---
applyTo: '**'
---
Guia operacional para agentes IA neste repositório (Codex/Chat):

1. Contexto de colaboração
- Este projeto é trabalhado por múltiplos colaboradores em cópias locais diferentes, com repositório único no GitHub.
- Priorizar mudanças pequenas e focadas para reduzir conflitos entre branches.

2. Fluxo obrigatório antes de editar
- Verificar `git status` e branch atual.
- Confirmar escopo da tarefa e evitar tocar áreas fora do pedido.
- Se houver risco de conflito (ex.: `server.js`), editar apenas trecho estritamente necessário.

3. Regras de convivência entre áreas
- Layout/UI: `menu_produto.*`, `public/`, `img/`.
- Relatórios: rotas/consultas em `routes/` e seções de relatório em `server.js`.
- Compras/Kanban: `routes/compras*`, `kanban/`, `sql/` e blocos relacionados em `server.js`.
- Ao cruzar áreas, informar risco de conflito e manter alteração mínima.

4. Segurança de dados
- Nunca versionar segredos, credenciais, tokens ou dumps sensíveis.
- Respeitar `.gitignore` e não recriar arquivos acidentais/local-only.

5. Commits e revisão
- Separar commits por tema: limpeza, docs, funcionalidade.
- Não misturar refatoração ampla com correção funcional.
- Relatar claramente o que foi alterado e por quê.

6. PM2
- Após alterações relevantes de backend, aplicar sequência operacional:
	- `pm2 flush`
	- `pm2 restart intranet_api`
	- `pm2 logs intranet_api`
- Para alterações apenas de front-end (HTML/CSS/JS sem backend), não executar PM2.