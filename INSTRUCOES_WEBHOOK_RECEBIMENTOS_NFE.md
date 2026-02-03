# 📥 Webhook de Recebimentos de NF-e - Omie

## 🎯 Visão Geral

Este webhook captura eventos de recebimentos de NF-e da Omie e sincroniza automaticamente com o banco de dados PostgreSQL no schema `logistica`.

## 📍 Endpoints

**URLs aceitas:**
- `POST https://intranet-30av.onrender.com/webhooks/omie/recebimentos-nfe`
- `POST https://intranet-30av.onrender.com/api/webhooks/omie/recebimentos-nfe`

**Localhost:**
- `POST http://localhost:5001/webhooks/omie/recebimentos-nfe`
- `POST http://localhost:5001/api/webhooks/omie/recebimentos-nfe`

## 🔔 Eventos Suportados

O webhook responde aos seguintes eventos da Omie:

| Evento | Descrição | Ação |
|--------|-----------|------|
| `RecebimentoProduto.Incluido` | NF-e incluída no sistema | Insere recebimento completo no banco |
| `RecebimentoProduto.Alterado` | NF-e alterada | Atualiza dados do recebimento |
| `RecebimentoProduto.Concluido` | Recebimento concluído | Atualiza status para concluído |
| `RecebimentoProduto.Devolvido` | NF-e devolvida | Marca como devolvida |
| `RecebimentoProduto.Revertido` | Recebimento revertido | Reverte status do recebimento |
| `RecebimentoProduto.Excluido` | NF-e excluída | Marca como cancelada (c_cancelada='S') |

## 📊 Estrutura do Payload

### Exemplo de Payload (RecebimentoProduto.Incluido)

```json
{
  "topic": "RecebimentoProduto.Incluido",
  "messageId": "msg-123456",
  "evento": {
    "nIdReceb": 10810037468,
    "cChaveNfe": "35260159086148000133550020000035421654706059",
    "cabec": {
      "nIdReceb": 10810037468,
      "cChaveNfe": "35260159086148000133550020000035421654706059",
      "cNumeroNFe": "000003542",
      "cEtapa": "40"
    }
  }
}
```

### Campos Importantes

- **nIdReceb** (obrigatório): ID único do recebimento na Omie
- **cChaveNfe** (alternativo): Chave de acesso da NF-e (44 dígitos)
- **topic**: Nome do evento (RecebimentoProduto.*)
- **messageId**: ID único da mensagem do webhook

## 🔄 Fluxo de Processamento

### 1. Recebimento do Webhook
```
Omie → POST /webhooks/omie/recebimentos-nfe → API
```

### 2. Validação Inicial
- Extrai `nIdReceb` ou `cChaveNfe` do payload
- Valida presença de pelo menos um identificador
- Retorna resposta imediata (200 OK) para evitar reenvio

### 3. Processamento Assíncrono

#### Para eventos de Inclusão/Alteração/Conclusão:
1. Aguarda 2 segundos (delay para Omie processar)
2. Consulta dados completos via API: `ConsultarRecebimento`
3. Faz upsert completo no banco (4 tabelas):
   - `logistica.recebimentos_nfe_omie` (cabeçalho)
   - `logistica.recebimentos_nfe_itens` (itens)
   - `logistica.recebimentos_nfe_parcelas` (financeiro)
   - `logistica.recebimentos_nfe_frete` (logística)

#### Para evento de Exclusão:
1. Atualiza campo `c_cancelada = 'S'` no registro existente
2. Mantém dados históricos (soft delete)

## 🗄️ Dados Sincronizados

### Tabela Principal: `recebimentos_nfe_omie`

**Identificação:**
- n_id_receb (PK)
- c_chave_nfe (UNIQUE)
- c_numero_nfe, c_serie_nfe, c_modelo_nfe

**Datas:**
- d_emissao_nfe, d_entrada, d_registro

**Valores:**
- n_valor_nfe, v_total_produtos, v_aprox_tributos
- v_desconto, v_frete, v_seguro, v_outras, v_ipi, v_icms_st

**Fornecedor:**
- n_id_fornecedor, c_nome_fornecedor, c_cnpj_cpf_fornecedor

