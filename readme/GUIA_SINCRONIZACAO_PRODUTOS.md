# 🔄 Guia de Sincronização de Produtos Omie

## Objetivo
Atualizar a tabela `public.produtos_omie` com todos os produtos da Omie após período sem sincronização.

---

## 📋 Opções de Sincronização

### 🚀 Opção 1: Sincronização RÁPIDA (Recomendado)
**Arquivo:** `scripts/sync_produtos_omie_rapido.js`

**Características:**
- ⚡ **Muito rápido** (~5-10 minutos para milhares de produtos)
- 📊 Usa apenas `ListarProdutos` (100 produtos por requisição)
- 💾 Insere dados básicos de cada produto
- ✅ Ideal para sincronização inicial ou completa

**Quando usar:**
- Primeira sincronização
- Atualização em massa após período offline
- Quando precisa de velocidade

**Como executar:**
```bash
cd /home/leandro/Projetos/intranet
node scripts/sync_produtos_omie_rapido.js
```

---

### 🔍 Opção 2: Sincronização COMPLETA (Detalhada)
**Arquivo:** `scripts/sync_produtos_omie_completo.js`

**Características:**
- 🐢 **Mais lento** (~30-60 minutos para milhares de produtos)
- 📊 Consulta detalhes de **cada produto individualmente**
- 💾 Insere dados completos incluindo imagens, características, etc.
- ✅ Ideal para garantir dados 100% atualizados

**Quando usar:**
- Quando precisa de todos os detalhes de cada produto
- Sincronização periódica de qualidade
- Após mudanças importantes na Omie

**Como executar:**
```bash
cd /home/leandro/Projetos/intranet
node scripts/sync_produtos_omie_completo.js
```

---

## 📊 Comparação

| Característica | RÁPIDA | COMPLETA |
|----------------|---------|----------|
| Velocidade | ⚡⚡⚡⚡⚡ | ⚡⚡ |
| Detalhes | Básicos | Completos |
| Tempo estimado | 5-10 min | 30-60 min |
| Requisições API | ~10-20 | ~1000-5000 |
| Uso recomendado | Inicial/Massa | Periódica/Qualidade |

---

## 🛠️ Pré-requisitos

### 1. Verificar variáveis de ambiente
```bash
# Verificar se as credenciais estão configuradas
echo $OMIE_APP_KEY
echo $OMIE_APP_SECRET

# Se não estiverem configuradas, configure:
export OMIE_APP_KEY="sua_chave_aqui"
export OMIE_APP_SECRET="seu_secret_aqui"
```

### 2. Verificar conexão com banco
```bash
# Testar conexão
node -e "const {dbQuery} = require('./src/db'); dbQuery('SELECT 1').then(() => console.log('✅ DB OK')).catch(e => console.error('❌', e.message))"
```

---

## 📝 Passo a Passo Recomendado

### Para Primeira Sincronização:

```bash
# 1. Ir para o diretório do projeto
cd /home/leandro/Projetos/intranet

# 2. Executar sincronização RÁPIDA
node scripts/sync_produtos_omie_rapido.js

# 3. Aguardar conclusão (5-10 minutos)
# O script mostrará progresso em tempo real

# 4. Verificar resultado
node -e "const {dbQuery} = require('./src/db'); dbQuery('SELECT COUNT(*) FROM public.produtos_omie').then(r => console.log('Total produtos:', r.rows[0].count))"
```

### Para Sincronização Periódica:

```bash
# Executar sincronização COMPLETA (mais detalhada)
node scripts/sync_produtos_omie_completo.js
```

---

## 📊 Monitoramento Durante Execução

O script mostra progresso em tempo real:

### Sincronização RÁPIDA:
```
============================================================================
⚡ SINCRONIZAÇÃO RÁPIDA: Omie → PostgreSQL
============================================================================

✓ Credenciais configuradas
✓ Conexão com banco OK

📊 Consultando total de produtos...
✓ Total: 2500 produtos em 25 páginas
⏱️  Tempo estimado: ~2 minutos

⏳ Iniciando em 2 segundos...

📄 Página 1/25 - 100 produtos
   ✅ 4.0% concluído (100 ok, 0 erros)

📄 Página 2/25 - 100 produtos
   ✅ 8.0% concluído (200 ok, 0 erros)

...

============================================================================
🎉 SINCRONIZAÇÃO CONCLUÍDA!
============================================================================

📊 ESTATÍSTICAS:
   Total: 2500
   ✅ Sucesso: 2498 (99.9%)
   ❌ Erros: 2 (0.1%)
   ⏱️  Duração: 8m 32s

✅ Tabela public.produtos_omie atualizada!
```

