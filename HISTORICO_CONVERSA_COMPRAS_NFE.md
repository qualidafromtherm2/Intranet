# Histórico da Conversa e Alterações (Compras/NFe/Kanban)

Este documento resume, em ordem cronológica, o que foi solicitado e o que foi alterado no projeto desde o início desta conversa.

Data de consolidação: 2026-02-26

## 1. Solicitação inicial: link de NF-e no `Vlr Total`
- Foi solicitado incluir um ícone/link ao lado de `Vlr Total` na lista de compras.
- Regra inicial definida:
`compras.pedidos_omie` -> obter `n_cod_for` -> buscar em `logistica.recebimentos_nfe_omie` por `n_id_fornecedor` + `n_valor_nfe` -> obter `c_numero_nfe` -> consultar Omie (`ConsultarNF`) -> obter `nIdNF` -> consultar Omie (`ObterNfe`) -> abrir `cPdf`.

## 2. Primeiro erro de rota (`bigint: "nfe-pdf-link"`)
- Erro recebido: `invalid input syntax for type bigint: "nfe-pdf-link"`.
- Causa tratada no backend: conflito/ordem de rotas e parsing de parâmetros.
- Resultado: rota específica de link passou a ser tratada corretamente sem cair em rota genérica de `:id`.

## 3. Mudança de fluxo para só mostrar ícone quando houver link válido
- Nova regra aplicada: não exibir link por padrão.
- Na geração da lista, verificar os itens e somente exibir o ícone quando o link estiver disponível.
- Regra adicional: só processar itens que tenham `Vlr Total` válido.

## 4. Ajuste de UX de popup (`about:blank`)
- Problema: abria aba em branco e o navegador bloqueava popup.
- Ajuste: evitar abertura prematura; abrir o PDF somente quando a URL final estiver pronta.

## 5. Erros 404 na API de link e validação da carga
- Durante testes surgiram chamadas 404 para `/api/compras/pedidos-omie/nfe-pdf-link`.
- Foram feitos ajustes de integração frontend/backend e restart do serviço para normalizar endpoints ativos.

## 6. Otimização de performance do fluxo
- Fluxo foi alterado para ficar mais rápido no carregamento:
não consultar Omie na montagem da lista.
- Estratégia:
identificar localmente o `c_numero_nfe` por fornecedor/valor.
- Consulta Omie passa a ocorrer só no clique do link.

## 7. Sincronização de status/etapa antes de gerar link
- Foi implementada lógica para sincronizar `c_etapa` e status de compras com base em recebimentos NFe.
- Erro posterior tratado:
`invalid input syntax for type bigint: ""` em atualização com valores vazios.
- Foram adicionadas validações/guards para evitar cast de string vazia para bigint.

## 8. Rearquitetura para persistir vínculo NFe direto no banco
- Decisão tomada:
parar de resolver tudo em tempo real na abertura da página.
- Implementado modelo persistente em SQL.
- Duas colunas passaram a ser usadas em `compras.pedidos_omie_produtos`:
`c_link_nfe_pdf` e `c_dados_adicionais_nfe`.
- Objetivo:
frontend só consome dados já vinculados e fica mais rápido.

## 9. Backfill + atualização contínua no banco
- Foi implementado processo para:
popular retroativamente e manter atualizado automaticamente.
- Lógica aplicada com função de aplicação de vínculo por recebimento e execução em lote (backfill).
- Também foram executadas consultas de validação de contagem e cobertura.

## 10. Regras de extração do pedido em `c_dados_adicionais`
- Evolução da regex/regra para interpretar variações:
`PEDIDOx 2025`, `PEDIDO n 2025`, `NPEDIDO 2025`, `PEDIDO N°2277`, `PEDIDO 2346`.
- Regra de segurança aplicada:
só usar `c_dados_adicionais` para desambiguar quando existir match por `n_id_fornecedor` + `n_valor_nfe`.
- Sem esse match-base, não usar `c_dados_adicionais` para gravar `c_link_nfe_pdf`.

## 11. Query de auditoria para casos sem vínculo
- Foi solicitada e preparada abordagem de auditoria para listar:
recebimentos que ainda não viraram link e o motivo (sem match fornecedor/valor, sem pedido no texto, etc.).

## 12. Nova coluna `Etapa_NF` em `compras.pedidos_omie`
- Implementado fluxo:
após vínculo de NF-e, atualizar `Etapa_NF` em `compras.pedidos_omie` usando `c_etapa` de `logistica.recebimentos_nfe_omie` via `n_cod_ped`.

## 13. Regras de exibição no Kanban com `Etapa_NF`
- Ajuste aplicado:
se `Etapa_NF` estiver preenchida, item sai dos kanbans `Pedido de compra` e `Compra realizada`.
- Mapeamento implementado:
`Etapa_NF = 40` -> `Faturada pelo fornecedor`
`Etapa_NF = 50 ou 60` -> `Recebido`
`Etapa_NF = 80` -> `Concluído`.

## 14. Correções de ausência de cards e agrupamentos
- Houve divergência entre dados no banco e cards exibidos.
- Foram ajustadas regras de filtro/agrupamento para considerar corretamente os pedidos por `c_numero`, `c_cod_int_ped`, `n_cod_ped` e origem de dados.
- Correção adicional:
eliminar comportamento que gerava itens sintéticos no modal (IDs `nf_..._recebido`) sem dados reais.

## 15. Correção de formatação de quantidade em modais
- Ajustado formato de quantidade para remover sufixo desnecessário (`1.0000` -> `1`) quando inteiro.
- Aplicado no fluxo de exibição dos modais de compras.

## 16. Correção de filtro `Minhas` vs `Todas`
- Problema reportado:
`Minhas` mostrava menos cards que `Todas` filtrando por solicitante.
- Causa:
filtro de `Pedido de compra` e `Compra realizada` estava cruzando por número de pedido em vez de solicitante.
- Ajuste aplicado no frontend:
filtro `Minhas` passou a priorizar `solicitante` (com fallback por referências antigas).
- Cobertura estendida para dados de `compras.compras_sem_cadastro`.

## 17. Correções específicas do modal `Cotado aguardando escolha`
- Foram feitas várias correções sequenciais:
busca robusta do item (cache, `/api/compras/minhas`, `/api/compras/todas`).
- Tratamento de `id_solicitante` como fallback de identificação.
- Renderização defensiva de cotações/anexos para evitar quebra por dados inconsistentes.
- Exibição de erro mais detalhada no modal para diagnóstico.
- Correções de escopo de helper de quantidade e remoção de duplicidade de declaração que derrubava o carregamento da página (`Identifier ... already been declared`).

## 18. Estado atual após último ajuste
- Página voltou a carregar após remoção de declaração duplicada.
- Modal `Cotado aguardando escolha` teve ajustes de robustez e de escopo.
- Serviço `intranet_api` foi reiniciado diversas vezes para aplicar alterações durante os testes.

## Arquivos e áreas mais impactados
- `menu_produto.js`
- `server.js`
- Banco de dados (rotinas/queries/tabelas de compras e logística), com foco em:
`compras.pedidos_omie`
`compras.pedidos_omie_produtos`
`compras.solicitacao_compras`
`compras.compras_sem_cadastro`
`logistica.recebimentos_nfe_omie`
`logistica.etapas_recebimento_nfe`.

## Observação final
- Como o fluxo evoluiu em etapas, houve mudanças de direção ao longo da conversa (tempo de resposta vs pré-processamento em SQL).
- O estado final ficou orientado a persistir vínculos e etapas no banco, reduzindo custo de processamento em tempo de tela e simplificando a renderização do frontend.
