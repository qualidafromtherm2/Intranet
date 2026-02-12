# Sistema de Histórico/Auditoria de Solicitações de Compras

## 📋 Objetivo

Registrar automaticamente todas as operações realizadas na tabela `compras.solicitacao_compras` para:
- Rastreamento completo do processo de compra
- Auditoria de mudanças
- Identificação de quem alterou cada campo
- Histórico de evolução de cada item

## 🗃️ Estrutura do Banco de Dados

### Tabela: `compras.historico_solicitacao_compras`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL | ID único do registro de histórico |
| `solicitacao_id` | INTEGER | Referência ao ID do item em solicitacao_compras |
| `operacao` | TEXT | Tipo de operação: INSERT, UPDATE ou DELETE |
| `campo_alterado` | TEXT | Nome do campo que foi alterado |
| `valor_anterior` | TEXT | Valor antes da alteração (NULL em INSERT) |
| `valor_novo` | TEXT | Valor depois da alteração (NULL em DELETE) |
| `usuario` | TEXT | Username de quem realizou a operação |
| `descricao_item` | TEXT | Descrição do produto (para identificação) |
| `status_item` | TEXT | Status do item no momento da operação |
| `departamento` | TEXT | Departamento do item |
| `created_at` | TIMESTAMP | Data/hora do registro (automático) |

### Índices Criados

- `idx_historico_solicitacao_id` - Para buscar histórico de um item específico
- `idx_historico_operacao` - Para filtrar por tipo de operação
- `idx_historico_created_at` - Para consultas ordenadas por data
- `idx_historico_usuario` - Para auditorias por usuário

## ⚙️ Funcionamento Automático

### Trigger: `trg_historico_solicitacao_compras`

O trigger é executado **APÓS** cada operação (INSERT/UPDATE/DELETE) e registra automaticamente:

#### 📌 Em INSERT (Novo Item):
- Registra como operação "INSERT"
- Grava descrição, quantidade, solicitante como `valor_novo`

#### 📌 Em UPDATE (Alteração):
Registra **cada campo alterado separadamente**:
- **status** - Mudanças de status (ex: "aguardando aprovação" → "aprovado")
- **quantidade** - Alterações na quantidade solicitada
- **descricao** - Mudanças na descrição do produto
- **departamento** - Troca de departamento
- **solicitante** - Mudança de solicitante
- **codigo_produto_omie** - Vinculação com produto Omie
- **categoria** - Alteração de categoria
- **observacao** - Mudanças em observações
- **objetivo_compra** - Alterações no objetivo da compra

#### 📌 Em DELETE (Remoção):
- Registra como operação "DELETE"
- Grava todos os dados do item removido em `valor_anterior`

## 🔌 Endpoints da API

### 1. GET `/api/compras/historico/:solicitacaoId`
Busca todo o histórico de um item específico.

**Exemplo:**
```javascript
fetch('/api/compras/historico/123', { credentials: 'include' })
  .then(res => res.json())
  .then(data => console.log(data.historico));
```

**Resposta:**
```json
{
  "ok": true,
  "historico": [
    {
      "id": 1,
      "solicitacao_id": 123,
      "operacao": "UPDATE",
      "campo_alterado": "status",
      "valor_anterior": "aguardando aprovação",
      "valor_novo": "aprovado",
      "usuario": "joao.silva",
      "created_at": "2026-01-28T10:30:00.000Z"
    }
  ]
}
```

### 2. GET `/api/compras/historico`
Lista histórico com filtros opcionais.

**Parâmetros Query:**
- `usuario` - Filtrar por username
- `operacao` - Filtrar por tipo (INSERT, UPDATE, DELETE)
- `dias` - Últimos X dias (padrão: 30)
- `limit` - Limite de registros (padrão: 100)

**Exemplo:**
```javascript
fetch('/api/compras/historico?usuario=joao.silva&dias=7&limit=50')
```

### 3. GET `/api/compras/historico/resumo`
Estatísticas do histórico (quantidade de operações por tipo/campo).

**Parâmetros Query:**
- `dias` - Últimos X dias (padrão: 30)

