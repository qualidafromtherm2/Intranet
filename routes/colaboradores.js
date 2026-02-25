// routes/colaboradores.js
const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
});

let _hasOperacaoProfileCol = null;
async function hasOperacaoProfileColumn() {
  if (_hasOperacaoProfileCol !== null) return _hasOperacaoProfileCol;
  try {
    const { rows } = await pool.query(
      `SELECT EXISTS(
         SELECT 1 FROM information_schema.columns
          WHERE table_schema='public'
            AND table_name='auth_user_profile'
            AND column_name='operacao_id'
       ) AS ok`
    );
    _hasOperacaoProfileCol = !!rows[0]?.ok;
  } catch (e) {
    console.warn('[colaboradores] não foi possível verificar coluna operacao_id:', e.message);
    _hasOperacaoProfileCol = false;
  }
  return _hasOperacaoProfileCol;
}

let _hasOperacaoLinkTable = null;
async function hasOperacaoLinkTable() {
  if (_hasOperacaoLinkTable !== null) return _hasOperacaoLinkTable;
  try {
    const { rows } = await pool.query(
      `SELECT EXISTS(
         SELECT 1 FROM information_schema.tables
          WHERE table_schema='public'
            AND table_name='auth_user_operacao'
       ) AS ok`
    );
    _hasOperacaoLinkTable = !!rows[0]?.ok;
  } catch (e) {
    console.warn('[colaboradores] não foi possível verificar tabela auth_user_operacao:', e.message);
    _hasOperacaoLinkTable = false;
  }
  return _hasOperacaoLinkTable;
}

async function upsertUserProfile(client, userId, { funcao_id, setor_id, operacao_id }) {
  const hasOper = await hasOperacaoProfileColumn();
  const shouldHandleOper = hasOper && operacao_id !== undefined;
  const hasFuncao = funcao_id !== undefined;
  const hasSetor  = setor_id  !== undefined;

  if (!hasFuncao && !hasSetor && !shouldHandleOper) return;

  const cols = ['user_id'];
  const params = [userId];
  const updates = [];

  if (hasFuncao) {
    cols.push('funcao_id');
    params.push(funcao_id ?? null);
    updates.push('funcao_id = EXCLUDED.funcao_id');
  }

  if (hasSetor) {
    cols.push('sector_id');
    params.push(setor_id ?? null);
    updates.push('sector_id = EXCLUDED.sector_id');
  }

  if (hasOper) {
    const opId = operacao_id == null
      ? null
      : String(operacao_id).trim();
    cols.push('operacao_id');
    params.push(opId && opId.length ? opId : null);
    updates.push('operacao_id = EXCLUDED.operacao_id');
  }

  if (!updates.length) return;

  const placeholders = cols.map((_, idx) => `$${idx + 1}`);
  await client.query(
    `INSERT INTO public.auth_user_profile (${cols.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (user_id) DO UPDATE SET ${updates.join(', ')}`,
    params
  );
}

async function syncUserOperacoes(client, userId, operacaoIds) {
  if (!await hasOperacaoLinkTable()) return;
  const ids = Array.from(new Set(
    (operacaoIds || [])
      .map(id => (id == null ? '' : String(id).trim()))
      .filter(id => id.length > 0)
  ));
  await client.query('DELETE FROM public.auth_user_operacao WHERE user_id = $1', [userId]);
  if (!ids.length) return;
  const values = ids.map((_, idx) => `($1, $${idx + 2})`).join(',');
  await client.query(
    `INSERT INTO public.auth_user_operacao (user_id, operacao_id)
     VALUES ${values}
     ON CONFLICT (user_id, operacao_id) DO NOTHING`,
    [userId, ...ids]
  );
}

// Sincroniza permissões de produto (produto_permissao_codigos)
// Remove todas as antigas para o usuário e insere o conjunto novo, ignorando duplicatas.
async function syncUserProdutoPermissoes(client, userId, codigos) {
  const codes = Array.from(new Set(
    (codigos || [])
      .map(c => (c == null ? '' : String(c).trim()))
      .filter(c => c.length > 0)
  ));
  await client.query('DELETE FROM public.auth_user_produto_permissao WHERE user_id = $1', [userId]);
  if (!codes.length) return;
  const values = codes.map((_, idx) => `($1, $${idx + 2})`).join(',');
  await client.query(
    `INSERT INTO public.auth_user_produto_permissao (user_id, permissao_codigo)
     VALUES ${values}
     ON CONFLICT (user_id, permissao_codigo) DO NOTHING`,
    [userId, ...codes]
  );
}

