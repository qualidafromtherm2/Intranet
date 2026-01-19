#!/bin/bash

# Teste direto na API da Omie para verificar o que ela retorna

echo "======================================================================"
echo "TESTE 1: Buscar TODOS os pedidos (todos os filtros = true)"
echo "======================================================================"

curl -X POST 'https://app.omie.com.br/api/v1/produtos/pedidocompra/' \
  -H 'Content-Type: application/json' \
  -d '{
    "call": "PesquisarPedCompra",
    "app_key": "4244634488206",
    "app_secret": "10d9dde2e4e3bac7e62a2cc01bfba01e",
    "param": [{
      "nPagina": 1,
      "nRegsPorPagina": 10,
      "lExibirPedidosPendentes": true,
      "lExibirPedidosFaturados": true,
      "lExibirPedidosRecebidos": true,
      "lExibirPedidosCancelados": true,
      "lExibirPedidosEncerrados": true
    }]
  }' | jq '{
    total: .nTotalRegistros,
    paginas: .nTotalPaginas,
    retornados: (.pedidos_pesquisa | length),
    etapas: [.pedidos_pesquisa[].cabecalho.cEtapa] | group_by(.) | map({etapa: .[0], count: length})
  }'

echo ""
echo ""
echo "======================================================================"
echo "TESTE 2: Buscar SEM FILTROS (nenhum parâmetro l*)"
echo "======================================================================"

curl -X POST 'https://app.omie.com.br/api/v1/produtos/pedidocompra/' \
  -H 'Content-Type: application/json' \
  -d '{
    "call": "PesquisarPedCompra",
    "app_key": "4244634488206",
    "app_secret": "10d9dde2e4e3bac7e62a2cc01bfba01e",
    "param": [{
      "nPagina": 1,
      "nRegsPorPagina": 10
    }]
  }' | jq '{
    total: .nTotalRegistros,
    paginas: .nTotalPaginas,
    retornados: (.pedidos_pesquisa | length),
    etapas: [.pedidos_pesquisa[].cabecalho.cEtapa] | group_by(.) | map({etapa: .[0], count: length})
  }'

echo ""
echo ""
echo "======================================================================"
echo "TESTE 3: Buscar apenas FATURADOS"
echo "======================================================================"

curl -X POST 'https://app.omie.com.br/api/v1/produtos/pedidocompra/' \
  -H 'Content-Type: application/json' \
  -d '{
    "call": "PesquisarPedCompra",
    "app_key": "4244634488206",
    "app_secret": "10d9dde2e4e3bac7e62a2cc01bfba01e",
    "param": [{
      "nPagina": 1,
      "nRegsPorPagina": 10,
      "lExibirPedidosPendentes": false,
      "lExibirPedidosFaturados": true,
      "lExibirPedidosRecebidos": false,
      "lExibirPedidosCancelados": false,
      "lExibirPedidosEncerrados": false
    }]
  }' | jq '{
    total: .nTotalRegistros,
    paginas: .nTotalPaginas,
    retornados: (.pedidos_pesquisa | length),
    exemplo_pedido: (.pedidos_pesquisa[0] | {numero: .cabecalho.cNumero, etapa: .cabecalho.cEtapa, status: .cabecalho.cDescStatus})
  }'

echo ""
echo ""
echo "======================================================================"
echo "TESTE 4: Procurar pedido específico 2149"
echo "======================================================================"

curl -X POST 'https://app.omie.com.br/api/v1/produtos/pedidocompra/' \
  -H 'Content-Type: application/json' \
  -d '{
    "call": "PesquisarPedCompra",
    "app_key": "4244634488206",
    "app_secret": "10d9dde2e4e3bac7e62a2cc01bfba01e",
    "param": [{
      "nPagina": 1,
      "nRegsPorPagina": 50,
      "lExibirPedidosPendentes": true,
      "lExibirPedidosFaturados": true,
      "lExibirPedidosRecebidos": true,
      "lExibirPedidosCancelados": true,
      "lExibirPedidosEncerrados": true
    }]
  }' | jq '.pedidos_pesquisa[] | select(.cabecalho.cNumero == "2149") | {numero: .cabecalho.cNumero, etapa: .cabecalho.cEtapa, status: .cabecalho.cDescStatus}'
