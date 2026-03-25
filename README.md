# Intranet - Guia Rapido de Colaboracao

Objetivo: permitir que colaboradores trabalhem em paralelo com seguranca, sem sobrescrever trabalho dos outros.

## 1) Forma recomendada de entrada no projeto

Nao use copia manual da pasta para iniciar o trabalho diario.
Cada colaborador deve clonar do GitHub:

```bash
git clone git@github.com:qualidafromtherm2/Intranet.git
cd Intranet
npm install
```

Se voce ja enviou a pasta manualmente, ainda assim conecte ao Git e siga o fluxo de branch/PR descrito neste arquivo.

## 2) Preparacao local

1. Copie o arquivo de exemplo de variaveis:

```bash
cp .env.example .env
```

2. Preencha o `.env` com credenciais locais (nunca commitar credenciais reais).
3. Rodar em desenvolvimento:

```bash
npm run dev
```

## 3) Divisao de responsabilidade sugerida

Para reduzir conflito, cada colaborador atua em um conjunto principal de arquivos:

1. Layout/UI:
- `public/`
- `img/`
- `menu_produto.css`
- `menu_produto.html`
- `menu_produto.js`

2. Relatorios:
- `routes/`
- `server.js` (somente blocos de relatorio)
- `readme/` (documentacao de relatorios)

3. Compras/Kanban:
- `routes/compras*`
- `kanban/`
- `sql/`
- `server.js` (somente blocos de compras)

Se dois colaboradores precisarem mexer em `server.js`, combinar previamente os blocos para evitar conflito de merge.

## 4) Fluxo Git obrigatorio

1. Atualizar `main` antes de iniciar:

```bash
git checkout main
git pull origin main
```

2. Criar branch da tarefa:

```bash
git checkout -b tipo/area-descricao-curta
```

Exemplos:
- `feat/layout-menu-lateral`
- `feat/relatorios-filtro-data`
- `fix/compras-validacao-kanban`

3. Commits pequenos e objetivos.
4. Publicar branch:

```bash
git push -u origin nome-da-branch
```

5. Abrir Pull Request para `main`.
6. Nao fazer push direto em `main`.

## 5) Regras para evitar conflitos

1. Nunca versionar `node_modules/`.
2. Nunca versionar `.env`, `config.server.js`, dumps e arquivos de backup local.
3. Sempre fazer `git pull origin main` no inicio do dia.
4. Antes de abrir PR, atualizar branch com a `main` e resolver conflitos localmente.
5. Evitar commits gigantes misturando frontend, backend e limpeza de arquivos.

## 6) Checklist antes do push

1. `git status` sem arquivos inesperados.
2. Sem credenciais em texto aberto.
3. Mudanca testada localmente.
4. Commits com mensagem clara.

## 7) Comandos uteis

```bash
git status
git log --oneline -n 10
git fetch origin
git pull origin main
```
