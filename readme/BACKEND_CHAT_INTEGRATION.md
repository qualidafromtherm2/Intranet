# Integração Backend - Sistema de Chat com SQL

## ✅ Rotas Atualizadas no server.js

Data: 21/11/2025

---

### 📍 Rota 1: GET `/api/chat/users`

**Objetivo:** Lista usuários ATIVOS disponíveis para chat (exclui o próprio usuário)

**Arquivo:** `server.js`  
**Linha:** ~5145

**O que mudou:**
- ✅ Agora usa função SQL `get_active_chat_users(user_id)`
- ✅ Filtra automaticamente por `is_active = TRUE`
- ✅ Exclui o próprio usuário da lista
- ✅ Retorna contagem de mensagens não lidas de cada usuário
- ✅ Mantém fallback para `users.json` se SQL falhar

**Retorno:**
```json
{
  "users": [
    {
      "id": "2",
      "username": "joao",
      "email": "joao@empresa.com",
      "unreadCount": 3
    }
  ]
}
```

---

### 📍 Rota 2: GET `/api/chat/conversation?userId=X`

**Objetivo:** Retorna histórico de mensagens entre usuário logado e outro usuário

**Arquivo:** `server.js`  
**Linha:** ~5180

**O que mudou:**
- ✅ Usa função SQL `get_conversation(user1, user2, limit)`
- ✅ Retorna últimas 100 mensagens da conversa
- ✅ **MARCA AUTOMATICAMENTE como lidas** quando abre a conversa
- ✅ Mantém fallback para arquivo JSON

**Retorno:**
```json
{
  "messages": [
    {
      "id": "1",
      "from": "1",
      "to": "2",
      "text": "Olá! Como está?",
      "timestamp": "2025-11-21T10:30:00Z",
      "read": true
    }
  ]
}
```

---

### 📍 Rota 3: POST `/api/chat/send`

**Objetivo:** Envia nova mensagem

**Arquivo:** `server.js`  
**Linha:** ~5220

**Body:**
```json
{
  "to": "2",
  "text": "Mensagem de teste"
}
```

**O que mudou:**
- ✅ Usa função SQL `send_chat_message(from, to, text)`
- ✅ **Valida automaticamente** se usuários estão ativos
- ✅ **Valida automaticamente** se não está enviando para si mesmo
- ✅ Retorna erro específico se validação falhar
- ✅ Mantém fallback para arquivo JSON

**Validações SQL automáticas:**
- Usuário remetente existe e está ativo
- Usuário destinatário existe e está ativo
- Não permite enviar para si mesmo
- Mensagem não pode ser vazia

**Retorno sucesso:**
```json
{
  "ok": true,
  "message": {
    "id": "123",
    "from": "1",
    "to": "2",
    "text": "Mensagem de teste",
    "timestamp": "2025-11-21T10:30:00Z",
    "read": false
  }
}
```

**Retorno erro (exemplo):**
```json
{
  "error": "Usuário destinatário está inativo"
}
```

---

### 📍 Rota 4: GET `/api/chat/unread-count` (NOVA!)

**Objetivo:** Retorna total de mensagens não lidas para o badge de notificação

**Arquivo:** `server.js`  
**Linha:** ~5285

**O que faz:**
- ✅ Usa função SQL `count_unread_messages(user_id)`
- ✅ Retorna total de mensagens não lidas
- ✅ Pode ser usada para atualizar badge em tempo real

**Retorno:**
```json
{
  "count": 5
}
```

**Como usar no frontend:**
```javascript
// Atualizar badge periodicamente
setInterval(async () => {
  const res = await fetch('/api/chat/unread-count', { credentials: 'include' });
  const { count } = await res.json();
  document.querySelector('.notification-number').textContent = count;
  document.querySelector('.notification-number').style.display = count > 0 ? 'inline-flex' : 'none';
}, 30000); // A cada 30 segundos
```

---

## 🔧 Melhorias Implementadas

### 1. **Segurança e Validação**
- ✅ Todas as operações validam se usuários existem e estão ativos
- ✅ Não permite enviar mensagem para usuário inativo
- ✅ Não permite enviar mensagem para si mesmo
- ✅ Mensagens vazias são rejeitadas

### 2. **Performance**
- ✅ Usa índices SQL otimizados
- ✅ Queries otimizadas para conversas frequentes
- ✅ Marca como lidas automaticamente ao abrir conversa

### 3. **Experiência do Usuário**
- ✅ Lista mostra apenas usuários ativos
- ✅ Contagem de não lidas por usuário
- ✅ Mensagens marcadas como lidas automaticamente
- ✅ Badge global de notificações

### 4. **Confiabilidade**
- ✅ Fallback para JSON se SQL falhar
- ✅ Logs detalhados de erros
- ✅ Tratamento de exceções em todas as rotas
- ✅ Validações robustas

---

## 📊 Fluxo Completo do Chat

```
1. Usuário clica no sino
   ↓
2. Frontend chama GET /api/chat/users
   ↓
3. Backend usa get_active_chat_users(current_user_id)
   ↓
4. Retorna lista de usuários ATIVOS com contagem de não lidas
   ↓
5. Usuário seleciona um contato
   ↓
6. Frontend chama GET /api/chat/conversation?userId=X
   ↓
7. Backend usa get_conversation(user1, user2)
   ↓
8. Backend marca mensagens como lidas automaticamente
   ↓
9. Retorna histórico da conversa
   ↓
10. Usuário digita e envia mensagem
   ↓
11. Frontend chama POST /api/chat/send
   ↓
12. Backend usa send_chat_message() com validações
   ↓
13. Retorna mensagem criada ou erro de validação
```

---

## 🧪 Como Testar

### 1. **Testar listagem de usuários:**
```bash
curl -X GET http://localhost:5001/api/chat/users \
  -H "Cookie: seu-cookie-de-sessao"
```

### 2. **Testar conversa:**
```bash
curl -X GET "http://localhost:5001/api/chat/conversation?userId=2" \
  -H "Cookie: seu-cookie-de-sessao"
```

### 3. **Testar envio:**
```bash
curl -X POST http://localhost:5001/api/chat/send \
  -H "Cookie: seu-cookie-de-sessao" \
  -H "Content-Type: application/json" \
  -d '{"to":"2","text":"Mensagem teste"}'
```

### 4. **Testar contador:**
```bash
curl -X GET http://localhost:5001/api/chat/unread-count \
  -H "Cookie: seu-cookie-de-sessao"
```

---

## ⚠️ Observações Importantes

1. **is_active = TRUE**: Apenas usuários com `is_active = TRUE` aparecem no chat
2. **Auto-read**: Mensagens são marcadas como lidas automaticamente ao abrir conversa
3. **Validações SQL**: Erros de validação retornam mensagens específicas
4. **Fallback JSON**: Sistema continua funcionando se SQL falhar
5. **Logs**: Todos os erros são logados no console com prefixo `[CHAT]`

---

## 📝 Próximos Passos Sugeridos

1. ✅ Testar no navegador enviando mensagens
2. ✅ Verificar se badge de notificação atualiza
3. ✅ Confirmar que só usuários ativos aparecem
4. ⏳ Adicionar notificações em tempo real (WebSocket/SSE) - opcional
5. ⏳ Adicionar indicador "digitando..." - opcional
6. ⏳ Adicionar histórico de conversas recentes - opcional (função já existe: `get_recent_conversations`)

---

**Servidor reiniciado com sucesso!** 🚀
Agora o chat está integrado com o SQL e todas as validações estão ativas.
