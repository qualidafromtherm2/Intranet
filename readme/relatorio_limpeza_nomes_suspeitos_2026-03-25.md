]633;E;pm2 logs intranet_api;bbaa73a4-686f-45ad-8b14-64c65c3d0eae]633;C# Relatorio de nomes suspeitos

Data: 2026-03-25

## Grupo 1 - Seguro para apagar (padrao comando/SQL)

- aux | grep intranet_api
- aux | grep psql | head -3
- backup/x220- travou nessa parte do projeto, não abre mais login/aux | grep psql | head -3
- backup/x220- travou nessa parte do projeto, não abre mais login/ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c DROP FUNCTION IF EXISTS compras.fn_registrar_historico_solicitacao() CASCADE;
- backup/x220- travou nessa parte do projeto, não abre mais login/ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c SELECT COUNT(*) FROM compras.historico_solicitacao_compras;
- backup/x220- travou nessa parte do projeto, não abre mais login/ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c SELECT * FROM compras.solicitacao_compras WHERE status = 'aguardando aprovação da requisição' LIMIT 1;
- backup/x220- travou nessa parte do projeto, não abre mais login/ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c SELECT nome FROM configuracoes.departamento LIMIT 5;
- backup/x220- travou nessa parte do projeto, não abre mais login/ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c SELECT pg_get_functiondef('compras.fn_registrar_historico_solicitacao()'::regprocedure);
- backup/x220- travou nessa parte do projeto, não abre mais login/ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c UPDATE compras.solicitacao_compras SET status = 'aguardando cotação' WHERE status = 'cotado';
- backup/x220- travou nessa parte do projeto, não abre mais login/ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -t -c SELECT nome FROM configuracoes.status_compras WHERE ativo = true ORDER BY ordem, nome;
- backup/x220- travou nessa parte do projeto, não abre mais login/uario := COALESCE(current_setting('app.current_user', true), current_user);
- backup/x220- travou nessa parte do projeto, não abre mais login/uario := current_setting('app.current_user', true);
- ervidor..." && pm2 restart intranet_api --update-env
- intranet_api --lines 20 --nostream
- intranet_api --lines 50
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -Aqt -c SELECT tgname FROM pg_trigger WHERE tgrelid = 'compras.pedidos_omie'::regclass
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c ALTER TABLE compras.compras_sem_cadastro ADD COLUMN IF NOT EXISTS observacao_reprovacao TEXT, ADD COLUMN IF NOT EXISTS usuario_comentario TEXT;
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c DROP FUNCTION IF EXISTS compras.fn_registrar_historico_solicitacao() CASCADE;
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w --command=SELECT COUNT(*) FROM compras.solicitacao_compras;
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c SELECT ativo, dias_semana, horario::text, tabelas, proxima_execucao, ultima_execucao FROM public.agendamento_sincronizacao LIMIT 1;
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='rh' AND table_name='reservas_ambientes' ORDER BY ordinal_position;
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c SELECT COUNT(*) as total, COUNT(c_chave_nfe) as preenchidas, COUNT(*) - COUNT(c_chave_nfe) as vazias FROM logistica.recebimentos_nfe_omie;
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c SELECT COUNT(*) FROM compras.historico_solicitacao_compras;
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c SELECT * FROM compras.solicitacao_compras WHERE status = 'aguardando aprovação da requisição' LIMIT 1;
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c SELECT * FROM logistica.etapas_recebimento_nfe ORDER BY codigo;
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c SELECT nome FROM configuracoes.departamento LIMIT 5;
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c SELECT pg_get_functiondef('compras.fn_registrar_historico_solicitacao()'::regprocedure);
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -c UPDATE compras.solicitacao_compras SET status = 'aguardando cotação' WHERE status = 'cotado';
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w --no-psqlrc -c \d logistica.recebimentos_nfe_itens
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -t -A -c SELECT column_name FROM information_schema.columns WHERE table_schema='configuracoes' AND table_name='departamento' ORDER BY ordinal_position;
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -t -A -c SELECT id, key, label, position, parent_id, active FROM public.nav_node WHERE active = true ORDER BY parent_id NULLS FIRST, sort, key;
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -t -A -c SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'compras.pedidos_omie'::regclass AND tgname = 'trg_sync_nfe_valor_pedido';
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -t -c SELECT id, departamento_id, nome, ativo FROM configuracoes.categoria_departamento ORDER BY departamento_id, nome;
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -t -c SELECT link FROM compras.compras_sem_cadastro ORDER BY id DESC LIMIT 3;
- ql -h dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com -U intranet_db_yd0w_user intranet_db_yd0w -t -c SELECT nome FROM configuracoes.status_compras WHERE ativo = true ORDER BY ordem, nome;
- uario := COALESCE(current_setting('app.current_user', true), current_user);
- uario := current_setting('app.current_user', true);
- ucesso!" && sleep 1

## Grupo 2 - Revisar antes (fragmentos/lixo, mas menos deterministico)

- backup/x220- travou nessa parte do projeto, não abre mais login/cricao                                      | saldo  | data_posicao 
- backup/x220- travou nessa parte do projeto, não abre mais login/crição: -s | Qtd: -s | Status: -s',
- backup/x220- travou nessa parte do projeto, não abre mais login/ername TEXT NOT NULL,
- backup/x220- travou nessa parte do projeto, não abre mais login/olicitacao_id, operacao, campo_alterado, valor_anterior, valor_novo,
- backup/x220- travou nessa parte do projeto, não abre mais login/pseroavel_username TEXT NOT NULL,
- backup/x220- travou nessa parte do projeto, não abre mais login/t { Pool } = require('pg');
- backup/x220- travou nessa parte do projeto, não abre mais login/tringify(r.rows, null, 2)); pool.end(); })
- chaves_nao_vazias,
- com_chave,
- cricao                                      | saldo  | data_posicao 
- crição: -s | Qtd: -s | Status: -s',
- ername TEXT NOT NULL,
- et -a
- et -e
- ole.log('n📋 Últimos 3 registros:n');
- olicitacao_id, operacao, campo_alterado, valor_anterior, valor_novo,
- pseroavel_username TEXT NOT NULL,
- total,
- t { Pool } = require('pg');
- tringify(r.rows, null, 2)); pool.end(); })
- tros' as verificacao,

## Versionados no Git


- Grupo 1 versionados: 29
- Grupo 2 versionados: 14
