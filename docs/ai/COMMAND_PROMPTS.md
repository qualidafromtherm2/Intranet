# COMMAND_PROMPTS.md

## Corrigir Bug

Leia `AGENTS.md` e `docs/ai/`. Reproduza ou localize o fluxo com `rg` antes de abrir arquivos grandes. Edite o menor conjunto de arquivos, rode validacoes relevantes e nao exponha segredos.

## Revisar Alteracao Antes de Commit

Atue como revisor. Use `git diff --check`, `git diff --stat`, `git diff --cached --stat` e leia somente arquivos alterados. Liste achados por severidade com arquivo e linha. Nao fazer merge nem push.

## Diagnosticar Erro de API

Localize rota, handler, cliente externo e variaveis de ambiente. Leia logs somente se indispensavel e resuma sem payloads, tokens, cookies ou URLs privadas completas.

## Criar Nova Tela

Identifique primeiro o padrao de tela existente no modulo. Reuse assets, CSS e rotas atuais. Para arquivos grandes, buscar por ids/classes/funcoes antes de abrir trechos.

## Revisar Fluxo da Intranet

Mapeie entrada frontend, rota Express, query de banco, integracao externa e permissao/sessao. Nao copiar codigo inteiro para resposta.

## Revisar Integracao Externa

Verifique variaveis, cliente HTTP, retries, logs, tratamento de erro e limites. Nunca mostrar credenciais. Sugerir `process.env` quando houver valor hardcoded.

## Preparar PR

Verifique branch, base, status, diff staged, arquivos sensiveis e validacoes. Gere titulo, resumo, riscos e testes. Nao usar `git add .`.

## Atualizar AI_SESSION.md

Registre data, branch, objetivo, arquivos alterados, decisoes, pendencias, proximos passos e cuidados. Nao registrar valores sensiveis.
