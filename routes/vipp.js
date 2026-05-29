// routes/vipp.js — Integração VIPP VisualSet (Correios / PostarObjeto SOAP)
'use strict';

const express = require('express');
const axios   = require('axios');
const { dbQuery } = require('../src/db');
const Jimp        = require('jimp');

const router = express.Router();

// ── Credenciais (variáveis de ambiente; padrão = homologação VisualSet) ───────
const VIPP_USUARIO   = process.env.VIPP_USUARIO   || 'onbiws';
const VIPP_TOKEN     = String(process.env.VIPP_TOKEN || '').trim();
const VIPP_ID_PERFIL = process.env.VIPP_ID_PERFIL || '9363';
const VIPP_ENDPOINT  = 'http://vpsrv.visualset.com.br/PostagemVipp.asmx';
const VIPP_IMPRESSAO = 'https://vipp.visualset.com.br/vipp/remoto/ImpressaoRemota.php';
const VIPP_WEB_URL   = 'https://vipp.visualset.com.br';
const VIPP_REMETENTE_PADRAO = Object.freeze({
  nome: process.env.VIPP_REMETENTE_NOME || 'FROM THERM',
  documento: String(process.env.VIPP_REMETENTE_DOCUMENTO || '12659566000109').replace(/\D/g, ''),
  endereco: process.env.VIPP_REMETENTE_ENDERECO || 'RUA JOSE AGENOR DA LUZ',
  numero: process.env.VIPP_REMETENTE_NUMERO || '0',
  bairro: process.env.VIPP_REMETENTE_BAIRRO || 'REAL PARQUE',
  cidade: process.env.VIPP_REMETENTE_CIDADE || 'SAO JOSE',
  uf: process.env.VIPP_REMETENTE_UF || 'SC',
  cep: process.env.VIPP_REMETENTE_CEP || '88113-317',
});

// URLs dos logos para etiqueta ZPL (carregados e cacheados na primeira impressão)
const LOGO_EMPRESA_URL  = 'https://pxhbginkisinegzupqcy.supabase.co/storage/v1/object/public/compras-anexos/favicons/logo_guia_20260323.png';
const LOGO_EXPRESSA_URL = 'https://pxhbginkisinegzupqcy.supabase.co/storage/v1/object/public/compras-anexos/favicons/expressa_logo.png';
const LOGO_CORREIOS_URL = 'https://pxhbginkisinegzupqcy.supabase.co/storage/v1/object/public/compras-anexos/favicons/Logo_Correios.png';
const _gfCache = new Map();

// ── Cache SQL compartilhado (etiqueta.vipp_situacao_cache) e rate-limit ──────
const VIPP_CACHE_TTL_MS    = Number(process.env.VIPP_CACHE_TTL_MS    || 6 * 60 * 60 * 1000);  // 6h
const VIPP_RATE_LIMIT_HINTS = [
  /limite\s+gratuito/i,
  /di[áa]rio\s+atingido/i,
  /quota\s+excedida/i,
  /requisi[çc][õo]es\s+excedidas/i,
];

function _eDiaSeguinteBR() {
  // proximo dia 00:00:00 horario Sao Paulo (UTC-3, sem DST atual)
  const agora = new Date();
  const utc = agora.getTime() + agora.getTimezoneOffset() * 60000;
  const br  = new Date(utc - 3 * 60 * 60 * 1000);
  br.setHours(24, 0, 0, 0);
  return new Date(br.getTime() + 3 * 60 * 60 * 1000);
}

function _ehErroRateLimitVipp(err) {
  if (!err) return false;
  const status = err?.response?.status;
  if (status === 402 || status === 429) return true;
  const msg = String(err?.message || err || '');
  return VIPP_RATE_LIMIT_HINTS.some(rx => rx.test(msg));
}

async function _vippGetRateLimit(endpoint) {
  try {
    const { rows } = await dbQuery(
      `SELECT bloqueado_ate, motivo, http_status
         FROM etiqueta.vipp_rate_limit
        WHERE endpoint = $1
          AND bloqueado_ate IS NOT NULL
          AND bloqueado_ate > now()
        LIMIT 1`,
      [endpoint]
    );
    return rows[0] || null;
  } catch (err) {
    console.warn('[VIPP] _vippGetRateLimit falhou:', err.message);
    return null;
  }
}

async function _vippMarcarRateLimit(endpoint, err) {
  try {
    const status = err?.response?.status || null;
    const motivo = String(err?.message || 'rate limit').slice(0, 500);
    const ate = _eDiaSeguinteBR();
    await dbQuery(
      `INSERT INTO etiqueta.vipp_rate_limit (endpoint, bloqueado_ate, motivo, http_status, detectado_em, atualizado_em)
       VALUES ($1, $2, $3, $4, now(), now())
       ON CONFLICT (endpoint) DO UPDATE
         SET bloqueado_ate = EXCLUDED.bloqueado_ate,
             motivo        = EXCLUDED.motivo,
             http_status   = EXCLUDED.http_status,
             atualizado_em = now()`,
      [endpoint, ate, motivo, status]
    );
    console.warn(`[VIPP] rate-limit registrado em ${endpoint} ate ${ate.toISOString()}: ${motivo}`);
  } catch (e) {
    console.warn('[VIPP] _vippMarcarRateLimit falhou:', e.message);
  }
}

async function _vippCacheGet(etiqueta) {
  try {
    const { rows } = await dbQuery(
      `UPDATE etiqueta.vipp_situacao_cache
          SET hits = hits + 1,
              ultima_consulta = now()
        WHERE etiqueta = $1
          AND expira_em > now()
        RETURNING dados, fonte`,
      [etiqueta]
    );
    return rows[0] || null;
  } catch (err) {
    console.warn('[VIPP] _vippCacheGet falhou:', err.message);
    return null;
  }
}

async function _vippCacheSet(etiqueta, dados, fonte = 'soap', ttlMs = VIPP_CACHE_TTL_MS) {
  try {
    await dbQuery(
      `INSERT INTO etiqueta.vipp_situacao_cache (etiqueta, dados, fonte, capturado_em, expira_em, ultima_consulta, hits)
       VALUES ($1, $2::jsonb, $3, now(), now() + ($4 || ' milliseconds')::interval, now(), 0)
       ON CONFLICT (etiqueta) DO UPDATE
         SET dados           = EXCLUDED.dados,
             fonte           = EXCLUDED.fonte,
             capturado_em    = now(),
             expira_em       = EXCLUDED.expira_em,
             ultima_consulta = now()`,
      [etiqueta, JSON.stringify(dados || {}), fonte, String(ttlMs)]
    );
  } catch (err) {
    console.warn('[VIPP] _vippCacheSet falhou:', err.message);
  }
}

// ── Sessão web VIPP (PHP session para GerarPPN) ───────────────────────────────
let _vippWebSession = { cookie: null, expiresAt: 0 };

async function getVippWebSession() {
  if (_vippWebSession.cookie && Date.now() < _vippWebSession.expiresAt) {
    return _vippWebSession.cookie;
  }

  const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  // Passo 1: GET /vipp/login/login.php → 302 para /vipp/inicio/index.php + Set-Cookie PHPSESSID
  const r1 = await axios.get(`${VIPP_WEB_URL}/vipp/login/login.php`, {
    timeout: 15000,
    maxRedirects: 0,
    validateStatus: () => true,
    headers: { 'User-Agent': UA },
  });

  const setCookieHdr = [].concat(r1.headers['set-cookie'] || []);
  const sessionCookie = setCookieHdr
    .map(c => (c || '').match(/PHPSESSID=([^;]+)/)?.[1])
    .find(Boolean);

  if (!sessionCookie) throw new Error('[VIPP] Falha ao obter sessão inicial de login');

  // Passo 2: POST /vipp/inicio/index.php com credenciais (endpoint correto do formulário de login)
  const formBody = new URLSearchParams({
    txtUsr: VIPP_USUARIO,
    txtPwd: VIPP_TOKEN,
  }).toString();

  const r2 = await axios.post(`${VIPP_WEB_URL}/vipp/inicio/index.php`, formBody, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': `PHPSESSID=${sessionCookie}`,
      'User-Agent': UA,
      'Origin': VIPP_WEB_URL,
      'Referer': `${VIPP_WEB_URL}/vipp/inicio/index.php`,
    },
    maxRedirects: 0,
    validateStatus: s => s >= 200 && s < 400,
    timeout: 15000,
  });

  // Sucesso: redireciona para login/index.php (dashboard); falha: redireciona para login.php ou outro
  const loc = (r2.headers['location'] || '').toLowerCase();
  if (!loc.includes('login/index.php')) {
    throw new Error(`[VIPP] Login web falhou — redirecionou para: ${r2.headers['location']}`);
  }

  _vippWebSession = { cookie: `PHPSESSID=${sessionCookie}`, expiresAt: Date.now() + 25 * 60 * 1000 };
  console.log('[VIPP] Sessão web criada (PHPSESSID obtido)');
  return _vippWebSession.cookie;
}

