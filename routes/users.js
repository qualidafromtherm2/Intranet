// routes/users.js — SQL only (com self-or-manage e salvamento de permissões)
const express = require('express');
const { Pool } = require('pg');

const router = express.Router();
router.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let _hasProfileOperCol = null;
async function hasOperacaoProfileColumn() {
  if (_hasProfileOperCol !== null) return _hasProfileOperCol;
  try {
    const { rows } = await pool.query(
      `SELECT EXISTS(
         SELECT 1
           FROM information_schema.columns
          WHERE table_schema='public'
            AND table_name='auth_user_profile'
            AND column_name='operacao_id'
       ) AS ok`
    );
    _hasProfileOperCol = !!rows[0]?.ok;
  } catch (e) {
    console.warn('[users] não foi possível verificar coluna operacao_id:', e.message);
    _hasProfileOperCol = false;
  }
  return _hasProfileOperCol;
}

let _hasOperacaoLinkTable = null;
async function hasOperacaoLinkTable() {
  if (_hasOperacaoLinkTable !== null) return _hasOperacaoLinkTable;
  try {
    const { rows } = await pool.query(
      `SELECT EXISTS(
         SELECT 1
           FROM information_schema.tables
          WHERE table_schema='public'
            AND table_name='auth_user_operacao'
       ) AS ok`
    );
    _hasOperacaoLinkTable = !!rows[0]?.ok;
  } catch (e) {
    console.warn('[users] não foi possível verificar tabela auth_user_operacao:', e.message);
    _hasOperacaoLinkTable = false;
  }
  return _hasOperacaoLinkTable;
}

