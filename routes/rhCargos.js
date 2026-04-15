const express = require('express');
const router = express.Router();
const { dbQuery, dbGetClient } = require('../src/db');

function normalizePayload(body = {}) {
  return {
    cargo: String(body.cargo || '').trim(),
    cbo: String(body.cbo || '').trim(),
    descricao_ltcat: String(body.descricao_ltcat || '').trim(),
    descricao_chao_fabrica: String(body.descricao_chao_fabrica || '').trim(),
    epi: String(body.epi || '').trim(),
    treinamentos: String(body.treinamentos || '').trim(),
    periculosidade: String(body.periculosidade || '').trim(),
    insalubridade: String(body.insalubridade || '').trim(),
    equipamentos_ferramentas: String(body.equipamentos_ferramentas || '').trim(),
  };
}

router.get('/cargos', async (_req, res) => {
  try {
    const { rows } = await dbQuery(
      `SELECT
         id,
         cargo,
         cbo,
         descricao_ltcat,
         descricao_chao_fabrica,
         epi,
         treinamentos,
         periculosidade,
         insalubridade,
         equipamentos_ferramentas,
         created_at,
         updated_at
       FROM rh.descricao_cargos
       ORDER BY updated_at DESC, id DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/rh/cargos] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar descrição de cargos' });
  }
});

router.post('/cargos', async (req, res) => {
  const data = normalizePayload(req.body);
  if (!data.cargo) {
    return res.status(400).json({ error: 'Campo "cargo" é obrigatório' });
  }

  try {
    const { rows } = await dbQuery(
      `INSERT INTO rh.descricao_cargos (
         cargo,
         cbo,
         descricao_ltcat,
         descricao_chao_fabrica,
         epi,
         treinamentos,
         periculosidade,
         insalubridade,
         equipamentos_ferramentas
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING
         id,
         cargo,
         cbo,
         descricao_ltcat,
         descricao_chao_fabrica,
         epi,
         treinamentos,
         periculosidade,
         insalubridade,
         equipamentos_ferramentas,
         created_at,
         updated_at`,
      [
        data.cargo,
        data.cbo,
        data.descricao_ltcat,
        data.descricao_chao_fabrica,
        data.epi,
        data.treinamentos,
        data.periculosidade,
        data.insalubridade,
        data.equipamentos_ferramentas,
      ]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /api/rh/cargos] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao criar descrição de cargo' });
  }
});

router.put('/cargos/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  const data = normalizePayload(req.body);
  if (!data.cargo) {
    return res.status(400).json({ error: 'Campo "cargo" é obrigatório' });
  }

  try {
    const { rows } = await dbQuery(
      `UPDATE rh.descricao_cargos
          SET cargo = $1,
              cbo = $2,
              descricao_ltcat = $3,
              descricao_chao_fabrica = $4,
              epi = $5,
              treinamentos = $6,
              periculosidade = $7,
              insalubridade = $8,
              equipamentos_ferramentas = $9,
              updated_at = NOW()
        WHERE id = $10
        RETURNING
          id,
          cargo,
          cbo,
          descricao_ltcat,
          descricao_chao_fabrica,
          epi,
          treinamentos,
          periculosidade,
          insalubridade,
          equipamentos_ferramentas,
          created_at,
          updated_at`,
      [
        data.cargo,
        data.cbo,
        data.descricao_ltcat,
        data.descricao_chao_fabrica,
        data.epi,
        data.treinamentos,
        data.periculosidade,
        data.insalubridade,
        data.equipamentos_ferramentas,
        id,
      ]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Registro não encontrado' });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('[PUT /api/rh/cargos/:id] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao atualizar descrição de cargo' });
  }
});

router.delete('/cargos/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const { rowCount } = await dbQuery(
      'DELETE FROM rh.descricao_cargos WHERE id = $1',
      [id]
    );
    if (!rowCount) {
      return res.status(404).json({ error: 'Registro não encontrado' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/rh/cargos/:id] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao excluir descrição de cargo' });
  }
});

function normalizeColaboradorPayload(body = {}) {
  const toInt = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  return {
    user_id: toInt(body.user_id),
    nome_completo: body.nome_completo == null ? null : String(body.nome_completo).trim() || null,
    email: body.email == null ? null : String(body.email).trim() || null,
    data_nascimento: body.data_nascimento || null,
    telefone_contato: body.telefone_contato == null ? null : String(body.telefone_contato).trim() || null,
    receber_notificacao: body.receber_notificacao === true,
    tipo_contrato: ['CLT','PJ','Temporario','Terceiro'].includes(body.tipo_contrato) ? body.tipo_contrato : null,
    funcao_id: toInt(body.funcao_id),
    setor_id: toInt(body.setor_id),
    cargo_id: toInt(body.cargo_id),
  };
}

router.get('/colaboradores/usuarios', async (_req, res) => {
  try {
    const { rows } = await dbQuery(
      `SELECT
         u.id,
         u.username,
         u.email,
         up.funcao_id,
         up.sector_id AS setor_id,
         f.name AS funcao,
         s.name AS setor,
         rc.cargo_id,
         rc.cargo,
         rc.cbo
       FROM public.auth_user u
       LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
       LEFT JOIN public.auth_funcao f ON f.id = up.funcao_id
       LEFT JOIN public.auth_sector s ON s.id = up.sector_id
       LEFT JOIN rh.colaboradores rc ON rc.user_id = u.id
       ORDER BY u.username`
    );
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/rh/colaboradores/usuarios] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar usuários para RH' });
  }
});

router.get('/colaboradores/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const { rows } = await dbQuery(
      `SELECT
         u.id,
         u.username,
         u.nome_completo,
         u.email,
         u.data_nascimento,
         u.telefone_contato,
         u.receber_notificacao,
         u.tipo_contrato,
         u.ultimo_acesso,
         up.funcao_id,
         up.sector_id AS setor_id,
         f.name AS funcao,
         s.name AS setor,
         rc.cargo_id,
         rc.cargo,
         rc.cbo,
         rc.descricao_ltcat,
         rc.descricao_chao_fabrica,
         rc.epi,
         rc.treinamentos,
         rc.periculosidade,
         rc.insalubridade,
         rc.equipamentos_ferramentas,
         rc.created_at,
         rc.updated_at
       FROM public.auth_user u
       LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
       LEFT JOIN public.auth_funcao f ON f.id = up.funcao_id
       LEFT JOIN public.auth_sector s ON s.id = up.sector_id
       LEFT JOIN rh.colaboradores rc ON rc.user_id = u.id
       WHERE u.id = $1
       LIMIT 1`,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('[GET /api/rh/colaboradores/:userId] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao buscar colaborador RH' });
  }
});

router.post('/colaboradores/salvar', async (req, res) => {
  const data = normalizeColaboradorPayload(req.body);
  if (!data.user_id) {
    return res.status(400).json({ error: 'Campo user_id é obrigatório' });
  }

  const client = await dbGetClient();
  try {
    await client.query('BEGIN');

    const userRes = await client.query(
      `SELECT id, username FROM public.auth_user WHERE id = $1 LIMIT 1`,
      [data.user_id]
    );
    if (!userRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const user = userRes.rows[0];

    await client.query(
      `UPDATE public.auth_user
          SET nome_completo = $1,
              email = $2,
              data_nascimento = $3,
              telefone_contato = $4,
              receber_notificacao = $5,
              tipo_contrato = $6,
              updated_at = NOW()
        WHERE id = $7`,
      [data.nome_completo, data.email, data.data_nascimento, data.telefone_contato, data.receber_notificacao, data.tipo_contrato, data.user_id]
    );

    await client.query(
      `INSERT INTO public.auth_user_profile (user_id, funcao_id, sector_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id)
       DO UPDATE SET funcao_id = EXCLUDED.funcao_id,
                     sector_id = EXCLUDED.sector_id`,
      [data.user_id, data.funcao_id, data.setor_id]
    );

    let cargo = {
      id: null,
      cargo: null,
      cbo: null,
      descricao_ltcat: null,
      descricao_chao_fabrica: null,
      epi: null,
      treinamentos: null,
      periculosidade: null,
      insalubridade: null,
      equipamentos_ferramentas: null,
    };

    if (data.cargo_id) {
      const cargoRes = await client.query(
        `SELECT
           id,
           cargo,
           cbo,
           descricao_ltcat,
           descricao_chao_fabrica,
           epi,
           treinamentos,
           periculosidade,
           insalubridade,
           equipamentos_ferramentas
         FROM rh.descricao_cargos
         WHERE id = $1
         LIMIT 1`,
        [data.cargo_id]
      );
      if (!cargoRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Cargo não encontrado' });
      }
      cargo = cargoRes.rows[0];
    }

    await client.query(
      `INSERT INTO rh.colaboradores (
         user_id,
         username,
         email,
         funcao_id,
         setor_id,
         cargo_id,
         cargo,
         cbo,
         descricao_ltcat,
         descricao_chao_fabrica,
         epi,
         treinamentos,
         periculosidade,
         insalubridade,
         equipamentos_ferramentas,
         updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW()
       )
       ON CONFLICT (user_id)
       DO UPDATE SET
         username = EXCLUDED.username,
         email = EXCLUDED.email,
         funcao_id = EXCLUDED.funcao_id,
         setor_id = EXCLUDED.setor_id,
         cargo_id = EXCLUDED.cargo_id,
         cargo = EXCLUDED.cargo,
         cbo = EXCLUDED.cbo,
         descricao_ltcat = EXCLUDED.descricao_ltcat,
         descricao_chao_fabrica = EXCLUDED.descricao_chao_fabrica,
         epi = EXCLUDED.epi,
         treinamentos = EXCLUDED.treinamentos,
         periculosidade = EXCLUDED.periculosidade,
         insalubridade = EXCLUDED.insalubridade,
         equipamentos_ferramentas = EXCLUDED.equipamentos_ferramentas,
         updated_at = NOW()`,
      [
        data.user_id,
        user.username,
        data.email,
        data.funcao_id,
        data.setor_id,
        cargo.id,
        cargo.cargo,
        cargo.cbo,
        cargo.descricao_ltcat,
        cargo.descricao_chao_fabrica,
        cargo.epi,
        cargo.treinamentos,
        cargo.periculosidade,
        cargo.insalubridade,
        cargo.equipamentos_ferramentas,
      ]
    );

    await client.query('COMMIT');

    const { rows } = await dbQuery(
      `SELECT
         u.id,
         u.username,
         u.nome_completo,
         u.email,
         u.telefone_contato,
         u.receber_notificacao,
         u.ultimo_acesso,
         up.funcao_id,
         up.sector_id AS setor_id,
         f.name AS funcao,
         s.name AS setor,
         rc.cargo_id,
         rc.cargo,
         rc.cbo,
         rc.descricao_ltcat,
         rc.descricao_chao_fabrica,
         rc.epi,
         rc.treinamentos,
         rc.periculosidade,
         rc.insalubridade,
         rc.equipamentos_ferramentas,
         rc.created_at,
         rc.updated_at
       FROM public.auth_user u
       LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
       LEFT JOIN public.auth_funcao f ON f.id = up.funcao_id
       LEFT JOIN public.auth_sector s ON s.id = up.sector_id
       LEFT JOIN rh.colaboradores rc ON rc.user_id = u.id
       WHERE u.id = $1
       LIMIT 1`,
      [data.user_id]
    );

    return res.json(rows[0]);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[POST /api/rh/colaboradores/salvar] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao salvar colaborador RH' });
  } finally {
    client.release();
  }
});

router.post('/colaboradores/novo-usuario', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const email = String(req.body?.email || '').trim() || null;
  const funcao_id = Number(req.body?.funcao_id);
  const setor_id = Number(req.body?.setor_id);

  if (!username) {
    return res.status(400).json({ error: 'Campo username é obrigatório' });
  }

  const client = await dbGetClient();
  try {
    await client.query('BEGIN');

    const exists = await client.query(
      `SELECT 1 FROM public.auth_user WHERE username = $1 LIMIT 1`,
      [username]
    );
    if (exists.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Nome de usuário já existe' });
    }

    const createdRes = await client.query(
      'SELECT * FROM public.auth_create_user($1, $2, $3::text[])',
      [username, '123', []]
    );
    const created = createdRes.rows?.[0];
    if (!created?.id) {
      throw new Error('Falha ao criar usuário');
    }

    await client.query(
      `UPDATE public.auth_user
          SET email = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [email, created.id]
    );

    const funcaoVal = Number.isInteger(funcao_id) && funcao_id > 0 ? funcao_id : null;
    const setorVal = Number.isInteger(setor_id) && setor_id > 0 ? setor_id : null;

    await client.query(
      `INSERT INTO public.auth_user_profile (user_id, funcao_id, sector_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id)
       DO UPDATE SET funcao_id = EXCLUDED.funcao_id,
                     sector_id = EXCLUDED.sector_id`,
      [created.id, funcaoVal, setorVal]
    );

    // Garante que o novo usuário inicie com todas as permissões da árvore desmarcadas
    await client.query(
      `INSERT INTO public.auth_user_permission (user_id, node_id, allow)
       SELECT $1, n.id, false
         FROM public.nav_node n
        WHERE n.active = TRUE
       ON CONFLICT (user_id, node_id)
       DO UPDATE SET allow = EXCLUDED.allow`,
      [created.id]
    );
    await client.query('DELETE FROM public.auth_user_produto_permissao WHERE user_id = $1', [created.id]);
    await client.query('DELETE FROM public.auth_user_operacao WHERE user_id = $1', [created.id]);

    await client.query('COMMIT');

    const { rows } = await dbQuery(
      `SELECT
         u.id,
         u.username,
         u.email,
         up.funcao_id,
         up.sector_id AS setor_id,
         f.name AS funcao,
         s.name AS setor
       FROM public.auth_user u
       LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
       LEFT JOIN public.auth_funcao f ON f.id = up.funcao_id
       LEFT JOIN public.auth_sector s ON s.id = up.sector_id
       WHERE u.id = $1
       LIMIT 1`,
      [created.id]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[POST /api/rh/colaboradores/novo-usuario] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao criar novo usuário' });
  } finally {
    client.release();
  }
});

router.get('/colaboradores/:userId/anexos', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const { rows } = await dbQuery(
      `SELECT id, user_id, nome_arquivo, url_arquivo, path_arquivo, enviado_por, created_at
         FROM rh.colaboradores_anexos
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC`,
      [userId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/rh/colaboradores/:userId/anexos] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar anexos do colaborador' });
  }
});

router.post('/colaboradores/:userId/anexos', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  const nomeArquivo = String(req.body?.nome_arquivo || '').trim();
  const urlArquivo = String(req.body?.url_arquivo || '').trim();
  const pathArquivo = String(req.body?.path_arquivo || '').trim();
  const enviadoPor = String(req.body?.enviado_por || '').trim() || null;

  if (!nomeArquivo || !urlArquivo || !pathArquivo) {
    return res.status(400).json({ error: 'nome_arquivo, url_arquivo e path_arquivo são obrigatórios' });
  }

  try {
    const userCheck = await dbQuery('SELECT 1 FROM public.auth_user WHERE id = $1 LIMIT 1', [userId]);
    if (!userCheck.rows.length) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const { rows } = await dbQuery(
      `INSERT INTO rh.colaboradores_anexos (user_id, nome_arquivo, url_arquivo, path_arquivo, enviado_por)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, nome_arquivo, url_arquivo, path_arquivo, enviado_por, created_at`,
      [userId, nomeArquivo, urlArquivo, pathArquivo, enviadoPor]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /api/rh/colaboradores/:userId/anexos] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao salvar anexo do colaborador' });
  }
});

