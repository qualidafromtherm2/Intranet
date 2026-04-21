BEGIN;

CREATE SCHEMA IF NOT EXISTS "Vendas";

CREATE TABLE IF NOT EXISTS "Vendas".notas_fiscais_omie (
  id BIGSERIAL PRIMARY KEY,
  identidade TEXT NOT NULL UNIQUE,
  tipo_documento VARCHAR(10) NOT NULL,
  topic_ultimo VARCHAR(100) NOT NULL,
  status_ultimo VARCHAR(40) NOT NULL,
  numero_nota VARCHAR(40),
  chave_nfe VARCHAR(60),
  numero_pedido VARCHAR(40),
  valor_total NUMERIC(18,2),
  cnpj_emitente VARCHAR(20),
  razao_emitente VARCHAR(200),
  data_emissao VARCHAR(40),
  message_id_ultimo VARCHAR(120),
  author_ultimo VARCHAR(120),
  payload_ultimo JSONB,
  ativa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notas_fiscais_omie_numero ON "Vendas".notas_fiscais_omie(numero_nota);
CREATE INDEX IF NOT EXISTS idx_notas_fiscais_omie_chave ON "Vendas".notas_fiscais_omie(chave_nfe);
CREATE INDEX IF NOT EXISTS idx_notas_fiscais_omie_pedido ON "Vendas".notas_fiscais_omie(numero_pedido);
CREATE INDEX IF NOT EXISTS idx_notas_fiscais_omie_topic ON "Vendas".notas_fiscais_omie(topic_ultimo);

CREATE TABLE IF NOT EXISTS "Vendas".notas_fiscais_omie_eventos (
  id BIGSERIAL PRIMARY KEY,
  identidade TEXT,
  tipo_documento VARCHAR(10),
  topic VARCHAR(100) NOT NULL,
  status VARCHAR(40),
  numero_nota VARCHAR(40),
  chave_nfe VARCHAR(60),
  numero_pedido VARCHAR(40),
  message_id VARCHAR(120),
  author VARCHAR(120),
  payload JSONB,
  recebido_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  processado_com_sucesso BOOLEAN,
  erro TEXT
);

CREATE INDEX IF NOT EXISTS idx_notas_fiscais_omie_eventos_topic ON "Vendas".notas_fiscais_omie_eventos(topic);
CREATE INDEX IF NOT EXISTS idx_notas_fiscais_omie_eventos_numero ON "Vendas".notas_fiscais_omie_eventos(numero_nota);
CREATE INDEX IF NOT EXISTS idx_notas_fiscais_omie_eventos_chave ON "Vendas".notas_fiscais_omie_eventos(chave_nfe);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notas_fiscais_omie_eventos_message_topic
  ON "Vendas".notas_fiscais_omie_eventos(message_id, topic)
  WHERE message_id IS NOT NULL;

COMMIT;
