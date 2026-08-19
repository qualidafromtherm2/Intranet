'use strict';

/**
 * Destino de etiqueta.ETQ_recebimento após o recebimento:
 * - MP (família/código xx.MP....) → pir=false → lista PIR (Qualidade)
 * - fora de MP → pir=true → Identificação do produto (Logística)
 * - pir_vai_direto_identificacao → sempre Identificação
 * - pir_necessario_eng → também entra na lista PIR_ENG (sem travar Identificação)
 */

function codigoTemSegmentoMp(codigo) {
  const seg = String(codigo || '').trim().split('.')[1] || '';
  return seg.toUpperCase() === 'MP';
}

function produtoEhFamiliaMp(row, codigoFallback) {
  if (row) {
    if (String(row.codint_familia || '').trim().toUpperCase() === 'MP') return true;
    if (codigoTemSegmentoMp(row.codigo)) return true;
    if (codigoTemSegmentoMp(row.codigo_produto)) return true;
  }
  return codigoTemSegmentoMp(codigoFallback);
}

/** SQL booleano: etiqueta é MP (família Omie ou 2º segmento do código). Alias er + po. */
const SQL_ETQ_EH_MP = `(
  UPPER(TRIM(COALESCE(po.codint_familia, ''))) = 'MP'
  OR UPPER(SPLIT_PART(TRIM(COALESCE(po.codigo, '')), '.', 2)) = 'MP'
  OR UPPER(SPLIT_PART(TRIM(COALESCE(er.codigo_produto, '')), '.', 2)) = 'MP'
)`;

function calcularPirInicial({ vaiDireto, ehMp }) {
  if (vaiDireto === true) return true;
  if (ehMp !== true) return true; // fora de MP → Identificação
  return false; // MP → PIR
}

/**
 * Consulta produtos_omie e decide pir inicial + se é MP.
 * @param {import('pg').Pool|{query: Function}} pool
 * @param {string} codigoProduto
 */
async function resolverDestinoPirRecebimento(pool, codigoProduto) {
  const cod = String(codigoProduto || '').trim();
  let vaiDireto = false;
  let necessarioEng = false;
  let ehMp = codigoTemSegmentoMp(cod);
  try {
    await pool.query(`
      ALTER TABLE produto.produtos_omie
      ADD COLUMN IF NOT EXISTS pir_necessario_eng BOOLEAN NOT NULL DEFAULT FALSE
    `).catch(() => {});
    const { rows } = await pool.query(
      `SELECT COALESCE(pir_vai_direto_identificacao, FALSE) AS vai_direto,
              COALESCE(pir_necessario_eng, FALSE) AS necessario_eng,
              UPPER(TRIM(COALESCE(codint_familia, ''))) AS codint_familia,
              codigo,
              codigo_produto::text AS codigo_produto
         FROM produto.produtos_omie
        WHERE TRIM(COALESCE(codigo, '')) = TRIM($1)
           OR TRIM(COALESCE(codigo_produto::text, '')) = TRIM($1)
        LIMIT 1`,
      [cod]
    );
    if (rows[0]) {
      vaiDireto = rows[0].vai_direto === true;
      necessarioEng = rows[0].necessario_eng === true;
      ehMp = produtoEhFamiliaMp(rows[0], cod);
    }
  } catch (_) {
    /* usa fallback do código */
  }
  return {
    pirInicial: calcularPirInicial({ vaiDireto, ehMp }),
    ehMp,
    vaiDireto,
    necessarioEng,
  };
}

/**
 * Libera etiquetas fora de MP que ficaram presas em pir=false
 * (não apareciam na PIR padrão nem em Identificação).
 */
async function liberarEtiquetasForaMpPresas(pool) {
  const sql = `
    UPDATE etiqueta."ETQ_recebimento" er
       SET pir = true
     WHERE COALESCE(er.pir, false) = false
       AND NOT EXISTS (
         SELECT 1
           FROM produto.produtos_omie po
          WHERE (
                  TRIM(COALESCE(po.codigo, '')) = TRIM(COALESCE(er.codigo_produto, ''))
                  OR TRIM(COALESCE(po.codigo_produto::text, '')) = TRIM(COALESCE(er.codigo_produto, ''))
                )
            AND (
                  UPPER(TRIM(COALESCE(po.codint_familia, ''))) = 'MP'
                  OR UPPER(SPLIT_PART(TRIM(COALESCE(po.codigo, '')), '.', 2)) = 'MP'
                )
       )
       AND UPPER(SPLIT_PART(TRIM(COALESCE(er.codigo_produto, '')), '.', 2)) <> 'MP'
  `;
  const result = await pool.query(sql);
  return Number(result.rowCount || 0);
}

module.exports = {
  SQL_ETQ_EH_MP,
  codigoTemSegmentoMp,
  produtoEhFamiliaMp,
  calcularPirInicial,
  resolverDestinoPirRecebimento,
  liberarEtiquetasForaMpPresas,
};
