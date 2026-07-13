const express = require('express');
const router = express.Router();

const { dbQuery } = require('../src/db');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config.server');
const { registrarEventoReq: monEventoReq } = require('../utils/monitoramento');

const STATUS_AGUARDANDO = 'Aguardando aprovação';
const STATUS_TRANSFERIDO = 'Transferido';
const STATUS_REPROVADO = 'Reprovado';
const ERROS_OMIE_SEM_RETRY_IMEDIATO = [
  /api bloqueada por consumo indevido/i,
  /consumo redundante detectado/i,
  /nenhum produto foi localizado/i,
  /produto.+n.o encontrado/i,
  /valor unit.rio.+deve ser maior que zero/i
];

let schemaTransferenciasOk = false;

async function ensureTransferenciasSchema() {
  if (schemaTransferenciasOk) return;
  await dbQuery(`
    ALTER TABLE mensagens.transferencias
      ADD COLUMN IF NOT EXISTS data_movimentacao DATE,
      ADD COLUMN IF NOT EXISTS cmc NUMERIC(18,4),
      ADD COLUMN IF NOT EXISTS reprovado_por TEXT,
      ADD COLUMN IF NOT EXISTS reprovado_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS motivo_reprovacao TEXT
  `);
  await dbQuery(`
    ALTER TABLE mensagens.transferencias
      DROP CONSTRAINT IF EXISTS transferencias_codigo_produto_fkey
  `);
  schemaTransferenciasOk = true;
}

// Resolve o identificador numérico do produto (codigo_produto) usando o código Omie textual ou numérico.
async function buscarProdutoPorCodigoProduto(codigoProduto) {
  const id = Number(codigoProduto);
  if (!Number.isFinite(id)) return null;
  const { rows } = await dbQuery(
    `SELECT codigo_produto
       FROM public.produtos_omie
      WHERE codigo_produto = $1
      LIMIT 1`,
    [id]
  );
  return rows.length ? Number(rows[0].codigo_produto) : null;
}

async function resolveCodigoProduto(codigoParam) {
  const raw = String(codigoParam || '').trim();
  if (!raw) {
    const err = new Error('Código do produto ausente.');
    err.status = 400;
    throw err;
  }

  if (/^\d+$/.test(raw)) {
    const existente = await buscarProdutoPorCodigoProduto(raw);
    if (existente) return existente;
  }

  const sql = `
    SELECT codigo_produto
      FROM public.produtos_omie
     WHERE codigo = $1
     LIMIT 1
  `;
  const { rows } = await dbQuery(sql, [raw]);
  if (!rows.length) {
    const err = new Error(`Produto "${raw}" não encontrado.`);
    err.status = 404;
    throw err;
  }
  return Number(rows[0].codigo_produto);
}

async function resolverCodigoProdutoTransferencia(candidatos, codigo) {
  for (const candidato of candidatos) {
    const str = candidato !== undefined && candidato !== null ? String(candidato).trim() : '';
    if (!str || !/^\d+$/.test(str)) continue;
    const existente = await buscarProdutoPorCodigoProduto(str);
    if (existente) return existente;
  }
  return resolveCodigoProduto(codigo);
}

