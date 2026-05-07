---
applyTo: 'menu_produto.html'
---
# Protocolo obrigatório ao adicionar novo item no menu lateral

Sempre que você adicionar um novo `<a>` com `data-nav-key` e `data-nav-selector` no menu lateral (`menu_produto.html`), **execute imediatamente** o script abaixo para registrar o item no banco e liberar apenas para admins:

```js
// Substituir os valores entre < > conforme o novo item
const NAV_KEY      = 'side:<area>:<nome>';   // ex: 'side:producao:montagem'
const NAV_LABEL    = '<Label visível>';       // ex: 'Produção montagem'
const NAV_SELECTOR = '#<id-do-elemento>';    // ex: '#menu-monta-producao'
const PARENT_KEY   = 'side:<area>';          // ex: 'side:producao'
const NAV_SORT     = 99;                     // número de ordem (alto = fim da lista)

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  // 1. Busca o id do nó pai
  const { rows: [parent] } = await pool.query(
    `SELECT id FROM public.nav_node WHERE key = $1`, [PARENT_KEY]
  );
  if (!parent) throw new Error(`Nó pai "${PARENT_KEY}" não encontrado`);

  // 2. Insere (ou atualiza) o nav_node
  const { rows: [node] } = await pool.query(`
    INSERT INTO public.nav_node (key, label, position, parent_id, sort, active, selector)
    VALUES ($1, $2, 'side', $3, $4, true, $5)
    ON CONFLICT (key) DO UPDATE SET
      label    = EXCLUDED.label,
      active   = true,
      selector = EXCLUDED.selector
    RETURNING id, key
  `, [NAV_KEY, NAV_LABEL, parent.id, NAV_SORT, NAV_SELECTOR]);
  console.log('nav_node OK:', node);

  // 3. Permissão por role: admin=true, todos os outros=false
  const { rows: roles } = await pool.query(
    `SELECT DISTINCT role FROM public.auth_role_permission`
  );
  const allRoles = [...new Set([...roles.map(r => r.role), 'admin', 'editor'])];
  for (const role of allRoles) {
    await pool.query(`
      INSERT INTO public.auth_role_permission (role, node_id, allow)
      VALUES ($1, $2, $3)
      ON CONFLICT (role, node_id) DO UPDATE SET allow = EXCLUDED.allow
    `, [role, node.id, role === 'admin']);
  }
  console.log('auth_role_permission OK');

  // 4. Permissão por usuário: allow = (roles contém 'admin')
  const { rows: users } = await pool.query(
    `SELECT id, roles FROM public.auth_user`
  );
  for (const u of users) {
    const isAdmin = Array.isArray(u.roles) && u.roles.includes('admin');
    await pool.query(`
      INSERT INTO public.auth_user_permission (user_id, node_id, allow)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, node_id) DO UPDATE SET allow = EXCLUDED.allow
    `, [u.id, node.id, isAdmin]);
  }
  console.log('auth_user_permission OK — admins liberados, demais bloqueados');

  pool.end();
})().catch(e => { console.error(e); process.exit(1); });
```

**Regras:**
- O item ficará **visível apenas para usuários com `role = 'admin'`** — os demais vêem o item oculto.
- Para liberar para outros usuários, use a tela de gerenciamento de permissões da intranet.
- **Não é necessário reiniciar o PM2** — permissões são consultadas em tempo real.
- O usuário deve dar **F5** no browser para invalidar o cache `perm-tree` do localStorage.

## Por que isso é necessário
A função SQL `auth_user_permissions_tree` usa `ELSE FALSE` como padrão — itens sem registro em `nav_node` ficam invisíveis para todos, e itens sem registro em `auth_role_permission`/`auth_user_permission` ficam ocultos para não-admins.
