# Contribuindo com o projeto Intranet

## Regra principal

Toda alteracao deve acontecer em branch propria e entrar na `main` via Pull Request.

## Padrao de branch

Use o formato:

`tipo/area-descricao-curta`

Tipos recomendados:
- `feat`
- `fix`
- `chore`
- `docs`

Areas recomendadas:
- `layout`
- `relatorios`
- `compras`
- `kanban`
- `infra`

Exemplos:
- `feat/layout-cards-home`
- `fix/compras-filtro-etapa`
- `docs/guia-onboarding-time`

## Padrao de commit

Formato recomendado:

`tipo(area): descricao curta`

Exemplos:
- `feat(layout): adiciona novo bloco de cards`
- `fix(compras): corrige validacao de status no kanban`
- `chore(repo): remove arquivos acidentais`

## Boas praticas de PR

1. PR pequeno e focado em um objetivo.
2. Nao misturar limpeza de repositorio com feature.
3. Explicar impacto da alteracao no texto do PR.
4. Listar como validar a mudanca.

## Arquivos sensiveis

Nunca commitar:

1. `.env`
2. `config.server.js`
3. dumps de banco e backups locais
4. arquivos temporarios de editor/sistema

## Rebase/atualizacao

Antes de abrir PR:

```bash
git checkout main
git pull origin main
git checkout sua-branch
git merge main
```

## Revisao por area (sugestao)

1. Layout/UI: revisar por quem atua no frontend.
2. Relatorios: revisar por quem cuida de consultas/rotas.
3. Compras/Kanban: revisar por quem domina fluxo de compras.
