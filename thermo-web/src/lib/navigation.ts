import type { AppView, PermissionNode, ShellNavItem, ShellNavigationCatalog, ShellNavSection } from '../types'

const migratedSelectors = new Set(['#btn-omie-list1'])

const sectionOrder = [
  'top',
  'side:produtos',
  'side:log',
  'side:compras',
  'side:producao',
  'side:qualidade',
  'side:sac',
  'side:vendas',
  'side:rh',
  'side:engenharia',
  'side:sincronizacao',
  'side:chatbot',
  'side:conf-sistema',
]

const iconRules: Array<{ match: RegExp; icon: string }> = [
  { match: /(in[ií]cio|home)/i, icon: 'home' },
  { match: /(produto|pe[cç]a|manual|pir|ri|cadastro)/i, icon: 'boxes' },
  { match: /(log[ií]st|armaz[eé]m|estoque|recebimento|expedi[cç][aã]o|transfer[eê]ncia|frete|bipagem)/i, icon: 'warehouse' },
  { match: /(compra|carrinho|contas utilizadas)/i, icon: 'shopping-cart' },
  { match: /(produ[cç][aã]o|gemba|linha|montagem|ocorr[eê]ncia|prepara[cç][aã]o|teste)/i, icon: 'factory' },
  { match: /(qualidade|pir|lista mestra|vermelha)/i, icon: 'badge-check' },
  { match: /(sac|atendimento|at\b|envio)/i, icon: 'headset' },
  { match: /(vendas|pedido|mapa|gr[aá]fico)/i, icon: 'chart' },
  { match: /(rh|colaborador|f[eé]rias|epi|aniversariante|cargo)/i, icon: 'users' },
  { match: /(engenharia|desenho|c[oó]digos? de erro|fromthest)/i, icon: 'drafting' },
  { match: /(sincroniza|auditar|configura[rç][aã]o do chatbot|monitoramento)/i, icon: 'refresh' },
  { match: /(config|agente)/i, icon: 'settings' },
]

function normalizeText(value: string | null | undefined) {
  return String(value || '').trim()
}

function buildSelectorMap(nodes: PermissionNode[]) {
  const selectorMap = new Map<string, PermissionNode[]>()

  for (const node of nodes) {
    const selector = normalizeText(node.selector)
    if (!selector) continue
    const bucket = selectorMap.get(selector) ?? []
    bucket.push(node)
    selectorMap.set(selector, bucket)
  }

  return selectorMap
}

export function isSelectorAllowed(selector: string, selectorMap: Map<string, PermissionNode[]>) {
  const hits = selectorMap.get(selector) ?? []
  return hits.some((node) => node.allowed)
}

function resolveIcon(node: PermissionNode) {
  const source = `${node.key} ${node.label} ${node.selector || ''}`
  const hit = iconRules.find((rule) => rule.match.test(source))
  return hit?.icon ?? 'dot'
}

function getView(node: PermissionNode): AppView | null {
  return normalizeText(node.selector) === '#btn-omie-list1' ? 'products' : null
}

function getStatus(node: PermissionNode) {
  return migratedSelectors.has(normalizeText(node.selector)) ? 'migrated' : 'pending'
}

function compareNodes(left: PermissionNode, right: PermissionNode) {
  const sortLeft = left.sort ?? Number.MAX_SAFE_INTEGER
  const sortRight = right.sort ?? Number.MAX_SAFE_INTEGER
  if (sortLeft !== sortRight) return sortLeft - sortRight
  return left.id - right.id
}

function buildNavItem(node: PermissionNode, childrenByParent: Map<number, PermissionNode[]>): ShellNavItem {
  const children = (childrenByParent.get(node.id) ?? []).sort(compareNodes).map((child) => buildNavItem(child, childrenByParent))

  return {
    id: String(node.id),
    key: node.key,
    label: node.label,
    pos: node.pos,
    selector: node.selector,
    icon: resolveIcon(node),
    status: getStatus(node),
    view: getView(node),
    allowed: node.allowed,
    children,
  }
}

function buildTopSection(nodes: PermissionNode[], childrenByParent: Map<number, PermissionNode[]>): ShellNavSection | null {
  const topRoots = nodes
    .filter((node) => node.allowed && node.pos === 'top')
    .sort(compareNodes)
    .map((node) => buildNavItem(node, childrenByParent))

  if (topRoots.length === 0) return null

  return {
    id: 'top',
    key: 'top',
    label: 'Topo',
    icon: 'layout',
    children: topRoots,
  }
}

export function buildNavigationCatalog(nodes: PermissionNode[]): ShellNavigationCatalog {
  const selectorMap = buildSelectorMap(nodes)
  const allowedNodes = nodes.filter((node) => node.allowed && (node.pos === 'side' || node.pos === 'top'))
  const nodesById = new Map(allowedNodes.map((node) => [node.id, node]))
  const childrenByParent = new Map<number, PermissionNode[]>()
  const sectionRoots: PermissionNode[] = []

  for (const node of allowedNodes) {
    if (node.parent_id && nodesById.has(node.parent_id)) {
      const bucket = childrenByParent.get(node.parent_id) ?? []
      bucket.push(node)
      childrenByParent.set(node.parent_id, bucket)
    } else if (node.pos === 'side') {
      sectionRoots.push(node)
    }
  }

  const sections: ShellNavSection[] = []
  const topSection = buildTopSection(allowedNodes, childrenByParent)
  if (topSection) sections.push(topSection)

  const sectionItems = sectionRoots
    .sort((left, right) => {
      const indexLeft = sectionOrder.indexOf(left.key)
      const indexRight = sectionOrder.indexOf(right.key)
      if (indexLeft !== indexRight) {
        return (indexLeft === -1 ? Number.MAX_SAFE_INTEGER : indexLeft) - (indexRight === -1 ? Number.MAX_SAFE_INTEGER : indexRight)
      }
      return compareNodes(left, right)
    })
    .map((node) => ({
      id: String(node.id),
      key: node.key,
      label: node.label,
      icon: resolveIcon(node),
      children: (childrenByParent.get(node.id) ?? []).sort(compareNodes).map((child) => buildNavItem(child, childrenByParent)),
    }))
    .filter((section) => section.children.length > 0)

  sections.push(...sectionItems)

  return { sections, selectorMap }
}
