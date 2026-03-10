CREATE SCHEMA IF NOT EXISTS rh;

CREATE TABLE IF NOT EXISTS rh.links_rapidos (
  id BIGSERIAL PRIMARY KEY,
  nome_link TEXT NOT NULL,
  url_link TEXT NOT NULL,
  criado_por TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS links_rapidos_url_unq
  ON rh.links_rapidos (url_link);
