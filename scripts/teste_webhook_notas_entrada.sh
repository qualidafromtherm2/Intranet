#!/bin/bash
# Script para testar webhook dedicado de Nota de Entrada

set -euo pipefail

API_URL="${1:-http://localhost:5001}"
TOKEN_QS=""
if [[ -n "${OMIE_WEBHOOK_TOKEN:-}" ]]; then
  TOKEN_QS="?token=${OMIE_WEBHOOK_TOKEN}"
fi

PAYLOAD='{
  "messageId": "test-nota-entrada-'"$(date +%s)'"",
  "topic": "NotaEntrada.Incluida",
  "event": {
    "cabecalho": {
      "nIdReceb": 10826000242,
      "cNumeroNF": "663588",
      "cSerie": "2",
      "dDataEmissao": "23/02/2026"
    }
  },
  "author": {
    "email": "no-reply@omie.com.br",
    "name": "Integracao",
    "userId": 89
  }
}'

echo "Enviando para: ${API_URL}/webhooks/omie/notas-entrada${TOKEN_QS}"
RESP=$(curl -sS -X POST "${API_URL}/webhooks/omie/notas-entrada${TOKEN_QS}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

echo "Resposta:"
echo "$RESP"
