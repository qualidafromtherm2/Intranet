import type { PermissionNode, ShellArea, ShellAction } from '../types'
import { buildLegacyUrl } from '../services/authGateway'

const baseLegacyUrl = buildLegacyUrl('/menu_produto.html')

export const shellAreas: ShellArea[] = [
  {
    id: 'logistica',
    title: 'Logística',
    description: 'Produtos, estoque, compras e expedição.',
    accent: 'bg-red-50 text-red-700 border-red-200',
    actions: [
      {
        id: 'lista-produtos',
        title: 'Lista de produtos',
        description: 'Consulta e filtros do cadastro atual de produtos.',
        selector: '#btn-omie-list1',
        view: 'products',
      },
      {
        id: 'cadastro-produto',
        title: 'Cadastrar produto',
        description: 'Fluxo legado de cadastro do produto.',
        selector: '#menu-produto',
        view: 'legacy',
        legacyPath: baseLegacyUrl,
        legacyHint: 'Abre a Intranet legada com o menu de produto disponível.',
      },
      {
        id: 'definicoes-produto',
        title: 'Definições',
        description: 'Configurações legadas relacionadas ao cadastro.',
        selector: '#btn-definicoes',
        view: 'legacy',
        legacyPath: baseLegacyUrl,
        legacyHint: 'Abre a Intranet legada para continuar nas definições.',
      },
      {
        id: 'estoque',
        title: 'Estoque',
        description: 'Armazéns, recebimento e movimentações.',
        selector: '#menu-armazens',
        view: 'legacy',
        legacyPath: baseLegacyUrl,
        legacyHint: 'Abre a Intranet legada para as rotinas de estoque.',
      },
      {
        id: 'compras',
        title: 'Compras',
        description: 'Solicitações e acompanhamento de compras.',
        selector: '#cart-icon',
        view: 'legacy',
        legacyPath: baseLegacyUrl,
        legacyHint: 'Abre a Intranet legada para as rotinas de compras.',
      },
      {
        id: 'expedicao',
        title: 'Expedição',
        description: 'Transferências, envios, fretes e relatórios.',
        selector: '#menu-solicitacao-transferencia',
        view: 'legacy',
        legacyPath: baseLegacyUrl,
        legacyHint: 'Abre a Intranet legada para as rotinas de expedição.',
      },
    ],
  },
  {
    id: 'producao',
    title: 'Produção',
    description: 'Registros, inspeção e acompanhamento da produção.',
    accent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    actions: [
      {
        id: 'linha-producao',
        title: 'Linha de produção',
        description: 'Fluxos produtivos ainda operam no legado.',
        selector: '#menu-registrar-producao',
        view: 'legacy',
        legacyPath: `${baseLegacyUrl}#linha-producao`,
        legacyHint: 'Abre o legado na área de produção.',
      },
    ],
  },
  {
    id: 'qualidade',
    title: 'Qualidade',
    description: 'Inspeções, documentos e controles.',
    accent: 'bg-blue-50 text-blue-700 border-blue-200',
    actions: [
      {
        id: 'qualidade-fabrica',
        title: 'Qualidade fábrica',
        description: 'Rotinas de qualidade permanecem no legado.',
        selector: '#menu-qualidade-fabrica',
        view: 'legacy',
        legacyPath: baseLegacyUrl,
        legacyHint: 'Abre a Intranet legada para as rotinas de qualidade.',
      },
    ],
  },
  {
    id: 'vendas',
    title: 'Vendas',
    description: 'Pedidos, mapas, indicadores e relatórios.',
    accent: 'bg-amber-50 text-amber-800 border-amber-200',
    actions: [
      {
        id: 'vendas',
        title: 'Rotinas de vendas',
        description: 'Operação comercial ainda roda no legado.',
        selector: '#menu-vendas-graficos',
        view: 'legacy',
        legacyPath: baseLegacyUrl,
        legacyHint: 'Abre a Intranet legada para as rotinas de vendas.',
      },
    ],
  },
  {
    id: 'sac',
    title: 'SAC e assistência',
    description: 'Atendimento técnico, solicitações e relatórios.',
    accent: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
    actions: [
      {
        id: 'sac',
        title: 'Rotinas de SAC',
        description: 'Atendimento técnico segue no legado.',
        selector: '#menu-sac-at',
        view: 'legacy',
        legacyPath: baseLegacyUrl,
        legacyHint: 'Abre a Intranet legada para as rotinas de SAC.',
      },
    ],
  },
  {
    id: 'rh',
    title: 'Recursos humanos',
    description: 'Colaboradores, cargos, férias e EPIs.',
    accent: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    actions: [
      {
        id: 'rh',
        title: 'Rotinas de RH',
        description: 'Cadastros e gestão de pessoas seguem no legado.',
        selector: '#btn-colaboradores',
        view: 'legacy',
        legacyPath: baseLegacyUrl,
        legacyHint: 'Abre a Intranet legada para as rotinas de RH.',
      },
    ],
  },
]

function actionAllowed(action: ShellAction, nodesBySelector: Map<string, PermissionNode[]>) {
  if (!action.selector) return true
  const hits = nodesBySelector.get(action.selector) ?? []
  return hits.some((node) => node.allowed)
}

export function buildAllowedAreas(nodes: PermissionNode[]) {
  const nodesBySelector = new Map<string, PermissionNode[]>()

  for (const node of nodes) {
    const selector = String(node.selector || '').trim()
    if (!selector) continue
    const bucket = nodesBySelector.get(selector) ?? []
    bucket.push(node)
    nodesBySelector.set(selector, bucket)
  }

  return shellAreas
    .map((area) => ({
      ...area,
      actions: area.actions.filter((action) => actionAllowed(action, nodesBySelector)),
    }))
    .filter((area) => area.actions.length > 0)
}
