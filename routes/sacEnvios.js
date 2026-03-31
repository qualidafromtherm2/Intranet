const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const pdfParse = require('pdf-parse');
const fetch = require('node-fetch');
const { parse: csvParse } = require('csv-parse/sync');

const supabase = require('../utils/supabase');

const router = express.Router();

const STATUS_LIST = ['Pendente', 'Em separação', 'Aguardando correios', 'Enviado', 'Finalizado'];

const TRACK_USER = process.env.TRACK_USER || 'guest';
const TRACK_TOKEN = process.env.TRACK_TOKEN || 'guest';
const TRACK_BASES = [
  ...(process.env.TRACK_BASE_URL ? [process.env.TRACK_BASE_URL] : []),
  'https://api.linketrack.com',
  'https://api.linketrack.com.br'
];

// Wonca: chave e endpoint configuráveis
const WONCA_API_KEY = process.env.WONCA_API_KEY || process.env.WONCA_TOKEN || '';
const WONCA_TRACK_URL = (process.env.WONCA_TRACK_URL || 'https://api-labs.wonca.com.br/wonca.labs.v1.LabsService/Track').replace(/\/$/, '');

// TrackingMore: fallback com carrier dos Correios
const TRACKINGMORE_API_KEY = process.env.TRACKINGMORE_API_KEY || process.env.TRACKINGMORE_TOKEN || '';
const TRACKINGMORE_URL = (process.env.TRACKINGMORE_URL || 'https://api.trackingmore.com/v2/trackings/realtime').replace(/\/$/, '');
const AT_SERIE_SHEETS_PUB_KEY = '2PACX-1vTBZcTPkowyN_dViQlzWd4noEgssByJR3f6YPtnR234sYIT5gTFI5PZXw3ZdPUOWAlxp_RDMo_I8JFm';
const AT_SERIE_SHEETS = ['PRODUÇÃO 1 - ESCOPO', 'PRODUÇÃO 2 - F/ ESCOPO'];
const AT_SERIE_PUBHTML_URL = `https://docs.google.com/spreadsheets/d/e/${AT_SERIE_SHEETS_PUB_KEY}/pubhtml`;
const AT_SERIE_CSV_URL = `https://docs.google.com/spreadsheets/d/e/${AT_SERIE_SHEETS_PUB_KEY}/pub`;
const LEGACY_SERIE_SHEET_ID = '1pYlgEpyF10xprNlI7kcnLQZJPwV15sAMtJaCKCBNySI';
const LEGACY_SERIE_SHEET_NAME = 'IMPORTRANGE';
const PEDIDOS_SERIE_SHEET_ID = '14cmU3eOVH8ZscU-nZqxPb1Do5wTnl0SdQCU1caee6qk';
const PEDIDOS_SERIE_GID = '1642140396';
const TESTE_GAS_SHEET_ID = '1Kzg7LngaUig6t2CLabS1fhZ-iD5idrmv1ZesIUVOy1M';
const TESTE_GAS_SHEET_GID = '1333359070';
let atSerieSheetGidCache = null;
let atSerieSheetGidCacheAt = 0;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function extractGvizJson(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Resposta gviz invalida.');
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function parseGvizRows(gvizObj) {
  const table = gvizObj?.table;
  const cols = Array.isArray(table?.cols) ? table.cols : [];
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const headers = cols.map((c, idx) => String(c?.label || c?.id || `col_${idx}`).trim());

  return rows.map((row) => {
    const cells = Array.isArray(row?.c) ? row.c : [];
    const out = {};
    headers.forEach((h, idx) => {
      const cell = cells[idx];
      const val = cell && typeof cell === 'object' ? (cell.f ?? cell.v ?? '') : '';
      out[h] = String(val ?? '').trim();
    });
    return out;
  });
}

function getValueByHeaderMatch(rowObj, matcher) {
  const keys = Object.keys(rowObj || {});
  const found = keys.find((key) => matcher(normalizeText(key)));
  return found ? String(rowObj[found] || '').trim() : '';
}

async function getAtSerieSheetGids() {
  const now = Date.now();
  if (atSerieSheetGidCache && (now - atSerieSheetGidCacheAt) < 10 * 60 * 1000) {
    return atSerieSheetGidCache;
  }

  const resp = await fetchWithTimeout(AT_SERIE_PUBHTML_URL, { headers: { Accept: 'text/html' } }, 15000);
  if (!resp.ok) {
    throw new Error(`Falha ao consultar pubhtml da planilha (${resp.status})`);
  }

  const html = await resp.text();
  const map = {};

  // Formato atual do pubhtml: items.push({name: "...", ..., gid: "..."})
  const scriptRegex = /items\.push\(\{name:\s*"([^"]+)",[\s\S]*?gid:\s*"(-?\d+)"/g;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const rawTitle = String(match[1] || '').trim();
    const gid = String(match[2] || '').trim();
    const title = rawTitle
      .replace(/\\\//g, '/')
      .replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .trim();
    if (!gid || !title) continue;
    map[normalizeText(title)] = gid;
  }

  // Fallback para versões antigas do pubhtml com links no menu
  if (!Object.keys(map).length) {
    const anchorRegex = /<a[^>]*href="\?gid=(\d+)[^"]*"[^>]*>(.*?)<\/a>/gi;
    while ((match = anchorRegex.exec(html)) !== null) {
      const gid = String(match[1] || '').trim();
      const titleHtml = String(match[2] || '').trim();
      const title = titleHtml.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim();
      if (!gid || !title) continue;
      map[normalizeText(title)] = gid;
    }
  }

  atSerieSheetGidCache = map;
  atSerieSheetGidCacheAt = now;
  return map;
}

async function fetchAtSerieSheetRows(sheetName) {
  const gidMap = await getAtSerieSheetGids();
  const gid = gidMap[normalizeText(sheetName)];
  if (!gid) {
    throw new Error(`Aba não encontrada na publicação: ${sheetName}`);
  }

  const csvUrl = `${AT_SERIE_CSV_URL}?gid=${encodeURIComponent(gid)}&single=true&output=csv`;
  const resp = await fetchWithTimeout(csvUrl, { headers: { Accept: 'text/csv' } }, 30000);
  if (!resp.ok) {
    throw new Error(`Falha ao consultar CSV da aba ${sheetName} (${resp.status})`);
  }
  const csvText = await resp.text();
  return csvParse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true,
  });
}

async function fetchLegacySerieRows() {
  const csvUrl = `https://docs.google.com/spreadsheets/d/${LEGACY_SERIE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(LEGACY_SERIE_SHEET_NAME)}`;
  const resp = await fetchWithTimeout(csvUrl, { headers: { Accept: 'text/csv' } }, 30000);
  if (!resp.ok) {
    throw new Error(`Falha ao consultar CSV da planilha legacy (${resp.status})`);
  }
  const csvText = await resp.text();
  return csvParse(csvText, {
    columns: false,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true,
  });
}

async function fetchPedidosSerieRows() {
  const csvUrl = `https://docs.google.com/spreadsheets/d/${PEDIDOS_SERIE_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(PEDIDOS_SERIE_GID)}`;
  const resp = await fetchWithTimeout(csvUrl, { headers: { Accept: 'text/csv' } }, 30000);
  if (!resp.ok) {
    throw new Error(`Falha ao consultar planilha PEDIDOS (${resp.status})`);
  }
  const csvText = await resp.text();
  return csvParse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true,
  });
}

async function fetchTesteGasRows() {
  const csvUrl = `https://docs.google.com/spreadsheets/d/${TESTE_GAS_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(TESTE_GAS_SHEET_GID)}`;
  const resp = await fetchWithTimeout(csvUrl, { headers: { Accept: 'text/csv' } }, 30000);
  if (!resp.ok) {
    throw new Error(`Falha ao consultar planilha TESTE/GAS (${resp.status})`);
  }
  const csvText = await resp.text();
  return csvParse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true,
  });
}

function isAbortError(err) {
  return err?.name === 'AbortError' || err?.type === 'aborted';
}

function sanitizeIdentificacao(codigo) {
  return String(codigo || '').replace(/\s+/g, '').toUpperCase() || null;
}

