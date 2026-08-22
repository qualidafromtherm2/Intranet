import type {
  TestDetail,
  TestReading,
  TestReport,
  TestSummary,
} from "../features/production-tests/types";
const base = import.meta.env.VITE_API_BASE_URL || "";
export class ProductionTestsError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}
async function get<T>(path: string) {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    throw new ProductionTestsError(
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
    throw new ProductionTestsError(
      typeof data.error === "string"
        ? data.error
        : `Falha HTTP ${response.status}`,
      response.status,
    );
  return data as T;
}
export function loadTestsSummary() {
  return get<TestSummary & { ok: true }>("/api/testes/resumo");
}
export function loadTestReports(
  filters: { q?: string; modelo?: string; linha?: string; limit?: number } = {},
) {
  const p = new URLSearchParams();
  if (filters.q?.trim()) p.set("q", filters.q.trim());
  if (filters.modelo) p.set("modelo", filters.modelo);
  if (filters.linha) p.set("linha", filters.linha);
  p.set("limit", String(filters.limit || 100));
  return get<{ ok: true; relatorios: TestReport[] }>(
    `/api/testes/relatorios?${p}`,
  );
}
export function loadTestDetail(id: number) {
  if (!Number.isInteger(id) || id < 1)
    throw new ProductionTestsError("ID inválido.");
  return get<TestDetail & { ok: true }>(`/api/testes/relatorios/${id}`);
}
export function loadFtibrReadings(id: number) {
  if (!Number.isInteger(id) || id < 1)
    throw new ProductionTestsError("ID inválido.");
  return get<{
    ok: true;
    relatorio: TestReport;
    leituras_ftibr: TestReading[];
  }>(`/api/testes/relatorios/${id}/ftibr`);
}
export function loadMachineHistory(model: string) {
  if (!model.trim()) throw new ProductionTestsError("Modelo obrigatório.");
  return get<{
    ok: true;
    modelo: string;
    spec?: Record<string, unknown>;
    relatorios: TestReport[];
  }>(`/api/testes/maquinas/${encodeURIComponent(model.trim())}`);
}