**Etapa do Recebimento:**
- c_etapa (10, 20, 30, 40, 50, 60, 80)
- c_desc_etapa

**Status - Faturado:**
- c_faturado ('S'/'N')
- d_fat (data), h_fat (hora), c_usuario_fat

**Status - Recebido:**
- c_recebido ('S'/'N')
- d_rec (data), h_rec (hora), c_usuario_rec

**Status - Devolvido:**
- c_devolvido ('S'/'N')
- c_devolvido_parc ('S'/'N')
- d_dev (data), h_dev (hora), c_usuario_dev

**Status - Outros:**
- c_autorizado, c_bloqueado, c_cancelada

### Tabela de Itens: `recebimentos_nfe_itens`

**Vinculação com Pedido de Compra:**
- n_num_ped_compra ← **Campo crucial para vincular com pedidos!**
- n_id_pedido
- n_id_it_pedido

**Produto:**
- n_id_produto, c_codigo_produto, c_descricao_produto, c_ncm

**Quantidades:**
- n_qtde_nfe, c_unidade_nfe
- n_qtde_recebida, n_qtde_divergente

**Valores:**
- n_preco_unit, v_total_item, v_desconto
- v_icms, v_ipi, v_pis, v_cofins, v_icms_st

**Estoque:**
- codigo_local_estoque, c_local_estoque

## 🔧 Configuração na Omie

### 1. Acessar Configurações de Webhook

1. Entre em **Configurações** → **Webhooks**
2. Clique em **Novo Webhook**

### 2. Configurar o Webhook

**URL de Destino:**
```
https://intranet-30av.onrender.com/webhooks/omie/recebimentos-nfe
```

**Eventos a Monitorar:**
- ✅ RecebimentoProduto.Incluido
- ✅ RecebimentoProduto.Alterado
- ✅ RecebimentoProduto.Concluido
- ✅ RecebimentoProduto.Devolvido
- ✅ RecebimentoProduto.Revertido
- ✅ RecebimentoProduto.Excluido

**Autenticação:** (Opcional)
- Tipo: Bearer Token (se implementado)

**Timeout:** 30 segundos

**Retentativas:** 3 tentativas com backoff exponencial

## 🧪 Testar Webhook

### Teste Local

```bash
# Simular webhook de inclusão
curl -X POST http://localhost:5001/webhooks/omie/recebimentos-nfe \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "RecebimentoProduto.Incluido",
    "messageId": "test-123",
    "evento": {
      "nIdReceb": 10810037468,
      "cChaveNfe": "35260159086148000133550020000035421654706059"
    }
  }'
```

### Verificar Logs

```bash
# Monitorar logs do webhook
pm2 logs intranet_api --lines 50 | grep "recebimentos-nfe"

# Verificar erros
tail -f ~/.pm2/logs/intranet-api-error.log | grep "recebimentos-nfe"
```

### Consultar Banco de Dados

```sql
-- Ver últimos recebimentos sincronizados
SELECT 
  n_id_receb,
  c_numero_nfe,
  c_etapa,
  c_faturado,
  c_recebido,
  d_emissao_nfe,
  n_valor_nfe,
  updated_at
FROM logistica.recebimentos_nfe_omie
ORDER BY updated_at DESC
LIMIT 10;

-- Ver itens com vinculação a pedidos
SELECT 
  r.c_numero_nfe,
  i.c_codigo_produto,
  i.c_descricao_produto,
  i.n_qtde_nfe,
  i.n_num_ped_compra,
  i.n_id_pedido
FROM logistica.recebimentos_nfe_itens i
JOIN logistica.recebimentos_nfe_omie r ON r.n_id_receb = i.n_id_receb
WHERE i.n_num_ped_compra IS NOT NULL
ORDER BY r.updated_at DESC
LIMIT 10;
```

## 📈 Monitoramento

### Estatísticas de Recebimentos

