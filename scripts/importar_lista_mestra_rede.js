#!/usr/bin/env node
/**
 * Importa documentos da rede (SMB) para Cloudflare R2 e atualiza qualidade.lista_mestra
 *
 * Uso:
 *   node scripts/importar_lista_mestra_rede.js [caminho-base]
 *   DRY_RUN=1 node scripts/importar_lista_mestra_rede.js
 *   FORCE=1 node scripts/importar_lista_mestra_rede.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { dbQuery, pool } = require('../src/db');
const { uploadPublicFile } = require('../utils/storage');

const LISTA_MESTRA_BUCKET = process.env.QUALIDADE_LISTA_MESTRA_BUCKET || 'Manuais';
const LISTA_MESTRA_PREFIX = process.env.QUALIDADE_LISTA_MESTRA_PREFIX || 'documentos internos';
const DRY_RUN = ['1', 'true', 'yes'].includes(String(process.env.DRY_RUN || '').toLowerCase());
const FORCE = ['1', 'true', 'yes'].includes(String(process.env.FORCE || '').toLowerCase());

// Código no arquivo da rede → código normalizado no banco
const CODIGO_REDE_PARA_DB = {
  'FT-M07-MPTNC': 'FT-M07-MATNC',
};

const DEFAULT_BASE = '/run/user/1000/gvfs/smb-share:server=192.168.30.100,share=e/5 - QUALIDADE/1-DOCUMENTOS ORIGINAIS';
const EXTENSOES = new Set(['.xlsx', '.xls', '.xlsm', '.pdf', '.docx', '.doc', '.pptx', '.pub', '.ppt']);

function normalizarCodigo(valor) {
  return String(valor || '').toUpperCase().replace(/\s+/g, '').trim();
}

function formatarRevisao(valor) {
  const digits = String(valor || '0').replace(/\D/g, '');
  const n = Number.parseInt(digits || '0', 10);
  return String(Number.isFinite(n) ? n : 0).padStart(2, '0');
}

function sanitizarNumeroFormulario(valor) {
  return String(valor || '').trim().replace(/[\\/]+/g, '-');
}

function montarNomeArquivo(numeroFormulario, numeroRevisao, ext) {
  const base = sanitizarNumeroFormulario(numeroFormulario);
  const rev = formatarRevisao(numeroRevisao);
  return `${base}_REV${rev}${ext}`;
}

function montarCaminhoArquivo(numeroFormulario, nomeArquivo) {
  return `${LISTA_MESTRA_PREFIX}/${sanitizarNumeroFormulario(numeroFormulario)}/${nomeArquivo}`;
}

function extrairCodigoDoArquivo(fileName) {
  const base = path.basename(fileName);
  if (base.startsWith('~$')) return null;
  const semExt = base.replace(/\.[^.]+$/, '');

  if (semExt.includes(' - ')) {
    return semExt.split(' - ')[0].trim();
  }

  const comEspaco = semExt.match(/^((?:FT|FR)(?:-[A-Z0-9]+){2,4})\s/i);
  if (comEspaco) return comEspaco[1].trim();

  return semExt.trim();
}

function encontrarRegistroPorArquivo(fileName, mapaDb) {
  const codigo = extrairCodigoDoArquivo(fileName);
  if (!codigo) return null;

  const chaveDireta = normalizarCodigo(codigo);
  const chaveDb = CODIGO_REDE_PARA_DB[chaveDireta] || chaveDireta;
  if (mapaDb.has(chaveDb)) {
    return { reg: mapaDb.get(chaveDb), chave: chaveDb };
  }

  const normFull = normalizarCodigo(path.basename(fileName).replace(/\.[^.]+$/, ''));
  let melhor = null;
  for (const [chave, reg] of mapaDb) {
    if (normFull.startsWith(chave)) {
      if (!melhor || chave.length > melhor.chave.length) {
        melhor = { reg, chave };
      }
    }
  }
  return melhor;
}

function extrairModuloPasta(numeroFormulario) {
  const m = String(numeroFormulario || '').match(/M(\d{2})/i);
  return m ? `M${m[1]}` : null;
}

function pontuarArquivo(filePath) {
  const lower = filePath.toLowerCase();
  const nome = path.basename(filePath).toLowerCase();
  let score = 0;

  if (lower.includes('arquivo morto')) score -= 100;
  if (lower.includes('obsoleto')) score -= 100;
  if (nome.includes('errado')) score -= 80;
  if (nome.includes('versao') || nome.includes('versão')) score -= 40;
  if (nome.includes('copia') || nome.includes('cópia')) score -= 20;
  if (lower.includes('/m10 - procedimento/01- arquivo morto/')) score -= 90;

  const matchModulo = lower.match(/\/(m\d{2})\s-/i);
  if (matchModulo && !lower.includes('arquivo morto')) score += 50;

  if (nome.endsWith('.xlsx') || nome.endsWith('.docx') || nome.endsWith('.pdf')) score += 10;
  if (nome.endsWith('.xlsm')) score += 2;

  try {
    const stat = fs.statSync(filePath);
    score += Math.min(stat.mtimeMs / 1e12, 5);
  } catch (_) {}

  return score;
}

function listarArquivosRecursivo(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listarArquivosRecursivo(full, acc);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('~$')) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!EXTENSOES.has(ext)) continue;
    acc.push(full);
  }
  return acc;
}

async function ensureSchema() {
  await dbQuery(`ALTER TABLE qualidade.lista_mestra ADD COLUMN IF NOT EXISTS documento TEXT`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS qualidade.lista_mestra_historico (
      id SERIAL PRIMARY KEY,
      lista_mestra_id INTEGER NOT NULL REFERENCES qualidade.lista_mestra(id) ON DELETE CASCADE,
      numero_revisao TEXT NOT NULL,
      documento TEXT NOT NULL,
      documento_path TEXT,
      descricao_alteracao TEXT,
      inserido_por TEXT NOT NULL,
      inserido_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function main() {
  const baseDir = process.argv[2] || DEFAULT_BASE;
  if (!fs.existsSync(baseDir)) {
    console.error('Pasta não encontrada:', baseDir);
    console.error('Monte o compartilhamento SMB ou informe o caminho local.');
    process.exit(1);
  }

  await ensureSchema();

  const { rows: registros } = await dbQuery(
    `SELECT id, numero_formulario, numero_revisao, documento, descricao
       FROM qualidade.lista_mestra
      ORDER BY numero_formulario`
  );

  const mapaDb = new Map();
  for (const row of registros) {
    mapaDb.set(normalizarCodigo(row.numero_formulario), row);
  }

  const arquivos = listarArquivosRecursivo(baseDir);
  const candidatosPorCodigo = new Map();

  for (const filePath of arquivos) {
    const match = encontrarRegistroPorArquivo(filePath, mapaDb);
    if (!match) continue;
    const chave = match.chave;

    const atual = candidatosPorCodigo.get(chave) || [];
    atual.push({ filePath, codigoExtraido: match.reg.numero_formulario, score: pontuarArquivo(filePath) });
    candidatosPorCodigo.set(chave, atual);
  }

  const resultado = {
    dry_run: DRY_RUN,
    base: baseDir,
    total_registros_db: registros.length,
    enviados: [],
    ignorados_ja_tinham_arquivo: [],
    sem_arquivo_na_rede: [],
    erros: [],
    arquivos_rede_nao_mapeados: []
  };

  for (const row of registros) {
    const chave = normalizarCodigo(row.numero_formulario);
    const candidatos = (candidatosPorCodigo.get(chave) || []).sort((a, b) => b.score - a.score);

    if (!candidatos.length) {
      resultado.sem_arquivo_na_rede.push({
        numero_formulario: row.numero_formulario,
        descricao: row.descricao,
        modulo_esperado: extrairModuloPasta(row.numero_formulario)
      });
      continue;
    }

    if (row.documento && !FORCE) {
      resultado.ignorados_ja_tinham_arquivo.push({
        numero_formulario: row.numero_formulario,
        documento: row.documento
      });
      continue;
    }

    const escolhido = candidatos[0];
    const ext = path.extname(escolhido.filePath).toLowerCase() || '.pdf';
    const numeroRevisao = formatarRevisao(row.numero_revisao);
    const nomeDestino = montarNomeArquivo(row.numero_formulario, numeroRevisao, ext);
    const caminhoDestino = montarCaminhoArquivo(row.numero_formulario, nomeDestino);

    try {
      if (DRY_RUN) {
        resultado.enviados.push({
          numero_formulario: row.numero_formulario,
          origem: escolhido.filePath,
          destino: caminhoDestino,
          revisao: numeroRevisao,
          dry_run: true
        });
        continue;
      }

      const buffer = fs.readFileSync(escolhido.filePath);
      const contentType = mime.lookup(ext) || 'application/octet-stream';
      const { url, path: savedPath } = await uploadPublicFile(
        LISTA_MESTRA_BUCKET,
        caminhoDestino,
        buffer,
        { contentType, upsert: FORCE }
      );

      await dbQuery(
        `INSERT INTO qualidade.lista_mestra_historico
          (lista_mestra_id, numero_revisao, documento, documento_path, descricao_alteracao, inserido_por)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          row.id,
          numeroRevisao,
          url,
          savedPath,
          `Importação automática da rede: ${path.basename(escolhido.filePath)}`,
          'importacao_rede'
        ]
      );

      await dbQuery(
        `UPDATE qualidade.lista_mestra
            SET documento = $1, atualizado_em = NOW()
          WHERE id = $2`,
        [url, row.id]
      );

      resultado.enviados.push({
        numero_formulario: row.numero_formulario,
        origem: escolhido.filePath,
        destino: caminhoDestino,
        url,
        revisao: numeroRevisao
      });
    } catch (err) {
      resultado.erros.push({
        numero_formulario: row.numero_formulario,
        origem: escolhido.filePath,
        erro: String(err?.message || err)
      });
    }
  }

  // Arquivos FT/FR na rede que não estão na lista mestra (amostra útil para revisão manual)
  const vistos = new Set();
  for (const filePath of arquivos) {
    const match = encontrarRegistroPorArquivo(filePath, mapaDb);
    if (match) continue;
    const codigo = extrairCodigoDoArquivo(filePath);
    if (!codigo || !/^(FT|FR)-/i.test(codigo)) continue;
    const chave = normalizarCodigo(codigo);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    resultado.arquivos_rede_nao_mapeados.push({
      codigo_extraido: codigo,
      exemplo_arquivo: filePath
    });
  }
  resultado.arquivos_rede_nao_mapeados.sort((a, b) => a.codigo_extraido.localeCompare(b.codigo_extraido, 'pt-BR'));

  const relatorioPath = path.join(__dirname, 'relatorio_importacao_lista_mestra_rede.json');
  fs.writeFileSync(relatorioPath, JSON.stringify(resultado, null, 2), 'utf8');

  console.log(JSON.stringify({
    dry_run: DRY_RUN,
    enviados: resultado.enviados.length,
    sem_arquivo_na_rede: resultado.sem_arquivo_na_rede.length,
    ignorados_ja_tinham_arquivo: resultado.ignorados_ja_tinham_arquivo.length,
    erros: resultado.erros.length,
    rede_nao_mapeados: resultado.arquivos_rede_nao_mapeados.length,
    relatorio: relatorioPath
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool?.end?.());
