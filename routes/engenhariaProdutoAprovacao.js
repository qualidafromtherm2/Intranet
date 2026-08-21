'use strict';

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const { dbQuery } = require('../src/db');
const { uploadPublicFile } = require('../utils/storage');
const { dispararAlertaAreaVermelha } = require('../utils/alertaAreaVermelhaEmail');
const {
  LOCAL_ESTOQUE_PRODUCAO,
  NOME_ESTOQUE_PRODUCAO,
  LOCAL_AREA_VERMELHA,
  NOME_AREA_VERMELHA,
  buscarNomeLocal,
  trfParaAreaVermelha,
  saiScrapAreaVermelha,
} = require('../utils/niqAreaVermelhaOmie');

const STATUS_OK = new Set(['aprovado', 'reprovado', 'projeto']);
const STATUS_LABEL = {
  aprovado: 'Aprovado para uso',
  reprovado: 'Reprovado',
  projeto: 'Projeto',
};

const NIQ_STATUS_LABEL = {
  registrado: 'Registrado',
  aguardando_aprovacao: 'Aguardando aprovação',
  scrap: 'Scrap',
  scrapado: 'Scrap', // legado
  retrabalho: 'Retrabalho',
  liberado: 'Liberado',
};
const NIQ_DECISOES = new Set(['scrap', 'retrabalho', 'liberar']);

async function ensureProdutoAprovacaoTable() {
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS engenharia`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS engenharia.produto_aprovacao (
      id SERIAL PRIMARY KEY,
      codigo_produto TEXT NOT NULL,
      codigo TEXT,
      status TEXT NOT NULL,
      definido_por TEXT NOT NULL,
      definido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      etq_recebimento_id INT
    )
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_produto_aprovacao_codigo_produto_em
      ON engenharia.produto_aprovacao (codigo_produto, definido_em DESC)
  `);
}

async function ensureNiqAreaVermelhaTable() {
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS qualidade`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS qualidade.niq_area_vermelha (
      id SERIAL PRIMARY KEY,
      codigo TEXT NOT NULL,
      codigo_produto TEXT,
      descricao TEXT,
      quantidade NUMERIC(18,4),
      descricao_falha TEXT NOT NULL,
      numero_op TEXT,
      op_producao_id BIGINT,
      produto_grupo TEXT,
      foto_url TEXT,
      video_url TEXT,
      anexos JSONB NOT NULL DEFAULT '[]'::jsonb,
      registrado_por TEXT NOT NULL,
      registrado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'registrado'`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS local_origem_codigo TEXT`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS local_origem_nome TEXT`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS local_destino_codigo TEXT`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS local_destino_nome TEXT`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS omie_trf_codigo TEXT`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS analise_por TEXT`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS analise_em TIMESTAMPTZ`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS analise_foto_url TEXT`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS analise_video_url TEXT`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS analise_anexos JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS analise_obs TEXT`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS decisao_por TEXT`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS decisao_em TIMESTAMPTZ`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS omie_sai_codigo TEXT`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS decisao_motivo TEXT`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS referencia_tipo TEXT`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS decisao_foto_url TEXT`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS decisao_video_url TEXT`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS decisao_anexos JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await dbQuery(`ALTER TABLE qualidade.niq_area_vermelha ADD COLUMN IF NOT EXISTS analista_user TEXT`);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_niq_av_registrado_em
      ON qualidade.niq_area_vermelha (registrado_em DESC)
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_niq_av_codigo
      ON qualidade.niq_area_vermelha (codigo)
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_niq_av_status
      ON qualidade.niq_area_vermelha (status)
  `);
  // Legado: "scrapado" → "scrap" (refugo/sucata)
  await dbQuery(`
    UPDATE qualidade.niq_area_vermelha
       SET status = 'scrap'
     WHERE LOWER(TRIM(status)) = 'scrapado'
  `);
}

function extArquivo(file) {
  const byMime = mime.extension(file?.mimetype);
  const byName = String(file?.originalname || '').split('.').pop();
  return String(byMime || byName || 'bin').replace(/[^a-zA-Z0-9]/g, '');
}

function coletarArquivosUpload(req) {
  const files = req.files || {};
  const lista = [];
  for (const key of ['foto', 'video', 'arquivos']) {
    const arr = Array.isArray(files[key]) ? files[key] : [];
    lista.push(...arr);
  }
  return lista.filter((f) => f?.buffer?.length);
}

function tipoMidia(file) {
  const mimeType = String(file?.mimetype || '').toLowerCase();
  if (mimeType.startsWith('image/')) return 'foto';
  if (mimeType.startsWith('video/')) return 'video';
  const nome = String(file?.originalname || '').toLowerCase();
  if (/\.(jpe?g|png|gif|webp|bmp)$/.test(nome)) return 'foto';
  if (/\.(mp4|webm|mov|avi|mkv)$/.test(nome)) return 'video';
  return 'arquivo';
}

async function uploadNiqArquivos(niqId, files) {
  const anexos = [];
  let fotoUrl = null;
  let videoUrl = null;
  for (const file of files) {
    const tipo = tipoMidia(file);
    const nome = `${uuidv4()}.${extArquivo(file)}`;
    const pathKey = `AreaVermelhaNIQ/${niqId}/${tipo}/${nome}`;
    const { url } = await uploadPublicFile('produtos', pathKey, file.buffer, {
      contentType: file.mimetype || 'application/octet-stream',
      upsert: false,
    });
    anexos.push({
      url,
      tipo,
      nome: String(file.originalname || nome).trim() || nome,
    });
    if (tipo === 'foto' && !fotoUrl) fotoUrl = url;
    if (tipo === 'video' && !videoUrl) videoUrl = url;
  }
  return { anexos, fotoUrl, videoUrl };
}

