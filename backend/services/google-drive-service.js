// =====================================================================
// google-drive-service.js — Google Drive via OAuth2 (conta pessoal)
// ---------------------------------------------------------------------
// Fluxo:
//   1. Admin clica "Autorizar Google Drive" → redirect p/ Google
//   2. Google redireciona de volta com auth code
//   3. App troca code por access_token + refresh_token
//   4. refresh_token fica encriptado no DB (tabela configuracoes)
//   5. Uploads usam access_token (renovado automaticamente via refresh)
//
// Env vars necessárias:
//   GOOGLE_CLIENT_ID        → OAuth2 client ID
//   GOOGLE_CLIENT_SECRET    → OAuth2 client secret
//   GOOGLE_DRIVE_FOLDER_ID  → ID da pasta raiz no Drive
//
// Referência no DB: `gdrive://<file-id>`
// =====================================================================

import { readFile, unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { queryOne, query } from '../db/index.js';
import { encrypt, decrypt } from './crypto-helper.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const CONFIG_KEY = 'gdrive_tokens';

// --- helpers de configuração ---

function getEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!clientId || !clientSecret || !folderId) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_DRIVE_FOLDER_ID não configurados');
  }
  return { clientId, clientSecret, folderId };
}

export function googleDriveDisponivel() {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_DRIVE_FOLDER_ID
  );
}

async function obterTokensDB() {
  const r = await queryOne('SELECT valor FROM configuracoes WHERE chave=$1', [CONFIG_KEY]);
  if (!r) return null;
  try {
    const v = typeof r.valor === 'string' ? JSON.parse(r.valor) : r.valor;
    if (v.refresh_token_enc) {
      v.refresh_token = decrypt(v.refresh_token_enc);
    }
    return v;
  } catch { return null; }
}

async function salvarTokensDB(tokens) {
  const salvar = {
    refresh_token_enc: encrypt(tokens.refresh_token),
    access_token: tokens.access_token,
    expires_at: tokens.expires_at,
    autorizado_em: tokens.autorizado_em || new Date().toISOString(),
    email: tokens.email || null,
  };
  const json = JSON.stringify(salvar);
  const existe = await queryOne('SELECT chave FROM configuracoes WHERE chave=$1', [CONFIG_KEY]);
  if (existe) {
    await query('UPDATE configuracoes SET valor=$1, atualizado_em=CURRENT_TIMESTAMP WHERE chave=$2', [json, CONFIG_KEY]);
  } else {
    await query('INSERT INTO configuracoes (chave, valor) VALUES ($1, $2)', [CONFIG_KEY, json]);
  }
}

// --- OAuth2 ---

export function gerarUrlAutorizacao(redirectUri) {
  const { clientId } = getEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${AUTH_URL}?${params}`;
}

export async function trocarCodePorTokens(code, redirectUri) {
  const { clientId, clientSecret } = getEnv();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Troca de code falhou HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.refresh_token) {
    throw new Error('Google não retornou refresh_token. Tente revogar o acesso em myaccount.google.com/permissions e autorizar novamente.');
  }

  // Buscar email do usuário que autorizou
  let email = null;
  try {
    const info = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (info.ok) {
      const u = await info.json();
      email = u.email;
    }
  } catch {}

  const tokens = {
    refresh_token: data.refresh_token,
    access_token: data.access_token,
    expires_at: Date.now() + (Number(data.expires_in || 3500) * 1000),
    autorizado_em: new Date().toISOString(),
    email,
  };
  await salvarTokensDB(tokens);
  return { ok: true, email };
}

// --- Access Token (com refresh automático) ---

let _accessTokenCache = null;

async function obterAccessToken() {
  if (_accessTokenCache && _accessTokenCache.expires_at > Date.now() + 30_000) {
    return _accessTokenCache.access_token;
  }

  const stored = await obterTokensDB();
  if (!stored || !stored.refresh_token) {
    throw new Error('Google Drive não autorizado. O admin precisa autorizar em Configurações → Armazenamento.');
  }

  // Tenta usar o access_token armazenado se ainda válido
  if (stored.access_token && stored.expires_at && stored.expires_at > Date.now() + 30_000) {
    _accessTokenCache = { access_token: stored.access_token, expires_at: stored.expires_at };
    return stored.access_token;
  }

  // Refresh
  const { clientId, clientSecret } = getEnv();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: stored.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Refresh token falhou HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  const newTokens = {
    ...stored,
    access_token: data.access_token,
    expires_at: Date.now() + (Number(data.expires_in || 3500) * 1000),
  };
  await salvarTokensDB(newTokens);
  _accessTokenCache = { access_token: data.access_token, expires_at: newTokens.expires_at };
  return data.access_token;
}

export async function estaAutorizado() {
  if (!googleDriveDisponivel()) return false;
  try {
    const stored = await obterTokensDB();
    return !!(stored && stored.refresh_token);
  } catch { return false; }
}

export async function obterStatusAutorizacao() {
  const stored = await obterTokensDB();
  if (!stored || !stored.refresh_token) {
    return { autorizado: false };
  }
  return {
    autorizado: true,
    email: stored.email || null,
    autorizado_em: stored.autorizado_em || null,
  };
}

// --- Operações no Drive ---

function sanitizar(texto) {
  return (texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

const _folderCache = new Map();

async function obterOuCriarSubpasta(parentId, nome) {
  const cacheKey = `${parentId}/${nome}`;
  if (_folderCache.has(cacheKey)) return _folderCache.get(cacheKey);

  const token = await obterAccessToken();
  const q = encodeURIComponent(`'${parentId}' in parents and name='${nome.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const listRes = await fetch(`${DRIVE_API}/files?q=${q}&fields=files(id)&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) throw new Error(`Listar pasta falhou HTTP ${listRes.status}`);
  const listData = await listRes.json();

  if (listData.files && listData.files.length > 0) {
    const id = listData.files[0].id;
    _folderCache.set(cacheKey, id);
    return id;
  }

  const createRes = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: nome,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  if (!createRes.ok) {
    const txt = await createRes.text().catch(() => '');
    throw new Error(`Criar pasta "${nome}" falhou HTTP ${createRes.status}: ${txt.slice(0, 200)}`);
  }
  const created = await createRes.json();
  _folderCache.set(cacheKey, created.id);
  return created.id;
}