function normalizaNumeroParaOmie(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const textoOriginal = String(value).trim();
  if (!textoOriginal) return null;

  const semEspacos = textoOriginal.replace(/\s+/g, '');
  const possuiVirgula = semEspacos.includes(',');
  const possuiPonto = semEspacos.includes('.');

  let normalizado = semEspacos;

  if (possuiVirgula && possuiPonto) {
    if (semEspacos.lastIndexOf(',') > semEspacos.lastIndexOf('.')) {
      normalizado = semEspacos.replace(/\./g, '').replace(',', '.');
    } else {
      normalizado = semEspacos.replace(/,/g, '');
    }
  } else if (possuiVirgula) {
    normalizado = semEspacos.replace(/\./g, '').replace(',', '.');
  } else if (possuiPonto) {
    const partes = semEspacos.split('.');
    if (partes.length > 2) {
      normalizado = semEspacos.replace(/\./g, '');
    } else if (partes.length === 2 && partes[1].length === 3) {
      normalizado = semEspacos.replace(/\./g, '');
    }
  }

  const parsed = Number(normalizado);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatarDataBR(data = new Date()) {
  const valor = data instanceof Date ? data : new Date(data);
  const dia = String(valor.getDate()).padStart(2, '0');
  const mes = String(valor.getMonth() + 1).padStart(2, '0');
  const ano = String(valor.getFullYear());
  return `${dia}/${mes}/${ano}`;
}

function normalizarDataMovimentacao(value) {
  const raw = String(value || '').trim();
  if (!raw) return new Date();

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, ano, mes, dia] = isoMatch;
    return new Date(Number(ano), Number(mes) - 1, Number(dia));
  }

  const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    const [, dia, mes, ano] = brMatch;
    return new Date(Number(ano), Number(mes) - 1, Number(dia));
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function formatarDataSql(data = new Date()) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