async function getStoredStatus(codigo) {
  if (!codigo) return null;
  try {
    const r = await pool.query(
      `SELECT identificacao, rastreio_status, rastreio_quando, finalizado_em
         FROM envios.solicitacoes
        WHERE upper(regexp_replace(COALESCE(identificacao, ''), '\\s+', '', 'g')) = $1
           OR upper(identificacao) = $1
        LIMIT 1`,
      [codigo]
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      codigo,
      status: row.rastreio_status,
      detalhe: null,
      local: null,
      cidade: null,
      uf: null,
      quando: row.finalizado_em || row.rastreio_quando
    };
  } catch (err) {
    console.warn('[SAC] falha ao buscar status armazenado:', err?.message || err);
    return null;
  }
}

async function persistStatus(codigo, { status, detalhe, local, cidade, uf, quando }) {
  const statusVal = String(status || '').trim() || 'sem status';
  const quandoVal = quando ? new Date(quando) : null;
  const isDelivered = /entregue ao destinat[áa]rio/i.test(statusVal) || /\bentregue\b/i.test(statusVal);

  try {
    await pool.query(
      `UPDATE envios.solicitacoes
          SET rastreio_status = $2,
              rastreio_quando = COALESCE($3, rastreio_quando),
              status = CASE
                         WHEN $4 AND status <> 'Finalizado' THEN 'Finalizado'
                         ELSE status
                       END,
              finalizado_em = CASE
                                WHEN $4 THEN COALESCE($3, finalizado_em, NOW())
                                ELSE finalizado_em
                              END
        WHERE upper(regexp_replace(COALESCE(identificacao, ''), '\\s+', '', 'g')) = $1
           OR upper(identificacao) = $1`,
      [codigo, statusVal, quandoVal, isDelivered]
    );
  } catch (err) {
    console.warn('[SAC] falha ao atualizar rastreio_status:', err?.message || err);
  }
}

const trackCache = new Map();
const CACHE_HIT_TTL_MS = 10 * 60 * 1000; // 10min
const CACHE_FAIL_TTL_MS = 5 * 60 * 1000;  // 5min

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: ctrl.signal });
    return r;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeStatus(statusRaw) {
  const val = String(statusRaw || '').trim();
  if (!val) return STATUS_LIST[0];
  const normalized = STATUS_LIST.find(s => s.toLowerCase() === val.toLowerCase());
  return normalized || STATUS_LIST[0];
}

// Extrai e formata o conteúdo da declaração de conteúdo (PDF)
function extractConteudo(textRaw) {
  const text = String(textRaw || '');
  const lower = text.toLowerCase();
  const startKey = 'identificação dos bens';
  const startKeyAlt = 'identificacao dos bens';
  let start = lower.indexOf(startKey);
  if (start === -1) start = lower.indexOf(startKeyAlt);
  if (start === -1) return null;

  const slice = text.slice(start);
  const lowerSlice = lower.slice(start);
  const endMarkers = ['totais', 'peso total', 'declaração', 'declaracao'];
  let end = slice.length;
  for (const mark of endMarkers) {
    const idx = lowerSlice.indexOf(mark);
    if (idx !== -1 && idx < end) end = idx;
  }

  let section = slice.slice(0, end);
  section = section.replace(/Identificação Dos Bens/i, '');
  section = section.replace(/Item\s*Conteúdo\s*Quant\.?\s*Valor/i, '');

  const lines = section
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const items = [];
  const seen = new Set();
  
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, ' ').trim();
    
    // Ignora headers ou linhas puramente numéricas
    if (!/[A-Za-z]/.test(normalized)) continue;
    if (/^í?tem|^conte(ú|u)do|^quant|^valor/i.test(normalized)) continue;
    if (/(item|ítem).*(conte(ú|u)do)/i.test(normalized)) continue;
    if (/^totais?/i.test(normalized)) break;
    if (seen.has(normalized)) continue; // evita duplicar
    seen.add(normalized);
    
    // Extrai apenas conteúdo e quantidade (ignora coluna Item do PDF)
    // Quantidade deve ser apenas 1 ou 2 dígitos no FINAL da linha
    
    // Remove número inicial (coluna Item do PDF) se existir
    const withoutLeadingNumber = normalized.replace(/^\d+\s+/, '');
    
    // Tenta extrair quantidade: apenas 1 ou 2 dígitos no final
    const match = withoutLeadingNumber.match(/^(.+?)\s+(\d{1,2})\s*$/);
    
    if (match) {
      const conteudo = match[1].trim();
      const quantidade = match[2];
      
      items.push({
        conteudo: conteudo,
        quantidade: quantidade
      });
    } else {
      // Se não encontrou quantidade, adiciona com quantidade 1
      if (withoutLeadingNumber) {
        items.push({
          conteudo: withoutLeadingNumber,
          quantidade: '1'
        });
      }
    }
  }

  if (!items.length) return null;

  // Retorna em formato JSON para melhor estruturação no frontend
  return JSON.stringify(items);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

const BUCKET = process.env.SUPABASE_BUCKET_SAC || process.env.SUPABASE_BUCKET || 'produtos';

// Upload em memória, máximo 12MB por arquivo, até 2 arquivos
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 2 }
});

