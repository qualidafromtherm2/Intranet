# 🔍 INVESTIGAÇÃO - Por que pedidos Faturados/Recebidos/Conferidos não aparecem?

## Situação Atual

Após aplicar a correção dos filtros e sincronizar novamente:
- ✅ Sync completou com sucesso: 1.589 pedidos
- ❌ Apenas 3 etapas aparecem no banco: 10, 15, 20
- ❌ Etapas 40, 60, 80 continuam ausentes

## Distribuição Atual (após correção)

```
 codigo_etapa | etapa_descricao  | total 
--------------+------------------+-------
 10           | Pedido de Compra |     7
 15           | Aprovação        |  1577
 20           | Requisição       |     5
```

## Hipóteses

### Hipótese 1: Pedidos "Faturados" não são Pedidos de Compra na Omie ❌

**Possibilidade**: Na Omie, quando um pedido de compra é "Faturado pelo Fornecedor", ele pode:
1. Virar uma **Nota Fiscal de Entrada** (outro módulo/API)
2. Sair da API de Pedidos de Compra
3. Ir para o módulo de "Recebimento de Mercadorias"

**Evidência**: 
- A tela da Omie mostra "Compras, Estoque e Produção" no menu superior
- As colunas "Faturado pelo Fornecedor", "Recebido", "Conferido" podem ser OUTRA entidade

### Hipótese 2: API PesquisarPedCompra só retorna pedidos "ativos"  ✅ PROVÁVEL

**Possibilidade**: A API `PesquisarPedCompra` pode ter um comportamento onde:
- Pedidos ainda não faturados: etapas 10, 15, 20 (visíveis na API)
- Pedidos já faturados: etapas 40, 60, 80 (requerem outra chamada ou parâmetro)

**O que a documentação da Omie diz**:
- `lExibirPedidosPendentes`: Pedidos não faturados/recebidos
- `lExibirPedidosFaturados`: Pedidos com NF-e mas não recebidos
- `lExibirPedidosRecebidos`: Pedidos já recebidos fisicamente
- `lExibirPedidosCancelados`: Pedidos cancelados
- `lExibirPedidosEncerrados`: Pedidos concluídos/encerrados

**Possível interpretação da Omie**:
- **SEM filtros** = Apenas pendentes (padrão mais comum)
- **COM filtros explícitos** = Inclui os tipos solicitados

### Hipótese 3: Precisamos usar filtros parciais ✅ TESTAR

**Solução**: Tentar diferentes combinações:

```javascript
// Opção A: Apenas faturados
{ lExibirPedidosFaturados: true }

// Opção B: Apenas recebidos
{ lExibirPedidosRecebidos: true }

// Opção C: Apenas faturados + recebidos
{ 
  lExibirPedidosFaturados: true,
  lExibirPedidosRecebidos: true 
}

// Opção D: Recebidos parciais
{ 
  lExibirPedidosRecParciais: true,
  lExibirPedidosFatParciais: true
}
```

## Próximos Passos

### 1. Testar filtros específicos

Vou modificar o endpoint de teste para tentar diferentes combinações e ver qual retorna pedidos nas etapas 40, 60, 80.

### 2. Consultar documentação completa

Verificar se existe algum parâmetro adicional ou endpoint diferente para pedidos em estágios avançados.

### 3. Verificar se são Notas Fiscais

Os pedidos "Faturados" podem estar na API de **Notas Fiscais de Entrada** (`/nfconsultar/`), não na API de Pedidos de Compra.

### 4. Contatar suporte da Omie

Se necessário, abrir chamado técnico para entender o comportamento esperado da API.

## Código de Teste

Vou criar um endpoint que testa TODAS as combinações possíveis de filtros e mostra qual retorna pedidos em cada etapa:

```javascript
// Teste todas as combinações
const testes = [
  { nome: "Sem filtros", param: {} },
  { nome: "Apenas pendentes", param: { lExibirPedidosPendentes: true } },
  { nome: "Apenas faturados", param: { lExibirPedidosFaturados: true } },
  { nome: "Apenas recebidos", param: { lExibirPedidosRecebidos: true } },
  { nome: "Faturados + Recebidos", param: { 
    lExibirPedidosFaturados: true,
    lExibirPedidosRecebidos: true 
  }},
  { nome: "Todos = true", param: {
    lExibirPedidosPendentes: true,
    lExibirPedidosFaturados: true,
    lExibirPedidosRecebidos: true,
    lExibirPedidosCancelados: true,
    lExibirPedidosEncerrados: true
  }},
  { nome: "Parciais", param: {
    lExibirPedidosRecParciais: true,
    lExibirPedidosFatParciais: true
  }}
];
```

## Conclusão Temporária

A interface da Omie mostra pedidos em várias etapas, mas a **API não está retornando esses pedidos**. Isso sugere que:

1. Precisamos de filtros/parâmetros específicos que ainda não descobrimos
2. Pedidos "avançados" podem estar em outra API/endpoint
3. A conta/empresa pode ter configurações que limitam o acesso via API

Vou implementar testes sistemáticos para descobrir a configuração correta.
