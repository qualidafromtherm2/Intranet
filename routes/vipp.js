// routes/vipp.js — Integração VIPP VisualSet (Correios / PostarObjeto SOAP)
'use strict';

const express = require('express');
const axios   = require('axios');
const { dbQuery } = require('../src/db');

const router = express.Router();

// ── Credenciais (variáveis de ambiente; padrão = homologação VisualSet) ───────
const VIPP_USUARIO   = process.env.VIPP_USUARIO   || 'onbiws';
const VIPP_TOKEN     = process.env.VIPP_TOKEN     || '112233';
const VIPP_ID_PERFIL = process.env.VIPP_ID_PERFIL || '9363';
const VIPP_ENDPOINT  = 'http://vpsrv.visualset.com.br/PostagemVipp.asmx';
const VIPP_IMPRESSAO = 'https://vipp.visualset.com.br/vipp/remoto/ImpressaoRemota.php';
const VIPP_WEB_URL   = 'https://vipp.visualset.com.br';

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
  const { id } = req.query;
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

    // Se o registro já tem etiqueta_url, o frontend deveria abrir o PDF diretamente
    if (rows[0].etiqueta_url) {
      return res.status(400).json({ ok: false, error: 'Este envio já possui etiqueta PDF salva. Abra o link diretamente.', etiqueta_url: rows[0].etiqueta_url });
    }

    const identificacao = (rows[0].identificacao || '').trim().replace(/\s+/g, '');
    if (!identificacao) {
      return res.status(400).json({ ok: false, error: 'Código de identificação (ECT) ainda não disponível para este envio' });
    }

    // 2. Busca ZVP (ZPL) no VIPP — Filtro=1 (Registro ECT), Saida=0 (ZVP)
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
    const zpl = Buffer.from(vippResp.data).toString('latin1');
    if (!zpl.trim()) {
      return res.status(502).json({ ok: false, error: 'VIPP retornou ZPL vazio' });
    }

    // 3. Enfileira no agente de impressão
    const filaIns = await dbQuery(
      `INSERT INTO etiqueta."ETQ_fila_impressao" (etq_ids, multiplo, usuario, zpl, quantidade, destino_agente, impressora)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [[], 0, usuario, zpl, 1, destino_agente || null, impressora || null]
    );
    console.log(`[VIPP] imprimir-envio: envio_id=${envio_id} identificacao=${identificacao} fila_id=${filaIns.rows[0].id}`);
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
  if (!id) return res.status(400).json({ ok: false, error: 'Parâmetro id obrigatório' });

  try {
    const { rows } = await dbQuery(
      `SELECT id, declaracao_url, identificacao, id_vipp, conteudo, observacao, usuario
         FROM envios.solicitacoes WHERE id = $1 LIMIT 1`,
      [Number(id)]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Envio não encontrado' });
    const envio = rows[0];

    // 1. Se já tem declaração salva em Supabase → redireciona
    if (envio.declaracao_url) {
      return res.redirect(302, envio.declaracao_url);
    }

    // 2. Busca ZVP no VIPP para extrair dados de declaração
    const ect    = (envio.identificacao || '').trim().replace(/\s+/g, '');
    const idVipp = (envio.id_vipp || '').trim();

    if (!ect && !idVipp) {
      // Sem dados VIPP — tenta gerar declaração básica do conteudo salvo
      if (!envio.conteudo) {
        return res.status(404).send('<p>Declaração não disponível para este envio.</p>');
      }
      // Gera HTML simples a partir do campo conteudo
      let itens = [];
      try { itens = JSON.parse(envio.conteudo); } catch { itens = []; }
      return res.send(_gerarHtmlDeclaracao({
        remetente: 'FROM THERM SISTEMAS TERMICOS LTDA ME',
        destinatario: envio.observacao || '',
        ect: ect || '',
        itens,
      }));
    }

    // Busca ZVP para extrair dados
    const filtro = /^[A-Z]{2}\d{9}BR$/i.test(ect) ? '1' : (idVipp ? '4' : '1');
    const lista  = filtro === '4' ? idVipp : ect;
    const params = new URLSearchParams({ Usr: VIPP_USUARIO, Pwd: VIPP_TOKEN, Filtro: filtro, Ordem: '1', Saida: '0', Lista: lista });

    let zvpXml = '';
    try {
      const resp = await axios.get(`${VIPP_IMPRESSAO}?${params}`, { responseType: 'arraybuffer', timeout: 30000, validateStatus: s => s === 200 });
      zvpXml = Buffer.from(resp.data).toString('latin1');
    } catch (e) {
      console.warn('[VIPP] declaracao: falha ao buscar ZVP:', e.message);
    }

    // Parseia campos do ZVP (extrai primeiro RECORD)
    const getField = (xml, tag) => {
      const m = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };

    const remetente    = getField(zvpXml, 'rem_nom') || 'FROM THERM SISTEMAS TERMICOS LTDA ME';
    const remRazao     = getField(zvpXml, 'nomechancela') || remetente;
    const remEndereco  = [getField(zvpXml, 'rem_log'), getField(zvpXml, 'rem_nro'), getField(zvpXml, 'rem_cpl'), getField(zvpXml, 'rem_brr'), getField(zvpXml, 'rem_cid') + '/' + getField(zvpXml, 'rem_uf'), getField(zvpXml, 'rem_cep')].filter(Boolean).join(', ');
    const remDoc       = getField(zvpXml, 'rem_doc') || '';
    const destinatario = getField(zvpXml, 'des_nom') || (envio.observacao || '');
    const desEndereco  = [getField(zvpXml, 'des_log'), getField(zvpXml, 'des_nro'), getField(zvpXml, 'des_cpl'), getField(zvpXml, 'des_brr'), getField(zvpXml, 'des_cid') + '/' + getField(zvpXml, 'des_uf'), getField(zvpXml, 'des_cep')].filter(Boolean).join(', ');
    const desDoc       = getField(zvpXml, 'des_doc') || '';
    const ectCode      = getField(zvpXml, 'ect_reg') || ect;
    const chaveNfe     = getField(zvpXml, 'vol_obs2') || '';
    const nfeNum       = getField(zvpXml, 'not_num')  || '';
    const nfeSerie     = getField(zvpXml, 'not_ser')  || '';

    // Parseia itens de conteúdo do ZVP (disc_conteudo_N: quantidade|descricao|valor|peso)
    const itens = [];
    if (zvpXml) {
      const reItens = /<disc_conteudo_\d+>(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?<\/disc_conteudo_\d+>/gi;
      let m;
      while ((m = reItens.exec(zvpXml)) !== null) {
        const parts = m[1].split('|');
        if (parts.length >= 2) {
          itens.push({
            conteudo:       parts[1] ? parts[1].trim() : '',
            quantidade:     parts[0] ? parts[0].trim() : '1',
            valor_unitario: parts[2] ? parts[2].trim() : '0,00',
            valor_total:    '',
          });
        }
      }
    }

    // Fallback: itens do campo conteudo salvo no banco
    if (!itens.length && envio.conteudo) {
      try { const parsed = JSON.parse(envio.conteudo); itens.push(...parsed); } catch {}
    }

    return res.send(_gerarHtmlDeclaracao({ remetente: remRazao || remetente, remEndereco, remDoc, destinatario, desEndereco, desDoc, ect: ectCode, chaveNfe, nfeNum, nfeSerie, itens }));

  } catch (err) {
    console.error('[VIPP] declaracao erro:', err.message);
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

// ── POST /api/vipp/imprimir-declaracao ───────────────────────────────────────
// Busca dados da declaração via ZVP VIPP, gera ZPL e enfileira no agente.
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
      `SELECT id, identificacao, id_vipp, conteudo, observacao
         FROM envios.solicitacoes WHERE id = $1 LIMIT 1`,
      [Number(envio_id)]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Envio não encontrado' });
    const envio = rows[0];

    const ect    = (envio.identificacao || '').trim().replace(/\s+/g, '');
    const idVipp = (envio.id_vipp || '').toString().trim();

    if (!ect && !idVipp) {
      return res.status(400).json({ ok: false, error: 'Envio sem código ECT ou ID VIPP — declaração não disponível' });
    }

    // 2. Busca ZVP no VIPP (mesmos parâmetros que GET /declaracao)
    const filtro = /^[A-Z]{2}\d{9}BR$/i.test(ect) ? '1' : (idVipp ? '4' : '1');
    const lista  = filtro === '4' ? idVipp : ect;
    const params = new URLSearchParams({
      Usr: VIPP_USUARIO, Pwd: VIPP_TOKEN,
      Filtro: filtro, Ordem: '1', Saida: '0', Lista: lista,
    });
    const vippResp = await axios.get(`${VIPP_IMPRESSAO}?${params}`, {
      responseType: 'arraybuffer', timeout: 30000, validateStatus: s => s === 200,
    });
    const zvpXml = Buffer.from(vippResp.data).toString('latin1');
    if (!zvpXml.trim()) {
      return res.status(502).json({ ok: false, error: 'VIPP retornou ZVP vazio para este envio' });
    }

    // 3. Parseia campos do ZVP
    const getField = (tag) => {
      const m = zvpXml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };

    const remetente   = getField('nomechancela') || getField('rem_nom') || 'FROM THERM';
    const remEndereco = [
      getField('rem_log'), getField('rem_nro'), getField('rem_brr'),
      getField('rem_cid') + '/' + getField('rem_uf'), 'CEP ' + getField('rem_cep'),
    ].filter(Boolean).join(' - ');
    const remDoc       = getField('rem_doc') || '';
    const destinatario = getField('des_nom') || (envio.observacao || '');
    const desEndereco  = [
      getField('des_log'), getField('des_nro'), getField('des_brr'),
      getField('des_cid') + '/' + getField('des_uf'), 'CEP ' + getField('des_cep'),
    ].filter(Boolean).join(' - ');
    const desDoc  = getField('des_doc') || '';
    const ectCode = getField('ect_reg') || ect;
    const chaveNfe = getField('vol_obs2') || '';

    // Parseia itens de conteúdo (disc_conteudo_N: quantidade|descricao|valor|peso)
    const itens = [];
    const reItens = /<disc_conteudo_\d+>(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?<\/disc_conteudo_\d+>/gi;
    let mItem;
    while ((mItem = reItens.exec(zvpXml)) !== null) {
      const parts = mItem[1].split('|');
      if (parts.length >= 2) {
        itens.push({
          conteudo:       (parts[1] || '').trim(),
          quantidade:     (parts[0] || '1').trim(),
          valor_unitario: (parts[2] || '0,01').trim(),
        });
      }
    }

    // 4. Gera ZPL da declaração
    const zpl = _gerarZplDeclaracao({ remetente, remEndereco, destinatario, desEndereco, ect: ectCode, chaveNfe, itens });

    // 5. Enfileira no agente de impressão
    const filaIns = await dbQuery(
      `INSERT INTO etiqueta."ETQ_fila_impressao" (etq_ids, multiplo, usuario, zpl, quantidade, destino_agente, impressora)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [[], 0, usuario, zpl, 1, destino_agente || null, impressora || null]
    );
    console.log(`[VIPP] imprimir-declaracao: envio_id=${envio_id} ect=${ectCode} fila_id=${filaIns.rows[0].id}`);
    return res.json({ ok: true, fila_id: filaIns.rows[0].id });

  } catch (err) {
    const status = err.response?.status;
    if (status === 215) return res.status(502).json({ ok: false, error: 'Declaração não encontrada no VIPP' });
    console.error('[VIPP] imprimir-declaracao erro:', err.message);
    return res.status(502).json({ ok: false, error: err.message || 'Falha ao comunicar com VIPP' });
  }
});

