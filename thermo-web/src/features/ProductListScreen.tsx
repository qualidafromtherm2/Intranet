import { clsx } from 'clsx'
import {
  ArrowLeftRight,
  CheckCircle2,
  ClipboardList,
  Ellipsis,
  ExternalLink,
  Filter,
  Grid2X2,
  ImageOff,
  Info,
  List,
  PackagePlus,
  PackageSearch,
  Pencil,
  QrCode,
  RefreshCw,
  Search,
  ShoppingCart,
  SquarePen,
  Truck,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ModalShell } from '../components/ModalShell'
import { usePilotData } from '../hooks/usePilotData'
import { defaultFilters } from '../lib/products'
import { quantity } from '../lib/format'
import { buildLegacyUrl } from '../services/authGateway'
import { loadPurchaseDetail } from '../services/pilotGateway'
import type { FiltersState, ProductFilterOption, ProductPurchaseDetailItem, ProductRecord, ProductWarehouseBalance } from '../types'

type BridgeKey = 'qr' | 'bulk' | 'cart' | 'separation' | 'detail'

const bridgeContent: Record<BridgeKey, { title: string; body: string; cta: string; href: string }> = {
  qr: {
    title: 'Leitor QR legado',
    body: 'A leitura por câmera e bipador continua no modal legado da Lista de Produtos. A ponte abre a Intranet atual em URL real, sem mock.',
    cta: 'Abrir leitor QR no legado',
    href: buildLegacyUrl('/menu_produto.html'),
  },
  bulk: {
    title: 'Editar em massa no legado',
    body: 'A edição em massa ainda depende do fluxo legado. Esta ponte abre a Intranet atual para continuar a operação real.',
    cta: 'Abrir edição em massa no legado',
    href: buildLegacyUrl('/menu_produto.html'),
  },
  cart: {
    title: 'Carrinho de compras no legado',
    body: 'A contagem vem da API real. A abertura do carrinho completo continua no modal legado por regra operacional e permissões já existentes.',
    cta: 'Abrir carrinho de compras no legado',
    href: buildLegacyUrl('/menu_produto.html'),
  },
  separation: {
    title: 'Carrinho de separação no legado',
    body: 'A solicitação de separação continua no modal legado. Esta ponte abre a Intranet atual para seguir o fluxo real.',
    cta: 'Abrir carrinho de separação no legado',
    href: buildLegacyUrl('/menu_produto.html'),
  },
  detail: {
    title: 'Detalhe do produto no legado',
    body: 'A visualização detalhada e edição do produto permanecem no fluxo legado. Esta ponte abre a Intranet atual para seguir a rotina real.',
    cta: 'Abrir detalhe do produto no legado',
    href: buildLegacyUrl('/menu_produto.html#produto-dados'),
  },
}

function countAppliedFilters(filters: FiltersState) {
  return (
    filters.families.length +
    filters.typeItems.length +
    filters.origins.length +
    filters.purchaseStatus.length +
    filters.locationCodes.length +
    Number(filters.showInactive) +
    Number(filters.hideObsolete) +
    Number(filters.hideEngineering) +
    Number(filters.semEstoqueMin) +
    Number(filters.abaixoEstoqueMin) +
    Number(filters.acimaEstoqueMin) +
    Number(filters.proximoEstoqueMin) +
    Number(filters.estoqueNegativo)
  )
}

function describeAppliedFilters(filters: FiltersState) {
  const parts: Array<{ key: string; label: string }> = []
  if (filters.semEstoqueMin) parts.push({ key: 'semEstoqueMin', label: 'Sem estoque mínimo' })
  if (filters.abaixoEstoqueMin) parts.push({ key: 'abaixoEstoqueMin', label: 'Abaixo do mínimo' })
  if (filters.acimaEstoqueMin) parts.push({ key: 'acimaEstoqueMin', label: 'Acima do mínimo' })
  if (filters.proximoEstoqueMin) parts.push({ key: 'proximoEstoqueMin', label: `Até ${filters.proximoPercent}% acima do mínimo` })
  if (filters.estoqueNegativo) parts.push({ key: 'estoqueNegativo', label: 'Estoque negativo' })
  if (filters.showInactive) parts.push({ key: 'showInactive', label: 'Mostrar inativos' })
  if (filters.hideObsolete) parts.push({ key: 'hideObsolete', label: 'Ocultar obsoletos' })
  if (filters.hideEngineering) parts.push({ key: 'hideEngineering', label: 'Ocultar engenharia' })
  if (filters.families.length) parts.push({ key: 'families', label: `${filters.families.length} família(s)` })
  if (filters.typeItems.length) parts.push({ key: 'typeItems', label: `${filters.typeItems.length} tipo(s)` })
  if (filters.origins.length) parts.push({ key: 'origins', label: `${filters.origins.length} origem(ns)` })
  if (filters.purchaseStatus.includes('em_compra')) parts.push({ key: 'purchaseStatus', label: 'Em compra' })
  if (filters.locationCodes.length) parts.push({ key: 'locationCodes', label: `${filters.locationCodes.length} local(is)` })
  return parts
}

function statusTone(product: ProductRecord) {
  if (product.saldo_endereco_sem_omie || product.saldo_divergente_endereco) return 'red'
  if (hasNegativeStock(product).length > 0) return 'red'
  if (product.abaixo_minimo) return 'amber'
  return 'green'
}

function toNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function renderStockLines(product: ProductRecord) {
  const seen = new Set<string>()
  const balances = Array.isArray(product.warehouseBalances) ? product.warehouseBalances : []
  const normalized = balances
    .map((item, index) => normalizeWarehouseBalance(item, product.unidade, index))
    .filter((item): item is ReturnType<typeof normalizeWarehouseBalance> => Boolean(item))
    .filter((item) => {
      if (seen.has(item.key)) return false
      seen.add(item.key)
      return true
    })

  const almox =
    normalized.find((item) => item.isAlmox)
    ?? {
      key: '10717096386',
      label: '#ALMOX',
      numeric: toNumber(product.saldo_almox),
      priority: true,
      isAlmox: true,
      value: quantity(toNumber(product.saldo_almox), product.unidade),
    }

  const others = normalized
    .filter((item) => !item.isAlmox && item.numeric !== 0)
    .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'))

  return [almox, ...others]
}

function normalizeWarehouseBalance(item: ProductWarehouseBalance, unit: string | null | undefined, index: number) {
  const code = String(item.local_codigo || '').trim()
  const rawLabel = String(item.local_nome || '').trim()
  const isAlmox = code === '10717096386' || /porta pallet|almox/i.test(rawLabel)
  const label = isAlmox ? '#ALMOX' : rawLabel || code || `Armazém ${index + 1}`
  return {
    key: code || `${label}-${index}`,
    label,
    numeric: toNumber(item.saldo),
    priority: isAlmox,
    isAlmox,
    value: quantity(toNumber(item.saldo), unit),
  }
}

function minimumHealth(product: ProductRecord) {
  const minimo = toNumber(product.estoque_minimo)
  const saldo = toNumber(product.saldo_almox)
  if (minimo <= 0) return null
  const percentual = (saldo / minimo) * 100
  return {
    saldo,
    minimo,
    percentual,
    progress: Math.max(0, Math.min(percentual, 100)),
    tone: percentual < 100 ? 'bg-red-500' : percentual === 100 ? 'bg-amber-500' : 'bg-emerald-500',
    textTone: percentual < 100 ? 'text-red-700' : percentual === 100 ? 'text-amber-700' : 'text-emerald-700',
  }
}

function hasNegativeStock(product: ProductRecord) {
  return renderStockLines(product).filter((line) => line.numeric < 0)
}

function buildStatusFlags(product: ProductRecord) {
  const flags: Array<{ key: string; tone: 'green' | 'amber' | 'red' | 'slate'; label: string }> = []
  const negativeLines = hasNegativeStock(product)

  if (negativeLines.length > 0) {
    flags.push({
      key: 'estoque-negativo',
      tone: 'red',
      label: negativeLines.length === 1 ? `${negativeLines[0]!.label} negativo` : 'Estoque negativo',
    })
  } else if (product.expedicao_negativa && toNumber(product.saldo_expedicao) < 0) {
    flags.push({ key: 'expedicao-negativa', tone: 'red', label: 'Expedição negativa' })
  }

  if (product.saldo_endereco_sem_omie) {
    flags.push({ key: 'saldo-endereco-sem-omie', tone: 'red', label: 'Saldo em endereço sem Omie' })
  }

  if (product.saldo_divergente_endereco) {
    flags.push({ key: 'saldo-divergente-endereco', tone: 'red', label: 'Omie diferente dos endereços' })
  }

  if (product.estoque_minimo > 0) {
    flags.push({
      key: 'estoque-minimo',
      tone: product.abaixo_minimo ? 'red' : 'green',
      label: product.abaixo_minimo ? `Abaixo do mínimo · ${quantity(product.estoque_minimo, product.unidade)}` : `Mínimo · ${quantity(product.estoque_minimo, product.unidade)}`,
    })
  }

  return flags
}

function StatusBadge({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'slate'; children: string }) {
  const styles = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
  }

  return <span className={clsx('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold', styles[tone])}>{children}</span>
}

function MultiSelectField({
  label,
  hint,
  value,
  options,
  size = 5,
  onChange,
}: {
  label: string
  hint: string
  value: string[]
  options: ProductFilterOption[]
  size?: number
  onChange: (value: string[]) => void
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{label}</label>
      <select
        multiple
        size={size}
        value={value}
        onChange={(event) => onChange(Array.from(event.target.selectedOptions, (option) => option.value))}
        className="min-h-24 w-full rounded-xl border border-thermo-border bg-white px-3 py-2 text-sm text-thermo-ink outline-none focus:border-thermo-navy"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} ({option.count})
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  )
}

