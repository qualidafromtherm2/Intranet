'use strict';

/**
 * E-mail ao setor Compras quando uma requisição cai no kanban Requisições
 * (após IncluirReq na Omie). Mesmo SMTP das reservas (utils/mailer.js).
 */

const { dbQuery } = require('../src/db');
const { smtpConfigurado, enviarEmail } = require('./mailer');

function normalizarEmail(valor) {
  const email = String(valor || '').trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function escaparHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function contentTypePorNome(nome, tipoInformado) {
  const informado = String(tipoInformado || '').trim();
  if (informado) return informado;
  const lower = String(nome || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

function parseAnexosJson(raw) {
  if (!raw) return [];
  let arr = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch (_) {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((a) => ({
      nome: String(a?.nome || a?.filename || a?.name || 'anexo').trim() || 'anexo',
      url: String(a?.url || a?.href || '').trim(),
      tipo: String(a?.tipo || a?.mime || a?.contentType || '').trim() || null,
    }))
    .filter((a) => a.url && /^https?:\/\//i.test(a.url));
}

function parseLinksSoltos(raw) {
  const texto = String(raw || '').trim();
  if (!texto) return [];
  return texto
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s))
    .map((url, idx) => ({
      nome: `anexo_url_${idx + 1}`,
      url,
      tipo: null,
    }));
}

async function obterEmailsSetorCompras() {
  const { rows } = await dbQuery(
    `SELECT u.username, u.email
       FROM public.auth_user u
       INNER JOIN public.auth_user_profile up ON up.user_id = u.id
       INNER JOIN public.auth_sector s ON s.id = up.sector_id
      WHERE LOWER(TRIM(s.name)) = 'compras'
        AND COALESCE(u.is_active, TRUE) = TRUE`
  );

  const emails = [];
  const seen = new Set();
  for (const r of rows) {
    const email = normalizarEmail(r.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

async function carregarItensRequisicao(origem, itemIds) {
  const ids = Array.from(
    new Set((itemIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))
  );
  if (!ids.length) return [];

  const tabela =
    origem === 'compras_sem_cadastro'
      ? 'compras.compras_sem_cadastro'
      : 'compras.solicitacao_compras';

  const temAnexoUrl = origem !== 'compras_sem_cadastro';
  const { rows } = await dbQuery(
    `SELECT id,
            produto_codigo,
            produto_descricao,
            quantidade,
            solicitante,
            departamento,
            objetivo_compra,
            grupo_requisicao,
            anexos
            ${temAnexoUrl ? ', anexo_url' : ', NULL::text AS anexo_url'}
       FROM ${tabela}
      WHERE id = ANY($1::int[])
      ORDER BY id`,
    [ids]
  );
  return rows;
}

async function baixarAnexo({ nome, url, tipo }) {
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ao baixar ${url}`);
  }
  const ab = await resp.arrayBuffer();
  const content = Buffer.from(ab);
  const contentType =
    contentTypePorNome(nome, tipo) ||
    String(resp.headers.get('content-type') || '').split(';')[0].trim() ||
    'application/octet-stream';
  let filename = nome;
  if (!/\.[a-z0-9]{2,5}$/i.test(filename)) {
    const pathPart = String(url).split('?')[0].split('/').pop() || '';
    if (pathPart && /\.[a-z0-9]{2,5}$/i.test(pathPart)) filename = pathPart;
  }
  return { filename, content, contentType };
}

function coletarAnexosDosItens(itens) {
  const lista = [];
  const seen = new Set();
  for (const item of itens) {
    const doJson = parseAnexosJson(item.anexos);
    const doUrl = parseLinksSoltos(item.anexo_url);
    for (const a of [...doJson, ...doUrl]) {
      const key = a.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lista.push(a);
    }
  }
  return lista;
}

function montarTexto(payload, itens, anexosOk, anexosFalha) {
  const linhas = [
    'Nova requisição de compra na Omie (kanban Requisições)',
    '',
    `Número pedido (interno): ${payload.numeroPedido || '-'}`,
    `Código Omie (ncodped): ${payload.ncodped || '-'}`,
    `Nº requisição Omie: ${payload.numeroRequisicaoOmie || '-'}`,
    `Origem: ${payload.origem === 'compras_sem_cadastro' ? 'Produto sem cadastro' : 'Solicitação de compra'}`,
    '',
    'Itens:',
  ];
  for (const it of itens) {
    linhas.push(
      `- [${it.id}] ${it.produto_codigo || '-'} | ${it.produto_descricao || '-'} | qtd ${it.quantidade ?? '-'} | solicitante ${it.solicitante || '-'}`
    );
  }
  if (itens[0]?.objetivo_compra) {
    linhas.push('', `Objetivo: ${itens[0].objetivo_compra}`);
  }
  if (itens[0]?.departamento) {
    linhas.push(`Departamento: ${itens[0].departamento}`);
  }
  if (itens[0]?.grupo_requisicao) {
    linhas.push(`Grupo: ${itens[0].grupo_requisicao}`);
  }
  if (anexosOk.length) {
    linhas.push('', `Anexos neste e-mail: ${anexosOk.map((a) => a.filename).join(', ')}`);
  } else {
    linhas.push('', 'Anexos neste e-mail: nenhum');
  }
  if (anexosFalha.length) {
    linhas.push(`Anexos com falha no download: ${anexosFalha.join(', ')}`);
  }
  linhas.push('', '— Intranet Fromtherm');
  return linhas.join('\n');
}

function montarHtml(payload, itens, anexosOk, anexosFalha) {
  const row = (label, value) =>
    value
      ? `<tr><td style="padding:4px 12px 4px 0;color:#555;vertical-align:top;">${escaparHtml(label)}</td><td style="padding:4px 0;">${value}</td></tr>`
      : '';

  const itensHtml = itens
    .map(
      (it) =>
        `<li><strong>${escaparHtml(it.produto_codigo || '-')}</strong> — ${escaparHtml(it.produto_descricao || '-')} (qtd ${escaparHtml(it.quantidade ?? '-')}) · ${escaparHtml(it.solicitante || '-')}</li>`
    )
    .join('');

  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;line-height:1.45;">
  <h2 style="margin:0 0 12px;font-size:18px;">Nova requisição de compra (Requisições)</h2>
  <table style="border-collapse:collapse;">
    ${row('Nº pedido interno', escaparHtml(payload.numeroPedido || '-'))}
    ${row('Código Omie (ncodped)', escaparHtml(payload.ncodped || '-'))}
    ${row('Nº requisição Omie', escaparHtml(payload.numeroRequisicaoOmie || '-'))}
    ${row('Origem', payload.origem === 'compras_sem_cadastro' ? 'Produto sem cadastro' : 'Solicitação de compra')}
    ${row('Departamento', escaparHtml(itens[0]?.departamento || ''))}
    ${row('Grupo', escaparHtml(itens[0]?.grupo_requisicao || ''))}
    ${row('Objetivo', escaparHtml(itens[0]?.objetivo_compra || ''))}
  </table>
  <p style="margin:14px 0 6px;"><strong>Itens</strong></p>
  <ul style="margin:0;padding-left:18px;">${itensHtml || '<li>—</li>'}</ul>
  <p style="margin:14px 0 0;">Anexos neste e-mail: ${
    anexosOk.length ? escaparHtml(anexosOk.map((a) => a.filename).join(', ')) : 'nenhum'
  }</p>
  ${
    anexosFalha.length
      ? `<p style="margin:6px 0 0;color:#a00;">Falha ao baixar: ${escaparHtml(anexosFalha.join(', '))}</p>`
      : ''
  }
  <p style="margin-top:16px;color:#888;font-size:12px;">Intranet Fromtherm</p>
</div>`;
}

async function emailRequisicaoEstaAtivo() {
  try {
    const { rows } = await dbQuery(
      `SELECT valor
         FROM compras.config_sistema
        WHERE chave = 'email_requisicao_ativo'
        LIMIT 1`
    );
    if (!rows.length) return true; // padrão: ativo (até existir config)
    const raw = String(rows[0]?.valor ?? 'true').trim().toLowerCase();
    return !['false', '0', 'off', 'nao', 'não', 'desativado'].includes(raw);
  } catch (err) {
    // Tabela ainda não criada / falha de leitura → não bloqueia envio
    console.warn('[ComprasReqEmail] Não foi possível ler config_sistema:', err?.message || err);
    return true;
  }
}

/**
 * Avisa usuários do setor Compras após criar requisição na Omie.
 * Não bloqueia o fluxo de compras se SMTP/anexo falhar.
 */
async function notificarRequisicaoComprasCriada({
  origem = 'solicitacao_compras',
  itemIds = [],
  numeroPedido = null,
  ncodped = null,
  numeroRequisicaoOmie = null,
} = {}) {
  if (!(await emailRequisicaoEstaAtivo())) {
    console.log('[ComprasReqEmail] Envio desativado na Configuração de Compras — pulando.');
    return { ok: false, skipped: true, reason: 'email_desativado_config' };
  }

  if (!smtpConfigurado()) {
    console.warn('[ComprasReqEmail] SMTP não configurado — pulando aviso de requisição.');
    return { ok: false, skipped: true, reason: 'smtp_nao_configurado' };
  }

  const emails = await obterEmailsSetorCompras();
  if (!emails.length) {
    console.warn('[ComprasReqEmail] Nenhum e-mail de usuário com Setor = Compras.');
    return { ok: false, skipped: true, reason: 'sem_emails_setor_compras' };
  }

  const itens = await carregarItensRequisicao(origem, itemIds);
  if (!itens.length) {
    console.warn('[ComprasReqEmail] Nenhum item encontrado para notificar.', { origem, itemIds });
    return { ok: false, skipped: true, reason: 'sem_itens' };
  }

  const anexosMeta = coletarAnexosDosItens(itens);
  const attachments = [];
  const anexosFalha = [];
  for (const a of anexosMeta) {
    try {
      attachments.push(await baixarAnexo(a));
    } catch (err) {
      anexosFalha.push(a.nome || a.url);
      console.warn('[ComprasReqEmail] Falha ao baixar anexo:', a.url, err?.message || err);
    }
  }

  const payload = { origem, numeroPedido, ncodped, numeroRequisicaoOmie };
  const subject = `[Compras] Requisição Omie ${numeroRequisicaoOmie || ncodped || numeroPedido || ''} — ${itens[0].produto_codigo || 'itens'}`.trim();

  const info = await enviarEmail({
    to: emails,
    subject,
    text: montarTexto(payload, itens, attachments, anexosFalha),
    html: montarHtml(payload, itens, attachments, anexosFalha),
    attachments,
  });

  console.log(
    `[ComprasReqEmail] Requisição ${numeroPedido || ncodped || '-'} → ${emails.length} destinatário(s), ` +
      `${attachments.length} anexo(s)`
  );
  return { ok: true, to: info.to, anexos: attachments.length, anexosFalha };
}

module.exports = {
  obterEmailsSetorCompras,
  notificarRequisicaoComprasCriada,
};
