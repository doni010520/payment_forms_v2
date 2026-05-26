// =====================================================================
// V292: Storage abstraction — local (default) ou OneDrive/SharePoint (MS Graph)
//
// Config persistida em `configuracoes` chave='storage' como JSON:
//   {
//     "backend": "local" | "onedrive",
//     "onedrive": {
//       "enabled": boolean,
//       "tenant_id": string,
//       "client_id": string,
//       "client_secret_enc": string,    // encriptado via crypto-helper
//       "drive_id": string,              // SharePoint site drive ID ou /users/{upn}/drive
//       "folder_path": string            // ex: "FESF-SUS/anexos"
//     }
//   }
//
// API exposta:
//   - obterConfig() / salvarConfig(...)
//   - obterConfigPublica() — sem segredos, para UI
//   - testarConexao() — autentica + lista pasta raiz
//   - subirArquivo(localPath, nomeOriginal) → { caminho }  // upload p/ remote OU mantém local
//   - obterBuffer(caminho) → Buffer  // baixa do OneDrive ou lê do disco
//
// Estratégia: se backend=onedrive E enabled=true E creds válidos → upload remoto.
// Caso contrário, fica local (caminho = path no disco). O `caminho` salvo na tabela
// `documentos` pode ser:
//   - path local (legado): "/uploads/abc123"
//   - URL OneDrive: "onedrive://<item-id>"
// =====================================================================
import { readFile, unlink } from 'fs/promises';
import { query, queryOne } from '../db/index.js';
import { encrypt, decrypt, mascarar } from './crypto-helper.js';

const CHAVE = 'storage';

const DEFAULT_CONFIG = {
  backend: 'local',
  onedrive: {
    enabled: false,
    tenant_id: '',
    client_id: '',
    client_secret_enc: null,
    drive_id: '',
    folder_path: 'FESF-SUS/anexos',
  },
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

export async function obterConfig() {
  const r = await queryOne('SELECT valor FROM configuracoes WHERE chave=$1', [CHAVE]);
  if (!r) return clone(DEFAULT_CONFIG);
  try {
    const v = typeof r.valor === 'string' ? JSON.parse(r.valor) : r.valor;
    return { ...DEFAULT_CONFIG, ...v, onedrive: { ...DEFAULT_CONFIG.onedrive, ...(v.onedrive || {}) } };
  } catch { return clone(DEFAULT_CONFIG); }
}

/** Config sem o secret cleartext — seguro para UI. */
export async function obterConfigPublica() {
  const c = await obterConfig();
  const decClienteSecret = decrypt(c.onedrive.client_secret_enc);
  return {
    backend: c.backend,
    onedrive: {
      enabled: !!c.onedrive.enabled,
      tenant_id: c.onedrive.tenant_id || '',
      client_id: c.onedrive.client_id || '',
      client_secret_mask: decClienteSecret ? mascarar(decClienteSecret) : '',
      client_secret_configured: !!decClienteSecret,
      drive_id: c.onedrive.drive_id || '',
      folder_path: c.onedrive.folder_path || '',
    },
  };
}

export async function salvarConfig(input, usuarioId) {
  const atual = await obterConfig();
  const next = clone(atual);
  if (typeof input.backend === 'string' && ['local', 'onedrive'].includes(input.backend)) {
    next.backend = input.backend;
  }
  if (input.onedrive && typeof input.onedrive === 'object') {
    const od = input.onedrive;
    if (typeof od.enabled === 'boolean') next.onedrive.enabled = od.enabled;
    if (typeof od.tenant_id === 'string') next.onedrive.tenant_id = od.tenant_id.trim();
    if (typeof od.client_id === 'string') next.onedrive.client_id = od.client_id.trim();
    if (typeof od.drive_id === 'string') next.onedrive.drive_id = od.drive_id.trim();
    if (typeof od.folder_path === 'string') next.onedrive.folder_path = od.folder_path.trim() || 'FESF-SUS/anexos';
    // Se veio um client_secret novo (não-vazio), encripta. Se veio string vazia, mantém atual.
    if (typeof od.client_secret === 'string' && od.client_secret.length > 0) {
      next.onedrive.client_secret_enc = encrypt(od.client_secret);
    } else if (od.client_secret === null) {
      next.onedrive.client_secret_enc = null;
    }
  }
  // Validação: se backend=onedrive e enabled=true, exige tenant/client/drive
  if (next.backend === 'onedrive' && next.onedrive.enabled) {
    const od = next.onedrive;
    if (!od.tenant_id || !od.client_id || !od.client_secret_enc || !od.drive_id) {
      const err = new Error('Para habilitar OneDrive, preencha tenant_id, client_id, client_secret e drive_id');
      err.code = 'INVALID_CONFIG'; throw err;
    }
  }
  const json = JSON.stringify(next);
  const existe = await queryOne('SELECT chave FROM configuracoes WHERE chave=$1', [CHAVE]);
  if (existe) {
    await query('UPDATE configuracoes SET valor=$1, atualizado_em=CURRENT_TIMESTAMP, atualizado_por=$2 WHERE chave=$3', [json, usuarioId || null, CHAVE]);
  } else {
    await query('INSERT INTO configuracoes (chave, valor, atualizado_por) VALUES ($1, $2, $3)', [CHAVE, json, usuarioId || null]);
  }
  return obterConfigPublica();
}

// ---------------------------------------------------------------------
// MS Graph API helpers
// ---------------------------------------------------------------------
let TOKEN_CACHE = null; // { access_token, expires_at }

async function obterToken(cfg) {
  if (TOKEN_CACHE && TOKEN_CACHE.expires_at > Date.now() + 30_000) return TOKEN_CACHE.access_token;
  const secret = decrypt(cfg.onedrive.client_secret_enc);
  if (!secret) { const e = new Error('client_secret não disponível'); e.code = 'NO_SECRET'; throw e; }
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(cfg.onedrive.tenant_id)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.onedrive.client_id,
    client_secret: secret,
    scope: 'https://graph.microsoft.com/.default',
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err = new Error(`Falha autenticação MS Graph (HTTP ${res.status}): ${txt.substring(0, 300)}`);
    err.code = 'AUTH_FAIL'; throw err;
  }
  const j = await res.json();
  TOKEN_CACHE = { access_token: j.access_token, expires_at: Date.now() + (Number(j.expires_in || 3500) * 1000) };
  return TOKEN_CACHE.access_token;
}

