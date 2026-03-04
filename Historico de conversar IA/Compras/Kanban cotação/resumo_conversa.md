Tema
Kanban cotação (compras) — moeda, conversão USD→BRL, total misto e ajuste de fluxo de status

Objetivo
Garantir exibição correta de valores em dólar com conversão para real, corrigir totalização quando houver moedas mistas (BRL + USD) e ajustar o botão “Enviar Cotações” do modal “Cotação” para manter status em `cotado`.

Contexto inicial
Após a edição de cotações estar funcionando, surgiram três problemas no Kanban Cotação:
- A conversão USD→BRL não aparecia por bloqueio de CORS no navegador.
- O “Total das cotações” somava valores mistos como se fossem de uma única moeda.
- O botão “Enviar Cotações” no modal “Cotação” resultava em avanço incorreto de etapa no grupo.

O que foi decidido
- Manter consulta de câmbio no frontend, mas sem credenciais/sessão para evitar CORS.
- Exibir valor convertido ao lado apenas para cotações em USD, preservando moeda original da cotação.
- Para totais com moedas mistas, exibir soma separada (`R$ + $`) e adicional convertido em BRL quando houver taxa disponível.
- No envio de cotações do modal “Cotação”, atualizar status para `cotado` em todos os itens do grupo (`table_source` respeitado), não só no item de referência.
- Aplicar a mesma lógica de valor/total nos dois modais: “Cotação” e “Cotado aguardando escolha”.

O que foi implementado
- Frontend (`menu_produto.js`):
  - Consulta USD→BRL implementada com cache curto e chamada externa sem credenciais (`credentials: 'omit'`) para contornar CORS.
  - Exibição de conversão `(≈ R$ ...)` adicionada ao lado de valores em USD nos cards de cotações.
  - Modal “Cotado aguardando escolha” também passou a exibir conversão nos cards de valor.
  - Totalização refeita com suporte a moeda mista por meio de helper dedicado:
    - apenas BRL: mostra total em BRL;
    - apenas USD: mostra total em USD + convertido em BRL;
    - BRL + USD: mostra `R$ X + $ Y` + total convertido aproximado em BRL.
  - Função `enviarCotacoesKanban()` alterada para atualizar status `cotado` em todos os IDs do grupo carregado no modal.
- Operação/validação:
  - Sem erros de sintaxe no arquivo alterado.
  - Rotina PM2 executada após cada ajuste relevante (`pm2 flush`, `pm2 restart intranet_api`, `pm2 logs intranet_api`).

Pendências
- Validar com dados reais cenários com múltiplas cotações mistas (mais de 1 USD e mais de 1 BRL) nos dois modais.
- Confirmar se o total misto deve continuar como `R$ + $` com aproximado em BRL (comportamento atual) ou se deve exibir também um total aproximado em USD.
- Revisar pontos antigos do projeto onde ainda há renderização fixa em `R$` fora desses dois modais.