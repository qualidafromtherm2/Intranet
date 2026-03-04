Tema
Ajustes no Kanban de compras: modal “Cotado aguardando escolha” e integração com fluxo de “Análise de cadastro”.

Objetivo
Padronizar o modal de cotação/cotado, garantir regra de aprovação antes de envio, corrigir origem de dados para análise de cadastro via histórico e implementar envio fracionado por cotações aprovadas com novo grupo_requisicao sequencial.

Contexto inicial
O modal “Cotado aguardando escolha” estava com layout diferente do modal “Cotação”, sem exibição consistente de itens e total, além de fluxo de envio ainda ligado ao comportamento antigo (requisição Omie). Também houve erro de “Status inválido” e divergência na origem de dados de “Análise de cadastro” (apenas compras_sem_cadastro, quando o desejado era histórico). Durante os testes, foi identificado grupo com 2 itens (20260303-151707-061), mas o modal mostrava apenas 1.

O que foi decidido
- O card “Detalhes do Item” do modal “Cotado aguardando escolha” deve seguir o padrão visual/conceitual do modal “Cotação”.
- Em “Cotações Registradas”, exibir itens vinculados por cotação.
- Valor das cotações deve respeitar moeda dinâmica.
- “Total das cotações” deve somar apenas cotações aprovadas.
- IDs dos cards em kanban (Cotação, Cotado, Aprovação, Revisão, Análise de cadastro) devem usar ID do histórico.
- Botão “Enviar solicitação” no modal Cotado deve:
  - exigir ao menos 1 cotação aprovada;
  - mover apenas itens aprovados para “Analise de cadastro”;
  - fracionar grupo_requisicao com sufixo sequencial (.1, .2, ...), conforme cada conjunto aprovado;
  - não executar fluxo antigo de requisição Omie nesse passo.
- Modal “Análise de cadastro” deve aceitar dados vindos do histórico e listar itens do grupo completo.

O que foi implementado
- Frontend (`menu_produto.js`):
  - Ajuste do card “Detalhes do Item” para padrão do modal “Cotação”.
  - Inclusão/ajuste do bloco “Itens do Grupo” no modal Cotado.
  - Em “Cotações Registradas”, inclusão de “Itens da cotação”.
  - Formatação de valor por moeda dinâmica e total calculado somente por cotações aprovadas.
  - Exibição de ID histórico também em Cotado, Aprovação, Revisão e Análise de cadastro.
  - Ajuste do botão “Enviar solicitação” para novo endpoint de processamento fracionado.
  - Modal de “Análise de cadastro” passou a carregar itens pelo grupo (`/api/compras/grupo-itens`) e não apenas pela descrição do item clicado.
  - Botões de Omie no modal de Análise de cadastro foram mantidos visíveis; quando origem não é `compras_sem_cadastro`, ficam desabilitados com indicação.
  - Adicionado botão “Mover para Cotado” no modal de Análise de cadastro.

- Backend (`server.js`):
  - Criação do endpoint `POST /api/compras/cotado-escolha/enviar-solicitacao`:
    - valida existência de cotações aprovadas;
    - busca itens vinculados em `compras.cotacoes_itens`;
    - define novos grupos com sufixo sequencial baseado no grupo original;
    - atualiza apenas itens aprovados para status `Analise de cadastro` na tabela de origem.

- Operacional:
  - Validações de sintaxe com `node --check`.
  - Rotina PM2 executada após mudanças (`pm2 flush`, `pm2 restart intranet_api`, `pm2 logs intranet_api`).

Pendências
- Validar em cenário real de múltiplas cotações aprovadas se o fracionamento final atende 100% ao esperado de negócio (especialmente quando o mesmo item aparece em mais de uma cotação aprovada).
- Definir regra final para casos com itens do mesmo grupo em status diferentes (ex.: um já em análise e outro ainda cotado) e refletir isso nos cards.
- Opcional: exibir no frontend um resumo explícito do resultado do fracionamento (cotação -> novo grupo).

Como retomar na próxima conversa
“Continuar no tema Kanban cotado: validar e ajustar o fracionamento de grupo_requisicao no envio por cotações aprovadas (endpoint /api/compras/cotado-escolha/enviar-solicitacao), incluindo casos de sobreposição de itens entre cotações e refinamento da exibição no modal/kanban.”