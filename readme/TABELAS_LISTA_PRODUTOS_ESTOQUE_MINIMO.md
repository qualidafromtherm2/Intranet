# Tabelas consultadas — Lista de Produtos e Estoque Mínimo

## 1. Endpoint da lista de produtos

**Rota:** `GET /api/produtos/lista`  
**Arquivo:** `routes/produtos.js`

A query principal usa:

```sql
WITH base AS (
  SELECT v.*, p.descricao_familia
  FROM public.vw_lista_produtos v
  LEFT JOIN public.produtos_omie p ON p.codigo_produto = v.codigo_produto
  WHERE ...
)
```

### View `public.vw_lista_produtos`

Definida diretamente no banco (não há `CREATE VIEW` no código-fonte):

```sql
SELECT
  p.codigo_produto,
  p.codigo_produto_integracao,
  p.codigo,
  p.descricao,
  p.unidade,
  p.tipoitem,
  p.ncm,
  p.valor_unitario,
  p.quantidade_estoque,
  p.inativo,
  p.bloqueado,
  p.marca,
  p.modelo,
  p.dalt, p.halt, p.dinc, p.hinc,
  img.url_imagem AS primeira_imagem
FROM public.produtos_omie p
LEFT JOIN LATERAL (
  SELECT url_imagem
  FROM public.produtos_omie_imagens i
  WHERE i.codigo_produto = p.codigo_produto
  ORDER BY i.pos
  LIMIT 1
) img ON true;
```

> ⚠️ A `vw_lista_produtos` **não inclui `estoque_minimo`**. Ela retorna apenas dados cadastrais do produto + primeira imagem.

---

## 2. Onde o `estoque_minimo` é exibido

### 2.1 Catálogo de compras — `GET /api/compras/catalogo-omie`

Exibe a lista de produtos com saldo de estoque e indicador de abaixo do mínimo.

```sql
SELECT
  p.codigo,
  p.descricao,
  p.descricao_familia,
  p.codigo_produto,
  COALESCE(ea.saldo_total, 0)     AS saldo_estoque,
  COALESCE(ea.estoque_minimo, 0)  AS estoque_minimo,
  CASE
    WHEN ea.estoque_minimo > 0 AND ea.saldo_total < ea.estoque_minimo THEN true
    ELSE false
  END AS abaixo_minimo,
  COALESCE(ea.locais, '[]'::json) AS locais
FROM public.produtos_omie p
LEFT JOIN LATERAL (
  SELECT
    SUM(saldo)          AS saldo_total,
    MAX(estoque_minimo) AS estoque_minimo,
    json_agg(...) FILTER (WHERE saldo > 0) AS locais
  FROM logistica.estoque_atual
  WHERE codigo = p.codigo
) ea ON true
WHERE p.bloqueado = 'N'
ORDER BY p.descricao;
```

**Tabelas envolvidas:**
| Tabela | Schema | Papel |
|--------|--------|-------|
| `produtos_omie` | `public` | Dados cadastrais do produto |
| `produtos_omie_imagens` | `public` | Imagem do produto |
| `estoque_atual` | `logistica` | `estoque_minimo`, `saldo`, `fisico` por local |

### 2.2 Produtos abaixo do mínimo — `GET /api/logistica/produtos-no-minimo`

Lista somente os produtos cujo físico está abaixo do mínimo no PORTA PALLET (Almoxarifado).

```sql
WITH minimos AS (
  SELECT omie_prod_id, MAX(estoque_minimo) AS minimo
  FROM logistica.estoque_atual
  WHERE COALESCE(estoque_minimo, 0) > 0
  GROUP BY omie_prod_id
)
SELECT
  po.codigo,
  po.descricao,
  '10717096386'                      AS local_codigo,   -- PORTA PALLET
  '2. PORTA PALLET (ALMOXARIFADO)'   AS local_nome,
  COALESCE(pp.fisico, 0)             AS fisico,
  m.minimo                           AS estoque_minimo,
  (m.minimo - COALESCE(pp.fisico, 0)) AS deficit
FROM minimos m
JOIN public.produtos_omie po ON po.codigo_produto = m.omie_prod_id
LEFT JOIN logistica.estoque_atual pp
  ON pp.omie_prod_id = m.omie_prod_id
 AND pp.local_codigo = '10717096386'
WHERE COALESCE(pp.fisico, 0) < m.minimo
ORDER BY deficit DESC;
```

### 2.3 Almoxarifado grid — `POST /api/armazem/almoxarifado`

Leitura direta das posições de estoque por armazém:

