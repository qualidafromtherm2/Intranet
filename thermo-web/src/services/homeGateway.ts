import type { ActivityResponse, ReminderResponse, ReservationResponse } from '../types'

const proxyTarget = import.meta.env.VITE_PROXY_TARGET || 'http://127.0.0.1:5001'

function buildFriendlyError(path: string, detail?: string) {
  const base = `Falha ao carregar dados da home por ${path}.`
  const hint = `Confirme se o backend legado está ativo em ${proxyTarget}.`
  return detail ? `${base} ${detail} ${hint}` : `${base} ${hint}`
}

async function getJson<T>(path: string) {
  try {
    const response = await fetch(path, {
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
    if (error instanceof Error && error.message.includes('Falha ao carregar dados da home')) throw error
    throw new Error(buildFriendlyError(path, error instanceof Error ? error.message : undefined))
  }
}

export async function loadReservationsMonth(year: number, month: number) {
  return getJson<ReservationResponse>(`/api/rh/reservas?ano=${year}&mes=${month}`)
}

export async function loadRemindersMonth(year: number, month: number, user: string) {
  const params = new URLSearchParams({ ano: String(year), mes: String(month), user })
  return getJson<ReminderResponse>(`/api/rh/lembretes?${params.toString()}`)
}

export async function loadRecentActivity(user: string, limit = 12) {
  const params = new URLSearchParams({ usuario: user, limit: String(limit) })
  return getJson<ActivityResponse>(`/api/monitoramento/cronologia?${params.toString()}`)
}

export async function loadActiveUsers() {
  try {
    const response = await getJson<{ users?: string[] }>('/api/users/ativos')
    return Array.isArray(response.users) ? response.users : []
  } catch {
    const fallback = await getJson<{ usuarios?: Array<{ username?: string } | string> }>('/api/usuarios/ativos')
    if (Array.isArray(fallback.usuarios)) {
      return fallback.usuarios
        .map((entry) => (typeof entry === 'string' ? entry : entry?.username))
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    }
    return []
  }
}
