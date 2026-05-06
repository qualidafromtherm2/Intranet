# AGENTS.md

## Projeto

Intranet corporativa Fromtherm para gestao interna, compras, engenharia, qualidade, RH, estoque, SAC/AT, produtos, integracoes Omie e automacoes operacionais.

## Stack Real Detectada

- Node.js + Express em `server.js`.
- PostgreSQL via `pg`, `connect-pg-simple` e modulo `src/db.js`.
- Frontend majoritariamente estatico em HTML/CSS/JS servido por Express.
- Uploads/anexos com `multer`; armazenamento externo via Supabase.
- Sessao com `express-session`; senhas com `bcrypt`.
- Seguranca HTTP com `helmet` e rate limit em rotas de login.
- Integracoes: Omie, Supabase, GitHub, Google OAuth/Sheets/Calendar, OpenAI, TrackingMore/Wonca e WhatsApp/Meta.
- Subprojeto `Site_AT/`: Express ESM para busca de serie/etiqueta ZPL.

## Comandos Reais

Raiz:

```powershell
npm install
npm run dev
npm start
npm run sync:cfop
npm run chatbot:indexar-manuais
powershell -ExecutionPolicy Bypass -File scripts/check-secrets.ps1
```

`npm test` existe, mas atualmente retorna erro intencional (`no test specified`). Nao ha scripts reais de build ou lint na raiz.

`Site_AT/`:

```powershell
cd Site_AT
npm install
npm run dev
npm start
```

Comandos que acessam banco ou APIs dependem de variaveis locais como `DATABASE_URL`, `POSTGRES_URL`, `OMIE_APP_KEY`, `OMIE_APP_SECRET`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE`.

## Estrutura Principal

- `server.js`: entrada principal Express e muitas rotas inline.
- `routes/`: rotas modulares para auth, usuarios, compras, engenharia, produtos, RH, qualidade, SAC/AT, estoque e outros modulos.
- `src/db.js`: helper de acesso ao PostgreSQL.
- `utils/`: clientes/utilitarios para Omie, Supabase, auditoria, CSV e retry.
- `cron/`, `workers/`, `scripts/`: sincronizacoes, automacoes, manutencao e migracoes.
- `public/`, `login/`, `kanban/`, `produtos/`, `mensagens/`, `legal/`, `img/`: assets e telas estaticas.
- `sql/`: scripts SQL historicos; abrir apenas com necessidade explicita.
- `Site_AT/`: app separado de assistencia tecnica/etiquetas.

## Git e Branches

- Nunca alterar diretamente `main`, `master` ou `production`.
- Criar branch especifica antes de editar em branch protegida.
- Nao fazer merge nem push sem pedido explicito.
- Nao usar `git reset --hard`, `git clean` ou apagar arquivos locais.
- Nao usar `git add .`; adicionar somente arquivos permitidos.
- Ao final, informar branch, arquivos alterados, validacoes e sugestao de commit/PR.

## Economia de Contexto

- Ler primeiro `AGENTS.md` e `docs/ai/`.
- Buscar com `rg` por arquivo, rota, simbolo, variavel ou trecho antes de abrir arquivos grandes.
- `server.js`, `routes/sacEnvios.js`, `routes/ai_assistant.js` e arquivos HTML/JS grandes devem ser lidos por trechos.
- Ignorar backups, logs, dumps, bancos locais, imagens grandes e pastas privadas salvo pedido explicito.

## Credenciais

- Credenciais reais ficam em `.env`, `.env.local`, `.env.production`, `config.server.js` ou ambiente do provedor, nunca em docs.
- Agentes podem ler/editar arquivo local de ambiente quando necessario, mas nunca devem copiar valores para chat, README, docs ou codigo.
- Ao mencionar credenciais, citar somente nomes como `DATABASE_URL`, `OMIE_APP_KEY`, `OMIE_APP_SECRET`, `SESSION_SECRET`.
- `.env.example` deve conter nomes de variaveis e comentarios curtos, sem valores reais.
- Rodar `scripts/check-secrets.ps1` antes de commit quando mexer em config, docs, scripts ou integracoes.

## Arquivos a Ignorar

Ignorar salvo necessidade explicita: `.git/`, `node_modules/`, `.vs/`, `.playwright-mcp/`, `_local_private/`, `.env*`, `config.server.js`, `cookies.txt`, logs, backups, dumps, arquivos `.sql`, `.tar.gz`, `.db`, `.db-shm`, `.db-wal`, `.xlsx` e imagens grandes.

## Resposta Final Padrao

Responder com:

1. Branch usada ou criada.
2. Arquivos criados/alterados.
3. Resumo curto.
4. Alertas importantes sem segredos.
5. Validacoes executadas.
6. Commit/push/PR ou proximo passo recomendado.
