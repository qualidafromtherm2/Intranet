import type { GembaItem } from '../features/production-gemba/types'

export const loadProductionGemba = async () => {
  const response = await fetch('/api/producao/gemba', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`)
  if (!Array.isArray(payload.items)) throw new Error('Contrato Gemba inválido: esperado items[].')
  return { items: payload.items as GembaItem[] }
}
