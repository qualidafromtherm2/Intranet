# ✅ Configuração do Webhook de Fornecedores na Omie - GUIA COMPLETO

## 🎯 Sistema Implementado e Funcionando

A tabela `omie.fornecedores` foi criada automaticamente e o webhook está pronto para receber atualizações da Omie.

---

## 📊 1. POPULAR A TABELA (Primeira Vez)

### Opção A: Sincronização Automática (Recomendado)

O servidor está executando a sincronização automática. Aguarde alguns minutos e verifique:

```bash
# Verificar se os fornecedores foram carregados
curl http://localhost:5001/api/fornecedores?limit=10
```

### Opção B: Sincronização Manual

Se quiser forçar a sincronização novamente:

```bash
curl -X POST http://localhost:5001/api/fornecedores/sync
```

**⚠️ ATENÇÃO**: A sincronização pode demorar de 2 a 10 minutos dependendo da quantidade de fornecedores.

**Verificar progresso nos logs**:
```bash
pm2 logs intranet_api --lines 50
```

Você verá mensagens como:
```
[Fornecedores] Iniciando sincronização com Omie...
[Fornecedores] Sincronização concluída: 150 fornecedores
```

---

## 🔔 2. CONFIGURAR WEBHOOK NA OMIE

### URL do Webhook

Seu webhook já está configurado e rodando em:

```
https://intranet-30av.onrender.com/webhooks/omie/clientes?token=<OMIE_WEBHOOK_TOKEN>
```

### Passo a Passo na Interface da Omie

1. **Acesse**: https://app.omie.com.br
2. **Menu**: Configurações → Integrações → Webhooks (ou Omie Connect 2.0)
3. **Clique em**: "Novo Webhook" ou "Adicionar Webhook"

### Configuração do Webhook

Preencha os campos conforme abaixo:

| Campo | Valor |
|-------|-------|
| **Nome** | `Webhook Fornecedores Intranet` |
| **Evento/Tópico** | `Clientes/Fornecedores` |
| **Operações** | ✅ Todas marcadas:<br>• ClienteFornecedor.Incluido<br>• ClienteFornecedor.Alterado<br>• ClienteFornecedor.Excluido |
| **URL** | `https://intranet-30av.onrender.com/webhooks/omie/clientes?token=<OMIE_WEBHOOK_TOKEN>` |
| **Método HTTP** | `POST` |
| **Content-Type** | `application/json` |
| **Status** | `Ativo` ✅ |

**📸 Captura de tela da configuração:**
```
┌─────────────────────────────────────────────────┐
│ Nome: Webhook Fornecedores Intranet             │
│                                                  │
│ Evento: Clientes/Fornecedores                   │
│                                                  │
│ Operações:                                       │
│ ☑ ClienteFornecedor.Incluido                    │
│ ☑ ClienteFornecedor.Alterado                    │
│ ☑ ClienteFornecedor.Excluido                    │
│                                                  │
│ URL: https://intranet-30av.onrender.com/        │
│      webhooks/omie/clientes?token=11e50...      │
│                                                  │
│ Status: ● Ativo                                  │
└─────────────────────────────────────────────────┘
```

### 3. Testar o Webhook

Após salvar, clique em **"Testar Webhook"** na interface da Omie.

**Resposta esperada** (código 200):
```json
{
  "ok": true,
  "codigo_cliente_omie": 12345678,
  "acao": "incluido",
  "atualizado": true
}
```

---

## 🧪 3. TESTAR MANUALMENTE (Sem usar interface da Omie)

Se quiser testar o webhook sem usar a Omie:

```bash
curl -X POST "https://intranet-30av.onrender.com/webhooks/omie/clientes?token=<OMIE_WEBHOOK_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "ClienteFornecedor.Alterado",
    "event": {
      "codigo_cliente_omie": 12345678
    }
  }'
```

---

## 📡 4. COMO FUNCIONA