async function ensureSchema() {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS envios;
    CREATE TABLE IF NOT EXISTS envios.solicitacoes (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      usuario TEXT NOT NULL,
      observacao TEXT,
      status TEXT NOT NULL DEFAULT 'Pendente',
      anexos TEXT[] NOT NULL DEFAULT '{}',
      conferido BOOLEAN NOT NULL DEFAULT false,
      etiqueta_url TEXT,
      declaracao_url TEXT,
      identificacao TEXT,
      finalizado_em TIMESTAMPTZ
    );

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS anexos TEXT[] NOT NULL DEFAULT '{}'::text[];

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS conferido BOOLEAN NOT NULL DEFAULT false;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS etiqueta_url TEXT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS declaracao_url TEXT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS identificacao TEXT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS conteudo TEXT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS rastreio_status TEXT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS rastreio_quando TIMESTAMPTZ;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS finalizado_em TIMESTAMPTZ;

    ALTER TABLE envios.solicitacoes
      ALTER COLUMN status SET DEFAULT 'Pendente';

    CREATE SCHEMA IF NOT EXISTS sac;

    CREATE TABLE IF NOT EXISTS sac.at (
      id BIGSERIAL PRIMARY KEY,
      data TIMESTAMP NOT NULL DEFAULT NOW(),
      tipo TEXT,
      nome_revenda_cliente TEXT,
      numero_telefone TEXT,
      cpf_cnpj TEXT,
      cep TEXT,
      bairro TEXT,
      cidade TEXT,
      estado TEXT,
      numero TEXT,
      rua TEXT,
      agendar_atendimento_com TEXT,
      descreva_reclamacao TEXT
    );

    CREATE TABLE IF NOT EXISTS sac.at_busca_selecionada (
      id BIGSERIAL PRIMARY KEY,
      id_at BIGINT NOT NULL REFERENCES sac.at(id) ON DELETE CASCADE,
      pedido TEXT,
      ordem_producao TEXT,
      modelo TEXT,
      cliente TEXT,
      nota_fiscal TEXT,
      data_entrega TEXT,
      teste_tipo_gas TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS modelo TEXT;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS tag_problema TEXT;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS plataforma_atendimento TEXT;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS editado_por TEXT;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS editado_em TIMESTAMP;

    CREATE TABLE IF NOT EXISTS sac.fechamento (
      id BIGSERIAL PRIMARY KEY,
      id_at BIGINT NOT NULL REFERENCES sac.at(id) ON DELETE CASCADE,
      tag_problema TEXT,
      plataforma_atendimento TEXT,
      descricao_servico_realizado TEXT,
      valor_total_mao_obra NUMERIC(15,2),
      valor_gasto_pecas NUMERIC(15,2),
      pecas_reposicao TEXT,
      data_conclusao_servico DATE,
      observacoes TEXT,
      midias_servico TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sac.at_anexos (
      id         BIGSERIAL PRIMARY KEY,
      id_at      BIGINT NOT NULL REFERENCES sac.at(id) ON DELETE CASCADE,
      nome_arquivo TEXT NOT NULL,
      path_key   TEXT NOT NULL,
      url_publica TEXT NOT NULL,
      content_type TEXT,
      tamanho_bytes BIGINT,
      enviado_por TEXT,
      criado_em  TIMESTAMP NOT NULL DEFAULT NOW()
    );

    DO $controle$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'controle_tecnicos'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'sac' AND table_name = 'controle_tecnicos'
      ) THEN
        ALTER TABLE public.controle_tecnicos SET SCHEMA sac;
      END IF;
    END $controle$;
  `);
}

ensureSchema().catch(err => {
  console.error('[SAC] falha ao garantir schema/tabela envios:', err);
});

router.post('/at', async (req, res) => {
  const body = req.body || {};

  const payload = {
    tipo: String(body.tipo || '').trim() || null,
    nomeRevendaCliente: String(body.nome_revenda_cliente || '').trim() || null,
    numeroTelefone: String(body.numero_telefone || '').trim() || null,
    cpfCnpj: String(body.cpf_cnpj || '').trim() || null,
    cep: String(body.cep || '').trim() || null,
    bairro: String(body.bairro || '').trim() || null,
    cidade: String(body.cidade || '').trim() || null,
    estado: String(body.estado || '').trim() || null,
    numero: String(body.numero || '').trim() || null,
    rua: String(body.rua || '').trim() || null,
    agendarAtendimentoCom: String(body.agendar_atendimento_com || '').trim() || null,
    descrevaReclamacao: String(body.descreva_reclamacao || '').trim() || null,
    modelo: String(body.modelo || '').trim() || null,
    tagProblema: String(body.tag_problema || '').trim() || null,
    plataformaAtendimento: String(body.plataforma_atendimento || '').trim() || null,
  };

  // Se vier id_at_existente significa que é um novo registro de reclamação sobre um AT já existente
  const idAtExistente = body.id_at_existente && Number.isInteger(Number(body.id_at_existente))
    ? Number(body.id_at_existente)
    : null;

  const selectedItemRaw = body.selected_item && typeof body.selected_item === 'object'
    ? body.selected_item
    : null;
  const selectedItem = selectedItemRaw ? {
    pedido: String(selectedItemRaw.pedido || '').trim() || null,
    ordemProducao: String(selectedItemRaw.ordem_producao || '').trim() || null,
    modelo: String(selectedItemRaw.modelo || '').trim() || null,
    cliente: String(selectedItemRaw.cliente || '').trim() || null,
    notaFiscal: String(selectedItemRaw.nota_fiscal || '').trim() || null,
    dataEntrega: String(selectedItemRaw.data_entrega || '').trim() || null,
    testeTipoGas: String(selectedItemRaw.teste_tipo_gas || '').trim() || null,
  } : null;

  const hasSelectedItem = !!selectedItem && [
    selectedItem.pedido,
    selectedItem.ordemProducao,
    selectedItem.modelo,
    selectedItem.cliente,
    selectedItem.notaFiscal,
    selectedItem.dataEntrega,
    selectedItem.testeTipoGas,
  ].some(Boolean);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let atRow;

    if (idAtExistente) {
      // AT já existe — apenas inserir nova linha de reclamação (nova entrada na tabela sac.at)
      // referenciando o mesmo item selecionado, sem duplicar sac.at_busca_selecionada
      const result = await client.query(
        `INSERT INTO sac.at (
           tipo,
           nome_revenda_cliente,
           numero_telefone,
           cpf_cnpj,
           cep,
           bairro,
           cidade,
           estado,
           numero,
           rua,
           agendar_atendimento_com,
           descreva_reclamacao,
           modelo,
           tag_problema,
           plataforma_atendimento
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id, data`,
        [
          payload.tipo,
          payload.nomeRevendaCliente,
          payload.numeroTelefone,
          payload.cpfCnpj,
          payload.cep,
          payload.bairro,
          payload.cidade,
          payload.estado,
          payload.numero,
          payload.rua,
          payload.agendarAtendimentoCom,
          payload.descrevaReclamacao,
          payload.modelo,
          payload.tagProblema,
          payload.plataformaAtendimento,
        ]
      );
      atRow = result.rows[0];

      // Copia o vínculo do item selecionado do AT original para este novo AT
      await client.query(
        `INSERT INTO sac.at_busca_selecionada (id_at, pedido, ordem_producao, modelo, cliente, nota_fiscal, data_entrega, teste_tipo_gas)
         SELECT $1, pedido, ordem_producao, modelo, cliente, nota_fiscal, data_entrega, teste_tipo_gas
           FROM sac.at_busca_selecionada WHERE id_at = $2 LIMIT 1`,
        [atRow.id, idAtExistente]
      );
    } else {
      const result = await client.query(
        `INSERT INTO sac.at (
           tipo,
           nome_revenda_cliente,
           numero_telefone,
           cpf_cnpj,
           cep,
           bairro,
           cidade,
           estado,
           numero,
           rua,
           agendar_atendimento_com,
           descreva_reclamacao,
           modelo,
           tag_problema,
           plataforma_atendimento
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id, data`,
        [
          payload.tipo,
          payload.nomeRevendaCliente,
          payload.numeroTelefone,
          payload.cpfCnpj,
          payload.cep,
          payload.bairro,
          payload.cidade,
          payload.estado,
          payload.numero,
          payload.rua,
          payload.agendarAtendimentoCom,
          payload.descrevaReclamacao,
          payload.modelo,
          payload.tagProblema,
          payload.plataformaAtendimento,
        ]
      );
      atRow = result.rows[0];

      if (hasSelectedItem) {
        await client.query(
          `INSERT INTO sac.at_busca_selecionada (
              id_at, pedido, ordem_producao, modelo, cliente, nota_fiscal, data_entrega, teste_tipo_gas
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            atRow.id,
            selectedItem.pedido,
            selectedItem.ordemProducao,
            selectedItem.modelo,
            selectedItem.cliente,
            selectedItem.notaFiscal,
            selectedItem.dataEntrega,
            selectedItem.testeTipoGas,
          ]
        );
      }
    }

    await client.query('COMMIT');

    return res.status(201).json({ ok: true, row: atRow });
  } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[SAC/AT] erro ao salvar atendimento:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao salvar atendimento AT.' });
    } finally {
      client.release();
  }
});

