import { beforeEach, expect, it, vi } from "vitest";
import {
  createRedAreaEntry,
  decideRedAreaItem,
  loadRedArea,
  submitRedAreaAnalysis,
} from "./redAreaGateway";
const response = (x: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(x)),
  } as Response);
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
it("loads the mixed PIR and NIQ queue", async () => {
  vi.mocked(fetch).mockImplementationOnce(() =>
    response({ ok: true, itens: [] }),
  );
  await loadRedArea("OP 1");
  expect(fetch).toHaveBeenCalledWith(
    "/api/engenharia/produto-aprovacao?status=reprovado&q=OP+1",
    expect.objectContaining({ credentials: "include" }),
  );
});
it("blocks every write without canWrite and confirmation before fetch", () => {
  const entry = {
    codigo: "A",
    quantidade: 1,
    descricao_falha: "Falha",
    local_origem_codigo: "3",
    fotos: [],
    videos: [],
  };
  expect(() =>
    createRedAreaEntry(entry, {
      canWrite: false,
      confirmation: {
        confirmed: true,
        phrase: "TRANSFERIR PARA ÁREA VERMELHA",
      },
    }),
  ).toThrow("não autorizada");
  expect(() =>
    submitRedAreaAnalysis(
      1,
      { analise_por: "qa", fotos: [], videos: [] },
      { canWrite: true, confirmation: { confirmed: true, phrase: "errada" } },
    ),
  ).toThrow("Confirmação forte");
  expect(() =>
    decideRedAreaItem(1, "scrap", {
      canWrite: true,
      confirmation: { confirmed: false, phrase: "CONFIRMAR SCRAP" },
    }),
  ).toThrow("Confirmação forte");
  expect(fetch).not.toHaveBeenCalled();
});
it("preserves exact confirmed decision payload", async () => {
  vi.mocked(fetch).mockImplementationOnce(() =>
    response({ ok: true, niq: {} }),
  );
  await decideRedAreaItem(7, "scrap", {
    canWrite: true,
    confirmation: { confirmed: true, phrase: "CONFIRMAR SCRAP" },
  });
  expect(fetch).toHaveBeenCalledWith(
    "/api/engenharia/niq-area-vermelha/7/decisao",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ acao: "scrap" }),
    }),
  );
});
it("preserves confirmed multipart entry and analysis contracts", async () => {
  vi.mocked(fetch).mockImplementation(() => response({ ok: true, niq: {} }));
  await createRedAreaEntry(
    {
      codigo: "A",
      codigo_produto: "1",
      descricao: "Produto",
      quantidade: 2,
      descricao_falha: "Falha",
      produto_grupo: "Área vermelha",
      numero_op: "OP-1",
      local_origem_codigo: "10431538872",
      fotos: [],
      videos: [],
    },
    {
      canWrite: true,
      confirmation: {
        confirmed: true,
        phrase: "TRANSFERIR PARA ÁREA VERMELHA",
      },
    },
  );
  await submitRedAreaAnalysis(
    9,
    { analise_por: "qa", analise_obs: "Revisado", fotos: [], videos: [] },
    {
      canWrite: true,
      confirmation: { confirmed: true, phrase: "ENVIAR ANÁLISE" },
    },
  );
  expect(fetch).toHaveBeenNthCalledWith(
    1,
    "/api/engenharia/niq-area-vermelha",
    expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
  );
  expect(fetch).toHaveBeenNthCalledWith(
    2,
    "/api/engenharia/niq-area-vermelha/9/analise",
    expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
  );
});
