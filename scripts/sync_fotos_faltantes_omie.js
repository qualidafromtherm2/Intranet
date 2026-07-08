#!/usr/bin/env node
/* eslint-disable no-console */

// ============================================================================
// Sincroniza fotos SOMENTE de produtos sem imagem no R2/banco
// ----------------------------------------------------------------------------
// Fluxo:
//   1. Lista codigo_produto sem foto em public.produtos_omie_imagens
//   2. Varre ListarProdutos (Omie) e, para os faltantes com imagem, faz upload R2
//   3. Insere em public.produtos_omie_imagens (sem apagar registros existentes)
//   4. Fase 2: ConsultarProduto nos que ainda faltam (caso a listagem não traga imagem)
//
// USO:
//   node scripts/sync_fotos_faltantes_omie.js
//
// VARIÁVEIS:
//   OMIE_APP_KEY, OMIE_APP_SECRET, DATABASE_URL
//   R2_* (Cloudflare R2 via utils/storage)
//   DRY_RUN=1          → simula sem gravar
//   MAX_PRODUTOS=N     → limita quantos faltantes processar (0 = todos)
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
const REGISTROS_POR_PAGINA = 100;
// Omie: máx. 4 req/s → intervalo mínimo 250 ms; usamos 300 ms com margem
const OMIE_MIN_INTERVAL_MS = 300;
const LOCK_FILE = path.join(os.tmpdir(), 'sync_fotos_faltantes_omie.lock');
const MAX_RETRIES = 5;