router.get('/at/atendimentos', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         a.id,
         a.data,
         a.tipo,
         a.nome_revenda_cliente,
         a.numero_telefone          AS telefone,
         a.cpf_cnpj,
         a.estado,
         a.cidade,
         a.descreva_reclamacao,
         COALESCE(a.modelo, s.modelo) AS modelo,
         a.tag_problema,
         a.plataforma_atendimento,
         a.editado_por,
         a.editado_em,
         s.pedido,
         s.ordem_producao,
         s.cliente,
         s.nota_fiscal,
         s.data_entrega,
         s.teste_tipo_gas,
         f.id                        AS fech_id,
         f.tag_problema             AS fech_tag,
         f.plataforma_atendimento   AS fech_plataforma,
         f.descricao_servico_realizado AS fech_descricao,
         f.valor_total_mao_obra     AS fech_valor_mo,
         f.valor_gasto_pecas        AS fech_valor_pecas,
         f.pecas_reposicao          AS fech_pecas,
         f.data_conclusao_servico   AS fech_data_conclusao,
         f.observacoes              AS fech_obs,
         f.midias_servico           AS fech_midias,
         (SELECT COUNT(*) FROM sac.at_anexos anx WHERE anx.id_at = a.id) AS qtd_anexos
       FROM sac.at a
       LEFT JOIN sac.at_busca_selecionada s ON s.id_at = a.id
       LEFT JOIN sac.fechamento           f ON f.id_at = a.id
       ORDER BY a.id DESC`
    );

    return res.json({ ok: true, rows: result.rows || [] });
  } catch (err) {
    console.error('[SAC/AT] erro ao listar atendimentos:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao listar atendimentos AT.' });
  }
});

router.patch('/at/atendimentos/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || id <= 0) return res.status(400).json({ ok: false, error: 'ID inválido.' });

  // mapeamento campo_frontend -> coluna_db
  const FIELD_MAP = {
    nome_revenda_cliente:   'nome_revenda_cliente',
    telefone:               'numero_telefone',
    cpf_cnpj:               'cpf_cnpj',
    estado:                 'estado',
    cidade:                 'cidade',
    descreva_reclamacao:    'descreva_reclamacao',
    modelo:                 'modelo',
    tag_problema:           'tag_problema',
    plataforma_atendimento: 'plataforma_atendimento',
  };

  const setClauses = [];
  const colValues  = [];

  for (const [campo, coluna] of Object.entries(FIELD_MAP)) {
    if (Object.prototype.hasOwnProperty.call(req.body, campo)) {
      setClauses.push(`${coluna} = $${setClauses.length + 1}`);
      colValues.push(String(req.body[campo] ?? '').trim() || null);
    }
  }

  if (!setClauses.length)
    return res.status(400).json({ ok: false, error: 'Nenhum campo válido enviado.' });

  const usuarioLogado = req.session?.user?.fullName
                     || req.session?.user?.username
                     || req.session?.user?.login
                     || 'desconhecido';

  // editado_por como parâmetro; editado_em usa NOW() direto
  setClauses.push(`editado_por = $${setClauses.length + 1}`);
  colValues.push(usuarioLogado);
  setClauses.push(`editado_em = NOW()`);

  const values = [...colValues, id];

  try {
    await pool.query(
      `UPDATE sac.at SET ${setClauses.join(', ')} WHERE id = $${values.length}`,
      values
    );
    return res.json({ ok: true, editado_por: usuarioLogado, editado_em: new Date().toISOString() });
  } catch (err) {
    console.error('[SAC/AT] erro ao atualizar atendimento:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao atualizar atendimento.' });
  }
});

router.patch('/at/fechamento/:id_at', async (req, res) => {
  const idAt = parseInt(req.params.id_at, 10);
  if (!idAt || idAt <= 0) return res.status(400).json({ ok: false, error: 'ID inválido.' });

  const FECH_FIELDS = [
    'tag_problema', 'plataforma_atendimento', 'descricao_servico_realizado',
    'valor_total_mao_obra', 'valor_gasto_pecas', 'pecas_reposicao',
    'data_conclusao_servico', 'observacoes', 'midias_servico'
  ];
  const cols = [];
  const vals = [];
  for (const field of FECH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      let v = String(req.body[field] ?? '').trim() || null;
      cols.push(field);
      vals.push(v);
    }
  }
  if (!cols.length) return res.status(400).json({ ok: false, error: 'Nenhum campo válido.' });

  try {
    const existing = await pool.query('SELECT id FROM sac.fechamento WHERE id_at = $1', [idAt]);
    if (existing.rows.length) {
      const setList = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
      await pool.query(
        `UPDATE sac.fechamento SET ${setList} WHERE id_at = $1`,
        [idAt, ...vals]
      );
    } else {
      await pool.query(
        `INSERT INTO sac.fechamento (id_at, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
        [idAt, ...vals]
      );
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[SAC/AT] erro ao salvar fechamento:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao salvar fechamento.' });
  }
});

router.post('/solicitacoes', upload.array('anexos', 2), async (req, res) => {
  const usuario = String(req.body?.usuario || '').trim();
  const observacao = String(req.body?.observacao || '').trim();
  const status = normalizeStatus(req.body?.status);

  if (!usuario) {
    return res.status(400).json({ ok: false, error: 'Usuário é obrigatório.' });
  }

  const files = Array.isArray(req.files) ? req.files : [];
  const urls = [];
  let identificacao = null;
  let conteudo = null;

  try {
    // Faz upload opcional dos arquivos selecionados
    for (const [index, file] of files.entries()) {
      const ext = mime.extension(file.mimetype) || 'bin';
      const fileName = `${uuidv4()}.${ext}`;
      const pathKey = `sac/${fileName}`;

      const { error: upErr } = await supabase
        .storage
        .from(BUCKET)
        .upload(pathKey, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathKey);
      urls.push(data.publicUrl);

      // Extrai código de barras somente do primeiro arquivo (Etiqueta)
      if (index === 0 && !identificacao && file.mimetype === 'application/pdf') {
        try {
          const parsed = await pdfParse(file.buffer);
          const text = String(parsed?.text || '');
          const match = text.match(/[A-Z]{2}\s?\d{3}\s?\d{3}\s?\d{3}\s?[A-Z]{2}/);
          if (match) {
            identificacao = match[0].replace(/\s+/g, ' ').trim();
          }
        } catch (err) {
          console.warn('[SAC] não foi possível extrair identificação da etiqueta:', err?.message || err);
        }
      }

      // Extrai conteúdo da declaração (assumindo segundo arquivo)
      if (index === 1 && !conteudo && file.mimetype === 'application/pdf') {
        try {
          const parsed = await pdfParse(file.buffer);
          conteudo = extractConteudo(parsed?.text);
        } catch (err) {
          console.warn('[SAC] não foi possível extrair conteúdo da declaração:', err?.message || err);
        }
      }
    }

    const etiquetaUrl = urls[0] || null;
    const declaracaoUrl = urls[1] || null;

    const result = await pool.query(
      `INSERT INTO envios.solicitacoes (usuario, observacao, status, anexos, conferido, etiqueta_url, declaracao_url, identificacao, conteudo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, created_at, status, anexos, conferido, etiqueta_url, declaracao_url, identificacao, conteudo`,
      [usuario, observacao, status, urls, false, etiquetaUrl, declaracaoUrl, identificacao, conteudo]
    );

    const row = result.rows[0];
    return res.json({ ok: true, id: row.id, created_at: row.created_at, status: row.status, anexos: row.anexos, conferido: row.conferido, etiqueta_url: row.etiqueta_url, declaracao_url: row.declaracao_url, identificacao: row.identificacao, conteudo: row.conteudo });
  } catch (err) {
    console.error('[SAC] erro ao inserir solicitação:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao registrar solicitação.' });
  }
});