// Gera ZPL da Declaração de Conteúdo para impressora térmica (100x150mm, 203dpi)
function _gerarZplDeclaracao({ remetente, remEndereco, destinatario, desEndereco, ect, chaveNfe, itens }) {
  // Sanitiza texto para ZPL: remove ^ ~ que são chars de controle ZPL
  const z = (s, max = 60) => String(s || '').replace(/[\^~]/g, '-').replace(/\|/g, ' ').substring(0, max);

  const LM = 20;   // margem esquerda em pontos
  const IW = 772;  // largura interna (812 - 2×20)
  const cmds = [];
  let y = 20;

  const addText = (str, h, x = LM) => {
    if (!str) return;
    cmds.push(`^FO${x},${y}^A0N,${h},${h}^FD${z(str)}^FS`);
    y += h + 8;
  };

  const addSep = () => {
    cmds.push(`^FO${LM},${y}^GB${IW},2,2^FS`);
    y += 12;
  };

  // Título
  addText('*** DECLARACAO DE CONTEUDO ***', 26);
  addSep();

  // Remetente
  addText('REMETENTE:', 22);
  addText(remetente, 20, LM + 10);
  if (remEndereco) addText(remEndereco, 16, LM + 10);
  y += 4;
  addSep();

  // Destinatário
  addText('DESTINATARIO:', 22);
  addText(destinatario, 20, LM + 10);
  if (desEndereco) addText(desEndereco, 16, LM + 10);
  y += 4;
  addSep();

  // Código ECT
  if (ect) {
    addText('OBJETO POSTAL: ' + ect, 20);
    y += 4;
    addSep();
  }

  // Itens de conteúdo
  addText('CONTEUDO:', 22);
  (itens || []).forEach((it, i) => {
    const desc = (it.conteudo || '').substring(0, 45);
    const qty  = it.quantidade || '1';
    const val  = it.valor_unitario || '0,01';
    addText(`${i + 1}. ${desc}`, 18);
    addText(`Qtd: ${qty}  Valor: R$ ${val}`, 16, LM + 20);
  });
  y += 10;
  addSep();

  // QR code com a chave NF-e (se disponível) — ocupa 120x120 dots à direita
  if (chaveNfe && /^\d{44}$/.test(chaveNfe)) {
    const qrY = y;
    cmds.push(`^FO${LM},${qrY}^A0N,16,16^FDCHAVE NF-e:^FS`);
    cmds.push(`^FO${LM},${qrY + 22}^A0N,14,14^FD${z(chaveNfe.substring(0, 44), 44)}^FS`);
    // QR code posicionado à direita
    cmds.push(`^FO${812 - 140},${qrY}^BQN,2,4^FDMM,A${chaveNfe}^FS`);
    y = qrY + 140;
    y += 8;
  }

  y += 10; // padding inferior

  return `^XA\n^CI13\n^PW812\n^LH0,0\n^LL${y}\n${cmds.join('\n')}\n^XZ`;
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
