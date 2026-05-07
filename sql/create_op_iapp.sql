-- =============================================================
-- Cache de Ordens de Produção — API IAPP
-- Schema: IAPP_API  (separado do schema public)
--
--   op_iapp_produto   Cadastro de produtos (1 linha por produto único)
--   op_iapp           Ordens de Produção   (N OPs por produto)
--   op_iapp_os        Ordens de Serviço    (N OSs por OP)
--
-- Populado via POST /api/producao/sync (manual/agendado)
-- Leitura via GET  /api/producao/ordens (sem sync automático)
-- =============================================================

CREATE SCHEMA IF NOT EXISTS "IAPP_API";

-- -------------------------------------------------------------
-- 1. PRODUTOS
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "IAPP_API".op_iapp_produto (
  produto_id            INTEGER       NOT NULL PRIMARY KEY,  -- produto.id
  identificacao         TEXT,                                -- produto.identificacao (código)
  descricao             TEXT,                                -- produto.descricao
  unidade_medida        TEXT,                                -- produto.unidade_medida
  ean                   TEXT,                                -- produto.ean
  tipo                  TEXT,                                -- produto.tipo
  origem                TEXT,                                -- produto.origem
  ncm                   TEXT,                                -- produto.ncm
  cest                  TEXT,                                -- produto.cest
  status                TEXT,                                -- produto.status ("ativo" etc.)

  -- Valores
  valor_venda           NUMERIC(18,6),
  valor_custo           NUMERIC(18,6),
  lucro_pretendido      NUMERIC(18,4),

  -- Dimensões / peso
  altura                NUMERIC(12,4),
  largura               NUMERIC(12,4),
  comprimento           NUMERIC(12,4),
  peso_bruto            NUMERIC(12,4),
  peso_liquido          NUMERIC(12,4),
  peso_tara             NUMERIC(12,4),
  area                  NUMERIC(12,4),
  diametro              NUMERIC(12,4),

  -- Embalagem / estoque
  qtde_volume           NUMERIC(12,4),
  tipo_volume           TEXT,
  qtde_embalagem        NUMERIC(12,4),
  tipo_embalagem        TEXT,
  lote_minimo_compra    NUMERIC(12,4),
  maximo_empilhamentos  NUMERIC(12,4),
  qtde_seguranca        NUMERIC(12,4),
  qtde_minima           NUMERIC(12,4),

  -- Grupo / classificação
  grupo_id              INTEGER,
  grupo_identificacao   TEXT,
  grupo_descricao       TEXT,

  -- Datas
  data_ultima_atualizacao  TIMESTAMP,

  -- Controle
  sincronizado_em  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iapp_produto_ident  ON "IAPP_API".op_iapp_produto (identificacao);
CREATE INDEX IF NOT EXISTS idx_iapp_produto_tipo   ON "IAPP_API".op_iapp_produto (tipo);
CREATE INDEX IF NOT EXISTS idx_iapp_produto_status ON "IAPP_API".op_iapp_produto (status);


-- -------------------------------------------------------------
-- 2. ORDENS DE PRODUÇÃO (item pai)
-- Chave: id da OP no IAPP.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "IAPP_API".op_iapp (
  iapp_id               INTEGER       NOT NULL PRIMARY KEY,  -- OP.id
  identificacao         TEXT,                                -- ex: "0002394"
  status                TEXT,                                -- "A PRODUZIR", "PRODUZINDO", "ENCERRADO" …

  -- Referências
  produto_id            INTEGER  REFERENCES "IAPP_API".op_iapp_produto (produto_id) ON DELETE SET NULL,
  ficha_tecnica         INTEGER,                             -- id da ficha técnica no IAPP
  linha_producao        INTEGER,                             -- id da linha de produção no IAPP

  -- Quantidades
  qtde                  NUMERIC(18,4),
  tempo_total           NUMERIC(18,4),

  -- Observações e links opcionais (mantidos como JSONB pois variam)
  obs                   TEXT,
  cliente               JSONB,   -- objeto cliente quando vinculado
  projeto               JSONB,   -- objeto projeto quando vinculado
  origem                JSONB,   -- origem da OP
  documento             JSONB,   -- documento vinculado

  -- Datas
  data_abertura              TIMESTAMP,
  data_inicio                TIMESTAMP,
  data_final                 TIMESTAMP,
  data_encerramento          TIMESTAMP,
  data_previsao_faturamento  TIMESTAMP,
  data_previsao_entrega      TIMESTAMP,
  data_ultima_atualizacao    TIMESTAMP,

  -- Controle
  sincronizado_em  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iapp_op_status          ON "IAPP_API".op_iapp (status);
CREATE INDEX IF NOT EXISTS idx_iapp_op_produto_id      ON "IAPP_API".op_iapp (produto_id);
CREATE INDEX IF NOT EXISTS idx_iapp_op_data_abertura   ON "IAPP_API".op_iapp (data_abertura DESC);
CREATE INDEX IF NOT EXISTS idx_iapp_op_ult_atualizacao ON "IAPP_API".op_iapp (data_ultima_atualizacao DESC);


-- -------------------------------------------------------------
-- 3. ORDENS DE SERVIÇO (itens filhos da OP)
-- Chave: id da OS no IAPP.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "IAPP_API".op_iapp_os (
  os_id                 INTEGER       NOT NULL PRIMARY KEY,  -- OS.id
  op_iapp_id            INTEGER       NOT NULL REFERENCES "IAPP_API".op_iapp (iapp_id) ON DELETE CASCADE,

  identificacao         TEXT,   -- ex: "0002394.01"
  status                TEXT,   -- "ABERTA", "EM ANDAMENTO", "ENCERRADA" …
  operacao              TEXT,   -- nome da operação ("MONTAGEM", "TESTE FINAL" …)

  -- Equipamento
  grupo_equipamentos    JSONB,
  equipamento           JSONB,

  -- Projeto vinculado
  projeto               JSONB,

  -- Tempo
  tempo_total           NUMERIC(18,4),

  -- Datas
  data_abertura         TIMESTAMP,
  data_inicio           TIMESTAMP,
  data_final            TIMESTAMP,
  data_encerramento     TIMESTAMP,
  data_ultima_atualizacao TIMESTAMP,

  -- Controle
  sincronizado_em  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iapp_os_op_id  ON "IAPP_API".op_iapp_os (op_iapp_id);
CREATE INDEX IF NOT EXISTS idx_iapp_os_status ON "IAPP_API".op_iapp_os (status);

