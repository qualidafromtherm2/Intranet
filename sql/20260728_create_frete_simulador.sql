BEGIN;

CREATE SCHEMA IF NOT EXISTS frete;

CREATE TABLE IF NOT EXISTS frete.transportadora (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  cnpj TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  observacao TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS frete.tabela_preco (
  id BIGSERIAL PRIMARY KEY,
  transportadora_id BIGINT NOT NULL REFERENCES frete.transportadora(id),
  nome TEXT NOT NULL,
  versao TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'em_revisao', 'ativa', 'inativa')),
  vigencia_inicio DATE,
  vigencia_fim DATE,
  origem_cep INTEGER,
  origem_cidade TEXT,
  origem_uf CHAR(2),
  fator_cubagem_kg_m3 NUMERIC(12,4) NOT NULL DEFAULT 300,
  moeda CHAR(3) NOT NULL DEFAULT 'BRL',
  arquivo_origem TEXT,
  arquivo_sha256 TEXT,
  configuracao JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transportadora_id, versao)
);

CREATE TABLE IF NOT EXISTS frete.importacao (
  id BIGSERIAL PRIMARY KEY,
  tabela_preco_id BIGINT REFERENCES frete.tabela_preco(id) ON DELETE CASCADE,
  arquivo_nome TEXT NOT NULL,
  arquivo_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processando'
    CHECK (status IN ('processando', 'concluida', 'concluida_com_alertas', 'falhou')),
  total_linhas INTEGER NOT NULL DEFAULT 0,
  linhas_validas INTEGER NOT NULL DEFAULT 0,
  linhas_alerta INTEGER NOT NULL DEFAULT 0,
  resumo JSONB NOT NULL DEFAULT '{}'::jsonb,
  erro TEXT,
  criado_por BIGINT REFERENCES public.auth_user(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluido_em TIMESTAMPTZ,
  UNIQUE (arquivo_sha256)
);

CREATE TABLE IF NOT EXISTS frete.importacao_linha (
  id BIGSERIAL PRIMARY KEY,
  importacao_id BIGINT NOT NULL REFERENCES frete.importacao(id) ON DELETE CASCADE,
  aba TEXT NOT NULL,
  numero_linha INTEGER NOT NULL,
  dados JSONB NOT NULL,
  valido BOOLEAN NOT NULL DEFAULT TRUE,
  alertas JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (importacao_id, aba, numero_linha)
);

CREATE TABLE IF NOT EXISTS frete.cobertura (
  id BIGSERIAL PRIMARY KEY,
  tabela_preco_id BIGINT NOT NULL REFERENCES frete.tabela_preco(id) ON DELETE CASCADE,
  codigo_regiao TEXT,
  uf CHAR(2) NOT NULL,
  cidade TEXT,
  cidade_normalizada TEXT,
  codigo_ibge BIGINT,
  cep_inicio INTEGER,
  cep_fim INTEGER,
  prazo_min_dias INTEGER,
  prazo_max_dias INTEGER,
  frequencia TEXT,
  atendida BOOLEAN NOT NULL DEFAULT TRUE,
  tde NUMERIC(14,4),
  trt NUMERIC(14,4),
  observacao TEXT,
  metadados JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (cep_inicio IS NULL OR cep_inicio BETWEEN 1000000 AND 99999999),
  CHECK (cep_fim IS NULL OR cep_fim BETWEEN 1000000 AND 99999999),
  CHECK (cep_inicio IS NULL OR cep_fim IS NULL OR cep_inicio <= cep_fim)
);

CREATE INDEX IF NOT EXISTS frete_cobertura_cep_idx
  ON frete.cobertura (tabela_preco_id, cep_inicio, cep_fim)
  WHERE cep_inicio IS NOT NULL AND cep_fim IS NOT NULL;
CREATE INDEX IF NOT EXISTS frete_cobertura_cidade_idx
  ON frete.cobertura (tabela_preco_id, uf, cidade_normalizada);
CREATE INDEX IF NOT EXISTS frete_cobertura_regiao_idx
  ON frete.cobertura (tabela_preco_id, codigo_regiao);

CREATE TABLE IF NOT EXISTS frete.tarifa_faixa (
  id BIGSERIAL PRIMARY KEY,
  tabela_preco_id BIGINT NOT NULL REFERENCES frete.tabela_preco(id) ON DELETE CASCADE,
  codigo_regiao TEXT,
  uf_destino CHAR(2),
  cidade_normalizada TEXT,
  peso_de_kg NUMERIC(14,4) NOT NULL DEFAULT 0,
  peso_ate_kg NUMERIC(14,4),
  valor_base NUMERIC(14,4) NOT NULL DEFAULT 0,
  valor_kg_excedente NUMERIC(14,6),
  peso_referencia_excedente_kg NUMERIC(14,4),
  frete_minimo NUMERIC(14,4),
  ad_valorem_aliquota NUMERIC(14,8),
  taxa_despacho NUMERIC(14,4),
  pedagio_por_100kg NUMERIC(14,4),
  prioridade INTEGER NOT NULL DEFAULT 100,
  metadados JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (peso_de_kg >= 0),
  CHECK (peso_ate_kg IS NULL OR peso_ate_kg >= peso_de_kg)
);

CREATE INDEX IF NOT EXISTS frete_tarifa_faixa_busca_idx
  ON frete.tarifa_faixa (tabela_preco_id, codigo_regiao, peso_de_kg, peso_ate_kg, prioridade);

CREATE TABLE IF NOT EXISTS frete.regra_adicional (
  id BIGSERIAL PRIMARY KEY,
  tabela_preco_id BIGINT NOT NULL REFERENCES frete.tabela_preco(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  nome TEXT NOT NULL,
  tipo_calculo TEXT NOT NULL
    CHECK (tipo_calculo IN ('fixo', 'percentual_mercadoria', 'percentual_frete', 'por_100kg', 'por_kg', 'maior_entre_percentual_e_minimo')),
  valor NUMERIC(16,8) NOT NULL,
  valor_minimo NUMERIC(14,4),
  valor_maximo NUMERIC(14,4),
  condicoes JSONB NOT NULL DEFAULT '{}'::jsonb,
  prioridade INTEGER NOT NULL DEFAULT 100,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  observacao TEXT,
  UNIQUE (tabela_preco_id, codigo)
);

CREATE TABLE IF NOT EXISTS frete.configuracao (
  chave TEXT PRIMARY KEY,
  valor JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_por BIGINT REFERENCES public.auth_user(id)
);

INSERT INTO frete.configuracao (chave, valor)
VALUES (
  'origem_padrao',
  '{"cep":"88164-275","cidade":"Biguaçu","uf":"SC","logradouro":"Rua Edgard Hoffmann","numero":"699"}'::jsonb
)
ON CONFLICT (chave) DO NOTHING;

CREATE TABLE IF NOT EXISTS frete.municipio (
  codigo_ibge BIGINT PRIMARY KEY,
  uf CHAR(2) NOT NULL,
  nome TEXT NOT NULL,
  nome_normalizado TEXT NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS frete_municipio_uf_nome_idx
  ON frete.municipio (uf, nome_normalizado);

CREATE TABLE IF NOT EXISTS frete.cotacao (
  id BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT REFERENCES public.auth_user(id),
  origem_cep INTEGER,
  origem_cidade TEXT,
  origem_uf CHAR(2),
  destino_cep INTEGER,
  destino_cidade TEXT NOT NULL,
  destino_uf CHAR(2) NOT NULL,
  valor_mercadoria NUMERIC(16,2) NOT NULL DEFAULT 0,
  peso_real_kg NUMERIC(16,4) NOT NULL,
  volume_m3 NUMERIC(16,6) NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS frete.cotacao_item (
  id BIGSERIAL PRIMARY KEY,
  cotacao_id BIGINT NOT NULL REFERENCES frete.cotacao(id) ON DELETE CASCADE,
  codigo_produto BIGINT,
  codigo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  quantidade NUMERIC(14,4) NOT NULL,
  altura_cm NUMERIC(14,4) NOT NULL,
  largura_cm NUMERIC(14,4) NOT NULL,
  profundidade_cm NUMERIC(14,4) NOT NULL,
  peso_unitario_kg NUMERIC(14,4) NOT NULL,
  volume_total_m3 NUMERIC(16,6) NOT NULL,
  peso_total_kg NUMERIC(16,4) NOT NULL,
  produto_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS frete.cotacao_resultado (
  id BIGSERIAL PRIMARY KEY,
  cotacao_id BIGINT NOT NULL REFERENCES frete.cotacao(id) ON DELETE CASCADE,
  tabela_preco_id BIGINT NOT NULL REFERENCES frete.tabela_preco(id),
  cobertura_id BIGINT REFERENCES frete.cobertura(id),
  peso_cubado_kg NUMERIC(16,4) NOT NULL,
  peso_cobravel_kg NUMERIC(16,4) NOT NULL,
  frete_peso NUMERIC(16,2) NOT NULL,
  adicionais NUMERIC(16,2) NOT NULL DEFAULT 0,
  valor_total NUMERIC(16,2) NOT NULL,
  prazo_min_dias INTEGER,
  prazo_max_dias INTEGER,
  memoria_calculo JSONB NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.nav_node (key, label, position, parent_id, sort, active, selector)
SELECT
  'side:log:simulador-frete',
  'Simulador de frete',
  'side',
  p.id,
  95,
  TRUE,
  '#menu-simulador-frete'
FROM public.nav_node p
WHERE p.key = 'side:log'
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  position = EXCLUDED.position,
  parent_id = EXCLUDED.parent_id,
  sort = EXCLUDED.sort,
  active = TRUE,
  selector = EXCLUDED.selector;

INSERT INTO public.auth_user_permission (user_id, node_id, allow)
SELECT u.id, n.id, TRUE
FROM public.auth_user u
JOIN public.auth_user_profile up ON up.user_id = u.id
CROSS JOIN public.nav_node n
WHERE n.key = 'side:log:simulador-frete'
  AND u.is_active = TRUE
  AND (up.sector_id IN (4, 10) OR 'admin' = ANY(COALESCE(u.roles, ARRAY[]::text[])))
ON CONFLICT (user_id, node_id) DO UPDATE SET allow = TRUE;

COMMIT;
