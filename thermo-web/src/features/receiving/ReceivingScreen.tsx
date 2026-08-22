import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, FileSearch, LoaderCircle, PackageCheck, RefreshCw, Search, ShoppingCart, X } from 'lucide-react'
import {
  confirmNfeAssociation,
  findNfeKey,
  loadNfeDetails,
  loadPendingReceipts,
  loadReceivedProducts,
  loadActivePurchaseCategories,
  locateNfe,
  locatePurchaseOrder,
  previewNfeAssociation,
} from '../../services/receivingGateway'
import type { AssociationInput, AssociationItemOverride, AssociationPreviewResponse, LocateNfeResponse, NfeDetailsResponse, PurchaseCategory, ReceivingLocatorOrder, ReceivingMode, ReceivingOrder, ReceivingRow } from './types'

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
  const [overrides, setOverrides] = useState<Record<number, AssociationItemOverride>>({})
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState<PurchaseCategory[]>([])
  const [previewDirty, setPreviewDirty] = useState(false)

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
      setPreview(await previewNfeAssociation({ ...input, itens_override: Object.values(overrides), nova_categoria_compra: category || undefined }))
      setPreviewDirty(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível gerar a prévia.') }
    finally { setDetailsLoading(false) }
  }

  const confirmAssociation = async () => {
    if (!association || !preview) return
    setDetailsLoading(true); setError('')
    try {
      const input: AssociationInput = { numero_nfe: association.nfe.trim(), numero_pedido: association.order.cnumero, n_cod_ped: Number(association.order.n_cod_ped), itens_override: Object.values(overrides), nova_categoria_compra: category || undefined }
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
    {mode === 'receiving' && <ReceivingLocator onAssociate={(order, nfe) => setAssociation({ order: locatorOrder(order), nfe })} />}
    <label className="relative block"><span className="sr-only">Pesquisar pedidos, produtos ou fornecedores</span><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-500" /><input value={query} onChange={(e) => setQuery(e.target.value)} className="min-h-11 w-full rounded-md border border-slate-300 bg-white pl-10 pr-4 text-base outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200" placeholder="Pesquisar pedido, produto, fornecedor, etapa ou NF-e" type="search" /></label>
    {error && <div role="alert" className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{error}</span></div>}
    {mutationMessage && <div role="status" className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /><span>{mutationMessage}</span></div>}
    {loading ? <div className="grid min-h-56 place-items-center text-slate-600" role="status"><span className="inline-flex items-center gap-2"><LoaderCircle className="size-5 animate-spin" />Carregando recebimentos…</span></div> : orders.length === 0 ? <div className="grid min-h-56 place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><div><PackageCheck className="mx-auto size-8 text-slate-500" /><p className="mt-3 font-semibold">{query ? 'Nenhum resultado para os filtros.' : mode === 'receiving' ? 'Nenhum pedido aguardando recebimento.' : 'Nenhum produto recebido.'}</p></div></div> : <div className="grid gap-3" aria-live="polite">{orders.map((order) => <OrderCard key={order.key} order={order} mode={mode} onNfe={openNfe} onAssociate={() => setAssociation({ order, nfe: '' })} />)}</div>}
    {detailsLoading && !association && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40" role="status"><span className="rounded-md bg-white px-5 py-4 font-semibold"><LoaderCircle className="mr-2 inline size-5 animate-spin" />Consultando NF-e…</span></div>}
    {details && <NfeDialog details={details} onClose={() => setDetails(null)} />}
    {association && <Dialog title={`Associar NF-e ao pedido ${association.order.cnumero}`} onClose={() => { setAssociation(null); setPreview(null) }}><AssociationEditor nfe={association.nfe} setNfe={(nfe)=>{setAssociation({...association,nfe});setPreview(null);setOverrides({});setCategory('')}} preview={preview} overrides={overrides} setOverrides={(next)=>{setOverrides(next);setPreviewDirty(true)}} category={category} setCategory={(next)=>{setCategory(next);setPreviewDirty(true)}} categories={categories} loadCategories={async()=>{if(categories.length)return;try{setCategories((await loadActivePurchaseCategories()).categorias.filter(c=>c.conta_inativa!=='S'))}catch(e){setError(e instanceof Error?e.message:'Falha ao carregar categorias.')}}} loading={detailsLoading} cancel={()=>{setAssociation(null);setPreview(null)}} generate={()=>void previewAssociation()} confirm={()=>void confirmAssociation()} dirty={previewDirty}/></Dialog>}
  </main>
}

function locatorOrder(order: ReceivingLocatorOrder): ReceivingOrder {
  const rows: ReceivingRow[] = (order.itens || []).map((item, index) => ({
    id: item.n_cod_item || index + 1,
    n_cod_ped: order.n_cod_ped,
    n_cod_item: item.n_cod_item,
    cnumero: order.cnumero,
    produto_codigo: item.produto_codigo,
    produto_descricao: item.produto_descricao,
    quantidade: item.quantidade,
    unidade: item.unidade,
    valor_item: item.valor_item,
    fornecedor_nome_fantasia: order.fornecedor,
  }))
  const first = rows[0] || { id: order.n_cod_ped, n_cod_ped: order.n_cod_ped, cnumero: order.cnumero, fornecedor_nome_fantasia: order.fornecedor }
  return { key: String(order.n_cod_ped), n_cod_ped: order.n_cod_ped, cnumero: order.cnumero, rows, first }
}

const normalizeWords = (value: unknown) => new Set(String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]{2,}/g) || [])
function suggestionScore(nfe: LocateNfeResponse, order: ReceivingLocatorOrder) {
  const nfeWords = normalizeWords(nfe.itens.map(item => item.descricao).join(' '))
  const orderWords = normalizeWords((order.itens || []).map(item => item.produto_descricao).join(' '))
  const union = new Set([...nfeWords, ...orderWords])
  const common = [...nfeWords].filter(word => orderWords.has(word)).length
  const description = union.size ? common / union.size : 0
  const nfeTotal = number(nfe.nfe.n_valor_nfe) || nfe.itens.reduce((sum, item) => sum + number(item.vlr_item), 0)
  const orderTotal = (order.itens || []).reduce((sum, item) => sum + number(item.valor_item), 0)
  const value = nfeTotal > 0 && orderTotal > 0 ? 1 - Math.min(1, Math.abs(nfeTotal - orderTotal) / Math.max(nfeTotal, orderTotal)) : 0
  const itemCount = nfe.itens.length && order.itens?.length ? 1 - Math.min(1, Math.abs(nfe.itens.length - order.itens.length) / Math.max(nfe.itens.length, order.itens.length)) : 0
  return Math.round((description * .6 + value * .25 + itemCount * .15) * 100)
}

function ReceivingLocator({ onAssociate }: { onAssociate: (order: ReceivingLocatorOrder, nfe: string) => void }) {
  const [mode, setMode] = useState<'nfe' | 'pedido'>('nfe')
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [nfeResult, setNfeResult] = useState<LocateNfeResponse | null>(null)
  const [keyResult, setKeyResult] = useState<Record<string, unknown> | null>(null)
  const [orderResult, setOrderResult] = useState<ReceivingLocatorOrder | null>(null)
  const [lastNfe, setLastNfe] = useState('')

  const search = async () => {
    if (!value.trim()) return
    setLoading(true); setError(''); setNfeResult(null); setKeyResult(null); setOrderResult(null)
    try {
      if (mode === 'pedido') setOrderResult((await locatePurchaseOrder(value)).pedido)
      else {
        const result = await locateNfe(value)
        if ('nfe' in result) { setNfeResult(result); setLastNfe(text(result.nfe.c_numero_nfe, value)) }
        else { setKeyResult(result.recebimento); setLastNfe(text(result.recebimento.c_numero_nfe, value)) }
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível localizar o documento.') }
    finally { setLoading(false) }
  }
  const readOnly = nfeResult ? ['S'].includes(text(nfeResult.nfe.c_recebido, '').toUpperCase()) || ['50', '60', '80'].includes(text(nfeResult.nfe.c_etapa, '')) || text(nfeResult.nfe.c_cancelada, '').toUpperCase() === 'S' : false
  const suggestions = nfeResult ? [...nfeResult.pedidos_sugeridos].map(order => ({ order, score: suggestionScore(nfeResult, order) })).sort((a, b) => b.score - a.score || String(a.order.cnumero).localeCompare(String(b.order.cnumero))) : []
  return <section className="rounded-lg border border-violet-200 bg-white shadow-sm" aria-labelledby="receiving-locator-title">
    <div className="flex flex-col gap-3 border-b border-violet-100 p-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 id="receiving-locator-title" className="font-bold text-slate-900">Localizar NF-e</h2><p className="text-sm text-slate-600">Consulte por número, chave de 44 dígitos ou número do pedido.</p></div><div className="grid grid-cols-2 rounded-md bg-violet-50 p-1" role="tablist"><button role="tab" aria-selected={mode === 'nfe'} onClick={() => { setMode('nfe'); setValue('') }} className={`min-h-10 rounded px-3 text-sm font-semibold ${mode === 'nfe' ? 'bg-white text-violet-800 shadow-sm' : 'text-slate-600'}`}>Por NF-e/chave</button><button role="tab" aria-selected={mode === 'pedido'} onClick={() => { setMode('pedido'); setValue('') }} className={`min-h-10 rounded px-3 text-sm font-semibold ${mode === 'pedido' ? 'bg-white text-violet-800 shadow-sm' : 'text-slate-600'}`}>Por pedido</button></div></div>
    <form className="flex flex-col gap-2 p-3 sm:flex-row" onSubmit={e => { e.preventDefault(); void search() }}><label className="relative flex-1"><span className="sr-only">{mode === 'nfe' ? 'Número ou chave da NF-e' : 'Número do pedido'}</span>{mode === 'nfe' ? <FileSearch className="absolute left-3 top-3.5 size-4 text-violet-700" /> : <ShoppingCart className="absolute left-3 top-3.5 size-4 text-violet-700" />}<input value={value} onChange={e => setValue(e.target.value)} className="min-h-11 w-full rounded-md border border-violet-200 pl-10 pr-3" placeholder={mode === 'nfe' ? 'Número ou chave da NF-e' : 'Número do pedido de compra'} /></label><button disabled={loading || !value.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-violet-700 px-5 font-semibold text-white disabled:opacity-50">{loading ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}Buscar</button></form>
    {error && <p role="alert" className="mx-3 mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    {keyResult && <div className="mx-3 mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm"><b>NF-e localizada pela chave.</b><p>NF-e {text(keyResult.c_numero_nfe)} · {text(keyResult.c_nome_fornecedor)} · {number(keyResult.itens_total)} item(ns).</p><p className="mt-1 text-slate-600">Para sugerir pedidos, pesquise também pelo número da NF-e.</p></div>}
    {orderResult && <div className="mx-3 mb-3 flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"><div><b>Pedido {orderResult.cnumero}</b><p className="text-sm text-slate-600">{text(orderResult.fornecedor)} · {(orderResult.itens || []).length} item(ns)</p>{!lastNfe && <p className="mt-2 text-sm text-amber-800">Pesquise primeiro a NF-e para associar com contexto completo.</p>}</div>{lastNfe && <button type="button" onClick={() => onAssociate(orderResult, lastNfe)} className="min-h-11 rounded-md bg-violet-700 px-4 font-semibold text-white">Associar à NF-e {lastNfe}</button>}</div>}
    {nfeResult && <div className="space-y-3 border-t border-violet-100 p-3"><div className="flex flex-wrap items-start justify-between gap-3 rounded-md bg-slate-900 p-3 text-white"><div><b>NF-e {text(nfeResult.nfe.c_numero_nfe)}</b><p className="text-sm text-slate-300">{text(nfeResult.nfe.c_nome_fornecedor)} · {money.format(number(nfeResult.nfe.n_valor_nfe))}</p></div><span className={`rounded-full px-2 py-1 text-xs font-bold ${readOnly ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>{readOnly ? 'Somente consulta' : `Faturada · etapa ${text(nfeResult.nfe.c_etapa)}`}</span></div><div className="overflow-x-auto"><table className="min-w-[640px] w-full text-left text-sm"><thead className="bg-slate-100"><tr><th className="p-2">Código</th><th className="p-2">Descrição</th><th className="p-2 text-right">Qtd.</th><th className="p-2">Un.</th><th className="p-2 text-right">Valor</th></tr></thead><tbody>{nfeResult.itens.map((item, index) => <tr key={`${item.codigo}-${index}`} className="border-b"><td className="p-2 font-mono">{text(item.codigo)}</td><td className="p-2">{text(item.descricao)}</td><td className="p-2 text-right">{number(item.qtd).toLocaleString('pt-BR')}</td><td className="p-2">{text(item.unidade)}</td><td className="p-2 text-right">{money.format(number(item.vlr_item))}</td></tr>)}</tbody></table></div>{!readOnly && <div><h3 className="mb-2 font-bold">Pedidos sugeridos ({suggestions.length})</h3><div className="grid gap-2">{suggestions.map(({ order, score }) => <button key={order.n_cod_ped} type="button" onClick={() => onAssociate(order, text(nfeResult.nfe.c_numero_nfe, value))} className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-violet-200 p-3 text-left hover:bg-violet-50"><span><b>Pedido {order.cnumero}</b><span className="block text-sm text-slate-600">{text(order.fornecedor)} · {(order.itens || []).length} item(ns)</span></span><span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-bold text-violet-900">{score}%</span></button>)}{!suggestions.length && <p className="rounded-md border border-dashed p-3 text-sm text-slate-600">Nenhum pedido candidato localizado.</p>}</div></div>}</div>}
  </section>
}

function AssociationEditor({ nfe, setNfe, preview, overrides, setOverrides, category, setCategory, categories, loadCategories, loading, cancel, generate, confirm, dirty }: { nfe: string; setNfe: (v: string) => void; preview: AssociationPreviewResponse | null; overrides: Record<number, AssociationItemOverride>; setOverrides: (v: Record<number, AssociationItemOverride>) => void; category: string; setCategory: (v: string) => void; categories: PurchaseCategory[]; loadCategories: () => Promise<void>; loading: boolean; cancel: () => void; generate: () => void; confirm: () => void; dirty: boolean }) {
  const data = preview?.preview; const items = data?.itens || []
  const candidates = [...(data?.itens_pedido_informativos || []), ...items].filter((item, index, all) => item.pedido_n_cod_item && all.findIndex(x => x.pedido_n_cod_item === item.pedido_n_cod_item) === index)
  const review = items.filter(i => i.requer_revisao && !i.pedido_item_encontrado && !overrides[number(i.n_sequencia)]?.nIdItPedidoExistente && !overrides[number(i.n_sequencia)]?.nIdProdutoServico).length
  const unmatched = items.filter(i => !i.pedido_item_encontrado && !i.requer_revisao && !overrides[number(i.n_sequencia)]?.nIdItPedidoExistente && !overrides[number(i.n_sequencia)]?.nIdProdutoServico).length
  const priceDiff = items.filter(i => i.criterio_match !== 'agrupamento_mesmo_item_pedido' && !i.conversao_unidade_manual && !i.conversao_unidade_necessaria && Math.abs(number(i.nf_valor_unitario)-number(i.pedido_valor_unitario)) > .01).length
  const quantityDiff = items.filter(i => i.criterio_match !== 'agrupamento_mesmo_item_pedido' && (Math.abs(number(i.nf_qtde)-number(i.pedido_qtde)) > .0001 || text(i.nf_unidade,'').toUpperCase() !== text(i.pedido_unidade || i.pedido_c_unidade,'').toUpperCase())).length
  useEffect(() => { if (data?.categoria?.inativa) void loadCategories() }, [data?.categoria?.inativa, loadCategories])
  const update = (seq: number, patch: Partial<AssociationItemOverride>) => setOverrides({ ...overrides, [seq]: { ...overrides[seq], ...patch, n_sequencia: seq } })
  return <div className="space-y-5"><label className="block font-semibold">Número da NF-e<input autoFocus value={nfe} onChange={e=>setNfe(e.target.value)} className="mt-2 min-h-11 w-full rounded-md border px-3" inputMode="numeric"/></label>{data && <><div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><Metric label="Com match" value={items.filter(i=>i.pedido_item_encontrado).length}/><Metric label="Revisar" value={review}/><Metric label="Sem match" value={unmatched}/><Metric label="Preço divergente" value={priceDiff}/><Metric label="Qtd/Unid divergentes" value={quantityDiff}/><Metric label="Itens informativos" value={(data.itens_pedido_informativos||[]).length}/></div>{data.categoria?.inativa && <label className="block rounded-md border border-amber-300 bg-amber-50 p-3 font-semibold">Categoria substituta ativa<select aria-label="Categoria substituta ativa" value={category} onChange={e=>setCategory(e.target.value)} className="mt-2 min-h-11 w-full rounded-md border bg-white px-3"><option value="">Selecione uma categoria ativa</option>{categories.map(c=><option key={c.codigo} value={c.codigo}>{c.codigo} — {c.descricao}</option>)}</select></label>}<div className="grid gap-3">{items.map(item=>{const seq=number(item.n_sequencia);const ov=overrides[seq];const divergent=Math.abs(number(item.nf_qtde)-number(item.pedido_qtde))>.0001 || text(item.nf_unidade,'').toUpperCase()!==text(item.pedido_unidade||item.pedido_c_unidade,'').toUpperCase() || item.conversao_unidade_necessaria;return <article key={seq} className="rounded-md border p-3"><div className="grid gap-3 md:grid-cols-2"><div><b>NF-e #{seq}: {text(item.nf_codigo_produto)}</b><p className="text-sm">{text(item.nf_descricao_produto)}</p><p className="text-sm">{number(item.nf_qtde)} {text(item.nf_unidade,'')} · {money.format(number(item.nf_valor_unitario))}</p></div><label className="font-semibold">Item do pedido<select aria-label={`Item do pedido para sequência ${seq}`} value={ov?.nIdItPedidoExistente || item.pedido_n_cod_item || ''} onChange={e=>{const chosen=candidates.find(c=>number(c.pedido_n_cod_item)===number(e.target.value));update(seq,{nIdItPedidoExistente:number(chosen?.pedido_n_cod_item)||undefined,nIdPedidoExistente:number(chosen?.pedido_n_cod_ped)||undefined})}} className="mt-1 min-h-11 w-full rounded-md border px-2"><option value="">Selecione com segurança</option>{candidates.map(c=><option key={c.pedido_n_cod_item} value={c.pedido_n_cod_item}>{text(c.pedido_codigo_produto)} · {text(c.pedido_descricao_produto)} · {number(c.pedido_qtde)} {text(c.pedido_unidade||c.pedido_c_unidade,'')}</option>)}</select></label></div>{divergent && <div className="mt-3 grid gap-2 sm:grid-cols-2"><label>Quantidade do pedido<input aria-label={`Quantidade sequência ${seq}`} type="number" min="0.0001" step="any" value={ov?.nQtde ?? item.pedido_qtde ?? ''} onChange={e=>update(seq,{nQtde:Number(e.target.value),conversaoUnidade:Boolean(item.conversao_unidade_necessaria||item.conversao_unidade_manual)})} className="mt-1 min-h-11 w-full rounded-md border px-2"/></label><label>Unidade do pedido<input aria-label={`Unidade sequência ${seq}`} value={ov?.cUnidade ?? item.pedido_unidade ?? item.pedido_c_unidade ?? ''} onChange={e=>update(seq,{cUnidade:e.target.value.trim().toUpperCase(),conversaoUnidade:Boolean(item.conversao_unidade_necessaria||item.conversao_unidade_manual)})} className="mt-1 min-h-11 w-full rounded-md border px-2"/></label></div>}</article>})}</div></>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button onClick={cancel} className="min-h-11 rounded-md border px-4 font-semibold">Cancelar</button>{preview?<><button onClick={generate} disabled={loading||!dirty} className="min-h-11 rounded-md bg-slate-700 px-4 font-semibold text-white disabled:opacity-40">Regerar prévia</button><button onClick={confirm} disabled={loading||dirty||unmatched>0||review>0||Boolean(data?.categoria?.inativa&&!category)} className="min-h-11 rounded-md bg-emerald-700 px-4 font-semibold text-white disabled:opacity-40">Confirmar associação</button></>:<button onClick={generate} disabled={loading||!nfe.trim()} className="min-h-11 rounded-md bg-slate-800 px-4 font-semibold text-white disabled:opacity-40">Gerar prévia</button>}</div>{dirty&&<p role="alert" className="text-sm text-amber-800">Ajustes alterados. Regenere a prévia antes de confirmar.</p>}</div>
}
function Metric({label,value}:{label:string;value:number}) { return <div className="rounded-md border bg-slate-50 p-2"><span className="block text-xs text-slate-600">{label}</span><b>{value}</b></div> }

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
