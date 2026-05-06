# PROJECT_MAP.md

## Raiz

Clone limpo usado: `C:\Users\Jair\Desktop\Intranet-github-clean`.

## Pastas Principais

- `server.js`: servidor Express principal, configuracao de sessao, middlewares, rotas inline e montagem de rotas modulares.
- `routes/`: endpoints por dominio. Destaques: `auth.js`, `users.js`, `compras.js`, `engenharia.js`, `produtos.js`, `sacEnvios.js`, `rhCargos.js`, `pcp_estrutura.js`, `ai_assistant.js`.
- `src/db.js`: acesso compartilhado ao PostgreSQL.
- `utils/`: utilitarios para Omie, Supabase, auditoria, CSV e retry.
- `cron/`: sincronizacoes agendadas, incluindo recebimentos NFe e agendamentos.
- `workers/`: processos auxiliares, incluindo impressao e agendamento.
- `scripts/`: manutencao, importacoes, sincronizacoes e migracoes. Contem SQL; abrir somente quando necessario.
- `backend/`: scripts de aplicacao de schema/migracao.
- `public/`, `login/`, `kanban/`, `produtos/`, `mensagens/`, `legal/`, `img/`: telas e assets estaticos.
- `uploads/`: arquivos enviados/cache local; tratar como dado operacional.
- `Site_AT/`: subaplicacao Express ESM para assistencia tecnica/etiquetas ZPL.

## Arquivos-Chave

- `package.json`: scripts e dependencias da intranet principal.
- `Site_AT/package.json`: scripts e dependencias do subprojeto AT.
- `.env.example` e `Site_AT/.env.example`: nomes de variaveis, sem valores reais.
- `config.server.example.js`: exemplo de config usando `process.env`.
- `render.yaml`, `ecosystem.config.js`: deploy/process manager.
- `.gitattributes`: normalizacao de texto.
- `scripts/check-secrets.ps1`: checagem local de segredos.

## Cuidados

- `server.js`, `routes/sacEnvios.js` e `routes/ai_assistant.js` sao grandes; usar `rg` e abrir trechos.
- Nao copiar codigo inteiro para docs ou respostas.
- Nao abrir logs, dumps, backups ou ambientes locais sem necessidade explicita.
