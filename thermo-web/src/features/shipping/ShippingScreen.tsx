import { AlertCircle, Barcode, CheckCircle2, ExternalLink, FileText, LockKeyhole, PackageOpen, RefreshCw, Search, Truck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { generateShippingLabel, loadShippingQueue, markShippingAsSent, shippingDeclarationUrl, shippingLabelUrl } from '../../services/shippingGateway'
import { ConfirmationDialog } from '../separation/ConfirmationDialog'
import type { ShippingItem, ShippingMetrics, ShippingRecord } from './types'

type PendingAction = { kind: 'sent' | 'label'; record: ShippingRecord } | null

function normalize(value: unknown) { return String(value ?? '').trim().toLocaleLowerCase('pt-BR') }
function formatDate(value?: string | null) { return value ? new Date(value).toLocaleString('pt-BR') : 'Data não informada' }
function formatHours(value?: number) { return Number.isFinite(value) ? `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h` : '—' }
function isOverdue(record: ShippingRecord) { return !!record.sla_limite_em && new Date(record.sla_limite_em).getTime() < Date.now() }

function parseShippingItems(raw: ShippingRecord['conteudo']): ShippingItem[] {
  if (Array.isArray(raw)) return raw
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [{ conteudo: raw }] }
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return <div className="rounded-lg border border-thermo-border bg-white p-3"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span><strong className="mt-1 block text-xl text-thermo-navy">{value}</strong><small className="mt-1 block text-xs text-slate-500">{hint}</small></div>
}

