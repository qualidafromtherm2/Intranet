import type {
  RedAreaAnalysis,
  RedAreaDecision,
  RedAreaEntry,
  RedAreaItem,
  RedAreaProduct,
} from "../features/red-area/types";
const base = import.meta.env.VITE_API_BASE_URL || "";
export class RedAreaError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}
async function request<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && typeof init.body === "string")
    headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers,
      credentials: "include",
      cache: "no-store",
    });
  } catch (e) {
    throw new RedAreaError(
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
  if (!response.ok || data.ok === false)
    throw new RedAreaError(
      typeof data.error === "string"
        ? data.error
        : `Falha HTTP ${response.status}`,
      response.status,
    );
  return data as T;
}
function authorize(
  canWrite: boolean,
  confirmation: { confirmed: boolean; phrase: string },
  phrase: string,
) {
  if (!canWrite)
    throw new RedAreaError("Escrita não autorizada para este perfil.");
  if (!confirmation.confirmed || confirmation.phrase.trim() !== phrase)
    throw new RedAreaError(`Confirmação forte obrigatória: ${phrase}`);
}
export async function loadRedArea(query = "") {
  const p = new URLSearchParams({ status: "reprovado" });
  if (query.trim()) p.set("q", query.trim());
  return request<{ ok: true; itens: RedAreaItem[] }>(
    `/api/engenharia/produto-aprovacao?${p}`,
  );
}
export async function searchRedAreaProducts(query: string) {
  if (query.trim().length < 2) return [];
  const data = await request<{ produtos?: RedAreaProduct[] }>(
    `/api/produtos/search?q=${encodeURIComponent(query.trim())}&limit=15`,
  );
  return data.produtos || [];
}
export async function loadRedAreaLocations() {
  return request<{
    locais?: Array<{
      codigo?: string;
      local_codigo?: string;
      descricao?: string;
      nome?: string;
    }>;
  }>("/api/armazem/locais?fonte=db");
}
export async function loadRedAreaUsers() {
  const data = await request<{ users?: string[] }>("/api/users/ativos");
  return data.users || [];
}
export function createRedAreaEntry(
  input: RedAreaEntry,
  guard: {
    canWrite: boolean;
    confirmation: { confirmed: boolean; phrase: string };
  },
) {
  authorize(
    guard.canWrite,
    guard.confirmation,
    "TRANSFERIR PARA ÁREA VERMELHA",
  );
  if (
    !input.codigo.trim() ||
    !input.descricao_falha.trim() ||
    !Number.isFinite(input.quantidade) ||
    input.quantidade <= 0 ||
    !input.local_origem_codigo.trim()
  )
    throw new RedAreaError(
      "Produto, quantidade, falha e origem são obrigatórios.",
    );
  const fd = new FormData();
  fd.set("codigo", input.codigo);
  if (input.codigo_produto) fd.set("codigo_produto", input.codigo_produto);
  if (input.descricao) fd.set("descricao", input.descricao);
  fd.set("quantidade", String(input.quantidade));
  fd.set("descricao_falha", input.descricao_falha.trim());
  fd.set("produto_grupo", input.produto_grupo || "Área vermelha");
  if (input.op_producao_id)
    fd.set("op_producao_id", String(input.op_producao_id));
  fd.set("numero_op", input.numero_op || "");
  fd.set("local_origem_codigo", input.local_origem_codigo);
  input.fotos.forEach((x) => fd.append("foto", x));
  input.videos.forEach((x) => fd.append("video", x));
  return request<{ ok: true; niq: RedAreaItem }>(
    "/api/engenharia/niq-area-vermelha",
    { method: "POST", body: fd },
  );
}
export function submitRedAreaAnalysis(
  id: number,
  input: RedAreaAnalysis,
  guard: {
    canWrite: boolean;
    confirmation: { confirmed: boolean; phrase: string };
  },
) {
  authorize(guard.canWrite, guard.confirmation, "ENVIAR ANÁLISE");
  if (!id || !input.analise_por.trim())
    throw new RedAreaError("NIQ e responsável pela análise são obrigatórios.");
  const fd = new FormData();
  fd.set("analise_por", input.analise_por.trim());
  fd.set("analise_obs", input.analise_obs?.trim() || "");
  input.fotos.forEach((x) => fd.append("foto", x));
  input.videos.forEach((x) => fd.append("video", x));
  return request<{ ok: true; niq: RedAreaItem }>(
    `/api/engenharia/niq-area-vermelha/${id}/analise`,
    { method: "POST", body: fd },
  );
}
export function decideRedAreaItem(
  id: number,
  decision: RedAreaDecision,
  guard: {
    canWrite: boolean;
    confirmation: { confirmed: boolean; phrase: string };
  },
) {
  const phrases: Record<RedAreaDecision, string> = {
    scrap: "CONFIRMAR SCRAP",
    retrabalho: "CONFIRMAR RETRABALHO",
    liberar: "CONFIRMAR LIBERAÇÃO",
  };
  authorize(guard.canWrite, guard.confirmation, phrases[decision]);
  if (!id) throw new RedAreaError("NIQ inválida.");
  return request<{ ok: true; niq: RedAreaItem }>(
    `/api/engenharia/niq-area-vermelha/${id}/decisao`,
    { method: "POST", body: JSON.stringify({ acao: decision }) },
  );
}
