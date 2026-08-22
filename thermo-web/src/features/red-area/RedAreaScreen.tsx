/* oxlint-disable react/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, Search, X } from "lucide-react";
import * as api from "../../services/redAreaGateway";
import type { RedAreaDecision, RedAreaItem, RedAreaProduct } from "./types";
export function RedAreaScreen({
  allowed = true,
  canWrite = false,
  currentUser = "",
}: {
  allowed?: boolean;
  canWrite?: boolean;
  currentUser?: string;
}) {
  const [items, setItems] = useState<RedAreaItem[]>([]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"entry" | "analysis" | "decision" | null>(
    null,
  );
  const [selected, setSelected] = useState<RedAreaItem | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError("");
    try {
      setItems((await api.loadRedArea(query)).itens || []);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Falha ao carregar Área Vermelha.",
      );
    } finally {
      setLoading(false);
    }
  }, [allowed, query]);
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
        <p>Seu perfil não possui permissão para consultar a Área Vermelha.</p>
      </section>
    );
  const open = (m: typeof mode, item?: RedAreaItem) => {
    setSelected(item || null);
    setMode(m);
  };
  return (
    <main className="mx-auto max-w-[1440px] space-y-4 p-3 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-red-700">
            Qualidade
          </p>
          <h1 className="text-2xl font-bold">Área Vermelha</h1>
          <p className="text-sm text-slate-600">
            Materiais reprovados e NIQs sob contenção.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void load()}
            className="min-h-11 rounded border px-4"
          >
            <RefreshCw className="mr-2 inline size-4" />
            Atualizar
          </button>
          {canWrite && (
            <button
              onClick={() => open("entry")}
              className="min-h-11 rounded bg-red-700 px-4 font-bold text-white"
            >
              Registrar NIQ
            </button>
          )}
        </div>
      </header>
      <label className="relative block">
        <span className="sr-only">
          Buscar código, descrição, OP, falha ou responsável
        </span>
        <Search className="absolute left-3 top-3 size-5" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar código, descrição, OP, falha ou responsável"
          className="min-h-11 w-full rounded border pl-10 pr-3"
        />
      </label>
      {!canWrite && (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          Modo somente consulta. Escritas exigem perfil Admin ou Qualidade
          confirmado pela integração.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-red-900"
        >
          {error}
        </p>
      )}
      {loading && !items.length ? (
        <p>Carregando materiais…</p>
      ) : items.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <article
              key={`${item.origem}-${item.id}`}
              className="rounded-md border bg-white p-4"
            >
              <div className="flex justify-between gap-2">
                <b>{item.codigo_produto || item.codigo}</b>
                <span className="rounded-full bg-red-100 px-2 py-1 text-xs">
                  {item.status_label || item.status}
                </span>
              </div>
              <p className="text-sm">{item.descricao || "—"}</p>
              <p className="mt-2 text-sm">
                {item.origem === "niq"
                  ? `OP ${item.numero_op || "—"} · ${item.descricao_falha || item.lote || "—"}`
                  : [item.numero_nfe, item.lote].filter(Boolean).join(" · ") ||
                    "Origem PIR"}
              </p>
              <p className="mt-2 text-xs text-slate-600">
                {item.ids_armazem ||
                  item.local_destino_nome ||
                  "7. AREA VERMELHA"}{" "}
                · por {item.definido_por || "—"}
              </p>
              {item.omie_trf_codigo && (
                <p className="text-xs">TRF Omie: {item.omie_trf_codigo}</p>
              )}
              <Evidence item={item} />
              {canWrite && item.origem === "niq" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.status === "registrado" && (
                    <button
                      onClick={() => open("analysis", item)}
                      className="min-h-11 rounded bg-violet-700 px-3 font-bold text-white"
                    >
                      Registrar análise
                    </button>
                  )}
                  {item.status === "aguardando_aprovacao" && (
                    <button
                      onClick={() => open("decision", item)}
                      className="min-h-11 rounded bg-slate-800 px-3 font-bold text-white"
                    >
                      Decidir
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="rounded border p-6 text-center text-slate-600">
          Nenhum item na Área Vermelha.
        </p>
      )}
      {mode === "entry" && (
        <EntryDialog
          canWrite={canWrite}
          close={() => setMode(null)}
          done={() => {
            setMode(null);
            void load();
          }}
          error={setError}
        />
      )}{" "}
      {mode === "analysis" && selected && (
        <AnalysisDialog
          item={selected}
          canWrite={canWrite}
          currentUser={currentUser}
          close={() => setMode(null)}
          done={() => {
            setMode(null);
            void load();
          }}
          error={setError}
        />
      )}{" "}
      {mode === "decision" && selected && (
        <DecisionDialog
          item={selected}
          canWrite={canWrite}
          close={() => setMode(null)}
          done={() => {
            setMode(null);
            void load();
          }}
          error={setError}
        />
      )}
    </main>
  );
}
function Evidence({ item }: { item: RedAreaItem }) {
  const links = [
    [item.foto_url, "Foto NIQ"],
    [item.video_url, "Vídeo NIQ"],
    [item.analise_foto_url, "Foto análise"],
    [item.analise_video_url, "Vídeo análise"],
  ].filter((x) => x[0]);
  return links.length ? (
    <div className="mt-2 flex flex-wrap gap-2">
      {links.map(([url, label]) => (
        <a
          key={label}
          href={url || ""}
          target="_blank"
          rel="noreferrer"
          className="text-sm underline"
        >
          {label}
        </a>
      ))}
    </div>
  ) : null;
}
function Modal({
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
        className="max-h-dvh w-full max-w-2xl overflow-auto bg-white p-4 sm:max-h-[92vh] sm:rounded-md"
      >
        <button
          aria-label="Fechar"
          onClick={close}
          className="float-right grid size-11 place-items-center"
        >
          <X />
        </button>
        <h2 className="text-xl font-bold">{title}</h2>
        {children}
      </section>
    </div>
  );
}
function Confirm({
  phrase,
  value,
  set,
}: {
  phrase: string;
  value: string;
  set: (x: string) => void;
}) {
  return (
    <label className="block rounded border border-amber-300 bg-amber-50 p-3">
      Digite <b>{phrase}</b>
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        className="mt-2 min-h-11 w-full rounded border px-3"
      />
    </label>
  );
}
function EntryDialog({
  canWrite,
  close,
  done,
  error,
}: {
  canWrite: boolean;
  close: () => void;
  done: () => void;
  error: (x: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<RedAreaProduct[]>([]);
  const [product, setProduct] = useState<RedAreaProduct | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [failure, setFailure] = useState("");
  const [op, setOp] = useState("");
  const [origin, setOrigin] = useState("10431538872");
  const [fotos, setFotos] = useState<File[]>([]);
  const [videos, setVideos] = useState<File[]>([]);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (search.length < 2) return;
    const id = setTimeout(
      () =>
        api
          .searchRedAreaProducts(search)
          .then(setProducts)
          .catch(() => setProducts([])),
      220,
    );
    return () => clearTimeout(id);
  }, [search]);
  const submit = async () => {
    if (!product) return;
    setBusy(true);
    try {
      await api.createRedAreaEntry(
        {
          codigo: product.codigo,
          codigo_produto: String(product.codigo_produto || ""),
          descricao: product.descricao,
          quantidade: Number(quantity.replace(",", ".")),
          descricao_falha: failure,
          produto_grupo: "Área vermelha",
          numero_op: op,
          local_origem_codigo: origin,
          fotos,
          videos,
        },
        { canWrite, confirmation: { confirmed: true, phrase } },
      );
      done();
    } catch (e) {
      error(e instanceof Error ? e.message : "Falha ao registrar NIQ.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Registrar NIQ na Área Vermelha" close={close}>
      <div className="mt-4 space-y-3">
        <p className="rounded bg-red-50 p-3 text-sm">
          <AlertTriangle className="mr-2 inline size-4" />
          Esta ação transfere estoque da origem para o armazém 7 na Omie. Se o
          upload falhar depois, a entrada pode permanecer registrada sem mídia.
        </p>
        <label className="block">
          Pesquisar produto
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setProduct(null);
            }}
            className="mt-1 min-h-11 w-full rounded border px-3"
          />
        </label>
        {!product && products.length > 0 && (
          <div className="max-h-48 overflow-auto rounded border">
            {products.map((p) => (
              <button
                key={`${p.codigo}-${p.codigo_produto}`}
                onClick={() => {
                  setProduct(p);
                  setSearch(p.codigo);
                  setProducts([]);
                }}
                className="block w-full border-b p-3 text-left"
              >
                <b>{p.codigo}</b> · {p.descricao}
              </button>
            ))}
          </div>
        )}
        <label className="block">
          Armazém de origem
          <input
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className="mt-1 min-h-11 w-full rounded border px-3"
          />
        </label>
        <label className="block">
          Número da OP (opcional)
          <input
            value={op}
            onChange={(e) => setOp(e.target.value)}
            className="mt-1 min-h-11 w-full rounded border px-3"
          />
        </label>
        <label className="block">
          Quantidade
          <input
            value={quantity}
            inputMode="decimal"
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1 min-h-11 w-full rounded border px-3"
          />
        </label>
        <label className="block">
          Descrição da falha
          <textarea
            value={failure}
            onChange={(e) => setFailure(e.target.value)}
            className="mt-1 w-full rounded border p-3"
          />
        </label>
        <label className="block">
          Fotos
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFotos(Array.from(e.target.files || []))}
          />
        </label>
        <label className="block">
          Vídeos
          <input
            type="file"
            accept="video/*"
            multiple
            onChange={(e) => setVideos(Array.from(e.target.files || []))}
          />
        </label>
        <Confirm
          phrase="TRANSFERIR PARA ÁREA VERMELHA"
          value={phrase}
          set={setPhrase}
        />
        <button
          disabled={
            busy ||
            !product ||
            !failure.trim() ||
            phrase !== "TRANSFERIR PARA ÁREA VERMELHA"
          }
          onClick={() => void submit()}
          className="min-h-11 w-full rounded bg-red-700 font-bold text-white disabled:opacity-40"
        >
          Transferir e registrar NIQ
        </button>
      </div>
    </Modal>
  );
}
function AnalysisDialog({
  item,
  canWrite,
  currentUser,
  close,
  done,
  error,
}: {
  item: RedAreaItem;
  canWrite: boolean;
  currentUser: string;
  close: () => void;
  done: () => void;
  error: (x: string) => void;
}) {
  const [user, setUser] = useState(currentUser);
  const [users, setUsers] = useState<string[]>([]);
  const [obs, setObs] = useState("");
  const [fotos, setFotos] = useState<File[]>([]);
  const [videos, setVideos] = useState<File[]>([]);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.submitRedAreaAnalysis(
        item.id,
        { analise_por: user, analise_obs: obs, fotos, videos },
        { canWrite, confirmation: { confirmed: true, phrase } },
      );
      done();
    } catch (e) {
      error(e instanceof Error ? e.message : "Falha ao registrar análise.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    api
      .loadRedAreaUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);
  return (
    <Modal title={`Análise NIQ #${item.id}`} close={close}>
      <div className="mt-4 space-y-3">
        <p>
          Somente NIQ em estado Registrado. O próximo estado será Aguardando
          aprovação.
        </p>
        <label className="block">
          Responsável
          <select
            value={user}
            onChange={(e) => setUser(e.target.value)}
            className="mt-1 min-h-11 w-full rounded border px-3"
          >
            <option value="">Selecione</option>
            {currentUser && !users.includes(currentUser) && (
              <option>{currentUser}</option>
            )}
            {users.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          Fotos da análise
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFotos(Array.from(e.target.files || []))}
          />
        </label>
        <label className="block">
          Vídeos da análise
          <input
            type="file"
            accept="video/*"
            multiple
            onChange={(e) => setVideos(Array.from(e.target.files || []))}
          />
        </label>
        <label className="block">
          Observação
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            className="mt-1 w-full rounded border p-3"
          />
        </label>
        <Confirm phrase="ENVIAR ANÁLISE" value={phrase} set={setPhrase} />
        <button
          disabled={busy || !user.trim() || phrase !== "ENVIAR ANÁLISE"}
          onClick={() => void submit()}
          className="min-h-11 w-full rounded bg-violet-700 font-bold text-white disabled:opacity-40"
        >
          Enviar análise
        </button>
      </div>
    </Modal>
  );
}
function DecisionDialog({
  item,
  canWrite,
  close,
  done,
  error,
}: {
  item: RedAreaItem;
  canWrite: boolean;
  close: () => void;
  done: () => void;
  error: (x: string) => void;
}) {
  const [decision, setDecision] = useState<RedAreaDecision | null>(null);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const phrases = {
    scrap: "CONFIRMAR SCRAP",
    retrabalho: "CONFIRMAR RETRABALHO",
    liberar: "CONFIRMAR LIBERAÇÃO",
  };
  const submit = async () => {
    if (!decision) return;
    setBusy(true);
    try {
      await api.decideRedAreaItem(item.id, decision, {
        canWrite,
        confirmation: { confirmed: true, phrase },
      });
      done();
    } catch (e) {
      error(e instanceof Error ? e.message : "Falha ao decidir NIQ.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Decisão NIQ #${item.id}`} close={close}>
      <div className="mt-4 space-y-3">
        <p>Somente NIQ em Aguardando aprovação.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {(["scrap", "retrabalho", "liberar"] as RedAreaDecision[]).map(
            (d) => (
              <button
                key={d}
                onClick={() => {
                  setDecision(d);
                  setPhrase("");
                }}
                className={`min-h-11 rounded border ${decision === d ? "bg-slate-800 text-white" : ""}`}
              >
                {d === "scrap"
                  ? "Scrap"
                  : d === "retrabalho"
                    ? "Retrabalho"
                    : "Liberar"}
              </button>
            ),
          )}
        </div>
        {decision && (
          <p className="rounded bg-amber-50 p-3 text-sm">
            {decision === "scrap"
              ? "Gera SAI scrap na Omie antes de gravar Scrapado. Se a Omie falhar, o estado não muda."
              : "Altera somente o status; não há saída ou transferência de estoque comprovada neste contrato."}
          </p>
        )}
        {decision && (
          <Confirm phrase={phrases[decision]} value={phrase} set={setPhrase} />
        )}
        <button
          disabled={
            busy || !decision || phrase !== (decision ? phrases[decision] : "")
          }
          onClick={() => void submit()}
          className="min-h-11 w-full rounded bg-red-700 font-bold text-white disabled:opacity-40"
        >
          Confirmar decisão
        </button>
      </div>
    </Modal>
  );
}
