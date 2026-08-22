import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { SacShippingRequestScreen } from "./SacShippingRequestScreen"

const response = (body: unknown) => ({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) }) as Response
beforeEach(() => vi.unstubAllGlobals())

it("does no reads without navigation permission", () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock)
  render(<SacShippingRequestScreen allowed={false} />)
  expect(screen.getByRole("alert")).toHaveTextContent("Acesso não permitido")
  expect(fetchMock).not.toHaveBeenCalled()
})

it("renders requests, items, destination, separation, attachments and conservative actions", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ok: true, rows: [{ id: 7, usuario: "Jair", created_at: "2026-08-21T10:00:00Z", observacao: "Cliente final", metodo_envio: "Envio via Correios", numero_sep: "SEP-1007", sep_status: "Em Separação", identificacao: "AB123456789BR", rastreio_status: "Pendente", conteudo: JSON.stringify([{ conteudo: "Válvula", quantidade: 2 }]), etiqueta_url: "https://files.test/label.pdf", declaracao_url: "https://files.test/declaration.pdf" }] })))
  render(<SacShippingRequestScreen />)
  expect(await screen.findByText("Envio #7")).toBeInTheDocument()
  expect(screen.getByText("Válvula")).toBeInTheDocument()
  expect(screen.getByText(/Envio via Correios/)).toBeInTheDocument()
  expect(screen.getByText("SEP: Em Separação")).toBeInTheDocument()
  expect(screen.getByRole("link", { name: /Abrir etiqueta/ })).toHaveAttribute("href", "https://files.test/label.pdf")
  expect(screen.getByText(/Modo somente consulta/)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Marcar enviado" })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Nova solicitação" })).toBeDisabled()
})

it("requires the exact strong confirmation before a logistical mutation", async () => {
  const fetchMock = vi.fn().mockResolvedValue(response({ ok: true, rows: [{ id: 9, rastreio_status: "Pendente", conteudo: "[]" }] }))
  vi.stubGlobal("fetch", fetchMock)
  render(<SacShippingRequestScreen canWrite />)
  fireEvent.click(await screen.findByRole("button", { name: "Marcar enviado" }))
  const confirm = screen.getByRole("button", { name: "Confirmar" })
  expect(confirm).toBeDisabled()
  fireEvent.change(screen.getByLabelText("Frase de confirmação"), { target: { value: "MARCAR ENVIO 9 COMO ENVIADO" } })
  expect(confirm).toBeEnabled()
  fireEvent.click(confirm)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sac/solicitacoes/9/status", expect.objectContaining({ method: "PATCH" })))
})
