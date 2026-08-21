/* oxlint-disable react/set-state-in-effect, react/only-export-components */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock3, RefreshCw, Search, X } from "lucide-react";
import * as api from "../../services/productionRegistrationGateway";
import type {
  ProductionColumn,
  ProductionOrder,
  ProductionProgram,
  ProductionSaleOrder,
  ProductionSnapshot,
} from "./types";
const columns: [ProductionColumn, string][] = [
  ["programado", "Programado"],
  ["solicitado", "Montagem hermética"],
  ["produzindo", "Montagem elétrica"],
  ["teste", "Teste"],
  ["inspecao_final", "Inspeção final"],
  ["embalagem", "Embalagem"],
];
const norm = (v: unknown) =>
  String(v || "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
export function productionColumn(
  program?: ProductionProgram,
): ProductionColumn {
  const s = norm(program?.status);
  if (s === "finalizado") return "finalizado";
  if (s === "embalagem") return "embalagem";
  if (["inspecao final", "teste ok", "teste final"].includes(s))
    return "inspecao_final";
  if (s === "teste") return "teste";
  if (s === "montagem eletrica") return "produzindo";
  if (s === "montagem hermetica") return "solicitado";
  return "programado";
}
const next: Record<ProductionColumn, string> = {
  programado: "Montagem hermética",
  solicitado: "Montagem elétrica",
  produzindo: "Teste",
  teste: "Inspeção final",
  inspecao_final: "Embalagem",
  embalagem: "Finalizado",
  finalizado: "Finalizado",
};
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-0 sm:p-5">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-dvh w-full max-w-3xl flex-col overflow-hidden bg-white sm:max-h-[92vh] sm:rounded-md"
      >
        <header className="flex items-center justify-between border-b p-4">
          <h2 className="font-bold">{title}</h2>
          <button
            aria-label="Fechar"
            onClick={close}
            className="grid size-11 place-items-center"
          >
            <X />
          </button>
        </header>
        <div className="overflow-auto p-4">{children}</div>
      </section>
    </div>
  );
}
export function ProductionRegistrationScreen({
  username = "",
  allowed = true,
}: {
  username?: string;
  allowed?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<ProductionSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ProductionOrder | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError("");
    try {
      setSnapshot(await api.loadProductionSnapshot());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar produção.");
    } finally {
      setLoading(false);
    }
  }, [allowed]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const programs = snapshot?.programs || [];
  const program = (op: ProductionOrder) =>
    programs.find(
      (r) =>
        r.op_producao_id === op.id ||
        norm(r.numero_op) === norm(op.identificacao || op.n_op),
    );
  const filtered = useMemo(() => {
    const q = norm(query);
    return (snapshot?.orders || []).filter(
      (o) => !q || norm(JSON.stringify(o)).includes(q),
    );
  }, [query, snapshot]);
  if (!allowed)
    return (
      <section
        role="alert"
        className="rounded border border-amber-300 bg-amber-50 p-5"
      >
        <h1 className="font-bold">Acesso não permitido</h1>
        <p>Seu perfil não possui permissão para Registrar produção.</p>
      </section>
    );
  return (
    <main className="mx-auto max-w-[1440px] space-y-4 p-3 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">
            Produção
          </p>
          <h1 className="text-2xl font-bold">Registrar produção</h1>
          <p className="text-sm text-slate-600">
            Ordens, apontamentos e estados reais do kanban.
          </p>
        </div>
        <button
          onClick={() => void reload()}
          className="min-h-11 rounded bg-slate-800 px-4 font-semibold text-white"
        >
          <RefreshCw className="mr-2 inline size-4" />
          Atualizar
        </button>
      </header>
      <label className="relative block">
        <Search className="absolute left-3 top-3 size-5" />
        <span className="sr-only">Pesquisar modelo ou OP</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pesquisar por modelo ou número de OP"
          className="min-h-11 w-full rounded border pl-10 pr-3"
        />
      </label>
      {error && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-red-900"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded border border-emerald-300 bg-emerald-50 p-3 text-emerald-900"
        >
          {notice}
        </p>
      )}
      {loading && !snapshot ? (
        <p>Carregando OPs e pedidos…</p>
      ) : (
        <div className="flex snap-x gap-3 overflow-x-auto pb-3 lg:grid lg:grid-cols-3 xl:grid-cols-6">
          {columns.map(([key, label]) => {
            const ops = filtered.filter(
              (o) => productionColumn(program(o)) === key,
            );
            return (
              <section
                key={key}
                className="min-w-[300px] snap-start rounded-md border bg-slate-50 lg:min-w-0"
              >
                <header className="flex items-center justify-between border-b p-3">
                  <h2 className="font-bold">{label}</h2>
                  <span className="rounded-full bg-slate-200 px-2 text-sm">
                    {ops.length}
                  </span>
                </header>
                <div className="space-y-2 p-2">
                  {ops.length ? (
                    ops.map((op) => (
                      <OrderCard
                        key={op.id}
                        op={op}
                        program={program(op)}
                        stopped={snapshot?.stopsByOrder[String(op.id)]}
                        ri={snapshot?.riByOrder[String(op.id)]}
                        occurrence={snapshot?.occurrencesByOrder[String(op.id)]}
                        time={snapshot?.timesByOrder[String(op.id)]}
                        open={() => setSelected(op)}
                      />
                    ))
                  ) : (
                    <p className="p-4 text-sm text-slate-500">Nenhuma OP.</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {selected && (
        <ActionDialog
          op={selected}
          program={program(selected)}
          column={productionColumn(program(selected))}
          sales={snapshot?.sales || []}
          stop={snapshot?.stopsByOrder[String(selected.id)]}
          ri={snapshot?.riByOrder[String(selected.id)]}
          username={username}
          close={() => setSelected(null)}
          done={(m) => {
            setSelected(null);
            setNotice(m);
            void reload();
          }}
          error={setError}
        />
      )}
    </main>
  );
}
function OrderCard({
  op,
  program,
  stopped,
  ri,
  occurrence,
  time,
  open,
}: {
  op: ProductionOrder;
  program?: ProductionProgram;
  stopped?: unknown;
  ri?: unknown;
  occurrence?: unknown;
  time?: unknown;
  open: () => void;
}) {
  return (
    <button
      onClick={open}
      className="w-full rounded-md border bg-white p-3 text-left"
    >
      <b>OP {op.identificacao || op.n_op || op.id}</b>
      <p className="text-sm">
        {op.produto?.identificacao || program?.codigo || "—"} ·{" "}
        {op.produto?.descricao || program?.descricao || "—"}
      </p>
      <p className="text-sm">
        Quantidade:{" "}
        {op.quantidade ||
          op.produto?.quantidade ||
          program?.quantidade_programado ||
          1}
      </p>
      <div className="mt-2 flex flex-wrap gap-1 text-xs">
        {Boolean(stopped) && (
          <span className="rounded bg-amber-100 px-2 py-1">Parada ativa</span>
        )}
        {Boolean(ri) && (
          <span className="rounded bg-violet-100 px-2 py-1">Aguardando RI</span>
        )}
        {Boolean(occurrence) && (
          <span className="rounded bg-red-100 px-2 py-1">Ocorrência</span>
        )}
        {Boolean(time) && (
          <span className="rounded bg-sky-100 px-2 py-1">
            <Clock3 className="mr-1 inline size-3" />
            Tempo ativo
          </span>
        )}
      </div>
    </button>
  );
}
function ActionDialog({
  op,
  program,
  column,
  sales,
  stop,
  ri,
  username,
  close,
  done,
  error,
}: {
  op: ProductionOrder;
  program?: ProductionProgram;
  column: ProductionColumn;
  sales: ProductionSaleOrder[];
  stop?: any;
  ri?: unknown;
  username: string;
  close: () => void;
  done: (m: string) => void;
  error: (m: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [action, setAction] = useState<
    "start" | "finish" | "back" | "stop" | "resume" | "link" | ""
  >("");
  const [type, setType] = useState("");
  const [reason, setReason] = useState("");
  const [reasons, setReasons] = useState<
    Array<{ tipo_parada: string; motivo: string }>
  >([]);
  const [sale, setSale] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .loadStopReasons()
      .then((r) => setReasons(r.motivos || []))
      .catch(() => setReasons([]));
  }, []);
  const code = op.produto?.identificacao || program?.codigo || "";
  const saleOptions = sales.flatMap((p) =>
    (p.itens || [])
      .filter((i) => norm(i.codigo) === norm(code))
      .map((i) => ({ order: p, item: i })),
  );
  const execute = async () => {
    if (!confirm || !action) return;
    setBusy(true);
    try {
      const common = {
        op_producao_id: op.from_op_producao === false ? 0 : op.id,
        numero_op: op.identificacao || op.n_op || "",
        kanban_programacao_id: program?.id || null,
        usuario: username,
      };
      if (action === "start") await api.startProduction(common);
      if (action === "finish")
        await api.finishProductionStep({
          ...common,
          col_key: column,
          posto_atual: columns.find((x) => x[0] === column)?.[1] || "",
          proximo_status: next[column],
          operacao: next[column],
        });
      if (action === "back")
        await api.moveProductionBack({ ...common, col_key: column });
      if (action === "resume") await api.resumeProduction(Number(stop?.id));
      if (action === "stop") {
        if (!type || !reason.trim())
          throw new Error("Informe tipo e motivo da parada.");
        await api.createProductionStop({
          kanban_programacao_id: program?.id || null,
          numero_op: common.numero_op,
          usuario: username,
          operacao: columns.find((x) => x[0] === column)?.[1] || column,
          tipo_parada: type,
          motivo: reason.trim(),
        });
      }
      if (action === "link") {
        const chosen = saleOptions.find(
          (x) => String(x.order.codigo_pedido) === sale,
        );
        if (!chosen) throw new Error("Selecione um pedido compatível.");
        const opQty = Number(
          op.quantidade ||
            op.produto?.quantidade ||
            program?.quantidade_programado ||
            1,
        );
        if (Number(chosen.item.quantidade) < opQty)
          throw new Error("Saldo do pedido é menor que a quantidade da OP.");
        await api.linkSaleOrder({
          codigo_pedido: chosen.order.codigo_pedido,
          codigo: chosen.item.codigo,
          quantidade_programado: opQty,
          numero_op: common.numero_op,
          op_producao_id: op.id,
        });
      }
      done("Apontamento registrado com sucesso.");
    } catch (e) {
      error(e instanceof Error ? e.message : "Falha no apontamento.");
    } finally {
      setBusy(false);
    }
  };
  const blockedFinish = Boolean(stop) || Boolean(ri);
  return (
    <Dialog
      title={`Ações da OP ${op.identificacao || op.n_op || op.id}`}
      close={close}
    >
      <div className="space-y-4">
        <p>
          <b>{code}</b> · {op.produto?.descricao || program?.descricao || "—"}
        </p>
        <p>
          Estado atual:{" "}
          <b>{columns.find((x) => x[0] === column)?.[1] || column}</b> ·
          Próximo: <b>{next[column]}</b>
        </p>
        {stop && (
          <p className="rounded bg-amber-50 p-3">
            <AlertTriangle className="mr-2 inline size-4" />
            Parada ativa: {stop.motivo || "—"}. Finalização e retrocesso
            bloqueados.
          </p>
        )}
        {ri && (
          <p className="rounded bg-violet-50 p-3">
            A OP aguarda RI da qualidade neste posto.
          </p>
        )}
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="font-bold">Ação explícita</legend>
          {column === "programado" && (
            <Choice
              value="start"
              label="Iniciar produção"
              action={action}
              set={setAction}
            />
          )}{" "}
          {column === "programado" && !program && (
            <Choice
              value="link"
              label="Vincular pedido"
              action={action}
              set={setAction}
            />
          )}{" "}
          {column !== "programado" && column !== "finalizado" && (
            <Choice
              value="finish"
              label="Finalizar operação"
              action={action}
              set={setAction}
              disabled={blockedFinish}
            />
          )}{" "}
          {[
            "solicitado",
            "produzindo",
            "teste",
            "inspecao_final",
          ].includes(column) && (
            <Choice
              value="back"
              label="Retroceder OP"
              action={action}
              set={setAction}
              disabled={Boolean(stop)}
            />
          )}{" "}
          {stop ? (
            <Choice
              value="resume"
              label="Retomar produção"
              action={action}
              set={setAction}
            />
          ) : (
            column !== "programado" && (
              <Choice
                value="stop"
                label="Registrar parada"
                action={action}
                set={setAction}
              />
            )
          )}
        </fieldset>
        {action === "link" && (
          <label>
            Pedido compatível
            <select
              value={sale}
              onChange={(e) => setSale(e.target.value)}
              className="mt-1 min-h-11 w-full rounded border px-2"
            >
              <option value="">Selecione</option>
              {saleOptions.map((x) => (
                <option
                  key={x.order.codigo_pedido}
                  value={x.order.codigo_pedido}
                >
                  Pedido {x.order.numero_pedido || x.order.codigo_pedido} ·
                  saldo {x.item.quantidade}
                </option>
              ))}
            </select>
          </label>
        )}
        {action === "stop" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              Tipo
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="mt-1 min-h-11 w-full rounded border"
              >
                <option value="">Selecione</option>
                <option>Programada</option>
                <option>Não programada</option>
              </select>
            </label>
            <label>
              Motivo
              <input
                list="stop-reasons"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 min-h-11 w-full rounded border px-2"
              />
              <datalist id="stop-reasons">
                {reasons
                  .filter((r) => !type || r.tipo_parada === type)
                  .map((r) => (
                    <option
                      key={`${r.tipo_parada}-${r.motivo}`}
                      value={r.motivo}
                    />
                  ))}
              </datalist>
            </label>
          </div>
        )}
        <label className="flex gap-2 rounded bg-amber-50 p-3">
          <input
            type="checkbox"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
          />
          <span>
            Confirmo a OP, o estado atual e o efeito desta ação em produção e
            estoque.
          </span>
        </label>
        <button
          disabled={
            !confirm ||
            !action ||
            busy ||
            (action === "link" && !sale) ||
            (action === "stop" && (!type || !reason.trim()))
          }
          onClick={() => void execute()}
          className="min-h-11 w-full rounded bg-emerald-700 px-4 font-bold text-white disabled:opacity-40"
        >
          Confirmar apontamento
        </button>
      </div>
    </Dialog>
  );
}
function Choice({
  value,
  label,
  action,
  set,
  disabled = false,
}: {
  value: any;
  label: string;
  action: string;
  set: (x: any) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex min-h-11 items-center gap-2 rounded border p-3 ${disabled ? "opacity-40" : ""}`}
    >
      <input
        type="radio"
        name="action"
        value={value}
        checked={action === value}
        disabled={disabled}
        onChange={() => set(value)}
      />
      {label}
    </label>
  );
}
