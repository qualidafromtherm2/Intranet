# Documentação - Webhook de Pedidos de Compra da Omie

## Objetivo
Este documento descreve a implementação dos webhooks da Omie para pedidos de compra, permitindo que o sistema receba e armazene automaticamente as atualizações de pedidos de compra vindas da Omie.

---

## 1. Estrutura das Tabelas

### Schema: `compras`

As tabelas foram criadas no schema `compras` para armazenar os dados dos pedidos de compra:

#### 1.1 `compras.pedidos_omie` (Cabeçalho)
Tabela principal que armazena o cabeçalho do pedido de compra.

**Principais campos:**
- `n_cod_ped` (PK): Código do pedido na Omie
- `c_numero`: Número do pedido
- `c_etapa`: Etapa do pedido (Ex: "Pendente", "Faturado", etc.)
- `n_cod_for`: Código do fornecedor
- `d_dt_previsao`: Data de previsão
- `evento_webhook`: Último evento recebido
- `inativo`: Flag para pedidos excluídos/cancelados

#### 1.2 `compras.pedidos_omie_produtos`
Armazena os produtos/itens do pedido.

**Principais campos:**
- `n_cod_ped` (FK): Código do pedido
- `n_cod_prod`: Código do produto na Omie
- `c_produto`: Código do produto
- `c_descricao`: Descrição do produto
- `n_qtde`: Quantidade
- `n_val_unit`: Valor unitário
- `n_val_tot`: Valor total do item

#### 1.3 `compras.pedidos_omie_frete`
Dados de frete do pedido (relação 1:1 com pedido).

**Principais campos:**
- `n_cod_ped` (FK): Código do pedido
- `n_cod_transp`: Código da transportadora
- `c_tp_frete`: Tipo de frete
- `n_val_frete`: Valor do frete

#### 1.4 `compras.pedidos_omie_parcelas`
Parcelas de pagamento do pedido.

**Principais campos:**
- `n_cod_ped` (FK): Código do pedido
- `n_parcela`: Número da parcela
- `d_vencto`: Data de vencimento
- `n_valor`: Valor da parcela

#### 1.5 `compras.pedidos_omie_departamentos`
Rateio por departamento do pedido.

**Principais campos:**
- `n_cod_ped` (FK): Código do pedido
- `c_cod_depto`: Código do departamento
- `n_perc`: Percentual do rateio

---

## 2. Criação das Tabelas

Execute o script SQL para criar as tabelas:

```bash
# Se estiver usando o banco local (modo JSON), não é necessário
# Se estiver usando PostgreSQL do Render:

PGPASSWORD='amLpOKjWzzDRhwcR1NF0eolJzzfCY0ho' \
psql \
  -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com \
  -p 5432 \
  -U intranet_db_yd0w_user \
  -d intranet_db_yd0w \
  -f scripts/20250117_create_pedidos_compra_omie.sql
```

---

## 3. Webhook da Omie

### 3.1 Endpoint

O webhook está configurado no seguinte endpoint:

- **URL Local**: `http://localhost:5001/webhooks/omie/pedidos-compra`
- **URL Alternativa**: `http://localhost:5001/api/webhooks/omie/pedidos-compra`

### 3.2 Eventos Suportados

O webhook processa os seguintes eventos da Omie:

1. **CompraProduto.Incluida**
   - Quando um novo pedido de compra é criado na Omie
   - Ação: Insere o pedido no banco de dados

2. **CompraProduto.Alterada**
   - Quando um pedido existente é modificado
   - Ação: Atualiza os dados do pedido no banco

3. **CompraProduto.Cancelada**
   - Quando um pedido é cancelado
   - Ação: Marca o pedido como inativo (`inativo = true`)

4. **CompraProduto.Encerrada**
   - Quando um pedido é encerrado
   - Ação: Atualiza o status do pedido

5. **CompraProduto.EtapaAlterada**
   - Quando a etapa do pedido muda
   - Ação: Atualiza a etapa no banco

6. **CompraProduto.Excluida**
   - Quando um pedido é excluído
   - Ação: Marca o pedido como inativo (`inativo = true`)

### 3.3 Fluxo de Processamento

```
1. Webhook recebe evento da Omie
   ↓
2. Valida token de segurança (OMIE_WEBHOOK_TOKEN)
   ↓
3. Extrai nCodPed (código do pedido) do evento
   ↓
4. Se for Cancelada/Excluída:
   - Marca como inativo no banco
   ↓
5. Caso contrário:
   - Consulta dados completos na API da Omie
   - Chama função upsertPedidoCompra()
   ↓
6. Atualiza tabelas:
   - pedidos_omie (cabeçalho)
   - pedidos_omie_produtos
   - pedidos_omie_frete
   - pedidos_omie_parcelas
   - pedidos_omie_departamentos
   ↓
7. Retorna confirmação para a Omie
```

---

## 4. Configuração na Omie

Para ativar os webhooks na Omie:

