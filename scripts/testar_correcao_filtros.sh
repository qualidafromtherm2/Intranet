#!/bin/bash
# Script para testar a correção dos filtros da API Omie

echo "═══════════════════════════════════════════════════════════════"
echo "  TESTE DA CORREÇÃO - Sincronização de Pedidos de Compra"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}1. Limpando dados antigos das tabelas...${NC}"
PGPASSWORD='amLpOKjWzzDRhwcR1NF0eolJzzfCY0ho' psql \
  -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com \
  -p 5432 \
  -U intranet_db_yd0w_user \
  -d intranet_db_yd0w \
  -c "TRUNCATE compras.pedidos_omie_produtos, compras.pedidos_omie_frete, compras.pedidos_omie_parcelas, compras.pedidos_omie_departamentos, compras.pedidos_omie CASCADE;" 2>&1 | grep -E "(TRUNCATE|ERROR)"

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Tabelas limpas com sucesso${NC}\n"
else
  echo -e "${RED}✗ Erro ao limpar tabelas${NC}\n"
  exit 1
fi

echo -e "${YELLOW}2. Iniciando sincronização (SEM filtros - deve trazer TODAS as etapas)...${NC}"
echo "   Aguarde... isso pode levar vários minutos"
echo ""

curl -X POST http://localhost:5001/api/compras/pedidos-omie/sync \
  -H "Content-Type: application/json" \
  -d '{}' \
  2>/dev/null | python3 -m json.tool 2>/dev/null

echo ""
echo -e "${YELLOW}3. Aguardando 5 segundos...${NC}"
sleep 5

echo -e "${YELLOW}4. Verificando distribuição de pedidos por etapa...${NC}"
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
      WHEN codigo_etapa IN ('40', '60', '80') THEN '← DEVE APARECER!'
      ELSE ''
    END as status
FROM compras.v_pedidos_omie_completo 
GROUP BY codigo_etapa, etapa_descricao 
ORDER BY codigo_etapa;"

echo ""
echo -e "${YELLOW}5. Procurando pedido específico 2149 (aparece na foto como 'Aprovado')...${NC}"
echo ""

PGPASSWORD='amLpOKjWzzDRhwcR1NF0eolJzzfCY0ho' psql \
  -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com \
  -p 5432 \
  -U intranet_db_yd0w_user \
  -d intranet_db_yd0w \
  -c "SELECT n_cod_ped, c_numero, codigo_etapa, etapa_descricao 
FROM compras.v_pedidos_omie_completo 
WHERE c_numero = '2149';"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo -e "${GREEN}✓ Teste concluído!${NC}"
echo ""
echo "Se você ver pedidos nas etapas 40, 60 e 80, a correção funcionou!"
echo "═══════════════════════════════════════════════════════════════"
