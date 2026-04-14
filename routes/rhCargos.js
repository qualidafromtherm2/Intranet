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
    email: body.email == null ? null : String(body.email).trim() || null,
    data_nascimento: body.data_nascimento || null,
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
         u.email,
         u.data_nascimento,
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
          SET email = $1,
              data_nascimento = $2,
              updated_at = NOW()
        WHERE id = $3`,
      [data.email, data.data_nascimento, data.user_id]
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
         u.email,
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

module.exports = router;