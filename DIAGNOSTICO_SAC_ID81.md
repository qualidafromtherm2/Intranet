# Diagnóstico: Discrepância na Tabela "Registro de Envios" (SAC) — ID 81

## 📋 Problemas Reportados

1. **Quantidade exibida: 11** (na tabela)
   - JSON do banco: `[{"conteudo":"104.MP.I.80024...","quantidade":"1"},{"conteudo":"2PLACA...","quantidade":"1"}]`
   - Esperado: 1 + 1 = **2**, não **11**

2. **Descrição ("identificacao"): "motor ventilador"**
   - JSON contém: "RELE"
   - Há desalinhamento entre o campo `identificacao` e o conteúdo do JSON

3. **Muitos "Outros" no relatório**
   - Mesmo com código no início do item

---

## 🔍 Investigação Realizada

### 1. Estrutura do Banco de Dados

**Tabela:** `envios.solicitacoes`

```sql
CREATE TABLE envios.solicitacoes (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  usuario TEXT NOT NULL,
  observacao TEXT,
  status TEXT NOT NULL DEFAULT 'Pendente',
  anexos TEXT[] NOT NULL DEFAULT '{}',
  conferido BOOLEAN NOT NULL DEFAULT false,
  etiqueta_url TEXT,
  declaracao_url TEXT,
  identificacao TEXT,           -- ← Campo descrição/identificação
  numero_sep TEXT,
  conteudo TEXT,                -- ← JSON dos itens com quantidades
  chave_dce TEXT,
  rastreio_status TEXT,
  rastreio_quando TIMESTAMPTZ,
  finalizado_em TIMESTAMPTZ
);
```

**Achado crítico:** ❌ **NÃO há coluna "quantidade" numérica** na tabela.  
Toda quantidade vem do JSON dentro do campo `conteudo`.

---

### 2. Estrutura do JSON em "conteudo"

Formato esperado:
```json
[
  {
    "conteudo": "104.MP.I.80024...",
    "quantidade": "1"
  },
  {
    "conteudo": "2PLACA...",
    "quantidade": "1"
  }
]
```

---

### 3. Renderização no Frontend

**Arquivo:** [menu_produto.js](menu_produto.js) — função `carregarSacSolicitacoes` (linha 17101)

**Lógica:**
1. Fetch: `/api/sac/solicitacoes` → retorna array de registros
2. Para cada registro:
   - Parseia JSON do campo `conteudo`
   - Renderiza HTML com tabela interna (2 colunas):
     - Coluna 1 (85%): nome do item
     - Coluna 2 (15%): `Qtd: [formatarQuantidadeExibicao(item.quantidade)]`

**HTML gerado para 2 itens:**
```html
<div style="display:table;width:100%;">
  <div style="display:table-row;">
    <div style="width:85%;">104- MP.I.80024...</div>
    <div style="width:15%;font-weight:600;">Qtd: 1</div>
  </div>
  <div style="display:table-row;border-top:1px solid...">
    <div style="width:85%;">2- PLACA...</div>
    <div style="width:15%;font-weight:600;">Qtd: 1</div>
  </div>
</div>
```

---

## 🎯 Possíveis Causas da Quantidade "11"

### Causa 1: **Formato do JSON corrompido ou diferente** (MAIS PROVÁVEL)
- O JSON armazenado pode ter estrutura diferente
- Campos podem ser `"quantidade": "11"` ao invés de `"1"`
- Pode haver mais itens no array que não estão visíveis à primeira vista

### Causa 2: **Campo "conteudo" com múltiplos formatos**
A função `_sacExtrairItensDoConteudo` tenta 3 formatos:
1. JSON array (principal)
2. Regex: "Item N: ... Quantidade N"
3. Fallback: todo o conteúdo como 1 item

Se nenhum funcionar, retorna todo o string como nome + quantidade 1.

### Causa 3: **Renderização visual** (MENOS PROVÁVEL)
- Dois dígitos "1" aparecem lado a lado sem quebra visual
- CSS faz parecer "11" em vez de "1 / 1"

---

## 🔧 Desalinhamento "motor ventilador" vs "RELE"

