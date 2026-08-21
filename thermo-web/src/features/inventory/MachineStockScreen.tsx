import { ClipboardCheck, LoaderCircle, RefreshCw, ScanLine, Search, Warehouse } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { loadMachineStock, previewMachineStockCount, type MachineStockItem, type ReconciliationItem } from '../../services/machineStockGateway'

function parseCount(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [codigo, raw = '0'] = line.split(/\t|;|\s{2,}/).map((value) => value.trim())
    return { codigo, qty_fisica: Number(raw.replace(',', '.')) }
  }).filter((item) => item.codigo && Number.isFinite(item.qty_fisica))
}

export function MachineStockScreen({ allowed = true }: { allowed?: boolean }) {
  const [items, setItems] = useState<MachineStockItem[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [countText, setCountText] = useState('')
  const [preview, setPreview] = useState<{ date: string; items: ReconciliationItem[] } | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const load = async () => {
    setLoading(true); setError(null)
    try { setItems(await loadMachineStock()) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o estoque.') }
    finally { setLoading(false) }
  }
  useEffect(() => { if (allowed) void load() }, [allowed])
  const visible = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return items
    return items.filter((item) => `${item.codigo} ${item.cod_int || ''} ${item.descricao}`.toLowerCase().includes(value))
  }, [items, query])
  const total = visible.reduce((sum, item) => sum + Number(item.saldo || 0), 0)

  const reconcile = async (event: FormEvent) => {
    event.preventDefault(); setError(null)
    const parsed = parseCount(countText)
    if (!parsed.length) { setError('Cole ao menos uma linha no formato CÓDIGO e QUANTIDADE.'); return }
    setPreviewing(true)
    try { const result = await previewMachineStockCount(parsed); setPreview({ date: result.ultimaData, items: result.resultados || [] }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao comparar a contagem.') }
    finally { setPreviewing(false) }
  }

  if (!allowed) return <section className="rounded-lg border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold">Estoque de Máquinas</h1><p className="mt-2 text-amber-900">Seu usuário não possui acesso a esta rotina.</p></section>
  return <section className="space-y-4" aria-label="Estoque de Máquinas">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Logística</p><h1 className="text-2xl font-bold text-thermo-navy">Estoque de Máquinas</h1><p className="text-sm text-slate-600">Consulta, bipagem e conferência do armazém #MAQ.</p></div><button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 px-3 font-semibold"><RefreshCw className="size-4" />Atualizar</button></header>
    {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    <div className="grid gap-3 sm:grid-cols-2"><article className="rounded-lg border border-slate-200 bg-white p-4"><Warehouse className="size-5 text-slate-500" /><p className="mt-2 text-sm text-slate-500">Produtos no #MAQ</p><strong className="text-2xl">{items.length}</strong></article><article className="rounded-lg border border-slate-200 bg-white p-4"><ClipboardCheck className="size-5 text-slate-500" /><p className="mt-2 text-sm text-slate-500">Saldo somado</p><strong className="text-2xl tabular-nums">{total.toLocaleString('pt-BR')}</strong></article></div>
    <div className="relative"><Search className="absolute left-3 top-3 size-5 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar ou bipar código" className="min-h-11 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3" autoFocus /></div>
    {loading ? <div className="grid min-h-40 place-items-center"><LoaderCircle className="size-6 animate-spin" /></div> : <div className="overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="max-h-[40vh] overflow-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-3">Código</th><th className="p-3">Descrição</th><th className="p-3 text-right">Saldo #MAQ</th></tr></thead><tbody>{visible.map((item) => <tr key={`${item.codigo}-${item.cod_int}`} className="border-t border-slate-100"><td className="p-3 font-mono font-semibold">{item.codigo}</td><td className="p-3">{item.descricao}</td><td className="p-3 text-right font-bold tabular-nums">{Number(item.saldo || 0).toLocaleString('pt-BR')}</td></tr>)}</tbody></table></div>{!visible.length && <p className="p-6 text-center text-slate-500">Nenhum produto encontrado.</p>}</div>}
    <form onSubmit={reconcile} className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><ScanLine className="size-5" /><h2 className="font-bold">Conferir contagem física</h2></div><p className="mt-1 text-sm text-slate-600">Cole uma linha por produto: código, TAB e quantidade. Esta etapa apenas calcula; não altera estoque.</p><textarea value={countText} onChange={(event) => { setCountText(event.target.value); setPreview(null) }} rows={5} placeholder={'CODIGO\tQUANTIDADE'} className="mt-3 w-full rounded-md border border-slate-300 p-3 font-mono text-sm" /><button disabled={previewing} className="mt-3 min-h-10 rounded-md bg-thermo-navy px-4 font-semibold text-white disabled:opacity-50">{previewing ? 'Comparando…' : 'Calcular diferenças'}</button></form>
    {preview && <section className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">Prévia da posição de {preview.date}</h2><p className="text-sm text-slate-600">Nenhuma movimentação foi executada.</p><div className="mt-3 overflow-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">Código</th><th className="p-2 text-right">Sistema</th><th className="p-2 text-right">Contado</th><th className="p-2 text-right">Diferença</th><th className="p-2 text-left">Sugestão</th></tr></thead><tbody>{preview.items.map((item) => <tr key={item.codigo} className="border-t"><td className="p-2 font-mono">{item.codigo}</td><td className="p-2 text-right">{item.qtySistema}</td><td className="p-2 text-right">{item.qtyFisica}</td><td className="p-2 text-right font-bold">{item.delta > 0 ? '+' : ''}{item.delta}</td><td className="p-2">{item.tipo === 'TRF' ? `Transferência ${item.origemTrfNome || '#MAQ'} → ${item.destinoTrfNome || '#MAQ'}` : item.tipo === 'ENT' ? 'Entrada' : 'Sem ajuste'}</td></tr>)}</tbody></table></div></section>}
  </section>
}
