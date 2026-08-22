import type {
  PurchaseDepartment,
  PurchaseSettingKind,
} from "../features/purchase-settings/types";
const base = import.meta.env.VITE_API_BASE_URL || "";
export class PurchaseSettingsError extends Error {
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
    throw new PurchaseSettingsError(
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
    throw new PurchaseSettingsError(
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
    throw new PurchaseSettingsError("Escrita não autorizada para este perfil.");
  if (!confirmation.confirmed || confirmation.phrase.trim() !== phrase)
    throw new PurchaseSettingsError(`Confirmação forte obrigatória: ${phrase}`);
}
export async function loadPurchaseSettings() {
  return request<{ ok: true; departamentos: PurchaseDepartment[] }>(
    "/api/compras/departamentos-categorias",
  );
}
export function createPurchaseSetting(
  kind: PurchaseSettingKind,
  parentId: number | null,
  name: string,
  guard: {
    canWrite: boolean;
    confirmation: { confirmed: boolean; phrase: string };
  },
) {
  authorize(guard.canWrite, guard.confirmation, "SALVAR CONFIGURAÇÃO");
  const nome = name.trim();
  if (!nome) throw new PurchaseSettingsError("Nome obrigatório.");
  if (kind !== "departamento" && !parentId)
    throw new PurchaseSettingsError("Registro pai obrigatório.");
  const path =
    kind === "departamento"
      ? "/api/compras/departamentos"
      : kind === "categoria"
        ? `/api/compras/departamentos/${parentId}/categorias`
        : `/api/compras/categorias-departamento/${parentId}/subitens`;
  return request<{ ok: true }>(path, {
    method: "POST",
    body: JSON.stringify({ nome }),
  });
}
export function renamePurchaseSetting(
  kind: PurchaseSettingKind,
  id: number,
  name: string,
  guard: {
    canWrite: boolean;
    confirmation: { confirmed: boolean; phrase: string };
  },
) {
  authorize(guard.canWrite, guard.confirmation, "RENOMEAR CONFIGURAÇÃO");
  const nome = name.trim();
  if (!id || !nome)
    throw new PurchaseSettingsError("ID e nome são obrigatórios.");
  const root =
    kind === "departamento"
      ? "departamentos"
      : kind === "categoria"
        ? "categorias-departamento"
        : "subitens-departamento";
  return request<{ ok: true }>(`/api/compras/${root}/${id}`, {
    method: "PUT",
    body: JSON.stringify({ nome }),
  });
}
export function deletePurchaseSetting(
  kind: PurchaseSettingKind,
  id: number,
  guard: {
    canWrite: boolean;
    confirmation: { confirmed: boolean; phrase: string };
  },
) {
  authorize(guard.canWrite, guard.confirmation, "EXCLUIR CONFIGURAÇÃO");
  if (!id) throw new PurchaseSettingsError("ID inválido.");
  const root =
    kind === "departamento"
      ? "departamentos"
      : kind === "categoria"
        ? "categorias-departamento"
        : "subitens-departamento";
  return request<{ ok: true }>(`/api/compras/${root}/${id}`, {
    method: "DELETE",
  });
}
