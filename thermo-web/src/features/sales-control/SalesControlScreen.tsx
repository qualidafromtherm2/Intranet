import {
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  RefreshCw,
  Search,
  ShoppingCart,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  loadSalesOrderItems,
  loadSalesOrders,
} from "../../services/salesControlGateway";
import type {
  SalesFilters,
  SalesOrder,
  SalesOrderItem,
  SalesSortKey,
  SortDirection,
} from "./types";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const quantity = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
const EMPTY_FILTERS: SalesFilters = {
  pedido: "",
  cliente: "",
  etapa: "",
  dataCriacao: "",
  origem: "",
};

export function formatSalesDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

const normalize = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR");
const orderNumber = (order: SalesOrder) =>
  order.numero_pedido || order.codigo_pedido || "—";
const stage = (order: SalesOrder) =>
  order.etapa_descricao || order.etapa || "—";
const numeric = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;
const dateValue = (value?: string | null) =>
  value && !Number.isNaN(new Date(value).getTime())
    ? new Date(value).getTime()
    : 0;

function sortValue(order: SalesOrder, key: SalesSortKey): string | number {
  if (key === "pedido") return numeric(orderNumber(order));
  if (key === "cliente") return normalize(order.cliente_nome);
  if (key === "etapa") return normalize(stage(order));
  if (key === "created_at") return dateValue(order.created_at);
  if (key === "data_previsao") return dateValue(order.data_previsao);
  if (key === "origem") return normalize(order.origem_pedido);
  return numeric(order.valor_total_pedido);
}

export function filterAndSortOrders(
  rows: SalesOrder[],
  filters: SalesFilters,
  key: SalesSortKey,
  direction: SortDirection,
) {
  const filtered = rows.filter((order) => {
    if (
      normalize(filters.pedido) &&
      !normalize(orderNumber(order)).includes(normalize(filters.pedido))
    )
      return false;
    if (
      normalize(filters.cliente) &&
      !normalize(order.cliente_nome).includes(normalize(filters.cliente))
    )
      return false;
    if (
      normalize(filters.etapa) &&
      !normalize(stage(order)).includes(normalize(filters.etapa))
    )
      return false;
    if (
      normalize(filters.dataCriacao) &&
      !normalize(formatSalesDate(order.created_at)).includes(
        normalize(filters.dataCriacao),
      )
    )
      return false;
    if (
      normalize(filters.origem) &&
      !normalize(order.origem_pedido).includes(normalize(filters.origem))
    )
      return false;
    return true;
  });
  return filtered.sort((a, b) => {
    const left = sortValue(a, key);
    const right = sortValue(b, key);
    let comparison =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right), "pt-BR", {
            sensitivity: "base",
          });
    if (!comparison)
      comparison = numeric(orderNumber(a)) - numeric(orderNumber(b));
    return direction === "asc" ? comparison : -comparison;
  });
}

function StatusBadge({ order }: { order: SalesOrder }) {
  const label = stage(order);
  const tone = /faturado|entregue|concluído/i.test(label)
    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
    : /análise|processamento|separação/i.test(label)
      ? "bg-amber-50 text-amber-800 border-amber-200"
      : "bg-sky-50 text-sky-800 border-sky-200";
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}
    >
      {label}
    </span>
  );
}

