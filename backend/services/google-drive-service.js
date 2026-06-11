// =====================================================================
// google-drive-service.js — Google Drive via Service Account (sem googleapis)
// ---------------------------------------------------------------------
// Usa JWT + fetch direto na REST API do Google Drive v3.
// Zero dependências extras — usa jsonwebtoken (já no projeto) + fetch nativo.
//
// Estrutura de pastas no Drive:
//   📁 Pasta raiz (GOOGLE_DRIVE_FOLDER_ID)
//     📁 PROT-00123 - Hospital Sao Jorge (2026-06)
//       📄 nf_pdf.pdf
//       📄 crf_estadual.pdf
//
// Referência no DB: `gdrive://<file-id>`
// =====================================================================

import { readFile, unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import { randomBytes, createSign } from 'node:crypto';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive';

let _tokenCache = null;

function getEnv() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!folderId || !email || !key) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_KEY não configurados');
  }
  return { folderId, email, key: key.replace(/\\n/g, '\n') };
}

export function googleDriveDisponivel() {
  return !!(
    process.env.GOOGLE_DRIVE_FOLDER_ID &&
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  );
}

function base64url(data) {
  return Buffer.from(data).toString('base64url');
}

async function obterToken() {
  if (_tokenCache && _tokenCache.expires_at > Date.now() + 30_000) {
    return _tokenCache.access_token;
  }
  const { email, key } = getEnv();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(key, 'base64url');
  const jwt = `${header}.${payload}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Google auth falhou HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  _tokenCache = {
    access_token: data.access_token,
    expires_at: Date.now() + (Number(data.expires_in || 3500) * 1000),
  };
  return _tokenCache.access_token;
}

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

  const token = await obterToken();
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

/**
 * Upload de arquivo para o Google Drive.
 * Cria subpasta por envio: "PROT-00123 - Razão Social (2026-06)"
 */
export async function subirArquivoGDrive(localPath, nomeOriginal, mimeType, ctx) {
  const { folderId } = getEnv();
  const token = await obterToken();

  const nomePasta = montarNomePasta(ctx);
  const pastaEnvioId = await obterOuCriarSubpasta(folderId, nomePasta);

  const ext = extname(nomeOriginal || '').toLowerCase();
  const base = sanitizar(nomeOriginal || 'arquivo');
  const nomeArquivo = base.endsWith(ext) ? base : base + ext;

  const buf = await readFile(localPath);

  // Multipart upload (metadata + file content)
  const boundary = '----GDriveBoundary' + randomBytes(8).toString('hex');
  const metadata = JSON.stringify({
    name: nomeArquivo,
    parents: [pastaEnvioId],
  });

  const bodyParts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`,
  ];
  const prefix = Buffer.from(bodyParts[0]);
  const middle = Buffer.from(bodyParts[1]);
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

/**
 * Download de arquivo do Google Drive. Retorna Buffer.
 */
export async function obterBufferGDrive(caminho) {
  if (!caminho.startsWith('gdrive://')) {
    throw new Error(`Caminho inválido para Google Drive: ${caminho}`);
  }
  const fileId = caminho.replace('gdrive://', '');
  const token = await obterToken();

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

/**
 * Remove arquivo do Google Drive.
 */
export async function removerArquivoGDrive(caminho) {
  if (!caminho.startsWith('gdrive://')) return;
  const fileId = caminho.replace('gdrive://', '');
  const token = await obterToken();
  await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Testa conexão — verifica acesso à pasta raiz.
 */
export async function testarConexaoGDrive() {
  const { folderId } = getEnv();
  const token = await obterToken();

  const folderRes = await fetch(`${DRIVE_API}/files/${folderId}?fields=id,name,mimeType`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!folderRes.ok) {
    const txt = await folderRes.text().catch(() => '');
    throw new Error(`Acesso à pasta falhou HTTP ${folderRes.status}: ${txt.slice(0, 200)}`);
  }
  const folder = await folderRes.json();

  const listRes = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&fields=files(id)&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listData = await listRes.json();

  return {
    ok: true,
    folder_name: folder.name,
    folder_id: folderId,
    has_files: (listData.files || []).length > 0,
  };
}
