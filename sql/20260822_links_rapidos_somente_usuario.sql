-- Links rápidos: opção de atalho particular (visível só para quem cadastrou)

ALTER TABLE rh.links_rapidos
  ADD COLUMN IF NOT EXISTS somente_usuario BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN rh.links_rapidos.somente_usuario IS
  'Quando TRUE, o atalho aparece somente para o usuário que cadastrou. FALSE = visível para todos.';

DROP INDEX IF EXISTS rh.links_rapidos_url_unq;

CREATE UNIQUE INDEX IF NOT EXISTS links_rapidos_url_publico_unq
  ON rh.links_rapidos (url_link)
  WHERE NOT somente_usuario;

CREATE UNIQUE INDEX IF NOT EXISTS links_rapidos_url_privado_user_unq
  ON rh.links_rapidos (url_link, criado_por)
  WHERE somente_usuario;
