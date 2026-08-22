import { clsx } from 'clsx'
import {
  AlertCircle,
  Boxes,
  Check,
  Eye,
  EyeOff,
  Filter,
  ImageOff,
  LayoutGrid,
  List,
  LoaderCircle,
  LockKeyhole,
  PackageX,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ModalShell } from '../../components/ModalShell'
import {
  deleteReceiptIdentification,
  errorMessage,
  isPermissionFailure,
  loadPrinterSetup,
  loadIdentificationPhoto,
  loadReceiptIdentifications,
  printReceiptIdentifications,
  printSplitReceiptIdentification,
  reopenReceiptIdentification,
  setReceiptIdentificationHidden,
  type LogisticsFlow,
  type PrintResult,
  type PrinterOption,
  type ReceiptIdentification,
} from '../../services/logistics'

function quantity(value: number, unit?: string | null) {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(Number(value) || 0)} ${unit || 'UN'}`
}

function dateTime(value?: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function isWholeUnit(unit?: string | null) {
  return /^(UN|UND|PC|PCS|PÇ|PÇS|PEÇA|PEÇAS|CT)$/i.test(String(unit || '').trim())
}

function divisionSuggestions(total: number, mode: 'etiquetas' | 'embalagem', unit?: string | null) {
  if (!(total > 0)) return []
  const whole = isWholeUnit(unit)
  if (mode === 'etiquetas') {
    return Array.from({ length: Math.min(12, Math.floor(total)) }, (_, index) => index + 1)
      .filter((labels) => !whole || Number.isInteger(total / labels))
      .slice(0, 6)
  }
  const limit = Math.min(12, Math.floor(total))
  return Array.from({ length: limit }, (_, index) => index + 1)
    .map((labels) => Number((total / labels).toFixed(4)))
    .filter((size) => !whole || Number.isInteger(size))
    .filter((size, index, all) => size > 0 && all.indexOf(size) === index)
    .slice(0, 6)
}

export function calculateDivision(
  total: number,
  mode: 'etiquetas' | 'embalagem',
  rawValue: number,
  unit?: string | null,
) {
  if (!(total > 0) || !(rawValue > 0)) return { valid: false as const, message: 'Informe um valor maior que zero.' }
  if (mode === 'etiquetas') {
    if (!Number.isInteger(rawValue)) return { valid: false as const, message: 'O número de etiquetas precisa ser inteiro.' }
    const multiple = total / rawValue
    if (isWholeUnit(unit) && !Number.isInteger(multiple)) {
      return { valid: false as const, message: `${quantity(total, unit)} não podem ser divididas igualmente em ${rawValue} etiquetas.` }
    }
    return { valid: true as const, multiple, labels: rawValue, perLabel: multiple, remainder: 0 }
  }
  const full = Math.floor(total / rawValue)
  const remainder = Number((total - full * rawValue).toFixed(6))
  return {
    valid: true as const,
    multiple: rawValue,
    labels: Math.max(1, full + (remainder > 0.000001 ? 1 : 0)),
    perLabel: rawValue,
    remainder,
  }
}

function triggerDownload(result: Extract<PrintResult, { kind: 'download' }>) {
  const url = URL.createObjectURL(result.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = result.filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function DivisionDialog({
  receipt,
  printers,
  selectedPrinter,
  username,
  onClose,
  onPrinted,
}: {
  receipt: ReceiptIdentification | null
  printers: PrinterOption[]
  selectedPrinter: string
  username: string
  onClose: () => void
  onPrinted: (message: string) => void
}) {
  const [mode, setMode] = useState<'etiquetas' | 'embalagem'>('etiquetas')
  const [value, setValue] = useState('')
  const [printer, setPrinter] = useState(selectedPrinter)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!receipt) return
    setMode('etiquetas')
    setValue('')
    setPrinter(selectedPrinter)
    setError(null)
  }, [receipt, selectedPrinter])

  const division = useMemo(
    () => receipt ? calculateDivision(Number(receipt.qtd) || 0, mode, Number(value), receipt.unidade) : null,
    [mode, receipt, value],
  )
  const suggestions = useMemo(
    () => receipt ? divisionSuggestions(Number(receipt.qtd) || 0, mode, receipt.unidade) : [],
    [mode, receipt],
  )

  const submit = async () => {
    if (!receipt || !division?.valid || !printer) {
      setError(!printer ? 'Escolha a impressora antes de continuar.' : division?.message || 'Informe uma divisão válida.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await printSplitReceiptIdentification({
        id: receipt.id,
        multiple: division.multiple,
        printer,
        username,
      })
      if (result.kind === 'download') triggerDownload(result)
      onPrinted(`${division.labels} etiqueta(s) gerada(s) para ${receipt.codigo_produto || 'o produto'}.`)
      onClose()
    } catch (printError) {
      setError(errorMessage(printError, 'Falha ao gerar as etiquetas divididas.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell open={Boolean(receipt)} title="Dividir em etiquetas" description={receipt ? `Quantidade total recebida: ${quantity(receipt.qtd, receipt.unidade)}` : undefined} onClose={onClose} panelStyle={{ width: 'min(100vw, 42rem)', maxWidth: '42rem', flexShrink: 0 }}>
      <div className="space-y-5">
        <fieldset>
          <legend className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Forma de dividir</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {([['etiquetas', 'Número de etiquetas', 'Ex.: recebi 4 caixas e quero 4 etiquetas.'], ['embalagem', 'Quantidade por embalagem', 'Ex.: cada caixa contém 200 peças.']] as const).map(([option, title, hint]) => (
              <label key={option} className={clsx('cursor-pointer rounded-xl border p-3', mode === option ? 'border-thermo-navy bg-thermo-bg' : 'border-thermo-border')}>
                <input className="mr-2" type="radio" name="division-mode" checked={mode === option} onChange={() => setMode(option)} />
                <strong className="text-sm text-thermo-navy">{title}</strong><small className="mt-1 block pl-5 text-slate-500">{hint}</small>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{mode === 'etiquetas' ? 'Quantas etiquetas deseja imprimir?' : `Quantidade em cada embalagem (${receipt?.unidade || 'UN'})`}</span>
          <input value={value} onChange={(event) => setValue(event.target.value)} type="number" min="1" step={mode === 'etiquetas' ? '1' : 'any'} className="min-h-11 w-full rounded-xl border border-thermo-border bg-white px-3 py-2 text-base outline-none focus:border-thermo-navy" />
        </label>
        {suggestions.length ? <div className="flex flex-wrap gap-2" aria-label="Sugestões de divisão">{suggestions.map((suggestion) => <button key={suggestion} type="button" className="thermo-chip min-h-10" onClick={() => setValue(String(suggestion))}>{suggestion}</button>)}</div> : null}

        {division ? (
          <div className={clsx('rounded-xl border px-4 py-3 text-sm', division.valid ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-red-200 bg-red-50 text-red-700')} role={division.valid ? 'status' : 'alert'}>
            {division.valid ? (
              <><strong>Resultado:</strong> {division.labels} etiqueta(s); {division.remainder > 0 ? `${division.labels - 1} com ${quantity(division.perLabel, receipt?.unidade)} e 1 com ${quantity(division.remainder, receipt?.unidade)}.` : `cada uma com ${quantity(division.perLabel, receipt?.unidade)}.`} Cada volume terá ID próprio.</>
            ) : division.message}
          </div>
        ) : null}

        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Impressora ativa</span>
          <select value={printer} onChange={(event) => setPrinter(event.target.value)} className="min-h-11 w-full rounded-xl border border-thermo-border bg-white px-3 py-2 text-sm outline-none focus:border-thermo-navy">
            <option value="">— nenhuma selecionada —</option>
            {printers.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div> : null}
        <div className="flex justify-end gap-2 border-t border-thermo-border pt-4"><button className="thermo-button thermo-button-secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="thermo-button thermo-button-primary" type="button" onClick={() => void submit()} disabled={busy || !division?.valid || !printer}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Printer className="size-4" />}Imprimir etiquetas</button></div>
      </div>
    </ModalShell>
  )
}

export function IdentifyProductScreen({
  flow = 'recebimento',
  allowed = true,
  username,
  onReadyToStore,
}: {
  flow?: LogisticsFlow
  allowed?: boolean
  username: string
  onReadyToStore?: (ids: number[]) => void
}) {
  const [items, setItems] = useState<ReceiptIdentification[]>([])
  const [query, setQuery] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [withoutMp, setWithoutMp] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [printers, setPrinters] = useState<PrinterOption[]>([])
  const [printer, setPrinter] = useState('')
  const [printerError, setPrinterError] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [divisionReceipt, setDivisionReceipt] = useState<ReceiptIdentification | null>(null)
  const [deleteReceipt, setDeleteReceipt] = useState<ReceiptIdentification | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'grid'>('list')

  const canDelete = String(username || '').trim().toLowerCase() === 'jair.r'

  const load = useCallback(async (search = query) => {
    if (!allowed) return
    setLoading(true)
    setError(null)
    setPermissionDenied(false)
    try {
      const response = await loadReceiptIdentifications({
        query: search,
        flow,
        showHidden,
        withoutMp,
      })
      setItems((response.etiquetas || []).filter((item) => (Number(item.qtd) || 0) > 0))
      setSelected(new Set())
    } catch (loadError) {
      if (isPermissionFailure(loadError)) setPermissionDenied(true)
      setError(errorMessage(loadError, 'Falha ao carregar as identificações pendentes.'))
    } finally {
      setLoading(false)
    }
  }, [allowed, flow, query, showHidden, withoutMp])

  useEffect(() => {
    if (!allowed) return
    const timer = setTimeout(() => void load(query), 350)
    return () => clearTimeout(timer)
  }, [allowed, load, query])

  useEffect(() => {
    if (!allowed) return
    loadPrinterSetup(username)
      .then((setup) => {
        setPrinters(setup.options)
        const saved = sessionStorage.getItem('thermo-identification-printer')
        setPrinter(saved && setup.options.some((option) => option.value === saved) ? saved : setup.defaultValue || '')
        setPrinterError(setup.options.length ? null : 'Nenhuma impressora online ou configurada foi encontrada.')
      })
      .catch((loadError) => setPrinterError(errorMessage(loadError, 'Falha ao carregar impressoras.')))
  }, [allowed, username])

  useEffect(() => { if (printer) sessionStorage.setItem('thermo-identification-printer', printer) }, [printer])

  const updateItem = async (item: ReceiptIdentification, action: 'hidden' | 'reopen') => {
    const key = `${action}:${item.id}`
    setActionBusy(key)
    setNotice(null)
    try {
      if (action === 'hidden') {
        const hidden = !showHidden
        if (hidden && !window.confirm(`Ocultar ${item.codigo_produto || 'este item'}? Ele poderá ser recuperado em “Exibir itens ocultos”.`)) return
        await setReceiptIdentificationHidden(item.id, hidden)
        setNotice(hidden ? 'Identificação ocultada.' : 'Identificação desocultada.')
      } else {
        await reopenReceiptIdentification(item.id)
        setNotice('Identificação reaberta para impressão.')
      }
      void load(query)
    } catch (actionError) {
      setError(errorMessage(actionError, 'Falha ao atualizar a identificação.'))
    } finally {
      setActionBusy(null)
    }
  }

  const printSelected = async () => {
    const ids = [...selected]
    if (!ids.length || !printer) {
      setError(!printer ? 'Escolha a impressora antes de continuar.' : 'Selecione ao menos uma etiqueta.')
      return
    }
    setPrinting(true)
    setError(null)
    try {
      const result = await printReceiptIdentifications({ ids, printer, username })
      if (result.kind === 'download') triggerDownload(result)
      const count = result.kind === 'queued' ? result.quantity : ids.length
      setNotice(`${count} etiqueta(s) ${result.kind === 'download' ? 'gerada(s) em PDF' : 'enviada(s) para impressão'}.`)
      onReadyToStore?.(ids)
      setSelected(new Set())
      void load(query)
    } catch (printError) {
      setError(errorMessage(printError, 'Falha ao imprimir as etiquetas selecionadas.'))
    } finally {
      setPrinting(false)
    }
  }

  if (!allowed) {
    return <section className="rounded-xl border border-amber-200 bg-amber-50 p-6" aria-label="Sem permissão para Identificação do produto"><LockKeyhole className="size-6 text-amber-700" /><h1 className="mt-3 text-xl font-bold text-thermo-navy">Identificação do produto</h1><p className="mt-2 max-w-2xl text-sm text-amber-900">Sua conta não possui a permissão deste item de navegação. Solicite acesso ao responsável pelo sistema.</p></section>
  }

  return (
    <section className="min-w-0 space-y-4" aria-labelledby="identify-product-title">
      <header className="rounded-xl border border-thermo-border bg-white px-4 py-4 shadow-sm sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-sky-700"><Printer className="size-4" />Etapa 1 · Identificar{flow === 'expedicao' ? ' · Tipo 00' : ''}</div><h1 id="identify-product-title" className="mt-1 text-xl font-bold text-thermo-navy">Identificação do produto</h1><p className="mt-1 text-sm text-slate-500">Itens aprovados no PIR aguardando impressão de etiqueta.</p></div>
          <button className="thermo-button thermo-button-primary min-h-11" type="button" onClick={() => void printSelected()} disabled={printing || selected.size === 0 || !printer}>{printing ? <LoaderCircle className="size-4 animate-spin" /> : <Printer className="size-4" />}Imprimir {selected.size || ''} {selected.size === 1 ? 'etiqueta' : 'etiquetas'}</button>
        </div>
      </header>

      <div className="rounded-xl border border-thermo-border bg-white p-3 shadow-sm sm:p-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(16rem,1fr)_minmax(15rem,.7fr)_auto]">
          <label className="relative block"><span className="sr-only">Pesquisar identificações</span><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar por lote, código ou descrição" className="min-h-11 w-full rounded-xl border border-thermo-border py-2 pl-10 pr-3 text-base outline-none focus:border-thermo-navy" /></label>
          <label className="relative block"><span className="sr-only">Impressora ativa</span><Printer className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" /><select value={printer} onChange={(event) => setPrinter(event.target.value)} className="min-h-11 w-full rounded-xl border border-thermo-border bg-white py-2 pl-10 pr-3 text-sm outline-none focus:border-thermo-navy"><option value="">— nenhuma impressora selecionada —</option>{printers.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <button className="thermo-toolbar-button" type="button" onClick={() => void load(query)} disabled={loading}><RefreshCw className={clsx('size-4', loading && 'animate-spin')} />Atualizar lista</button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className={clsx('thermo-chip min-h-11', showHidden && 'thermo-chip-active')} type="button" aria-pressed={showHidden} onClick={() => setShowHidden((current) => !current)}>{showHidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}{showHidden ? 'Ver itens ativos' : 'Exibir itens ocultos'}</button>
          <button className={clsx('thermo-chip min-h-11', withoutMp && 'thermo-chip-active')} type="button" aria-pressed={withoutMp} onClick={() => setWithoutMp((current) => !current)}><Filter className="size-3.5" />{withoutMp ? 'Ver todos' : 'Exibir sem MP'}</button>
          <div className="ml-auto flex items-center gap-1" aria-label="Visualização"><button className={clsx('thermo-icon-button', view === 'list' && 'bg-thermo-navy text-white')} type="button" aria-label="Visualização em lista" aria-pressed={view === 'list'} onClick={() => setView('list')}><List className="size-4" /></button><button className={clsx('thermo-icon-button', view === 'grid' && 'bg-thermo-navy text-white')} type="button" aria-label="Visualização em grade" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid className="size-4" /></button></div>
          <span className="text-xs text-slate-500">{items.length} etiqueta(s) · {selected.size} selecionada(s)</span>
        </div>
      </div>

      {printerError ? <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status"><Settings2 className="mt-0.5 size-4 shrink-0" />{printerError}</div> : null}
      {notice ? <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status"><Check className="mt-0.5 size-4 shrink-0" />{notice}</div> : null}
      {permissionDenied ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-900" role="alert"><strong className="block text-thermo-navy">Sem permissão ou sessão expirada</strong>{error}</div> : null}
      {!permissionDenied && error ? <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{error}</span><button className="ml-auto font-semibold underline" type="button" onClick={() => void load(query)}>Tentar novamente</button></div> : null}

      <div className="overflow-hidden rounded-xl border border-thermo-border bg-white shadow-sm">
        {view === 'list' ? <div className="hidden grid-cols-[2.5rem_3.5rem_minmax(12rem,1.2fr)_minmax(7rem,.55fr)_minmax(10rem,.8fr)_minmax(8rem,.6fr)_minmax(16rem,1.2fr)] gap-3 border-b border-thermo-border bg-thermo-bg px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 2xl:grid"><span /><span>Foto</span><span>Produto</span><span>Lote</span><span>Origem</span><span>Quantidade</span><span>Ações</span></div> : null}
        {loading && items.length === 0 ? <div className="space-y-3 p-4" aria-label="Carregando identificações"><div className="h-20 animate-pulse rounded-xl bg-slate-100" /><div className="h-20 animate-pulse rounded-xl bg-slate-100" /></div> : null}
        {!loading && !error && items.length === 0 ? <div className="px-6 py-14 text-center"><Boxes className="mx-auto size-8 text-slate-300" /><h2 className="mt-3 font-bold text-thermo-navy">Nenhuma etiqueta pendente encontrada</h2><p className="mt-1 text-sm text-slate-500">Ajuste a busca ou os filtros.</p></div> : null}
        <div className={clsx(view === 'grid' && 'grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3')}>{items.map((item) => {
          const selectable = !item.impressa
          const checked = selected.has(item.id)
          return (
            <article key={item.id} className={clsx('grid gap-3 px-4 py-4', view === 'list' ? 'border-b border-thermo-border last:border-b-0 2xl:grid-cols-[2.5rem_3.5rem_minmax(12rem,1.2fr)_minmax(7rem,.55fr)_minmax(10rem,.8fr)_minmax(8rem,.6fr)_minmax(16rem,1.2fr)] 2xl:items-center' : 'rounded-lg border border-thermo-border sm:grid-cols-[auto_3.5rem_1fr]', checked && 'bg-sky-50/60')} data-testid="identification-row">
              <label className="flex min-h-11 items-center"><span className="sr-only">Selecionar {item.codigo_produto}</span><input type="checkbox" disabled={!selectable} checked={checked} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next })} className="size-5 accent-thermo-navy" /></label>
              <IdentificationPhoto code={item.codigo_produto} description={item.descricao_produto} />
              <div><div className="font-mono text-xs font-semibold text-slate-500">{item.codigo_produto || '—'}</div><div className="mt-1 text-sm font-bold text-thermo-navy">{item.descricao_produto || 'Produto sem descrição'}</div><span className="mt-1 block text-xs text-slate-500">Recebido em {dateTime(item.criado_em)}</span></div>
              <div><span className="2xl:hidden text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Lote · </span><strong className="font-mono text-sm">{item.lote || '—'}</strong></div>
              <div className="text-sm"><strong className="block">{item.numero_nfe ? `NF-e Nº ${item.numero_nfe}` : item.numero_pedido ? `Pedido Nº ${item.numero_pedido}` : 'Sem documento'}</strong>{item.data_emissao ? <span className="text-xs text-slate-500">Emissão: {item.data_emissao}</span> : null}</div>
              <div><strong className="text-sm">{quantity(item.qtd, item.unidade)}</strong>{item.impressa ? <span className="mt-1 block w-fit rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Impresso</span> : <span className="mt-1 block w-fit rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">Pendente</span>}</div>
              <div className="flex flex-wrap gap-2">
                {item.impressa ? <button className="thermo-button thermo-button-secondary min-h-11" type="button" onClick={() => void updateItem(item, 'reopen')} disabled={actionBusy === `reopen:${item.id}`}><RotateCcw className="size-4" />Reabrir</button> : <button className="thermo-button thermo-button-secondary min-h-11" type="button" onClick={() => setDivisionReceipt(item)}><Boxes className="size-4" />Dividir volumes</button>}
                <button className="thermo-icon-button" type="button" onClick={() => void updateItem(item, 'hidden')} disabled={actionBusy === `hidden:${item.id}`} aria-label={showHidden ? `Desocultar ${item.codigo_produto}` : `Ocultar ${item.codigo_produto}`} title={showHidden ? 'Desocultar' : 'Ocultar'}>{showHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}</button>
                {canDelete ? <button className="thermo-icon-button border-red-200 text-red-700 hover:border-red-400 hover:text-red-800" type="button" onClick={() => { setDeleteError(null); setDeleteReceipt(item) }} aria-label={`Excluir identificação de ${item.codigo_produto}`} title="Excluir identificação"><Trash2 className="size-4" /></button> : null}
              </div>
            </article>
          )
        })}</div>
      </div>

      <DivisionDialog receipt={divisionReceipt} printers={printers} selectedPrinter={printer} username={username} onClose={() => setDivisionReceipt(null)} onPrinted={(message) => { setNotice(message); setSelected(new Set()); void load(query) }} />

      <ModalShell open={Boolean(deleteReceipt)} title="Excluir identificação" description="A entrada de estoque/Omie e o cadastro do produto não serão desfeitos." onClose={() => { if (!actionBusy) setDeleteReceipt(null) }}>
        <div className="space-y-4">
          {deleteReceipt ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800"><strong className="block text-red-900">{deleteReceipt.codigo_produto} · {deleteReceipt.descricao_produto}</strong><span className="mt-1 block">Lote {deleteReceipt.lote || 'não informado'} · {quantity(deleteReceipt.qtd, deleteReceipt.unidade)}</span><span className="mt-2 block">Use somente para entradas duplicadas ou materiais que já entraram por outro processo.</span></div> : null}
          {deleteError ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{deleteError}</div> : null}
          <div className="flex justify-end gap-2"><button className="thermo-button thermo-button-secondary" type="button" onClick={() => setDeleteReceipt(null)} disabled={Boolean(actionBusy)}>Cancelar</button><button className="thermo-button border-red-700 bg-red-700 text-white hover:bg-red-800" type="button" disabled={Boolean(actionBusy)} onClick={async () => {
            if (!deleteReceipt) return
            setActionBusy(`delete:${deleteReceipt.id}`); setDeleteError(null)
            try {
              await deleteReceiptIdentification(deleteReceipt.id)
              setNotice(`Identificação de ${deleteReceipt.codigo_produto || 'produto'} excluída.`)
              setDeleteReceipt(null)
              void load(query)
            } catch (deleteFailure) { setDeleteError(errorMessage(deleteFailure, 'Falha ao excluir identificação.')) }
            finally { setActionBusy(null) }
          }}>{actionBusy ? <LoaderCircle className="size-4 animate-spin" /> : <PackageX className="size-4" />}Excluir identificação</button></div>
        </div>
      </ModalShell>
    </section>
  )
}

function IdentificationPhoto({ code, description }: { code: string | null; description: string | null }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { if (code) void loadIdentificationPhoto(code).then(setUrl).catch(() => setUrl(null)) }, [code])
  return url ? <img className="size-11 rounded-lg border border-thermo-border object-cover" src={url} alt={`Foto de ${description || code || 'produto'}`} /> : <div className="flex size-11 items-center justify-center rounded-lg border border-dashed border-thermo-border bg-thermo-bg text-slate-400" aria-label={`Foto de ${code || 'produto'} indisponível`}><ImageOff className="size-4" /></div>
}
