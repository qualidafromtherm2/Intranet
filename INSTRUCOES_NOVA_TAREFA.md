# Instruções para Criar a Tabela de Atividades do Produto

## Sistema implementado! ✅

Já foram criados:
1. ✅ Botão "Nova Tarefa" ao lado do botão "Salvar" no Check-Proj
2. ✅ Modal bonito para adicionar tarefas específicas do produto
3. ✅ Endpoints no backend (`POST /api/engenharia/atividade-produto` e `GET /api/engenharia/atividades-produto/:codigo`)
4. ✅ JavaScript para integração completa

## Falta apenas criar a tabela no banco de dados

Execute este SQL manualmente no seu banco PostgreSQL (Render):

```sql
-- Tabela para armazenar atividades específicas de cada produto
CREATE TABLE IF NOT EXISTS engenharia.atividades_produto (
  id SERIAL PRIMARY KEY,
  produto_codigo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  observacoes TEXT,
  ativo BOOLEAN DEFAULT true,
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Índice para buscar atividades por produto
CREATE INDEX IF NOT EXISTS idx_atividades_produto_codigo 
  ON engenharia.atividades_produto(produto_codigo) 
  WHERE ativo = true;

COMMENT ON TABLE engenharia.atividades_produto IS 
  'Atividades específicas de um produto individual (independente da família)';
```

## Como usar:

1. Abra um produto no sistema
2. Vá na aba "Check-Proj (Engenharia)"
3. Clique no botão "Nova Tarefa" (azul, ao lado do "Salvar")
4. Preencha a descrição da tarefa
5. Adicione observações se necessário
6. Clique em "Adicionar"
7. A tarefa aparecerá na lista com um badge azul "ESPECÍFICA" e borda azul
8. As tarefas específicas do produto só aparecem para aquele produto
9. As tarefas da família continuam aparecendo normalmente (borda cinza)

## Diferenças visuais:

- **Tarefas da Família**: Borda cinza, sem badge
- **Tarefas Específicas do Produto**: Borda azul + badge azul "ESPECÍFICA"

## Observação importante:

As tarefas específicas são salvas junto com as tarefas da família quando você clicar em "Salvar". O sistema reconhece automaticamente se é uma tarefa da família (tem `atividade_id`) ou específica do produto (tem `atividade_produto_id`).
