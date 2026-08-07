#!/usr/bin/env node
/* eslint-disable no-console */

// ============================================================================
// Sincroniza fotos da Omie → Cloudflare R2 → produto.produtos_omie_imagens
// ----------------------------------------------------------------------------
// Fluxo:
//   1. Carrega posições de foto já gravadas no banco (por codigo_produto)
//   2. Varre ListarProdutos (Omie) respeitando ≤4 req/s
//   3. Para cada produto com imagem na Omie, baixa só as posições que faltam
//   4. Upload no R2 (Fotos_produto/<codigo_produto>/...) e INSERT no banco
//   5. (opcional) CONSULTAR=1 — ConsultarProduto nos que ainda estão zerados
//
// USO:
//   node scripts/sync_fotos_faltantes_omie.js
//
// VARIÁVEIS:
//   OMIE_APP_KEY, OMIE_APP_SECRET, DATABASE_URL
//   R2_* (Cloudflare R2 via utils/storage)
//   DRY_RUN=1          → simula sem gravar
//   MAX_PRODUTOS=N     → limita quantos produtos receberão upload (0 = todos)
//   CONSULTAR=1        → fase extra ConsultarProduto (lenta; só se Listar não trouxer imagens[])
//   SOMENTE_SEM_FOTO=1 → ignora produtos que já têm alguma foto (só zerados)
//   OMIE_MIN_INTERVAL_MS → intervalo entre calls Omie (default 400, mínimo 300; Omie máx 4/s)
//   FORCE_REIMPORT=1   → rebaixa/reenvia mesmo se já houver foto local (útil quando URL no SQL aponta R2 404)
// ============================================================================

require('dotenv/config');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { dbQuery } = require('../src/db');
const supabase = require('../utils/supabase');

const OMIE_APP_KEY = process.env.OMIE_APP_KEY || '';
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || '';
const OMIE_PROD_URL = 'https://app.omie.com.br/api/v1/geral/produtos/';
const BUCKET = process.env.STORAGE_BUCKET || process.env.R2_DEFAULT_PREFIX || 'produtos';
const PASTA_BASE = 'Fotos_produto';
const DRY_RUN = String(process.env.DRY_RUN || '').trim() === '1';
const MAX_PRODUTOS = Number(process.env.MAX_PRODUTOS || 0);
const CONSULTAR = String(process.env.CONSULTAR || '').trim() === '1';
const SOMENTE_SEM_FOTO = String(process.env.SOMENTE_SEM_FOTO || '').trim() === '1';
const FORCE_REIMPORT = String(process.env.FORCE_REIMPORT || '').trim() === '1';
const REGISTROS_POR_PAGINA = 100;
// Omie: máx. 4 req/s → default 400 ms (~2.5/s) com margem; override via OMIE_MIN_INTERVAL_MS
const OMIE_MIN_INTERVAL_MS = Math.max(300, Number(process.env.OMIE_MIN_INTERVAL_MS || 400) || 400);
const LOCK_FILE = path.join(os.tmpdir(), 'sync_fotos_faltantes_omie.lock');
const MAX_RETRIES = 5;

const stats = {
  produtos_omie_com_imagem: 0,
  produtos_com_gap: 0,
  posicoes_faltantes: 0,
  uploads_ok: 0,
  uploads_falha: 0,
  inseridos: 0,
  consultas_ok: 0,
  paginas: 0,
  erros: []
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let omieQueue = Promise.resolve();
let lastOmieAt = 0;

function aguardarVagaOmie() {
  omieQueue = omieQueue.then(async () => {
    const agora = Date.now();
    const espera = lastOmieAt + OMIE_MIN_INTERVAL_MS - agora;
    if (espera > 0) await sleep(espera);
    lastOmieAt = Date.now();
  });
  return omieQueue;
}

function adquirirLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = Number(fs.readFileSync(LOCK_FILE, 'utf8').trim());
    if (pid) {
      try {
        process.kill(pid, 0);
        console.error(`[sync-fotos-faltantes] Já em execução (PID ${pid}). Aguarde terminar.`);
        process.exit(1);
      } catch (_) {
        /* lock antigo */
      }
    }
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  const liberar = () => { try { fs.unlinkSync(LOCK_FILE); } catch (_) {} };
  process.on('exit', liberar);
  process.on('SIGINT', () => { liberar(); process.exit(130); });
  process.on('SIGTERM', () => { liberar(); process.exit(143); });
}

