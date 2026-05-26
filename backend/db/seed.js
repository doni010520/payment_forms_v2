// =====================================================================
// Seed: popula o banco com dados realistas para desenvolvimento
// Roda automaticamente na inicializacao do servidor (se banco vazio).
// =====================================================================
import bcrypt from 'bcryptjs';
import { getDb, initSchema, query, queryOne } from './index.js';

const SENHA_PADRAO = 'senha123'; // todos os usuarios de seed

/**
 * Verifica se ja foi seedado (existe pelo menos uma unidade).
 */
async function jaSeedado() {
  await initSchema();
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM unidades');
  return rows[0].n > 0;
}

export async function seed({ force = false } = {}) {
  await initSchema();

  if (!force && await jaSeedado()) {
    console.log('[seed] banco ja populado · pulando');
    return;
  }

  if (force) {
    const { truncateAll } = await import('./index.js');
    await truncateAll();
  }

  console.log('[seed] populando banco...');

  // --------------------------------------------------------------------
  // UNIDADES
  // --------------------------------------------------------------------
  const unidades = [
    ['HECC', 'Hospital Estadual Costa dos Coqueiros', 'Lauro de Freitas'],
    ['MRC',  'Maternidade Regional de Camaçari',     'Camaçari'],
    ['HMI',  'Hospital Materno-Infantil de Ilhéus',  'Ilhéus'],
    ['PN',   'Policlínica Narandiba',                'Salvador'],
    ['PE',   'Policlínica Escada',                   'Salvador'],
    ['CAPS-MSJ', 'CAPS Mata de São João',            'Mata de São João'],
    ['SVO',  'SVO Salvador',                         'Salvador'],
    ['SEDE', 'Sede FESF-SUS',                        'Salvador'],
  ];
  for (const [sigla, nome, cidade] of unidades) {
    await query(
      'INSERT INTO unidades (sigla, nome, cidade) VALUES ($1, $2, $3)',
      [sigla, nome, cidade]
    );
  }

  // --------------------------------------------------------------------
  // MODALIDADES
  // --------------------------------------------------------------------
  // Listas de documentos esperados por categoria de modalidade
  const docsMoe = JSON.stringify([
    { campo: 'nf',           label: 'Nota Fiscal de Serviço',          obrigatorio: true },
    { campo: 'recibo',       label: 'Recibo de pagamento (folha)',     obrigatorio: true },
    { campo: 'gps',          label: 'GPS (INSS) com comprovante',      obrigatorio: true },
    { campo: 'fgts',         label: 'GRF (FGTS) com comprovante',      obrigatorio: true },
    { campo: 'darf',         label: 'DARF (IRRF) com comprovante',     obrigatorio: false },
    { campo: 'cnd_inss',     label: 'CND Federal/INSS',                 obrigatorio: true },
    { campo: 'cnd_fgts',     label: 'CRF FGTS',                         obrigatorio: true },
    { campo: 'cnd_trab',     label: 'CNDT (Justiça do Trabalho)',       obrigatorio: true },
  ]);
  const docsServ = JSON.stringify([
    { campo: 'nf',           label: 'Nota Fiscal de Serviço',          obrigatorio: true },
    { campo: 'contrato',     label: 'Contrato ou aditivo aplicável',   obrigatorio: false },
    { campo: 'cnd_federal',  label: 'CND Federal',                      obrigatorio: true },
    { campo: 'cnd_estadual', label: 'CND Estadual',                     obrigatorio: true },
    { campo: 'cnd_municipal',label: 'CND Municipal',                    obrigatorio: true },
    { campo: 'cnd_fgts',     label: 'CRF FGTS',                         obrigatorio: true },
    { campo: 'cnd_trab',     label: 'CNDT (Justiça do Trabalho)',       obrigatorio: true },
  ]);
  const docsIns = JSON.stringify([
    { campo: 'nf',           label: 'Nota Fiscal de Mercadoria',       obrigatorio: true },
    { campo: 'romaneio',     label: 'Romaneio/recibo de entrega',      obrigatorio: true },
    { campo: 'cnd_federal',  label: 'CND Federal',                      obrigatorio: true },
    { campo: 'cnd_estadual', label: 'CND Estadual',                     obrigatorio: true },
    { campo: 'cnd_fgts',     label: 'CRF FGTS',                         obrigatorio: true },
  ]);
  const modalidades = [
    ['indenizatorio_moe',      'Pagamento Indenizatório · Mão de Obra Exclusiva', 'indenizatorio', 'formulario-hcc.html',              docsMoe],
    ['indenizatorio_servicos', 'Pagamento Indenizatório · Serviços',              'indenizatorio', 'formulario-hcc-servicos.html',     docsServ],
    ['indenizatorio_insumos',  'Pagamento Indenizatório · Insumos',               'indenizatorio', 'formulario-hcc-insumos.html',      docsIns],
    ['pagamento_moe',          'Pagamento c/ Mão de Obra Exclusiva',              'normal',        'formulario-hcc-pgto-mao-obra.html',docsMoe],
    ['pagamento_servico',      'Pagamento Serviço',                                'normal',        'formulario-hcc-pgto-servico.html', docsServ],
    ['pagamento_insumos',      'Pagamento Insumos',                                'normal',        'formulario-hcc-pgto-insumos.html', docsIns],
  ];
  for (const [codigo, nome, categoria, formulario, docs_esperados] of modalidades) {
    await query(
      'INSERT INTO modalidades (codigo, nome, categoria, formulario, documentos_esperados) VALUES ($1, $2, $3, $4, $5)',
      [codigo, nome, categoria, formulario, docs_esperados]
    );
  }

  // --------------------------------------------------------------------
  // FORNECEDORES
  // --------------------------------------------------------------------
  // Mix dos 3 tipos
  const fornecedores = [
    // com_portal (PJs que tem conta no portal e fazem auto-servico)
    { tipo: 'com_portal', razao_social: 'Empresa Hospitalar Ltda.', documento: '11222333000181', email: 'contato@empresahosp.com.br', telefone: '7199876-5432', unidades: ['HECC', 'MRC', 'HMI'] },
    { tipo: 'com_portal', razao_social: 'MedSupply Serviços S.A.',  documento: '44555666000199', email: 'faturamento@medsupply.com.br', telefone: '7133214455', unidades: ['HECC', 'MRC'] },
    { tipo: 'com_portal', razao_social: 'Vigilância Líder BA',      documento: '66777888000133', email: 'contato@vlider.com.br', telefone: '7133335577', unidades: ['HECC', 'CAPS-MSJ'] },
    { tipo: 'com_portal', razao_social: 'Limpeza Hospitalar BA',    documento: '22333444000155', email: 'faturamento@lhba.com.br', telefone: '7133886611', unidades: ['HECC'] },
    // externo_pj (PJs sem portal, operador opera)
    { tipo: 'externo_pj', razao_social: 'Insumos São José Ltda. ME',documento: '88111222000150', email: 'maria@insumosj.com.br', telefone: '7188776655', unidades: ['HECC'], criado_por_unidade: 'HECC' },
    { tipo: 'externo_pj', razao_social: 'Tec-Hospitalar Serviços',  documento: '99888777000122', email: 'faturamento@techospitalar.com.br', telefone: '7133557799', unidades: ['HECC', 'MRC'], criado_por_unidade: 'HECC' },
    // externo_pf (PF, autonomos)
    { tipo: 'externo_pf', razao_social: 'Maria das Graças Conceição', documento: '12345678900',   email: null, telefone: '7199876-1234', unidades: ['HECC'], criado_por_unidade: 'HECC' },
    { tipo: 'externo_pf', razao_social: 'João Pedreiro',              documento: '98765432111',   email: 'pedreirojp@gmail.com', telefone: '7199123-4567', unidades: ['HECC', 'MRC'], criado_por_unidade: 'HECC' },
  ];

  for (const f of fornecedores) {
    const criadoPorUnidadeId = f.criado_por_unidade
      ? (await queryOne('SELECT id FROM unidades WHERE sigla=$1', [f.criado_por_unidade])).id
      : null;
    const { rows: [row] } = await query(
      `INSERT INTO fornecedores (tipo, razao_social, documento, email, telefone, criado_por_unidade_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [f.tipo, f.razao_social, f.documento, f.email, f.telefone, criadoPorUnidadeId]
    );
    for (const sigla of f.unidades) {
      const u = await queryOne('SELECT id FROM unidades WHERE sigla=$1', [sigla]);
      await query(
        'INSERT INTO fornecedor_unidades (fornecedor_id, unidade_id) VALUES ($1, $2)',
        [row.id, u.id]
      );
    }
  }

  // --------------------------------------------------------------------
  // USUARIOS
  // --------------------------------------------------------------------
  const senhaHash = await bcrypt.hash(SENHA_PADRAO, 8);

  // 1 admin FESF
  await query(
    `INSERT INTO usuarios (papel, nome, email, senha_hash) VALUES ('admin_fesf', $1, $2, $3)`,
    ['Maria Andrade (FESF Sede)', 'maria.andrade@fesfsus.ba.gov.br', senhaHash]
  );

  // Operadores: 1 por unidade ativa
  const opNomes = {
    HECC: 'Carlos Souza',
    MRC:  'Beatriz Ramos',
    HMI:  'Felipe Tavares',
    PN:   'Ana Costa',
    PE:   'Rafael Lima',
    'CAPS-MSJ': 'Patrícia Mendes',
    SVO:  'Gabriel Pinto',
    SEDE: 'Mariana Reis',
  };
  for (const sigla of Object.keys(opNomes)) {
    const u = await queryOne('SELECT id FROM unidades WHERE sigla=$1', [sigla]);
    const email = `${opNomes[sigla].toLowerCase().normalize('NFD').replace(/[^a-z]/g, '.')}@fesfsus.ba.gov.br`.replace(/\.+/g, '.');
    await query(
      `INSERT INTO usuarios (papel, nome, email, senha_hash, unidade_id) VALUES ('operador_unidade', $1, $2, $3, $4)`,
      [`${opNomes[sigla]} (${sigla})`, email, senhaHash, u.id]
    );
  }

  // Usuarios para fornecedores com_portal
  const fornCompPortal = await query("SELECT id, razao_social, email FROM fornecedores WHERE tipo='com_portal'");
  for (const f of fornCompPortal.rows) {
    if (!f.email) continue;
    await query(
      `INSERT INTO usuarios (papel, nome, email, senha_hash, fornecedor_id) VALUES ('fornecedor', $1, $2, $3, $4)`,
      [`Contato · ${f.razao_social}`, f.email, senhaHash, f.id]
    );
  }

  // --------------------------------------------------------------------
  // EXEMPLOS DE ENVIOS (1 de cada origem para HECC)
  // --------------------------------------------------------------------
  const hecc = await queryOne('SELECT id FROM unidades WHERE sigla=$1', ['HECC']);
  const opHecc = await queryOne(`SELECT id FROM usuarios WHERE papel='operador_unidade' AND unidade_id=$1`, [hecc.id]);
  const modMoe = await queryOne(`SELECT id FROM modalidades WHERE codigo='indenizatorio_moe'`);
  const modInsumos = await queryOne(`SELECT id FROM modalidades WHERE codigo='pagamento_insumos'`);
  const fornEmpresa = await queryOne(`SELECT id FROM fornecedores WHERE documento='11222333000181'`);
  const fornInsumos = await queryOne(`SELECT id FROM fornecedores WHERE documento='88111222000150'`);
  const fornMaria = await queryOne(`SELECT id FROM fornecedores WHERE documento='12345678900'`);
  const usrFornEmpresa = await queryOne(`SELECT id FROM usuarios WHERE fornecedor_id=$1`, [fornEmpresa.id]);

  // Helper: insere envio + versao 1 + auditoria
  async function inserirEnvioCompleto({ protocolo, fornecedorId, unidadeId, modalidadeId, competencia, origem, valorCentavos, numeroNF, descricao, submetidoPorUsuarioId, submetidoPorNome, submetidoPorDocumento, linkPublicoId, motivoManual }) {
    const { rows: [e] } = await query(
      `INSERT INTO envios (protocolo, fornecedor_id, unidade_id, modalidade_id, competencia, origem, status,
                            valor_centavos, numero_nf, descricao, submetido_por_usuario_id, submetido_por_nome, submetido_por_documento, link_publico_id, motivo_manual)
       VALUES ($1,$2,$3,$4,$5,$6,'em_analise',$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [protocolo, fornecedorId, unidadeId, modalidadeId, competencia, origem,
       valorCentavos || 0, numeroNF || null, descricao || null,
       submetidoPorUsuarioId || null, submetidoPorNome || null, submetidoPorDocumento || null,
       linkPublicoId || null, motivoManual || null]
    );
    await query(
      `INSERT INTO versoes_envio (envio_id, numero, dados_json) VALUES ($1, 1, $2)`,
      [e.id, JSON.stringify({ seed: true, valorCentavos, numeroNF, descricao })]
    );
    const acao = origem === 'portal' ? 'criado_portal' :
                 origem === 'link_publico' ? 'criado_link_publico' : 'criado_manual';
    await query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, detalhe) VALUES ('envio', $1, $2, $3, $4)`,
      [e.id, acao, submetidoPorUsuarioId, `Seed · protocolo ${protocolo}`]
    );
    return e;
  }

  // Envio via portal (logado)
  await inserirEnvioCompleto({
    protocolo: 'HECC-SEED-0001',
    fornecedorId: fornEmpresa.id, unidadeId: hecc.id, modalidadeId: modMoe.id,
    competencia: '2026-05', origem: 'portal',
    valorCentavos: 15800000, numeroNF: 'NF-2026-0517',
    descricao: 'Limpeza hospitalar — alas A e B',
    submetidoPorUsuarioId: usrFornEmpresa?.id,
  });

  // Envio via link publico
  const tokenLink = 'pub_seed_link_001';
  const { rows: [linkRow] } = await query(
    `INSERT INTO links_publicos (token, fornecedor_id, unidade_id, modalidade_id, email_destinatario, criado_por_usuario_id, usos)
     VALUES ($1, $2, $3, $4, $5, $6, 1) RETURNING id`,
    [tokenLink, fornInsumos.id, hecc.id, modInsumos.id, 'maria@insumosj.com.br', opHecc.id]
  );
  await inserirEnvioCompleto({
    protocolo: 'HECC-SEED-0002',
    fornecedorId: fornInsumos.id, unidadeId: hecc.id, modalidadeId: modInsumos.id,
    competencia: '2026-05', origem: 'link_publico',
    valorCentavos: 1845000, descricao: 'Insumos hospitalares · mai/2026',
    submetidoPorNome: 'Maria da Silva', submetidoPorDocumento: '88111222000150',
    linkPublicoId: linkRow.id,
  });

  // Envio manual (operador lancou)
  await inserirEnvioCompleto({
    protocolo: 'HECC-SEED-0003',
    fornecedorId: fornMaria.id, unidadeId: hecc.id, modalidadeId: modInsumos.id,
    competencia: '2026-05', origem: 'manual',
    valorCentavos: 280000, descricao: 'Diaria de servico avulso',
    submetidoPorUsuarioId: opHecc.id,
    motivoManual: 'Fornecedor PF sem e-mail; contato apenas por telefone — autorizacao verbal.',
  });

  // --------------------------------------------------------------------
  // EXPECTATIVAS (cenario 3: fornecedor que ainda nao respondeu)
  // --------------------------------------------------------------------
  // Uma expectativa atrasada (Tec-Hospitalar)
  const fornTec = await queryOne(`SELECT id FROM fornecedores WHERE documento='99888777000122'`);
  await query(
    `INSERT INTO expectativas (fornecedor_id, unidade_id, modalidade_id, competencia, prazo, origem_prevista, status, criada_por_usuario_id, observacoes)
     VALUES ($1, $2, $3, '2026-05', DATE '2026-05-19', 'link_publico', 'atrasada', $4, 'Link enviado em 14/05, nao foi aberto.')`,
    [fornTec.id, hecc.id, modInsumos.id, opHecc.id]
  );
  // Uma expectativa sem resposta (Maria PF)
  await query(
    `INSERT INTO expectativas (fornecedor_id, unidade_id, modalidade_id, competencia, prazo, origem_prevista, status, criada_por_usuario_id, observacoes)
     VALUES ($1, $2, $3, '2026-05', DATE '2026-05-28', 'manual', 'sem_resposta', $4, 'PF sem email, contato telefonico em curso.')`,
    [fornMaria.id, hecc.id, modInsumos.id, opHecc.id]
  );
  // Uma expectativa aguardando (Vigilancia)
  const fornVig = await queryOne(`SELECT id FROM fornecedores WHERE documento='66777888000133'`);
  await query(
    `INSERT INTO expectativas (fornecedor_id, unidade_id, modalidade_id, competencia, prazo, origem_prevista, status, criada_por_usuario_id)
     VALUES ($1, $2, $3, '2026-05', DATE '2026-05-30', 'portal', 'aguardando', $4)`,
    [fornVig.id, hecc.id, modMoe.id, opHecc.id]
  );

  console.log('[seed] OK');
  console.log(`[seed] senha padrao para todos os usuarios: ${SENHA_PADRAO}`);
}

// Executa diretamente se chamado via CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const force = process.argv.includes('--force');
  await seed({ force });
  process.exit(0);
}
