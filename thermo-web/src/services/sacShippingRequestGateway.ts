import type { SacShippingListResponse, StrongConfirmation } from "../features/sac-shipping-request/types"

const base = import.meta.env.VITE_API_BASE_URL || ""

export class SacShippingRequestError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("Accept", "application/json")
  if (typeof init.body === "string") headers.set("Content-Type", "application/json")
  let response: Response
  try {
    response = await fetch(`${base}${path}`, { ...init, headers, credentials: "include", cache: "no-store" })
  } catch (error) {
    throw new SacShippingRequestError(error instanceof Error ? error.message : "Falha de conexão.")
  }
  const raw = await response.text()
  let data: Record<string, unknown> = {}
  try { data = raw ? JSON.parse(raw) : {} } catch { data = { error: raw } }
  if (!response.ok || data.ok === false) {
    throw new SacShippingRequestError(typeof data.error === "string" ? data.error : `Falha HTTP ${response.status}`, response.status)
  }
  return data as T
}

function authorize(canWrite: boolean, confirmation: StrongConfirmation, phrase: string) {
  if (!canWrite) throw new SacShippingRequestError("Ação não autorizada para este perfil.")
  if (!confirmation.confirmed || confirmation.phrase.trim() !== phrase) {
    throw new SacShippingRequestError(`Confirmação forte obrigatória: ${phrase}`)
  }
}

function validId(id: number) {
  if (!Number.isInteger(id) || id <= 0) throw new SacShippingRequestError("Solicitação inválida.")
}

export function listSacShippingRequests() {
  return request<SacShippingListResponse>("/api/sac/solicitacoes?filterByUser=1")
}

export function updateSacShippingStatus(id: number, status: "Pendente" | "Enviado", guard: { canWrite: boolean; confirmation: StrongConfirmation }) {
  validId(id)
  const phrase = status === "Enviado" ? `MARCAR ENVIO ${id} COMO ENVIADO` : `REABRIR ENVIO ${id}`
  authorize(guard.canWrite, guard.confirmation, phrase)
  return request<{ ok: true; rastreio_status: string }>(`/api/sac/solicitacoes/${id}/status`, {
    method: "PATCH", body: JSON.stringify({ status }),
  })
}

export function updateSacShippingIdentification(id: number, identificacao: string, guard: { canWrite: boolean; confirmation: StrongConfirmation }) {
  validId(id)
  authorize(guard.canWrite, guard.confirmation, `ALTERAR RASTREABILIDADE ${id}`)
  const normalized = identificacao.replace(/\s+/g, "").toUpperCase()
  if (!normalized) throw new SacShippingRequestError("Código de rastreabilidade é obrigatório.")
  return request<{ ok: true; identificacao: string }>(`/api/sac/solicitacoes/${id}/identificacao`, {
    method: "PATCH", body: JSON.stringify({ identificacao: normalized }),
  })
}

export function deleteSacShippingRequest(id: number, guard: { canWrite: boolean; confirmation: StrongConfirmation }) {
  validId(id)
  authorize(guard.canWrite, guard.confirmation, `EXCLUIR ENVIO ${id}`)
  return request<{ ok: true; rastreio_status: "Excluído" }>(`/api/sac/solicitacoes/${id}`, { method: "DELETE" })
}

export function createManualSacShippingRequest(input: { usuario: string; observacao?: string; numeroSep?: string; etiqueta: File; declaracao: File }, guard: { canCreate: boolean; confirmation: StrongConfirmation }) {
  authorize(guard.canCreate, guard.confirmation, "CRIAR SOLICITAÇÃO DE ENVIO")
  if (!input.usuario.trim()) throw new SacShippingRequestError("Usuário é obrigatório.")
  if (input.declaracao.type !== "application/pdf") throw new SacShippingRequestError("A declaração deve ser um PDF válido.")
  const form = new FormData()
  form.set("usuario", input.usuario.trim())
  form.set("observacao", input.observacao?.trim() || "")
  if (input.numeroSep?.trim()) form.set("numero_sep", input.numeroSep.trim())
  form.append("anexos", input.etiqueta)
  form.append("anexos", input.declaracao)
  return request<{ ok: true; id: number }>("/api/sac/solicitacoes", { method: "POST", body: form })
}

export function blockAmbiguousShippingAction(action: string): never {
  throw new SacShippingRequestError(`${action} exige o fluxo operacional dedicado; nenhuma postagem, impressão ou geração será iniciada nesta tela.`)
}