router.delete('/colaboradores/anexos/:anexoId', async (req, res) => {
  const anexoId = Number(req.params.anexoId);
  if (!Number.isInteger(anexoId) || anexoId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const { rowCount } = await dbQuery(
      'DELETE FROM rh.colaboradores_anexos WHERE id = $1',
      [anexoId]
    );
    if (!rowCount) {
      return res.status(404).json({ error: 'Anexo não encontrado' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/rh/colaboradores/anexos/:anexoId] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao remover anexo do colaborador' });
  }
});

/* ============================
   EPI — Tamanhos do funcionário
   ============================ */

router.get('/funcionarios/epi/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const { rows } = await dbQuery(
      `SELECT id, user_id, tam_camiseta, tam_calca, tam_sapato, created_at, updated_at
         FROM funcionarios.epi
        WHERE user_id = $1
        LIMIT 1`,
      [userId]
    );
    return res.json(rows[0] || { user_id: userId, tam_camiseta: '', tam_calca: '', tam_sapato: '' });
  } catch (err) {
    console.error('[GET /api/rh/funcionarios/epi/:userId] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao buscar EPI do funcionário' });
  }
});

router.post('/funcionarios/epi/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const tam_camiseta = String(req.body?.tam_camiseta || '').trim();
  const tam_calca = String(req.body?.tam_calca || '').trim();
  const tam_sapato = String(req.body?.tam_sapato || '').trim();

  try {
    const { rows } = await dbQuery(
      `INSERT INTO funcionarios.epi (user_id, tam_camiseta, tam_calca, tam_sapato)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id)
       DO UPDATE SET tam_camiseta = EXCLUDED.tam_camiseta,
                     tam_calca    = EXCLUDED.tam_calca,
                     tam_sapato   = EXCLUDED.tam_sapato,
                     updated_at   = NOW()
       RETURNING *`,
      [userId, tam_camiseta, tam_calca, tam_sapato]
    );
    return res.json(rows[0]);
  } catch (err) {
    console.error('[POST /api/rh/funcionarios/epi/:userId] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao salvar EPI do funcionário' });
  }
});

