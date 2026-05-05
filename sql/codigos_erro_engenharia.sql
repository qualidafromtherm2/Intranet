-- Tabela: engenharia.codigos_erro
-- Criado em: 2026-05-05
-- Armazena códigos de erros de produtos/sistemas com análise e solução

CREATE TABLE IF NOT EXISTS engenharia.codigos_erro (
  id              SERIAL PRIMARY KEY,
  codigo          TEXT        NOT NULL,
  analise         TEXT,
  solucao_problema TEXT,
  anexos          TEXT,
  fotos           TEXT,
  criado_por      TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para busca rápida por código
CREATE INDEX IF NOT EXISTS idx_codigos_erro_codigo
  ON engenharia.codigos_erro (codigo);

COMMENT ON TABLE engenharia.codigos_erro IS
  'Catálogo de códigos de erro com análise, solução, anexos e fotos para consulta interna.';

COMMENT ON COLUMN engenharia.codigos_erro.codigo          IS 'Código do erro (ex.: E001, F-102)';
COMMENT ON COLUMN engenharia.codigos_erro.analise         IS 'Análise técnica da causa do erro';
COMMENT ON COLUMN engenharia.codigos_erro.solucao_problema IS 'Procedimento de solução do problema';
COMMENT ON COLUMN engenharia.codigos_erro.anexos          IS 'URLs ou referências de arquivos anexados';
COMMENT ON COLUMN engenharia.codigos_erro.fotos           IS 'URLs de fotos relacionadas ao erro';
COMMENT ON COLUMN engenharia.codigos_erro.criado_por      IS 'Usuário que cadastrou o registro';
