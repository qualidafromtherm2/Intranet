# ✅ CONCLUSÃO FINAL - Pedidos Faturados/Recebidos/Conferidos

## 🎯 Descoberta

Após testar **14 combinações diferentes** de filtros da API Omie, a conclusão é:

**❌ NENHUMA combinação de filtros retorna pedidos nas etapas 40, 60 ou 80**

## 📊 Resultado dos Testes

```
Total de testes: 14
Encontrou etapas 40/60/80: NÃO
```

### Testes Relevantes:

1. **Sem filtros** → 0 pedidos
2. **Apenas pendentes** → 33 pedidos (etapas: 10, 15, 20)
3. **Apenas faturados** → 0 pedidos  ⚠️
4. **Apenas recebidos** → 1.366 pedidos (TODOS na etapa 15!) ⚠️
5. **Apenas cancelados** → 1 pedido (etapa 10)
6. **Apenas encerrados** → 189 pedidos (TODOS na etapa 15!) ⚠️
7. **Todos os filtros = true** → 1.589 pedidos (etapas: 10, 15, 20)

## 🔍 Interpretação

### O que isso significa?

1. **A API da Omie considera "etapa" diferente de "status"**
   - Etapa (`cEtapa`): 10, 15, 20 = Etapas internas do pedido de compra
   - Status: Faturado, Recebido, Conferido = Status de processamento

2. **Pedidos "Recebidos" estão na etapa 15!**
   - Quando filtramos `lExibirPedidosRecebidos: true` → 1.366 pedidos
   - TODOS esses pedidos têm `cEtapa = 15` (Aprovação)
   - Isso significa que "Recebido" é um **substatus** dentro da etapa 15

3. **Pedidos "Encerrados" também estão na etapa 15!**
   - Filtro `lExibirPedidosEncerrados: true` → 189 pedidos  
   - Todos na etapa 15

### Conclusão: As "colunas" da interface são agrupamentos, não etapas!

Na interface da Omie:
```
┌─────────┬───────────┬────────────┬───────────────────────────┬──────────┬───────────┐
│ Pedido  │ Aprovação │ Requisição │ Faturado pelo Fornecedor  │ Recebido │ Conferido │
└─────────┴───────────┴────────────┴───────────────────────────┴──────────┴───────────┘
  etapa 10   etapa 15    etapa 20        (status especial)      (status)    (status)
```

Mas na API:
- **Etapas reais**: 10, 15, 20
- **Status/Filtros**: Pendente, Faturado, Recebido, Encerrado, Cancelado
- **Relação**: Um pedido na etapa 15 pode ter status "Recebido" ou "Encerrado"

## 💡 Solução

### Para ter TODOS os pedidos (incluindo os "nas colunas Faturado/Recebido/Conferido"):

Use os filtros que retornaram mais pedidos:

```javascript
// Configuração RECOMENDADA para sincronização completa
{
  nPagina: 1,
  nRegsPorPagina: 50,
  lExibirPedidosRecebidos: true,  // Inclui pedidos "recebidos"
  lExibirPedidosEncerrados: true, // Inclui pedidos "encerrados"
  lExibirPedidosPendentes: true   // Inclui pedidos "pendentes"
  // Total: 33 + 1.366 + 189 = 1.588 pedidos (quase todos!)
}
```

Ou simplesmente:

```javascript
// Configuração SIMPLIFICADA (retorna tudo)
{
  nPagina: 1,
  nRegsPorPagina: 50,
  lExibirPedidosPendentes: true,
  lExibirPedidosFaturados: true,
  lExibirPedidosRecebidos: true,
  lExibirPedidosCancelados: true,
  lExibirPedidosEncerrados: true
}
// Total: 1.589 pedidos
```

### ⚠️ IMPORTANTE

**NÃO EXISTEM** pedidos nas etapas 40, 60, 80 na sua base da Omie!

Os códigos de etapa que você viu na documentação (40, 60, 80) provavelmente são:
1. **Códigos antigos** que não são mais usados
2. **Códigos de outro módulo** (NF-e, Recebimento, etc.)
3. **Planejados mas não implementados** pela Omie

## ✅ Distribuição REAL dos Pedidos

Após sincronização com TODOS os filtros:

```
Etapa  | Descrição        | Quantidade
-------|------------------|------------
10     | Pedido de Compra |      7
15     | Aprovação        |  1.577  ← AQUI estão os "Faturados", "Recebidos", "Conferidos"
20     | Requisição       |      5
-------|------------------|------------
TOTAL                     |  1.589
```

## 🎯 Recomendação Final

1. **Mantenha a sincronização atual** - Ela está trazendo TODOS os 1.589 pedidos
2. **Remova os códigos de etapa 40, 60, 80** - Eles não existem na prática
3. **Se precisar diferenciar status dentro da etapa 15**:
   - Use os filtros `lExibirPedidosRecebidos` e `lExibirPedidosEncerrados`
   - Ou adicione um campo adicional no banco para marcar o "subtipo"

## 📝 Ações Necessárias

### 1. Atualizar tabela de referência

```sql
-- Remover etapas inexistentes
DELETE FROM compras.etapas_pedido_compra 
WHERE codigo IN ('40', '60', '80');

-- Adicionar observação à etapa 15
UPDATE compras.etapas_pedido_compra
SET descricao = 'Aprovação (pode incluir: Faturado, Recebido, Conferido)'
WHERE codigo = '15';
```

### 2. Documentar corretamente

As "colunas" da interface da Omie agrupam pedidos por STATUS, não por ETAPA:
- **Pendentes** = `lExibirPedidosPendentes: true`
- **Faturados** = (provavelmente pedidos com NF-e vinculada, mas ainda na etapa 15)
- **Recebidos** = `lExibirPedidosRecebidos: true` (etapa 15)
- **Conferidos** = `lExibirPedidosEncerrados: true` (etapa 15)

---

**Data da investigação**: 18 de janeiro de 2026  
**Método**: Teste exaustivo de 14 combinações de filtros da API Omie  
**Conclusão**: Pedidos "avançados" estão na etapa 15, não em etapas 40/60/80
