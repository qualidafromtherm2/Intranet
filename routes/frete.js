const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../src/db');
const { exigirPermissaoNav } = require('../utils/navPermissions');
const { calcularRomaneio, normalizarCep, normalizarTexto, parseCurrencyBR, simularTransportadora } = require('../utils/freteEngine');

const router = express.Router();
const NAV_KEY = 'side:log:simulador-frete';
const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'sql', '20260728_create_frete_simulador.sql'), 'utf8');
let schemaPromise = null;

function garantirSchema() {
  if (!schemaPromise) {
    schemaPromise = pool.query(SCHEMA_SQL).catch((erro) => {
      schemaPromise = null;
      throw erro;
    });
  }
  return schemaPromise;
}

async function salvarCotacao({ usuarioId, destino, valorMercadoria, romaneio, resultados }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const origemResult = await client.query("SELECT valor FROM frete.configuracao WHERE chave = 'origem_padrao'");
    const origem = origemResult.rows[0]?.valor || {};
    const cotacaoResult = await client.query(`
      INSERT INTO frete.cotacao (
        usuario_id, origem_cep, origem_cidade, origem_uf,
        destino_cep, destino_cidade, destino_uf, valor_mercadoria,
        peso_real_kg, volume_m3
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `, [
      usuarioId || null,
      normalizarCep(origem.cep),
      origem.cidade || null,
      origem.uf || null,
      normalizarCep(destino.cep),
      destino.cidade,
      destino.uf,
      valorMercadoria,
      romaneio.peso_real_kg,
      romaneio.volume_m3
    ]);
    const cotacaoId = cotacaoResult.rows[0].id;

    await client.query(`
      INSERT INTO frete.cotacao_item (
        cotacao_id, codigo_produto, codigo, descricao, quantidade,
        altura_cm, largura_cm, profundidade_cm, peso_unitario_kg,
        volume_total_m3, peso_total_kg, produto_snapshot
      )
      SELECT $1, x.codigo_produto, x.codigo, x.descricao, x.quantidade,
             x.altura_cm, x.largura_cm, x.profundidade_cm, x.peso_unitario_kg,
             x.volume_total_m3, x.peso_total_kg, x.produto_snapshot
      FROM jsonb_to_recordset($2::jsonb) AS x(
        codigo_produto bigint, codigo text, descricao text, quantidade numeric,
        altura_cm numeric, largura_cm numeric, profundidade_cm numeric,
        peso_unitario_kg numeric, volume_total_m3 numeric, peso_total_kg numeric,
        produto_snapshot jsonb
      )
    `, [cotacaoId, JSON.stringify(romaneio.itens.map((item) => ({ ...item, produto_snapshot: item })))]);

    const validos = resultados.filter((item) => item.ok);
    if (validos.length) {
      await client.query(`
        INSERT INTO frete.cotacao_resultado (
          cotacao_id, tabela_preco_id, cobertura_id, peso_cubado_kg,
          peso_cobravel_kg, frete_peso, adicionais, valor_total,
          prazo_min_dias, prazo_max_dias, memoria_calculo
        )
        SELECT $1, x.tabela_preco_id, x.cobertura_id, x.peso_cubado_kg,
               x.peso_cobravel_kg, x.frete_peso, x.adicionais, x.valor_total,
               x.prazo_min_dias, x.prazo_max_dias, x.memoria_calculo
        FROM jsonb_to_recordset($2::jsonb) AS x(
          tabela_preco_id bigint, cobertura_id bigint, peso_cubado_kg numeric,
          peso_cobravel_kg numeric, frete_peso numeric, adicionais numeric,
          valor_total numeric, prazo_min_dias integer, prazo_max_dias integer,
          memoria_calculo jsonb
        )
      `, [cotacaoId, JSON.stringify(validos.map((item) => ({
        ...item,
        cobertura_id: item.cobertura?.id || null,
        memoria_calculo: item
      })))]);
    }
    await client.query('COMMIT');
    return cotacaoId;
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}

async function exigirAcesso(req, res, next) {
  try {
    await garantirSchema();
    const permitido = await exigirPermissaoNav(
      req,
      res,
      NAV_KEY,
      'Seu usuário não possui acesso ao Simulador de Frete.'
    );
    if (permitido) next();
  } catch (erro) {
    console.error('[frete] autorização/schema', erro);
    res.status(500).json({ ok: false, error: 'Não foi possível preparar o Simulador de Frete.' });
  }
}

