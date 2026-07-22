# Pré-cadastro na Solicitação de compra (sem Análise de cadastro)

**Data:** 2026-07-21  
**Status:** aprovado pelo usuário (design)  
**Módulo:** Compras — modal Compras + Solicitação de compra + cadastro Omie

## Problema

Hoje, produto sem cadastro entra pela Solicitação de compra e depois passa pelo kanban **Análise de cadastro** para completar família/origem/unidade e gerar `CODPROV`. Isso atrasa o fluxo e duplica trabalho: o usuário já poderia informar esses dados na solicitação.

## Objetivo

1. Renomear **Meu Carrinho de Compras** → **Compras**.
2. Incluir botão **Produto sem cadastro** que abre a Solicitação de compra.
3. Mesclar nessa Solicitação os campos essenciais do cadastro Omie (foto 3).
4. Gravar **pré-cadastro completo** na solicitação, **sem** gerar os 5 dígitos finais do código.
5. Novos itens **não passam** por Análise de cadastro.
6. Gerar código definitivo + cadastrar na Omie **imediatamente antes** de criar a Requisição/Pedido Omie.

## Decisões fechadas

| Tema | Decisão |
|------|----------|
| Abordagem | A — pré-cadastro completo na solicitação |
| Momento do código definitivo | Antes da Requisição/Pedido Omie |
| Título do modal do carrinho | **Compras** |
| Entrada | Botão **Produto sem cadastro** no modal Compras |
| Análise de cadastro | Só para itens **legados** ainda pendentes; novos não entram |
| Identificador temporário | Sem `CODPROV - 00001`; mostrar **pré-cadastro** + descrição; prefixo família+origem apenas como preview |

## Fora de escopo (nesta entrega)

- Remover/apagar a coluna Análise de cadastro do kanban (apenas deixar de alimentar com itens novos)
- Cadastro em lote (foto 3) — nesta versão: **produto único** por item da lista
- Alterar o fluxo de produtos já cadastrados no catálogo Omie (carrinho normal)
- Redesign visual completo dos modais além do necessário para os novos campos

## Fluxo do usuário

```
Modal Compras
  → [Produto sem cadastro]
  → Solicitação de compra (campos compra + pré-cadastro)
  → Enviar
  → Grava solicitação + pré-cadastro (sem 5 dígitos)
  → Kanban (ex.: Aprovação) — NÃO vai para Análise de cadastro
  → … etapas até Requisições
  → Antes de criar requisição Omie: gera código definitivo + cadastra Omie
  → Segue Requisição / Pedido
```

## Campos do modal mesclado

### Mantém (Solicitação — foto 2)

- Modelo de compra  
- Departamento / Categoria  
- Objetivo da Compra / Observações  
- Adicionar itens e quantidades  
- Anexar arquivo / Link  
- Observação para recebimento  
- Responsável pela inspeção  
- Botão **Realizar solicitação de compra**

### Inclui (Cadastro Omie — foto 3)

| Campo | Obrigatório | Notas |
|-------|-------------|--------|
| Família | Sim | Usada no prefixo do código |
| Origem (Nacional / Importado) | Sim | Usada no prefixo do código |
| Descrição do produto | Sim | Pode alinhar com itens da lista |
| Unidade | Sim | |
| Tipo de item (Omie) | Sim | Default atual: `00 - Mercadoria para Revenda` |
| Foto | Não | Opcional |

### Não inclui nesta etapa

- Botão **Gerar código** que cria os 5 dígitos / `CODPROV`  
- Toggle **Cadastro em lote** (só produto único nesta entrega)

### Preview de código

Mostrar apenas o **prefixo** derivado de família + origem (ex.: `01.N.`), com texto:  
*“Código definitivo será gerado na hora da Requisição Omie.”*

## Dados e backend

### Persistência

Continuar usando `compras.compras_sem_cadastro` (e histórico associado), com campos novos via `ADD COLUMN IF NOT EXISTS`:

