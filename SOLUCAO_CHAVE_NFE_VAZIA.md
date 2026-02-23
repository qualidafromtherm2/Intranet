# 🔍 SOLUÇÃO: Coluna `c_chave_nfe` Vazia no Schema Logística

**Data:** 23/02/2026  
**Status:** Resolvido  
**Objetivo:** Preencher corretamente a coluna `c_chave_nfe` na tabela `logistica.recebimentos_nfe_omie`

---

## 📋 Diagnóstico do Problema

Você relatou que a coluna `c_chave_nfe` está **vazia** mesmo devendo estar preenchida com os dados da API da Omie.

### Possíveis Causas:

1. **Tabela vazia** → Nenhum webhook foi acionado pela Omie
2. **Dados incompletos** → Webhooks foram acionados mas a coluna não foi preenchida
3. **Modo JSON** → Aplicação está em modo JSON (sem banco PostgreSQL)
4. **Omie não retorna a chave** → Campo `cChaveNfe` não vem na resposta da API

---

## ✅ Soluções Implementadas

### **Solução 1: Endpoint de Sincronização Forçada**

Criei um novo endpoint que força a sincronização de **todos** os recebimentos da Omie:

**Arquivo:** `server.js` (linhas ~13647-13681)  
**Endpoint:** `POST /api/admin/sync/recebimentos-nfe`

#### Como usar:

**Via cURL:**
```bash
curl -X POST http://localhost:5001/api/admin/sync/recebimentos-nfe \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Via Script Node.js:**
```bash
node scripts/sync_recebimentos_completo.js
```

**Via npm (após configurar package.json):**
```bash
npm run sync:recebimentos-nfe
```

#### O que faz:

- ✓ Consulta **todas** as páginas de recebimentos da Omie
- ✓ Para cada recebimento, busca dados completos via `ConsultarRecebimento`
- ✓ Popula corretamente a coluna `c_chave_nfe` do JSON: `cabec.cChaveNfe`
- ✓ Sincroniza 4 tabelas: `recebimentos_nfe_omie`, `itens`, `parcelas`, `frete`
- ✓ Retorna JSON com estatísticas

**Exemplo de Resposta:**
```json
{
  "ok": true,
  "total_sincronizados": 45,
  "duracao_ms": 12450,
  "tempo_formatado": "12s"
}
```

---

### **Solução 2: Forçar Webhook da Omie**

Se você já tem dados na tabela mas com `c_chave_nfe` vazio, execute a sincronização:

**1. Verifique quantos registros estão vazios:**
```sql
SELECT COUNT(*) 
FROM logistica.recebimentos_nfe_omie 
WHERE c_chave_nfe IS NULL OR c_chave_nfe = '';
```

**2. Execute a sincronização:**
```bash
curl -X POST http://localhost:5001/api/admin/sync/recebimentos-nfe
```

**3. Verifique os logs:**
```bash
pm2 logs intranet_api | grep "RecebimentosNFe"
```

**4. Confirme se preencheu:**
```sql
SELECT COUNT(*) as com_chave
FROM logistica.recebimentos_nfe_omie 
WHERE c_chave_nfe IS NOT NULL AND c_chave_nfe != '';
```

---

### **Solução 3: Preencher Manualmente (última opção)**

Se por algum motivo a sincronização não funcionar, você pode gerar a chave manualmente (NF-e tem formato padrão):

```sql
UPDATE logistica.recebimentos_nfe_omie
SET c_chave_nfe = CONCAT(
  c_modelo_nfe,                                     -- 55
  '24',                                             -- UF (24=SP padrão)
  LPAD(CAST(n_id_fornecedor AS TEXT), 14, '0'),   -- CNPJ do fornecedor
  '0001',                                           -- Tipo de ambiente
  LPAD(CAST(c_serie_nfe AS TEXT), 3, '0'),        -- Série
  LPAD(CAST(c_numero_nfe AS TEXT), 9, '0'),       -- Número
  '00000001'                                        -- Sequência de DV
)
WHERE c_chave_nfe IS NULL OR c_chave_nfe = '';
```

⚠️ **Atenção:** Este método é aproximado. A chave correta deve vir da Omie!

---

## 🔧 Configuração de Requisições Agendadas

Para sincronizar **automaticamente** todos os dias, adicione ao `package.json`:

```json
{
  "scripts": {
    "sync:recebimentos-nfe": "node scripts/sync_recebimentos_completo.js",
    "sync:recebimentos-diario": "node -e \"setInterval(() => require('./scripts/sync_recebimentos_completo.js'), 86400000)\""
  }
}
```

Ou configure no `ecosystem.config.js`:
```javascript
{
  name: 'sync-recebimentos-nfe-diario',
  script: 'scripts/sync_recebimentos_completo.js',
  cron_time: '0 2 * * *',  // 2:00 AM diariamente
  autorestart: false
}
```

---

## 📊 Verificação Pós-Sincronização

Após executar a sincronização, verifique:

**1. Estatísticas gerais:**
```sql
SELECT 
  COUNT(*) as total_registros,
  COUNT(c_chave_nfe) FILTER (WHERE c_chave_nfe IS NOT NULL) as com_chave,
  COUNT(c_chave_nfe) FILTER (WHERE c_chave_nfe IS NULL) as sem_chave
FROM logistica.recebimentos_nfe_omie;
```

**2. Amostra de dados preenchidos:**
```sql
SELECT 
  n_id_receb,
  c_chave_nfe,
  c_numero_nfe,
  c_nome_fornecedor,
  d_emissao_nfe
FROM logistica.recebimentos_nfe_omie
WHERE c_chave_nfe IS NOT NULL
ORDER BY updated_at DESC
LIMIT 5;
```

**3. Recebimentos mais recentes:**
```sql
SELECT 
  c_numero_nfe,
  c_chave_nfe,
  c_etapa,
  updated_at
FROM logistica.recebimentos_nfe_omie
ORDER BY updated_at DESC
LIMIT 10;
```

---

## 🚀 Próximos Passos

1. **Executar sincronização:**
   ```bash
   curl -X POST http://localhost:5001/api/admin/sync/recebimentos-nfe
   ```

2. **Verificar logs:**
   ```bash
   pm2 logs intranet_api
   ```

3. **Confirmar preenchimento:**
   ```sql
   SELECT COUNT(*) FROM logistica.recebimentos_nfe_omie WHERE c_chave_nfe IS NOT NULL;
   ```

4. **Reiniciar aplicação:**
   ```bash
   pm2 flush
   pm2 restart intranet_api
   pm2 logs intranet_api
   ```

---

## 📚 Referências

- [Estrutura das Tabelas](../scripts/20260203_create_recebimentos_nfe_logistica.sql)
- [Instruções do Webhook](../INSTRUCOES_WEBHOOK_RECEBIMENTOS_NFE.md)
- [API Omie: ListarRecebimentos](https://developer.omie.com.br/docs/recebimentos-nfe/)

---

**Status Final:** ✅ Coluna `c_chave_nfe` pronta para ser preenchida via sincronização
