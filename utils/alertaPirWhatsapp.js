'use strict';

/**
 * Alerta WhatsApp quando um item novo entra na lista PIR padrão
 * (etiqueta.ETQ_recebimento com pir=false e família/código MP
 *  → Qualidade Fábrica → PIR).
 *
 * Destinatários: usuários com public.auth_user_profile.funcao_id = 4
 * (Supervisor de qualidade) e telefone_contato preenchido.
 *
 * Itens fora de MP não disparam alerta — vão direto à Identificação.
 */

const { dbQuery } = require('../src/db');
const {
  toWhatsappPhone,
  getWhatsappPhoneNumberId,
  whatsappConfigurado,
  enviarWhatsappNotificacao,
} = require('./whatsappEnvio');
const { codigoTemSegmentoMp, produtoEhFamiliaMp } = require('./etqRecebimentoPir');
const { filtrarUsuarios } = require('./notificacaoPreferencias');

const TAG = '[AlertaPirWhatsApp]';
const FUNCAO_ID_DESTINO = Number(process.env.ALERTA_PIR_FUNCAO_ID || 4) || 4;

let schemaOk = false;

async function garantirSchemaAlertaPir() {
  if (schemaOk) return;
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS qualidade`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS qualidade.alerta_pir_whatsapp_enviado (
      id                   BIGSERIAL PRIMARY KEY,
      etq_recebimento_id   BIGINT NOT NULL,
      enviados_para        TEXT,
      enviado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (etq_recebimento_id)
    )
  `);
  schemaOk = true;
}

async function listarSupervisoresQualidade() {
  const { rows } = await dbQuery(
    `SELECT u.id, u.username, u.nome_completo, u.telefone_contato
       FROM public.auth_user u
       JOIN public.auth_user_profile up ON up.user_id = u.id
      WHERE up.funcao_id = $1
        AND u.is_active IS DISTINCT FROM false
        AND u.telefone_contato IS NOT NULL
        AND TRIM(u.telefone_contato) <> ''`,
    [FUNCAO_ID_DESTINO]
  );
  return rows;
}

function formatarQtd(qtd, unidade) {
  if (qtd == null || qtd === '') return '—';
  const n = Number(qtd);
  const qtdTxt = Number.isFinite(n)
    ? n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })
    : String(qtd);
  const un = String(unidade || '').trim();
  return un ? `${qtdTxt} ${un}` : qtdTxt;
}

function montarMensagemItens(itens) {
  const lista = Array.isArray(itens) ? itens.filter(Boolean) : [];
  if (!lista.length) return null;

  if (lista.length === 1) {
    const it = lista[0];
    return [
      '*PIR — novo item para inspeção*',
      '',
      `Código: ${it.codigo_produto || '—'}`,
      `Descrição: ${it.descricao_produto || '—'}`,
      `Qtd: ${formatarQtd(it.qtd, it.unidade)}`,
      `Lote: ${it.lote || '—'}`,
      `NF-e: ${it.numero_nfe || '—'}`,
      '',
      'Abra: Qualidade Fábrica → PIR',
    ].join('\n');
  }

  const linhas = lista.slice(0, 15).map((it, idx) => {
    const cod = it.codigo_produto || '—';
    const qtd = formatarQtd(it.qtd, it.unidade);
    const nfe = it.numero_nfe || '—';
    return `${idx + 1}. ${cod} — ${qtd} (NF-e ${nfe})`;
  });
  if (lista.length > 15) {
    linhas.push(`… e mais ${lista.length - 15} item(ns)`);
  }

  return [
    `*PIR — ${lista.length} novos itens para inspeção*`,
    '',
    ...linhas,
    '',
    'Abra: Qualidade Fábrica → PIR',
  ].join('\n');
}

async function reservarEnvios(ids) {
  await garantirSchemaAlertaPir();
  const novos = [];
  for (const id of ids) {
    const etqId = Number(id);
    if (!Number.isFinite(etqId) || etqId <= 0) continue;
    try {
      const { rows } = await dbQuery(
        `INSERT INTO qualidade.alerta_pir_whatsapp_enviado (etq_recebimento_id)
         VALUES ($1)
         ON CONFLICT (etq_recebimento_id) DO NOTHING
         RETURNING etq_recebimento_id`,
        [etqId]
      );
      if (rows.length) novos.push(etqId);
    } catch (err) {
      console.error(TAG, `Falha ao reservar etq_id=${etqId}:`, err?.message || err);
    }
  }
  return novos;
}

async function marcarEnviados(ids, enviadosPara) {
  if (!ids.length) return;
  await dbQuery(
    `UPDATE qualidade.alerta_pir_whatsapp_enviado
        SET enviados_para = $2,
            enviado_em = NOW()
      WHERE etq_recebimento_id = ANY($1::bigint[])`,
    [ids, String(enviadosPara || '').slice(0, 2000)]
  );
}

