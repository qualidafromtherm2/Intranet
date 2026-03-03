Tema
Kanban cotação (compras) — habilitação de edição no modal “Cotação”

Objetivo
Permitir editar uma cotação já registrada no modal do Kanban Cotação, corrigindo fornecedor, valor, moeda, links e itens vinculados, com persistência real na tabela SQL.

Contexto inicial
O fluxo já permitia criar e excluir cotações com itens vinculados por grupo, porém a edição ainda não estava concluída no frontend do modal e no backend faltava atualizar itens vinculados da cotação no banco.

O que foi decidido
- Reutilizar o endpoint existente `PUT /api/compras/cotacoes/:id` para suportar edição completa.
- No modal “Cotação”, usar modo de edição no mesmo formulário de cadastro (sem criar nova tela).
- Atualização deve afetar também `compras.cotacoes_itens`, não apenas os campos da tabela `compras.cotacoes`.
- Manter comportamento por `table_source` para compatibilidade com `solicitacao_compras` e `compras_sem_cadastro`.

O que foi implementado
- Backend (`server.js`):
  - `PUT /api/compras/cotacoes/:id` passou a aceitar `moeda` e `itens_cotacao`.
  - Atualização feita com transação (`BEGIN/COMMIT/ROLLBACK`) para consistência.
  - Ao editar itens: remove vínculos antigos em `compras.cotacoes_itens` e recria os novos vínculos.
  - Retorno final da API inclui cotação recarregada com `itens_cotacao` atualizados.
- Frontend (`menu_produto.js`):
  - Adicionado botão de editar em cada card de “Cotações Registradas”.
  - Formulário ganhou modo edição (indicador visual, botão “Salvar alterações” e “Cancelar edição”).
  - Ao entrar em edição, carrega fornecedor, valor, moeda, links e itens da cotação selecionada.
  - Ao salvar edição, envia `PUT` para `/api/compras/cotacoes/:id` e recarrega lista com dados atualizados.
- Operação/validação:
  - Sem erros de sintaxe nos arquivos alterados (`server.js` e `menu_produto.js`).
  - Rotina PM2 executada após mudança backend (`flush`, `restart`, `logs`).
  - Log confirmou requisição `PUT /api/compras/cotacoes/:id` com status 200.

Pendências
- Validar no navegador cenários reais de edição em grupos diferentes (incluindo troca de itens vinculados).
- Confirmar com usuário final se deseja incluir campo de observação também no mesmo formulário principal de edição.
- Ajustar eventual refinamento visual do estado “editando cotação” conforme preferência.

Como retomar na próxima conversa
Continuar no tema “Kanban cotação” validando no front a edição completa de cotações (fornecedor, valor, moeda, links e itens) e, se necessário, incluir a observação no formulário principal de edição para manter tudo no mesmo fluxo.