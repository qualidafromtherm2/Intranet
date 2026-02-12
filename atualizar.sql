-- Objetivo: criar e popular tabelas de Departamentos e Categorias no schema configuracoes.
-- Observação: este script é idempotente (pode ser executado várias vezes).

BEGIN;

-- Garante o schema configuracoes
CREATE SCHEMA IF NOT EXISTS configuracoes;

-- Tabela de departamentos
CREATE TABLE IF NOT EXISTS configuracoes.departamento (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabela de categorias por departamento
CREATE TABLE IF NOT EXISTS configuracoes.categoria_departamento (
  id SERIAL PRIMARY KEY,
  departamento_id INTEGER NOT NULL REFERENCES configuracoes.departamento(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (departamento_id, nome)
);

-- Tabela de subitens por categoria
CREATE TABLE IF NOT EXISTS configuracoes.subitem_departamento (
  id SERIAL PRIMARY KEY,
  categoria_id INTEGER NOT NULL REFERENCES configuracoes.categoria_departamento(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (categoria_id, nome)
);

-- Seed: departamentos
INSERT INTO configuracoes.departamento (nome)
VALUES
  ('Administrativo'),
  ('Comercial'),
  ('Produção')
ON CONFLICT (nome) DO NOTHING;

-- Seed: categorias por departamento
-- Administrativo
INSERT INTO configuracoes.categoria_departamento (departamento_id, nome, ordem)
SELECT d.id, c.nome, c.ordem
FROM configuracoes.departamento d
JOIN (VALUES
  ('Predial', 1),
  ('Imobilizados', 2),
  ('Móveis e Utensilios', 3),
  ('Tecnologia da informação', 4),
  ('Serviços administrativos', 5),
  ('Recursos Humanos', 6),
  ('Suprimentos administrativos', 7)
) AS c(nome, ordem) ON TRUE
WHERE d.nome = 'Administrativo'
ON CONFLICT (departamento_id, nome) DO NOTHING;

-- Comercial
INSERT INTO configuracoes.categoria_departamento (departamento_id, nome, ordem)
SELECT d.id, c.nome, c.ordem
FROM configuracoes.departamento d
JOIN (VALUES
  ('Vendas', 1),
  ('Visitas/Treinamentos', 2),
  ('Materiais', 3),
  ('Eventos comerciais', 4),
  ('Outros', 5)
) AS c(nome, ordem) ON TRUE
WHERE d.nome = 'Comercial'
ON CONFLICT (departamento_id, nome) DO NOTHING;

-- Produção
INSERT INTO configuracoes.categoria_departamento (departamento_id, nome, ordem)
SELECT d.id, c.nome, c.ordem
FROM configuracoes.departamento d
JOIN (VALUES
  ('Certificação e qualidade', 1),
  ('Engenharia', 2),
  ('Ferramentas', 3),
  ('Investimento na produção', 4),
  ('Manutenção', 5),
  ('Maquinas e equipamentos', 6),
  ('Materia prima', 7),
  ('Outros', 8),
  ('P&D', 9)
) AS c(nome, ordem) ON TRUE
WHERE d.nome = 'Produção'
ON CONFLICT (departamento_id, nome) DO NOTHING;

COMMIT;