// Lista solicitações de envio (com opção de filtrar por usuário logado)
router.get('/solicitacoes', async (req, res) => {
  try {
    const hideDone = String(req.query?.hideDone || '').toLowerCase() === 'true' || req.query?.hideDone === '1';
    // Novo parâmetro: filterByUser=1 indica que deve filtrar apenas registros do usuário logado
    const filterByUser = String(req.query?.filterByUser || '').toLowerCase() === 'true' || req.query?.filterByUser === '1';

    const conditions = [];
    const params = [];

    // Filtro por status (oculta Enviado e Finalizado)
    if (hideDone) {
      conditions.push("COALESCE(status, '') NOT IN ('Enviado', 'Finalizado')");
    }

    // Filtro por usuário logado (apenas se filterByUser=true)
    if (filterByUser) {
      const usuarioLogado = req.session?.user?.fullName 
                         || req.session?.user?.username 
                         || req.session?.user?.login
                         || null;

      if (!usuarioLogado) {
        return res.status(401).json({ ok: false, error: 'Usuário não autenticado.' });
      }

      params.push(usuarioLogado);
      conditions.push(`usuario = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const r = await pool.query(
      `SELECT id, created_at, usuario, observacao, status, conferido, etiqueta_url, declaracao_url, identificacao, conteudo, rastreio_status, rastreio_quando, finalizado_em
         FROM envios.solicitacoes
        ${whereClause}
        ORDER BY id DESC
        LIMIT 200`,
      params
    );
    return res.json({ ok: true, rows: r.rows });
  } catch (err) {
    console.error('[SAC] erro ao listar solicitacoes:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao listar solicitacoes.' });
  }
});

// Rastreio: tenta Correios e depois LinkeTrack, com cache simples em memória
router.get('/rastreio/:codigo', async (req, res) => {
  const codigo = sanitizeIdentificacao(req.params.codigo);
  if (!codigo) {
    return res.status(400).json({ ok: false, error: 'Código inválido.' });
  }

  try {
    const now = Date.now();
    const cached = trackCache.get(codigo);
    if (cached && (now - cached.at) < (cached.ok ? CACHE_HIT_TTL_MS : CACHE_FAIL_TTL_MS)) {
      const payload = cached.payload || {};
      // Garante persistência mesmo em cache, útil para marcar Finalizado após ajuste de lógica
      await persistStatus(codigo, {
        status: payload.status || payload.detalhe || 'ok',
        detalhe: payload.detalhe,
        local: payload.local,
        cidade: payload.cidade,
        uf: payload.uf,
        quando: payload.quando
      });
      return res.json(cached.payload);
    }

    let lastErr = null;

    // Tentativa 1: Correios
    try {
      const urlCorreios = `https://proxyapp.correios.com.br/v1/sro-rastro/${codigo}`;
      const r1 = await fetchWithTimeout(urlCorreios, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://rastreamento.correios.com.br/app/index.php'
        }
      });

      if (r1.ok) {
        const data = await r1.json();
        const eventos = data?.objetos?.[0]?.eventos || [];
        const ultimo = eventos[0] || null;
        const status = ultimo?.descricao || null;
        const detalhe = ultimo?.detalhe || null;
        const local = ultimo?.unidade?.local || null;
        const cidade = ultimo?.unidade?.endereco?.cidade || null;
        const uf = ultimo?.unidade?.endereco?.uf || null;
        const quando = ultimo?.dtHrCriado || null;
        const payload = { ok: true, codigo, status, detalhe, local, cidade, uf, quando };
        await persistStatus(codigo, { status: status || detalhe || 'ok', detalhe, local, cidade, uf, quando });
        trackCache.set(codigo, { ok: true, payload, at: now });
        return res.json(payload);
      }
    } catch (err) {
      lastErr = err;
    }

    // Tentativa 2: Wonca API (requer WONCA_API_KEY)
    if (WONCA_API_KEY) {
      try {
        const r2 = await fetchWithTimeout(WONCA_TRACK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Apikey ${WONCA_API_KEY}`
          },
          body: JSON.stringify({ code: codigo })
        });

        if (r2.ok) {
          const data2 = await r2.json();

          const eventos2 = data2?.events
            || data2?.eventos
            || data2?.data?.events
            || data2?.data?.eventos
            || [];

          const ultimo2 = Array.isArray(eventos2) ? eventos2[0] || null : null;
          const status2 = ultimo2?.description || ultimo2?.descricao || ultimo2?.status || data2?.status || null;
          const detalhe2 = ultimo2?.detail || ultimo2?.detalhe || ultimo2?.message || null;
          const local2 = ultimo2?.local || ultimo2?.location || null;
          const cidade2 = ultimo2?.cidade || ultimo2?.city || null;
          const uf2 = ultimo2?.uf || ultimo2?.state || null;
          const quando2 = ultimo2?.datetime
            || ultimo2?.dataHora
            || (ultimo2?.date && ultimo2?.time ? `${ultimo2.date} ${ultimo2.time}` : null);

          const payload = { ok: true, codigo, status: status2, detalhe: detalhe2, local: local2, cidade: cidade2, uf: uf2, quando: quando2 };
          await persistStatus(codigo, { status: status2 || detalhe2 || 'ok', detalhe: detalhe2, local: local2, cidade: cidade2, uf: uf2, quando: quando2 });
          trackCache.set(codigo, { ok: true, payload, at: now });
          return res.json(payload);
        }

        lastErr = new Error(`Wonca HTTP ${r2.status}`);
      } catch (err) {
        lastErr = err;
      }
    }

    // Tentativa 3: TrackingMore (carrier Correios)
    if (TRACKINGMORE_API_KEY) {
      try {
        const r3 = await fetchWithTimeout(TRACKINGMORE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Trackingmore-Api-Key': TRACKINGMORE_API_KEY
          },
          body: JSON.stringify({ tracking_number: codigo, carrier_code: 'brazil-correios' })
        });

        if (r3.ok) {
          const data3 = await r3.json();
          const item = data3?.data?.items?.[0] || null;

          if (item && item.status && item.status !== 'notfound') {
            const trackInfos = item?.origin_info?.trackinfo || item?.destination_info?.trackinfo || [];
            const ultimo3 = Array.isArray(trackInfos) ? trackInfos[0] || null : null;

            const status3 = ultimo3?.StatusDescription
              || ultimo3?.statusDescription
              || ultimo3?.Status
              || ultimo3?.status
              || item?.status
              || null;

            const detalhe3 = ultimo3?.Details
              || ultimo3?.details
              || ultimo3?.checkpoint_delivery_status
              || ultimo3?.substatus
              || null;

            const local3 = ultimo3?.Location
              || ultimo3?.location
              || ultimo3?.checkpoint_city
              || null;

            const cidade3 = ultimo3?.city || ultimo3?.checkpoint_city || null;
            const uf3 = ultimo3?.state || ultimo3?.checkpoint_state || null;
            const quando3 = ultimo3?.Date
              || ultimo3?.date
              || ultimo3?.EventTime
              || ultimo3?.checkpoint_time
              || null;

            const payload = { ok: true, codigo, status: status3, detalhe: detalhe3, local: local3, cidade: cidade3, uf: uf3, quando: quando3 };
            await persistStatus(codigo, { status: status3 || detalhe3 || item?.status || 'ok', detalhe: detalhe3, local: local3, cidade: cidade3, uf: uf3, quando: quando3 });
            trackCache.set(codigo, { ok: true, payload, at: now });
            return res.json(payload);
          }

          if (item?.status === 'notfound') {
            lastErr = new Error('TrackingMore: código não encontrado');
          } else {
            lastErr = new Error('TrackingMore: resposta sem eventos');
          }
        } else {
          lastErr = new Error(`TrackingMore HTTP ${r3.status}`);
        }
      } catch (err) {
        lastErr = err;
      }
    }

    // Tentativa 4: LinkeTrack (com fallback para múltiplas bases)
    for (const baseUrl of TRACK_BASES) {
      try {
        const cleanBase = baseUrl.replace(/\/$/, '');
        const urlLinke = `${cleanBase}/track/json?user=${encodeURIComponent(TRACK_USER)}&token=${encodeURIComponent(TRACK_TOKEN)}&codigo=${encodeURIComponent(codigo)}`;
        const r3 = await fetchWithTimeout(urlLinke, { method: 'GET' });

        if (!r3.ok) {
          lastErr = new Error(`HTTP ${r3.status} em ${cleanBase}`);
          continue;
        }

        const data3 = await r3.json();
        const eventos3 = data3?.eventos || [];
        const ultimo3 = eventos3[0] || null;
        const status3 = ultimo3?.status || ultimo3?.descricao || null;
        const detalhe3 = ultimo3?.subStatus?.join(' | ') || null;
        const local3 = ultimo3?.local || null;
        const cidade3 = ultimo3?.cidade || null;
        const uf3 = ultimo3?.uf || null;
        const quando3 = ultimo3?.data && ultimo3?.hora ? `${ultimo3.data} ${ultimo3.hora}` : null;

        const payload = { ok: true, codigo, status: status3, detalhe: detalhe3, local: local3, cidade: cidade3, uf: uf3, quando: quando3 };
        await persistStatus(codigo, { status: status3 || detalhe3 || 'ok', detalhe: detalhe3, local: local3, cidade: cidade3, uf: uf3, quando: quando3 });
        trackCache.set(codigo, { ok: true, payload, at: now });
        return res.json(payload);
      } catch (err) {
        lastErr = err;
        if (err?.code === 'ENOTFOUND') continue;
      }
    }

    const stored = await getStoredStatus(codigo);
    if (stored?.status) {
      const payloadStored = { ok: true, codigo, status: stored.status, detalhe: stored.detalhe, local: stored.local, cidade: stored.cidade, uf: stored.uf, quando: stored.quando };
      trackCache.set(codigo, { ok: true, payload: payloadStored, at: now });
      return res.json(payloadStored);
    }

    const payload = { ok: false, error: 'Rastreamento indisponível no momento.' };
    if (lastErr?.message) payload.detail = lastErr.message;
    trackCache.set(codigo, { ok: false, payload, at: now });
    return res.status(200).json(payload);
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    const stored = await getStoredStatus(codigo);
    if (stored?.status) {
      const payloadStored = { ok: true, codigo, status: stored.status, detalhe: stored.detalhe, local: stored.local, cidade: stored.cidade, uf: stored.uf, quando: stored.quando };
      trackCache.set(codigo, { ok: true, payload: payloadStored, at: Date.now() });
      return res.json(payloadStored);
    }

    const payload = { ok: false, error: aborted ? 'Timeout ao consultar rastreio.' : 'Rastreamento indisponível no momento.' };
    trackCache.set(codigo, { ok: false, payload, at: Date.now() });
    return res.status(200).json(payload);
  }
});

router.patch('/solicitacoes/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'ID inválido.' });
  }

  const status = normalizeStatus(req.body?.status);
  if (!STATUS_LIST.includes(status)) {
    return res.status(400).json({ ok: false, error: 'Status inválido.' });
  }

  try {
    const r = await pool.query(
      `UPDATE envios.solicitacoes
          SET status = $1
        WHERE id = $2
      RETURNING id, status`,
      [status, id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Registro não encontrado.' });
    }

    return res.json({ ok: true, status: r.rows[0].status });
  } catch (err) {
    console.error('[SAC] erro ao atualizar status:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar status.' });
  }
});

// Endpoint para editar observação
router.patch('/solicitacoes/:id/observacao', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'ID inválido.' });
  }

  const observacao = String(req.body?.observacao || '').trim();

  try {
    const r = await pool.query(
      `UPDATE envios.solicitacoes
          SET observacao = $1
        WHERE id = $2
      RETURNING id, observacao`,
      [observacao, id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Registro não encontrado.' });
    }

    return res.json({ ok: true, observacao: r.rows[0].observacao });
  } catch (err) {
    console.error('[SAC] erro ao atualizar observação:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar observação.' });
  }
});

// Endpoint para editar status livre (qualquer valor)
router.patch('/solicitacoes/:id/status-livre', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'ID inválido.' });
  }

  const status = String(req.body?.status || '').trim();
  if (!status) {
    return res.status(400).json({ ok: false, error: 'Status não pode ser vazio.' });
  }

  try {
    const r = await pool.query(
      `UPDATE envios.solicitacoes
          SET status = $1
        WHERE id = $2
      RETURNING id, status`,
      [status, id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Registro não encontrado.' });
    }

    return res.json({ ok: true, status: r.rows[0].status });
  } catch (err) {
    console.error('[SAC] erro ao atualizar status livre:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar status.' });
  }
});

// Endpoint para editar quantidade dentro do campo conteudo (JSON)
router.patch('/solicitacoes/:id/quantidade', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'ID inválido.' });
  }

  const conteudoNovo = req.body?.conteudo;
  if (!conteudoNovo) {
    return res.status(400).json({ ok: false, error: 'Conteúdo não fornecido.' });
  }

  try {
    // Validar se é um JSON válido
    const conteudoStr = typeof conteudoNovo === 'string' ? conteudoNovo : JSON.stringify(conteudoNovo);
    JSON.parse(conteudoStr); // Valida o JSON

    const r = await pool.query(
      `UPDATE envios.solicitacoes
          SET conteudo = $1
        WHERE id = $2
      RETURNING id, conteudo`,
      [conteudoStr, id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Registro não encontrado.' });
    }

    return res.json({ ok: true, conteudo: r.rows[0].conteudo });
  } catch (err) {
    console.error('[SAC] erro ao atualizar quantidade:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar quantidade.' });
  }
});

// Endpoint para excluir (marcar status como "Excluído")
router.delete('/solicitacoes/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'ID inválido.' });
  }

  try {
    const r = await pool.query(
      `UPDATE envios.solicitacoes
          SET status = 'Excluído'
        WHERE id = $1
      RETURNING id, status`,
      [id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Registro não encontrado.' });
    }

    return res.json({ ok: true, status: r.rows[0].status });
  } catch (err) {
    console.error('[SAC] erro ao excluir solicitação:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao excluir solicitação.' });
  }
});

router.get('/at/busca-serie', async (req, res) => {
  const termo = String(req.query?.termo || '').trim();
  if (termo.length < 2) {
    return res.status(400).json({ ok: false, error: 'Informe ao menos 2 caracteres para a busca.' });
  }

  const termoNorm = normalizeText(termo);
  const maxResultados = 10;

  try {
    const resultados = [];
    const seen = new Set();
    const fontesComTimeout = [];

    const upsertResultado = (row) => {
      const dedupKey = `${row.numero_serie}|${row.op}|${row.modelo}`;
      const jaExiste = seen.has(dedupKey);

      if (jaExiste) {
        const existente = resultados.find((item) => `${item.numero_serie}|${item.op}|${item.modelo}` === dedupKey);
        if (!existente) return false;
        if (!existente.cliente && row.cliente) existente.cliente = row.cliente;
        if (!existente.nota_fiscal && row.nota_fiscal) existente.nota_fiscal = row.nota_fiscal;
        if (!existente.chave_nfe && row.chave_nfe) existente.chave_nfe = row.chave_nfe;
        if (!existente.data_entrega && row.data_entrega) existente.data_entrega = row.data_entrega;
        if (!existente.teste_tipo_gas && row.teste_tipo_gas) existente.teste_tipo_gas = row.teste_tipo_gas;
        return false;
      }

      if (resultados.length >= maxResultados) return false;
      seen.add(dedupKey);
      resultados.push(row);
      return true;
    };

    for (const sheetName of AT_SERIE_SHEETS) {
      const sheetNameNorm = normalizeText(sheetName);
      let rows = [];
      try {
        rows = await fetchAtSerieSheetRows(sheetName);
      } catch (sheetErr) {
        if (isAbortError(sheetErr)) {
          fontesComTimeout.push(sheetName);
          console.warn(`[SAC/AT] timeout ao consultar aba ${sheetName}; seguindo com próximas fontes.`);
          continue;
        }
        console.warn(`[SAC/AT] falha na aba ${sheetName}; seguindo com próximas fontes:`, sheetErr?.message || sheetErr);
        continue;
      }

      for (const rowObj of rows) {
        const pedido = getValueByHeaderMatch(rowObj, (key) => key.includes('PEDIDO'));
        const ordemProducao = getValueByHeaderMatch(rowObj, (key) => key.includes('ORDEM') && key.includes('PRODUCAO'));
        const modelo = getValueByHeaderMatch(rowObj, (key) => key.includes('MODELO'));
        const revenda = getValueByHeaderMatch(rowObj, (key) => key.includes('REVENDA') || key.includes('CLIENTE'));
        const dataVenda = getValueByHeaderMatch(rowObj, (key) => key.includes('DATA') && key.includes('VENDA'));
        let testeTipoGas = '';

        if (sheetNameNorm.includes('PRODUCAO 2')) {
          testeTipoGas = getValueByHeaderMatch(
            rowObj,
            (key) => key.includes('1REF') && key.includes('FLUIDO') && key.includes('REFRIGERANTE')
          );
        } else if (sheetNameNorm.includes('PRODUCAO 1')) {
          testeTipoGas = getValueByHeaderMatch(
            rowObj,
            (key) => key.includes('REF') && key.includes('FLUIDO') && key.includes('REFRIGERANTE')
          );
        }

        const pedidoNorm = normalizeText(pedido);
        const ordemNorm = normalizeText(ordemProducao);
        if (!pedidoNorm && !ordemNorm) continue;

        let descricao = '';
        if (pedidoNorm.startsWith(termoNorm)) {
          descricao = String(pedido || '').toUpperCase();
        } else if (ordemNorm.startsWith(termoNorm)) {
          descricao = String(ordemProducao || '').toUpperCase();
        } else {
          continue;
        }

        const row = {
          descricao,
          numero_serie: pedido,
          op: ordemProducao,
          modelo,
          revenda,
          data_venda: dataVenda,
          cliente: '',
          nota_fiscal: '',
          chave_nfe: '',
          data_entrega: '',
          teste_tipo_gas: testeTipoGas,
          pedido,
          ordem_producao: ordemProducao,
        };

        upsertResultado(row);
        if (resultados.length >= maxResultados) break;
      }

      if (resultados.length >= maxResultados) break;
    }

    if (resultados.length < maxResultados) {
      try {
        const legacyRows = await fetchLegacySerieRows();
        for (let i = 1; i < legacyRows.length; i++) {
          const row = Array.isArray(legacyRows[i]) ? legacyRows[i] : [];
          const serie = String(row[0] || '').trim();
          const op = String(row[8] || '').trim();
          const modelo = String(row[12] || '').trim();
          const revenda = String(row[2] || '').trim();
          const dataVenda = String(row[22] || '').trim();

          const serieNorm = normalizeText(serie);
          const opNorm = normalizeText(op);
          if (!serieNorm && !opNorm) continue;

          let descricao = '';
          if (serieNorm.startsWith(termoNorm)) {
            descricao = String(serie || '').toUpperCase();
          } else if (opNorm.startsWith(termoNorm)) {
            descricao = String(op || '').toUpperCase();
          } else {
            continue;
          }

          const out = {
            descricao,
            numero_serie: serie,
            op,
            modelo,
            revenda,
            data_venda: dataVenda,
            cliente: '',
            nota_fiscal: '',
            chave_nfe: '',
            data_entrega: '',
            teste_tipo_gas: '',
            pedido: serie,
            ordem_producao: op,
          };

          upsertResultado(out);
          if (resultados.length >= maxResultados) break;
        }
      } catch (legacyErr) {
        if (isAbortError(legacyErr)) {
          fontesComTimeout.push('IMPORTRANGE (legacy)');
          console.warn('[SAC/AT] timeout na planilha legacy; retornando resultados parciais.');
        } else {
          console.warn('[SAC/AT] planilha legacy indisponível para busca de série:', legacyErr?.message || legacyErr);
        }
      }
    }

      if (resultados.length < maxResultados) {
        try {
          const pedidosRows = await fetchPedidosSerieRows();
          for (const rowObj of pedidosRows) {
            const pedido = getValueByHeaderMatch(rowObj, (key) => key.includes('PEDIDO'));
            const ordemProducao = getValueByHeaderMatch(rowObj, (key) => key.includes('ORDEM') && key.includes('PRODUCAO'));
            const modelo = getValueByHeaderMatch(rowObj, (key) => key.includes('MODELO'));
            const revenda = getValueByHeaderMatch(rowObj, (key) => key.includes('REVENDA') || key.includes('CLIENTE'));
            const dataVenda = getValueByHeaderMatch(rowObj, (key) => key.includes('DATA') && key.includes('VENDA'));
            const cliente = getValueByHeaderMatch(rowObj, (key) => key.includes('CLIENTE'));
            const notaFiscal = getValueByHeaderMatch(rowObj, (key) => key.includes('NOTA') && key.includes('FISCAL'));
            const chaveNfe = getValueByHeaderMatch(rowObj, (key) => key.includes('CHAVE') && key.includes('NFE'));
            const dataEntrega = getValueByHeaderMatch(rowObj, (key) => key.includes('DATA') && key.includes('ENTREGA'));

            const pedidoNorm = normalizeText(pedido);
            const ordemNorm = normalizeText(ordemProducao);
            if (!pedidoNorm && !ordemNorm) continue;

            let descricao = '';
            if (pedidoNorm.startsWith(termoNorm)) {
              descricao = String(pedido || '').toUpperCase();
            } else if (ordemNorm.startsWith(termoNorm)) {
              descricao = String(ordemProducao || '').toUpperCase();
            } else {
              continue;
            }

            const out = {
              descricao,
              numero_serie: pedido,
              op: ordemProducao,
              modelo,
              revenda,
              data_venda: dataVenda,
              cliente,
              nota_fiscal: notaFiscal,
              chave_nfe: chaveNfe,
              data_entrega: dataEntrega,
              teste_tipo_gas: '',
              pedido,
              ordem_producao: ordemProducao,
            };

            upsertResultado(out);
            if (resultados.length >= maxResultados) break;
          }
        } catch (pedidosErr) {
          if (isAbortError(pedidosErr)) {
            fontesComTimeout.push('PEDIDOS (gid 1642140396)');
            console.warn('[SAC/AT] timeout na planilha PEDIDOS; retornando resultados parciais.');
          } else {
            console.warn('[SAC/AT] planilha PEDIDOS indisponível para busca de série:', pedidosErr?.message || pedidosErr);
          }
        }
      }

      try {
        const testeGasRows = await fetchTesteGasRows();
        for (const rowObj of testeGasRows) {
          const pedido = getValueByHeaderMatch(rowObj, (key) => key.includes('PEDIDO'));
          const ordemProducao = getValueByHeaderMatch(rowObj, (key) => key.includes('ORDEM') && key.includes('PRODUCAO'));
          const modelo = getValueByHeaderMatch(rowObj, (key) => key.includes('MODELO'));
          const cliente = getValueByHeaderMatch(rowObj, (key) => key.includes('CLIENTE') || key.includes('REVENDA'));
          const testeTipoGas = getValueByHeaderMatch(rowObj, (key) => key.includes('TESTE') && key.includes('TIPO') && key.includes('GAS'));

          const pedidoNorm = normalizeText(pedido);
          const ordemNorm = normalizeText(ordemProducao);
          if (!pedidoNorm && !ordemNorm) continue;

          let descricao = '';
          if (pedidoNorm.startsWith(termoNorm)) {
            descricao = String(pedido || '').toUpperCase();
          } else if (ordemNorm.startsWith(termoNorm)) {
            descricao = String(ordemProducao || '').toUpperCase();
          } else {
            continue;
          }

          const out = {
            descricao,
            numero_serie: pedido,
            op: ordemProducao,
            modelo,
            revenda: cliente,
            data_venda: '',
            cliente,
            nota_fiscal: '',
            chave_nfe: '',
            data_entrega: '',
            teste_tipo_gas: testeTipoGas,
            pedido,
            ordem_producao: ordemProducao,
          };

          upsertResultado(out);
          if (resultados.length >= maxResultados) break;
        }
      } catch (testeGasErr) {
        if (isAbortError(testeGasErr)) {
          fontesComTimeout.push('TESTE/GAS (gid 1333359070)');
          console.warn('[SAC/AT] timeout na planilha TESTE/GAS; retornando resultados parciais.');
        } else {
          console.warn('[SAC/AT] planilha TESTE/GAS indisponível para busca de série:', testeGasErr?.message || testeGasErr);
        }
      }

    // Enriquece resultados com flag ja_existe (registro em sac.at_busca_selecionada)
    if (resultados.length > 0) {
      try {
        const pairs = resultados.filter(r => r.ordem_producao || r.modelo);
        if (pairs.length > 0) {
          const conditions = pairs.map((_, i) => `(s.ordem_producao = $${i * 2 + 1} AND s.modelo = $${i * 2 + 2})`).join(' OR ');
          const params = pairs.flatMap(p => [String(p.ordem_producao || '').trim() || null, String(p.modelo || '').trim() || null]);
          const dbResult = await pool.query(
            `SELECT DISTINCT ON (s.ordem_producao, s.modelo)
               s.ordem_producao, s.modelo, s.id_at,
               a.tipo, a.nome_revenda_cliente, a.numero_telefone, a.cpf_cnpj,
               a.cep, a.bairro, a.cidade, a.estado, a.numero, a.rua,
               a.agendar_atendimento_com,
               a.modelo AS at_modelo,
               a.tag_problema, a.plataforma_atendimento
             FROM sac.at_busca_selecionada s
             JOIN sac.at a ON a.id = s.id_at
             WHERE ${conditions}
             ORDER BY s.ordem_producao, s.modelo, s.id_at DESC`,
            params
          );
          const existMap = new Map();
          for (const row of dbResult.rows) {
            const key = `${row.ordem_producao || ''}|${row.modelo || ''}`;
            existMap.set(key, { id_at: row.id_at, at_data: row });
          }
          for (const r of resultados) {
            const key = `${r.ordem_producao || ''}|${r.modelo || ''}`;
            if (existMap.has(key)) {
              r.ja_existe = true;
              r.id_at = existMap.get(key).id_at;
              r.at_data = existMap.get(key).at_data;
            } else {
              r.ja_existe = false;
            }
          }
        }
      } catch (enrichErr) {
        console.warn('[SAC/AT] falha ao enriquecer resultados com at_busca_selecionada:', enrichErr?.message || enrichErr);
      }
    }

    const payload = { ok: true, rows: resultados };
    if (fontesComTimeout.length) {
      payload.partial = true;
      payload.warning = `Algumas fontes excederam o tempo: ${fontesComTimeout.join(', ')}`;
    }

    return res.json(payload);
  } catch (err) {
    if (isAbortError(err)) {
      return res.status(200).json({ ok: true, rows: [], partial: true, warning: 'Busca parcial por timeout externo.' });
    }
    console.error('[SAC/AT] erro na busca por numero de serie:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao consultar planilha para busca de serie.' });
  }
});

router.get('/at/historico-reclamacao', async (req, res) => {
  const op = String(req.query?.ordem_producao || '').trim();
  const modelo = String(req.query?.modelo || '').trim();

  if (!op && !modelo) {
    return res.json({ ok: true, rows: [] });
  }

  try {
    const result = await pool.query(
      `SELECT a.id, a.data, a.tipo, a.descreva_reclamacao
       FROM sac.at a
       JOIN sac.at_busca_selecionada s ON s.id_at = a.id
       WHERE ($1::text IS NULL OR s.ordem_producao = $1)
         AND ($2::text IS NULL OR s.modelo = $2)
         AND a.descreva_reclamacao IS NOT NULL
         AND trim(a.descreva_reclamacao) != ''
       ORDER BY a.id ASC`,
      [op || null, modelo || null]
    );
    return res.json({ ok: true, rows: result.rows });
  } catch (err) {
    console.error('[SAC/AT] erro ao buscar historico de reclamacao:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao buscar histrico de reclamao.' });
  }
});

// Retorna valores distintos de uma coluna para alimentar combobox no front
router.get('/at/opcoes-campo', async (req, res) => {
  const CAMPOS_PERMITIDOS = ['tag_problema', 'plataforma_atendimento'];
  const campo = String(req.query?.campo || '').trim();
  if (!CAMPOS_PERMITIDOS.includes(campo)) {
    return res.status(400).json({ ok: false, error: 'Campo inválido.' });
  }
  try {
    const result = await pool.query(
      `SELECT DISTINCT "${campo}" AS valor
         FROM sac.at
        WHERE "${campo}" IS NOT NULL AND "${campo}" <> ''
        ORDER BY "${campo}"`
    );
    return res.json({ ok: true, opcoes: result.rows.map(r => r.valor) });
  } catch (err) {
    console.error(`[SAC/AT] erro ao buscar opcoes de ${campo}:`, err);
    return res.status(500).json({ ok: false, error: 'Falha ao buscar opções.' });
  }
});

router.get('/at/cep/:cep', async (req, res) => {
  const cep = String(req.params?.cep || '').replace(/\D/g, '');
  if (cep.length !== 8) {
    return res.status(400).json({ ok: false, error: 'CEP inválido. Informe 8 dígitos.' });
  }

  try {
    const resp = await fetchWithTimeout(`https://viacep.com.br/ws/${cep}/json/`, {
      headers: { Accept: 'application/json' }
    }, 10000);

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data?.erro) {
      return res.status(404).json({ ok: false, error: 'CEP não encontrado.' });
    }

    return res.json({
      ok: true,
      cep: String(data.cep || '').trim(),
      rua: String(data.logradouro || '').trim(),
      bairro: String(data.bairro || '').trim(),
      cidade: String(data.localidade || '').trim(),
      estado: String(data.uf || '').trim(),
    });
  } catch (err) {
    console.error('[SAC/AT] erro ao consultar CEP:', err);
    return res.status(502).json({ ok: false, error: 'Falha ao consultar CEP.' });
  }
});

