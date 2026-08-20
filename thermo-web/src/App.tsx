import { clsx } from 'clsx'
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Filter,
  Layers3,
  LayoutGrid,
  List,
  Lock,
  MapPin,
  PackageSearch,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  ShoppingCart,
  Warehouse,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ThermoLogo } from './components/ThermoLogo'
import { usePilotData } from './hooks/usePilotData'
import { currency, quantity, relativeLabel } from './lib/format'
import { defaultFilters } from './lib/products'
import type { FiltersState, InventoryHealth, ProductRecord } from './types'

const navItems: Array<{ label: string; icon: LucideIcon; active: boolean }> = [
  { label: 'Lista de produtos', icon: Boxes, active: true },
  { label: 'Compras', icon: ShoppingCart, active: true },
  { label: 'Separações', icon: ClipboardList, active: false },
  { label: 'Estoque', icon: Warehouse, active: false },
]

const guaranteeCards: Array<{ icon: LucideIcon; title: string; body: string }> = [
  { icon: CheckCircle2, title: 'Sem merge, push ou PR', body: 'Toda a execução do piloto está restrita ao worktree local `codex/thermo-lista-produtos-piloto`.' },
  { icon: Lock, title: 'Permissões seguras', body: 'Botões sensíveis mostram a intenção, mas não assumem autorização backend nem concluem o fluxo por conta própria.' },
  { icon: ClipboardList, title: 'Ponte explícita com o legado', body: 'Cadastro, QR code e fluxos completos continuam sinalizados como ponte/demonstração nesta fase.' },
]

const healthLabels: Record<InventoryHealth, string> = {
  normal: 'Normal',
  'abaixo-minimo': 'Abaixo do mínimo',
  'estoque-negativo': 'Estoque negativo',
  'expedicao-negativa': 'Expedição negativa',
  divergente: 'Divergência Omie/endereço',
}

function StatusBadge({ tone, children }: { tone: 'navy' | 'green' | 'amber' | 'red' | 'slate'; children: string }) {
  const styles = {
    navy: 'bg-[rgba(11,29,52,0.08)] text-thermo-navy',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-thermo-red',
    slate: 'bg-slate-100 text-slate-700',
  }

  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold', styles[tone])}>{children}</span>
}