router.use(express.json({ limit: '1mb' }));
router.use(exigirAcesso);

router.get('/status', async (_req, res) => {
  try {
    const [produtos, tabelas, configuracao] = await Promise.all([
      pool.query(`
        WITH base AS (
          SELECT p.*
          FROM public.produtos_omie p
          WHERE LPAD(REGEXP_REPLACE(COALESCE(p.tipoitem, ''), '\\D', '', 'g'), 2, '0') IN ('00', '04')
            AND COALESCE(p.inativo, 'N') <> 'S'
        )
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE COALESCE(altura, 0) > 0
              AND COALESCE(largura, 0) > 0
              AND COALESCE(profundidade, 0) > 0
              AND GREATEST(COALESCE(peso_bruto, 0), COALESCE(peso_liq, 0)) > 0
              AND GREATEST(altura, largura, profundidade) <= 500
          )::int AS aptos
        FROM base
      `),
      pool.query(`
        SELECT t.id, tr.nome AS transportadora, t.nome, t.versao, t.status,
               t.vigencia_inicio, t.vigencia_fim,
               (SELECT COUNT(*)::int FROM frete.cobertura c WHERE c.tabela_preco_id = t.id) AS coberturas,
               (SELECT COUNT(*)::int FROM frete.tarifa_faixa f WHERE f.tabela_preco_id = t.id) AS faixas
        FROM frete.tabela_preco t
        JOIN frete.transportadora tr ON tr.id = t.transportadora_id
        WHERE tr.ativo = TRUE
        ORDER BY tr.nome, t.criado_em DESC
      `),
      pool.query("SELECT valor FROM frete.configuracao WHERE chave = 'origem_padrao'")
    ]);
    res.json({ ok: true, produtos: produtos.rows[0], tabelas: tabelas.rows, origem: configuracao.rows[0]?.valor || null });
  } catch (erro) {
    console.error('[frete/status]', erro);
    res.status(500).json({ ok: false, error: 'Falha ao carregar o status do simulador.' });
  }
});

router.get('/produtos', async (req, res) => {
  try {
    const busca = String(req.query.q || '').trim();
    const limite = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    if (busca.length < 2) return res.json({ ok: true, itens: [] });
    const like = `%${busca}%`;
    const { rows } = await pool.query(`
      SELECT
        p.codigo_produto,
        p.codigo,
        p.descricao,
        p.tipoitem,
        p.unidade,
        p.altura,
        p.largura,
        p.profundidade,
        p.peso_bruto,
        p.peso_liq,
        img.url_imagem,
        (
          COALESCE(p.altura, 0) > 0
          AND COALESCE(p.largura, 0) > 0
          AND COALESCE(p.profundidade, 0) > 0
          AND GREATEST(COALESCE(p.peso_bruto, 0), COALESCE(p.peso_liq, 0)) > 0
          AND GREATEST(p.altura, p.largura, p.profundidade) <= 500
        ) AS apto_simulacao
      FROM public.produtos_omie p
      LEFT JOIN LATERAL (
        SELECT i.url_imagem
        FROM public.produtos_omie_imagens i
        WHERE i.codigo_produto = p.codigo_produto
          AND COALESCE(i.ativo, TRUE) = TRUE
        ORDER BY COALESCE(i.pos, 999999), i.id
        LIMIT 1
      ) img ON TRUE
      WHERE LPAD(REGEXP_REPLACE(COALESCE(p.tipoitem, ''), '\\D', '', 'g'), 2, '0') IN ('00', '04')
        AND COALESCE(p.inativo, 'N') <> 'S'
        AND (p.codigo ILIKE $1 OR p.descricao ILIKE $1)
      ORDER BY
        CASE WHEN UPPER(p.codigo) = UPPER($2) THEN 0 WHEN p.codigo ILIKE $3 THEN 1 ELSE 2 END,
        p.codigo
      LIMIT $4
    `, [like, busca, `${busca}%`, limite]);
    res.json({ ok: true, itens: rows });
  } catch (erro) {
    console.error('[frete/produtos]', erro);
    res.status(500).json({ ok: false, error: 'Falha ao pesquisar produtos.' });
  }
});

