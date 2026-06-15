#!/usr/bin/env node
/* eslint-disable no-console */

// ============================================================================
// Sincroniza fotos de produtos da Omie para Cloudflare R2
// ----------------------------------------------------------------------------
// Fluxo:
//   1. Lista todos os produtos via ListarProdutos (Omie)
//   2. Baixa o conteúdo da URL informada em "url_imagem"
//   3. Faz upload no bucket Supabase (default: produtos) na pasta
//        Fotos_produto/<codigo_produto>/<arquivo>
//   4. Coleta as URLs públicas geradas
//   5. Limpa public.produtos_omie_imagens e insere apenas os novos registros
//
// USO:
//   node scripts/sync_fotos_produtos_supabase.js
//
// VARIÁVEIS DE AMBIENTE:
//   OMIE_APP_KEY, OMIE_APP_SECRET
//   DATABASE_URL
//   R2_* (Cloudflare R2)
//   STORAGE_BUCKET (opcional, default = "produtos")
// ============================================================================

require('dotenv/config');

const path = require('path');
const { dbQuery, dbGetClient } = require('../src/db');
const supabase = require('../utils/supabase');

const OMIE_APP_KEY = process.env.OMIE_APP_KEY || '';
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || '';
const OMIE_PROD_URL = 'https://app.omie.com.br/api/v1/geral/produtos/';
const BUCKET = process.env.STORAGE_BUCKET || process.env.R2_DEFAULT_PREFIX || 'produtos';
const PASTA_BASE = 'Fotos_produto';
const DRY_RUN = String(process.env.DRY_RUN || '').trim() === '1';

const REGISTROS_POR_PAGINA = 100;
const DELAY_PAGINA_MS = 400;
const DELAY_PRODUTO_MS = 80;
const MAX_RETRIES = 3;
const MAX_PAGINAS = Number(process.env.MAX_PAGINAS || 0); // 0 = sem limite

