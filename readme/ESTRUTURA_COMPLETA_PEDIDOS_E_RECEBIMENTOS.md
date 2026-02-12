# 🎯 EUREKA! Descobrimos a Estrutura Completa!

## 📋 Dados Reais da API de Recebimentos

**NF-e consultada:** 000003542  
**Comando usado:**
```bash
curl -s https://app.omie.com.br/api/v1/produtos/recebimentonfe/ \
  -H 'Content-type: application/json' \
  -d '{
    "call":"ConsultarRecebimento",
    "param":[{"cChaveNfe":"35260159086148000133550020000035421654706059"}],
    "app_key":"#APP_KEY#",
    "app_secret":"#APP_SECRET#"
  }'
```

## 🔍 Descobertas Cruciais

### 1. ✅ A Etapa 40 EXISTE na API de Recebimentos!

```json
"cabec": {
  "cEtapa": "40",  // ← CONFIRMADO! Etapa 40 existe!
  "nIdReceb": 10810037468,
  "cNumeroNFe": "000003542"
}
```

**Conclusão:** A etapa 40 NÃO está na API de Pedidos (`/pedidocompra/`), mas SIM na API de Recebimentos (`/recebimentonfe/`)!

### 2. ✅ Vinculação com Pedido de Compra

```json
"itensInfoAdic": {
  "nNumPedCompra": "200001473921396",  // ← ID ou Número do Pedido
  "cCategoriaItem": "2.01.03"
}
```

### 3. ✅ Status Completo

```json
"infoCadastro": {
  "cFaturado": "S",         // Faturado pelo fornecedor
  "dFat": "17/01/2026",     // Data de faturamento
  "hFat": "09:51:13",       // Hora de faturamento
  "cUsuarioFat": "WEBSERVICE",
  
  "cRecebido": "N",         // Ainda não recebido fisicamente
  "cDevolvido": "N",        // Não devolvido
  "cCancelada": "N",        // Não cancelada
  "cBloqueado": "N"         // Não bloqueada
}
```

## 🏗️ Arquitetura Real da Omie

```
┌─────────────────────────────────┐
│ API: /pedidocompra/             │
│ Pedidos de Compra               │
├─────────────────────────────────┤
│ Etapas: 10, 15, 20              │
│ - 10: Pedido de Compra          │
│ - 15: Aprovação                 │
│ - 20: Requisição                │
└────────────┬────────────────────┘
             │
             │ Quando NF-e chega
             ▼
┌─────────────────────────────────┐
│ API: /recebimentonfe/           │
│ Recebimentos de NF-e            │
├─────────────────────────────────┤
│ Etapas: 10, 20, 30, 40, 50, 60  │ ← AQUI!
│ - 10: Aguardando entrada        │
│ - 20: Em conferência            │
│ - 30: Pendente                  │
│ - 40: Faturado (vinculado)      │
│ - 50: Recebido parcial          │
│ - 60: Recebido total            │
└─────────────────────────────────┘
```

## 📊 Estrutura de Dados do Recebimento

### Tabela Principal: recebimentos_nfe