router.get('/localidades', async (req, res) => {
  try {
    const uf = String(req.query.uf || '').trim().toUpperCase();
    const busca = normalizarTexto(req.query.q || '');
    const limite = Math.min(1000, Math.max(10, Number(req.query.limit) || 500));
    if (!/^[A-Z]{2}$/.test(uf)) return res.status(400).json({ ok: false, error: 'Informe uma UF válida.' });
    const { rows } = await pool.query(`
      WITH cobertura_agrupada AS (
        SELECT cidade_normalizada, MIN(cidade) AS cidade_cobertura,
               MIN(codigo_ibge) AS codigo_ibge, MIN(cep_inicio) AS cep_inicio,
               MAX(cep_fim) AS cep_fim, COUNT(DISTINCT tabela_preco_id)::int AS transportadoras
        FROM frete.cobertura
        WHERE atendida = TRUE AND uf = $1 AND cidade IS NOT NULL
        GROUP BY cidade_normalizada
      ), oficiais AS (
        SELECT m.nome AS cidade, m.nome_normalizado AS cidade_normalizada, m.uf,
               m.codigo_ibge, c.cep_inicio, c.cep_fim,
               COALESCE(c.transportadoras, 0)::int AS transportadoras
        FROM frete.municipio m
        LEFT JOIN cobertura_agrupada c ON c.cidade_normalizada = m.nome_normalizado
        WHERE m.uf = $1 AND ($2 = '' OR m.nome_normalizado LIKE $2 || '%')
      ), extras_cobertura AS (
        SELECT c.cidade_cobertura AS cidade, c.cidade_normalizada, $1::char(2) AS uf,
               c.codigo_ibge, c.cep_inicio, c.cep_fim, c.transportadoras
        FROM cobertura_agrupada c
        WHERE ($2 = '' OR c.cidade_normalizada LIKE $2 || '%')
          AND NOT EXISTS (
            SELECT 1 FROM frete.municipio m
            WHERE m.uf = $1 AND m.nome_normalizado = c.cidade_normalizada
          )
      )
      SELECT * FROM oficiais
      UNION ALL
      SELECT * FROM extras_cobertura
      ORDER BY cidade
      LIMIT $3
    `, [uf, busca, limite]);
    res.json({ ok: true, itens: rows });
  } catch (erro) {
    console.error('[frete/localidades]', erro);
    res.status(500).json({ ok: false, error: 'Falha ao listar cidades atendidas.' });
  }
});

router.get('/cotacoes', async (req, res) => {
  try {
    const usuarioId = req.session?.user?.id;
    const limite = Math.min(20, Math.max(1, Number(req.query.limit) || 8));
    if (!usuarioId) return res.json({ ok: true, itens: [] });
    const { rows } = await pool.query(`
      SELECT c.id, c.criado_em, c.destino_cep, c.destino_cidade, c.destino_uf,
             c.valor_mercadoria, c.peso_real_kg, c.volume_m3,
             COUNT(DISTINCT i.id)::int AS itens,
             COUNT(DISTINCT r.id)::int AS resultados,
             MIN(r.valor_total) AS melhor_valor
      FROM frete.cotacao c
      LEFT JOIN frete.cotacao_item i ON i.cotacao_id = c.id
      LEFT JOIN frete.cotacao_resultado r ON r.cotacao_id = c.id
      WHERE c.usuario_id = $1
      GROUP BY c.id
      ORDER BY c.criado_em DESC, c.id DESC
      LIMIT $2
    `, [usuarioId, limite]);
    res.json({ ok: true, itens: rows });
  } catch (erro) {
    console.error('[frete/cotacoes]', erro);
    res.status(500).json({ ok: false, error: 'Falha ao carregar as cotações recentes.' });
  }
});