```sql
SELECT DISTINCT ON (p.omie_prod_id)
  p.codigo, p.descricao,
  p.estoque_minimo,
  p.fisico, p.reservado, p.saldo, p.cmc
FROM public.omie_estoque_posicao p
LEFT JOIN public.produtos_omie po ON po.codigo_produto = p.omie_prod_id
WHERE p.local_codigo = $1        -- ex: '10408201806' (Recebimento)
  AND COALESCE(p.saldo, 0) != 0
ORDER BY p.omie_prod_id, p.data_posicao DESC;
```

---

## 3. Resumo de todas as tabelas

| Tabela | Schema | O que contém | `estoque_minimo`? |
|--------|--------|-------------|-------------------|
| `vw_lista_produtos` | `public` | View: produtos_omie + 1ª imagem | ❌ Não |
| `produtos_omie` | `public` | Cadastro completo do produto (vindo da Omie via webhook) | ✅ Sim (campo da Omie) |
| `produtos_omie_imagens` | `public` | Imagens por produto | ❌ Não |
| `estoque_atual` | `logistica` | Saldo atual por local, CMC, `estoque_minimo` sincronizado | ✅ Sim ← **usado no catálogo** |
| `omie_estoque_posicao` | `public` | Histórico de posições da Omie (snapshot diário) | ✅ Sim ← **usado no almoxarifado** |

---

## 4. De onde vem o `estoque_minimo` — origem dos dados

```
Omie ERP
  └── AlterarEstoqueMinimo (API)
        ├── grava em produtos_omie.estoque_minimo   (via webhook de produto)
        └── grava em omie_estoque_posicao            (via snapshot diário / cron)
              └── cron sincroniza → logistica.estoque_atual.estoque_minimo
```

- O valor cadastrado na Omie pode ser alterado via `POST /api/omie/estoque/ajuste` → chama `AlterarEstoqueMinimo` na Omie.
- A tabela `logistica.estoque_atual` é o **espelho sincronizado** e é a fonte principal para exibição na intranet.

---

## 5. Comparativo de fontes — cobertura do `estoque_minimo`

Análise executada diretamente no banco (27/05/2026):

| Fonte | Produtos únicos | Com `estoque_minimo > 0` |
|-------|----------------|--------------------------|
| `logistica.estoque_atual` (todos os locais) | 1.291 | 261 |
| `logistica.estoque_atual` (só RECEBIMENTO) | 737 | 261 |
| `v_omie_estoque_posicao_atual` (só RECEBIMENTO) | 1.899 | **443** |

**Conclusão:** `v_omie_estoque_posicao_atual` é a fonte **mais completa**.

- 184 produtos têm `estoque_minimo > 0` na view mas **não** em `logistica.estoque_atual`
- Apenas 2 fazem o caminho inverso
- Trocar `v_omie_estoque_posicao_atual` por `logistica.estoque_atual` perderia o mínimo de 184 produtos

> ✅ A implementação atual (que usa `v_omie_estoque_posicao_atual`) está correta e não deve ser alterada.

---

## 5. Query completa — todos os campos de uma vez ✅

Confirmado em teste: é possível buscar todos os campos abaixo em uma única query:

| Campo | Tipo retornado | Origem |
|-------|---------------|--------|
| `codigo_produto` | bigint | `public.produtos_omie` |
| `codigo` | text | `public.produtos_omie` |
| `descricao` | text | `public.produtos_omie` |
| `unidade` | text | `public.produtos_omie` |
| `tipoItem` | text | `public.produtos_omie` |
| `inativo` | char | `public.produtos_omie` |
| `ean` | text | `public.produtos_omie` |
| `lead_time` | integer | `public.produtos_omie` |
| `url_imagens` | JSON array de URLs | `public.produtos_omie_imagens` |
| `vl_cmc` | numeric | `logistica.estoque_atual` |
| `estoque_minimo` | numeric | `logistica.estoque_atual` |

```sql
SELECT
  p.codigo_produto,
  p.codigo,
  p.descricao,
  p.unidade,
  p.tipoitem                              AS "tipoItem",
  p.inativo,
  p.ean,
  p.lead_time,
  COALESCE(imgs.urls, '[]'::json)         AS url_imagens,
  COALESCE(ea.vl_cmc, 0)                  AS vl_cmc,
  COALESCE(ea.estoque_minimo, 0)          AS estoque_minimo
FROM public.produtos_omie p
LEFT JOIN LATERAL (
  SELECT json_agg(url_imagem ORDER BY pos) AS urls
  FROM public.produtos_omie_imagens
  WHERE codigo_produto = p.codigo_produto
) imgs ON true
LEFT JOIN LATERAL (
  SELECT
    MAX(cmc)             AS vl_cmc,
    MAX(estoque_minimo)  AS estoque_minimo
  FROM logistica.estoque_atual
  WHERE omie_prod_id = p.codigo_produto
) ea ON true
WHERE p.inativo = 'N'
  AND p.bloqueado = 'N'
ORDER BY p.descricao;
```