async function buscarCmcAtual({ codigo, origem }) {
  if (!codigo || !origem) return null;
  const { rows } = await dbQuery(
    `SELECT cmc
       FROM logistica.estoque_atual
      WHERE codigo = $1
        AND local_codigo = $2
      LIMIT 1`,
    [String(codigo).trim(), String(origem).trim()]
  );
  const cmc = normalizaNumeroParaOmie(rows?.[0]?.cmc);
  return cmc && cmc > 0 ? cmc : null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isErroOmieRetryable({ httpStatus, texto }) {
  const body = String(texto || '');
  if (ERROS_OMIE_SEM_RETRY_IMEDIATO.some((regex) => regex.test(body))) {
    return false;
  }
  return httpStatus === 425
    || httpStatus === 429
    || httpStatus >= 500
    || /too many|rate limit|consumo redundante|requisi/i.test(body);
}

async function incluirAjusteEstoqueOmie({ origem, destino, codigo_produto, qtd, codigo, id, cmc, data_movimentacao, motivo }, aprovadoPor) {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    const err = new Error('Credenciais da Omie ausentes.');
    err.status = 500;
    throw err;
  }

  const origemNumero = normalizaNumeroParaOmie(origem);
  const destinoNumero = normalizaNumeroParaOmie(destino);
  const idProdutoNumero = normalizaNumeroParaOmie(codigo_produto);
  const quantidadeNumero = normalizaNumeroParaOmie(qtd) ?? 0;
  const quantidadeValida = quantidadeNumero > 0 ? quantidadeNumero : 0;
  const valorCmcInformado = normalizaNumeroParaOmie(cmc);
  const valorCmc = valorCmcInformado && valorCmcInformado > 0
    ? valorCmcInformado
    : await buscarCmcAtual({ codigo, origem });
  if (!valorCmc || valorCmc <= 0) {
    const err = new Error(`CMC ausente ou invalido para o produto ${codigo || codigo_produto}. Nao e seguro movimentar estoque sem valor do produto.`);
    err.status = 400;
    throw err;
  }
  const dataMovimentacao = normalizarDataMovimentacao(data_movimentacao);
  const motivoNormalizado = String(motivo || 'TRF').toUpperCase();
  const motivoOmie = (motivoNormalizado === 'TPQ' || motivoNormalizado === 'TRF') ? motivoNormalizado : 'TRF';

  const payload = {
    call: 'IncluirAjusteEstoque',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [
      {
        codigo_local_estoque: origemNumero ?? origem ?? '',
        codigo_local_estoque_destino: destinoNumero ?? destino ?? '',
        id_prod: idProdutoNumero ?? codigo_produto,
        data: formatarDataBR(dataMovimentacao),
        quan: String(quantidadeValida || quantidadeNumero || qtd || '0'),
        obs: `Solicitação de transferência #${id} do produto ${codigo || ''}. Aprovado por ${aprovadoPor}.`,
        origem: 'AJU',
        tipo: 'TRF',
        motivo: motivoOmie,
        valor: valorCmc
      }
    ]
  };

  const resumoEnvio = {
    transferenciaId: id,
    origem: payload.param[0].codigo_local_estoque,
    destino: payload.param[0].codigo_local_estoque_destino,
    produto: payload.param[0].id_prod,
    data: payload.param[0].data,
    quantidadeOriginal: qtd,
    quantidadeNormalizada: quantidadeNumero,
    quantidadeFinal: payload.param[0].quan,
    valorFinal: payload.param[0].valor
  };
  console.info('[transferencias][omie] Enviando ajuste', resumoEnvio);

  const delays = [3000, 6000, 12000, 24000, 45000];
  let ultimoErro = null;

  for (let tentativa = 0; tentativa <= delays.length; tentativa++) {
    let respRetry;
    let texto = '';
    try {
      respRetry = await fetch('https://app.omie.com.br/api/v1/estoque/ajuste/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      texto = await respRetry.text();
    } catch (fetchErr) {
      ultimoErro = fetchErr;
      if (tentativa < delays.length) {
        await sleep(delays[tentativa]);
        continue;
      }
      const err = new Error(`Falha ao comunicar com a Omie: ${fetchErr.message || fetchErr}`);
      err.status = 502;
      throw err;
    }

    let jsonRetry;
    try {
      jsonRetry = texto ? JSON.parse(texto) : {};
    } catch (parseErr) {
      ultimoErro = parseErr;
      if (isErroOmieRetryable({ httpStatus: respRetry.status, texto }) && tentativa < delays.length) {
        console.warn('[transferencias][omie] retry por resposta invalida/rate-limit', {
          transferenciaId: id,
          tentativa: tentativa + 1,
          httpStatus: respRetry.status
        });
        await sleep(delays[tentativa]);
        continue;
      }
      const err = new Error(`Resposta invalida da Omie. HTTP ${respRetry.status}.`);
      err.status = respRetry.status >= 400 ? respRetry.status : 502;
      throw err;
    }

    if (respRetry.ok && String(jsonRetry?.codigo_status || '') === '0') {
      return jsonRetry;
    }

    const retryable = isErroOmieRetryable({
      httpStatus: respRetry.status,
      texto: texto || jsonRetry?.descricao_status || jsonRetry?.faultstring
    });
    if (retryable && tentativa < delays.length) {
      console.warn('[transferencias][omie] retry por limite/erro temporario', {
        transferenciaId: id,
        tentativa: tentativa + 1,
        httpStatus: respRetry.status,
        descricao: jsonRetry?.descricao_status || jsonRetry?.faultstring || texto?.slice?.(0, 180)
      });
      await sleep(delays[tentativa]);
      continue;
    }

    const msg = jsonRetry?.descricao_status
      || jsonRetry?.faultstring
      || `Falha ao comunicar com a Omie (HTTP ${respRetry.status}).`;
    const err = new Error(msg);
    err.status = respRetry.status >= 400 ? respRetry.status : 502;
    throw err;
  }

  const err = new Error(`Omie nao confirmou a transferencia apos novas tentativas. ${ultimoErro?.message || ''}`.trim());
  err.status = 429;
  throw err;

  const resp = await fetch('https://app.omie.com.br/api/v1/estoque/ajuste/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const msg = `Falha ao comunicar com a Omie (HTTP ${resp.status}).`;
    const err = new Error(msg);
    err.status = 502;
    throw err;
  }

  let json;
  try {
    json = await resp.json();
  } catch (parseErr) {
    const err = new Error('Resposta inválida da Omie.');
    err.status = 502;
    throw err;
  }

  if (String(json?.codigo_status || '') !== '0') {
    const err = new Error(json?.descricao_status || 'Omie retornou erro ao incluir ajuste.');
    err.status = 502;
    throw err;
  }

  return json;
}

function sanitizeNumero(value) {
  if (value === null || value === undefined || value === '') return null;
  const asString = String(value).replace(',', '.');
  const num = Number(asString);
  return Number.isFinite(num) ? num : null;
}

router.get('/', async (_req, res) => {
  try {
    await ensureTransferenciasSchema();
    const { rows } = await dbQuery(
      `WITH pendentes AS (
         SELECT id,
                codigo_produto,
                codigo,
                descricao,
                qtd,
                origem,
                destino,
                data_movimentacao,
                cmc,
                solicitante,
                status,
                aprovado_pro,
                reprovado_por,
                reprovado_em,
                motivo_reprovacao,
                0 AS ordem_status
           FROM mensagens.transferencias
          WHERE lower(coalesce(status, '')) NOT IN ('transferido', 'reprovado')
       ),
       historico AS (
         SELECT id,
                codigo_produto,
                codigo,
                descricao,
                qtd,
                origem,
                destino,
                data_movimentacao,
                cmc,
                solicitante,
                status,
                aprovado_pro,
                reprovado_por,
                reprovado_em,
                motivo_reprovacao,
                1 AS ordem_status
           FROM mensagens.transferencias
          WHERE lower(coalesce(status, '')) IN ('transferido', 'reprovado')
          ORDER BY id DESC
          LIMIT 250
       )
       SELECT id,
              codigo_produto,
              codigo,
              descricao,
              qtd,
              origem,
              destino,
              data_movimentacao,
              cmc,
              solicitante,
              status,
              aprovado_pro,
              reprovado_por,
              reprovado_em,
              motivo_reprovacao
         FROM (
           SELECT * FROM pendentes
           UNION ALL
           SELECT * FROM historico
         ) itens
        ORDER BY ordem_status, id DESC`
    );

    res.json({ ok: true, registros: rows });
  } catch (err) {
    console.error('[transferencias] falha ao listar transferências', err);
    res.status(500).json({ error: 'Falha ao buscar solicitações de transferência.' });
  }
});

router.post('/', express.json(), async (req, res) => {
  try {
    await ensureTransferenciasSchema();
    const origem = String(req.body?.origem || '').trim();
    const destino = String(req.body?.destino || '').trim();
    const dataMovimentacaoRaw = String(req.body?.data_movimentacao || req.body?.dataMovimentacao || '').trim();
    const dataMovimentacao = normalizarDataMovimentacao(dataMovimentacaoRaw);
    const dataMovimentacaoSql = formatarDataSql(dataMovimentacao);
    const solicitante = String(req.body?.solicitante || '').trim() || null;
    const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];

    if (!origem || !destino) {
      return res.status(400).json({ error: 'Informe origem e destino da transferência.' });
    }
    if (!itens.length) {
      return res.status(400).json({ error: 'Nenhum item selecionado para transferência.' });
    }

    const cache = new Map();
    const preparados = [];

    for (const item of itens) {
      if (!item) continue;
      const codigo = String(item.codigo || '').trim();
      const descricao = String(item.descricao || '').trim();
      const qtd = sanitizeNumero(item.qtd);
      const cmcInformado = sanitizeNumero(item.cmc);
      if (!codigo) {
        return res.status(400).json({ error: 'Item sem código informado.' });
      }
      if (qtd === null || qtd <= 0) {
        return res.status(400).json({ error: `Quantidade inválida para o produto ${codigo}.` });
      }

      const cmc = (cmcInformado && cmcInformado > 0) ? cmcInformado : await buscarCmcAtual({ codigo, origem });
      if (!cmc || cmc <= 0) {
        return res.status(400).json({ error: `CMC ausente ou invalido para o produto ${codigo}. Corrija o estoque atual antes de registrar a transferencia.` });
      }

      const candidatos = [
        item.codigo_produto,
        item.codigoProduto,
        item.codigoProdutoId,
        item.codigoProdutoOmie,
        item.codOmie,
        item.codigo_omie
      ];

      const chave = codigo;
      let codigoProduto = cache.get(chave);
      if (!codigoProduto) {
        try {
          codigoProduto = await resolverCodigoProdutoTransferencia(candidatos, codigo);
        } catch (resolveErr) {
          const fallbackNumerico = candidatos
            .map(candidato => String(candidato ?? '').trim())
            .find(str => /^\d+$/.test(str));
          if (!fallbackNumerico) throw resolveErr;
          codigoProduto = Number(fallbackNumerico);
        }
        cache.set(chave, codigoProduto);
      }

      preparados.push({
        codigo_produto: codigoProduto,
        codigo,
        descricao,
        qtd,
        origem,
        destino,
        data_movimentacao: dataMovimentacaoSql,
        cmc,
        solicitante
      });
    }

    if (!preparados.length) {
      return res.status(400).json({ error: 'Nenhum item válido para registrar transferência.' });
    }

    const params = [];
    const valuesSql = preparados.map((item, idx) => {
      const base = idx * 10;
      params.push(
        item.codigo_produto,
        item.codigo,
        item.descricao || null,
        item.qtd,
        item.origem,
        item.destino,
        item.data_movimentacao,
        item.cmc,
        item.solicitante,
        STATUS_AGUARDANDO
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
    }).join(', ');

    const insertSql = `
      INSERT INTO mensagens.transferencias
        (codigo_produto, codigo, descricao, qtd, origem, destino, data_movimentacao, cmc, solicitante, status)
      VALUES ${valuesSql}
      RETURNING id, codigo_produto, codigo, descricao, qtd, origem, destino, data_movimentacao, cmc, solicitante, status, aprovado_pro
    `;

    const resultado = await dbQuery(insertSql, params);

    res.json({ ok: true, registros: resultado.rows });
  } catch (err) {
    console.error('[transferencias] falha ao registrar transferência', err);
    const detalhe = err.code === '23503' && err.constraint === 'transferencias_codigo_produto_fkey'
      ? 'Produto sem cadastro valido em public.produtos_omie. Atualize o cadastro/cache de produtos antes de registrar a transferencia.'
      : (err.message || String(err));
    res.status(err.status || 500).json({
      error: 'Falha ao registrar transferência de itens.',
      detail: detalhe
    });
  }
});

router.patch('/:id/aprovar', express.json(), async (req, res) => {
  try {
    await ensureTransferenciasSchema();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Identificador inválido.' });
    }

    const aprovadoPor = String(req.body?.aprovadoPor || '').trim();
    if (!aprovadoPor) {
      return res.status(400).json({ error: 'Informe o nome de quem aprovou.' });
    }

    const selectSql = `
      SELECT id,
             codigo_produto,
             codigo,
             descricao,
             qtd,
             origem,
             destino,
             data_movimentacao,
             cmc,
             solicitante,
             status,
             aprovado_pro
        FROM mensagens.transferencias
       WHERE id = $1
       LIMIT 1`;

    const { rows: encontrados } = await dbQuery(selectSql, [id]);
    if (!encontrados.length) {
      return res.status(404).json({ error: 'Solicitação não encontrada.' });
    }

    const registroAtual = encontrados[0];
    if (String(registroAtual.status || '').toLowerCase() === STATUS_TRANSFERIDO.toLowerCase()) {
      return res.status(409).json({ error: 'Esta solicitação já foi marcada como transferida.' });
    }

    const motivoOmie = String(req.body?.motivo || 'TRF').trim().toUpperCase() || 'TRF';
    const respostaOmie = await incluirAjusteEstoqueOmie({ ...registroAtual, motivo: motivoOmie }, aprovadoPor);

    const updateSql = `
      UPDATE mensagens.transferencias
         SET status = $1,
             aprovado_pro = $2
       WHERE id = $3
       RETURNING id,
                 codigo_produto,
                 codigo,
                 descricao,
                 qtd,
                 origem,
                 destino,
                 data_movimentacao,
                 cmc,
                 solicitante,
                 status,
                 aprovado_pro`;

    const { rows } = await dbQuery(updateSql, [STATUS_TRANSFERIDO, aprovadoPor, id]);

    res.json({
      ok: true,
      registro: rows[0],
      descricao_status: respostaOmie?.descricao_status || null,
      omie: respostaOmie || null
    });
    void monEventoReq(req, {
      categoria: 'API',
      acao: 'transferencia_omie_aprovada',
      codigo_produto: registroAtual.codigo,
      codigo_produto_omie: registroAtual.codigo_produto != null ? String(registroAtual.codigo_produto) : null,
      sucesso: true,
      detalhe: {
        transferencia_id: id,
        qtd: registroAtual.qtd,
        origem: registroAtual.origem,
        destino: registroAtual.destino,
        solicitante: registroAtual.solicitante,
        aprovado_por: aprovadoPor,
        motivo: motivoOmie,
        omie: respostaOmie || null,
        sessao_id: req.body?.sessao_id || null
      }
    });
  } catch (err) {
    console.error('[transferencias] falha ao aprovar transferência', err);
    void monEventoReq(req, {
      categoria: 'API',
      acao: 'transferencia_omie_aprovada',
      sucesso: false,
      detalhe: { transferencia_id: Number(req.params.id), erro: err.message || String(err), sessao_id: req.body?.sessao_id || null }
    });
    res.status(err.status || 500).json({
      error: err.message || 'Falha ao aprovar solicitação de transferência.'
    });
  }
});

