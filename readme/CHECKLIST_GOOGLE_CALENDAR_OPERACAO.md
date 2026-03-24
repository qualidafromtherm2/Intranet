# Objetivo

Garantir operacao estavel da integracao entre o calendario interno e Google Calendar, sem bloquear a reserva local quando houver falha externa.

# Checklist Interno (Reserva Local Primeiro)

- Regra de seguranca: a reserva local no sistema deve permanecer salva mesmo se o Google Calendar falhar.
- Validar resposta da API ao salvar reserva:
  - `ok: true` e `ids` deve existir para confirmar persistencia local.
  - `googleAgenda.ok` pode ser `false`; isso nao invalida a reserva local.
- Em falha Google, verificar campos retornados:
  - `googleAgenda.code`
  - `googleAgenda.message`
- Orientacao ao usuario final:
  - Informar que a reserva foi salva no sistema.
  - Solicitar reconexao da conta Google quando codigo for `insufficient_scopes`, `auth_error` ou `not_connected`.

# Monitoramento de Logs (3 a 7 dias)

- Todas as falhas de sync Google usam a tag:
  - `[GOOGLE_CALENDAR_SYNC]`
- Campos registrados no log:
  - `operacao`
  - `codigo`
  - `user`
  - `reserva_id`
  - `reserva_local_salva`
  - `erro`

## Comandos uteis

- Ver eventos recentes de falha Google:
  - `pm2 logs intranet_api --lines 200 --nostream | grep GOOGLE_CALENDAR_SYNC`
- Contar falhas por tipo de codigo:
  - `pm2 logs intranet_api --lines 1000 --nostream | grep GOOGLE_CALENDAR_SYNC | grep -o 'codigo=[^ ]*' | sort | uniq -c`
- Confirmar que reserva local foi mantida:
  - `pm2 logs intranet_api --lines 300 --nostream | grep GOOGLE_CALENDAR_SYNC | grep 'reserva_local_salva=true'`

# Acoes Rapidas por Codigo

- `insufficient_scopes`: desconectar e reconectar conta Google (novo consentimento).
- `token_expired`: reconectar conta Google.
- `refresh_token_missing`: reconectar conta Google.
- `not_connected`: conectar conta Google no modal.
- `auth_error`: validar credenciais OAuth no ambiente e usuario de teste no Google Cloud.
- `quota_rate_limit`: aguardar e repetir; se recorrente, revisar cota da API.

# Encerramento Diario

- Sem falhas criticas se:
  - A maioria das reservas teve `googleAgenda.ok=true`.
  - Eventuais falhas mantiveram `reserva_local_salva=true`.
- Se houver aumento de `insufficient_scopes`:
  - revisar consentimento OAuth no Google Cloud e refazer conexao das contas afetadas.
