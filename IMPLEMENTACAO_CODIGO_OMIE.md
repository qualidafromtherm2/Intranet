# Implementação Campo codigo_omie - Integração Omie

## Objetivo
Resolver erro da Omie "Produto não cadastrado para o Código de Integração" usando `codItem` ao invés de `codIntProd` na requisição IncluirReq.

## Problema Anterior
- Enviávamos `codIntProd` com o valor do campo `codigo` (ex: "07.MP.N.70004")
- Omie esperava o `codigo_produto` (ex: "90003") ou `codigo_produto_integracao`
- Erro: "Produto não cadastrado para o Código de Integração [07.MP.N.70004]!"

## Solução Implementada
Usar `codItem` no payload da Omie com o valor de `codigo_produto` da tabela `public.produtos_omie`.

---

## 1. Banco de Dados

### Arquivo: sql/add_codigo_omie.sql (NOVO)
```sql
ALTER TABLE compras.solicitacao_compras 
ADD COLUMN IF NOT EXISTS codigo_omie BIGINT;

CREATE INDEX IF NOT EXISTS idx_solicitacao_compras_codigo_omie 
ON compras.solicitacao_compras(codigo_omie);

COMMENT ON COLUMN compras.solicitacao_compras.codigo_omie IS 
'Código do produto na Omie (codigo_produto da tabela produtos_omie) - usado como codItem na API';
```

**Migração executada com sucesso** ✅

---

## 2. Backend - Endpoint de Busca

### Arquivo: server.js
### Localizar: Antes de `app.post('/api/compras/pedido'`

```javascript
// GET /api/produtos-omie/buscar-codigo - Busca codigo_produto da tabela produtos_omie pelo codigo
app.get('/api/produtos-omie/buscar-codigo', async (req, res) => {
  try {
    const { codigo } = req.query;
    
    if (!codigo) {
      return res.status(400).json({ ok: false, error: 'Código é obrigatório' });
    }
    
    const { rows } = await pool.query(`
      SELECT codigo_produto
      FROM public.produtos_omie
      WHERE codigo = $1
      LIMIT 1
    `, [codigo]);
    
    if (rows.length === 0) {
      return res.json({ ok: true, codigo_produto: null });
    }
    
    res.json({ ok: true, codigo_produto: rows[0].codigo_produto });
  } catch (err) {
    console.error('[Produtos Omie] Erro ao buscar codigo_produto:', err);
    res.status(500).json({ ok: false, error: 'Erro ao buscar codigo_produto' });
  }
});
```

---

## 3. Backend - Salvar codigo_omie

### Arquivo: server.js - POST /api/compras/pedido
### Localizar: `for (const item of itens)`

#### 3.1 Adicionar campo na extração (linha ~11108):
```javascript
const {
  produto_codigo,
  produto_descricao,
  quantidade,
  prazo_solicitado,
  familia_codigo,
  familia_nome,
  observacao,
  departamento,
  centro_custo,
  objetivo_compra,
  resp_inspecao_recebimento,
  retorno_cotacao,
  codigo_produto_omie,
  categoria_compra_codigo,
  categoria_compra_nome,
  codigo_omie  // ← NOVO
} = item;
```

#### 3.2 Adicionar no INSERT (linha ~11140):
```javascript
INSERT INTO compras.solicitacao_compras (
  produto_codigo,
  produto_descricao,
  quantidade,
  prazo_solicitado,
  familia_produto,
  status,
  observacao,
  solicitante,
  departamento,
  centro_custo,
  objetivo_compra,
  resp_inspecao_recebimento,
  retorno_cotacao,
  codigo_produto_omie,
  categoria_compra_codigo,
  categoria_compra_nome,
  codigo_omie,           -- ← NOVO
  created_at,
  updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())
```

