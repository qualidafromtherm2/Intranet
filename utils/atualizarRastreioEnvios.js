/**
 * Atualização em lote de rastreio — envios.solicitacoes
 * Consulta VIPP (fila Valida / Processamento Vipp) e Correios (código ECT).
 */
'use strict';

const axios = require('axios');
const { dbQuery } = require('../src/db');

const TAG = '[RastreioEnvios]';
const FILA_STATUS = ['Valida', 'Processamento Vipp'];
const ECT_RE = /^[A-Z]{2}\d{9}[A-Z]{2}$/;
const STATUS_VIPP_INVALIDOS = new Set(['Desconhecido', 'Invalida']);

const VIPP_USUARIO = process.env.VIPP_USUARIO || 'onbiws';
const VIPP_TOKEN = String(process.env.VIPP_TOKEN || '').trim();
const VIPP_ID_PERFIL = process.env.VIPP_ID_PERFIL || '9363';
const VIPP_ENDPOINT = 'http://vpsrv.visualset.com.br/PostagemVipp.asmx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function escXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extrairTag(xml, tag) {
  const m = String(xml || '').match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

function sanitizeCodigo(codigo) {
  return String(codigo || '').replace(/\s+/g, '').toUpperCase() || null;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function persistStatus(codigo, { status, quando }) {
  const statusVal = String(status || '').trim() || 'sem status';
  const quandoVal = quando ? new Date(quando) : null;
  const isDelivered = /entregue ao destinat[áa]rio/i.test(statusVal) || /\bentregue\b/i.test(statusVal);

  await dbQuery(
    `UPDATE envios.solicitacoes
        SET rastreio_status = CASE
                                WHEN $4 THEN 'Finalizado'
                                ELSE $2
                              END,
            rastreio_quando = COALESCE($3, rastreio_quando),
            finalizado_em = CASE
                              WHEN $4 THEN COALESCE($3, finalizado_em, NOW())
                              ELSE finalizado_em
                            END
      WHERE upper(regexp_replace(COALESCE(identificacao, ''), '\\s+', '', 'g')) = $1
         OR upper(identificacao) = $1`,
    [codigo, statusVal, quandoVal, isDelivered]
  );
}

async function consultarCorreios(codigo) {
  const urlCorreios = `https://proxyapp.correios.com.br/v1/sro-rastro/${codigo}`;
  const resp = await fetchWithTimeout(urlCorreios, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://rastreamento.correios.com.br/app/index.php',
    },
  }, 10000);

  if (!resp.ok) {
    throw new Error(`Correios HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const eventos = data?.objetos?.[0]?.eventos || [];
  const ultimo = eventos[0] || null;
  const status = ultimo?.descricao || null;
  const detalhe = ultimo?.detalhe || null;
  const quando = ultimo?.dtHrCriado || null;

  await persistStatus(codigo, { status: status || detalhe || 'ok', quando });
  return { codigo, status: status || detalhe || 'ok', fonte: 'correios' };
}

async function atualizarStatusVipp(envioId, idVipp) {
  if (!VIPP_TOKEN) {
    throw new Error('VIPP_TOKEN não configurado');
  }

  const soapXml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ListarRastreioObjeto xmlns="http://www.visualset.inf.br/">
      <ListarRastreio>
        <PerfilVipp>
          <Usuario>${escXml(VIPP_USUARIO)}</Usuario>
          <Token>${escXml(VIPP_TOKEN)}</Token>
          <IdPerfil>${escXml(VIPP_ID_PERFIL)}</IdPerfil>
        </PerfilVipp>
        <IdConhecimento>${escXml(idVipp)}</IdConhecimento>
      </ListarRastreio>
    </ListarRastreioObjeto>
  </soap:Body>
</soap:Envelope>`;

  const resp = await axios.post(VIPP_ENDPOINT, soapXml, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '"http://www.visualset.inf.br/ListarRastreioObjeto"',
    },
    timeout: 15000,
  });

  const raw = String(resp.data || '');
  const etiquetaPostagem = extrairTag(raw, 'EtiquetaPostagem');
  const nomeStatusEvento = extrairTag(raw, 'NomeGrupoStatusEvento');
  const statusSolicitacao = extrairTag(raw, 'StatusSolicitacao');

  if (extrairTag(raw, 'Message') && !etiquetaPostagem) {
    throw new Error(extrairTag(raw, 'Message') || 'Erro VIPP');
  }

  const statusParaSalvar = (nomeStatusEvento && !STATUS_VIPP_INVALIDOS.has(nomeStatusEvento))
    ? nomeStatusEvento
    : (statusSolicitacao && !STATUS_VIPP_INVALIDOS.has(statusSolicitacao) ? statusSolicitacao : null);

  if (statusParaSalvar) {
    await dbQuery(
      `UPDATE envios.solicitacoes
          SET rastreio_status = $1,
              rastreio_quando = NOW(),
              identificacao   = COALESCE(NULLIF(identificacao, ''), $2)
        WHERE id = $3`,
      [statusParaSalvar, etiquetaPostagem || null, Number(envioId)]
    );
  }

  const codigoEct = sanitizeCodigo(etiquetaPostagem);
  if (codigoEct && ECT_RE.test(codigoEct)) {
    try {
      await consultarCorreios(codigoEct);
    } catch (err) {
      console.warn(TAG, `VIPP ok, Correios falhou envio #${envioId}:`, err?.message || err);
    }
  }

  return { envioId, status: statusParaSalvar || '(sem mudança)', fonte: 'vipp' };
}

