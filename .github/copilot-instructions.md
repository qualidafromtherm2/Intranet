# Intranet — instruções para agentes

## Visão geral
- Backend monolítico em Node/Express em `server.js` com muitas rotas inline e montagem de rotas em `routes/`.
- Banco principal é Postgres via `pg`; helpers em `src/db.js`. Alguns módulos criam `Pool` próprio (ex.: `routes/auth.js`), outros recebem `pool` injetado (ex.: `routes/compras.js`).
- Integração com Omie: chamadas HTTP em `utils/omieCall.js` e webhook/consulta de produtos em `routes/produtos.js`.
- Sincronização em tempo real usa SSE em /api/produtos/stream (ver `server.js`); o front acompanha progresso.

## Fluxos e integrações
- Credenciais e chaves ficam em variáveis de ambiente (ex.: `OMIE_APP_KEY`, `OMIE_APP_SECRET`, `OMIE_WEBHOOK_TOKEN`, `DATABASE_URL`).
- Sincronizações/migrações e scripts operacionais estão em `scripts/` (ex.: `scripts/sync_produtos_omie_rapido.js`, `scripts/sync_produtos_omie_completo.js`).
- Arquivos JSON locais usados por módulos específicos ficam em `data/` (modo local/legado).
- Sessões via `express-session` são configuradas antes das rotas em `server.js`; respeite essa ordem ao adicionar novas rotas.

## Workflows essenciais
- Desenvolvimento: `npm run dev` (nodemon) e produção local: `npm start` (ver `package.json`).
- PM2 é o processo padrão (ver `ecosystem.config.js`); o serviço principal é `intranet_api`.
- Validação de webhook de produtos: `VALIDACAO_WEBHOOK.md` e script `scripts/test_webhook_produtos.sh`.
- Guia de sincronização Omie: `GUIA_SINCRONIZACAO_PRODUTOS.md`.

## Padrões do projeto
- Preferir reutilizar `dbQuery`/`dbGetClient` de `src/db.js` quando possível; se criar `Pool` novo, padronize `ssl: { rejectUnauthorized: false }` (Render).
- Endpoints de produtos usam normalização de payload para o front (ex.: `tipoItem`, `codInt_familia`) — veja `routes/produtos.js`.
- Para novos módulos de API, manter a estrutura Express em `routes/` e montar no `server.js`.
- Existe um app separado em `Site_AT/` com README próprio e porta 3000 (ver `Site_AT/README.md`).

## Instruções para respostas
- Para cada atualização de código, inclua uma linha com **exemplo de comando** executado (ex.: `pm2 restart intranet_api`).
- Se a atualização envolver HTML, explique **apenas um trecho pequeno** da alteração em cada resposta, citando **em que parte da página** ele aparece.
- Quando houver alterações, traga a explicação em **lista separada por HTML, CSS e JavaScript** (quando aplicável).
- Só execute os comandos do PM2 quando a atualização realmente exigir (ex.: mudanças de backend). Se a mudança for apenas em HTML/CSS/JS de front, **não** execute PM2.

## Protocolo de colaboração multi-IA (obrigatório)
- Este repositório é editado por múltiplos colaboradores usando IA (Codex/Chat). Toda alteração deve priorizar **baixo conflito de merge**.
- Nunca fazer push direto em `main` quando houver fluxo de time; usar branch por tarefa e Pull Request.
- Antes de iniciar qualquer alteração: atualizar contexto com `git status`, `git pull` e confirmar branch correta.
- Evitar mudanças amplas fora do escopo solicitado; não fazer "faxina geral" sem pedido explícito.
- Não remover, renomear ou mover arquivos de outras áreas sem autorização explícita do usuário.

## Áreas de atuação por colaborador
- Colaborador Layout/UI: prioriza `public/`, `img/`, `menu_produto.css`, `menu_produto.html`, `menu_produto.js`.
- Colaborador Relatórios: prioriza rotas/consultas de relatório em `routes/` e blocos relacionados no `server.js`.
- Colaborador Compras/Kanban: prioriza `routes/compras*`, `kanban/`, `sql/` e blocos de compras no `server.js`.
- Se a solicitação cruzar áreas, a IA deve avisar risco de conflito e manter alteração mínima possível.

## Regras para alterar `server.js`
- `server.js` é arquivo de alto conflito: editar somente o bloco necessário.
- Evitar reordenação ampla, reformatação global e mudanças cosméticas no arquivo inteiro.
- Em caso de trechos potencialmente concorrentes, citar exatamente a seção alterada para facilitar merge.

## Segurança e versionamento
- Nunca commitar segredos: `.env`, tokens, senhas, URLs com credenciais, `config.server.js` com dados reais.
- Respeitar `.gitignore` e não versionar artefatos locais (`node_modules`, backups locais, logs, dumps).
- Ao detectar arquivo com nome acidental (comando colado, saída de terminal, etc.), confirmar com o usuário antes de remover em lote.

## Qualidade de entrega em time
- Entregar mudanças em commits pequenos e temáticos (ex.: `chore`, `docs`, `feat`, `fix`).
- Separar commit de infraestrutura/limpeza de commit funcional.
- Sempre informar comando de validação executado e impacto esperado.

## Protocolo obrigatório de commit ao final de cada tarefa (CRÍTICO)
Este projeto é editado exclusivamente via GitHub Copilot Chat. Por isso, toda modificação de código DEVE ser commitada imediatamente após ser aplicada — nunca deixar arquivos apenas no working directory.

### Regra de ouro: toda sessão de trabalho deve terminar com tudo commitado.

**Fluxo obrigatório ao final de cada conjunto de mudanças:**
1. Verificar arquivos modificados: `git status --short`
2. Validar sintaxe dos arquivos JS alterados: `node --check <arquivo>.js`
3. Fazer commit separado por tema (não misturar features diferentes no mesmo commit):
   - `git add <arquivos-da-feature> && git commit -m "feat/fix/chore(area): descrição"`
4. Se houver arquivos de múltiplas features ainda não commitados, commitar cada grupo separadamente.
5. Confirmar que `git status` está limpo (ou que os uncommitted são apenas arquivos já existentes não relacionados à tarefa).

**Antes de começar qualquer nova tarefa:**
- Executar `git status` para detectar arquivos modificados não commitados de sessões anteriores.
- Se houver arquivos modificados não relacionados à nova tarefa, commitá-los primeiro com mensagem adequada antes de prosseguir.
- Nunca sobrescrever arquivos com mudanças não commitadas sem alertar o usuário.

**Por que isso é crítico:**
- O Copilot Chat é o único agente que faz commits neste repositório.
- Se uma sessão terminar sem commit e a próxima sessão editar o mesmo arquivo, as mudanças da sessão anterior serão perdidas permanentemente (não há histórico fora do git).
- Isso já causou perda real de funcionalidades neste projeto (ex.: filtro CFOP 6.905 e spinner de Vendas perdidos em mai/2026).

**Exemplo de sequência correta ao final de uma sessão:**
```bash
git status --short
node --check routes/sacEnvios.js
git add routes/sacEnvios.js menu_produto.html menu_produto.js
git commit -m "feat(vendas): filtro CFOP 6905 e spinner no mapa"
```