// ── Aloca código ECT dos Correios para uma postagem via GerarPPN.php ──────────
async function gerarECT(idConhecimento) {
  const cookie = await getVippWebSession();
  const r = await axios.post(
    `${VIPP_WEB_URL}/vipp/entradadados/digitacao/GerarPPN.php`,
    new URLSearchParams({ IdxCto: String(idConhecimento) }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      timeout: 20000,
    }
  );
  const d = r.data;
  if (!d) throw new Error('[VIPP] Resposta vazia de GerarPPN');

  // Sucesso normal: Sts=1 e Etq preenchida
  if (d.Sts === 1 && d.Etq) return d.Etq;

  // PPN já gerada anteriormente: extrai ECT da mensagem
  if ((d.Sts === 0 || d.Sts === 1) && typeof d.Msg === 'string') {
    const ectMatch = d.Msg.match(/([A-Z]{2}\d{8,9}[A-Z]{2})/);
    if (ectMatch) return ectMatch[1];
  }

  // Falha de autenticação: invalida cache e propaga erro
  if (d?.Msg === 'Usuario Nao Logado') {
    _vippWebSession = { cookie: null, expiresAt: 0 };
    throw new Error('[VIPP] Sessão expirada — tente novamente');
  }

  throw new Error(`[VIPP] Falha ao gerar ECT: Sts=${d?.Sts} Msg=${d?.Msg}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escXml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function extrairTag(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m ? m[1].trim() : '';
}

function decodeXmlEntities(xml) {
  return String(xml || '')
    .replace(/&lt;/g,  '<')
    .replace(/&gt;/g,  '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ── Monta XML SOAP de LiberarDownloadConhecimento ────────────────────────────
function buildSoapLiberar(etiqueta) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <LiberarDownloadConhecimento xmlns="http://www.visualset.inf.br/">
      <LiberarPostagem>
        <PerfilVipp>
          <Usuario>${escXml(VIPP_USUARIO)}</Usuario>
          <Token>${escXml(VIPP_TOKEN)}</Token>
          <IdPerfil>${escXml(VIPP_ID_PERFIL)}</IdPerfil>
        </PerfilVipp>
        <Etiqueta>${escXml(etiqueta)}</Etiqueta>
        <StLiberado>1</StLiberado>
      </LiberarPostagem>
    </LiberarDownloadConhecimento>
  </soap:Body>
</soap:Envelope>`;
}

function buildSoapSituacaoPostagem(listaObjetos = [], buscarPor = 'EtiquetaPostagem', stDadosCompletos = '1') {
  const listaXml = ([]).concat(listaObjetos || [])
    .filter(Boolean)
    .map(obj => `<string>${escXml(obj)}</string>`)
    .join('');

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <SituacaoPostagem xmlns="http://www.visualset.inf.br/">
      <Usuario>${escXml(VIPP_USUARIO)}</Usuario>
      <Senha>${escXml(VIPP_TOKEN)}</Senha>
      <StDadosCompletos>${escXml(String(stDadosCompletos))}</StDadosCompletos>
      <BuscarPor>${escXml(buscarPor)}</BuscarPor>
      <ListaObjeto>${listaXml}</ListaObjeto>
    </SituacaoPostagem>
  </soap:Body>
</soap:Envelope>`;
}

// ── Tenta liberar postagem no VIPP (silencioso — não bloqueia o fluxo) ────────
async function tentarLiberar(etiqueta) {
  if (!etiqueta) return;
  try {
    const xml = buildSoapLiberar(etiqueta);
    const resp = await axios.post(VIPP_ENDPOINT, xml, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction':   '"http://www.visualset.inf.br/LiberarDownloadConhecimento"',
      },
      timeout: 15000,
    });
    const raw = String(resp.data || '');
    const stLib = extrairTag(raw, 'StLiberado');
    console.log('[VIPP] LiberarDownload:', etiqueta, '→ StLiberado:', stLib);
  } catch (e) {
    console.warn('[VIPP] LiberarDownload falhou (silencioso):', e.message);
  }
}

// ── Monta XML SOAP de PostarObjeto ────────────────────────────────────────────
function buildSoap(p) {
  const dest = p.destinatario || {};
  const vol  = p.volume       || {};
  const nf   = p.notaFiscal   || {};
  const decl = p.declaracaoConteudo;

  // Nota Fiscal (opcional) — converte data YYYY-MM-DD → DD/MM/YYYY exigido pelo VIPP
  const dtNf = nf.data ? nf.data.split('-').reverse().join('/') : '';
  const nfXml = nf.numero ? `
        <NotasFiscais>
          <NotaFiscal>
            <DtNotaFiscal>${escXml(dtNf)}</DtNotaFiscal>
            <SerieNotaFiscal>${escXml(nf.serie)}</SerieNotaFiscal>
            <NrNotaFiscal>${escXml(nf.numero)}</NrNotaFiscal>
            <VlrTotalNota>${escXml(nf.valor)}</VlrTotalNota>
          </NotaFiscal>
        </NotasFiscais>` : '';

  // Declaração de Conteúdo — inclui itens quando enviados pelo frontend.
  // Nota: o adicional 0DE NÃO é adicionado explicitamente; o VIPP aceita <DeclaracaoConteudo>
  // sem ele para o serviço 03220-SEDEX (validado em teste direto, postagem 634894407).
  // Schema WSDL: ItemConteudo.DescricaoConteudo + Quantidade + Valor; itens em ArrayOfItemConteudo
  let declXml = '';
  if (decl && Array.isArray(decl.itens) && decl.itens.length) {
    const itensXml = decl.itens.map(it =>
      `<ItemConteudo><DescricaoConteudo>${escXml(it.descricao)}</DescricaoConteudo><Quantidade>${escXml(String(it.quantidade))}</Quantidade><Valor>${escXml(String(it.valor))}</Valor></ItemConteudo>`
    ).join('');
    declXml = `\n            <DeclaracaoConteudo><DocumentoRemetente>${escXml(decl.docRemetente || '')}</DocumentoRemetente><DocumentoDestinatario>${escXml(decl.docDestinatario || '')}</DocumentoDestinatario><PesoTotal>${escXml(String(decl.pesoTotal || ''))}</PesoTotal><ItemConteudo>${itensXml}</ItemConteudo></DeclaracaoConteudo>`;
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <PostarObjeto xmlns="http://www.visualset.inf.br/">
      <PostagemVipp>
        <PerfilVipp>
          <Usuario>${escXml(VIPP_USUARIO)}</Usuario>
          <Token>${escXml(VIPP_TOKEN)}</Token>
          <IdPerfil>${escXml(VIPP_ID_PERFIL)}</IdPerfil>
        </PerfilVipp>
        <Destinatario>
          <CnpjCpf>${escXml(dest.cnpjCpf)}</CnpjCpf>
          <Nome>${escXml(dest.nome)}</Nome>
          <Endereco>${escXml(dest.endereco)}</Endereco>
          <Numero>${escXml(dest.numero)}</Numero>
          <Complemento>${escXml(dest.complemento)}</Complemento>
          <Bairro>${escXml(dest.bairro)}</Bairro>
          <Cidade>${escXml(dest.cidade)}</Cidade>
          <UF>${escXml(dest.uf)}</UF>
          <Cep>${escXml(dest.cep)}</Cep>
          <Telefone>${escXml(dest.telefone)}</Telefone>
          <Email>${escXml(dest.email)}</Email>
        </Destinatario>
        <Servico>
          <ServicoECT>${escXml(p.servico)}</ServicoECT>
        </Servico>${nfXml}
        <Volumes>
          <VolumeObjeto>
            <Peso>${escXml(vol.peso)}</Peso>
            <Altura>${escXml(vol.altura)}</Altura>
            <Largura>${escXml(vol.largura)}</Largura>
            <Comprimento>${escXml(vol.comprimento)}</Comprimento>
            <ObservacaoVisual>${escXml(p.observacao)}</ObservacaoVisual>
            <Conteudo>${escXml(vol.conteudo)}</Conteudo>${declXml}
          </VolumeObjeto>
        </Volumes>
      </PostagemVipp>
    </PostarObjeto>
  </soap:Body>
</soap:Envelope>`;
}

// ── POST /api/vipp/postar ─────────────────────────────────────────────────────
router.post('/postar', async (req, res) => {
  try {
    const payload = req.body;

    if (!payload || !payload.destinatario || !payload.destinatario.nome) {
      return res.status(400).json({ ok: false, error: 'Payload inválido: destinatario.nome obrigatório.' });
    }

    const soapXml = buildSoap(payload);

    const vippResp = await axios.post(VIPP_ENDPOINT, soapXml, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction':   '"http://www.visualset.inf.br/PostarObjeto"',
      },
      timeout: 30000,
      validateStatus: () => true, // Captura 4xx do VIPP como resposta normal para extrair erros
    });

    if (vippResp.status !== 200) {
      console.warn('[VIPP] HTTP', vippResp.status, '— processando erros da resposta SOAP...');
    }

    const rawResp = String(vippResp.data || '');

    // Extrai o conteúdo de PostarObjetoResult (pode vir XML-escaped ou raw)
    const resultRaw = extrairTag(rawResp, 'PostarObjetoResult');
    // Decodifica entidades XML caso o resultado venha escapado
    const resultXml = resultRaw
      .replace(/&lt;/g,  '<')
      .replace(/&gt;/g,  '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");

    const xmlParaDump = resultXml || rawResp;

    // Extrai etiqueta (código de rastreio Correios)
    const etiqueta = extrairTag(xmlParaDump, 'Etiqueta') ||
                     extrairTag(xmlParaDump, 'CodigoBarraVolume') ||
                     extrairTag(xmlParaDump, 'Registro');

    // Status da postagem
    const stPostagem         = extrairTag(xmlParaDump, 'StPostagem') || extrairTag(xmlParaDump, 'StatusPostagem');
    const idStatus           = extrairTag(xmlParaDump, 'IdStatusPostagem');
    const idConhecimento     = extrairTag(xmlParaDump, 'IdConhecimento');
    const nrEtiquetaPostagem = extrairTag(xmlParaDump, 'NrEtiquetaPostagem');

    // Erros — extrai da seção <ListaErros> para evitar capturar <DescricaoConteudo>
    const erros = [];
    const listaErrosXml = extrairTag(xmlParaDump, 'ListaErros');
    if (listaErrosXml) {
      const erroBlocks = listaErrosXml.matchAll(/<Erro>([\s\S]*?)<\/Erro>/gi);
      for (const m of erroBlocks) {
        const bloco = m[1];
        const attr = bloco.match(/<Atributo[^>]*>([^<]*)<\/Atributo>/i)?.[1] || '';
        const desc = bloco.match(/<Descricao[^>]*>([^<]*)<\/Descricao>/i)?.[1]
                  || bloco.match(/<DescricaoTipoErro[^>]*>([^<]*)<\/DescricaoTipoErro>/i)?.[1] || '';
        const msg = [attr && `[${attr}]`, desc].filter(Boolean).join(': ');
        if (msg) erros.push(msg);
      }
    }

    // Sucesso: com etiqueta explícita OU status "Valida" sem erros
    const statusValida = /valida/i.test(stPostagem);
    if (etiqueta || (statusValida && erros.length === 0)) {
      console.log('[VIPP] Postagem criada. IdConhecimento:', idConhecimento, '| Etiqueta:', etiqueta || '(aguardando)');

      // Tenta auto-liberar usando o identificador disponível (fire-and-forget)
      tentarLiberar(etiqueta || idConhecimento);

      return res.json({ ok: true, etiqueta: etiqueta || null, idConhecimento, stPostagem, idStatus, rawXml: xmlParaDump });
    }

    // Sem status válido = falha
    console.warn('[VIPP] Postagem rejeitada. Status:', idStatus, '| Erros:', erros);
    return res.json({
      ok:    false,
      erros: erros.length ? erros : ['VIPP rejeitou a postagem. Verifique os dados.'],
      stPostagem,
      idStatus,
      idConhecimento,
      rawXml: xmlParaDump,
    });

  } catch (err) {
    const detail = err.response?.data ? String(err.response.data).substring(0, 1500) : err.message;
    console.error('[VIPP] Erro ao chamar PostarObjeto:', err.message);
    if (err.response?.data) console.error('[VIPP] Response body:', String(err.response.data).substring(0, 1500));
    return res.status(502).json({ ok: false, error: 'Falha ao conectar com VIPP', detail });
  }
});

