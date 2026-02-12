# Correção do Timeout no Webhook de Produtos

## Objetivo
Corrigir o erro de timeout (24 segundos) que estava impedindo o webhook da Omie de atualizar produtos na tabela `public.produtos_omie`.

## Problema Identificado

### Erro Original:
```json
{
  "except": "HTTPSConnectionPool(host='intranet-30av.onrender.com', port=443): Read timed out. (read timeout=24)"
}
```

### Causa Raiz:
O webhook estava fazendo operações **síncronas pesadas** antes de responder à Omie:
1. Consulta à API da Omie (`consultarProdutoOmie`)
2. Insert/Update no banco de dados
3. Re-sync da estrutura de produtos
4. Broadcast SSE para o front-end

Como essas operações demoravam mais de 24 segundos, a Omie dava timeout e o produto não era atualizado.

## Solução Implementada

### Arquitetura Nova: **Resposta Imediata + Processamento Assíncrono**

#### 1. **Resposta Imediata (< 1 segundo)**
```javascript
// Responde imediatamente para a Omie
res.json({ 
  ok: true, 
  message: 'Webhook recebido e será processado em background',
  messageId,
  timestamp: new Date().toISOString()
});
```

#### 2. **Processamento em Background (fire-and-forget)**
```javascript
// Processa em background sem bloquear a resposta
processWebhookInBackground(req.app, body, messageId).catch(err => {
  console.error('[webhook/produtos] Erro no processamento em background:', err);
});
```

#### 3. **Logs Detalhados para Rastreamento**
Todos os passos do processamento agora são logados com:
- `messageId` único para rastrear cada webhook
- Timestamps
- Detalhes do produto (codigo_produto, codigo, descricao)
- Duração do processamento
- Erros detalhados com stack trace

## Arquivos Modificados

### 1. `/routes/produtos.js`
- ✅ Webhook agora responde imediatamente
- ✅ Processamento movido para função `processWebhookInBackground()`
- ✅ Logs detalhados em cada etapa
- ✅ Suporte mantido para webhook "clássico" e Omie Connect 2.0

## Como Testar

### Teste 1: Verificar se o serviço está rodando
```bash
pm2 status
pm2 logs intranet_api --lines 50
```

### Teste 2: Simular webhook manualmente
```bash
curl -X POST "http://localhost:5001/api/produtos/webhook?token=11e503358e3ae0bee91053faa1323629" \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "test-123",
    "topic": "Produto.Alterado",
    "event": {
      "codigo_produto": 10437359849,
      "codigo": "09.MC.N.10622"
    }
  }'
```

**Resultado esperado:**
- Resposta **imediata** (< 1 segundo) com `ok: true`
- Logs no console mostrando o processamento em background
- Produto atualizado no banco após alguns segundos

### Teste 3: Verificar produto no banco
```bash
node scripts/check_produto.js
```

### Teste 4: Acompanhar logs em tempo real
```bash
pm2 logs intranet_api --lines 0
```

Edite um produto na Omie e observe os logs:
```
[webhook/produtos] Recebido: { messageId: '...', topic: 'Produto.Alterado', ... }
[webhook/produtos] Iniciando processamento em background: ...
[webhook/produtos] Consultando produto na API Omie...
[webhook/produtos] Produto consultado com sucesso: ...
[webhook/produtos] Salvando no banco: ...
[webhook/produtos] Produto salvo com sucesso: ...
[webhook/produtos] SSE enviado para o front: { produtos_atualizados: 1 }
[webhook/produtos] Processamento concluído: { duration_ms: 2531, ... }
```

## Formato dos Logs

### Log de Recebimento:
```javascript
[webhook/produtos] Recebido: {
  messageId: '5dd9451e-9b2b-4173-b837-8c8214ebba5b',
  topic: 'Produto.Alterado',
  codigo_produto: 10437359849,
  codigo: '09.MC.N.10622',
  timestamp: '2026-01-19T...'
}
```

