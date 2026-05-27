// =====================================================================
// supabase-storage.js
// ---------------------------------------------------------------------
// Adapter para armazenar arquivos no Supabase Storage (backend privado).
//
// Convenções:
//   - bucket fixo: 'documentos' (criado via migration manual)
//   - caminho remoto: AAAA-MM/nanoid-nomeoriginal.ext
//   - referência no DB: `supabase://documentos/AAAA-MM/nanoid-nome.ext`
//
// Credenciais (via env vars):
//   SUPABASE_URL          → https://<ref>.supabase.co
//   SUPABASE_SERVICE_KEY  → service_role JWT (admin, bypassa RLS)
//
// Uso típico (a partir de storage-service.js):
//   const { subirArquivoSupabase, obterBufferSupabase } = await import(...)
//   const r = await subirArquivoSupabase(localPath, 'nf.pdf');
//   // r.caminho = 'supabase://documentos/2026-05/abcd-nf.pdf'
// =====================================================================

import { readFile, unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import { randomBytes } from 'node:crypto';

const BUCKET = 'documentos';

function getEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY não configurados');
  }
  return { url: url.replace(/\/$/, ''), key };
}

/**
 * Verifica se o Supabase Storage está disponível (env vars setadas).
 */
export function supabaseStorageDisponivel() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

/**
 * Gera um nome único para o arquivo, preservando a extensão original.
 * Formato: AAAA-MM/<8-hex>-<nome-sanitizado.ext>
 */
function gerarChaveRemota(nomeOriginal) {
  const agora = new Date();
  const yyyymm = `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, '0')}`;
  const rand = randomBytes(4).toString('hex');
  // Sanitiza: tira acentos, espaços, caracteres especiais
  const ext = extname(nomeOriginal || '').toLowerCase();
  const base = (nomeOriginal || 'arquivo')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]/g, '_')
    .slice(0, 60);
  // Garante que termina com a extensão original
  const safeName = base.endsWith(ext) ? base : base.replace(/\.[^.]*$/, '') + ext;
  return `${yyyymm}/${rand}-${safeName}`;
}

/**
 * Faz upload de um arquivo local para o Supabase Storage.
 * @param {string} localPath - Caminho no disco (vindo do multer)
 * @param {string} nomeOriginal - Nome original do arquivo
 * @param {string} [mimeType] - Content-Type (opcional)
 * @returns {Promise<{caminho:string, backend:string, remote_key:string, erro?:string}>}
 */
export async function subirArquivoSupabase(localPath, nomeOriginal, mimeType) {
  const { url, key } = getEnv();
  const remoteKey = gerarChaveRemota(nomeOriginal);
  const buf = await readFile(localPath);

  const endpoint = `${url}/storage/v1/object/${BUCKET}/${encodeURI(remoteKey)}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': mimeType || 'application/octet-stream',
      'x-upsert': 'false',           // não sobrescreve (chave é única por design)
      'Cache-Control': 'private, max-age=31536000',
    },
    body: buf,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase upload falhou HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }

  // Remove o arquivo local após upload OK (boa prática — disco efêmero no Render)
  try { await unlink(localPath); } catch {}

  return {
    caminho: `supabase://${BUCKET}/${remoteKey}`,
    backend: 'supabase',
    remote_key: remoteKey,
  };
}

/**
 * Baixa um arquivo do Supabase Storage e retorna o Buffer.
 * @param {string} caminho - Formato `supabase://bucket/path`
 * @returns {Promise<Buffer>}
 */
export async function obterBufferSupabase(caminho) {
  if (!caminho.startsWith('supabase://')) {
    throw new Error(`Caminho inválido para Supabase Storage: ${caminho}`);
  }
  const { url, key } = getEnv();
  // supabase://documentos/2026-05/abcd-nf.pdf → bucket="documentos", key="2026-05/..."
  const [bucket, ...keyParts] = caminho.replace('supabase://', '').split('/');
  const remoteKey = keyParts.join('/');
  const endpoint = `${url}/storage/v1/object/${bucket}/${encodeURI(remoteKey)}`;

  const res = await fetch(endpoint, {
    headers: { 'Authorization': `Bearer ${key}` },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase download falhou HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }

  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Remove um arquivo do bucket (soft-delete na app fica no DB; aqui é remoção real).
 * Não usado por padrão — o app prefere soft-delete via flag `ativo`.
 */
export async function removerArquivoSupabase(caminho) {
  if (!caminho.startsWith('supabase://')) return;
  const { url, key } = getEnv();
  const [bucket, ...keyParts] = caminho.replace('supabase://', '').split('/');
  const remoteKey = keyParts.join('/');
  const endpoint = `${url}/storage/v1/object/${bucket}/${encodeURI(remoteKey)}`;
  await fetch(endpoint, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${key}` },
  });
}

/**
 * Testa conexão e permissões básicas — lista objetos no bucket.
 */
export async function testarConexaoSupabase() {
  const { url, key } = getEnv();
  const endpoint = `${url}/storage/v1/object/list/${BUCKET}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefix: '', limit: 1 }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Teste de conexão falhou HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  const items = await res.json();
  return { ok: true, bucket: BUCKET, sample_count: items.length };
}