/* ============================
   EPI — Entregas (histórico)
   ============================ */

router.get('/funcionarios/epi-entregas/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const { rows } = await dbQuery(
      `SELECT id, user_id, item, tamanho, data_entrega, observacao, registrado_por, created_at
         FROM funcionarios.epi_entrega
        WHERE user_id = $1
        ORDER BY data_entrega DESC, id DESC`,
      [userId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/rh/funcionarios/epi-entregas/:userId] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar entregas de EPI' });
  }
});

router.post('/funcionarios/epi-entregas/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const item = String(req.body?.item || '').trim();
  const tamanho = String(req.body?.tamanho || '').trim();
  const data_entrega = req.body?.data_entrega || null;
  const observacao = String(req.body?.observacao || '').trim() || null;
  const registrado_por = String(req.body?.registrado_por || '').trim() || null;

  if (!item) {
    return res.status(400).json({ error: 'Campo "item" é obrigatório' });
  }

  try {
    const { rows } = await dbQuery(
      `INSERT INTO funcionarios.epi_entrega (user_id, item, tamanho, data_entrega, observacao, registrado_por)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6)
       RETURNING *`,
      [userId, item, tamanho, data_entrega, observacao, registrado_por]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /api/rh/funcionarios/epi-entregas/:userId] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao registrar entrega de EPI' });
  }
});