// ── GET /api/vipp/status ──────────────────────────────────────────────────────
// Consulta ListarRastreioObjeto para retornar o status atual de uma postagem.
// Query params:
//   id — IdConhecimento numérico
//
router.get('/status', async (req, res) => {
  const { id, envio_id } = req.query;
  if (!id) return res.status(400).json({ ok: false, error: 'Parâmetro id obrigatório' });

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
        <IdConhecimento>${escXml(id)}</IdConhecimento>
      </ListarRastreio>
    </ListarRastreioObjeto>
  </soap:Body>
</soap:Envelope>`;

  try {
    const resp = await axios.post(VIPP_ENDPOINT, soapXml, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction':   '"http://www.visualset.inf.br/ListarRastreioObjeto"',
      },
      timeout: 15000,
    });
    const raw = String(resp.data || '');
    const etiquetaPostagem     = extrairTag(raw, 'EtiquetaPostagem');
    const nomeStatusEvento     = extrairTag(raw, 'NomeGrupoStatusEvento');
    const idGrupoStatusEvento  = extrairTag(raw, 'IdGrupoStatusEvento');
    const stConhecimento       = extrairTag(raw, 'StConhecimento');
    const statusSolicitacao    = extrairTag(raw, 'StatusSolicitacao');

    if (extrairTag(raw, 'Message') && !etiquetaPostagem) {
      return res.json({ ok: false, error: extrairTag(raw, 'Message') });
    }

    // Persiste status no banco quando envio_id fornecido
    // 'Invalida' = postagem não liberada no VIPP ainda (não é status real)
    const STATUS_VIPP_INVALIDOS = ['Desconhecido', 'Invalida'];
    if (envio_id) {
      const statusParaSalvar = (nomeStatusEvento && !STATUS_VIPP_INVALIDOS.includes(nomeStatusEvento))
        ? nomeStatusEvento
        : (statusSolicitacao && !STATUS_VIPP_INVALIDOS.includes(statusSolicitacao) ? statusSolicitacao : null);
      if (statusParaSalvar) {
        try {
          await dbQuery(
            `UPDATE envios.solicitacoes
                SET rastreio_status = $1,
                    rastreio_quando = NOW(),
                    identificacao   = COALESCE(NULLIF(identificacao, ''), $2)
              WHERE id = $3`,
            [statusParaSalvar, etiquetaPostagem || null, Number(envio_id)]
          );
        } catch (e) {
          console.warn('[VIPP] falha ao persistir status:', e.message);
        }
      }
    }

    return res.json({
      ok:                  true,
      idConhecimento:      id,
      etiquetaPostagem:    etiquetaPostagem || null,
      temEtiqueta:         !!etiquetaPostagem,
      statusVipp:          nomeStatusEvento || 'Desconhecido',
      idGrupoStatusEvento: idGrupoStatusEvento || null,
      stConhecimento:      stConhecimento || null,
      statusSolicitacao:   statusSolicitacao || null,
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'Falha ao conectar com VIPP', detail: err.message });
  }
});

// ── GET /api/vipp/etiqueta ────────────────────────────────────────────────────
// Busca e retorna a etiqueta postal (PDF ou ZVP para Zebra) a partir do
// identificador retornado pelo PostarObjeto.
//
// Query params:
//   id    — IdConhecimento (numérico) ou Registro ECT (ex.: JS123456789BR)
//   saida — 0=ZVP Zebra  1=PDF A4 (padrão)  2=PDF 6x folha
//
// Filtros VIPP:
//   Filtro=4 → busca por IdConhecimento (número interno VIPP)
//   Filtro=1 → busca por Registro ECT (código Correios ex.: JS123456789BR)
//   Filtro=2 → busca por Etiqueta ViPP (identificador interno legado)
//
router.get('/etiqueta', async (req, res) => {
  const { id, saida = '1' } = req.query;
  if (!id) return res.status(400).json({ ok: false, error: 'Parâmetro id obrigatório' });

  // Mapa de erros VIPP retornados como status HTTP
  const errosVipp = {
    210: 'Usuário ou senha inválidos',
    211: 'Usuário bloqueado',
    214: 'Nenhum registro fornecido para busca',
    215: 'Etiqueta não encontrada — aguarde a liberação no VIPP',
    216: 'Erro ao processar (contate VisualSet)',
  };

  const tentarBuscar = async (filtroVal, lista) => {
    const params = new URLSearchParams({
      Usr:    VIPP_USUARIO,
      Pwd:    VIPP_TOKEN,
      Filtro: String(filtroVal),
      Ordem:  '1',
      Saida:  String(saida),
      Lista:  lista,
    });
    return axios.get(`${VIPP_IMPRESSAO}?${params}`, {
      responseType: 'arraybuffer',
      timeout: 30000,
      validateStatus: s => s === 200,
    });
  };

  // Detecta o tipo do id para escolher o Filtro correto:
  //   Filtro=2 → IdConhecimento numérico (ex.: 634865783) ou Etiqueta ViPP
  //             retorna 215 se o ECT ainda não foi atribuído (aguardar PLP)
  //   Filtro=1 → Registro ECT (ex.: JS123456789BR) — para reimpressão por código Correios
  const isIdConhecimento = /^\d+$/.test(id);
  const isRegistroECT   = /^[A-Z]{2}\d{9}BR$/i.test(id);
  const filtroInicial   = isRegistroECT ? '1' : '2';

  try {
    let resposta;

    // Primeira tentativa com o filtro detectado
    try {
      resposta = await tentarBuscar(filtroInicial, id);
    } catch (e1) {
      const s1 = e1.response?.status;
      if (s1 === 215 && isIdConhecimento) {
        // ECT ainda não atribuído: postagem liberada no VIPP mas PLP não gerada
        return res.json({
          ok: false,
          error: 'Etiqueta ainda não disponível. Acesse o VIPP Check List, selecione a postagem e clique em "Etiquetas Pré-postagem" para gerar a etiqueta.',
          codigoVipp: 215,
          aguardandoPLP: true,
        });
      }
      const msg = errosVipp[s1] || `VIPP erro ${s1 || e1.message}`;
      return res.json({ ok: false, error: msg, codigoVipp: s1 });
    }

    // Verifica se a resposta é um arquivo válido (deve ter conteúdo)
    const buf = Buffer.from(resposta.data);
    if (!buf.length) {
      return res.json({ ok: false, error: 'VIPP retornou arquivo vazio' });
    }

    console.log('[VIPP] Etiqueta retornada. id:', id, '| Saida:', saida, '| Bytes:', buf.length);

    const isPdf = saida === '1' || saida === '2';
    const ext   = isPdf ? 'pdf' : 'zvp';
    const ct    = isPdf ? 'application/pdf' : 'application/octet-stream';

    res.set('Content-Type', ct);
    res.set('Content-Disposition', `inline; filename="etiqueta-${id}.${ext}"`);
    res.set('Content-Length', buf.length);
    return res.send(buf);

  } catch (err) {
    console.error('[VIPP] Erro ao buscar etiqueta:', err.message);
    return res.status(502).json({ ok: false, error: 'Falha ao conectar com VIPP', detail: err.message });
  }
});

// ── POST /api/vipp/gerar-etiqueta ─────────────────────────────────────────────
// Aloca um código ECT dos Correios para uma postagem sem etiqueta, depois
// retorna o PDF de etiqueta pronto para impressão.
//
// Body JSON: { idConhecimento }
// Resposta:  PDF (application/pdf) + header X-ECT-Code com o código alocado
//
router.post('/gerar-etiqueta', async (req, res) => {
  const { idConhecimento, n_solic } = req.body;
  if (!idConhecimento) {
    return res.status(400).json({ ok: false, error: 'idConhecimento obrigatório' });
  }

  try {
    // 1. Alocar código ECT via VIPP web
    const ectCode = await gerarECT(idConhecimento);
    console.log(`[VIPP] ECT alocado: ${ectCode} → IdConhecimento=${idConhecimento}`);

    // 2. Registra código de rastreio + status na tabela envios.solicitacoes
    if (n_solic) {
      try {
        await dbQuery(
          `UPDATE envios.solicitacoes
              SET identificacao = $1,
                  status        = 'Em separação'
            WHERE numero_sep = $2`,
          [ectCode, n_solic]
        );
        console.log(`[VIPP] identificacao=${ectCode} registrado em envios.solicitacoes → SEP=${n_solic}`);

        // Pré-gera ZPL da declaração local (vipp_payload ja persistido),
        // evita 1ª impressão chamar API VIPP (cota baixa).
        try {
          const { rows: envRows } = await dbQuery(
            `SELECT id, identificacao, id_vipp, conteudo, observacao, declaracao_url,
                    numero_sep, chave_dce, vipp_payload
               FROM envios.solicitacoes
              WHERE numero_sep = $1
              LIMIT 1`,
            [n_solic]
          );
          if (envRows.length) {
            const env = envRows[0];
            if (!env.declaracao_url || !String(env.declaracao_url).trimStart().startsWith('^XA')) {
              const dadosLocais = _montarDadosDeclaracaoFallback(env);
              const faltantesLocais = _listarCamposObrigatoriosDeclaracao(dadosLocais);

              if (!faltantesLocais.length) {
                await _persistirDeclaracaoCache(env.id, dadosLocais, dadosLocais.chaveNfe || env.chave_dce || '');
                console.log(`[VIPP] declaracao_url pre-gerada localmente para envio id=${env.id}`);
              } else {
                const bloqueioSituacao = await _vippGetRateLimit('situacao_postagem');
                if (bloqueioSituacao) {
                  console.log(
                    `[VIPP] gerar-etiqueta: declaracao pendente para envio id=${env.id}; ` +
                    `faltantes locais: ${faltantesLocais.join(', ')}; ` +
                    `consulta SituacaoPostagem bloqueada ate ${new Date(bloqueioSituacao.bloqueado_ate).toISOString()}`
                  );
                } else {
                  const dados = await _resolverDadosDeclaracao(env, '[VIPP] gerar-etiqueta pre-cache', { exigirCamposObrigatorios: true });
                  await _persistirDeclaracaoCache(env.id, dados, dados.chaveNfe || env.chave_dce || '');
                  console.log(`[VIPP] declaracao_url pre-gerada para envio id=${env.id}`);
                }
              }
            }
          }
        } catch (e) {
          console.warn('[VIPP] gerar-etiqueta: falha ao pre-gerar declaracao:', e.message);
        }
      } catch (e) {
        console.warn('[VIPP] Falha ao atualizar envios.solicitacoes:', e.message);
      }
    }

    return res.json({ ok: true, ectCode });

  } catch (err) {
    console.error('[VIPP] gerar-etiqueta erro:', err.message);
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// ── POST /api/vipp/imprimir-envio ─────────────────────────────────────────────
// Busca o ZVP (ZPL) de uma etiqueta ECT via VIPP ImpressaoRemota e enfileira
// no agente de impressão (etiqueta."ETQ_fila_impressao").
// Só deve ser chamado para registros sem etiqueta_url — se o registro tiver
// etiqueta_url, o frontend abre o PDF diretamente sem chamar este endpoint.
//
// Body JSON: { envio_id, destino_agente?, impressora? }
// envio_id       → id de envios.solicitacoes
// destino_agente → pcName do agente (opcional)
// impressora     → nome da impressora (opcional)
//
router.post('/imprimir-envio', async (req, res) => {
  const { envio_id, destino_agente, impressora } = req.body || {};
  const usuario = req.session?.user?.login || req.session?.usuario || '';
  if (!envio_id) return res.status(400).json({ ok: false, error: 'envio_id obrigatório' });

  try {
    // 1. Busca código ECT e etiqueta_url do registro de envio
    const { rows } = await dbQuery(
      `SELECT identificacao, etiqueta_url FROM envios.solicitacoes WHERE id = $1 LIMIT 1`,
      [Number(envio_id)]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Envio não encontrado' });

    // 2. Obtém ZPL — usa cache se disponível, senão busca no VIPP e converte
    let zpl = null;
    const cachedUrl = rows[0].etiqueta_url || '';

    if (cachedUrl.trimStart().startsWith('^XA')) {
      // Cache já é ZPL válido — usa diretamente (reimpressão sem chamar VIPP)
      zpl = await _upgradeLegacyEtiquetaZpl(cachedUrl);
      if (zpl !== cachedUrl) {
        dbQuery(
          `UPDATE envios.solicitacoes SET etiqueta_url = $1 WHERE id = $2`,
          [zpl, Number(envio_id)]
        ).catch(e => console.warn('[VIPP] falha ao atualizar ZPL legado em etiqueta_url:', e.message));
      }
    } else if (cachedUrl.trimStart().startsWith('<?xml') || cachedUrl.trimStart().startsWith('<RECORDS')) {
      // Cache é ZVP XML — converte para ZPL (sem chamar VIPP)
      zpl = await _gerarZplEtiquetaEnvio(cachedUrl);
      // Upgrade: substitui ZVP por ZPL no cache para reprints futuros
      dbQuery(
        `UPDATE envios.solicitacoes SET etiqueta_url = $1 WHERE id = $2`,
        [zpl, Number(envio_id)]
      ).catch(e => console.warn('[VIPP] falha ao atualizar ZPL em etiqueta_url:', e.message));
    } else {
      // Sem cache — busca no VIPP
      const identificacao = (rows[0].identificacao || '').trim().replace(/\s+/g, '');
      if (!identificacao) {
        return res.status(400).json({ ok: false, error: 'Código de identificação (ECT) ainda não disponível para este envio' });
      }
      const params = new URLSearchParams({
        Usr:    VIPP_USUARIO,
        Pwd:    VIPP_TOKEN,
        Filtro: '1',
        Ordem:  '1',
        Saida:  '0',
        Lista:  identificacao,
      });
      const vippResp = await axios.get(`${VIPP_IMPRESSAO}?${params}`, {
        responseType: 'arraybuffer',
        timeout: 30000,
        validateStatus: s => s === 200,
      });
      const zvpXml = Buffer.from(vippResp.data).toString('latin1');
      if (!zvpXml.trim()) {
        return res.status(502).json({ ok: false, error: 'VIPP retornou ZVP vazio' });
      }
      // Converte ZVP XML → ZPL para enviar ao agente Zebra
      zpl = await _gerarZplEtiquetaEnvio(zvpXml);
      // Persiste ZPL em etiqueta_url (cache para reimpressões futuras)
      try {
        await dbQuery(
          `UPDATE envios.solicitacoes SET etiqueta_url = $1 WHERE id = $2 AND (etiqueta_url IS NULL OR etiqueta_url = '')`,
          [zpl, Number(envio_id)]
        );
      } catch (e) {
        console.warn('[VIPP] imprimir-envio: falha ao salvar ZPL em etiqueta_url:', e.message);
      }
    }

    // 3. Enfileira no agente de impressão
    const filaIns = await dbQuery(
      `INSERT INTO etiqueta."ETQ_fila_impressao" (etq_ids, multiplo, usuario, zpl, quantidade, destino_agente, impressora)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [[], 0, usuario, zpl, 1, destino_agente || null, impressora || null]
    );
    console.log(`[VIPP] imprimir-envio: envio_id=${envio_id} fila_id=${filaIns.rows[0].id} fromCache=${!!cachedUrl}`);
    return res.json({ ok: true, fila_id: filaIns.rows[0].id });

  } catch (err) {
    const status = err.response?.status;
    const errosVipp = { 210: 'Usuário/senha VIPP inválidos', 211: 'Usuário VIPP bloqueado', 214: 'Nenhum registro fornecido', 215: 'Etiqueta não encontrada no VIPP' };
    if (status && errosVipp[status]) {
      return res.status(502).json({ ok: false, error: errosVipp[status] });
    }
    console.error('[VIPP] imprimir-envio erro:', err.message);
    return res.status(502).json({ ok: false, error: err.message || 'Falha ao comunicar com VIPP' });
  }
});

