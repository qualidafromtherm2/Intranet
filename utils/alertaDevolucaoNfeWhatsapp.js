'use strict';

/**
 * Alerta quando chega NF-e de devolução/retorno (emitida contra a Fromtherm).
 * Destinatários: usuários ATIVOS em Destinatários de devolução
 * (auth_user.email_devolucao = true) — independente das preferências pessoais.
 * Envia WhatsApp (se houver telefone) e e-mail (se houver e-mail).
 *
 * Disparo: webhook Omie recebimentos-nfe (após gravar na tabela), não por cron.
 */

const { dbQuery } = require('../src/db');
const {
  toWhatsappPhone,
  getWhatsappPhoneNumberId,
  whatsappConfigurado,
  enviarWhatsappNotificacao,
} = require('./whatsappEnvio');
const { smtpConfigurado, enviarEmail } = require('./mailer');

const TAG = '[AlertaDevolucaoNFe]';
const FUNCAO_ID_DESTINO = Number(process.env.ALERTA_DEVOLUCAO_FUNCAO_ID || 5) || 5;

/** CFOPs típicos de devolução / retorno de conserto (só dígitos). */
const CFOPS_DEVOLUCAO = new Set([
  // Entrada — devolução de venda
  '1201', '1202', '1203', '1204', '1208', '1209', '1213', '1215', '1216', '1553',
  '2201', '2202', '2203', '2204', '2208', '2209', '2213', '2215', '2216', '2553',
  '3201', '3553',
  // Saída do emitente — devolução de compra (como a NF 170 / CFOP 6202)
  '5201', '5202', '5208', '5209', '5210', '5213', '5214', '5216', '5412', '5503', '5553', '5556', '5921',
  '6201', '6202', '6208', '6209', '6210', '6213', '6214', '6216', '6412', '6503', '6553', '6556', '6921',
  '7201', '7202', '7553', '7556',
  // Remessa / retorno para conserto ou reparo
  '1915', '1916', '2915', '2916', '5915', '5916', '6915', '6916',
]);

let schemaOk = false;

function normalizarCfop(valor) {
  const digits = String(valor || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length >= 4 ? digits.slice(-4) : digits.padStart(4, '0');
}

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function naturezaIndicaDevolucao(natureza) {
  const s = normalizarTexto(natureza);
  if (!s) return false;
  if (s.includes('devolu')) return true;
  if (s.includes('retorno') && (s.includes('conserto') || s.includes('reparo') || s.includes('garantia'))) {
    return true;
  }
  if (s.includes('remessa') && (s.includes('conserto') || s.includes('reparo'))) {
    return true;
  }
  return false;
}

function cfopIndicaDevolucao(cfops) {
  const lista = Array.isArray(cfops) ? cfops : [cfops];
  for (const raw of lista) {
    const cod = normalizarCfop(raw);
    if (cod && CFOPS_DEVOLUCAO.has(cod)) return true;
  }
  return false;
}

function isNfeDevolucao({ natureza, cfops } = {}) {
  if (naturezaIndicaDevolucao(natureza)) return true;
  if (cfopIndicaDevolucao(cfops)) return true;
  return false;
}

function montarDedupeKey({ cChaveNfe, nIdReceb }) {
  const chave = String(cChaveNfe || '').trim();
  if (chave) return `chave:${chave}`;
  const idReceb = nIdReceb != null && String(nIdReceb).trim() !== '' ? Number(nIdReceb) : null;
  if (Number.isFinite(idReceb) && idReceb > 0) return `receb:${idReceb}`;
  return null;
}

async function garantirSchemaAlertaDevolucao() {
  if (schemaOk) return;
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS logistica`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS logistica.alerta_devolucao_nfe_enviado (
      id              BIGSERIAL PRIMARY KEY,
      dedupe_key      TEXT,
      c_chave_nfe     TEXT,
      n_id_receb      BIGINT,
      motivo          TEXT,
      enviados_para   TEXT,
      enviado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQuery(`
    ALTER TABLE logistica.alerta_devolucao_nfe_enviado
      ADD COLUMN IF NOT EXISTS dedupe_key TEXT
  `);
  await dbQuery(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_alerta_devolucao_dedupe_key
      ON logistica.alerta_devolucao_nfe_enviado (dedupe_key)
  `);
  schemaOk = true;
}

