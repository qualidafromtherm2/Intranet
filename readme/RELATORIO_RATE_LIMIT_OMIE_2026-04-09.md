# Relatorio de Correcao de Rate Limit Omie

Data: 2026-04-09

## Objetivo

Reduzir os erros HTTP 429 e as falhas por consumo redundante na integracao com a Omie.

## Problemas encontrados

1. Havia chamadas com pagina acima do recomendado pela Omie.
   - Casos com `200` e `500` por pagina.
   - Havia um fluxo que tentava buscar `total_de_registros` em uma unica chamada.

2. Havia consultas repetidas ao mesmo metodo sem dedupe forte.
   - `ConsultarProduto` em webhook.
   - `ConsultarPedido` via telas.
   - `ListarProdutos` e `ListarProdutosResumido` via proxies usados pelo front.

3. Havia renovacao de imagens em lote com paralelismo agressivo no front.
   - Muitas chamadas seguidas para `ConsultarProduto` so para renovar URL de imagem expirada.

4. Parte das rotas aceitava `nRegPorPagina` vindo do cliente sem clamp central.

## Correcoes aplicadas

### 1. Politica central de paginacao segura

Arquivo:
- `utils/omiePolicy.js`

Foi criada uma politica central para limitar qualquer pagina da Omie a no maximo `100` registros.

Campos tratados:
- `registros_por_pagina`
- `nRegistrosPorPagina`
- `nRegPorPagina`

### 2. Hardening da funcao base de chamada Omie

Arquivo:
- `utils/omieCall.js`

Mudancas:
- aplica clamp automatico de pagina antes de enviar para a Omie;
- adiciona retry controlado para `429` e `425`;
- mantem retry para erro de consumo redundante;
- preserva logs mascarando `app_secret`.

### 3. Dedupe ampliado para respeitar a janela real da Omie

Arquivo:
- `utils/callOmieDedup.js`

Mudancas:
- janela de dedupe aumentada de `30s` para `60s`;
- mantida reutilizacao de chamada em andamento (`pending`);
- falhas repetidas do mesmo payload agora ficam em quarentena curta antes de nova tentativa;
- isso reduz repeticao do mesmo payload dentro da janela que a Omie considera redundante.

### 4. Clamp nas rotas de estoque

Arquivo:
- `routes/estoque.js`

Mudancas:
- `/pagina` agora sanitiza a paginacao recebida;
- `/posicao` agora limita `nRegPorPagina` antes de consultar a Omie.

### 5. Dedupe no fallback de produto e no webhook

Arquivo:
- `routes/produtos.js`

Mudancas:
- `consultarProdutoOmie()` deixou de chamar `fetch` bruto;
- agora usa `callOmieDedup`, reduzindo repeticao de `ConsultarProduto` em webhook e sincronizacao de produto.

### 6. Ajustes nos proxies mais usados pelo front

Arquivo:
- `server.js`

Mudancas principais:
- `/api/omie/produtos` passou a usar `callOmieDedup`;
- `/api/omie/pedido` passou a usar `callOmieDedup`;
- `/api/compras/parcelas` passou a usar `callOmieDedup`;
- `ListarLocaisEstoque` foi reduzido para `100` por pagina;
- sync de almoxarifado foi reduzido para `100` por pagina;
- `ListarCategorias` foi reduzido de `500` para `100`;
- `ListarEstruturas` foi reduzido de `200` para `100`;
- importadores com constantes `OP_REGS_PER_PAGE` e `PV_REGS_PER_PAGE` foram reduzidos para `100`;
- sync de recebimentos NF-e deixou de usar default efetivo de `500` por pagina e agora faz clamp para `100`.

### 7. Renovacao de imagem mais conservadora

Arquivos:
- `server.js`
- `menu_produto.js`

Mudancas:
- a fila de `imagem-fresca` foi serializada corretamente no backend;
- o backend passou a usar `callOmieDedup` ao renovar imagem;
- o front reduziu o lote de renovacao de imagens de `10` para `2`;
- o intervalo entre lotes subiu de `500ms` para `1500ms`.

Impacto esperado:
- menos rajadas simultaneas de `ConsultarProduto`;
- menor chance de 429 ao abrir catalogos com muitas imagens expiradas.

### 8. Kanban Preparacao sem buscar tudo em uma chamada

Arquivo:
- `kanban/kanban_preparacao.js`

Mudancas:
- o cache de tipo `03` deixou de usar `registros_por_pagina = total_de_registros`;
- agora busca em paginas de `100`;
- foi adicionado pequeno respiro entre paginas.

## Arquivos alterados neste pacote

- `server.js`
- `routes/produtos.js`
- `routes/estoque.js`
- `utils/omieCall.js`
- `utils/callOmieDedup.js`
- `utils/omiePolicy.js`
- `menu_produto.js`
- `kanban/kanban_preparacao.js`

## Efeito pratico esperado

1. Menos chamadas redundantes para o mesmo metodo e mesmo payload.
2. Menos bursts no front ao abrir catalogos e detalhes.
3. Respeito ao limite recomendado de `100` registros por pagina.
4. Menor risco de bloqueio temporario por consumo indevido.

## Observacoes

1. O repositorio ainda possui fluxos grandes de sincronizacao do tipo `Listar* + Consultar* por item`.
   - Isso nao foi removido neste pacote porque mudaria a regra funcional do sistema.
   - O que foi feito aqui foi reduzir agressividade e repeticao ao redor desses fluxos.

2. Scripts manuais fora do fluxo normal podem continuar consumindo Omie se forem executados em paralelo.
   - Exemplo: sincronizadores avulsos disparados manualmente.

3. Se o ambiente de producao estiver com mais de um agendador ativo para a mesma tabela, ainda pode haver sobreconsumo.
   - Vale revisar se existe duplicidade entre cron externo, cron interno e autosync.

## Validacao executada

Checks de sintaxe executados com sucesso:
- `node --check server.js`
- `node --check routes/produtos.js`
- `node --check routes/estoque.js`
- `node --check utils/omieCall.js`
- `node --check utils/callOmieDedup.js`
- `node --check menu_produto.js`
- `node --check kanban/kanban_preparacao.js`
