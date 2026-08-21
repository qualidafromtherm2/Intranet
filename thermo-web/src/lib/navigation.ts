import { buildLegacyUrl } from '../services/authGateway'
import type { AppView, PermissionNode, ShellNavItem, ShellNavigationCatalog, ShellNavSection, ShellNavStatus } from '../types'

type NavMeta = {
  icon: string
  migrationStatus: ShellNavStatus
  view: AppView | null
  destination: string | null
}

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

const sectionIconMap: Record<string, string> = {
  top: 'layout',
  'side:produtos': 'boxes',
  'side:log': 'warehouse',
  'side:compras': 'shopping-cart',
  'side:producao': 'factory',
  'side:qualidade': 'badge-check',
  'side:sac': 'headset',
  'side:vendas': 'chart',
  'side:rh': 'users',
  'side:engenharia': 'drafting',
  'side:sincronizacao': 'refresh',
  'side:chatbot': 'bot',
  'side:conf-sistema': 'settings',
}

const itemIconMap: Record<string, string> = {
  '#menu-inicio': 'home',
  '#menu-lista-produtos': 'boxes',
  '#btn-omie-list1': 'boxes',
  '#menu-produto': 'square-plus',
  '#btn-definicoes': 'settings',
  '#menu-armazens': 'warehouse',
  '#menu-solicitacao-transferencia': 'arrow-left-right',
  '#menu-solicitacao-ajuste': 'file-pen',
  '#menu-simulador-frete': 'calculator',
  '#menu-estoque-minimo': 'boxes',
  '#menu-log-relatorio': 'file-chart-column',
  '#menu-recebimento': 'truck-ramp',
  '#menu-produto-recebido': 'package-check',
  '#menu-guardar-materiais': 'hand',
  '#menu-identificacao-produto': 'printer',
  '#menu-envio-mercadoria': 'truck',
  '#menu-estoque-maquinas': 'cog',
  '#menu-guardar-materiais-expedicao': 'hand',
  '#menu-identificacao-produto-expedicao': 'printer',
  '#cart-icon': 'shopping-cart',
  '#menu-compras-contas-utilizadas': 'landmark',
  '#menu-compras-configuracoes': 'settings',
  '#menu-producao-primeira-peca-ok': 'badge-check',
  '#menu-registrar-producao': 'factory',
  '#menu-registro-producao': 'clipboard-list',
  '#menu-producao-3d': 'scan-search',
  '#menu-monta-producao': 'wrench',
  '#menu-producao-gemba': 'binoculars',
  '#menu-producao-ocorrencias': 'triangle-alert',
  '#menu-preparacoes': 'package-search',
  '#menu-ri-registro-inspecao': 'clipboard-check',
  '#menu-producao-testes': 'flask-conical',
  '#menu-producao-relatorio': 'file-chart-column',
  '#menu-qualidade-fabrica': 'clipboard-check',
  '#menu-qualidade-manuais': 'book-open',
  '#menu-qualidade-area-vermelha': 'ban',
  '#menu-sac-solicitacao-envio': 'send',
  '#menu-sac-at': 'briefcase-medical',
  '#menu-sac-at-relatorio': 'file-chart-column',
  '#menu-vendas-graficos': 'chart-column',
  '#menu-vendas-controle': 'receipt',
  '#menu-vendas-mapa': 'map',
  '#menu-vendas-relatorio': 'file-chart-column',
  '#btn-colaboradores': 'users',
  '#btn-rh-config-cargos': 'id-card',
  '#btn-rh-colaboradores': 'address-book',
  '#btn-rh-controle-ferias': 'palm-tree',
  '#btn-rh-epi': 'shield',
  '#btn-rh-meus-epis': 'file-signature',
  '#menu-engenharia-codigos-erro': 'bug',
  '#menu-engenharia-fromthest': 'cpu',
  '#menu-engenharia-alteracoes': 'history',
  '#menu-engenharia-desenho-tecnico': 'drafting',
  '#menu-engenharia-gerador-graficos': 'chart-line',
  '#menu-sincronizar-produtos': 'refresh',
  '#menu-auditar': 'search-check',
  '#menu-chatbot-monitor': 'bot',
  '#menu-chatbot-config': 'sliders-horizontal',
  '#menu-configurar-agente': 'settings',
}

function normalizeText(value: string | null | undefined) {
  return String(value || '').trim()
}

