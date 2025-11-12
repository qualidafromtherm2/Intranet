const express = require('express');
const router = express.Router();

const { dbQuery } = require('../src/db');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config.server');

const STATUS_AGUARDANDO = 'Aguardando aprovação';
const STATUS_TRANSFERIDO = 'Transferido';

// Resolve o identificador numérico do produto (codigo_produto) usando o código Omie textual ou numérico.
async function resolveCodigoProduto(codigoParam) {
  const raw = String(codigoParam || '').trim();
  if (!raw) {
    const err = new Error('Código do produto ausente.');
    err.status = 400;
    throw err;
  }

  if (/^\d+$/.test(raw)) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
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
  const dia = String(data.getDate()).padStart(2, '0');
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const ano = String(data.getFullYear());
  return `${dia}/${mes}/${ano}`;
}

async function incluirAjusteEstoqueOmie({ origem, destino, codigo_produto, qtd, codigo, id }, aprovadoPor) {
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

  const payload = {
    call: 'IncluirAjusteEstoque',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [
      {
        codigo_local_estoque: origemNumero ?? origem ?? '',
        codigo_local_estoque_destino: destinoNumero ?? destino ?? '',
        id_prod: idProdutoNumero ?? codigo_produto,
        data: formatarDataBR(),
        quan: String(quantidadeValida || quantidadeNumero || qtd || '0'),
        obs: `Solicitação de transferência #${id} do produto ${codigo || ''}. Aprovado por ${aprovadoPor}.`,
        origem: 'AJU',
        tipo: 'TRF',
        motivo: 'TRF',
        valor: quantidadeValida > 0 ? quantidadeValida : 1
      }
    ]
  };

  const resumoEnvio = {
    transferenciaId: id,
    origem: payload.param[0].codigo_local_estoque,
    destino: payload.param[0].codigo_local_estoque_destino,
    produto: payload.param[0].id_prod,
    quantidadeOriginal: qtd,
    quantidadeNormalizada: quantidadeNumero,
    quantidadeFinal: payload.param[0].quan,
    valorFinal: payload.param[0].valor
  };
  console.info('[transferencias][omie] Enviando ajuste', resumoEnvio);

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
    const { rows } = await dbQuery(
      `SELECT id,
              codigo_produto,
              codigo,
              descricao,
              qtd,
              origem,
              destino,
              solicitante,
              status,
              aprovado_pro
         FROM mensagens.transferencias
        ORDER BY id DESC
        LIMIT 250`
    );

    res.json({ ok: true, registros: rows });
  } catch (err) {
    console.error('[transferencias] falha ao listar transferências', err);
    res.status(500).json({ error: 'Falha ao buscar solicitações de transferência.' });
  }
});

router.post('/', express.json(), async (req, res) => {
  try {
    const origem = String(req.body?.origem || '').trim();
    const destino = String(req.body?.destino || '').trim();
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
      if (!codigo) {
        return res.status(400).json({ error: 'Item sem código informado.' });
      }
      if (qtd === null || qtd <= 0) {
        return res.status(400).json({ error: `Quantidade inválida para o produto ${codigo}.` });
      }

      const candidatos = [
        item.codigo_produto,
        item.codigoProduto,
        item.codigoProdutoId,
        item.codigoProdutoOmie,
        item.codOmie,
        item.codigo_omie
      ];

      let codigoProduto = null;
      for (const candidato of candidatos) {
        const str = candidato !== undefined && candidato !== null ? String(candidato).trim() : '';
        if (!str) continue;
        if (/^\d+$/.test(str)) {
          const parsed = Number(str);
          if (Number.isFinite(parsed)) {
            codigoProduto = parsed;
            break;
          }
        }
      }

      if (!codigoProduto) {
        const chave = codigo;
        if (cache.has(chave)) {
          codigoProduto = cache.get(chave);
        } else {
          codigoProduto = await resolveCodigoProduto(codigo);
          cache.set(chave, codigoProduto);
        }
      }

      preparados.push({
        codigo_produto: codigoProduto,
        codigo,
        descricao,
        qtd,
        origem,
        destino,
        solicitante
      });
    }

    if (!preparados.length) {
      return res.status(400).json({ error: 'Nenhum item válido para registrar transferência.' });
    }

    const params = [];
    const valuesSql = preparados.map((item, idx) => {
      const base = idx * 8;
      params.push(
        item.codigo_produto,
        item.codigo,
        item.descricao || null,
        item.qtd,
        item.origem,
        item.destino,
        item.solicitante,
        STATUS_AGUARDANDO
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
    }).join(', ');

    const insertSql = `
      INSERT INTO mensagens.transferencias
        (codigo_produto, codigo, descricao, qtd, origem, destino, solicitante, status)
      VALUES ${valuesSql}
      RETURNING id, codigo_produto, codigo, descricao, qtd, origem, destino, solicitante, status, aprovado_pro
    `;

    const resultado = await dbQuery(insertSql, params);

    res.json({ ok: true, registros: resultado.rows });
  } catch (err) {
    console.error('[transferencias] falha ao registrar transferência', err);
    res.status(err.status || 500).json({
      error: 'Falha ao registrar transferência de itens.',
      detail: err.message || String(err)
    });
  }
});

router.patch('/:id/aprovar', express.json(), async (req, res) => {
  try {
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

    const respostaOmie = await incluirAjusteEstoqueOmie(registroAtual, aprovadoPor);

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
  } catch (err) {
    console.error('[transferencias] falha ao aprovar transferência', err);
    res.status(err.status || 500).json({
      error: err.message || 'Falha ao aprovar solicitação de transferência.'
    });
  }
});

module.exports = router;
