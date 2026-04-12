require('dotenv').config();

const crypto = require('crypto');
const axios = require('axios');
const pdf = require('pdf-parse');
const { Pool } = require('pg');

const MAX_CHARS_PER_CHUNK = 1800;

function normalizarTextoBusca(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function garantirEstrutura(client) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS "Chatbot";

    CREATE TABLE IF NOT EXISTS "Chatbot".manuais_instrucao (
      id BIGSERIAL PRIMARY KEY,
      nome_arquivo TEXT NOT NULL,
      caminho_manual TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE "Chatbot".manuais_instrucao
      ADD COLUMN IF NOT EXISTS nome_arquivo_normalizado TEXT,
      ADD COLUMN IF NOT EXISTS paginas INTEGER,
      ADD COLUMN IF NOT EXISTS conteudo_hash TEXT,
      ADD COLUMN IF NOT EXISTS ultima_indexacao_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS status_indexacao TEXT NOT NULL DEFAULT 'pendente',
      ADD COLUMN IF NOT EXISTS erro_indexacao TEXT;

    CREATE TABLE IF NOT EXISTS "Chatbot".manuais_instrucao_chunks (
      id BIGSERIAL PRIMARY KEY,
      manual_id BIGINT NOT NULL REFERENCES "Chatbot".manuais_instrucao(id) ON DELETE CASCADE,
      chunk_ordem INTEGER NOT NULL,
      pagina_inicial INTEGER NOT NULL,
      pagina_final INTEGER NOT NULL,
      texto TEXT NOT NULL,
      texto_normalizado TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_chatbot_manuais_instrucao_caminho
      ON "Chatbot".manuais_instrucao (caminho_manual);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chatbot_manuais_chunks_manual_ordem
      ON "Chatbot".manuais_instrucao_chunks (manual_id, chunk_ordem);
    CREATE INDEX IF NOT EXISTS idx_chatbot_manuais_chunks_manual
      ON "Chatbot".manuais_instrucao_chunks (manual_id);
    CREATE INDEX IF NOT EXISTS idx_chatbot_manuais_chunks_busca
      ON "Chatbot".manuais_instrucao_chunks
      USING GIN (to_tsvector('simple', COALESCE(texto_normalizado, '')));
  `);
}

function renderPage(pageData, pageNumber, pageStore) {
  return pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
    .then((textContent) => {
      let lastY = null;
      const lines = [];
      let currentLine = [];

      for (const item of textContent.items) {
        const y = item.transform?.[5];
        if (lastY !== null && Math.abs(y - lastY) > 1.5) {
          lines.push(currentLine.join(' ').replace(/\s+/g, ' ').trim());
          currentLine = [];
        }
        currentLine.push(String(item.str || '').trim());
        lastY = y;
      }

      if (currentLine.length) {
        lines.push(currentLine.join(' ').replace(/\s+/g, ' ').trim());
      }

      const pageText = lines.filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n').trim();
      pageStore.push({ pageNumber, text: pageText });
      return pageText;
    });
}

function quebrarPaginaEmChunks(pageText, pageNumber) {
  const linhas = String(pageText || '')
    .split(/\n+/)
    .map((linha) => linha.trim())
    .filter(Boolean);

  const chunks = [];
  let buffer = '';

  for (const linha of linhas) {
    const candidate = buffer ? `${buffer}\n${linha}` : linha;
    if (candidate.length > MAX_CHARS_PER_CHUNK && buffer) {
      chunks.push({
        pagina_inicial: pageNumber,
        pagina_final: pageNumber,
        texto: buffer.trim()
      });
      buffer = linha;
    } else {
      buffer = candidate;
    }
  }

  if (buffer.trim()) {
    chunks.push({
      pagina_inicial: pageNumber,
      pagina_final: pageNumber,
      texto: buffer.trim()
    });
  }

  return chunks;
}

async function baixarPdf(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000
  });
  return Buffer.from(response.data);
}

async function extrairChunksDoPdf(buffer) {
  const pages = [];
  let pageCounter = 0;

  await pdf(buffer, {
    pagerender: (pageData) => {
      pageCounter += 1;
      return renderPage(pageData, pageCounter, pages);
    }
  });

  const chunks = [];
  let chunkOrdem = 1;
  for (const page of pages) {
    const pageChunks = quebrarPaginaEmChunks(page.text, page.pageNumber);
    for (const chunk of pageChunks) {
      chunks.push({
        chunk_ordem: chunkOrdem,
        pagina_inicial: chunk.pagina_inicial,
        pagina_final: chunk.pagina_final,
        texto: chunk.texto,
        texto_normalizado: normalizarTextoBusca(chunk.texto)
      });
      chunkOrdem += 1;
    }
  }

  return {
    paginas: pages.length,
    chunks
  };
}

async function indexarManual(client, manual) {
  const manualId = Number(manual.id);
  const url = String(manual.caminho_manual || '').trim();
  const nomeArquivo = String(manual.nome_arquivo || '').trim();

  await client.query(
    `
      UPDATE "Chatbot".manuais_instrucao
      SET status_indexacao = 'processando',
          erro_indexacao = NULL
      WHERE id = $1
    `,
    [manualId]
  );

  const pdfBuffer = await baixarPdf(url);
  const hash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
  const extraido = await extrairChunksDoPdf(pdfBuffer);

  await client.query('DELETE FROM "Chatbot".manuais_instrucao_chunks WHERE manual_id = $1', [manualId]);

  for (const chunk of extraido.chunks) {
    await client.query(
      `
        INSERT INTO "Chatbot".manuais_instrucao_chunks
          (manual_id, chunk_ordem, pagina_inicial, pagina_final, texto, texto_normalizado)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        manualId,
        chunk.chunk_ordem,
        chunk.pagina_inicial,
        chunk.pagina_final,
        chunk.texto,
        chunk.texto_normalizado
      ]
    );
  }

  await client.query(
    `
      UPDATE "Chatbot".manuais_instrucao
      SET nome_arquivo_normalizado = $2,
          paginas = $3,
          conteudo_hash = $4,
          ultima_indexacao_em = NOW(),
          status_indexacao = 'indexado',
          erro_indexacao = NULL
      WHERE id = $1
    `,
    [manualId, normalizarTextoBusca(nomeArquivo), extraido.paginas, hash]
  );

  return {
    manual_id: manualId,
    nome_arquivo: nomeArquivo,
    paginas: extraido.paginas,
    chunks: extraido.chunks.length
  };
}

