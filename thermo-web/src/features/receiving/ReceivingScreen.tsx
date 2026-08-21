import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, FileSearch, LoaderCircle, PackageCheck, RefreshCw, Search, X } from 'lucide-react'
import {
  confirmNfeAssociation,
  findNfeKey,
  loadNfeDetails,
  loadPendingReceipts,
  loadReceivedProducts,
  previewNfeAssociation,
} from '../../services/receivingGateway'
import type { AssociationInput, AssociationPreviewResponse, NfeDetailsResponse, ReceivingMode, ReceivingOrder, ReceivingRow } from './types'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' })
const text = (value: unknown, fallback = '—') => String(value ?? '').trim() || fallback
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const formatDate = (value: unknown) => { try { return value ? date.format(new Date(String(value))) : '—' } catch { return text(value) } }

function groupOrders(rows: ReceivingRow[]): ReceivingOrder[] {
  const groups = new Map<string, ReceivingRow[]>()
  rows.forEach((row) => {
    const key = String(row.n_cod_ped || row.cnumero || row.id)
    groups.set(key, [...(groups.get(key) || []), row])
  })
  return [...groups.entries()].map(([key, items]) => ({ key, n_cod_ped: items[0]!.n_cod_ped, cnumero: items[0]!.cnumero, rows: items, first: items[0]! }))
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-0 sm:p-5" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section role="dialog" aria-modal="true" aria-label={title} className="flex max-h-dvh w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-lg">
      <header className="flex min-h-14 items-center justify-between border-b border-slate-200 px-4"><h2 className="text-lg font-bold text-slate-900">{title}</h2><button type="button" onClick={onClose} aria-label="Fechar" className="grid size-11 place-items-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700"><X className="size-5" /></button></header>
      <div className="min-h-0 overflow-y-auto p-4 sm:p-6">{children}</div>
    </section>
  </div>
}

