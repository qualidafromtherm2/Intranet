const { dbQuery } = require('../src/db');
const { executarNotificacaoDiaria } = require('../cron/notificacao_diaria_whatsapp');

(async () => {
  // 1. Lista quem vai receber
  const { rows } = await dbQuery(
    `SELECT id, username, telefone_contato
     FROM public.auth_user
     WHERE receber_notificacao = true
       AND telefone_contato IS NOT NULL
       AND TRIM(telefone_contato) <> ''
     ORDER BY username`
  );

  if (!rows.length) {
    console.log('Nenhum usuario com notificacao ativada e telefone preenchido.');
    process.exit(0);
  }

  console.log(`\n=== ${rows.length} usuario(s) elegiveis ===`);
  rows.forEach(r => console.log(`  - ${r.username} | Tel: ${r.telefone_contato} | ID: ${r.id}`));
  console.log('\nEnviando notificacao de teste...\n');

  // 2. Dispara a notificacao
  await executarNotificacaoDiaria();

  console.log('\nTeste concluido.');
  process.exit(0);
})().catch(e => {
  console.error('Erro:', e.message || e);
  process.exit(1);
});