function Filter({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="min-w-0 text-xs font-medium text-slate-600">
      <span className="mb-1 block">{label}</span>
      <input
        className="thermo-input w-full"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function Items({ orderId }: { orderId: string | number }) {
  const [items, setItems] = useState<SalesOrderItem[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    loadSalesOrderItems(orderId, controller.signal)
      .then((data) => setItems(data.rows || []))
      .catch((reason) => {
        if (reason?.name !== "AbortError")
          setError(
            reason instanceof Error
              ? reason.message
              : "Falha ao carregar itens.",
          );
      });
    return () => controller.abort();
  }, [orderId]);
  if (error)
    return (
      <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
        {error}
      </p>
    );
  if (!items)
    return (
      <p className="flex items-center gap-2 p-3 text-sm text-slate-500">
        <LoaderCircle className="size-4 animate-spin" />
        Carregando itens reais…
      </p>
    );
  if (!items.length)
    return (
      <p className="p-3 text-sm text-slate-500">Sem itens para este pedido.</p>
    );
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="p-2 text-left">Código</th>
            <th className="p-2 text-left">Descrição</th>
            <th className="p-2 text-right">Quantidade</th>
            <th className="p-2 text-right">Valor total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr className="border-t" key={`${item.codigo}-${index}`}>
              <td className="whitespace-nowrap p-2 font-mono">
                {item.codigo || "—"}
              </td>
              <td className="p-2">{item.descricao || "—"}</td>
              <td className="whitespace-nowrap p-2 text-right">
                {quantity.format(numeric(item.quantidade))}
              </td>
              <td className="whitespace-nowrap p-2 text-right font-semibold">
                {money.format(numeric(item.valor_total))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileOrder({
  order,
  expanded,
  toggle,
}: {
  order: SalesOrder;
  expanded: boolean;
  toggle: () => void;
}) {
  return (
    <article className="rounded-lg border border-thermo-border bg-white">
      <button
        className="w-full p-4 text-left"
        onClick={toggle}
        type="button"
        aria-expanded={expanded}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-slate-500">
              Pedido {orderNumber(order)}
            </p>
            <h2 className="font-semibold text-thermo-navy">
              {order.cliente_nome || "Sem nome"}
            </h2>
          </div>
          {expanded ? (
            <ChevronUp className="size-5" />
          ) : (
            <ChevronDown className="size-5" />
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge order={order} />
          <strong className="ml-auto">
            {money.format(numeric(order.valor_total_pedido))}
          </strong>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <dt className="text-slate-500">Criado em</dt>
            <dd>{formatSalesDate(order.created_at)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Previsão</dt>
            <dd>{formatSalesDate(order.data_previsao)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-slate-500">Origem</dt>
            <dd>{order.origem_pedido || "—"}</dd>
          </div>
        </dl>
      </button>
      {expanded && (
        <div className="border-t p-3">
          <Items orderId={order.codigo_pedido} />
        </div>
      )}
    </article>
  );
}

export function SalesControlScreen({ allowed = true }: { allowed?: boolean }) {
  const [orders, setOrders] = useState<SalesOrder[]>([]),
    [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<SalesSortKey>("pedido"),
    [direction, setDirection] = useState<SortDirection>("desc");
  const [expanded, setExpanded] = useState<string | null>(null),
    [loading, setLoading] = useState(allowed),
    [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setOrders((await loadSalesOrders()).rows || []);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Falha ao carregar pedidos.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (allowed) void load();
    else setLoading(false);
  }, [allowed]); // oxlint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(
    () => filterAndSortOrders(orders, filters, sortKey, direction),
    [orders, filters, sortKey, direction],
  );
  const sort = (key: SalesSortKey) => {
    setExpanded(null);
    if (sortKey === key) setDirection(direction === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setDirection("asc");
    }
  };
  const updateFilter = (key: keyof SalesFilters, value: string) => {
    setFilters({ ...filters, [key]: value });
    setExpanded(null);
  };
  if (!allowed)
    return (
      <section
        aria-label="Controle de Pedidos"
        className="rounded-lg border border-amber-200 bg-amber-50 p-6"
      >
        <h1 className="font-bold text-amber-900">
          Controle de Pedidos bloqueado
        </h1>
        <p className="mt-1 text-sm text-amber-800">
          Seu usuário não possui a permissão de navegação{" "}
          <code>side:vendas:controle</code>.
        </p>
      </section>
    );
  const columns: Array<[SalesSortKey, string]> = [
    ["pedido", "Pedido"],
    ["cliente", "Cliente"],
    ["etapa", "Etapa"],
    ["created_at", "Criado em"],
    ["data_previsao", "Previsão"],
    ["origem", "Origem"],
    ["valor_total", "Valor total"],
  ];
  return (
    <main aria-label="Controle de Pedidos" className="min-w-0 space-y-4">
      <header className="rounded-lg border border-thermo-border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-sky-700">
              Vendas · Consulta comercial
            </p>
            <h1 className="text-xl font-bold text-thermo-navy">
              Controle de Pedidos de Venda
            </h1>
            <p className="text-sm text-slate-500">
              Até 500 pedidos, conforme contrato legado. Consulta sem alterações
              comerciais.
            </p>
          </div>
          <button
            className="thermo-button thermo-button-secondary"
            type="button"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Atualizar
          </button>
        </div>
      </header>
      <section
        aria-label="Filtros"
        className="rounded-lg border border-thermo-border bg-white p-4"
      >
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-thermo-navy">
          <Search className="size-4" />
          Filtros locais
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Filter
            label="Pedido"
            placeholder="Número do pedido"
            value={filters.pedido}
            onChange={(value) => updateFilter("pedido", value)}
          />
          <Filter
            label="Cliente"
            placeholder="Nome do cliente"
            value={filters.cliente}
            onChange={(value) => updateFilter("cliente", value)}
          />
          <Filter
            label="Etapa"
            placeholder="Descrição da etapa"
            value={filters.etapa}
            onChange={(value) => updateFilter("etapa", value)}
          />
          <Filter
            label="Data de criação"
            placeholder="dd/mm/aaaa"
            value={filters.dataCriacao}
            onChange={(value) => updateFilter("dataCriacao", value)}
          />
          <Filter
            label="Origem"
            placeholder="Pedido do cliente"
            value={filters.origem}
            onChange={(value) => updateFilter("origem", value)}
          />
        </div>
      </section>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>
          {loading
            ? "Carregando pedidos reais…"
            : `${rows.length} de ${orders.length} pedido(s)`}
        </span>
        {Object.values(filters).some(Boolean) && (
          <button
            className="text-sky-700 underline"
            onClick={() => setFilters(EMPTY_FILTERS)}
            type="button"
          >
            Limpar filtros
          </button>
        )}
      </div>
      {!loading && !error && !rows.length && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
          <ShoppingCart className="mx-auto mb-2 size-6" />
          Nenhum pedido encontrado.
        </div>
      )}
      <section className="space-y-3 md:hidden" aria-label="Pedidos em cartões">
        {rows.map((order) => {
          const id = String(order.codigo_pedido);
          return (
            <MobileOrder
              key={id}
              order={order}
              expanded={expanded === id}
              toggle={() => setExpanded(expanded === id ? null : id)}
            />
          );
        })}
      </section>
      <div className="hidden overflow-x-auto rounded-lg border border-thermo-border bg-white md:block">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map(([key, label]) => (
                <th
                  className={`whitespace-nowrap p-3 text-xs uppercase text-slate-500 ${key === "valor_total" ? "text-right" : "text-left"}`}
                  key={key}
                >
                  <button
                    className="inline-flex items-center gap-1"
                    type="button"
                    onClick={() => sort(key)}
                  >
                    {label}
                    {sortKey === key &&
                      (direction === "asc" ? (
                        <ChevronUp className="size-3" />
                      ) : (
                        <ChevronDown className="size-3" />
                      ))}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((order) => {
              const id = String(order.codigo_pedido);
              const open = expanded === id;
              return (
                <Fragment key={id}>
                  <tr
                    className="cursor-pointer border-t hover:bg-sky-50"
                    onClick={() => setExpanded(open ? null : id)}
                  >
                    <td className="whitespace-nowrap p-3 font-mono font-semibold">
                      {orderNumber(order)}
                    </td>
                    <td className="max-w-72 p-3">
                      <span
                        className="line-clamp-2"
                        title={order.obs_venda || undefined}
                      >
                        {order.cliente_nome || "Sem nome"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap p-3">
                      <StatusBadge order={order} />
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {formatSalesDate(order.created_at)}
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {formatSalesDate(order.data_previsao)}
                    </td>
                    <td className="p-3">{order.origem_pedido || "—"}</td>
                    <td className="whitespace-nowrap p-3 text-right font-semibold">
                      {money.format(numeric(order.valor_total_pedido))}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td className="border-t bg-slate-50 p-3" colSpan={7}>
                        <Items orderId={order.codigo_pedido} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