export function ShippingScreen({ allowed = true }: { allowed?: boolean }) {
  const [rows, setRows] = useState<ShippingRecord[]>([])
  const [metrics, setMetrics] = useState<ShippingMetrics>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('ativos')
  const [pending, setPending] = useState<PendingAction>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!allowed) return
    setLoading(true); setError('')
    try {
      const data = await loadShippingQueue()
      setRows(Array.isArray(data.rows) ? data.rows : [])
      setMetrics(data.metricas || {})
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao carregar envios.') }
    finally { setLoading(false) }
  }, [allowed])

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(task)
  }, [load])

  const filtered = useMemo(() => rows.filter((record) => {
    const haystack = normalize([record.numero_sep, record.usuario, record.observacao, record.identificacao, record.metodo_envio, record.conteudo].join(' '))
    const matchesQuery = !query.trim() || haystack.includes(normalize(query))
    const matchesStatus = status === 'todos' || (status === 'atrasados' ? isOverdue(record) : normalize(record.rastreio_status || 'Pendente') !== 'enviado')
    return matchesQuery && matchesStatus
  }).sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a))), [query, rows, status])

  async function confirmAction() {
    if (!pending) return
    setBusy(true); setError('')
    try {
      if (pending.kind === 'sent') await markShippingAsSent(pending.record.id)
      else await generateShippingLabel(pending.record.id, pending.record.numero_sep)
      setPending(null)
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha na operação.') }
    finally { setBusy(false) }
  }

  if (!allowed) return <section aria-label="Sem permissão para Envio de mercadoria" className="rounded-lg border border-amber-200 bg-amber-50 p-6"><LockKeyhole className="size-6 text-amber-700" /><h1 className="mt-3 text-xl font-bold text-thermo-navy">Envio de mercadoria</h1><p className="mt-2 text-sm text-amber-900">Sua árvore de permissões não liberou #menu-envio-mercadoria. Solicite acesso ao responsável pelo sistema.</p></section>

  return <section aria-labelledby="shipping-title" className="min-w-0 space-y-4">
    <header className="flex flex-col gap-3 rounded-lg bg-thermo-navy p-4 text-white sm:flex-row sm:items-center sm:justify-between">
      <div><h1 className="flex items-center gap-2 text-xl font-bold" id="shipping-title"><Truck className="size-5" />Envio de mercadoria</h1><p className="mt-1 text-sm text-slate-300">Fila operacional de separação, postagem, documentos e rastreio.</p></div>
      <div className="flex flex-wrap gap-2"><a className="thermo-button bg-white/10 text-white hover:bg-white/20" href="https://vipp.visualset.com.br/vipp/inicio/index.php" rel="noreferrer" target="_blank"><ExternalLink className="size-4" />VIPP</a><button className="thermo-button bg-white text-thermo-navy" disabled={loading} onClick={() => void load()} type="button"><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />Recarregar</button></div>
    </header>

    <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
      <Metric label="Meta de hoje" value={`${metrics.enviados_hoje ?? 0} / ${metrics.meta_hoje ?? 0}`} hint="Progresso da expedição" />
      <Metric label="Pendentes" value={metrics.pendentes ?? rows.length} hint="Fila ativa agora" />
      <Metric label="Atrasados" value={metrics.atrasados ?? rows.filter(isOverdue).length} hint="Fora do prazo" />
      <Metric label="Enviados hoje" value={metrics.enviados_hoje ?? 0} hint="Baixas da expedição" />
      <Metric label="SLA 7 dias" value={metrics.sla_percentual_7d == null ? '—' : `${metrics.sla_percentual_7d}%`} hint={`Mediana ${formatHours(metrics.mediana_horas_7d)}`} />
      <Metric label="Tempo médio" value={formatHours(metrics.media_horas_7d)} hint="Solicitação até envio" />
    </div>

    <div className="grid gap-2 rounded-lg border border-thermo-border bg-white p-3 sm:grid-cols-[1fr_190px]">
      <label className="relative"><span className="sr-only">Buscar envios</span><Search className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" /><input className="thermo-input w-full pl-9" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar SEP, requisitante, rastreio ou conteúdo" value={query} /></label>
      <label><span className="sr-only">Filtrar situação</span><select className="thermo-input w-full" onChange={(event) => setStatus(event.target.value)} value={status}><option value="ativos">Fila ativa</option><option value="atrasados">Atrasados</option><option value="todos">Todos retornados</option></select></label>
    </div>

    {error ? <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{error}</span><button className="ml-auto font-semibold underline" onClick={() => void load()} type="button">Tentar novamente</button></div> : null}
    {loading && !rows.length ? <div className="rounded-lg border border-thermo-border bg-white p-8 text-center text-sm text-slate-500" role="status">Carregando envios reais…</div> : null}
    {!loading && !error && !filtered.length ? <div className="rounded-lg border border-dashed border-thermo-border bg-white p-8 text-center"><PackageOpen className="mx-auto size-7 text-slate-400" /><strong className="mt-3 block text-thermo-navy">Nenhum envio encontrado</strong><p className="mt-1 text-sm text-slate-500">A fila está vazia ou os filtros não encontraram registros.</p></div> : null}

    <div className="space-y-3">{filtered.map((record) => {
      const items = parseShippingItems(record.conteudo)
      const labelUrl = shippingLabelUrl(record)
      const declarationUrl = shippingDeclarationUrl(record)
      const canGenerate = !!record.id_vipp
      return <article className={`grid gap-4 rounded-lg border bg-white p-4 lg:grid-cols-[minmax(180px,.8fr)_minmax(260px,1.4fr)_minmax(180px,.8fr)_170px] ${isOverdue(record) ? 'border-red-300' : 'border-thermo-border'}`} key={record.id}>
        <div><div className="flex flex-wrap items-center gap-2"><strong className="text-thermo-navy">#{record.id}</strong><span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-bold text-sky-800">{record.numero_sep || 'Sem SEP'}</span></div><p className="mt-2 text-sm font-medium text-slate-700">{record.usuario || 'Requisitante não informado'}</p><p className="mt-1 text-xs text-slate-500">{formatDate(record.created_at)}</p>{record.sep_status ? <p className="mt-2 text-xs font-semibold text-indigo-700">Separação: {record.sep_status}</p> : null}</div>
        <div><span className="text-xs font-semibold uppercase text-slate-500">Conteúdo</span>{items.length ? <ul className="mt-2 space-y-1">{items.map((item, index) => <li className="flex justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm" key={`${record.id}-${index}`}><span>{item.descricao || item.conteudo || item.codigo || 'Item sem descrição'}</span><strong>{item.quantidade ? `Qtd. ${item.quantidade}` : ''}</strong></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">Conteúdo não informado.</p>}<p className="mt-2 text-sm text-slate-600">{record.observacao || 'Sem observação.'}</p></div>
        <div><span className="text-xs font-semibold uppercase text-slate-500">Postagem</span><strong className="mt-2 block text-thermo-navy">{record.metodo_envio || (record.id_vipp ? 'VIPP / Correios' : 'Método não informado')}</strong><p className="mt-1 text-sm text-slate-600">{record.identificacao || 'Rastreio ainda não disponível'}</p><span className={`mt-3 inline-flex rounded-full px-2 py-1 text-xs font-bold ${isOverdue(record) ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{isOverdue(record) ? 'SLA atrasado' : record.rastreio_status || 'Pendente'}</span></div>
        <div className="flex flex-col gap-2">
          {labelUrl ? <a className="thermo-button thermo-button-secondary justify-center" href={labelUrl} rel="noreferrer" target="_blank"><Barcode className="size-4" />Etiqueta</a> : <button className="thermo-button thermo-button-secondary justify-center" disabled={!canGenerate} onClick={() => setPending({ kind: 'label', record })} title={canGenerate ? 'Alocar etiqueta no VIPP' : 'Este envio não possui id_vipp; a etiqueta não pode ser gerada com segurança.'} type="button"><Barcode className="size-4" />Gerar etiqueta</button>}
          {declarationUrl ? <a className="thermo-button thermo-button-secondary justify-center" href={declarationUrl} rel="noreferrer" target="_blank"><FileText className="size-4" />Declaração</a> : <button className="thermo-button thermo-button-secondary justify-center" disabled title="Declaração indisponível: não há arquivo, VIPP ou conteúdo comprovado." type="button"><FileText className="size-4" />Declaração</button>}
          <button className="thermo-button thermo-button-primary justify-center" onClick={() => setPending({ kind: 'sent', record })} type="button"><CheckCircle2 className="size-4" />Marcar enviado</button>
        </div>
      </article>
    })}</div>

    <ConfirmationDialog busy={busy} confirmLabel={pending?.kind === 'sent' ? 'Marcar como enviado' : 'Gerar etiqueta'} danger={pending?.kind === 'sent'} description={pending?.kind === 'sent' ? `${pending.record.numero_sep || `Envio #${pending.record.id}`} sairá da fila ativa. Esta baixa altera o registro real.` : `O VIPP alocará um código ECT para ${pending?.record.numero_sep || `o envio #${pending?.record.id}`}.`} onCancel={() => !busy && setPending(null)} onConfirm={() => void confirmAction()} open={!!pending} title={pending?.kind === 'sent' ? 'Confirmar baixa do envio?' : 'Confirmar geração no VIPP?'} />
  </section>
}
