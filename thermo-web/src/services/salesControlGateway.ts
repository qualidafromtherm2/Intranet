import type {
  SalesOrder,
  SalesOrderItem,
} from "../features/sales-control/types";

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    signal,
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    ok?: boolean;
    error?: string;
  };
  if (!response.ok || payload.ok === false)
    throw new Error(payload.error || `Falha HTTP ${response.status}.`);
  return payload;
}

export const loadSalesOrders = (signal?: AbortSignal) =>
  request<{ ok: true; rows: SalesOrder[] }>(
    "/api/sac/vendas/controle/pedidos",
    signal,
  );

export function loadSalesOrderItems(
  orderId: string | number,
  signal?: AbortSignal,
) {
  const id = String(orderId).trim();
  if (!id) throw new Error("Código do pedido é obrigatório.");
  return request<{ ok: true; rows: SalesOrderItem[] }>(
    `/api/sac/vendas/controle/pedido-itens/${encodeURIComponent(id)}`,
    signal,
  );
}
