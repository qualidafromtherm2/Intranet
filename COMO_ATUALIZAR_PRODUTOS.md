# ⚡ COMO ATUALIZAR A TABELA produtos_omie

## 🎯 Objetivo
Sincronizar todos os produtos da Omie para o banco de dados após período sem atualização devido aos erros do webhook.

---

## ✅ SOLUÇÃO IMPLEMENTADA

Criei **2 scripts de sincronização** para você escolher:

### 🚀 1. SINCRONIZAÇÃO RÁPIDA (Recomendado)
**Tempo:** ~5-10 minutos  
**Arquivo:** `scripts/sync_produtos_omie_rapido.js`

```bash
cd /home/leandro/Projetos/intranet
node scripts/sync_produtos_omie_rapido.js
```

**Vantagens:**
- ⚡ Muito rápido
- 📊 Atualiza todos os produtos de uma vez
- 💾 100 produtos por requisição
- ✅ Ideal para sincronização inicial

---

### 🔍 2. SINCRONIZAÇÃO COMPLETA (Detalhada)
**Tempo:** ~30-60 minutos  
**Arquivo:** `scripts/sync_produtos_omie_completo.js`

```bash
cd /home/leandro/Projetos/intranet
node scripts/sync_produtos_omie_completo.js
```

**Vantagens:**
- 🔍 Consulta cada produto individualmente
- 💾 Dados mais completos e detalhados
- ✅ Ideal para garantir 100% de precisão

---

## 🚀 PASSO A PASSO RÁPIDO

### 1️⃣ Verificar credenciais
```bash
echo $OMIE_APP_KEY
echo $OMIE_APP_SECRET
```

Se não aparecer nada, configure:
```bash
export OMIE_APP_KEY="sua_chave"
export OMIE_APP_SECRET="seu_secret"
```

### 2️⃣ Executar sincronização
```bash
cd /home/leandro/Projetos/intranet
node scripts/sync_produtos_omie_rapido.js
```

### 3️⃣ Aguardar conclusão
O script mostrará progresso em tempo real:
```
⚡ SINCRONIZAÇÃO RÁPIDA: Omie → PostgreSQL
✓ Total: 2500 produtos em 25 páginas
⏱️  Tempo estimado: ~2 minutos

📄 Página 1/25 - 100 produtos
   ✅ 4.0% concluído (100 ok, 0 erros)
...
🎉 SINCRONIZAÇÃO CONCLUÍDA!
```

### 4️⃣ Verificar resultado
```bash
node -e "const {dbQuery} = require('./src/db'); dbQuery('SELECT COUNT(*) FROM public.produtos_omie').then(r => console.log('✅ Total produtos:', r.rows[0].count))"
```

---

## 📊 O QUE ACONTECE DURANTE A SINCRONIZAÇÃO

1. **Consulta total de produtos** na Omie
2. **Busca produtos página por página** (50-100 por vez)
3. **Insere/Atualiza cada produto** no banco usando `omie_upsert_produto()`
4. **Mostra progresso** em tempo real
5. **Exibe relatório final** com estatísticas

---

## 🔄 DEPOIS DA SINCRONIZAÇÃO

Após rodar a sincronização inicial:

✅ **Webhook corrigido manterá tudo atualizado automaticamente**  
✅ Não precisará rodar sincronização manual novamente  
✅ Produtos serão atualizados em tempo real quando mudarem na Omie

---

## 🎯 RECOMENDAÇÃO

**Execute AGORA:**
```bash
cd /home/leandro/Projetos/intranet
node scripts/sync_produtos_omie_rapido.js
```

Isso irá:
1. Atualizar todos os produtos em ~5-10 minutos
2. Deixar a tabela `produtos_omie` 100% sincronizada
3. O webhook corrigido cuidará das atualizações futuras

---

## 📚 DOCUMENTAÇÃO COMPLETA

Para mais detalhes, consulte:
- [GUIA_SINCRONIZACAO_PRODUTOS.md](GUIA_SINCRONIZACAO_PRODUTOS.md) - Guia completo
- [CORRECAO_WEBHOOK_TIMEOUT_PRODUTOS.md](CORRECAO_WEBHOOK_TIMEOUT_PRODUTOS.md) - Correção do webhook
- [VALIDACAO_WEBHOOK.md](VALIDACAO_WEBHOOK.md) - Como validar

---

## ⚠️ TROUBLESHOOTING RÁPIDO

### Erro: "OMIE_APP_KEY não configurado"
```bash
export OMIE_APP_KEY="sua_chave"
export OMIE_APP_SECRET="seu_secret"
```

### Erro: "Cannot find module"
```bash
cd /home/leandro/Projetos/intranet
pwd  # Verificar se está no diretório correto
```

### Erro de conexão com banco
```bash
echo $DATABASE_URL  # Verificar se está configurado
```

---

## 💡 DICA

**Mantenha o terminal aberto** durante a execução para ver o progresso.  
O script mostra estatísticas a cada página processada!
