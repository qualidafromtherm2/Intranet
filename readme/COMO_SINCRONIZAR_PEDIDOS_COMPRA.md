# Como Sincronizar Pedidos de Compra da Omie

## 📥 Sincronização Manual - Passo a Passo

### 1️⃣ Via Terminal (Recomendado para primeira sincronização)

Execute o seguinte comando para sincronizar todos os pedidos:

```bash
curl -X POST http://localhost:5001/api/compras/pedidos-omie/sync \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Com filtros (opcional):**
```bash
curl -X POST http://localhost:5001/api/compras/pedidos-omie/sync \
  -H "Content-Type: application/json" \
  -d '{
    "pendentes": true,
    "faturados": true,
    "recebidos": true,
    "cancelados": false,
    "encerrados": false,
    "data_inicial": "01/01/2025",
    "data_final": "31/12/2025"
  }'
```

### 2️⃣ Via Navegador (Para teste rápido)

No console do navegador (F12), execute:

```javascript
// Sincronizar todos os pedidos
fetch('http://localhost:5001/api/compras/pedidos-omie/sync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({})
})
.then(r => r.json())
.then(console.log);

// Sincronizar só pedidos pendentes dos últimos 30 dias
fetch('http://localhost:5001/api/compras/pedidos-omie/sync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pendentes: true,
    faturados: false,
    recebidos: false,
    cancelados: false,
    encerrados: false
  })
})
.then(r => r.json())
.then(console.log);
```

---

## 📊 Consultando os Dados Sincronizados

### Listar pedidos

```bash
# Listar todos os pedidos (100 primeiros)
curl http://localhost:5001/api/compras/pedidos-omie

# Com filtros
curl "http://localhost:5001/api/compras/pedidos-omie?etapa=Pendente&limit=50"
```

### Ver detalhes de um pedido específico

```bash
# Substitua 123456 pelo código do pedido
curl http://localhost:5001/api/compras/pedidos-omie/123456
```

### No banco de dados (SQL)

```sql
-- Ver todos os pedidos
SELECT 
  n_cod_ped, 
  c_numero, 
  c_etapa, 
  d_dt_previsao,
  evento_webhook, 
  data_webhook
FROM compras.pedidos_omie 
ORDER BY data_webhook DESC 
LIMIT 20;

-- Ver produtos de um pedido
SELECT 
  p.c_produto,
  p.c_descricao,
  p.n_qtde,
  p.n_val_unit,
  p.n_val_tot
FROM compras.pedidos_omie_produtos p
WHERE p.n_cod_ped = 123456;  -- Substitua pelo seu código

-- Estatísticas
SELECT 
  c_etapa,
  COUNT(*) as total,
  SUM((SELECT SUM(n_val_tot) FROM compras.pedidos_omie_produtos WHERE n_cod_ped = po.n_cod_ped)) as valor_total
FROM compras.pedidos_omie po
GROUP BY c_etapa
ORDER BY total DESC;
```

---

## 🔄 URLs dos Endpoints

### Produção (Render)
```
POST https://intranet-30av.onrender.com/api/compras/pedidos-omie/sync
GET  https://intranet-30av.onrender.com/api/compras/pedidos-omie
GET  https://intranet-30av.onrender.com/api/compras/pedidos-omie/:nCodPed
```

### Local
```
POST http://localhost:5001/api/compras/pedidos-omie/sync
GET  http://localhost:5001/api/compras/pedidos-omie
GET  http://localhost:5001/api/compras/pedidos-omie/:nCodPed
```

---

## ⚙️ Parâmetros de Filtro para Sincronização

| Parâmetro | Tipo | Descrição | Padrão |
|-----------|------|-----------|--------|
| `pendentes` | boolean | Incluir pedidos pendentes | `true` |
| `faturados` | boolean | Incluir pedidos faturados | `true` |
| `recebidos` | boolean | Incluir pedidos recebidos | `true` |
| `cancelados` | boolean | Incluir pedidos cancelados | `true` |
| `encerrados` | boolean | Incluir pedidos encerrados | `true` |
| `data_inicial` | string | Data inicial (DD/MM/YYYY) | - |
| `data_final` | string | Data final (DD/MM/YYYY) | - |

---

## 📝 Logs

Para acompanhar a sincronização em tempo real:

```bash
# Ver logs
pm2 logs intranet_api | grep "PedidosCompra"

# Ou todos os logs
pm2 logs intranet_api --lines 100
```

---

## ⏱️ Tempo Estimado

- **10 pedidos**: ~3 segundos
- **100 pedidos**: ~30 segundos
- **1000 pedidos**: ~5 minutos

A sincronização busca os detalhes completos de cada pedido, incluindo produtos, frete, parcelas e departamentos.

---

## 🆘 Problemas Comuns

### Erro "Omie API retornou 401"
- Verifique se as variáveis `OMIE_APP_KEY` e `OMIE_APP_SECRET` estão configuradas

### Sincronização muito lenta
- Use filtros para limitar o período: `data_inicial` e `data_final`
- Sincronize por partes

### Pedidos não aparecem
- Verifique se as tabelas foram criadas no banco
- Execute: `SELECT COUNT(*) FROM compras.pedidos_omie;`

---

## 🎯 Exemplo Completo

```bash
# 1. Sincronizar pedidos dos últimos 90 dias
curl -X POST http://localhost:5001/api/compras/pedidos-omie/sync \
  -H "Content-Type: application/json" \
  -d '{
    "data_inicial": "17/10/2025",
    "data_final": "17/01/2026"
  }'

# 2. Ver quantos pedidos foram sincronizados
PGPASSWORD='amLpOKjWzzDRhwcR1NF0eolJzzfCY0ho' \
psql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com \
     -p 5432 -U intranet_db_yd0w_user -d intranet_db_yd0w \
     -c "SELECT COUNT(*) FROM compras.pedidos_omie;"

# 3. Ver pedidos por etapa
PGPASSWORD='amLpOKjWzzDRhwcR1NF0eolJzzfCY0ho' \
psql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com \
     -p 5432 -U intranet_db_yd0w_user -d intranet_db_yd0w \
     -c "SELECT c_etapa, COUNT(*) FROM compras.pedidos_omie GROUP BY c_etapa;"
```

---

**Data:** 17/01/2026  
**Desenvolvido por:** GitHub Copilot
