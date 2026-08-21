import { clsx } from 'clsx'
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  PackageCheck,
  Printer,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Warehouse,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ModalShell } from '../../components/ModalShell'
import {
  errorMessage,
  extractPrintedReceiptId,
  isPermissionFailure,
  loadPrintedReceipt,
  loadPrintedReceipts,
  loadIdentificationPhoto,
  loadPrinterSetup,
  loadProductAddressReferences,
  loadWarehouseLocations,
  reprintPrintedReceipt,
  returnPrintedReceipt,
  storePrintedReceipt,
  validateWarehouseAddress,
  warehouseAddressHint,
  warehouseLocationLabel,
  type LogisticsFlow,
  type PrintedReceipt,
  type PrintedReceiptDetail,
  type PrinterOption,
  type ProductAddressReference,
  type WarehouseLocation,
} from '../../services/logistics'

const fallbackWarehouse: WarehouseLocation = {
  codigo: '#ALMOX',
  descricao: 'Porta Pallet (Almoxarifado)',
  codigo_local_estoque: '10717096386',
}

function quantity(value: number, unit?: string | null) {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(Number(value) || 0)} ${unit || 'UN'}`
}

function dateTime(value?: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function receiptLabel(receipt: Pick<PrintedReceipt, 'id' | 'id_rotulo'>) {
  return String(receipt.id_rotulo || receipt.id)
}

type BarcodeDetectorInstance = {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>
}

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance

function StoreReceiptDialog({
  open,
  initialId,
  locations,
  initialDestination,
  onClose,
  onStored,
  onStoredIds,
}: {
  open: boolean
  initialId: number | null
  locations: WarehouseLocation[]
  initialDestination: string
  onClose: () => void
  onStored: (message: string) => void
  onStoredIds: (ids: number[]) => void
}) {
  const [items, setItems] = useState<PrintedReceiptDetail[]>([])
  const [labelInput, setLabelInput] = useState('')
  const [address, setAddress] = useState('')
  const [complement, setComplement] = useState('')
  const [destination, setDestination] = useState(initialDestination)
  const [references, setReferences] = useState<ProductAddressReference[]>([])
  const [busy, setBusy] = useState(false)
  const [loadingId, setLoadingId] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cameraTarget, setCameraTarget] = useState<'label' | 'address' | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number | null>(null)

  const stopCamera = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraTarget(null)
  }, [])

  const addReceipt = useCallback(async (rawValue: string) => {
    const id = extractPrintedReceiptId(rawValue)
    if (!id) {
      setError('ETQ não reconhecida. Informe o número, o rótulo 1850.1 ou o conteúdo completo do QR Code.')
      return
    }
    setLoadingId(true)
    setError(null)
    setFeedback(`Consultando ETQ ${id}…`)
    try {
      const response = await loadPrintedReceipt(id)
      const receipt = response.etiqueta
      if ((Number(receipt.qtd) || 0) <= 0) throw new Error(`A ETQ ${receipt.id_rotulo || receipt.id} não possui quantidade disponível.`)
      if (String(receipt.endereco || '').trim()) throw new Error(`A ETQ ${receipt.id_rotulo || receipt.id} já está guardada em ${receipt.endereco}.`)
      setItems((current) => (current.some((item) => item.id === receipt.id) ? current : [...current, receipt]))
      setLabelInput('')
      setFeedback(`ETQ ${receipt.id_rotulo || receipt.id} adicionada. Inclua outras ETQs ou informe o endereço.`)
    } catch (loadError) {
      setFeedback(null)
      setError(errorMessage(loadError, `Não foi possível consultar a ETQ ${id}.`))
    } finally {
      setLoadingId(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setItems([])
    setLabelInput('')
    setAddress('')
    setComplement('')
    setDestination(initialDestination)
    setReferences([])
    setFeedback(null)
    setError(null)
    if (initialId) void addReceipt(String(initialId))
  }, [addReceipt, initialDestination, initialId, open])

  useEffect(() => {
    const code = String(items[0]?.codigo || items[0]?.codigo_omie || '').trim()
    if (!code) {
      setReferences([])
      return
    }
    let cancelled = false
    loadProductAddressReferences(code)
      .then((data) => {
        if (!cancelled) setReferences(data)
      })
      .catch(() => {
        if (!cancelled) setReferences([])
      })
    return () => {
      cancelled = true
    }
  }, [items])

  useEffect(() => () => stopCamera(), [stopCamera])

  const startCamera = async (target: 'label' | 'address') => {
    stopCamera()
    setError(null)
    const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setError('A leitura automática não está disponível neste navegador. Use o bipador ou digite o código.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      setCameraTarget(target)
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (!videoRef.current) return
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      const detector = new Detector({ formats: target === 'label' ? ['qr_code', 'data_matrix'] : ['code_128', 'code_39', 'data_matrix'] })
      const scan = async () => {
        if (!videoRef.current || !streamRef.current) return
        try {
          const hits = await detector.detect(videoRef.current as unknown as ImageBitmapSource)
          const value = hits[0]?.rawValue?.trim()
          if (value) {
            stopCamera()
            if (target === 'label') void addReceipt(value)
            else setAddress(value)
            return
          }
        } catch {
          // Frames sem leitura são esperados durante a captura.
        }
        frameRef.current = requestAnimationFrame(scan)
      }
      frameRef.current = requestAnimationFrame(scan)
    } catch (cameraError) {
      stopCamera()
      setError(errorMessage(cameraError, 'Não foi possível acessar a câmera. Use o campo manual.'))
    }
  }

  const submit = async () => {
    if (!items.length) {
      setError('Adicione ao menos uma ETQ antes de guardar.')
      return
    }
    let normalizedAddress: string
    try {
      normalizedAddress = validateWarehouseAddress(address)
    } catch (validationError) {
      setError(errorMessage(validationError, warehouseAddressHint))
      return
    }
    if (!destination) {
      setError('Selecione o armazém de destino.')
      return
    }

    setBusy(true)
    setError(null)
    const failures: Array<{ item: PrintedReceiptDetail; message: string }> = []
    const completedIds: number[] = []
    let completed = 0
    for (const item of items) {
      setFeedback(`Guardando ${completed + 1} de ${items.length} no endereço ${normalizedAddress}…`)
      try {
        await storePrintedReceipt({
          id: item.id,
          address: normalizedAddress,
          complement,
          destinationCode: destination,
        })
        completed += 1
        completedIds.push(item.id)
      } catch (storeError) {
        failures.push({ item, message: errorMessage(storeError, 'Falha ao guardar.') })
      }
    }
    setBusy(false)
    if (completedIds.length) onStoredIds(completedIds)

    if (failures.length) {
      setItems(failures.map((failure) => failure.item))
      setFeedback(`${completed} ETQ(s) concluída(s). ${failures.length} permanece(m) no lote para nova tentativa.`)
      setError(failures.map((failure) => `ETQ ${failure.item.id_rotulo || failure.item.id}: ${failure.message}`).join(' '))
      return
    }

    const destinationLabel = warehouseLocationLabel(locations.find((location) => location.codigo_local_estoque === destination) || fallbackWarehouse)
    onStored(`${completed} ETQ(s) enviada(s) para ${destinationLabel} · Endereço ${normalizedAddress}.`)
    onClose()
  }

  return (
    <ModalShell
      open={open}
      title={initialId ? 'Guardar material' : 'Ler etiquetas para guardar'}
      description="Bipe uma ou mais ETQs, escolha o armazém e informe um único endereço para o lote."
      onClose={() => {
        stopCamera()
        onClose()
      }}
      panelStyle={{ width: 'min(100vw, 48rem)', maxWidth: '48rem', flexShrink: 0 }}
    >
      <div className="space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Armazém de destino</span>
          <select
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-thermo-border bg-white px-3 py-2 text-sm text-thermo-ink outline-none focus:border-thermo-navy focus:ring-2 focus:ring-thermo-navy/10"
          >
            {locations.map((location) => (
              <option key={location.codigo_local_estoque} value={location.codigo_local_estoque}>{warehouseLocationLabel(location)}</option>
            ))}
          </select>
        </label>

        <section className="rounded-xl border border-thermo-border bg-thermo-bg p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-thermo-navy">ETQs do lote</h3>
              <p className="text-xs text-slate-500">Aceita ID simples, volume como 1850.1 ou o conteúdo completo do QR.</p>
            </div>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-thermo-navy">{items.length} ID(s)</span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={labelInput}
              onChange={(event) => setLabelInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void addReceipt(labelInput)
                }
              }}
              placeholder="Bipe, leia ou digite o ID da ETQ"
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-thermo-border bg-white px-3 py-2 text-base outline-none focus:border-thermo-navy focus:ring-2 focus:ring-thermo-navy/10"
              autoFocus={!initialId}
            />
            <button className="thermo-button thermo-button-secondary" type="button" onClick={() => void addReceipt(labelInput)} disabled={loadingId || !labelInput.trim()}>
              {loadingId ? <LoaderCircle className="size-4 animate-spin" /> : <QrCode className="size-4" />} Adicionar
            </button>
            <button className="thermo-icon-button" type="button" onClick={() => void startCamera('label')} aria-label="Ler ETQ pela câmera" title="Ler ETQ pela câmera">
              <Camera className="size-4" />
            </button>
          </div>
          {items.length ? (
            <div className="mt-3 space-y-2">
              {items.map((item) => (
                <div key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-xl border border-thermo-border bg-white px-3 py-2.5">
                  <span className="font-mono text-xs font-bold text-thermo-navy">ETQ {item.id_rotulo || item.id}</span>
                  <span className="min-w-0"><strong className="block truncate text-sm text-thermo-ink">{item.codigo || item.codigo_omie || 'Produto'}</strong><small className="block truncate text-slate-500">{item.descricao || 'Sem descrição'}</small></span>
                  <span className="text-xs font-semibold text-slate-600">{quantity(item.qtd, item.unidade)}</span>
                  <button className="thermo-icon-button size-10" type="button" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))} aria-label={`Remover ETQ ${item.id_rotulo || item.id}`}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-center text-sm text-slate-500">Nenhuma ETQ adicionada.</div>}
        </section>

        {cameraTarget ? (
          <section className="overflow-hidden rounded-xl border border-thermo-border bg-slate-950">
            <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
            <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-white"><span>Alinhe {cameraTarget === 'label' ? 'o QR da ETQ' : 'o código do endereço'} na câmera.</span><button type="button" className="font-semibold underline" onClick={stopCamera}>Cancelar câmera</button></div>
          </section>
        ) : null}

        <section className="grid gap-4 rounded-xl border border-thermo-border bg-white p-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Endereço do lote</span>
            <div className="flex gap-2">
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="01-03-21-002"
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-thermo-border bg-white px-3 py-2 font-mono text-base uppercase outline-none focus:border-thermo-navy focus:ring-2 focus:ring-thermo-navy/10"
              />
              <button className="thermo-icon-button" type="button" onClick={() => void startCamera('address')} aria-label="Ler endereço pela câmera" title="Ler endereço pela câmera"><Camera className="size-4" /></button>
            </div>
            <span className="mt-1 block text-xs text-slate-500">{warehouseAddressHint}</span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Complemento (opcional)</span>
            <input value={complement} onChange={(event) => setComplement(event.target.value)} className="min-h-11 w-full rounded-xl border border-thermo-border bg-white px-3 py-2 text-base outline-none focus:border-thermo-navy focus:ring-2 focus:ring-thermo-navy/10" />
          </label>
        </section>

        {references.length ? (
          <section className="rounded-xl border border-sky-200 bg-sky-50 p-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-thermo-navy"><MapPin className="size-4" />Onde este produto já está guardado</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {references.map((reference) => (
                <button key={`${reference.endereco}-${reference.complemento || ''}`} type="button" onClick={() => { setAddress(reference.endereco); setComplement(reference.complemento || '') }} className="min-h-11 rounded-xl border border-sky-200 bg-white px-3 py-2 text-left text-sm transition hover:border-thermo-navy">
                  <strong className="font-mono text-thermo-navy">{reference.endereco}</strong>
                  <span className="ml-2 text-slate-500">{quantity(reference.qtd, reference.unidade)}</span>
                  {reference.complemento ? <small className="block text-slate-500">{reference.complemento}</small> : null}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {feedback ? <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800" role="status">{feedback}</div> : null}
        {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div> : null}

        <div className="flex flex-col-reverse gap-2 border-t border-thermo-border pt-4 sm:flex-row sm:justify-end">
          <button className="thermo-button thermo-button-secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="thermo-button thermo-button-primary" type="button" onClick={() => void submit()} disabled={busy || !items.length}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <PackageCheck className="size-4" />} Guardar {items.length || ''} {items.length === 1 ? 'material' : 'materiais'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

function ReprintDialog({
  receipt,
  username,
  onClose,
  onSuccess,
}: {
  receipt: PrintedReceipt | null
  username: string
  onClose: () => void
  onSuccess: (message: string) => void
}) {
  const [format, setFormat] = useState<'pequena' | 'grande'>('pequena')
  const [printers, setPrinters] = useState<PrinterOption[]>([])
  const [printer, setPrinter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!receipt) return
    setFormat('pequena')
    setPrinters([])
    setPrinter('')
    setError(null)
    loadPrinterSetup(username)
      .then((setup) => {
        const physical = setup.options.filter((option) => option.kind !== 'pdf')
        setPrinters(physical)
        setPrinter(physical.some((option) => option.value === setup.defaultValue) ? String(setup.defaultValue) : physical[0]?.value || '')
      })
      .catch((loadError) => setError(errorMessage(loadError, 'Não foi possível carregar as impressoras.')))
  }, [receipt, username])

  const submit = async () => {
    if (!receipt || !printer) {
      setError('Escolha uma impressora física.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await reprintPrintedReceipt({ id: receipt.id, format, printer, username })
      onSuccess(`ETQ ${receiptLabel(receipt)} enviada para reimpressão no formato ${format === 'grande' ? '70 × 115 mm' : '50 × 30 mm'}. O ID foi preservado.`)
      onClose()
    } catch (printError) {
      setError(errorMessage(printError, 'Falha ao reimprimir a etiqueta.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell open={Boolean(receipt)} title={receipt ? `Reimprimir ETQ ${receiptLabel(receipt)}` : 'Reimprimir ETQ'} description="O backend regenera o ZPL atual e preserva o mesmo ID." onClose={onClose}>
      <div className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Formato</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {([['pequena', 'Pequena', '50 × 30 mm · Zebra P'], ['grande', 'Grande', '70 × 115 mm · Zebra G']] as const).map(([value, label, hint]) => (
              <label key={value} className={clsx('cursor-pointer rounded-xl border p-3', format === value ? 'border-thermo-navy bg-slate-50' : 'border-thermo-border')}>
                <input type="radio" name="reprint-format" value={value} checked={format === value} onChange={() => setFormat(value)} className="mr-2" />
                <strong className="text-sm text-thermo-navy">{label}</strong><small className="mt-1 block pl-5 text-slate-500">{hint}</small>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Impressora</span>
          <select value={printer} onChange={(event) => setPrinter(event.target.value)} className="min-h-11 w-full rounded-xl border border-thermo-border bg-white px-3 py-2 text-sm outline-none focus:border-thermo-navy">
            <option value="">— escolha uma impressora física —</option>
            {printers.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div> : null}
        <div className="flex justify-end gap-2 border-t border-thermo-border pt-4"><button className="thermo-button thermo-button-secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="thermo-button thermo-button-primary" type="button" onClick={() => void submit()} disabled={busy || !printer}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Printer className="size-4" />}Reimprimir</button></div>
      </div>
    </ModalShell>
  )
}

export function StoreMaterialsScreen({
  flow = 'recebimento',
  allowed = true,
  username,
}: {
  flow?: LogisticsFlow
  allowed?: boolean
  username: string
}) {
  const [receipts, setReceipts] = useState<PrintedReceipt[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [locations, setLocations] = useState<WarehouseLocation[]>([fallbackWarehouse])
  const [locationWarning, setLocationWarning] = useState<string | null>(null)
  const [destination, setDestination] = useState(fallbackWarehouse.codigo_local_estoque)
  const [storeOpen, setStoreOpen] = useState(false)
  const [storeInitialId, setStoreInitialId] = useState<number | null>(null)
  const [reprintReceipt, setReprintReceipt] = useState<PrintedReceipt | null>(null)
  const [returnReceipt, setReturnReceipt] = useState<PrintedReceipt | null>(null)
  const [returnBusy, setReturnBusy] = useState(false)
  const [returnError, setReturnError] = useState<string | null>(null)

  const load = useCallback(async (search = query) => {
    if (!allowed) return
    setLoading(true)
    setError(null)
    setPermissionDenied(false)
    try {
      const response = await loadPrintedReceipts({ query: search, flow })
      setReceipts((response.etiquetas || []).filter((receipt) => (Number(receipt.qtd) || 0) > 0))
    } catch (loadError) {
      if (isPermissionFailure(loadError)) setPermissionDenied(true)
      setError(errorMessage(loadError, 'Falha ao carregar materiais aguardando armazenamento.'))
    } finally {
      setLoading(false)
    }
  }, [allowed, flow, query])

  useEffect(() => {
    if (!allowed) return
    const timer = setTimeout(() => void load(query), 350)
    return () => clearTimeout(timer)
  }, [allowed, load, query])

  useEffect(() => {
    if (!allowed) return
    loadWarehouseLocations()
      .then((data) => {
        setLocations(data)
        setLocationWarning(null)
        setDestination((current) => data.some((location) => location.codigo_local_estoque === current) ? current : data[0]?.codigo_local_estoque || fallbackWarehouse.codigo_local_estoque)
      })
      .catch((loadError) => {
        setLocations([fallbackWarehouse])
        setDestination(fallbackWarehouse.codigo_local_estoque)
        setLocationWarning(`${errorMessage(loadError, 'Falha ao consultar armazéns.')} O destino permanece no Almoxarifado.`)
      })
  }, [allowed])

  const destinationLabel = useMemo(
    () => warehouseLocationLabel(locations.find((location) => location.codigo_local_estoque === destination) || fallbackWarehouse),
    [destination, locations],
  )

  if (!allowed) {
    return <section className="rounded-xl border border-amber-200 bg-amber-50 p-6" aria-label="Sem permissão para Guardar materiais"><LockKeyhole className="size-6 text-amber-700" /><h1 className="mt-3 text-xl font-bold text-thermo-navy">Guardar materiais</h1><p className="mt-2 max-w-2xl text-sm text-amber-900">Sua conta não possui a permissão deste item de navegação. Solicite acesso ao responsável pelo sistema.</p></section>
  }

  return (
    <section className="min-w-0 space-y-4" aria-labelledby="store-materials-title">
      <header className="rounded-xl border border-thermo-border bg-white px-4 py-4 shadow-sm sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700"><Warehouse className="size-4" />Etapa 2 · Armazenar{flow === 'expedicao' ? ' · Tipo 00' : ''}</div>
            <h1 id="store-materials-title" className="mt-1 text-xl font-bold text-thermo-navy">Guardar materiais</h1>
            <p className="mt-1 text-sm text-slate-500">Materiais identificados e impressos aguardando endereço físico.</p>
          </div>
          <button className="thermo-button thermo-button-primary min-h-11" type="button" onClick={() => { setStoreInitialId(null); setStoreOpen(true) }}><QrCode className="size-4" />Ler etiquetas em lote</button>
        </div>
      </header>

      <div className="rounded-xl border border-thermo-border bg-white p-3 shadow-sm sm:p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_minmax(18rem,0.8fr)_auto]">
          <label className="relative block">
            <span className="sr-only">Pesquisar materiais</span><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar por lote, código, descrição ou ETQ" className="min-h-11 w-full rounded-xl border border-thermo-border bg-white py-2 pl-10 pr-3 text-base outline-none focus:border-thermo-navy focus:ring-2 focus:ring-thermo-navy/10" />
          </label>
          <label className="block">
            <span className="sr-only">Armazém de destino</span>
            <select value={destination} onChange={(event) => setDestination(event.target.value)} className="min-h-11 w-full rounded-xl border border-thermo-border bg-white px-3 py-2 text-sm text-thermo-ink outline-none focus:border-thermo-navy">
              {locations.map((location) => <option key={location.codigo_local_estoque} value={location.codigo_local_estoque}>{warehouseLocationLabel(location)}</option>)}
            </select>
          </label>
          <button className="thermo-toolbar-button" type="button" onClick={() => void load(query)} disabled={loading}><RefreshCw className={clsx('size-4', loading && 'animate-spin')} />Atualizar lista</button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>Destino: <strong className="text-thermo-navy">{destinationLabel}</strong></span><span>{receipts.length} material(is) aguardando armazenamento</span></div>
      </div>

      {locationWarning ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">{locationWarning}</div> : null}
      {notice ? <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{notice}</div> : null}
      {permissionDenied ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-900" role="alert"><strong className="block text-thermo-navy">Sem permissão ou sessão expirada</strong>{error}</div> : null}
      {!permissionDenied && error ? <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{error}</span><button className="ml-auto font-semibold underline" type="button" onClick={() => void load(query)}>Tentar novamente</button></div> : null}

      <div className="overflow-hidden rounded-xl border border-thermo-border bg-white shadow-sm">
        <div className="hidden grid-cols-[3.5rem_minmax(12rem,1.2fr)_minmax(8rem,.7fr)_minmax(10rem,.8fr)_minmax(7rem,.5fr)_minmax(12rem,.9fr)_minmax(18rem,1.2fr)] gap-3 border-b border-thermo-border bg-thermo-bg px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 2xl:grid"><span>Foto</span><span>Produto</span><span>Lote</span><span>Origem</span><span>Quantidade</span><span>Situação</span><span>Ações</span></div>
        {loading && receipts.length === 0 ? (
          <div className="space-y-3 p-4" aria-label="Carregando materiais"><div className="h-20 animate-pulse rounded-xl bg-slate-100" /><div className="h-20 animate-pulse rounded-xl bg-slate-100" /><div className="h-20 animate-pulse rounded-xl bg-slate-100" /></div>
        ) : null}
        {!loading && !error && receipts.length === 0 ? <div className="px-6 py-14 text-center"><PackageCheck className="mx-auto size-8 text-slate-300" /><h2 className="mt-3 font-bold text-thermo-navy">Nenhum material aguardando armazenamento</h2><p className="mt-1 text-sm text-slate-500">Ajuste a busca ou atualize a lista.</p></div> : null}
        {receipts.map((receipt) => (
          <article key={receipt.id} className="grid gap-3 border-b border-thermo-border px-4 py-4 last:border-b-0 2xl:grid-cols-[3.5rem_minmax(12rem,1.2fr)_minmax(8rem,.7fr)_minmax(10rem,.8fr)_minmax(7rem,.5fr)_minmax(12rem,.9fr)_minmax(18rem,1.2fr)] 2xl:items-center" data-testid="store-material-row">
            <MaterialPhoto code={receipt.codigo_produto} description={receipt.descricao_produto} />
            <div><div className="font-mono text-xs font-semibold text-slate-500">{receipt.codigo_produto || '—'}</div><div className="mt-1 text-sm font-bold text-thermo-navy">{receipt.descricao_produto || 'Produto sem descrição'}</div></div>
            <div><span className="2xl:hidden text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Lote · </span><strong className="font-mono text-sm text-thermo-ink">{receipt.lote || '—'}</strong></div>
            <div className="text-sm"><strong className="block text-thermo-ink">{receipt.numero_nfe ? `NF-e Nº ${receipt.numero_nfe}` : receipt.numero_pedido ? `Pedido Nº ${receipt.numero_pedido}` : 'Sem documento'}</strong>{receipt.fornecedor ? <span className="block text-xs text-slate-500">{receipt.fornecedor}</span> : null}{receipt.data_emissao ? <span className="block text-xs text-slate-500">Emissão: {receipt.data_emissao}</span> : null}</div>
            <div className="text-sm font-semibold text-thermo-ink">{quantity(receipt.qtd, receipt.unidade)}</div>
            <div><strong className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-mono text-xs text-sky-800">ETQ {receiptLabel(receipt)}</strong><span className="mt-1 block text-xs text-slate-500"><Printer className="mr-1 inline size-3" />{dateTime(receipt.impresso_em)}{receipt.usuario_criacao ? ` · ${receipt.usuario_criacao}` : ''}</span></div>
            <div className="grid gap-2 sm:grid-cols-3 2xl:grid-cols-1">
              <button className="thermo-button thermo-button-secondary min-h-11" type="button" onClick={() => setReprintReceipt(receipt)}><Printer className="size-4" />Reimprimir</button>
              <button className="thermo-button thermo-button-secondary min-h-11" type="button" onClick={() => { setReturnError(null); setReturnReceipt(receipt) }}><RotateCcw className="size-4" />Retornar</button>
              <button className="thermo-button thermo-button-primary min-h-11" type="button" onClick={() => { setStoreInitialId(receipt.id); setStoreOpen(true) }}><PackageCheck className="size-4" />Guardar material</button>
            </div>
          </article>
        ))}
      </div>

      <StoreReceiptDialog open={storeOpen} initialId={storeInitialId} locations={locations} initialDestination={destination} onClose={() => setStoreOpen(false)} onStored={setNotice} onStoredIds={(ids) => setReceipts((current) => current.filter((receipt) => !ids.includes(receipt.id)))} />
      <ReprintDialog receipt={reprintReceipt} username={username} onClose={() => setReprintReceipt(null)} onSuccess={setNotice} />

      <ModalShell open={Boolean(returnReceipt)} title={returnReceipt ? `Retornar ETQ ${receiptLabel(returnReceipt)}` : 'Retornar etiqueta'} description="O saldo volta para Identificação do produto e poderá ser reimpresso com múltiplo." onClose={() => { if (!returnBusy) setReturnReceipt(null) }}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Escolha se deseja devolver apenas esta etiqueta ou consolidar todas as etiquetas do mesmo produto e lote.</p>
          {returnError ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{returnError}</div> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {([['uma', 'Só esta etiqueta', 'Devolve apenas o ID selecionado.'], ['todas', 'Todas deste produto', 'Junta o saldo do mesmo produto e lote.']] as const).map(([mode, label, hint]) => (
              <button key={mode} type="button" disabled={returnBusy} onClick={async () => {
                if (!returnReceipt) return
                setReturnBusy(true); setReturnError(null)
                try {
                  const response = await returnPrintedReceipt(returnReceipt.id, mode)
                  setNotice(`Saldo ${quantity(response.saldo_retornado, returnReceipt.unidade)} devolvido para Identificação do produto.`)
                  setReturnReceipt(null)
                  void load(query)
                } catch (returnFailure) {
                  setReturnError(errorMessage(returnFailure, 'Falha ao retornar a etiqueta.'))
                } finally { setReturnBusy(false) }
              }} className="min-h-24 rounded-xl border border-thermo-border bg-white p-4 text-left transition hover:border-thermo-navy hover:bg-thermo-bg disabled:opacity-45"><strong className="block text-sm text-thermo-navy">{label}</strong><span className="mt-1 block text-xs text-slate-500">{hint}</span></button>
            ))}
          </div>
        </div>
      </ModalShell>
    </section>
  )
}

function MaterialPhoto({ code, description }: { code: string | null; description: string | null }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { if (code) void loadIdentificationPhoto(code).then(setUrl).catch(() => setUrl(null)) }, [code])
  return url ? <img className="size-11 rounded-lg border border-thermo-border object-cover" src={url} alt={`Foto de ${description || code || 'produto'}`} /> : <div className="flex size-11 items-center justify-center rounded-lg border border-dashed border-thermo-border bg-thermo-bg text-slate-400" aria-label={`Foto de ${code || 'produto'} indisponível`}><PackageCheck className="size-4" /></div>
}