### Fluxo de Atualização Automática

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│   OMIE       │──────▶│   WEBHOOK    │──────▶│  BANCO DE    │
│ (alteração)  │ HTTP  │   HANDLER    │ SQL   │    DADOS     │
└──────────────┘       └──────────────┘       └──────────────┘
     │                                              │
     │ 1. Fornecedor alterado                       │
     │ 2. Webhook disparado                         │
     │ 3. Consulta dados completos                  │
     │ 4. Upsert no banco ────────────────────────▶ │
                                                     │
                     ┌───────────────────────────────┘
                     │ 5. Dados atualizados
                     ▼
            ┌──────────────────┐
            │  API Consulta    │ GET /api/fornecedores
            │  (Instantâneo)   │
            └──────────────────┘
```

### Eventos Tratados

| Evento na Omie | Ação no Sistema |
|----------------|-----------------|
| `ClienteFornecedor.Incluido` | Insere novo fornecedor no banco |
| `ClienteFornecedor.Alterado` | Atualiza dados do fornecedor |
| `ClienteFornecedor.Excluido` | Marca como `inativo = true` |

---

## 🔍 5. VERIFICAR SE ESTÁ FUNCIONANDO

### Consultar fornecedores no banco

```bash
# Via API
curl http://localhost:5001/api/fornecedores?limit=5

# Via SQL direto
PGPASSWORD=amLpOKjWzzDRhwcR1NF0eolJzzfCY0ho psql \
  -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com \
  -U intranet_db_yd0w_user \
  intranet_db_yd0w \
  -c "SELECT COUNT(*) as total FROM omie.fornecedores;"
```

### Acompanhar logs em tempo real

```bash
pm2 logs intranet_api
```

**Logs esperados quando webhook é recebido:**
```
[webhooks/omie/clientes] Webhook recebido: {...}
[webhooks/omie/clientes] Processando evento "ClienteFornecedor.Alterado" para cliente 12345678
[webhooks/omie/clientes] Cliente 12345678 alterado com sucesso
```

---

## 📋 6. ENDPOINTS DISPONÍVEIS

### 6.1 Listar Fornecedores

```bash
GET /api/fornecedores
```

**Parâmetros opcionais:**
- `ativo=true|false` - Filtra por status ativo/inativo
- `search=termo` - Busca por razão social, nome fantasia ou CNPJ
- `limit=100` - Limite de resultados (padrão: 100)

**Exemplos:**

```bash
# Todos os fornecedores ativos
curl "http://localhost:5001/api/fornecedores?ativo=true"

# Buscar por nome
curl "http://localhost:5001/api/fornecedores?search=fromtherm"

# Buscar por CNPJ
curl "http://localhost:5001/api/fornecedores?search=12.345.678"