### Log de Processamento:
```javascript
[webhook/produtos] Iniciando processamento em background: 5dd9451e-9b2b-4173-b837-8c8214ebba5b
[webhook/produtos] Processando Omie Connect 2.0: {
  messageId: '5dd9451e-9b2b-4173-b837-8c8214ebba5b',
  topic: 'Produto.Alterado',
  codigo_produto: 10437359849,
  codigo: '09.MC.N.10622'
}
[webhook/produtos] Consultando produto na API Omie...
[webhook/produtos] Produto consultado com sucesso: {
  messageId: '5dd9451e-9b2b-4173-b837-8c8214ebba5b',
  codigo_produto: 10437359849,
  codigo: '09.MC.N.10622'
}
```

### Log de Salvamento:
```javascript
[webhook/produtos] Salvando no banco: {
  messageId: '5dd9451e-9b2b-4173-b837-8c8214ebba5b',
  label: 'omie_connect',
  codigo_produto: 10437359849,
  codigo: '09.MC.N.10622',
  descricao: 'CANETA MARCADOR RETROPROJETOR PONTA 2.0MM PIL'
}
[webhook/produtos] Produto salvo com sucesso: {
  messageId: '5dd9451e-9b2b-4173-b837-8c8214ebba5b',
  codigo_produto: 10437359849,
  codigo: '09.MC.N.10622'
}
```

### Log de Conclusão:
```javascript
[webhook/produtos] Processamento concluído: {
  messageId: '5dd9451e-9b2b-4173-b837-8c8214ebba5b',
  processed: 1,
  fetched_from_omie: 1,
  failures: 0,
  duration_ms: 2531,
  touchedIds: [10437359849]
}
```

## Benefícios da Correção

✅ **Sem mais timeouts**: Omie recebe resposta em < 1 segundo  
✅ **Processamento confiável**: Continua em background mesmo após responder  
✅ **Rastreabilidade completa**: Todos os passos são logados com messageId  
✅ **Debug facilitado**: Erros detalhados com stack trace  
✅ **Monitoramento**: Duração e status de cada processamento  
✅ **Compatibilidade**: Mantém suporte a webhook clássico e Omie Connect 2.0  

## Troubleshooting

### Se o webhook continuar falhando:

#### 1. Verificar se o token está correto
```bash
echo $OMIE_WEBHOOK_TOKEN
# Deve ser: 11e503358e3ae0bee91053faa1323629
```

#### 2. Verificar se as credenciais da Omie estão configuradas
```bash
echo $OMIE_APP_KEY
echo $OMIE_APP_SECRET
```

#### 3. Verificar conectividade com a API da Omie
```bash
curl -X POST https://app.omie.com.br/api/v1/geral/produtos/ \
  -H "Content-Type: application/json" \
  -d '{
    "call": "ConsultarProduto",
    "app_key": "SEU_APP_KEY",
    "app_secret": "SEU_APP_SECRET",
    "param": [{"codigo_produto": 10437359849}]
  }'
```

#### 4. Verificar se o banco está acessível
```bash
node scripts/check_produto.js
```

## Próximos Passos

1. ✅ Aplicar correção no servidor (FEITO)
2. ⏳ Testar com webhook real da Omie
3. ⏳ Monitorar logs por 24-48h
4. ⏳ Confirmar que produtos estão sendo atualizados corretamente

## Caso o Webhook Falhe na Omie

Se a Omie continuar mostrando erro, isso pode indicar que ela espera uma resposta específica. Neste caso, podemos ajustar a resposta para incluir mais detalhes:

```javascript
res.json({ 
  ok: true,
  success: true,
  message: 'Webhook received',
  messageId,
  timestamp: new Date().toISOString()
});
```

## Monitoramento Contínuo

Execute este comando para monitorar os webhooks em tempo real:
```bash
pm2 logs intranet_api | grep webhook/produtos
```

## Referências

- Arquivo modificado: [routes/produtos.js](routes/produtos.js)
- Script de teste: [scripts/check_produto.js](scripts/check_produto.js)
- Exemplo de correção: [routes/produtos_webhook_fix.js](routes/produtos_webhook_fix.js)
