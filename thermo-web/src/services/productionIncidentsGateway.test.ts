import { afterEach, describe, expect, it, vi } from "vitest";
import {
  correctProductionIncident,
  createProductionIncident,
  incidentsQuery,
  loadProductionIncidents,
} from "./productionIncidentsGateway";
const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
describe("productionIncidentsGateway", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("preserva filtros e limites do GET", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        response({
          ok: true,
          ocorrencias: [],
          contagens: {},
          limit: 400,
          offset: 0,
        }),
      );
    vi.stubGlobal("fetch", f);
    expect(incidentsQuery("OP 10", "aberta")).toContain("q=OP+10");
    await loadProductionIncidents("OP 10", "aberta");
    expect(f.mock.calls[0]![0]).toContain("status=aberta");
    expect(f.mock.calls[0]![1].method).toBe("GET");
  });
  it("bloqueia abertura antes do upload sem frase exata", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const input = { op_producao_id: 42, falha_detectada: "Trinca detectada" };
    await expect(createProductionIncident(input, "sim")).rejects.toThrow(
      "REGISTRAR OCORRENCIA 42",
    );
    expect(f).not.toHaveBeenCalled();
    f.mockResolvedValue(response({ ok: true, ocorrencia: {} }));
    await createProductionIncident(input, "REGISTRAR OCORRENCIA 42");
    expect(f.mock.calls[0]![0]).toBe("/api/qualidade/ri-check/niq");
    expect(f.mock.calls[0]![1].body).toBeInstanceOf(FormData);
  });
  it("protege a correção por confirmação forte", async () => {
    const f = vi.fn().mockResolvedValue(response({ ok: true, ocorrencia: {} }));
    vi.stubGlobal("fetch", f);
    await expect(correctProductionIncident(7, "CORRIGIR")).rejects.toThrow(
      "CORRIGIR OCORRENCIA 7",
    );
    expect(f).not.toHaveBeenCalled();
    await correctProductionIncident(7, "CORRIGIR OCORRENCIA 7");
    expect(f.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ method: "PATCH", body: "{}" }),
    );
  });
});
