-- Tabela para armazenar preferências de filtro de kanbans por usuário
-- Cada usuário pode ter seus próprios kanbans visíveis/ocultos

CREATE TABLE IF NOT EXISTS compras.filtro_kanbans_usuario (
  username VARCHAR(100) PRIMARY KEY,
  kanbans_visiveis JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Comentários
COMMENT ON TABLE compras.filtro_kanbans_usuario IS 'Armazena preferências de visualização de kanbans por usuário';
COMMENT ON COLUMN compras.filtro_kanbans_usuario.username IS 'Nome do usuário (chave primária)';
COMMENT ON COLUMN compras.filtro_kanbans_usuario.kanbans_visiveis IS 'Array JSON com os nomes dos kanbans que o usuário quer visualizar';
COMMENT ON COLUMN compras.filtro_kanbans_usuario.created_at IS 'Data de criação do registro';
COMMENT ON COLUMN compras.filtro_kanbans_usuario.updated_at IS 'Data da última atualização';

-- Índice para melhorar performance
CREATE INDEX IF NOT EXISTS idx_filtro_kanbans_username ON compras.filtro_kanbans_usuario(username);
