import { beforeEach, expect, it, vi } from "vitest";
import {
  finishPreparation,
  loadPreparationMaterials,
  loadPreparations,
} from "./preparationsGateway";
const response = (x: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(x)),
  } as Response);
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
it("loads stations, production contracts and filters PP orders", async () => {
  vi.mocked(fetch)
    .mockImplementationOnce(() =>
      response({ success: true, postos: [{ id: 1, nome: "Corte" }] }),
    )
    .mockImplementationOnce(() =>
      response({
        success: true,
        ordens: [
          { id: 1, produto: { identificacao: "03.PP.N.1" } },
          { id: 2, produto: { identificacao: "09.MC.1" } },
        ],
      }),
    )
    .mockImplementationOnce(() => response({ success: true, registros: [] }));
  await expect(loadPreparations()).resolves.toMatchObject({
    orders: [{ id: 1 }],
  });
  expect(vi.mocked(fetch).mock.calls.map((x) => x[0])).toEqual([
    "/api/producao/postos-preparacao",
    "/api/producao/ordens",
    "/api/producao/kanban-programacao",
  ]);
});
it("uses exact material payload and blocks mutation without confirmation", async () => {
  vi.mocked(fetch).mockImplementationOnce(() =>
    response({ ok: true, itens: [], meta: {} }),
  );
  await loadPreparationMaterials("OP-1", "03.PP.1");
  expect(fetch).toHaveBeenCalledWith(
    "/api/preparacao/op/estrutura",
    expect.objectContaining({
      body: JSON.stringify({ op: "OP-1", produtoCodigo: "03.PP.1" }),
    }),
  );
  expect(() =>
    finishPreparation(
      {
        op_producao_id: 1,
        numero_op: "OP-1",
        kanban_programacao_id: 2,
        usuario: "u",
        col_key: "prep-1",
        posto_atual: "Corte",
        proximo_status: "Dobra",
        operacao: "Dobra",
      },
      { confirmed: false },
    ),
  ).toThrow("Confirmação explícita");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("preserves the confirmed production payload", async () => {
  vi.mocked(fetch).mockImplementationOnce(() => response({ success: true }));
  const input = {
    op_producao_id: 1,
    numero_op: "OP-1",
    kanban_programacao_id: 2,
    usuario: "u",
    col_key: "prep-1",
    posto_atual: "Corte",
    proximo_status: "Dobra",
    operacao: "Dobra",
  };
  await finishPreparation(input, { confirmed: true });
  expect(fetch).toHaveBeenCalledWith(
    "/api/producao/finalizar-operacao",
    expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
  );
});
