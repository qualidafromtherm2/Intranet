Tema
Correção do fluxo de histórico de compras no modal “Meu Carrinho de Compras” (Compras com cadastro).

Objetivo
Garantir consistência de status entre `compras.solicitacao_compras` e `compras.historico_compras`, evitando registrar status `carrinho` no histórico unificado.

Contexto inicial
- Foi reportado que, ao enviar solicitação pelo modal com retorno de cotação e sem compra realizada, a tabela `compras.solicitacao_compras` recebia status `aguardando aprovação da requisição`, mas `compras.historico_compras` ficava com `carrinho`.
- Investigação mostrou que o histórico unificado estava sendo alimentado com comportamento de inserção inicial por grupo e não refletia corretamente as atualizações posteriores de status.

O que foi decidido
- O histórico unificado deve refletir somente status válidos do fluxo de solicitação.
- Registros com status `carrinho` não devem ser gravados em `compras.historico_compras`.
- A sincronização do histórico deve acontecer em `INSERT` e `UPDATE`, com lógica de upsert por `grupo_requisicao`.

O que foi implementado
- Arquivo alterado: `server.js`.
- Ajuste da função `compras.fn_sync_historico_compras_upsert()` para:
  - ignorar gravação quando `status` for nulo ou `carrinho`;
  - atualizar/inserir histórico por `grupo_requisicao` apenas para status válidos.
- Ajuste de backfill para considerar somente `compras.solicitacao_compras` com status diferente de `carrinho`.
- Limpeza de legado no startup para remover registros `carrinho` de `compras.historico_compras`.
- Reinicialização e validação operacional realizadas com PM2.
- Verificação em banco confirmou triggers ativos e ausência final de registros `carrinho` no histórico unificado.

Pendências
- Validar novamente em cenário real de UI (E2E): criar item no carrinho → enviar solicitação → confirmar que `historico_compras` recebe status final correto.
- Monitorar próximos registros após uso normal para garantir que não haja regressão.
- Próximos passos:
  1) Executar teste manual com novo item de compra;
  2) Conferir status por `grupo_requisicao` em ambas as tabelas;
  3) Se necessário, adicionar consulta de auditoria rápida para suporte.

Como retomar na próxima conversa
Cole este texto para continuar:
"Continuar validação do fluxo de Compras com cadastro: revisar o envio do carrinho para solicitação e confirmar que `compras.historico_compras` nunca grava status `carrinho`, mantendo sincronia com `compras.solicitacao_compras` por `grupo_requisicao`."