/** Mantém só itens MP (lista PIR padrão). Aceita eh_mp do caller ou consulta o banco. */
async function filtrarItensMpParaAlerta(lista) {
  const comFlag = lista.filter((it) => it.eh_mp === true || it.ehMp === true);
  const semFlag = lista.filter((it) => it.eh_mp !== true && it.ehMp !== true);
  if (!semFlag.length) return comFlag;

  const ids = semFlag.map((it) => it.id).filter((id) => Number(id) > 0);
  const mpIds = new Set();
  if (ids.length) {
    try {
      const { rows } = await dbQuery(
        `SELECT er.id,
                UPPER(TRIM(COALESCE(po.codint_familia, ''))) AS codint_familia,
                po.codigo,
                po.codigo_produto::text AS codigo_produto,
                er.codigo_produto AS etq_codigo
           FROM etiqueta."ETQ_recebimento" er
           LEFT JOIN LATERAL (
             SELECT p.codint_familia, p.codigo, p.codigo_produto
               FROM produto.produtos_omie p
              WHERE TRIM(COALESCE(p.codigo, '')) = TRIM(COALESCE(er.codigo_produto, ''))
                 OR TRIM(COALESCE(p.codigo_produto::text, '')) = TRIM(COALESCE(er.codigo_produto, ''))
              LIMIT 1
           ) po ON TRUE
          WHERE er.id = ANY($1::bigint[])`,
        [ids]
      );
      for (const row of rows) {
        if (produtoEhFamiliaMp(row, row.etq_codigo) || codigoTemSegmentoMp(row.etq_codigo)) {
          mpIds.add(Number(row.id));
        }
      }
    } catch (err) {
      console.error(TAG, 'Falha ao filtrar MP:', err?.message || err);
      for (const it of semFlag) {
        if (codigoTemSegmentoMp(it.codigo_produto)) mpIds.add(Number(it.id));
      }
    }
  } else {
    for (const it of semFlag) {
      if (codigoTemSegmentoMp(it.codigo_produto)) mpIds.add(Number(it.id));
    }
  }

  return [
    ...comFlag,
    ...semFlag.filter((it) => mpIds.has(Number(it.id))),
  ];
}

/**
 * Notifica Supervisores de qualidade sobre itens novos na lista PIR (só MP).
 * @param {Array<{id, codigo_produto, descricao_produto, qtd, unidade, lote, numero_nfe, eh_mp?}>} itens
 */
async function notificarEntradaListaPir(itens) {
  const listaBruta = (Array.isArray(itens) ? itens : [itens])
    .filter((it) => it && Number(it.id) > 0)
    .map((it) => ({
      id: Number(it.id),
      codigo_produto: String(it.codigo_produto || '').trim(),
      descricao_produto: String(it.descricao_produto || '').trim(),
      qtd: it.qtd,
      unidade: it.unidade,
      lote: String(it.lote || '').trim(),
      numero_nfe: String(it.numero_nfe || '').trim(),
      eh_mp: it.eh_mp === true || it.ehMp === true,
      ehMp: it.eh_mp === true || it.ehMp === true,
    }));

  if (!listaBruta.length) return { ok: false, reason: 'sem_itens' };

  const lista = await filtrarItensMpParaAlerta(listaBruta);
  if (!lista.length) {
    console.log(TAG, 'Nenhum item MP para alertar (fora de MP ignorado).');
    return { ok: true, skipped: true, reason: 'sem_itens_mp' };
  }

  if (!whatsappConfigurado()) {
    console.log(TAG, 'WhatsApp não configurado — alerta ignorado.');
    return { ok: false, reason: 'whatsapp_nao_configurado' };
  }

  const idsNovos = await reservarEnvios(lista.map((it) => it.id));
  if (!idsNovos.length) {
    console.log(TAG, `Já alertado anteriormente: ids=${lista.map((i) => i.id).join(',')}`);
    return { ok: true, skipped: true, reason: 'ja_enviado' };
  }

  const paraEnviar = lista.filter((it) => idsNovos.includes(it.id));
  const mensagem = montarMensagemItens(paraEnviar);
  if (!mensagem) return { ok: false, reason: 'sem_mensagem' };

  const destinatariosCargo = await listarSupervisoresQualidade();
  if (!destinatariosCargo.length) {
    console.warn(TAG, `Nenhum telefone para funcao_id=${FUNCAO_ID_DESTINO}`);
    return { ok: false, reason: 'sem_destinatarios' };
  }

  const destinatarios = await filtrarUsuarios(destinatariosCargo, 'pir_novo_item', 'whatsapp');
  if (!destinatarios.length) {
    console.log(TAG, 'Nenhum destinatário com preferência pir_novo_item / whatsapp.');
    return { ok: false, reason: 'sem_preferencia' };
  }

  const phoneNumberId = await getWhatsappPhoneNumberId();
  if (!phoneNumberId) {
    console.warn(TAG, 'Phone Number ID não encontrado.');
    return { ok: false, reason: 'sem_phone_number_id' };
  }

  const enviados = [];
  const vistos = new Set();
  for (const dest of destinatarios) {
    try {
      const phone = toWhatsappPhone(dest.telefone_contato);
      if (!phone || vistos.has(phone)) continue;
      vistos.add(phone);

      const result = await enviarWhatsappNotificacao(dest.telefone_contato, mensagem, phoneNumberId);
      enviados.push(`${dest.username || dest.id}:${result?.wa_id || phone}`);
      console.log(
        TAG,
        `WhatsApp enviado (${result?.modo || 'texto'}) para ${dest.username || dest.id}`
        + ` — ${result?.wa_id || phone}`
        + ` — ${paraEnviar.length} item(ns)`
      );
    } catch (err) {
      console.error(TAG, `Falha envio para ${dest.username || dest.id}:`, err?.message || err);
    }
  }

  await marcarEnviados(idsNovos, enviados.join(', ') || 'falhou');
  return { ok: enviados.length > 0, enviados, qtdItens: paraEnviar.length };
}

function dispararNotificacaoEntradaListaPir(itens) {
  Promise.resolve()
    .then(() => notificarEntradaListaPir(itens))
    .catch((err) => console.error(TAG, err?.message || err));
}

module.exports = {
  FUNCAO_ID_DESTINO,
  notificarEntradaListaPir,
  dispararNotificacaoEntradaListaPir,
  montarMensagemItens,
};