router.get('/cotacoes/:id', async (req, res) => {
  try {
    const usuarioId = req.session?.user?.id;
    const cotacaoId = Number(req.params.id);
    if (!usuarioId || !Number.isInteger(cotacaoId) || cotacaoId <= 0) {
      return res.status(404).json({ ok: false, error: 'Cotação não encontrada.' });
    }
    const cotacao = await pool.query(`
      SELECT id, criado_em, destino_cep, destino_cidade, destino_uf,
             valor_mercadoria, peso_real_kg, volume_m3
      FROM frete.cotacao
      WHERE id = $1 AND usuario_id = $2
    `, [cotacaoId, usuarioId]);
    if (!cotacao.rows[0]) return res.status(404).json({ ok: false, error: 'Cotação não encontrada.' });

    const itens = await pool.query(`
      SELECT ci.codigo_produto, ci.codigo,
             COALESCE(p.descricao, ci.descricao) AS descricao,
             ci.quantidade, COALESCE(p.tipoitem, ci.produto_snapshot->>'tipoitem') AS tipoitem,
             COALESCE(p.unidade, ci.produto_snapshot->>'unidade') AS unidade,
             COALESCE(p.altura, ci.altura_cm) AS altura,
             COALESCE(p.largura, ci.largura_cm) AS largura,
             COALESCE(p.profundidade, ci.profundidade_cm) AS profundidade,
             COALESCE(p.peso_bruto, ci.peso_unitario_kg) AS peso_bruto,
             COALESCE(p.peso_liq, ci.peso_unitario_kg) AS peso_liq,
             img.url_imagem,
             (
               p.codigo_produto IS NOT NULL
               AND LPAD(REGEXP_REPLACE(COALESCE(p.tipoitem, ''), '\\D', '', 'g'), 2, '0') IN ('00', '04')
               AND COALESCE(p.inativo, 'N') <> 'S'
               AND COALESCE(p.altura, 0) > 0 AND COALESCE(p.largura, 0) > 0
               AND COALESCE(p.profundidade, 0) > 0
               AND GREATEST(COALESCE(p.peso_bruto, 0), COALESCE(p.peso_liq, 0)) > 0
               AND GREATEST(p.altura, p.largura, p.profundidade) <= 500
             ) AS apto_simulacao
      FROM frete.cotacao_item ci
      LEFT JOIN public.produtos_omie p ON p.codigo = ci.codigo
      LEFT JOIN LATERAL (
        SELECT pi.url_imagem
        FROM public.produtos_omie_imagens pi
        WHERE pi.codigo_produto = p.codigo_produto AND COALESCE(pi.ativo, TRUE) = TRUE
        ORDER BY COALESCE(pi.pos, 999999), pi.id
        LIMIT 1
      ) img ON TRUE
      WHERE ci.cotacao_id = $1
      ORDER BY ci.id
    `, [cotacaoId]);
    res.json({ ok: true, cotacao: cotacao.rows[0], itens: itens.rows });
  } catch (erro) {
    console.error('[frete/cotacoes/detalhe]', erro);
    res.status(500).json({ ok: false, error: 'Falha ao reabrir a cotação.' });
  }
});