router.delete('/funcionarios/epi-entregas/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const { rowCount } = await dbQuery(
      'DELETE FROM funcionarios.epi_entrega WHERE id = $1',
      [id]
    );
    if (!rowCount) {
      return res.status(404).json({ error: 'Entrega não encontrada' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/rh/funcionarios/epi-entregas/:id] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao excluir entrega de EPI' });
  }
});

/* ============================
   Conversas — Histórico
   ============================ */

router.get('/funcionarios/conversas/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const { rows } = await dbQuery(
      `SELECT id, user_id, tema, descricao, registrado_por, created_at
         FROM funcionarios.conversas
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC`,
      [userId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/rh/funcionarios/conversas/:userId] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar conversas' });
  }
});

router.post('/funcionarios/conversas/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const tema = String(req.body?.tema || '').trim();
  const descricao = String(req.body?.descricao || '').trim() || null;
  const registrado_por = String(req.body?.registrado_por || '').trim() || null;

  if (!tema) {
    return res.status(400).json({ error: 'Campo "tema" é obrigatório' });
  }

  try {
    const { rows } = await dbQuery(
      `INSERT INTO funcionarios.conversas (user_id, tema, descricao, registrado_por)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, tema, descricao, registrado_por]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /api/rh/funcionarios/conversas/:userId] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao registrar conversa' });
  }
});

router.delete('/funcionarios/conversas/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const { rowCount } = await dbQuery(
      'DELETE FROM funcionarios.conversas WHERE id = $1',
      [id]
    );
    if (!rowCount) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/rh/funcionarios/conversas/:id] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao excluir conversa' });
  }
});

/* ============================
   Painel geral — Controle de Férias
   ============================ */

router.get('/funcionarios/ferias-painel', async (_req, res) => {
  try {
    const { rows } = await dbQuery(`
      SELECT
        u.id,
        u.username,
        u.nome_completo,
        u.tipo_contrato,
        f.data_admissao,
        f.data_limite_ferias,
        COALESCE(r.total_dias, 0) AS total_dias_gozados,
        COALESCE(r.qtd_registros, 0) AS qtd_registros
      FROM public.auth_user u
      LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
      LEFT JOIN funcionarios.ferias f ON f.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT SUM(fr.dias) AS total_dias, COUNT(*) AS qtd_registros
        FROM funcionarios.ferias_registros fr
        WHERE fr.user_id = u.id
      ) r ON true
      ORDER BY u.username
    `);
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/rh/funcionarios/ferias-painel] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar painel de férias' });
  }
});

/* ============================
   Férias — Dados e anexos
   ============================ */

router.get('/funcionarios/ferias/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const { rows } = await dbQuery(
      `SELECT id, user_id, data_admissao, data_limite_ferias, ferias_vencidas, created_at, updated_at
         FROM funcionarios.ferias
        WHERE user_id = $1
        LIMIT 1`,
      [userId]
    );
    return res.json(rows[0] || { user_id: userId, data_admissao: null, data_limite_ferias: null, ferias_vencidas: false });
  } catch (err) {
    console.error('[GET /api/rh/funcionarios/ferias/:userId] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao buscar dados de férias' });
  }
});

router.post('/funcionarios/ferias/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const data_admissao = req.body?.data_admissao || null;
  const data_limite_ferias = req.body?.data_limite_ferias || null;
  const ferias_vencidas = req.body?.ferias_vencidas === true;

  try {
    const { rows } = await dbQuery(
      `INSERT INTO funcionarios.ferias (user_id, data_admissao, data_limite_ferias, ferias_vencidas)
       VALUES ($1, $2::date, $3::date, $4)
       ON CONFLICT (user_id)
       DO UPDATE SET data_admissao       = EXCLUDED.data_admissao,
                     data_limite_ferias   = EXCLUDED.data_limite_ferias,
                     ferias_vencidas      = EXCLUDED.ferias_vencidas,
                     updated_at          = NOW()
       RETURNING *`,
      [userId, data_admissao, data_limite_ferias, ferias_vencidas]
    );
    return res.json(rows[0]);
  } catch (err) {
    console.error('[POST /api/rh/funcionarios/ferias/:userId] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao salvar dados de férias' });
  }
});

/* Anexos de férias */

router.get('/funcionarios/ferias-anexos/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const { rows } = await dbQuery(
      `SELECT id, user_id, nome_arquivo, url_arquivo, path_arquivo, enviado_por, created_at
         FROM funcionarios.ferias_anexos
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC`,
      [userId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/rh/funcionarios/ferias-anexos/:userId] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar anexos de férias' });
  }
});

router.post('/funcionarios/ferias-anexos/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const nomeArquivo = String(req.body?.nome_arquivo || '').trim();
  const urlArquivo = String(req.body?.url_arquivo || '').trim();
  const pathArquivo = String(req.body?.path_arquivo || '').trim();
  const enviadoPor = String(req.body?.enviado_por || '').trim() || null;

  if (!nomeArquivo || !urlArquivo || !pathArquivo) {
    return res.status(400).json({ error: 'nome_arquivo, url_arquivo e path_arquivo são obrigatórios' });
  }

  try {
    const { rows } = await dbQuery(
      `INSERT INTO funcionarios.ferias_anexos (user_id, nome_arquivo, url_arquivo, path_arquivo, enviado_por)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, nomeArquivo, urlArquivo, pathArquivo, enviadoPor]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /api/rh/funcionarios/ferias-anexos/:userId] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao salvar anexo de férias' });
  }
});

