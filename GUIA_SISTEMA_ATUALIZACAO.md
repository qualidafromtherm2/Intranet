// GUIA: Sistema de Detecção de Atualização com Versão no Banco

## 📋 Pré-requisitos

1. Executar o script SQL: `sql/create_versao_sistema.sql`

```bash
PGPASSWORD='amLpOKjWzzDRhwcR1NF0eolJzzfCY0ho' \
psql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com \
  -U intranet_db_yd0w_user \
  intranet_db_yd0w \
  -f sql/create_versao_sistema.sql
```

## 🔄 Como Funciona

1. **Primeira carga da página:**
   - Cliente faz requisição ao `/api/check-version`
   - Servidor retorna versão do banco: `{ version: "1.0.0" }`
   - Cliente armazena em `window.__appVersion`
   - ✓ Ícone fica **ESCONDIDO** (sincronizado)

2. **Você faz push/atualização no GitHub/Render:**
   - Atualiza a versão no banco:
   ```sql
   SELECT * FROM configuracoes.atualizar_versao_sistema('1.0.1', 'Novo bug fix');
   ```

3. **Usuário acessando o site com cache antigo:**
   - Sistema detecta que versão do banco (1.0.1) ≠ versão do cliente (1.0.0)
   - ✨ Ícone aparece e começa a girar
   - Usuário clica → confirma → cache limpo → página recarrega
   - ✓ Ícone desaparece (agora sincronizado novamente)

## 📊 Tabela no Banco

```sql
-- Localização: schema "configuracoes", tabela "versao_sistema"

SELECT versao, descricao, data_atualizacao, atualizado_por 
FROM configuracoes.versao_sistema;

-- Resultado exemplo:
-- versao    | descricao                          | data_atualizacao        | atualizado_por
-- --------  | --------------------------------- | ----------------------- | -----------
-- 1.0.1     | Novo bug fix na sincronização    | 2026-02-19 10:30:00    | sistema
```

## 🚀 Como Atualizar a Versão

### Opção 1: Usar a função PL/pgSQL

```sql
-- Retorna: versao_anterior | versao_nova | data_atualizacao
SELECT * FROM configuracoes.atualizar_versao_sistema(
  '1.0.2',  -- nova versão
  'Correção de segurança',  -- descrição
  'github-actions'  -- quem atualizou (opcional)
);
```

### Opção 2: Update direto

```sql
UPDATE configuracoes.versao_sistema
SET 
  versao = '1.0.2',
  descricao = 'Correção de segurança',
  atualizado_por = 'github-actions',
  data_atualizacao = CURRENT_TIMESTAMP
WHERE id = 1;
```

## 🎯 Fluxo Completo

```
┌─────────────────────────────────────────────────────────────┐
│ 1️⃣  INÍCIO - Página carregada com v1.0.0                   │
│    - Cliente faz fetch a /api/check-version                │
│    - Servidor retorna v1.0.0 do banco                      │
│    - window.__appVersion = "1.0.0"                         │
│    - ✓ Ícone ESCONDIDO (sincronizado)                      │
└─────────────────────────────────────────────────────────────┘
                          ⬇️
┌─────────────────────────────────────────────────────────────┐
│ 2️⃣  VOCÊ FAZ PUSH - Atualiza versão no banco para v1.0.1   │
│    SQL: SELECT * FROM configuracoes.atualizar_versao_    │
│          sistema('1.0.1', 'Nova feature');                │
└─────────────────────────────────────────────────────────────┘
                          ⬇️
┌─────────────────────────────────────────────────────────────┐
│ 3️⃣  USUÁRIO ACESSANDO - Próxima verificação (a cada 5 min) │
│    - Cliente faz fetch a /api/check-version                │
│    - Servidor retorna v1.0.1 do banco                      │
│    - Compara: "1.0.1" (servidor) ≠ "1.0.0" (cliente)      │
│    - ✨ Ícone APARECE e GIRA                               │
│    - window.__updatePending = true                         │
└─────────────────────────────────────────────────────────────┘
                          ⬇️
┌─────────────────────────────────────────────────────────────┐
│ 4️⃣  USUÁRIO CLICA - Limpa cache                             │
│    - clearCacheAndReload() chamado                          │
│    - localStorage.clear()                                  │
│    - sessionStorage.clear()                                │
│    - IndexedDB.deleteDatabase()                            │
│    - Service Workers desregistrados                        │
│    - window.__appVersion = null (reset)                    │
│    - Página recarregada                                    │
└─────────────────────────────────────────────────────────────┘
                          ⬇️
┌─────────────────────────────────────────────────────────────┐
│ 5️⃣  APÓS RELOAD - Nova verificação                          │
│    - Cliente faz fetch a /api/check-version                │
│    - Servidor retorna v1.0.1 do banco                      │
│    - window.__appVersion = "1.0.1" (primeira vez)          │
│    - ✓ Ícone ESCONDIDO (sincronizado novamente)            │
│    - window.__updatePending = false                        │
└─────────────────────────────────────────────────────────────┘
```

## 🔍 Monitoramento

**Ver logs no console do navegador:**
```
[UPDATE-CHECK] Versão do servidor (BD): 1.0.1
[UPDATE-CHECK] Versão armazenada no cliente: 1.0.0
[UPDATE-CHECK] ⚠️ ATUALIZAÇÃO DISPONÍVEL!
[UPDATE-CHECK] ✓ Ícone de atualização exibido e animando
```

**Ver histórico de versões no banco:**
```sql
SELECT * FROM configuracoes.versao_sistema;
```

## ⏱️ Intervalos de Verificação

- **Primeira verificação:** Imediatamente ao carregar a página
- **Verificações periódicas:** A cada 5 minutos (ajustável em menu_produto.js, linha `const CHECK_INTERVAL = 5 * 60 * 1000`)

Para mudar para 10 minutos:
```javascript
const CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutos
```

## 🎨 Estilo do Ícone

- **Ícone:** Font Awesome `fa-rotate-right`
- **Cor quando ativo:** Laranja (`#ff9800`)
- **Animação:** Rotação contínua 2s (classe `.update-available`)

## 🛡️ Segurança

- ✓ Requisições usam `credentials: 'include'` (verifica autenticação)
- ✓ Caching desativado com `cache: 'no-store'`
- ✓ Versão é armazenada centralizadamente no banco
- ✓ Sem dependências de timestamp ou arquivo local