async function main() {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    throw new Error('DATABASE_URL/POSTGRES_URL não configurada.');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  try {
    await garantirEstrutura(client);

    const { rows: manuais } = await client.query(`
      SELECT id, nome_arquivo, caminho_manual
      FROM "Chatbot".manuais_instrucao
      ORDER BY id
    `);

    const resultados = [];
    for (const manual of manuais) {
      try {
        const resumo = await indexarManual(client, manual);
        resultados.push({ ok: true, ...resumo });
        console.log(`[manuais] indexado id=${resumo.manual_id} paginas=${resumo.paginas} chunks=${resumo.chunks} nome=${resumo.nome_arquivo}`);
      } catch (err) {
        await client.query(
          `
            UPDATE "Chatbot".manuais_instrucao
            SET status_indexacao = 'erro',
                erro_indexacao = $2
            WHERE id = $1
          `,
          [manual.id, String(err?.message || err).slice(0, 2000)]
        );
        resultados.push({
          ok: false,
          manual_id: Number(manual.id),
          nome_arquivo: manual.nome_arquivo,
          error: String(err?.message || err)
        });
        console.error(`[manuais] erro ao indexar id=${manual.id}:`, err?.message || err);
      }
    }

    console.log(JSON.stringify({ total: manuais.length, resultados }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
