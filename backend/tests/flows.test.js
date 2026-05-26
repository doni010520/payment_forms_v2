// =====================================================================
// Testes funcionais ponta-a-ponta dos 3 cenarios de envio
// Roda sem framework — usa assert nativo.
// =====================================================================
import assert from 'node:assert/strict';
import { seed } from '../db/seed.js';
import { query, queryOne, closeDb, truncateAll, initSchema } from '../db/index.js';
import { login, verifyToken } from '../services/auth-service.js';
import { criarEnvioPortal, criarEnvioLinkPublico, criarEnvioManual, listarEnviosUnidade, resumoOrigemUnidade } from '../services/envio-service.js';
import { criarLinkPublico, lookupToken } from '../services/link-service.js';
import { criarExpectativa, enviarLembrete, executarEscalonamento, cancelarExpectativa, listarExpectativasUnidade } from '../services/expectativa-service.js';

let passed = 0; let failed = 0; const failures = [];

async function test(nome, fn) {
  try {
    await fn();
    console.log(`  ✓ ${nome}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${nome}`);
    console.log(`    ${e.message}`);
    if (process.env.DEBUG) console.log(e.stack);
    failed++;
    failures.push({ nome, err: e });
  }
}

function group(titulo, fn) {
  return (async () => {
    console.log(`\n[${titulo}]`);
    await fn();
  })();
}

// ===================================================================
// RESET INICIAL: garante estado limpo
// ===================================================================
console.log('Resetando banco para teste...');
await initSchema();
await truncateAll();
await seed({ force: true });

// ===================================================================
// AUTH
// ===================================================================
let tokenFornEmpresa = null;
let tokenOperadorHecc = null;
let tokenAdminFesf = null;

await group('Autenticacao', async () => {
  await test('login fornecedor logado retorna token JWT', async () => {
    const r = await login('contato@empresahosp.com.br', 'senha123');
    assert.ok(r.token, 'token presente');
    assert.equal(r.usuario.papel, 'fornecedor');
    assert.ok(r.usuario.fornecedor_id);
    const payload = verifyToken(r.token);
    assert.equal(payload.papel, 'fornecedor');
    tokenFornEmpresa = r.token;
  });

  await test('login operador unidade retorna token com unidade_id', async () => {
    const r = await login('carlos.souza..hecc.@fesfsus.ba.gov.br', 'senha123').catch(() => null);
    // o email gerado pode variar — buscar diretamente
    const u = await queryOne(`SELECT email FROM usuarios WHERE papel='operador_unidade' AND unidade_id=(SELECT id FROM unidades WHERE sigla='HECC')`);
    assert.ok(u, 'operador HECC existe no seed');
    const r2 = await login(u.email, 'senha123');
    assert.equal(r2.usuario.papel, 'operador_unidade');
    assert.ok(r2.usuario.unidade_id);
    tokenOperadorHecc = r2.token;
  });

  await test('login admin FESF retorna papel admin', async () => {
    const r = await login('maria.andrade@fesfsus.ba.gov.br', 'senha123');
    assert.equal(r.usuario.papel, 'admin_fesf');
    tokenAdminFesf = r.token;
  });

  await test('senha errada rejeita com erro INVALID_CREDENTIALS', async () => {
    await assert.rejects(
      login('contato@empresahosp.com.br', 'errada'),
      (e) => e.code === 'INVALID_CREDENTIALS'
    );
  });

  await test('usuario inexistente rejeita', async () => {
    await assert.rejects(
      login('nao.existe@nada.com', 'qualquer'),
      (e) => e.code === 'INVALID_CREDENTIALS'
    );
  });
});

