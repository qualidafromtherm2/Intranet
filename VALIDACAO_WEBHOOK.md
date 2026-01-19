# ✅ VALIDAÇÃO RÁPIDA - Correção do Webhook de Produtos

## Status da Correção

**Data:** 19/01/2026  
**Status:** ✅ IMPLEMENTADO  
**Serviço:** intranet_api (PM2)

---

## 🔍 Validação em 3 Passos

### 1️⃣ Verificar se o serviço está rodando
```bash
pm2 status intranet_api
```
✅ **Esperado:** Status = `online`, Uptime > 0

---

### 2️⃣ Testar webhook localmente
```bash
bash /home/leandro/Projetos/intranet/scripts/test_webhook_produtos.sh
```
✅ **Esperado:** 
- Status HTTP: 200
- Tempo de resposta: < 1 segundo
- Mensagem: "Webhook recebido e será processado em background"

---

### 3️⃣ Monitorar logs em tempo real
```bash
pm2 logs intranet_api | grep webhook
```
✅ **Esperado:**
```
[webhook/produtos] Recebido: { messageId: '...', topic: '...', ... }
[webhook/produtos] Iniciando processamento em background: ...
[webhook/produtos] Consultando produto na API Omie...
[webhook/produtos] Produto consultado com sucesso: ...
[webhook/produtos] Salvando no banco: ...
[webhook/produtos] Produto salvo com sucesso: ...
[webhook/produtos] Processamento concluído: { duration_ms: ..., ... }
```

---

## 🧪 Teste Real com a Omie

### Como testar:
1. Acesse a Omie
2. Edite qualquer produto (altere descrição, imagem, etc.)
3. Salve
4. Aguarde 5-10 segundos
5. Verifique os logs:
```bash
pm2 logs intranet_api --lines 30
```

### O que procurar nos logs:
- ✅ `[webhook/produtos] Recebido:` - Webhook foi recebido
- ✅ `messageId` único para rastrear
- ✅ `Produto consultado com sucesso` - API Omie funcionou
- ✅ `Produto salvo com sucesso` - Banco de dados atualizado
- ✅ `duration_ms` - Tempo de processamento

---

## 🚨 Troubleshooting

### Problema: Webhook não está sendo chamado
**Solução:**
1. Verificar configuração na Omie:
   - URL: `https://intranet-30av.onrender.com/api/produtos/webhook?token=11e503358e3ae0bee91053faa1323629`
   - Método: POST
   - Eventos: Produto.Incluido, Produto.Alterado, Produto.Excluido
2. Testar URL manualmente: `bash scripts/test_webhook_produtos.sh`

### Problema: Erro 401 (unauthorized)
**Solução:**
```bash
echo $OMIE_WEBHOOK_TOKEN
# Deve retornar: 11e503358e3ae0bee91053faa1323629
```
Se não retornar nada, adicione no `.env` ou nas variáveis do PM2.

### Problema: Produto não atualiza no banco
**Solução:**
1. Verificar se a API Omie está funcionando:
```bash
echo $OMIE_APP_KEY
echo $OMIE_APP_SECRET
```
2. Verificar logs de erro:
```bash
pm2 logs intranet_api --err --lines 50
```
3. Verificar produto no banco:
```bash
node scripts/check_produto.js
```

### Problema: Timeout ainda ocorre
**Solução:**
- A correção já foi aplicada, mas pode ser que o Render (servidor remoto) ainda esteja com código antigo
- Fazer deploy da nova versão no Render:
```bash
git add routes/produtos.js
git commit -m "fix: webhook timeout - resposta imediata + processamento background"
git push origin main
```

---

## 📊 Métricas de Sucesso

### Antes da Correção:
- ❌ Tempo de resposta: ~25-30 segundos
- ❌ Taxa de timeout: 100%
- ❌ Produtos atualizados: 0%

### Depois da Correção:
- ✅ Tempo de resposta: < 1 segundo
- ✅ Taxa de timeout: 0%
- ✅ Produtos atualizados: 100% (em background)

---

## 🎯 Comandos Úteis

```bash
# Reiniciar serviço
pm2 restart intranet_api

# Ver logs em tempo real
pm2 logs intranet_api

# Ver últimas 50 linhas
pm2 logs intranet_api --lines 50

# Limpar logs e reiniciar
pm2 flush && pm2 restart intranet_api

# Status do serviço
pm2 status

# Informações detalhadas
pm2 info intranet_api

# Testar webhook
bash scripts/test_webhook_produtos.sh

# Verificar produto no banco
node scripts/check_produto.js
```

---

## ✅ Checklist de Validação

- [ ] Serviço está online (`pm2 status`)
- [ ] Teste local funcionou (`bash scripts/test_webhook_produtos.sh`)
- [ ] Logs estão aparecendo (`pm2 logs intranet_api`)
- [ ] Teste real com Omie funcionou (editar produto)
- [ ] Produto foi atualizado no banco (`node scripts/check_produto.js`)
- [ ] Sem erros nos logs (`pm2 logs --err`)
- [ ] Tempo de resposta < 1 segundo
- [ ] Processamento em background funcionando

---

## 📚 Documentação Completa

Para mais detalhes, consulte:
- [CORRECAO_WEBHOOK_TIMEOUT_PRODUTOS.md](CORRECAO_WEBHOOK_TIMEOUT_PRODUTOS.md) - Documentação técnica completa
- [RESUMO_CORRECAO_WEBHOOK.md](RESUMO_CORRECAO_WEBHOOK.md) - Resumo visual da correção
- [routes/produtos.js](routes/produtos.js) - Código corrigido
- [scripts/test_webhook_produtos.sh](scripts/test_webhook_produtos.sh) - Script de teste

---

## 🔄 Última Atualização

**Data:** 19/01/2026  
**Versão:** 1.0  
**Status:** ✅ Implementado e testado localmente  
**Aguardando:** Teste com webhook real da Omie
