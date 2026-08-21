/* oxlint-disable react/set-state-in-effect -- Os efeitos sincronizam cada subfluxo com o estado assíncrono das APIs legadas. */
import { clsx } from 'clsx'
import {
  ArrowLeft,
  ArrowLeftRight,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  ExternalLink,
  FileClock,
  History,
  Info,
  LoaderCircle,
  MapPin,
  PackagePlus,
  Pencil,
  Printer,
  ReceiptText,
  RefreshCw,
  Scale,
  Trash2,
  Truck,
  Upload,
} from 'lucide-react'
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ModalShell } from '../../components/ModalShell'
import type { AuthUser, ProductRecord } from '../../types'
import {
  addProductToCart,
  applyStockAudit,
  createManualReceipt,
  deleteProductAddress,
  executeDispatch,
  executeMovement,
  loadIdentificationHistory,
  loadLatestManualReceiptReason,
  loadLatestPurchases,
  loadMovementHistory,
  loadMovementSetup,
  loadPrinterOptions,
  loadProductActionContext,
  loadProductAddresses,
  loadProductDetail,
  loadProductManuals,
  loadProductMultiple,
  loadStockAudit,
  moveProductAddress,
  removeProductManual,
  reprintIdentification,
  requestSeparation,
  saveProductMultiple,
  saveQuickEdit,
  uploadProductManual,
  uploadProductPhoto,
} from '../../services/productActionsGateway'
import type {
  IdentificationHistoryItem,
  PrinterOption,
  ProductActionAccess,
  ProductActionKey,
  ProductActionPermissionFallback,
  ProductAddressItem,
  ProductManualItem,
  ProductPurchaseHistoryItem,
  QuickEditPayload,
  StockAuditResponse,
  WarehouseLocation,
} from '../../services/productActionsGateway'

type ActionView = 'overview' | ProductActionKey

const emptyAccess: ProductActionAccess = {
  purchase: false,
  separation: false,
  movement: false,
  dispatch: false,
  information: false,
  quickEdit: false,
  latestPurchases: false,
  addresses: false,
  movementHistory: false,
  stockAudit: false,
  manualReceipt: false,
  identificationHistory: false,
  manuals: false,
  reasons: {},
}

const actionDefinitions: Array<{
  key: ProductActionKey
  label: string
  hint: string
  icon: ReactNode
}> = [
  { key: 'purchase', label: 'Compra', hint: 'Informar quantidade para adicionar ao carrinho', icon: <PackagePlus className="size-5" /> },
  { key: 'separation', label: 'Separação', hint: 'Abrir quantidade para solicitar separação', icon: <ClipboardList className="size-5" /> },
  { key: 'movement', label: 'Movimentação', hint: 'Entradas, saídas, transferências e ajustes', icon: <ArrowLeftRight className="size-5" /> },
  { key: 'dispatch', label: 'Expedição', hint: 'Transferir de Estoque Máquinas para Expedição', icon: <Truck className="size-5" /> },
  { key: 'information', label: 'Informações', hint: 'Abrir cadastro completo do produto', icon: <Info className="size-5" /> },
  { key: 'quickEdit', label: 'Editar produto', hint: 'Nome, estoque, medidas, peso e foto', icon: <Pencil className="size-5" /> },
  { key: 'latestPurchases', label: 'Últimas compras', hint: 'Consultar histórico recente de compra', icon: <ReceiptText className="size-5" /> },
  { key: 'addresses', label: 'Endereços', hint: 'Consultar, transferir ou remover locais sem saldo', icon: <MapPin className="size-5" /> },
  { key: 'movementHistory', label: 'Histórico de movimentação', hint: 'Auditar entradas, saídas, ajustes e separações', icon: <History className="size-5" /> },
  { key: 'stockAudit', label: 'Auditar saldo no endereço', hint: 'Conferir e reconciliar endereços com a Omie', icon: <Scale className="size-5" /> },
  { key: 'manualReceipt', label: 'Recebimento sem NF-e', hint: 'Gerar entrada para PIR ou Identificação do produto', icon: <ClipboardCheck className="size-5" /> },
  { key: 'identificationHistory', label: 'Histórico de identificações', hint: 'Listar etiquetas já impressas e reimprimir', icon: <FileClock className="size-5" /> },
  { key: 'manuals', label: 'Manual de instrução', hint: 'Abrir, consultar ou anexar manuais do produto', icon: <BookOpen className="size-5" /> },
]

