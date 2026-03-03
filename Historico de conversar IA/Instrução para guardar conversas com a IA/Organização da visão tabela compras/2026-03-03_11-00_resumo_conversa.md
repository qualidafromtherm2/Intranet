Tema
Organização da visão tabela de Compras (fonte histórica e regra da coluna ID)

Objetivo
Migrar a visão tabela de Compras para usar compras.historico_compras como fonte principal e ajustar a coluna ID para exibir o ID do histórico.

Contexto inicial
A tabela de Compras ainda era montada com base direta em compras.solicitacao_compras e compras.compras_sem_cadastro. A necessidade era consolidar pela tabela de histórico usando tabela_origem + grupo_requisicao, preservando os dados exibidos na página (ID, Nº Requisição, Nº Pedido, Fornecedor, Data, Data Previsão, Vlr Total).

O que foi decidido
- /api/compras/todas e /api/compras/minhas passariam a ser dirigidos por compras.historico_compras.
- A resolução dos dados da linha seria feita via tabela_origem + grupo_requisicao, buscando os campos na tabela indicada (solicitacao_compras ou compras_sem_cadastro).
- A coluna ID exibida na visão tabela deixaria de usar o formato antigo e passaria a usar o ID de compras.historico_compras.

O que foi implementado
- Refatoração das queries de /api/compras/todas e /api/compras/minhas em server.js para usar CTE com histórico recente por (tabela_origem, grupo_requisicao).
- Inclusão de joins com dados de origem para preencher os campos exibidos na tabela de Compras.
- Correção de conflitos de tipos no UNION (text vs integer e text vs jsonb) com casts explícitos.
- Ajuste da regra de ID exibido: id_solicitante agora recebe historico_id para registros vindos de solicitacao_compras e compras_sem_cadastro.
- Validação em runtime concluída com retorno HTTP 200 em /api/compras/todas e confirmação de id_solicitante igual a historico_id.

Pendências
- Validar em uso real (frontend) se todos os pontos que consomem id_solicitante continuam corretos com a nova regra da coluna ID.
- Revisar se algum fluxo ainda depende implicitamente do ID antigo por usuário/sequência.
- Confirmar com usuários de Compras se a exibição de ID histórico atende todos os cenários de operação e rastreabilidade.

Como retomar na próxima conversa
Continuar a validação da visão tabela de Compras após a migração para historico_compras, conferindo no front os cenários de Minhas/Todas solicitações e revisando eventuais usos residuais do ID antigo para padronizar tudo em historico_id.