async function executarAtualizacaoRastreioEnvios() {
  console.log(TAG, 'Atualização automática desativada — fluxo encerra em Enviado.');
  return { total: 0, ok: 0, ignorados: 0, erros: 0, detalhesErros: [] };
}

async function jaRodouHoje(hoje) {
  try {
    const { rows } = await dbQuery(
      `SELECT valor FROM public.cron_control WHERE chave = 'rastreio_envios_ultima_execucao'`
    );
    return rows[0]?.valor === hoje;
  } catch {
    return false;
  }
}

async function marcarRodouHoje(hoje) {
  try {
    await dbQuery(
      `INSERT INTO public.cron_control (chave, valor)
       VALUES ('rastreio_envios_ultima_execucao', $1)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
      [hoje]
    );
  } catch {
    // tabela pode não existir em ambientes antigos
  }
}

let _lastRunDate = null;
const HORA_ALVO_RASTREIO = 7; // 07:00 Brasília
const MINUTO_MAX_RASTREIO = 4;
const FUSO_BRASILIA = 'America/Sao_Paulo';

function getDataHoraBrasilia() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_BRASILIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const pick = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  const y = pick('year');
  const m = String(pick('month')).padStart(2, '0');
  const d = String(pick('day')).padStart(2, '0');

  return {
    hoje: `${y}-${m}-${d}`,
    hora: pick('hour'),
    minuto: pick('minute'),
  };
}

function verificarHorarioAtualizacaoRastreio() {
  const { hoje, hora, minuto } = getDataHoraBrasilia();

  if (hora !== HORA_ALVO_RASTREIO || minuto > MINUTO_MAX_RASTREIO || _lastRunDate === hoje) {
    return;
  }

  _lastRunDate = hoje;
  jaRodouHoje(hoje)
    .then((jaRodou) => {
      if (jaRodou) {
        console.log(TAG, `Atualização já executada hoje (${hoje}) — ignorando.`);
        return null;
      }
      return marcarRodouHoje(hoje).then(() => executarAtualizacaoRastreioEnvios());
    })
    .catch((err) => {
      console.error(TAG, 'Erro no timer diário:', err?.message || err);
    });
}

function iniciarCronAtualizacaoRastreio() {
  console.log(TAG, 'Cron de rastreio desativado — fluxo encerra em Enviado.');
}

module.exports = {
  executarAtualizacaoRastreioEnvios,
  jaRodouHoje,
  marcarRodouHoje,
  iniciarCronAtualizacaoRastreio,
};
