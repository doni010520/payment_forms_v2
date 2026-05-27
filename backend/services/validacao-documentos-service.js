/**
 * validacao-documentos-service.js
 * --------------------------------
 * Validação determinística de documentos enviados ao Portal FESF-SUS.
 *
 * Stack 100% local, sem chamadas externas, compatível com LGPD:
 *  - fast-xml-parser  → XML de NF-e (CNPJ, valor, número, data)
 *  - pdf-parse        → PDF nativo com camada de texto (~95% dos PDFs modernos)
 *  - Tesseract.js     → OCR para PDFs escaneados quando pdf-parse falha
 *  - sharp            → Pré-processamento de imagem antes do OCR (grayscale+binarização)
 *  - fast-levenshtein → Comparação fuzzy de CNPJ/razão social contra cadastro
 *  - Regex nativo     → Extração de datas de validade de certidões CND/CNDT/CRF
 *
 * Fluxo após upload:
 *   upload responde ao usuário
 *     └─ setImmediate → processarDocumento() roda em background
 *                         └─ UPDATE documentos SET validacao_json, data_expiracao, status_validade
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { query, queryOne } from '../db/index.js';
import { obterBuffer as obterBufferStorage } from './storage-service.js';

// ---------------------------------------------------------------------------
// Feature toggle
// ---------------------------------------------------------------------------

export async function obterCertidaoConfig() {
  try {
    const r = await queryOne("SELECT valor FROM configuracoes WHERE chave = 'certidao_config'");
    if (!r) return { validacao_ativa: false };
    return JSON.parse(r.valor);
  } catch {
    return { validacao_ativa: false };
  }
}

// ---------------------------------------------------------------------------
// Campos considerados certidões (para extração de validade)
// ---------------------------------------------------------------------------

const CAMPOS_CERTIDAO = new Set([
  'certidao_federal', 'cnd_federal', 'q15_fiscalFederal',
  'certidao_estadual', 'cnd_estadual', 'q16_fiscalEstadual',
  'certidao_municipal', 'cnd_municipal', 'q17_fiscalMunicipal',
  'cndt', 'q18_cndt',
  'crf_fgts', 'q19_crfFgts',
  'cgu', 'q21_cgu',
]);

function ehCampoNF(campo, mimeType) {
  if (!campo && !mimeType) return false;
  return (
    (campo && (campo.includes('nf_xml') || campo.includes('nfXml'))) ||
    (mimeType && (mimeType.includes('xml') || mimeType === 'application/xml' || mimeType === 'text/xml'))
  );
}

function ehCampoCertidao(campo) {
  if (!campo) return false;
  return CAMPOS_CERTIDAO.has(campo) || campo.toLowerCase().includes('certidao') ||
    campo.toLowerCase().includes('cnd') || campo.toLowerCase().includes('cndt') ||
    campo.toLowerCase().includes('crf') || campo.toLowerCase().includes('fiscal');
}

// ---------------------------------------------------------------------------
// Tesseract worker singleton
// ---------------------------------------------------------------------------

let _tesseractWorker = null;

async function obterWorkerOCR() {
  if (_tesseractWorker) return _tesseractWorker;
  const { createWorker } = await import('tesseract.js');
  _tesseractWorker = await createWorker('por');
  return _tesseractWorker;
}

// ---------------------------------------------------------------------------
// Leitura do buffer do arquivo (local ou OneDrive)
// ---------------------------------------------------------------------------

async function lerBufferArquivo(caminho) {
  if (caminho.includes('://')) {
    return obterBufferStorage(caminho);
  }
  return readFile(caminho);
}

// ---------------------------------------------------------------------------
// Parser 1: XML de NF-e
// ---------------------------------------------------------------------------

async function parsearNFeXML(buffer, contexto = {}) {
  const { XMLParser } = await import('fast-xml-parser');
  const { default: levenshtein } = await import('fast-levenshtein');

  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const obj = parser.parse(buffer.toString('utf-8'));

  // Navega pela estrutura típica de NF-e
  const nfe = obj?.nfeProc?.NFe?.infNFe ?? obj?.NFe?.infNFe ?? obj?.nfeProc?.NFe ?? null;

  if (!nfe) {
    return { tipo: 'nfe', erro: 'estrutura_nfe_nao_reconhecida', metodo: 'fast-xml-parser' };
  }

  const emit = nfe.emit ?? {};
  const dest = nfe.dest ?? {};
  const ide  = nfe.ide  ?? {};
  const total = nfe.total?.ICMSTot ?? {};

  const cnpjEmitente     = String(emit.CNPJ ?? emit.CPF ?? '').replace(/\D/g, '');
  const cnpjDestinatario = String(dest.CNPJ ?? dest.CPF ?? '').replace(/\D/g, '');
  const razaoEmitente    = String(emit.xNome ?? '');
  const valorNF          = parseFloat(total.vNF ?? 0);
  const numeroNF         = String(ide.nNF ?? '');
  const dataEmissao      = String(ide.dhEmi ?? ide.dEmi ?? '');

  // Verifica se CNPJ do emitente bate com o fornecedor do envio
  let cnpjMatch = null;
  if (contexto.fornecedorDocumento && cnpjEmitente) {
    const docLimpo = String(contexto.fornecedorDocumento).replace(/\D/g, '');
    const distancia = levenshtein.get(cnpjEmitente, docLimpo);
    cnpjMatch = distancia <= 2; // tolera 2 caracteres de diferença (OCR ou digitação)
  }

  // Verifica razão social com tolerância
  let razaoMatch = null;
  if (contexto.razaoSocial && razaoEmitente) {
    const a = contexto.razaoSocial.toUpperCase().trim();
    const b = razaoEmitente.toUpperCase().trim();
    const maxLen = Math.max(a.length, b.length);
    const distancia = levenshtein.get(a, b);
    razaoMatch = distancia / maxLen <= 0.25; // tolerância de 25%
  }

  return {
    tipo: 'nfe',
    metodo: 'fast-xml-parser',
    cnpj_emitente: cnpjEmitente,
    cnpj_destinatario: cnpjDestinatario,
    razao_social_emitente: razaoEmitente,
    valor_nf: valorNF,
    numero_nf: numeroNF,
    data_emissao: dataEmissao,
    cnpj_match: cnpjMatch,
    razao_match: razaoMatch,
  };
}

// ---------------------------------------------------------------------------
// Parser 2: PDF nativo (camada de texto)
// ---------------------------------------------------------------------------

async function extrairTextoPDF(buffer) {
  try {
    const pdfParse = await import('pdf-parse');
    const fn = pdfParse.default ?? pdfParse;
    const data = await fn(buffer);
    return data.text ?? '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Parser 3: OCR para PDFs escaneados
// ---------------------------------------------------------------------------

async function ocrizarPDF(buffer) {
  const sharp = (await import('sharp')).default;

  // Tenta converter PDF para imagem via sharp (quando há suporte)
  // Fallback: usa o próprio buffer como imagem se for JPEG/PNG diretamente
  let imgBuffer;
  try {
    imgBuffer = await sharp(buffer, { pages: 1 })
      .grayscale()
      .normalize()
      .threshold(128)
      .png()
      .toBuffer();
  } catch {
    // Se não conseguir converter (PDF binário), tenta o buffer diretamente
    try {
      imgBuffer = await sharp(buffer)
        .grayscale()
        .normalize()
        .threshold(128)
        .png()
        .toBuffer();
    } catch {
      return { texto: '', metodo: 'ocr_falhou' };
    }
  }

  const worker = await obterWorkerOCR();
  const { data } = await worker.recognize(imgBuffer);
  return { texto: data.text ?? '', metodo: 'tesseract_ocr', confianca: data.confidence ?? 0 };
}

// ---------------------------------------------------------------------------
// Extração de validade de certidões por regex
// ---------------------------------------------------------------------------

// Converte nome de mês em português para número
const MESES_PT = {
  janeiro: '01', fevereiro: '02', março: '03', marco: '03',
  abril: '04', maio: '05', junho: '06', julho: '07',
  agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};

function parsarDataCertidao(str) {
  if (!str) return null;
  const limpa = str.trim();

  // Formato DD/MM/AAAA
  const m1 = limpa.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;

  // Formato "DD de MMMM de AAAA"
  const m2 = limpa.toLowerCase().match(/^(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})$/);
  if (m2) {
    const mes = MESES_PT[m2[2]];
    if (mes) return `${m2[3]}-${mes}-${m2[1].padStart(2, '0')}`;
  }

  return null;
}

const PADROES_CERTIDAO = [
  // CND Federal / PGFN: "Válida até DD/MM/AAAA"
  /[Vv][áa]lid[ao]?\s+at[eé]\s+(\d{2}\/\d{2}\/\d{4})/,
  // CNDT (TJ): "válida até o dia DD de MMMM de AAAA"
  /[Vv][áa]lid[ao]?\s+at[eé]\s+o\s+dia\s+(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i,
  // CRF FGTS: "Validade: DD/MM/AAAA" ou "Validade DD/MM/AAAA"
  /[Vv]alidade[:\s]+(\d{2}\/\d{2}\/\d{4})/,
  // CND Estadual SEFAZ-BA: "Data de Validade: DD/MM/AAAA"
  /[Dd]ata\s+de\s+[Vv]alidade[:\s]+(\d{2}\/\d{2}\/\d{4})/,
  // Genérico: "Vence em DD/MM/AAAA"
  /[Vv]ence\s+em\s+(\d{2}\/\d{2}\/\d{4})/,
  // Genérico: "Expira em DD/MM/AAAA"
  /[Ee]xpira\s+em\s+(\d{2}\/\d{2}\/\d{4})/,
  // "Prazo de validade: DD/MM/AAAA"
  /[Pp]razo\s+de\s+validade[:\s]+(\d{2}\/\d{2}\/\d{4})/,
];

export function extrairValidadeCertidao(texto, campo) {
  if (!texto) return null;

  for (const padrao of PADROES_CERTIDAO) {
    const m = texto.match(padrao);
    if (m) {
      const dataIso = parsarDataCertidao(m[1]);
      if (dataIso) {
        return { campo, data_expiracao_iso: dataIso, padrao_encontrado: padrao.source };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cálculo de status de validade
// ---------------------------------------------------------------------------

export function calcularStatusValidade(dataExpiracaoIso) {
  if (!dataExpiracaoIso) return 'pendente';

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const exp = new Date(dataExpiracaoIso + 'T00:00:00');
  const diffMs = exp - hoje;
  const diffDias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDias < 0)  return 'vencido';
  if (diffDias <= 30) return 'alerta';
  return 'ok';
}

// ---------------------------------------------------------------------------
// Processador principal (roda em background)
// ---------------------------------------------------------------------------

async function processarDocumento(docId, tabela = 'documentos') {
  // Lê o documento do banco
  const tabelaSegura = tabela === 'fornecedor_documentos_fixos'
    ? 'fornecedor_documentos_fixos' : 'documentos';

  const doc = await queryOne(
    `SELECT d.id, d.caminho, d.mime_type, d.campo,
            e.fornecedor_id
     FROM ${tabelaSegura} d
     LEFT JOIN envios e ON e.id = d.envio_id
     WHERE d.id = $1`,
    [docId]
  );

  if (!doc) {
    console.warn(`[validacao] documento ${docId} não encontrado na tabela ${tabelaSegura}`);
    return;
  }

  // Lê o buffer do arquivo
  let buffer;
  try {
    buffer = await lerBufferArquivo(doc.caminho);
  } catch (err) {
    console.warn(`[validacao] não foi possível ler arquivo do doc ${docId}: ${err.message}`);
    await query(
      `UPDATE ${tabelaSegura} SET validacao_json = $1, status_validade = 'pendente' WHERE id = $2`,
      [JSON.stringify({ erro: 'arquivo_inacessivel', detalhe: err.message }), docId]
    );
    return;
  }

  // Busca dados do fornecedor para cross-check
  let contexto = {};
  if (doc.fornecedor_id) {
    const forn = await queryOne(
      'SELECT documento, razao_social FROM fornecedores WHERE id = $1',
      [doc.fornecedor_id]
    );
    if (forn) contexto = { fornecedorDocumento: forn.documento, razaoSocial: forn.razao_social };
  }

  let resultado = { tipo: 'desconhecido', metodo: 'nenhum' };
  let dataExpiracao = null;
  let statusValidade = 'pendente';

  try {
    // --- Rota 1: XML de NF-e ---
    if (ehCampoNF(doc.campo, doc.mime_type)) {
      resultado = await parsearNFeXML(buffer, contexto);
      resultado.tipo = 'nfe';
      statusValidade = 'ok'; // NFs não têm validade

    // --- Rota 2: PDF (certidão) ---
    } else if (
      doc.mime_type === 'application/pdf' ||
      (doc.caminho && doc.caminho.toLowerCase().endsWith('.pdf'))
    ) {
      let texto = await extrairTextoPDF(buffer);
      let metodo = 'pdf-parse';

      // Se o texto extraído for muito curto, provavelmente é PDF escaneado
      if (texto.replace(/\s/g, '').length < 50) {
        const ocr = await ocrizarPDF(buffer);
        texto = ocr.texto;
        metodo = ocr.metodo;
        resultado.confianca_ocr = ocr.confianca;
      }

      resultado.metodo = metodo;
      resultado.texto_extraido_tamanho = texto.length;

      if (ehCampoCertidao(doc.campo)) {
        resultado.tipo = 'certidao';
        const validade = extrairValidadeCertidao(texto, doc.campo);
        if (validade) {
          dataExpiracao = validade.data_expiracao_iso;
          statusValidade = calcularStatusValidade(dataExpiracao);
          resultado.data_expiracao = dataExpiracao;
          resultado.padrao_encontrado = validade.padrao_encontrado;
        } else {
          resultado.data_expiracao = null;
          resultado.aviso = 'data_validade_nao_encontrada';
          statusValidade = 'pendente';
        }
      } else {
        resultado.tipo = 'pdf_generico';
        statusValidade = 'ok';
      }

    // --- Rota 3: Imagem (JPEG/PNG) ---
    } else if (doc.mime_type && doc.mime_type.startsWith('image/')) {
      resultado.tipo = 'imagem';
      if (ehCampoCertidao(doc.campo)) {
        const ocr = await ocrizarPDF(buffer); // sharp aceita imagens também
        resultado.metodo = ocr.metodo;
        resultado.confianca_ocr = ocr.confianca;
        resultado.texto_extraido_tamanho = ocr.texto.length;
        const validade = extrairValidadeCertidao(ocr.texto, doc.campo);
        if (validade) {
          dataExpiracao = validade.data_expiracao_iso;
          statusValidade = calcularStatusValidade(dataExpiracao);
          resultado.data_expiracao = dataExpiracao;
        } else {
          resultado.aviso = 'data_validade_nao_encontrada';
          statusValidade = 'pendente';
        }
      } else {
        statusValidade = 'ok';
      }
    }
  } catch (err) {
    console.error(`[validacao] erro ao processar doc ${docId}:`, err.message);
    resultado.erro_processamento = err.message;
    statusValidade = 'pendente';
  }

  resultado.validado_em = new Date().toISOString();

  // Persiste resultado no banco
  await query(
    `UPDATE ${tabelaSegura}
     SET validacao_json   = $1,
         data_expiracao   = $2,
         status_validade  = $3
     WHERE id = $4`,
    [
      JSON.stringify(resultado),
      dataExpiracao || null,
      statusValidade,
      docId,
    ]
  );

  console.log(`[validacao] doc ${docId} processado → status=${statusValidade} exp=${dataExpiracao ?? 'N/A'}`);
}

// ---------------------------------------------------------------------------
// Entrada pública: fire-and-forget
// ---------------------------------------------------------------------------

/**
 * Dispara a validação de um documento em background.
 * Nunca bloqueia — retorna imediatamente.
 *
 * @param {number} docId - ID do documento na tabela
 * @param {object} opts
 * @param {'documentos'|'fornecedor_documentos_fixos'} opts.tabela
 */
