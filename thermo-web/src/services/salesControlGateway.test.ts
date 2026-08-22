import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSalesOrderItems, loadSalesOrders } from "./salesControlGateway";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("salesControlGateway", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("consulta pedidos somente com GET autenticado", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ ok: true, rows: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await loadSalesOrders();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sac/vendas/controle/pedidos",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });
  it("codifica o identificador ao consultar detalhes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ ok: true, rows: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await loadSalesOrderItems("PV 42/26");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "/api/sac/vendas/controle/pedido-itens/PV%2042%2F26",
    );
    expect(() => loadSalesOrderItems(" ")).toThrow(/obrigatório/);
  });
  it("propaga erro comercial retornado pelo backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({ ok: false, error: "Sem acesso aos pedidos." }, 403),
        ),
    );
    await expect(loadSalesOrders()).rejects.toThrow("Sem acesso aos pedidos.");
  });
});