```sql
-- Resumo por etapa
SELECT 
  c_etapa,
  e.descricao_customizada as etapa_desc,
  COUNT(*) as quantidade,
  SUM(n_valor_nfe) as valor_total
FROM logistica.recebimentos_nfe_omie r
LEFT JOIN logistica.etapas_recebimento_nfe e ON e.codigo = r.c_etapa
GROUP BY c_etapa, e.descricao_customizada
ORDER BY c_etapa;

-- Recebimentos faturados mas não recebidos
SELECT 
  c_numero_nfe,
  c_nome_fornecedor,
  d_emissao_nfe,
  d_fat,
  n_valor_nfe
FROM logistica.recebimentos_nfe_omie
WHERE c_faturado = 'S' 
  AND c_recebido = 'N'
  AND c_cancelada = 'N'
ORDER BY d_fat DESC;

-- Recebimentos com divergência de quantidade
SELECT 
  r.c_numero_nfe,
  i.c_codigo_produto,
  i.c_descricao_produto,
  i.n_qtde_nfe,
  i.n_qtde_recebida,
  i.n_qtde_divergente
FROM logistica.recebimentos_nfe_itens i
JOIN logistica.recebimentos_nfe_omie r ON r.n_id_receb = i.n_id_receb
WHERE i.n_qtde_divergente IS NOT NULL 
  AND i.n_qtde_divergente <> 0
ORDER BY r.d_emissao_nfe DESC;
```

## 🚨 Tratamento de Erros

### Erros Comuns

1. **"Webhook sem nIdReceb/cChaveNfe"**
   - Causa: Payload não contém identificadores
   - Solução: Verificar formato do payload na Omie

2. **"Erro na API Omie: 404"**
   - Causa: Recebimento não encontrado na API
   - Solução: Verificar se nIdReceb é válido

3. **"null value in column violates not-null constraint"**
   - Causa: Campo obrigatório ausente
   - Solução: Ajustar mapeamento ou permitir NULL

### Logs de Depuração

```bash
# Ver todos os webhooks recebidos hoje
pm2 logs intranet_api --nostream | grep "Webhook recebido" | grep "$(date +%Y-%m-%d)"

# Ver erros específicos de recebimentos
pm2 logs intranet_api --nostream --err | grep "recebimentos-nfe"
```

## 🔗 Integração com Pedidos de Compra

### Consulta Unificada: Pedido → Recebimento

```sql
-- Ver pedidos com seus recebimentos vinculados
SELECT 
  p.n_cod_ped,
  p.c_numero as numero_pedido,
  p.c_etapa as etapa_pedido,
  r.n_id_receb,
  r.c_numero_nfe,
  r.c_etapa as etapa_recebimento,
  r.c_faturado,
  r.c_recebido,
  r.d_emissao_nfe,
  r.n_valor_nfe
FROM compras.pedidos_omie p
LEFT JOIN logistica.recebimentos_nfe_itens i 
  ON i.n_num_ped_compra = p.c_numero 
  OR i.n_id_pedido = p.n_cod_ped
LEFT JOIN logistica.recebimentos_nfe_omie r 
  ON r.n_id_receb = i.n_id_receb
WHERE p.c_etapa = '15'
ORDER BY p.d_inc_data DESC;
```

## ✅ Checklist de Implementação

- [x] Endpoint criado: `/webhooks/omie/recebimentos-nfe`
- [x] 6 eventos implementados
- [x] Função `upsertRecebimentoNFe()` funcionando
- [x] Sincronização de 4 tabelas relacionadas
- [x] Resposta imediata (200 OK)
- [x] Processamento assíncrono
- [x] Logs detalhados
- [x] Tratamento de erros
- [ ] Configurado na Omie (aguardando)
- [ ] Testes em produção

## 📚 Próximos Passos

1. **Configurar na Omie:**
   - Acessar painel de webhooks
   - Adicionar URL do webhook
   - Selecionar os 6 eventos

2. **Testar em Produção:**
   - Criar uma NF-e de teste
   - Verificar se webhook dispara
   - Validar dados no banco

3. **Criar Views Consolidadas:**
   - View unificando pedidos + recebimentos
   - Dashboard de status completo
   - Alertas de divergências

4. **Implementar Notificações:**
   - Email quando NF-e for faturada
   - Alerta de divergência de quantidade
   - Notificação de recebimento concluído

---

**Documentação criada em:** 03/02/2026  
**Última atualização:** 03/02/2026  
**Versão:** 1.0
