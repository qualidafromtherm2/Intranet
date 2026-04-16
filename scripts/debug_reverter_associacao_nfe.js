/**
 * Script utilitário: reverte associação de uma NF-e a um pedido e
 * exibe a estrutura real das parcelas retornadas pela Omie.
 *
 * Uso:  node scripts/debug_reverter_associacao_nfe.js <numeroNfe>
 * Ex.:  node scripts/debug_reverter_associacao_nfe.js 12155
 */
require('dotenv').config();
const fetch = require('node-fetch');

const OMIE_APP_KEY    = process.env.OMIE_APP_KEY;
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;
const URL_RECEB = 'https://app.omie.com.br/api/v1/produtos/recebimentonfe/';

if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
  console.error('OMIE_APP_KEY ou OMIE_APP_SECRET não definidos no .env');
  process.exit(1);
}

const numeroNfe = String(process.argv[2] || '').replace(/\D/g, '').replace(/^0+/, '') || '12155';

async function omieReceb(call, param) {
  const resp = await fetch(URL_RECEB, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] })
  });
  const data = await resp.json().catch(() => ({}));
  if (data?.faultstring) throw new Error(data.faultstring);
  return data;
}

async function main() {
  // ── 1. Localiza a NF-e pelo número ───────────────────────────────────────
  console.log(`\n=== Consultando NF-e ${numeroNfe} ===`);
  let receb = null;

  // Tenta por listagem
  for (let pag = 1; pag <= 10; pag++) {
    const lista = await omieReceb('ListarRecebimentos', { nPagina: pag, nRegistrosPorPagina: 50, cExibirDetalhes: 'S' });
    const encontrado = (lista?.recebimentos || []).find(r =>
      String(r?.cabec?.cNumeroNFe || '').replace(/\D/g,'').replace(/^0+/,'') === numeroNfe
    );
    if (encontrado) { receb = encontrado; break; }
    if (pag >= Number(lista?.nTotalPaginas || 1)) break;
  }

  if (!receb?.cabec?.nIdReceb) {
    console.error(`NF-e ${numeroNfe} não encontrada na Omie.`);
    process.exit(1);
  }

  const nIdReceb = Number(receb.cabec.nIdReceb);
  console.log(`nIdReceb: ${nIdReceb}  etapa: ${receb.cabec.cEtapa}  #itens: ${receb.itensRecebimento?.length}`);

  // ── 2. Exibe estrutura das parcelas ──────────────────────────────────────
  console.log('\n=== PARCELAS (estrutura completa) ===');
  const parcs = Array.isArray(receb.parcelas) ? receb.parcelas : [];
  parcs.forEach((p, i) => {
    console.log(`Parcela ${i + 1}:`, JSON.stringify(p, null, 2));
  });

  // ── 3. Exibe estrutura dos itens ─────────────────────────────────────────
  console.log('\n=== ITENS (itensCabec) ===');
  (receb.itensRecebimento || []).forEach((item, i) => {
    console.log(`Item ${i + 1} itensCabec:`, JSON.stringify(item.itensCabec || {}, null, 2));
    console.log(`Item ${i + 1} itensInfoAdic:`, JSON.stringify(item.itensInfoAdic || {}, null, 2));
  });

  // ── 4. Reverte: remove vínculo de pedido de cada item ───────────────────
  console.log('\n=== REVERTENDO ASSOCIAÇÃO ===');
  const itensReverter = (receb.itensRecebimento || []).map((item, idx) => ({
    itensIde: {
      nSequencia: Number(item.itensCabec?.nSequencia || idx + 1),
      cAcao: 'ASSOCIAR-PEDIDO',
      nIdPedidoExistente: 0,
      nIdItPedidoExistente: 0
    }
  }));

  const payloadReverter = {
    ide: { nIdReceb: nIdReceb },
    itensRecebimentoEditar: itensReverter
  };

  console.log('Payload REVERTER enviado:', JSON.stringify(payloadReverter, null, 2));

  try {
    const respRev = await omieReceb('AlterarRecebimento', payloadReverter);
    console.log('Resposta AlterarRecebimento:', JSON.stringify(respRev, null, 2));
  } catch (e) {
    console.error('Erro ao reverter AlterarRecebimento:', e.message);
  }

  // ── 5. Devolve a etapa para 40 (Faturada) ───────────────────────────────
  console.log('\n=== REVERTENDO ETAPA para 40 ===');
  try {
    const respEtapa = await omieReceb('AlterarEtapaRecebimento', { nIdReceb: nIdReceb, cEtapa: '40' });
    console.log('Resposta AlterarEtapaRecebimento:', JSON.stringify(respEtapa, null, 2));
  } catch (e) {
    console.error('Erro ao reverter etapa:', e.message);
  }

  console.log('\nFinalizado.');
}

main().catch(err => { console.error('Erro fatal:', err); process.exit(1); });
