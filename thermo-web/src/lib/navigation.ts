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
  if (selector === '#btn-omie-list1') {
    return {
      icon: itemIconMap[selector] ?? 'boxes',
      migrationStatus: 'migrated',
      view: 'products',
      destination: '/products',
    }
  }

  return {
    icon: inferIcon(node, moduleKey),
    migrationStatus: 'pending',
    view: null,
    destination: selector ? buildLegacyUrl('/menu_produto.html') : null,
  }
}

function buildNavItem(node: PermissionNode, childrenByParent: Map<number, PermissionNode[]>, moduleKey: string, moduleLabel: string): ShellNavItem {
  const meta = inferMeta(node, moduleKey)
  const children = (childrenByParent.get(node.id) ?? []).sort(compareNodes).map((child) => buildNavItem(child, childrenByParent, moduleKey, moduleLabel))

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
    .filter((node) => node.allowed && node.pos === 'top')
    .sort(compareNodes)
    .map((node) => buildNavItem(node, childrenByParent, 'top', 'Topo'))

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
        .map((child) => buildNavItem(child, childrenByParent, node.key, node.label)),
    }))
    .filter((section) => section.children.length > 0)

  sections.push(...sideSections)
  return { sections, selectorMap }
}
