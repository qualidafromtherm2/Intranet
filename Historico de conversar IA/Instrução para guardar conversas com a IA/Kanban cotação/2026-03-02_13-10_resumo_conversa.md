# Tema
Kanban cotação (compras)

# Objetivo
Concluir a migração do fluxo de cotação para o modelo por grupo/histórico, habilitar seleção de múltiplos itens por cotação (drag-and-drop), persistir esses vínculos no banco e ajustar a identificação visual correta no card da coluna Cotação.

# Contexto inicial
O Kanban Cotação estava em transição para usar `compras.historico_compras` e `grupo_requisicao`, com necessidade de corrigir SQL de listagem, adaptar modal para contexto de grupo e permitir registrar cotações com mais de um item. Depois, surgiu ajuste visual: o card precisava mostrar o ID do histórico (e não o ID da compra).

# O que foi decidido
- A coluna “aguardando cotação” passa a ser alimentada por `compras.historico_compras`.
- O modal de cotação passa a operar por `grupo_requisicao` + `table_source`.
- Itens da cotação devem ser vinculados e persistidos em tabela dedicada (`compras.cotacoes_itens`).
- O valor unitário mantém campo único e a moeda alterna entre `R$` e `$` no botão do label.
- No card da coluna Cotação, o identificador exibido deve usar `historico_id` com prefixo `ID`.

# O que foi implementado
- Backend:
  - Ajustes em `GET /api/compras/todas` para consolidar Cotação via histórico e correções de tipo em `UNION`.
  - Criação de `GET /api/compras/grupo-itens` para carregar itens reais do grupo.
  - Extensão de `POST /api/compras/cotacoes` para receber `moeda` e `itens_cotacao`.
  - Extensão de `GET /api/compras/cotacoes/:solicitacao_id` para retornar `itens_cotacao` por cotação.
  - Criação de `compras.cotacoes_itens` e coluna `compras.cotacoes.moeda` (migration + ensure em runtime).
- Frontend (`menu_produto.js`):
  - Modal Cotação com drag-and-drop dos “Itens do Grupo” para “Itens nesta cotação”.
  - Seleção múltipla de itens e renderização dos itens vinculados em “Cotações Registradas”.
  - Toggle de filtro em “Itens do Grupo” (pendentes/todos).
  - Toggle de moeda (`R$`/`$`) no label de valor unitário.
  - Card da coluna Cotação exibindo `ID <historico_id>`.
- Operação/validação:
  - Migration aplicada no Render e validada.
  - Teste real de criação de cotação com 2 itens vinculado com sucesso.
  - Cotações de teste removidas após validação.
  - Rotina PM2 executada (`flush`, `restart`, `logs`) após alterações de backend.

# Pendências
- Validar visualmente no navegador o fluxo completo de arrastar/soltar em diferentes grupos reais.
- (Opcional) Ajustar a navegação entre cards no modal para sempre preservar contexto de grupo/origem em todos os caminhos.
- (Opcional) Padronizar o formato final do identificador exibido (`ID 123` vs `ID: 123`) conforme preferência final.

## Como retomar na próxima conversa
Continue o tema “Kanban cotação” a partir deste resumo, validando no front os cenários reais de drag-and-drop por grupo e, se necessário, finalize os ajustes de navegação do modal para manter `grupo_requisicao` + `table_source` em toda troca de item.