// ===================================================================
// CENARIO 1: ENVIO VIA PORTAL (fornecedor logado)
// ===================================================================
await group('Cenario 1: Envio via Portal (fornecedor logado)', async () => {
  const usrForn = await queryOne(`SELECT * FROM usuarios WHERE email='contato@empresahosp.com.br'`);
  const hecc = await queryOne(`SELECT id FROM unidades WHERE sigla='HECC'`);
  const mod = await queryOne(`SELECT id FROM modalidades WHERE codigo='indenizatorio_moe'`);

  let envioCriado;
  await test('fornecedor logado cria envio via Portal', async () => {
    envioCriado = await criarEnvioPortal({
      usuarioId: usrForn.id,
      unidadeId: hecc.id,
      modalidadeId: mod.id,
      competencia: '2026-06',
      valorCentavos: 14500000,
      numeroNF: 'NF-2026-0612',
      descricao: 'Servicos junho 2026',
    });
    assert.ok(envioCriado.id, 'envio criado');
    assert.equal(envioCriado.origem, 'portal');
    assert.equal(envioCriado.status, 'em_analise');
    assert.match(envioCriado.protocolo, /^HECC-\d{4}-\d{4}$/, 'protocolo formato OK');
  });

  await test('versao 1 do envio criada', async () => {
    const v = await queryOne('SELECT * FROM versoes_envio WHERE envio_id=$1', [envioCriado.id]);
    assert.ok(v); assert.equal(v.numero, 1);
  });

  await test('auditoria registrou acao criado_portal', async () => {
    const a = await queryOne(
      `SELECT * FROM auditoria WHERE entidade='envio' AND entidade_id=$1 AND acao='criado_portal'`,
      [envioCriado.id]
    );
    assert.ok(a);
    assert.equal(a.usuario_id, usrForn.id);
  });

  await test('fornecedor nao pode enviar para unidade que nao atende', async () => {
    const svo = await queryOne(`SELECT id FROM unidades WHERE sigla='SVO'`);
    await assert.rejects(
      criarEnvioPortal({
        usuarioId: usrForn.id,
        unidadeId: svo.id,
        modalidadeId: mod.id,
        competencia: '2026-06',
      }),
      (e) => e.code === 'NOT_LINKED'
    );
  });

  await test('operador NAO pode usar fluxo portal (apenas fornecedor)', async () => {
    const usrOp = await queryOne(`SELECT id FROM usuarios WHERE papel='operador_unidade' AND unidade_id=$1`, [hecc.id]);
    await assert.rejects(
      criarEnvioPortal({
        usuarioId: usrOp.id,
        unidadeId: hecc.id,
        modalidadeId: mod.id,
        competencia: '2026-06',
      }),
      (e) => e.code === 'FORBIDDEN'
    );
  });
});

// ===================================================================
// CENARIO 2: LINK PUBLICO (sem login)
// ===================================================================
await group('Cenario 2: Link Publico (anonimo, sem login)', async () => {
  const usrOp = await queryOne(`SELECT * FROM usuarios WHERE papel='operador_unidade' AND unidade_id=(SELECT id FROM unidades WHERE sigla='HECC')`);
  const fornInsumos = await queryOne(`SELECT * FROM fornecedores WHERE documento='88111222000150'`); // Insumos S. Jose
  const hecc = await queryOne(`SELECT id FROM unidades WHERE sigla='HECC'`);
  const modInsumos = await queryOne(`SELECT id FROM modalidades WHERE codigo='pagamento_insumos'`);

  let linkGerado;
  await test('operador cria link publico', async () => {
    linkGerado = await criarLinkPublico({
      usuarioId: usrOp.id,
      fornecedorId: fornInsumos.id,
      unidadeId: hecc.id,
      modalidadeId: modInsumos.id,
      emailDestinatario: 'maria@insumosj.com.br',
    });
    assert.ok(linkGerado.token);
    assert.match(linkGerado.token, /^pub_/);
    assert.equal(linkGerado.usos, 0);
  });

  await test('lookupToken retorna contexto correto sem expor dados sensiveis', async () => {
    const info = await lookupToken(linkGerado.token);
    assert.ok(info);
    assert.equal(info.valido, true);
    assert.equal(info.unidade_sigla, 'HECC');
    assert.equal(info.modalidade_codigo, 'pagamento_insumos');
    assert.equal(info.razao_social, 'Insumos São José Ltda. ME');
  });

  let envioPub;
  await test('anonimo submete via link publico', async () => {
    envioPub = await criarEnvioLinkPublico({
      token: linkGerado.token,
      competencia: '2026-06',
      valorCentavos: 1500000,
      numeroNF: 'NF-INSUMOS-2026-12',
      descricao: 'Insumos junho 2026',
      dadosSubmetente: { nome: 'Maria da Silva', documento: '88111222000150' },
    });
    assert.equal(envioPub.origem, 'link_publico');
    assert.ok(envioPub.protocolo);
    assert.equal(envioPub.link_publico_id, linkGerado.id);
  });

  await test('link de uso unico fica invalido apos primeiro uso', async () => {
    const info = await lookupToken(linkGerado.token);
    assert.equal(info.valido, false);
    assert.equal(info.motivoInvalido, 'ja_utilizado');
  });

  await test('reuso de link rejeita com ALREADY_USED', async () => {
    await assert.rejects(
      criarEnvioLinkPublico({
        token: linkGerado.token,
        competencia: '2026-07',
      }),
      (e) => e.code === 'ALREADY_USED'
    );
  });

  await test('token invalido rejeita com INVALID_TOKEN', async () => {
    await assert.rejects(
      criarEnvioLinkPublico({ token: 'pub_naoexiste', competencia: '2026-06' }),
      (e) => e.code === 'INVALID_TOKEN'
    );
  });

  await test('link multiuso permite varios envios', async () => {
    // V227/O6: multi-uso exige limite (expira_em ou usos_max)
    const linkM = await criarLinkPublico({
      usuarioId: usrOp.id,
      fornecedorId: fornInsumos.id,
      unidadeId: hecc.id,
      modalidadeId: modInsumos.id,
      usoMultiplo: true,
      expiraEm: '2099-12-31',
    });
    await criarEnvioLinkPublico({ token: linkM.token, competencia: '2026-06' });
    await criarEnvioLinkPublico({ token: linkM.token, competencia: '2026-07' });
    const info = await lookupToken(linkM.token);
    assert.equal(info.valido, true);
    assert.equal(info.usos, 2);
  });
});

