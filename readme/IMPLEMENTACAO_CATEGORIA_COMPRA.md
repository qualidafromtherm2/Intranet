# Implementação do Campo "Categoria da Compra"

## Objetivo
Resolver o erro da API Omie: `ERROR: O preenchimento da tag [codCateg] é obrigatório!`

## Problema
Ao aprovar itens de requisição, a integração com a Omie falhava porque o campo obrigatório `codCateg` não estava sendo enviado na requisição IncluirReq.

## Solução Implementada

### 1. Frontend (menu_produto.html)

#### Modal "Adicionar ao Carrinho" (linha ~555)
```html
<div class="form-row">
  <label for="modalComprasCategoriaCompra">Categoria da Compra:</label>
  <select id="modalComprasCategoriaCompra" style="width:100%;padding:8px;border-radius:4px;border:1px solid #ddd;">
    <option value="">Carregando...</option>
  </select>
</div>
```

#### Modal "Catálogo Omie" (linha ~940)
```html
<div style="flex:1;min-width:200px;">
  <label style="display:block;margin-bottom:5px;">Categoria da Compra:</label>
  <select id="catalogoCategoriaCompraGlobal" style="width:100%;padding:8px;border-radius:4px;border:1px solid #ddd;">
    <option value="">Carregando...</option>
  </select>
</div>
```

### 2. Frontend (menu_produto.js)

#### Função de Carregamento de Categorias (linha ~13055)
```javascript
async function loadModalComprasCategoriasCompra() {
  const selects = [
    document.getElementById('modalComprasCategoriaCompra'),
    document.getElementById('catalogoCategoriaCompraGlobal')
  ];
  
  for (const sel of selects) {
    if (!sel) continue;
    try {
      const res = await fetch('/api/compras/categorias');
      if (!res.ok) throw new Error('Erro ao carregar categorias');
      const cats = await res.json();
      sel.innerHTML = '<option value="">-- Selecione --</option>' + 
        cats.map(c => `<option value="${c.codigo}">${c.descricao}</option>`).join('');
    } catch (err) {
      sel.innerHTML = '<option value="">Erro ao carregar</option>';
    }
  }
}
```

#### Validação no Modal de Carrinho (adicionarItemCarrinho)
```javascript
const categoriaCompra = document.getElementById('modalComprasCategoriaCompra')?.value || '').trim();
const categoriaCompraTexto = document.getElementById('modalComprasCategoriaCompra')?.selectedOptions[0]?.text || '';

// Validação
if (!categoriaCompra) {
  alert('Selecione a categoria da compra');
  return;
}

// Inclusão no item
window.carrinhoCompras.push({
  // ... outros campos
  categoria_compra_codigo: categoriaCompra,
  categoria_compra_nome: categoriaCompraTexto
});
```

#### Validação no Modal de Catálogo (selecionarProdutoCatalogo)
```javascript
const selectCategoriaGlobal = document.getElementById('catalogoCategoriaCompraGlobal');
const categoriaCompra = selectCategoriaGlobal ? selectCategoriaGlobal.value.trim() : '';
const categoriaCompraTexto = selectCategoriaGlobal?.selectedOptions[0]?.text || '';

// Validação
if (!categoriaCompra) {
  alert('Selecione a categoria da compra no topo do catálogo!');
  selectCategoriaGlobal?.focus();
  return;
}

// Inclusão no item
window.carrinhoCompras.push({
  // ... outros campos
  categoria_compra_codigo: categoriaCompra,
  categoria_compra_nome: categoriaCompraTexto
});
```

### 3. Backend (server.js)

#### Endpoint POST /api/compras/pedido (linha ~11062)
```javascript
// Extração dos campos
const {
  // ... outros campos
  categoria_compra_codigo,
  categoria_compra_nome
} = item;

// INSERT com novos campos
INSERT INTO compras.solicitacao_compras (
  -- ... outros campos
  categoria_compra_codigo,
  categoria_compra_nome,
  created_at,
  updated_at
) VALUES ($1, $2, ..., $15, $16, NOW(), NOW())
```