// ─── AT ANEXOS ───────────────────────────────────────────────────────────────
const AT_BUCKET = BUCKET; // usa o mesmo bucket já existente; arquivos ficam na pasta "at/"
const atUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

function atSanitizeFileName(rawName, ext) {
  const base = String(rawName || '')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  const safe = base || `arquivo.${ext}`;
  return safe.includes('.') ? safe : `${safe}.${ext}`;
}

// GET /at/anexos/:id_at
router.get('/at/anexos/:id_at', async (req, res) => {
  const idAt = parseInt(req.params.id_at, 10);
  if (!Number.isFinite(idAt) || idAt <= 0) return res.status(400).json({ error: 'id_at inválido.' });
  try {
    const { rows } = await pool.query(
      `SELECT id, nome_arquivo, url_publica, content_type, tamanho_bytes, enviado_por, criado_em
         FROM sac.at_anexos WHERE id_at = $1 ORDER BY criado_em ASC`,
      [idAt]
    );
    res.json({ ok: true, anexos: rows });
  } catch (err) {
    console.error('[SAC/AT] erro ao listar anexos:', err);
    res.status(500).json({ error: 'Falha ao listar anexos.' });
  }
});

// POST /at/anexos/:id_at  (multipart: campo "arquivo", múltiplos)
router.post('/at/anexos/:id_at', atUpload.array('arquivo', 20), async (req, res) => {
  const idAt = parseInt(req.params.id_at, 10);
  if (!Number.isFinite(idAt) || idAt <= 0) return res.status(400).json({ error: 'id_at inválido.' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  const usuario = req.session?.user?.fullName || req.session?.user?.username || 'sistema';
  const inseridos = [];

  try {
    for (const file of req.files) {
      const mimeExt = mime.extension(file.mimetype);
      const originalExt = (file.originalname || '').split('.').pop();
      const ext = (mimeExt || originalExt || 'bin').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin';
      const safeName = atSanitizeFileName(file.originalname, ext);
      const pathKey = `at/${idAt}/${uuidv4()}_${safeName}`;

      const { error: upErr } = await supabase.storage.from(AT_BUCKET).upload(pathKey, file.buffer, {
        contentType: file.mimetype || 'application/octet-stream',
        upsert: false
      });
      if (upErr) throw new Error(`Supabase upload: ${upErr.message}`);

      const { data: pubData } = supabase.storage.from(AT_BUCKET).getPublicUrl(pathKey);
      const urlPublica = pubData?.publicUrl || '';

      const ins = await pool.query(
        `INSERT INTO sac.at_anexos (id_at, nome_arquivo, path_key, url_publica, content_type, tamanho_bytes, enviado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, nome_arquivo, url_publica, content_type, tamanho_bytes, criado_em`,
        [idAt, safeName, pathKey, urlPublica, file.mimetype || null, file.size || null, usuario]
      );
      inseridos.push(ins.rows[0]);
    }
    res.json({ ok: true, anexos: inseridos });
  } catch (err) {
    console.error('[SAC/AT] erro ao fazer upload de anexo:', err);
    res.status(500).json({ error: 'Falha no upload.', detail: String(err.message || err) });
  }
});

// DELETE /at/anexos/:id_at/:id_anexo
router.delete('/at/anexos/:id_at/:id_anexo', async (req, res) => {
  const idAt = parseInt(req.params.id_at, 10);
  const idAnexo = parseInt(req.params.id_anexo, 10);
  if (!Number.isFinite(idAt) || idAt <= 0 || !Number.isFinite(idAnexo) || idAnexo <= 0)
    return res.status(400).json({ error: 'Parâmetros inválidos.' });
  try {
    const { rows } = await pool.query(
      `DELETE FROM sac.at_anexos WHERE id = $1 AND id_at = $2 RETURNING path_key`,
      [idAnexo, idAt]
    );
    if (!rows.length) return res.status(404).json({ error: 'Anexo não encontrado.' });
    // tenta remover do storage (não bloqueia em caso de falha)
    supabase.storage.from(AT_BUCKET).remove([rows[0].path_key]).catch(e =>
      console.warn('[SAC/AT] falha ao remover do storage:', e?.message)
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[SAC/AT] erro ao deletar anexo:', err);
    res.status(500).json({ error: 'Falha ao deletar anexo.' });
  }
});

module.exports = router;