async function listarDestinatariosDevolucaoAtivos() {
  const { rows } = await dbQuery(
    `SELECT u.id, u.username, u.nome_completo, u.email, u.telefone_contato
       FROM public.auth_user u
      WHERE u.email_devolucao = true
        AND u.is_active IS DISTINCT FROM false`
  );
  return rows;
}

function emailValidoDevolucao(raw) {
  const e = String(raw || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}

function formatarMoedaBr(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataBr(val) {
  if (!val) return '—';
  try {
    return new Date(val).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch {
    return String(val);
  }
}

function montarHtmlEmailAlerta(nota) {
  const cfops = (nota.cfops || []).filter(Boolean);
  const cfopTxt = cfops.length ? [...new Set(cfops.map(normalizarCfop).filter(Boolean))].join(', ') : '—';
  const linha = (lbl, val) => {
    const v = String(val ?? '').trim() || '—';
    return `<tr><td style="padding:4px 8px;font-weight:700;color:#334155;white-space:nowrap;">${lbl}</td><td style="padding:4px 8px;color:#0f172a;">${String(v).replace(/</g, '&lt;')}</td></tr>`;
  };
  return `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;">
      <h2 style="margin:0 0 8px;color:#dc2626;">NF-e de DEVOLUÇÃO contra a Fromtherm</h2>
      <p style="margin:0 0 14px;color:#475569;">Recebemos registro de nota de devolução/retorno. Conferir e, se necessário, recusar/protestar <strong>antes</strong> do recebimento físico.</p>
      <table style="border-collapse:collapse;width:100%;max-width:720px;border:1px solid #e2e8f0;">
        ${linha('Emitente', nota.fornecedor)}
        ${linha('CNPJ', nota.cnpj)}
        ${linha('NF-e', nota.numero)}
        ${linha('Série', nota.serie)}
        ${linha('Emissão', formatarDataBr(nota.emissao))}
        ${linha('Valor', formatarMoedaBr(nota.valor))}
        ${linha('Natureza', nota.natureza)}
        ${linha('CFOP', cfopTxt)}
        ${linha('Chave', nota.chave)}
      </table>
      <p style="margin:14px 0 0;color:#64748b;font-size:12px;">Aviso automático da Intranet — Destinatários de devolução.</p>
    </div>`;
}

function montarMensagemAlerta(nota) {
  const cfops = (nota.cfops || []).filter(Boolean);
  const cfopTxt = cfops.length ? [...new Set(cfops.map(normalizarCfop).filter(Boolean))].join(', ') : '—';
  return [
    '*⚠ NF-e de DEVOLUÇÃO contra a Fromtherm*',
    '',
    'Recebemos registro de nota de devolução/retorno.',
    'Conferir e, se necessário, recusar/protestar *antes* do recebimento físico.',
    '',
    `Emitente: ${nota.fornecedor || '—'}`,
    `CNPJ: ${nota.cnpj || '—'}`,
    `NF-e: ${nota.numero || '—'}  Série: ${nota.serie || '—'}`,
    `Emissão: ${formatarDataBr(nota.emissao)}`,
    `Valor: ${formatarMoedaBr(nota.valor)}`,
    `Natureza: ${nota.natureza || '—'}`,
    `CFOP: ${cfopTxt}`,
    `Chave: ${nota.chave || '—'}`,
  ].join('\n');
}

/**
 * Tenta reservar o envio (dedupe). Retorna true se esta execução deve enviar.
 */
async function reservarEnvio({ cChaveNfe, nIdReceb, motivo }) {
  await garantirSchemaAlertaDevolucao();
  const dedupeKey = montarDedupeKey({ cChaveNfe, nIdReceb });
  if (!dedupeKey) return false;

  const chave = String(cChaveNfe || '').trim() || null;
  const idReceb = nIdReceb != null && String(nIdReceb).trim() !== '' ? Number(nIdReceb) : null;

  const { rows } = await dbQuery(
    `INSERT INTO logistica.alerta_devolucao_nfe_enviado
       (dedupe_key, c_chave_nfe, n_id_receb, motivo)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [dedupeKey, chave, Number.isFinite(idReceb) ? idReceb : null, motivo || null]
  );
  return rows.length > 0;
}

async function marcarEnviados(chaveOuId, enviadosPara) {
  const texto = String(enviadosPara || '').slice(0, 500);
  const dedupeKey = montarDedupeKey({
    cChaveNfe: chaveOuId?.cChaveNfe,
    nIdReceb: chaveOuId?.nIdReceb,
  });
  if (!dedupeKey) return;
  await dbQuery(
    `UPDATE logistica.alerta_devolucao_nfe_enviado
        SET enviados_para = $2
      WHERE dedupe_key = $1`,
    [dedupeKey, texto]
  );
}

async function carregarNotaDoBanco({ nIdReceb, cChaveNfe }) {
  const params = [];
  const where = [];
  if (nIdReceb != null && String(nIdReceb).trim() !== '') {
    params.push(nIdReceb);
    where.push(`r.n_id_receb = $${params.length}`);
  }
  if (cChaveNfe && String(cChaveNfe).trim()) {
    params.push(String(cChaveNfe).trim());
    where.push(`r.c_chave_nfe = $${params.length}`);
  }
  if (!where.length) return null;

  const { rows } = await dbQuery(
    `SELECT r.n_id_receb,
            r.c_chave_nfe,
            r.c_numero_nfe,
            r.c_serie_nfe,
            r.c_nome_fornecedor,
            r.c_cnpj_cpf_fornecedor,
            r.c_natureza_operacao,
            r.c_cfop_entrada,
            r.d_emissao_nfe,
            r.n_valor_nfe,
            r.c_cancelada,
            COALESCE(
              ARRAY_AGG(DISTINCT i.c_cfop_entrada)
                FILTER (WHERE i.c_cfop_entrada IS NOT NULL AND TRIM(i.c_cfop_entrada) <> ''),
              ARRAY[]::text[]
            ) AS cfops_itens
       FROM logistica.recebimentos_nfe_omie r
       LEFT JOIN logistica.recebimentos_nfe_itens i ON i.n_id_receb = r.n_id_receb
      WHERE ${where.join(' OR ')}
      GROUP BY r.n_id_receb
      LIMIT 1`,
    params
  );
  return rows[0] || null;
}

function cfopsDoRecebimentoApi(recebimento) {
  const out = [];
  const cabec = recebimento?.cabec || {};
  if (cabec.cCfopEntrada) out.push(cabec.cCfopEntrada);
  const itens = Array.isArray(recebimento?.itensRecebimento) ? recebimento.itensRecebimento : [];
  for (const item of itens) {
    const ia = item?.itensInfoAdic || item?.infoAdic || {};
    const ic = item?.itensCabec || item?.cabec || {};
    if (ia.cCfopEntrada) out.push(ia.cCfopEntrada);
    if (ic.cCfopEntrada) out.push(ic.cCfopEntrada);
    if (ic.cCFOP) out.push(ic.cCFOP);
    if (item.cCFOP) out.push(item.cCFOP);
  }
  return out;
}

/**
 * Avalia a NF-e recém gravada pelo webhook e, se for devolução,
 * avisa os Destinatários de devolução (WhatsApp e e-mail).
 */
async function avaliarENotificarDevolucaoPorRecebimento({
  nIdReceb = null,
  cChaveNfe = null,
  recebimentoApi = null,
} = {}) {
  const row = await carregarNotaDoBanco({ nIdReceb, cChaveNfe });
  if (!row) {
    console.log(TAG, 'Nota não encontrada no banco após webhook.', { nIdReceb, cChaveNfe });
    return { ok: false, reason: 'nota_nao_encontrada' };
  }

  if (String(row.c_cancelada || '').toUpperCase() === 'S') {
    return { ok: false, reason: 'nota_cancelada' };
  }

  const naturezaApi = recebimentoApi?.cabec?.cNaturezaOperacao || null;
  const natureza = row.c_natureza_operacao || naturezaApi || null;
  const cfops = [
    row.c_cfop_entrada,
    ...(row.cfops_itens || []),
    ...cfopsDoRecebimentoApi(recebimentoApi),
  ].filter(Boolean);

  if (!isNfeDevolucao({ natureza, cfops })) {
    return { ok: false, reason: 'nao_e_devolucao' };
  }

  const motivo = naturezaIndicaDevolucao(natureza)
    ? `natureza:${natureza}`
    : `cfop:${[...new Set(cfops.map(normalizarCfop).filter(Boolean))].join(',')}`;

  const deveEnviar = await reservarEnvio({
    cChaveNfe: row.c_chave_nfe,
    nIdReceb: row.n_id_receb,
    motivo,
  });
  if (!deveEnviar) {
    console.log(TAG, `Já alertado anteriormente: chave=${row.c_chave_nfe || row.n_id_receb}`);
    return { ok: true, skipped: true, reason: 'ja_enviado' };
  }

  const destinatarios = await listarDestinatariosDevolucaoAtivos();
  if (!destinatarios.length) {
    console.warn(TAG, 'Nenhum destinatário ativo em Destinatários de devolução.');
    return { ok: false, reason: 'sem_destinatarios' };
  }

  const dadosNota = {
    fornecedor: row.c_nome_fornecedor,
    cnpj: row.c_cnpj_cpf_fornecedor,
    numero: row.c_numero_nfe,
    serie: row.c_serie_nfe,
    emissao: row.d_emissao_nfe,
    valor: row.n_valor_nfe,
    natureza,
    chave: row.c_chave_nfe,
    cfops,
  };
  const mensagem = montarMensagemAlerta(dadosNota);
  const enviados = [];

  if (whatsappConfigurado()) {
    const phoneNumberId = await getWhatsappPhoneNumberId();
    if (!phoneNumberId) {
      console.warn(TAG, 'Phone Number ID não encontrado — pulando WhatsApp.');
    } else {
      const vistos = new Set();
      for (const dest of destinatarios) {
        try {
          const phone = toWhatsappPhone(dest.telefone_contato);
          if (!phone || vistos.has(phone)) continue;
          vistos.add(phone);
          const result = await enviarWhatsappNotificacao(dest.telefone_contato, mensagem, phoneNumberId);
          enviados.push(`wa:${dest.username || dest.id}:${result?.wa_id || phone}`);
          console.log(
            TAG,
            `WhatsApp enviado (${result?.modo || 'texto'}) para ${dest.username || dest.id}`
            + ` — ${result?.wa_id || phone}`
          );
        } catch (err) {
          console.error(TAG, `Falha WhatsApp para ${dest.username || dest.id}:`, err?.message || err);
        }
      }
    }
  } else {
    console.log(TAG, 'WhatsApp não configurado — pulando canal WhatsApp.');
  }

  if (smtpConfigurado()) {
    const emails = [];
    const vistosEmail = new Set();
    for (const dest of destinatarios) {
      const em = emailValidoDevolucao(dest.email);
      if (!em || vistosEmail.has(em)) continue;
      vistosEmail.add(em);
      emails.push(em);
    }
    if (emails.length) {
      try {
        const result = await enviarEmail({
          to: emails,
          subject: `NF-e de devolução — ${dadosNota.numero || ''} — ${dadosNota.fornecedor || 'Fromtherm'}`.trim(),
          text: mensagem.replace(/\*/g, ''),
          html: montarHtmlEmailAlerta(dadosNota),
        });
        enviados.push(`email:${(result.to || emails).join('|')}`);
        console.log(TAG, `E-mail enviado para ${emails.join(', ')}`);
      } catch (err) {
        console.error(TAG, 'Falha e-mail:', err?.message || err);
      }
    } else {
      console.log(TAG, 'Destinatários ativos sem e-mail válido — pulando canal e-mail.');
    }
  } else {
    console.log(TAG, 'SMTP não configurado — pulando canal e-mail.');
  }

  await marcarEnviados(
    { cChaveNfe: row.c_chave_nfe, nIdReceb: row.n_id_receb },
    enviados.join(', ') || 'falhou'
  );

  return { ok: enviados.length > 0, enviados, motivo };
}

module.exports = {
  FUNCAO_ID_DESTINO,
  CFOPS_DEVOLUCAO,
  isNfeDevolucao,
  naturezaIndicaDevolucao,
  cfopIndicaDevolucao,
  avaliarENotificarDevolucaoPorRecebimento,
  listarDestinatariosDevolucaoAtivos,
  montarMensagemAlerta,
};
