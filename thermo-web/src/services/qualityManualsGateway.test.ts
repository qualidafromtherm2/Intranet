import { beforeEach, describe, expect, it, vi } from "vitest";
import { linkProduct, loadMainManuals, masterFileUrl, unlinkProduct, uploadMasterRevision } from "./qualityManualsGateway";
describe("qualityManualsGateway", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("reads main manuals with session credentials", async () => { const fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({ok:true,itens:[]}),{status:200})); await loadMainManuals(); expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/qualidade/manuais-principais"),expect.objectContaining({credentials:"include"})); });
  it("blocks product mutations unless the exact phrase matches", () => { const fetcher=vi.spyOn(globalThis,"fetch"); expect(() => linkProduct(7,"ABC","yes")).toThrow("VINCULAR PRODUTO ABC AO MANUAL 7"); expect(() => unlinkProduct(7,"ABC","")).toThrow("REMOVER PRODUTO ABC DO MANUAL 7"); expect(fetcher).not.toHaveBeenCalled(); });
  it("uses the real link contract after strong confirmation", async () => { const fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({ok:true}),{status:200})); await linkProduct(7,"ABC","VINCULAR PRODUTO ABC AO MANUAL 7"); expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/manuais-chatbot/7/produtos"),expect.objectContaining({method:"POST",body:JSON.stringify({codigo_produto:"ABC"})})); });
  it("blocks upload before network and builds preview/history URLs", () => { const fetcher=vi.spyOn(globalThis,"fetch"); expect(() => uploadMasterRevision(4,new File(["x"],"a.pdf"),"rev","")).toThrow("ENVIAR REVISAO 4"); expect(fetcher).not.toHaveBeenCalled(); expect(masterFileUrl(4,true)).toContain("preview=1"); expect(masterFileUrl(4,false,9)).toContain("historico_id=9"); });
});
