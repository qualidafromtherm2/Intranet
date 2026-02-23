#!/bin/bash
# Script para testar o webhook corrigido
# Objetivo: Validar que o webhook agora reconhece corretamente event.cabecalho.nIdReceb

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  🧪 TESTE: Webhook de Recebimentos de NF-e (Corrigido)        ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# 1. Enviar webhook de teste para o endpoint local
echo "📤 Enviando webhook de teste com event.cabecalho.nIdReceb..."
echo ""

WEBHOOK_PAYLOAD='{
  "messageId": "test-3b21a8ef-bd0f-4144-9cc0-b221c2ed4bc5",
  "topic": "RecebimentoProduto.Incluido",
  "event": {
    "cabecalho": {
      "cCNPJ": "80.457.534/0001-80",
      "cCodCateg": "2.09.02",
      "cEtapa": "40",
      "cModelo": "55",
      "cNumeroNF": "663588",
      "cSerie": "2",
      "dDataEmissao": "23/02/2026",
      "dDataRegistro": "23/02/2026",
      "nCodCC": 10408201801,
      "nCodFor": 10651829899,
      "nIdReceb": 10826000242,
      "nValorNF": 4395.7
    },
    "frete": {
      "cTpFrete": "9",
      "nPesoLiq": 60
    }
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

# Enviar para localhost (desenvolvimento)
RESPONSE=$(curl -s -X POST http://localhost:5001/webhooks/omie/recebimentos-nfe \
  -H "Content-Type: application/json" \
  -d "$WEBHOOK_PAYLOAD")

echo "📨 Resposta do servidor:"
echo ""
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
echo ""

# 2. Verificar logs
echo "📋 Verificando logs do servidor..."
echo ""
echo "👉 Procurando por: '[webhooks/omie/recebimentos-nfe]'"
echo ""
pm2 logs intranet_api --lines 30 2>/dev/null | grep -A 2 "webhooks/omie/recebimentos-nfe" | head -20

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  ✅ TESTE COMPLETO                                             ║"
echo "║                                                                ║"
echo "║  Esperado na resposta:                                         ║"
echo "║  • ok: true                                                    ║"
echo "║  • n_id_receb: 10826000242                                     ║"
echo "║  • status: 'processing'                                        ║"
echo "║                                                                ║"
echo "║  Esperado nos logs:                                            ║"
echo "║  • Processando evento 'RecebimentoProduto.Incluido'            ║"
echo "║  • Consultando dados completos do recebimento...              ║"
echo "║  • ✓ Recebimento ... incluído com sucesso                      ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