export function ProductActionsPanel({
  open,
  product,
  permissions,
  onClose,
  onChanged,
}: {
  open: boolean
  product: ProductRecord | null
  permissions: ProductActionPermissionFallback
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const [view, setView] = useState<ActionView>('overview')
  const [access, setAccess] = useState<ProductActionAccess>(emptyAccess)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState<string | null>(null)
  const [contextAttempt, setContextAttempt] = useState(0)

  useEffect(() => {
    if (!open || !product) return
    let active = true
    setView('overview')
    setContextLoading(true)
    setContextError(null)
    setAccess(emptyAccess)
    setUser(null)
    loadProductActionContext(permissions)
      .then((context) => {
        if (!active) return
        setAccess(context.access)
        setUser(context.user)
      })
      .catch((error) => {
        if (!active) return
        setContextError(error instanceof Error ? error.message : 'Falha ao confirmar permissões da sessão.')
      })
      .finally(() => {
        if (active) setContextLoading(false)
      })
    return () => {
      active = false
    }
  }, [contextAttempt, open, permissions, product])

  if (!product) return null

  return (
    <ModalShell
      open={open}
      title={`Ações · ${product.codigo}`}
      description="Fluxos reais equivalentes às Ações da Lista de Produtos atual."
      onClose={onClose}
      panelStyle={{ width: 'min(96vw, 58rem)', maxWidth: '58rem', flexShrink: 0 }}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-thermo-border bg-thermo-bg px-4 py-3">
          <div className="font-mono text-xs font-semibold text-slate-500">{product.codigo}</div>
          <div className="mt-1 text-base font-bold text-thermo-navy">{product.descricao}</div>
          <div className="mt-1 text-xs text-slate-500">{product.unidade || 'UN'} · Omie {product.codigo_produto || 'não vinculado'}</div>
        </div>

        {view !== 'overview' ? (
          <button type="button" className="thermo-button thermo-button-secondary" onClick={() => setView('overview')}>
            <ArrowLeft className="size-4" />
            Voltar às ações
          </button>
        ) : null}

        {contextLoading ? <LoadingState label="Confirmando sessão e permissões reais…" /> : null}
        {!contextLoading && contextError ? (
          <ErrorState
            message={contextError}
            actionLabel="Tentar novamente"
            onAction={() => setContextAttempt((current) => current + 1)}
          />
        ) : null}

        {!contextLoading && !contextError && view === 'overview' ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {actionDefinitions.map((action) => (
              <ActionTile
                key={action.key}
                icon={action.icon}
                label={action.label}
                hint={access[action.key] ? action.hint : access.reasons[action.key] || 'Ação indisponível para esta sessão.'}
                disabled={!access[action.key]}
                onClick={() => setView(action.key)}
              />
            ))}
          </div>
        ) : null}

        {!contextLoading && !contextError && view === 'purchase' ? <QuantityAction product={product} kind="purchase" onChanged={onChanged} /> : null}
        {!contextLoading && !contextError && view === 'separation' ? <QuantityAction product={product} kind="separation" canEditMultiple={access.quickEdit} onChanged={onChanged} /> : null}
        {!contextLoading && !contextError && view === 'movement' && user ? <MovementAction product={product} user={user} onChanged={onChanged} /> : null}
        {!contextLoading && !contextError && view === 'dispatch' && user ? <DispatchAction product={product} user={user} onChanged={onChanged} /> : null}
        {!contextLoading && !contextError && view === 'information' ? <InformationAction product={product} /> : null}
        {!contextLoading && !contextError && view === 'quickEdit' ? <QuickEditAction product={product} onChanged={onChanged} /> : null}
        {!contextLoading && !contextError && view === 'latestPurchases' ? <LatestPurchasesAction product={product} /> : null}
        {!contextLoading && !contextError && view === 'addresses' ? <AddressesAction product={product} onChanged={onChanged} /> : null}
        {!contextLoading && !contextError && view === 'movementHistory' ? <MovementHistoryAction product={product} /> : null}
        {!contextLoading && !contextError && view === 'stockAudit' ? <StockAuditAction product={product} onChanged={onChanged} /> : null}
        {!contextLoading && !contextError && view === 'manualReceipt' && user ? <ManualReceiptAction product={product} user={user} onChanged={onChanged} /> : null}
        {!contextLoading && !contextError && view === 'identificationHistory' && user ? <IdentificationHistoryAction product={product} user={user} /> : null}
        {!contextLoading && !contextError && view === 'manuals' ? <ManualsAction product={product} /> : null}
      </div>
    </ModalShell>
  )
}

function ActionTile({
  icon,
  label,
  hint,
  disabled,
  onClick,
}: {
  icon: ReactNode
  label: string
  hint: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={hint}
      onClick={onClick}
      className={clsx(
        'min-h-28 rounded-xl border px-4 py-3 text-left transition focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-thermo-navy',
        disabled
          ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
          : 'border-thermo-border bg-white text-thermo-navy hover:border-thermo-navy/40 hover:bg-thermo-bg',
      )}
    >
      <span className="flex items-center gap-2 text-sm font-bold">{icon}{label}</span>
      <span className="mt-2 block text-xs leading-5 text-slate-500">{hint}</span>
    </button>
  )
}