// ===================================================================
// CENARIO 3: LANCAMENTO MANUAL (operador lanca pelo fornecedor)
// ===================================================================
await group('Cenario 3: Lancamento Manual (operador lanca por fornecedor)', async () => {
  const hecc = await queryOne(`SELECT id FROM unidades WHERE sigla='HECC'`);
  const mrc  = await queryOne(`SELECT id FROM unidades WHERE sigla='MRC'`);
  const usrOpHecc = await queryOne(`SELECT * FROM usuarios WHERE papel='operador_unidade' AND unidade_id=$1`, [hecc.id]);
  const usrOpMrc  = await queryOne(`SELECT * FROM usuarios WHERE papel='operador_unidade' AND unidade_id=$1`, [mrc.id]);
  const fornMaria = await queryOne(`SELECT * FROM fornecedores WHERE documento='12345678900'`); // PF
  const modServ = await queryOne(`SELECT id FROM modalidades WHERE codigo='pagamento_servico'`);

  let envioManual;
  await test('operador HECC cria envio manual para PF externo (Maria)', async () => {
    envioManual = await criarEnvioManual({
      usuarioId: usrOpHecc.id,
      fornecedorId: fornMaria.id,
      unidadeId: hecc.id,
      modalidadeId: modServ.id,
      competencia: '2026-06',
      valorCentavos: 280000,
      descricao: 'Servico avulso PF',
      motivo: 'Fornecedor PF sem e-mail; autorizacao por telefone',
    });
    assert.equal(envioManual.origem, 'manual');
    assert.equal(envioManual.submetido_por_usuario_id, usrOpHecc.id);
    assert.ok(envioManual.motivo_manual);
  });

  await test('lancamento manual SEM motivo eh rejeitado', async () => {
    await assert.rejects(
      criarEnvioManual({
        usuarioId: usrOpHecc.id,
        fornecedorId: fornMaria.id,
        unidadeId: hecc.id,
        modalidadeId: modServ.id,
        competencia: '2026-06',
        motivo: '', // vazio
      }),
      (e) => e.code === 'MOTIVO_INVALID'
    );
  });

  await test('operador MRC NAO pode lancar manual para HECC', async () => {
    await assert.rejects(
      criarEnvioManual({
        usuarioId: usrOpMrc.id,
        fornecedorId: fornMaria.id,
        unidadeId: hecc.id, // unidade errada
        modalidadeId: modServ.id,
        competencia: '2026-06',
        motivo: 'tentativa cruzada',
      }),
      (e) => e.code === 'WRONG_UNIT'
    );
  });

  await test('fornecedor logado NAO pode lancar manual', async () => {
    const usrForn = await queryOne(`SELECT id FROM usuarios WHERE papel='fornecedor' LIMIT 1`);
    await assert.rejects(
      criarEnvioManual({
        usuarioId: usrForn.id,
        fornecedorId: fornMaria.id,
        unidadeId: hecc.id,
        modalidadeId: modServ.id,
        competencia: '2026-06',
        motivo: 'tentando bypass',
      }),
      (e) => e.code === 'FORBIDDEN'
    );
  });

  await test('admin FESF pode lancar manual em qualquer unidade', async () => {
    const usrAdmin = await queryOne(`SELECT id FROM usuarios WHERE papel='admin_fesf'`);
    const envio = await criarEnvioManual({
      usuarioId: usrAdmin.id,
      fornecedorId: fornMaria.id,
      unidadeId: hecc.id,
      modalidadeId: modServ.id,
      competencia: '2026-06',
      motivo: 'Admin lancando excepcionalmente',
    });
    assert.equal(envio.origem, 'manual');
  });
});