// util
async function withTx(fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const out = await fn(client); await client.query('COMMIT'); return out; }
  catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

/* ======= SETORES ======= */
router.get('/setores', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name FROM public.auth_sector WHERE active IS DISTINCT FROM false ORDER BY name'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erro ao listar setores' });
  }
});

router.post('/setores', async (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO public.auth_sector(name, active) VALUES ($1, true) RETURNING id, name',
      [name.trim()]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erro ao criar setor' });
  }
});

/* ======= FUNÇÕES ======= */
router.get('/funcoes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name FROM public.auth_funcao WHERE active IS DISTINCT FROM false ORDER BY name'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erro ao listar funções' });
  }
});

router.post('/funcoes', async (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO public.auth_funcao(name, active) VALUES ($1, true) RETURNING id, name',
      [name.trim()]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erro ao criar função' });
  }
});

/* ======= OPERAÇÕES (OMIE) ======= */
router.get('/operacoes', async (_req, res) => {
  try {
    // detecta colunas da tabela omie_operacao dinamicamente
    const cols = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'omie_operacao'
        ORDER BY ordinal_position`
    );

    if (!cols.rowCount) {
      return res.json([]); // tabela inexistente: devolve vazio (front mostra placeholder)
    }

    const names = cols.rows.map(r => r.column_name);
    const pick = (candidates, fallback) => {
      for (const cand of candidates) {
        const hit = names.find(n => n.toLowerCase() === cand);
        if (hit) return hit;
      }
      return fallback || names[0];
    };

    const idCol = pick(['id', 'id_operacao', 'operacao_id', 'codigo', 'cod_operacao'], names[0]);
    const labelCol = pick(
      ['operacao', 'descricao', 'nome', 'nome_operacao', 'descricao_operacao', 'label'],
      names.find(n => n !== idCol) || names[0]
    );

    const q = `
      SELECT "${idCol}"   AS id,
             "${labelCol}" AS operacao
        FROM public.omie_operacao
    ORDER BY "${labelCol}", "${idCol}"`;
    const { rows } = await pool.query(q);
    res.json(rows.map(r => ({
      id: r.id,
      operacao: r.operacao ?? ''
    })));
  } catch (e) {
    console.error('[GET /api/colaboradores/operacoes]', e);
    res.status(500).json({ error: 'Erro ao listar operações' });
  }
});

/* ======= CRIAR COLABORADOR ======= */
router.post('/', async (req, res) => {
  const { username, senha, roles, funcao_id, setor_id, email } = req.body || {};
  const bodyOperacaoId = req.body?.operacao_id;
  const rawOperIds = Array.isArray(req.body?.operacao_ids)
    ? req.body.operacao_ids
    : (bodyOperacaoId != null ? [bodyOperacaoId] : []);
  const operacao_ids = Array.from(new Set(
    rawOperIds
      .map(id => (id == null ? '' : String(id).trim()))
      .filter(id => id.length > 0)
  ));
  const operacao_id = operacao_ids.length ? operacao_ids[0] : null;

  // Pegar permissões de produto
  const rawProdPermCodigos = Array.isArray(req.body?.produto_permissao_codigos)
    ? req.body.produto_permissao_codigos
    : [];
  const produto_permissao_codigos = Array.from(new Set(
    rawProdPermCodigos
      .map(codigo => (codigo == null ? '' : String(codigo).trim()))
      .filter(codigo => codigo.length > 0)
  ));

  try { console.log('[POST /api/colaboradores] produto_permissao_codigos=', produto_permissao_codigos); } catch {}

  // força senha provisória apenas na criação
const senhaProvisoria = '123';

  if (!username?.trim()) return res.status(400).json({ error: 'Usuário obrigatório' });

  try {
    const novo = await withTx(async (cx) => {
      // 1) cria usuário (usa função, se existir)
      let userRow;
      try {
// se existir a função no banco:
const q = await cx.query(
  'SELECT * FROM public.auth_create_user($1, $2, $3::text[])',
  [username.trim(), senhaProvisoria, roles]
);

// (removido: função duplicada syncUserProdutoPermissoes — agora definida no escopo superior)

        userRow = q.rows?.[0];
        
        // Se conseguiu criar pelo auth_create_user, atualiza o email separadamente
        if (userRow?.id && email != null) {
          await cx.query(
            'UPDATE public.auth_user SET email = $1 WHERE id = $2',
            [email.trim() || null, userRow.id]
          );
        }
      } catch (e) {
        // fallback: insere manualmente com crypt()
const q = await cx.query(
  `WITH upsert AS (
  INSERT INTO public.auth_user (username, password_hash, roles, email)
  VALUES ($1, crypt(COALESCE($2, gen_random_uuid()::text), gen_salt('bf')), $3::text[], $4)
  ON CONFLICT (username) DO NOTHING
  RETURNING *
)
SELECT * FROM upsert;
`,


  [username.trim(), senhaProvisoria, roles, email?.trim() || null]
);

        userRow = q.rows?.[0];
      }
      if (!userRow) throw new Error('Falha ao criar usuário');

      // 2) vincula setor/função (perfil)
      await upsertUserProfile(cx, userRow.id, { funcao_id, setor_id, operacao_id });
      await syncUserOperacoes(cx, userRow.id, operacao_ids);

  // 3) vincula permissões de produto
  try { console.log('[POST sync] user=', userRow.id, 'perms=', produto_permissao_codigos); } catch {}
  await syncUserProdutoPermissoes(cx, userRow.id, produto_permissao_codigos);
  try {
    const check = await cx.query('SELECT array_agg(permissao_codigo) arr FROM public.auth_user_produto_permissao WHERE user_id=$1', [userRow.id]);
    console.log('[POST sync check]', check.rows?.[0]?.arr || null);
  } catch(e){ console.warn('[POST sync check ERR]', e.message); }

  // 4) retorna o básico
      return { id: userRow.id, username: userRow.username, roles: userRow.roles };
    });

    res.json(novo);
} catch (e) {
  if (e && (e.http === 409 || e.message === 'USERNAME_TAKEN')) {
    return res.status(409).json({ error: 'Nome de usuário já existe. Escolha outro.' });
  }
  console.error('[POST /api/colaboradores]', e);
  res.status(500).json({ error: 'Erro ao criar colaborador' });
}

});

// === Atualizar colaborador (username, função, setor, roles) ===
// === Atualizar colaborador (username, função, setor, roles) ===
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { username, funcao_id, setor_id, roles, email } = req.body || {};
  try { console.log('[PUT /api/colaboradores/:id] RAW BODY', req.body); } catch {}
  const bodyOperacaoId = req.body?.operacao_id;
  const rawOperIds = Array.isArray(req.body?.operacao_ids)
    ? req.body.operacao_ids
    : (bodyOperacaoId != null ? [bodyOperacaoId] : undefined);
  const operacao_ids = rawOperIds === undefined ? undefined : Array.from(new Set(
    rawOperIds
      .map(id => (id == null ? '' : String(id).trim()))
      .filter(id => id.length > 0)
  ));
  const operacao_id = operacao_ids && operacao_ids.length ? operacao_ids[0] : (bodyOperacaoId != null ? String(bodyOperacaoId).trim() || null : null);

  // Extrai produto_permissao_codigos
  const rawProdPermCodigos = Array.isArray(req.body?.produto_permissao_codigos)
    ? req.body.produto_permissao_codigos
    : undefined;
  const produto_permissao_codigos = rawProdPermCodigos === undefined ? undefined : Array.from(new Set(
    rawProdPermCodigos
      .map(codigo => (codigo == null ? '' : String(codigo).trim()))
      .filter(codigo => codigo.length > 0)
  ));
  if (produto_permissao_codigos !== undefined) {
    try { console.log('[PUT /api/colaboradores/:id] produto_permissao_codigos=', produto_permissao_codigos); } catch {}
  }

  try {
    await withTx(async (cx) => {
      // atualiza username (se veio)
      if (typeof username === 'string' && username.trim()) {
        const newName = username.trim();

        // 1) checa duplicidade (case-insensitive opcional: troque por lower() se quiser)
        const dupe = await cx.query(
          `SELECT 1 FROM public.auth_user
            WHERE username = $1 AND id <> $2
            LIMIT 1`,
          [newName, id]
        );
        if (dupe.rowCount) {
          // aborta cedo com uma mensagem amigável
          const err = new Error('USERNAME_TAKEN');
          err.http = 409;
          throw err;
        }

        // 2) se não há duplicata, aplica o update
        await cx.query(
          `UPDATE public.auth_user
              SET username = $1, updated_at = now()
            WHERE id = $2`,
          [newName, id]
        );
      }

      // atualiza email (se veio no body, mesmo que vazio)
      if (email !== undefined) {
        await cx.query(
          `UPDATE public.auth_user
              SET email = $1, updated_at = now()
            WHERE id = $2`,
          [email?.trim() || null, id]
        );
      }

      // atualiza roles (se veio)
      if (Array.isArray(roles)) {
        await cx.query(
          `UPDATE public.auth_user
              SET roles = $1::text[], updated_at = now()
            WHERE id = $2`,
          [roles, id]
        );
      }

      // upsert do perfil (função/setor) se veio algo
      await upsertUserProfile(cx, id, { funcao_id, setor_id, operacao_id });
      if (operacao_ids !== undefined) {
        await syncUserOperacoes(cx, id, operacao_ids);
      }
      // sincroniza permissões de produto SEM depender de mudança em operações
      if (produto_permissao_codigos !== undefined) {
        try { console.log('[PUT sync] user=', id, 'perms=', produto_permissao_codigos); } catch {}
        await syncUserProdutoPermissoes(cx, id, produto_permissao_codigos);
        try {
          const check = await cx.query('SELECT array_agg(permissao_codigo) arr FROM public.auth_user_produto_permissao WHERE user_id=$1', [id]);
          console.log('[PUT sync check]', check.rows?.[0]?.arr || null);
        } catch(e){ console.warn('[PUT sync check ERR]', e.message); }
      }
    });

    res.json({ ok: true });
  } catch (e) {
    // mapeia o erro de duplicidade para 409
    if (e && (e.http === 409 || e.message === 'USERNAME_TAKEN')) {
      return res.status(409).json({ error: 'Nome de usuário já existe. Escolha outro.' });
    }
    console.error('[PUT /api/colaboradores/:id]', e);
    res.status(500).json({ error: 'Erro ao atualizar colaborador' });
  }
});

// === Excluir colaborador ===
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  // (opcional) impedir se o próprio usuário logado for deletar a si mesmo
  // if (req.user?.id && String(req.user.id) === String(id)) {
  //   return res.status(400).json({ error: 'Você não pode se auto-excluir.' });
  // }

  try {
    await withTx(async (cx) => {
      // apaga dependências primeiro (sem ON DELETE CASCADE)
      await cx.query('DELETE FROM public.auth_user_permission WHERE user_id = $1', [id]);
      await cx.query('DELETE FROM public.auth_user_profile    WHERE user_id = $1', [id]);

      // apaga o usuário
      const del = await cx.query('DELETE FROM public.auth_user WHERE id = $1 RETURNING id', [id]);
      if (del.rowCount === 0) {
        const err = new Error('NOT_FOUND');
        err.http = 404;
        throw err;
      }
    });

    res.json({ ok: true });
  } catch (e) {
    if (e.http === 404 || e.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    console.error('[DELETE /api/colaboradores/:id]', e);
    res.status(500).json({ error: 'Erro ao excluir colaborador' });
  }
});

// PUT /api/users/update-password-by-username
const bcrypt = require('bcrypt');           // se já usa hash no login
const USE_BCRYPT = true;                    // deixe true se seu login compara hash

router.put('/api/users/update-password-by-username', express.json(), async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok:false, error:'username e password obrigatórios' });
  }

  const client = await pool.connect();
  try {
    // ajuste para seu schema real: login, email, usuario...
    const { rows } = await client.query(
      `SELECT id FROM colaboradores WHERE login = $1 OR email = $1 LIMIT 1`,
      [username]
    );
    if (!rows.length) return res.status(404).json({ ok:false, error:'Usuário não encontrado' });

    const userId = rows[0].id;
    const hashed = USE_BCRYPT ? await bcrypt.hash(password, 10) : password;

    await client.query(
      `UPDATE colaboradores SET senha = $1, updated_at = NOW() WHERE id = $2`,
      [hashed, userId]
    );

    return res.json({ ok:true, userId });
  } catch (e) {
    console.error('[update-password-by-username]', e);
    return res.status(500).json({ ok:false, error:'Erro interno' });
  } finally {
    client.release();
  }
});

// ========== Endpoints de Permissões de Produto ==========

// GET /api/colaboradores/produto-permissoes - Lista todas as permissões de produto disponíveis
router.get('/produto-permissoes', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT codigo, nome 
      FROM produto_permissao 
      ORDER BY nome
    `);
    res.json(rows);
  } catch (e) {
    console.error('[produto-permissoes] erro:', e);
    res.status(500).json({ error: 'Erro ao buscar permissões de produto' });
  }
});

module.exports = router;
