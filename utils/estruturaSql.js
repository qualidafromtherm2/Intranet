/**
 * Cache local schema estrutura.* — leitura/gravação da BOM IAPP.
 */
const { dbQuery } = require('../src/db');

let schemaReadyPromise = null;

async function ensureSchemaEstruturaImpl() {
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS estrutura`);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS estrutura.ficha (
      id                      BIGINT PRIMARY KEY,
      codigo_produto          TEXT NOT NULL,
      identificacao           TEXT,
      descricao               TEXT,
      status                  TEXT,
      modelo                  TEXT,
      qtde                    NUMERIC,
      qtde_batelada           NUMERIC,
      qtde_referencia         NUMERIC,
      data_validade           TIMESTAMPTZ,
      vcpp                    NUMERIC,
      vcp                     NUMERIC,
      data_criacao            TIMESTAMPTZ,
      data_ultima_atualizacao TIMESTAMPTZ,
      usuario_criador         BIGINT,
      ultimo_usuario_atualizador BIGINT,
      raw                     JSONB,
      sincronizado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_estrutura_ficha_codigo
      ON estrutura.ficha (UPPER(BTRIM(codigo_produto)))
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS estrutura.ficha_operacao (
      id                      BIGSERIAL PRIMARY KEY,
      ficha_id                BIGINT NOT NULL REFERENCES estrutura.ficha(id) ON DELETE CASCADE,
      operacao                BIGINT NOT NULL,
      unidade                 TEXT,
      tempo_operacao          NUMERIC,
      tempo_preparacao        NUMERIC,
      tempo_espera            NUMERIC,
      tempo_transporte        NUMERIC,
      tempo_fila              NUMERIC,
      tempo_total_pessimista  NUMERIC,
      tempo_total_otimista    NUMERIC,
      valor_total             NUMERIC,
      capacidade              NUMERIC,
      meta                    NUMERIC,
      checklists              JSONB,
      servicos                JSONB,
      raw                     JSONB,
      UNIQUE (ficha_id, operacao)
    )
  `);

  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_estrutura_ficha_operacao_ficha
      ON estrutura.ficha_operacao (ficha_id)
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS estrutura.ficha_item (
      id                BIGSERIAL PRIMARY KEY,
      ficha_id          BIGINT NOT NULL REFERENCES estrutura.ficha(id) ON DELETE CASCADE,
      operacao          BIGINT NOT NULL,
      tipo              TEXT NOT NULL CHECK (tipo IN ('Material', 'Subproduto')),
      produto_iapp_id   BIGINT NOT NULL,
      qtde              NUMERIC,
      porcentagem       NUMERIC,
      qtde_custo_perdas NUMERIC,
      observacoes       TEXT,
      comportamento     TEXT,
      ordem             INT NOT NULL DEFAULT 0,
      raw               JSONB
    )
  `);

  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_estrutura_ficha_item_ficha
      ON estrutura.ficha_item (ficha_id)
  `);

  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_estrutura_ficha_item_produto
      ON estrutura.ficha_item (produto_iapp_id)
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS estrutura.produto_iapp (
      id                      BIGINT PRIMARY KEY,
      identificacao           TEXT,
      descricao               TEXT,
      unidade_medida          TEXT,
      ean                     TEXT,
      tipo                    TEXT,
      origem                  TEXT,
      valor_venda             NUMERIC,
      valor_custo             NUMERIC,
      altura                  NUMERIC,
      peso_bruto              NUMERIC,
      peso_liquido            NUMERIC,
      comprimento             NUMERIC,
      largura                 NUMERIC,
      ncm                     TEXT,
      cest                    TEXT,
      status                  TEXT,
      fabricante              TEXT,
      projeto                 TEXT,
      linha                   TEXT,
      grupo                   JSONB,
      subgrupo                JSONB,
      tag_grupo               JSONB,
      codigo_dun              TEXT,
      genero                  TEXT,
      area                    NUMERIC,
      diametro                NUMERIC,
      localizacao             TEXT,
      qtde_volume             NUMERIC,
      tipo_volume             TEXT,
      qtde_embalagem          NUMERIC,
      tipo_embalagem          TEXT,
      lucro_pretendido        NUMERIC,
      vcc                     NUMERIC,
      validade_vcc            NUMERIC,
      lote_minimo_compra      NUMERIC,
      maximo_empilhamentos    NUMERIC,
      qtde_seguranca          NUMERIC,
      qtde_minima             NUMERIC,
      peso_tara               NUMERIC,
      data_ultima_atualizacao TIMESTAMPTZ,
      raw                     JSONB,
      sincronizado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_estrutura_produto_iapp_ident
      ON estrutura.produto_iapp (UPPER(BTRIM(identificacao)))
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS estrutura.sync_log (
      id               BIGSERIAL PRIMARY KEY,
      codigo_produto   TEXT NOT NULL,
      ficha_id         BIGINT,
      status           TEXT NOT NULL DEFAULT 'running',
      etapa            TEXT,
      progresso_atual  INT NOT NULL DEFAULT 0,
      progresso_total  INT NOT NULL DEFAULT 0,
      total_api_calls  INT NOT NULL DEFAULT 0,
      total_itens      INT NOT NULL DEFAULT 0,
      total_produtos   INT NOT NULL DEFAULT 0,
      mensagem         TEXT,
      usuario          TEXT,
      iniciado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finalizado_em    TIMESTAMPTZ
    )
  `);
}

function ensureSchemaEstrutura() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureSchemaEstruturaImpl().catch((err) => {
      schemaReadyPromise = null;
      throw err;
    });
  }
  return schemaReadyPromise;
}

function normalizarCodigo(codigo) {
  return String(codigo || '').trim().toUpperCase();
}

function mapItensSqlParaResposta(rows) {
  return (rows || []).map((row) => ({
    item_id: row.id,
    ficha_id: row.ficha_id,
    produto_iapp_id: row.produto_iapp_id,
    identificacao: row.produto_codigo || String(row.produto_iapp_id || '—'),
    descricao: row.produto_descricao || row.produto_codigo || '—',
    status: row.tipo || '—',
    modelo: '—',
    qtde: row.qtde ?? 0,
    etapa: row.operacao ?? '—',
    unidade_medida: row.unidade_medida || null,
    produto_tipo: row.produto_tipo || null,
    ncm: row.ncm || null,
    valor_custo: row.valor_custo ?? null,
    valor_venda: row.valor_venda ?? null,
    preco: Number(row.valor_custo ?? row.valor_venda) || 0,
    operacao_unidade: row.operacao_unidade || null,
    tempo_operacao: row.tempo_operacao ?? null,
    tempo_preparacao: row.tempo_preparacao ?? null,
  }));
}

const JSONB_FIELDS = new Set(['raw', 'grupo', 'subgrupo', 'tag_grupo', 'checklists', 'servicos']);
const NUMERIC_FIELDS = new Set([
  'qtde', 'qtde_batelada', 'qtde_referencia', 'vcpp', 'vcp',
  'tempo_operacao', 'tempo_preparacao', 'tempo_espera', 'tempo_transporte', 'tempo_fila',
  'tempo_total_pessimista', 'tempo_total_otimista', 'valor_total', 'capacidade', 'meta',
  'porcentagem', 'qtde_custo_perdas', 'ordem', 'produto_iapp_id', 'operacao', 'ficha_id',
  'valor_venda', 'valor_custo', 'altura', 'peso_bruto', 'peso_liquido', 'comprimento', 'largura',
  'area', 'diametro', 'qtde_volume', 'qtde_embalagem', 'lucro_pretendido', 'vcc', 'validade_vcc',
  'lote_minimo_compra', 'maximo_empilhamentos', 'qtde_seguranca', 'qtde_minima', 'peso_tara',
  'usuario_criador', 'ultimo_usuario_atualizador', 'id',
]);

function serializarCampoEdicao(valor) {
  if (valor == null) return '';
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'object') return JSON.stringify(valor, null, 2);
  return String(valor);
}

function camposParaEdicao(row, skip = new Set(['id'])) {
  const fields = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (skip.has(key)) continue;
    fields[key] = serializarCampoEdicao(value);
  }
  return fields;
}

function parseValorCampo(key, raw) {
  const txt = raw == null ? '' : String(raw).trim();
  if (JSONB_FIELDS.has(key)) {
    if (!txt) return null;
    return JSON.parse(txt);
  }
  if (NUMERIC_FIELDS.has(key)) {
    if (!txt) return null;
    const n = Number(txt);
    return Number.isNaN(n) ? null : n;
  }
  if (key.startsWith('data_') || key.endsWith('_em') || key === 'data_validade') {
    if (!txt) return null;
    const d = new Date(txt);
    return Number.isNaN(d.getTime()) ? txt : d.toISOString();
  }
  return txt === '' ? null : txt;
}

async function obterFichaCompletaPorId(fichaId) {
  await ensureSchemaEstrutura();
  const id = Number(fichaId) || 0;
  if (!id) return null;

  const { rows: fichas } = await dbQuery(
    `SELECT * FROM estrutura.ficha WHERE id = $1 LIMIT 1`,
    [id]
  );
  if (!fichas[0]) return null;

  const { rows: operacoes } = await dbQuery(
    `SELECT * FROM estrutura.ficha_operacao
      WHERE ficha_id = $1
      ORDER BY operacao ASC`,
    [id]
  );

  return {
    ficha_id: id,
    ficha: camposParaEdicao(fichas[0]),
    operacoes: operacoes.map((op) => ({
      operacao: op.operacao,
      fields: camposParaEdicao(op, new Set(['id', 'ficha_id'])),
    })),
  };
}

async function atualizarFichaCompletaPorId(fichaId, payload = {}) {
  await ensureSchemaEstrutura();
  const id = Number(fichaId) || 0;
  if (!id) throw new Error('ID da ficha inválido.');

  const fichaBody = payload.ficha || {};
  const fichaSets = [];
  const fichaVals = [];
  let idx = 1;
  for (const [key, raw] of Object.entries(fichaBody)) {
    if (key === 'id' || key === 'sincronizado_em') continue;
    fichaSets.push(`${key} = $${idx++}`);
    fichaVals.push(parseValorCampo(key, raw));
  }
  if (fichaSets.length) {
    fichaSets.push('sincronizado_em = NOW()');
    fichaVals.push(id);
    await dbQuery(
      `UPDATE estrutura.ficha SET ${fichaSets.join(', ')} WHERE id = $${idx}`,
      fichaVals
    );
  }

  const operacoes = Array.isArray(payload.operacoes) ? payload.operacoes : [];
  for (const op of operacoes) {
    const operacaoId = Number(op.operacao) || 0;
    if (!operacaoId || !op.fields) continue;
    const sets = [];
    const vals = [];
    let j = 1;
    for (const [key, raw] of Object.entries(op.fields)) {
      if (key === 'operacao' || key === 'ficha_id') continue;
      sets.push(`${key} = $${j++}`);
      vals.push(parseValorCampo(key, raw));
    }
    if (!sets.length) continue;
    vals.push(id, operacaoId);
    await dbQuery(
      `UPDATE estrutura.ficha_operacao
          SET ${sets.join(', ')}
        WHERE ficha_id = $${j++} AND operacao = $${j}`,
      vals
    );
  }

  return obterFichaCompletaPorId(id);
}

async function obterItemCompletoPorId(itemId) {
  await ensureSchemaEstrutura();
  const id = Number(itemId) || 0;
  if (!id) return null;

  const { rows } = await dbQuery(
    `SELECT fi.*,
            pi.id AS prod_id,
            pi.identificacao AS pi_identificacao,
            pi.descricao AS pi_descricao,
            pi.unidade_medida, pi.ean, pi.tipo, pi.origem,
            pi.valor_venda, pi.valor_custo, pi.altura, pi.peso_bruto, pi.peso_liquido,
            pi.comprimento, pi.largura, pi.ncm, pi.cest, pi.status, pi.fabricante,
            pi.projeto, pi.linha, pi.grupo, pi.subgrupo, pi.tag_grupo, pi.codigo_dun,
            pi.genero, pi.area, pi.diametro, pi.localizacao, pi.qtde_volume, pi.tipo_volume,
            pi.qtde_embalagem, pi.tipo_embalagem, pi.lucro_pretendido, pi.vcc, pi.validade_vcc,
            pi.lote_minimo_compra, pi.maximo_empilhamentos, pi.qtde_seguranca, pi.qtde_minima,
            pi.peso_tara, pi.data_ultima_atualizacao AS pi_data_ultima_atualizacao,
            pi.raw AS pi_raw, pi.sincronizado_em AS pi_sincronizado_em,
            fo.unidade AS op_unidade,
            fo.tempo_operacao AS op_tempo_operacao,
            fo.tempo_preparacao AS op_tempo_preparacao,
            fo.tempo_espera AS op_tempo_espera,
            fo.tempo_transporte AS op_tempo_transporte,
            fo.tempo_fila AS op_tempo_fila,
            fo.tempo_total_pessimista AS op_tempo_total_pessimista,
            fo.tempo_total_otimista AS op_tempo_total_otimista,
            fo.valor_total AS op_valor_total,
            fo.capacidade AS op_capacidade,
            fo.meta AS op_meta,
            fo.checklists AS op_checklists,
            fo.servicos AS op_servicos,
            fo.raw AS op_raw
       FROM estrutura.ficha_item fi
       LEFT JOIN estrutura.produto_iapp pi ON pi.id = fi.produto_iapp_id
       LEFT JOIN estrutura.ficha_operacao fo
         ON fo.ficha_id = fi.ficha_id AND fo.operacao = fi.operacao
      WHERE fi.id = $1
      LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;

  const item = {
    id: row.id,
    ficha_id: row.ficha_id,
    operacao: row.operacao,
    tipo: row.tipo,
    produto_iapp_id: row.produto_iapp_id,
    qtde: row.qtde,
    porcentagem: row.porcentagem,
    qtde_custo_perdas: row.qtde_custo_perdas,
    observacoes: row.observacoes,
    comportamento: row.comportamento,
    ordem: row.ordem,
    raw: row.raw,
  };

  const produto = row.prod_id ? {
    id: row.prod_id,
    identificacao: row.pi_identificacao,
    descricao: row.pi_descricao,
    unidade_medida: row.unidade_medida,
    ean: row.ean,
    tipo: row.tipo,
    origem: row.origem,
    valor_venda: row.valor_venda,
    valor_custo: row.valor_custo,
    altura: row.altura,
    peso_bruto: row.peso_bruto,
    peso_liquido: row.peso_liquido,
    comprimento: row.comprimento,
    largura: row.largura,
    ncm: row.ncm,
    cest: row.cest,
    status: row.status,
    fabricante: row.fabricante,
    projeto: row.projeto,
    linha: row.linha,
    grupo: row.grupo,
    subgrupo: row.subgrupo,
    tag_grupo: row.tag_grupo,
    codigo_dun: row.codigo_dun,
    genero: row.genero,
    area: row.area,
    diametro: row.diametro,
    localizacao: row.localizacao,
    qtde_volume: row.qtde_volume,
    tipo_volume: row.tipo_volume,
    qtde_embalagem: row.qtde_embalagem,
    tipo_embalagem: row.tipo_embalagem,
    lucro_pretendido: row.lucro_pretendido,
    vcc: row.vcc,
    validade_vcc: row.validade_vcc,
    lote_minimo_compra: row.lote_minimo_compra,
    maximo_empilhamentos: row.maximo_empilhamentos,
    qtde_seguranca: row.qtde_seguranca,
    qtde_minima: row.qtde_minima,
    peso_tara: row.peso_tara,
    data_ultima_atualizacao: row.pi_data_ultima_atualizacao,
    raw: row.pi_raw,
    sincronizado_em: row.pi_sincronizado_em,
  } : null;

  const operacao = row.operacao ? {
    operacao: row.operacao,
    unidade: row.op_unidade,
    tempo_operacao: row.op_tempo_operacao,
    tempo_preparacao: row.op_tempo_preparacao,
    tempo_espera: row.op_tempo_espera,
    tempo_transporte: row.op_tempo_transporte,
    tempo_fila: row.op_tempo_fila,
    tempo_total_pessimista: row.op_tempo_total_pessimista,
    tempo_total_otimista: row.op_tempo_total_otimista,
    valor_total: row.op_valor_total,
    capacidade: row.op_capacidade,
    meta: row.op_meta,
    checklists: row.op_checklists,
    servicos: row.op_servicos,
    raw: row.op_raw,
  } : null;

  return {
    item_id: id,
    item: camposParaEdicao(item),
    produto: produto ? camposParaEdicao(produto) : {},
    operacao: operacao ? camposParaEdicao(operacao, new Set(['operacao'])) : {},
    meta: {
      ficha_id: row.ficha_id,
      operacao: row.operacao,
      produto_iapp_id: row.produto_iapp_id,
    },
  };
}

