/* oxlint-disable react/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileSpreadsheet, RefreshCw, Search } from "lucide-react";
import * as api from "../../services/productionTestsGateway";
import type { TestDetail, TestReport, TestSummary } from "./types";
const fmt = (v: unknown, d = 1) =>
  v == null || v === ""
    ? "—"
    : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: d });
const date = (v?: string) => (v ? new Date(v).toLocaleString("pt-BR") : "—");
export function ProductionTestsScreen({
  allowed = true,
}: {
  allowed?: boolean;
}) {
  const [summary, setSummary] = useState<TestSummary | null>(null);
  const [reports, setReports] = useState<TestReport[]>([]);
  const [detail, setDetail] = useState<TestDetail | null>(null);
  const [query, setQuery] = useState("");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError("");
    try {
      const [s, r] = await Promise.all([
        api.loadTestsSummary(),
        api.loadTestReports({ q: query, modelo: model, limit: 100 }),
      ]);
      setSummary(s);
      setReports(r.relatorios || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar testes.");
    } finally {
      setLoading(false);
    }
  }, [allowed, query, model]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!allowed)
    return (
      <section
        role="alert"
        className="rounded border border-amber-300 bg-amber-50 p-5"
      >
        <h1 className="font-bold">Acesso não permitido</h1>
        <p>Seu perfil não possui permissão para consultar Testes.</p>
      </section>
    );
  const open = async (id: number) => {
    setLoading(true);
    setError("");
    try {
      setDetail(await api.loadTestDetail(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao abrir relatório.");
    } finally {
      setLoading(false);
    }
  };
  if (detail)
    return <TestDetailView data={detail} back={() => setDetail(null)} />;
  return (
    <main className="mx-auto max-w-[1440px] space-y-4 p-3 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
            Produção · somente consulta
          </p>
          <h1 className="text-2xl font-bold">Testes de bombas de calor</h1>
          <p className="text-sm text-slate-600">
            Relatórios importados, leituras e diagnóstico calculado.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="min-h-11 rounded bg-slate-800 px-4 font-bold text-white"
        >
          <RefreshCw className="mr-2 inline size-4" />
          Atualizar
        </button>
      </header>
      {summary && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {[
            ["Relatórios", summary.totais.total_relatorios],
            ["Leituras", summary.totais.total_leituras],
            ["Modelos", summary.totais.total_modelos],
            ["OPs", summary.totais.total_ops],
          ].map(([l, v]) => (
            <div key={String(l)} className="rounded border bg-slate-50 p-3">
              <span className="text-xs font-bold uppercase text-slate-500">
                {String(l)}
              </span>
              <strong className="block text-2xl">{fmt(v, 0)}</strong>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_260px]">
        <label className="relative">
          <span className="sr-only">
            Pesquisar OP, modelo, linha, operador ou arquivo
          </span>
          <Search className="absolute left-3 top-3 size-5" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar OP, modelo, linha, operador ou arquivo"
            className="min-h-11 w-full rounded border pl-10 pr-3"
          />
        </label>
        <label>
          <span className="sr-only">Filtrar modelo</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="min-h-11 w-full rounded border px-2"
          >
            <option value="">Todos os modelos</option>
            {summary?.maquinas.map((m) => (
              <option key={m.modelo}>{m.modelo}</option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-red-900"
        >
          {error}
        </p>
      )}
      {loading && !reports.length ? (
        <p>Carregando relatórios…</p>
      ) : reports.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => void open(r.id)}
              className="rounded-md border bg-white p-4 text-left"
            >
              <div className="flex justify-between gap-2">
                <b>
                  OP {r.num_op || "—"} · {r.modelo || "—"}
                </b>
                <span className="text-xs text-slate-500">#{r.id}</span>
              </div>
              <p className="text-sm text-slate-600">
                {r.linha || "—"} · {r.operador || "—"} · {date(r.criado_em)}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <Metric
                  label="Leituras"
                  value={fmt(r.leituras_count || r.total_registros, 0)}
                />
                <Metric label="COP médio" value={fmt(r.cop_medio)} />
                <Metric label="ΔT médio" value={fmt(r.delta_t_medio)} />
              </div>
              {r.arquivo_xlsx && (
                <p className="mt-3 truncate text-xs text-slate-500">
                  <FileSpreadsheet className="mr-1 inline size-4" />
                  {r.arquivo_xlsx}
                </p>
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded border p-6 text-center text-slate-600">
          Nenhum relatório encontrado.
        </p>
      )}
    </main>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-slate-50 p-2">
      <span className="block text-xs text-slate-500">{label}</span>
      <b>{value}</b>
    </div>
  );
}
function TestDetailView({
  data,
  back,
}: {
  data: TestDetail;
  back: () => void;
}) {
  const r = data.relatorio;
  const d = data.diagnostico || {
    veredicto: "atencao",
    ok: [],
    alertas: [],
    infos: [],
  };
  const badge =
    d.veredicto === "aprovado"
      ? "bg-emerald-100 text-emerald-900"
      : d.veredicto === "reprovado"
        ? "bg-red-100 text-red-900"
        : "bg-amber-100 text-amber-900";
  return (
    <main className="mx-auto max-w-[1440px] space-y-4 p-3 sm:p-6">
      <button onClick={back} className="min-h-11 rounded border px-4">
        <ArrowLeft className="mr-2 inline size-4" />
        Voltar
      </button>
      <header className="rounded border p-4">
        <h1 className="text-xl font-bold">
          OP {r.num_op || "—"} · {r.modelo || "—"}{" "}
          <span className={`ml-2 rounded-full px-2 py-1 text-xs ${badge}`}>
            {d.veredicto === "reprovado"
              ? "Atenção crítica"
              : d.veredicto === "aprovado"
                ? "Aprovado"
                : "Requer atenção"}
          </span>
        </h1>
        <p className="text-sm text-slate-600">
          {r.linha} · Operador {r.operador || "—"} · {date(r.criado_em)}
        </p>
        {r.arquivo_xlsx && (
          <p className="text-sm">Origem/evidência: {r.arquivo_xlsx}</p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Veredicto calculado das leituras; não representa decisão gravada.
        </p>
      </header>
      <section className="grid gap-3 lg:grid-cols-3">
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3">
          <h2 className="font-bold">Conformes</h2>
          {d.ok.map((x, i) => (
            <p key={i} className="mt-2 text-sm">
              {x}
            </p>
          ))}
        </div>
        <div className="rounded border border-red-200 bg-red-50 p-3">
          <h2 className="font-bold">Alertas</h2>
          {d.alertas.map((x, i) => (
            <p key={i} className="mt-2 text-sm">
              {x.texto}
            </p>
          ))}
        </div>
        <div className="rounded border bg-slate-50 p-3">
          <h2 className="font-bold">Informações</h2>
          {d.infos.map((x, i) => (
            <p key={i} className="mt-2 text-sm">
              {x}
            </p>
          ))}
        </div>
      </section>
      <section>
        <h2 className="font-bold">Roteiro observado: fases das leituras</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {[...new Set(data.leituras.map((x) => x.fase).filter(Boolean))].map(
            (x) => (
              <span
                key={x}
                className="rounded-full bg-slate-100 px-3 py-1 text-sm"
              >
                {x}
              </span>
            ),
          )}
        </div>
      </section>
      <section>
        <h2 className="font-bold">Resultados e medições</h2>
        <div className="mt-2 overflow-x-auto rounded border">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                {[
                  "#",
                  "Fase",
                  "Data/hora",
                  "T amb",
                  "T entrada",
                  "T saída",
                  "ΔT",
                  "COP",
                  "kW aq.",
                  "kW cons.",
                  "Vazão",
                  "P alta",
                  "P baixa",
                  "Tensão",
                  "Corrente",
                ].map((x) => (
                  <th key={x} className="whitespace-nowrap p-2 text-left">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.leituras.map((x, i) => (
                <tr key={x.id || i} className="border-t">
                  <td className="p-2">{i + 1}</td>
                  <td className="p-2">{x.fase || "—"}</td>
                  <td className="p-2">{x.data_hora || "—"}</td>
                  {[
                    x.temp_ambiente,
                    x.temp_entrada,
                    x.temp_saida,
                    x.temp_dif,
                    x.cop,
                    x.kw_aquecimento,
                    x.kw_consumo,
                    x.vazao,
                    x.pressao_alta,
                    x.pressao_baixa,
                    x.tensao,
                    x.corrente,
                  ].map((v, j) => (
                    <td key={j} className="p-2">
                      {fmt(v, 2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {data.leituras_ftibr?.length > 0 && (
        <section>
          <h2 className="font-bold">Evidências FTIBR</h2>
          <p className="text-sm text-slate-600">
            {data.leituras_ftibr.length} leitura(s) completas vinculadas ao
            relatório.
          </p>
        </section>
      )}
    </main>
  );
}
