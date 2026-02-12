# 🔗 Como Descobrir qual Pedido está Vinculado a uma NF-e

## 🎯 Problema

**Cenário:** Você vê na interface da Omie uma NF-e (exemplo: 000003542) mas não sabe a qual pedido de compra ela está vinculada.

**Por quê?** As informações estão em APIs separadas:
- **Pedidos de Compra:** `/pedidocompra/`
- **Recebimentos de NF-e:** `/recebimentonfe/` ← Aqui tem a vinculação!

## 📋 Estrutura da Vinculação

```
┌──────────────────────────┐
│ Pedido de Compra         │
│ nCodPed: 10449116977     │ ← ID do Pedido
│ cNumero: "540"           │ ← Número visível
└─────────────┬────────────┘
              │
              │ Vinculação pelo campo
              │ nIdPedido
              ▼
┌──────────────────────────┐
│ Recebimento NF-e         │
│ nIdReceb: 123456         │
│ cNumeroNFe: "3542"       │
│ cChaveNfe: "35..."       │
│ itens[].nIdPedido        │ ← Vincula ao pedido!
└──────────────────────────┘
```

## ✅ Solução Implementada

### 1. Consultar API de Recebimentos

```javascript
// Endpoint: /api/compras/recebimentos-omie/buscar-nfe/:numero
// Exemplo: GET /api/compras/recebimentos-omie/buscar-nfe/3542

async function buscarPedidoPorNFe(numeroNFe) {
  // 1. Busca recebimentos na API Omie
  const recebimentos = await fetch('https://app.omie.com.br/api/v1/produtos/recebimentonfe/', {
    method: 'POST',
    body: JSON.stringify({
      call: 'ListarRecebimentos',
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [{ nPagina: 1, nRegsPorPagina: 100 }]
    })
  });
  
  // 2. Encontra a NF-e específica
  const nfe = recebimentos.find(r => r.cabec.cNumeroNFe === numeroNFe);
  
  // 3. Extrai IDs dos pedidos vinculados
  const pedidosIds = nfe.itens.map(item => item.itensCabec.nIdPedido);
  
  // 4. Busca pedidos no nosso banco
  const pedidos = await db.query(
    'SELECT * FROM compras.pedidos_omie WHERE n_cod_ped = ANY($1)',
    [pedidosIds]
  );
  
  return pedidos;
}
```

### 2. Criar Tabela de Recebimentos

Para facilitar consultas futuras, vamos importar os recebimentos:

```sql
CREATE TABLE compras.recebimentos_nfe_omie (
    n_id_receb BIGINT PRIMARY KEY,
    c_chave_nfe VARCHAR(50) UNIQUE,
    c_numero_nfe VARCHAR(20),
    c_serie_nfe VARCHAR(10),
    d_emissao_nfe DATE,
    n_valor_nfe DECIMAL(15,2),
    n_id_fornecedor BIGINT,
    c_nome_fornecedor VARCHAR(200),
    c_cnpj_cpf VARCHAR(18),
    c_etapa VARCHAR(20),
    
    -- Status de processamento
    c_faturado CHAR(1),
    d_faturamento DATE,
    h_faturamento TIME,
    c_usuario_faturamento VARCHAR(50),
    
    c_recebido CHAR(1),
    d_recebimento DATE,
    h_recebimento TIME,
    c_usuario_recebimento VARCHAR(50),
    
    c_autorizado CHAR(1),
    c_cancelada CHAR(1),
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de itens (vincula com pedidos)
CREATE TABLE compras.recebimentos_nfe_itens (
    id SERIAL PRIMARY KEY,
    n_id_receb BIGINT REFERENCES compras.recebimentos_nfe_omie(n_id_receb),
    n_id_item BIGINT,
    n_id_pedido BIGINT REFERENCES compras.pedidos_omie(n_cod_ped), -- VINCULAÇÃO!
    n_id_item_pedido BIGINT,
    n_id_produto BIGINT,
    c_codigo_produto VARCHAR(50),
    c_descricao_produto VARCHAR(500),
    n_qtde_nfe DECIMAL(15,4),
    c_unidade_nfe VARCHAR(10),
    n_preco_unit DECIMAL(15,4),
    v_total_item DECIMAL(15,2),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_receb_itens_pedido ON compras.recebimentos_nfe_itens(n_id_pedido);
CREATE INDEX idx_receb_nfe_numero ON compras.recebimentos_nfe_omie(c_numero_nfe);
CREATE INDEX idx_receb_nfe_chave ON compras.recebimentos_nfe_omie(c_chave_nfe);
```

