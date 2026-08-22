import type { AuthLoginResponse, AuthStatusResponse, PermissionTreeResponse } from '../types'

const proxyTarget = import.meta.env.VITE_PROXY_TARGET || 'http://127.0.0.1:5001'

function buildFriendlyError(path: string, detail?: string) {
  const base = `Falha na autenticação por ${path}.`
  const hint = `Confirme se o backend legado está ativo em ${proxyTarget}.`
  return detail ? `${base} ${detail} ${hint}` : `${base} ${hint}`
}

async function parseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(path, {
      credentials: 'include',
      headers: { Accept: 'application/json', ...(init?.headers || {}) },
      ...init,
    })

    if (!response.ok) {
      const detail = (await response.text()).trim()
      throw new Error(buildFriendlyError(path, detail || `HTTP ${response.status}`))
    }

    return parseJson<T>(response)
  } catch (error) {
    if (error instanceof Error && error.message.includes('Falha na autenticação')) throw error
    throw new Error(buildFriendlyError(path, error instanceof Error ? error.message : undefined))
  }
}

export function getLegacyBaseUrl() {
  return proxyTarget.replace(/\/$/, '')
}

export function buildLegacyUrl(path = '/menu_produto.html') {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${getLegacyBaseUrl()}${normalizedPath}`
}

export async function getAuthStatus() {
  return getJson<AuthStatusResponse>('/api/auth/status')
}

export async function login(user: string, senha: string) {
  return getJson<AuthLoginResponse>('/api/auth/login', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user, senha }),
  })
}

export async function logout() {
  return getJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
}

export async function getPermissionTree() {
  return getJson<PermissionTreeResponse>('/api/users/me/permissions/tree')
}