1. Acesse **Configurações** → **Integrações** → **Webhooks**
2. Adicione um novo webhook
3. Configure:
   - **URL**: `https://seu-dominio.com/webhooks/omie/pedidos-compra`
   - **Token**: Configure a variável `OMIE_WEBHOOK_TOKEN` no arquivo `.env` ou `config.server.js`
   - **Eventos**: Selecione todos os eventos de `CompraProduto.*`

---

## 5. Variáveis de Ambiente

Configure as seguintes variáveis no `config.server.js` ou `.env`:

```javascript
OMIE_APP_KEY=sua_app_key
OMIE_APP_SECRET=seu_app_secret
OMIE_WEBHOOK_TOKEN=token_seguro_aqui  // Token para validação dos webhooks
```

---

## 6. Testando os Webhooks

### 6.1 Verificar se o servidor está rodando

```bash
pm2 logs intranet_api
```

### 6.2 Criar um pedido de compra na Omie

1. Acesse a Omie
2. Crie um novo pedido de compra
3. Verifique nos logs se o webhook foi recebido:

```bash
pm2 logs intranet_api | grep "webhooks/omie/pedidos-compra"
```

### 6.3 Verificar dados no banco

```sql
-- Ver todos os pedidos
SELECT n_cod_ped, c_numero, c_etapa, evento_webhook, data_webhook
FROM compras.pedidos_omie
ORDER BY data_webhook DESC
LIMIT 10;

-- Ver produtos de um pedido específico
SELECT 
  p.n_cod_ped,
  p.c_produto,
  p.c_descricao,
  p.n_qtde,
  p.n_val_unit,
  p.n_val_tot
FROM compras.pedidos_omie_produtos p
WHERE p.n_cod_ped = 123456;  -- Substitua pelo código do seu pedido

-- Ver parcelas de um pedido
SELECT 
  n_parcela,
  d_vencto,
  n_valor
FROM compras.pedidos_omie_parcelas
WHERE n_cod_ped = 123456
ORDER BY n_parcela;
```

---

## 7. Endpoints Relacionados

Além do webhook, você pode consultar os dados via API:

```javascript
// GET - Listar pedidos de compra
GET /api/compras/pedidos

// GET - Consultar um pedido específico
GET /api/compras/pedidos/:nCodPed

// POST - Sincronizar pedidos manualmente (implementar se necessário)
POST /api/compras/pedidos/sync
```

---

## 8. Logs e Monitoramento

Os logs do webhook são identificados com o prefixo:
- `[webhooks/omie/pedidos-compra]`

Para monitorar:

```bash
# Ver logs em tempo real
pm2 logs intranet_api --lines 100

# Filtrar apenas logs de pedidos de compra
pm2 logs intranet_api | grep "pedidos-compra"

# Esvaziar logs antigos
pm2 flush
```

---

## 9. Solução de Problemas

### Webhook não está recebendo eventos

1. Verifique se o servidor está rodando:
   ```bash
   pm2 status
   ```

2. Verifique se o token está configurado corretamente:
   ```bash
   echo $OMIE_WEBHOOK_TOKEN
   ```

3. Verifique os logs de erro:
   ```bash
   pm2 logs intranet_api --err
   ```

### Dados não estão sendo salvos

1. Verifique se as tabelas existem:
   ```sql
   SELECT table_name 
   FROM information_schema.tables 
   WHERE table_schema = 'compras' 
   AND table_name LIKE 'pedidos_omie%';
   ```

2. Verifique permissões do usuário do banco

3. Verifique logs da aplicação para erros de SQL

### Webhook retorna erro 401

- O token está incorreto ou não foi configurado
- Verifique a variável `OMIE_WEBHOOK_TOKEN` no servidor

---

## 10. Estrutura de Código

### Arquivo: `server.js`

**Função principal:**
- `upsertPedidoCompra(pedido, eventoWebhook)` - Linha ~9965
  - Processa e salva pedido completo no banco
  - Usa transação para garantir integridade dos dados

**Webhook:**
- `POST /webhooks/omie/pedidos-compra` - Linha ~2175
  - Recebe eventos da Omie
  - Valida token
  - Processa cada tipo de evento

### Arquivo: `scripts/20250117_create_pedidos_compra_omie.sql`
- Script de criação de todas as tabelas
- Inclui índices para performance
- Comentários nas tabelas e campos

---

## 11. Próximos Passos

- [ ] Criar endpoints de consulta para listar pedidos
- [ ] Implementar sincronização manual de pedidos antigos
- [ ] Criar dashboard para visualizar pedidos
- [ ] Adicionar notificações quando novos pedidos chegarem
- [ ] Implementar filtros por fornecedor, data, etapa, etc.

---

## 12. Referências

- **Documentação Omie**: https://developer.omie.com.br
- **Script da API**: `scripts/PedidoCompraJsonClient.js`
- **Tabelas SQL**: `scripts/20250117_create_pedidos_compra_omie.sql`

---

**Data da implementação**: 17/01/2025
**Desenvolvido por**: GitHub Copilot