function compareNodes(left: PermissionNode, right: PermissionNode) {
  const sortLeft = left.sort ?? Number.MAX_SAFE_INTEGER
  const sortRight = right.sort ?? Number.MAX_SAFE_INTEGER
  if (sortLeft !== sortRight) return sortLeft - sortRight
  return left.id - right.id
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

function inferIcon(node: PermissionNode, moduleKey: string) {
  const selector = normalizeText(node.selector)
  if (selector && itemIconMap[selector]) return itemIconMap[selector]
  return sectionIconMap[moduleKey] ?? 'dot'
}

function inferMeta(node: PermissionNode, moduleKey: string): NavMeta {
  const selector = normalizeText(node.selector)
  if (selector === '#btn-omie-list1' || selector === '#menu-lista-produtos') {
    return {
      icon: itemIconMap[selector] ?? 'boxes',
      migrationStatus: 'migrated',
      view: 'products',
      destination: '/products',
    }
  }

  if (selector === '#menu-produto') {
    return {
      icon: itemIconMap[selector] ?? 'square-plus',
      migrationStatus: 'migrated',
      view: 'product-registration',
      destination: '/products/register',
    }
  }

  if (selector === '#menu-armazens') {
    return {
      icon: itemIconMap[selector] ?? 'warehouse',
      migrationStatus: 'migrated',
      view: 'warehouses',
      destination: '/logistics/warehouses',
    }
  }

  if (selector === '#menu-estoque-minimo') {
    return {
      icon: itemIconMap[selector] ?? 'boxes',
      migrationStatus: 'migrated',
      view: 'minimum-stock',
      destination: '/logistics/minimum-stock',
    }
  }

  if (selector === '#menu-solicitacao-ajuste') {
    return {
      icon: itemIconMap[selector] ?? 'file-pen',
      migrationStatus: 'migrated',
      view: 'stock-adjustment',
      destination: '/logistics/stock-adjustment',
    }
  }

  if (selector === '#menu-solicitacao-transferencia') {
    return {
      icon: itemIconMap[selector] ?? 'clipboard-list',
      migrationStatus: 'migrated',
      view: 'separation',
      destination: '/separation',
    }
  }

  if (selector === '#menu-guardar-materiais' || selector === '#menu-guardar-materiais-expedicao') {
    return {
      icon: itemIconMap[selector] ?? 'warehouse',
      migrationStatus: 'migrated',
      view: 'store-materials',
      destination: '/logistics/store-materials',
    }
  }

  if (selector === '#menu-identificacao-produto' || selector === '#menu-identificacao-produto-expedicao') {
    return {
      icon: itemIconMap[selector] ?? 'scan-line',
      migrationStatus: 'migrated',
      view: 'identify-product',
      destination: '/logistics/identify-product',
    }
  }

  if (selector === '#menu-recebimento') {
    return {
      icon: itemIconMap[selector] ?? 'truck-ramp',
      migrationStatus: 'migrated',
      view: 'receiving',
      destination: '/logistics/receiving',
    }
  }

  if (selector === '#menu-produto-recebido') {
    return {
      icon: itemIconMap[selector] ?? 'package-check',
      migrationStatus: 'migrated',
      view: 'products-received',
      destination: '/logistics/products-received',
    }
  }

  if (selector === '#menu-envio-mercadoria') {
    return {
      icon: itemIconMap[selector] ?? 'truck',
      migrationStatus: 'migrated',
      view: 'shipping',
      destination: '/logistics/shipping',
    }
  }

  if (selector === '#menu-estoque-maquinas') {
    return {
      icon: itemIconMap[selector] ?? 'cog',
      migrationStatus: 'migrated',
      view: 'machine-stock',
      destination: '/logistics/machine-stock',
    }
  }

  if (selector === '#menu-simulador-frete') {
    return {
      icon: itemIconMap[selector] ?? 'calculator',
      migrationStatus: 'migrated',
      view: 'freight-simulator',
      destination: '/logistics/freight-simulator',
    }
  }

  if (selector === '#menu-qualidade-fabrica' || selector === '#menu-engenharia-pir-eng') {
    return {
      icon: itemIconMap[selector] ?? 'clipboard-check',
      migrationStatus: 'migrated',
      view: 'pir',
      destination: '/quality/pir',
    }
  }

  if (selector === '#menu-registrar-producao') {
    return {
      icon: itemIconMap[selector] ?? 'factory',
      migrationStatus: 'migrated',
      view: 'production-registration',
      destination: '/production/register',
    }
  }

  if (selector === '#menu-producao-primeira-peca-ok') {
    return {
      icon: itemIconMap[selector] ?? 'badge-check',
      migrationStatus: 'migrated',
      view: 'first-piece',
      destination: '/production/first-piece',
    }
  }

  if (selector === '#menu-registro-producao') {
    return {
      icon: itemIconMap[selector] ?? 'clipboard-list',
      migrationStatus: 'migrated',
      view: 'production-records',
      destination: '/production/records',
    }
  }
  if (selector === '#menu-producao-ocorrencias') return { icon: itemIconMap[selector] ?? 'triangle-alert', migrationStatus: 'migrated', view: 'production-incidents', destination: '/production/incidents' }
  if (selector === '#menu-producao-3d') return { icon: itemIconMap[selector] ?? 'scan-search', migrationStatus: 'migrated', view: 'production-3d', destination: '/production/3d' }
  if (selector === '#menu-producao-gemba') return { icon: itemIconMap[selector] ?? 'binoculars', migrationStatus: 'migrated', view: 'production-gemba', destination: '/production/gemba' }
  if (selector === '#menu-preparacoes') return { icon: itemIconMap[selector] ?? 'package-search', migrationStatus: 'migrated', view: 'preparations', destination: '/production/preparations' }
  if (selector === '#menu-producao-testes') return { icon: itemIconMap[selector] ?? 'flask-conical', migrationStatus: 'migrated', view: 'production-tests', destination: '/production/tests' }
  if (selector === '#menu-producao-relatorio') return { icon: itemIconMap[selector] ?? 'file-chart-column', migrationStatus: 'migrated', view: 'production-report', destination: '/production/report' }
  if (selector === '#menu-ri-registro-inspecao') return { icon: itemIconMap[selector] ?? 'clipboard-check', migrationStatus: 'migrated', view: 'inspection-records', destination: '/quality/inspection-records' }
  if (selector === '#menu-qualidade-manuais') return { icon: itemIconMap[selector] ?? 'book-open', migrationStatus: 'migrated', view: 'quality-manuals', destination: '/quality/manuals' }
  if (selector === '#menu-qualidade-area-vermelha') return { icon: itemIconMap[selector] ?? 'ban', migrationStatus: 'migrated', view: 'red-area', destination: '/quality/red-area' }

  if (selector === '#menu-vendas-relatorio') {
    return {
      icon: itemIconMap[selector] ?? 'file-chart-column',
      migrationStatus: 'migrated',
      view: 'sales-report',
      destination: '/sales/report',
    }
  }

  if (selector === '#menu-vendas-controle') {
    return {
      icon: itemIconMap[selector] ?? 'receipt',
      migrationStatus: 'migrated',
      view: 'sales-control',
      destination: '/sales/orders',
    }
  }

  if (selector === '#menu-vendas-graficos') {
    return {
      icon: itemIconMap[selector] ?? 'chart-column',
      migrationStatus: 'migrated',
      view: 'sales-charts',
      destination: '/sales/charts',
    }
  }
  if (selector === '#menu-vendas-mapa') return { icon: itemIconMap[selector] ?? 'map', migrationStatus: 'migrated', view: 'sales-map', destination: '/sales/map' }
  if (selector === '#menu-compras-contas-utilizadas') return { icon: itemIconMap[selector] ?? 'landmark', migrationStatus: 'migrated', view: 'purchase-accounts', destination: '/purchases/accounts' }
  if (selector === '#menu-compras-configuracoes') return { icon: itemIconMap[selector] ?? 'settings', migrationStatus: 'migrated', view: 'purchase-settings', destination: '/purchases/settings' }
  if (selector === '#menu-sac-solicitacao-envio') return { icon: itemIconMap[selector] ?? 'send', migrationStatus: 'migrated', view: 'sac-shipping-request', destination: '/sac/shipping-requests' }
  if (selector === '#menu-sac-at-relatorio') return { icon: itemIconMap[selector] ?? 'file-chart-column', migrationStatus: 'migrated', view: 'sac-report', destination: '/sac/report' }
  if (selector === '#menu-engenharia-alteracoes') return { icon: itemIconMap[selector] ?? 'history', migrationStatus: 'migrated', view: 'engineering-changes', destination: '/engineering/changes' }
  if (selector === '#menu-chatbot-monitor') return { icon: itemIconMap[selector] ?? 'bot', migrationStatus: 'migrated', view: 'chatbot-monitor', destination: '/chatbot/monitor' }
  if (selector === '#menu-engenharia-codigos-erro') return { icon: itemIconMap[selector] ?? 'bug', migrationStatus: 'migrated', view: 'engineering-error-codes', destination: '/engineering/error-codes' }
  if (selector === '#menu-engenharia-desenho-tecnico') return { icon: itemIconMap[selector] ?? 'drafting', migrationStatus: 'migrated', view: 'technical-drawings', destination: '/engineering/technical-drawings' }

  if (selector === '#menu-log-relatorio') {
    return {
      icon: itemIconMap[selector] ?? 'file-chart-column',
      migrationStatus: 'migrated',
      view: 'logistics-report',
      destination: '/logistics/report',
    }
  }

  if (selector === '#menu-configurar-agente') {
    return {
      icon: itemIconMap[selector] ?? 'settings',
      migrationStatus: 'migrated',
      view: 'print-agent-config',
      destination: '/settings/print-agent',
    }
  }

  return {
    icon: inferIcon(node, moduleKey),
    migrationStatus: 'pending',
    view: null,
    destination: selector ? buildLegacyUrl('/menu_produto.html') : null,
  }
}

function buildNavItem(node: PermissionNode, childrenByParent: Map<number, PermissionNode[]>, moduleKey: string, moduleLabel: string): ShellNavItem | null {
  const meta = inferMeta(node, moduleKey)
  const selector = normalizeText(node.selector)
  const children = meta.migrationStatus === 'migrated'
    ? []
    : (childrenByParent.get(node.id) ?? [])
        .sort(compareNodes)
        .map((child) => buildNavItem(child, childrenByParent, moduleKey, moduleLabel))
        .filter((child): child is ShellNavItem => child !== null)

  // The permission tree also contains form sections (for example, product
  // registration fields). They control access in the legacy screen but are
  // not destinations and must not become disabled sidebar entries.
  if (!selector && children.length === 0) return null

  return {
    id: String(node.id),
    key: node.key,
    label: node.label,
    legacyLabel: node.label,
    moduleKey,
    moduleLabel,
    pos: node.pos,
    selector: node.selector,
    icon: meta.icon,
    migrationStatus: meta.migrationStatus,
    view: meta.view,
    destination: meta.destination,
    order: node.sort ?? 0,
    permissionKey: node.key,
    allowed: node.allowed,
    children,
  }
}

function buildTopSection(nodes: PermissionNode[], childrenByParent: Map<number, PermissionNode[]>): ShellNavSection | null {
  const topRoots = nodes
    .filter((node) => node.pos === 'top' && normalizeText(node.selector) !== '#menu-inicio')
    .sort(compareNodes)
    .map((node) => buildNavItem(node, childrenByParent, 'top', 'Topo'))
    // The legacy top area mixes true shortcuts with product-detail tabs.
    // Only expose shortcuts that already have a real Thermo destination.
    .filter((item): item is ShellNavItem => item !== null && item.migrationStatus === 'migrated' && item.view !== null)

  if (topRoots.length === 0) return null

  return {
    id: 'top',
    key: 'top',
    label: 'Topo',
    icon: sectionIconMap.top,
    order: 0,
    children: topRoots,
  }
}

export function buildNavigationCatalog(nodes: PermissionNode[]): ShellNavigationCatalog {
  const selectorMap = buildSelectorMap(nodes)
  const navigationNodes = nodes.filter((node) => node.pos === 'side' || node.pos === 'top')
  const nodesById = new Map(navigationNodes.map((node) => [node.id, node]))
  const childrenByParent = new Map<number, PermissionNode[]>()
  const sectionRoots: PermissionNode[] = []

  for (const node of navigationNodes) {
    if (node.parent_id && nodesById.has(node.parent_id)) {
      const bucket = childrenByParent.get(node.parent_id) ?? []
      bucket.push(node)
      childrenByParent.set(node.parent_id, bucket)
    } else if (node.pos === 'side') {
      sectionRoots.push(node)
    }
  }

  const sections: ShellNavSection[] = []
  const topSection = buildTopSection(navigationNodes, childrenByParent)
  if (topSection) sections.push(topSection)

  const sideSections = sectionRoots
    .sort((left, right) => {
      const leftIndex = sectionOrder.indexOf(left.key)
      const rightIndex = sectionOrder.indexOf(right.key)
      if (leftIndex !== rightIndex) {
        return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
      }
      return compareNodes(left, right)
    })
    .map((node) => ({
      id: String(node.id),
      key: node.key,
      label: node.label,
      icon: sectionIconMap[node.key] ?? 'folder',
      order: node.sort ?? 0,
      children: (childrenByParent.get(node.id) ?? [])
        .sort(compareNodes)
        .map((child) => buildNavItem(child, childrenByParent, node.key, node.label))
        .filter((item): item is ShellNavItem => item !== null),
    }))
    .filter((section) => section.children.length > 0)

  sections.push(...sideSections)
  return { sections, selectorMap }
}
