import { AlertCircle, Bolt, Box, CheckCircle2, ChevronRight, Clock3, PackageCheck, RefreshCw, Search, ShoppingCart, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { completeSeparation, loadSeparationItems, loadSeparationKanban, moveSeparationToAwaitingPickup, startSeparation } from '../../services/separationGateway'
import { ConfirmationDialog } from './ConfirmationDialog'
import { separationStatusLabels, separationWorkflowStatuses } from './types'
import type { SeparationItem, SeparationKanbanCard, SeparationWorkflowStatus } from './types'

const statusStyles: Record<SeparationWorkflowStatus, string> = {
  Solicitado: 'border-blue-200 bg-blue-50 text-blue-800',
  'Stund-by': 'border-pink-200 bg-pink-50 text-pink-800',
  'Em Separação': 'border-amber-200 bg-amber-50 text-amber-800',
  Separado: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  'Aguardando retirada': 'border-violet-200 bg-violet-50 text-violet-800',
  Concluído: 'border-slate-200 bg-slate-100 text-slate-700',
}

interface PendingTransition {
  title: string
  description: string
  confirmLabel: string
  run: () => Promise<void>
}

const dateTime = (value: string | null) => {
  if (!value) return 'Sem data registrada'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

const itemIdsFor = (items: SeparationItem[], status: SeparationWorkflowStatus) => {
  const allowed = status === 'Solicitado' || status === 'Stund-by'
    ? new Set(['pendente', 'stund-by'])
    : status === 'Separado'
      ? new Set(['separado'])
      : new Set(['aguardando retirada'])
  return items
    .filter((item) => allowed.has(String(item.status || '').trim().toLocaleLowerCase('pt-BR')))
    .map((item) => Number(item.solic_id))
    .filter((id) => Number.isInteger(id) && id > 0)
}

export function SeparationKanbanScreen() {
  const [columns, setColumns] = useState<Partial<Record<SeparationWorkflowStatus, SeparationKanbanCard[]>>>({})
  const [activeStatus, setActiveStatus] = useState<SeparationWorkflowStatus>('Solicitado')
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [detailsCard, setDetailsCard] = useState<SeparationKanbanCard | null>(null)
  const [details, setDetails] = useState<SeparationItem[]>([])
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [transition, setTransition] = useState<PendingTransition | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await loadSeparationKanban(search)
      setColumns(response.colunas || {})
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Falha ao carregar o kanban de separação.')
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- initial synchronization with the legacy API
    void reload()
  }, [reload])

  const total = useMemo(() => separationWorkflowStatuses.reduce((sum, status) => sum + (columns[status]?.length || 0), 0), [columns])

  const openDetails = async (card: SeparationKanbanCard) => {
    setDetailsCard(card)
    setDetails([])
    setDetailsLoading(true)
    setError(null)
    try {
      const response = await loadSeparationItems(card.n_solic)
      setDetails(response.itens || [])
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Falha ao carregar itens da SEP.')
      setDetailsCard(null)
    } finally {
      setDetailsLoading(false)
    }
  }

  const prepareTransition = async (card: SeparationKanbanCard, status: SeparationWorkflowStatus) => {
    setBusy(true)
    setError(null)
    try {
      const response = await loadSeparationItems(card.n_solic)
      const ids = itemIdsFor(response.itens || [], status)
      if (!ids.length) throw new Error(`Nenhum item elegível na SEP ${card.n_solic}. Atualize o quadro antes de tentar novamente.`)

      if (status === 'Solicitado' || status === 'Stund-by') {
        setTransition({
          title: 'Iniciar separação?',
          description: `${card.n_solic} será assumida pela sessão atual e sairá de ${separationStatusLabels[status]}.`,
          confirmLabel: 'Iniciar separação',
          run: async () => { await startSeparation(ids) },
        })
      } else if (status === 'Separado') {
        setTransition({
          title: 'Enviar para retirada?',
          description: `${card.n_solic} passará para Aguardando retirada. Itens de fluxos VIPP podem ser concluídos diretamente pelo backend legado.`,
          confirmLabel: 'Aguardar retirada',
          run: async () => { await moveSeparationToAwaitingPickup(ids) },
        })
      } else if (status === 'Aguardando retirada') {
        setTransition({
          title: 'Concluir retirada?',
          description: `${card.n_solic} será marcada como Concluído. Confirme somente após a entrega física.`,
          confirmLabel: 'Concluir retirada',
          run: async () => { await completeSeparation(ids) },
        })
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Falha ao preparar a transição.')
    } finally {
      setBusy(false)
    }
  }

  const confirmTransition = async () => {
    const pending = transition
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      await pending.run()
      setTransition(null)
      setNotice('Etapa atualizada pelo backend legado.')
      await reload()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Falha ao atualizar a etapa.')
    } finally {
      setBusy(false)
    }
  }

  const renderCard = (card: SeparationKanbanCard, status: SeparationWorkflowStatus) => (
    <article className={`rounded-md border border-l-[3px] bg-white p-3 shadow-sm ${card.tem_urgente ? 'border-l-thermo-red' : 'border-l-slate-300'}`} key={`${status}-${card.n_solic}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><div className="font-mono text-xs font-semibold text-thermo-navy">{card.n_solic}</div><div className="mt-1 flex items-center gap-1.5 text-xs text-slate-600"><UserRound className="size-3.5 shrink-0" />De: <span className="truncate font-medium text-slate-800">{card.nome_user}</span></div></div>
        {card.tem_urgente ? <span aria-label="Urgente" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700"><Bolt className="size-3.5" /></span> : null}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500"><Clock3 className="size-3.5" />{dateTime(card.item_criado_em || card.criado_em_min)}</div>
      {card.usuario_separando ? <div className="mt-2 truncate rounded-md bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-800">Separando: {card.usuario_separando}</div> : null}
      {status === 'Stund-by' && card.tem_em_compra ? <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700"><ShoppingCart className="size-3" />Em compra</div> : null}
      <div className="mt-3 flex items-center justify-between border-t border-dashed border-thermo-border pt-2 text-xs"><span className="inline-flex items-center gap-1 text-slate-600"><Box className="size-3.5" /><strong>{card.total_itens}</strong> {card.total_itens === 1 ? 'item' : 'itens'}</span><button className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 font-semibold text-thermo-navy hover:bg-thermo-bg focus:outline-none focus:ring-2 focus:ring-thermo-navy/20" onClick={() => void openDetails(card)} type="button">Ver itens<ChevronRight className="size-3.5" /></button></div>
      {(status === 'Solicitado' || status === 'Stund-by') ? <button aria-label={`Iniciar separação de ${card.n_solic}`} className="thermo-button thermo-button-primary mt-2 min-h-11 w-full" disabled={busy} onClick={() => void prepareTransition(card, status)} type="button">Iniciar separação</button> : null}
      {status === 'Separado' ? <button aria-label={`Enviar ${card.n_solic} para retirada`} className="thermo-button thermo-button-primary mt-2 min-h-11 w-full" disabled={busy} onClick={() => void prepareTransition(card, status)} type="button"><PackageCheck className="size-4" />Enviar para retirada</button> : null}
      {status === 'Aguardando retirada' ? <button aria-label={`Concluir retirada de ${card.n_solic}`} className="thermo-button thermo-button-primary mt-2 min-h-11 w-full" disabled={busy} onClick={() => void prepareTransition(card, status)} type="button"><CheckCircle2 className="size-4" />Concluir retirada</button> : null}
      {status === 'Em Separação' ? <p className="mt-2 rounded-md bg-amber-50 px-2 py-2 text-[11px] leading-4 text-amber-800">Conferência, ETQ e Omie permanecem no fluxo operacional legado.</p> : null}
    </article>
  )

  const renderColumn = (status: SeparationWorkflowStatus) => {
    const cards = columns[status] || []
    return <section className="min-w-0 rounded-[10px] border border-thermo-border bg-thermo-bg" key={status}><header className={`flex items-center justify-between gap-2 rounded-t-[10px] border-b px-3 py-2.5 ${statusStyles[status]}`}><h2 className="text-xs font-bold">{separationStatusLabels[status]}</h2><span className="rounded-full bg-white/70 px-2 py-0.5 font-mono text-[11px] font-semibold">{cards.length}</span></header><div className="space-y-2 p-2">{cards.length ? cards.map((card) => renderCard(card, status)) : <div className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-8 text-center text-xs text-slate-500">Nenhuma SEP nesta etapa.</div>}</div></section>
  }

  return (
    <section aria-labelledby="separation-kanban-title" className="min-w-0">
      <header className="mb-4 flex flex-col gap-3 border-b-2 border-thermo-border pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-thermo-red"><PackageCheck className="size-4" />THM-011</div><h1 className="text-xl font-bold text-thermo-navy" id="separation-kanban-title">Kanban de separação</h1><p className="mt-1 text-sm text-slate-600">{total} SEPs nos seis estados operacionais auditados.</p></div>
        <form className="flex min-w-0 flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()) }}><label className="relative min-w-0 flex-1 sm:w-72"><span className="sr-only">Buscar SEP, pessoa ou produto</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input className="min-h-11 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm focus:border-thermo-navy focus:outline-none focus:ring-2 focus:ring-thermo-navy/15" onChange={(event) => setSearchDraft(event.target.value)} placeholder="Buscar SEP, pessoa ou produto" value={searchDraft} /></label><button className="thermo-button thermo-button-secondary min-h-11" type="submit">Buscar</button><button aria-label="Atualizar kanban" className="thermo-icon-button" disabled={loading || busy} onClick={() => void reload()} type="button"><RefreshCw className="size-4" /></button></form>
      </header>
      {error ? <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</div> : null}
      {notice ? <div className="mb-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{notice}</div> : null}
      {loading ? <div className="rounded-[10px] border border-thermo-border bg-white px-5 py-12 text-center text-sm text-slate-500">Carregando quadro real de separação…</div> : null}
      {!loading ? <><div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:hidden" role="tablist" aria-label="Etapas da separação">{separationWorkflowStatuses.map((status) => <button aria-selected={activeStatus === status} className={`min-h-11 rounded-md border px-2 text-xs font-semibold ${activeStatus === status ? 'border-thermo-navy bg-thermo-navy text-white' : 'border-thermo-border bg-white text-slate-600'}`} key={status} onClick={() => setActiveStatus(status)} role="tab" type="button">{separationStatusLabels[status]} ({columns[status]?.length || 0})</button>)}</div><div className="overflow-x-auto pb-3"><div className="grid grid-cols-1 gap-3 lg:min-w-[94rem] lg:grid-cols-6">{separationWorkflowStatuses.map((status) => <div className={activeStatus === status ? 'block' : 'hidden lg:block'} key={status}>{renderColumn(status)}</div>)}</div></div></> : null}

      {detailsCard ? <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4" role="presentation"><section aria-labelledby="separation-details-title" aria-modal="true" className="max-h-[92dvh] w-full overflow-hidden rounded-t-[14px] bg-white shadow-2xl sm:max-w-2xl sm:rounded-[14px]" role="dialog"><header className="flex items-center gap-3 bg-thermo-navy px-4 py-3 text-white"><div className="flex-1"><div className="font-mono text-xs text-slate-300">{detailsCard.n_solic}</div><h2 className="text-sm font-semibold" id="separation-details-title">Itens da separação</h2></div><button aria-label="Fechar itens da separação" className="inline-flex size-11 items-center justify-center rounded-md hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/70" onClick={() => setDetailsCard(null)} type="button"><X className="size-4" /></button></header><div className="max-h-[calc(92dvh-4rem)] overflow-y-auto p-4">{detailsLoading ? <p className="py-8 text-center text-sm text-slate-500">Carregando itens…</p> : null}{!detailsLoading && !details.length ? <p className="py-8 text-center text-sm text-slate-500">Nenhum item disponível.</p> : null}<div className="space-y-2">{details.map((item) => <article className="rounded-md border border-thermo-border bg-thermo-bg p-3" key={`${item.solic_id}-${item.carr_id}`}><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-mono text-xs font-semibold text-thermo-navy">{item.codigo_produto}</div><div className="mt-1 text-sm font-medium text-thermo-ink">{item.descricao || 'Sem descrição'}</div></div><span className="rounded-full border border-thermo-border bg-white px-2 py-1 font-mono text-xs">{Number(item.quantidade_solicitada ?? item.quantidade).toLocaleString('pt-BR')} {item.unidade || 'UN'}</span></div>{item.comentario_item ? <p className="mt-2 text-xs text-slate-600"><strong>Comentário:</strong> {item.comentario_item}</p> : null}{item.observacao ? <p className="mt-1 text-xs text-slate-600"><strong>Observação:</strong> {item.observacao}</p> : null}<div className="mt-2 text-[11px] text-slate-500">Destino: {item.nome_local || item.cod_local || 'não informado'} · Status real: {item.status}</div></article>)}</div></div></section></div> : null}

      <ConfirmationDialog busy={busy} confirmLabel={transition?.confirmLabel || 'Confirmar'} description={transition?.description || ''} onCancel={() => setTransition(null)} onConfirm={() => void confirmTransition()} open={Boolean(transition)} title={transition?.title || ''} />
    </section>
  )
}
