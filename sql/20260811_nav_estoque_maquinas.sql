BEGIN;

INSERT INTO public.nav_node (key, label, position, parent_id, sort, active, selector)
SELECT
  'side:log:estoque-maquinas',
  'estoque de maquinas',
  'side',
  p.id,
  85,
  TRUE,
  '#menu-estoque-maquinas'
FROM public.nav_node p
WHERE p.key = 'side:log'
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  position = EXCLUDED.position,
  parent_id = EXCLUDED.parent_id,
  sort = EXCLUDED.sort,
  active = TRUE,
  selector = EXCLUDED.selector;

INSERT INTO public.auth_role_permission (role, node_id, allow)
SELECT arp.role, n.id, arp.allow
  FROM public.nav_node n
  JOIN public.nav_node s ON s.key = 'side:log:estoque-minimo'
  JOIN public.auth_role_permission arp ON arp.node_id = s.id
 WHERE n.key = 'side:log:estoque-maquinas'
ON CONFLICT (role, node_id) DO NOTHING;

INSERT INTO public.auth_user_permission (user_id, node_id, allow)
SELECT aup.user_id, n.id, aup.allow
  FROM public.nav_node n
  JOIN public.nav_node s ON s.key = 'side:log:estoque-minimo'
  JOIN public.auth_user_permission aup ON aup.node_id = s.id
 WHERE n.key = 'side:log:estoque-maquinas'
ON CONFLICT (user_id, node_id) DO NOTHING;

INSERT INTO public.auth_role_permission (role, node_id, allow)
SELECT 'admin', n.id, TRUE
  FROM public.nav_node n
 WHERE n.key = 'side:log:estoque-maquinas'
ON CONFLICT (role, node_id) DO UPDATE SET allow = TRUE;

COMMIT;
