-- ============================================================================
-- CRIAÇÃO DAS TABELAS DE RECEBIMENTOS DE NF-e NO SCHEMA LOGISTICA
-- Data: 03/02/2026
-- API: https://app.omie.com.br/api/v1/produtos/recebimentonfe/
-- Método: ListarRecebimentos
-- ============================================================================

-- Criar schema se não existir
CREATE SCHEMA IF NOT EXISTS logistica;

-- ============================================================================
-- TABELA PRINCIPAL: recebimentos_nfe_omie
-- Armazena o cabeçalho dos recebimentos de NF-e da Omie
-- ============================================================================
CREATE TABLE IF NOT EXISTS logistica.recebimentos_nfe_omie (
    -- Identificação
    n_id_receb BIGINT PRIMARY KEY,
    c_chave_nfe VARCHAR(50) UNIQUE NOT NULL,
    c_numero_nfe VARCHAR(20),
    c_serie_nfe VARCHAR(10),
    c_modelo_nfe VARCHAR(5),
    
    -- Datas da NF-e
    d_emissao_nfe DATE,
    d_entrada DATE,
    d_registro DATE,
    
    -- Valores
    n_valor_nfe DECIMAL(15,2),
    v_total_produtos DECIMAL(15,2),
    v_aprox_tributos DECIMAL(15,2),
    v_desconto DECIMAL(15,2),
    v_frete DECIMAL(15,2),
    v_seguro DECIMAL(15,2),
    v_outras DECIMAL(15,2),
    v_ipi DECIMAL(15,2),
    v_icms_st DECIMAL(15,2),
    
    -- Fornecedor/Emitente
    n_id_fornecedor BIGINT,
    c_nome_fornecedor VARCHAR(200),
    c_cnpj_cpf_fornecedor VARCHAR(20),
    
    -- Etapa do Recebimento (API de Recebimentos)
    c_etapa VARCHAR(20),
    c_desc_etapa VARCHAR(100),
    
    -- Status: Faturado
    c_faturado CHAR(1),
    d_fat DATE,
    h_fat TIME,
    c_usuario_fat VARCHAR(100),
    
    -- Status: Recebido
    c_recebido CHAR(1),
    d_rec DATE,
    h_rec TIME,
    c_usuario_rec VARCHAR(100),
    
    -- Status: Devolvido
    c_devolvido CHAR(1),
    c_devolvido_parc CHAR(1),
    d_dev DATE,
    h_dev TIME,
    c_usuario_dev VARCHAR(100),
    
    -- Status: Autorizado/Bloqueado/Cancelado
    c_autorizado CHAR(1),
    c_bloqueado CHAR(1),
    c_cancelada CHAR(1),
    
    -- Natureza da Operação e CFOP
    c_natureza_operacao VARCHAR(100),
    c_cfop_entrada VARCHAR(10),
    
    -- Conta Corrente e Categoria
    n_id_conta BIGINT,
    c_categ_compra VARCHAR(20),
    
    -- Observações
    c_obs_nfe TEXT,
    c_obs_rec TEXT,
    
    -- Controle de Sincronização
    c_importado_api CHAR(1) DEFAULT 'S',
    d_importacao TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_recebimentos_nfe_chave ON logistica.recebimentos_nfe_omie(c_chave_nfe);
CREATE INDEX IF NOT EXISTS idx_recebimentos_nfe_numero ON logistica.recebimentos_nfe_omie(c_numero_nfe);
CREATE INDEX IF NOT EXISTS idx_recebimentos_nfe_fornecedor ON logistica.recebimentos_nfe_omie(n_id_fornecedor);
CREATE INDEX IF NOT EXISTS idx_recebimentos_nfe_etapa ON logistica.recebimentos_nfe_omie(c_etapa);
CREATE INDEX IF NOT EXISTS idx_recebimentos_nfe_faturado ON logistica.recebimentos_nfe_omie(c_faturado);
CREATE INDEX IF NOT EXISTS idx_recebimentos_nfe_recebido ON logistica.recebimentos_nfe_omie(c_recebido);
CREATE INDEX IF NOT EXISTS idx_recebimentos_nfe_emissao ON logistica.recebimentos_nfe_omie(d_emissao_nfe);

-- ============================================================================
-- TABELA: recebimentos_nfe_itens
-- Armazena os itens de cada recebimento de NF-e
-- ============================================================================
CREATE TABLE IF NOT EXISTS logistica.recebimentos_nfe_itens (
    id SERIAL PRIMARY KEY,
    n_id_receb BIGINT NOT NULL REFERENCES logistica.recebimentos_nfe_omie(n_id_receb) ON DELETE CASCADE,
    
    -- Identificação do Item na NF-e
    n_id_item BIGINT,
    n_sequencia INTEGER,
    
    -- Produto
    n_id_produto BIGINT,
    c_codigo_produto VARCHAR(50),
    c_descricao_produto VARCHAR(500),
    c_ncm VARCHAR(20),
    
    -- Quantidades e Unidades
    n_qtde_nfe DECIMAL(15,4),
    c_unidade_nfe VARCHAR(10),
    n_qtde_recebida DECIMAL(15,4),
    n_qtde_divergente DECIMAL(15,4),
    
    -- Valores
    n_preco_unit DECIMAL(15,4),
    v_total_item DECIMAL(15,2),
    v_desconto DECIMAL(15,2),
    v_frete DECIMAL(15,2),
    v_seguro DECIMAL(15,2),
    v_outras DECIMAL(15,2),
    
    -- Impostos
    v_icms DECIMAL(15,2),
    v_ipi DECIMAL(15,2),
    v_pis DECIMAL(15,2),
    v_cofins DECIMAL(15,2),
    v_icms_st DECIMAL(15,2),
    
    -- Vinculação com Pedido de Compra
    n_num_ped_compra VARCHAR(50),
    n_id_pedido BIGINT,
    n_id_it_pedido BIGINT,
    
    -- CFOP e Categoria
    c_cfop_entrada VARCHAR(10),
    c_categoria_item VARCHAR(20),
    
    -- Estoque
    codigo_local_estoque BIGINT,
    c_local_estoque VARCHAR(100),
    
    -- Flags de Controle
    c_nao_gerar_financeiro CHAR(1),
    c_nao_gerar_mov_estoque CHAR(1),
    
    -- Observações
    c_obs_item TEXT,
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Índices para itens
CREATE INDEX IF NOT EXISTS idx_recebimentos_itens_receb ON logistica.recebimentos_nfe_itens(n_id_receb);
CREATE INDEX IF NOT EXISTS idx_recebimentos_itens_produto ON logistica.recebimentos_nfe_itens(n_id_produto);
CREATE INDEX IF NOT EXISTS idx_recebimentos_itens_codigo ON logistica.recebimentos_nfe_itens(c_codigo_produto);
CREATE INDEX IF NOT EXISTS idx_recebimentos_itens_pedido ON logistica.recebimentos_nfe_itens(n_num_ped_compra);
CREATE INDEX IF NOT EXISTS idx_recebimentos_itens_id_pedido ON logistica.recebimentos_nfe_itens(n_id_pedido);

-- ============================================================================
-- TABELA: recebimentos_nfe_frete
-- Armazena informações de frete do recebimento
-- ============================================================================
CREATE TABLE IF NOT EXISTS logistica.recebimentos_nfe_frete (
    id SERIAL PRIMARY KEY,
    n_id_receb BIGINT NOT NULL REFERENCES logistica.recebimentos_nfe_omie(n_id_receb) ON DELETE CASCADE,
    
    -- Modalidade de Frete
    c_modalidade_frete VARCHAR(20),
    
    -- Transportadora
    n_id_transportadora BIGINT,
    c_nome_transportadora VARCHAR(200),
    c_cnpj_cpf_transportadora VARCHAR(20),
    
    -- Valores do Frete
    v_frete DECIMAL(15,2),
    v_seguro DECIMAL(15,2),
    
    -- Volumes
    n_quantidade_volumes INTEGER,
    c_especie VARCHAR(50),
    c_marca VARCHAR(50),
    n_peso_bruto DECIMAL(15,3),
    n_peso_liquido DECIMAL(15,3),
    
    -- Placa do Veículo
    c_placa_veiculo VARCHAR(10),
    c_uf_veiculo VARCHAR(2),
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recebimentos_frete_receb ON logistica.recebimentos_nfe_frete(n_id_receb);

-- ============================================================================
-- TABELA: recebimentos_nfe_parcelas
-- Armazena as parcelas financeiras do recebimento
-- ============================================================================
CREATE TABLE IF NOT EXISTS logistica.recebimentos_nfe_parcelas (
    id SERIAL PRIMARY KEY,
    n_id_receb BIGINT NOT NULL REFERENCES logistica.recebimentos_nfe_omie(n_id_receb) ON DELETE CASCADE,
    
    -- Identificação da Parcela
    n_id_parcela BIGINT,
    n_numero_parcela INTEGER,
    
    -- Valores
    v_parcela DECIMAL(15,2),
    p_percentual DECIMAL(5,2),
    
    -- Datas
    d_vencimento DATE,
    n_dias_vencimento INTEGER,
    
    -- Forma de Pagamento
    c_forma_pagamento VARCHAR(50),
    
    -- Conta Corrente
    n_id_conta BIGINT,
    c_nome_conta VARCHAR(100),
    
    -- Categoria Financeira
    c_codigo_categoria VARCHAR(20),
    c_nome_categoria VARCHAR(100),
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recebimentos_parcelas_receb ON logistica.recebimentos_nfe_parcelas(n_id_receb);
CREATE INDEX IF NOT EXISTS idx_recebimentos_parcelas_vencimento ON logistica.recebimentos_nfe_parcelas(d_vencimento);

-- ============================================================================
-- TABELA DE REFERÊNCIA: etapas_recebimento_nfe
-- Códigos e descrições das etapas de recebimento
-- ============================================================================
CREATE TABLE IF NOT EXISTS logistica.etapas_recebimento_nfe (
    codigo VARCHAR(20) PRIMARY KEY,
    descricao VARCHAR(100) NOT NULL,
    descricao_customizada VARCHAR(100),
    ordem INTEGER,
    ativo BOOLEAN DEFAULT true,
    cor VARCHAR(20),
    icone VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Inserir etapas conhecidas da API de Recebimentos
INSERT INTO logistica.etapas_recebimento_nfe (codigo, descricao, descricao_customizada, ordem, cor, icone) VALUES
('10', 'Aguardando Entrada', 'Aguardando Entrada da NF-e', 1, '#FFA500', 'clock'),
('20', 'Em Conferência', 'Em Conferência', 2, '#FF8C00', 'search'),
('30', 'Pendente', 'Pendente de Aprovação', 3, '#FFD700', 'pause'),
('40', 'Faturado', 'Faturado pelo Fornecedor', 4, '#1E90FF', 'receipt'),
('50', 'Recebido Parcial', 'Recebido Parcialmente', 5, '#32CD32', 'package-check'),
('60', 'Recebido Total', 'Recebido Totalmente', 6, '#228B22', 'check-circle')
ON CONFLICT (codigo) DO UPDATE SET
    descricao = EXCLUDED.descricao,
    ordem = EXCLUDED.ordem,
    cor = EXCLUDED.cor,
    icone = EXCLUDED.icone;

-- ============================================================================
-- VIEW: v_recebimentos_nfe_completo
-- Visão consolidada dos recebimentos com todas as informações
-- ============================================================================
CREATE OR REPLACE VIEW logistica.v_recebimentos_nfe_completo AS
SELECT 
    -- Dados do Recebimento
    r.n_id_receb,
    r.c_chave_nfe,
    r.c_numero_nfe,
    r.c_serie_nfe,
    r.d_emissao_nfe,
    r.d_entrada,
    r.n_valor_nfe,
    
    -- Fornecedor
    r.n_id_fornecedor,
    r.c_nome_fornecedor,
    r.c_cnpj_cpf_fornecedor,
    
    -- Etapa
    r.c_etapa,
    e.descricao_customizada as desc_etapa,
    e.cor as cor_etapa,
    
    -- Status Consolidado
    CASE 
        WHEN r.c_cancelada = 'S' THEN 'Cancelada'
        WHEN r.c_devolvido = 'S' THEN 'Devolvida'
        WHEN r.c_recebido = 'S' THEN 'Recebido Totalmente'
        WHEN r.c_faturado = 'S' THEN 'Faturado pelo Fornecedor'
        WHEN r.c_etapa = '30' THEN 'Pendente'
        WHEN r.c_etapa = '20' THEN 'Em Conferência'
        WHEN r.c_etapa = '10' THEN 'Aguardando Entrada'
        ELSE 'Desconhecido'
    END as status_display,
    
    -- Flags de Status
    r.c_faturado,
    r.d_fat as data_faturamento,
    r.c_recebido,
    r.d_rec as data_recebimento,
    r.c_devolvido,
    r.c_cancelada,
    r.c_bloqueado,
    r.c_autorizado,
    
    -- Contadores
    (SELECT COUNT(*) FROM logistica.recebimentos_nfe_itens i WHERE i.n_id_receb = r.n_id_receb) as qtd_itens,
    (SELECT COUNT(*) FROM logistica.recebimentos_nfe_parcelas p WHERE p.n_id_receb = r.n_id_receb) as qtd_parcelas,
    
    -- Dados de Auditoria
    r.d_importacao,
    r.created_at,
    r.updated_at
    
FROM logistica.recebimentos_nfe_omie r
LEFT JOIN logistica.etapas_recebimento_nfe e ON e.codigo = r.c_etapa
ORDER BY r.d_emissao_nfe DESC;

-- ============================================================================
-- VIEW: v_recebimentos_nfe_com_pedidos
-- Vincula recebimentos com pedidos de compra (quando disponível)
-- ============================================================================
CREATE OR REPLACE VIEW logistica.v_recebimentos_nfe_com_pedidos AS
SELECT 
    r.*,
    i.n_num_ped_compra,
    i.n_id_pedido,
    i.c_codigo_produto,
    i.c_descricao_produto,
    i.n_qtde_nfe,
    i.n_qtde_recebida,
    i.v_total_item
FROM logistica.recebimentos_nfe_omie r
INNER JOIN logistica.recebimentos_nfe_itens i ON i.n_id_receb = r.n_id_receb
WHERE i.n_num_ped_compra IS NOT NULL OR i.n_id_pedido IS NOT NULL
ORDER BY r.d_emissao_nfe DESC;

-- ============================================================================
-- COMENTÁRIOS NAS TABELAS
-- ============================================================================
COMMENT ON TABLE logistica.recebimentos_nfe_omie IS 'Recebimentos de NF-e sincronizados da Omie via API /produtos/recebimentonfe/';
COMMENT ON TABLE logistica.recebimentos_nfe_itens IS 'Itens dos recebimentos de NF-e com vinculação aos pedidos de compra';
COMMENT ON TABLE logistica.recebimentos_nfe_frete IS 'Informações de frete e transporte dos recebimentos';
COMMENT ON TABLE logistica.recebimentos_nfe_parcelas IS 'Parcelas financeiras dos recebimentos de NF-e';
COMMENT ON TABLE logistica.etapas_recebimento_nfe IS 'Tabela de referência das etapas de recebimento da Omie';

COMMENT ON COLUMN logistica.recebimentos_nfe_omie.n_id_receb IS 'ID único do recebimento na Omie';
COMMENT ON COLUMN logistica.recebimentos_nfe_omie.c_chave_nfe IS 'Chave de acesso da NF-e (44 dígitos)';
COMMENT ON COLUMN logistica.recebimentos_nfe_omie.c_etapa IS 'Etapa do recebimento: 10, 20, 30, 40, 50, 60';
COMMENT ON COLUMN logistica.recebimentos_nfe_omie.c_faturado IS 'Faturado pelo fornecedor: S ou N';
COMMENT ON COLUMN logistica.recebimentos_nfe_omie.c_recebido IS 'Recebido fisicamente: S ou N';

COMMENT ON COLUMN logistica.recebimentos_nfe_itens.n_num_ped_compra IS 'Número do pedido de compra vinculado (campo nNumPedCompra da API)';
COMMENT ON COLUMN logistica.recebimentos_nfe_itens.n_id_pedido IS 'ID do pedido de compra na Omie';
COMMENT ON COLUMN logistica.recebimentos_nfe_itens.n_id_it_pedido IS 'ID do item do pedido de compra';

-- ============================================================================
-- GRANTS (Ajuste conforme necessário)
-- ============================================================================
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA logistica TO seu_usuario;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA logistica TO seu_usuario;

-- ============================================================================
-- FIM DO SCRIPT
-- ============================================================================

-- Para verificar a criação:
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE schemaname = 'logistica' 
  AND tablename LIKE 'recebimentos%'
ORDER BY tablename;