function logErro(contexto, codigoProduto, msg) {
  stats.erros.push({ contexto, codigo_produto: codigoProduto, mensagem: msg });
  console.error(`   ❌ [${contexto}] codigo_produto=${codigoProduto || '-'} :: ${msg}`);
}

/** @returns {Map<string, { codigo: string, posicoes: Set<number> }>} */
async function carregarEstadoLocal() {
  const { rows: produtos } = await dbQuery(`
    SELECT codigo_produto::text AS id, COALESCE(codigo, '') AS codigo
    FROM produto.produtos_omie
  `);

  const map = new Map();
  for (const r of produtos) {
    map.set(String(r.id), { codigo: String(r.codigo || ''), posicoes: new Set() });
  }

  const { rows: imgs } = await dbQuery(`
    SELECT codigo_produto::text AS id, pos
    FROM produto.produtos_omie_imagens
    WHERE ativo IS DISTINCT FROM false
      AND url_imagem IS NOT NULL
      AND TRIM(url_imagem) <> ''
  `);

  for (const r of imgs) {
    const rec = map.get(String(r.id));
    if (rec) rec.posicoes.add(Number(r.pos));
  }

  return map;
}

async function omiePost(call, param, tentativa = 1) {
  await aguardarVagaOmie();
  try {
    const res = await fetch(OMIE_PROD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call,
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [param]
      })
    });
    const text = await res.text();
    if (!res.ok) {
      const redundant = text.match(/Aguarde (\d+) segundos/i);
      if (redundant && tentativa <= MAX_RETRIES) {
        const waitSec = Number(redundant[1] || 60) + 3;
        console.warn(`   ⏳ Omie rate limit (${call}) — aguardando ${waitSec}s...`);
        await sleep(waitSec * 1000);
        return omiePost(call, param, tentativa + 1);
      }
      if (res.status === 429 && tentativa <= MAX_RETRIES) {
        const waitSec = 30 * tentativa;
        console.warn(`   ⏳ Omie 429 (${call}) — aguardando ${waitSec}s...`);
        await sleep(waitSec * 1000);
        return omiePost(call, param, tentativa + 1);
      }
      const misuse = text.match(/Tente novamente em (\d+) segundos/i);
      if (misuse) {
        const waitSec = Number(misuse[1] || 1800);
        const err = new Error(`API Omie bloqueada por ${waitSec}s (MISUSE). Aguarde e rode de novo.`);
        err.omieBlockedSec = waitSec;
        throw err;
      }
      throw new Error(`HTTP ${res.status} - ${text}`);
    }
    return JSON.parse(text);
  } catch (err) {
    if (err.omieBlockedSec) throw err;
    if (tentativa < MAX_RETRIES && !String(err.message || '').includes('Aguarde')) {
      await sleep(1200 * tentativa);
      return omiePost(call, param, tentativa + 1);
    }
    throw err;
  }
}

function extrairImagens(produto) {
  const arr = [];
  if (Array.isArray(produto.imagens)) {
    produto.imagens.forEach((img, idx) => {
      const url = String(img?.url_imagem || img?.url || '').trim();
      if (url) arr.push({ url, pos: idx });
    });
  }
  if (!arr.length) {
    const principal = String(produto.url_imagem || '').trim();
    if (principal) arr.push({ url: principal, pos: 0 });
  }
  return arr;
}

function nomeArquivoDaUrl(url, fallbackPos) {
  try {
    const u = new URL(url);
    const base = path.basename(u.pathname);
    if (base && /\.[a-zA-Z0-9]+$/.test(base)) return base;
    if (base) return `${base}.jpg`;
  } catch (_) { /* ignore */ }
  return `imagem_${fallbackPos}.jpg`;
}

function inferirContentType(nomeArquivo) {
  const ext = (path.extname(nomeArquivo) || '').toLowerCase().replace('.', '');
  switch (ext) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png':  return 'image/png';
    case 'gif':  return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp':  return 'image/bmp';
    case 'svg':  return 'image/svg+xml';
    default:     return 'application/octet-stream';
  }
}

