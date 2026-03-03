Tema
Ajustes no fluxo de Compras com cadastro (carrinho, integração Omie e UX do modal)

Objetivo
Corrigir regras de negócio e experiência do usuário no fluxo de compras com cadastro, garantindo envio correto para Omie, validações de NFe, consistência de campos e feedback final com número de compra.

Contexto inicial
O fluxo apresentava inconsistências entre frontend e backend: triângulo de NFe não renderizava corretamente, compra já realizada seguia para operação Omie inadequada em alguns casos, faltava padronização de mensagens e havia necessidade de levar campos do modal de solicitação para o carrinho.

O que foi decidido
- Compra já realizada deve seguir o fluxo de compra direta na Omie (IncluirPedCompra), não IncluirReq.
- Quando compra já realizada estiver marcada, N nota fiscal é obrigatória.
- Objetivo da compra não pode ficar vazio; usar fallback Compra via catálogo Omie.
- Prefixar objetivo com NFe: quando aplicável ao cenário de compra já realizada.
- Mostrar números de compra da Omie no final do envio e também em bloco visual fixo no modal, com texto de orientação para NFe e setor de compras.
- cObs enviado para Omie deve refletir o mesmo valor de objetivo_compra salvo em compras.solicitacao_compras.
- Ao marcar compra já realizada, ocultar Compra já autorizada, Retorno Cotação e Prazo Solicitado.

O que foi implementado
- Backend (server.js):
  - Correção no endpoint de compras realizadas para incluir c_obs no SELECT e viabilizar regra do triângulo NFe.
  - Fluxo de envio da solicitação ajustado para branch explícito de compra_realizada em IncluirPedCompra.
  - Validações e normalizações para compra_realizada e n_nota_fiscal, com fallback de objetivo.
  - Retorno de números de compra Omie na resposta da API para exibição no frontend.
  - Alinhamento do cObs/obsReqCompra com objetivo_compra no envio para Omie.
- Frontend (menu_produto.js e menu_produto.html):
  - Modal cotação com máscara monetária padrão pt-BR, total das cotações e cabeçalho fixo.
  - Modal carrinho com novos campos globais: objetivo, anexo, anexo URL, retorno cotação, compra já realizada e N nota fiscal condicional.
  - Validação obrigatória de NFe quando compra já realizada estiver ativa.
  - Mensagem final de sucesso com números da Omie.
  - Bloco visual fixo no modal com orientação: informar cNumero na NFe e encaminhar ao setor de Compras.
  - Ocultação dinâmica de Compra já autorizada, Retorno Cotação e Prazo Solicitado quando compra já realizada está marcada.

Pendências
- Validar visualmente com usuário final se o texto, ordem e destaque do bloco fixo estão 100% idênticos ao fluxo de referência.
- Executar teste funcional ponta a ponta com diferentes combinações de NP e múltiplos itens para confirmar consistência dos números retornados da Omie.
- Revisar se todos os pontos de envio alternativos (não carrinho) também mantêm o mesmo padrão de cObs quando exigido pela regra de negócio.

Como retomar na próxima conversa
Continuar a validação do fluxo de Compras com cadastro: testar compra já realizada com NFe obrigatória, conferir ocultação de campos no modal, validar cObs igual a objetivo_compra no payload Omie e ajustar o texto final do bloco de orientação caso o usuário queira correspondência visual exata com o fluxo de referência.