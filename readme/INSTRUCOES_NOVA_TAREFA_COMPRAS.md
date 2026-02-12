# Instruções: Nova Tarefa de Compras

## Implementação Concluída

Implementado um botão "+ Nova Tarefa" na tela de Check-Compras que permite criar tarefas específicas para cada produto, similar à funcionalidade da tela Check-Proj (Engenharia).

## Funcionalidades Implementadas

### 1. Interface do Usuário
- ✅ Botão "+ Nova Tarefa" adicionado na tela Check-Compras
- ✅ Modal específico para criação de tarefas de compras
- ✅ Badge "ESPECÍFICA" para diferenciar tarefas do produto das tarefas da família
- ✅ Borda laranja (#f59e0b) para destacar atividades específicas

### 2. Backend - Rotas API
Adicionadas em `/routes/compras.js`:
- ✅ `POST /api/compras/atividade-produto` - Criar nova atividade específica do produto
- ✅ `GET /api/compras/atividades-produto/:codigo` - Listar atividades específicas de um produto
- ✅ `POST /api/compras/atividade-produto-status/bulk` - Salvar status das atividades específicas

### 3. Frontend - JavaScript
Adicionado em `menu_produto.js`:
- ✅ Modal para adicionar nova tarefa de compras
- ✅ Função `renderLista` atualizada para mostrar atividades da família e específicas do produto
- ✅ Função `loadCheckCompras` atualizada para buscar ambos os tipos de atividades
- ✅ Função `salvarCheckCompras` atualizada para salvar ambos os tipos de atividades

### 4. Banco de Dados
Scripts criados para criar as tabelas necessárias:
- ✅ `scripts/criar_tabela_atividades_produto_compras.js`
- ✅ `scripts/criar_tabela_atividades_produto_status_especificas_compras.js`

## Como Usar

### Passo 1: Criar as Tabelas no Banco de Dados

Execute os seguintes comandos na raiz do projeto:

```bash
# Criar tabela de atividades específicas de compras
node scripts/criar_tabela_atividades_produto_compras.js

# Criar tabela de status das atividades específicas
node scripts/criar_tabela_atividades_produto_status_especificas_compras.js
```

**IMPORTANTE:** Antes de executar, configure as variáveis de ambiente ou edite os scripts com as credenciais do banco de dados:
- `DB_HOST` (padrão: localhost)
- `DB_PORT` (padrão: 5432)
- `DB_NAME` (padrão: intranet)
- `DB_USER` (padrão: postgres)
- `DB_PASSWORD` (sua senha)

### Passo 2: Usar a Funcionalidade

1. Abra um produto na aba "Produto"
2. Clique no card "Check-Compras"
3. Clique no botão "+ Nova Tarefa" (azul)
4. Preencha:
   - **Descrição da Tarefa** (obrigatório): Ex: "Solicitar cotação de fornecedores"
   - **Observações** (opcional): Detalhes adicionais
5. Clique em "Adicionar"
6. A nova tarefa aparecerá na lista com a badge "ESPECÍFICA" e borda laranja

### Passo 3: Gerenciar as Tarefas

- As tarefas específicas do produto aparecem junto com as tarefas da família
- Tarefas específicas têm:
  - Badge "ESPECÍFICA" (laranja)
  - Borda laranja destacada
- Você pode marcar como concluída, não aplicável, e adicionar observações
- Clique em "Salvar" para gravar todas as alterações

## Estrutura do Banco de Dados

### Tabela: `compras.atividades_produto`
```sql
id                SERIAL PRIMARY KEY
produto_codigo    VARCHAR(50) NOT NULL
descricao         TEXT NOT NULL
observacoes       TEXT
ativo             BOOLEAN DEFAULT true
criado_em         TIMESTAMP DEFAULT NOW()
atualizado_em     TIMESTAMP DEFAULT NOW()
```

### Tabela: `compras.atividades_produto_status_especificas`
```sql
id                    SERIAL PRIMARY KEY
produto_codigo        VARCHAR(50) NOT NULL
atividade_produto_id  INTEGER NOT NULL (FK)
concluido             BOOLEAN DEFAULT false
nao_aplicavel         BOOLEAN DEFAULT false
observacao_status     TEXT
data_conclusao        TIMESTAMP
criado_em             TIMESTAMP DEFAULT NOW()
atualizado_em         TIMESTAMP DEFAULT NOW()
UNIQUE(produto_codigo, atividade_produto_id)
```

## Arquivos Modificados

1. `/menu_produto.html` - Adicionado botão e modal
2. `/menu_produto.js` - Lógica do modal e atualização das funções
3. `/routes/compras.js` - Novas rotas API
4. `/scripts/criar_tabela_atividades_produto_compras.js` - Script de criação de tabela
5. `/scripts/criar_tabela_atividades_produto_status_especificas_compras.js` - Script de criação de tabela

## Próximos Passos (Opcional)

- Adicionar opção de editar/excluir tarefas específicas
- Adicionar filtro para mostrar apenas tarefas da família ou específicas
- Adicionar notificações quando tarefas são criadas
- Implementar auditoria de mudanças nas tarefas

## Notas

- A funcionalidade é independente das tarefas da família
- Cada produto pode ter suas próprias tarefas específicas
- As tarefas específicas são salvas em tabelas separadas das tarefas da família
- O sistema mantém compatibilidade com as tarefas da família existentes
