# Tema
Associação manual de NF-e a Pedido de Compra na Omie com evolução do modal e do kanban “Faturada pelo fornecedor”.

# Objetivo
Manter um fluxo completo para: localizar/associar NF-e a pedido na Omie, controlar visibilidade dos recebimentos no kanban via campo `compras`, e enriquecer o modal com dados fiscais/comerciais para análise rápida.

# Contexto inicial
- Fase 1 (histórico original): havia necessidade de associar NF-e a pedido de compra na Omie, com UX simples e confirmação no modal.
- Fase 2 (evolução): o kanban “Faturada pelo fornecedor” passou a exigir triagem operacional (manter/remover itens), sem recarregar toda a tela.
- Fase 3 (evolução): o modal precisou de dados adicionais (categoria convertida, observações, CFOP geral e CFOP por item, possíveis pedidos por valor) e navegação entre registros.

# O que foi decidido
- Preservar o fluxo original de associação NF-e ↔ pedido na Omie (consultar/preview/associar).
- Criar o campo `compras` em `logistica.recebimentos_nfe_omie` com uso operacional no kanban:
  - `sim` = mantém no kanban,
  - `nao` = remove do kanban,
  - vazio/null = mantém para triagem.
- No modal “NFe dos pedidos”, exibir e persistir `Compras?` via listbox (sim/não).
- Atualizar somente a coluna “Faturada pelo fornecedor” após mudança de `compras` (sem recarregar todos os kanbans).
- Enriquecer o modal com:
  - categoria de compra convertida em `configuracoes."ListarCategorias"` (descrição e natureza),
  - `cObs` do recebimento,
  - CFOP geral por `cCFOPEntrada`,
  - CFOP do item por `itensCabec.cCFOP` + descrição local,
  - possíveis pedidos com mesmo valor da NF (`compras.pedidos_omie.n_valor`, com `Etapa_NF <> 80`).
- Adicionar controle “Próximo” no modal para avançar entre registros da coluna faturada.

# O que foi implementado
- Fluxo original mantido:
  - Frontend: botão/modal para associação NF-e ↔ pedido.
  - Backend: endpoints
    - `POST /api/compras/pedidos-omie/nfe-associar-pedido/consultar`
    - `POST /api/compras/pedidos-omie/nfe-associar-pedido/preview`
    - `POST /api/compras/pedidos-omie/nfe-associar-pedido`
- Evoluções de controle no kanban:
  - Migration: `scripts/20260306_add_coluna_compras_recebimentos_nfe_omie.sql`.
  - Endpoint novo: `PUT /api/compras/recebimentos-nfe/compras/:nIdReceb`.
  - Filtro no kanban faturada para remover itens com `compras = 'nao'`.
  - Atualização pontual da coluna faturada após salvar no modal.
  - Contorno dos cards na coluna faturada:
    - verde quando `compras = sim`,
    - vermelho quando vazio/null.
- Evoluções do modal de NF-e:
  - Campos adicionais: descrição/natureza da categoria, `cObs`.
  - CFOP geral com fallback de cabeçalho quando itens não informam `cCFOPEntrada`.
  - Tabela de itens com coluna “Descrição CFOP (item)” baseada em `cCFOP` do item.
  - Correção de prioridade de categoria para `infoAdicionais.cCategCompra`.
  - Lista “Possíveis compras (mesmo valor)” com `c_numero` da tabela `compras.pedidos_omie`.
  - Controle de navegação “Próximo” + indicador `x/y`.

# Pendências
- Validar em ambiente real se a lista de possíveis compras por valor precisa ordenação por recência.
- Decidir se será incluído botão “Anterior” no modal.
- Opcional: transformar números de “possíveis compras” em links para abrir detalhe do pedido.
- Opcional: fallback em tempo real na Omie quando CFOP do item não existir na base local de CFOP.

---

## Como retomar na próxima conversa
"Continuar a funcionalidade de associação NF-e ↔ pedido no módulo de Compras, preservando o histórico já consolidado. Validar em caso real a lista de possíveis compras por valor, decidir sobre botão Anterior no modal e avaliar links clicáveis dos pedidos sugeridos."

## Prompt de atualização (copiar e colar)
Atualize o arquivo `Historico de conversar IA/Compras/AssocoarNFe ao pedido/resumo_conversa.md` sem apagar o que já existe. Faça evolução cronológica (histórico antigo + novidades), mantendo lógica contínua.

Formato obrigatório:
Tema
Objetivo
Contexto inicial
O que foi decidido
O que foi implementado
Pendências

Regras:
1) Não sobrescrever contexto anterior; apenas consolidar e evoluir.
2) Registrar claramente regra antiga → regra nova quando houver mudança.
3) Listar endpoints/arquivos alterados de forma objetiva.
4) Em Pendências, manter só itens realmente abertos.