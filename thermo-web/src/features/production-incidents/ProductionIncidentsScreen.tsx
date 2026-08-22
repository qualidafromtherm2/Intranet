import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Image,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Video,
} from "lucide-react";
import { useEffect, useState } from "react";
import * as api from "../../services/productionIncidentsGateway";
import type {
  IncidentAttachment,
  IncidentCounts,
  IncidentStatusFilter,
  ProductionIncident,
} from "./types";

export function normalizeIncidentAttachments(item: ProductionIncident) {
  let list: IncidentAttachment[] = [];
  if (Array.isArray(item.anexos)) list = item.anexos;
  else if (typeof item.anexos === "string" && item.anexos.trim()) {
    try {
      list = JSON.parse(item.anexos) as IncidentAttachment[];
    } catch {
      list = [];
    }
  }
  list = list.filter((attachment) => attachment?.url);
  if (!list.length) {
    if (item.foto) list.push({ url: item.foto, tipo: "foto", nome: "Foto" });
    if (item.video)
      list.push({ url: item.video, tipo: "video", nome: "Vídeo" });
  }
  return list;
}
const corrected = (item: ProductionIncident) =>
  item.corrigido === true ||
  item.corrigido === "t" ||
  item.corrigido === "true";
const displayDate = (value?: string | null) =>
  value ? String(value).replace("T", " ").slice(0, 16) : "—";
