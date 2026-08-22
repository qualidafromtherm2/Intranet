import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, ExternalLink, FileText, PackageCheck, RefreshCw, Send, ShieldAlert, Trash2 } from "lucide-react"
import { deleteSacShippingRequest, listSacShippingRequests, updateSacShippingStatus } from "../../services/sacShippingRequestGateway"
import type { SacShippingItem, SacShippingRequest } from "./types"

type Props = { allowed?: boolean; canWrite?: boolean; canCreate?: boolean }

function itemsOf(row: SacShippingRequest): SacShippingItem[] {
  if (Array.isArray(row.conteudo)) return row.conteudo
  if (!row.conteudo || typeof row.conteudo !== "string") return []
  try {
    const parsed: unknown = JSON.parse(row.conteudo)
    return Array.isArray(parsed) ? parsed.filter((item): item is SacShippingItem => Boolean(item && typeof item === "object" && "conteudo" in item)) : []
  } catch { return [{ conteudo: row.conteudo, quantidade: "—" }] }
}

function formatDate(value?: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR")
}

function statusTone(status?: string | null) {
  if (status === "Enviado") return "border-emerald-200 bg-emerald-50 text-emerald-800"
  if (status === "Excluído") return "border-slate-200 bg-slate-100 text-slate-600"
  return "border-amber-200 bg-amber-50 text-amber-800"
}