### 3. View Unificada

```sql
CREATE VIEW compras.v_pedidos_com_nfe AS
SELECT 
    p.n_cod_ped,
    p.c_numero as numero_pedido,
    p.c_etapa as etapa_pedido,
    p.d_inc_data as data_pedido,
    p.d_dt_previsao as data_previsao,
    
    -- Dados da NF-e (se existir)
    r.n_id_receb,
    r.c_numero_nfe,
    r.c_chave_nfe,
    r.d_emissao_nfe,
    r.n_valor_nfe,
    
    -- Status derivado
    CASE 
        WHEN r.c_recebido = 'S' THEN 'Conferido'
        WHEN r.c_faturado = 'S' THEN 'Recebido'
        WHEN r.c_autorizado = 'S' THEN 'Faturado pelo Fornecedor'
        WHEN p.c_etapa = '20' THEN 'Requisição'
        WHEN p.c_etapa = '15' THEN 'Aprovado'
        ELSE 'Pedido de Compra'
    END as status_atual,
    
    r.d_faturamento,
    r.d_recebimento,
    
    -- Fornecedor
    p.n_cod_for,
    r.c_nome_fornecedor
    
FROM compras.pedidos_omie p
LEFT JOIN compras.recebimentos_nfe_itens ri ON ri.n_id_pedido = p.n_cod_ped
LEFT JOIN compras.recebimentos_nfe_omie r ON r.n_id_receb = ri.n_id_receb
ORDER BY p.d_inc_data DESC;
```

## 🔍 Como Usar

### Buscar pedido por número de NF-e:

```sql
-- Encontrar qual pedido tem a NF-e 3542
SELECT 
    numero_pedido,
    c_numero_nfe,
    status_atual,
    data_pedido,
    d_emissao_nfe
FROM compras.v_pedidos_com_nfe
WHERE c_numero_nfe = '3542';
```

### Buscar NF-e por número de pedido:

```sql
-- Encontrar NF-es do pedido 540
SELECT 
    numero_pedido,
    c_numero_nfe,
    c_chave_nfe,
    status_atual,
    d_emissao_nfe
FROM compras.v_pedidos_com_nfe
WHERE numero_pedido = '540';
```

## ⚠️ Limitação Atual

**Problema:** A API `/recebimentonfe/` está retornando **403 (Acesso Negado)**

**Possíveis causas:**
1. A conta Omie não tem permissão para acessar essa API
2. Requer configuração adicional no painel da Omie
3. É um módulo pago/adicional

**Soluções:**

1. **Contatar suporte da Omie** para habilitar acesso à API de Recebimentos
2. **Verificar no painel** da Omie se há configurações de API/integrações
3. **Alternativa temporária:** Consultar manualmente na interface e mapear

## 📝 Exemplo Real

Para o seu caso (NF-e 000003542):

1. **Na interface da Omie:** Localizar essa NF-e
2. **Verificar detalhes:** Clicar na NF-e e ver qual pedido está vinculado
3. **Anotar o ID:** O campo `nIdPedido` no item da NF-e
4. **Buscar no banco:**
   ```sql
   SELECT * FROM compras.pedidos_omie WHERE n_cod_ped = [ID_ENCONTRADO];
   ```

## 🎯 Próximos Passos

1. ✅ **Verificar permissões** da API de Recebimentos com a Omie
2. ✅ **Criar endpoint** no server.js para buscar recebimentos
3. ✅ **Sincronizar recebimentos** assim que tivermos acesso
4. ✅ **Implementar webhooks** para recebimentos (se disponível)

---

**Resumo:** A vinculação existe na API `/recebimentonfe/` através do campo `nIdPedido` nos itens. Precisamos de acesso a essa API para automatizar a consulta.
