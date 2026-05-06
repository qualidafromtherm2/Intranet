# TROUBLESHOOTING.md

## Ambiente Ausente

Sintomas: falha de conexao com banco, erro em Omie/Supabase/OpenAI, login/sessao falhando.

Diagnostico:

```powershell
Get-Content .env.example
rg "NOME_DA_VARIAVEL" server.js routes src utils cron scripts
```

Solucao: configurar variaveis em arquivo local ou ambiente do provedor. Nao copiar valores para docs ou chat.

## Banco/Sessao

Sintomas: erro no store de sessao, rotas autenticadas retornando erro, pool PostgreSQL indisponivel.

Diagnostico:

```powershell
rg "connect-pg-simple|session|DATABASE_URL|POSTGRES_URL" server.js src routes
```

Verificar `DATABASE_URL`, `POSTGRES_URL`, `SESSION_SECRET` e tabela de sessao esperada.

## Omie

Sintomas: sincronizacao incompleta, falha em produtos, pedidos, NFe ou recebimentos.

Diagnostico:

```powershell
rg "OMIE_APP_KEY|OMIE_APP_SECRET|OMIE_WEBHOOK_TOKEN" server.js routes cron scripts utils
```

Verificar nomes de variaveis e limites de API. Nunca colar payloads com credenciais.

## Supabase/Uploads

Sintomas: anexos ou fotos nao sobem, links quebrados, erro de bucket.

Diagnostico:

```powershell
rg "SUPABASE_URL|SUPABASE_SERVICE_ROLE|SUPABASE_BUCKET" routes utils
```

Verificar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `SUPABASE_BUCKET` e `SUPABASE_BUCKET_SAC`.

## Arquivos Grandes

`server.js`, `routes/sacEnvios.js`, `routes/ai_assistant.js`, `menu_produto.js` e alguns HTMLs sao grandes. Usar `rg` e abrir por trechos para evitar custo alto de contexto.

## Segredos Hardcoded

Rodar:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-secrets.ps1
```

O script informa arquivo, linha aproximada e tipo provavel, sem valores. Se encontrar segredo em codigo, substituir por `process.env` ou mecanismo equivalente em tarefa separada.