const stats = {
  paginas: 0,
  produtos: 0,
  com_imagem: 0,
  uploads_ok: 0,
  uploads_falha: 0,
  inseridos: 0,
  erros: []
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function logErro(contexto, codigoProduto, msg) {
  stats.erros.push({ contexto, codigo_produto: codigoProduto, mensagem: msg });
  console.error(`   ❌ [${contexto}] codigo_produto=${codigoProduto || '-'} :: ${msg}`);
}

// ----------------------------------------------------------------------------
// Omie
// ----------------------------------------------------------------------------
async function listarProdutosOmie(pagina, tentativa = 1) {
  const body = {
    call: 'ListarProdutos',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      pagina,
      registros_por_pagina: REGISTROS_POR_PAGINA,
      apenas_importado_api: 'N',
      filtrar_apenas_omiepdv: 'N'
    }]
  };

  try {
    const res = await fetch(OMIE_PROD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} - ${await res.text()}`);
    }
    return await res.json();
  } catch (err) {
    if (tentativa < MAX_RETRIES) {
      console.warn(`   ⚠️  Pagina ${pagina} falhou (tentativa ${tentativa}): ${err.message}`);
      await sleep(1500 * tentativa);
      return listarProdutosOmie(pagina, tentativa + 1);
    }
    throw err;
  }
}

// ----------------------------------------------------------------------------
// Helpers para imagens
// ----------------------------------------------------------------------------

// Aceita produto da listagem e devolve um array [{ url, pos }] ordenado
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

async function uploadSupabase(codigoProduto, pos, urlOrigem) {
  const nome = nomeArquivoDaUrl(urlOrigem, pos);
  const pathKey = `${PASTA_BASE}/${codigoProduto}/${nome}`;
  const buffer = await baixarImagem(urlOrigem);

  if (DRY_RUN) {
    return { pathKey, publicUrl: `DRY_RUN://${pathKey}` };
  }

  const { error } = await supabase
    .storage
    .from(BUCKET)
    .upload(pathKey, buffer, {
      contentType: inferirContentType(nome),
      upsert: true
    });
  if (error) throw new Error(`Supabase upload: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathKey);
  return { pathKey, publicUrl: data.publicUrl };
}

// ----------------------------------------------------------------------------
// Pipeline principal
// ----------------------------------------------------------------------------
async function processarProduto(produto, novosRegistros) {
  const codigoProduto = Number(produto.codigo_produto);
  if (!codigoProduto) return;

  const imagens = extrairImagens(produto);
  if (!imagens.length) return;
  stats.com_imagem++;

  for (const img of imagens) {
    try {
      const { pathKey, publicUrl } = await uploadSupabase(codigoProduto, img.pos, img.url);
      novosRegistros.push({
        codigo_produto: codigoProduto,
        pos: img.pos,
        url_imagem: publicUrl,
        path_key: pathKey
      });
      stats.uploads_ok++;
    } catch (err) {
      stats.uploads_falha++;
      logErro('upload', codigoProduto, err.message);
    }
  }
}

async function gravarRegistros(novosRegistros) {
  if (DRY_RUN) {
    console.log(`\n[DRY_RUN] ${novosRegistros.length} registros seriam inseridos. Nada gravado.`);
    return;
  }

  // Filtra apenas codigo_produto que existe em produtos_omie (evita violar FK)
  const codigos = [...new Set(novosRegistros.map((r) => r.codigo_produto))];
  const { rows: existentes } = await dbQuery(
    'SELECT codigo_produto FROM public.produtos_omie WHERE codigo_produto = ANY($1::bigint[])',
    [codigos]
  );
  const setExistentes = new Set(existentes.map((r) => Number(r.codigo_produto)));
  const filtrados = novosRegistros.filter((r) => setExistentes.has(Number(r.codigo_produto)));
  const ignorados = novosRegistros.length - filtrados.length;
  if (ignorados > 0) {
    console.log(`[sync-fotos] Ignorando ${ignorados} registros sem produto correspondente em produtos_omie.`);
  }

  const client = await dbGetClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM public.produtos_omie_imagens');
    for (const reg of filtrados) {
      await client.query(
        `INSERT INTO public.produtos_omie_imagens
            (codigo_produto, pos, url_imagem, path_key, ativo)
         VALUES ($1, $2, $3, $4, true)`,
        [reg.codigo_produto, reg.pos, reg.url_imagem, reg.path_key]
      );
      stats.inseridos++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    console.error('OMIE_APP_KEY/OMIE_APP_SECRET ausentes no ambiente.');
    process.exit(1);
  }

  console.log(`[sync-fotos] bucket=${BUCKET} pasta=${PASTA_BASE} dry_run=${DRY_RUN}`);
  const inicio = Date.now();
  const novosRegistros = [];

  // Primeira página define o total
  const primeira = await listarProdutosOmie(1);
  const totalPaginas = Number(primeira.total_de_paginas || 1);
  const totalRegistros = Number(primeira.total_de_registros || 0);
  const limite = MAX_PAGINAS > 0 ? Math.min(totalPaginas, MAX_PAGINAS) : totalPaginas;
  stats.paginas = limite;
  console.log(`[sync-fotos] ${totalRegistros} produtos em ${totalPaginas} páginas (processando até ${limite})`);

  const processarLote = async (lista) => {
    for (const produto of lista || []) {
      stats.produtos++;
      await processarProduto(produto, novosRegistros);
      await sleep(DELAY_PRODUTO_MS);
    }
  };

  await processarLote(primeira.produto_servico_cadastro);

  for (let p = 2; p <= limite; p++) {
    console.log(`\n📄 Página ${p}/${limite} ...`);
    const lote = await listarProdutosOmie(p);
    await processarLote(lote.produto_servico_cadastro);
    await sleep(DELAY_PAGINA_MS);
  }

  console.log(`\n[sync-fotos] Coletados ${novosRegistros.length} registros para gravar.`);
  await gravarRegistros(novosRegistros);

  const dur = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log('\n=========================================');
  console.log(`Duração:           ${dur}s`);
  console.log(`Produtos lidos:    ${stats.produtos}`);
  console.log(`Com imagem:        ${stats.com_imagem}`);
  console.log(`Uploads OK:        ${stats.uploads_ok}`);
  console.log(`Uploads falha:     ${stats.uploads_falha}`);
  console.log(`Registros gravados:${stats.inseridos}`);
  console.log('=========================================');

  if (stats.erros.length) {
    console.log(`\nErros (${stats.erros.length}):`);
    stats.erros.slice(0, 20).forEach((e) => console.log(' -', e));
    if (stats.erros.length > 20) console.log(` ... +${stats.erros.length - 20} erros`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[sync-fotos] FATAL', err);
    process.exit(1);
  });
