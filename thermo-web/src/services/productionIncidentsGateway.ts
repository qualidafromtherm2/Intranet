import type {
  CreateIncidentInput,
  IncidentListResponse,
  IncidentStatusFilter,
  ProductionIncident,
} from "../features/production-incidents/types";

async function parse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & {
    ok?: boolean;
    error?: string;
  };
  if (!response.ok || payload.ok === false)
    throw new Error(payload.error || `Falha HTTP ${response.status}.`);
  return payload;
}
function confirmExact(actual: string, expected: string) {
  if (actual !== expected)
    throw new Error(`Confirmação inválida. Digite ${expected}.`);
}

export function incidentsQuery(
  query = "",
  status: IncidentStatusFilter = "",
  limit = 400,
  offset = 0,
) {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (status) params.set("status", status);
  params.set("limit", String(Math.min(Math.max(limit, 1), 1000)));
  params.set("offset", String(Math.max(offset, 0)));
  return params.toString();
}
export async function loadProductionIncidents(
  query = "",
  status: IncidentStatusFilter = "",
  signal?: AbortSignal,
) {
  return parse<IncidentListResponse>(
    await fetch(
      `/api/qualidade/ri-check/ocorrencias?${incidentsQuery(query, status)}`,
      {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        signal,
        headers: { Accept: "application/json" },
      },
    ),
  );
}
export async function createProductionIncident(
  input: CreateIncidentInput,
  confirmation: string,
) {
  if (!Number.isInteger(input.op_producao_id) || input.op_producao_id <= 0)
    throw new Error("OP obrigatória.");
  if (!input.falha_detectada.trim())
    throw new Error("Informe a falha detectada.");
  confirmExact(confirmation, `REGISTRAR OCORRENCIA ${input.op_producao_id}`);
  const form = new FormData();
  form.set("op_producao_id", String(input.op_producao_id));
  form.set("falha_detectada", input.falha_detectada.trim());
  if (input.numero_op?.trim()) form.set("numero_op", input.numero_op.trim());
  if (input.codigo?.trim()) form.set("codigo", input.codigo.trim());
  if (input.codigo_produto)
    form.set("codigo_produto", String(input.codigo_produto));
  for (const file of input.arquivos || []) form.append("arquivos", file);
  return parse<{ ok: true; ocorrencia: ProductionIncident }>(
    await fetch("/api/qualidade/ri-check/niq", {
      method: "POST",
      credentials: "include",
      body: form,
    }),
  );
}
export async function correctProductionIncident(
  id: number,
  confirmation: string,
) {
  if (!Number.isInteger(id) || id <= 0) throw new Error("Ocorrência inválida.");
  confirmExact(confirmation, `CORRIGIR OCORRENCIA ${id}`);
  return parse<{
    ok: true;
    ocorrencia: ProductionIncident;
    ja_corrigida?: boolean;
  }>(
    await fetch(`/api/qualidade/ri-check/niq/${id}/corrigir`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
  );
}