function QuantityAction({
  product,
  kind,
  canEditMultiple = false,
  onChanged,
}: {
  product: ProductRecord
  kind: 'purchase' | 'separation'
  canEditMultiple?: boolean
  onChanged: () => void | Promise<void>
}) {
  const [quantity, setQuantity] = useState('')
  const [multiple, setMultiple] = useState('')
  const [multipleLoading, setMultipleLoading] = useState(kind === 'separation')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const unit = String(product.unidade || 'UN').toUpperCase()

  useEffect(() => {
    if (kind !== 'separation') return
    let active = true
    setMultipleLoading(true)
    loadProductMultiple(product.codigo)
      .then((response) => {
        if (active) setMultiple(response.multiplo ? String(response.multiplo) : '')
      })
      .catch(() => {
        if (active) setMultiple('')
      })
      .finally(() => {
        if (active) setMultipleLoading(false)
      })
    return () => {
      active = false
    }
  }, [kind, product.codigo])

  const parsedQuantity = Number(quantity.replace(',', '.'))
  const parsedMultiple = Number(multiple.replace(',', '.'))
  const step = unit === 'UN' ? '1' : '0.001'

  const submit = async () => {
    setError(null)
    setMessage(null)
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError('Informe uma quantidade maior que zero.')
      return
    }
    const normalizedQuantity = unit === 'UN' ? Math.max(1, Math.round(parsedQuantity)) : parsedQuantity
    setSubmitting(true)
    try {
      if (kind === 'purchase') {
        await addProductToCart(product, normalizedQuantity)
        setMessage('Produto adicionado ao carrinho de compras.')
      } else {
        const result = await requestSeparation(product, normalizedQuantity)
        setMessage(result.merged ? 'Quantidade somada à separação existente.' : 'Separação registrada com sucesso.')
      }
      setQuantity('')
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao registrar a ação.')
    } finally {
      setSubmitting(false)
    }
  }

  const saveMultiple = async () => {
    setError(null)
    setMessage(null)
    if (!Number.isFinite(parsedMultiple) || parsedMultiple <= 0) {
      setError('Informe um múltiplo maior que zero.')
      return
    }
    setSubmitting(true)
    try {
      const result = await saveProductMultiple(product.codigo, parsedMultiple)
      setMultiple(result.multiplo ? String(result.multiplo) : '')
      setMessage('Múltiplo salvo com sucesso.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao salvar múltiplo.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ActionSection title={kind === 'purchase' ? 'Quantidade para compra' : 'Quantidade para separação'}>
      <Field label="Quantidade">
        <input
          aria-label="Quantidade"
          type="number"
          min={step}
          step={step}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          className="thermo-input"
          placeholder="Digite a quantidade"
        />
      </Field>

      {kind === 'separation' ? (
        <div className="rounded-xl border border-thermo-border bg-thermo-bg px-4 py-3">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Múltiplo do produto</div>
          {multipleLoading ? <div className="mt-2 text-sm text-slate-500">Carregando múltiplo…</div> : (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <input
                aria-label="Múltiplo do produto"
                type="number"
                min="0.001"
                step="0.001"
                value={multiple}
                disabled={!canEditMultiple}
                onChange={(event) => setMultiple(event.target.value)}
                className="thermo-input max-w-44 disabled:bg-slate-100"
                placeholder="Ex.: 50"
              />
              {Number.isFinite(parsedMultiple) && parsedMultiple > 0 ? (
                <button type="button" className="thermo-button thermo-button-secondary" onClick={() => setQuantity(String((Number.isFinite(parsedQuantity) ? parsedQuantity : 0) + parsedMultiple))}>
                  + {parsedMultiple.toLocaleString('pt-BR')}
                </button>
              ) : null}
              {canEditMultiple ? <button type="button" className="thermo-button thermo-button-secondary" onClick={() => void saveMultiple()} disabled={submitting}>Salvar múltiplo</button> : null}
            </div>
          )}
          {!canEditMultiple ? <p className="mt-2 text-xs text-slate-500">A edição do múltiplo exige permissão de cadastro de produtos.</p> : null}
        </div>
      ) : null}

      <Feedback error={error} message={message} />
      <button type="button" className="thermo-button thermo-button-primary" onClick={() => void submit()} disabled={submitting}>
        {submitting ? <LoaderCircle className="size-4 animate-spin" /> : kind === 'purchase' ? <PackagePlus className="size-4" /> : <ClipboardList className="size-4" />}
        {submitting ? 'Registrando…' : kind === 'purchase' ? 'Adicionar ao carrinho' : 'Enviar separação'}
      </button>
    </ActionSection>
  )
}

function InformationAction({ product }: { product: ProductRecord }) {
  const state = useAsyncValue(() => loadProductDetail(product.codigo), product.codigo)
  const detail = state.value
  const rows = detail ? [
    ['Código', detail.codigo || product.codigo],
    ['ID Omie', detail.codigo_produto || product.codigo_produto],
    ['Descrição', detail.descricao || product.descricao],
    ['Família', detail.descricao_familia || product.descricao_familia],
    ['Unidade', detail.unidade || product.unidade],
    ['Marca', detail.marca || product.marca],
    ['Modelo', detail.modelo || product.modelo],
    ['NCM', detail.ncm || product.ncm],
    ['Estoque mínimo', detail.estoque_minimo ?? product.estoque_minimo],
    ['Lead time (dias)', detail.lead_time],
    ['Altura (cm)', detail.altura],
    ['Largura (cm)', detail.largura],
    ['Comprimento (cm)', detail.profundidade],
    ['Peso (kg)', detail.peso_bruto ?? detail.peso_liq],
  ] : []
  return (
    <ActionSection title="Informações do produto">
      <AsyncFeedback state={state} loadingLabel="Carregando cadastro real do produto…" />
      {detail ? <div className="grid gap-3 sm:grid-cols-2">{rows.map(([label, value]) => <InfoLine key={String(label)} label={String(label)} value={displayValue(value)} />)}</div> : null}
    </ActionSection>
  )
}

function QuickEditAction({ product, onChanged }: { product: ProductRecord; onChanged: () => void | Promise<void> }) {
  const detailState = useAsyncValue(() => loadProductDetail(product.codigo), product.codigo)
  const detail = detailState.value
  const [values, setValues] = useState<QuickEditPayload | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!detail) return
    setValues({
      descricao: String(detail.descricao || product.descricao).trim(),
      estoque_minimo: Number(detail.estoque_minimo || 0),
      lead_time: Number(detail.lead_time || 0),
      altura: Number(detail.altura || 0),
      largura: Number(detail.largura || 0),
      profundidade: Number(detail.profundidade || 0),
      peso_bruto: Number(detail.peso_bruto ?? detail.peso_liq ?? 0),
    })
  }, [detail, product.descricao])

  const setNumber = (key: keyof QuickEditPayload, raw: string) => setValues((current) => current ? { ...current, [key]: raw === '' ? 0 : Number(raw.replace(',', '.')) } : current)

  const save = async () => {
    if (!detail || !values) return
    setError(null)
    setMessage(null)
    if (!values.descricao.trim()) return setError('O nome do produto é obrigatório.')
    const numericEntries = Object.entries(values).filter(([key]) => key !== 'descricao') as Array<[keyof QuickEditPayload, number]>
    if (numericEntries.some(([, value]) => !Number.isFinite(value) || value < 0)) return setError('Preencha medidas, peso, mínimo e lead time com valores válidos.')
    if (values.altura > 500 || values.largura > 500 || values.profundidade > 500) return setError('Altura, largura e comprimento devem ficar entre 0 e 500 cm.')
    setSaving(true)
    try {
      await saveQuickEdit(product, detail, values)
      if (photo) await uploadProductPhoto(product, photo, values.descricao)
      setMessage(photo ? 'Alterações e foto salvas com sucesso.' : 'Alterações salvas com sucesso.')
      setPhoto(null)
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Erro ao salvar alterações.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ActionSection title="Editar produto">
      <AsyncFeedback state={detailState} loadingLabel="Carregando produto…" />
      {values ? (
        <div className="space-y-4">
          <Field label="Nome do produto"><input className="thermo-input" value={values.descricao} onChange={(event) => setValues({ ...values, descricao: event.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField label="Estoque mínimo" value={values.estoque_minimo} onChange={(value) => setNumber('estoque_minimo', value)} />
            <NumberField label="Lead time (dias)" value={values.lead_time} onChange={(value) => setNumber('lead_time', value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField label="Altura (cm)" value={values.altura} onChange={(value) => setNumber('altura', value)} />
            <NumberField label="Largura (cm)" value={values.largura} onChange={(value) => setNumber('largura', value)} />
            <NumberField label="Comprimento (cm)" value={values.profundidade} onChange={(value) => setNumber('profundidade', value)} />
            <NumberField label="Peso (kg)" value={values.peso_bruto} step="0.001" onChange={(value) => setNumber('peso_bruto', value)} />
          </div>
          <Field label="Foto do produto">
            <input aria-label="Foto do produto" type="file" accept="image/*" onChange={(event) => setPhoto(event.target.files?.[0] || null)} className="block w-full text-sm text-slate-600" />
            <p className="mt-1 text-xs text-slate-500">Opcional. O envio substitui a foto principal, como no legado.</p>
          </Field>
          <Feedback error={error} message={message} />
          <button type="button" className="thermo-button thermo-button-primary" onClick={() => void save()} disabled={saving}>
            {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Pencil className="size-4" />}
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </button>
        </div>
      ) : null}
    </ActionSection>
  )
}

function LatestPurchasesAction({ product }: { product: ProductRecord }) {
  const state = useAsyncValue(
    () => product.codigo_produto ? loadLatestPurchases(product.codigo_produto) : Promise.reject(new Error('Este produto não possui ID Omie para consultar últimas compras.')),
    String(product.codigo_produto || ''),
  )
  const purchases = state.value?.itens || []
  return (
    <ActionSection title="Últimas compras">
      <AsyncFeedback state={state} loadingLabel="Carregando últimas compras…" />
      {!state.loading && !state.error && purchases.length === 0 ? <EmptyState label="Nenhuma compra encontrada para este produto." /> : null}
      <div className="space-y-3">
        {purchases.map((item, index) => <PurchaseCard key={`${item.c_chave_nfe || item.c_numero_nfe || 'compra'}-${index}`} item={item} />)}
      </div>
    </ActionSection>
  )
}

function PurchaseCard({ item }: { item: ProductPurchaseHistoryItem }) {
  return (
    <article className="rounded-xl border border-thermo-border bg-thermo-bg px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <InfoLine label="Recebido em" value={item.d_rec ? new Date(item.d_rec).toLocaleDateString('pt-BR') : '—'} />
        <InfoLine label="Fornecedor" value={item.c_nome_fornecedor || '—'} />
        <InfoLine label="NF-e" value={item.c_numero_nfe || '—'} />
        <InfoLine label="Quantidade" value={formatNumber(item.n_qtde_nfe)} />
        <InfoLine label="Preço unitário" value={formatCurrency(item.n_preco_unit)} />
        <InfoLine label="Total do item" value={formatCurrency(item.v_total_item)} />
      </div>
    </article>
  )
}

function ManualsAction({ product }: { product: ProductRecord }) {
  const [manuals, setManuals] = useState<ProductManualItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await loadProductManuals(product.codigo)
      setManuals(data.manuais || [])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Erro ao carregar manuais.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [product.codigo]) // oxlint-disable-line react-hooks/exhaustive-deps

  const upload = async () => {
    setError(null)
    setMessage(null)
    if (!name.trim()) return setError('Informe o nome do manual.')
    if (!file) return setError('Selecione um arquivo.')
    setSubmitting(true)
    try {
      await uploadProductManual(product.codigo, name.trim(), file)
      setName('')
      setFile(null)
      setMessage('Manual anexado com sucesso.')
      await reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Erro ao enviar manual.')
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (index: number) => {
    if (!window.confirm('Remover este manual?')) return
    setSubmitting(true)
    setError(null)
    try {
      await removeProductManual(product.codigo, index)
      setMessage('Manual removido.')
      await reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Erro ao remover manual.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ActionSection title="Manuais de instrução">
      {loading ? <LoadingState label="Carregando manuais…" /> : null}
      {!loading && !error && manuals.length === 0 ? <EmptyState label="Nenhum manual anexado." /> : null}
      <div className="space-y-2">
        {manuals.map((manual, index) => (
          <article key={`${manual.url}-${index}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-thermo-border bg-thermo-bg px-4 py-3">
            <div><div className="text-sm font-semibold text-thermo-navy">{manual.nome || 'Manual'}</div><div className="mt-1 text-xs text-slate-500">{manual.anexado_em ? new Date(manual.anexado_em).toLocaleString('pt-BR') : 'Data não informada'}</div></div>
            <div className="flex gap-2">
              <a className="thermo-button thermo-button-secondary" href={manual.url} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />Abrir manual</a>
              <button type="button" className="thermo-button border border-red-200 bg-red-50 text-red-700" onClick={() => void remove(index)} disabled={submitting}><Trash2 className="size-4" />Remover</button>
            </div>
          </article>
        ))}
      </div>
      <div className="space-y-3 rounded-xl border border-dashed border-thermo-border bg-thermo-bg px-4 py-4">
        <div className="text-sm font-bold text-thermo-navy">Anexar novo manual</div>
        <Field label="Nome do manual"><input className="thermo-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Manual FTI-125" /></Field>
        <Field label="Arquivo"><input aria-label="Arquivo do manual" type="file" accept=".pdf,.doc,.docx" onChange={(event) => setFile(event.target.files?.[0] || null)} className="block w-full text-sm text-slate-600" /></Field>
        <button type="button" className="thermo-button thermo-button-primary" onClick={() => void upload()} disabled={submitting}><Upload className="size-4" />{submitting ? 'Enviando…' : 'Enviar manual'}</button>
      </div>
      <Feedback error={error} message={message} />
    </ActionSection>
  )
}

function AddressesAction({ product, onChanged }: { product: ProductRecord; onChanged: () => void | Promise<void> }) {
  const [addresses, setAddresses] = useState<ProductAddressItem[]>([])
  const [unit, setUnit] = useState(String(product.unidade || 'UN'))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [selected, setSelected] = useState<ProductAddressItem | null>(null)
  const [destination, setDestination] = useState('')
  const [quantity, setQuantity] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await loadProductAddresses(product.codigo)
      setAddresses(data.enderecos || [])
      setUnit(data.produto?.unidade || product.unidade || 'UN')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar os endereços.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void reload() }, [product.codigo]) // oxlint-disable-line react-hooks/exhaustive-deps

  const beginMove = (address: ProductAddressItem) => {
    setSelected(address)
    setDestination('')
    setQuantity(String(address.saldo).replace('.', ','))
    setMessage(null)
    setError(null)
  }

  const move = async () => {
    if (!selected) return
    const parsed = Number(quantity.replace(/\./g, '').replace(',', '.'))
    if (!destination.trim()) return setError('Informe o novo endereço de destino.')
    if (!Number.isFinite(parsed) || parsed <= 0) return setError('Informe uma quantidade maior que zero.')
    if (parsed > selected.saldo + 0.000001) return setError(`A quantidade não pode ultrapassar o saldo disponível de ${formatQuantity(selected.saldo, unit)}.`)
    if (!window.confirm(`Mover ${formatQuantity(parsed, unit)} de ${selected.endereco} para ${destination.trim()}?`)) return
    setSubmitting(true)
    setError(null)
    try {
      await moveProductAddress(product.codigo, selected.endereco, destination.trim(), parsed)
      setMessage(`${formatQuantity(parsed, unit)} movidos para ${destination.trim()}.`)
      setSelected(null)
      await reload()
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao trocar endereço.')
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (address: ProductAddressItem) => {
    if (!window.confirm(`Excluir o endereço ${address.endereco}? Somente os registros sem saldo serão removidos.`)) return
    setSubmitting(true)
    setError(null)
    try {
      await deleteProductAddress(product.codigo, address.endereco)
      setMessage(`Endereço ${address.endereco} excluído.`)
      await reload()
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao excluir endereço.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ActionSection title="Endereços do produto">
      {loading ? <LoadingState label="Carregando endereços…" /> : null}
      {!loading && !error && addresses.length === 0 ? <EmptyState label="Nenhum endereço interno encontrado." /> : null}
      <div className="space-y-3">
        {addresses.map((address) => (
          <article key={address.endereco} className="rounded-xl border border-thermo-border bg-thermo-bg px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="font-mono text-sm font-bold text-thermo-navy">{address.endereco}</div><div className="mt-1 text-xs text-slate-500">{address.registros || 0} registro(s)</div></div>
              <div className="font-mono text-sm font-bold text-thermo-navy">{formatQuantity(address.saldo, address.unidade || unit)}</div>
              <div className="flex gap-2">
                <button type="button" className="thermo-button thermo-button-secondary" disabled={address.saldo <= 0 || submitting} onClick={() => beginMove(address)}><ArrowLeftRight className="size-4" />Trocar endereço</button>
                <button type="button" className="thermo-button border border-red-200 bg-red-50 text-red-700" disabled={address.saldo > 0 || submitting} onClick={() => void remove(address)}><Trash2 className="size-4" />Excluir</button>
              </div>
            </div>
            {selected?.endereco === address.endereco ? (
              <div className="mt-4 grid gap-3 border-t border-thermo-border pt-4 sm:grid-cols-2">
                <Field label="Novo endereço de destino"><input className="thermo-input" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Bipe ou digite o destino" /></Field>
                <Field label="Quantidade a mover"><input className="thermo-input" value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" /></Field>
                <div className="flex gap-2 sm:col-span-2"><button type="button" className="thermo-button thermo-button-secondary" onClick={() => setSelected(null)}>Cancelar</button><button type="button" className="thermo-button thermo-button-primary" onClick={() => void move()} disabled={submitting}>Confirmar transferência</button></div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      <Feedback error={error} message={message} />
    </ActionSection>
  )
}

function StockAuditAction({ product, onChanged }: { product: ProductRecord; onChanged: () => void | Promise<void> }) {
  const [data, setData] = useState<StockAuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [address, setAddress] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const reload = async () => {
    setLoading(true)
    setError(null)
    try { setData(await loadStockAudit(product.codigo)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível conferir os saldos.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [product.codigo]) // oxlint-disable-line react-hooks/exhaustive-deps

  const apply = async () => {
    if (!data) return
    const destination = newAddress.trim() || address
    if (!destination) return setError('Escolha ou informe o endereço da correção.')
    if (!reason.trim()) return setError('Informe a justificativa da correção.')
    const action = data.ajuste_necessario > 0 ? 'adição' : 'retirada'
    if (!window.confirm(`Confirmar ${action} de ${formatQuantity(Math.abs(data.ajuste_necessario), data.produto?.unidade || product.unidade)} no endereço ${destination}?`)) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await applyStockAudit(product.codigo, destination, reason.trim())
      setData(response.depois)
      setMessage('Saldo endereçado reconciliado e registrado no histórico.')
      setAddress('')
      setNewAddress('')
      setReason('')
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível aplicar a correção.')
    } finally {
      setSubmitting(false)
    }
  }

  const available = data?.enderecos?.filter((item) => data.ajuste_necessario > 0 || Number(item.saldo || 0) + 0.0001 >= Math.abs(data.ajuste_necessario)) || []
  return (
    <ActionSection title="Auditar saldo no endereço">
      {loading ? <LoadingState label="Conferindo saldos atuais…" /> : null}
      {!loading && data && !data.divergente ? <SuccessState label="A soma dos endereços já corresponde ao saldo do #ALMOX na Omie." /> : null}
      {!loading && data?.divergente ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {data.ajuste_necessario > 0 ? 'Faltam' : 'Sobram'} <strong>{formatQuantity(Math.abs(data.ajuste_necessario), data.produto?.unidade || product.unidade)}</strong> nos endereços. A Omie não será alterada.
          </div>
          <Field label={data.ajuste_necessario > 0 ? 'Adicionar em um endereço existente' : 'Retirar de qual endereço?'}>
            <select className="thermo-input" value={address} onChange={(event) => { setAddress(event.target.value); setNewAddress('') }}><option value="">Selecione</option>{available.map((item) => <option key={item.endereco} value={item.endereco}>{item.endereco} · saldo {formatQuantity(item.saldo, item.unidade || product.unidade)}</option>)}</select>
          </Field>
          {data.ajuste_necessario > 0 ? <Field label="Ou informe um novo endereço"><input className="thermo-input" value={newAddress} onChange={(event) => { setNewAddress(event.target.value); setAddress('') }} /></Field> : null}
          <Field label="Justificativa"><textarea className="thermo-input min-h-24" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          <button type="button" className="thermo-button thermo-button-primary" disabled={submitting} onClick={() => void apply()}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Scale className="size-4" />}Aplicar correção</button>
        </div>
      ) : null}
      <Feedback error={error} message={message} />
    </ActionSection>
  )
}

function ManualReceiptAction({ product, user, onChanged }: { product: ProductRecord; user: AuthUser; onChanged: () => void | Promise<void> }) {
  const now = new Date()
  const defaultNfe = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getFullYear()).slice(-2)}`
  const [nfe, setNfe] = useState(defaultNfe)
  const [order, setOrder] = useState('')
  const [reason, setReason] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState(String(product.unidade || 'UN').toUpperCase())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    loadLatestManualReceiptReason(product.codigo).then((data) => {
      if (data.motivo) setReason(data.motivo)
    }).catch(() => {})
  }, [product.codigo])

  const submit = async () => {
    const parsed = Number(quantity.replace(',', '.'))
    setError(null)
    setMessage(null)
    if (!nfe.trim()) return setError('Informe a NF-e (boleto, data, etc.).')
    if (!reason.trim()) return setError('Informe o motivo do recebimento sem NF-e.')
    if (!Number.isFinite(parsed) || parsed <= 0) return setError('Informe uma quantidade válida.')
    setSubmitting(true)
    try {
      const result = await createManualReceipt(product, { qtd: parsed, unidade: unit.trim().toUpperCase() || 'UN', nfe: nfe.trim(), pedido: order.trim(), motivo: reason.trim(), usuario: user.username })
      const destination = result.destino === 'identificacao' ? 'Identificação do produto (Logística)' : 'lista PIR (Qualidade Fábrica → PIR)'
      setMessage(`Entrada #${result.id} criada. Destino: ${destination}.`)
      setQuantity('')
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Erro ao criar entrada.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ActionSection title="Recebimento sem NF-e">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="NF-e (boleto, data, etc.)"><input className="thermo-input" value={nfe} onChange={(event) => setNfe(event.target.value)} /></Field>
        <Field label="Pedido"><input className="thermo-input" value={order} onChange={(event) => setOrder(event.target.value)} /></Field>
        <Field label="Motivo do recebimento"><input className="thermo-input" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        <Field label="Quantidade"><input className="thermo-input" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
        <Field label="Unidade"><input className="thermo-input uppercase" value={unit} onChange={(event) => setUnit(event.target.value)} /></Field>
      </div>
      <Feedback error={error} message={message} />
      <button type="button" className="thermo-button thermo-button-primary" onClick={() => void submit()} disabled={submitting}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}{submitting ? 'Criando entrada…' : 'Criar entrada'}</button>
    </ActionSection>
  )
}

function IdentificationHistoryAction({ product, user }: { product: ProductRecord; user: AuthUser }) {
  const [items, setItems] = useState<IdentificationHistoryItem[]>([])
  const [printers, setPrinters] = useState<PrinterOption[]>([])
  const [printerValue, setPrinterValue] = useState('')
  const [format, setFormat] = useState<'pequeno' | 'grande'>('pequeno')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [printingId, setPrintingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([loadIdentificationHistory(product.codigo), loadPrinterOptions()])
      .then(([history, options]) => {
        if (!active) return
        setItems(history.etiquetas || [])
        setPrinters(options)
        setPrinterValue(options[0]?.value || '')
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Falha ao carregar identificações.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [product.codigo])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return items
    return items.filter((item) => [item.id, item.id_rotulo, item.lote, item.endereco, item.numero_nfe, item.numero_pedido, item.usuario_criacao].join(' ').toLowerCase().includes(query))
  }, [items, search])

  const print = async (item: IdentificationHistoryItem) => {
    const printer = printers.find((option) => option.value === printerValue)
    if (!printer) return setError('Escolha a impressora para reimprimir.')
    if (!window.confirm(`Reimprimir a ETQ ${item.id_rotulo || item.id} no formato ${format === 'grande' ? '70 × 115 mm' : '50 × 30 mm'} em ${printer.label}?`)) return
    setPrintingId(item.id)
    setError(null)
    setMessage(null)
    try {
      await reprintIdentification(item.id, user.username, format, printer)
      setMessage(`ETQ ${item.id_rotulo || item.id} enviada para reimpressão. O ID foi preservado.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao reimprimir etiqueta.')
    } finally {
      setPrintingId(null)
    }
  }

  return (
    <ActionSection title="Histórico de identificações">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Filtrar"><input className="thermo-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ID, lote, NF-e ou endereço" /></Field>
        <Field label="Formato"><select className="thermo-input" value={format} onChange={(event) => setFormat(event.target.value as 'pequeno' | 'grande')}><option value="pequeno">Pequena (50 × 30 mm)</option><option value="grande">Grande (70 × 115 mm)</option></select></Field>
        <Field label="Impressora"><select className="thermo-input" value={printerValue} onChange={(event) => setPrinterValue(event.target.value)}><option value="">Selecione</option>{printers.map((printer) => <option key={printer.value} value={printer.value}>{printer.label}</option>)}</select></Field>
      </div>
      {loading ? <LoadingState label="Carregando etiquetas e impressoras…" /> : null}
      {!loading && !error && filtered.length === 0 ? <EmptyState label="Ainda não há etiquetas impressas deste produto." /> : null}
      <div className="space-y-2">
        {filtered.map((item) => (
          <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-thermo-border bg-thermo-bg px-4 py-3">
            <div><div className="font-mono text-sm font-bold text-thermo-navy">ETQ {item.id_rotulo || item.id}</div><div className="mt-1 text-xs text-slate-500">{item.impresso_em ? new Date(item.impresso_em).toLocaleString('pt-BR') : 'Sem data'}{item.usuario_criacao ? ` · ${item.usuario_criacao}` : ''}</div><div className="mt-1 text-xs text-slate-600">{item.lote ? `Lote ${item.lote} · ` : ''}{item.endereco || 'Sem endereço'} · {formatQuantity(item.qtd, item.unidade)}</div></div>
            <button type="button" className="thermo-button thermo-button-secondary" onClick={() => void print(item)} disabled={printingId === item.id}><Printer className="size-4" />{printingId === item.id ? 'Enviando…' : 'Reimprimir'}</button>
          </article>
        ))}
      </div>
      <Feedback error={error} message={message} />
    </ActionSection>
  )
}

function MovementHistoryAction({ product }: { product: ProductRecord }) {
  const state = useAsyncValue(
    () => loadMovementHistory(product),
    `${product.codigo}\u0000${product.codigo_produto || ''}`,
  )
  const rows = state.value?.ajuste_estoque_lista || []
  return (
    <ActionSection title="Histórico de movimentação">
      <AsyncFeedback state={state} loadingLabel="Consultando histórico na Omie…" />
      {!state.loading && !state.error && rows.length === 0 ? <EmptyState label="Nenhuma movimentação encontrada no período consultado." /> : null}
      {state.value?.periodo ? <div className="text-xs text-slate-500">Período: {state.value.periodo.de || '—'} a {state.value.periodo.ate || '—'}</div> : null}
      <div className="space-y-2">
        {rows.map((row, index) => (
          <article key={`${displayValue(row.id_ajuste)}-${index}`} className="rounded-xl border border-thermo-border bg-thermo-bg px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <InfoLine label="Data" value={displayValue(row.data || row.data_movimento)} />
              <InfoLine label="Tipo" value={displayValue(row.tipo || row.tipo_operacao || row.motivo)} />
              <InfoLine label="Local" value={displayValue(row.local_estoque || row.codigo_local_estoque || row.local)} />
              <InfoLine label="Quantidade" value={displayValue(row.quantidade || row.qtd || row.quan)} />
              <div className="sm:col-span-2 lg:col-span-4"><InfoLine label="Observação" value={displayValue(row.obs || row.observacao || row.descricao)} /></div>
            </div>
          </article>
        ))}
      </div>
    </ActionSection>
  )
}

function MovementAction({ product, user, onChanged }: { product: ProductRecord; user: AuthUser; onChanged: () => void | Promise<void> }) {
  const setup = useAsyncValue(() => loadMovementSetup(product), product.codigo)
  const [kind, setKind] = useState<'ENT' | 'SAI' | 'TRF'>('TRF')
  const [source, setSource] = useState('10717096386')
  const [destination, setDestination] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState<'INV' | 'INI' | 'PER' | 'TRF' | 'TPQ'>('TRF')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const locations = setup.value?.locations || []
  const allowedSources = useMemo(
    () => filterAllowedSources(setup.value?.locations || [], setup.value?.permission),
    [setup.value],
  )

  useEffect(() => {
    if (kind === 'TRF') setReason('TRF')
    else if (kind === 'ENT') setReason('INV')
    else setReason('INV')
  }, [kind])

  const submit = async () => {
    const parsed = Number(quantity.replace(',', '.'))
    setError(null)
    setMessage(null)
    if (!Number.isFinite(parsed) || parsed <= 0) return setError('Informe uma quantidade válida.')
    if (!window.confirm(`Confirmar ${kind === 'TRF' ? 'transferência' : kind === 'ENT' ? 'entrada' : 'saída'} de ${formatQuantity(parsed, product.unidade)} para ${product.codigo}?`)) return
    setSubmitting(true)
    try {
      const result = await executeMovement(product, user, { kind, source, destination, quantity: parsed, reason, note })
      setMessage(`Movimentação #${result.id} concluída e confirmada na Omie.`)
      setQuantity('')
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao registrar movimentação.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ActionSection title="Movimentação de estoque">
      <AsyncFeedback state={setup} loadingLabel="Carregando locais e saldos reais…" />
      {setup.value ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tipo de movimentação"><select className="thermo-input" value={kind} onChange={(event) => setKind(event.target.value as 'ENT' | 'SAI' | 'TRF')}><option value="ENT">Entrada</option><option value="SAI">Saída</option><option value="TRF">Transferência</option></select></Field>
            <Field label="Motivo"><select className="thermo-input" value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}>{movementReasons(kind).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
            {kind !== 'ENT' ? <Field label="Origem"><LocationSelect locations={allowedSources} value={source} onChange={setSource} /></Field> : null}
            {kind !== 'SAI' ? <Field label="Destino"><LocationSelect locations={locations} value={destination} onChange={setDestination} emptyLabel="Selecione o destino" /></Field> : null}
            <Field label="Quantidade"><input className="thermo-input" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
            <Field label="Apontamento"><input className="thermo-input" value={note} onChange={(event) => setNote(event.target.value)} /></Field>
          </div>
          <Feedback error={error} message={message} />
          <button type="button" className="thermo-button thermo-button-primary" onClick={() => void submit()} disabled={submitting}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowLeftRight className="size-4" />}{submitting ? 'Confirmando na Omie…' : 'Executar movimentação'}</button>
        </div>
      ) : null}
    </ActionSection>
  )
}

function DispatchAction({ product, user, onChanged }: { product: ProductRecord; user: AuthUser; onChanged: () => void | Promise<void> }) {
  const setup = useAsyncValue(() => loadMovementSetup(product), product.codigo)
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const stock = setup.value?.stock || []
  const sourceBalance = stockBalance(stock, '10408747829')
  const destinationBalance = stockBalance(stock, '10440426539')

  const submit = async () => {
    const parsed = Number(quantity.replace(',', '.'))
    setError(null)
    setMessage(null)
    if (!Number.isFinite(parsed) || parsed <= 0) return setError('Informe uma quantidade válida maior que zero.')
    if (sourceBalance != null && parsed > sourceBalance) return setError('A quantidade informada é maior que o saldo disponível no Estoque Máquinas.')
    if (!window.confirm(`Enviar ${formatQuantity(parsed, product.unidade)} de Estoque Máquinas para Expedição?`)) return
    setSubmitting(true)
    try {
      const result = await executeDispatch(product, user, parsed, note)
      setMessage(`Transferência #${result.id} confirmada. Produto enviado para Expedição.`)
      setQuantity('')
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao enviar para Expedição.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ActionSection title="Enviar produto para Expedição">
      <AsyncFeedback state={setup} loadingLabel="Carregando saldos reais…" />
      {setup.value ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2"><InfoLine label="Estoque Máquinas" value={sourceBalance == null ? 'Indisponível' : formatQuantity(sourceBalance, product.unidade)} /><InfoLine label="Estoque Expedição" value={destinationBalance == null ? 'Indisponível' : formatQuantity(destinationBalance, product.unidade)} /></div>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Quantidade"><input className="thermo-input" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field><Field label="Observação"><input className="thermo-input" value={note} onChange={(event) => setNote(event.target.value)} /></Field></div>
          <Feedback error={error} message={message} />
          <button type="button" className="thermo-button thermo-button-primary" onClick={() => void submit()} disabled={submitting}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Truck className="size-4" />}{submitting ? 'Confirmando na Omie…' : 'Enviar para Expedição'}</button>
        </div>
      ) : null}
    </ActionSection>
  )
}

function useAsyncValue<T>(factory: () => Promise<T>, dependencyKey: string) {
  const [value, setValue] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const load = useEffectEvent(factory)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setValue(null)
    load()
      .then((result) => { if (active) setValue(result) })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Falha ao carregar dados.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [dependencyKey])
  return { value, loading, error }
}

function ActionSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-4 rounded-xl border border-thermo-border bg-white px-4 py-4"><h3 className="text-base font-bold text-thermo-navy">{title}</h3>{children}</section>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</span>{children}</label>
}

function NumberField({ label, value, step = '0.01', onChange }: { label: string; value: number; step?: string; onChange: (value: string) => void }) {
  return <Field label={label}><input type="number" min="0" step={step} className="thermo-input" value={value} onChange={(event) => onChange(event.target.value)} /></Field>
}

function LoadingState({ label }: { label: string }) {
  return <div className="flex items-center gap-2 rounded-xl border border-thermo-border bg-thermo-bg px-4 py-4 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />{label}</div>
}

function ErrorState({ message, actionLabel, onAction }: { message: string; actionLabel?: string; onAction?: () => void }) {
  return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><div>{message}</div>{onAction ? <button type="button" className="thermo-button thermo-button-secondary mt-3" onClick={onAction}><RefreshCw className="size-4" />{actionLabel}</button> : null}</div>
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-xl border border-dashed border-thermo-border bg-thermo-bg px-4 py-5 text-sm text-slate-500">{label}</div>
}

function SuccessState({ label }: { label: string }) {
  return <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{label}</div>
}

function Feedback({ error, message }: { error: string | null; message: string | null }) {
  return <>{error ? <ErrorState message={error} /> : null}{message ? <SuccessState label={message} /> : null}</>
}

function AsyncFeedback<T>({ state, loadingLabel }: { state: { loading: boolean; error: string | null; value: T | null }; loadingLabel: string }) {
  return <>{state.loading ? <LoadingState label={loadingLabel} /> : null}{!state.loading && state.error ? <ErrorState message={state.error} /> : null}</>
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div><div className="mt-1 break-words text-sm text-thermo-ink">{value}</div></div>
}

function LocationSelect({ locations, value, onChange, emptyLabel }: { locations: WarehouseLocation[]; value: string; onChange: (value: string) => void; emptyLabel?: string }) {
  return <select className="thermo-input" value={value} onChange={(event) => onChange(event.target.value)}>{emptyLabel ? <option value="">{emptyLabel}</option> : null}{locations.map((location) => <option key={String(location.codigo_local_estoque)} value={String(location.codigo_local_estoque)}>{location.descricao || location.codigo_local_estoque}</option>)}</select>
}

function filterAllowedSources(locations: WarehouseLocation[], rule?: { origem_local_codigo?: string | null; origem_local_codigos?: string[] | null } | null) {
  const raw = rule?.origem_local_codigos?.length ? rule.origem_local_codigos : String(rule?.origem_local_codigo || '').split(',')
  const allowed = raw.map(String).map((value) => value.trim()).filter(Boolean)
  return allowed.length ? locations.filter((location) => allowed.includes(String(location.codigo_local_estoque))) : locations
}

function movementReasons(kind: 'ENT' | 'SAI' | 'TRF') {
  if (kind === 'ENT') return [{ value: 'INV', label: 'INV | Ajuste por Inventário' }, { value: 'INI', label: 'INI | Estoque Inicial' }] as const
  if (kind === 'SAI') return [{ value: 'INV', label: 'INV | Ajuste por Inventário' }, { value: 'PER', label: 'PER | Baixa por Perda/Quebra' }] as const
  return [{ value: 'TRF', label: 'TRF | Transferência entre Locais' }, { value: 'TPQ', label: 'TPQ | Transferência por Perda/Quebra' }] as const
}

function stockBalance(stock: Array<Record<string, unknown>>, code: string) {
  const row = stock.find((item) => String(item.local_codigo || '').trim() === code)
  const value = Number(row?.saldo ?? row?.quantidade)
  return Number.isFinite(value) ? value : null
}

function displayValue(value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function formatNumber(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('pt-BR').format(value) : '—'
}

function formatCurrency(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value) : '—'
}

function formatQuantity(value: number, unit: string | null | undefined) {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(Number(value || 0))} ${String(unit || 'UN').toUpperCase()}`
}