function ProductCard({
  product,
  onOpenPurchase,
  onOpenActions,
}: {
  product: ProductRecord
  onOpenPurchase: (product: ProductRecord) => void
  onOpenActions: (product: ProductRecord) => void
}) {
  const tone = statusTone(product)
  const stockLines = renderStockLines(product)
  const statusFlags = buildStatusFlags(product)
  const minimum = minimumHealth(product)

  return (
    <article className="flex h-full flex-col rounded-xl border border-thermo-border bg-white shadow-sm" data-testid="product-card">
      <div className="flex items-start gap-3 border-b border-thermo-border px-3 py-2.5">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={`Imagem do produto ${product.codigo}`}
            className="h-12 w-12 rounded-lg border border-thermo-border object-cover"
          />
        ) : (
          <div
            className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-thermo-border bg-slate-50 text-slate-400"
            aria-label={`Produto ${product.codigo} sem imagem`}
          >
            <ImageOff className="size-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] font-semibold text-slate-500">{product.codigo}</div>
          <h3 className="mt-0.5 line-clamp-2 text-[13px] leading-4 font-bold text-thermo-navy">{product.descricao}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {product.purchaseState === 'em_compra' ? <StatusBadge tone="amber">{product.compraStatus || 'Em compra'}</StatusBadge> : null}
            {statusFlags.map((flag) => (
              <StatusBadge key={flag.key} tone={flag.tone === 'green' ? tone : flag.tone}>{flag.label}</StatusBadge>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2 px-3 py-2.5">
        <div className="rounded-md border border-thermo-border bg-slate-50 px-2 py-1.5 text-[11px]">
          {minimum ? (
            <>
              <div className={clsx('font-semibold', minimum.textTone)}>
                {quantity(minimum.saldo, product.unidade)} / mín {quantity(minimum.minimo, product.unidade)} · {Math.round(minimum.percentual)}%
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className={clsx('h-full rounded-full', minimum.tone)} style={{ width: `${minimum.progress}%` }} />
              </div>
            </>
          ) : (
            <div className="font-semibold text-slate-500">Sem mínimo</div>
          )}
        </div>
        <div className="space-y-1.5">
          {stockLines.map((line) => (
            <div key={line.label} className={clsx('flex items-center justify-between rounded-md px-2 py-1 text-[11px]', line.priority ? 'bg-slate-100 text-slate-900' : 'bg-white text-slate-600')}>
              <span className={clsx('truncate', line.priority ? 'font-extrabold' : 'font-semibold')}>{line.label}</span>
              <span className={clsx('font-mono', line.priority ? 'font-extrabold' : 'font-semibold')}>{line.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-thermo-border px-3 py-2.5">
        {product.purchaseState === 'em_compra' ? (
          <button
            type="button"
            className="inline-flex min-h-9 items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-800"
            onClick={() => onOpenPurchase(product)}
            title="Ver detalhes reais da compra"
          >
            Em compra
          </button>
        ) : <span />}
        <button className="thermo-button thermo-button-secondary shrink-0 px-3 py-1.5 text-xs" type="button" onClick={() => onOpenActions(product)}>
          <Info className="size-4" />
          Ações
        </button>
      </div>
    </article>
  )
}

function ProductTable({
  rows,
  onOpenPurchase,
  onOpenActions,
}: {
  rows: ProductRecord[]
  onOpenPurchase: (product: ProductRecord) => void
  onOpenActions: (product: ProductRecord) => void
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-thermo-border">
      <table className="min-w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-thermo-bg text-left text-[10px] uppercase tracking-[0.14em] text-slate-500">
          <tr>
            <th className="px-3 py-2.5">Foto</th>
            <th className="px-3 py-2.5">Código</th>
            <th className="px-3 py-2.5">Descrição</th>
            <th className="px-3 py-2.5">Compra</th>
            <th className="px-3 py-2.5">Exceção</th>
            <th className="px-3 py-2.5">Saldo / mínimo</th>
            <th className="px-3 py-2.5">#ALMOX</th>
            <th className="px-3 py-2.5">Demais armazéns</th>
            <th className="px-3 py-2.5">Mínimo</th>
            <th className="px-3 py-2.5">Ação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((product) => (
            <tr
              key={product.codigo}
              className="cursor-pointer border-t border-thermo-border align-top transition hover:bg-slate-50 focus-within:bg-slate-50"
              tabIndex={0}
              aria-label={`Abrir ações do produto ${product.codigo}`}
              onClick={() => onOpenActions(product)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onOpenActions(product)
                }
              }}
            >
              {(() => {
                const minimum = minimumHealth(product)
                const stockLines = renderStockLines(product)
                return (
                  <>
              <td className="px-3 py-2.5">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt="" className="h-10 w-10 rounded-md border border-thermo-border object-cover" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-thermo-border bg-slate-50 text-slate-400">
                    <ImageOff className="size-4" />
                  </div>
                )}
              </td>
              <td className="px-3 py-2.5 font-mono text-xs font-semibold text-slate-600">{product.codigo}</td>
              <td className="px-3 py-2.5">
                <div className="font-semibold text-thermo-navy">{product.descricao}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {buildStatusFlags(product).map((flag) => (
                    <StatusBadge key={flag.key} tone={flag.tone}>{flag.label}</StatusBadge>
                  ))}
                </div>
              </td>
              <td className="px-3 py-2.5 text-slate-600">
                {product.purchaseState === 'em_compra' ? (
                  <button
                    type="button"
                    className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-800"
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpenPurchase(product)
                    }}
                  >
                    {product.compraStatus || 'Em compra'}
                  </button>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-3 py-2.5 text-slate-600">{buildStatusFlags(product).filter((flag) => flag.key !== 'estoque-minimo').map((flag) => flag.label).join(' · ') || '—'}</td>
              <td className="px-3 py-2.5 text-xs">
                {minimum ? (
                  <div className={clsx('font-semibold', minimum.textTone)}>
                    {quantity(minimum.saldo, product.unidade)} / mín {quantity(minimum.minimo, product.unidade)} · {Math.round(minimum.percentual)}%
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div className={clsx('h-full rounded-full', minimum.tone)} style={{ width: `${minimum.progress}%` }} />
                    </div>
                  </div>
                ) : (
                  <span className="text-slate-500">Sem mínimo</span>
                )}
              </td>
              <td className="px-3 py-2.5 font-mono text-slate-600">{quantity(product.saldo_almox, product.unidade)}</td>
              <td className="px-3 py-2.5 text-xs text-slate-600">
                {stockLines.filter((line) => !line.isAlmox).length > 0 ? (
                  <div className="space-y-1">
                    {stockLines.filter((line) => !line.isAlmox).map((line) => (
                      <div key={line.key} className="whitespace-nowrap">
                        <span className="font-semibold">{line.label}:</span> {line.value}
                      </div>
                    ))}
                  </div>
                ) : '—'}
              </td>
              <td className="px-3 py-2.5 font-mono text-slate-600">{product.estoque_minimo > 0 ? quantity(product.estoque_minimo, product.unidade) : '—'}</td>
              <td className="px-3 py-2.5">
                <button
                  className="thermo-button thermo-button-secondary whitespace-nowrap px-3 py-2 text-xs"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onOpenActions(product)
                  }}
                >
                  <Info className="size-4" />
                  Ações
                </button>
              </td>
                  </>
                )
              })()}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onChange,
}: {
  page: number
  pageCount: number
  total: number
  pageSize: number
  onChange: (page: number) => void
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 text-sm">
      <div className="text-slate-600">
        Página <strong>{page}</strong> de <strong>{pageCount}</strong> · {total} produto(s) · {pageSize} por página
      </div>
      <div className="flex items-center gap-2">
        <button className="thermo-button thermo-button-secondary" type="button" onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1}>
          Anterior
        </button>
        <button className="thermo-button thermo-button-secondary" type="button" onClick={() => onChange(Math.min(pageCount, page + 1))} disabled={page >= pageCount}>
          Próxima
        </button>
      </div>
    </div>
  )
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
      <div className="font-bold">Não foi possível carregar a Lista de Produtos real.</div>
      <div className="mt-2">{error}</div>
      <button className="thermo-button thermo-button-primary mt-4" type="button" onClick={onRetry}>
        <RefreshCw className="size-4" />
        Tentar novamente
      </button>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-8 text-center text-sm text-slate-500">
      Carregando Lista de Produtos real…
    </div>
  )
}

function EmptyState({
  hasSearch,
  onReset,
  onBridge,
}: {
  hasSearch: boolean
  onReset: () => void
  onBridge: (key: BridgeKey, product?: ProductRecord) => void
}) {
  return (
    <div className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-8 text-center">
      <PackageSearch className="mx-auto size-10 text-slate-400" />
      <div className="mt-3 text-lg font-bold text-thermo-navy">Nenhum produto encontrado</div>
      <p className="mt-2 text-sm text-slate-500">
        {hasSearch ? 'A pesquisa e os filtros atuais não retornaram resultados.' : 'A lista real não possui itens visíveis com os filtros ativos.'}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button className="thermo-button thermo-button-secondary" type="button" onClick={onReset}>
          Limpar filtros
        </button>
        <button className="thermo-button thermo-button-secondary" type="button" onClick={() => onBridge('qr')}>
          <QrCode className="size-4" />
          Abrir leitor QR legado
        </button>
      </div>
    </div>
  )
}

export function ProductListScreen({
  permissions,
}: {
  permissions: {
    canOpenCart: boolean
    canOpenSeparation: boolean
    canEditCatalog: boolean
    cartReason: string | null
    separationReason: string | null
  }
}) {
  const { filtered, paginated, loading, error, warnings, filters, setFilters, filtersMeta, page, setPage, pageCount, pageSize, viewMode, setViewMode, cartCount, streamEvents, dataMode, reload, fetchedAt } = usePilotData()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [bridgeState, setBridgeState] = useState<{ key: BridgeKey; product?: ProductRecord } | null>(null)
  const [draftFilters, setDraftFilters] = useState<FiltersState>({ ...filters })
  const [purchaseProduct, setPurchaseProduct] = useState<ProductRecord | null>(null)
  const [purchaseLoading, setPurchaseLoading] = useState(false)
  const [purchaseError, setPurchaseError] = useState<string | null>(null)
  const [purchaseItems, setPurchaseItems] = useState<ProductPurchaseDetailItem[]>([])
  const [actionProduct, setActionProduct] = useState<ProductRecord | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)

  const appliedFilterCount = useMemo(() => countAppliedFilters(filters), [filters])
  const appliedFilterSummary = useMemo(() => describeAppliedFilters(filters), [filters])
  const draftFilterCount = useMemo(() => countAppliedFilters(draftFilters), [draftFilters])
  const latestEvent = streamEvents[0]?.message || (streamEvents[0]?.type === 'error' ? 'canal indisponível' : 'aguardando')

  const updateFilters = (next: Partial<FiltersState>) => {
    setPage(1)
    setFilters((current) => ({ ...current, ...next }))
  }

  const updateDraftFilters = (next: Partial<FiltersState>) => {
    setDraftFilters((current) => ({ ...current, ...next }))
  }

  const openFilters = () => {
    setDraftFilters({ ...filters })
    setFiltersOpen(true)
  }

  const closeFilters = () => {
    setDraftFilters({ ...filters })
    setFiltersOpen(false)
  }

  const applyDraftFilters = () => {
    setPage(1)
    setFilters({ ...draftFilters })
    setFiltersOpen(false)
  }

  const clearDraftFilters = () => {
    setDraftFilters({ ...defaultFilters })
  }

  const removeAppliedFilter = (key: string) => {
    switch (key) {
      case 'semEstoqueMin':
      case 'abaixoEstoqueMin':
      case 'acimaEstoqueMin':
      case 'proximoEstoqueMin':
      case 'estoqueNegativo':
      case 'showInactive':
      case 'hideObsolete':
      case 'hideEngineering':
        updateFilters({ [key]: false } as Partial<FiltersState>)
        return
      case 'families':
      case 'typeItems':
      case 'origins':
      case 'purchaseStatus':
      case 'locationCodes':
        updateFilters({ [key]: [] } as Partial<FiltersState>)
        return
      default:
        break
    }
  }

  const openBridge = (key: BridgeKey, product?: ProductRecord) => setBridgeState({ key, product })
  const openActions = (product: ProductRecord) => setActionProduct(product)
  const openPurchase = async (product: ProductRecord) => {
    setPurchaseProduct(product)
    setPurchaseLoading(true)
    setPurchaseError(null)
    setPurchaseItems([])

    try {
      const detail = await loadPurchaseDetail(product.codigo)
      setPurchaseItems(detail.compras || [])
    } catch (error) {
      setPurchaseError(error instanceof Error ? error.message : 'Falha ao carregar os detalhes da compra.')
    } finally {
      setPurchaseLoading(false)
    }
  }

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFiltersOpen(false)
        setBridgeState(null)
        setMoreOpen(false)
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [])

  return (
    <>
      <section className="rounded-[28px] border border-thermo-border bg-white shadow-sm">
        <div className="border-b border-thermo-border px-4 py-3 md:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-xl bg-thermo-navy px-3.5 py-1.5 text-sm font-semibold text-white">
              Lista de produtos
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">{filtered.length}</span>
            </span>
          </div>
        </div>

        <div className="border-b border-thermo-border px-4 py-3 md:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-w-[15rem] flex-1 items-center gap-2 rounded-xl border border-thermo-border bg-thermo-bg px-3 py-2">
              <Search className="size-4 text-slate-400" />
              <input
                value={filters.search}
                onChange={(event) => updateFilters({ search: event.target.value })}
                className="min-w-0 flex-1 bg-transparent text-sm text-thermo-ink outline-none placeholder:text-slate-400"
                placeholder="Pesquisar código ou descrição"
                aria-label="Pesquisar código ou descrição"
              />
              {filters.search ? (
                <button className="text-slate-400" type="button" aria-label="Limpar pesquisa" onClick={() => updateFilters({ search: '' })}>
                  <X className="size-4" />
                </button>
              ) : null}
            </label>

            <button className="thermo-toolbar-button min-h-10 px-3 py-1.5 text-xs md:text-sm" type="button" title="Filtrar produtos" aria-label="Filtrar produtos" onClick={openFilters}>
              <Filter className="size-4" />
              <span>Filtrar</span>
              {appliedFilterCount > 0 ? <span className="rounded-full bg-thermo-red px-2 py-0.5 text-xs text-white">{appliedFilterCount}</span> : null}
            </button>
            <button className="thermo-toolbar-button min-h-10 px-3 py-1.5 text-xs md:text-sm" type="button" title="Atualizar produtos" aria-label="Atualizar produtos" onClick={() => void reload()}>
              <RefreshCw className={clsx('size-4', loading && 'animate-spin')} />
              <span>Atualizar</span>
            </button>
            <button className={clsx('thermo-toolbar-button min-h-10 px-3 py-1.5 text-xs md:text-sm', viewMode === 'grid' && 'thermo-icon-button-active')} type="button" title="Visualização em cartões" aria-label="Visualização em cartões" onClick={() => setViewMode('grid')}>
              <Grid2X2 className="size-4" />
              <span>Card</span>
            </button>
            <button className={clsx('thermo-toolbar-button min-h-10 px-3 py-1.5 text-xs md:text-sm', viewMode === 'list' && 'thermo-icon-button-active')} type="button" title="Visualização em lista" aria-label="Visualização em lista" onClick={() => setViewMode('list')}>
              <List className="size-4" />
              <span>Lista</span>
            </button>
            <div className="relative ml-auto">
              <button
                className="thermo-toolbar-button min-h-10 whitespace-nowrap px-3 py-1.5 text-xs md:text-sm"
                type="button"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                aria-label="Mais ações da lista de produtos"
                onClick={() => setMoreOpen((current) => !current)}
              >
                <Ellipsis className="size-4" />
                <span>Mais</span>
              </button>
              {moreOpen ? (
                <div className="absolute right-0 top-full z-20 mt-2 min-w-56 rounded-xl border border-thermo-border bg-white p-2 shadow-lg">
                  <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-thermo-ink hover:bg-thermo-bg" type="button" onClick={() => { setMoreOpen(false); openBridge('qr') }}>
                    <QrCode className="size-4" />
                    QR legado
                  </button>
                  <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-thermo-ink hover:bg-thermo-bg" type="button" onClick={() => { setMoreOpen(false); openBridge('bulk') }}>
                    <SquarePen className="size-4" />
                    Editar em massa
                  </button>
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-thermo-ink hover:bg-thermo-bg disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    disabled={!permissions.canOpenCart}
                    onClick={() => {
                      setMoreOpen(false)
                      openBridge('cart')
                    }}
                    title={permissions.cartReason || 'Abrir painel de compras legado'}
                  >
                    <ShoppingCart className="size-4" />
                    Compras
                    <span className="ml-auto rounded-full bg-thermo-navy px-2 py-0.5 text-xs text-white">{cartCount}</span>
                  </button>
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-thermo-ink hover:bg-thermo-bg disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    disabled={!permissions.canOpenSeparation}
                    onClick={() => {
                      setMoreOpen(false)
                      openBridge('separation')
                    }}
                    title={permissions.separationReason || 'Abrir separações legadas'}
                  >
                    <ClipboardList className="size-4" />
                    Separações
                    <span className="ml-auto rounded-full bg-amber-500 px-2 py-0.5 text-xs text-white">{permissions.canOpenSeparation ? 'Legado' : 'Bloq.'}</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            {appliedFilterSummary.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => removeAppliedFilter(chip.key)}
                className="inline-flex items-center gap-2 rounded-full border border-thermo-border bg-thermo-bg px-3 py-1 text-xs font-semibold text-slate-700"
              >
                {chip.label}
                <X className="size-3" />
              </button>
            ))}
            {appliedFilterCount > 0 ? (
              <button className="text-sm font-semibold text-thermo-navy" type="button" onClick={() => setFilters(defaultFilters)}>
                Limpar tudo
              </button>
            ) : null}
          </div>
        </div>

        <div className="px-4 py-4 md:px-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-thermo-border bg-thermo-bg px-4 py-3 text-sm">
            <div className="font-semibold text-thermo-navy">{filtered.length} produto(s) visível(is) na lista</div>
            <div className="text-slate-500">
              {dataMode === 'proxy' ? 'Dados reais via proxy do legado' : 'Demo explícita'} · SSE: {latestEvent}{fetchedAt ? ` · cache ${new Date(fetchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </div>
          </div>

          {!loading && !error && warnings.length > 0 ? (
            <div className="mb-4 flex flex-wrap gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {warnings.map((warning) => (
                <span key={warning} className="rounded-full border border-amber-200 bg-white/70 px-3 py-1 font-medium">
                  {warning}
                </span>
              ))}
            </div>
          ) : null}

          {loading ? <LoadingState /> : null}
          {!loading && error ? <ErrorState error={error} onRetry={() => void reload()} /> : null}
          {!loading && !error && filtered.length === 0 ? <EmptyState onReset={() => setFilters(defaultFilters)} hasSearch={Boolean(filters.search.trim())} onBridge={openBridge} /> : null}
          {!loading && !error && filtered.length > 0 ? (
            <>
              {viewMode === 'grid' ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {paginated.map((product) => (
                    <ProductCard key={product.codigo} product={product} onOpenPurchase={openPurchase} onOpenActions={openActions} />
                  ))}
                </div>
              ) : (
                <ProductTable rows={paginated} onOpenPurchase={openPurchase} onOpenActions={openActions} />
              )}
              <Pagination page={page} pageCount={pageCount} total={filtered.length} pageSize={pageSize} onChange={setPage} />
            </>
          ) : null}
        </div>
      </section>

      <ModalShell open={filtersOpen} title="Central de filtros" description="Critérios equivalentes ao modal legado da Lista de Produtos." onClose={closeFilters} panelStyle={{ width: 'min(94vw, 30rem)', maxWidth: '30rem', flexShrink: 0 }}>
        <div className="flex max-h-[82vh] flex-col overflow-hidden">
          <div className="border-b border-thermo-border px-1 pb-3 text-sm text-slate-500">
            {draftFilterCount > 0 ? `${draftFilterCount} filtro(s) em edição` : 'Nenhum filtro em edição'}
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto py-4">
            <section>
              <div className="mb-2 text-sm font-bold text-thermo-navy">Estoque e situação</div>
              <div className="space-y-2">
                <label className="flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={draftFilters.semEstoqueMin} onChange={(event) => updateDraftFilters({ semEstoqueMin: event.target.checked })} className="size-4 accent-thermo-navy" />Sem estoque mínimo</label>
                <label className="flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={draftFilters.abaixoEstoqueMin} onChange={(event) => updateDraftFilters({ abaixoEstoqueMin: event.target.checked })} className="size-4 accent-thermo-red" />Abaixo do estoque mínimo</label>
                <label className="flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={draftFilters.acimaEstoqueMin} onChange={(event) => updateDraftFilters({ acimaEstoqueMin: event.target.checked })} className="size-4 accent-emerald-600" />Acima do estoque mínimo</label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={draftFilters.proximoEstoqueMin} onChange={(event) => updateDraftFilters({ proximoEstoqueMin: event.target.checked })} className="size-4 accent-amber-500" />Próximo do mínimo</label>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  até
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={draftFilters.proximoPercent}
                    disabled={!draftFilters.proximoEstoqueMin}
                    onChange={(event) => updateDraftFilters({ proximoPercent: Math.min(100, Math.max(1, Number(event.target.value) || 10)) })}
                    className="w-16 rounded-lg border border-thermo-border px-2 py-1 disabled:bg-slate-100"
                  />
                  % acima do mínimo
                </label>
              </div>
                <label className="flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={draftFilters.estoqueNegativo} onChange={(event) => updateDraftFilters({ estoqueNegativo: event.target.checked })} className="size-4 accent-thermo-red" />Estoque negativo</label>
              </div>
            </section>

            <section>
              <div className="mb-2 text-sm font-bold text-thermo-navy">Cadastro e visibilidade</div>
              <div className="space-y-2">
                <label className="flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={draftFilters.showInactive} onChange={(event) => updateDraftFilters({ showInactive: event.target.checked })} className="size-4 accent-thermo-navy" />Mostrar inativos</label>
                <label className="flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={draftFilters.hideObsolete} onChange={(event) => updateDraftFilters({ hideObsolete: event.target.checked })} className="size-4 accent-thermo-navy" />Ocultar obsoletos</label>
                <label className="flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={draftFilters.hideEngineering} onChange={(event) => updateDraftFilters({ hideEngineering: event.target.checked })} className="size-4 accent-thermo-navy" />Ocultar engenharia</label>
              </div>
            </section>

            <section className="grid gap-4">
              <div className="text-sm font-bold text-thermo-navy">Classificação e local</div>
              <MultiSelectField label="Família" hint="Sem seleção exibe todas." size={4} value={draftFilters.families} options={filtersMeta.families} onChange={(families) => updateDraftFilters({ families })} />
              <MultiSelectField label="Tipo de item" hint="Sem seleção exibe todos." size={4} value={draftFilters.typeItems} options={filtersMeta.typeItems} onChange={(typeItems) => updateDraftFilters({ typeItems })} />

            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Origem do produto</label>
              <select
                multiple
                size={2}
                value={draftFilters.origins}
                onChange={(event) => updateDraftFilters({ origins: Array.from(event.target.selectedOptions, (option) => option.value as 'N' | 'I') })}
                className="min-h-20 w-full rounded-xl border border-thermo-border bg-white px-3 py-2 text-sm text-thermo-ink outline-none focus:border-thermo-navy"
              >
                <option value="N">Nacional</option>
                <option value="I">Importado</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">Sem seleção exibe todas.</p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Situação de compra</label>
              <select
                multiple
                size={2}
                value={draftFilters.purchaseStatus}
                onChange={(event) => updateDraftFilters({ purchaseStatus: Array.from(event.target.selectedOptions, (option) => option.value as 'em_compra') })}
                className="min-h-20 w-full rounded-xl border border-thermo-border bg-white px-3 py-2 text-sm text-thermo-ink outline-none focus:border-thermo-navy"
              >
                <option value="em_compra">Em compra</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">Sem seleção exibe todas.</p>
            </div>

              <MultiSelectField label="Local" hint="O produto aparece se tiver saldo positivo em qualquer local selecionado." size={4} value={draftFilters.locationCodes} options={filtersMeta.locations} onChange={(locationCodes) => updateDraftFilters({ locationCodes })} />
            </section>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-thermo-border pt-4">
              <button className="thermo-button thermo-button-secondary" type="button" onClick={clearDraftFilters}>
                Limpar tudo
              </button>
              <button className="thermo-button thermo-button-secondary" type="button" onClick={closeFilters}>
                Cancelar
              </button>
              <button className="thermo-button thermo-button-primary" type="button" onClick={applyDraftFilters}>
                <CheckCircle2 className="size-4" />
                Aplicar
              </button>
          </div>
        </div>
      </ModalShell>

      <ModalShell
        open={Boolean(bridgeState)}
        title={bridgeState ? bridgeContent[bridgeState.key].title : 'Ponte legado'}
        description="Ação ainda vinculada ao fluxo legado real."
        onClose={() => setBridgeState(null)}
        panelStyle={{ width: 'min(92vw, 32rem)', maxWidth: '32rem', flexShrink: 0 }}
      >
        {bridgeState ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              {bridgeContent[bridgeState.key].body}
            </div>
            {bridgeState.product ? (
              <div className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-4">
                <div className="font-mono text-xs font-semibold text-slate-500">{bridgeState.product.codigo}</div>
                <div className="mt-1 text-base font-bold text-thermo-navy">{bridgeState.product.descricao}</div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <a className="thermo-button thermo-button-primary" href={bridgeContent[bridgeState.key].href} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                {bridgeContent[bridgeState.key].cta}
              </a>
              <button className="thermo-button thermo-button-secondary" type="button" onClick={() => setBridgeState(null)}>
                Fechar
              </button>
            </div>
          </div>
        ) : null}
      </ModalShell>

      <ModalShell
        open={Boolean(purchaseProduct)}
        title={purchaseProduct ? `Compras em andamento · ${purchaseProduct.codigo}` : 'Compras em andamento'}
        description="Detalhes reais retornados por /api/compras/produtos-em-compra/:codigo."
        onClose={() => {
          setPurchaseProduct(null)
          setPurchaseItems([])
          setPurchaseError(null)
          setPurchaseLoading(false)
        }}
        panelStyle={{ width: 'min(96vw, 52rem)', maxWidth: '52rem', flexShrink: 0 }}
      >
        {purchaseLoading ? <div className="rounded-xl border border-thermo-border bg-thermo-bg px-4 py-6 text-sm text-slate-500">Carregando detalhes reais da compra…</div> : null}
        {!purchaseLoading && purchaseError ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">{purchaseError}</div> : null}
        {!purchaseLoading && !purchaseError && purchaseItems.length === 0 ? <div className="rounded-xl border border-thermo-border bg-thermo-bg px-4 py-6 text-sm text-slate-500">Nenhuma compra em andamento para este produto.</div> : null}
        {!purchaseLoading && !purchaseError && purchaseItems.length > 0 ? (
          <div className="space-y-4">
            {purchaseItems.map((item) => (
              <article key={item.id} className="rounded-xl border border-thermo-border bg-thermo-bg px-4 py-4">
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusBadge tone="slate">{item.status || '—'}</StatusBadge>
                  <StatusBadge tone="green">{`Qtd: ${quantity(item.quantidade, purchaseProduct?.unidade)}`}</StatusBadge>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Solicitante</div><div className="mt-1 text-sm text-thermo-ink">{item.solicitante || '—'}</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Responsável compra</div><div className="mt-1 text-sm text-thermo-ink">{item.responsavel_pela_compra || '—'}</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Fornecedor</div><div className="mt-1 text-sm text-thermo-ink">{item.fornecedor_nome || '—'}</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Pedido Omie</div><div className="mt-1 text-sm text-thermo-ink">{item.c_numero || '—'}</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Nº pedido interno</div><div className="mt-1 text-sm text-thermo-ink">{item.numero_pedido || '—'}</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Departamento</div><div className="mt-1 text-sm text-thermo-ink">{item.departamento || '—'}</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Prazo solicitado</div><div className="mt-1 text-sm text-thermo-ink">{item.prazo_solicitado ? new Date(item.prazo_solicitado).toLocaleDateString('pt-BR') : '—'}</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Previsão chegada</div><div className="mt-1 text-sm text-thermo-ink">{item.previsao_chegada ? new Date(item.previsao_chegada).toLocaleDateString('pt-BR') : '—'}</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Criado em</div><div className="mt-1 text-sm text-thermo-ink">{item.created_at ? new Date(item.created_at).toLocaleDateString('pt-BR') : '—'}</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Grupo requisição</div><div className="mt-1 text-sm text-thermo-ink">{item.grupo_requisicao || '—'}</div></div>
                  {item.objetivo_compra ? <div className="md:col-span-2"><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Objetivo</div><div className="mt-1 text-sm text-thermo-ink">{item.objetivo_compra}</div></div> : null}
                  {item.observacao ? <div className="md:col-span-2"><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Observação</div><div className="mt-1 text-sm text-thermo-ink">{item.observacao}</div></div> : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </ModalShell>

      <ModalShell
        open={Boolean(actionProduct)}
        title={actionProduct ? `Ações · ${actionProduct.codigo}` : 'Ações do produto'}
        description="Fluxos já migrados ou pontes explícitas para rotinas legadas reais."
        onClose={() => setActionProduct(null)}
        panelStyle={{ width: 'min(96vw, 40rem)', maxWidth: '40rem', flexShrink: 0 }}
      >
        {actionProduct ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-thermo-border bg-thermo-bg px-4 py-4">
              <div className="font-mono text-xs font-semibold text-slate-500">{actionProduct.codigo}</div>
              <div className="mt-1 text-base font-bold text-thermo-navy">{actionProduct.descricao}</div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <a
                className={clsx('thermo-button justify-start', permissions.canOpenCart ? 'thermo-button-secondary' : 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400')}
                href={permissions.canOpenCart ? buildLegacyUrl('/menu_produto.html') : undefined}
                target={permissions.canOpenCart ? '_blank' : undefined}
                rel={permissions.canOpenCart ? 'noreferrer' : undefined}
                aria-disabled={!permissions.canOpenCart}
                onClick={(event) => {
                  if (!permissions.canOpenCart) event.preventDefault()
                }}
                title={permissions.cartReason || 'Abrir compra no legado'}
              >
                <PackagePlus className="size-4" />
                Compra
              </a>
              <a
                className={clsx('thermo-button justify-start', permissions.canOpenSeparation ? 'thermo-button-secondary' : 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400')}
                href={permissions.canOpenSeparation ? buildLegacyUrl('/menu_produto.html') : undefined}
                target={permissions.canOpenSeparation ? '_blank' : undefined}
                rel={permissions.canOpenSeparation ? 'noreferrer' : undefined}
                aria-disabled={!permissions.canOpenSeparation}
                onClick={(event) => {
                  if (!permissions.canOpenSeparation) event.preventDefault()
                }}
                title={permissions.separationReason || 'Abrir separação no legado'}
              >
                <ClipboardList className="size-4" />
                Separação
              </a>
              <a className="thermo-button thermo-button-secondary justify-start" href={buildLegacyUrl('/menu_produto.html')} target="_blank" rel="noreferrer"><ArrowLeftRight className="size-4" />Movimentação</a>
              <a className="thermo-button thermo-button-secondary justify-start" href={buildLegacyUrl('/menu_produto.html')} target="_blank" rel="noreferrer"><Truck className="size-4" />Expedição</a>
              <a
                className={clsx('thermo-button justify-start', permissions.canEditCatalog ? 'thermo-button-secondary' : 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400')}
                href={permissions.canEditCatalog ? buildLegacyUrl('/menu_produto.html#produto-dados') : undefined}
                target={permissions.canEditCatalog ? '_blank' : undefined}
                rel={permissions.canEditCatalog ? 'noreferrer' : undefined}
                aria-disabled={!permissions.canEditCatalog}
                onClick={(event) => {
                  if (!permissions.canEditCatalog) event.preventDefault()
                }}
                title={permissions.canEditCatalog ? 'Abrir dados do produto no legado' : 'Sua sessão não liberou edição de cadastro do produto.'}
              >
                <Info className="size-4" />
                Informações / editar produto
              </a>
              <a
                className={clsx('thermo-button justify-start', permissions.canEditCatalog ? 'thermo-button-secondary' : 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400')}
                href={permissions.canEditCatalog ? buildLegacyUrl('/menu_produto.html#produto-dados') : undefined}
                target={permissions.canEditCatalog ? '_blank' : undefined}
                rel={permissions.canEditCatalog ? 'noreferrer' : undefined}
                aria-disabled={!permissions.canEditCatalog}
                onClick={(event) => {
                  if (!permissions.canEditCatalog) event.preventDefault()
                }}
                title={permissions.canEditCatalog ? 'Abrir edição rápida no legado' : 'Sua sessão não liberou edição de cadastro do produto.'}
              >
                <Pencil className="size-4" />
                Editar rápido
              </a>
              <a className="thermo-button thermo-button-secondary justify-start" href={buildLegacyUrl('/menu_produto.html')} target="_blank" rel="noreferrer"><ShoppingCart className="size-4" />Últimas compras</a>
              <a className="thermo-button thermo-button-secondary justify-start" href={buildLegacyUrl('/menu_produto.html')} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />Manual de instrução</a>
            </div>
          </div>
        ) : null}
      </ModalShell>
    </>
  )
}
