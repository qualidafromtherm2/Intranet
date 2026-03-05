Tema
Consolidação do fluxo de Compras com cadastro (carrinho, histórico unificado e integrações Omie).

Objetivo
Manter o processo consistente entre frontend, backend e Omie, garantindo:
- regras corretas para compra já realizada;
- histórico unificado sem status indevido;
- rastreabilidade entre requisições/pedidos e `compras.historico_compras`.

Contexto inicial
- Havia divergências entre UX e regra de negócio no modal de compras.
- O histórico unificado podia refletir `carrinho` indevidamente.
- Surgiu requisito de enviar `cNumPedido` com o ID de `compras.historico_compras` nas integrações Omie.

Decisões consolidadas
- Compra já realizada deve usar fluxo de compra direta na Omie (`IncluirPedCompra`).
- Quando compra já realizada estiver marcada, N nota fiscal é obrigatória.
- `objetivo_compra` não pode ficar vazio (fallback: “Compra via catálogo Omie”).
- `cObs`/observações enviadas para Omie devem refletir o objetivo salvo no banco.
- No histórico unificado, status `carrinho` não deve permanecer em `compras.historico_compras`.
- `cNumPedido` deve usar o `id` de `compras.historico_compras` **onde a API Omie aceita o campo**.

O que foi implementado

Backend (`server.js`)
- Fluxo “compra já realizada” reforçado para `IncluirPedCompra`.
- Validações para compra realizada/NFe e normalização de objetivo.
- Retorno de números da Omie para consumo do frontend.
- Sincronização do histórico unificado por `grupo_requisicao` via upsert em trigger.
- Filtro de legado para remover `carrinho` do histórico unificado.
- Inclusão de helper para resolver `id` de `compras.historico_compras` por:
  - `grupo_requisicao`,
  - `item id`,
  - `lista de ids`,
  - `numero_pedido`.

Integração Omie (`cNumPedido`)
- `IncluirPedCompra`: `cNumPedido` enviado com sucesso usando `id` de `compras.historico_compras`.
- `IncluirReq`: tentativa de envio de `cNumPedido` foi rejeitada pela Omie com erro de contrato:
  - `ERROR: Tag [CNUMPEDIDO] não faz parte da estrutura do tipo complexo [rcCadastro]!`
- Ajuste final aplicado: remover `cNumPedido` de `IncluirReq` para não quebrar o fluxo.

Frontend (`menu_produto.js` e `menu_produto.html`)
- Modal de cotação com máscara monetária pt-BR e totalização.
- Modal do carrinho com campos globais e comportamento condicional para compra realizada.
- Ocultação dinâmica de campos não aplicáveis quando compra já realizada está ativa.
- Bloco de orientação para NFe e setor de Compras.
- Mensagem final com números retornados da Omie.

Validações executadas nesta conversa
- Teste ponta a ponta no fluxo sem cadastro (`IncluirReq`):
  - após remover `cNumPedido`, fluxo voltou a funcionar com sucesso.
- Teste ponta a ponta no fluxo de compra direta (`IncluirPedCompra`):
  - Omie retornou `cNumPedido` igual ao `id` esperado de `compras.historico_compras`.
- Reinicializações e checagens operacionais com PM2 realizadas durante as mudanças de backend.

Pendências
- Se necessário, definir estratégia alternativa de rastreabilidade para `IncluirReq` (ex.: marcador em `obsIntReqCompra`), já que `cNumPedido` não é aceito nesse método pela Omie.
- Manter monitoramento E2E no uso real do carrinho para confirmar ausência de regressão no histórico.

Como retomar na próxima conversa
"Continuar no fluxo de Compras com cadastro validando rastreabilidade Omie por `historico_compras`: manter `cNumPedido` em `IncluirPedCompra`, preservar compatibilidade de `IncluirReq` sem `cNumPedido` e avaliar fallback de vínculo em observação interna, se necessário."
