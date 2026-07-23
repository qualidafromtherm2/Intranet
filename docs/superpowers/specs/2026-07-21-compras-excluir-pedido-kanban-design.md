# Exclusão lógica de pedidos no Kanban de Compras (antes de Requisições)

**Data:** 2026-07-21
**Status:** aprovado pelo usuário (design)
**Módulo:** Compras — kanban de pedidos

## Problema

Nos cards das colunas **antes de Requisições** (ex.: Aprovação, Análise de cadastro), o usuário vê apenas `ID 345`, `ID 659`, etc. Não há forma de remover um pedido criado por engano. O pedido precisa sumir de **todos** os kanbans de compra, com registro de quem excluiu.

## Objetivo

Permitir excluir o pedido inteiro (todos os itens do card/grupo) nas etapas anteriores a Requisições, com exclusão lógica (status `excluído`), auditoria e controle de permissão.

## Decisões fechadas

| Tema | Decisão |
|------|----------|
| Tipo de exclusão | Lógica — status `excluído` (abordagem A) |
| Confirmação | **Não** — exclui ao clicar |
| Posição do botão | Cabeçalho do modal, à direita (opção B) |
| Escopo de colunas | Todas **antes de Requisições**: Aprovação, Revisão, Cotação, Cotado, Análise de cadastro |
| Escopo do dado | Exclui **todo o pedido** (todos os itens do mesmo card/grupo) |
| Auditoria | Gravar `excluido_por` + `excluido_em` |
| Permissão | Solicitante **ou** `auth_sector.id` ∈ {5, 9} **ou** role `admin` |

## Fora de escopo

- Exclusão em Requisições, Pedido de compra, Compra realizada, Faturada, Recebido, Concluído
- Exclusão física (DELETE) no banco
- Coluna/kanban “Excluídos” para listar pedidos excluídos
- Restaurar pedido excluído
- Integração Omie para cancelar requisição/pedido já gerado (essas etapas estão após Requisições)

## Comportamento na tela

### Onde aparece

- Modal aberto a partir dos cards com `ID …` nas colunas listadas acima.
- Modais envolvidos: `modalDetalhesPedidoCompras` (detalhes / aprovação etc.) e `modalAnaliseCadastro` (Análise de cadastro / Organizando requisição).
- Botão **Excluir** no **cabeçalho**, à direita (próximo ao X), vermelho, ícone de lixeira.
- Botão **visível só** se o usuário logado tiver permissão (regra abaixo). Sem permissão, o botão não aparece.

### Fluxo

1. Usuário abre o modal do card (ex.: ID 345).
2. Se tiver permissão, vê **Excluir** no cabeçalho.
3. Clica em **Excluir** (sem diálogo de confirmação).
4. Front chama a API de exclusão com os IDs / grupo do pedido e a origem da tabela (`solicitacao_compras` ou `compras_sem_cadastro`).
5. Em sucesso: fecha o modal, recarrega o kanban; o card some de todas as colunas de compra.
6. Em erro (sem permissão, pedido já avançou, etc.): mensagem clara na tela.

## Regras de negócio

### Quais itens são excluídos

- Todos os itens que pertencem ao **mesmo card** no kanban (mesmo agrupamento usado hoje: `grupo_requisicao` / IDs do `data-todos-ids` / equivalente).
- Abrange linhas em `compras.solicitacao_compras` e `compras.compras_sem_cadastro`, conforme `table_source` do card.
- Se o pedido já estiver em status de Requisições ou posterior, a API **recusa** a exclusão (403/409).

### Permissão (servidor é a fonte da verdade)

Pode excluir se **qualquer** condição for verdadeira:

1. Username/solicitante do pedido = usuário da sessão; **ou**
2. `sector_id` da sessão ∈ `{5, 9}` (`public.auth_sector.id`); **ou**
3. Roles do usuário incluem `admin` (`public.auth_user.roles`).

Front só esconde/mostra o botão; a API valida de novo.

### Efeito no banco

