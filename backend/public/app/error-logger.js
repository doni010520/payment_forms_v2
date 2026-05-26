// =====================================================================
// V291: Error logger — captura erros do cliente e envia ao backend
// Instalado automaticamente quando api.js é carregado (todas as páginas).
//
// Captura:
//   1. window.onerror              → runtime errors (TypeError, ReferenceError, etc)
//   2. window.unhandledrejection   → promises rejeitadas sem catch
//   3. console.error               → logs explícitos de erro
//   4. fetch failures              → network errors + HTTP 5xx (via wrapper)
//
// Buffer + debounce para não floodar o backend (envia em batches de até 2s).
// =====================================================================

const BUFFER = [];
let FLUSH_TIMER = null;
const FLUSH_DELAY = 1500;
const MAX_BUFFER = 50;
let ENABLED = true;

function clip(s, n) { return typeof s === 'string' ? s.substring(0, n) : null; }

async function flush() {
  FLUSH_TIMER = null;
  if (BUFFER.length === 0 || !ENABLED) return;
  const items = BUFFER.splice(0, BUFFER.length);
  const token = localStorage.getItem('fesf_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Envia em paralelo (sem awaits sequenciais)
  for (const item of items) {
    try {
      await fetch('/api/client-errors', {
        method: 'POST',
        headers,
        body: JSON.stringify(item),
        // keepalive permite envio durante page unload
        keepalive: true,
      });
    } catch {
      // Falha silenciosa — não criar loop de erro
    }
  }
}

function scheduleFlush() {
  if (FLUSH_TIMER) return;
  FLUSH_TIMER = setTimeout(flush, FLUSH_DELAY);
  // Se o buffer encher, flusha imediato
  if (BUFFER.length >= MAX_BUFFER) {
    clearTimeout(FLUSH_TIMER);
    FLUSH_TIMER = null;
    flush();
  }
}

function reportar(tipo, mensagem, extras = {}) {
  if (!ENABLED) return;
  try {
    BUFFER.push({
      tipo,
      mensagem: clip(mensagem, 500),
      url: clip(location.href, 500),
      user_agent: clip(navigator.userAgent, 300),
      stack: clip(extras.stack, 4000),
      request_method: clip(extras.method, 10),
      request_url: clip(extras.requestUrl, 500),
      http_status: typeof extras.status === 'number' ? extras.status : null,
    });
    scheduleFlush();
  } catch { /* ignorar erro no próprio logger */ }
}

// ---- 1. Runtime errors ----
window.addEventListener('error', (e) => {
  // Ignorar erros de carregamento de recursos (imgs/scripts) — gerariam ruído
  if (e.target && e.target !== window && (e.target.src || e.target.href)) return;
  const err = e.error || e;
  reportar('runtime', err?.message || String(e.message || e), { stack: err?.stack });
});

// ---- 2. Unhandled rejections ----
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  const msg = r?.message || (typeof r === 'string' ? r : JSON.stringify(r));
  reportar('unhandled-rejection', msg, { stack: r?.stack });
});

// ---- 3. console.error wrap ----
const origConsoleError = console.error.bind(console);
console.error = function (...args) {
  origConsoleError(...args);
  try {
    const msg = args.map(a => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') return JSON.stringify(a).substring(0, 300);
      return String(a);
    }).join(' ');
    const stack = args.find(a => a instanceof Error)?.stack;
    // Evita reentrada infinita
    if (msg.includes('/api/client-errors')) return;
    reportar('console-error', msg, { stack });
  } catch { /* ignorar */ }
};

// ---- 4. fetch wrapper (para erros de rede + HTTP errors) ----
const origFetch = window.fetch.bind(window);
window.fetch = async function (input, init = {}) {
  const url = typeof input === 'string' ? input : (input?.url || '');
  const method = (init?.method || 'GET').toUpperCase();
  // Não loga requests do próprio endpoint (evita loop)
  const isSelfLog = url.includes('/api/client-errors');
  try {
    const res = await origFetch(input, init);
    // HTTP 5xx — erro do server
    if (!isSelfLog && res.status >= 500) {
      reportar('http-error', `${method} ${url} → HTTP ${res.status}`, {
        method, requestUrl: url, status: res.status,
      });
    }
    return res;
  } catch (e) {
    // Network error (server fora, CORS, timeout, etc) — o famoso "failed to fetch"
    if (!isSelfLog) {
      reportar('fetch-fail', `${method} ${url} → ${e.message || 'network error'}`, {
        method, requestUrl: url, stack: e.stack,
      });
    }
    throw e;
  }
};

// Tenta flushar antes do unload
window.addEventListener('beforeunload', () => { try { flush(); } catch {} });

// API público para desabilitar (útil em testes)
window.__errorLogger = {
  disable: () => { ENABLED = false; },
  enable: () => { ENABLED = true; },
  flush,
  buffer: () => [...BUFFER],
};
