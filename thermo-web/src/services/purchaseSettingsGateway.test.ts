import { beforeEach, expect, it, vi } from "vitest";
import {
  createPurchaseSetting,
  deletePurchaseSetting,
  loadPurchaseSettings,
  renamePurchaseSetting,
} from "./purchaseSettingsGateway";
const response = (x: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(x)),
  } as Response);
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
it("loads the complete hierarchy contract", async () => {
  vi.mocked(fetch).mockImplementationOnce(() =>
    response({ ok: true, departamentos: [] }),
  );
  await loadPurchaseSettings();
  expect(fetch).toHaveBeenCalledWith(
    "/api/compras/departamentos-categorias",
    expect.objectContaining({ credentials: "include" }),
  );
});
it("blocks all writes by default and before fetch", () => {
  expect(() =>
    createPurchaseSetting("departamento", null, "PCP", {
      canWrite: false,
      confirmation: { confirmed: true, phrase: "SALVAR CONFIGURAÇÃO" },
    }),
  ).toThrow("não autorizada");
  expect(() =>
    renamePurchaseSetting("categoria", 1, "Nova", {
      canWrite: true,
      confirmation: { confirmed: true, phrase: "errada" },
    }),
  ).toThrow("Confirmação forte");
  expect(() =>
    deletePurchaseSetting("subitem", 1, {
      canWrite: true,
      confirmation: { confirmed: false, phrase: "EXCLUIR CONFIGURAÇÃO" },
    }),
  ).toThrow("Confirmação forte");
  expect(fetch).not.toHaveBeenCalled();
});
it("preserves create update and delete endpoints", async () => {
  vi.mocked(fetch).mockImplementation(() => response({ ok: true }));
  await createPurchaseSetting("categoria", 4, "Elétrica", {
    canWrite: true,
    confirmation: { confirmed: true, phrase: "SALVAR CONFIGURAÇÃO" },
  });
  await renamePurchaseSetting("subitem", 9, "Cabos", {
    canWrite: true,
    confirmation: { confirmed: true, phrase: "RENOMEAR CONFIGURAÇÃO" },
  });
  await deletePurchaseSetting("departamento", 2, {
    canWrite: true,
    confirmation: { confirmed: true, phrase: "EXCLUIR CONFIGURAÇÃO" },
  });
  expect(
    vi
      .mocked(fetch)
      .mock.calls.map((x) => [x[0], (x[1] as RequestInit).method]),
  ).toEqual([
    ["/api/compras/departamentos/4/categorias", "POST"],
    ["/api/compras/subitens-departamento/9", "PUT"],
    ["/api/compras/departamentos/2", "DELETE"],
  ]);
});
