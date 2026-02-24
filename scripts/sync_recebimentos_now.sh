#!/bin/bash
# Script para sincronizar todos os recebimentos de NF-e da Omie
# Respeita o limite de 3 requisições por segundo

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  🔄 SINCRONIZAÇÃO: Recebimentos de NF-e da Omie               ║"
echo "║     Limite: 3 requisições/segundo (350ms entre cada)          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Verificar se servidor está rodando
echo "📡 Verificando servidor..."
if ! pm2 list | grep -q "intranet_api.*online"; then
  echo "❌ Servidor não está online!"
  echo "   Execute: pm2 restart intranet_api"
  exit 1
fi
echo "✓ Servidor online"
echo ""

# Iniciar sincronização em background
echo "🚀 Iniciando sincronização em background..."
echo ""

curl -X POST http://localhost:5001/api/admin/sync/recebimentos-nfe \
  -H "Content-Type: application/json" \
  -d '{}' &

CURL_PID=$!

echo "   PID do curl: $CURL_PID"
echo ""

# Aguardar 2 segundos para sincronização iniciar
sleep 2

echo "📋 Monitorando logs (Ctrl+C para sair)..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Mostrar logs em tempo real
pm2 logs intranet_api --lines 0 --nostream | grep -E "RecebimentosNFe|recebimentos-nfe" &
LOG_PID=$!

# Aguardar curl finalizar ou timeout de 5 minutos
timeout 300 tail --pid=$CURL_PID -f /dev/null 2>/dev/null

# Matar logs
kill $LOG_PID 2>/dev/null

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✓ Sincronização concluída!"
echo ""
echo "📊 Para verificar resultados:"
echo "   SELECT COUNT(*), COUNT(c_chave_nfe) FROM logistica.recebimentos_nfe_omie;"
echo ""
