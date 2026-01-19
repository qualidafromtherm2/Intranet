#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  MONITORANDO SINCRONIZAÇÃO - Aguarde até aparecer 'concluída'"
echo "═══════════════════════════════════════════════════════════════"
echo ""

while true; do
  # Pega as últimas 5 linhas dos logs
  LOGS=$(pm2 logs intranet_api --lines 5 --nostream 2>&1 | grep "PedidosCompra")
  
  # Verifica se tem progresso
  PROGRESSO=$(echo "$LOGS" | grep "Progresso:" | tail -1)
  PAGINA=$(echo "$LOGS" | grep "Página" | tail -1)
  CONCLUIDA=$(echo "$LOGS" | grep "concluída" | tail -1)
  
  clear
  echo "═══════════════════════════════════════════════════════════════"
  echo "  MONITORAMENTO DA SINCRONIZAÇÃO"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""
  
  if [ ! -z "$PAGINA" ]; then
    echo "📄 $PAGINA"
  fi
  
  if [ ! -z "$PROGRESSO" ]; then
    echo "📊 $PROGRESSO"
  fi
  
  if [ ! -z "$CONCLUIDA" ]; then
    echo ""
    echo "✅ $CONCLUIDA"
    echo ""
    break
  fi
  
  # Mostra distribuição atual
  echo ""
  echo "--- Distribuição atual por etapa ---"
  PGPASSWORD='amLpOKjWzzDRhwcR1NF0eolJzzfCY0ho' psql \
    -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com \
    -p 5432 \
    -U intranet_db_yd0w_user \
    -d intranet_db_yd0w \
    -t -A -c "SELECT codigo_etapa || ' - ' || etapa_descricao || ': ' || COUNT(*) FROM compras.v_pedidos_omie_completo GROUP BY codigo_etapa, etapa_descricao ORDER BY codigo_etapa;" 2>/dev/null
  
  echo ""
  echo "Próxima atualização em 10 segundos... (Ctrl+C para parar)"
  sleep 10
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  RESULTADO FINAL"
echo "═══════════════════════════════════════════════════════════════"
echo ""

PGPASSWORD='amLpOKjWzzDRhwcR1NF0eolJzzfCY0ho' psql \
  -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com \
  -p 5432 \
  -U intranet_db_yd0w_user \
  -d intranet_db_yd0w \
  -c "SELECT 
    codigo_etapa, 
    etapa_descricao, 
    COUNT(*) as total,
    CASE 
      WHEN codigo_etapa IN ('40', '60', '80') THEN '✅ SUCESSO!'
      ELSE ''
    END as status
FROM compras.v_pedidos_omie_completo 
GROUP BY codigo_etapa, etapa_descricao 
ORDER BY codigo_etapa;"

echo ""
echo "═══════════════════════════════════════════════════════════════"