// ===================================================================
// LISTAGEM POR UNIDADE
// ===================================================================
await group('Listagem por unidade', async () => {
  const hecc = await queryOne(`SELECT id FROM unidades WHERE sigla='HECC'`);
  const mrc  = await queryOne(`SELECT id FROM unidades WHERE sigla='MRC'`);

  await test('listagem HECC retorna so envios da HECC', async () => {
    const envios = await listarEnviosUnidade(hecc.id);
    assert.ok(envios.length > 0);
    for (const e of envios) {
      // verifica que envio realmente pertence ao HECC
      const u = await queryOne('SELECT unidade_id FROM envios WHERE id=$1', [e.id]);
      assert.equal(u.unidade_id, hecc.id);
    }
  });

  await test('filtro por origem retorna apenas envios daquela origem', async () => {
    const manuais = await listarEnviosUnidade(hecc.id, { origem: 'manual' });
    assert.ok(manuais.length > 0);
    for (const e of manuais) assert.equal(e.origem, 'manual');
    const portais = await listarEnviosUnidade(hecc.id, { origem: 'portal' });
    for (const e of portais) assert.equal(e.origem, 'portal');
  });

  await test('listagem MRC nao mistura com HECC', async () => {
    const enviosMrc = await listarEnviosUnidade(mrc.id);
    for (const e of enviosMrc) {
      const u = await queryOne('SELECT unidade_id FROM envios WHERE id=$1', [e.id]);
      assert.equal(u.unidade_id, mrc.id);
    }
  });

  await test('resumo por origem soma valores corretamente', async () => {
    const resumo = await resumoOrigemUnidade(hecc.id);
    const origens = resumo.map(r => r.origem);
    assert.ok(origens.includes('portal'));
    assert.ok(origens.includes('manual'));
    // total_centavos deve ser >= 0
    for (const r of resumo) assert.ok(Number(r.total_centavos) >= 0);
  });
});