async function atualizarItemCompletoPorId(itemId, payload = {}) {
  await ensureSchemaEstrutura();
  const id = Number(itemId) || 0;
  if (!id) throw new Error('ID do item inválido.');

  const atual = await obterItemCompletoPorId(id);
  if (!atual) throw new Error('Item não encontrado.');

  const itemBody = payload.item || {};
  const itemSets = [];
  const itemVals = [];
  let i = 1;
  for (const [key, raw] of Object.entries(itemBody)) {
    if (key === 'id') continue;
    itemSets.push(`${key} = $${i++}`);
    itemVals.push(parseValorCampo(key, raw));
  }
  if (itemSets.length) {
    itemVals.push(id);
    await dbQuery(
      `UPDATE estrutura.ficha_item SET ${itemSets.join(', ')} WHERE id = $${i}`,
      itemVals
    );
  }

  const produtoBody = payload.produto || {};
  const produtoId = Number(atual.meta?.produto_iapp_id) || 0;
  if (produtoId > 0 && Object.keys(produtoBody).length) {
    const prodSets = [];
    const prodVals = [];
    let p = 1;
    for (const [key, raw] of Object.entries(produtoBody)) {
      if (key === 'id' || key === 'sincronizado_em') continue;
      prodSets.push(`${key} = $${p++}`);
      prodVals.push(parseValorCampo(key, raw));
    }
    if (prodSets.length) {
      prodSets.push('sincronizado_em = NOW()');
      prodVals.push(produtoId);
      await dbQuery(
        `UPDATE estrutura.produto_iapp SET ${prodSets.join(', ')} WHERE id = $${p}`,
        prodVals
      );
    }
  }

  const operacaoBody = payload.operacao || {};
  const fichaId = Number(atual.meta?.ficha_id) || 0;
  const operacaoId = Number(atual.meta?.operacao) || 0;
  if (fichaId > 0 && operacaoId > 0 && Object.keys(operacaoBody).length) {
    const opSets = [];
    const opVals = [];
    let o = 1;
    for (const [key, raw] of Object.entries(operacaoBody)) {
      if (key === 'operacao' || key === 'ficha_id') continue;
      opSets.push(`${key} = $${o++}`);
      opVals.push(parseValorCampo(key, raw));
    }
    if (opSets.length) {
      opVals.push(fichaId, operacaoId);
      await dbQuery(
        `UPDATE estrutura.ficha_operacao
            SET ${opSets.join(', ')}
          WHERE ficha_id = $${o++} AND operacao = $${o}`,
        opVals
      );
    }
  }

  await dbQuery(
    `UPDATE estrutura.ficha SET sincronizado_em = NOW() WHERE id = $1`,
    [fichaId]
  );

  return obterItemCompletoPorId(id);
}

