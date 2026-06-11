// =====================================================================
// google-drive-service.js
// ---------------------------------------------------------------------
// Adapter para armazenar arquivos no Google Drive via Service Account.
//
// Estrutura de pastas:
//   📁 Pasta raiz (GOOGLE_DRIVE_FOLDER_ID)
//     📁 PROT-00123 - Hospital São Jorge (2026-06)
//       📄 nf_pdf.pdf
//       📄 crf_estadual.pdf
//     📁 PROT-00124 - Clínica Vida (2026-06)
//       📄 nf_pdf.pdf
//
// Referência no DB: `gdrive://<file-id>`
//
// Credenciais (via env vars):
//   GOOGLE_DRIVE_FOLDER_ID           → ID da pasta compartilhada
//   GOOGLE_SERVICE_ACCOUNT_EMAIL     → email da service account
//   GOOGLE_SERVICE_ACCOUNT_KEY       → private_key (com \n literais)
// =====================================================================

import { readFile, unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

let _authClient = null;
let _driveClient = null;

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

function getAuth() {
  if (_authClient) return _authClient;
  const { email, key } = getEnv();
  _authClient = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: SCOPES,
  });
  return _authClient;
}

function getDrive() {
  if (_driveClient) return _driveClient;
  _driveClient = google.drive({ version: 'v3', auth: getAuth() });
  return _driveClient;
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

  const drive = getDrive();
  const safeName = nome.replace(/'/g, "\\'");
  const q = `'${parentId}' in parents and name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const list = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });

  if (list.data.files && list.data.files.length > 0) {
    const id = list.data.files[0].id;
    _folderCache.set(cacheKey, id);
    return id;
  }

  const created = await drive.files.create({
    requestBody: {
      name: nome,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });
  const id = created.data.id;
  _folderCache.set(cacheKey, id);
  return id;
}

/**
 * Monta o nome da pasta do envio.
 * Formato: "PROT-00123 - Razão Social (2026-06)"
 * Se não tiver contexto, usa fallback genérico.
 */
function montarNomePasta(ctx) {
  if (!ctx) {
    const rand = randomBytes(4).toString('hex');
    return `upload-${rand}`;
  }
  const partes = [];
  if (ctx.protocolo) partes.push(ctx.protocolo);
  if (ctx.fornecedor) partes.push(sanitizar(ctx.fornecedor));
  if (ctx.competencia) partes.push(`(${ctx.competencia})`);
  return partes.join(' - ') || `envio-${ctx.envioId || randomBytes(4).toString('hex')}`;
}

/**
 * Upload de arquivo local para o Google Drive.
 * Cria subpasta por envio dentro da pasta raiz.
 *
 * @param {string} localPath - Caminho do arquivo temporário (multer)
 * @param {string} nomeOriginal - Nome original do arquivo
 * @param {string} [mimeType] - MIME type
 * @param {object} [ctx] - Contexto do envio: { envioId, protocolo, fornecedor, competencia }
 */
export async function subirArquivoGDrive(localPath, nomeOriginal, mimeType, ctx) {
  const { folderId } = getEnv();
  const drive = getDrive();

  const nomePasta = montarNomePasta(ctx);
  const pastaEnvioId = await obterOuCriarSubpasta(folderId, nomePasta);

  const ext = extname(nomeOriginal || '').toLowerCase();
  const base = sanitizar(nomeOriginal || 'arquivo');
  const nomeArquivo = base.endsWith(ext) ? base : base + ext;

  const buf = await readFile(localPath);
  const { Readable } = await import('node:stream');

  const res = await drive.files.create({
    requestBody: {
      name: nomeArquivo,
      parents: [pastaEnvioId],
    },
    media: {
      mimeType: mimeType || 'application/octet-stream',
      body: Readable.from(buf),
    },
    fields: 'id,name',
  });

  try { await unlink(localPath); } catch {}

  return {
    caminho: `gdrive://${res.data.id}`,
    backend: 'gdrive',
    remote_id: res.data.id,
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
  const drive = getDrive();

  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(res.data);
}

/**
 * Remove arquivo do Google Drive.
 */
export async function removerArquivoGDrive(caminho) {
  if (!caminho.startsWith('gdrive://')) return;
  const fileId = caminho.replace('gdrive://', '');
  const drive = getDrive();
  await drive.files.delete({ fileId });
}

/**
 * Testa conexão — verifica acesso à pasta raiz.
 */
export async function testarConexaoGDrive() {
  const { folderId } = getEnv();
  const drive = getDrive();

  const folder = await drive.files.get({
    fileId: folderId,
    fields: 'id,name,mimeType',
  });

  const list = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id)',
    pageSize: 1,
  });

  return {
    ok: true,
    folder_name: folder.data.name,
    folder_id: folderId,
    has_files: (list.data.files || []).length > 0,
  };
}
