# 🎯 DESCOBERTA - API de Recebimento de NF-e da Omie

## Eureka! Encontramos onde estão os status!

Analisando o arquivo `scripts/RecebimentoNFeJsonClient.js`, descobrimos que:

### 📋 Estrutura da API

**Endpoint:** `https://app.omie.com.br/api/v1/produtos/recebimentonfe/`

**Funções disponíveis:**
1. `ListarRecebimentos` - Lista recebimentos de NF-e
2. `ConsultarRecebimento` - Consulta detalhes de um recebimento
3. `AlterarEtapaRecebimento` - Altera a etapa do recebimento
4. `ConcluirRecebimento` - Conclui o recebimento
5. `ReverterRecebimento` - Reverte um recebimento

### 🔍 Campos Importantes Encontrados

#### 1. Campo `cEtapa` (linha 139)
```javascript
this.cabec=function(){
    this.nIdReceb=null;
    this.cChaveNfe=null;
    this.cEtapa=null;  // ← ETAPA DO RECEBIMENTO!
    // ...
};
```

#### 2. Objeto `infoCadastro` (linhas 169-198)
```javascript
this.infoCadastro=function(){
    // Status de Faturamento
    this.cFaturado=null;     // ← "S" ou "N"
    this.dFat=null;          // Data de faturamento
    this.hFat=null;          // Hora de faturamento
    this.cUsuarioFat=null;   // Usuário que faturou
    
    // Status de Recebimento
    this.cRecebido=null;     // ← "S" ou "N"
    this.dRec=null;          // Data de recebimento
    this.hRec=null;          // Hora de recebimento
    this.cUsuarioRec=null;   // Usuário que recebeu
    
    // Status de Devolução
    this.cDevolvido=null;
    this.cDevolvidoParc=null;
    this.dDev=null;
    
    // Status de Autorização/Bloqueio
    this.cAutorizado=null;
    this.cBloqueado=null;
    this.cCancelada=null;
    // ...
};
```

#### 3. Vinculação com Pedido de Compra (linha 231)
```javascript
this.itensCabec=function(){
    this.nIdItem=null;
    this.nIdPedido=null;      // ← ID do PEDIDO DE COMPRA!
    this.nIdItPedido=null;    // ← ID do ITEM do pedido
    this.nIdProduto=null;
    // ...
};
```

## 💡 O que isso significa?

### Sistema Real da Omie:

```
┌─────────────────────┐
│ Pedido de Compra    │ ← API /pedidocompra/
│ (etapas: 10,15,20)  │   Até aqui temos acesso
└──────────┬──────────┘
           │
           ▼ Gera NF-e
┌─────────────────────┐
│ Recebimento de NF-e │ ← API /recebimentonfe/
│ (c_faturado,        │   AQUI estão os status!
│  c_recebido, etc)   │
└─────────────────────┘
```

### Fluxo Completo:

1. **Pedido de Compra** (etapa 15 - Aprovação)
   - Pedido aprovado e aguardando NF-e do fornecedor

2. **NF-e Recebida** → `cFaturado = "S"`
   - Fornecedor emite NF-e
   - Sistema cria registro na API `/recebimentonfe/`
   - Status: "Faturado pelo Fornecedor"

3. **Mercadoria Recebida** → `cRecebido = "S"`
   - Mercadoria chega fisicamente
   - Usuário confirma recebimento
   - Status: "Recebido"

4. **Conferido** → (etapa específica do recebimento)
   - Mercadoria conferida e validada
   - Status: "Conferido"

## 🎯 Solução

Para ter os pedidos "Faturados", "Recebidos" e "Conferidos", precisamos:

### 1. Criar tabelas para Recebimentos

```sql
CREATE TABLE compras.recebimentos_nfe (
    n_id_receb BIGINT PRIMARY KEY,
    n_id_pedido BIGINT,  -- Vincula com pedidos_omie.n_cod_ped
    c_chave_nfe VARCHAR(50),
    c_etapa VARCHAR(20),
    c_numero_nfe VARCHAR(20),
    d_emissao_nfe DATE,
    n_valor_nfe DECIMAL(15,2),
    -- Status
    c_faturado VARCHAR(1),
    d_fat DATE,
    c_recebido VARCHAR(1),
    d_rec DATE,
    c_autorizado VARCHAR(1),
    c_bloqueado VARCHAR(1),
    c_cancelada VARCHAR(1),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (n_id_pedido) REFERENCES compras.pedidos_omie(n_cod_ped)
);

CREATE INDEX idx_recebimentos_pedido ON compras.recebimentos_nfe(n_id_pedido);
CREATE INDEX idx_recebimentos_chave_nfe ON compras.recebimentos_nfe(c_chave_nfe);
```

### 2. Sincronizar com a API

```javascript
async function syncRecebimentosNFe() {
    const response = await fetch('https://app.omie.com.br/api/v1/produtos/recebimentonfe/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            call: 'ListarRecebimentos',
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [{
                nPagina: 1,
                nRegsPorPagina: 50
            }]
        })
    });
    
    const data = await response.json();
    // Processar e inserir no banco
}
```

### 3. Criar View Completa

```sql
CREATE VIEW compras.v_pedidos_completo AS
SELECT 
    p.n_cod_ped,
    p.c_numero,
    p.c_etapa as etapa_pedido,
    e.descricao_customizada as desc_etapa_pedido,
    r.n_id_receb,
    r.c_chave_nfe,
    r.c_etapa as etapa_recebimento,
    -- Status derivados
    CASE 
        WHEN r.c_faturado = 'S' THEN 'Faturado pelo Fornecedor'
        WHEN r.c_recebido = 'S' THEN 'Recebido'
        WHEN r.c_autorizado = 'S' THEN 'Conferido'
        WHEN p.c_etapa = '15' THEN 'Aprovado'
        WHEN p.c_etapa = '20' THEN 'Requisição'
        ELSE 'Pedido de Compra'
    END as status_display,
    r.d_fat as data_faturamento,
    r.d_rec as data_recebimento,
    p.d_inc_data,
    p.d_dt_previsao
FROM compras.pedidos_omie p
LEFT JOIN compras.recebimentos_nfe r ON r.n_id_pedido = p.n_cod_ped
LEFT JOIN compras.etapas_pedido_compra e ON e.codigo = p.c_etapa;
```

## 📝 Próximos Passos

1. ✅ **Criar tabela de recebimentos** no schema `compras`
2. ✅ **Implementar sincronização** da API `/recebimentonfe/`
3. ✅ **Criar view combinada** pedidos + recebimentos
4. ✅ **Configurar webhooks** para recebimentos (se disponível)

## 🎉 Conclusão

**As colunas "Faturado", "Recebido", "Conferido" da interface NÃO SÃO etapas do pedido!**

São **registros separados** na API de **Recebimento de NF-e** que se vinculam aos pedidos pelo campo `nIdPedido`.

Por isso nunca encontramos essas etapas nos pedidos de compra - elas estão em outra tabela/API!