export function SacShippingRequestScreen({ allowed = true, canWrite = false, canCreate = false }: Props) {
  const [rows, setRows] = useState<SacShippingRequest[]>([])
  const [loading, setLoading] = useState(allowed)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SacShippingRequest | null>(null)
  const [pendingAction, setPendingAction] = useState<"send" | "delete" | null>(null)
  const [phrase, setPhrase] = useState("")
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!allowed) return
    setLoading(true); setError(null)
    try { setRows((await listSacShippingRequests()).rows || []) }
    catch (e) { setError(e instanceof Error ? e.message : "Falha ao carregar solicitações.") }
    finally { setLoading(false) }
  }, [allowed])
  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const counts = useMemo(() => ({ total: rows.length, pending: rows.filter((r) => r.rastreio_status !== "Enviado" && r.rastreio_status !== "Excluído").length, sent: rows.filter((r) => r.rastreio_status === "Enviado").length }), [rows])
  if (!allowed) return <section role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-950"><ShieldAlert className="size-6" /><h1 className="mt-2 text-xl font-bold">Acesso não permitido</h1><p className="mt-1 text-sm">Sua árvore de permissões não liberou Solicitação de envio SAC.</p></section>

  const expected = selected && pendingAction === "send" ? `MARCAR ENVIO ${selected.id} COMO ENVIADO` : selected ? `EXCLUIR ENVIO ${selected.id}` : ""
  async function confirmAction() {
    if (!selected || !pendingAction) return
    setSaving(true); setError(null)
    try {
      if (pendingAction === "send") await updateSacShippingStatus(selected.id, "Enviado", { canWrite, confirmation: { confirmed: true, phrase } })
      else await deleteSacShippingRequest(selected.id, { canWrite, confirmation: { confirmed: true, phrase } })
      setPendingAction(null); setSelected(null); setPhrase(""); await load()
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao concluir ação.") }
    finally { setSaving(false) }
  }

  return <section className="space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-[.16em] text-slate-500">SAC · Logística</p><h1 className="mt-1 text-2xl font-bold text-thermo-navy">Solicitações de envio</h1><p className="mt-1 text-sm text-slate-600">Itens, destino operacional, separação, anexos e rastreabilidade do usuário autenticado.</p></div>
      <div className="flex gap-2"><button type="button" className="thermo-button thermo-button-secondary" onClick={() => void load()} disabled={loading}><RefreshCw className="size-4" />Atualizar</button><button type="button" className="thermo-button thermo-button-primary" disabled title={!canCreate ? "Criação não autorizada" : "Fluxo de postagem exige integração dedicada"}><Send className="size-4" />Nova solicitação</button></div>
    </header>
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"><AlertTriangle className="mr-2 inline size-4" />Postagem VIPP, upload, geração e impressão de etiquetas permanecem bloqueados nesta migração. Os links abaixo apenas abrem anexos já existentes.</div>
    {!canWrite ? <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">Modo somente consulta. Alterações logísticas exigem permissão explícita.</div> : null}
    {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
    <div className="grid grid-cols-3 gap-2">{[["Registros", counts.total], ["Pendentes", counts.pending], ["Enviados", counts.sent]].map(([label, value]) => <div key={label} className="rounded-lg border border-thermo-border bg-white p-3"><div className="text-xs font-bold uppercase text-slate-500">{label}</div><div className="mt-1 text-xl font-bold text-thermo-navy">{value}</div></div>)}</div>
    {loading ? <div className="rounded-lg border border-thermo-border bg-white p-8 text-center text-sm text-slate-500">Carregando solicitações…</div> : rows.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center"><PackageCheck className="mx-auto size-7 text-slate-400" /><p className="mt-2 font-semibold text-thermo-navy">Nenhuma solicitação encontrada</p><p className="text-sm text-slate-500">Não há registros associados ao usuário autenticado.</p></div> : <div className="grid gap-3">{rows.map((row) => {
      const items = itemsOf(row); const attachments = [row.etiqueta_url, row.declaracao_url, ...(row.anexos || [])].filter((url, index, all): url is string => Boolean(url) && all.indexOf(url) === index)
      return <article key={row.id} className="rounded-lg border border-thermo-border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-thermo-navy">Envio #{row.id}</h2><span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusTone(row.rastreio_status)}`}>{row.rastreio_status || "Pendente"}</span>{row.sep_status ? <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">SEP: {row.sep_status}</span> : null}</div><p className="mt-1 text-sm text-slate-600">{formatDate(row.created_at)} · {row.usuario || "Usuário não informado"}</p></div><div className="flex gap-2">{canWrite && row.rastreio_status !== "Enviado" && row.rastreio_status !== "Excluído" ? <button type="button" className="thermo-button thermo-button-primary" onClick={() => { setSelected(row); setPendingAction("send"); setPhrase("") }}><PackageCheck className="size-4" />Marcar enviado</button> : null}{canWrite && row.rastreio_status !== "Excluído" ? <button aria-label={`Excluir envio ${row.id}`} type="button" className="thermo-button thermo-button-secondary text-red-700" onClick={() => { setSelected(row); setPendingAction("delete"); setPhrase("") }}><Trash2 className="size-4" /></button> : null}</div></div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-xs font-bold uppercase text-slate-500">Destino / método</dt><dd className="mt-1 text-thermo-ink">{row.metodo_envio || "Não informado"}{row.id_at ? ` · AT #${row.id_at}` : ""}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-500">Separação</dt><dd className="mt-1 text-thermo-ink">{row.numero_sep || "Sem SEP vinculada"}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-500">Rastreabilidade</dt><dd className="mt-1 break-all text-thermo-ink">{row.identificacao || row.id_vipp || "Não disponível"}</dd></div><div><dt className="text-xs font-bold uppercase text-slate-500">SLA</dt><dd className="mt-1 text-thermo-ink">{formatDate(row.sla_limite_em)}</dd></div></dl>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_18rem]"><div><h3 className="text-xs font-bold uppercase text-slate-500">Itens</h3>{items.length ? <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">{items.map((item, index) => <li key={`${item.conteudo}-${index}`} className="flex justify-between gap-3 px-3 py-2 text-sm"><span>{item.conteudo}</span><strong>Qtd. {String(item.quantidade ?? "—")}</strong></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">Conteúdo não informado.</p>} {row.observacao ? <p className="mt-2 text-sm text-slate-600"><strong>Observação:</strong> {row.observacao}</p> : null}</div><div><h3 className="text-xs font-bold uppercase text-slate-500">Anexos existentes</h3><div className="mt-2 flex flex-col gap-2">{attachments.length ? attachments.map((url, index) => <a key={url} className="thermo-button thermo-button-secondary justify-start" href={url} target="_blank" rel="noreferrer"><FileText className="size-4" />{index === 0 ? "Abrir etiqueta" : index === 1 ? "Abrir declaração" : `Abrir anexo ${index + 1}`}<ExternalLink className="ml-auto size-3" /></a>) : <span className="text-sm text-slate-500">Nenhum anexo disponível.</span>}</div></div></div>
      </article>})}</div>}
    {selected && pendingAction ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="sac-confirm-title"><div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"><h2 id="sac-confirm-title" className="text-lg font-bold text-thermo-navy">Confirmar efeito logístico</h2><p className="mt-2 text-sm text-slate-600">{pendingAction === "send" ? "Esta ação registra o envio como concluído e pode removê-lo da fila logística." : "Esta ação faz exclusão lógica e remove o registro das filas operacionais."}</p><label className="mt-4 block text-sm font-semibold text-thermo-navy">Digite exatamente <span className="font-mono text-xs">{expected}</span><input aria-label="Frase de confirmação" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm" value={phrase} onChange={(event) => setPhrase(event.target.value)} /></label><label className="mt-3 flex gap-2 text-sm text-slate-700"><input type="checkbox" checked={phrase === expected} readOnly />Reconheço o impacto desta ação</label><div className="mt-5 flex justify-end gap-2"><button type="button" className="thermo-button thermo-button-secondary" onClick={() => { setSelected(null); setPendingAction(null); setPhrase("") }}>Cancelar</button><button type="button" className="thermo-button thermo-button-primary" disabled={phrase !== expected || saving} onClick={() => void confirmAction()}>{saving ? "Salvando…" : "Confirmar"}</button></div></div></div> : null}
  </section>
}
