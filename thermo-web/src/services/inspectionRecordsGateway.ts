import type {
  InspectionDetail,
  InspectionPending,
  InspectionPrepareInput,
} from "../features/inspection-records/types";
const base = import.meta.env.VITE_API_BASE_URL || "";
export class InspectionRecordsError extends Error {
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
    throw new InspectionRecordsError(
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
    throw new InspectionRecordsError(
      typeof data.error === "string"
        ? data.error
        : `Falha HTTP ${response.status}`,
      response.status,
    );
  return data as T;
}
const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });
export async function loadInspectionQueue() {
  return request<{ ok: true; pendentes: InspectionPending[]; total: number }>(
    "/api/qualidade/ri-check/pendentes",
  );
}
export function prepareInspection(input: InspectionPrepareInput) {
  return post<InspectionDetail>("/api/qualidade/ri-check/preparar", input);
}
export async function registerAndReleaseInspection(
  input: InspectionPrepareInput,
  existingId: number | null,
  confirmation: { confirmed: boolean },
) {
  if (!confirmation.confirmed)
    throw new InspectionRecordsError("Confirmação explícita obrigatória.");
  let id = existingId;
  if (!id) {
    const opened = await post<InspectionDetail>(
      "/api/qualidade/ri-check/abrir",
      input,
    );
    id = opened.check?.id || null;
  }
  if (!id) throw new InspectionRecordsError("RI não pôde ser aberta.");
  await post<InspectionDetail>(`/api/qualidade/ri-check/${id}/salvar`, {
    kanban_local: input.kanban_local,
  });
  return post<InspectionDetail>(`/api/qualidade/ri-check/${id}/liberar`, {
    kanban_origem: input.kanban_local,
    op_producao_id: input.op_producao_id,
    numero_op: input.numero_op,
  });
}
export function registerOccurrence(
  checkId: number,
  failure: string,
  files: File[],
  confirmation: { confirmed: boolean },
) {
  if (!confirmation.confirmed)
    throw new InspectionRecordsError("Confirmação explícita obrigatória.");
  if (!failure.trim())
    throw new InspectionRecordsError("Informe a falha detectada.");
  const body = new FormData();
  body.set("falha_detectada", failure.trim());
  files.forEach((file) => body.append("arquivos", file));
  return request<{ ok: true; ocorrencia: unknown }>(
    `/api/qualidade/ri-check/${checkId}/niq`,
    { method: "POST", body },
  );
}