router.delete('/funcionarios/ferias-anexos/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const { rowCount } = await dbQuery(
      'DELETE FROM funcionarios.ferias_anexos WHERE id = $1',
      [id]
    );
    if (!rowCount) {
      return res.status(404).json({ error: 'Anexo não encontrado' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/rh/funcionarios/ferias-anexos/:id] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao excluir anexo de férias' });
  }
});

/* ============================
   Pasta do funcionário no Supabase
   ============================ */

router.post('/funcionarios/criar-pasta/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Supabase não configurado' });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Cria arquivo placeholder para garantir que a pasta existe
    const folderPath = `${userId}/.keep`;
    const { error } = await supabase.storage
      .from('Funcionarios')
      .upload(folderPath, Buffer.from(''), { contentType: 'text/plain', upsert: true });

    if (error && !error.message?.includes('already exists')) {
      console.error('[criar-pasta] erro:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true, path: `${userId}/` });
  } catch (err) {
    console.error('[POST /api/rh/funcionarios/criar-pasta/:userId] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao criar pasta do funcionário' });
  }
});

/* ============================
   Férias — Registros de gozo de férias
   ============================ */

router.get('/funcionarios/ferias-registros/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const { rows } = await dbQuery(
      `SELECT id, user_id, data_inicio, data_fim, dias, registrado_por, created_at
         FROM funcionarios.ferias_registros
        WHERE user_id = $1
        ORDER BY data_inicio DESC, id DESC`,
      [userId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/rh/funcionarios/ferias-registros/:userId] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao listar registros de férias' });
  }
});

