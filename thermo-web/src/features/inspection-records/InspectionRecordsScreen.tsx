/* oxlint-disable react/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, Search, X } from "lucide-react";
import * as api from "../../services/inspectionRecordsGateway";
import type {
  InspectionAttachment,
  InspectionDetail,
  InspectionPending,
  InspectionPrepareInput,
} from "./types";
const columns = [
  ["solicitado", "Montagem hermética"],
  ["produzindo", "Montagem elétrica"],
  ["teste", "Teste"],
  ["inspecao_final", "Inspeção final"],
  ["embalagem", "Embalagem"],
] as const;
const norm = (v: unknown) =>
  String(v || "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
function attachments(item: {
  anexos?: InspectionAttachment[] | string;
  foto?: string | null;
  video?: string | null;
}) {
  let list: InspectionAttachment[] = [];
  if (Array.isArray(item.anexos)) list = item.anexos;
  else if (typeof item.anexos === "string")
    try {
      list = JSON.parse(item.anexos);
    } catch {
      list = [];
    }
  if (!list.length && item.foto)
    list.push({ url: item.foto, nome: "Foto", tipo: "foto" });
  if (!list.length && item.video)
    list.push({ url: item.video, nome: "Vídeo", tipo: "video" });
  return list.filter((x) => x?.url);
}
export function InspectionRecordsScreen({
  allowed = true,
}: {
  allowed?: boolean;
}) {
  const [queue, setQueue] = useState<InspectionPending[]>([]);
  const [selected, setSelected] = useState<InspectionPending | null>(null);
  const [detail, setDetail] = useState<InspectionDetail | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError("");
    try {
      setQueue((await api.loadInspectionQueue()).pendentes || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar RIs.");
    } finally {
      setLoading(false);
    }
  }, [allowed]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const filtered = useMemo(
    () =>
      queue.filter(
        (x) => !query || norm(JSON.stringify(x)).includes(norm(query)),
      ),
    [queue, query],
  );
  if (!allowed)
    return (
      <section
        role="alert"
        className="rounded border border-amber-300 bg-amber-50 p-5"
      >
        <h1 className="font-bold">Acesso não permitido</h1>
        <p>Seu perfil não possui permissão para registrar inspeções.</p>
      </section>
    );
  const open = async (item: InspectionPending) => {
    setSelected(item);
    setDetail(null);
    setError("");
    try {
      setDetail(await api.prepareInspection(inputFor(item)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao preparar RI.");
    }
  };
  return (
    <main className="mx-auto max-w-[1440px] space-y-4 p-3 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">
            Qualidade
          </p>
          <h1 className="text-2xl font-bold">Registro de inspeção</h1>
          <p className="text-sm text-slate-600">
            OPs com RI ativa, agrupadas pelo posto atual.
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
          placeholder="Pesquisar modelo, OP ou ordem"
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
      {loading && !queue.length ? (
        <p>Carregando inspeções pendentes…</p>
      ) : (
        <div className="flex snap-x gap-3 overflow-x-auto pb-3 lg:grid lg:grid-cols-3 xl:grid-cols-5">
          {columns.map(([key, label]) => {
            const items = filtered.filter((x) => x.col_key === key);
            return (
              <section
                key={key}
                className="min-w-[300px] snap-start rounded-md border bg-slate-50 lg:min-w-0"
              >
                <header className="flex justify-between border-b p-3">
                  <h2 className="font-bold">{label}</h2>
                  <span>{items.length}</span>
                </header>
                <div className="space-y-2 p-2">
                  {items.length ? (
                    items.map((item) => (
                      <button
                        key={item.op_producao_id}
                        onClick={() => void open(item)}
                        className="w-full rounded border bg-white p-3 text-left"
                      >
                        <b>{item.produto.identificacao}</b>
                        <p className="text-sm">
                          {item.produto.descricao || "—"}
                        </p>
                        <p className="mt-2 text-sm">
                          OP {item.numero_op} · QTD {item.qtde}
                        </p>
                        <span className="mt-2 inline-block text-xs font-bold text-indigo-700">
                          Registrar RI
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="p-4 text-sm text-slate-500">
                      Nenhuma OP aguardando RI.
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {selected && (
        <InspectionDialog
          item={selected}
          detail={detail}
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
function inputFor(item: InspectionPending): InspectionPrepareInput {
  return {
    op_producao_id: item.op_producao_id,
    op_iapp_id: item.op_producao_id,
    numero_op: item.numero_op,
    codigo: item.produto.identificacao,
    descricao: item.produto.descricao || "",
    kanban_local: item.posto,
  };
}
function InspectionDialog({
  item,
  detail,
  close,
  done,
  error,
}: {
  item: InspectionPending;
  detail: InspectionDetail | null;
  close: () => void;
  done: () => void;
  error: (x: string) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [failure, setFailure] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  if (!detail)
    return (
      <Modal close={close}>
        <p>Carregando critérios e ocorrências…</p>
      </Modal>
    );
  const release = async () => {
    setBusy(true);
    try {
      await api.registerAndReleaseInspection(
        inputFor(item),
        detail.check?.id || null,
        { confirmed },
      );
      done();
    } catch (e) {
      error(e instanceof Error ? e.message : "Falha ao liberar RI.");
    } finally {
      setBusy(false);
    }
  };
  const occurrence = async () => {
    if (!detail.check?.id) return;
    setBusy(true);
    try {
      await api.registerOccurrence(detail.check.id, failure, files, {
        confirmed,
      });
      done();
    } catch (e) {
      error(e instanceof Error ? e.message : "Falha ao registrar ocorrência.");
    } finally {
      setBusy(false);
    }
  };
  const canRelease = detail.ri_ativo && !detail.ja_registrado;
  return (
    <Modal close={close}>
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">RI · OP {item.numero_op}</h2>
          <p>
            {item.produto.identificacao} — {item.produto.descricao}
          </p>
          <p className="text-sm">
            Posto: <b>{item.posto}</b> · Status:{" "}
            <b>{detail.check?.status || "Aguardando registro"}</b>
          </p>
        </div>
        <section>
          <h3 className="font-bold">Critérios e evidências</h3>
          {detail.verificacoes?.length ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {detail.verificacoes.map((v, i) => (
                <article key={v.id || i} className="rounded border p-3">
                  <b>{v.check_nome}</b>
                  {v.descricao_check && (
                    <p className="text-sm text-slate-600">
                      {v.descricao_check}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {attachments(v).map((a, j) => (
                      <a
                        key={j}
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded bg-slate-100 px-2 py-1 text-sm underline"
                      >
                        {a.nome || "Evidência"}
                      </a>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-amber-800">
              Nenhum critério cadastrado para este posto.
            </p>
          )}
        </section>
        <section>
          <h3 className="font-bold">Ocorrências</h3>
          {detail.ocorrencias?.length ? (
            detail.ocorrencias.map((o) => (
              <article
                key={o.id}
                className="mt-2 rounded border border-red-200 bg-red-50 p-3"
              >
                <b>
                  #{o.id} · {o.falha_detectada}
                </b>
                <p className="text-sm">
                  {o.corrigido
                    ? `Corrigida por ${o.corrigido_por || "—"}`
                    : "Aberta"}
                </p>
                {attachments(o).map((a, j) => (
                  <a
                    key={j}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mr-2 text-sm underline"
                  >
                    {a.nome || "Evidência"}
                  </a>
                ))}
              </article>
            ))
          ) : (
            <p className="text-sm text-slate-600">
              Nenhuma ocorrência registrada.
            </p>
          )}
        </section>
        {detail.check?.id && (
          <section className="space-y-2 rounded border p-3">
            <h3 className="font-bold">
              <AlertTriangle className="mr-2 inline size-4" />
              Registrar falha
            </h3>
            <label className="block">
              Falha detectada
              <textarea
                value={failure}
                onChange={(e) => {
                  setFailure(e.target.value);
                  setConfirmed(false);
                }}
                className="mt-1 w-full rounded border p-2"
              />
            </label>
            <label className="block">
              Evidências (opcional)
              <input
                type="file"
                multiple
                onChange={(e) => {
                  setFiles(Array.from(e.target.files || []));
                  setConfirmed(false);
                }}
                className="mt-1 block w-full"
              />
            </label>
            <button
              disabled={!confirmed || !failure.trim() || busy}
              onClick={() => void occurrence()}
              className="min-h-11 rounded bg-red-700 px-4 font-bold text-white disabled:opacity-40"
            >
              Registrar ocorrência
            </button>
          </section>
        )}
        <label className="flex gap-3 rounded border border-amber-300 bg-amber-50 p-3">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            Confirmo a OP, o posto, os critérios/evidências e os efeitos da
            liberação em qualidade, produção e estoque.
          </span>
        </label>
        <button
          disabled={!confirmed || !canRelease || busy}
          onClick={() => void release()}
          className="min-h-11 w-full rounded bg-emerald-700 px-4 font-bold text-white disabled:opacity-40"
        >
          Registrar RI e liberar OP
        </button>
        {!canRelease && (
          <p className="text-sm text-slate-600">
            RI já liberada ou não está ativa; disponível somente para consulta.
          </p>
        )}
      </div>
    </Modal>
  );
}
function Modal({
  close,
  children,
}: {
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-0 sm:p-5">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Registro de inspeção"
        className="max-h-dvh w-full max-w-4xl overflow-auto bg-white p-4 sm:max-h-[92vh] sm:rounded-md"
      >
        <button
          aria-label="Fechar"
          onClick={close}
          className="float-right grid size-11 place-items-center"
        >
          <X />
        </button>
        {children}
      </section>
    </div>
  );
}
