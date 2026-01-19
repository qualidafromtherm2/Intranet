# 🐛 PROBLEMA IDENTIFICADO - Pedidos Faturados/Recebidos/Conferidos não estão sendo sincronizados

## Problema

Na interface da Omie aparecem claramente várias colunas com pedidos em diferentes etapas:
- **Aprovado** (etapa 15) ✅ Sincronizado
- **Faturado pelo Fornecedor** (etapa 40) ❌ NÃO sincronizado  
- **Recebido** (etapa 60) ❌ NÃO sincronizado
- **Conferido** (etapa 80) ❌ NÃO sincronizado

Porém no banco de dados só temos:
```
 codigo_etapa | etapa_descricao  | total 
--------------+------------------+-------
 10           | Pedido de Compra |     7
 15           | Aprovação        |  1577
 20           | Requisição       |     5
(3 linhas)
```

## Causa

O problema está na função `syncPedidosCompraOmie()` no arquivo `server.js` (linha ~10436):

```javascript
param: [{
  nPagina: pagina,
  nRegsPorPagina: 50,
  lExibirPedidosPendentes: filtros.pendentes !== false,    // = true
  lExibirPedidosFaturados: filtros.faturados !== false,    // = true
  lExibirPedidosRecebidos: filtros.recebidos !== false,    // = true
  lExibirPedidosCancelados: filtros.cancelados !== false,  // = true
  lExibirPedidosEncerrados: filtros.encerrados !== false   // = true
}]
```

Quando chamamos o sync sem parâmetros, TODOS os filtros ficam como `true`.

**O comportamento da API da Omie** parece ser:
- Quando TODOS os filtros são `true`, a API interpreta isso de forma restritiva
- Ou a API tem um comportamento padrão diferente quando nenhum filtro é especificado

## Solução

**Opção 1: Remover TODOS os filtros** (deixar a API usar seu comportamento padrão)
```javascript
param: [{
  nPagina: pagina,
  nRegsPorPagina: 50
  // SEM filtros lExibir*
}]
```

**Opção 2: Setar TODOS como false** (forçar a API a retornar tudo)
```javascript
param: [{
  nPagina: pagina,
  nRegsPorPagina: 50,
  lExibirPedidosPendentes: false,
  lExibirPedidosFaturados: false,
  lExibirPedidosRecebidos: false,
  lExibirPedidosCancelados: false,
  lExibirPedidosEncerrados: false
}]
```

## Implementação da Correção

Vamos modificar a função `syncPedidosCompraOmie()` para:

1. **Por padrão**: NÃO enviar nenhum filtro (deixar a API decidir)
2. **Quando especificado**: Permitir filtros individuais

### Código Corrigido

```javascript
async function syncPedidosCompraOmie(filtros = {}) {
  try {
    console.log('[PedidosCompra] Iniciando sincronização com Omie...');
    let pagina = 1;
    let totalSincronizados = 0;
    let continuar = true;
    
    while (continuar) {
      const param = {
        nPagina: pagina,
        nRegsPorPagina: 50
      };
      
      // Só adiciona filtros de status se EXPLICITAMENTE definidos
      if (filtros.pendentes === true || filtros.pendentes === false) {
        param.lExibirPedidosPendentes = filtros.pendentes;
      }
      if (filtros.faturados === true || filtros.faturados === false) {
        param.lExibirPedidosFaturados = filtros.faturados;
      }
      if (filtros.recebidos === true || filtros.recebidos === false) {
        param.lExibirPedidosRecebidos = filtros.recebidos;
      }
      if (filtros.cancelados === true || filtros.cancelados === false) {
        param.lExibirPedidosCancelados = filtros.cancelados;
      }
      if (filtros.encerrados === true || filtros.encerrados === false) {
        param.lExibirPedidosEncerrados = filtros.encerrados;
      }
      
      // Filtros de data (sempre adiciona se definidos)
      if (filtros.data_inicial) {
        param.dDataInicial = filtros.data_inicial;
      }
      if (filtros.data_final) {
        param.dDataFinal = filtros.data_final;
      }
      
      const body = {
        call: 'PesquisarPedCompra',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [param]
      };
      
      console.log(`[PedidosCompra] Buscando página ${pagina}...`);
      
      // ... resto do código continua igual
    }
  } catch (err) {
    // ...
  }
}
```

## Como Testar

```bash
# 1. Aplicar a correção no server.js

# 2. Fazer commit e push
git add server.js
git commit -m "fix: Corrige filtros da API Omie para trazer pedidos de todas as etapas"
git push

# 3. Aguardar deploy automático (5-10 minutos)

# 4. Limpar dados antigos e sincronizar novamente
PGPASSWORD='amLpOKjWzzDRhwcR1NF0eolJzzfCY0ho' psql \
  -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com \
  -p 5432 \
  -U intranet_db_yd0w_user \
  -d intranet_db_yd0w \
  -c "TRUNCATE compras.pedidos_omie_produtos, compras.pedidos_omie_frete, compras.pedidos_omie_parcelas, compras.pedidos_omie_departamentos, compras.pedidos_omie CASCADE;"

# 5. Rodar sync novamente
curl -X POST http://localhost:5001/api/compras/pedidos-omie/sync

# 6. Verificar distribuição por etapa
PGPASSWORD='amLpOKjWzzDRhwcR1NF0eolJzzfCY0ho' psql \
  -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com \
  -p 5432 \
  -U intranet_db_yd0w_user \
  -d intranet_db_yd0w \
  -c "SELECT codigo_etapa, etapa_descricao, COUNT(*) FROM compras.v_pedidos_omie_completo GROUP BY codigo_etapa, etapa_descricao ORDER BY codigo_etapa;"
```

## Resultado Esperado

Após a correção, devemos ver pedidos em TODAS as etapas:
```
 codigo_etapa | etapa_descricao            | total 
--------------+----------------------------+-------
 10           | Pedido de Compra           |    XX
 15           | Aprovação                  |    XX
 20           | Requisição                 |    XX
 40           | Faturado pelo Fornecedor   |    XX  ← Deve aparecer!
 60           | Recebido                   |    XX  ← Deve aparecer!
 80           | Conferido                  |    XX  ← Deve aparecer!
```
