-- Cria o schema SAC (em Postgres, sem aspas o nome fica em minusculas)
CREATE SCHEMA IF NOT EXISTS sac;

-- Cria a tabela AT dentro do schema SAC
CREATE TABLE IF NOT EXISTS sac.at (
  id BIGSERIAL PRIMARY KEY,
  data TIMESTAMP NOT NULL DEFAULT NOW(),
  tipo TEXT,
  nome_revenda_cliente TEXT,
  numero_telefone TEXT,
  cpf_cnpj TEXT,
  cep TEXT,
  bairro TEXT,
  cidade TEXT,
  estado TEXT,
  numero TEXT,
  rua TEXT,
  agendar_atendimento_com TEXT,
  descreva_reclamacao TEXT
);

-- Cria tabela com o item selecionado na busca de série (vinculada ao atendimento AT)
CREATE TABLE IF NOT EXISTS sac.at_busca_selecionada (
  id BIGSERIAL PRIMARY KEY,
  id_at BIGINT NOT NULL REFERENCES sac.at(id) ON DELETE CASCADE,
  pedido TEXT,
  ordem_producao TEXT,
  modelo TEXT,
  cliente TEXT,
  nota_fiscal TEXT,
  data_entrega TEXT,
  teste_tipo_gas TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sac.at IS 'Tabela de atendimentos AT do SAC';
COMMENT ON COLUMN sac.at.data IS 'Data da solicitacao';
COMMENT ON COLUMN sac.at.tipo IS 'Tipo do atendimento';
COMMENT ON COLUMN sac.at.nome_revenda_cliente IS 'Nome revenda/cliente';
COMMENT ON COLUMN sac.at.numero_telefone IS 'Numero de telefone';
COMMENT ON COLUMN sac.at.cpf_cnpj IS 'CPF/CNPJ';
COMMENT ON COLUMN sac.at.cep IS 'CEP';
COMMENT ON COLUMN sac.at.bairro IS 'Bairro';
COMMENT ON COLUMN sac.at.cidade IS 'Cidade';
COMMENT ON COLUMN sac.at.estado IS 'Estado';
COMMENT ON COLUMN sac.at.numero IS 'Numero';
COMMENT ON COLUMN sac.at.rua IS 'Rua';
COMMENT ON COLUMN sac.at.agendar_atendimento_com IS 'Agendar atendimento com';
COMMENT ON COLUMN sac.at.descreva_reclamacao IS 'Descreva a reclamacao';

COMMENT ON TABLE sac.at_busca_selecionada IS 'Item selecionado na busca de serie, vinculado ao atendimento AT';
COMMENT ON COLUMN sac.at_busca_selecionada.id_at IS 'FK para sac.at.id';
COMMENT ON COLUMN sac.at_busca_selecionada.pedido IS 'Pedido selecionado';
COMMENT ON COLUMN sac.at_busca_selecionada.ordem_producao IS 'Ordem de producao selecionada';
COMMENT ON COLUMN sac.at_busca_selecionada.modelo IS 'Modelo selecionado';
COMMENT ON COLUMN sac.at_busca_selecionada.cliente IS 'Cliente selecionado';
COMMENT ON COLUMN sac.at_busca_selecionada.nota_fiscal IS 'Nota fiscal selecionada';
COMMENT ON COLUMN sac.at_busca_selecionada.data_entrega IS 'Data de entrega selecionada';
COMMENT ON COLUMN sac.at_busca_selecionada.teste_tipo_gas IS '1o teste / tipo de gas selecionado';