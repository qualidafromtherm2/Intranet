import { demoSnapshot } from '../data/demo'
import type {
  CartResponse,
  DataMode,
  InventoryLocationsResponse,
  ProductListResponse,
  ProductPurchaseResponse,
  ProductStreamEvent,
} from '../types'

const modeFromEnv = import.meta.env.VITE_THERMO_DATA_MODE
const dataMode: DataMode = modeFromEnv === 'demo' ? 'demo' : 'proxy'
const apiBase = import.meta.env.VITE_API_BASE_URL || ''
const proxyTarget = import.meta.env.VITE_PROXY_TARGET || 'http://127.0.0.1:3000'
const buildUrl = (path: string) => `${apiBase}${path}`

function buildFriendlyError(path: string, detail?: string) {
  const base = `Não foi possível carregar dados reais da Lista de Produtos por ${path}.`
  const hint = `Confirme se o backend legado está ativo e acessível pelo proxy Vite em ${proxyTarget}.`
  return detail ? `${base} ${detail} ${hint}` : `${base} ${hint}`
}

async function getJson<T>(path: string): Promise<T> {
  try {
    const response = await fetch(buildUrl(path), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })

    if (!response.ok) {
      const detail = (await response.text()).trim()
      throw new Error(buildFriendlyError(path, detail || `HTTP ${response.status}`))
    }

    return response.json() as Promise<T>
  } catch (error) {
    if (error instanceof Error && error.message.includes('Lista de Produtos')) throw error
    throw new Error(buildFriendlyError(path, error instanceof Error ? error.message : undefined))
  }
}

export async function loadProducts(): Promise<ProductListResponse> {
  if (dataMode === 'demo') return demoSnapshot.products

  const limit = 500
  let page = 1
  let total = 0
  const itens = []

  while (true) {
    const response = await getJson<ProductListResponse>(`/api/produtos/lista?limit=${limit}&page=${page}`)
    const pageItems = Array.isArray(response.itens) ? response.itens : []
    total = Number(response.total || total || pageItems.length)
    itens.push(...pageItems)
    if (pageItems.length === 0 || itens.length >= total) break
    page += 1
  }

  const unique = new Map<string, ProductListResponse['itens'][number]>()
  for (const item of itens) {
    const key = `${String(item.codigo_produto ?? '')}|${String(item.codigo ?? '').trim().toUpperCase()}`
    if (!unique.has(key)) unique.set(key, item)
  }

  const deduped = [...unique.values()]
  return { total: deduped.length, page: 1, limit, itens: deduped }
}

export async function loadPurchases(): Promise<ProductPurchaseResponse> {
  if (dataMode === 'demo') return demoSnapshot.purchases
  return getJson<ProductPurchaseResponse>('/api/compras/produtos-em-compra')
}

export async function loadLocations(): Promise<InventoryLocationsResponse> {
  if (dataMode === 'demo') return demoSnapshot.locations
  return getJson<InventoryLocationsResponse>('/api/logistica/locais-inventario')
}

export async function loadCart(): Promise<CartResponse> {
  if (dataMode === 'demo') return demoSnapshot.cart
  return getJson<CartResponse>('/api/compras/carrinho')
}

export function subscribeProductsStream(onEvent: (event: ProductStreamEvent) => void) {
  if (dataMode === 'demo') {
    const timers = demoSnapshot.sseEvents.map((event, index) => window.setTimeout(() => onEvent(event), 250 * (index + 1)))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }

  const source = new EventSource(buildUrl('/api/produtos/stream'), { withCredentials: true })
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as ProductStreamEvent)
    } catch {
      onEvent({ type: 'message', message: message.data })
    }
  }
  source.onerror = () => onEvent({ type: 'error', message: 'Canal de atualização do legado indisponível no momento.' })
  return () => source.close()
}

export const getPilotMode = () => dataMode
