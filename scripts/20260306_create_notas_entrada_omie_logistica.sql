-- ============================================================================
-- Tabelas de controle de Notas de Entrada (Omie) no schema logistica
-- Data: 2026-03-06
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS logistica;

CREATE TABLE IF NOT EXISTS logistica.notas_entrada_omie (
    id BIGSERIAL PRIMARY KEY,
    n_id_receb BIGINT,
    c_chave_nfe VARCHAR(50),
    c_numero_nfe VARCHAR(20),
    c_serie_nfe VARCHAR(10),
    c_modelo_nfe VARCHAR(10),
    d_emissao_nfe DATE,
    d_entrada DATE,
    d_registro DATE,
    n_valor_nfe NUMERIC(15,2),
    n_id_fornecedor BIGINT,
    c_nome_fornecedor VARCHAR(200),
    c_cnpj_cpf_fornecedor VARCHAR(20),
    c_etapa VARCHAR(20),
    c_desc_etapa VARCHAR(100),
    c_status VARCHAR(20) NOT NULL DEFAULT 'Incluida',
    c_ultimo_topico VARCHAR(100),
    message_id_ultimo VARCHAR(120),
    d_ultima_ocorrencia TIMESTAMP WITHOUT TIME ZONE,
    c_origem_ultimo_evento VARCHAR(40) NOT NULL DEFAULT 'omie',
    c_ativo BOOLEAN NOT NULL DEFAULT TRUE,
    snapshot JSONB,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_notas_entrada_omie_status
      CHECK (c_status IN ('Incluida', 'Alterada', 'Concluida', 'Cancelada', 'Excluida', 'Desconhecida', 'Sincronizada')),
    CONSTRAINT uq_notas_entrada_omie_n_id_receb UNIQUE (n_id_receb),
    CONSTRAINT uq_notas_entrada_omie_chave_nfe UNIQUE (c_chave_nfe)
);

CREATE INDEX IF NOT EXISTS idx_notas_entrada_omie_chave ON logistica.notas_entrada_omie(c_chave_nfe);
CREATE INDEX IF NOT EXISTS idx_notas_entrada_omie_numero ON logistica.notas_entrada_omie(c_numero_nfe);
CREATE INDEX IF NOT EXISTS idx_notas_entrada_omie_fornecedor ON logistica.notas_entrada_omie(n_id_fornecedor);
CREATE INDEX IF NOT EXISTS idx_notas_entrada_omie_status ON logistica.notas_entrada_omie(c_status);
CREATE INDEX IF NOT EXISTS idx_notas_entrada_omie_ultima_ocorrencia ON logistica.notas_entrada_omie(d_ultima_ocorrencia DESC);

CREATE TABLE IF NOT EXISTS logistica.notas_entrada_omie_eventos (
    id BIGSERIAL PRIMARY KEY,
    n_id_receb BIGINT,
    c_chave_nfe VARCHAR(50),
    topic VARCHAR(100) NOT NULL,
    c_status VARCHAR(20),
    message_id VARCHAR(120),
    author VARCHAR(120),
    payload JSONB,
    origem_evento VARCHAR(40) NOT NULL DEFAULT 'omie',
    recebido_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    processado_em TIMESTAMP WITHOUT TIME ZONE,
    processado_com_sucesso BOOLEAN,
    erro TEXT,
    CONSTRAINT ck_notas_entrada_eventos_status
      CHECK (c_status IS NULL OR c_status IN ('Incluida', 'Alterada', 'Concluida', 'Cancelada', 'Excluida', 'Desconhecida', 'Sincronizada'))
);