async function ensureFolder(cfg, token, folderPath) {
  // Cria pastas recursivamente (idempotente). MS Graph: PUT folder se não existir.
  // Estratégia simplificada: tenta GET; se 404 cria via PATCH no item path.
  const parts = folderPath.split('/').filter(Boolean);
  let acc = '';
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p;
    const url = `https://graph.microsoft.com/v1.0/drives/${cfg.onedrive.drive_id}/root:/${encodeURIComponent(acc).replace(/%2F/g, '/')}`;
    const get = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (get.status === 404) {
      // Criar pasta: POST nos children do parent
      const parentPath = parts.slice(0, parts.indexOf(p)).join('/');
      const parentUrl = parentPath
        ? `https://graph.microsoft.com/v1.0/drives/${cfg.onedrive.drive_id}/root:/${parentPath}:/children`
        : `https://graph.microsoft.com/v1.0/drives/${cfg.onedrive.drive_id}/root/children`;
      const create = await fetch(parentUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: p, folder: {}, '@microsoft.graph.conflictBehavior': 'replace' }),
      });
      if (!create.ok) {
        const t = await create.text().catch(() => '');
        const err = new Error(`Falha criar pasta "${acc}" (HTTP ${create.status}): ${t.substring(0, 200)}`);
        err.code = 'FOLDER_FAIL'; throw err;
      }
    }
  }
}

