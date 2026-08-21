# THM-077 — QA final

- HEAD/base verificado: `a52b9b9447b4abf35e9818504fc81338e6f200ce`
- Escopo: somente leitura; nenhum upload, escrita, estoque, Omie ou qualidade executado.

## Verificações automatizadas

- Vitest: 70 arquivos, 209 testes — todos passaram; execução com `--pool=forks --maxWorkers=1`.
- TypeScript + Vite build: passou; aviso não bloqueante de chunk JS >500 kB.
- Lint (`oxlint`): passou com warnings preexistentes de hooks/React (`set-state-in-effect`, dependências e componentes estáticos).
- `git diff --check`: passou sem apontamentos.

## Navegador

- Serviço já estava ativo em `http://127.0.0.1:4173` (porta 4173 ocupada; não foi iniciado um segundo processo).
- Login/shell carregado em 1366×768 e 390×844.
- Overflow: `scrollWidth == clientWidth` nos dois viewports (1366 e 390).
- Console: 0 erros e 0 warnings; apenas mensagem informativa padrão do React DevTools.
- Screenshots: `.playwright-cli/page-2026-08-21T12-04-05-608Z.png` (desktop) e `.playwright-cli/page-2026-08-21T12-04-14-197Z.png` (mobile).

## Módulos integrados

Códigos de Erro, Desenho Técnico, Produção 3D e smoke dos módulos integrados não puderam ser abertos porque a sessão/proxy não estava autenticada e não foram fornecidas credenciais. Nenhuma tentativa de login com dados inventados foi feita.

## Bloqueios, riscos e pendências

- Bloqueio: validar rotas internas e permissões reais requer sessão/proxy autenticado.
- Risco: warnings de lint devem ser tratados em follow-up; não impediram build/testes.
- Risco: chunk principal acima de 500 kB recomenda code-splitting futuro.
- Pendência: repetir smoke visual autenticado nos quatro viewports da checklist (incluindo 768×1024 e 1440×900) quando uma sessão de QA estiver disponível.