# Limitar resultados
curl "http://localhost:5001/api/fornecedores?limit=10"
```

**Resposta:**
```json
{
  "ok": true,
  "total": 10,
  "fornecedores": [
    {
      "id": 1,
      "codigo_cliente_omie": 12345678,
      "razao_social": "FROMTHERM INDUSTRIA LTDA",
      "nome_fantasia": "Fromtherm",
      "cnpj_cpf": "12.345.678/0001-90",
      "telefone1_ddd": "11",
      "telefone1_numero": "99999-9999",
      "email": "contato@fromtherm.com.br",
      "cidade": "São Paulo",
      "estado": "SP",
      "inativo": false,
      "tags": ["FORNECEDOR", "CLIENTE"],
      "created_at": "2026-01-09T12:00:00.000Z",
      "updated_at": "2026-01-09T12:30:00.000Z"
    }
  ]
}
```

### 6.2 Buscar Fornecedor Específico

```bash
GET /api/fornecedores/:codigo_cliente_omie
```

**Exemplo:**
```bash
curl "http://localhost:5001/api/fornecedores/12345678"
```

### 6.3 Sincronizar Manualmente

```bash
POST /api/fornecedores/sync
```

**Exemplo:**
```bash
curl -X POST "http://localhost:5001/api/fornecedores/sync"
```

---

## ⚠️ 7. TROUBLESHOOTING

### Problema: Fornecedores não aparecem

**Verificar se a sincronização rodou:**
```bash
pm2 logs intranet_api | grep Fornecedores
```

**Deve aparecer:**
```
[Fornecedores] Schema e tabela garantidos
[Fornecedores] Iniciando sincronização com Omie...
[Fornecedores] Sincronização concluída: X fornecedores
```

**Se não rodou, execute manualmente:**
```bash
curl -X POST http://localhost:5001/api/fornecedores/sync
```

---

### Problema: Webhook retorna erro 401

**Causa:** Token inválido

**Verificar:** O token na URL deve ser exatamente:
```
<OMIE_WEBHOOK_TOKEN>
```

**URL completa:**
```
https://intranet-30av.onrender.com/webhooks/omie/clientes?token=<OMIE_WEBHOOK_TOKEN>
```

---

### Problema: Webhook não atualiza

**1. Verificar se o webhook está ativo na Omie**

Vá em: Configurações → Integrações → Webhooks
- Status deve estar **Ativo** ✅

**2. Testar webhook manualmente**

Na interface da Omie, clique em "Testar Webhook"

**3. Verificar logs do servidor**
```bash
pm2 logs intranet_api --lines 100
```

**4. Alterar um fornecedor de teste**

Faça uma pequena alteração em um fornecedor na Omie e verifique os logs

---

### Problema: Erro "relation omie.fornecedores does not exist"

**Causa:** Schema ou tabela não foi criada

**Solução:**
```bash
# Reiniciar servidor
pm2 restart intranet_api

# Verificar nos logs se aparece:
# [Fornecedores] Schema e tabela garantidos
pm2 logs intranet_api | grep Fornecedores
```

---

## ✅ 8. CHECKLIST DE CONFIGURAÇÃO

- [x] Tabela `omie.fornecedores` criada automaticamente
- [x] Webhook endpoint criado e funcionando
- [ ] **Executar sincronização inicial**: `curl -X POST http://localhost:5001/api/fornecedores/sync`
- [ ] **Aguardar conclusão** (verificar logs: `pm2 logs intranet_api`)
- [ ] **Configurar webhook na Omie** com a URL fornecida
- [ ] **Marcar os 3 eventos**: Incluido, Alterado, Excluido
- [ ] **Ativar o webhook** na interface da Omie
- [ ] **Testar o webhook** usando botão "Testar" na Omie
- [ ] **Verificar resposta**: Deve retornar código 200 OK
- [ ] **Fazer teste real**: Alterar um fornecedor na Omie
- [ ] **Verificar logs**: `pm2 logs intranet_api`
- [ ] **Consultar API**: `curl http://localhost:5001/api/fornecedores?limit=5`

---

## 🎯 9. RESUMO RÁPIDO

### URL DO WEBHOOK PARA CONFIGURAR NA OMIE:
```
https://intranet-30av.onrender.com/webhooks/omie/clientes?token=<OMIE_WEBHOOK_TOKEN>
```

### EVENTOS A MARCAR:
- ✅ ClienteFornecedor.Incluido
- ✅ ClienteFornecedor.Alterado  
- ✅ ClienteFornecedor.Excluido

### COMANDOS ÚTEIS:
```bash
# Sincronizar manualmente
curl -X POST http://localhost:5001/api/fornecedores/sync

# Ver logs
pm2 logs intranet_api

# Listar fornecedores
curl http://localhost:5001/api/fornecedores?limit=10

# Buscar específico
curl http://localhost:5001/api/fornecedores/12345678
```

---

## 📞 10. SUPORTE

Se tiver problemas, verifique:

1. **Logs do servidor**: `pm2 logs intranet_api`
2. **Tabela no banco**: `SELECT COUNT(*) FROM omie.fornecedores;`
3. **Status do webhook na Omie**: Deve estar "Ativo"
4. **Token na URL**: Deve ser exatamente o configurado

---

**✅ Sistema pronto para uso!**

Assim que configurar o webhook na Omie, qualquer alteração em fornecedores será automaticamente sincronizada com seu banco de dados local! 🚀
