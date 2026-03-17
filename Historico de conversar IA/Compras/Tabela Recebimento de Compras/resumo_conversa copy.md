<!-- # Tema -->
Ajuste da página “Recebimento de Compras” para nova fonte de dados em `compras.pedidos_omie` com regra de filtro por `Etapa_NF`.

# Objetivo
Garantir que a página de recebimento liste apenas itens elegíveis de pedidos Omie, conforme regra operacional definida para `Etapa_NF` (vazio, 50 ou 60).

# Contexto inicial
- A tela de “Recebimento de Compras” estava sendo populada por `compras.solicitacao_compras` com filtro por `status = 'compra realizada'`.
- Havia necessidade de migrar a população para dados reais de pedidos Omie (`compras.pedidos_omie` e itens), mantendo a visualização atual da página.

# O que foi decidido
- Regra antiga → regra nova:
  - Antiga: carregar recebimentos a partir de solicitações com status “compra realizada”.
  - Nova: carregar recebimentos a partir de `compras.pedidos_omie` + `compras.pedidos_omie_produtos`.
- Aplicar filtro obrigatório de elegibilidade por `Etapa_NF`:
  - incluir quando `Etapa_NF` estiver vazia,
  - incluir quando `Etapa_NF = '50'`,
  - incluir quando `Etapa_NF = '60'`.
- Manter o payload compatível com o frontend atual para evitar refatoração adicional na tela.

# O que foi implementado
- Endpoint alterado:
  - `GET /api/compras/solicitacoes-recebimento`
- Arquivos alterados:
  - `routes/compras.js`
    - troca da origem da consulta para `compras.pedidos_omie` + `compras.pedidos_omie_produtos`.
    - filtro aplicado: `COALESCE(BTRIM(po."Etapa_NF"), '') = '' OR BTRIM(po."Etapa_NF") IN ('50', '60')`.
    - exclusão de pedidos inativos (`inativo = false`) e manutenção de aliases esperados pela UI.
  - `menu_produto.html`
    - mensagem de estado vazio atualizada para refletir a nova regra da tela.
- Operação pós-ajuste executada no backend:
  - `pm2 flush && pm2 restart intranet_api && pm2 logs intranet_api --lines 50 --nostream`

# Pendências
- Validar em cenário real se todos os registros esperados (Etapa_NF vazio/50/60) estão aparecendo corretamente na tela.
- Confirmar com o time se o campo `solicitante` vindo de `po.c_contato` atende 100% dos casos.
- (Opcional) Revisar critério de ordenação para priorizar por recência de criação além do número do pedido.

---

## Como retomar na próxima conversa
"Continuar a melhoria da tela de Recebimento de Compras, validando em dados reais o filtro de Etapa_NF (vazio/50/60), conferindo mapeamento de campos exibidos e, se necessário, ajustar ordenação para destacar pedidos mais recentes."