async function baixarImagem(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar imagem`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('Imagem vazia');
  return buf;
}

async function uploadR2(codigoProduto, pos, urlOrigem) {
  const nome = nomeArquivoDaUrl(urlOrigem, pos);
  const pathKey = `${PASTA_BASE}/${codigoProduto}/${nome}`;
  const buffer = await baixarImagem(urlOrigem);

  if (DRY_RUN) {
    return { pathKey, publicUrl: `DRY_RUN://${pathKey}` };
  }

  const { error } = await supabase.storage.from(BUCKET).upload(pathKey, buffer, {
    contentType: inferirContentType(nome),
    upsert: true
  });
  if (error) throw new Error(`R2 upload: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathKey);
  return { pathKey, publicUrl: data.publicUrl };
}

async function inserirImagem(reg) {
  if (DRY_RUN) {
    stats.inseridos++;
    return;
  }

  await dbQuery(
    `INSERT INTO produto.produtos_omie_imagens
       (codigo_produto, pos, url_imagem, path_key, ativo, visivel_producao, visivel_assistencia_tecnica)
     VALUES ($1::bigint, $2, $3, $4, true, true, true)
     ON CONFLICT (codigo_produto, pos) WHERE (ativo IS TRUE)
     DO UPDATE SET
       url_imagem = EXCLUDED.url_imagem,
       path_key   = EXCLUDED.path_key`,
    [reg.codigo_produto, reg.pos, reg.url_imagem, reg.path_key]
  );
  stats.inseridos++;
}

function imagensFaltantes(estadoLocal, codigoProduto, imagensOmie) {
  const rec = estadoLocal.get(String(codigoProduto));
  if (!rec) return []; // produto ainda não está em produtos_omie
  if (FORCE_REIMPORT) return imagensOmie.slice();
  if (SOMENTE_SEM_FOTO && rec.posicoes.size > 0) return [];

  return imagensOmie.filter((img) => !rec.posicoes.has(Number(img.pos)));
}

async function processarImagensProduto(estadoLocal, codigoProduto, codigo, imagensOmie) {
  const faltam = imagensFaltantes(estadoLocal, codigoProduto, imagensOmie);
  if (!faltam.length) return false;

  stats.produtos_com_gap++;
  stats.posicoes_faltantes += faltam.length;

  let okAlguma = false;
  const rec = estadoLocal.get(String(codigoProduto));

  for (const img of faltam) {
    if (MAX_PRODUTOS > 0 && stats.uploads_ok >= MAX_PRODUTOS) break;
    try {
      const { pathKey, publicUrl } = await uploadR2(codigoProduto, img.pos, img.url);
      await inserirImagem({
        codigo_produto: codigoProduto,
        pos: img.pos,
        url_imagem: publicUrl,
        path_key: pathKey
      });
      if (rec) rec.posicoes.add(Number(img.pos));
      stats.uploads_ok++;
      okAlguma = true;
      console.log(`   ✅ ${codigo || codigoProduto} pos=${img.pos} → R2`);
    } catch (err) {
      stats.uploads_falha++;
      logErro('upload', codigoProduto, err.message);
    }
  }
  return okAlguma;
}

async function faseListarProdutos(estadoLocal) {
  const primeira = await omiePost('ListarProdutos', {
    pagina: 1,
    registros_por_pagina: REGISTROS_POR_PAGINA,
    apenas_importado_api: 'N',
    filtrar_apenas_omiepdv: 'N'
  });

  const totalPaginas = Number(primeira.total_de_paginas || 1);
  const totalRegistros = Number(primeira.total_de_registros || 0);
  stats.paginas = totalPaginas;
  console.log(`\n═══ FASE 1 — ListarProdutos ═══`);
  console.log(`Omie: ${totalRegistros} produtos em ${totalPaginas} páginas\n`);

  const processarLote = async (lista) => {
    for (const produto of lista || []) {
      if (MAX_PRODUTOS > 0 && stats.uploads_ok >= MAX_PRODUTOS) return;

      const codigoProduto = String(produto.codigo_produto || '');
      if (!codigoProduto || !estadoLocal.has(codigoProduto)) continue;

      const imagens = extrairImagens(produto);
      if (!imagens.length) continue;

      stats.produtos_omie_com_imagem++;
      await processarImagensProduto(
        estadoLocal,
        codigoProduto,
        produto.codigo,
        imagens
      );
    }
  };

  console.log(`   página 1/${totalPaginas}`);
  await processarLote(primeira.produto_servico_cadastro);

  for (let p = 2; p <= totalPaginas; p++) {
    if (MAX_PRODUTOS > 0 && stats.uploads_ok >= MAX_PRODUTOS) break;
    console.log(
      `   página ${p}/${totalPaginas} | gaps: ${stats.produtos_com_gap} | uploads: ${stats.uploads_ok}`
    );
    const lote = await omiePost('ListarProdutos', {
      pagina: p,
      registros_por_pagina: REGISTROS_POR_PAGINA,
      apenas_importado_api: 'N',
      filtrar_apenas_omiepdv: 'N'
    });
    await processarLote(lote.produto_servico_cadastro);
  }
}

async function faseConsultarProduto(estadoLocal) {
  const zerados = [...estadoLocal.entries()]
    .filter(([, rec]) => rec.posicoes.size === 0)
    .map(([id, rec]) => [id, rec.codigo]);

  if (!zerados.length) return;

  console.log(`\n═══ FASE 2 — ConsultarProduto (${zerados.length} sem foto local) ═══\n`);

  for (let i = 0; i < zerados.length; i++) {
    if (MAX_PRODUTOS > 0 && stats.uploads_ok >= MAX_PRODUTOS) break;

    const [codigoProduto, codigo] = zerados[i];
    const atual = i + 1;
    if (atual === 1 || atual % 50 === 0 || atual === zerados.length) {
      console.log(`   ${atual}/${zerados.length} | uploads: ${stats.uploads_ok}`);
    }

    const chave = codigo || codigoProduto;
    try {
      const detalhe = await omiePost('ConsultarProduto', { codigo: chave });
      const imagens = extrairImagens(detalhe);
      if (!imagens.length) continue;
      stats.consultas_ok++;
      await processarImagensProduto(estadoLocal, codigoProduto, codigo, imagens);
    } catch (err) {
      if (err.omieBlockedSec) throw err;
      logErro('consultar', codigoProduto, err.message);
    }
  }
}

async function main() {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    console.error('OMIE_APP_KEY/OMIE_APP_SECRET ausentes.');
    process.exit(1);
  }

  adquirirLock();

  const inicio = Date.now();
  const estadoLocal = await carregarEstadoLocal();

  let comFoto = 0;
  let semFoto = 0;
  for (const rec of estadoLocal.values()) {
    if (rec.posicoes.size > 0) comFoto++;
    else semFoto++;
  }

  console.log(`[sync-fotos-faltantes] bucket=${BUCKET} dry_run=${DRY_RUN}`);
  console.log(`[sync-fotos-faltantes] Rate Omie: 1 req / ${OMIE_MIN_INTERVAL_MS}ms (máx ~${(1000 / OMIE_MIN_INTERVAL_MS).toFixed(1)}/s)`);
  console.log(`[sync-fotos-faltantes] Produtos locais: ${estadoLocal.size} (com foto: ${comFoto}, sem foto: ${semFoto})`);
  console.log(`[sync-fotos-faltantes] Modo: ${FORCE_REIMPORT ? 'FORCE_REIMPORT' : (SOMENTE_SEM_FOTO ? 'só zerados' : 'gaps de posição + zerados')} | CONSULTAR=${CONSULTAR}`);

  await faseListarProdutos(estadoLocal);

  if (CONSULTAR) {
    await faseConsultarProduto(estadoLocal);
  } else {
    console.log('\n(Fase ConsultarProduto pulada — use CONSULTAR=1 se precisar.)');
  }

  const dur = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log('\n=========================================');
  console.log(`Duração:                 ${dur}s`);
  console.log(`Omie c/ imagem (vistos):  ${stats.produtos_omie_com_imagem}`);
  console.log(`Produtos com gap:         ${stats.produtos_com_gap}`);
  console.log(`Posições faltantes:       ${stats.posicoes_faltantes}`);
  console.log(`Uploads OK:               ${stats.uploads_ok}`);
  console.log(`Uploads falha:            ${stats.uploads_falha}`);
  console.log(`Registros gravados:       ${stats.inseridos}`);
  console.log(`Consultas c/ imagem:      ${stats.consultas_ok}`);
  console.log('=========================================');

  if (stats.erros.length) {
    console.log(`\nErros (${stats.erros.length}, mostrando 15):`);
    stats.erros.slice(0, 15).forEach((e) => console.log(' -', e));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    if (err.omieBlockedSec) {
      const min = Math.ceil(err.omieBlockedSec / 60);
      console.error(`\n🛑 API Omie bloqueada. Aguarde ~${min} min e rode de novo:`);
      console.error('   node scripts/sync_fotos_faltantes_omie.js\n');
    } else {
      console.error('[sync-fotos-faltantes] FATAL', err);
    }
    process.exit(1);
  });
