import type { Production3dResponse } from '../features/production-3d/types'

export async function loadProduction3d() {
  const response = await fetch('/api/producao/cena-3d', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`)
  if (!Array.isArray(payload.itens) || typeof payload.total !== 'number') throw new Error('Contrato Produção 3D inválido: esperado total e itens[].')
  return payload as Production3dResponse
}