function Attachment({ attachment }: { attachment: IncidentAttachment }) {
  const type = String(attachment.tipo || "").toLowerCase();
  const photo =
    type === "foto" || /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(attachment.url);
  const video =
    type === "video" || /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(attachment.url);
  return (
    <a
      className="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-xs text-sky-800"
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {photo ? (
        <Image className="size-3" />
      ) : video ? (
        <Video className="size-3" />
      ) : (
        <FileText className="size-3" />
      )}
      {attachment.nome || "Arquivo"}
      <ExternalLink className="size-3" />
    </a>
  );
}
function IncidentCard({
  incident,
  canWrite,
  onCorrect,
}: {
  incident: ProductionIncident;
  canWrite: boolean;
  onCorrect: (incident: ProductionIncident) => void;
}) {
  const done = corrected(incident);
  return (
    <article
      className={`rounded-lg border p-4 ${done ? "border-emerald-200 bg-emerald-50/60" : "border-red-200 bg-red-50/60"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-slate-500">
            #{incident.id} · OP{" "}
            {incident.numero_op || incident.op_iapp_id || "—"}
          </p>
          <h2
            className={`font-semibold ${done ? "text-emerald-900" : "text-red-900"}`}
          >
            {incident.falha_detectada || "—"}
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Produto {incident.codigo_produto || "—"} · Registrado por{" "}
            {incident.usuario || "—"} · {displayDate(incident.created_at)}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${done ? "border-emerald-300 text-emerald-800" : "border-red-300 text-red-800"}`}
        >
          {done ? (
            <CheckCircle2 className="size-3" />
          ) : (
            <AlertTriangle className="size-3" />
          )}
          {done ? "Corrigida" : "Aberta"}
        </span>
      </div>
      {done && (
        <p className="mt-2 text-xs text-emerald-800">
          Liberada por <b>{incident.corrigido_por || "—"}</b> em{" "}
          {displayDate(incident.corrigido_em)}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {normalizeIncidentAttachments(incident).map((attachment, index) => (
          <Attachment
            key={`${attachment.url}-${index}`}
            attachment={attachment}
          />
        ))}
      </div>
      {!done && canWrite && (
        <button
          className="thermo-button thermo-button-secondary mt-3"
          type="button"
          onClick={() => onCorrect(incident)}
        >
          <CheckCircle2 className="size-4" />
          Marcar como corrigida
        </button>
      )}
    </article>
  );
}

function ConfirmCorrection({
  incident,
  close,
  done,
}: {
  incident: ProductionIncident;
  close: () => void;
  done: () => void;
}) {
  const expected = `CORRIGIR OCORRENCIA ${incident.id}`;
  const [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api.correctProductionIncident(incident.id, confirmation);
      done();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao corrigir.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Confirmar correção"
        className="w-full max-w-lg rounded-lg bg-white p-5"
      >
        <h2 className="font-bold text-thermo-navy">
          Confirmar correção da ocorrência #{incident.id}
        </h2>
        <p className="mt-2 text-sm text-red-700">
          Esta ação libera a ocorrência operacional e envia notificação. Ela não
          anexa nova evidência.
        </p>
        <label className="mt-4 block text-sm">
          Digite <b>{expected}</b>
          <input
            className="thermo-input mt-1 w-full"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
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
            {busy ? "Corrigindo…" : "Confirmar correção"}
          </button>
        </div>
      </section>
    </div>
  );
}

function NewIncident({ close, done }: { close: () => void; done: () => void }) {
  const [op, setOp] = useState(""),
    [number, setNumber] = useState(""),
    [code, setCode] = useState(""),
    [failure, setFailure] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const id = Number(op);
  const expected = `REGISTRAR OCORRENCIA ${op}`;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api.createProductionIncident(
        {
          op_producao_id: id,
          numero_op: number,
          codigo: code,
          falha_detectada: failure,
          arquivos: files,
        },
        confirmation,
      );
      done();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Falha ao registrar.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Nova ocorrência"
        className="mx-auto my-8 w-full max-w-xl rounded-lg bg-white p-5"
      >
        <h2 className="font-bold text-thermo-navy">
          Registrar ocorrência de produção
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          O registro cria uma NIQ, envia notificações e pode fazer upload das
          evidências selecionadas.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            ID interno da OP
            <input
              type="number"
              min="1"
              className="thermo-input mt-1 w-full"
              value={op}
              onChange={(event) => {
                setOp(event.target.value);
                setConfirmation("");
              }}
            />
          </label>
          <label className="text-sm">
            Número visível da OP
            <input
              className="thermo-input mt-1 w-full"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Código do produto
            <input
              className="thermo-input mt-1 w-full"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Falha detectada
            <textarea
              className="thermo-input mt-1 min-h-24 w-full"
              value={failure}
              onChange={(event) => setFailure(event.target.value)}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Evidências (até 20 arquivos no contrato)
            <input
              type="file"
              multiple
              className="mt-1 block w-full text-sm"
              onChange={(event) =>
                setFiles(Array.from(event.target.files || []).slice(0, 20))
              }
            />
            <span className="text-xs text-slate-500">
              {files.length} arquivo(s) selecionado(s). O upload só ocorre após
              confirmação.
            </span>
          </label>
          <label className="text-sm sm:col-span-2">
            Digite <b>{expected || "REGISTRAR OCORRENCIA [ID]"}</b>
            <input
              className="thermo-input mt-1 w-full"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="thermo-button thermo-button-secondary"
            onClick={close}
          >
            Cancelar
          </button>
          <button
            className="thermo-button thermo-button-primary"
            disabled={
              busy ||
              !Number.isInteger(id) ||
              id <= 0 ||
              confirmation !== expected
            }
            onClick={() => void submit()}
          >
            {busy ? "Registrando…" : "Registrar ocorrência"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ProductionIncidentsScreen({
  allowed = true,
  canWrite = false,
}: {
  allowed?: boolean;
  canWrite?: boolean;
}) {
  const [rows, setRows] = useState<ProductionIncident[]>([]),
    [counts, setCounts] = useState<IncidentCounts>({
      total: 0,
      aberta: 0,
      corrigida: 0,
    }),
    [status, setStatus] = useState<IncidentStatusFilter>(""),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(allowed),
    [error, setError] = useState(""),
    [newOpen, setNewOpen] = useState(false),
    [correcting, setCorrecting] = useState<ProductionIncident | null>(null);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.loadProductionIncidents(query, status);
      setRows(data.ocorrencias || []);
      setCounts(data.contagens || { total: 0, aberta: 0, corrigida: 0 });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Falha ao carregar ocorrências.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    const timer = setTimeout(() => void load(), 280);
    return () => clearTimeout(timer);
  }, [allowed, query, status]);
  if (!allowed)
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <h1 className="font-bold text-amber-900">
          Ocorrências de produção bloqueadas
        </h1>
        <p className="text-sm text-amber-800">
          Permissão necessária: <code>side:producao:ocorrencias</code>.
        </p>
      </section>
    );
  return (
    <main aria-label="Ocorrências de produção" className="space-y-4">
      <header className="rounded-lg border border-thermo-border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-red-700">
              Produção · RI / NIQ
            </p>
            <h1 className="text-xl font-bold text-thermo-navy">
              Ocorrências registradas
            </h1>
            <p className="text-sm text-slate-500">
              Falhas detectadas em inspeções e ordens de produção.
            </p>
          </div>
          <div className="flex gap-2">
            {canWrite && (
              <button
                className="thermo-button thermo-button-primary"
                onClick={() => setNewOpen(true)}
              >
                <Plus className="size-4" />
                Nova ocorrência
              </button>
            )}
            <button
              className="thermo-button thermo-button-secondary"
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
        </div>
      </header>
      <section className="rounded-lg border border-thermo-border bg-white p-4">
        <label className="relative block">
          <Search className="absolute left-3 top-3 size-4 text-slate-400" />
          <span className="sr-only">Buscar ocorrências</span>
          <input
            aria-label="Buscar ocorrências"
            className="thermo-input w-full pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Falha, OP, produto ou usuário"
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ["", "Todas", counts.total],
              ["aberta", "Abertas", counts.aberta],
              ["corrigida", "Corrigidas", counts.corrigida],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              className={`rounded-md border px-3 py-2 text-sm ${status === value ? "border-red-300 bg-red-50 text-red-800" : "bg-white text-slate-700"}`}
              onClick={() => setStatus(value)}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      </section>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <p className="text-sm text-slate-600">
        {loading
          ? "Carregando ocorrências reais…"
          : `${rows.length} ocorrência(s) — mais nova primeiro.`}
      </p>
      {!loading && !error && !rows.length && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
          Nenhuma ocorrência registrada.
        </div>
      )}
      <section className="grid gap-3 lg:grid-cols-2">
        {rows.map((incident) => (
          <IncidentCard
            key={incident.id}
            incident={incident}
            canWrite={canWrite}
            onCorrect={setCorrecting}
          />
        ))}
      </section>
      {newOpen && (
        <NewIncident
          close={() => setNewOpen(false)}
          done={() => {
            setNewOpen(false);
            void load();
          }}
        />
      )}
      {correcting && (
        <ConfirmCorrection
          incident={correcting}
          close={() => setCorrecting(null)}
          done={() => {
            setCorrecting(null);
            void load();
          }}
        />
      )}
    </main>
  );
}