router.patch('/:id/reprovar', express.json(), async (req, res) => {
  try {
    await ensureTransferenciasSchema();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Identificador invÃ¡lido.' });
    }

    const reprovadoPor = String(req.body?.reprovadoPor || req.body?.usuario || '').trim();
    const motivo = String(req.body?.motivo || '').trim() || null;
    if (!reprovadoPor) {
      return res.status(400).json({ error: 'Informe o nome de quem reprovou.' });
    }

    const { rows: encontrados } = await dbQuery(
      `SELECT id, status
         FROM mensagens.transferencias
        WHERE id = $1
        LIMIT 1`,
      [id]
    );

    if (!encontrados.length) {
      return res.status(404).json({ error: 'SolicitaÃ§Ã£o nÃ£o encontrada.' });
    }

    const statusAtual = String(encontrados[0].status || '').toLowerCase();
    if (statusAtual === STATUS_TRANSFERIDO.toLowerCase()) {
      return res.status(409).json({ error: 'Esta solicitaÃ§Ã£o jÃ¡ foi transferida e nÃ£o pode ser reprovada.' });
    }

    const { rows } = await dbQuery(
      `UPDATE mensagens.transferencias
          SET status = $1,
              reprovado_por = $2,
              reprovado_em = NOW(),
              motivo_reprovacao = $3
        WHERE id = $4
        RETURNING id,
                  codigo_produto,
                  codigo,
                  descricao,
                  qtd,
                  origem,
                  destino,
                  data_movimentacao,
                  cmc,
                  solicitante,
                  status,
                  aprovado_pro,
                  reprovado_por,
                  reprovado_em,
                  motivo_reprovacao`,
      [STATUS_REPROVADO, reprovadoPor, motivo, id]
    );

    res.json({ ok: true, registro: rows[0] });
  } catch (err) {
    console.error('[transferencias] falha ao reprovar transferÃªncia', err);
    res.status(err.status || 500).json({
      error: err.message || 'Falha ao reprovar solicitaÃ§Ã£o de transferÃªncia.'
    });
  }
});

module.exports = router;
