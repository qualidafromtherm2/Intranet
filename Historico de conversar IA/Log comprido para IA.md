1|intranet_api  | [Compras] Schema e tabela garantidos com migrações aplicadas
1|intranet_api  | [SheetsAuto] Sincronização concluída (evento-db:solicitacao_compras:UPDATE) com 108 linha(s) em KANBAN e 38 linha(s) em historico.
1|intranet_api  | [FICHA][DIAG-RAW] total rawRows: 103
1|intranet_api  | [FICHA][DIAG-RAW] rawRows[0]: ["Nível","Identificação do Produto","Descrição do Produto","Quantidade","Unidade de Medida","Ficha Técnica","Total Cúbico"]
1|intranet_api  | [FICHA][DIAG-RAW] rawRows[1]: ["1","FTI185LPTBR","BOMBA DE CALOR FTi-185L40 BR TRIFASICA 380V WIFI - INVERTER - PRETA","1.00000","UN","00000387","0.00000"]
1|intranet_api  | [FICHA][DIAG-RAW] rawRows[2]: ["1.1","07.MP.N.70005","ABRACADEIRA DE NYLON PRETA 4,8X280MM","2.00000","UN","","0.00000"]
1|intranet_api  | [FICHA][DIAG] totalRows: 102 | primeiros níveis: "1", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9" | primeiros códigos: "FTI185LPTBR", "07.MP.N.70005", "07.MP.N.90511", "07.MP.N.62003", "07.MP.N.90515", "07.MP.N.90516", "07.MP.N.92001", "07.MP.N.90507", "07.MP.N.62004", "07.MP.N.70005"
1|intranet_api  | [FICHA][DIAG2] mainItems.length: 38 | subMontagens keys: 5 | exemplo mainItem[0]: {"comp_codigo":"07.MP.N.70005","comp_descricao":"ABRACADEIRA DE NYLON PRETA 4,8X280MM","comp_qtd":2,"comp_unid":"UN","comp_operacao":null,"ficha":""}
1|intranet_api  | [FICHA][DIAG-RAW] total rawRows: 103
1|intranet_api  | [FICHA][DIAG-RAW] rawRows[0]: ["Nível","Identificação do Produto","Descrição do Produto","Quantidade","Unidade de Medida","Ficha Técnica","Total Cúbico"]
1|intranet_api  | [FICHA][DIAG-RAW] rawRows[1]: ["1","FTI185LPTBR","BOMBA DE CALOR FTi-185L40 BR TRIFASICA 380V WIFI - INVERTER - PRETA","1.00000","UN","00000387","0.00000"]
1|intranet_api  | [FICHA][DIAG-RAW] rawRows[2]: ["1.1","07.MP.N.70005","ABRACADEIRA DE NYLON PRETA 4,8X280MM","2.00000","UN","","0.00000"]
1|intranet_api  | [FICHA][DIAG] totalRows: 102 | primeiros níveis: "1", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9" | primeiros códigos: "FTI185LPTBR", "07.MP.N.70005", "07.MP.N.90511", "07.MP.N.62003", "07.MP.N.90515", "07.MP.N.90516", "07.MP.N.92001", "07.MP.N.90507", "07.MP.N.62004", "07.MP.N.70005"
1|intranet_api  | [FICHA][DIAG2] mainItems.length: 38 | subMontagens keys: 5 | exemplo mainItem[0]: {"comp_codigo":"07.MP.N.70005","comp_descricao":"ABRACADEIRA DE NYLON PRETA 4,8X280MM","comp_qtd":2,"comp_unid":"UN","comp_operacao":null,"ficha":""}
1|intranet_api  | [VERSION-CHECK] Versão atual do sistema: 1.0.4
1|intranet_api  | [FICHA][DIAG-RAW] total rawRows: 1048576
1|intranet_api  | [FICHA][DIAG-RAW] rawRows[0]: ["Nível","Identificação do Produto","Descrição do Produto","Quantidade","Unidade de Medida","Ficha Técnica","Total Cúbico"]
1|intranet_api  | [FICHA][DIAG-RAW] rawRows[1]: ["1","FTI185LPTBR","BOMBA DE CALOR FTi-185L40 BR TRIFASICA 380V WIFI - INVERTER - PRETA","1.00000","UN","00000387","0.00000"]
1|intranet_api  | [FICHA][DIAG-RAW] rawRows[2]: ["1.1","07.MP.N.70005","ABRACADEIRA DE NYLON PRETA 4,8X280MM","7.00000","UN","","0.00000"]
1|intranet_api  | [FICHA][DIAG] totalRows: 100 | primeiros níveis: "1", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.11" | primeiros códigos: "FTI185LPTBR", "07.MP.N.70005", "07.MP.N.90511", "07.MP.N.62003", "07.MP.N.90515", "07.MP.N.90516", "07.MP.N.92001", "07.MP.N.90507", "07.MP.N.62004", "07.MP.N.90517"
1|intranet_api  | [FICHA][DIAG2] mainItems.length: 36 | subMontagens keys: 5 | exemplo mainItem[0]: {"comp_codigo":"07.MP.N.70005","comp_descricao":"ABRACADEIRA DE NYLON PRETA 4,8X280MM","comp_qtd":7,"comp_unid":"UN","comp_operacao":null,"ficha":""}
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'ConsultarEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { codProduto: 'FTI185LPTBR' } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 357,
1|intranet_api  |   body: {
1|intranet_api  |     ident: {
1|intranet_api  |       codFamilia: 'FTIBR',
1|intranet_api  |       codProduto: 'FTI185LPTBR',
1|intranet_api  |       descrFamilia: 'FTIBR - Inverter Piscina Nacional',
1|intranet_api  |       descrProduto: 'BOMBA DE CALOR FTi-185L40 BR TRIFASICA 380V WIFI - INVERTER - PRETA',
1|intranet_api  |       idFamilia: 10489696385,
1|intranet_api  |       idProduto: 10722904812,
1|intranet_api  |       pesoBrutoProduto: 170,
1|intranet_api  |       pesoLiqProduto: 170,
1|intranet_api  |       tipoProduto: '04',
1|intranet_api  |       unidProduto: 'UN'
1|intranet_api  |     },
1|intranet_api  |     observacoes: {},
1|intranet_api  |     custoProducao: { vGGF: 0, vMOD: 0 },
1|intranet_api  |     itens: []
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [FICHA][OMIE][CLEAR] {
1|intranet_api  |   ok: true,
1|intranet_api  |   idProduto: 10722904812,
1|intranet_api  |   consultados: 0,
1|intranet_api  |   deletados: 0,
1|intranet_api  |   erros: []
1|intranet_api  | }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 351,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 383,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 392,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 397,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 399,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 411,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 389,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 409,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 457,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 367,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 390,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 429,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 366,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 397,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 501,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 437,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 436,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 436,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 366,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 366,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 455,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 355,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 512,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 511,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 377,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 383,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 404,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 357,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 505,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 516,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 392,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 407,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 473,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] → https://app.omie.com.br/api/v1/geral/malha/
1|intranet_api  |   headers: { 'Content-Type': 'application/json' }
1|intranet_api  |   body (mask): {
1|intranet_api  |     call: 'IncluirEstrutura',
1|intranet_api  |     app_key: '3917057082939',
1|intranet_api  |     app_secret: '11***29',
1|intranet_api  |     param: [ { idProduto: 10722904812, itemMalhaIncluir: [Object] } ]
1|intranet_api  |   }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 362,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 363,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [omieCall] ← https://app.omie.com.br/api/v1/geral/malha/ {
1|intranet_api  |   status: 200,
1|intranet_api  |   ms: 378,
1|intranet_api  |   body: {
1|intranet_api  |     idProduto: 0,
1|intranet_api  |     intProduto: '',
1|intranet_api  |     codStatus: '',
1|intranet_api  |     descrStatus: '',
1|intranet_api  |     itemMalhaStatus: [ [Object] ]
1|intranet_api  |   }
1|intranet_api  | }
1|intranet_api  | [FICHA][OMIE][INCLUIR] {
1|intranet_api  |   ok: true,
1|intranet_api  |   idProduto: 10722904812,
1|intranet_api  |   total: 36,
1|intranet_api  |   incluidos: 36,
1|intranet_api  |   sem_id: [],
1|intranet_api  |   erros: []
1|intranet_api  | }
1|intranet_api  | [PCP][Estrutura] pai: FTI185LPTBR versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 07.MP.N.70005 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 01.MP.N.30003 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 01.MP.N.30048 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 01.MP.N.30049 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 01.MP.N.30086 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 01.MP.N.30054 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 01.MP.N.30090 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 01.MP.N.30042 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 01.MP.N.30063 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 07.MP.N.90516 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 08.EM.N.31001 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 08.EM.N.31302 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 07.MP.N.92001 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 04.MP.I.71035 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 08.EM.N.31100 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 08.EM.N.31101 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 08.EM.N.31102 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 07.MP.N.90511 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 08.EM.N.31506 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 06.MP.N.90717 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 06.MP.N.90713 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 07.MP.N.90515 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 08.EM.N.31200 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 03.PP.N.10923 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 05.PP.N.10928 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 05.PP.N.10927 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 05.PP.N.10925 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 04.PP.N.03.LWF.38120 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 03.PP.N.10924 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 07.MP.N.90507 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 08.EM.N.31301 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 07.MP.N.90517 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 07.MP.I.80018 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 07.MP.N.62004 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 07.MP.N.62003 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 02.MP.I.40009 versao:  op: 
1|intranet_api  | [PCP][Estrutura] pai: 03.PP.N.10923 versao:  op: 
1|intranet_api  | [VERSION-CHECK] Versão atual do sistema: 1.0.4
