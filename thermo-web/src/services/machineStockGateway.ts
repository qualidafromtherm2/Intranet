const MACHINE_STOCK_CODE = '10408747829'

export type MachineStockItem = {
  codigo: string
  cod_int?: string | null
  descricao: string
  saldo: number
  fisico?: number | null
  reservado?: number | null
  pendente?: number | null
  unidade?: string | null
  updated_at?: string | null
}

export type ReconciliationItem = {
  codigo: string
  descricao: string
  qtySistema: number
  qtyFisica: number
  delta: number
  ajusteQty: number
  tipo: 'ENT' | 'TRF' | null
  origemTrfNome?: string
  destinoTrfNome?: string
  semSistema?: boolean
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...init })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Falha na consulta (${response.status}).`)
  return data as T
}

export async function loadMachineStock(query = '') {
  const params = new URLSearchParams({ local: MACHINE_STOCK_CODE })
  if (query.trim()) params.set('q', query.trim())
  const data = await jsonRequest<{ ok: boolean; total: number; dados: MachineStockItem[] }>(`/api/logistica/estoque?${params}`)
  return data.dados ?? []
}

export async function previewMachineStockCount(items: Array<{ codigo: string; qty_fisica: number }>) {
  return jsonRequest<{ ok: boolean; ultimaData: string; resultados: ReconciliationItem[] }>('/api/ajustes/reconciliar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ local_estoque: MACHINE_STOCK_CODE, itens: items }),
  })
}

export { MACHINE_STOCK_CODE }
