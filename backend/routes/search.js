// =====================================================================
// Busca global — unifica fornecedores, envios e unidades em um endpoint.
// Respeita escopo do usuario (RBAC por papel).
// =====================================================================
import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../services/auth-service.js';

const router = Router();

const LIMITE_POR_CATEGORIA = 10;
const TAM_MIN_QUERY = 2;

/**
 * GET /api/search?q=<termo>[&tipos=fornecedores,envios,unidades]
 * Resposta: { q, resultados: { fornecedores, envios, unidades }, total }
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < TAM_MIN_QUERY) {
      return res.status(400).json({
        error: `query muito curta (min ${TAM_MIN_QUERY} caracteres)`,
        min: TAM_MIN_QUERY,
      });
    }
    const tipos = req.query.tipos
      ? String(req.query.tipos).split(',').map(s => s.trim()).filter(Boolean)
      : ['fornecedores', 'envios', 'unidades'];

    const usuario = req.usuario;
    const padraoDoc = '%' + q.toLowerCase().replace(/[.\-\/]/g, '') + '%'; // documento: so digitos
    const padraoTexto = '%' + q.toLowerCase() + '%';

    const resultados = { fornecedores: [], envios: [], unidades: [] };

    // FORNECEDORES — admin ve todos; operador ve da unidade dele; fornecedor ve so o proprio
    if (tipos.includes('fornecedores')) {
      let sql, params;
      if (usuario.papel === 'admin_fesf') {
        sql = `SELECT id, razao_social, nome_fantasia, documento, tipo, status_engajamento
               FROM fornecedores
               WHERE LOWER(razao_social) LIKE $1
                  OR LOWER(COALESCE(nome_fantasia, '')) LIKE $1
                  OR documento LIKE $2
               ORDER BY razao_social LIMIT $3`;
        params = [padraoTexto, padraoDoc, LIMITE_POR_CATEGORIA];
      } else if (usuario.papel === 'operador_unidade') {
        sql = `SELECT DISTINCT f.id, f.razao_social, f.nome_fantasia, f.documento, f.tipo, f.status_engajamento
               FROM fornecedores f
               JOIN fornecedor_unidades fu ON fu.fornecedor_id = f.id
               WHERE fu.unidade_id = $1
                 AND (LOWER(f.razao_social) LIKE $2
                      OR LOWER(COALESCE(f.nome_fantasia, '')) LIKE $2
                      OR f.documento LIKE $3)
               ORDER BY f.razao_social LIMIT $4`;
        params = [usuario.unidade_id, padraoTexto, padraoDoc, LIMITE_POR_CATEGORIA];
      } else if (usuario.papel === 'fornecedor') {
        sql = `SELECT id, razao_social, nome_fantasia, documento, tipo, status_engajamento
               FROM fornecedores WHERE id = $1
                 AND (LOWER(razao_social) LIKE $2
                      OR LOWER(COALESCE(nome_fantasia, '')) LIKE $2
                      OR documento LIKE $3)`;
        params = [usuario.fornecedor_id, padraoTexto, padraoDoc];
      }
      if (sql) {
        const { rows } = await query(sql, params);
        resultados.fornecedores = rows;
      }
    }

    // ENVIOS — busca por protocolo, NF, competencia, nome do fornecedor
    if (tipos.includes('envios')) {
      let scope = '';
      const params = [padraoTexto];
      if (usuario.papel === 'operador_unidade') {
        params.push(usuario.unidade_id);
        scope = `AND e.unidade_id = $${params.length}`;
      } else if (usuario.papel === 'fornecedor') {
        params.push(usuario.fornecedor_id);
        scope = `AND e.fornecedor_id = $${params.length}`;
      }
      params.push(LIMITE_POR_CATEGORIA);
      const sql = `
        SELECT e.id, e.protocolo, e.numero_nf, e.competencia, e.status, e.valor_centavos, e.criado_em,
               f.razao_social AS fornecedor_nome, u.sigla AS unidade_sigla
        FROM envios e
        LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
        LEFT JOIN unidades u ON u.id = e.unidade_id
        WHERE (LOWER(e.protocolo) LIKE $1
               OR LOWER(COALESCE(e.numero_nf, '')) LIKE $1
               OR LOWER(COALESCE(e.competencia, '')) LIKE $1
               OR LOWER(COALESCE(f.razao_social, '')) LIKE $1)
          ${scope}
        ORDER BY e.criado_em DESC
        LIMIT $${params.length}`;
      const { rows } = await query(sql, params);
      resultados.envios = rows;
    }

    // UNIDADES — admin/operador podem buscar todas; fornecedor so as que atende
    if (tipos.includes('unidades')) {
      let sql, params;
      if (usuario.papel === 'fornecedor') {
        sql = `SELECT DISTINCT u.id, u.sigla, u.nome, u.cidade, u.estado
               FROM unidades u
               JOIN fornecedor_unidades fu ON fu.unidade_id = u.id
               WHERE fu.fornecedor_id = $1
                 AND u.ativa = TRUE
                 AND (LOWER(u.sigla) LIKE $2 OR LOWER(u.nome) LIKE $2 OR LOWER(u.cidade) LIKE $2)
               ORDER BY u.sigla LIMIT $3`;
        params = [usuario.fornecedor_id, padraoTexto, LIMITE_POR_CATEGORIA];
      } else {
        sql = `SELECT id, sigla, nome, cidade, estado
               FROM unidades
               WHERE ativa = TRUE
                 AND (LOWER(sigla) LIKE $1 OR LOWER(nome) LIKE $1 OR LOWER(cidade) LIKE $1)
               ORDER BY sigla LIMIT $2`;
        params = [padraoTexto, LIMITE_POR_CATEGORIA];
      }
      const { rows } = await query(sql, params);
      resultados.unidades = rows;
    }

    const total = resultados.fornecedores.length + resultados.envios.length + resultados.unidades.length;
    res.json({ q, resultados, total, limite_por_categoria: LIMITE_POR_CATEGORIA });
  } catch (e) {
    console.error('[search]', e);
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

export default router;
