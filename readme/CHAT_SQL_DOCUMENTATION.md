# Sistema de Chat - Documentação SQL

## ✅ Estrutura Criada com Sucesso

Data: 21/11/2025

### 📊 Tabela Principal: `chat_messages`

**Colunas:**
- `id` - ID único da mensagem (auto-incremento)
- `from_user_id` - ID do usuário que enviou (referência: auth_user)
- `to_user_id` - ID do usuário que recebeu (referência: auth_user)
- `message_text` - Texto da mensagem
- `is_read` - Se a mensagem foi lida (padrão: false)
- `created_at` - Data/hora de criação
- `updated_at` - Data/hora de atualização

**Regras de Integridade:**
- ✅ Não permite enviar mensagem para si mesmo
- ✅ Valida que usuários existem em `auth_user`
- ✅ Exclui mensagens automaticamente se usuário for deletado (CASCADE)
- ✅ 6 índices para otimização de consultas

---

### 🔧 Funções SQL Disponíveis

#### 1. `get_active_chat_users(p_current_user_id)`
**Objetivo:** Lista usuários ATIVOS disponíveis para chat

**Retorna:**
- id
- username
- email
- created_at
- unread_count (quantidade de mensagens não lidas daquele usuário)

**Regras:**
- ✅ Só mostra usuários com `is_active = TRUE`
- ✅ Exclui o próprio usuário da lista
- ✅ Ordena por username alfabeticamente

**Exemplo de uso:**
```sql
SELECT * FROM get_active_chat_users(1); -- Lista usuários exceto ID 1
```

---

#### 2. `send_chat_message(p_from_user_id, p_to_user_id, p_message_text)`
**Objetivo:** Envia uma nova mensagem

**Validações:**
- ✅ Verifica se ambos usuários existem
- ✅ Verifica se ambos estão ativos (`is_active = TRUE`)
- ✅ Não permite enviar para si mesmo
- ✅ Não permite mensagem vazia

**Retorna:** ID da mensagem criada

**Exemplo de uso:**
```sql
SELECT send_chat_message(1, 2, 'Olá! Como está?');
```

---

#### 3. `get_conversation(p_user1_id, p_user2_id, p_limit)`
**Objetivo:** Retorna histórico de mensagens entre dois usuários

**Parâmetros:**
- p_user1_id - ID do primeiro usuário
- p_user2_id - ID do segundo usuário
- p_limit - Máximo de mensagens (padrão: 100)

**Retorna:** Mensagens ordenadas cronologicamente (mais antigas primeiro)

**Exemplo de uso:**
```sql
SELECT * FROM get_conversation(1, 2); -- Últimas 100 mensagens
SELECT * FROM get_conversation(1, 2, 50); -- Últimas 50 mensagens
```

---

#### 4. `mark_messages_as_read(p_user_id, p_from_user_id)`
**Objetivo:** Marca mensagens como lidas

**Marca como lidas:** Todas as mensagens não lidas que o `p_from_user_id` enviou para `p_user_id`

**Retorna:** Quantidade de mensagens marcadas como lidas

**Exemplo de uso:**
```sql
SELECT mark_messages_as_read(1, 2); -- Marca como lidas mensagens de 2 para 1
```

---

#### 5. `count_unread_messages(p_user_id)`
**Objetivo:** Conta total de mensagens não lidas

**Retorna:** Número inteiro com total de mensagens não lidas

**Exemplo de uso:**
```sql
SELECT count_unread_messages(1); -- Total de não lidas para usuário 1
```

---

#### 6. `get_recent_conversations(p_user_id, p_limit)`
**Objetivo:** Lista conversas recentes com preview

**Retorna:**
- other_user_id
- other_username
- last_message (preview da última mensagem)
- last_message_time
- unread_count (não lidas daquele usuário)
- is_from_me (se a última mensagem foi enviada por você)

**Regras:**
- ✅ Só mostra usuários ativos
- ✅ Ordena por mensagem mais recente

**Exemplo de uso:**
```sql
SELECT * FROM get_recent_conversations(1, 10); -- 10 conversas mais recentes
```

---

### 🎯 Como Usar no Backend (Node.js)

**1. Listar usuários ativos para chat:**
```javascript
const result = await db.query(
  'SELECT * FROM get_active_chat_users($1)',
  [currentUserId]
);
const users = result.rows;
```

**2. Enviar mensagem:**
```javascript
const result = await db.query(
  'SELECT send_chat_message($1, $2, $3)',
  [fromUserId, toUserId, messageText]
);
const messageId = result.rows[0].send_chat_message;
```

**3. Obter conversa:**
```javascript
const result = await db.query(
  'SELECT * FROM get_conversation($1, $2)',
  [user1Id, user2Id]
);
const messages = result.rows;
```

**4. Marcar como lidas:**
```javascript
await db.query(
  'SELECT mark_messages_as_read($1, $2)',
  [currentUserId, otherUserId]
);
```

---

### 📋 Próximos Passos

1. ✅ Atualizar rotas do backend (`server.js`) para usar as funções SQL
2. ✅ Modificar rota `/api/chat/users` para usar `get_active_chat_users`
3. ✅ Modificar rota `/api/chat/conversation` para usar `get_conversation`
4. ✅ Modificar rota `/api/chat/send` para usar `send_chat_message`
5. ✅ Adicionar rota para marcar mensagens como lidas
6. ✅ Adicionar contador de mensagens não lidas no badge

---

### 🔍 Consultas Úteis para Debug

```sql
-- Ver todas as mensagens
SELECT * FROM chat_messages ORDER BY created_at DESC;

-- Ver usuários ativos
SELECT id, username, is_active FROM auth_user WHERE is_active = TRUE;

-- Contar mensagens por usuário
SELECT from_user_id, COUNT(*) 
FROM chat_messages 
GROUP BY from_user_id;

-- Ver mensagens não lidas
SELECT * FROM chat_messages WHERE is_read = FALSE;
```

---

### ⚠️ Observações Importantes

1. **is_active**: A coluna `is_active` da tabela `auth_user` é usada para filtrar usuários
2. **Segurança**: Todas as funções validam se usuários existem e estão ativos
3. **Performance**: Índices criados para otimizar consultas frequentes
4. **Integridade**: Foreign keys garantem que mensagens só existem entre usuários válidos
5. **Cascade**: Se um usuário for deletado, suas mensagens também são deletadas automaticamente

---

**Script SQL completo:** `/scripts/20251121_create_chat_system.sql`
