// =====================================================================
// Paginacao padronizada (RFC-ish: page/per_page + headers X-Total-*).
// Compatibilidade: aceita ?limit=&offset= como fallback legado.
// =====================================================================

const PER_PAGE_DEFAULT = 50;
const PER_PAGE_MAX = 200;

/**
 * Le query params e devolve { page, perPage, limit, offset, modoLegado }.
 *   modoLegado=true quando o cliente mandou ?limit= (paginacao via offset puro).
 *   modoLegado=false quando usou ?page= ou nada (default 1).
 */
export function aplicarPaginacao(req) {
  const qLimit = req.query.limit;
  const qOffset = req.query.offset;
  const qPage = req.query.page;
  const qPerPage = req.query.per_page;

  // Modo legado: ?limit=&offset= → preserva comportamento atual
  if (qLimit != null || qOffset != null) {
    const limit = Math.max(1, Math.min(PER_PAGE_MAX, Number(qLimit) || PER_PAGE_DEFAULT));
    const offset = Math.max(0, Number(qOffset) || 0);
    return {
      page: Math.floor(offset / limit) + 1,
      perPage: limit, limit, offset, modoLegado: true,
    };
  }
  // Modo paginado: ?page=&per_page=
  // Trata 0/negativo explicitamente (Number(0) || X falha o OR pq 0 eh falsy)
  const perPageRaw = qPerPage != null && qPerPage !== '' ? Number(qPerPage) : PER_PAGE_DEFAULT;
  const perPage = Math.max(1, Math.min(PER_PAGE_MAX, Number.isFinite(perPageRaw) && perPageRaw >= 1 ? perPageRaw : 1));
  const pageRaw = qPage != null && qPage !== '' ? Number(qPage) : 1;
  const page = Math.max(1, Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1);
  const offset = (page - 1) * perPage;
  return { page, perPage, limit: perPage, offset, modoLegado: false };
}

/**
 * Setta os headers padronizados de paginacao.
 *   X-Total-Count      : total absoluto
 *   X-Page             : pagina atual
 *   X-Per-Page         : tamanho da pagina
 *   X-Total-Pages      : total de paginas
 * Tambem inclui rel-link no header Link (RFC 5988) para navegacao.
 */
export function setPaginationHeaders(res, { total, page, perPage, baseUrl }) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  res.setHeader('X-Total-Count', String(total));
  res.setHeader('X-Page', String(page));
  res.setHeader('X-Per-Page', String(perPage));
  res.setHeader('X-Total-Pages', String(totalPages));
  if (baseUrl) {
    const links = [];
    const make = (p, rel) => `<${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${p}&per_page=${perPage}>; rel="${rel}"`;
    links.push(make(1, 'first'));
    links.push(make(totalPages, 'last'));
    if (page > 1) links.push(make(page - 1, 'prev'));
    if (page < totalPages) links.push(make(page + 1, 'next'));
    res.setHeader('Link', links.join(', '));
  }
}

/**
 * Helper combinado: aplica paginacao + retorna { page, perPage, limit, offset } +
 * funcao para depois settar headers quando ja souber o total.
 */
export function paginar(req, res) {
  const p = aplicarPaginacao(req);
  return {
    ...p,
    setHeaders: (total) => setPaginationHeaders(res, {
      total, page: p.page, perPage: p.perPage,
      baseUrl: req.baseUrl + req.path,
    }),
  };
}
