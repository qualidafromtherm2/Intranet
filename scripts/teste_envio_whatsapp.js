const { dbQuery } = require('../src/db');

const TOKEN = String(
  process.env.WHATSAPP_CLOUD_ACCESS_TOKEN ||
  process.env.META_WHATSAPP_ACCESS_TOKEN || ''
).trim();
const API_VER = 'v25.0';

(async () => {
  if (!TOKEN) {
    console.log('ERRO: Token WhatsApp nao configurado (WHATSAPP_CLOUD_ACCESS_TOKEN).');
    process.exit(1);
  }

  const { rows } = await dbQuery(
    `SELECT phone_number_id FROM sac.whatsapp_webhook_messages
     WHERE phone_number_id IS NOT NULL AND direction = 'outbound'
     GROUP BY phone_number_id ORDER BY count(*) DESC LIMIT 1`
  );
  const phoneNumberId = rows[0]?.phone_number_id;
  if (!phoneNumberId) {
    console.log('ERRO: Nenhum Phone Number ID encontrado.');
    process.exit(1);
  }

  const toPhone = '5541987819808';
  const text = 'Bom dia! Esta é uma mensagem de teste do sistema SGF Fromtherm.\n\nSe recebeu esta mensagem, a notificação diária está funcionando corretamente. ✅';

  console.log('Phone Number ID:', phoneNumberId);
  console.log('Enviando para:', toPhone);

  const resp = await fetch(
    `https://graph.facebook.com/${API_VER}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'text',
        text: { body: text }
      })
    }
  );

  const body = await resp.json();
  console.log('Status HTTP:', resp.status);
  console.log('Resposta:', JSON.stringify(body, null, 2));

  if (resp.ok) {
    console.log('\n✓ Mensagem de teste enviada com sucesso!');
  } else {
    console.log('\n✗ Falha no envio.');
  }

  process.exit(0);
})().catch(e => {
  console.error('Erro:', e.message || e);
  process.exit(1);
});