async function lerEstruturaDoSql(codigoProduto, opts = {}) {
  await ensureSchemaEstrutura();
  const codigoNorm = normalizarCodigo(codigoProduto);
  const fichaId = Number(opts.fichaId) || 0;
  if (!codigoNorm && !fichaId) return null;

  let ficha = null;
  if (fichaId > 0) {
    const { rows } = await dbQuery(
      `SELECT * FROM estrutura.ficha WHERE id = $1 LIMIT 1`,
      [fichaId]
    );
    ficha = rows[0] || null;
  } else {
    const { rows } = await dbQuery(
      `SELECT * FROM estrutura.ficha
        WHERE UPPER(BTRIM(codigo_produto)) = $1
           OR UPPER(BTRIM(descricao)) = $1
        ORDER BY sincronizado_em DESC
        LIMIT 1`,
      [codigoNorm]
    );
    ficha = rows[0] || null;
  }
  if (!ficha) return null;

  const { rows: itensDb } = await dbQuery(
    `SELECT fi.*,
            pi.identificacao AS produto_codigo,
            pi.descricao AS produto_descricao,
            pi.unidade_medida,
            pi.tipo AS produto_tipo,
            pi.ncm,
            pi.valor_custo,
            pi.valor_venda,
            fo.unidade AS operacao_unidade,
            fo.tempo_operacao,
            fo.tempo_preparacao
       FROM estrutura.ficha_item fi
       LEFT JOIN estrutura.produto_iapp pi ON pi.id = fi.produto_iapp_id
       LEFT JOIN estrutura.ficha_operacao fo
         ON fo.ficha_id = fi.ficha_id AND fo.operacao = fi.operacao
      WHERE fi.ficha_id = $1
      ORDER BY fi.ordem ASC, fi.id ASC`,
    [ficha.id]
  );
  if (!itensDb.length) return null;

  const itens = mapItensSqlParaResposta(itensDb);
  return {
    codigo: ficha.codigo_produto || codigoProduto,
    fonte: 'sql',
    sincronizado_em: ficha.sincronizado_em,
    ficha: {
      id: ficha.id,
      identificacao: ficha.identificacao,
      descricao: ficha.descricao,
      produto: ficha.codigo_produto,
      status: ficha.status,
      sincronizado_em: ficha.sincronizado_em,
    },
    itens,
    itensDb,
  };
}

