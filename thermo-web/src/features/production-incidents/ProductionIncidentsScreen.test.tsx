import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeIncidentAttachments,
  ProductionIncidentsScreen,
} from "./ProductionIncidentsScreen";
const gateway = vi.hoisted(() => ({
  loadProductionIncidents: vi.fn(),
  createProductionIncident: vi.fn(),
  correctProductionIncident: vi.fn(),
}));
vi.mock("../../services/productionIncidentsGateway", () => gateway);
const rows = [
  {
    id: 7,
    op_iapp_id: 42,
    numero_op: "OP-42",
    codigo_produto: "P1",
    falha_detectada: "Trinca",
    usuario: "ana",
    created_at: "2026-08-21T10:00:00",
    corrigido: false,
    anexos: [{ url: "/foto.jpg", tipo: "foto", nome: "Evidência" }],
  },
  {
    id: 8,
    op_iapp_id: 43,
    falha_detectada: "Medida",
    corrigido: true,
    corrigido_por: "jair",
  },
];
describe("ProductionIncidentsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gateway.loadProductionIncidents.mockResolvedValue({
      ok: true,
      ocorrencias: rows,
      contagens: { total: 2, aberta: 1, corrigida: 1 },
      limit: 400,
      offset: 0,
    });
  });
  it("bloqueia sem permissão", () => {
    render(<ProductionIncidentsScreen allowed={false} />);
    expect(screen.getByText(/side:producao:ocorrencias/)).toBeInTheDocument();
    expect(gateway.loadProductionIncidents).not.toHaveBeenCalled();
  });
  it("exibe estados, autor e evidência reais", async () => {
    render(<ProductionIncidentsScreen />);
    expect(await screen.findByText("Trinca")).toBeInTheDocument();
    expect(screen.getByText(/Registrado por ana/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Evidência/ })).toHaveAttribute(
      "href",
      "/foto.jpg",
    );
    expect(screen.getByText("Corrigida")).toBeInTheDocument();
  });
  it("abre escrita somente com permissão e exige frase", async () => {
    const user = userEvent.setup();
    render(<ProductionIncidentsScreen canWrite />);
    await screen.findByText("Trinca");
    await user.click(
      screen.getByRole("button", { name: "Marcar como corrigida" }),
    );
    expect(
      screen.getByRole("button", { name: "Confirmar correção" }),
    ).toBeDisabled();
    expect(gateway.correctProductionIncident).not.toHaveBeenCalled();
  });
  it("normaliza JSON e fallbacks legados", () => {
    expect(
      normalizeIncidentAttachments({
        id: 1,
        falha_detectada: "x",
        anexos: '[{"url":"/a.pdf"}]',
      }),
    ).toHaveLength(1);
    expect(
      normalizeIncidentAttachments({
        id: 1,
        falha_detectada: "x",
        foto: "/f.jpg",
        video: "/v.mp4",
      }),
    ).toHaveLength(2);
  });
});