### Sincronização COMPLETA:
```
============================================================================
🔄 SINCRONIZAÇÃO COMPLETA: Omie → PostgreSQL
============================================================================

✓ Credenciais da Omie configuradas
✓ Conexão com banco de dados OK
✓ Registros por página: 50
✓ Delay entre páginas: 300ms
✓ Delay entre produtos: 50ms

📊 Consultando total de produtos na Omie...

✓ Total de páginas: 50
✓ Total de produtos: 2500
⏱️  Tempo estimado: ~45 minutos

⏳ Iniciando sincronização em 3 segundos...

📄 Buscando página 1/50...
   Produtos na página: 50
   ✅ [1/2500] 0.0% - 01.001 - Produto exemplo 1
   ✅ [2/2500] 0.1% - 01.002 - Produto exemplo 2
   ...
```

---

## ⚠️ Troubleshooting

### Erro: "OMIE_APP_KEY não configurado"
**Solução:**
```bash
# Configurar variáveis no ambiente atual
export OMIE_APP_KEY="sua_chave"
export OMIE_APP_SECRET="seu_secret"

# Ou executar diretamente:
OMIE_APP_KEY="..." OMIE_APP_SECRET="..." node scripts/sync_produtos_omie_rapido.js
```

### Erro: "Cannot find module '../src/db'"
**Solução:**
```bash
# Certifique-se de estar no diretório correto
cd /home/leandro/Projetos/intranet
pwd  # Deve mostrar: /home/leandro/Projetos/intranet
```

### Erro: "Conexão com banco falhou"
**Solução:**
```bash
# Verificar se DATABASE_URL está configurado
echo $DATABASE_URL

# Ou verificar variáveis individuais
echo $PGHOST
echo $PGDATABASE
echo $PGUSER
```

### Erro: "HTTP 401" ou "Unauthorized"
**Solução:**
- Verifique se OMIE_APP_KEY e OMIE_APP_SECRET estão corretos
- Teste as credenciais diretamente na Omie

### Erro: "Timeout" ou muitos erros
**Solução:**
- Aumente os delays no script (edite as constantes no início)
- Reduza REGISTROS_POR_PAGINA
- Execute em horário de menor uso da API

---

## 🔧 Configurações Avançadas

### Ajustar velocidade (editar o script):

```javascript
// No início do arquivo sync_produtos_omie_rapido.js

// Velocidade RÁPIDA (padrão)
const REGISTROS_POR_PAGINA = 100;
const DELAY_MS = 500;

// Velocidade SEGURA (se der muitos erros)
const REGISTROS_POR_PAGINA = 50;
const DELAY_MS = 1000;

// Velocidade TURBO (use com cuidado)
const REGISTROS_POR_PAGINA = 100;
const DELAY_MS = 200;
```

---

## 📅 Sincronização Automática (Opcional)

### Criar cron job para sincronização diária:

```bash
# Abrir crontab
crontab -e

# Adicionar linha (sincronização às 2h da manhã)
0 2 * * * cd /home/leandro/Projetos/intranet && node scripts/sync_produtos_omie_rapido.js >> /tmp/sync_produtos.log 2>&1
```

---

## ✅ Validação Pós-Sincronização

### 1. Verificar quantidade de produtos
```bash
node -e "const {dbQuery} = require('./src/db'); dbQuery('SELECT COUNT(*) as total FROM public.produtos_omie').then(r => console.log('✅ Total produtos:', r.rows[0].total))"
```

### 2. Verificar produtos recentes
```bash
node -e "const {dbQuery} = require('./src/db'); dbQuery('SELECT codigo, descricao, updated_at FROM public.produtos_omie ORDER BY updated_at DESC LIMIT 10').then(r => console.table(r.rows))"
```

### 3. Verificar produto específico
```bash
# Usar o script que já criamos
node scripts/check_produto.js
```

---

## 🎯 Recomendação

**Para atualizar agora:**
1. Use a **sincronização RÁPIDA** para atualizar tudo de uma vez
2. A partir de agora, o **webhook corrigido** manterá tudo atualizado automaticamente
3. Se necessário, rode a sincronização COMPLETA mensalmente para garantir

**Comando:**
```bash
cd /home/leandro/Projetos/intranet && node scripts/sync_produtos_omie_rapido.js
```

---

## 📚 Arquivos Criados

- ✅ `scripts/sync_produtos_omie_rapido.js` - Sincronização rápida
- ✅ `scripts/sync_produtos_omie_completo.js` - Sincronização completa
- ✅ `GUIA_SINCRONIZACAO_PRODUTOS.md` - Este guia
- ✅ `scripts/check_produto.js` - Verificar produto no banco
- ✅ `scripts/test_webhook_produtos.sh` - Testar webhook
