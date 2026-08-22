import type {
  FirstPieceDecision,
  FirstPieceProduct,
  FirstPieceUser,
} from "../features/first-piece/types";

const base = import.meta.env.VITE_API_BASE_URL || "";
export class FirstPieceGatewayError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  } catch (error) {
    throw new FirstPieceGatewayError(
      error instanceof Error ? error.message : "Falha de conexão.",
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
    throw new FirstPieceGatewayError(
      typeof data.error === "string"
        ? data.error
        : `Falha HTTP ${response.status}`,
      response.status,
    );
  return data as T;
}

export function findFirstPieceProduct(code: string) {
  const value = code.trim();
  if (!value) throw new FirstPieceGatewayError("Informe um código de produto.");
  return request<FirstPieceProduct & { ok: boolean }>(
    `/api/primeira-pc-ok/buscar-por-codigo?codigo=${encodeURIComponent(value)}`,
  );
}

export async function loadFirstPieceUsers(): Promise<FirstPieceUser[]> {
  try {
    const data = await request<{ usuarios?: FirstPieceUser[] }>(
      "/api/usuarios/ativos",
    );
    if (data.usuarios?.length) return data.usuarios;
  } catch {
    /* fallback comprovado pelo legado */
  }
  const fallback = await request<
    FirstPieceUser[] | { usuarios?: FirstPieceUser[] }
  >("/api/rh/colaboradores/usuarios");
  return Array.isArray(fallback) ? fallback : fallback.usuarios || [];
}

export function registerFirstPieceDecision(
  input: FirstPieceDecision,
  confirmation: { confirmed: boolean },
) {
  if (!confirmation.confirmed)
    throw new FirstPieceGatewayError("Confirmação explícita obrigatória.");
  if (!input.codigo_produto.trim())
    throw new FirstPieceGatewayError("Produto obrigatório.");
  if (!input.numero_op.trim())
    throw new FirstPieceGatewayError("Número da OP obrigatório.");
  if (
    !input.itens.length ||
    input.itens.some(
      (item) => item.resultado !== "ok" && item.resultado !== "nok",
    )
  )
    throw new FirstPieceGatewayError("Todos os itens devem estar avaliados.");
  const hasNok = input.itens.some((item) => item.resultado === "nok");
  if (input.tem_nok !== hasNok)
    throw new FirstPieceGatewayError(
      "A indicação de NOK diverge dos itens avaliados.",
    );
  if (
    hasNok &&
    (!input.user_liberacao?.trim() ||
      !input.senha_liberacao?.trim() ||
      !input.resolucao?.trim())
  )
    throw new FirstPieceGatewayError("NOK exige liberador, senha e resolução.");
  return request<{ ok: true; registro: unknown }>(
    "/api/primeira-pc-ok/registrar-verificacao",
    { method: "POST", body: JSON.stringify(input) },
  );
}