function montarNomePasta(ctx) {
  if (!ctx) return `upload-${randomBytes(4).toString('hex')}`;
  const partes = [];
  if (ctx.protocolo) partes.push(ctx.protocolo);
  if (ctx.fornecedor) partes.push(sanitizar(ctx.fornecedor));
  if (ctx.competencia) partes.push(`(${ctx.competencia})`);
  return partes.join(' - ') || `envio-${ctx.envioId || randomBytes(4).toString('hex')}`;
}

export async function subirArquivoGDrive(localPath, nomeOriginal, mimeType, ctx) {
  const { folderId } = getEnv();
  const token = await obterAccessToken();

  const nomePasta = montarNomePasta(ctx);
  const pastaEnvioId = await obterOuCriarSubpasta(folderId, nomePasta);

  const ext = extname(nomeOriginal || '').toLowerCase();
  const base = sanitizar(nomeOriginal || 'arquivo');
  const nomeArquivo = base.endsWith(ext) ? base : base + ext;

  const buf = await readFile(localPath);

  const boundary = '----GDriveBoundary' + randomBytes(8).toString('hex');
  const metadata = JSON.stringify({
    name: nomeArquivo,
    parents: [pastaEnvioId],
  });

  const prefix = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`);
  const middle = Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`);
  const suffix = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([prefix, middle, buf, suffix]);

  const upRes = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id,name`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });

  if (!upRes.ok) {
    const txt = await upRes.text().catch(() => '');
    throw new Error(`Upload GDrive falhou HTTP ${upRes.status}: ${txt.slice(0, 300)}`);
  }

  const file = await upRes.json();
  try { await unlink(localPath); } catch {}

  return {
    caminho: `gdrive://${file.id}`,
    backend: 'gdrive',
    remote_id: file.id,
    pasta: nomePasta,
  };
}

export async function obterBufferGDrive(caminho) {
  if (!caminho.startsWith('gdrive://')) {
    throw new Error(`Caminho inválido para Google Drive: ${caminho}`);
  }
  const fileId = caminho.replace('gdrive://', '');
  const token = await obterAccessToken();

  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Download GDrive falhou HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export async function removerArquivoGDrive(caminho) {
  if (!caminho.startsWith('gdrive://')) return;
  const fileId = caminho.replace('gdrive://', '');
  const token = await obterAccessToken();
  await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function testarConexaoGDrive() {
  const { folderId } = getEnv();
  const token = await obterAccessToken();

  const folderRes = await fetch(`${DRIVE_API}/files/${folderId}?fields=id,name,mimeType`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!folderRes.ok) {
    const txt = await folderRes.text().catch(() => '');
    throw new Error(`Acesso à pasta falhou HTTP ${folderRes.status}: ${txt.slice(0, 200)}`);
  }
  const folder = await folderRes.json();

  return {
    ok: true,
    folder_name: folder.name,
    folder_id: folderId,
  };
}