export function dispararValidacaoBackground(docId, { tabela = 'documentos' } = {}) {
  setImmediate(() => {
    processarDocumento(docId, tabela).catch((err) => {
      console.error(`[validacao] falha inesperada no doc ${docId}:`, err.message);
    });
  });
}

// ---------------------------------------------------------------------------
// Gate de envio: bloqueia se houver certidões vencidas
// ---------------------------------------------------------------------------

/**
 * Verifica se o fornecedor tem certidões vencidas que bloqueiam novos envios.
 *
 * @param {number} fornecedorId
 * @returns {{ bloqueado: boolean, certidoes?: object[] }}
 */
export async function verificarBloqueioEnvio(fornecedorId) {
  const config = await obterCertidaoConfig();
  if (!config.bloquear_vencidas) return { bloqueado: false };

  const { rows } = await query(
    `SELECT d.campo, d.data_expiracao, d.nome_original
     FROM documentos d
     JOIN envios e ON e.id = d.envio_id
     WHERE e.fornecedor_id = $1
       AND d.status_validade = 'vencido'
       AND d.campo IN (
         'certidao_federal','cnd_federal','q15_fiscalFederal',
         'certidao_estadual','cnd_estadual','q16_fiscalEstadual',
         'certidao_municipal','cnd_municipal','q17_fiscalMunicipal',
         'cndt','q18_cndt',
         'crf_fgts','q19_crfFgts'
       )
     ORDER BY d.data_expiracao ASC
     LIMIT 10`,
    [fornecedorId]
  );

  if (rows.length === 0) return { bloqueado: false };
  return { bloqueado: true, certidoes: rows };
}
