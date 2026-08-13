-- RH — Catálogo, solicitação e enriquecimento de entregas de EPI
-- Base: RELAÇÃO DE EPI-FROMTHERM + FT-M00-FCEPI (Ficha de controle)

CREATE SCHEMA IF NOT EXISTS rh;

-- Catálogo de EPIs (descrição + C.A.)
CREATE TABLE IF NOT EXISTS rh.epi_catalogo (
  id            SERIAL PRIMARY KEY,
  descricao     VARCHAR(255) NOT NULL,
  ca            VARCHAR(50),
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_epi_catalogo_desc_ca
  ON rh.epi_catalogo (LOWER(descricao), COALESCE(ca, ''));

-- EPIs sugeridos por cargo/função (relação da planilha)
CREATE TABLE IF NOT EXISTS rh.epi_cargo (
  id               SERIAL PRIMARY KEY,
  cargo_nome       VARCHAR(255) NOT NULL,
  epi_catalogo_id  INTEGER NOT NULL REFERENCES rh.epi_catalogo(id) ON DELETE CASCADE,
  ativo            BOOLEAN NOT NULL DEFAULT TRUE,
  ordem            INTEGER NOT NULL DEFAULT 0,
  UNIQUE (cargo_nome, epi_catalogo_id)
);

ALTER TABLE rh.epi_cargo ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE rh.epi_cargo ADD COLUMN IF NOT EXISTS ordem INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_epi_cargo_nome ON rh.epi_cargo (LOWER(cargo_nome));

-- Solicitação de EPI
CREATE TABLE IF NOT EXISTS rh.epi_solicitacao (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES public.auth_user(id) ON DELETE CASCADE,
  cargo_funcao    VARCHAR(255),
  status          VARCHAR(30) NOT NULL DEFAULT 'aberta',
  observacao      TEXT,
  solicitado_por  VARCHAR(100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_epi_solicitacao_user ON rh.epi_solicitacao(user_id);
CREATE INDEX IF NOT EXISTS idx_epi_solicitacao_status ON rh.epi_solicitacao(status);

ALTER TABLE rh.epi_solicitacao ADD COLUMN IF NOT EXISTS assinatura_url TEXT;
ALTER TABLE rh.epi_solicitacao ADD COLUMN IF NOT EXISTS assinatura_path TEXT;
ALTER TABLE rh.epi_solicitacao ADD COLUMN IF NOT EXISTS assinado_em TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS rh.epi_solicitacao_item (
  id               SERIAL PRIMARY KEY,
  solicitacao_id   INTEGER NOT NULL REFERENCES rh.epi_solicitacao(id) ON DELETE CASCADE,
  epi_catalogo_id  INTEGER REFERENCES rh.epi_catalogo(id) ON DELETE SET NULL,
  descricao        VARCHAR(255) NOT NULL,
  ca               VARCHAR(50),
  quantidade       INTEGER NOT NULL DEFAULT 1,
  tamanho          VARCHAR(30),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_epi_solicitacao_item_sol ON rh.epi_solicitacao_item(solicitacao_id);

-- Produtos do cadastro vinculados a cada tipo de EPI (ex.: vários óculos em "Óculos de proteção")
CREATE TABLE IF NOT EXISTS rh.epi_catalogo_produto (
  id               SERIAL PRIMARY KEY,
  epi_catalogo_id  INTEGER NOT NULL REFERENCES rh.epi_catalogo(id) ON DELETE CASCADE,
  codigo           VARCHAR(120) NOT NULL,
  codigo_produto   VARCHAR(120),
  descricao        VARCHAR(500),
  url_imagem       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (epi_catalogo_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_epi_catalogo_produto_cat ON rh.epi_catalogo_produto(epi_catalogo_id);

-- Enriquecer ficha de entrega (FT-M00-FCEPI)
ALTER TABLE rh.epi_entrega ADD COLUMN IF NOT EXISTS ca VARCHAR(50);
ALTER TABLE rh.epi_entrega ADD COLUMN IF NOT EXISTS quantidade INTEGER DEFAULT 1;
ALTER TABLE rh.epi_entrega ADD COLUMN IF NOT EXISTS data_devolucao DATE;
ALTER TABLE rh.epi_entrega ADD COLUMN IF NOT EXISTS epi_catalogo_id INTEGER;
ALTER TABLE rh.epi_entrega ADD COLUMN IF NOT EXISTS solicitacao_id INTEGER;
ALTER TABLE rh.epi_entrega ADD COLUMN IF NOT EXISTS codigo_item VARCHAR(50);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'epi_entrega_epi_catalogo_id_fkey'
  ) THEN
    ALTER TABLE rh.epi_entrega
      ADD CONSTRAINT epi_entrega_epi_catalogo_id_fkey
      FOREIGN KEY (epi_catalogo_id) REFERENCES rh.epi_catalogo(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'epi_entrega_solicitacao_id_fkey'
  ) THEN
    ALTER TABLE rh.epi_entrega
      ADD CONSTRAINT epi_entrega_solicitacao_id_fkey
      FOREIGN KEY (solicitacao_id) REFERENCES rh.epi_solicitacao(id) ON DELETE SET NULL;
  END IF;
END $$;
