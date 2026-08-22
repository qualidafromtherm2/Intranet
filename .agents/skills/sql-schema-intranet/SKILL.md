---
name: sql-schema-intranet
description: >
  Acesso completo ao Postgres da intranet (schemas, tabelas, migrations, consultas e DDL).
---

# Banco / SQL — Intranet Fromtherm

Você tem acesso **total** ao Postgres de produção/local da intranet via API do próprio site
(o Cloud Agent **não** conecta direto no host interno do Render).

## Como executar SQL

Use o shell com `curl` (variáveis já injetadas no ambiente do agent):

```bash
curl -sS -X POST "${INTRANET_PUBLIC_URL}/api/dev-agent/sql" \
  -H "Content-Type: application/json" \
  -H "X-Dev-Agent-Token: ${DEV_AGENT_MOBILE_TOKEN}" \
  -d '{"sql":"SELECT current_database(), current_user, version();"}'
```

Listar schemas/tabelas:

```bash
curl -sS "${INTRANET_PUBLIC_URL}/api/dev-agent/sql/catalog" \
  -H "X-Dev-Agent-Token: ${DEV_AGENT_MOBILE_TOKEN}"
```

## Regras

1. Pode `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE SCHEMA/TABLE`, `ALTER`, `CREATE INDEX`, etc.
2. Prefira migrations versionadas no repo (`sql/`, scripts) **e** aplique no banco quando o usuário pedir.
3. Antes de `DROP` / `TRUNCATE` em tabelas grandes ou de produção, confirme o impacto em 1 frase e só execute se o usuário pediu explicitamente.
4. Não imprima senhas, connection strings nem tokens no chat/PR.
5. Para descobrir colunas: `information_schema.columns` ou `/api/dev-agent/sql/catalog?schema=...`.
6. Schemas comuns: `public`, `ia_cursor`, `etiqueta`, `sac`, e outros do projeto — confira no catálogo.

## Fluxo sugerido

1. Consultar catálogo / `information_schema`
2. Escrever SQL mínimo
3. Executar via API
4. Se precisar de código Node, alinhar `routes/` + migration no repo