export function ReceivingScreen({ mode = 'receiving', allowed = true }: { mode?: ReceivingMode; allowed?: boolean }) {
  const [rows, setRows] = useState<ReceivingRow[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [details, setDetails] = useState<NfeDetailsResponse | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [association, setAssociation] = useState<{ order: ReceivingOrder; nfe: string } | null>(null)
  const [preview, setPreview] = useState<AssociationPreviewResponse | null>(null)
  const [mutationMessage, setMutationMessage] = useState('')

  const reload = useCallback(async () => {
    if (!allowed) return
    setLoading(true); setError('')
    try { setRows(await (mode === 'receiving' ? loadPendingReceipts() : loadReceivedProducts())) }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar os recebimentos.') }
    finally { setLoading(false) }
  }, [allowed, mode])
  // A troca de tela sincroniza a feature com os endpoints legados correspondentes.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void reload() }, [reload])

  const orders = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR')
    return groupOrders(rows).filter((order) => !normalized || JSON.stringify(order).toLocaleLowerCase('pt-BR').includes(normalized))
  }, [rows, query])

  const openNfe = async (numeroNfe: string, knownKey = '') => {
    setDetailsLoading(true); setError('')
    try {
      const key = knownKey.replace(/\D/g, '') || (await findNfeKey(numeroNfe)).chave_nfe
      setDetails(await loadNfeDetails(key, numeroNfe))
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível consultar a NF-e.') }
    finally { setDetailsLoading(false) }
  }

  const previewAssociation = async () => {
    if (!association?.nfe.trim()) return
    setDetailsLoading(true); setError(''); setPreview(null)
    try {
      const input: AssociationInput = { numero_nfe: association.nfe.trim(), numero_pedido: association.order.cnumero, n_cod_ped: Number(association.order.n_cod_ped) }
      setPreview(await previewNfeAssociation(input))
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível gerar a prévia.') }
    finally { setDetailsLoading(false) }
  }

  const confirmAssociation = async () => {
    if (!association || !preview) return
    setDetailsLoading(true); setError('')
    try {
      const input: AssociationInput = { numero_nfe: association.nfe.trim(), numero_pedido: association.order.cnumero, n_cod_ped: Number(association.order.n_cod_ped) }
      const result = await confirmNfeAssociation(input)
      setMutationMessage(result.message || 'NF-e associada ao pedido com sucesso.')
      setAssociation(null); setPreview(null); await reload()
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível confirmar a associação.') }
    finally { setDetailsLoading(false) }
  }

  if (!allowed) return <section className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-amber-950" role="alert"><div className="flex gap-3"><AlertCircle className="mt-0.5 size-5 shrink-0" /><div><h1 className="font-bold">Acesso não permitido</h1><p className="mt-1 text-sm">Seu perfil não possui permissão para acessar {mode === 'receiving' ? 'Recebimento' : 'Produtos recebidos'}.</p></div></div></section>

  return <main className="mx-auto w-full max-w-[1440px] space-y-4 p-3 text-slate-900 sm:p-5">
    <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Compras e logística</p><h1 className="text-2xl font-bold">{mode === 'receiving' ? 'Recebimento' : 'Produtos recebidos'}</h1><p className="mt-1 text-sm text-slate-600">{mode === 'receiving' ? 'Pedidos aguardando entrada e associação de NF-e.' : 'Pedidos nas etapas 50 e 60, já recebidos.'}</p></div>
      <button type="button" onClick={() => void reload()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-slate-800 px-4 font-semibold text-white hover:bg-slate-700 disabled:opacity-50"><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />Atualizar</button>
    </header>
    <label className="relative block"><span className="sr-only">Pesquisar pedidos, produtos ou fornecedores</span><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-500" /><input value={query} onChange={(e) => setQuery(e.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 bg-white pl-10 pr-4 text-base outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200" placeholder="Pesquisar pedido, produto, fornecedor, etapa ou NF-e" type="search" /></label>
    {error && <div role="alert" className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{error}</span></div>}
    {mutationMessage && <div role="status" className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /><span>{mutationMessage}</span></div>}
    {loading ? <div className="grid min-h-56 place-items-center text-slate-600" role="status"><span className="inline-flex items-center gap-2"><LoaderCircle className="size-5 animate-spin" />Carregando recebimentos…</span></div> : orders.length === 0 ? <div className="grid min-h-56 place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><div><PackageCheck className="mx-auto size-8 text-slate-500" /><p className="mt-3 font-semibold">{query ? 'Nenhum resultado para os filtros.' : mode === 'receiving' ? 'Nenhum pedido aguardando recebimento.' : 'Nenhum produto recebido.'}</p></div></div> : <div className="grid gap-3" aria-live="polite">{orders.map((order) => <OrderCard key={order.key} order={order} mode={mode} onNfe={openNfe} onAssociate={() => setAssociation({ order, nfe: '' })} />)}</div>}
    {detailsLoading && !association && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40" role="status"><span className="rounded-md bg-white px-5 py-4 font-semibold"><LoaderCircle className="mr-2 inline size-5 animate-spin" />Consultando NF-e…</span></div>}
    {details && <NfeDialog details={details} onClose={() => setDetails(null)} />}
    {association && <Dialog title={`Associar NF-e ao pedido ${association.order.cnumero}`} onClose={() => { setAssociation(null); setPreview(null) }}><div className="space-y-5"><label className="block font-semibold">Número da NF-e<input autoFocus value={association.nfe} onChange={(e) => { setAssociation({ ...association, nfe: e.target.value }); setPreview(null) }} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-base" inputMode="numeric" /></label>{preview && <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm"><p><b>Fornecedor:</b> {text(preview.preview.fornecedor_nome)}</p><p><b>Itens:</b> {number(preview.preview.itens_match_total)} associados de {number(preview.preview.itens_nf_total)}</p><p><b>Sem correspondência:</b> {number(preview.preview.itens_sem_match_total)}</p></div>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => { setAssociation(null); setPreview(null) }} className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold">Cancelar</button>{preview ? <button type="button" onClick={() => void confirmAssociation()} disabled={detailsLoading || number(preview.preview.itens_sem_match_total) > 0} className="min-h-11 rounded-md bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50">{detailsLoading ? 'Confirmando…' : 'Confirmar associação'}</button> : <button type="button" onClick={() => void previewAssociation()} disabled={detailsLoading || !association.nfe.trim()} className="min-h-11 rounded-md bg-slate-800 px-4 font-semibold text-white disabled:opacity-50">{detailsLoading ? 'Consultando…' : 'Gerar prévia'}</button>}</div></div></Dialog>}
  </main>
}

function OrderCard({ order, mode, onNfe, onAssociate }: { order: ReceivingOrder; mode: ReceivingMode; onNfe: (number: string, key?: string) => void; onAssociate: () => void }) {
  const first = order.first
  const nfes = Array.isArray(first.fornecedor_lista_nfes) ? first.fornecedor_lista_nfes : []
  const visibleNfes = nfes.slice(0, 3)
  const remainingNfes = nfes.slice(3)
  const nfeButton = (nfe: (typeof nfes)[number]) => <button key={`${nfe.numero_nfe}-${nfe.chave_nfe}`} type="button" onClick={() => onNfe(text(nfe.numero_nfe, ''), text(nfe.chave_nfe, ''))} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50"><FileSearch className="size-4" />NF-e {text(nfe.numero_nfe)}</button>
  return <article className="rounded-lg border border-slate-200 bg-white shadow-sm"><div className="grid gap-3 p-4 lg:grid-cols-[1.1fr_1fr_1fr_auto] lg:items-start"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold">Pedido {text(order.cnumero)}</h2><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">{text(first.etapa_nf_descricao || first.etapa_nf)}</span></div><p className="mt-1 text-sm text-slate-600">{order.rows.length} {order.rows.length === 1 ? 'item' : 'itens'} · {money.format(number(first.valor_total_pedido))}</p></div><div className="text-sm"><p className="font-semibold">{text(first.fornecedor_nome_fantasia || first.fornecedor_razao_social)}</p><p className="text-slate-600">Previsão: {formatDate(first.previsao_chegada)}</p></div><div className="text-sm"><p>Solicitante: <b>{text(first.solicitante)}</b></p><p>Inspeção: <b>{text(first.resp_inspecao_recebimento)}</b></p></div><div className="flex max-w-md flex-wrap gap-2 lg:justify-end">{mode === 'receiving' && <button type="button" onClick={onAssociate} className="min-h-11 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-600">Associar NF-e</button>}{visibleNfes.map(nfeButton)}{remainingNfes.length > 0 && <details className="w-full text-right"><summary className="cursor-pointer text-sm font-semibold text-thermo-navy">Ver mais {remainingNfes.length} NF-e</summary><div className="mt-2 flex max-h-56 flex-wrap justify-end gap-2 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2">{remainingNfes.map(nfeButton)}</div></details>}</div></div><details className="border-t border-slate-200"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">Ver itens do pedido</summary><div className="grid gap-2 px-4 pb-4">{order.rows.map((row) => <div key={row.id} className="grid gap-1 rounded-md bg-slate-50 p-3 text-sm sm:grid-cols-[1fr_auto]"><div><b>{text(row.produto_codigo)}</b> · {text(row.produto_descricao)}</div><div className="font-semibold tabular-nums">{number(row.quantidade).toLocaleString('pt-BR')} {text(row.unidade, '')}</div></div>)}</div></details></article>
}

function NfeDialog({ details, onClose }: { details: NfeDetailsResponse; onClose: () => void }) {
  const cab = details.data.cabec || {}
  const items = Array.isArray(details.data.itensRecebimento) ? details.data.itensRecebimento : []
  return <Dialog title={`NF-e ${text(cab.cNumeroNFe || cab.cNumeroNfe)}`} onClose={onClose}><div className="space-y-4"><div className="grid gap-3 rounded-md bg-slate-50 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4"><p><span className="block text-slate-500">Fornecedor</span><b>{text(cab.cRazaoSocial || cab.cNome)}</b></p><p><span className="block text-slate-500">Etapa</span><b>{text(details.etapa_info?.descricao_customizada || details.etapa_info?.descricao || cab.cEtapa)}</b></p><p><span className="block text-slate-500">Emissão</span><b>{formatDate(cab.dEmissaoNFe || cab.dEmissao)}</b></p><p><span className="block text-slate-500">Origem</span><b>{text(details.source)}</b></p></div><div className="space-y-2"><h3 className="font-bold">Itens recebidos ({items.length})</h3>{items.length ? items.map((item, index) => { const c = item.itensCabec || {}; return <div key={String(c.nSequencia || index)} className="grid gap-1 rounded-md border border-slate-200 p-3 text-sm sm:grid-cols-[1fr_auto]"><span><b>{text(c.cCodigoProduto)}</b> · {text(c.cDescricaoProduto)}</span><span className="font-semibold tabular-nums">{number(c.nQtdeNFe || c.nQtde).toLocaleString('pt-BR')} {text(c.cUnidadeNfe, '')}</span></div> }) : <p className="rounded-md border border-dashed border-slate-300 p-4 text-slate-600">Nenhum item retornado para este recebimento.</p>}</div></div></Dialog>
}

export const ProductsReceivedScreen = (props: { allowed?: boolean }) => <ReceivingScreen {...props} mode="received" />