let _operacaoColumns = undefined;
async function getOperacaoColumns() {
  if (_operacaoColumns !== undefined) return _operacaoColumns;
  try {
    const { rows } = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='omie_operacao'
        ORDER BY ordinal_position`
    );
    if (!rows.length) {
      _operacaoColumns = null;
      return null;
    }
    const names = rows.map(r => r.column_name);
    const pick = (candidates, fallback) => {
      for (const cand of candidates) {
        const match = names.find(n => n.toLowerCase() === cand);
        if (match) return match;
      }
      return fallback || names[0];
    };
    const id = pick(['id', 'operacao_id', 'id_operacao', 'codigo', 'cod'], names[0]);
    const label = pick(
      ['operacao', 'descricao', 'nome', 'label', 'descricao_operacao', 'titulo'],
      names.find(n => n !== id) || names[0]
    );
    _operacaoColumns = { id, label };
    return _operacaoColumns;
  } catch (e) {
    console.warn('[users] não foi possível obter colunas de omie_operacao:', e.message);
    _operacaoColumns = null;
    return null;
  }
}

/* ----------------- helpers ----------------- */
function requireLogin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Não autenticado' });
  next();
}

async function hasManagePermission(userId) {
  const { rows } = await pool.query(
    `SELECT EXISTS(
       SELECT 1 FROM public.auth_user_permissions_tree($1) t
       WHERE t.key='side:rh:cad-colab' AND t.allowed
     ) AS ok`,
    [userId]
  );
  return !!rows[0]?.ok;
}

async function manageOnly(req, res, next) {
  const me = req.session?.user;
  if (!me) return res.status(401).json({ error: 'Não autenticado' });
  if (await hasManagePermission(me.id)) return next();
  return res.status(403).json({ error: 'Sem permissão' });
}

async function selfOrManage(req, res, next) {
  const me = req.session?.user;
  if (!me) return res.status(401).json({ error: 'Não autenticado' });

  const p = String(req.params.id || '');
  if (String(me.id) === p || String(me.username) === p) return next(); // próprio usuário

  if (await hasManagePermission(me.id)) return next();                 // pode gerenciar
  return res.status(403).json({ error: 'Sem permissão' });
}

async function idFromParam(p) {
  const { rows } = await pool.query(
    `SELECT id FROM public.auth_user WHERE id::text=$1 OR username=$1 LIMIT 1`,
    [p]
  );
  return rows[0]?.id || null;
}

/* ----------------- 1) Listar usuários (precisa poder gerenciar) ----------------- */
router.get('/', requireLogin, manageOnly, async (_req, res) => {
  const hasOper = await hasOperacaoProfileColumn();
  const hasOperLink = await hasOperacaoLinkTable();
  const operCols = (hasOper || hasOperLink) ? await getOperacaoColumns() : null;
  const useOper = hasOper && operCols;
  const operLabelExpr = useOper ? `op_single."${operCols.label}"::text` : 'NULL::text';
  const operIdExpr = useOper ? `op_single."${operCols.id}"::text` : 'NULL::text';
  const profileOperIdExpr = 'up.operacao_id::text';
  const operJoin = useOper
    ? ` LEFT JOIN public.omie_operacao op_single ON ${operIdExpr} = ${profileOperIdExpr}`
    : '';
  const operSelect = useOper
    ? `, ${operLabelExpr} AS operacao, up.operacao_id`
    : ", NULL::text AS operacao, NULL::bigint AS operacao_id";

  const useOperList = hasOperLink && operCols;
  // Usar subconsulta LATERAL para evitar produto cartesiano entre operações e permissões
  const operListSelect = useOperList
    ? `,
       (SELECT COALESCE(
         json_agg(
           json_build_object(
             'id', uo.operacao_id::text,
             'label', COALESCE(op_list."${operCols.label}"::text, uo.operacao_id::text)
           )
           ORDER BY COALESCE(op_list."${operCols.label}"::text, uo.operacao_id::text)
         ),
         '[]'::json
       )
       FROM public.auth_user_operacao uo
       LEFT JOIN public.omie_operacao op_list ON op_list."${operCols.id}"::text = uo.operacao_id::text
       WHERE uo.user_id = u.id
       ) AS operacoes`
    : `,
       '[]'::json AS operacoes`;
  const extraGroup = useOper ? `, ${operLabelExpr}, up.operacao_id` : '';

  // Adicionar permissões de produto usando subconsulta LATERAL
  const prodPermSelect = `,
    (SELECT COALESCE(
      json_agg(
        json_build_object(
          'codigo', upp.permissao_codigo,
          'nome', pp.nome
        )
        ORDER BY pp.nome
      ),
      '[]'::json
    )
    FROM public.auth_user_produto_permissao upp
    LEFT JOIN public.produto_permissao pp ON pp.codigo = upp.permissao_codigo
    WHERE upp.user_id = u.id
    ) AS produto_permissoes`;

  const q = `
    SELECT u.id::text AS id, u.username::text AS username, u.email, u.roles,
           s.name AS setor, f.name AS funcao
           ${operSelect}
           ${operListSelect}
           ${prodPermSelect}
      FROM public.auth_user u
      LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
      LEFT JOIN public.auth_sector s ON s.id = up.sector_id
      LEFT JOIN public.auth_funcao f ON f.id = up.funcao_id
      ${operJoin}
     GROUP BY u.id, u.username, u.email, u.roles, s.name, f.name${extraGroup}
     ORDER BY u.username`;
  const { rows } = await pool.query(q);
  res.json(rows.map(r => ({
    id: r.id, username: r.username, email: r.email || null, roles: r.roles || [],
    setor: r.setor || null, funcao: r.funcao || null,
    operacao: r.operacao || null,
    operacao_id: r.operacao_id != null ? Number(r.operacao_id) : null,
  operacoes: Array.isArray(r.operacoes) ? r.operacoes : [],
  produto_permissoes: Array.isArray(r.produto_permissoes) ? r.produto_permissoes : []
  })));
});

/* ----------------- 2) Obter 1 usuário + perfil (self OU quem pode gerenciar) ----------------- */
router.get('/:id', requireLogin, selfOrManage, async (req, res) => {
  const uid = await idFromParam(req.params.id);
  if (!uid) return res.status(404).json({ error: 'Usuário não encontrado' });

  const hasOper = await hasOperacaoProfileColumn();
  const hasOperLink = await hasOperacaoLinkTable();
  const operCols = (hasOper || hasOperLink) ? await getOperacaoColumns() : null;
  const useOper = hasOper && operCols;
  const operLabelExpr = useOper ? `op_single."${operCols.label}"` : 'NULL::text';
  const operIdExpr = useOper ? `op_single."${operCols.id}"::text` : 'NULL::text';
  const profileOperIdExpr = 'up.operacao_id::text';
  const operJoin = useOper
    ? ` LEFT JOIN public.omie_operacao op_single ON ${operIdExpr} = ${profileOperIdExpr}`
    : '';
  const operSelect = useOper
    ? `, ${operLabelExpr} AS operacao, up.operacao_id`
    : ", NULL::text AS operacao, NULL::bigint AS operacao_id";

  const useOperList = hasOperLink && operCols;
  const operListJoin = useOperList
    ? ` LEFT JOIN public.auth_user_operacao uo ON uo.user_id = u.id
        LEFT JOIN public.omie_operacao op_list ON op_list."${operCols.id}"::text = uo.operacao_id::text`
    : '';
  const operListLabelExpr = useOperList ? `op_list."${operCols.label}"` : 'NULL::text';
  const operListSelect = useOperList
    ? `,
       COALESCE(
         json_agg(
           json_build_object(
             'id', uo.operacao_id::text,
             'label', COALESCE(${operListLabelExpr}, uo.operacao_id::text)
           )
           ORDER BY COALESCE(${operListLabelExpr}, uo.operacao_id::text)
         ) FILTER (WHERE uo.operacao_id IS NOT NULL),
         '[]'::json
       ) AS operacoes`
    : `,
       '[]'::json AS operacoes`;
  const extraGroup = useOper ? `, ${operLabelExpr}, up.operacao_id` : '';
  const q = `
    SELECT u.id::text AS id, u.username::text AS username, u.email, u.roles,
           s.name AS setor, f.name AS funcao
           ${operSelect}
           ${operListSelect}
      FROM public.auth_user u
      LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
      LEFT JOIN public.auth_sector s ON s.id = up.sector_id
      LEFT JOIN public.auth_funcao f ON f.id = up.funcao_id
      ${operJoin}
      ${operListJoin}
     WHERE u.id = $1
     GROUP BY u.id, u.username, u.email, u.roles, s.name, f.name${extraGroup}
     LIMIT 1`;
  const { rows } = await pool.query(q, [uid]);
  const r = rows[0];

  // Buscar permissões de produto
  const { rows: permRows } = await pool.query(
    `SELECT pp.codigo, pp.nome
     FROM public.auth_user_produto_permissao upp
     JOIN public.produto_permissao pp ON pp.codigo = upp.permissao_codigo
     WHERE upp.user_id = $1
     ORDER BY pp.nome`,
    [uid]
  );

  res.json({
    user:    { id: r.id, username: r.username, email: r.email || null, roles: r.roles || [] },
    profile: {
      setor: r.setor || null,
      funcao: r.funcao || null,
      operacao: r.operacao || null,
      operacao_id: r.operacao_id != null ? Number(r.operacao_id) : null,
  operacoes: Array.isArray(r.operacoes) ? r.operacoes : [],
  produto_permissoes: permRows
    }
  });
});

/* ----------------- 3) Árvore de permissões (SELF OU quem pode gerenciar) ----------------- */
// rota "me" (facilita no front). IMPORTANTE: declarar ANTES de "/:id/..."
router.get('/me/permissions/tree', requireLogin, async (req, res) => {
  const uid = req.session.user.id;
  const { rows } = await pool.query(
    `SELECT t.id, t.parent_id, t.key, t.label, t.pos, t.sort, t.allowed, t.user_override,
            (SELECT selector FROM public.nav_node n WHERE n.id=t.id) AS selector
       FROM public.auth_user_permissions_tree($1) t
     ORDER BY t.pos, t.parent_id NULLS FIRST, t.sort, t.id`,
    [uid]
  );
  res.json({ userId: String(uid), nodes: rows });
});

router.get('/:id/permissions/tree', requireLogin, selfOrManage, async (req, res) => {
  const uid = await idFromParam(req.params.id);
  if (!uid) return res.status(404).json({ error: 'Usuário não encontrado' });

  const { rows } = await pool.query(
    `SELECT t.id, t.parent_id, t.key, t.label, t.pos, t.sort, t.allowed, t.user_override,
            (SELECT selector FROM public.nav_node n WHERE n.id=t.id) AS selector
       FROM public.auth_user_permissions_tree($1) t
     ORDER BY t.pos, t.parent_id NULLS FIRST, t.sort, t.id`,
    [uid]
  );
  res.json({ userId: String(uid), nodes: rows });
});

/* ----------------- 4) Salvar permissões (precisa poder gerenciar) ----------------- */
router.post('/:id/permissions/save', requireLogin, manageOnly, async (req, res) => {
  const uid = await idFromParam(req.params.id);
  if (!uid) return res.status(404).json({ error: 'Usuário não encontrado' });

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'Nada para salvar' });

  const rowsToInsert = items
    .map(it => ({ node_id: Number(it.node_id ?? it.id), allow: !!it.allowed }))
    .filter(it => Number.isInteger(it.node_id));

  if (!rowsToInsert.length) return res.status(400).json({ error: 'Itens inválidos' });

  const values = [];
  const params = [];
  let i = 1;
  for (const it of rowsToInsert) {
    params.push(uid, it.node_id, it.allow);
    values.push(`($${i++}, $${i++}, $${i++})`);
  }
  const sql = `
    INSERT INTO public.auth_user_permission(user_id, node_id, allow)
    VALUES ${values.join(',')}
    ON CONFLICT (user_id, node_id) DO UPDATE SET allow = EXCLUDED.allow`;
  await pool.query(sql, params);

  res.json({ ok: true, updated: rowsToInsert.length });
});

/* ----------------- 5) Atualizar senha/roles (mantive a regra de “pode gerenciar”) ----------------- */
router.put('/:id', requireLogin, manageOnly, async (req, res) => {
  const uid = await idFromParam(req.params.id);
  if (!uid) return res.status(404).json({ error: 'Usuário não encontrado' });

  const { password, roles } = req.body || {};
  if (password) {
    const { rows } = await pool.query('SELECT username FROM public.auth_user WHERE id=$1', [uid]);
    await pool.query('SELECT public.auth_set_password($1,$2)', [rows[0].username, password]);
  }
  if (Array.isArray(roles)) {
    await pool.query('UPDATE public.auth_user SET roles=$1 WHERE id=$2', [roles, uid]);
  }
  res.json({ ok: true });
});

/* ----------------- 6) Endpoint para contagem de mensagens ----------------- */
router.get('/me/messages', requireLogin, async (req, res) => {
  try {
    // Por enquanto retorna sempre 0, você pode implementar a lógica real depois
    res.json({ count: 0 });
  } catch (e) {
    console.error('[GET /me/messages] erro:', e);
    res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }
});

/* ----------------- 7) Endpoint para obter foto de perfil ----------------- */
router.get('/:id/foto-perfil', requireLogin, async (req, res) => {
  try {
    console.log('[GET /:id/foto-perfil] Buscando foto para ID:', req.params.id);
    const uid = await idFromParam(req.params.id);
    if (!uid) {
      console.log('[GET /:id/foto-perfil] ID não encontrado');
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    console.log('[GET /:id/foto-perfil] UID convertido:', uid);
    const { rows } = await pool.query(
      'SELECT foto_perfil_url FROM public.auth_user WHERE id = $1',
      [uid]
    );
    
    console.log('[GET /:id/foto-perfil] Resultado da query:', rows);
    
    if (!rows.length) {
      console.log('[GET /:id/foto-perfil] Usuário não encontrado no banco');
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    const fotoUrl = rows[0].foto_perfil_url || null;
    console.log('[GET /:id/foto-perfil] Retornando foto_perfil_url:', fotoUrl);
    res.json({ foto_perfil_url: fotoUrl });
  } catch (e) {
    console.error('[GET /:id/foto-perfil] erro:', e);
    res.status(500).json({ error: 'Erro ao buscar foto de perfil' });
  }
});

/* ----------------- 8) Endpoint para atualizar foto de perfil ----------------- */
router.put('/:id/foto-perfil', requireLogin, selfOrManage, async (req, res) => {
  try {
    const uid = await idFromParam(req.params.id);
    if (!uid) return res.status(404).json({ error: 'Usuário não encontrado' });
    
    const { foto_perfil_url } = req.body || {};
    
    // Valida URL (básico)
    if (foto_perfil_url && !foto_perfil_url.startsWith('http')) {
      return res.status(400).json({ error: 'URL inválida' });
    }
    
    await pool.query(
      'UPDATE public.auth_user SET foto_perfil_url = $1, updated_at = NOW() WHERE id = $2',
      [foto_perfil_url || null, uid]
    );
    
    res.json({ ok: true, foto_perfil_url: foto_perfil_url || null });
  } catch (e) {
    console.error('[PUT /:id/foto-perfil] erro:', e);
    res.status(500).json({ error: 'Erro ao atualizar foto de perfil' });
  }
});

module.exports = router;
