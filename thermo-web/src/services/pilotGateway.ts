import { demoSnapshot } from '../data/demo'
import type { CartResponse, DataMode, InventoryLocationsResponse, ProductListResponse, ProductPurchaseResponse, ProductStreamEvent } from '../types'

const dataMode: DataMode = import.meta.env.VITE_THERMO_DATA_MODE === 'proxy' ? 'proxy' : 'demo'
const apiBase = import.meta.env.VITE_API_BASE_URL || ''
const buildUrl = (path: string) => `${apiBase}${path}`

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(buildUrl(path), { credentials: 'include', headers: { Accept: 'application/json' } })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

export async function loadProducts(): Promise<ProductListResponse> {
  if (dataMode === 'demo') return demoSnapshot.products
  return getJson<ProductListResponse>('/api/produtos/lista?limit=250&page=1')
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
  try {
    return await getJson<CartResponse>('/api/compras/carrinho')
  } catch (error) {
    if (error instanceof Error && error.message.includes('401')) return { ok: false, itens: [] }
    throw error
  }
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
  source.onerror = () => onEvent({ type: 'error', message: 'Canal SSE indisponível no momento.' })
  return () => source.close()
}

export const getPilotMode = () => dataMode
export const getDemoUser = () => demoSnapshot.user