- `familia_codigo` / `familia_nome` (ou equivalente já existente, se houver)
- `origem` (`Nacional` | `Importado`)
- `unidade`
- `tipo_item_omie`
- `foto_url` (ou reutilizar anexo/foto já existente)
- `pre_cadastro_completo` (boolean) — marca itens do novo fluxo
- `codigo_prefixo` (texto opcional, só preview)
- `produto_codigo` — **não** preencher com `CODPROV - #####` neste fluxo; null/vazio até a geração definitiva

Ajustar `POST /api/compras/sem-cadastro` para:

- Aceitar e gravar os campos de pré-cadastro  
- **Não** chamar `obterBaseCodprovDisponivel` / não gerar `CODPROV` quando `pre_cadastro_completo = true`  
- Definir status inicial **sem** mandar para `Analise de cadastro` (ex.: Aprovação ou fluxo já usado quando diretor/retorno — mas nunca Análise para itens novos deste fluxo)

### Status / kanban

- Novos itens com pré-cadastro completo: **não** usam status `analise de cadastro` / `Analise de cadastro`  
- Coluna Análise de cadastro permanece só para registros antigos  
- Nas listagens do kanban, cards sem código definitivo exibem rótulo tipo **Pré-cadastro** + descrição

### Geração do código definitivo

Ponto único, imediatamente antes de criar requisição/pedido na Omie (mesmo gancho onde hoje se exige produto cadastrado):

1. Validar pré-cadastro completo (família, origem, descrição, unidade, tipo)  
2. Gerar sequencial de 5 dígitos + montar código definitivo (regra atual de família+origem+sequencial)  
3. `cadastrarProdutoNaOmie(...)`  
4. Atualizar `produto_codigo` / vínculo Omie no registro  
5. Prosseguir criação da requisição/pedido

Se falhar o cadastro Omie: **não** criar a requisição; retornar erro claro para o usuário.

## Front — arquivos

| Arquivo | Mudança |
|---------|---------|
| `menu_produto.html` | Título **Compras**; botão **Produto sem cadastro**; campos de pré-cadastro no modal de solicitação (foto 2) |
| `menu_produto.js` | Abrir solicitação a partir do botão; validar campos; payload com pré-cadastro; preview de prefixo; rótulo no kanban |
| `server.js` | Endpoint `sem-cadastro` sem CODPROV; colunas novas; geração de código + Omie antes da requisição |

## Critérios de aceite

1. Modal do carrinho exibe título **Compras**.  
2. Existe botão **Produto sem cadastro** que abre a Solicitação mesclada.  
3. Usuário consegue enviar solicitação com família, origem, descrição, unidade e tipo (foto opcional).  
4. Nenhum `CODPROV - #####` é gerado nesse envio.  
5. Item novo **não** aparece na coluna Análise de cadastro.  
6. Antes da Requisição Omie, o sistema gera o código definitivo, cadastra na Omie e só então cria a requisição.  
7. Itens antigos ainda em Análise de cadastro continuam funcionando como hoje.

## Riscos e mitigação

| Risco | Mitigação |
|-------|-----------|
| Omie exige código no momento da requisição | Gerar e cadastrar **antes** de chamar a API de requisição, na mesma operação |
| Colisão de sequencial | Reutilizar a mesma lógica de max+1 já usada em `CODPROV` / cadastro Omie |
| Solicitação incompleta (faltou unidade etc.) | Validação no front + rejeição 400 no backend |
| Mistura com fluxo catálogo (produto Omie) | Botão separado; fluxo do catálogo/carrinho normal inalterado |

## Referências de código

- Modal carrinho: `#modalCarrinhoCompras`, `abrirModalCarrinhoCompras`  
- Solicitação sem cadastro: `POST /api/compras/sem-cadastro`  
- Código provisório atual: `/api/compras/proximo-codigo-provisorio`, `CODPROV - #####`  
- Cadastro Omie: `cadastrarProdutoNaOmie`  
- Kanban Análise: status `analise de cadastro` / modal `abrirModalAnaliseCadastro`
