import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import FormData from "form-data";

dotenv.config();

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

app.get("/api/op", async (req, res) => {
  const numeroOp = String(req.query.numero_op || "").trim();
  if (!numeroOp) {
    return res.status(400).json({ error: "numero_op obrigatorio" });
  }

  const opVersao = parseOpVersao(numeroOp);
  const opCustom = parseOpCustom(numeroOp);

  try {
    const query = `
      select
        op.codigo_produto,
        op.codigo_produto_id as codigo_omie,
        op.conteudo_zpl,
        pom.descricao
      from "OrdemProducao".tab_op op
      left join public.produtos_omie pom on pom.codigo_produto = op.codigo_produto_id
      where op.numero_op = $1
      limit 1
    `;
    const { rows } = await pool.query(query, [numeroOp]);

    if (!rows.length) {
      return res.status(404).json({ error: "OP nao encontrada" });
    }

    const { codigo_produto, codigo_omie, conteudo_zpl, descricao } = rows[0];

    let estruturaItems = [];
    try {
      const { rows: estrRows } = await pool.query(
        `select id, versao from public.omie_estrutura where id_produto = $1 order by versao desc`,
        [codigo_omie]
      );

      if (estrRows.length) {
        const chosen =
          estrRows.find((r) => Number(r.versao || 0) <= opVersao) ||
          estrRows[0];
        const estruturaId = chosen.id;
        const estruturaVersao = Number(chosen.versao || 0);

        if (estruturaVersao <= opVersao) {
          const { rows: itemRows } = await pool.query(
            `select cod_prod_malha, descr_prod_malha, quant_prod_malha, unid_prod_malha
             from public.omie_estrutura_item
             where parent_id = $1
             order by cod_prod_malha asc`,
            [estruturaId]
          );
          estruturaItems = itemRows;
        } else {
          const { rows: itemRows } = await pool.query(
            `select cod_prod_malha, descr_prod_malha, quant_prod_malha, unid_prod_malha
             from public.omie_estrutura_item_versao
             where parent_id = $1 and versao = $2
             order by cod_prod_malha asc`,
            [estruturaId, opVersao]
          );
          estruturaItems = itemRows;

          if (!estruturaItems.length) {
            const { rows: fallbackRows } = await pool.query(
              `select cod_prod_malha, descr_prod_malha, quant_prod_malha, unid_prod_malha
               from public.omie_estrutura_item
               where parent_id = $1
               order by cod_prod_malha asc`,
              [estruturaId]
            );
            estruturaItems = fallbackRows;
          }
        }
      }
    } catch (estrErr) {
      console.error("Erro ao buscar estrutura Omie", estrErr);
    }

    let labelPreview = null;
    let labelError = null;
    try {
      labelPreview = await renderZplToPng(conteudo_zpl || "");
    } catch (err) {
      labelError = err.message;
      console.error("Falha ao renderizar ZPL", err.message);
    }

    let produtoImagem = null;
    let produtoImagens = [];
    try {
      // Busca imagens da OP em tab_op_imagens (somente assistencia_tecnica visível) e resolve URLs
      const { rows: opImgs } = await pool.query(
        `select id_imagem
           from "OrdemProducao".tab_op_imagens
          where numero_op = $1
            and coalesce(visivel_assistencia_tecnica, true) = true`,
        [numeroOp]
      );

      const imgIds = opImgs.map((r) => r.id_imagem).filter(Boolean);
      if (imgIds.length) {
        const { rows: imgRows } = await pool.query(
          `select id, url_imagem
             from public.produtos_omie_imagens
            where id = ANY($1::bigint[])
              and coalesce(visivel_assistencia_tecnica, true) = true
            order by pos, id`,
          [imgIds]
        );
        produtoImagens = imgRows.map((r) => r.url_imagem).filter(Boolean);
        produtoImagem = produtoImagens[0] || null;
      }
    } catch (imgErr) {
      console.error("Erro ao buscar imagem do produto", imgErr);
    }

    // aplica personalização C: remove originais e insere trocados
    try {
      if (opCustom) {
        const numeroRef = numeroOp.trim();
        const { rows: persRows } = await pool.query(
          `select id from public.pcp_personalizacao where numero_referencia ilike $1 limit 1`,
          [numeroRef]
        );

        if (persRows.length) {
          const persId = persRows[0].id;
          const { rows: customRows } = await pool.query(
            `select codigo_original, descricao_original, codigo_trocado, descricao_trocada
             from public.pcp_personalizacao_item
             where personalizacao_id = $1`,
            [persId]
          );

          if (customRows.length && estruturaItems.length) {
            let baseItems = [...estruturaItems];
            const additions = [];

            customRows.forEach((row) => {
              const origRaw = String(row.codigo_original || "").trim();
              if (!origRaw) return;
              const origKey = origRaw.toUpperCase();

              const matches = baseItems.filter(
                (item) => String(item.cod_prod_malha || "").trim().toUpperCase() === origKey
              );

              const qty = matches[0]?.quant_prod_malha ?? 1;
              const unid = matches[0]?.unid_prod_malha ?? "";

              baseItems = baseItems.filter(
                (item) => String(item.cod_prod_malha || "").trim().toUpperCase() !== origKey
              );

              const codigoNovo = String(row.codigo_trocado || origRaw).trim();
              const descricaoNova = String(
                row.descricao_trocada || row.descricao_original || ""
              ).trim();

              additions.push({
                cod_prod_malha: codigoNovo,
                descr_prod_malha: descricaoNova,
                quant_prod_malha: qty,
                unid_prod_malha: unid
              });
            });

            estruturaItems = [...baseItems, ...additions];
          }
        }
      }
    } catch (customErr) {
      console.error("Erro ao aplicar personalizacao", customErr);
    }

      let manualLinks = [];
      try {
        // Busca anexos da OP em tab_op_anexos e depois resolve para produtos_omie_anexos
        const { rows: opAnexos } = await pool.query(
          `select id_anexo from "OrdemProducao".tab_op_anexos where numero_op = $1`,
          [numeroOp]
        );

        const ids = opAnexos.map((r) => r.id_anexo).filter(Boolean);
        if (ids.length) {
          const { rows: anexosRows } = await pool.query(
            `select nome_anexo, url_anexo, path_key
             from public.produtos_omie_anexos
             where id = ANY($1::bigint[])`,
            [ids]
          );

          manualLinks = anexosRows
            .map((row) => {
              const { nome_anexo, url_anexo, path_key } = row;
              const primaryUrl = url_anexo && url_anexo.trim();
              const fallbackUrl = path_key && path_key.trim();
              const chosen = primaryUrl || (fallbackUrl && /^(https?:)?\/\//i.test(fallbackUrl) ? fallbackUrl : fallbackUrl);
              if (!chosen) return null;
              return { nome: nome_anexo || "Manual", url: chosen };
            })
            .filter(Boolean);
        }
      } catch (anexoErr) {
        console.error("Erro ao buscar anexos", anexoErr);
      }

    return res.json({
      codigo_produto,
      codigo_omie,
      descricao,
      conteudo_zpl,
      estrutura_items: estruturaItems,
      produto_imagem: produtoImagem,
      produto_imagens: produtoImagens,
      manual_links: manualLinks,
      label_preview: labelPreview,
      label_error: labelError
    });
  } catch (err) {
    console.error("Erro na consulta", err);
    return res.status(500).json({ error: "Erro interno" });
  }
});

function parseOpVersao(opValue) {
  const match = /-v(\d+)/i.exec(opValue || "");
  if (!match) return 1;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseOpCustom(opValue) {
  const match = /-v\d+c(\d+)/i.exec(opValue || "");
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function renderZplToPng(zpl) {
  if (!zpl) return null;
  const sanitized = sanitizeZpl(zpl);
  const attempts = [
    { url: "https://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/", mode: "plain", body: zpl },
    { url: "https://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/", mode: "plain", body: sanitized },
    { url: "https://api.labelary.com/v1/printers/8dpmm/labels/4x8/0/", mode: "plain", body: sanitized },
    { url: "https://api.labelary.com/v1/printers/12dpmm/labels/6x8/0/", mode: "plain", body: sanitized },
    { url: "https://api.labelary.com/v1/printers/8dpmm/labels/6x8/0/", mode: "plain", body: sanitized },
    { url: "https://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/", mode: "multipart", body: sanitized },
    { url: "https://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/", mode: "urlencoded", body: sanitized }
  ];

  let lastError = null;

  for (const attempt of attempts) {
    try {
      let data = attempt.body;
      let headers = { Accept: "image/png" };

      if (attempt.mode === "plain") {
        headers["Content-Type"] = "text/plain";
      } else if (attempt.mode === "multipart") {
        const form = new FormData();
        form.append("file", zpl);
        data = form;
        headers = { ...form.getHeaders(), Accept: "image/png" };
      } else if (attempt.mode === "urlencoded") {
        const params = new URLSearchParams();
        params.append("file", attempt.body);
        data = params.toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      }

      const response = await axios.post(attempt.url, data, {
        headers,
        responseType: "arraybuffer",
        maxBodyLength: Infinity
      });
      return Buffer.from(response.data, "binary").toString("base64");
    } catch (err) {
      lastError = err;
    }
  }

  const bodyMsg = lastError?.response?.data?.toString?.();
  const headerMsg = lastError?.response?.headers?.["x-labelary-error"];
  const status = lastError?.response?.status;
  const labelaryMsg = headerMsg || bodyMsg || lastError?.message || "erro desconhecido";
  throw new Error(`Labelary (${status || ""}): ${labelaryMsg}`);
}

function sanitizeZpl(zpl) {
  const trimmed = (zpl || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const asciiOnly = trimmed
    .split("")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 32 && code <= 126) return ch;
      return " ";
    })
    .join("");

  const hasXA = asciiOnly.includes("^XA");
  const hasXZ = asciiOnly.includes("^XZ");

  if (hasXA && hasXZ) return asciiOnly;
  return `^XA\n${asciiOnly}\n^XZ`;
}

app.listen(port, () => {
  console.log(`Servidor escutando em http://localhost:${port}`);
});