#### Endpoint POST /api/compras/aprovar-item/:id (linha ~11522)
```javascript
// SELECT com categoria
SELECT 
  id,
  produto_codigo,
  produto_descricao,
  quantidade,
  objetivo_compra,
  solicitante,
  departamento,
  categoria_compra_codigo
FROM compras.solicitacao_compras
WHERE id = $1

// Inclusão do codCateg no payload da Omie
const requisicaoOmie = {
  codIntReqCompra: numeroPedido,
  codCateg: item.categoria_compra_codigo || '',  // ← NOVO
  ItensReqCompra: [
    {
      codIntItem: `${itemId}`,
      codIntProd: item.produto_codigo || '',
      obsItem: item.objetivo_compra || '',
      qtde: parseFloat(item.quantidade) || 1
    }
  ]
};
```

### 4. Banco de Dados

#### Migração SQL (sql/add_categoria_compra.sql)
```sql
ALTER TABLE compras.solicitacao_compras 
ADD COLUMN IF NOT EXISTS categoria_compra_codigo VARCHAR(50),
ADD COLUMN IF NOT EXISTS categoria_compra_nome VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_solicitacao_compras_categoria 
ON compras.solicitacao_compras(categoria_compra_codigo);

COMMENT ON COLUMN compras.solicitacao_compras.categoria_compra_codigo IS 'Código da categoria da compra na Omie (campo codCateg)';
COMMENT ON COLUMN compras.solicitacao_compras.categoria_compra_nome IS 'Nome descritivo da categoria da compra';
```

## Fluxo Completo

1. **Usuário adiciona item ao carrinho**
   - Seleciona categoria da compra (validação obrigatória)
   - Categoria é armazenada no objeto do item (código + nome)

2. **Envio do pedido**
   - POST /api/compras/pedido recebe itens com categoria
   - Salva categoria_compra_codigo e categoria_compra_nome no banco

3. **Aprovação do item**
   - GET busca item incluindo categoria_compra_codigo
   - POST para Omie inclui codCateg no payload
   - Omie aceita requisição sem erro

## Endpoint de Categorias

GET /api/compras/categorias (já existente)
- Lista categorias da Omie
- Filtra: conta_despesa='S', conta_inativa='N', categoria_superior='2.01'
- Retorna: [{ codigo, descricao }, ...]

## Validações Implementadas

✅ **Modal Carrinho**: Alerta se categoria não selecionada  
✅ **Modal Catálogo**: Alerta se categoria não selecionada (global)  
✅ **Backend**: Aceita categoria_compra_codigo opcional (null permitido)  
✅ **Omie**: Envia codCateg vazio ('') se não houver categoria  

## Testes Necessários

- [ ] Adicionar produto via modal carrinho com categoria
- [ ] Adicionar produto via catálogo Omie com categoria
- [ ] Aprovar item e verificar criação de requisição na Omie
- [ ] Verificar se erro de codCateg foi resolvido
- [ ] Testar com categoria não selecionada (deve alertar)

## Arquivos Modificados

1. **menu_produto.html** (2 alterações)
   - Linha ~555: Campo no modal carrinho
   - Linha ~940: Campo no modal catálogo

2. **menu_produto.js** (4 alterações)
   - Linha ~13055: Função loadModalComprasCategoriasCompra()
   - Linha ~13250: Validação e extração no adicionarItemCarrinho()
   - Linha ~19151: Validação e extração no selecionarProdutoCatalogo()
   - Linha ~19646 e ~18827: Inicialização do carregamento

3. **server.js** (3 alterações)
   - Linha ~11083: Extração dos campos categoria
   - Linha ~11108: INSERT com categoria_compra_codigo e categoria_compra_nome
   - Linha ~11530: SELECT com categoria_compra_codigo
   - Linha ~11561: Inclusão de codCateg no payload Omie

4. **sql/add_categoria_compra.sql** (novo arquivo)
   - Migração para adicionar colunas

## Status

✅ **Implementação Completa**  
✅ **Migração Executada**  
✅ **Servidor Reiniciado**  
⏳ **Aguardando Testes**
