import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import * as api from "../../services/stockAdjustmentGateway";
import type {
  AdjustmentItem,
  AdjustmentProduct,
  AdjustmentType,
  StockAdjustment,
} from "../../services/stockAdjustmentGateway";

export function StockAdjustmentScreen({
  currentUser,
  allowed,
}: {
  currentUser: string;
  allowed: boolean;
}) {
  const [rows, setRows] = useState<StockAdjustment[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [tab, setTab] = useState<"pending" | "history" | "new">("pending");
  const [selected, setSelected] = useState<StockAdjustment | null>(null),
    [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const reload = async () => {
    setLoading(true);
    setError("");
    try {
      setRows((await api.loadAdjustments()).registros || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar ajustes.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (allowed) void reload();
    else setLoading(false);
  }, [allowed]); // oxlint-disable-line react-hooks/exhaustive-deps
  const pending = rows.filter(
      (r) =>
        !["executado", "reprovado"].includes(String(r.status).toLowerCase()),
    ),
    history = rows.filter((r) =>
      ["executado", "reprovado"].includes(String(r.status).toLowerCase()),
    );
  if (!allowed)
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-950">
        <AlertTriangle />
        <h1 className="mt-2 text-xl font-bold">
          Solicitação de ajuste bloqueada
        </h1>
        <p>
          A permissão real <code>side:log:solicitacao-ajuste</code> não foi
          concedida.
        </p>
      </section>
    );
  return (
    <main className="space-y-4" aria-label="Solicitações de ajuste de estoque">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-thermo-border bg-white p-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
            Logística · Fluxo auditado
          </p>
          <h1 className="text-xl font-bold text-thermo-navy">
            Solicitações de ajuste de estoque
          </h1>
        </div>
        <button
          className="thermo-button thermo-button-secondary"
          onClick={() => void reload()}
        >
          <RefreshCw className="size-4" />
          Atualizar
        </button>
      </header>
      <nav className="flex gap-2 overflow-x-auto" aria-label="Visões de ajuste">
        <Tab active={tab === "pending"} onClick={() => setTab("pending")}>
          Pendentes ({pending.length})
        </Tab>
        <Tab active={tab === "history"} onClick={() => setTab("history")}>
          Histórico ({history.length})
        </Tab>
        <Tab active={tab === "new"} onClick={() => setTab("new")}>
          <Plus className="size-4" />
          Nova solicitação
        </Tab>
      </nav>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800"
        >
          {notice}
        </p>
      )}
      {loading ? (
        <p className="flex items-center gap-2 p-5">
          <LoaderCircle className="size-4 animate-spin" />
          Carregando dados reais…
        </p>
      ) : tab === "new" ? (
        <NewAdjustment
          currentUser={currentUser}
          done={async (m) => {
            setNotice(m);
            setTab("pending");
            await reload();
          }}
        />
      ) : (
        <AdjustmentList
          rows={tab === "pending" ? pending : history}
          actionable={tab === "pending"}
          onDecision={(row, kind) => {
            setSelected(row);
            setDecision(kind);
          }}
        />
      )}
      {selected && decision && (
        <DecisionDialog
          row={selected}
          kind={decision}
          currentUser={currentUser}
          close={() => {
            setSelected(null);
            setDecision(null);
          }}
          done={async (m) => {
            setSelected(null);
            setDecision(null);
            setNotice(m);
            await reload();
          }}
        />
      )}
    </main>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`thermo-button shrink-0 ${active ? "thermo-button-primary" : "thermo-button-secondary"}`}
    >
      {children}
    </button>
  );
}
function AdjustmentList({
  rows,
  actionable,
  onDecision,
}: {
  rows: StockAdjustment[];
  actionable: boolean;
  onDecision: (r: StockAdjustment, k: "approve" | "reject") => void;
}) {
  if (!rows.length)
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-slate-500">
        Nenhuma solicitação nesta visão.
      </p>
    );
  return (
    <section className="grid gap-3">
      {rows.map((r) => (
        <article
          key={r.id}
          className="rounded-lg border border-thermo-border bg-white p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span
                className={`rounded px-2 py-1 text-xs font-bold ${r.tipo_operacao === "ENT" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}
              >
                {r.tipo_operacao}
              </span>
              <h2 className="mt-2 font-bold text-thermo-navy">
                #{r.id} · {r.codigo} · {r.descricao || "—"}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {formatQty(r.qtd)} · {r.local_nome || r.local_estoque} ·{" "}
                {formatDate(r.data_movimentacao)}
              </p>
            </div>
            <Status value={r.status} />
          </div>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Info label="Motivo" value={r.motivo} />
            <Info label="Justificativa" value={r.obs} />
            <Info label="Solicitante" value={r.solicitante} />
            <Info
              label="CMC"
              value={r.cmc == null ? "—" : formatMoney(r.cmc)}
            />
            {r.motivo_reprovacao && (
              <Info label="Motivo da reprovação" value={r.motivo_reprovacao} />
            )}
          </dl>
          {actionable && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="thermo-button thermo-button-primary"
                onClick={() => onDecision(r, "approve")}
              >
                <Check className="size-4" />
                Executar ajuste
              </button>
              <button
                className="thermo-button border border-red-200 bg-red-50 text-red-700"
                onClick={() => onDecision(r, "reject")}
              >
                <X className="size-4" />
                Reprovar
              </button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

function DecisionDialog({
  row,
  kind,
  currentUser,
  close,
  done,
}: {
  row: StockAdjustment;
  kind: "approve" | "reject";
  currentUser: string;
  close: () => void;
  done: (m: string) => void;
}) {
  const [reason, setReason] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const expected = `${kind === "approve" ? "EXECUTAR" : "REPROVAR"} ${row.id}`;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (kind === "approve")
        await api.approveAdjustment(row.id, currentUser, confirmation);
      else
        await api.rejectAdjustment(row.id, currentUser, reason, confirmation);
      done(
        kind === "approve"
          ? `Ajuste #${row.id} executado na Omie.`
          : `Ajuste #${row.id} reprovado.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na decisão.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/65 p-3">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={kind === "approve" ? "Executar ajuste" : "Reprovar ajuste"}
        className="w-full max-w-lg space-y-4 rounded-lg bg-white p-5"
      >
        <h2 className="text-lg font-bold">
          {kind === "approve"
            ? "Executar ajuste na Omie"
            : "Reprovar solicitação"}{" "}
          #{row.id}
        </h2>
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {kind === "approve"
            ? "Esta ação altera o estoque real e não pode ser desfeita nesta tela."
            : "A solicitação deixará a fila de pendências."}
        </p>
        {kind === "reject" && (
          <Field label="Justificativa da reprovação">
            <textarea
              className="thermo-input min-h-24"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        )}
        <Field label={`Digite ${expected} para confirmar`}>
          <input
            className="thermo-input"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            className="thermo-button thermo-button-secondary"
            onClick={close}
          >
            Cancelar
          </button>
          <button
            className="thermo-button thermo-button-primary"
            disabled={busy || confirmation !== expected}
            onClick={() => void submit()}
          >
            {busy ? "Processando…" : "Confirmar"}
          </button>
        </div>
      </section>
    </div>
  );
}

function NewAdjustment({
  currentUser,
  done,
}: {
  currentUser: string;
  done: (m: string) => void;
}) {
  const [type, setType] = useState<AdjustmentType>("ENT"),
    [locations, setLocations] = useState<api.AdjustmentLocation[]>([]),
    [location, setLocation] = useState(""),
    [date, setDate] = useState(() => new Date().toISOString().slice(0, 10)),
    [reason, setReason] = useState("INV"),
    [note, setNote] = useState(""),
    [query, setQuery] = useState(""),
    [options, setOptions] = useState<AdjustmentProduct[]>([]),
    [items, setItems] = useState<AdjustmentItem[]>([]),
    [confirmation, setConfirmation] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .loadAdjustmentLocations()
      .then((r) => setLocations((r.locais || []).filter((x) => !x.inativo)))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Falha nos locais."),
      );
  }, []);
  useEffect(() => setReason("INV"), [type]);
  const search = async () => {
    if (query.trim().length < 2) return;
    try {
      setOptions((await api.searchAdjustmentProducts(query.trim())).data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na busca.");
    }
  };
  const add = (p: AdjustmentProduct) => {
    if (!items.some((x) => x.codigo === p.codigo))
      setItems([...items, { ...p, qtd: 1, cmc: p.cmc ?? null }]);
    setOptions([]);
    setQuery("");
  };
  const submit = async () => {
    const loc = locations.find(
      (x) => String(x.codigo_local_estoque) === location,
    );
    setBusy(true);
    setError("");
    try {
      await api.createAdjustment(
        {
          tipo_operacao: type,
          local_estoque: location,
          local_nome: loc?.descricao || null,
          data_movimentacao: date,
          solicitante: currentUser,
          motivo: reason,
          obs: note,
          itens: items,
        },
        confirmation,
      );
      done(`Solicitação ${type} registrada e enviada para aprovação.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao solicitar ajuste.");
    } finally {
      setBusy(false);
    }
  };
  const expected = `SOLICITAR ${type}`;
  return (
    <section className="space-y-4 rounded-lg border border-thermo-border bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Tipo">
          <select
            className="thermo-input"
            value={type}
            onChange={(e) => setType(e.target.value as AdjustmentType)}
          >
            <option value="ENT">ENT · Entrada</option>
            <option value="SAI">SAI · Saída</option>
          </select>
        </Field>
        <Field label="Local de estoque">
          <select
            className="thermo-input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          >
            <option value="">Selecione</option>
            {locations.map((x) => (
              <option
                key={String(x.codigo_local_estoque)}
                value={String(x.codigo_local_estoque)}
              >
                {x.descricao || x.codigo_local_estoque}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Data da movimentação">
          <input
            type="date"
            className="thermo-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Motivo">
          <select
            className="thermo-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {api.reasonsByType[type].map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Justificativa obrigatória">
        <textarea
          className="thermo-input min-h-20"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Explique a divergência e a origem da conferência"
        />
      </Field>
      <div className="flex gap-2">
        <Field label="Adicionar produto">
          <input
            className="thermo-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Código ou descrição"
          />
        </Field>
        <button
          className="thermo-button thermo-button-secondary self-end"
          onClick={() => void search()}
        >
          <Search className="size-4" />
          Buscar
        </button>
      </div>
      {options.map((p) => (
        <button
          key={p.codigo}
          className="block w-full rounded border p-2 text-left text-sm"
          onClick={() => add(p)}
        >
          {p.codigo} · {p.descricao}
        </button>
      ))}
      <div className="space-y-2">
        {items.map((item, index) => (
          <article
            key={item.codigo}
            className="grid gap-2 rounded-lg bg-thermo-bg p-3 sm:grid-cols-[1fr_130px_130px_auto]"
          >
            <div>
              <b>{item.codigo}</b>
              <p className="text-sm text-slate-600">{item.descricao}</p>
            </div>
            <Field label="Quantidade">
              <input
                type="number"
                min="0.0001"
                className="thermo-input"
                value={item.qtd}
                onChange={(e) =>
                  setItems(
                    items.map((x, i) =>
                      i === index ? { ...x, qtd: Number(e.target.value) } : x,
                    ),
                  )
                }
              />
            </Field>
            <Field label="CMC">
              <input
                type="number"
                min="0"
                step="0.0001"
                className="thermo-input"
                value={item.cmc ?? ""}
                onChange={(e) =>
                  setItems(
                    items.map((x, i) =>
                      i === index
                        ? {
                            ...x,
                            cmc:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          }
                        : x,
                    ),
                  )
                }
              />
            </Field>
            <button
              aria-label={`Remover ${item.codigo}`}
              className="self-center p-2 text-red-700"
              onClick={() => setItems(items.filter((_, i) => i !== index))}
            >
              <Trash2 />
            </button>
          </article>
        ))}
      </div>
      <Field label={`Digite ${expected} para confirmar`}>
        <input
          className="thermo-input"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        className="thermo-button thermo-button-primary"
        disabled={busy || confirmation !== expected}
        onClick={() => void submit()}
      >
        {busy ? "Enviando…" : "Registrar solicitação"}
      </button>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block flex-1">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}
function Info({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 break-words">{String(value || "—")}</dd>
    </div>
  );
}
function Status({ value }: { value: string }) {
  const key = value.toLowerCase();
  return (
    <span
      className={`rounded px-2 py-1 text-xs font-bold ${key === "executado" ? "bg-emerald-100 text-emerald-800" : key === "reprovado" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}
    >
      {value}
    </span>
  );
}
const formatQty = (n: number) =>
    new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(
      Number(n || 0),
    ),
  formatMoney = (n: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(Number(n || 0)),
  formatDate = (d?: string | null) =>
    d
      ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(
          "pt-BR",
        )
      : "—";