Para cada linha do pedido:

- `status` ← `'excluído'` (ou `'excluido'` — padronizar **um** valor e filtrar os dois na listagem por segurança, alinhado ao que já existe em outros pontos do `server.js`).
- `excluido_por` ← identificador do usuário (username da sessão).
- `excluido_em` ← `NOW()`.

Colunas novas via `ADD COLUMN IF NOT EXISTS` nas duas tabelas, no mesmo endpoint (padrão do projeto).

### Efeito no kanban

- `GET /api/compras/todas`, `GET /api/compras/minhas` e demais listagens usadas pelo kanban **excluem** registros com status `excluído` / `excluido`.
- Alguns filtros já ignoram esses status; completar onde ainda faltar para o kanban de compras.

## API

### Endpoint

`POST /api/compras/pedido/excluir` (ou `PATCH` equivalente no bloco de compras em `server.js`)

**Body (exemplo):**

```json
{
  "item_ids": [345, 346],
  "table_source": "solicitacao_compras",
  "grupo_requisicao": "opcional-se-agrupado"
}
```

**Respostas:**

- `200` — `{ success: true, excluidos: N, excluido_por, excluido_em }`
- `403` — sem permissão
- `404` — itens não encontrados
- `409` — status não permite exclusão (já em Requisições ou depois)
- `500` — erro interno

### Validação no handler

1. Sessão autenticada.
2. Carregar itens (por IDs e/ou grupo + `table_source`).
3. Checar permissão (solicitante / setor 5–9 / admin).
4. Checar status ∈ conjunto permitido (antes de Requisições).
5. `UPDATE` em transação: status + `excluido_por` + `excluido_em`.
6. Opcional: registrar em `compras.historico_solicitacao_compras` se o fluxo de histórico já capturar UPDATE via trigger; caso contrário, insert explícito de auditoria.

## Front — arquivos

| Arquivo | Mudança |
|---------|---------|
| `menu_produto.html` | Botão Excluir nos headers de `modalDetalhesPedidoCompras` e `modalAnaliseCadastro` (inicialmente oculto). |
| `menu_produto.js` | Mostrar/ocultar botão por permissão; handler de clique; chamada API; refresh do kanban. |

Permissão no front: reutilizar `window.__sessionUser` / roles já usados (`sector_id`, admin), mais comparação com `solicitante` do pedido carregado no modal.

## Critérios de aceite

1. Em Aprovação / Análise (e demais colunas antes de Requisições), ao abrir o modal, quem tem permissão vê **Excluir** no cabeçalho.
2. Quem não tem permissão **não** vê o botão; chamada direta à API retorna 403.
3. Após excluir, o card **não** aparece em nenhum kanban de compras.
4. No banco, itens ficam com status excluído e campos `excluido_por` / `excluido_em` preenchidos.
5. Pedidos em Requisições ou etapas posteriores **não** podem ser excluídos por este botão/API.
6. Excluir remove o **pedido inteiro** (todos os itens do grupo), não só uma linha.

## Riscos e mitigação

| Risco | Mitigação |
|-------|-----------|
| Status escrito como `excluido` vs `excluído` | Filtrar ambos nas queries; gravar um valor canônico (`excluído`). |
| Grupo com itens em tabelas diferentes | Resolver `table_source` por item; atualizar cada tabela corretamente. |
| Botão em modal errado (etapas Omie) | Só habilitar quando o status da coluna for pré-Requisições. |

## Referências de código existentes

- Cards `ID ${historico_id \|\| id}`: `menu_produto.js` (~65868–65874)
- Modais: `abrirModalDetalhesPedidoMinhas`, `abrirModalAnaliseCadastro`
- Filtros que já ignoram `excluido`/`excluído`: trechos em `server.js` (ex. produtos em compra / logística)
- Padrão de auditoria semelhante: `rh.atas_reuniao` (`excluido_por`, `excluido_em`)
- Soft delete por status em logística: `PATCH /api/logistica/sep/:n_solic/excluido`
