#!/bin/bash
echo "Iniciando sincronização de pedidos..."
curl -X POST "http://localhost:5001/api/admin/sync/pedidos/simples" \
     -H "Content-Type: application/json" \
     -d '{"max_paginas": 10}' \
     --max-time 600 \
     --connect-timeout 30
echo "Sincronização finalizada"