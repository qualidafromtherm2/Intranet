#!/bin/bash

# Script para testar o webhook de produtos localmente

echo "======================================================================"
echo "TESTE DO WEBHOOK DE PRODUTOS - Correção de Timeout"
echo "======================================================================"
echo ""

# Configurações
WEBHOOK_URL="http://localhost:5001/api/produtos/webhook"
TOKEN="11e503358e3ae0bee91053faa1323629"

# Dados do webhook de exemplo (igual ao que a Omie enviou)
WEBHOOK_DATA='{
  "messageId": "test-manual-'$(date +%s)'",
  "topic": "Produto.Alterado",
  "event": {
    "altura": 0,
    "bloqueado": "N",
    "cest": "19.028.00",
    "cnpj_fabricante": "",
    "codigo": "09.MC.N.10622",
    "codigo_familia": 10510982035,
    "codigo_produto": 10437359849,
    "codigo_produto_integracao": "",
    "combustivel": {
      "codigo_anp": "         ",
      "descr_anp": ""
    },
    "cupom_fiscal": "N",
    "descr_detalhada": "",
    "descricao": "CANETA MARCADOR RETROPROJETOR PONTA 2.0MM PILOT PRETO",
    "dias_crossdocking": 0,
    "dias_garantia": 0,
    "ean": "",
    "estoque_minimo": 0,
    "exibir_descricao_nfe": "N",
    "exibir_descricao_pedido": "N",
    "id_cest": "19.028.00",
    "id_preco_tabelado": 0,
    "inativo": "N",
    "indicador_escala": "",
    "largura": 0,
    "marca": "",
    "market_place": "N",
    "modelo": "",
    "ncm": "9608.20.00",
    "obs_internas": " #40288318",
    "origem_mercadoria": "5",
    "peso_bruto": 0,
    "peso_liq": 0,
    "profundidade": 0,
    "quantidade_estoque": 0,
    "tipoItem": "07",
    "unidade": "UN",
    "valor_unitario": 0,
    "variacao": "N"
  },
  "author": {
    "email": "no-reply@omie.com.br",
    "name": "Integração",
    "userId": 89
  },
  "appKey": "3917057082939",
  "appHash": "fromtherm-5315dsja",
  "origin": "omie-connect-2.0"
}'

echo "1. Testando webhook..."
echo "   URL: $WEBHOOK_URL?token=$TOKEN"
echo ""

# Captura o início do tempo
START_TIME=$(date +%s%3N)

# Faz a requisição
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}\nTIME_TOTAL:%{time_total}" \
  -X POST "$WEBHOOK_URL?token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d "$WEBHOOK_DATA")

# Captura o fim do tempo
END_TIME=$(date +%s%3N)

# Extrai o status HTTP e o tempo
HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
TIME_TOTAL=$(echo "$RESPONSE" | grep "TIME_TOTAL:" | cut -d: -f2)
RESPONSE_BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS:/d' | sed '/TIME_TOTAL:/d')

# Calcula o tempo em milissegundos
DURATION=$((END_TIME - START_TIME))

echo "2. Resposta recebida:"
echo "   Status HTTP: $HTTP_STATUS"
echo "   Tempo de resposta: ${TIME_TOTAL}s (${DURATION}ms)"
echo "   Body:"
echo "$RESPONSE_BODY" | jq . 2>/dev/null || echo "$RESPONSE_BODY"
echo ""

# Verifica se foi bem sucedido
if [ "$HTTP_STATUS" = "200" ]; then
    echo "✓ Webhook respondeu com sucesso!"
    echo ""
    echo "3. Aguardando 5 segundos para o processamento em background..."
    sleep 5
    echo ""
    echo "4. Verificando produto no banco de dados..."
    node /home/leandro/Projetos/intranet/scripts/check_produto.js
    echo ""
    echo "5. Consultando logs recentes do PM2..."
    echo "   (últimas 20 linhas relacionadas ao webhook)"
    pm2 logs intranet_api --nostream --lines 20 | grep -i "webhook\|produto" || echo "   Nenhum log encontrado"
else
    echo "✗ Erro! Status HTTP: $HTTP_STATUS"
    echo "   Resposta: $RESPONSE_BODY"
fi

echo ""
echo "======================================================================"
echo "Teste concluído!"
echo "======================================================================"
echo ""
echo "Para monitorar os logs em tempo real, execute:"
echo "  pm2 logs intranet_api"
echo ""