const stats = {
  faltantes_inicio: 0,
  paginas: 0,
  omie_com_imagem: 0,
  uploads_ok: 0,
  uploads_falha: 0,
  inseridos: 0,
  consultas_ok: 0,
  ainda_sem_foto: 0,
  erros: []
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fila global: no máximo 1 chamada Omie a cada 300 ms (≈3,3 req/s)
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

async function carregarFaltantes() {
  const { rows } = await dbQuery(`
    SELECT p.codigo_produto, p.codigo
    FROM public.produtos_omie p
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.produtos_omie_imagens i
      WHERE i.codigo_produto = p.codigo_produto
        AND i.ativo IS DISTINCT FROM false
        AND i.url_imagem IS NOT NULL
        AND TRIM(i.url_imagem) <> ''
    )
    ORDER BY p.codigo_produto
  `);

  const map = new Map();
  for (const r of rows) {
    map.set(Number(r.codigo_produto), String(r.codigo || ''));
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
    `INSERT INTO public.produtos_omie_imagens
       (codigo_produto, pos, url_imagem, path_key, ativo)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (codigo_produto, pos) WHERE (ativo IS TRUE)
     DO UPDATE SET
       url_imagem = EXCLUDED.url_imagem,
       path_key   = EXCLUDED.path_key`,
    [reg.codigo_produto, reg.pos, reg.url_imagem, reg.path_key]
  );
  stats.inseridos++;
}

async function processarImagensProduto(codigoProduto, imagens) {
  if (!imagens.length) return false;

  let okAlguma = false;
  for (const img of imagens) {
    try {
      const { pathKey, publicUrl } = await uploadR2(codigoProduto, img.pos, img.url);
      await inserirImagem({
        codigo_produto: codigoProduto,
        pos: img.pos,
        url_imagem: publicUrl,
        path_key: pathKey
      });
      stats.uploads_ok++;
      okAlguma = true;
    } catch (err) {
      stats.uploads_falha++;
      logErro('upload', codigoProduto, err.message);
    }
  }
  return okAlguma;
}

async function faseListarProdutos(faltantes) {
  const primeira = await omiePost('ListarProdutos', {
    pagina: 1,
    registros_por_pagina: REGISTROS_POR_PAGINA,
    apenas_importado_api: 'N',
    filtrar_apenas_omiepdv: 'N'
  });

  const totalPaginas = Number(primeira.total_de_paginas || 1);
  const totalRegistros = Number(primeira.total_de_registros || 0);
  stats.paginas = totalPaginas;
  console.log(`\n═══ FASE 1/2 — ListarProdutos ═══`);
  console.log(`Omie: ${totalRegistros} produtos em ${totalPaginas} páginas`);
  console.log(`Sem foto no banco: ${faltantes.size}\n`);

  const processarLote = async (lista) => {
    for (const produto of lista || []) {
      const codigoProduto = Number(produto.codigo_produto);
      if (!codigoProduto || !faltantes.has(codigoProduto)) continue;
      if (MAX_PRODUTOS > 0 && stats.uploads_ok >= MAX_PRODUTOS) return;

      const imagens = extrairImagens(produto);
      if (!imagens.length) continue;

      stats.omie_com_imagem++;
      const ok = await processarImagensProduto(codigoProduto, imagens);
      if (ok) {
        faltantes.delete(codigoProduto);
        console.log(`   ✅ foto importada: ${produto.codigo || codigoProduto} (total fotos novas: ${stats.uploads_ok})`);
      }
    }
  };

  console.log(`   Fase 1 — página 1/${totalPaginas}`);
  await processarLote(primeira.produto_servico_cadastro);

  for (let p = 2; p <= totalPaginas; p++) {
    if (MAX_PRODUTOS > 0 && stats.uploads_ok >= MAX_PRODUTOS) break;
    if (!faltantes.size) break;

    console.log(`   Fase 1 — página ${p}/${totalPaginas} | sem foto: ${faltantes.size} | fotos novas: ${stats.uploads_ok}`);
    const lote = await omiePost('ListarProdutos', {
      pagina: p,
      registros_por_pagina: REGISTROS_POR_PAGINA,
      apenas_importado_api: 'N',
      filtrar_apenas_omiepdv: 'N'
    });
    await processarLote(lote.produto_servico_cadastro);
  }
}

async function faseConsultarProduto(faltantes) {
  if (!faltantes.size) return;
  if (MAX_PRODUTOS > 0 && stats.uploads_ok >= MAX_PRODUTOS) return;

  const lista = [...faltantes.entries()];
  const totalFase2 = lista.length;
  const LOG_CADA = 50;

  console.log(`\n═══ FASE 2/2 — ConsultarProduto ═══`);
  console.log(`Consultando ${totalFase2} produtos sem foto...\n`);

  for (let i = 0; i < lista.length; i++) {
    if (MAX_PRODUTOS > 0 && stats.uploads_ok >= MAX_PRODUTOS) break;

    const [codigoProduto, codigo] = lista[i];
    const atual = i + 1;

    if (atual === 1 || atual % LOG_CADA === 0 || atual === totalFase2) {
      console.log(`   ${atual}/${totalFase2} | fotos novas: ${stats.uploads_ok} | sem foto: ${faltantes.size}`);
    }

    const chave = codigo || String(codigoProduto);
    try {
      const detalhe = await omiePost('ConsultarProduto', { codigo: chave });
      const imagens = extrairImagens(detalhe);
      if (!imagens.length) continue;

      stats.consultas_ok++;
      const ok = await processarImagensProduto(codigoProduto, imagens);
      if (ok) {
        faltantes.delete(codigoProduto);
        console.log(`   ✅ ${atual}/${totalFase2} — foto importada: ${codigo} (total: ${stats.uploads_ok})`);
      }
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
  const faltantes = await carregarFaltantes();
  stats.faltantes_inicio = faltantes.size;

  const estimativaOmieSec = Math.ceil((32 + faltantes.size) * OMIE_MIN_INTERVAL_MS / 1000);
  console.log(`[sync-fotos-faltantes] bucket=${BUCKET} dry_run=${DRY_RUN}`);
  console.log(`[sync-fotos-faltantes] Rate Omie: 1 req / ${OMIE_MIN_INTERVAL_MS}ms (máx ~3,3/s)`);
  console.log(`[sync-fotos-faltantes] Tempo estimado só API Omie: ~${Math.ceil(estimativaOmieSec / 60)} min`);
  console.log(`[sync-fotos-faltantes] Produtos sem foto: ${faltantes.size}`);

  if (!faltantes.size) {
    console.log('Nada a fazer.');
    process.exit(0);
  }

  await faseListarProdutos(faltantes);
  await faseConsultarProduto(faltantes);

  stats.ainda_sem_foto = faltantes.size;

  const dur = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log('\n=========================================');
  console.log(`Duração:              ${dur}s`);
  console.log(`Sem foto (início):    ${stats.faltantes_inicio}`);
  console.log(`Omie c/ imagem:       ${stats.omie_com_imagem}`);
  console.log(`Consultas c/ imagem:  ${stats.consultas_ok}`);
  console.log(`Uploads OK:           ${stats.uploads_ok}`);
  console.log(`Uploads falha:        ${stats.uploads_falha}`);
  console.log(`Registros gravados:   ${stats.inseridos}`);
  console.log(`Ainda sem foto:       ${stats.ainda_sem_foto}`);
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