async function buscarProdutoOmieValidado(codigo, codigoProduto) {
  const cod = String(codigo || '').trim();
  const codProd = Number(codigoProduto);
  if (!cod) throw new Error('Código do produto é obrigatório.');
  if (!Number.isFinite(codProd) || codProd <= 0) throw new Error('codigo_produto inválido.');

  const { rows } = await dbQuery(
    `SELECT codigo_produto, codigo, descricao
       FROM public.produtos_omie
      WHERE codigo_produto = $1 AND codigo = $2
      LIMIT 1`,
    [codProd, cod]
  );
  if (!rows[0]) throw new Error('Produto não encontrado em produtos_omie.');
  return rows[0];
}

async function ensureProdutoIappFromOmie(codigo, codigoProduto) {
  await ensureSchemaEstrutura();
  const omie = await buscarProdutoOmieValidado(codigo, codigoProduto);
  const codNorm = normalizarCodigo(omie.codigo);

  const { rows: existentes } = await dbQuery(
    `SELECT id FROM estrutura.produto_iapp
      WHERE UPPER(BTRIM(identificacao)) = $1
      ORDER BY sincronizado_em DESC NULLS LAST
      LIMIT 1`,
    [codNorm]
  );
  if (existentes[0]?.id) return Number(existentes[0].id);

  const iappId = Number(omie.codigo_produto);
  await dbQuery(
    `INSERT INTO estrutura.produto_iapp (id, identificacao, descricao, sincronizado_em)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       identificacao = COALESCE(NULLIF(EXCLUDED.identificacao, ''), estrutura.produto_iapp.identificacao),
       descricao = COALESCE(NULLIF(EXCLUDED.descricao, ''), estrutura.produto_iapp.descricao),
       sincronizado_em = NOW()`,
    [iappId, omie.codigo, omie.descricao || omie.codigo]
  );
  return iappId;
}