CREATE INDEX IF NOT EXISTS idx_notas_entrada_eventos_receb ON logistica.notas_entrada_omie_eventos(n_id_receb);
CREATE INDEX IF NOT EXISTS idx_notas_entrada_eventos_chave ON logistica.notas_entrada_omie_eventos(c_chave_nfe);
CREATE INDEX IF NOT EXISTS idx_notas_entrada_eventos_topic ON logistica.notas_entrada_omie_eventos(topic);
CREATE INDEX IF NOT EXISTS idx_notas_entrada_eventos_recebido_em ON logistica.notas_entrada_omie_eventos(recebido_em DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notas_entrada_eventos_message_topic
    ON logistica.notas_entrada_omie_eventos(message_id, topic)
    WHERE message_id IS NOT NULL;

COMMENT ON TABLE logistica.notas_entrada_omie IS 'Estado atual das notas de entrada da Omie (eventos NotaEntrada.* e RecebimentoProduto.*)';
COMMENT ON TABLE logistica.notas_entrada_omie_eventos IS 'Historico de eventos de nota de entrada recebidos por webhook';

-- ============================================================================
-- Backfill inicial a partir da tabela de recebimentos ja sincronizada da Omie
-- ============================================================================
INSERT INTO logistica.notas_entrada_omie (
    n_id_receb,
    c_chave_nfe,
    c_numero_nfe,
    c_serie_nfe,
    c_modelo_nfe,
    d_emissao_nfe,
    d_entrada,
    d_registro,
    n_valor_nfe,
    n_id_fornecedor,
    c_nome_fornecedor,
    c_cnpj_cpf_fornecedor,
    c_etapa,
    c_desc_etapa,
    c_status,
    c_ultimo_topico,
    d_ultima_ocorrencia,
    c_origem_ultimo_evento,
    c_ativo,
    snapshot,
    updated_at
)
SELECT
    r.n_id_receb,
    NULLIF(BTRIM(r.c_chave_nfe), ''),
    NULLIF(BTRIM(r.c_numero_nfe), ''),
    NULLIF(BTRIM(r.c_serie_nfe), ''),
    NULLIF(BTRIM(r.c_modelo_nfe), ''),
    r.d_emissao_nfe,
    r.d_entrada,
    r.d_registro,
    r.n_valor_nfe,
    r.n_id_fornecedor,
    NULLIF(BTRIM(r.c_nome_fornecedor), ''),
    NULLIF(BTRIM(r.c_cnpj_cpf_fornecedor), ''),
    NULLIF(BTRIM(r.c_etapa), ''),
    NULLIF(BTRIM(r.c_desc_etapa), ''),
    CASE
      WHEN COALESCE(BTRIM(r.c_cancelada), 'N') = 'S' THEN 'Cancelada'
      WHEN COALESCE(BTRIM(r.c_etapa), '') IN ('60', '80', '100') OR COALESCE(BTRIM(r.c_recebido), 'N') = 'S' THEN 'Concluida'
      ELSE 'Incluida'
    END,
    'bootstrap.recebimentos_nfe_omie',
    NOW(),
    'bootstrap',
    CASE
      WHEN COALESCE(BTRIM(r.c_cancelada), 'N') = 'S' THEN FALSE
      ELSE TRUE
    END,
    jsonb_strip_nulls(jsonb_build_object(
      'n_id_receb', r.n_id_receb,
      'c_chave_nfe', r.c_chave_nfe,
      'c_numero_nfe', r.c_numero_nfe,
      'c_etapa', r.c_etapa,
      'c_desc_etapa', r.c_desc_etapa,
      'n_valor_nfe', r.n_valor_nfe,
      'n_id_fornecedor', r.n_id_fornecedor,
      'c_nome_fornecedor', r.c_nome_fornecedor
    )),
    NOW()
FROM logistica.recebimentos_nfe_omie r
ON CONFLICT (n_id_receb) DO UPDATE
SET
    c_chave_nfe = COALESCE(EXCLUDED.c_chave_nfe, logistica.notas_entrada_omie.c_chave_nfe),
    c_numero_nfe = COALESCE(EXCLUDED.c_numero_nfe, logistica.notas_entrada_omie.c_numero_nfe),
    c_serie_nfe = COALESCE(EXCLUDED.c_serie_nfe, logistica.notas_entrada_omie.c_serie_nfe),
    c_modelo_nfe = COALESCE(EXCLUDED.c_modelo_nfe, logistica.notas_entrada_omie.c_modelo_nfe),
    d_emissao_nfe = COALESCE(EXCLUDED.d_emissao_nfe, logistica.notas_entrada_omie.d_emissao_nfe),
    d_entrada = COALESCE(EXCLUDED.d_entrada, logistica.notas_entrada_omie.d_entrada),
    d_registro = COALESCE(EXCLUDED.d_registro, logistica.notas_entrada_omie.d_registro),
    n_valor_nfe = COALESCE(EXCLUDED.n_valor_nfe, logistica.notas_entrada_omie.n_valor_nfe),
    n_id_fornecedor = COALESCE(EXCLUDED.n_id_fornecedor, logistica.notas_entrada_omie.n_id_fornecedor),
    c_nome_fornecedor = COALESCE(EXCLUDED.c_nome_fornecedor, logistica.notas_entrada_omie.c_nome_fornecedor),
    c_cnpj_cpf_fornecedor = COALESCE(EXCLUDED.c_cnpj_cpf_fornecedor, logistica.notas_entrada_omie.c_cnpj_cpf_fornecedor),
    c_etapa = COALESCE(EXCLUDED.c_etapa, logistica.notas_entrada_omie.c_etapa),
    c_desc_etapa = COALESCE(EXCLUDED.c_desc_etapa, logistica.notas_entrada_omie.c_desc_etapa),
    c_status = EXCLUDED.c_status,
    c_ultimo_topico = EXCLUDED.c_ultimo_topico,
    d_ultima_ocorrencia = EXCLUDED.d_ultima_ocorrencia,
    c_origem_ultimo_evento = EXCLUDED.c_origem_ultimo_evento,
    c_ativo = EXCLUDED.c_ativo,
    snapshot = COALESCE(EXCLUDED.snapshot, logistica.notas_entrada_omie.snapshot),
    updated_at = NOW();

INSERT INTO logistica.notas_entrada_omie_eventos (
    n_id_receb,
    c_chave_nfe,
    topic,
    c_status,
    payload,
    origem_evento,
    recebido_em,
    processado_em,
    processado_com_sucesso
)
SELECT
    n.n_id_receb,
    n.c_chave_nfe,
    'bootstrap.recebimentos_nfe_omie',
    n.c_status,
    jsonb_build_object('source', 'logistica.recebimentos_nfe_omie', 'n_id_receb', n.n_id_receb),
    'bootstrap',
    NOW(),
    NOW(),
    TRUE
FROM logistica.notas_entrada_omie n
WHERE NOT EXISTS (
    SELECT 1
    FROM logistica.notas_entrada_omie_eventos e
    WHERE e.n_id_receb = n.n_id_receb
      AND e.topic = 'bootstrap.recebimentos_nfe_omie'
);
