import type {
  PreparationMaterial,
  PreparationOrder,
  PreparationProgram,
  PreparationSnapshot,
  PreparationStation,
} from "../features/preparations/types";
const base = import.meta.env.VITE_API_BASE_URL || "";
export class PreparationsError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}
async function request<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers,
      credentials: "include",
      cache: "no-store",
    });
  } catch (e) {
    throw new PreparationsError(
      e instanceof Error ? e.message : "Falha de conexão.",
    );
  }
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { error: raw };
  }
  if (!response.ok || data.success === false || data.ok === false)
    throw new PreparationsError(
      typeof data.error === "string"
        ? data.error
        : `Falha HTTP ${response.status}`,
      response.status,
    );
  return data as T;
}
const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });
export async function loadPreparations(): Promise<PreparationSnapshot> {
  const [s, o, p] = await Promise.all([
    request<{ success: true; postos: PreparationStation[] }>(
      "/api/producao/postos-preparacao",
    ),
    request<{ success: true; ordens: PreparationOrder[] }>(
      "/api/producao/ordens",
    ),
    request<{ success: true; registros: PreparationProgram[] }>(
      "/api/producao/kanban-programacao",
    ),
  ]);
  return {
    stations: s.postos || [],
    orders: (o.ordens || []).filter((x) =>
      /(?:^|\.)PP(?:\.|$)/i.test(String(x.produto?.identificacao || "")),
    ),
    programs: p.registros || [],
  };
}
export async function loadPreparationMaterials(
  op: string,
  productCode: string,
) {
  if (!op.trim() || !productCode.trim())
    throw new PreparationsError("OP e produto são obrigatórios.");
  const data = await post<{
    ok: true;
    itens: PreparationMaterial[];
    meta: Record<string, unknown>;
  }>("/api/preparacao/op/estrutura", { op, produtoCodigo: productCode });
  return data;
}
export function finishPreparation(
  input: {
    op_producao_id: number;
    numero_op: string;
    kanban_programacao_id: number | null;
    usuario: string;
    col_key: string;
    posto_atual: string;
    proximo_status: string;
    operacao: string;
  },
  confirmation: { confirmed: boolean },
) {
  if (!confirmation.confirmed)
    throw new PreparationsError("Confirmação explícita obrigatória.");
  if (
    !input.op_producao_id ||
    !input.numero_op ||
    !input.posto_atual ||
    !input.proximo_status
  )
    throw new PreparationsError(
      "OP, posto atual e próximo posto são obrigatórios.",
    );
  return post<{ success: true }>("/api/producao/finalizar-operacao", input);
}