```sql
CREATE TABLE compras.recebimentos_nfe (
    -- Identificação
    n_id_receb BIGINT PRIMARY KEY,
    c_chave_nfe VARCHAR(50) UNIQUE NOT NULL,
    c_numero_nfe VARCHAR(20),
    c_serie_nfe VARCHAR(10),
    c_modelo_nfe VARCHAR(5),
    
    -- Datas
    d_emissao_nfe DATE,
    d_registro DATE,
    
    -- Valores
    n_valor_nfe DECIMAL(15,2),
    v_total_produtos DECIMAL(15,2),
    v_aprox_tributos DECIMAL(15,2),
    
    -- Fornecedor
    n_id_fornecedor BIGINT,
    
    -- Etapa no Recebimento
    c_etapa VARCHAR(20),  -- ← 10, 20, 30, 40, 50, 60
    
    -- Status
    c_faturado CHAR(1),
    d_faturamento DATE,
    h_faturamento TIME,
    c_usuario_faturamento VARCHAR(50),
    
    c_recebido CHAR(1),
    d_recebimento DATE,
    h_recebimento TIME,
    c_usuario_recebimento VARCHAR(50),
    
    c_devolvido CHAR(1),
    c_cancelada CHAR(1),
    c_bloqueado CHAR(1),
    
    -- Outros
    c_natureza_operacao VARCHAR(100),
    n_id_conta BIGINT,
    c_categ_compra VARCHAR(20),
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### Tabela de Itens com Vinculação

```sql
CREATE TABLE compras.recebimentos_nfe_itens (
    id SERIAL PRIMARY KEY,
    n_id_receb BIGINT REFERENCES compras.recebimentos_nfe(n_id_receb),
    
    -- Identificação do item
    n_sequencia INTEGER,
    c_codigo_produto VARCHAR(50),
    c_descricao_produto VARCHAR(500),
    c_ncm VARCHAR(20),
    
    -- Quantidades e valores
    n_qtde_nfe DECIMAL(15,4),
    c_unidade_nfe VARCHAR(10),
    n_preco_unit DECIMAL(15,4),
    v_total_item DECIMAL(15,2),
    v_desconto DECIMAL(15,2),
    
    -- ⭐ VINCULAÇÃO COM PEDIDO DE COMPRA ⭐
    n_num_ped_compra VARCHAR(50),  -- ← Campo "nNumPedCompra"
    n_id_produto BIGINT,
    
    -- Ajustes
    c_cfop_entrada VARCHAR(10),
    codigo_local_estoque BIGINT,
    n_qtde_recebida DECIMAL(15,4),
    c_nao_gerar_financeiro CHAR(1),
    c_nao_gerar_mov_estoque CHAR(1),
    
    created_at TIMESTAMP DEFAULT NOW()
);
```

### View Unificada

```sql
CREATE VIEW compras.v_pedidos_e_recebimentos AS
SELECT 
    -- Dados do Pedido
    p.n_cod_ped,
    p.c_numero as numero_pedido,
    p.c_etapa as etapa_pedido,
    p.d_inc_data as data_pedido,
    
    -- Dados do Recebimento/NF-e
    r.n_id_receb,
    r.c_numero_nfe,
    r.c_chave_nfe,
    r.c_etapa as etapa_recebimento,
    r.d_emissao_nfe,
    r.n_valor_nfe,
    
    -- Status Consolidado
    CASE 
        -- Etapas do Recebimento (quando existe NF-e)
        WHEN r.c_etapa = '60' THEN 'Recebido Total'
        WHEN r.c_etapa = '50' THEN 'Recebido Parcial'
        WHEN r.c_etapa = '40' THEN 'Faturado pelo Fornecedor'
        WHEN r.c_etapa = '30' THEN 'NF-e Pendente'
        WHEN r.c_etapa = '20' THEN 'Em Conferência'
        WHEN r.c_etapa = '10' THEN 'Aguardando Entrada'
        
        -- Etapas do Pedido (quando não tem NF-e ainda)
        WHEN p.c_etapa = '20' THEN 'Requisição'
        WHEN p.c_etapa = '15' THEN 'Aprovado'
        WHEN p.c_etapa = '10' THEN 'Pedido de Compra'
        
        ELSE 'Desconhecido'
    END as status_display,
    
    -- Datas importantes
    r.d_faturamento,
    r.d_recebimento,
    
    -- Flags
    r.c_faturado,
    r.c_recebido,
    r.c_cancelada
    
FROM compras.pedidos_omie p
LEFT JOIN compras.recebimentos_nfe_itens ri 
    ON ri.n_num_ped_compra = p.c_numero 
    OR ri.n_num_ped_compra = p.n_cod_ped::text
LEFT JOIN compras.recebimentos_nfe r 
    ON r.n_id_receb = ri.n_id_receb
ORDER BY 
    COALESCE(r.d_emissao_nfe, p.d_inc_data) DESC;
```

## 🎯 Resultado Esperado

Com essa implementação, teremos:

### Consulta por Pedido:
```sql
SELECT * FROM compras.v_pedidos_e_recebimentos 
WHERE numero_pedido = '540';
```

**Resultado:**
```
numero_pedido | status_display              | c_numero_nfe | d_faturamento | d_recebimento
--------------|-----------------------------|--------------|---------------|---------------
540           | Faturado pelo Fornecedor    | 000003542    | 2026-01-17    | null
```

### Consulta por NF-e:
```sql
SELECT * FROM compras.v_pedidos_e_recebimentos 
WHERE c_numero_nfe = '000003542';
```

**Resultado:**
```
numero_pedido       | status_display              | c_numero_nfe
--------------------|-----------------------------|--------------
200001473921396     | Faturado pelo Fornecedor    | 000003542
```

## 📝 Próximos Passos

1. ✅ Criar tabelas de recebimentos
2. ✅ Implementar sincronização da API `/recebimentonfe/`
3. ✅ Criar view unificada
4. ✅ Configurar webhooks para recebimentos
5. ✅ Atualizar documentação de etapas

## 🎉 Conclusão Final

**A interface da Omie mostra DUAS etapas combinadas:**
- **Pedido de Compra:** etapas 10, 15, 20
- **Recebimento de NF-e:** etapas 10, 20, 30, 40, 50, 60

**Para ter o status completo, precisamos sincronizar AMBAS as APIs!**