async function resolverOperacaoPadraoFicha(fichaId) {
  const id = Number(fichaId) || 0;
  if (!id) return 1;

  const { rows: itens } = await dbQuery(
    `SELECT operacao FROM estrutura.ficha_item
      WHERE ficha_id = $1
      ORDER BY ordem DESC, id DESC
      LIMIT 1`,
    [id]
  );
  if (itens[0]?.operacao != null) return Number(itens[0].operacao);

  const { rows: ops } = await dbQuery(
    `SELECT operacao FROM estrutura.ficha_operacao
      WHERE ficha_id = $1
      ORDER BY operacao ASC
      LIMIT 1`,
    [id]
  );
  if (ops[0]?.operacao != null) return Number(ops[0].operacao);
  return 1;
}

async function proximaOrdemFichaItem(fichaId) {
  const { rows } = await dbQuery(
    `SELECT COALESCE(MAX(ordem), 0) + 1 AS prox
       FROM estrutura.ficha_item
      WHERE ficha_id = $1`,
    [fichaId]
  );
  return Number(rows[0]?.prox) || 1;
}

async function trocarProdutoItemPorOmie(itemId, { codigo, codigo_produto: codigoProduto }) {
  await ensureSchemaEstrutura();
  const id = Number(itemId) || 0;
  if (!id) throw new Error('ID do item inválido.');

  const atual = await obterItemCompletoPorId(id);
  if (!atual) throw new Error('Item não encontrado.');

  const produtoIappId = await ensureProdutoIappFromOmie(codigo, codigoProduto);
  const omie = await buscarProdutoOmieValidado(codigo, codigoProduto);

  await dbQuery(
    `UPDATE estrutura.ficha_item
        SET produto_iapp_id = $1,
            raw = COALESCE(raw, '{}'::jsonb) || $2::jsonb
      WHERE id = $3`,
    [
      produtoIappId,
      JSON.stringify({ trocado_de: atual.meta?.produto_iapp_id, omie_codigo: omie.codigo }),
      id,
    ]
  );

  const fichaId = Number(atual.meta?.ficha_id) || 0;
  if (fichaId > 0) {
    await dbQuery(`UPDATE estrutura.ficha SET sincronizado_em = NOW() WHERE id = $1`, [fichaId]);
  }

  return obterItemCompletoPorId(id);
}