function formatarQtdExibicaoNiq(q) {
  if (q == null || q === '') return '';
  const n = Number(q);
  if (!Number.isFinite(n)) return String(q);
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return String(parseFloat(Number(n).toFixed(4)));
}

function mapearLinhaNiq(row) {
  const qtd = formatarQtdExibicaoNiq(row.quantidade);
  const falha = String(row.descricao_falha || '').trim();
  let st = String(row.status || 'registrado').trim().toLowerCase() || 'registrado';
  if (st === 'scrapado') st = 'scrap';
  const destinoNome = String(row.local_destino_nome || NOME_AREA_VERMELHA).trim();
  const refTipo = String(row.referencia_tipo || '').trim().toLowerCase();
  const numeroRef = String(row.numero_op || '').trim();
  let numeroNfe = '';
  if (numeroRef) {
    if (refTipo === 'os') numeroNfe = `OS ${numeroRef}`;
    else numeroNfe = `OP ${numeroRef}`;
  }
  return {
    id: row.id,
    codigo_produto: row.codigo,
    codigo: row.codigo,
    status: st,
    status_label: NIQ_STATUS_LABEL[st] || st,
    definido_por: row.registrado_por,
    definido_em: row.registrado_em,
    etq_recebimento_id: null,
    descricao: row.descricao || '',
    numero_nfe: numeroNfe,
    lote: falha,
    qtd_recebimento: row.quantidade,
    ids_armazem: [
      destinoNome || '7. AREA VERMELHA',
      qtd ? `Qtd ${qtd}` : null,
      row.omie_trf_codigo ? `TRF ${row.omie_trf_codigo}` : null,
    ].filter(Boolean).join(' · '),
    origem: 'niq',
    numero_op: row.numero_op || '',
    referencia_tipo: refTipo || '',
    descricao_falha: falha,
    quantidade: row.quantidade,
    foto_url: row.foto_url,
    video_url: row.video_url,
    local_origem_codigo: row.local_origem_codigo || '',
    local_origem_nome: row.local_origem_nome || '',
    local_destino_codigo: row.local_destino_codigo || LOCAL_AREA_VERMELHA,
    local_destino_nome: destinoNome,
    analista_user: row.analista_user || '',
    analise_por: row.analise_por || '',
    analise_em: row.analise_em || null,
    analise_foto_url: row.analise_foto_url || null,
    analise_video_url: row.analise_video_url || null,
    analise_obs: row.analise_obs || '',
    decisao_por: row.decisao_por || '',
    decisao_em: row.decisao_em || null,
    decisao_motivo: String(row.decisao_motivo || '').trim(),
    decisao_foto_url: row.decisao_foto_url || null,
    decisao_video_url: row.decisao_video_url || null,
    omie_trf_codigo: row.omie_trf_codigo || '',
    omie_sai_codigo: row.omie_sai_codigo || '',
  };
}

function usuarioSessao(req) {
  const u = req.session?.user || {};
  return String(u.fullName || u.username || u.email || u.id || 'sistema').trim() || 'sistema';
}

function identidadesSessaoNiq(req) {
  const u = req.session?.user || {};
  return [u.username, u.fullName, u.email, u.name, u.id]
    .map((s) => String(s || '').trim().toLowerCase())
    .filter(Boolean);
}

function sessaoCorrespondeUsuarioNiq(req, alvo) {
  const n = String(alvo || '').trim().toLowerCase();
  if (!n) return false;
  return identidadesSessaoNiq(req).includes(n);
}

function usuarioEhAdminNiq(req) {
  const u = req.session?.user || {};
  const roles = Array.isArray(u.roles)
    ? u.roles
    : String(u.roles || '').split(',').map((s) => s.trim()).filter(Boolean);
  return roles.some((r) => String(r || '').trim().toLowerCase() === 'admin');
}