**Resposta:**
```json
{
  "ok": true,
  "resumo": [
    {
      "operacao": "UPDATE",
      "campo_alterado": "status",
      "total": 45,
      "itens_afetados": 32,
      "usuarios_distintos": 5
    }
  ]
}
```

## 🎨 Interface Frontend

### Botão de Histórico

Na tabela de "Aprovação de Requisições", cada item agora possui um botão **roxo** com ícone de relógio:

```html
<button onclick="abrirHistoricoItem(123, 'Nome do produto')">
  <i class="fa-solid fa-clock-rotate-left"></i>
</button>
```

### Modal de Histórico

Ao clicar no botão, abre um modal com:
- ✅ Timeline visual das alterações
- 🎨 Cores diferenciadas por tipo de operação:
  - 🟢 Verde - INSERT (novo item)
  - 🔵 Azul - UPDATE (alteração)
  - 🔴 Vermelho - DELETE (remoção)
- 👤 Usuário que fez cada alteração
- 📅 Data/hora formatada em PT-BR
- 📝 Valores antes/depois de cada mudança

## 📊 Consultas SQL Úteis

### Ver histórico de um item específico:
```sql
SELECT * FROM compras.historico_solicitacao_compras 
WHERE solicitacao_id = 123 
ORDER BY created_at DESC;
```

### Mudanças de status dos últimos 7 dias:
```sql
SELECT * FROM compras.historico_solicitacao_compras 
WHERE campo_alterado = 'status' 
  AND created_at >= NOW() - INTERVAL '7 days' 
ORDER BY created_at DESC;
```

### Ações de um usuário específico:
```sql
SELECT * FROM compras.historico_solicitacao_compras 
WHERE usuario = 'joao.silva' 
ORDER BY created_at DESC 
LIMIT 50;
```

### Itens que mudaram de departamento:
```sql
SELECT 
  solicitacao_id,
  descricao_item,
  valor_anterior AS depto_antigo,
  valor_novo AS depto_novo,
  usuario,
  created_at
FROM compras.historico_solicitacao_compras 
WHERE campo_alterado = 'departamento' 
ORDER BY created_at DESC;
```

### Relatório de atividades (últimos 30 dias):
```sql
SELECT 
  operacao,
  campo_alterado,
  COUNT(*) as total_alteracoes,
  COUNT(DISTINCT solicitacao_id) as itens_afetados,
  COUNT(DISTINCT usuario) as usuarios
FROM compras.historico_solicitacao_compras
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY operacao, campo_alterado
ORDER BY total_alteracoes DESC;
```

## 🔒 Segurança e Integridade

- ✅ Trigger automático - **não pode ser esquecido**
- ✅ Registro imutável - histórico não é alterado
- ✅ Captura de usuário da sessão (quando configurado)
- ✅ Índices otimizados para consultas rápidas
- ✅ Constraints para garantir tipos de operação válidos

## 📁 Arquivos Envolvidos

1. **SQL:** `/sql/criar_historico_solicitacao_compras.sql`
   - Script completo de criação da tabela e triggers

2. **Backend:** `server.js`
   - Linhas ~2920-3030: Endpoints de histórico

3. **Frontend:** `menu_produto.js`
   - Função `abrirHistoricoItem()` - Modal de visualização
   - Função `fecharModalHistoricoItem()` - Fecha modal
   - Botão de histórico na tabela de aprovação

## ✅ Testes Recomendados

1. **Criar novo item** → Verificar registro INSERT no histórico
2. **Alterar quantidade** → Verificar registro UPDATE do campo quantidade
3. **Mudar status** → Verificar registro UPDATE do campo status
4. **Deletar item** → Verificar registro DELETE
5. **Abrir modal de histórico** → Verificar exibição correta dos registros

## 🚀 Próximas Melhorias Sugeridas

- [ ] Adicionar histórico em outros modals (edição, kanban)
- [ ] Exportar histórico para Excel
- [ ] Filtros avançados no modal de histórico
- [ ] Gráficos de atividade por período
- [ ] Notificações de mudanças críticas
- [ ] Reverter alterações (desfazer)

---

**Criado em:** 28/01/2026  
**Versão:** 1.0  
**Status:** ✅ Implementado e Funcional
