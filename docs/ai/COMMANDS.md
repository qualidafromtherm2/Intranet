# COMMANDS.md

## Raiz

Instalar:

```powershell
npm install
```

Desenvolvimento:

```powershell
npm run dev
```

Producao local:

```powershell
npm start
```

Sincronizacoes registradas no `package.json`:

```powershell
npm run sync:cfop
npm run chatbot:indexar-manuais
```

Checagem de segredos:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-secrets.ps1
```

## Testes, Build e Lint

- `npm test` existe, mas retorna erro intencional `no test specified`.
- Nao ha `npm run build` na raiz.
- Nao ha `npm run lint` na raiz.

## Site_AT

```powershell
cd Site_AT
npm install
npm run dev
npm start
```

## Diagnostico Rapido

```powershell
git status -sb
git diff --stat
rg "termo" .
rg --files -g package.json -g server.js -g "*.js"
node -v
npm -v
```

## Variaveis de Ambiente

Comandos que acessam banco e APIs externas dependem de variaveis como `DATABASE_URL`, `POSTGRES_URL`, `OMIE_APP_KEY`, `OMIE_APP_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `SESSION_SECRET`, `OPENAI_API_KEY` e tokens de integracoes. Consultar `.env.example` para nomes; nao registrar valores.