/** Tenta autenticar + listar pasta raiz. Retorna { ok, info } ou { ok:false, error }. */
export async function testarConexao() {
  const cfg = await obterConfig();
  if (cfg.backend !== 'onedrive' || !cfg.onedrive.enabled) {
    return { ok: false, error: 'OneDrive não habilitado' };
  }
  try {
    const token = await obterToken(cfg);
    const url = `https://graph.microsoft.com/v1.0/drives/${cfg.onedrive.drive_id}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { ok: false, error: `HTTP ${r.status}: ${t.substring(0, 300)}` };
    }
    const drive = await r.json();
    return {
      ok: true,
      info: {
        drive_name: drive.name,
        drive_type: drive.driveType,
        owner: drive.owner?.user?.displayName || drive.owner?.user?.email || '—',
        quota_usado_gb: drive.quota?.used ? (drive.quota.used / 1024 / 1024 / 1024).toFixed(2) : null,
        quota_total_gb: drive.quota?.total ? (drive.quota.total / 1024 / 1024 / 1024).toFixed(2) : null,
      },
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Upload de arquivo. Se OneDrive habilitado, manda para lá; senão fica local.
 * - localPath: caminho do tmp file (do multer)
 * - nomeOriginal: nome legível (para o arquivo no remote)
 * Retorna { caminho } — pode ser path local OR "onedrive://<item-id>"
 */
export async function subirArquivo(localPath, nomeOriginal) {
  const cfg = await obterConfig();
  if (cfg.backend !== 'onedrive' || !cfg.onedrive.enabled) {
    return { caminho: localPath, backend: 'local' };
  }
  try {
    const token = await obterToken(cfg);
    const folder = cfg.onedrive.folder_path || 'FESF-SUS/anexos';
    await ensureFolder(cfg, token, folder);
    const buf = await readFile(localPath);
    // Para arquivos < 4 MB usar simple upload; >= 4 MB usar resumable session
    let itemId;
    if (buf.length < 4 * 1024 * 1024) {
      const url = `https://graph.microsoft.com/v1.0/drives/${cfg.onedrive.drive_id}/root:/${folder}/${encodeURIComponent(nomeOriginal)}:/content`;
      const up = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
        body: buf,
      });
      if (!up.ok) {
        const t = await up.text().catch(() => '');
        throw new Error(`Upload simples falhou HTTP ${up.status}: ${t.substring(0, 200)}`);
      }
      const item = await up.json();
      itemId = item.id;
    } else {
      // Resumable upload (sessão)
      const sessUrl = `https://graph.microsoft.com/v1.0/drives/${cfg.onedrive.drive_id}/root:/${folder}/${encodeURIComponent(nomeOriginal)}:/createUploadSession`;
      const sess = await fetch(sessUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }),
      });
      if (!sess.ok) {
        const t = await sess.text().catch(() => '');
        throw new Error(`createUploadSession falhou HTTP ${sess.status}: ${t.substring(0, 200)}`);
      }
      const { uploadUrl } = await sess.json();
      // Upload em chunks de 4MB
      const CHUNK = 4 * 1024 * 1024;
      let item = null;
      for (let start = 0; start < buf.length; start += CHUNK) {
        const end = Math.min(start + CHUNK, buf.length);
        const part = buf.slice(start, end);
        const r = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Length': String(part.length),
            'Content-Range': `bytes ${start}-${end - 1}/${buf.length}`,
          },
          body: part,
        });
        if (!r.ok && r.status !== 202) {
          const t = await r.text().catch(() => '');
          throw new Error(`Chunk upload falhou HTTP ${r.status}: ${t.substring(0, 200)}`);
        }
        if (r.status === 200 || r.status === 201) item = await r.json();
      }
      if (!item) throw new Error('Upload terminou sem item final');
      itemId = item.id;
    }
    // Remove local após upload OK
    try { await unlink(localPath); } catch {}
    return { caminho: `onedrive://${itemId}`, backend: 'onedrive', remote_id: itemId };
  } catch (e) {
    // Fallback: mantém local se upload falhou (não perde o arquivo)
    console.error('[storage/subirArquivo] OneDrive falhou, mantendo local:', e.message);
    return { caminho: localPath, backend: 'local-fallback', erro: e.message };
  }
}

/** Lê um arquivo (do disco OU baixa do OneDrive). Retorna Buffer. */
export async function obterBuffer(caminho) {
  if (caminho && caminho.startsWith('onedrive://')) {
    const itemId = caminho.replace('onedrive://', '');
    const cfg = await obterConfig();
    const token = await obterToken(cfg);
    const url = `https://graph.microsoft.com/v1.0/drives/${cfg.onedrive.drive_id}/items/${itemId}/content`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`Download OneDrive falhou HTTP ${r.status}: ${t.substring(0, 200)}`);
    }
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  }
  // Local
  return readFile(caminho);
}
