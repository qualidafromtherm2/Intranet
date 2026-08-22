import { beforeEach, expect, it, vi } from "vitest";
import {
  loadFtibrReadings,
  loadMachineHistory,
  loadTestDetail,
  loadTestReports,
  loadTestsSummary,
} from "./productionTestsGateway";
const response = (x: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(x)),
  } as Response);
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => response({ ok: true })),
  ),
);
it("preserves all read-only endpoint contracts", async () => {
  await loadTestsSummary();
  await loadTestReports({ q: "OP 1", modelo: "FTI", linha: "L1", limit: 80 });
  await loadTestDetail(4);
  await loadFtibrReadings(4);
  await loadMachineHistory("FTI 145");
  expect(vi.mocked(fetch).mock.calls.map((x) => x[0])).toEqual([
    "/api/testes/resumo",
    "/api/testes/relatorios?q=OP+1&modelo=FTI&linha=L1&limit=80",
    "/api/testes/relatorios/4",
    "/api/testes/relatorios/4/ftibr",
    "/api/testes/maquinas/FTI%20145",
  ]);
  for (const [, init] of vi.mocked(fetch).mock.calls)
    expect(init).not.toHaveProperty("method");
});
it("validates identifiers before any request", () => {
  expect(() => loadTestDetail(0)).toThrow("ID inválido");
  expect(() => loadMachineHistory(" ")).toThrow("Modelo obrigatório");
  expect(fetch).not.toHaveBeenCalled();
});
