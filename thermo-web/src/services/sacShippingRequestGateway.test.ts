import { beforeEach, describe, expect, it, vi } from "vitest"
import { createManualSacShippingRequest, deleteSacShippingRequest, listSacShippingRequests, updateSacShippingStatus } from "./sacShippingRequestGateway"

const jsonResponse = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) }) as Response

beforeEach(() => vi.unstubAllGlobals())

describe("sacShippingRequestGateway", () => {
  it("lists only the authenticated user's requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, rows: [] }))
    vi.stubGlobal("fetch", fetchMock)
    await listSacShippingRequests()
    expect(fetchMock).toHaveBeenCalledWith("/api/sac/solicitacoes?filterByUser=1", expect.objectContaining({ credentials: "include", cache: "no-store" }))
  })

  it("blocks status mutation before fetch without permission or exact phrase", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock)
    expect(() => updateSacShippingStatus(42, "Enviado", { canWrite: false, confirmation: { confirmed: true, phrase: "MARCAR ENVIO 42 COMO ENVIADO" } })).toThrow("não autorizada")
    expect(() => updateSacShippingStatus(42, "Enviado", { canWrite: true, confirmation: { confirmed: true, phrase: "confirmo" } })).toThrow("Confirmação forte")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("uses the audited status and logical-delete contracts after confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, rastreio_status: "Enviado" }))
    vi.stubGlobal("fetch", fetchMock)
    await updateSacShippingStatus(42, "Enviado", { canWrite: true, confirmation: { confirmed: true, phrase: "MARCAR ENVIO 42 COMO ENVIADO" } })
    await deleteSacShippingRequest(42, { canWrite: true, confirmation: { confirmed: true, phrase: "EXCLUIR ENVIO 42" } })
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/sac/solicitacoes/42/status", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "Enviado" }) }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/sac/solicitacoes/42", expect.objectContaining({ method: "DELETE" }))
  })

  it("validates the two-file manual contract before upload", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock)
    const etiqueta = new File(["label"], "label.png", { type: "image/png" })
    const invalidDeclaration = new File(["not pdf"], "declaracao.txt", { type: "text/plain" })
    expect(() => createManualSacShippingRequest({ usuario: "Jair", etiqueta, declaracao: invalidDeclaration }, { canCreate: true, confirmation: { confirmed: true, phrase: "CRIAR SOLICITAÇÃO DE ENVIO" } })).toThrow("PDF válido")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