function usuarioEhAdminOuQualidade(req) {
  if (usuarioEhAdminNiq(req)) return true;
  const u = req.session?.user || {};
  if (Number(u.sector_id) === 2) return true;
  const setor = String(u.setor || u.sector || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  return setor.includes('qualidade');
}

function usuarioPodeAlterarAnalistaNiq(req, registradoPor) {
  if (usuarioEhAdminNiq(req)) return true;
  return sessaoCorrespondeUsuarioNiq(req, registradoPor);
}

function usuarioPodeExcluirNiq(req, registradoPor) {
  if (usuarioEhAdminOuQualidade(req)) return true;
  return sessaoCorrespondeUsuarioNiq(req, registradoPor);
}

function usuarioPodeDecidirNiq(req, analistaUser) {
  if (usuarioEhAdminNiq(req)) return true;
  const a = String(analistaUser || '').trim();
  if (!a) return true; // NIQ legado sem analista: mantém comportamento anterior
  return sessaoCorrespondeUsuarioNiq(req, a);
}

const NIQ_SELECT_COLS = `
  n.id, n.codigo, n.codigo_produto, n.descricao, n.quantidade, n.descricao_falha,
  n.numero_op, n.op_producao_id, n.referencia_tipo, n.foto_url, n.video_url,
  n.registrado_por, n.registrado_em, n.status, n.analista_user,
  n.local_origem_codigo, n.local_origem_nome,
  n.local_destino_codigo, n.local_destino_nome,
  n.omie_trf_codigo, n.analise_por, n.analise_em,
  n.analise_foto_url, n.analise_video_url, n.analise_obs,
  n.decisao_por, n.decisao_em, n.decisao_motivo,
  n.decisao_foto_url, n.decisao_video_url, n.omie_sai_codigo
`;

module.exports = function engenhariaProdutoAprovacaoRouter() {
  const router = express.Router();
  const {
    LOCAL_AREA_VERMELHA,
    LOCAL_ENG_AMOSTRAS
  } = require('../utils/locaisSeparacaoBloqueados');

  router.get('/produto-aprovacao', async (req, res) => {
    try {
      await ensureProdutoAprovacaoTable();
      const status = String(req.query.status || '').trim().toLowerCase();
      if (!STATUS_OK.has(status) || status === 'aprovado') {
        return res.status(400).json({ error: 'Use status=reprovado ou status=projeto.' });
      }
      const localAlvo = status === 'reprovado' ? LOCAL_AREA_VERMELHA : LOCAL_ENG_AMOSTRAS;
      const q = String(req.query.q || '').trim();
      const like = q ? `%${q}%` : null;
      const result = await dbQuery(
        `WITH ult AS (
           SELECT DISTINCT ON (TRIM(a.codigo_produto))
                  a.id, a.codigo_produto, a.codigo, a.status, a.definido_por, a.definido_em, a.etq_recebimento_id
             FROM engenharia.produto_aprovacao a
            WHERE a.status = $1
            ORDER BY TRIM(a.codigo_produto), a.definido_em DESC, a.id DESC
         )
         SELECT u.id, u.codigo_produto, u.codigo, u.status, u.definido_por, u.definido_em, u.etq_recebimento_id,
                COALESCE(p.descricao, r.descricao_produto, '') AS descricao,
                r.numero_nfe, r.lote, r.qtd AS qtd_recebimento,
                (
                  SELECT string_agg(i.id::text, ', ' ORDER BY i.id)
                    FROM etiqueta."ETQ_rec_impresso" i
                    LEFT JOIN produto.produtos_omie p2
                      ON TRIM(i.codigo_produto) IN (p2.codigo_produto::text, TRIM(p2.codigo))
                   WHERE COALESCE(i.qtd, 0) > 0
                     AND TRIM(COALESCE(i.local_estoque_codigo, '')) = $2
                     AND (
                       TRIM(COALESCE(p2.codigo, '')) = TRIM(u.codigo_produto)
                       OR TRIM(COALESCE(p2.codigo_produto::text, '')) = TRIM(u.codigo_produto)
                       OR (u.etq_recebimento_id IS NOT NULL AND i.origem_id = u.etq_recebimento_id)
                     )
                ) AS ids_armazem
           FROM ult u
           LEFT JOIN LATERAL (
             SELECT descricao
               FROM produto.produtos_omie
              WHERE TRIM(codigo) = TRIM(u.codigo_produto)
                 OR TRIM(codigo_produto::text) = TRIM(u.codigo_produto)
              ORDER BY codigo_produto DESC
              LIMIT 1
           ) p ON TRUE
           LEFT JOIN etiqueta."ETQ_recebimento" r ON r.id = u.etq_recebimento_id
          WHERE ($3::text IS NULL
             OR u.codigo_produto ILIKE $3
             OR COALESCE(u.codigo, '') ILIKE $3
             OR COALESCE(p.descricao, r.descricao_produto, '') ILIKE $3
             OR COALESCE(r.numero_nfe, '') ILIKE $3
             OR COALESCE(r.lote, '') ILIKE $3)
          ORDER BY u.definido_em DESC
          LIMIT 400`,
        [status, localAlvo, like]
      );
      const pirItens = (result.rows || []).map((row) => ({
        ...row,
        status_label: STATUS_LABEL[row.status] || row.status,
        origem: 'pir',
      }));

      let niqItens = [];
      if (status === 'reprovado') {
        await ensureNiqAreaVermelhaTable();
        const niqResult = await dbQuery(
          `SELECT ${NIQ_SELECT_COLS}
             FROM qualidade.niq_area_vermelha n
            WHERE ($1::text IS NULL
               OR n.codigo ILIKE $1
               OR COALESCE(n.codigo_produto, '') ILIKE $1
               OR COALESCE(n.descricao, '') ILIKE $1
               OR COALESCE(n.numero_op, '') ILIKE $1
               OR COALESCE(n.descricao_falha, '') ILIKE $1
               OR COALESCE(n.decisao_motivo, '') ILIKE $1
               OR COALESCE(n.registrado_por, '') ILIKE $1
               OR COALESCE(n.status, '') ILIKE $1
               OR COALESCE(n.analise_por, '') ILIKE $1
               OR COALESCE(n.analista_user, '') ILIKE $1)
            ORDER BY n.registrado_em DESC
            LIMIT 400`,
          [like]
        );
        niqItens = (niqResult.rows || []).map(mapearLinhaNiq);
      }

      const itens = [...niqItens, ...pirItens].sort((a, b) => {
        const ta = new Date(a.definido_em || 0).getTime();
        const tb = new Date(b.definido_em || 0).getTime();
        return tb - ta;
      });

      return res.json({
        ok: true,
        status,
        status_label: STATUS_LABEL[status] || status,
        itens
      });
    } catch (err) {
      console.error('[engenharia/produto-aprovacao LIST]', err);
      return res.status(500).json({ error: err.message || 'Falha ao listar.' });
    }
  });

  router.get('/produto-aprovacao/:codigo', async (req, res) => {
    try {
      await ensureProdutoAprovacaoTable();
      const codigo = String(req.params.codigo || '').trim();
      if (!codigo) return res.status(400).json({ error: 'Código obrigatório.' });

      const result = await dbQuery(
        `SELECT id, codigo_produto, codigo, status, definido_por, definido_em, etq_recebimento_id
           FROM engenharia.produto_aprovacao
          WHERE TRIM(codigo_produto) = TRIM($1)
             OR TRIM(COALESCE(codigo, '')) = TRIM($1)
          ORDER BY definido_em DESC, id DESC
          LIMIT 1`,
        [codigo]
      );
      if (result.rows.length) {
        const row = result.rows[0];
        return res.json({
          ok: true,
          aprovacao: {
            ...row,
            status_label: STATUS_LABEL[row.status] || row.status,
          },
        });
      }
      return res.json({ ok: true, aprovacao: null });
    } catch (err) {
      console.error('[engenharia/produto-aprovacao GET]', err);
      return res.status(500).json({ error: err.message || 'Falha ao buscar aprovação.' });
    }
  });

  router.post('/produto-aprovacao', express.json(), async (req, res) => {
    try {
      await ensureProdutoAprovacaoTable();
      const status = String(req.body?.status || '').trim().toLowerCase();
      if (!STATUS_OK.has(status)) {
        return res.status(400).json({ error: 'Status inválido. Use aprovado, reprovado ou projeto.' });
      }
      const codigoProduto = String(req.body?.codigo_produto || '').trim();
      const codigo = String(req.body?.codigo || '').trim();
      if (!codigoProduto && !codigo) {
        return res.status(400).json({ error: 'Informe codigo_produto.' });
      }
      const etqId = Number(req.body?.etq_recebimento_id || 0) || null;
      const definidoPor = usuarioSessao(req);

      const result = await dbQuery(
        `INSERT INTO engenharia.produto_aprovacao
           (codigo_produto, codigo, status, definido_por, etq_recebimento_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, codigo_produto, codigo, status, definido_por, definido_em, etq_recebimento_id`,
        [codigoProduto || codigo, codigo || null, status, definidoPor, etqId]
      );
      const row = result.rows[0];
      if (status === 'reprovado') {
        let descricao = '';
        try {
          const prod = await dbQuery(
            `SELECT descricao
               FROM produto.produtos_omie
              WHERE TRIM(codigo) = TRIM($1)
                 OR TRIM(codigo_produto::text) = TRIM($1)
              ORDER BY codigo_produto DESC
              LIMIT 1`,
            [row.codigo_produto || row.codigo]
          );
          descricao = prod.rows[0]?.descricao || '';
        } catch (_) {}
        dispararAlertaAreaVermelha({
          origem: 'pir',
          codigo_produto: row.codigo_produto || row.codigo,
          codigo: row.codigo,
          descricao,
          definido_por: row.definido_por,
        });
      }
      return res.json({
        ok: true,
        aprovacao: {
          ...row,
          status_label: STATUS_LABEL[row.status] || row.status,
        },
      });
    } catch (err) {
      console.error('[engenharia/produto-aprovacao POST]', err);
      return res.status(500).json({ error: err.message || 'Falha ao gravar aprovação.' });
    }
  });

  const uploadNiq = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 80 * 1024 * 1024 },
  });

  router.post('/niq-area-vermelha', uploadNiq.fields([
    { name: 'foto', maxCount: 5 },
    { name: 'video', maxCount: 5 },
    { name: 'arquivos', maxCount: 10 },
  ]), async (req, res) => {
    try {
      if (!usuarioEhAdminOuQualidade(req)) {
        return res.status(403).json({ ok: false, error: 'Somente Admin ou Qualidade podem registrar NIQ.' });
      }
      await ensureNiqAreaVermelhaTable();
      const codigo = String(req.body?.codigo || req.body?.codigo_produto || '').trim();
      if (!codigo) {
        return res.status(400).json({ ok: false, error: 'Informe o código do produto.' });
      }
      const descricaoFalha = String(req.body?.descricao_falha || '').trim();
      if (!descricaoFalha) {
        return res.status(400).json({ ok: false, error: 'Informe a descrição da falha.' });
      }
      const qtdRaw = String(req.body?.quantidade ?? '').trim().replace(',', '.');
      const quantidade = qtdRaw === '' ? null : Number(qtdRaw);
      if (quantidade == null || !Number.isFinite(quantidade) || quantidade <= 0) {
        return res.status(400).json({ ok: false, error: 'Informe a quantidade.' });
      }

      let descricao = String(req.body?.descricao || '').trim();
      let codigoProduto = String(req.body?.codigo_produto || '').trim();
      const prod = await dbQuery(
        `SELECT codigo, codigo_produto::text AS codigo_produto, descricao
           FROM produto.produtos_omie
          WHERE TRIM(codigo) = TRIM($1)
             OR TRIM(codigo_produto::text) = TRIM($1)
          ORDER BY codigo_produto DESC
          LIMIT 1`,
        [codigo]
      );
      if (!prod.rows[0]) {
        return res.status(400).json({ ok: false, error: 'Produto não encontrado. Pesquise e escolha na lista.' });
      }
      descricao = descricao || prod.rows[0].descricao || '';
      codigoProduto = codigoProduto || prod.rows[0].codigo_produto || '';

      const analistaUser = String(req.body?.analista_user || req.body?.analista || '').trim();
      if (!analistaUser) {
        return res.status(400).json({ ok: false, error: 'Selecione o usuário que vai realizar a análise.' });
      }

      const numeroOp = String(req.body?.numero_op || '').trim();
      const opProducaoId = Number(req.body?.op_producao_id || 0) || null;
      let referenciaTipo = String(req.body?.referencia_tipo || '').trim().toLowerCase();
      if (!['op', 'os'].includes(referenciaTipo)) {
        referenciaTipo = numeroOp || opProducaoId ? 'op' : null;
      }
      if (!numeroOp && !opProducaoId) referenciaTipo = null;
      const produtoGrupo = String(req.body?.produto_grupo || '').trim();
      const registradoPor = usuarioSessao(req);
      const localOrigemCodigo = String(req.body?.local_origem_codigo || LOCAL_ESTOQUE_PRODUCAO).trim()
        || LOCAL_ESTOQUE_PRODUCAO;

      const ins = await dbQuery(
        `INSERT INTO qualidade.niq_area_vermelha
           (codigo, codigo_produto, descricao, quantidade, descricao_falha,
            numero_op, op_producao_id, referencia_tipo, produto_grupo, registrado_por, status,
            local_origem_codigo, local_destino_codigo, local_destino_nome, analista_user)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'registrado', $11, $12, $13, $14)
         RETURNING ${NIQ_SELECT_COLS.replace(/\bn\./g, '')}`,
        [
          prod.rows[0]?.codigo || codigo,
          codigoProduto || null,
          descricao || null,
          quantidade,
          descricaoFalha,
          numeroOp || null,
          opProducaoId,
          referenciaTipo,
          produtoGrupo || null,
          registradoPor,
          localOrigemCodigo,
          LOCAL_AREA_VERMELHA,
          NOME_AREA_VERMELHA,
          analistaUser,
        ]
      );
      let row = ins.rows[0];

      let trfInfo;
      try {
        trfInfo = await trfParaAreaVermelha({
          codigo: row.codigo,
          quantidade,
          localOrigemCodigo,
          usuario: registradoPor,
          numeroOp,
          niqId: row.id,
        });
      } catch (trfErr) {
        await dbQuery(`DELETE FROM qualidade.niq_area_vermelha WHERE id = $1`, [row.id]).catch(() => {});
        const status = Number(trfErr?.status) || 502;
        return res.status(status).json({
          ok: false,
          error: trfErr?.message || 'Falha ao transferir estoque para a Área vermelha na Omie.',
        });
      }

      const origemNome = trfInfo.local_origem_nome
        || (await buscarNomeLocal(localOrigemCodigo))
        || NOME_ESTOQUE_PRODUCAO;
      const updTrf = await dbQuery(
        `UPDATE qualidade.niq_area_vermelha
            SET local_origem_codigo = $2,
                local_origem_nome = $3,
                local_destino_codigo = $4,
                local_destino_nome = $5,
                omie_trf_codigo = $6
          WHERE id = $1
          RETURNING ${NIQ_SELECT_COLS.replace(/\bn\./g, '')}`,
        [
          row.id,
          trfInfo.local_origem_codigo,
          origemNome,
          trfInfo.local_destino_codigo,
          trfInfo.local_destino_nome,
          trfInfo.omie_codigo || null,
        ]
      );
      if (updTrf.rows[0]) row = updTrf.rows[0];

      const files = coletarArquivosUpload(req);
      if (files.length) {
        try {
          const { anexos, fotoUrl, videoUrl } = await uploadNiqArquivos(row.id, files);
          const upd = await dbQuery(
            `UPDATE qualidade.niq_area_vermelha
                SET foto_url = $2, video_url = $3, anexos = $4::jsonb
              WHERE id = $1
              RETURNING ${NIQ_SELECT_COLS.replace(/\bn\./g, '')}`,
            [row.id, fotoUrl, videoUrl, JSON.stringify(anexos)]
          );
          if (upd.rows[0]) row = upd.rows[0];
        } catch (upErr) {
          console.warn('[engenharia/niq-area-vermelha] upload de mídia falhou:', upErr?.message || upErr);
        }
      }

      dispararAlertaAreaVermelha({
        origem: 'niq',
        codigo_produto: row.codigo,
        codigo: row.codigo,
        descricao: row.descricao,
        quantidade: row.quantidade,
        numero_op: row.numero_op,
        descricao_falha: row.descricao_falha,
        definido_por: row.registrado_por,
        registrado_por: row.registrado_por,
      });

      return res.json({ ok: true, niq: mapearLinhaNiq(row) });
    } catch (err) {
      console.error('[engenharia/niq-area-vermelha POST]', err);
      return res.status(500).json({ ok: false, error: err.message || 'Falha ao registrar NIQ.' });
    }
  });

  router.post('/niq-area-vermelha/:id/analise', uploadNiq.fields([
    { name: 'foto', maxCount: 5 },
    { name: 'video', maxCount: 5 },
    { name: 'arquivos', maxCount: 10 },
  ]), async (req, res) => {
    try {
      if (!usuarioEhAdminOuQualidade(req)) {
        return res.status(403).json({ ok: false, error: 'Somente Admin ou Qualidade podem registrar a análise.' });
      }
      await ensureNiqAreaVermelhaTable();
      const id = Number(req.params.id) || 0;
      if (!id) return res.status(400).json({ ok: false, error: 'ID inválido.' });

      const analisePor = String(req.body?.analise_por || '').trim();
      if (!analisePor) {
        return res.status(400).json({ ok: false, error: 'Selecione o usuário que tomou a decisão.' });
      }
      const analiseObs = String(req.body?.analise_obs || '').trim();

      const { rows: atualRows } = await dbQuery(
        `SELECT id, status FROM qualidade.niq_area_vermelha WHERE id = $1 LIMIT 1`,
        [id]
      );
      if (!atualRows.length) {
        return res.status(404).json({ ok: false, error: 'NIQ não encontrada.' });
      }
      const st = String(atualRows[0].status || '').toLowerCase();
      if (st !== 'registrado') {
        return res.status(409).json({
          ok: false,
          error: 'Só é possível registrar análise em NIQ com status Registrado.',
        });
      }

      const files = coletarArquivosUpload(req);
      let fotoUrl = null;
      let videoUrl = null;
      let anexos = [];
      if (files.length) {
        const up = await uploadNiqArquivos(`${id}/analise`, files);
        anexos = up.anexos;
        fotoUrl = up.fotoUrl;
        videoUrl = up.videoUrl;
      }

      const upd = await dbQuery(
        `UPDATE qualidade.niq_area_vermelha
            SET status = 'aguardando_aprovacao',
                analise_por = $2,
                analise_em = NOW(),
                analise_foto_url = COALESCE($3, analise_foto_url),
                analise_video_url = COALESCE($4, analise_video_url),
                analise_anexos = CASE
                  WHEN $5::text = '[]' THEN analise_anexos
                  ELSE $5::jsonb
                END,
                analise_obs = NULLIF($6, '')
          WHERE id = $1
          RETURNING ${NIQ_SELECT_COLS.replace(/\bn\./g, '')}`,
        [id, analisePor, fotoUrl, videoUrl, JSON.stringify(anexos), analiseObs]
      );

      return res.json({ ok: true, niq: mapearLinhaNiq(upd.rows[0]) });
    } catch (err) {
      console.error('[engenharia/niq-area-vermelha analise]', err);
      return res.status(500).json({ ok: false, error: err.message || 'Falha ao registrar análise.' });
    }
  });

  router.get('/niq-area-vermelha/busca-referencia', async (req, res) => {
    try {
      const tipo = String(req.query?.tipo || '').trim().toLowerCase();
      const q = String(req.query?.q || '').trim();
      if (!['op', 'os'].includes(tipo)) {
        return res.status(400).json({ ok: false, error: 'Use tipo=op ou tipo=os.' });
      }
      if (q.length < 3) {
        return res.json({ ok: true, itens: [] });
      }
      const like = `%${q}%`;
      if (tipo === 'op') {
        const { rows } = await dbQuery(
          `SELECT id, n_op AS valor, codigo, codigo_produto::text AS codigo_produto
             FROM producao."OP_producao"
            WHERE COALESCE(n_op, '') ILIKE $1
            ORDER BY created_at DESC NULLS LAST, id DESC
            LIMIT 25`,
          [like]
        );
        return res.json({
          ok: true,
          itens: (rows || []).map((r) => ({
            id: r.id,
            valor: String(r.valor || '').trim(),
            label: `OP ${String(r.valor || '').trim()}`,
            extra: String(r.codigo || r.codigo_produto || '').trim(),
          })).filter((i) => i.valor),
        });
      }
      const { rows } = await dbQuery(
        `SELECT id,
                COALESCE(nome_revenda_cliente, '') AS cliente,
                COALESCE(modelo, '') AS modelo
           FROM sac.at
          WHERE id::text ILIKE $1
          ORDER BY id DESC
          LIMIT 25`,
        [like]
      );
      return res.json({
        ok: true,
        itens: (rows || []).map((r) => ({
          id: r.id,
          valor: String(r.id),
          label: `OS ${r.id}`,
          extra: [r.cliente, r.modelo].filter(Boolean).join(' · '),
        })),
      });
    } catch (err) {
      console.error('[engenharia/niq-area-vermelha busca-referencia]', err);
      return res.status(500).json({ ok: false, error: err.message || 'Falha na busca.' });
    }
  });

  router.post('/niq-area-vermelha/:id/decisao', (req, res, next) => {
    const ct = String(req.headers['content-type'] || '');
    if (ct.includes('multipart/form-data')) {
      return uploadNiq.fields([
        { name: 'foto', maxCount: 5 },
        { name: 'video', maxCount: 5 },
        { name: 'arquivos', maxCount: 10 },
      ])(req, res, next);
    }
    return express.json()(req, res, next);
  }, async (req, res) => {
    try {
      await ensureNiqAreaVermelhaTable();
      const id = Number(req.params.id) || 0;
      if (!id) return res.status(400).json({ ok: false, error: 'ID inválido.' });
      const acao = String(req.body?.acao || '').trim().toLowerCase();
      if (!NIQ_DECISOES.has(acao)) {
        return res.status(400).json({ ok: false, error: 'Ação inválida. Use scrap, retrabalho ou liberar.' });
      }
      const decisaoMotivo = String(req.body?.decisao_motivo || req.body?.motivo || '').trim();
      if (acao === 'scrap' && !decisaoMotivo) {
        return res.status(400).json({ ok: false, error: 'Informe o que motivou a decisão de scrap.' });
      }

      const { rows: atualRows } = await dbQuery(
        `SELECT id, codigo, quantidade, numero_op, status, analista_user
           FROM qualidade.niq_area_vermelha
          WHERE id = $1
          LIMIT 1`,
        [id]
      );
      if (!atualRows.length) {
        return res.status(404).json({ ok: false, error: 'NIQ não encontrada.' });
      }
      const atual = atualRows[0];
      if (String(atual.status || '').toLowerCase() !== 'aguardando_aprovacao') {
        return res.status(409).json({
          ok: false,
          error: 'Só é possível decidir NIQ em Aguardando aprovação.',
        });
      }
      if (!usuarioPodeDecidirNiq(req, atual.analista_user)) {
        return res.status(403).json({
          ok: false,
          error: 'Somente o analista designado (ou Admin) pode confirmar scrap, retrabalhar ou liberar.',
        });
      }

      const decisaoPor = usuarioSessao(req);
      let statusNovo = 'liberado';
      let omieSai = null;
      if (acao === 'scrap') {
        statusNovo = 'scrap';
        try {
          const sai = await saiScrapAreaVermelha({
            codigo: atual.codigo,
            quantidade: atual.quantidade,
            usuario: decisaoPor,
            niqId: id,
            numeroOp: atual.numero_op,
          });
          omieSai = sai.omie_codigo || null;
        } catch (saiErr) {
          const status = Number(saiErr?.status) || 502;
          return res.status(status).json({
            ok: false,
            error: saiErr?.message || 'Falha ao gerar SAI scrap na Omie.',
          });
        }
      } else if (acao === 'retrabalho') {
        statusNovo = 'retrabalho';
      } else {
        statusNovo = 'liberado';
      }

      let fotoUrl = null;
      let videoUrl = null;
      let anexosJson = '[]';
      if (acao === 'scrap') {
        const files = coletarArquivosUpload(req);
        if (files.length) {
          try {
            const up = await uploadNiqArquivos(`${id}/decisao`, files);
            fotoUrl = up.fotoUrl;
            videoUrl = up.videoUrl;
            anexosJson = JSON.stringify(up.anexos || []);
          } catch (upErr) {
            console.warn('[engenharia/niq-area-vermelha decisao] upload falhou:', upErr?.message || upErr);
          }
        }
      }

      const upd = await dbQuery(
        `UPDATE qualidade.niq_area_vermelha
            SET status = $2,
                decisao_por = $3,
                decisao_em = NOW(),
                omie_sai_codigo = COALESCE($4, omie_sai_codigo),
                decisao_motivo = CASE WHEN $5::text IS NULL OR $5::text = '' THEN decisao_motivo ELSE $5 END,
                decisao_foto_url = COALESCE($6, decisao_foto_url),
                decisao_video_url = COALESCE($7, decisao_video_url),
                decisao_anexos = CASE
                  WHEN $8::text = '[]' THEN decisao_anexos
                  ELSE $8::jsonb
                END
          WHERE id = $1
          RETURNING ${NIQ_SELECT_COLS.replace(/\bn\./g, '')}`,
        [
          id,
          statusNovo,
          decisaoPor,
          omieSai,
          acao === 'scrap' ? decisaoMotivo : null,
          fotoUrl,
          videoUrl,
          anexosJson,
        ]
      );

      return res.json({ ok: true, niq: mapearLinhaNiq(upd.rows[0]) });
    } catch (err) {
      console.error('[engenharia/niq-area-vermelha decisao]', err);
      return res.status(500).json({ ok: false, error: err.message || 'Falha ao registrar decisão.' });
    }
  });

  // Alterar quem vai realizar a análise — só quem registrou o NIQ ou Admin.
  router.post('/niq-area-vermelha/:id/analista', express.json(), async (req, res) => {
    try {
      await ensureNiqAreaVermelhaTable();
      const id = Number(req.params.id) || 0;
      if (!id) return res.status(400).json({ ok: false, error: 'ID inválido.' });
      const analistaUser = String(req.body?.analista_user || req.body?.analista || '').trim();
      if (!analistaUser) {
        return res.status(400).json({ ok: false, error: 'Selecione o usuário que vai realizar a análise.' });
      }

      const { rows: atualRows } = await dbQuery(
        `SELECT id, registrado_por, status
           FROM qualidade.niq_area_vermelha
          WHERE id = $1
          LIMIT 1`,
        [id]
      );
      if (!atualRows.length) {
        return res.status(404).json({ ok: false, error: 'NIQ não encontrada.' });
      }
      const atual = atualRows[0];
      if (!usuarioPodeAlterarAnalistaNiq(req, atual.registrado_por)) {
        return res.status(403).json({
          ok: false,
          error: 'Somente quem registrou o NIQ ou Admin pode alterar o analista.',
        });
      }
      const st = String(atual.status || '').toLowerCase();
      if (['scrap', 'retrabalho', 'liberado', 'scrapado'].includes(st)) {
        return res.status(409).json({
          ok: false,
          error: 'Não é possível alterar o analista após a decisão final.',
        });
      }

      const upd = await dbQuery(
        `UPDATE qualidade.niq_area_vermelha
            SET analista_user = $2
          WHERE id = $1
          RETURNING ${NIQ_SELECT_COLS.replace(/\bn\./g, '')}`,
        [id, analistaUser]
      );
      return res.json({ ok: true, niq: mapearLinhaNiq(upd.rows[0]) });
    } catch (err) {
      console.error('[engenharia/niq-area-vermelha analista]', err);
      return res.status(500).json({ ok: false, error: err.message || 'Falha ao alterar analista.' });
    }
  });

  // Excluir NIQ — só quem registrou, Qualidade ou Admin.
  router.delete('/niq-area-vermelha/:id', async (req, res) => {
    try {
      await ensureNiqAreaVermelhaTable();
      const id = Number(req.params.id) || 0;
      if (!id) return res.status(400).json({ ok: false, error: 'ID inválido.' });

      const { rows: atualRows } = await dbQuery(
        `SELECT id, registrado_por, status, omie_trf_codigo, omie_sai_codigo
           FROM qualidade.niq_area_vermelha
          WHERE id = $1
          LIMIT 1`,
        [id]
      );
      if (!atualRows.length) {
        return res.status(404).json({ ok: false, error: 'NIQ não encontrada.' });
      }
      const atual = atualRows[0];
      if (!usuarioPodeExcluirNiq(req, atual.registrado_por)) {
        return res.status(403).json({
          ok: false,
          error: 'Somente quem registrou o NIQ, Qualidade ou Admin podem excluir.',
        });
      }

      await dbQuery(`DELETE FROM qualidade.niq_area_vermelha WHERE id = $1`, [id]);
      return res.json({
        ok: true,
        id,
        aviso_omie: !!(atual.omie_trf_codigo || atual.omie_sai_codigo),
      });
    } catch (err) {
      console.error('[engenharia/niq-area-vermelha DELETE]', err);
      return res.status(500).json({ ok: false, error: err.message || 'Falha ao excluir NIQ.' });
    }
  });

  // Anexar/atualizar foto ou vídeo a qualquer momento (registro, análise ou decisão),
  // sem alterar o status do NIQ — o usuário pode deixar para anexar depois.
  router.post('/niq-area-vermelha/:id/midia', uploadNiq.fields([
    { name: 'foto', maxCount: 5 },
    { name: 'video', maxCount: 5 },
    { name: 'arquivos', maxCount: 10 },
  ]), async (req, res) => {
    try {
      if (!usuarioEhAdminOuQualidade(req)) {
        return res.status(403).json({ ok: false, error: 'Somente Admin ou Qualidade podem anexar arquivos no NIQ.' });
      }
      await ensureNiqAreaVermelhaTable();
      const id = Number(req.params.id) || 0;
      if (!id) return res.status(400).json({ ok: false, error: 'ID inválido.' });

      const etapa = String(req.body?.etapa || '').trim().toLowerCase();
      if (!['registro', 'analise', 'decisao'].includes(etapa)) {
        return res.status(400).json({ ok: false, error: 'Informe etapa=registro, analise ou decisao.' });
      }

      const { rows: atualRows } = await dbQuery(
        `SELECT id FROM qualidade.niq_area_vermelha WHERE id = $1 LIMIT 1`,
        [id]
      );
      if (!atualRows.length) {
        return res.status(404).json({ ok: false, error: 'NIQ não encontrada.' });
      }

      const files = coletarArquivosUpload(req);
      if (!files.length) {
        return res.status(400).json({ ok: false, error: 'Selecione ao menos um arquivo.' });
      }

      const pathKey = etapa === 'registro' ? String(id) : `${id}/${etapa}`;
      const up = await uploadNiqArquivos(pathKey, files);
      const anexosJson = JSON.stringify(up.anexos || []);

      let upd;
      if (etapa === 'registro') {
        upd = await dbQuery(
          `UPDATE qualidade.niq_area_vermelha
              SET foto_url = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE foto_url END,
                  video_url = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE video_url END,
                  anexos = CASE
                    WHEN $4::text = '[]' THEN anexos
                    ELSE COALESCE(anexos, '[]'::jsonb) || $4::jsonb
                  END
            WHERE id = $1
            RETURNING ${NIQ_SELECT_COLS.replace(/\bn\./g, '')}`,
          [id, up.fotoUrl, up.videoUrl, anexosJson]
        );
      } else if (etapa === 'analise') {
        upd = await dbQuery(
          `UPDATE qualidade.niq_area_vermelha
              SET analise_foto_url = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE analise_foto_url END,
                  analise_video_url = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE analise_video_url END,
                  analise_anexos = CASE
                    WHEN $4::text = '[]' THEN analise_anexos
                    ELSE COALESCE(analise_anexos, '[]'::jsonb) || $4::jsonb
                  END
            WHERE id = $1
            RETURNING ${NIQ_SELECT_COLS.replace(/\bn\./g, '')}`,
          [id, up.fotoUrl, up.videoUrl, anexosJson]
        );
      } else {
        upd = await dbQuery(
          `UPDATE qualidade.niq_area_vermelha
              SET decisao_foto_url = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE decisao_foto_url END,
                  decisao_video_url = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE decisao_video_url END,
                  decisao_anexos = CASE
                    WHEN $4::text = '[]' THEN decisao_anexos
                    ELSE COALESCE(decisao_anexos, '[]'::jsonb) || $4::jsonb
                  END
            WHERE id = $1
            RETURNING ${NIQ_SELECT_COLS.replace(/\bn\./g, '')}`,
          [id, up.fotoUrl, up.videoUrl, anexosJson]
        );
      }

      return res.json({ ok: true, niq: mapearLinhaNiq(upd.rows[0]) });
    } catch (err) {
      console.error('[engenharia/niq-area-vermelha midia]', err);
      return res.status(500).json({ ok: false, error: err.message || 'Falha ao anexar arquivo.' });
    }
  });

  return router;
};
