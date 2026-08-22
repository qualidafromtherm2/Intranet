export type Agent = {
  pcName: string;
  printers: string[];
  printerAliases: Record<string, string>;
  version?: string | null;
  online: boolean;
};
export type Field = {
  id: string;
  tipo: "texto" | "bloco" | "texto_rot" | "qr";
  orientacao?: "N" | "R" | "I" | "B";
  x: number;
  y: number;
  fonteH?: number;
  fonteW?: number;
  magnificacao?: number;
  conteudo: string;
};
export type Layout = {
  chave: string;
  nome: string;
  labelWidth: number;
  labelHeight: number;
  darkness: number;
  speed: number;
  offsetX: number;
  offsetY: number;
  dpi: number;
  zplTemplate: string | null;
  campos: Field[];
  amostra: Record<string, string>;
  tipoBase: string;
  isProfile: boolean;
  ativo: boolean;
  placeholders: string[];
  atualizadoEm?: string;
  atualizadoPor?: string | null;
};
export type LayoutMeta = {
  layouts: Layout[];
  layoutTypes: Array<{
    chave: string;
    nome: string;
    vinculoImpressora: boolean;
  }>;
  sampleDefaults: Record<string, string>;
  fieldTypes: Array<{ value: Field["tipo"]; label: string }>;
};
export type AgentConfig = {
  pcName: string;
  printer: string;
  labelWidth: number;
  labelHeight: number;
  darkness: number;
  speed: number;
  labelOffsetX: number;
  labelOffsetY: number;
  pollInterval: number;
  printerConfigs: Record<
    string,
    { layoutProfile?: string; layoutProfiles?: Record<string, string> }
  >;
  printerAliases: Record<string, string>;
  serverUrl: string;
  lastSeen?: string | null;
  version?: string | null;
  printersOnline?: string[];
};
export type LayoutDraft = Pick<
  Layout,
  | "chave"
  | "nome"
  | "labelWidth"
  | "labelHeight"
  | "darkness"
  | "speed"
  | "offsetX"
  | "offsetY"
  | "dpi"
  | "zplTemplate"
  | "campos"
  | "amostra"
>;
type Fetcher = typeof fetch;
async function req<T>(f: Fetcher, p: string, i?: RequestInit) {
  const r = await f(p, { credentials: "include", ...i });
  const d = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(
      new Error((d as { error?: string }).error || `Falha (${r.status})`),
      { status: r.status },
    );
  return d as T;
}
const json = (b: unknown) => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(b),
});
const confirmed = (v: true | undefined) => {
  if (v !== true)
    throw new Error(
      "Confirmação obrigatória para alterar configurações ou imprimir.",
    );
};
export function createPrintAgentGateway(f: Fetcher = fetch) {
  return {
    listAgents: () =>
      req<{ ok: true; agentes: Agent[] }>(
        f,
        "/api/etiquetas/agentes-disponiveis",
      ).then((x) => x.agentes || []),
    listConfigs: () =>
      req<{ ok: true; configs: AgentConfig[] }>(
        f,
        "/api/etiquetas/agente/configs",
      ).then((x) => x.configs || []),
    getLayouts: () =>
      req<{ ok: true } & LayoutMeta>(f, "/api/etiquetas/layout-config"),
    getAgentUrl: () =>
      req<{ ok: true; url: string; versao: string }>(
        f,
        "/api/etiquetas/agente-url",
      ),
    preview: (draft: LayoutDraft) =>
      req<{
        ok: true;
        zpl: string;
        imageBase64: string;
        widthMm: number;
        heightMm: number;
      }>(f, "/api/etiquetas/layout-config/preview", {
        method: "POST",
        ...json(draft),
      }),
    createProfile: (
      body: {
        nome: string;
        cloneFrom: string;
        labelWidth: number;
        labelHeight: number;
      },
      confirm?: true,
    ) => {
      confirmed(confirm);
      return req<{ ok: true; layout: Layout }>(
        f,
        "/api/etiquetas/layout-config",
        { method: "POST", ...json(body) },
      );
    },
    saveLayout: (draft: LayoutDraft, confirm?: true) => {
      confirmed(confirm);
      return req<{ ok: true; layout: Layout }>(
        f,
        `/api/etiquetas/layout-config/${encodeURIComponent(draft.chave)}`,
        { method: "PUT", ...json(draft) },
      );
    },
    deleteProfile: (layout: Layout, confirm?: true) => {
      confirmed(confirm);
      if (!layout.isProfile)
        throw new Error("Presets internos do sistema não podem ser excluídos.");
      return req<{ ok: true }>(
        f,
        `/api/etiquetas/layout-config/${encodeURIComponent(layout.chave)}`,
        { method: "DELETE" },
      );
    },
    testPrint: (
      body: {
        zpl: string;
        destinoAgente: string;
        impressora: string;
        perfil: string;
      },
      confirm?: true,
    ) => {
      confirmed(confirm);
      if (!body.impressora || !body.destinoAgente)
        throw new Error("Escolha agente e impressora para o teste.");
      return req<{ ok: true; filaId: number }>(
        f,
        "/api/etiquetas/layout-config/test-print",
        { method: "POST", ...json(body) },
      );
    },
    saveAgentConfig: (config: AgentConfig, confirm?: true) => {
      confirmed(confirm);
      return req<{ ok: true; config: AgentConfig }>(
        f,
        `/api/etiquetas/agente/config/${encodeURIComponent(config.pcName)}`,
        { method: "PUT", ...json(config) },
      );
    },
    saveUserPrinters: (
      body: { usuario: string; padrao: string | null; enabled: string[] },
      confirm?: true,
    ) => {
      confirmed(confirm);
      return req<{ ok: true }>(f, "/api/etiquetas/usuario-impressoras", {
        method: "PUT",
        ...json(body),
      });
    },
  };
}
export const printAgentGateway = createPrintAgentGateway();