function ModalShell({
  open,
  title,
  onClose,
  children,
  description,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  description?: string
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-slate-950/45" role="presentation" onClick={onClose}>
      <section
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={description ? `${title}-description` : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-thermo-border px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-thermo-navy">{title}</h2>
            {description ? <p id={`${title}-description`} className="mt-1 text-sm text-slate-500">{description}</p> : null}
          </div>
          <button className="thermo-icon-button" type="button" onClick={onClose} aria-label={`Fechar ${title.toLowerCase()}`}>
            <X className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </section>
    </div>
  )
}

function ProductCard({
  product,
  canRequestPurchase,
  canEditCatalog,
  onRequestPurchase,
}: {
  product: ProductRecord
  canRequestPurchase: boolean
  canEditCatalog: boolean
  onRequestPurchase: (product: ProductRecord) => void
}) {
  const healthTone = product.health === 'normal' ? 'green' : product.health === 'divergente' ? 'amber' : 'red'

  return (
    <article className="flex h-full flex-col rounded-2xl border border-thermo-border bg-white p-4 shadow-sm" data-testid="product-card">
      <div className="flex gap-4">
        <img src={product.imageUrl ?? ''} alt={`Imagem demonstrativa do produto ${product.codigo}`} className="h-24 w-24 rounded-xl border border-thermo-border object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-xs font-semibold text-slate-500">{product.codigo}</div>
              <h3 className="mt-1 text-sm font-bold text-thermo-navy">{product.descricao}</h3>
              <p className="mt-1 text-xs text-slate-500">{product.descricao_familia ?? 'Sem família'} · {product.tipoitem ?? '—'}</p>
            </div>
            {product.compraStatus ? <StatusBadge tone="amber">Em compra</StatusBadge> : <StatusBadge tone="slate">Sem compra</StatusBadge>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusBadge tone={healthTone}>{healthLabels[product.health]}</StatusBadge>
            {product.item_limitado ? <StatusBadge tone="navy">Item limitado</StatusBadge> : null}
            {String(product.inativo ?? '').toUpperCase() === 'S' ? <StatusBadge tone="red">Inativo</StatusBadge> : null}
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-thermo-bg px-3 py-2">
          <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Saldo almox</dt>
          <dd className="mt-1 font-mono text-sm font-semibold text-thermo-navy">{quantity(product.saldo_almox, product.unidade)}</dd>
        </div>
        <div className="rounded-xl bg-thermo-bg px-3 py-2">
          <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Estoque mínimo</dt>
          <dd className="mt-1 font-mono text-sm font-semibold text-thermo-navy">{quantity(product.estoque_minimo, product.unidade)}</dd>
        </div>
        <div className="rounded-xl bg-thermo-bg px-3 py-2">
          <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Saldo expedição</dt>
          <dd className="mt-1 font-mono text-sm font-semibold text-thermo-navy">{quantity(product.saldo_expedicao, product.unidade)}</dd>
        </div>
        <div className="rounded-xl bg-thermo-bg px-3 py-2">
          <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Valor unitário</dt>
          <dd className="mt-1 font-mono text-sm font-semibold text-thermo-navy">{currency(product.valor_unitario)}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
        {product.locaisPositivos.slice(0, 2).map((location) => (
          <span key={location} className="inline-flex items-center gap-1 rounded-full border border-thermo-border px-2.5 py-1">
            <MapPin className="size-3.5" />
            {location}
          </span>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          className="thermo-button thermo-button-primary"
          type="button"
          disabled={!canRequestPurchase}
          title={canRequestPurchase ? 'Ação demonstrativa do piloto.' : 'Permissão depende do backend legado.'}
          onClick={() => onRequestPurchase(product)}
        >
          <ShoppingCart className="size-4" />
          Solicitar compra
        </button>
        <button className="thermo-button thermo-button-secondary" type="button" disabled={!canEditCatalog} title={canEditCatalog ? 'Abriria o cadastro migrado.' : 'Cadastro/edição continua no legado nesta fase.'}>
          <ArrowLeftRight className="size-4" />
          Abrir ponte legado
        </button>
      </div>
    </article>
  )
}

function ProductTable({
  rows,
  canRequestPurchase,
  onRequestPurchase,
}: {
  rows: ProductRecord[]
  canRequestPurchase: boolean
  onRequestPurchase: (product: ProductRecord) => void
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-thermo-border bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-thermo-bg text-[11px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">Família</th>
              <th className="px-4 py-3">Estoque</th>
              <th className="px-4 py-3">Compra</th>
              <th className="px-4 py-3">Locais</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((product) => (
              <tr key={product.codigo} className="border-t border-thermo-border align-top">
                <td className="px-4 py-4">
                  <div className="flex items-start gap-3">
                    <img src={product.imageUrl ?? ''} alt="" className="hidden h-14 w-14 rounded-xl border border-thermo-border object-cover sm:block" />
                    <div>
                      <div className="font-mono text-xs font-semibold text-slate-500">{product.codigo}</div>
                      <div className="mt-1 font-semibold text-thermo-navy">{product.descricao}</div>
                      <div className="mt-1 text-xs text-slate-500">{currency(product.valor_unitario)} · {product.unidade ?? 'UN'}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 text-slate-600">{product.descricao_familia ?? 'Sem família'}</td>
                <td className="px-4 py-4">
                  <div className="font-mono text-sm font-semibold text-thermo-navy">{quantity(product.saldo_almox, product.unidade)}</div>
                  <div className="mt-1 text-xs text-slate-500">Mín. {quantity(product.estoque_minimo, product.unidade)}</div>
                  <div className="mt-2">
                    <StatusBadge tone={product.health === 'normal' ? 'green' : 'red'}>{healthLabels[product.health]}</StatusBadge>
                  </div>
                </td>
                <td className="px-4 py-4">
                  {product.compraStatus ? <StatusBadge tone="amber">{product.compraStatus}</StatusBadge> : <StatusBadge tone="slate">Sem compra</StatusBadge>}
                </td>
                <td className="px-4 py-4 text-xs text-slate-500">{product.locaisPositivos.join(' · ') || 'Sem saldo positivo'}</td>
                <td className="px-4 py-4">
                  <div className="flex justify-end gap-2">
                    <button className="thermo-button thermo-button-secondary" type="button">Detalhes</button>
                    <button className="thermo-button thermo-button-primary" type="button" disabled={!canRequestPurchase} onClick={() => onRequestPurchase(product)}>Compra</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="animate-pulse rounded-2xl border border-thermo-border bg-white p-4 shadow-sm">
          <div className="h-24 rounded-xl bg-slate-100" />
          <div className="mt-4 h-4 w-20 rounded bg-slate-100" />
          <div className="mt-2 h-4 rounded bg-slate-100" />
          <div className="mt-2 h-4 w-3/4 rounded bg-slate-100" />
          <div className="mt-4 h-20 rounded-xl bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ clearFilters }: { clearFilters: () => void }) {
  return (
    <div className="rounded-3xl border border-dashed border-thermo-border bg-white px-6 py-14 text-center shadow-sm">
      <PackageSearch className="mx-auto size-10 text-slate-400" />
      <h3 className="mt-4 text-lg font-bold text-thermo-navy">Nenhum produto atende aos filtros aplicados</h3>
      <p className="mt-2 text-sm text-slate-500">Ajuste busca, status de compra, saúde de estoque ou locais com saldo positivo.</p>
      <button className="thermo-button thermo-button-secondary mx-auto mt-5" type="button" onClick={clearFilters}>
        Limpar filtros
      </button>
    </div>
  )
}

function ErrorState({ error, retryNote }: { error: string; retryNote: string }) {
  return (
    <div className="rounded-3xl border border-red-100 bg-red-50 px-6 py-14 text-center text-red-700 shadow-sm">
      <ShieldAlert className="mx-auto size-10" />
      <h3 className="mt-4 text-lg font-bold">Falha ao carregar o piloto</h3>
      <p className="mt-2 text-sm">{error}</p>
      <p className="mt-2 text-sm">{retryNote}</p>
    </div>
  )
}

function Pagination({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (value: number) => void }) {
  if (pageCount <= 1) return null

  return (
    <nav className="mt-6 flex flex-wrap items-center justify-between gap-3" aria-label="Paginação">
      <div className="text-sm text-slate-500">Página {page} de {pageCount}</div>
      <div className="flex gap-2">
        <button className="thermo-button thermo-button-secondary" type="button" onClick={() => onChange(page - 1)} disabled={page === 1}>Anterior</button>
        <button className="thermo-button thermo-button-secondary" type="button" onClick={() => onChange(page + 1)} disabled={page === pageCount}>Próxima</button>
      </div>
    </nav>
  )
}

function applyToggle<T extends string>(current: T[], value: T) {
  return current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]
}

function countAppliedFilters(filters: FiltersState) {
  return filters.family.length
    + filters.purchaseStatus.length
    + filters.health.length
    + filters.locations.length
    + Number(filters.limitedOnly)
    + Number(filters.inactiveVisible)
}

function describeAppliedFilters(filters: FiltersState) {
  const segments: string[] = []

  if (filters.family.length) segments.push(`${filters.family.length} família(s)`)
  if (filters.purchaseStatus.length) segments.push(`${filters.purchaseStatus.length} status de compra`)
  if (filters.health.length) segments.push(`${filters.health.length} saúde(s)`)
  if (filters.locations.length) segments.push(`${filters.locations.length} local(is)`)
  if (filters.limitedOnly) segments.push('somente limitados')
  if (filters.inactiveVisible) segments.push('inclui inativos')

  return segments.length > 0 ? segments.join(' · ') : 'Nenhum filtro adicional aplicado'
}

function App() {
  const { paginated, filtered, loading, error, filters, setFilters, page, setPage, pageCount, viewMode, setViewMode, cartCount, streamEvents, locationNames, familyNames, dataMode, user } = usePilotData()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [purchaseFeedback, setPurchaseFeedback] = useState<ProductRecord | null>(null)

  const totalCritical = useMemo(() => filtered.filter((product) => product.health !== 'normal').length, [filtered])
  const appliedFilterCount = useMemo(() => countAppliedFilters(filters), [filters])
  const appliedFilterSummary = useMemo(() => describeAppliedFilters(filters), [filters])

  const updateFilters = (patch: Partial<FiltersState>) => setFilters((current) => ({ ...current, ...patch }))
  const closeOverlays = () => {
    setMobileNavOpen(false)
    setMobileFiltersOpen(false)
    setPurchaseFeedback(null)
  }
  const handlePurchaseBridge = (product: ProductRecord) => {
    if (!user.permissions.canRequestPurchase) return

    setPurchaseFeedback(product)
  }

  useEffect(() => {
    if (!mobileNavOpen && !mobileFiltersOpen && !purchaseFeedback) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeOverlays()
    }

    window.addEventListener('keydown', handleEscape)

    return () => window.removeEventListener('keydown', handleEscape)
  }, [mobileFiltersOpen, mobileNavOpen, purchaseFeedback])

  useEffect(() => {
    const shouldLockScroll = mobileNavOpen || mobileFiltersOpen || Boolean(purchaseFeedback)

    if (!shouldLockScroll) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [mobileFiltersOpen, mobileNavOpen, purchaseFeedback])

  return (
    <div className="min-h-screen bg-thermo-bg text-thermo-ink">
      <div className="grid min-h-screen lg:grid-cols-[244px_minmax(0,1fr)]">
        <aside className="hidden bg-thermo-navy text-white lg:flex lg:flex-col">
          <div className="border-b border-white/10 px-5 py-5">
            <ThermoLogo />
          </div>
          <nav className="flex-1 px-3 py-5">
            <div className="px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Operação</div>
            {navItems.map(({ label, icon: Icon, active }) => (
              <button key={label} type="button" className={clsx('mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium', active ? 'bg-white/10 text-white' : 'text-slate-300')}>
                <Icon className="size-4" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="border-t border-white/10 px-5 py-4">
            <div className="text-xs font-semibold text-slate-200">{user.displayName}</div>
            <div className="mt-1 text-[11px] text-slate-400">{user.roleLabel}</div>
          </div>
        </aside>

        <main className="min-w-0">
          <header className="sticky top-0 z-20 border-b border-thermo-border bg-thermo-navy px-4 py-3 text-white shadow-sm md:px-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 lg:hidden">
                <button className="thermo-icon-button border-white/15 bg-white/8 text-white hover:border-white/25 hover:bg-white/12" type="button" onClick={() => setMobileNavOpen(true)} aria-label="Abrir navegação operacional" aria-expanded={mobileNavOpen} aria-controls="mobile-operational-nav">
                  <Layers3 className="size-4" />
                </button>
                <ThermoLogo compact />
              </div>
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/15 bg-white/6 px-3 py-2">
                <Search className="size-4 text-slate-300" />
                <input
                  value={filters.search}
                  onChange={(event) => updateFilters({ search: event.target.value })}
                  className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-400"
                  placeholder="Pesquisar código, descrição, família ou integração"
                  aria-label="Pesquisar produtos"
                />
              </label>
              <button
                className="thermo-button thermo-button-secondary border-white/15 bg-white/8 text-white hover:border-white/25 hover:bg-white/12 lg:hidden"
                type="button"
                onClick={() => setMobileFiltersOpen(true)}
                aria-label="Abrir filtros"
                aria-expanded={mobileFiltersOpen}
                aria-controls="mobile-product-filters"
              >
                <SlidersHorizontal className="size-4" />
                Filtros
              </button>
              <div className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/6 px-3 py-2 text-sm font-semibold">
                <ShoppingCart className="size-4 text-amber-300" />
                Carrinho {cartCount}
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-[1520px] px-4 py-5 md:px-6 xl:px-8">
            <section className="rounded-[28px] border border-thermo-border bg-white px-5 py-5 shadow-sm md:px-7 md:py-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-thermo-red">THM-PILOT-001</div>
                  <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-thermo-navy md:text-3xl">Lista de Produtos Thermo</h1>
                  <p className="mt-2 max-w-3xl text-sm text-slate-600">
                    Piloto local da migração para React, TypeScript, Tailwind e Vite. Mantém contratos do backend, não altera permissões do legado e explicita o que ainda continua como ponte operacional.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone={dataMode === 'demo' ? 'amber' : 'navy'}>
                    {dataMode === 'demo' ? 'Demo local sem credenciais' : 'Proxy do backend legado'}
                  </StatusBadge>
                  <StatusBadge tone="slate">Tema claro oficial</StatusBadge>
                </div>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-4">
                {[
                  { label: 'Produtos visíveis', value: String(filtered.length), icon: Boxes },
                  { label: 'Críticos / divergentes', value: String(totalCritical), icon: AlertTriangle },
                  { label: 'Itens em compra', value: String(filtered.filter((item) => item.compraStatus).length), icon: ShoppingCart },
                  { label: 'Canal SSE', value: streamEvents[0]?.message ?? 'Aguardando evento', icon: RefreshCw },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-4">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                      <Icon className="size-4" />
                      {label}
                    </div>
                    <div className="mt-3 text-lg font-extrabold text-thermo-navy">{value}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-5 rounded-[28px] border border-thermo-border bg-white px-5 py-5 shadow-sm md:px-7 md:py-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-thermo-navy">Filtros combináveis</h2>
                  <p className="mt-1 text-sm text-slate-500">Família, situação de compra, saúde do estoque, locais com saldo positivo e visibilidade de inativos.</p>
                </div>
                <div className="flex gap-2">
                  <button className={clsx('thermo-icon-button', viewMode === 'grid' && 'thermo-icon-button-active')} type="button" aria-label="Visualização em grade" onClick={() => setViewMode('grid')}>
                    <LayoutGrid className="size-4" />
                  </button>
                  <button className={clsx('thermo-icon-button', viewMode === 'list' && 'thermo-icon-button-active')} type="button" aria-label="Visualização em lista" onClick={() => setViewMode('list')}>
                    <List className="size-4" />
                  </button>
                  <button className="thermo-button thermo-button-secondary" type="button" onClick={() => setFilters(defaultFilters)}>
                    <Filter className="size-4" />
                    Limpar
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 xl:hidden">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Resumo aplicado</div>
                    <div className="mt-1 text-sm text-slate-600">{appliedFilterSummary}</div>
                  </div>
                  <button className="thermo-button thermo-button-secondary" type="button" onClick={() => setMobileFiltersOpen(true)} aria-label="Abrir painel de filtros">
                    <SlidersHorizontal className="size-4" />
                    {appliedFilterCount > 0 ? `Filtros (${appliedFilterCount})` : 'Abrir filtros'}
                  </button>
                </div>
              </div>

              <div className="mt-5 hidden gap-5 xl:grid xl:grid-cols-[1.4fr_1fr]">
                <div className="space-y-4">
                  <div>
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Famílias</div>
                    <div className="flex flex-wrap gap-2">
                      {familyNames.map((family) => (
                        <button key={family} className={clsx('thermo-chip', filters.family.includes(family) && 'thermo-chip-active')} type="button" onClick={() => updateFilters({ family: applyToggle(filters.family, family) })}>
                          {family}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Situação de compra</div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        ['sem_compra', 'Sem compra'],
                        ['em_compra', 'Em compra'],
                      ].map(([value, label]) => (
                        <button key={value} className={clsx('thermo-chip', filters.purchaseStatus.includes(value as 'sem_compra' | 'em_compra') && 'thermo-chip-active')} type="button" onClick={() => updateFilters({ purchaseStatus: applyToggle(filters.purchaseStatus, value as 'sem_compra' | 'em_compra') })}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Saúde do estoque</div>
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(healthLabels) as InventoryHealth[]).map((health) => (
                        <button key={health} className={clsx('thermo-chip', filters.health.includes(health) && 'thermo-chip-active')} type="button" onClick={() => updateFilters({ health: applyToggle(filters.health, health) })}>
                          {healthLabels[health]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Locais com saldo positivo</div>
                    <div className="flex flex-wrap gap-2">
                      {locationNames.map((location) => (
                        <button key={location} className={clsx('thermo-chip', filters.locations.includes(location) && 'thermo-chip-active')} type="button" onClick={() => updateFilters({ locations: applyToggle(filters.locations, location) })}>
                          <MapPin className="size-3.5" />
                          {location}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-start gap-3 rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 text-sm text-slate-600">
                    <input type="checkbox" checked={filters.limitedOnly} onChange={(event) => updateFilters({ limitedOnly: event.target.checked })} className="mt-0.5 size-4 accent-thermo-navy" />
                    Mostrar somente itens limitados
                  </label>
                  <label className="flex items-start gap-3 rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 text-sm text-slate-600">
                    <input type="checkbox" checked={filters.inactiveVisible} onChange={(event) => updateFilters({ inactiveVisible: event.target.checked })} className="mt-0.5 size-4 accent-thermo-navy" />
                    Incluir produtos inativos no piloto
                  </label>
                </div>
              </div>
            </section>

            <section className="mt-5">
              {loading ? <LoadingState /> : null}
              {!loading && error ? (
                <ErrorState error={error} retryNote={dataMode === 'proxy' ? 'Confira se o backend legado está ativo e autenticado.' : 'No modo demo isso indica problema local da aplicação.'} />
              ) : null}
              {!loading && !error && filtered.length === 0 ? <EmptyState clearFilters={() => setFilters(defaultFilters)} /> : null}
              {!loading && !error && filtered.length > 0 ? (
                <>
                  {viewMode === 'grid' ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      {paginated.map((product) => (
                        <ProductCard key={product.codigo} product={product} canRequestPurchase={user.permissions.canRequestPurchase} canEditCatalog={user.permissions.canEditCatalog} onRequestPurchase={handlePurchaseBridge} />
                      ))}
                    </div>
                  ) : (
                    <ProductTable rows={paginated} canRequestPurchase={user.permissions.canRequestPurchase} onRequestPurchase={handlePurchaseBridge} />
                  )}
                  <Pagination page={page} pageCount={pageCount} onChange={setPage} />
                </>
              ) : null}
            </section>

            <section className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_1fr]">
              <div className="rounded-[28px] border border-thermo-border bg-white px-5 py-5 shadow-sm md:px-7 md:py-6">
                <div className="flex items-center gap-2 text-lg font-bold text-thermo-navy">
                  <Layers3 className="size-5" />
                  Garantias do piloto
                </div>
                <div className="mt-4 grid gap-3">
                  {guaranteeCards.map(({ icon: Icon, title, body }) => (
                    <div key={title} className="flex gap-3 rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-4">
                      <Icon className="mt-0.5 size-5 text-thermo-red" />
                      <div>
                        <div className="font-semibold text-thermo-navy">{title}</div>
                        <p className="mt-1 text-sm text-slate-600">{body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[28px] border border-thermo-border bg-white px-5 py-5 shadow-sm md:px-7 md:py-6">
                <div className="flex items-center gap-2 text-lg font-bold text-thermo-navy">
                  <RefreshCw className="size-5" />
                  Eventos recentes
                </div>
                <div className="mt-4 space-y-3">
                  {streamEvents.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-thermo-border bg-thermo-bg px-4 py-6 text-sm text-slate-500">Aguardando eventos do stream de produtos.</div>
                  ) : (
                    streamEvents.map((event, index) => (
                      <div key={`${event.type}-${index}`} className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3">
                        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{event.type}</div>
                        <div className="mt-1 text-sm text-thermo-navy">{event.message ?? 'Evento recebido'}</div>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-5 rounded-2xl border border-thermo-border bg-white px-4 py-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-thermo-navy">
                    <ShoppingCart className="size-4" />
                    Carrinho demonstrativo
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    O piloto exibe badges, dependências de compra e datas no padrão atual, mas a conclusão do processo ainda depende da tela legada de compras.
                  </p>
                  <div className="mt-3 text-xs text-slate-500">Última referência visual: {relativeLabel('2026-08-20')}</div>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
      <ModalShell open={mobileNavOpen} title="Navegação operacional" description="Substituto acessível para o menu lateral nas larguras mobile e tablet." onClose={() => setMobileNavOpen(false)}>
        <nav id="mobile-operational-nav" className="space-y-2" aria-label="Navegação operacional mobile">
          {navItems.map(({ label, icon: Icon, active }) => (
            <button key={label} type="button" className={clsx('flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-semibold', active ? 'border-thermo-navy bg-thermo-navy text-white' : 'border-thermo-border bg-thermo-bg text-thermo-navy')}>
              <Icon className="size-4" />
              <span>{label}</span>
              {active ? <span className="ml-auto text-[11px] font-bold uppercase tracking-[0.14em] text-white/75">Disponível</span> : <span className="ml-auto text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Ponte</span>}
            </button>
          ))}
        </nav>
        <div className="mt-5 rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-4">
          <div className="text-sm font-semibold text-thermo-navy">{user.displayName}</div>
          <div className="mt-1 text-xs text-slate-500">{user.roleLabel}</div>
        </div>
      </ModalShell>

      <ModalShell open={mobileFiltersOpen} title="Filtros de produtos" description="Ajuste filtros no mobile/tablet mantendo o resumo do estado aplicado." onClose={() => setMobileFiltersOpen(false)}>
        <div id="mobile-product-filters" className="space-y-5">
          <div className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Resumo aplicado</div>
            <div className="mt-1 text-sm text-slate-600">{appliedFilterSummary}</div>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Famílias</div>
            <div className="flex flex-wrap gap-2">
              {familyNames.map((family) => (
                <button key={family} className={clsx('thermo-chip', filters.family.includes(family) && 'thermo-chip-active')} type="button" onClick={() => updateFilters({ family: applyToggle(filters.family, family) })}>
                  {family}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Situação de compra</div>
            <div className="flex flex-wrap gap-2">
              {[
                ['sem_compra', 'Sem compra'],
                ['em_compra', 'Em compra'],
              ].map(([value, label]) => (
                <button key={value} className={clsx('thermo-chip', filters.purchaseStatus.includes(value as 'sem_compra' | 'em_compra') && 'thermo-chip-active')} type="button" onClick={() => updateFilters({ purchaseStatus: applyToggle(filters.purchaseStatus, value as 'sem_compra' | 'em_compra') })}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Saúde do estoque</div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(healthLabels) as InventoryHealth[]).map((health) => (
                <button key={health} className={clsx('thermo-chip', filters.health.includes(health) && 'thermo-chip-active')} type="button" onClick={() => updateFilters({ health: applyToggle(filters.health, health) })}>
                  {healthLabels[health]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Locais com saldo positivo</div>
            <div className="flex flex-wrap gap-2">
              {locationNames.map((location) => (
                <button key={location} className={clsx('thermo-chip', filters.locations.includes(location) && 'thermo-chip-active')} type="button" onClick={() => updateFilters({ locations: applyToggle(filters.locations, location) })}>
                  <MapPin className="size-3.5" />
                  {location}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 text-sm text-slate-600">
            <input type="checkbox" checked={filters.limitedOnly} onChange={(event) => updateFilters({ limitedOnly: event.target.checked })} className="mt-0.5 size-4 accent-thermo-navy" />
            Mostrar somente itens limitados
          </label>
          <label className="flex items-start gap-3 rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 text-sm text-slate-600">
            <input type="checkbox" checked={filters.inactiveVisible} onChange={(event) => updateFilters({ inactiveVisible: event.target.checked })} className="mt-0.5 size-4 accent-thermo-navy" />
            Incluir produtos inativos no piloto
          </label>

          <div className="flex flex-wrap gap-2 border-t border-thermo-border pt-4">
            <button className="thermo-button thermo-button-secondary" type="button" onClick={() => setFilters(defaultFilters)}>
              <Filter className="size-4" />
              Limpar filtros
            </button>
            <button className="thermo-button thermo-button-primary" type="button" onClick={() => setMobileFiltersOpen(false)}>
              Aplicar e voltar
            </button>
          </div>
        </div>
      </ModalShell>

      <ModalShell
        open={Boolean(purchaseFeedback)}
        title="Solicitação de compra em modo demonstração"
        description="A CTA foi preservada como ponte visual do piloto, sem disparar fluxo real."
        onClose={() => setPurchaseFeedback(null)}
      >
        {purchaseFeedback ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              Nenhuma compra foi criada. Este botão existe apenas para validar posicionamento, texto, estado e feedback da ação durante a migração.
            </div>
            <div className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-4">
              <div className="font-mono text-xs font-semibold text-slate-500">{purchaseFeedback.codigo}</div>
              <div className="mt-1 text-base font-bold text-thermo-navy">{purchaseFeedback.descricao}</div>
              <div className="mt-2 text-sm text-slate-600">Para concluir a operação real, a equipe ainda precisa seguir pela tela legada de compras com autorização backend existente.</div>
            </div>
            <button className="thermo-button thermo-button-primary" type="button" onClick={() => setPurchaseFeedback(null)}>
              Entendi, continuar no piloto
            </button>
          </div>
        ) : null}
      </ModalShell>
    </div>
  )
}

export default App
