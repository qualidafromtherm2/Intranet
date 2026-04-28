// scripts/backfill_envios_conteudo.js
// Backfill de envios.solicitacoes.conteudo via SEFAZ Paraná.
// Para cada registro com declaracao_url:
//  1) baixa PDF
//  2) extrai chave_dce
//  3) consulta SEFAZ-PR e obtém itens estruturados
//  4) atualiza conteudo (e chave_dce se ausente) somente quando SEFAZ retornar dados
//
// Uso:
//   node scripts/backfill_envios_conteudo.js              # processa todos
//   node scripts/backfill_envios_conteudo.js --ids=148,165,167
//   node scripts/backfill_envios_conteudo.js --dry-run    # não grava

require('dotenv').config();
const { Pool } = require('pg');
const fetch = require('node-fetch');
const pdfParse = require('pdf-parse');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const idsArg = args.find(a => a.startsWith('--ids='));
const onlyIds = idsArg ? idsArg.slice('--ids='.length).split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean) : null;

function extractDceChaveFromPdf(textRaw) {
  const text = String(textRaw || '');
  const matches = [
    text.match(/(?:\d{4}[\s\r\n]+){10}\d{4}/),
    text.match(/chDCe=(\d{44})/i),
    text.match(/CH\s*DCe?[:\s=]+(\d{44})/i),
    text.match(/(?<!\d)(\d{44})(?!\d)/),
  ];
  for (const m of matches) {
    if (m) {
      const c = (m[1] || m[0]).replace(/\s+/g, '');
      if (/^\d{44}$/.test(c)) return c;
    }
  }
  return null;
}

function decodeHtmlEntitiesBasic(s) {
  return String(s || '')
    .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é').replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó').replace(/&uacute;/gi, 'ú').replace(/&atilde;/gi, 'ã')
    .replace(/&otilde;/gi, 'õ').replace(/&acirc;/gi, 'â').replace(/&ecirc;/gi, 'ê')
    .replace(/&ocirc;/gi, 'ô').replace(/&ccedil;/gi, 'ç').replace(/&Aacute;/g, 'Á')
    .replace(/&Eacute;/g, 'É').replace(/&Iacute;/g, 'Í').replace(/&Oacute;/g, 'Ó')
    .replace(/&Uacute;/g, 'Ú').replace(/&Atilde;/g, 'Ã').replace(/&Otilde;/g, 'Õ')
    .replace(/&Acirc;/g, 'Â').replace(/&Ecirc;/g, 'Ê').replace(/&Ocirc;/g, 'Ô')
    .replace(/&Ccedil;/g, 'Ç').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function formatSefazQuantidade(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const num = Number(s.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return '';
  if (Number.isInteger(num)) return String(num);
  return num.toFixed(4).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

async function fetchSefazProdutos(chaveDce, { timeoutMs = 8000 } = {}) {
  if (!/^\d{44}$/.test(String(chaveDce || ''))) return null;
  const url = `https://www.fazenda.pr.gov.br/dce/qrcode?chDCe=${chaveDce}&tpAmb=1`;
  let html = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IntranetSAC-Backfill/1.0)' },
      });
      if (!resp || !resp.ok) return null;
      html = await resp.text();
    } finally { clearTimeout(timer); }
  } catch (e) {
    console.warn('  ! SEFAZ fetch falhou:', e.message || e);
    return null;
  }
  if (!html || !/Detalhamento de Produtos/i.test(html)) return null;

  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<td[^>]*class="fixo-prod-serv-([a-z]+)"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/gi;
  const items = [];
  const seen = new Set();
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    if (!/fixo-prod-serv-descricao/i.test(rowHtml)) continue;
    if (/<label\b/i.test(rowHtml)) continue;
    const cells = {};
    let cellMatch;
    cellRegex.lastIndex = 0;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells[cellMatch[1].toLowerCase()] = decodeHtmlEntitiesBasic(cellMatch[2])
        .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    }
    const conteudo = cells.descricao || '';
    const quantidade = formatSefazQuantidade(cells.qtd || '');
    if (!conteudo || !quantidade) continue;
    const key = `${conteudo.toUpperCase()}::${quantidade}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const item = { conteudo, quantidade };
    if (cells.vu) item.valor_unitario = cells.vu;
    if (cells.vb) item.valor_total = cells.vb;
    if (cells.ncm) item.ncm = cells.ncm;
    items.push(item);
  }
  if (!items.length) return null;
  return JSON.stringify(items);
}

async function downloadPdf(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status}`);
    const buf = await resp.buffer();
    return buf;
  } finally { clearTimeout(timer); }
}

(async () => {
  let where = "declaracao_url IS NOT NULL";
  const params = [];
  if (onlyIds && onlyIds.length) {
    where += ` AND id = ANY($1::int[])`;
    params.push(onlyIds);
  }
  const sql = `SELECT id, chave_dce, declaracao_url, conteudo FROM envios.solicitacoes WHERE ${where} ORDER BY id`;
  const { rows } = await pool.query(sql, params);
  console.log(`Registros candidatos: ${rows.length}${dryRun ? ' (DRY-RUN)' : ''}`);

  let okCount = 0, skipCount = 0, errCount = 0;
  for (const row of rows) {
    const id = row.id;
    try {
      let chave = row.chave_dce && /^\d{44}$/.test(row.chave_dce) ? row.chave_dce : null;
      if (!chave) {
        const buf = await downloadPdf(row.declaracao_url);
        let txt = '';
        try { const p = await pdfParse(buf); txt = String(p?.text || ''); } catch (_) {}
        chave = extractDceChaveFromPdf(txt);
      }
      if (!chave) { console.log(`#${id}: sem chave DCe -> SKIP`); skipCount++; continue; }

      const novoConteudo = await fetchSefazProdutos(chave);
      if (!novoConteudo) { console.log(`#${id}: SEFAZ sem itens (chave ${chave}) -> SKIP`); skipCount++; continue; }

      if (novoConteudo === row.conteudo && row.chave_dce === chave) {
        console.log(`#${id}: já está correto -> SKIP`);
        skipCount++;
        continue;
      }

      if (dryRun) {
        console.log(`#${id}: [DRY] chave=${chave} novoConteudo=${novoConteudo.slice(0, 120)}${novoConteudo.length > 120 ? '...' : ''}`);
      } else {
        await pool.query(
          'UPDATE envios.solicitacoes SET conteudo = $1, chave_dce = COALESCE(chave_dce, $2) WHERE id = $3',
          [novoConteudo, chave, id]
        );
        console.log(`#${id}: OK chave=${chave} itens=${JSON.parse(novoConteudo).length}`);
      }
      okCount++;
    } catch (e) {
      console.error(`#${id}: ERRO`, e.message || e);
      errCount++;
    }
    // pausa curta para não martelar a SEFAZ
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`\nResumo: ok=${okCount} skip=${skipCount} err=${errCount}`);
  await pool.end();
})().catch(e => { console.error('FATAL:', e); pool.end(); process.exit(1); });
