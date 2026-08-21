import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findFirstPieceProduct,
  loadFirstPieceUsers,
  registerFirstPieceDecision,
} from "./firstPieceGateway";

const response = (body: unknown, ok = true) =>
  Promise.resolve({
    ok,
    status: ok ? 200 : 400,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
describe("firstPieceGateway", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  it("uses the proven lookup and user fallback contracts", async () => {
    vi.mocked(fetch)
      .mockImplementationOnce(() =>
        response({ ok: true, codigo_produto: "10", itens: [] }),
      )
      .mockImplementationOnce(() => response({ usuarios: [] }))
      .mockImplementationOnce(() => response([{ username: "qa" }]));
    await findFirstPieceProduct(" A/1 ");
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/primeira-pc-ok/buscar-por-codigo?codigo=A%2F1",
      expect.objectContaining({ credentials: "include" }),
    );
    await expect(loadFirstPieceUsers()).resolves.toEqual([{ username: "qa" }]);
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/api/rh/colaboradores/usuarios",
      expect.anything(),
    );
  });
  it("requires gateway confirmation and exact NOK credentials before writing", async () => {
    const decision = {
      codigo_produto: "10",
      numero_op: "OP-1",
      itens: [{ id: 1, o_que_verificar: "Medida", resultado: "nok" as const }],
      tem_nok: true,
      user_liberacao: "qa",
      senha_liberacao: "secret",
      resolucao: "Desvio aprovado",
    };
    expect(() =>
      registerFirstPieceDecision(decision, { confirmed: false }),
    ).toThrow("Confirmação explícita");
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockImplementationOnce(() =>
      response({ ok: true, registro: {} }),
    );
    await registerFirstPieceDecision(decision, { confirmed: true });
    expect(fetch).toHaveBeenCalledWith(
      "/api/primeira-pc-ok/registrar-verificacao",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(decision),
      }),
    );
  });
});