**Campo `identificacao`:** Texto único descrição do envio (inserido pelo usuário)  
**Campo `conteudo`:** JSON com itens reais enviados

Possível causa:
- Usuário preencheu `identificacao` com "motor ventilador" durante a criação
- Mas o JSON (`conteudo`) foi preenchido com dados diferentes (RELE)
- Pode ser erro de usuário ou de integração de dados

---

## 📊 "Outros" no Relatório com Código no Início

**Função:** `_renderizarRelatorioSacPorUsuario` (linha 17519)  
**Lógica:**
1. Extrai itens do JSON via `_sacExtrairItensDoConteudo`
2. Agrupa por nome (após normalização)
3. Se nome estiver entre top 8, mostra com cor própria
4. Caso contrário, agrupa em "Outros itens"

**Possível causa:**
- Nomes não estão sendo normalizados consistentemente
- Espaços, acentos ou formatação variam
- Ex: "1- RELE" ≠ "RELE" ≠ "01-RELE"

---

## ✅ Recomendações de Ação

### 1. **VERIFICAR DADOS BRUTOS** (URGENTE)

Execute no banco:
```sql
SELECT 
  id, 
  identificacao, 
  conteudo,
  LENGTH(conteudo) as tamanho_conteudo
FROM envios.solicitacoes 
WHERE id = 81;
```

**Copie a resposta exata do campo `conteudo`** para análise.

---

### 2. **Validar Estrutura do JSON**

```sql
-- Verificar se é JSON válido
SELECT 
  id,
  conteudo::json as conteudo_json,
  json_array_length(conteudo::json) as num_items
FROM envios.solicitacoes 
WHERE id = 81
  AND conteudo IS NOT NULL;
```

---

### 3. **Listar Todos os Items com Suas Quantidades**

```sql
-- Expandir items do JSON
SELECT 
  id,
  item_idx,
  item->>'conteudo' as nome_item,
  item->>'quantidade' as quantidade_item
FROM envios.solicitacoes, 
  jsonb_array_elements(conteudo::jsonb) WITH ORDINALITY AS t(item, item_idx)
WHERE id = 81;
```

---

### 4. **Problema no Frontend: Normalização de Nomes**

Se nomes com código no início não estão sendo agrupados corretamente:

**Adicione normalização em** `_sacExtrairItensDoConteudo`:
```javascript
const nome = String(item?.conteudo || item?.item || '')
  .trim()
  .replace(/^(\d+[-\s]+)/, '')  // Remove "1- ", "001 ", etc.
  .toUpperCase();  // Padroniza maiúsculas
```

---

### 5. **Adicionar Validação de Dados no Formulário**

No ponto de criação do registro (sacEnvios.js linha 4429):
- Validar que `identificacao` e `conteudo` são consistentes
- Alertar se há discrepância

---

## 📌 Próximas Etapas

1. **Execute as queries SQL acima** e compartilhe o resultado
2. **Analise o JSON retornado** para confirmar:
   - Número real de items
   - Valores reais de quantidade
   - Se há formatação inconsistente
3. **Confirme se o problema é:**
   - Dados (banco) → Precisa corrigir registros existentes
   - Renderização → Precisa ajustar CSS/HTML
   - Lógica de normalização → Precisa melhorar grouping

---

## 📁 Arquivos Relacionados

- **Backend:** [routes/sacEnvios.js](routes/sacEnvios.js) — rotas e lógica de SAC
  - Linha 4429: INSERT de solicitação
  - Linha 4444: GET /api/sac/solicitacoes

- **Frontend:** [menu_produto.js](menu_produto.js) — renderização
  - Linha 17101: `carregarSacSolicitacoes()` — renderiza tabela
  - Linha 17407: `_sacExtrairItensDoConteudo()` — extrai items do JSON
  - Linha 17519: `_renderizarRelatorioSacPorUsuario()` — gera relatório

- **HTML:** [menu_produto.html](menu_produto.html)
  - Tabela de registro de envios (SAC)

---

**Data de investigação:** 19 de maio de 2026  
**Status:** Aguardando dados brutos do banco para confirmação
