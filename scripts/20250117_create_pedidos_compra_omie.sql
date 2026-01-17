-- ============================================================================
-- Script para criar tabelas de Pedidos de Compra da Omie
-- Data: 2025-01-17
-- Objetivo: Armazenar pedidos de compra vindos da Omie via webhook
-- Eventos tratados: CompraProduto.Incluida, Alterada, Cancelada, Encerrada, 
--                   EtapaAlterada, Excluida
-- ============================================================================

-- Garantir que o schema compras existe
CREATE SCHEMA IF NOT EXISTS compras;

-- ============================================================================
-- 1. TABELA PRINCIPAL: CABEÇALHO DO PEDIDO DE COMPRA
-- ============================================================================
CREATE TABLE IF NOT EXISTS compras.pedidos_omie (
  -- Identificadores
  n_cod_ped BIGINT PRIMARY KEY,                  -- Código do pedido na Omie (nCodPed)
  c_cod_int_ped VARCHAR(100),                    -- Código de integração (cCodIntPed)
  c_numero VARCHAR(50),                          -- Número do pedido (cNumero)
  
  -- Datas
  d_inc_data DATE,                               -- Data de inclusão (dIncData)
  c_inc_hora VARCHAR(10),                        -- Hora de inclusão (cIncHora)
  d_dt_previsao DATE,                            -- Data de previsão (dDtPrevisao)
  
  -- Status e Etapa
  c_etapa VARCHAR(100),                          -- Etapa do pedido (cEtapa)
  c_cod_status VARCHAR(20),                      -- Código de status (cCodStatus)
  c_desc_status VARCHAR(100),                    -- Descrição do status (cDescStatus)
  
  -- Fornecedor
  n_cod_for BIGINT,                              -- Código do fornecedor na Omie (nCodFor)
  c_cod_int_for VARCHAR(100),                    -- Código de integração do fornecedor (cCodIntFor)
  c_cnpj_cpf_for VARCHAR(20),                    -- CNPJ/CPF do fornecedor (cCnpjCpfFor)
  
  -- Financeiro
  c_cod_parc VARCHAR(50),                        -- Código da parcela (cCodParc)
  n_qtde_parc INTEGER,                           -- Quantidade de parcelas (nQtdeParc)
  
  -- Complementos
  c_cod_categ VARCHAR(50),                       -- Código da categoria (cCodCateg)
  n_cod_compr BIGINT,                            -- Código do comprador (nCodCompr)
  c_contato VARCHAR(100),                        -- Contato (cContato)
  c_contrato VARCHAR(100),                       -- Contrato (cContrato)
  
  -- Centro de Custo
  n_cod_cc BIGINT,                               -- Código do centro de custo (nCodCC)
  n_cod_int_cc VARCHAR(100),                     -- Código de integração CC (nCodIntCC)
  
  -- Projeto
  n_cod_proj BIGINT,                             -- Código do projeto (nCodProj)
  
  -- Observações
  c_num_pedido VARCHAR(50),                      -- Número do pedido (cNumPedido)
  c_obs TEXT,                                    -- Observações (cObs)
  c_obs_int TEXT,                                -- Observações internas (cObsInt)
  
  -- Aprovação
  c_email_aprovador VARCHAR(255),                -- Email do aprovador (cEmailAprovador)
  
  -- Controle
  inativo BOOLEAN DEFAULT FALSE,                 -- Se foi excluído/cancelado
  data_webhook TIMESTAMP DEFAULT NOW(),          -- Data de recebimento do webhook
  evento_webhook VARCHAR(100),                   -- Último evento recebido
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para a tabela principal
CREATE INDEX IF NOT EXISTS idx_pedidos_omie_cod_int 
  ON compras.pedidos_omie(c_cod_int_ped);
CREATE INDEX IF NOT EXISTS idx_pedidos_omie_fornecedor 
  ON compras.pedidos_omie(n_cod_for);
CREATE INDEX IF NOT EXISTS idx_pedidos_omie_numero 
  ON compras.pedidos_omie(c_numero);
CREATE INDEX IF NOT EXISTS idx_pedidos_omie_etapa 
  ON compras.pedidos_omie(c_etapa);
CREATE INDEX IF NOT EXISTS idx_pedidos_omie_data 
  ON compras.pedidos_omie(d_inc_data);

-- ============================================================================
-- 2. TABELA DE PRODUTOS DO PEDIDO
-- ============================================================================
CREATE TABLE IF NOT EXISTS compras.pedidos_omie_produtos (
  id SERIAL PRIMARY KEY,
  n_cod_ped BIGINT NOT NULL,                     -- FK para pedidos_omie
  
  -- Identificadores do item
  c_cod_int_item VARCHAR(100),                   -- Código de integração do item (cCodIntItem)
  n_cod_item BIGINT,                             -- Código do item (nCodItem)
  
  -- Identificadores do produto
  c_cod_int_prod VARCHAR(100),                   -- Código de integração do produto (cCodIntProd)
  n_cod_prod BIGINT,                             -- Código do produto na Omie (nCodProd)
  c_produto VARCHAR(100),                        -- Código do produto (cProduto)
  c_descricao TEXT,                              -- Descrição do produto (cDescricao)
  
  -- Características do produto
  c_ncm VARCHAR(20),                             -- NCM (cNCM)
  c_unidade VARCHAR(10),                         -- Unidade (cUnidade)
  c_ean VARCHAR(20),                             -- Código EAN (cEAN)
  n_peso_liq DECIMAL(15,4),                      -- Peso líquido (nPesoLiq)
  n_peso_bruto DECIMAL(15,4),                    -- Peso bruto (nPesoBruto)
  
  -- Quantidades e valores
  n_qtde DECIMAL(15,4),                          -- Quantidade (nQtde)
  n_qtde_rec DECIMAL(15,4),                      -- Quantidade recebida (nQtdeRec)
  n_val_unit DECIMAL(15,2),                      -- Valor unitário (nValUnit)
  n_val_merc DECIMAL(15,2),                      -- Valor da mercadoria (nValMerc)
  n_desconto DECIMAL(15,2),                      -- Desconto (nDesconto)
  n_val_tot DECIMAL(15,2),                       -- Valor total (nValTot)
  
  -- Impostos
  n_valor_icms DECIMAL(15,2),                    -- Valor ICMS (nValorIcms)
  n_valor_st DECIMAL(15,2),                      -- Valor ST (nValorSt)
  n_valor_ipi DECIMAL(15,2),                     -- Valor IPI (nValorIpi)
  n_valor_pis DECIMAL(15,2),                     -- Valor PIS (nValorPis)
  n_valor_cofins DECIMAL(15,2),                  -- Valor COFINS (nValorCofins)
  
  -- Custos adicionais
  n_frete DECIMAL(15,2),                         -- Frete (nFrete)
  n_seguro DECIMAL(15,2),                        -- Seguro (nSeguro)
  n_despesas DECIMAL(15,2),                      -- Despesas (nDespesas)
  
  -- Observações
  c_obs TEXT,                                    -- Observações (cObs)
  
  -- Markup
  c_mkp_atu_pv VARCHAR(1),                       -- Atualiza preço de venda (cMkpAtuPv)
  c_mkp_atu_sm VARCHAR(1),                       -- Atualiza preço sugerido (cMkpAtuSm)
  n_mkp_perc DECIMAL(15,2),                      -- Percentual de markup (nMkpPerc)
  
  -- Estoque e categoria
  codigo_local_estoque BIGINT,                   -- Código do local de estoque
  c_cod_categ VARCHAR(50),                       -- Código da categoria (cCodCateg)
  
  -- Controle
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  FOREIGN KEY (n_cod_ped) REFERENCES compras.pedidos_omie(n_cod_ped) ON DELETE CASCADE
);

-- Índices para produtos
CREATE INDEX IF NOT EXISTS idx_pedidos_omie_produtos_pedido 
  ON compras.pedidos_omie_produtos(n_cod_ped);
CREATE INDEX IF NOT EXISTS idx_pedidos_omie_produtos_cod_prod 
  ON compras.pedidos_omie_produtos(n_cod_prod);
CREATE INDEX IF NOT EXISTS idx_pedidos_omie_produtos_cod_int_prod 
  ON compras.pedidos_omie_produtos(c_cod_int_prod);

-- ============================================================================
-- 3. TABELA DE FRETE
-- ============================================================================
CREATE TABLE IF NOT EXISTS compras.pedidos_omie_frete (
  id SERIAL PRIMARY KEY,
  n_cod_ped BIGINT NOT NULL UNIQUE,              -- FK para pedidos_omie (1:1)
  
  -- Transportadora
  n_cod_transp BIGINT,                           -- Código da transportadora (nCodTransp)
  c_cod_int_transp VARCHAR(100),                 -- Código de integração transportadora (cCodIntTransp)
  c_tp_frete VARCHAR(1),                         -- Tipo de frete (cTpFrete)
  
  -- Veículo
  c_placa VARCHAR(10),                           -- Placa (cPlaca)
  c_uf VARCHAR(2),                               -- UF (cUF)
  
  -- Volumes
  n_qtd_vol INTEGER,                             -- Quantidade de volumes (nQtdVol)
  c_esp_vol VARCHAR(50),                         -- Espécie dos volumes (cEspVol)
  c_mar_vol VARCHAR(50),                         -- Marca dos volumes (cMarVol)
  c_num_vol VARCHAR(50),                         -- Numeração dos volumes (cNumVol)
  
  -- Pesos
  n_peso_liq DECIMAL(15,4),                      -- Peso líquido (nPesoLiq)
  n_peso_bruto DECIMAL(15,4),                    -- Peso bruto (nPesoBruto)
  
  -- Valores
  n_val_frete DECIMAL(15,2),                     -- Valor do frete (nValFrete)
  n_val_seguro DECIMAL(15,2),                    -- Valor do seguro (nValSeguro)
  n_val_outras DECIMAL(15,2),                    -- Outras despesas (nValOutras)
  
  -- Lacre
  c_lacre VARCHAR(50),                           -- Lacre (cLacre)
  
  -- Controle
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  FOREIGN KEY (n_cod_ped) REFERENCES compras.pedidos_omie(n_cod_ped) ON DELETE CASCADE
);

-- Índice para frete
CREATE INDEX IF NOT EXISTS idx_pedidos_omie_frete_pedido 
  ON compras.pedidos_omie_frete(n_cod_ped);

-- ============================================================================
-- 4. TABELA DE PARCELAS
-- ============================================================================
CREATE TABLE IF NOT EXISTS compras.pedidos_omie_parcelas (
  id SERIAL PRIMARY KEY,
  n_cod_ped BIGINT NOT NULL,                     -- FK para pedidos_omie
  
  n_parcela INTEGER,                             -- Número da parcela (nParcela)
  d_vencto DATE,                                 -- Data de vencimento (dVencto)
  n_valor DECIMAL(15,2),                         -- Valor da parcela (nValor)
  n_dias INTEGER,                                -- Dias (nDias)
  n_percent DECIMAL(5,2),                        -- Percentual (nPercent)
  c_tipo_doc VARCHAR(10),                        -- Tipo de documento (cTipoDoc)
  
  -- Controle
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  FOREIGN KEY (n_cod_ped) REFERENCES compras.pedidos_omie(n_cod_ped) ON DELETE CASCADE
);

-- Índices para parcelas
CREATE INDEX IF NOT EXISTS idx_pedidos_omie_parcelas_pedido 
  ON compras.pedidos_omie_parcelas(n_cod_ped);
CREATE INDEX IF NOT EXISTS idx_pedidos_omie_parcelas_vencto 
  ON compras.pedidos_omie_parcelas(d_vencto);

-- ============================================================================
-- 5. TABELA DE DEPARTAMENTOS
-- ============================================================================
CREATE TABLE IF NOT EXISTS compras.pedidos_omie_departamentos (
  id SERIAL PRIMARY KEY,
  n_cod_ped BIGINT NOT NULL,                     -- FK para pedidos_omie
  
  c_cod_depto VARCHAR(50),                       -- Código do departamento (cCodDepto)
  n_perc DECIMAL(5,2),                           -- Percentual (nPerc)
  n_valor DECIMAL(15,2),                         -- Valor (nValor)
  
  -- Controle
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  FOREIGN KEY (n_cod_ped) REFERENCES compras.pedidos_omie(n_cod_ped) ON DELETE CASCADE
);

-- Índice para departamentos
CREATE INDEX IF NOT EXISTS idx_pedidos_omie_departamentos_pedido 
  ON compras.pedidos_omie_departamentos(n_cod_ped);

-- ============================================================================
-- COMENTÁRIOS NAS TABELAS
-- ============================================================================

COMMENT ON TABLE compras.pedidos_omie IS 
  'Cabeçalho dos pedidos de compra vindos da Omie via webhook';

COMMENT ON TABLE compras.pedidos_omie_produtos IS 
  'Produtos/itens dos pedidos de compra da Omie';

COMMENT ON TABLE compras.pedidos_omie_frete IS 
  'Dados de frete dos pedidos de compra da Omie';

COMMENT ON TABLE compras.pedidos_omie_parcelas IS 
  'Parcelas de pagamento dos pedidos de compra da Omie';

COMMENT ON TABLE compras.pedidos_omie_departamentos IS 
  'Rateio por departamento dos pedidos de compra da Omie';

-- ============================================================================
-- VERIFICAÇÃO
-- ============================================================================

-- Verificar se as tabelas foram criadas
SELECT 
  table_schema,
  table_name,
  (SELECT COUNT(*) 
   FROM information_schema.columns 
   WHERE table_schema = t.table_schema 
   AND table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'compras' 
  AND table_name LIKE 'pedidos_omie%'
ORDER BY table_name;

-- Verificar índices criados
SELECT 
  schemaname,
  tablename,
  indexname
FROM pg_indexes
WHERE schemaname = 'compras' 
  AND tablename LIKE 'pedidos_omie%'
ORDER BY tablename, indexname;

