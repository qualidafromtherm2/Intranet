BEGIN;

CREATE TABLE IF NOT EXISTS compras.cotacoes_itens (
  id SERIAL PRIMARY KEY,
  cotacao_id INTEGER NOT NULL REFERENCES compras.cotacoes(id) ON DELETE CASCADE,
  item_origem_id INTEGER NOT NULL,
  grupo_requisicao TEXT,
  table_source TEXT NOT NULL DEFAULT 'solicitacao_compras',
  produto_codigo TEXT,
  produto_descricao TEXT,
  quantidade NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (cotacao_id, item_origem_id, table_source)
);

CREATE INDEX IF NOT EXISTS idx_cotacoes_itens_cotacao
  ON compras.cotacoes_itens(cotacao_id);

CREATE INDEX IF NOT EXISTS idx_cotacoes_itens_origem
  ON compras.cotacoes_itens(item_origem_id, table_source);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'compras'
      AND table_name = 'cotacoes'
      AND column_name = 'moeda'
  ) THEN
    ALTER TABLE compras.cotacoes
      ADD COLUMN moeda VARCHAR(3) NOT NULL DEFAULT 'BRL'
      CHECK (moeda IN ('BRL', 'USD'));
  END IF;
END $$;

COMMIT;