router.post('/funcionarios/ferias-registros/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const dataInicio = req.body?.data_inicio;
  const dataFim = req.body?.data_fim;
  if (!dataInicio || !dataFim) {
    return res.status(400).json({ error: 'data_inicio e data_fim são obrigatórios' });
  }

  const d1 = new Date(dataInicio + 'T00:00:00');
  const d2 = new Date(dataFim + 'T00:00:00');
  if (isNaN(d1.getTime()) || isNaN(d2.getTime()) || d2 < d1) {
    return res.status(400).json({ error: 'Datas inválidas (fim deve ser >= início)' });
  }
  const dias = Math.round((d2 - d1) / 86400000) + 1;
  const registradoPor = String(req.body?.registrado_por || '').trim() || null;

  try {
    const { rows } = await dbQuery(
      `INSERT INTO funcionarios.ferias_registros (user_id, data_inicio, data_fim, dias, registrado_por)
       VALUES ($1, $2::date, $3::date, $4, $5)
       RETURNING *`,
      [userId, dataInicio, dataFim, dias, registradoPor]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /api/rh/funcionarios/ferias-registros/:userId] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao registrar férias' });
  }
});

router.delete('/funcionarios/ferias-registros/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const { rowCount } = await dbQuery(
      'DELETE FROM funcionarios.ferias_registros WHERE id = $1',
      [id]
    );
    if (!rowCount) {
      return res.status(404).json({ error: 'Registro não encontrado' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/rh/funcionarios/ferias-registros/:id] erro:', err?.message || err);
    return res.status(500).json({ error: 'Erro ao excluir registro de férias' });
  }
});

module.exports = router;