// ── GET /api/vipp/declaracao ──────────────────────────────────────────────────
// Retorna a declaração de conteúdo de um envio como HTML (pronto para impressão).
//
// Query params:
//   id  — id de envios.solicitacoes
//
// Lógica:
//   1. Se o registro tem declaracao_url → redireciona para o PDF salvo
//   2. Se tem código ECT (identificacao) → busca ZVP no VIPP, parseia itens, gera HTML
//   3. Se tem id_vipp (sem ECT) → busca ZVP por IdConhecimento, idem
//   4. Sem dados → 404
//
router.get('/declaracao', async (req, res) => {
  const { id } = req.query;
  const somenteValidar = String(req.query?.somente_validar || '').trim() === '1';
  if (!id) return res.status(400).json({ ok: false, error: 'Parâmetro id obrigatório' });

  try {
    const { rows } = await dbQuery(
      `SELECT id, declaracao_url, identificacao, id_vipp, conteudo, observacao, usuario, numero_sep, chave_dce, vipp_payload
         FROM envios.solicitacoes WHERE id = $1 LIMIT 1`,
      [Number(id)]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Envio não encontrado' });
    const envio = rows[0];

    if (somenteValidar && envio.declaracao_url && envio.declaracao_url.trimStart().startsWith('http')) {
      return res.json({ ok: true, camposFaltantes: [], origem: 'arquivo' });
    }

    // 1. Se já tem declaração salva como URL (PDF/Supabase) → redireciona
    if (!somenteValidar && envio.declaracao_url && envio.declaracao_url.trimStart().startsWith('http')) {
      return res.redirect(302, envio.declaracao_url);
    }

    const dados = await _resolverDadosDeclaracao(envio, '[VIPP] declaracao', { exigirCamposObrigatorios: true });

    if (somenteValidar) {
      return res.json({ ok: true, camposFaltantes: [], origem: 'dados' });
    }

    try {
      await _persistirDeclaracaoCache(Number(id), dados, envio.chave_dce || '');
    } catch (cacheErr) {
      console.warn('[VIPP] declaracao: falha ao persistir cache ZPL:', cacheErr.message);
    }

    return res.send(_gerarHtmlDeclaracao({
      remetente:   dados.remetente,
      remEndereco: dados.remEndereco,
      remDoc:      dados.remDoc,
      destinatario: dados.destinatario,
      desEndereco: dados.desEndereco,
      desDoc:      dados.desDoc,
      ect:         dados.ect,
      chaveNfe:    dados.chaveNfe,
      nfeNum:      dados.nfeNum,
      nfeSerie:    dados.nfeSerie,
      itens:       dados.itens,
    }));

  } catch (err) {
    console.error('[VIPP] declaracao erro:', err.message);
    if (somenteValidar) {
      return res.status(err.camposFaltantes?.length ? 422 : 500).json({
        ok: false,
        error: err.message,
        camposFaltantes: err.camposFaltantes || [],
      });
    }
    if (err.camposFaltantes?.length) {
      return res.status(422).send(_gerarHtmlErroDeclaracao(err));
    }
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Gera HTML da Declaração de Conteúdo — layout similar à DACE (ECT/Correios)
function _gerarHtmlDeclaracao({ remetente, remEndereco, remDoc, destinatario, desEndereco, desDoc, ect, chaveNfe, nfeNum, nfeSerie, itens }) {
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/, '&quot;');

  // Cálculo do valor total dos itens
  const valorTotal = (itens || []).reduce((acc, it) => {
    const v = parseFloat((it.valor_unitario || '0').toString().replace(',', '.')) || 0;
    const q = parseInt(it.quantidade || '1') || 1;
    return acc + v * q;
  }, 0).toFixed(2).replace('.', ',');

  // Formata chave NF-e em blocos de 4 para exibição
  const chaveFormatada = chaveNfe ? chaveNfe.replace(/(\d{4})/g, '$1 ').trim() : '';

  // QR code da DCE: aponta para portal SEFAZ/Fazenda com a chave
  // Formato: https://www.fazenda.pr.gov.br/dce/qrcode?chDCe={chave44}&tpAmb=1
  const dceQrTarget = chaveNfe ? `https://www.fazenda.pr.gov.br/dce/qrcode?chDCe=${chaveNfe}&tpAmb=1` : '';
  const qrUrl = dceQrTarget
    ? `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(dceQrTarget)}&size=120x120&margin=4`
    : '';

  const linhas = (itens || []).map((it, i) => {
    const vUnit = parseFloat((it.valor_unitario || '0').toString().replace(',', '.')) || 0;
    const q     = parseInt(it.quantidade || '1') || 1;
    const vTot  = (vUnit * q).toFixed(2).replace('.', ',');
    return `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(it.conteudo)}</td>
      <td style="text-align:center">${esc(it.quantidade)}</td>
      <td style="text-align:right">R$ ${esc(it.valor_unitario || '0,01')}</td>
      <td style="text-align:right">R$ ${vTot}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Declaração de Conteúdo${ect ? ' — ' + esc(ect) : ''}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 11px; margin: 10mm; color: #000; }
  .titulo-bloco { border: 2px solid #000; padding: 6px 10px; margin-bottom: 0; display: flex; justify-content: space-between; align-items: center; }
  .titulo-bloco h2 { margin: 0; font-size: 13px; font-weight: bold; letter-spacing: 1px; }
  .chave-bar { border: 1px solid #000; border-top: none; padding: 4px 10px; font-family: monospace; font-size: 10px; letter-spacing: 1px; background: #f9f9f9; margin-bottom: 6px; word-break: break-all; }
  .row2 { display: flex; gap: 6px; margin-bottom: 6px; }
  .section { border: 1px solid #000; padding: 6px 8px; flex: 1; }
  .section-full { border: 1px solid #000; padding: 6px 8px; margin-bottom: 6px; }
  .lbl { font-weight: bold; font-size: 9px; text-transform: uppercase; margin-bottom: 2px; color: #333; }
  .val { font-size: 11px; }
  .sub { font-size: 10px; color: #555; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { background: #000; color: #fff; padding: 4px 6px; font-size: 10px; text-align: left; }
  td { border: 1px solid #bbb; padding: 3px 6px; }
  .total-row td { font-weight: bold; background: #f0f0f0; }
  .footer-bloco { display: flex; gap: 10px; margin-top: 6px; align-items: flex-start; }
  .footer-texto { font-size: 9px; color: #444; flex: 1; border: 1px solid #ccc; padding: 6px; }
  .qr-bloco { text-align: center; border: 1px solid #ccc; padding: 4px; min-width: 130px; }
  .qr-bloco img { display: block; margin: 0 auto; }
  .qr-bloco .qr-label { font-size: 8px; color: #666; margin-top: 2px; }
  .assinatura { margin-top: 10px; display: flex; gap: 30px; }
  .assinatura div { flex: 1; border-top: 1px solid #000; padding-top: 3px; text-align: center; font-size: 10px; }
  @media print { body { margin: 5mm; } .btn-print { display: none; } }
</style>
</head>
<body>
<button class="btn-print" onclick="window.print()" style="float:right;padding:5px 12px;font-size:11px;cursor:pointer;background:#1d4ed8;color:#fff;border:none;border-radius:4px;margin-bottom:4px;">🖨 Imprimir</button>

<div class="titulo-bloco">
  <div>
    <h2 style="margin:0 0 2px">DECLARAÇÃO DE CONTEÚDO</h2>
    ${(nfeNum || nfeSerie) ? `<div style="font-size:10px;color:#444">NF-e Nº: <strong>${esc(nfeNum || '-')}</strong> &nbsp; SÉRIE: <strong>${esc(nfeSerie || '-')}</strong></div>` : ''}
  </div>
  ${ect ? `<div style="font-family:monospace;font-size:13px;letter-spacing:3px">${esc(ect)}</div>` : ''}
</div>
${chaveFormatada ? `<div class="chave-bar">Chave NF-e: ${chaveFormatada}</div>` : '<div style="margin-bottom:6px"></div>'}

<div class="row2">
  <div class="section">
    <div class="lbl">Identificação do Remetente</div>
    ${remDoc ? `<div class="sub">CNPJ/CPF: ${esc(remDoc)}</div>` : ''}
    <div class="val">${esc(remetente)}</div>
    ${remEndereco ? `<div class="sub">${esc(remEndereco)}</div>` : ''}
  </div>
  <div class="section">
    <div class="lbl">Identificação do Destinatário</div>
    ${desDoc ? `<div class="sub">CNPJ/CPF: ${esc(desDoc)}</div>` : ''}
    <div class="val">${esc(destinatario)}</div>
    ${desEndereco ? `<div class="sub">${esc(desEndereco)}</div>` : ''}
  </div>
</div>

<div class="section-full">
  <div class="lbl">Transportadora</div>
  <div class="val">EMPRESA BRASILEIRA DE CORREIOS E TELÉGRAFOS — CNPJ: 34.028.316/0001-03</div>
</div>

<div class="section-full">
  <div class="lbl">Identificação dos Bens ou Mercadorias</div>
  <table>
    <thead>
      <tr><th>Item</th><th>Descrição</th><th>Qtde</th><th>Valor Unit. R$</th><th>Valor Total R$</th></tr>
    </thead>
    <tbody>
      ${linhas || '<tr><td colspan="5" style="text-align:center;color:#999">Sem itens cadastrados</td></tr>'}
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="4" style="text-align:right">VALOR TOTAL R$</td>
        <td style="text-align:right">R$ ${valorTotal}</td>
      </tr>
    </tfoot>
  </table>
</div>

<div class="footer-bloco">
  ${qrUrl ? `
  <div class="qr-bloco">
    <a href="${esc(dceQrTarget)}" target="_blank" rel="noopener noreferrer">
      <img src="${qrUrl}" width="120" height="120" alt="QR Code DCE">
    </a>
    <div class="qr-label">Consulta DCE — SEFAZ</div>
  </div>` : ''}
  <div class="footer-texto">
    <strong>Declaro</strong> que o conteúdo desta encomenda não é proibido por lei ou regulamento e corresponde ao
    informado acima.<br><br>
    É contribuinte de ICMS qualquer pessoa física ou jurídica que realize, com habitualidade ou em volume que
    caracterize intuito comercial, operações de circulação de mercadoria ou prestações de serviços de
    transportes interestadual e intermunicipal e de comunicação, ainda que as operações e as prestações se
    iniciem no exterior (Lei Complementar nº 87/96, Art. 4º).
  </div>
</div>

<div class="assinatura">
  <div>Assinatura do Remetente</div>
  <div>Data: ___/___/______</div>
  <div>Assinatura do Destinatário</div>
</div>
</body>
</html>`;
}

function _gerarHtmlErroDeclaracao(err) {
  const esc = s => String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const faltantes = Array.isArray(err?.camposFaltantes) ? err.camposFaltantes : [];
  const detalheApi = String(err?.detalheApi || '').trim();
  const itens = faltantes.map(campo => `<li>${esc(campo)}</li>`).join('');
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Declaração indisponível</title>
<style>
  body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
  .box { max-width: 720px; border: 1px solid #fecaca; background: #fef2f2; padding: 20px; border-radius: 8px; }
  h1 { margin: 0 0 12px; font-size: 22px; }
  p { margin: 0 0 12px; line-height: 1.45; }
  ul { margin: 0 0 12px 18px; }
  .detalhe { color: #991b1b; font-size: 14px; }
</style>
</head>
<body>
  <div class="box">
    <h1>Declaração não pode ser gerada</h1>
    <p>Os campos obrigatórios abaixo continuam faltando mesmo após tentar completar os dados pela API VIPP:</p>
    <ul>${itens || '<li>Campos obrigatórios não identificados.</li>'}</ul>
    ${detalheApi ? `<p class="detalhe">Consulta VIPP: ${esc(detalheApi)}</p>` : ''}
  </div>
</body>
</html>`;
}

// ── Helper: busca dados completos via GetSituacaoPostagem ─────────────────────
// Retorna objeto pronto para _gerarZplDeclaracao.
function _extrairDadosNfeDaPostagem(s = {}, post = {}) {
  const chaveNfe = String(s.ObservacaoDois || post.ObservacaoDois || '').replace(/\D/g, '').substring(0, 44);
  const nfeNumDireto = String(s.NumeroNotaFiscal || post.NumeroNotaFiscal || '').replace(/\D/g, '');
  const nfeSerieDireta = String(s.SerieNotaFiscal || post.SerieNotaFiscal || '').replace(/\D/g, '');

  return {
    chaveNfe,
    nfeNum: nfeNumDireto || (chaveNfe.length === 44 ? String(parseInt(chaveNfe.substring(25, 34), 10)) : ''),
    nfeSerie: nfeSerieDireta ? nfeSerieDireta.padStart(3, '0') : (chaveNfe.length === 44 ? chaveNfe.substring(22, 25) : ''),
  };
}

function _aplicarFallbackNfe(dados = {}, chaveFallback = '') {
  const extraidos = _extrairDadosNfeDaPostagem({ ObservacaoDois: chaveFallback }, {});
  return {
    ...dados,
    chaveNfe: dados.chaveNfe || extraidos.chaveNfe,
    nfeNum: dados.nfeNum || extraidos.nfeNum,
    nfeSerie: dados.nfeSerie || extraidos.nfeSerie,
  };
}

function _normalizarItensConteudoEnvio(conteudo) {
  if (!conteudo) return [];

  let itens = [];
  if (Array.isArray(conteudo)) {
    itens = conteudo;
  } else {
    try {
      itens = JSON.parse(conteudo);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(itens)) return [];

  return itens
    .map(it => {
      const quantidadeNum = Number.parseInt(it?.quantidade, 10) || 1;
      const valorNum = Number(String(it?.valor_unitario ?? it?.valor ?? '0.01').replace(',', '.'));
      return {
        conteudo: String(it?.conteudo || it?.descricao || '').trim(),
        quantidade: String(quantidadeNum),
        valor_unitario: Number.isFinite(valorNum) ? valorNum.toFixed(2).replace('.', ',') : '0,01',
      };
    })
    .filter(it => it.conteudo);
}

function _normalizarVippPayload(vippPayload) {
  if (!vippPayload) return {};
  if (typeof vippPayload === 'string') {
    try {
      return JSON.parse(vippPayload);
    } catch {
      return {};
    }
  }
  return typeof vippPayload === 'object' ? vippPayload : {};
}

function _montarEnderecoVipp(destinatario = {}) {
  const cidadeUf = [destinatario.cidade, destinatario.uf].filter(Boolean).join('/');
  return [
    destinatario.endereco,
    destinatario.numero,
    destinatario.bairro,
    cidadeUf,
    destinatario.cep ? `CEP ${destinatario.cep}` : null,
  ].filter(Boolean).join(' - ');
}

function _montarEnderecoRemetentePadrao() {
  const cidadeUf = [VIPP_REMETENTE_PADRAO.cidade, VIPP_REMETENTE_PADRAO.uf].filter(Boolean).join('/');
  return [
    VIPP_REMETENTE_PADRAO.endereco,
    VIPP_REMETENTE_PADRAO.numero,
    VIPP_REMETENTE_PADRAO.bairro,
    cidadeUf,
    VIPP_REMETENTE_PADRAO.cep ? `CEP ${VIPP_REMETENTE_PADRAO.cep}` : null,
  ].filter(Boolean).join(' - ');
}

function _formatarDataDeclaracao(valor) {
  if (!valor) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(valor))) return String(valor);
  const dt = new Date(valor);
  if (Number.isNaN(dt.getTime())) return String(valor);
  return dt.toLocaleDateString('pt-BR');
}

function _montarDadosDeclaracaoFallback(envio = {}) {
  const vippPayload = _normalizarVippPayload(envio.vipp_payload);
  const destinatario = vippPayload.destinatario || {};
  const notaFiscal = vippPayload.notaFiscal || {};
  const declaracaoConteudo = vippPayload.declaracaoConteudo || {};
  const ect = String(envio.identificacao || '').trim().replace(/\s+/g, '');
  const dadosBase = {
    remetente: VIPP_REMETENTE_PADRAO.nome,
    remDoc: String(declaracaoConteudo.docRemetente || VIPP_REMETENTE_PADRAO.documento || '').trim(),
    remEndereco: _montarEnderecoRemetentePadrao(),
    destinatario: String(destinatario.nome || envio.destinatario || envio.observacao || envio.numero_sep || envio.id_vipp || 'NAO INFORMADO').trim(),
    desDoc: String(declaracaoConteudo.docDestinatario || destinatario.cnpjCpf || '').trim(),
    desEndereco: _montarEnderecoVipp(destinatario),
    ect,
    chaveNfe: '',
    itens: _normalizarItensConteudoEnvio(envio.conteudo || declaracaoConteudo.itens || []),
    nfeNum: String(notaFiscal.numero || '').replace(/\D/g, ''),
    nfeSerie: String(notaFiscal.serie || '').replace(/\D/g, ''),
    cnpjTransp: '34.028.316/0001-03',
    nomeTransp: 'EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS',
    dataEmissao: _formatarDataDeclaracao(notaFiscal.data),
    protocolo: '',
  };

  return _aplicarFallbackNfe(dadosBase, envio.chave_dce || '');
}

function _campoObrigatorioDeclaracaoPresente(value) {
  const normalizado = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalizado) return false;
  return !/^(?:-|---|NAO INFORMADO|NAOINFORMADO)$/i.test(normalizado);
}

function _itensDeclaracaoValidos(itens = []) {
  return Array.isArray(itens) && itens.length > 0 && itens.every(item => (
    _campoObrigatorioDeclaracaoPresente(item?.conteudo) &&
    _campoObrigatorioDeclaracaoPresente(item?.quantidade) &&
    _campoObrigatorioDeclaracaoPresente(item?.valor_unitario)
  ));
}

function _listarCamposObrigatoriosDeclaracao(dados = {}) {
  const faltantes = [];
  if (!_campoObrigatorioDeclaracaoPresente(dados.ect)) faltantes.push('código ECT');
  if (!_campoObrigatorioDeclaracaoPresente(dados.nfeNum)) faltantes.push('N da NF-e');
  if (!_campoObrigatorioDeclaracaoPresente(dados.nfeSerie)) faltantes.push('série da NF-e');
  if (!_campoObrigatorioDeclaracaoPresente(dados.remDoc)) faltantes.push('CNPJ/CPF do remetente');
  if (!_campoObrigatorioDeclaracaoPresente(dados.remEndereco)) faltantes.push('endereço do remetente');
  if (!_campoObrigatorioDeclaracaoPresente(dados.destinatario)) faltantes.push('nome do destinatário');
  if (!_campoObrigatorioDeclaracaoPresente(dados.desDoc)) faltantes.push('documento do destinatário');
  if (!_campoObrigatorioDeclaracaoPresente(dados.desEndereco)) faltantes.push('endereço do destinatário');
  if (!_itensDeclaracaoValidos(dados.itens)) faltantes.push('itens da declaração');
  return faltantes;
}

function _detalheApiIndicaBloqueioTemporario(detalheApi = '') {
  const detalhe = String(detalheApi || '');
  return /SituacaoPostagem bloqueada ate|Limite Gratuito Diario Atingido/i.test(detalhe);
}

function _montarErroCamposObrigatoriosDeclaracao(faltantes = [], detalheApi = '') {
  const faltantesLimpos = Array.from(new Set((faltantes || []).filter(Boolean)));
  const orientacao = _detalheApiIndicaBloqueioTemporario(detalheApi)
    ? ' A etiqueta pode ja ter sido gerada, mas a declaracao depende dos campos faltantes no payload local ou da liberacao da consulta VIPP.'
    : '';
  const sufixoApi = detalheApi ? ` Consulta VIPP: ${detalheApi}` : '';
  const err = new Error(`Declaração sem campos obrigatórios: ${faltantesLimpos.join(', ')}.${sufixoApi}${orientacao}`.trim());
  err.camposFaltantes = faltantesLimpos;
  err.detalheApi = detalheApi || '';
  return err;
}

function _temDadosDeclaracao(dados = {}) {
  return _listarCamposObrigatoriosDeclaracao(dados).length === 0;
}

// Considera o payload local "completo o suficiente" para gerar a DACE sem
// precisar chamar a API VIPP (que tem rate limit baixo). Os 5 campos abaixo
// sao o minimo para uma declaracao impressa coerente.
function _dadosDeclaracaoCompletos(dados = {}) {
  return _temDadosDeclaracao(dados);
}

async function _resolverDadosDeclaracao(envio = {}, contextoLog = '[VIPP] declaracao', opcoes = {}) {
  const { exigirCamposObrigatorios = false } = opcoes || {};
  const dadosFallback = _montarDadosDeclaracaoFallback(envio);
  if (!dadosFallback.ect) {
    if (exigirCamposObrigatorios) {
      throw _montarErroCamposObrigatoriosDeclaracao(_listarCamposObrigatoriosDeclaracao(dadosFallback));
    }
    return dadosFallback;
  }

  // Se o payload local ja tem tudo que a DACE precisa, evita ir na API VIPP
  // (preserva cota e funciona mesmo offline). A API so e consultada quando
  // realmente faltam dados criticos no payload persistido.
  if (_dadosDeclaracaoCompletos(dadosFallback)) {
    return dadosFallback;
  }

  let dadosResolvidos = dadosFallback;
  let erroConsulta = null;

  try {
    const dadosVipp = _aplicarFallbackNfe(await _buscarSituacaoPostagem(dadosFallback.ect), envio.chave_dce);
    dadosResolvidos = {
      ...dadosFallback,
      ...dadosVipp,
      itens: Array.isArray(dadosVipp.itens) && dadosVipp.itens.length ? dadosVipp.itens : dadosFallback.itens,
    };
  } catch (err) {
    erroConsulta = err;
  }

  const faltantes = _listarCamposObrigatoriosDeclaracao(dadosResolvidos);
  if (faltantes.length) {
    if (exigirCamposObrigatorios) {
      throw _montarErroCamposObrigatoriosDeclaracao(faltantes, erroConsulta?.message || '');
    }
    if (erroConsulta) {
      console.warn(`${contextoLog}: usando fallback local da declaracao:`, erroConsulta.message);
    }
  }

  return dadosResolvidos;
}

async function _persistirDeclaracaoCache(envioId, dados = {}, chaveDce = '') {
  const zpl = _gerarZplDeclaracao(dados);
  await dbQuery(
    `UPDATE envios.solicitacoes
        SET declaracao_url = CASE WHEN declaracao_url IS NULL OR declaracao_url = '' THEN $1 ELSE declaracao_url END,
            chave_dce = CASE WHEN $2 <> '' THEN $2 ELSE chave_dce END
      WHERE id = $3`,
    [zpl, chaveDce || dados.chaveNfe || '', Number(envioId)]
  );
  return zpl;
}

function _normalizarProtocoloAutorizacao(value = '') {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  const protocolo = cleaned.match(/\b\d{15,20}\b/);
  if (!protocolo) return '';

  const dataHora = cleaned.match(/\b\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}\b/);
  return dataHora ? `${protocolo[0]} - ${dataHora[0]}` : protocolo[0];
}

function _extrairProtocoloDaPostagem(s = {}, post = {}) {
  const candidatos = [
    s.ProtocoloAutorizacao,
    post.ProtocoloAutorizacao,
    s.ProtocoloDeAutorizacao,
    post.ProtocoloDeAutorizacao,
    s.NumeroProtocoloAutorizacao,
    post.NumeroProtocoloAutorizacao,
    s.NrProtocoloAutorizacao,
    post.NrProtocoloAutorizacao,
    s.ProtocoloAutorizacaoDce,
    post.ProtocoloAutorizacaoDce,
    s.AutorizacaoDce,
    post.AutorizacaoDce,
    s.Protocolo,
    post.Protocolo,
    s.NrProtocolo,
    post.NrProtocolo,
    s.Autorizacao,
    post.Autorizacao,
  ];

  for (const value of candidatos) {
    const protocolo = _normalizarProtocoloAutorizacao(value);
    if (protocolo) return protocolo;
  }

  for (const [key, value] of [...Object.entries(s), ...Object.entries(post)]) {
    if (!/(protoc|autoriz)/i.test(key)) continue;
    const protocolo = _normalizarProtocoloAutorizacao(value);
    if (protocolo) return protocolo;
  }

  for (const value of [...Object.values(s), ...Object.values(post)]) {
    const protocolo = _normalizarProtocoloAutorizacao(value);
    if (protocolo) return protocolo;
  }

  return '';
}

function _extrairTagsXml(xml, tags = []) {
  return tags.reduce((acc, tag) => {
    const value = extrairTag(xml, tag);
    if (value) acc[tag] = value;
    return acc;
  }, {});
}

function _mapearSituacaoPostagem(s = {}, post = {}, etiqueta) {
  let itens = [];
  if (post.DescricaoConteudo) {
    try {
      const dc = JSON.parse(post.DescricaoConteudo);
      itens = (dc.Conteudos || []).map(c => ({
        conteudo:       c.ObjDsc  || '',
        quantidade:     c.ObjQtd  || '1',
        valor_unitario: c.ObjVlr  ? Number(c.ObjVlr).toFixed(2).replace('.', ',') : '0,00',
      }));
    } catch {}
  }
  if (!itens.length && post.Conteudo) {
    itens = [{ conteudo: post.Conteudo, quantidade: '1', valor_unitario: '0,00' }];
  }

  const { chaveNfe, nfeNum, nfeSerie } = _extrairDadosNfeDaPostagem(s, post);
  const protocolo = _extrairProtocoloDaPostagem(s, post);

  const fmtCnpj = n => {
    const d = String(n || '').replace(/\D/g, '').padStart(14, '0');
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  };

  const fmtDocumento = n => {
    const digits = String(n || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 11) {
      return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    }
    if (digits.length === 14) {
      return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    return String(n || '').trim();
  };

  const remEndereco = [
    post.EnderecoRemetente,
    post.NumeroRemetente,
    post.ComplementoRemetente,
    post.BairroRemetente,
    post.CidadeRemetente && post.UfRemetente ? `${post.CidadeRemetente}/${post.UfRemetente}` : null,
    post.CepRemetente ? `CEP ${post.CepRemetente}` : null,
  ].filter(Boolean).join(' - ');

  const documentoDestinatario =
    post.DocumentoDestinatario ||
    post.CpfCnpjDestinatario ||
    post.CnpjCpfDestinatario ||
    post.AosCuidados ||
    '';

  const desEndereco = [
    post.EnderecoDestinatario,
    post.NumeroDestinatario,
    post.ComplementoDestinatario,
    post.BairroDestinatario,
    post.CidadeDestinatario && post.UfDestinatario ? `${post.CidadeDestinatario}/${post.UfDestinatario}` : null,
    (post.CEPDestinatario || post.CepDestinatario) ? `CEP ${post.CEPDestinatario || post.CepDestinatario}` : null,
  ].filter(Boolean).join(' - ');

  const dataEntrada = s.DataDeEntradaNoVipp || post.DataDeEntradaNoVipp || s.DataPostagem || post.DataPostagem || '';
  const dataEmissao = (() => {
    if (!dataEntrada) return undefined;
    const d = new Date(dataEntrada);
    return isNaN(d.getTime()) ? String(dataEntrada)
      : d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR');
  })();

  return {
    remetente:   post.NomeRemetente || post.NomeFantasiaRemetente || VIPP_REMETENTE_PADRAO.nome,
    remDoc:      fmtCnpj(post.CNPJRemetente || VIPP_REMETENTE_PADRAO.documento),
    remEndereco: remEndereco || _montarEnderecoRemetentePadrao(),
    desDoc:      fmtDocumento(documentoDestinatario),
    desEndereco,
    ect:         post.Etiqueta || s.Etiqueta || etiqueta,
    chaveNfe,
    itens,
    nfeNum,
    nfeSerie,
    cnpjTransp:  fmtCnpj(post.CNPJPostadora),
    nomeTransp:  post.NomeFantasiaPostadora || post.NomePostadora || 'EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS',
    telefoneDestinatario: String(post.TelefoneDestinatario || '').replace(/\D/g, ''),
    emailDestinatario: post.EmailDestinatario || '',
    dataEmissao,
    protocolo,
  };
}

async function _buscarSituacaoPostagemSoap(etiqueta) {
  const soapXml = buildSoapSituacaoPostagem([etiqueta]);
  const resp = await axios.post(VIPP_ENDPOINT, soapXml, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': '"http://www.visualset.inf.br/SituacaoPostagem"',
    },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (resp.status !== 200) {
    throw new Error(`SituacaoPostagem SOAP HTTP ${resp.status}`);
  }

  const raw = String(resp.data || '');
  const resultXml = decodeXmlEntities(extrairTag(raw, 'SituacaoPostagemResult') || raw);
  const listaErros = extrairTag(resultXml, 'ListaErros');
  if (listaErros) {
    const descricaoErro = extrairTag(listaErros, 'Descricao') || extrairTag(listaErros, 'DescricaoTipoErro') || 'Erro desconhecido no SOAP SituacaoPostagem';
    throw new Error(`SituacaoPostagem SOAP: ${descricaoErro}`);
  }

  const topTags = [
    'Etiqueta', 'ObservacaoDois', 'NumeroNotaFiscal', 'SerieNotaFiscal', 'DataDeEntradaNoVipp',
    'DataPostagem', 'ProtocoloAutorizacao', 'ProtocoloDeAutorizacao', 'NumeroProtocoloAutorizacao',
    'NrProtocoloAutorizacao', 'ProtocoloAutorizacaoDce', 'AutorizacaoDce', 'Protocolo', 'NrProtocolo', 'Autorizacao',
    'DocumentoDestinatario', 'TelefoneDestinatario', 'EmailDestinatario', 'ComplementoDestinatario', 'ComplementoRemetente',
    'CpfCnpjDestinatario', 'CnpjCpfDestinatario', 'ObservacaoUm'
  ];
  const postTags = [
    'Etiqueta', 'ObservacaoDois', 'NumeroNotaFiscal', 'SerieNotaFiscal', 'DescricaoConteudo', 'Conteudo',
    'NomeRemetente', 'NomeFantasiaRemetente', 'CNPJRemetente', 'EnderecoRemetente', 'NumeroRemetente',
    'ComplementoRemetente', 'BairroRemetente', 'CidadeRemetente', 'UfRemetente', 'CepRemetente', 'NomeDestinatario', 'AosCuidados',
    'EnderecoDestinatario', 'NumeroDestinatario', 'BairroDestinatario', 'CidadeDestinatario', 'UfDestinatario',
    'CEPDestinatario', 'CepDestinatario', 'ComplementoDestinatario', 'DocumentoDestinatario', 'TelefoneDestinatario',
    'EmailDestinatario', 'CpfCnpjDestinatario', 'CnpjCpfDestinatario', 'CNPJPostadora', 'NomeFantasiaPostadora', 'NomePostadora',
    'DataDeEntradaNoVipp', 'DataPostagem', 'ProtocoloAutorizacao', 'ProtocoloDeAutorizacao', 'NumeroProtocoloAutorizacao',
    'NrProtocoloAutorizacao', 'ProtocoloAutorizacaoDce', 'AutorizacaoDce', 'Protocolo', 'NrProtocolo', 'Autorizacao', 'ObservacaoUm'
  ];

  const s = _extrairTagsXml(resultXml, topTags);
  const post = _extrairTagsXml(resultXml, postTags);
  if (!Object.keys(s).length && !Object.keys(post).length) {
    throw new Error('SituacaoPostagem SOAP sem dados parseaveis');
  }

  return _mapearSituacaoPostagem(s, post, etiqueta);
}

async function _buscarSituacaoPostagem(etiqueta) {
  // 1) Cache compartilhado em SQL (etiqueta.vipp_situacao_cache)
  const hit = await _vippCacheGet(etiqueta);
  if (hit && hit.dados) {
    return hit.dados;
  }

  // 2) Se a credencial esta marcada como bloqueada (402/limite diario),
  //    nao queima rate limit; deixa o caller usar o fallback local.
  const bloqueio = await _vippGetRateLimit('situacao_postagem');
  if (bloqueio) {
    throw new Error(`SituacaoPostagem bloqueada ate ${new Date(bloqueio.bloqueado_ate).toISOString()}: ${bloqueio.motivo || 'rate limit'}`);
  }

  let dadosSoap = null;
  let soapError = null;
  try {
    dadosSoap = await _buscarSituacaoPostagemSoap(etiqueta);
  } catch (err) {
    soapError = err;
  }

  let dadosRest = null;
  let restError = null;

  try {
    const resp = await axios({
      method: 'get',
      url: 'http://vpsrv.visualset.com.br/api/v1/conhecimento/GetSituacaoPostagem',
      params: {
        usuario: VIPP_USUARIO,
        senha:   VIPP_TOKEN,
        StDadosCompletos: 1,
        BuscarPor: 'EtiquetaPostagem',
      },
      data: [etiqueta],
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    const lista = resp.data && resp.data.SituacaoPostagem;
    if (!lista || !lista.length) throw new Error('GetSituacaoPostagem: resposta vazia para ' + etiqueta);
    dadosRest = _mapearSituacaoPostagem(lista[0], lista[0].PostagensRastreio || {}, etiqueta);
  } catch (err) {
    restError = err;
  }

  // 3) Detecta rate-limit em qualquer um dos dois canais e registra na tabela.
  if (!dadosSoap && !dadosRest) {
    if (_ehErroRateLimitVipp(soapError) || _ehErroRateLimitVipp(restError)) {
      await _vippMarcarRateLimit('situacao_postagem', soapError || restError);
    }
    throw soapError || restError || new Error('SituacaoPostagem sem retorno');
  }

  // 4) Monta resultado priorizando SOAP (mais completo) e popula cache.
  let resultado;
  if (dadosSoap) {
    if (!dadosRest) {
      resultado = dadosSoap;
    } else {
      resultado = {
        ...dadosRest,
        ...dadosSoap,
        protocolo: dadosSoap.protocolo || dadosRest.protocolo,
        dataEmissao: dadosSoap.dataEmissao || dadosRest.dataEmissao,
        chaveNfe: dadosSoap.chaveNfe || dadosRest.chaveNfe,
        nfeNum: dadosSoap.nfeNum || dadosRest.nfeNum,
        nfeSerie: dadosSoap.nfeSerie || dadosRest.nfeSerie,
        itens: dadosSoap.itens?.length ? dadosSoap.itens : dadosRest.itens,
        remDoc: dadosSoap.remDoc || dadosRest.remDoc,
        remEndereco: dadosSoap.remEndereco || dadosRest.remEndereco,
        destinatario: dadosSoap.destinatario || dadosRest.destinatario,
        desDoc: dadosSoap.desDoc || dadosRest.desDoc,
        desEndereco: dadosSoap.desEndereco || dadosRest.desEndereco,
        telefoneDestinatario: dadosSoap.telefoneDestinatario || dadosRest.telefoneDestinatario,
        emailDestinatario: dadosSoap.emailDestinatario || dadosRest.emailDestinatario,
        cnpjTransp: dadosSoap.cnpjTransp || dadosRest.cnpjTransp,
        nomeTransp: dadosSoap.nomeTransp || dadosRest.nomeTransp,
      };
    }
  } else {
    console.warn('[VIPP] SituacaoPostagem SOAP indisponivel, mantendo dados REST:', soapError?.message || 'sem detalhe');
    resultado = dadosRest;
  }

  await _vippCacheSet(etiqueta, resultado, dadosSoap ? 'soap' : 'rest');
  return resultado;
}

// ── POST /api/vipp/imprimir-declaracao ───────────────────────────────────────
// Busca dados da declaração via GetSituacaoPostagem, gera ZPL e enfileira no agente.
//
// Body JSON: { envio_id, destino_agente?, impressora? }
//
router.post('/imprimir-declaracao', async (req, res) => {
  const { envio_id, destino_agente, impressora } = req.body || {};
  const usuario = req.session?.user?.login || req.session?.usuario || '';
  if (!envio_id) return res.status(400).json({ ok: false, error: 'envio_id obrigatório' });

  try {
    // 1. Busca dados do envio
    const { rows } = await dbQuery(
      `SELECT id, identificacao, id_vipp, conteudo, observacao, declaracao_url, numero_sep, chave_dce, vipp_payload
         FROM envios.solicitacoes WHERE id = $1 LIMIT 1`,
      [Number(envio_id)]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Envio não encontrado' });
    const envio = rows[0];
    const dadosResolvidos = await _resolverDadosDeclaracao(envio, '[VIPP] imprimir-declaracao', { exigirCamposObrigatorios: true });
    const chaveDeclaracao = dadosResolvidos.chaveNfe || envio.chave_dce || '';

    // 1b. Se já há ZPL em cache, enfileira direto
    if (envio.declaracao_url && envio.declaracao_url.trimStart().startsWith('^XA')) {
      const zplCache = _gerarZplDeclaracao(dadosResolvidos);
      const filaIns = await dbQuery(
        `INSERT INTO etiqueta."ETQ_fila_impressao" (etq_ids, multiplo, usuario, zpl, quantidade, destino_agente, impressora)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [[], 0, usuario, zplCache, 1, destino_agente || null, impressora || null]
      );
      if (zplCache !== envio.declaracao_url || chaveDeclaracao !== (envio.chave_dce || '')) {
        try {
          await dbQuery(
            `UPDATE envios.solicitacoes SET declaracao_url = $1, chave_dce = $2 WHERE id = $3`,
            [zplCache, chaveDeclaracao || envio.chave_dce || null, Number(envio_id)]
          );
        } catch (e) {
          console.warn('[VIPP] imprimir-declaracao (cache): falha ao atualizar ZPL legado:', e.message);
        }
      }
      console.log(`[VIPP] imprimir-declaracao (cache): envio_id=${envio_id} fila_id=${filaIns.rows[0].id}`);
      return res.json({ ok: true, fila_id: filaIns.rows[0].id, fromCache: true, updatedLegacy: zplCache !== envio.declaracao_url });
    }

    // 3. Gera ZPL
    const zpl = _gerarZplDeclaracao(dadosResolvidos);

    // 4. Enfileira no agente de impressão
    const filaIns = await dbQuery(
      `INSERT INTO etiqueta."ETQ_fila_impressao" (etq_ids, multiplo, usuario, zpl, quantidade, destino_agente, impressora)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [[], 0, usuario, zpl, 1, destino_agente || null, impressora || null]
    );
    // 5. Persiste ZPL em declaracao_url para reimpressão futura
    try {
      await dbQuery(
        `UPDATE envios.solicitacoes
            SET declaracao_url = CASE WHEN declaracao_url IS NULL OR declaracao_url = '' THEN $1 ELSE declaracao_url END,
                chave_dce = CASE WHEN $2 <> '' THEN $2 ELSE chave_dce END
          WHERE id = $3`,
        [zpl, dadosResolvidos.chaveNfe || '', Number(envio_id)]
      );
    } catch (e) {
      console.warn('[VIPP] imprimir-declaracao: falha ao salvar ZPL em declaracao_url:', e.message);
    }
    console.log(`[VIPP] imprimir-declaracao: envio_id=${envio_id} ect=${dadosResolvidos.ect || ''} fila_id=${filaIns.rows[0].id}`);
    return res.json({ ok: true, fila_id: filaIns.rows[0].id });

  } catch (err) {
    console.error('[VIPP] imprimir-declaracao erro:', err.message);
    return res.status(err.camposFaltantes?.length ? 422 : 502).json({
      ok: false,
      error: err.message || 'Falha ao buscar dados da postagem',
      camposFaltantes: err.camposFaltantes || [],
    });
  }
});

// Converte imagem PNG de URL para comando ^GF (ZPL). Cache por URL+dimensões.
async function _imgToGf(url, targetW, targetH) {
  const key = `${url}:${targetW}x${targetH}`;
  if (_gfCache.has(key)) return _gfCache.get(key);
  try {
    const img = await Jimp.read(url);
    img.contain(targetW, targetH, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE, 0xFFFFFFFF);
    img.grayscale();
    const w   = img.getWidth();
    const h   = img.getHeight();
    const bpr = Math.ceil(w / 8);
    let hex = '';
    for (let row = 0; row < h; row++) {
      for (let bx = 0; bx < bpr; bx++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const px = bx * 8 + bit;
          if (px < w) {
            const { r, a } = Jimp.intToRGBA(img.getPixelColor(px, row));
            if (a > 32 && r < 128) byte |= (0x80 >> bit);
          }
        }
        hex += byte.toString(16).padStart(2, '0').toUpperCase();
      }
    }
    const cmd = `^GFA,${bpr * h},${bpr * h},${bpr},${hex}`;
    _gfCache.set(key, cmd);
    return cmd;
  } catch (e) {
    console.warn('[VIPP] _imgToGf falha:', url, e.message);
    return null;
  }
}

async function _upgradeLegacyEtiquetaZpl(zpl) {
  let current = String(zpl || '').replace(/\^LH8,8/, '^LH12,12');
  const legacyQr = /\^FO357,5\^BQN,2,3\^FDQA,([^\^]+)\^FS/;
  const match = current.match(legacyQr);
  if (match) {
    const qrData = match[1];
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrData)}&size=136x136&margin=0`;
    const gfQr = await _imgToGf(qrUrl, 136, 136);
    if (gfQr) current = current.replace(legacyQr, `^FO357,5${gfQr}`);
  }

  return current
    .replace(/\^FO0,142\^A0N,18,18\^FB784,1,,C\^FDContrato: ([^\^]+)\^FS/g, '^FO318,148^A0N,13,12^FB214,2,0,C^FDContrato:\\&$1^FS')
    .replace(/\^FO574,5/g, '^FO588,5')
    .replace(/\^FO574,143/g, '^FO588,143');
}

// Gera ZPL da Etiqueta de Envio — layout fiel ao modelo Correios (VIPP PDF)
// Label: 100×150mm (^PW812 × ^LL1218) a 203 DPI
async function _gerarZplEtiquetaEnvio(zvpXml) {
  const get = (tag) => {
    const m = zvpXml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i'));
    return m ? m[1].trim() : '';
  };
  const safe = (s, n) => String(s || '').replace(/[\^~\\]/g, '').replace(/\r?\n/g, ' ').slice(0, n);
  const fmtCep = (c) => {
    const d = (c || '').replace(/\D/g, '');
    return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (c || '');
  };
  // Formata código ECT com espaços: "AD468913789BR" → "AD 468 913 789 BR"
  const fmtEct = (s) => {
    const c = String(s || '').replace(/\s/g, '');
    return /^[A-Z]{2}\d{9}[A-Z]{2}$/i.test(c)
      ? `${c.slice(0,2)} ${c.slice(2,5)} ${c.slice(5,8)} ${c.slice(8,11)} ${c.slice(11,13)}`
      : c;
  };
  const SRV_NOME = { '3220':'EXPRESSA', '03220':'EXPRESSA', '40010':'SEDEX', '04510':'PAC', '04669':'PAC' };

  const ectRegRaw  = safe(get('ect_reg'), 20).replace(/\s/g, '');
  const ectReg     = fmtEct(ectRegRaw);
  const ectSrvCode = safe(get('ect_srv') || get('ect_tip') || '', 10);
  const contrato   = safe(get('ctt_nro') || get('ctt_ctr'), 20);
  const volume     = safe(get('vol_pos') || get('vol_nro') || '1', 5);
  const totalVol   = safe(get('vol_qtd') || get('vol_total') || '1', 5);
  const desNom     = safe(get('des_nom'), 28);
  const desAcd     = safe(get('des_acd'), 30);
  const desLog     = safe(get('des_log'), 28);
  const desNro     = safe(get('des_nro'), 6);
  const desBrr     = safe(get('des_brr'), 22);
  const desCid     = safe(get('des_cid'), 20);
  const desUf      = safe(get('des_uf'), 2);
  const desCep     = fmtCep(get('des_cep'));
  const desCepD    = (get('des_cep') || '').replace(/\D/g, '');
  const remNom     = safe(get('rem_nom'), 32);
  const remLog     = safe(get('rem_log'), 28);
  const remNro     = safe(get('rem_nro'), 6);
  const remBrr     = safe(get('rem_brr'), 20);
  const remCid     = safe(get('rem_cid'), 20);
  const remUf      = safe(get('rem_uf'), 2);
  const remCep     = fmtCep(get('rem_cep'));
  const QR_TOP     = 5;
  const QR_LEFT    = 357;
  const QR_SIDE    = 136;
  const CONTRATO_X = 318;
  const EXPRESSA_X = 588;
  const desCepRaw  = (get('des_cep') || '').replace(/\D/g, '').padStart(8, '0').slice(0, 8);
  const remCepRaw  = (get('rem_cep') || '').replace(/\D/g, '').padStart(8, '0').slice(0, 8);
  const pesoStr    = String(parseInt(get('vol_pes') || '0') || 0).padStart(5, '0').slice(0, 5);
  const cttNroPad  = String(get('ctt_nro') || '').replace(/\D/g, '').padStart(10, '0').slice(0, 10);
  const admPad     = String(get('ctt_adm') || '').replace(/\D/g, '').padStart(8, '0').slice(0, 8);
  const srvPad     = String(ectSrvCode).replace(/\D/g, '').padStart(4, '0').slice(0, 4);
  const carPad     = String(get('ctt_car') || '').replace(/\D/g, '').padStart(8, '0').slice(0, 8);
  const qrData = `${desCepRaw}00000${remCepRaw}00000${ectRegRaw}${pesoStr}${cttNroPad}${admPad}${srvPad}${carPad}-00.000000-00.000000|`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrData)}&size=${QR_SIDE}x${QR_SIDE}&margin=0`;

  const [gfEmpresa, gfExpressa, gfCorreios, gfQrEtiqueta] = await Promise.all([
    _imgToGf(LOGO_EMPRESA_URL,  160, 160),
    _imgToGf(LOGO_EXPRESSA_URL, 210, 128),
    _imgToGf(LOGO_CORREIOS_URL, 120,  44),
    _imgToGf(qrUrl, QR_SIDE, QR_SIDE),
  ]);

  // Pré-cálculo da altura do box DESTINATÁRIO (^GB desenhado antes do conteúdo)
  // Y_BOX = separador (476) + 12px de margem = 488
  const Y_BOX = 488;
  let y_calc = Y_BOX + 52 + 6;
  y_calc += 34;                  // nome (24pt)
  if (desAcd) y_calc += 30;     // acompanhante (24pt)
  y_calc += 30;                  // logradouro (24pt)
  if (desBrr) y_calc += 28;     // bairro (24pt)
  y_calc += 40;                  // CEP + cidade (28pt)
  if (desCepD.length === 8) y_calc += 80; // barcode CEP
  y_calc += 8;                   // padding inferior
  const boxH = y_calc - Y_BOX;

  const L = [];
  L.push(
    '^XA',
    '^CI13',
    '^PW799',
    '^LH12,12',
    '^LL1218',
    // ══ HEADER ══
    // Logo empresa (canto superior esquerdo, 160×160)
    ...(gfEmpresa ? [`^FO10,5${gfEmpresa}`] : []),
    // Zebra física renderiza o ^BQN de forma ligeiramente diferente do Labelary.
    // Rasterizar o QR mantém preview e impressão real no mesmo posicionamento.
    ...(gfQrEtiqueta
      ? [`^FO${QR_LEFT},${QR_TOP}${gfQrEtiqueta}`]
      : [`^FO${QR_LEFT},${QR_TOP}^BQN,2,3^FDQA,${qrData}^FS`]
    ),
    // Contrato abaixo do QR, centralizado no mesmo eixo do QR e com folga visual.
    ...(contrato ? [`^FO${CONTRATO_X},148^A0N,13,12^FB214,2,0,C^FDContrato:\\&${contrato}^FS`] : []),
    // Logo EXPRESSA (canto superior direito, 210×128)
    ...(gfExpressa ? [`^FO${EXPRESSA_X},5${gfExpressa}`] : []),
    // Volume centralizado abaixo do logo EXPRESSA
    `^FO${EXPRESSA_X},143^A0N,18,18^FB210,1,,C^FDVolume: ${volume}/${totalVol}^FS`,
    // Separador header
    '^FO0,173^GB784,3,3^FS',
    // ══ CÓDIGO ECT CENTRALIZADO ══
    `^FO0,182^A0N,36,36^FB784,1,,C^FD${ectReg}^FS`,
    // ══ CÓDIGO DE BARRAS CODE-128 (quase full-width, BY4=alta densidade, altura 130px) ══
    `^FO36,224^BY4,3,130^BCN,130,N,N^FD${ectRegRaw}^FS`,
    // Separador
    '^FO0,394^GB784,3,3^FS',
    // ══ LINHAS DE RECEBEDOR / ASSINATURA ══
    '^FO14,402^A0N,22,22^FDRecebedor:^FS',
    '^FO132,423^GB652,2,2^FS',
    '^FO14,436^A0N,22,22^FDAssinatura:^FS',
    '^FO140,457^GB288,2,2^FS',
    '^FO450,436^A0N,22,22^FDDocumento:^FS',
    '^FO556,457^GB228,2,2^FS',
    // Separador antes do bloco DESTINATÁRIO
    '^FO0,476^GB784,3,3^FS',
    // ══ BOX EXTERNO ao redor do bloco DESTINATÁRIO (borda 4 dots) ══
    `^FO0,${Y_BOX}^GB784,${boxH},4^FS`,
    // ══ FAIXA PRETA apenas onde está o texto DESTINATARIO ══
    `^FO0,${Y_BOX}^GB230,52,52^FS`,
    `^FO14,${Y_BOX+12}^A0N,28,28^FR^FDDESTINATARIO^FS`,
    // Logo CORREIOS: canto direito da banda DESTINATÁRIO (8px dentro da borda interna)
    ...(gfCorreios
      ? [`^FO652,${Y_BOX+4}${gfCorreios}`]
      : [`^FO652,${Y_BOX+15}^A0N,20,20^FDCorreios^FS`]
    ),
  );

  // ══ DADOS DO DESTINATÁRIO — todos em 24pt (tamanho uniforme) ══
  let y = Y_BOX + 52 + 6;
  L.push(`^FO14,${y}^A0N,24,24^FD${desNom}^FS`); y += 34;
  if (desAcd) { L.push(`^FO14,${y}^A0N,24,24^FD${desAcd}^FS`); y += 30; }
  L.push(`^FO14,${y}^A0N,24,24^FD${desLog}, ${desNro}^FS`); y += 30;
  if (desBrr) { L.push(`^FO14,${y}^A0N,24,24^FD${desBrr}^FS`); y += 28; }
  L.push(`^FO14,${y}^A0N,28,28^FD${desCep}  ${desCid}/${desUf}^FS`); y += 40;
  if (desCepD.length === 8) {
    L.push(`^FO14,${y}^BY2,3,70^BCN,70,N,N^FD${desCepD}^FS`); y += 80;
  }

  // ══ REMETENTE — texto solto abaixo do box, SEM bordas ══
  y = Y_BOX + boxH + 10;
  L.push(`^FO14,${y}^A0N,22,22^FDRemetente: ${remNom}^FS`); y += 30;
  L.push(`^FO14,${y}^A0N,20,20^FD${remLog} ${remNro} ${remBrr}^FS`); y += 26;
  L.push(`^FO14,${y}^A0N,20,20^FD${remCep}  ${remCid}/${remUf}^FS`);

  L.push('^XZ');
  return L.join('\n');
}

function _zplAscii(s, max = 80) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[º°]/g, 'o')
    .replace(/ª/g, 'a')
    .replace(/[–—]/g, '-')
    .replace(/[\^~]/g, '-')
    .replace(/\|/g, ' ')
    .substring(0, max);
}

function _zplHexField(s, max = 1600, escapeChar = '_') {
  const sanitized = String(s || '')
    .replace(/[\^~]/g, '-')
    .replace(/\|/g, ' ')
    .substring(0, max);

  return Array.from(Buffer.from(sanitized, 'latin1')).map(byte => {
    const ch = String.fromCharCode(byte);
    if (byte >= 32 && byte <= 126 && ch !== escapeChar) return ch;
    return `${escapeChar}${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }).join('');
}

function _getDeclaracaoObservacoesText() {
  const paragrafo1 = 'É contribuinte de ICMS qualquer pessoa física ou jurídica, que realize, com habitualidade ou em volume que caracterize intuito comercial, operações de circulação de mercadoria ou prestações de serviços de transportes interestadual e intermunicipal e de comunicação, ainda que as operações e prestações se iniciem no exterior (Lei Complementar nº 87/96, Art. 4º).';
  const paragrafo2 = 'Constitui crime contra a ordem tributária suprimir ou reduzir tributo, ou contribuição social e qualquer acessório: quando negar ou deixar de fornecer, quando obrigatório, nota fiscal ou documento equivalente, relativa a venda de mercadoria ou prestação de serviço, efetivamente realizada ou fornecê-la em desacordo com a legislação. Sob pena de reclusão de 2 (dois) e 5 (cinco) anos, e multa (Lei 8.137/90, Art 1ª, V).';
  return `${paragrafo1}\\&\\&${paragrafo2}`;
}

// Gera ZPL da Declaração de Conteúdo para impressora térmica (100x150mm, 203dpi)
function _gerarZplDeclaracao({ remetente, remDoc, remEndereco, destinatario, desDoc, desEndereco, ect, chaveNfe, itens, nfeNum, nfeSerie, protocolo, dataEmissao, cnpjTransp, nomeTransp }) {
  const z = _zplAscii;

  // Chave NF-e (44 dígitos) — usa zeros se inválida
  const chave = chaveNfe && /^\d{44}$/.test(chaveNfe) ? chaveNfe : '0'.repeat(44);
  const chaveFormatted = chave.match(/.{1,4}/g).join(' ');

  const nfeNumFmt  = nfeNum  ? String(nfeNum)  : '---';
  const nfeSerieFmt = nfeSerie ? String(nfeSerie).padStart(3, '0') : '---';

  const dataFmt     = dataEmissao || (() => { const d = new Date(); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR'); })();
  const protocoloRaw = String(protocolo || '').replace(/\s+/g, ' ').trim();
  const protocoloFmt = protocoloRaw
    ? (/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}/.test(protocoloRaw)
      ? z(protocoloRaw, 60)
      : `${z(protocoloRaw, 20)} - ${dataFmt}`)
    : dataFmt;

  const sefazUrl = `https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=completa&chave=${chave}`;

  // Divide endereço composto ("RUA X - N - BAIRRO - CIDADE/UF - CEP XXXXX") em cidade e logradouro
  const splitAddr = (addr) => {
    const parts = (addr || '').split(' - ');
    if (parts.length >= 4) {
      const cepIdx = parts.findIndex(p => /^CEP/i.test(p));
      const cityIdx = cepIdx > 0 ? cepIdx - 1 : parts.length - 2;
      return { cidadeUf: parts[cityIdx] || '', endereco: parts.slice(0, cityIdx).join(' - ') };
    }
    return { cidadeUf: '', endereco: addr };
  };

  const remAddr = splitAddr(remEndereco);
  const desAddr = splitAddr(desEndereco);
  const observacoesText = _zplAscii(_getDeclaracaoObservacoesText(), 1600);

  const itensFmt   = (itens || []).slice(0, 5);
  const nItens     = Math.max(itensFmt.length, 1);

  // ── Y positions ──────────────────────────────────────────────────────────
  const Y0 = 5;
  const SECTION_HEAD_H = 66;
  const SECTION_HEAD_TXT_Y = 24;
  const INFO_ROW_H   = 26;
  const ITEM_HEAD_H  = 22;
  const TOTAL_ROW_H  = 66;
  const DADOS_ROW_H  = 66;
  const QR_HEAD_H    = 66;
  const HEADER_H    = 118;
  const Y_DIGITS    = Y0 + HEADER_H;           // 123
  const Y_DATA      = Y_DIGITS + 22;           // 145
  const DATA_H      = 32;                      // linha data/modalidade mais alta (2 linhas no campo direito)
  const Y_PROT      = Y_DATA + DATA_H;         // 177
  const FULL_H      = Y_PROT + 22 - Y0;         // 194 — altura total do bloco cabeçalho (outer box + divisor)
  const Y_REM_HEAD  = Y_PROT + 22;             // 199
  const Y_REM_R1    = Y_REM_HEAD + SECTION_HEAD_H;
  const Y_REM_R2    = Y_REM_R1 + 28;           // 241
  const Y_DES_HEAD  = Y_REM_R2 + 28;           // 269
  const Y_DES_R1    = Y_DES_HEAD + SECTION_HEAD_H;
  const Y_DES_R2    = Y_DES_R1 + 28;           // 319
  const Y_TRA_HEAD  = Y_DES_R2 + 28;           // 347
  const Y_TRA_R1    = Y_TRA_HEAD + SECTION_HEAD_H;
  const Y_BENS_HEAD = Y_TRA_R1 + 36;           // 405
  const Y_BENS_TH   = Y_BENS_HEAD + SECTION_HEAD_H + 8;
  const Y_ITEMS     = Y_BENS_TH + ITEM_HEAD_H;
  const Y_TOTAL     = Y_ITEMS + nItens * 34;   // 475 para 1 item
  const Y_DADOS     = Y_TOTAL + TOTAL_ROW_H;
  const Y_INF       = Y_DADOS + DADOS_ROW_H;
  const Y_QR_H      = Y_INF + INFO_ROW_H;
  const Y_QR_C      = Y_QR_H + QR_HEAD_H;
  const QR_H        = 196;
  const LL          = Y_QR_C + QR_H + 14;

  const lines = [
    '^XA',
    '^CI13',
    '^PW799',
    '^LH10,18',
    `^LL${LL}`,

    // ── Cabeçalho principal (left: DACE info mesclado; right: código de barras) ──
    `^FO0,${Y0}^GB789,${FULL_H},2^FS`,
    `^FO193,${Y0}^GB2,${FULL_H},2^FS`,
    `^FO0,38^A0N,16,9^FB193,1,,C^FDDACE  -  DECLARACAO AUXILIAR\\&^FS`,
    `^FO0,57^A0N,14,8^FB193,1,,C^FDDE  CONTEUDO  ELETRONICA\\&^FS`,
    `^FO2,100^A0N,18,17^FB191,1,,C^FDN: ${nfeNumFmt}\\&^FS`,
    `^FO2,128^A0N,18,17^FB191,1,,C^FDSERIE: ${nfeSerieFmt}\\&^FS`,
    `^FO220,24^BY2,3,60^BCN,60,N,N,N,A^FD${chave}^FS`,

    // ── Dígitos da chave ──
    `^FO198,${Y_DIGITS}^A0N,13,11^FB588,1,,C^FD${z(chaveFormatted, 60)}\\&^FS`,

    // ── Data emissão / Modalidade ──
    `^FO193,${Y_DATA}^GB596,2,2^FS`,
    `^FO423,${Y_DATA}^GB2,32,2^FS`,
    `^FO198,${Y_DATA + 4}^A0N,12,10^FB222,2,,^FDData emissao: ${z(dataFmt, 40)}^FS`,
    `^FO428,${Y_DATA + 4}^A0N,12,10^FB357,2,,^FDModalidade de Transporte: 0 - TRANSPORTE PELOS CORREIOS\\&^FS`,

    // ── Protocolo ──
    `^FO193,${Y_PROT}^GB596,2,2^FS`,
    `^FO198,${Y_PROT + 4}^A0N,11,9^FB587,1,,^FDProtocolo de autorizacao: ${z(protocoloFmt, 70)}^FS`,

    // ── CAIXA 1: Identificação ─────────────────────────────────────────────
    // Caixa externa única; divisores internos 1px evitam bordas duplas/grossas
    `^FO0,${Y_REM_HEAD}^GB789,${Y_BENS_HEAD + SECTION_HEAD_H - Y_REM_HEAD},2^FS`,
    // Divisores horizontais internos (1px, recuados 2px das laterais)
    `^FO2,${Y_REM_R1}^GB785,1,1^FS`,
    `^FO2,${Y_REM_R2}^GB785,1,1^FS`,
    `^FO2,${Y_DES_HEAD}^GB785,1,1^FS`,
    `^FO2,${Y_DES_R1}^GB785,1,1^FS`,
    `^FO2,${Y_DES_R2}^GB785,1,1^FS`,
    `^FO2,${Y_TRA_HEAD}^GB785,1,1^FS`,
    `^FO2,${Y_TRA_R1}^GB785,1,1^FS`,
    `^FO2,${Y_BENS_HEAD}^GB785,1,1^FS`,
    // Divisores verticais de coluna nas linhas de dados (x=230)
    `^FO230,${Y_REM_R1}^GB2,28,2^FS`,
    `^FO230,${Y_REM_R2}^GB2,28,2^FS`,
    `^FO230,${Y_DES_R1}^GB2,28,2^FS`,
    `^FO230,${Y_DES_R2}^GB2,28,2^FS`,
    `^FO230,${Y_TRA_R1}^GB2,36,2^FS`,
    // ── Remetente
    `^FO5,${Y_REM_HEAD + SECTION_HEAD_TXT_Y}^A0N,16,14^FB789,1,,C^FDIDENTIFICACAO DO REMETENTE (USUARIO EMITENTE)^FS`,
    `^FO5,${Y_REM_R1 + 4}^A0N,13,12^FD${z('CNPJ: ' + (remDoc || 'NAO INFORMADO'), 35)}^FS`,
    `^FO235,${Y_REM_R1 + 4}^A0N,13,12^FD${z('NOME: ' + remetente, 55)}^FS`,
    `^FO5,${Y_REM_R2 + 4}^A0N,13,12^FD${z('CIDADE-UF: ' + (remAddr.cidadeUf || 'NAO INFORMADO'), 35)}^FS`,
    `^FO235,${Y_REM_R2 + 4}^A0N,13,12^FD${z('ENDERECO: ' + (remAddr.endereco || remEndereco || '-'), 55)}^FS`,
    // ── Destinatário
    `^FO5,${Y_DES_HEAD + SECTION_HEAD_TXT_Y}^A0N,16,14^FB789,1,,C^FDIDENTIFICACAO DO DESTINATARIO^FS`,
    `^FO5,${Y_DES_R1 + 4}^A0N,13,12^FD${z('IDOUTROS: ' + (desDoc || 'NAOINFORMADO'), 35)}^FS`,
    `^FO235,${Y_DES_R1 + 4}^A0N,13,12^FD${z('NOME: ' + destinatario, 55)}^FS`,
    `^FO5,${Y_DES_R2 + 4}^A0N,13,12^FD${z('CIDADE-UF: ' + (desAddr.cidadeUf || 'NAO INFORMADO'), 35)}^FS`,
    `^FO235,${Y_DES_R2 + 4}^A0N,13,12^FD${z('ENDERECO: ' + (desAddr.endereco || desEndereco || '-'), 55)}^FS`,
    // ── Transportadora (ECT)
    `^FO5,${Y_TRA_HEAD + SECTION_HEAD_TXT_Y}^A0N,16,14^FB789,1,,C^FDTRANSPORTADORA^FS`,
    `^FO5,${Y_TRA_R1 + 3}^A0N,10,8^FB225,2,,^FDCNPJ FISCO/ MARKET/ TRANSP:\\&${z(cnpjTransp || '34.028.316/0001-03', 30)}^FS`,
    `^FO235,${Y_TRA_R1 + 3}^A0N,10,8^FB554,2,,^FDNOME FISCO/ MARKETPLACE/ TRANSPORTADORA: ${z(nomeTransp || 'EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS', 55)}^FS`,
    // ── Bens (cabeçalho)
    `^FO5,${Y_BENS_HEAD + SECTION_HEAD_TXT_Y}^A0N,16,14^FB789,1,,C^FDIDENTIFICACAO DOS BENS OU MERCADORIAS^FS`,

    // ── CAIXA 2: Itens + Dados Adicionais ────────────────────────────────────
    // Outer box (Y_BENS_TH inclui +4px de separação visual da caixa 1)
    `^FO0,${Y_BENS_TH}^GB789,${Y_QR_C + QR_H - Y_BENS_TH},2^FS`,
    // Divisores verticais no cabeçalho da tabela de itens
    `^FO55,${Y_BENS_TH}^GB2,${ITEM_HEAD_H},2^FS`,
    `^FO665,${Y_BENS_TH}^GB2,${ITEM_HEAD_H},2^FS`,
    `^FO730,${Y_BENS_TH}^GB2,${ITEM_HEAD_H},2^FS`,
    `^FO5,${Y_BENS_TH + 4}^A0N,14,13^FDITEM^FS`,
    `^FO60,${Y_BENS_TH + 4}^A0N,14,13^FDDESCRICAO^FS`,
    `^FO670,${Y_BENS_TH + 4}^A0N,14,13^FDQTDE^FS`,
    `^FO735,${Y_BENS_TH + 4}^A0N,14,13^FDVALOR^FS`,
    // Divisor após cabeçalho da tabela
    `^FO2,${Y_ITEMS}^GB785,1,1^FS`,

    // Linhas de itens
    ...itensFmt.flatMap((it, i) => {
      const yI = Y_ITEMS + i * 34;
      return [
        ...(i > 0 ? [`^FO2,${yI}^GB785,1,1^FS`] : []),
        `^FO55,${yI}^GB2,34,2^FS`,
        `^FO665,${yI}^GB2,34,2^FS`,
        `^FO730,${yI}^GB2,34,2^FS`,
        `^FO5,${yI + 9}^A0N,16,14^FB50,1,,C^FD${i + 1}\\&^FS`,
        `^FO60,${yI + 5}^A0N,13,12^FB605,2,,^FD${z(it.conteudo || '', 55)}\\&^FS`,
        `^FO670,${yI + 9}^A0N,16,14^FB60,1,,C^FD${z(String(it.quantidade || '1'), 5)}\\&^FS`,
        `^FO735,${yI + 7}^A0N,13,12^FD${z(String(it.valor_unitario || '0,01'), 10)}^FS`,
      ];
    }),

    // Linha vazia se sem itens
    ...(itensFmt.length === 0 ? [
      `^FO55,${Y_ITEMS}^GB2,34,2^FS`,
      `^FO665,${Y_ITEMS}^GB2,34,2^FS`,
      `^FO730,${Y_ITEMS}^GB2,34,2^FS`,
    ] : []),

    // Divisor / VALOR TOTAL
    `^FO2,${Y_TOTAL}^GB785,1,1^FS`,
    `^FO5,${Y_TOTAL + SECTION_HEAD_TXT_Y}^A0N,14,13^FB789,1,,C^FDVALOR TOTAL R$ ${z(itensFmt.map(it => it.valor_unitario || '0,01').join(' + ') || '0,00', 50)}^FS`,

    // Divisor / DADOS ADICIONAIS
    `^FO2,${Y_DADOS}^GB785,1,1^FS`,
    `^FO5,${Y_DADOS + SECTION_HEAD_TXT_Y}^A0N,16,14^FB789,1,,C^FDDADOS ADICIONAIS^FS`,

    // Divisor / INF COMPLEMENTARES
    `^FO2,${Y_INF}^GB785,1,1^FS`,
    `^FO185,${Y_INF}^GB2,${INFO_ROW_H},2^FS`,
    `^FO5,${Y_INF + 6}^A0N,13,12^FDINF. COMPLEMENTARES:^FS`,
    `^FO190,${Y_INF + 6}^A0N,13,12^FDINFORMACOES ADICIONAIS DO FISCO^FS`,


    // Divisor / QR-CODE header
    `^FO2,${Y_QR_H}^GB785,1,1^FS`,
    `^FO210,${Y_QR_H}^GB2,${QR_HEAD_H},2^FS`,
    `^FO5,${Y_QR_H + SECTION_HEAD_TXT_Y}^A0N,16,14^FB205,1,,C^FDQR-CODE^FS`,
    `^FO215,${Y_QR_H + SECTION_HEAD_TXT_Y}^A0N,16,14^FB580,1,,C^FDOBSERVACOES^FS`,

    // Divisor / QR-CODE content
    `^FO2,${Y_QR_C}^GB785,1,1^FS`,
    `^FO210,${Y_QR_C}^GB2,${QR_H},2^FS`,
    `^FO34,${Y_QR_C - 18}^BQN,3,3^FDQA,https://www.fazenda.pr.gov.br/dce/qrcode?chDCe=${chave}&tpAmb=1^FS`,
    `^FO224,${Y_QR_C + 8}^A0N,15,13^FB548,10,2,L^FD${observacoesText}^FS`,

    '^XZ',
  ];

  return lines.join('\n');
}

function _upgradeLegacyDeclaracaoZpl(zpl, chaveFallback = '') {
  const extraidos = _extrairDadosNfeDaPostagem({ ObservacaoDois: chaveFallback }, {});
  const nfeNumFmt = extraidos.nfeNum || '---';
  const nfeSerieFmt = extraidos.nfeSerie ? String(extraidos.nfeSerie).padStart(3, '0') : '---';
  const observacoesText = _zplAscii(_getDeclaracaoObservacoesText(), 1600);

  let updated = String(zpl || '')
    .replace(/\^CI28/, '^CI13')
    .replace(/\^LH5,8/, '^LH10,18')
    .replace(/\^LL(\d+)/, (_, ll) => `^LL${Number(ll) + 10}`)
    .replace(/\^FO232,20\^BY1,3,80\^BCN,80,N,N\^FD[^\^]+\^FS/g, `^FO220,24^BY2,3,60^BCN,60,N,N,N,A^FD${extraidos.chaveNfe || '0'.repeat(44)}^FS`)
    .replace(/\^FD(?:NUMERO|N(?:º|°|Â°)?): [^^]*\^FS/g, `^FDN: ${nfeNumFmt}\\&^FS`)
    .replace(/\^FDS(?:ÉRIE|ERIE|Â°\/00RIE): [^^]*\^FS/g, `^FDSERIE: ${nfeSerieFmt}\\&^FS`)
    .replace(/Data emiss[^:]*:/g, 'Data emissao:')
    .replace(/Protocolo de autoriza[^:]*:/g, 'Protocolo de autorizacao:')
    .replace(/ENDERE[^:]*:/g, 'ENDERECO:')

  const qrContentMatch = updated.match(/\^FO2,(\d+)\^GB785,1,1\^FS\s*\^FO210,\1\^GB2,\d+,2\^FS\s*\^FO(?:40|34),\d+\^BQN,3,3\^FDQA,[^\^]+\^FS/);
  if (qrContentMatch) {
    const qrY = Number(qrContentMatch[1]) - 18;
    updated = updated.replace(/\^FO(?:40|34),\d+\^BQN,3,3\^FDQA,[^\^]+\^FS/g, `^FO34,${qrY}^BQN,3,3^FDQA,https://www.fazenda.pr.gov.br/dce/qrcode?chDCe=${extraidos.chaveNfe || '0'.repeat(44)}&tpAmb=1^FS`);
  }

  return updated
    .replace(/\^FO(?:224|220|218),(\d+)\^A0N,\d+,\d+\^FB\d+,\d+,\d+,[A-Z](?:\^FH_)?\^FD[^\^]*\^FS/g, `^FO224,$1^A0N,15,13^FB548,10,2,L^FD${observacoesText}^FS`);
}

// ── GET /api/vipp/sep-check ───────────────────────────────────────────────────
// Verifica se uma SEP foi gerada a partir de uma postagem VIPP.
// Query: n_solic — ex.: SEP-1001
// Retorna: { ok, idVipp } onde idVipp é o IdConhecimento VIPP ou null.
//
router.get('/sep-check', async (req, res) => {
  const { n_solic } = req.query;
  if (!n_solic) return res.json({ ok: true, idVipp: null });
  try {
    const { rows } = await dbQuery(
      `SELECT id_vipp FROM envios.solicitacoes WHERE numero_sep = $1 AND id_vipp IS NOT NULL LIMIT 1`,
      [n_solic]
    );
    return res.json({ ok: true, idVipp: rows[0]?.id_vipp || null });
  } catch (e) {
    console.warn('[VIPP] sep-check erro:', e.message);
    return res.json({ ok: true, idVipp: null });
  }
});

module.exports = router;
// Helpers exportados para uso pelo cron de enriquecimento.
// Mantem o router como export principal (compatibilidade) e expoe os
// utilitarios via propriedades.
module.exports.helpers = {
  resolverDadosDeclaracao: _resolverDadosDeclaracao,
  persistirDeclaracaoCache: _persistirDeclaracaoCache,
  buscarSituacaoPostagem: _buscarSituacaoPostagem,
  temDadosDeclaracao: _temDadosDeclaracao,
  dadosDeclaracaoCompletos: _dadosDeclaracaoCompletos,
  montarDadosDeclaracaoFallback: _montarDadosDeclaracaoFallback,
  vippEstaBloqueado: () => _vippGetRateLimit('situacao_postagem'),
};