async function adicionarItemFichaPorOmie(fichaId, payload = {}) {
  await ensureSchemaEstrutura();
  const fid = Number(fichaId) || 0;
  if (!fid) throw new Error('ID da ficha inválido.');

  const { rows: fichas } = await dbQuery(
    `SELECT id FROM estrutura.ficha WHERE id = $1 LIMIT 1`,
    [fid]
  );
  if (!fichas[0]) throw new Error('Ficha não encontrada no cache SQL.');

  const produtoIappId = await ensureProdutoIappFromOmie(payload.codigo, payload.codigo_produto);
  const operacao = Number(payload.operacao) || await resolverOperacaoPadraoFicha(fid);
  const tipoRaw = String(payload.tipo || 'Material').trim();
  const tipo = /^subproduto$/i.test(tipoRaw) ? 'Subproduto' : 'Material';
  const qtde = payload.qtde == null || payload.qtde === '' ? 1 : parseValorCampo('qtde', payload.qtde);
  const ordem = await proximaOrdemFichaItem(fid);

  const { rows } = await dbQuery(
    `INSERT INTO estrutura.ficha_item (
       ficha_id, operacao, tipo, produto_iapp_id, qtde, ordem, raw
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [fid, operacao, tipo, produtoIappId, qtde, ordem, JSON.stringify({ origem: 'manual_omie' })]
  );

  await dbQuery(`UPDATE estrutura.ficha SET sincronizado_em = NOW() WHERE id = $1`, [fid]);

  const novoId = Number(rows[0]?.id) || 0;
  return {
    item_id: novoId,
    ...(await obterItemCompletoPorId(novoId)),
  };
}

async function excluirItemFicha(itemId) {
  await ensureSchemaEstrutura();
  const id = Number(itemId) || 0;
  if (!id) throw new Error('ID do item inválido.');

  const atual = await obterItemCompletoPorId(id);
  if (!atual) throw new Error('Item não encontrado.');

  const fichaId = Number(atual.meta?.ficha_id) || 0;
  await dbQuery(`DELETE FROM estrutura.ficha_item WHERE id = $1`, [id]);

  if (fichaId > 0) {
    await dbQuery(`UPDATE estrutura.ficha SET sincronizado_em = NOW() WHERE id = $1`, [fichaId]);
  }

  return { item_id: id, ficha_id: fichaId, excluido: true };
}

/** Tenta vários códigos (query, kanban, fallback) até achar cache SQL. */
async function lerEstruturaCachePorCodigos(codigos, opts = {}) {
  const vistos = new Set();
  for (const raw of codigos || []) {
    const norm = normalizarCodigo(raw);
    if (!norm || vistos.has(norm)) continue;
    vistos.add(norm);
    const hit = await lerEstruturaDoSql(norm, opts);
    if (hit?.itens?.length) return hit;
  }
  if (Number(opts.fichaId) > 0) {
    const hit = await lerEstruturaDoSql(null, { fichaId: opts.fichaId });
    if (hit?.itens?.length) return hit;
  }
  return null;
}

module.exports = {
  ensureSchemaEstrutura,
  lerEstruturaDoSql,
  lerEstruturaCachePorCodigos,
  mapItensSqlParaResposta,
  obterFichaCompletaPorId,
  atualizarFichaCompletaPorId,
  obterItemCompletoPorId,
  atualizarItemCompletoPorId,
  trocarProdutoItemPorOmie,
  adicionarItemFichaPorOmie,
  excluirItemFicha,
};