router.post('/simular', async (req, res) => {
  try {
    const destino = {
      cep: req.body?.destino?.cep || null,
      cidade: String(req.body?.destino?.cidade || '').trim(),
      uf: String(req.body?.destino?.uf || '').trim().toUpperCase()
    };
    const cep = destino.cep ? normalizarCep(destino.cep) : null;
    if (!destino.cidade || !/^[A-Z]{2}$/.test(destino.uf)) {
      return res.status(400).json({ ok: false, error: 'Informe a cidade e a UF de destino.' });
    }
    if (destino.cep && !cep) return res.status(400).json({ ok: false, error: 'CEP de destino inválido.' });

    const solicitados = Array.isArray(req.body?.itens) ? req.body.itens : [];
    if (!solicitados.length || solicitados.length > 100) {
      return res.status(400).json({ ok: false, error: 'Informe de 1 a 100 produtos.' });
    }
    const codigos = [...new Set(solicitados.map((item) => String(item?.codigo || '').trim()).filter(Boolean))];
    const { rows: produtos } = await pool.query(`
      SELECT codigo_produto, codigo, descricao, tipoitem, unidade, altura, largura, profundidade,
             peso_bruto, peso_liq
      FROM public.produtos_omie
      WHERE codigo = ANY($1::text[])
        AND LPAD(REGEXP_REPLACE(COALESCE(tipoitem, ''), '\\D', '', 'g'), 2, '0') IN ('00', '04')
        AND COALESCE(inativo, 'N') <> 'S'
    `, [codigos]);
    const produtosPorCodigo = new Map(produtos.map((produto) => [String(produto.codigo), produto]));
    const itens = solicitados.map((solicitado) => {
      const produto = produtosPorCodigo.get(String(solicitado.codigo || '').trim());
      return produto ? {
        ...produto,
        quantidade: Number(solicitado.quantidade),
        altura_cm: produto.altura,
        largura_cm: produto.largura,
        profundidade_cm: produto.profundidade,
        peso_unitario_kg: Number(produto.peso_bruto) > 0 ? produto.peso_bruto : produto.peso_liq
      } : { codigo: solicitado.codigo, quantidade: solicitado.quantidade };
    });

    let romaneio;
    try {
      romaneio = calcularRomaneio(itens);
    } catch (erro) {
      return res.status(422).json({ ok: false, error: erro.message, code: erro.code, detalhes: erro.detalhes || [] });
    }

    const valorMercadoriaInformado = parseCurrencyBR(req.body?.valor_mercadoria);
    const valorMercadoria = Math.max(0, Number.isFinite(valorMercadoriaInformado) ? valorMercadoriaInformado : 0);
    const { rows: tabelas } = await pool.query(`
      SELECT t.*, tr.nome AS transportadora, tr.slug AS transportadora_slug
      FROM frete.tabela_preco t
      JOIN frete.transportadora tr ON tr.id = t.transportadora_id
      WHERE tr.ativo = TRUE AND t.status IN ('ativa', 'em_revisao')
      ORDER BY CASE t.status WHEN 'ativa' THEN 0 ELSE 1 END, tr.nome
    `);
    const ids = tabelas.map((tabela) => tabela.id);
    let coberturas = [];
    let tarifas = [];
    let regras = [];
    if (ids.length) {
      [coberturas, tarifas, regras] = await Promise.all([
        pool.query(`SELECT * FROM frete.cobertura WHERE tabela_preco_id = ANY($1::bigint[]) AND atendida = TRUE AND uf = $2 AND (($3::int IS NOT NULL AND cep_inicio IS NOT NULL AND $3 BETWEEN cep_inicio AND cep_fim) OR cidade_normalizada = $4 OR (cep_inicio IS NULL AND cidade_normalizada IS NULL))`, [ids, destino.uf, cep, normalizarTexto(destino.cidade)]).then((r) => r.rows),
        pool.query('SELECT * FROM frete.tarifa_faixa WHERE tabela_preco_id = ANY($1::bigint[]) ORDER BY prioridade, peso_de_kg', [ids]).then((r) => r.rows),
        pool.query('SELECT * FROM frete.regra_adicional WHERE tabela_preco_id = ANY($1::bigint[]) AND ativo = TRUE ORDER BY prioridade', [ids]).then((r) => r.rows)
      ]);
    }

    const resultados = tabelas.map((tabela) => {
      const calculo = simularTransportadora({
        tabela,
        destino,
        romaneio,
        valorMercadoria,
        coberturas: coberturas.filter((item) => String(item.tabela_preco_id) === String(tabela.id)),
        tarifas: tarifas.filter((item) => String(item.tabela_preco_id) === String(tabela.id)),
        regras: regras.filter((item) => String(item.tabela_preco_id) === String(tabela.id))
      });
      return {
        tabela_id: tabela.id,
        transportadora: tabela.transportadora,
        versao: tabela.versao,
        status: tabela.status,
        ...calculo
      };
    }).sort((a, b) => {
      if (a.ok !== b.ok) return a.ok ? -1 : 1;
      return (a.valor_total || Infinity) - (b.valor_total || Infinity);
    });

    const cotacaoId = await salvarCotacao({
      usuarioId: req.session?.user?.id,
      destino: { ...destino, cep },
      valorMercadoria,
      romaneio,
      resultados
    });

    res.json({
      ok: true,
      cotacao_id: cotacaoId,
      destino: { ...destino, cep },
      valor_mercadoria: valorMercadoria,
      romaneio,
      resultados,
      avisos: resultados.some((item) => item.status === 'em_revisao')
        ? ['Há tabelas em revisão que não participam da comparação de preço.']
        : []
    });
  } catch (erro) {
    console.error('[frete/simular]', erro);
    res.status(500).json({ ok: false, error: 'Falha ao calcular as opções de frete.' });
  }
});

module.exports = { router, garantirSchema, NAV_KEY };
