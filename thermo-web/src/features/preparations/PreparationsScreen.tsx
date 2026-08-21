/* oxlint-disable react/set-state-in-effect, react/only-export-components */
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import * as api from "../../services/preparationsGateway";
import type {
  PreparationMaterial,
  PreparationOrder,
  PreparationProgram,
  PreparationSnapshot,
  PreparationStation,
} from "./types";
const norm = (v: unknown) =>
  String(v || "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
const parse = (v?: string[] | string) =>
  Array.isArray(v)
    ? v
    : typeof v === "string"
      ? v
          .split(/[,;|]/)
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
export function preparationStation(
  op: PreparationOrder,
  programs: PreparationProgram[],
  stations: PreparationStation[],
) {
  const regs = programs.filter(
    (r) =>
      r.op_producao_id === op.id ||
      norm(r.numero_op) === norm(op.identificacao || op.n_op),
  );
  if (regs.some((r) => norm(r.status) === "finalizado")) return null;
  const byName = new Map(stations.map((s) => [norm(s.nome), s.id]));
  for (const r of regs) {
    const id = byName.get(norm(r.status));
    if (id) return id;
  }
  for (const r of regs)
    for (const p of parse(r.postos)) {
      const id = byName.get(norm(p));
      if (id) return id;
    }
  return null;
}
export function PreparationsScreen({
  username = "",
  allowed = true,
}: {
  username?: string;
  allowed?: boolean;
}) {
  const [data, setData] = useState<PreparationSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PreparationOrder | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError("");
    try {
      setData(await api.loadPreparations());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Falha ao carregar preparações.",
      );
    } finally {
      setLoading(false);
    }
  }, [allowed]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const orders = useMemo(
    () =>
      (data?.orders || []).filter(
        (o) => !query || norm(JSON.stringify(o)).includes(norm(query)),
      ),
    [data, query],
  );
  if (!allowed)
    return (
      <section
        role="alert"
        className="rounded border border-amber-300 bg-amber-50 p-5"
      >
        <h1 className="font-bold">Acesso não permitido</h1>
        <p>Seu perfil não possui permissão para Preparações.</p>
      </section>
    );
  return (
    <main className="mx-auto max-w-[1440px] space-y-4 p-3 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
            Produção
          </p>
          <h1 className="text-2xl font-bold">Preparações</h1>
          <p className="text-sm text-slate-600">
            Kanban dos produtos PP conforme postos cadastrados no Gerar OP.
          </p>
        </div>
        <button
          onClick={() => void reload()}
          className="min-h-11 rounded bg-slate-800 px-4 font-bold text-white"
        >
          <RefreshCw className="mr-2 inline size-4" />
          Atualizar
        </button>
      </header>
      <label className="relative block">
        <span className="sr-only">Pesquisar modelo, OP ou ordem</span>
        <Search className="absolute left-3 top-3 size-5" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pesquisar modelo, número de OP ou Ordem"
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
      {loading && !data ? (
        <p>Carregando postos e OPs…</p>
      ) : !data?.stations.length ? (
        <p className="rounded border border-dashed p-6 text-center">
          Nenhum posto de preparação cadastrado. O cadastro ocorre no fluxo
          Gerar OP.
        </p>
      ) : (
        <div className="flex snap-x gap-3 overflow-x-auto pb-3 lg:grid lg:grid-cols-3 xl:grid-cols-5">
          {data.stations.map((st) => {
            const items = orders.filter(
              (o) =>
                preparationStation(o, data.programs, data.stations) === st.id,
            );
            return (
              <section
                key={st.id}
                className="min-w-[300px] snap-start rounded-md border bg-slate-50 lg:min-w-0"
              >
                <header className="flex justify-between border-b p-3">
                  <h2 className="font-bold">{st.nome}</h2>
                  <span>{items.length}</span>
                </header>
                <div className="space-y-2 p-2">
                  {items.length ? (
                    items.map((o) => (
                      <button
                        key={o.id}
                        onClick={() => setSelected(o)}
                        className="w-full rounded border bg-white p-3 text-left"
                      >
                        <b>{o.produto?.identificacao}</b>
                        <p className="text-sm">{o.produto?.descricao || "—"}</p>
                        <p className="mt-2 text-sm">
                          OP {o.identificacao || o.n_op || o.id} · QTD{" "}
                          {o.quantidade || o.produto?.quantidade || 1}
                        </p>
                      </button>
                    ))
                  ) : (
                    <p className="p-4 text-sm text-slate-500">
                      Nenhuma OP neste posto.
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {selected && data && (
        <PreparationDialog
          op={selected}
          data={data}
          username={username}
          close={() => setSelected(null)}
          done={() => {
            setSelected(null);
            void reload();
          }}
          error={setError}
        />
      )}
    </main>
  );
}
function PreparationDialog({
  op,
  data,
  username,
  close,
  done,
  error,
}: {
  op: PreparationOrder;
  data: PreparationSnapshot;
  username: string;
  close: () => void;
  done: () => void;
  error: (x: string) => void;
}) {
  const [materials, setMaterials] = useState<PreparationMaterial[] | null>(
    null,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const stationId = preparationStation(op, data.programs, data.stations);
  const index = data.stations.findIndex((s) => s.id === stationId);
  const current = data.stations[index];
  const next = data.stations[index + 1];
  const reg = data.programs.find(
    (r) =>
      r.op_producao_id === op.id ||
      norm(r.numero_op) === norm(op.identificacao || op.n_op),
  );
  const code = op.produto?.identificacao || "";
  const opNo = op.identificacao || op.n_op || String(op.id);
  useEffect(() => {
    api
      .loadPreparationMaterials(opNo, code)
      .then((x) => setMaterials(x.itens || []))
      .catch((e) =>
        error(e instanceof Error ? e.message : "Falha ao carregar materiais."),
      );
  }, [opNo, code, error]);
  const finish = async () => {
    if (!current || !next) return;
    setBusy(true);
    try {
      await api.finishPreparation(
        {
          op_producao_id: op.id,
          numero_op: opNo,
          kanban_programacao_id: reg?.id || null,
          usuario: username,
          col_key: `prep-${current.id}`,
          posto_atual: current.nome,
          proximo_status: next.nome,
          operacao: next.nome,
        },
        { confirmed },
      );
      done();
    } catch (e) {
      error(e instanceof Error ? e.message : "Falha ao finalizar preparação.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-0 sm:p-5">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Detalhes da preparação"
        className="max-h-dvh w-full max-w-4xl overflow-auto bg-white p-4 sm:max-h-[92vh] sm:rounded-md"
      >
        <button
          aria-label="Fechar"
          onClick={close}
          className="float-right grid size-11 place-items-center"
        >
          <X />
        </button>
        <h2 className="text-xl font-bold">OP {opNo}</h2>
        <p>
          {code} — {op.produto?.descricao}
        </p>
        <p className="text-sm">
          Posto: <b>{current?.nome || "Não identificado"}</b>
          {reg?.observacao ? ` · Instrução: ${reg.observacao}` : ""}
        </p>
        <h3 className="mt-5 font-bold">Materiais da estrutura</h3>
        {materials === null ? (
          <p>Carregando estrutura…</p>
        ) : materials.length ? (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left">Código</th>
                  <th className="p-2 text-left">Descrição</th>
                  <th className="p-2 text-right">Quantidade</th>
                  <th className="p-2 text-left">Operação</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m, i) => (
                  <tr key={`${m.codigo}-${i}`} className="border-t">
                    <td className="p-2">
                      {m.codigo}
                      {m.customizado ? " · customizado" : ""}
                    </td>
                    <td className="p-2">{m.descricao}</td>
                    <td className="p-2 text-right">
                      {m.quantidade} {m.unidade}
                    </td>
                    <td className="p-2">{m.operacao || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-slate-600">
            Nenhum material encontrado na estrutura.
          </p>
        )}
        <section className="mt-5 space-y-3 rounded border border-amber-300 bg-amber-50 p-4">
          {next ? (
            <>
              <p>
                Próximo posto comprovado pelo plano: <b>{next.nome}</b>.
              </p>
              <label className="flex gap-3">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  Confirmo a OP, o posto atual, os materiais/instruções e o
                  avanço para {next.nome}.
                </span>
              </label>
              <button
                disabled={!confirmed || busy || Boolean(reg?.ri)}
                onClick={() => void finish()}
                className="min-h-11 w-full rounded bg-emerald-700 px-4 font-bold text-white disabled:opacity-40"
              >
                Finalizar operação
              </button>
              {reg?.ri && (
                <p className="text-sm text-amber-900">
                  Ação bloqueada: esta OP aguarda RI da Qualidade.
                </p>
              )}
            </>
          ) : (
            <p>
              Último posto do plano. A conclusão final/efeito em estoque não
              possui contrato PP específico comprovado nesta tela e permanece
              bloqueada.
            </p>
          )}
        </section>
      </section>
    </div>
  );
}
