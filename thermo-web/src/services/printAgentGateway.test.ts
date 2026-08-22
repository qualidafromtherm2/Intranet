import { describe, expect, it, vi } from "vitest";
import { createPrintAgentGateway, type Layout } from "./printAgentGateway";
const res = (d: unknown, ok = true) =>
  Promise.resolve({
    ok,
    status: ok ? 200 : 400,
    json: () => Promise.resolve(d),
  } as Response);
const layout = {
  chave: "impressao",
  nome: "Sistema",
  isProfile: false,
} as Layout;
describe("printAgentGateway", () => {
  it("carrega agentes, configs, layouts e instalador reais", async () => {
    const f = vi
      .fn()
      .mockImplementation((p: string) =>
        res(
          p.includes("agentes-disponiveis")
            ? { agentes: [] }
            : p.includes("/configs")
              ? { configs: [] }
              : p.includes("layout-config")
                ? {
                    layouts: [],
                    layoutTypes: [],
                    sampleDefaults: {},
                    fieldTypes: [],
                  }
                : { url: "x", versao: "3" },
        ),
      );
    const g = createPrintAgentGateway(f);
    await Promise.all([
      g.listAgents(),
      g.listConfigs(),
      g.getLayouts(),
      g.getAgentUrl(),
    ]);
    expect(f.mock.calls.map((x) => x[0])).toEqual([
      "/api/etiquetas/agentes-disponiveis",
      "/api/etiquetas/agente/configs",
      "/api/etiquetas/layout-config",
      "/api/etiquetas/agente-url",
    ]);
  });
  it("preview é permitido sem confirmação", async () => {
    const f = vi.fn().mockReturnValue(res({ ok: true, zpl: "^XA^XZ" }));
    await createPrintAgentGateway(f).preview({ chave: "x" } as never);
    expect(f).toHaveBeenCalledWith(
      "/api/etiquetas/layout-config/preview",
      expect.objectContaining({ method: "POST" }),
    );
  });
  it("bloqueia todas as mutações antes do fetch sem confirmação", () => {
    const f = vi.fn(),
      g = createPrintAgentGateway(f);
    expect(() => g.deleteProfile({ ...layout, isProfile: true })).toThrow(
      "Confirmação obrigatória",
    );
    expect(() =>
      g.testPrint({
        zpl: "^XA^XZ",
        destinoAgente: "PC",
        impressora: "Z",
        perfil: "x",
      }),
    ).toThrow("Confirmação obrigatória");
    expect(f).not.toHaveBeenCalled();
  });
  it("protege preset interno mesmo confirmado", () => {
    const f = vi.fn();
    expect(() =>
      createPrintAgentGateway(f).deleteProfile(layout, true),
    ).toThrow("Presets internos");
    expect(f).not.toHaveBeenCalled();
  });
  it("envia teste sem ID operacional somente após confirmação", async () => {
    const f = vi.fn().mockReturnValue(res({ ok: true, filaId: 9 }));
    const body = {
      zpl: "^XA^XZ",
      destinoAgente: "PC",
      impressora: "Zebra",
      perfil: "x",
    };
    await createPrintAgentGateway(f).testPrint(body, true);
    expect(f).toHaveBeenCalledWith(
      "/api/etiquetas/layout-config/test-print",
      expect.objectContaining({ body: JSON.stringify(body) }),
    );
    expect(JSON.stringify(f.mock.calls)).not.toContain("etq_ids");
  });
});