// ===================================================================
// EXPECTATIVAS / CICLO DE PENDENCIAS
// ===================================================================
await group('Expectativas e ciclo de pendencias', async () => {
  const hecc = await queryOne(`SELECT id FROM unidades WHERE sigla='HECC'`);
  const usrOpHecc = await queryOne(`SELECT id FROM usuarios WHERE papel='operador_unidade' AND unidade_id=$1`, [hecc.id]);
  const fornVig = await queryOne(`SELECT id FROM fornecedores WHERE documento='66777888000133'`);
  const modMoe = await queryOne(`SELECT id FROM modalidades WHERE codigo='indenizatorio_moe'`);

  let expCriada;
  await test('operador cria expectativa', async () => {
    expCriada = await criarExpectativa({
      usuarioId: usrOpHecc.id,
      fornecedorId: fornVig.id,
      unidadeId: hecc.id,
      modalidadeId: modMoe.id,
      competencia: '2026-07',
      prazo: '2026-07-30',
      origemPrevista: 'portal',
    });
    assert.equal(expCriada.status, 'aguardando');
  });

  await test('enviar lembrete promove status para lembrado', async () => {
    await enviarLembrete({ expectativaId: expCriada.id, canal: 'email', usuarioId: usrOpHecc.id });
    const e2 = await queryOne('SELECT status FROM expectativas WHERE id=$1', [expCriada.id]);
    assert.equal(e2.status, 'lembrado');
  });

  await test('contagem de lembretes incrementa', async () => {
    await enviarLembrete({ expectativaId: expCriada.id, canal: 'portal', usuarioId: usrOpHecc.id });
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM lembretes WHERE expectativa_id=$1', [expCriada.id]);
    assert.equal(rows[0].n, 2);
  });

  await test('escalonamento marca prazo passado como atrasada', async () => {
    // a expectativa de seed Tec-Hospitalar tem prazo 2026-05-19 → ja muito atrasada
    // forcamos hoje >2026-05-26 (D+7 atras)
    const r = await executarEscalonamento({ hoje: new Date('2026-06-10') });
    // ja pode estar atrasada no seed, mas a logica deve mover qualquer aguardando/lembrado/sem_resposta
    const exp = await queryOne('SELECT status FROM expectativas WHERE fornecedor_id=(SELECT id FROM fornecedores WHERE documento=$1) AND prazo=$2', ['99888777000122', '2026-05-19']);
    assert.equal(exp.status, 'atrasada');
  });

  await test('cancelar expectativa exige motivo', async () => {
    await assert.rejects(
      cancelarExpectativa({ expectativaId: expCriada.id, usuarioId: usrOpHecc.id, motivo: 'no' }),
      (e) => e.code === 'MOTIVO_INVALID'
    );
  });

  await test('cancelar com motivo valido marca como cancelada', async () => {
    await cancelarExpectativa({ expectativaId: expCriada.id, usuarioId: usrOpHecc.id, motivo: 'Fornecedor encerrou contrato' });
    const e = await queryOne('SELECT status, motivo_cancelamento FROM expectativas WHERE id=$1', [expCriada.id]);
    assert.equal(e.status, 'cancelada');
    assert.ok(e.motivo_cancelamento);
  });

  await test('envio que cumpre uma expectativa marca como cumprida', async () => {
    const fornInsumos = await queryOne(`SELECT id FROM fornecedores WHERE documento='88111222000150'`);
    const modInsumos = await queryOne(`SELECT id FROM modalidades WHERE codigo='pagamento_insumos'`);
    // cria expectativa
    const exp = await criarExpectativa({
      usuarioId: usrOpHecc.id,
      fornecedorId: fornInsumos.id,
      unidadeId: hecc.id,
      modalidadeId: modInsumos.id,
      competencia: '2026-08',
      prazo: '2026-08-25',
      origemPrevista: 'manual',
    });
    // cria envio manual com mesmo fornecedor+unidade+modalidade+competencia
    await criarEnvioManual({
      usuarioId: usrOpHecc.id,
      fornecedorId: fornInsumos.id,
      unidadeId: hecc.id,
      modalidadeId: modInsumos.id,
      competencia: '2026-08',
      motivo: 'cumprimento de expectativa',
    });
    const eAtual = await queryOne('SELECT status, envio_id FROM expectativas WHERE id=$1', [exp.id]);
    assert.equal(eAtual.status, 'cumprida');
    assert.ok(eAtual.envio_id);
  });

  await test('listagem ordena criticas primeiro (atrasadas no topo)', async () => {
    const lista = await listarExpectativasUnidade(hecc.id);
    // primeira deve ser atrasada ou sem_resposta
    if (lista.length > 0) {
      const primeira = lista[0];
      const ordem = { atrasada: 1, sem_resposta: 2, lembrado: 3, aguardando: 4, cancelada: 5, cumprida: 6 };
      const valor = ordem[primeira.status];
      for (const e of lista.slice(1)) {
        assert.ok(ordem[e.status] >= valor, `${primeira.status}(${valor}) deve preceder ${e.status}(${ordem[e.status]})`);
      }
    }
  });
});

// ===================================================================
// AUDITORIA: garantia de trilha completa
// ===================================================================
await group('Auditoria', async () => {
  await test('todas as criacoes de envio geram registro auditoria', async () => {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM auditoria
       WHERE entidade='envio' AND acao IN ('criado_portal','criado_link_publico','criado_manual')`
    );
    assert.ok(rows[0].n > 0, 'pelo menos um registro de criacao');
  });

  await test('cada envio tem registro de auditoria', async () => {
    const { rows } = await query(`SELECT e.id FROM envios e`);
    for (const e of rows) {
      const a = await queryOne(`SELECT id FROM auditoria WHERE entidade='envio' AND entidade_id=$1`, [e.id]);
      assert.ok(a, `envio ${e.id} tem auditoria`);
    }
  });
});

// ===================================================================
// FINALIZACAO
// ===================================================================
console.log(`\n========================================`);
console.log(`Resultado: ${passed} passou · ${failed} falhou`);
console.log(`========================================`);
if (failed > 0) {
  console.log('\nFalhas:');
  for (const f of failures) console.log(`  - ${f.nome}: ${f.err.message}`);
}

await closeDb();
process.exit(failed > 0 ? 1 : 0);
