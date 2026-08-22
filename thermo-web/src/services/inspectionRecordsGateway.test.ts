import { beforeEach, expect, it, vi } from "vitest";
import {
  loadInspectionQueue,
  prepareInspection,
  registerAndReleaseInspection,
  registerOccurrence,
} from "./inspectionRecordsGateway";
const response = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
it("uses the proven read contracts", async () => {
  vi.mocked(fetch).mockImplementation(() =>
    response({ ok: true, pendentes: [], total: 0 }),
  );
  await loadInspectionQueue();
  expect(fetch).toHaveBeenCalledWith(
    "/api/qualidade/ri-check/pendentes",
    expect.anything(),
  );
  vi.mocked(fetch).mockImplementation(() =>
    response({ ok: true, ri_ativo: true, verificacoes: [], ocorrencias: [] }),
  );
  await prepareInspection({
    op_producao_id: 1,
    op_iapp_id: 1,
    numero_op: "OP1",
    codigo: "A",
    descricao: "D",
    kanban_local: "Teste",
  });
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/qualidade/ri-check/preparar",
    expect.objectContaining({ method: "POST" }),
  );
});
it("requires confirmation before release or upload", async () => {
  const input = {
    op_producao_id: 1,
    op_iapp_id: 1,
    numero_op: "OP1",
    codigo: "A",
    descricao: "D",
    kanban_local: "Teste",
  };
  await expect(
    registerAndReleaseInspection(input, 3, { confirmed: false }),
  ).rejects.toThrow("Confirmação explícita");
  expect(() =>
    registerOccurrence(3, "Falha", [], { confirmed: false }),
  ).toThrow("Confirmação explícita");
  expect(fetch).not.toHaveBeenCalled();
});
it("preserves open-save-release sequence", async () => {
  vi.mocked(fetch)
    .mockImplementationOnce(() =>
      response({
        ok: true,
        ri_ativo: true,
        check: { id: 9 },
        verificacoes: [],
        ocorrencias: [],
      }),
    )
    .mockImplementation(() => response({ ok: true }));
  await registerAndReleaseInspection(
    {
      op_producao_id: 1,
      op_iapp_id: 1,
      numero_op: "OP1",
      codigo: "A",
      descricao: "D",
      kanban_local: "Teste",
    },
    null,
    { confirmed: true },
  );
  expect(vi.mocked(fetch).mock.calls.map((x) => x[0])).toEqual([
    "/api/qualidade/ri-check/abrir",
    "/api/qualidade/ri-check/9/salvar",
    "/api/qualidade/ri-check/9/liberar",
  ]);
});