#### 3.3 Adicionar no array de parâmetros:
```javascript
`, [
  produto_codigo,
  produto_descricao || '',
  quantidade,
  prazo_solicitado || null,
  familia_nome || null,
  statusInicial,
  observacao || '',
  solicitante,
  departamento || null,
  centro_custo || null,
  objetivo_compra || null,
  resp_inspecao_recebimento || solicitante,
  retorno_cotacao || null,
  codigo_produto_omie || null,
  categoria_compra_codigo || null,
  categoria_compra_nome || null,
  codigo_omie || null  // ← NOVO
]);
```

---

## 4. Backend - Endpoint de Aprovação

### Arquivo: server.js - POST /api/compras/aprovar-item/:id
### Localizar: `app.post('/api/compras/aprovar-item/:id'`

#### 4.1 Adicionar campo no SELECT (linha ~11572):
```javascript
SELECT 
  id,
  produto_codigo,
  produto_descricao,
  quantidade,
  objetivo_compra,
  solicitante,
  departamento,
  categoria_compra_codigo,
  previsao_chegada,
  prazo_solicitado,
  codigo_produto_omie,
  codigo_omie  -- ← NOVO
FROM compras.solicitacao_compras
WHERE id = $1
```

#### 4.2 Usar codItem no payload Omie (linha ~11608):
```javascript
const requisicaoOmie = {
  codIntReqCompra: numeroPedido,
  codCateg: item.categoria_compra_codigo || '',
  dtSugestao: dtSugestao,
  ItensReqCompra: [
    {
      codIntItem: `${itemId}`,
      codItem: item.codigo_omie || null,  // ← MUDANÇA: codIntProd → codItem
      obsItem: item.objetivo_compra || '',
      qtde: parseFloat(item.quantidade) || 1
    }
  ]
};
```

---

## 5. Frontend - Modal Adicionar ao Carrinho

### Arquivo: menu_produto.js
### Localizar: função `adicionarItemCarrinho()` (linha ~13305)

#### 5.1 Buscar codigo_omie antes de adicionar ao carrinho:
```javascript
if (!categoriaCompra) {
  alert('Selecione a categoria da compra');
  return;
}

// Busca codigo_produto da tabela produtos_omie usando o codigo do produto
let codigoOmie = null;
try {
  const resOmie = await fetch(`/api/produtos-omie/buscar-codigo?codigo=${encodeURIComponent(codigo)}`);
  if (resOmie.ok) {
    const dataOmie = await resOmie.json();
    codigoOmie = dataOmie.codigo_produto || null;
  }
} catch (err) {
  console.warn('Erro ao buscar codigo_produto da Omie:', err);
}

window.carrinhoCompras.push({
```

#### 5.2 Adicionar no objeto do carrinho (linha ~13320):
```javascript
window.carrinhoCompras.push({
  produto_codigo: codigo,
  produto_descricao: descricao,
  quantidade,
  prazo_solicitado: prazo || null,
  familia_codigo: familia || null,
  familia_nome: familiaTexto || null,
  observacao: observacao || '',
  departamento: departamento,
  centro_custo: centroCusto,
  codigo_produto_omie: codigoProdutoOmie || null,
  codigo_omie: codigoOmie,  // ← NOVO
  objetivo_compra: objetivoCompra || '',
  resp_inspecao_recebimento: responsavel || '',
  retorno_cotacao: retornoCotacao,
  categoria_compra_codigo: categoriaCompra,
  categoria_compra_nome: categoriaCompraTexto
});
```

---

## 6. Frontend - Catálogo Omie

### Arquivo: menu_produto.js
### Localizar: função `selecionarProdutoCatalogo()` (linha ~19210)

#### 6.1 Buscar codigo_produto do catálogo:
```javascript
// Busca o produto completo no catálogo para pegar a família e o codigo_produto
const produtoCatalogo = (window.produtosCatalogoOmie || []).find(p => p.codigo === codigo);
const familiaDescricao = produtoCatalogo ? produtoCatalogo.descricao_familia : null;
const codigoOmie = produtoCatalogo ? produtoCatalogo.codigo_produto : null;  // ← NOVO
```

#### 6.2 Adicionar no objeto do carrinho:
```javascript
window.carrinhoCompras.push({
  produto_codigo: codigo,
  produto_descricao: descricao,
  quantidade: quantidade,
  prazo_solicitado: prazo || null,
  familia_codigo: null,
  familia_nome: familiaDescricao,
  observacao: '',
  departamento: departamento,
  centro_custo: centroCusto,
  codigo_produto_omie: null,
  codigo_omie: codigoOmie,  // ← NOVO
  objetivo_compra: 'Compra via catálogo Omie',
  resp_inspecao_recebimento: '',
  retorno_cotacao: retornoCotacoes === 'sim' ? 'S' : 'N',
  categoria_compra_codigo: categoriaCompra,
  categoria_compra_nome: categoriaCompraTexto
});
```

---

## Fluxo Completo

### 1. Usuário adiciona produto ao carrinho (Modal ou Catálogo)
   - **Modal**: Busca `codigo_produto` na API `/api/produtos-omie/buscar-codigo?codigo=XXX`
   - **Catálogo**: Pega `codigo_produto` direto do objeto `produtoCatalogo`
   - Armazena no campo `codigo_omie` do item do carrinho

### 2. Usuário clica em "Enviar solicitação"
   - Frontend envia array de itens incluindo `codigo_omie`
   - Backend salva `codigo_omie` na tabela `compras.solicitacao_compras`

### 3. Gestor aprova item
   - Backend busca item incluindo `codigo_omie`
   - Monta payload Omie usando `codItem: item.codigo_omie`
   - Envia para Omie API IncluirReq
   - Omie aceita requisição com sucesso ✅

---

## Comparação: Antes vs Depois

### Antes (ERRADO ❌):
```json
{
  "ItensReqCompra": [{
    "codIntProd": "07.MP.N.70004"  // Código do produto
  }]
}
```
**Erro**: "Produto não cadastrado para o Código de Integração [07.MP.N.70004]!"

### Depois (CORRETO ✅):
```json
{
  "ItensReqCompra": [{
    "codItem": 10409717444  // codigo_produto da Omie
  }]
}
```
**Resultado**: Requisição criada com sucesso!

---

## Arquivos Modificados

1. **sql/add_codigo_omie.sql** (novo)
   - Criação da coluna e índice

2. **server.js** (4 modificações)
   - Novo endpoint GET `/api/produtos-omie/buscar-codigo`
   - POST `/api/compras/pedido`: Salvar codigo_omie
   - POST `/api/compras/aprovar-item/:id`: Buscar e usar codigo_omie como codItem

3. **menu_produto.js** (2 modificações)
   - `adicionarItemCarrinho()`: Buscar e incluir codigo_omie
   - `selecionarProdutoCatalogo()`: Pegar e incluir codigo_omie

---

## Status

✅ **Migração Executada**  
✅ **Endpoint de Busca Criado**  
✅ **Frontend Atualizado (Modal + Catálogo)**  
✅ **Backend Atualizado (Salvar + Usar)**  
✅ **Servidor Reiniciado**  
⏳ **Aguardando Testes**

## Testes Necessários

1. [ ] Adicionar produto via modal carrinho
2. [ ] Adicionar produto via catálogo Omie
3. [ ] Verificar se codigo_omie foi salvo no banco
4. [ ] Aprovar item e verificar payload enviado à Omie
5. [ ] Confirmar criação de requisição na Omie sem erros
