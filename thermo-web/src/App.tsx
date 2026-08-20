import { clsx } from 'clsx'
import {
  ArrowLeftRight,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Filter,
  Grid2X2,
  List,
  MapPin,
  PackageSearch,
  QrCode,
  RefreshCw,
  Search,
  ShoppingCart,
  SquarePen,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { usePilotData } from './hooks/usePilotData'
import { defaultFilters } from './lib/products'
import { currency, quantity } from './lib/format'
import type { FiltersState, ProductFilterOption, ProductRecord } from './types'

const pageTitle = 'Lista de produtos'

const originLabels = {
  N: 'Nacional',
  I: 'Importado',
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
    Number(filters.estoqueNegativo) +
    Number(filters.expedicaoNegativa) +
    Number(filters.saldoEnderecoSemOmie) +
    Number(filters.saldoDivergenteEndereco)
  )
}

function describeAppliedFilters(filters: FiltersState) {
  const parts: string[] = []
  if (filters.families.length) parts.push(`${filters.families.length} família(s)`)
  if (filters.typeItems.length) parts.push(`${filters.typeItems.length} tipo(s)`)
  if (filters.origins.length) parts.push(`${filters.origins.length} origem(ns)`)
  if (filters.purchaseStatus.length) parts.push(`${filters.purchaseStatus.length} situação(ões) de compra`)
  if (filters.locationCodes.length) parts.push(`${filters.locationCodes.length} local(is)`)
  if (filters.showInactive) parts.push('inativos')
  if (filters.hideObsolete) parts.push('ocultando obsoletos')
  if (filters.hideEngineering) parts.push('ocultando engenharia')
  if (filters.semEstoqueMin) parts.push('sem estoque mínimo')
  if (filters.abaixoEstoqueMin) parts.push('abaixo do mínimo')
  if (filters.acimaEstoqueMin) parts.push('acima do mínimo')
  if (filters.proximoEstoqueMin) parts.push(`até ${filters.proximoPercent}% acima do mínimo`)
  if (filters.estoqueNegativo) parts.push('estoque negativo')
  if (filters.expedicaoNegativa) parts.push('expedição negativa')
  if (filters.saldoEnderecoSemOmie) parts.push('saldo em endereço sem Omie')
  if (filters.saldoDivergenteEndereco) parts.push('divergência Omie/endereço')
  return parts.length > 0 ? parts.join(' · ') : 'Nenhum filtro ativo'
}

const bridgeCopy: Record<string, { title: string; body: string }> = {
  qr: {
    title: 'QR Code continua como ponte',
    body: 'A leitura por câmera e bipador continua no fluxo legado. Neste piloto React a ação está preservada como entrada visual, sem abrir câmera nem alterar a busca real.',
  },
  bulk: {
    title: 'Editar em massa continua no legado',
    body: 'A operação em massa não foi migrada neste piloto. O botão permanece para validar posição, prioridade e affordance, sem executar alteração real.',
  },
  cart: {
    title: 'Compras continua como ponte',
    body: 'A contagem do carrinho vem da API real, mas a abertura do fluxo completo de compras continua dependente da tela legada existente.',
  },
  separation: {
    title: 'Separações continua como ponte',
    body: 'A navegação para tela de separação e kanban ainda não foi migrada. O piloto preserva o ponto de entrada sem prometer execução local.',
  },
  detail: {
    title: 'Detalhe do produto continua no legado',
    body: 'Na tela atual, abrir o produto leva ao detalhe legado. Neste piloto o botão existe para validar densidade, rotas futuras e clareza da ação.',
  },
  purchase: {
    title: 'Solicitação de compra continua como ponte',
    body: 'O produto e sua situação de compra estão reais, mas a conclusão da solicitação ainda depende da tela legada e das permissões já existentes no backend.',
  },
}

function statusTone(product: ProductRecord) {
  if (product.saldo_endereco_sem_omie || product.saldo_divergente_endereco) return 'red'
  if (product.expedicao_negativa || product.estoque_negativo) return 'red'
  if (product.abaixo_minimo) return 'amber'
  return 'green'
}

function statusLabel(product: ProductRecord) {
  if (product.saldo_endereco_sem_omie) return 'Saldo em endereço sem Omie'
  if (product.saldo_divergente_endereco) return 'Omie diferente dos endereços'
  if (product.expedicao_negativa) return 'Expedição negativa'
  if (product.estoque_negativo) return 'Estoque negativo'
  if (product.abaixo_minimo) return 'Abaixo do estoque mínimo'
  return 'Saldo estável'
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

export function ModalShell({
  open,
  title,
  onClose,
  children,
  description,
  panelClassName,
  panelStyle,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  description?: string
  panelClassName?: string
  panelStyle?: CSSProperties
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" role="presentation">
      <button type="button" className="absolute inset-0 bg-slate-950/45" aria-label={`Fechar ${title} pelo fundo`} onClick={onClose} />
      <section
        className={clsx('relative z-10 flex h-full max-w-[min(96vw,42rem)] flex-col bg-white shadow-2xl', panelClassName)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={description ? `${title}-description` : undefined}
        style={panelStyle}
        data-testid="modal-panel"
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
        className="min-h-32 w-full rounded-2xl border border-thermo-border bg-thermo-bg px-3 py-3 text-sm text-thermo-ink outline-none focus:border-thermo-navy"
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
  onBridge,
}: {
  product: ProductRecord
  onBridge: (key: keyof typeof bridgeCopy, product?: ProductRecord) => void
}) {
  const tone = statusTone(product)

  return (
    <article className="flex h-full flex-col rounded-2xl border border-thermo-border bg-white shadow-sm" data-testid="product-card">
      <div className="flex items-start gap-4 border-b border-thermo-border px-4 py-4">
        <img
          src={product.imageUrl || '/branding/thermo-simbolo.png'}
          alt={`Imagem do produto ${product.codigo}`}
          className="h-20 w-20 rounded-xl border border-thermo-border object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] font-semibold text-slate-500">{product.codigo}</div>
          <h3 className="mt-1 line-clamp-2 text-sm font-bold text-thermo-navy">{product.descricao}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge tone={tone}>{statusLabel(product)}</StatusBadge>
            <StatusBadge tone={product.purchaseState === 'em_compra' ? 'amber' : 'slate'}>
              {product.purchaseState === 'em_compra' ? product.compraStatus || 'Em compra' : 'Não comprado ainda'}
            </StatusBadge>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 text-sm">
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Família</dt>
          <dd className="mt-1 text-thermo-ink">{product.descricao_familia || 'Sem família'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Tipo item</dt>
          <dd className="mt-1 font-mono text-thermo-ink">{product.tipoCodigo || product.tipoitem || '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Origem</dt>
          <dd className="mt-1 text-thermo-ink">{product.origemCodigo ? originLabels[product.origemCodigo] : 'Não definida'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Estoque mínimo</dt>
          <dd className="mt-1 font-mono text-thermo-ink">{quantity(product.estoque_minimo, product.unidade)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Saldo #ALMOX</dt>
          <dd className="mt-1 font-mono text-thermo-ink">{quantity(product.saldo_almox, product.unidade)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Saldo expedição</dt>
          <dd className={clsx('mt-1 font-mono', product.expedicao_negativa ? 'text-thermo-red' : 'text-thermo-ink')}>{quantity(product.saldo_expedicao, product.unidade)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Valor unitário</dt>
          <dd className="mt-1 font-mono text-thermo-ink">{currency(product.valor_unitario)}</dd>
        </div>
      </dl>

      <div className="mt-auto border-t border-thermo-border px-4 py-4">
        <div className="mb-3 flex flex-wrap gap-2 text-xs text-slate-600">
          {product.locaisPositivos.length > 0 ? (
            product.locaisPositivos.slice(0, 3).map((location) => (
              <span key={`${product.codigo}-${location.codigo}`} className="inline-flex items-center gap-1 rounded-full border border-thermo-border px-2.5 py-1">
                <MapPin className="size-3.5" />
                {location.nome}
              </span>
            ))
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-thermo-border px-2.5 py-1 text-slate-500">Sem saldo positivo por local</span>
          )}
        </div>
        <div className="mb-3 flex flex-wrap gap-2 text-[11px] font-semibold">
          {product.isInactive ? <StatusBadge tone="red">Inativo</StatusBadge> : null}
          {product.isObsolete ? <StatusBadge tone="amber">Obsoleto</StatusBadge> : null}
          {product.isEngineering ? <StatusBadge tone="amber">Engenharia</StatusBadge> : null}
          {product.item_limitado ? <StatusBadge tone="slate">Item limitado</StatusBadge> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="thermo-button thermo-button-secondary" type="button" onClick={() => onBridge('detail', product)}>
            <ArrowLeftRight className="size-4" />
            Abrir detalhe
          </button>
          <button className="thermo-button thermo-button-primary" type="button" onClick={() => onBridge('purchase', product)}>
            <ShoppingCart className="size-4" />
            Solicitar compra
          </button>
        </div>
      </div>
    </article>
  )
}

function ProductTable({
  rows,
  onBridge,
}: {
  rows: ProductRecord[]
  onBridge: (key: keyof typeof bridgeCopy, product?: ProductRecord) => void
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-thermo-border bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-thermo-bg text-[11px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">Família</th>
              <th className="px-4 py-3">Tipo / Origem</th>
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
                  <div className="flex min-w-[19rem] items-start gap-3">
                    <img src={product.imageUrl || '/branding/thermo-simbolo.png'} alt="" className="hidden h-14 w-14 rounded-xl border border-thermo-border object-cover sm:block" />
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold text-slate-500">{product.codigo}</div>
                      <div className="mt-1 font-semibold text-thermo-navy">{product.descricao}</div>
                      <div className="mt-1 text-xs text-slate-500">Valor unit. {currency(product.valor_unitario)}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <StatusBadge tone={statusTone(product)}>{statusLabel(product)}</StatusBadge>
                        {product.isInactive ? <StatusBadge tone="red">Inativo</StatusBadge> : null}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 text-slate-700">{product.descricao_familia || 'Sem família'}</td>
                <td className="px-4 py-4">
                  <div className="font-mono text-sm font-semibold text-thermo-ink">{product.tipoCodigo || product.tipoitem || '—'}</div>
                  <div className="mt-1 text-xs text-slate-500">{product.origemCodigo ? originLabels[product.origemCodigo] : 'Origem não definida'}</div>
                </td>
                <td className="px-4 py-4">
                  <div className="font-mono text-sm font-semibold text-thermo-ink">{quantity(product.saldo_almox, product.unidade)}</div>
                  <div className="mt-1 text-xs text-slate-500">Mín. {quantity(product.estoque_minimo, product.unidade)}</div>
                  <div className={clsx('mt-1 text-xs', product.expedicao_negativa ? 'text-thermo-red' : 'text-slate-500')}>
                    Expedição {quantity(product.saldo_expedicao, product.unidade)}
                  </div>
                </td>
                <td className="px-4 py-4">
                  <StatusBadge tone={product.purchaseState === 'em_compra' ? 'amber' : 'slate'}>
                    {product.purchaseState === 'em_compra' ? product.compraStatus || 'Em compra' : 'Não comprado ainda'}
                  </StatusBadge>
                </td>
                <td className="px-4 py-4 text-xs text-slate-600">
                  {product.locaisPositivos.length > 0 ? product.locaisPositivos.map((location) => location.nome).join(' · ') : 'Sem saldo positivo'}
                </td>
                <td className="px-4 py-4">
                  <div className="flex justify-end gap-2">
                    <button className="thermo-button thermo-button-secondary" type="button" onClick={() => onBridge('detail', product)}>Detalhes</button>
                    <button className="thermo-button thermo-button-primary" type="button" onClick={() => onBridge('purchase', product)}>Compra</button>
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
          <div className="h-20 rounded-xl bg-slate-100" />
          <div className="mt-4 h-4 w-28 rounded bg-slate-100" />
          <div className="mt-2 h-4 rounded bg-slate-100" />
          <div className="mt-4 h-24 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ onReset, hasSearch, onBridge }: { onReset: () => void; hasSearch: boolean; onBridge: (key: keyof typeof bridgeCopy) => void }) {
  return (
    <div className="rounded-3xl border border-dashed border-thermo-border bg-white px-6 py-14 text-center shadow-sm">
      <PackageSearch className="mx-auto size-10 text-slate-400" />
      <h3 className="mt-4 text-lg font-bold text-thermo-navy">Nenhum produto atende aos filtros aplicados</h3>
      <p className="mt-2 text-sm text-slate-500">Ajuste a busca ou os critérios da central de filtros para refazer a lista.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button className="thermo-button thermo-button-secondary" type="button" onClick={onReset}>
          Limpar filtros
        </button>
        {hasSearch ? (
          <button className="thermo-button thermo-button-primary" type="button" onClick={() => onBridge('purchase')}>
            <ShoppingCart className="size-4" />
            Solicitar compra
          </button>
        ) : null}
      </div>
    </div>
  )
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="rounded-3xl border border-red-200 bg-red-50 px-6 py-14 text-center shadow-sm">
      <PackageSearch className="mx-auto size-10 text-red-400" />
      <h3 className="mt-4 text-lg font-bold text-red-700">Falha ao carregar a Lista de Produtos real</h3>
      <p className="mt-2 text-sm text-red-700">{error}</p>
      <p className="mt-2 text-sm text-red-700">Este modo não cai para fixtures automaticamente. Se você quiser demo local isolada, use explicitamente <code>npm run dev:demo</code>.</p>
      <button className="thermo-button thermo-button-secondary mx-auto mt-5" type="button" onClick={onRetry}>
        <RefreshCw className="size-4" />
        Tentar novamente
      </button>
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
  onChange: (value: number) => void
}) {
  if (pageCount <= 1) return null
  const start = (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)

  return (
    <nav className="mt-6 flex flex-wrap items-center justify-between gap-3" aria-label="Paginação">
      <div className="text-sm text-slate-500">
        {start}-{end} de {total} · Página {page}/{pageCount} · {pageSize} por página
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="thermo-button thermo-button-secondary" type="button" onClick={() => onChange(1)} disabled={page === 1}>Primeira</button>
        <button className="thermo-button thermo-button-secondary" type="button" onClick={() => onChange(page - 1)} disabled={page === 1}>Anterior</button>
        <button className="thermo-button thermo-button-secondary" type="button" onClick={() => onChange(page + 1)} disabled={page === pageCount}>Próxima</button>
        <button className="thermo-button thermo-button-secondary" type="button" onClick={() => onChange(pageCount)} disabled={page === pageCount}>Última</button>
      </div>
    </nav>
  )
}

function App() {
  const { filtered, paginated, loading, error, warnings, filters, setFilters, filtersMeta, page, setPage, pageCount, pageSize, viewMode, setViewMode, cartCount, streamEvents, dataMode, reload } = usePilotData()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [bridgeState, setBridgeState] = useState<{ key: keyof typeof bridgeCopy; product?: ProductRecord } | null>(null)

  const appliedFilterCount = useMemo(() => countAppliedFilters(filters), [filters])
  const appliedFilterSummary = useMemo(() => describeAppliedFilters(filters), [filters])
  const latestEvent = streamEvents[0]?.message || 'Aguardando eventos do fluxo legado.'

  const updateFilters = (patch: Partial<FiltersState>) => {
    setPage(1)
    setFilters((current) => ({ ...current, ...patch }))
  }
  const openBridge = (key: keyof typeof bridgeCopy, product?: ProductRecord) => setBridgeState({ key, product })

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFiltersOpen(false)
        setBridgeState(null)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [])

  return (
    <div className="min-h-screen bg-thermo-bg text-thermo-ink">
      <header className="border-b border-thermo-border bg-white">
        <div className="mx-auto flex max-w-[1540px] items-center justify-between gap-4 px-4 py-4 md:px-6 xl:px-8">
          <img src="/branding/thermo-logo-principal.png" alt="Thermo" className="h-8 w-auto md:h-9" />
          <img src="/branding/thermo-app-icon.png" alt="" className="hidden size-8 rounded-lg object-cover md:block" />
        </div>
      </header>

      <main className="mx-auto max-w-[1540px] px-4 py-5 md:px-6 xl:px-8">
        <section className="rounded-[28px] border border-thermo-border bg-white shadow-sm">
          <div className="border-b border-thermo-border px-4 py-4 md:px-6">
            <button className="inline-flex items-center gap-2 rounded-xl bg-thermo-navy px-4 py-2 text-sm font-semibold text-white" type="button">
              <Boxes className="size-4" />
              {pageTitle}
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">{filtered.length}</span>
            </button>
          </div>

          <div className="border-b border-thermo-border px-4 py-4 md:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-[18rem] flex-1 items-center gap-2 rounded-xl border border-thermo-border bg-thermo-bg px-3 py-2">
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

              <button className="thermo-icon-button" type="button" title="Ler QR Code" aria-label="Ler QR Code" onClick={() => openBridge('qr')}>
                <QrCode className="size-4" />
              </button>
              <button className="thermo-icon-button" type="button" title="Filtrar produtos" aria-label="Filtrar produtos" onClick={() => setFiltersOpen(true)}>
                <Filter className="size-4" />
              </button>
              <button className="thermo-icon-button" type="button" title="Atualizar produtos" aria-label="Atualizar produtos" onClick={() => void reload()}>
                <RefreshCw className={clsx('size-4', loading && 'animate-spin')} />
              </button>
              <button className="thermo-icon-button" type="button" title="Editar em massa" aria-label="Editar em massa" onClick={() => openBridge('bulk')}>
                <SquarePen className="size-4" />
              </button>
              <button className={clsx('thermo-icon-button', viewMode === 'grid' && 'thermo-icon-button-active')} type="button" title="Visualização em grade" aria-label="Visualização em grade" onClick={() => setViewMode('grid')}>
                <Grid2X2 className="size-4" />
              </button>
              <button className={clsx('thermo-icon-button', viewMode === 'list' && 'thermo-icon-button-active')} type="button" title="Visualização em lista" aria-label="Visualização em lista" onClick={() => setViewMode('list')}>
                <List className="size-4" />
              </button>
              <button className="thermo-button thermo-button-secondary" type="button" onClick={() => openBridge('cart')}>
                <ShoppingCart className="size-4" />
                Compras
                <span className="rounded-full bg-thermo-navy px-2 py-0.5 text-xs text-white">{cartCount}</span>
              </button>
              <button className="thermo-button thermo-button-secondary" type="button" onClick={() => openBridge('separation')}>
                <ClipboardList className="size-4" />
                Separações
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs text-white">Ponte</span>
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span className="rounded-full border border-thermo-border bg-thermo-bg px-3 py-1 font-semibold">
                {appliedFilterCount > 0 ? `${appliedFilterCount} filtro(s)` : 'Nenhum filtro ativo'}
              </span>
              <span className="text-slate-500">{appliedFilterSummary}</span>
              {appliedFilterCount > 0 ? (
                <button className="text-sm font-semibold text-thermo-navy" type="button" onClick={() => setFilters(defaultFilters)}>
                  Limpar tudo
                </button>
              ) : null}
            </div>
          </div>

          <div className="px-4 py-4 md:px-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 text-sm">
              <div className="font-semibold text-thermo-navy">{filtered.length} produto(s) visível(is) na lista</div>
              <div className="text-slate-500">
                {dataMode === 'proxy' ? 'Dados reais via proxy do legado' : 'Demo explícita'} · SSE: {latestEvent}
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
            {!loading && !error && filtered.length === 0 ? (
              <EmptyState onReset={() => setFilters(defaultFilters)} hasSearch={Boolean(filters.search.trim())} onBridge={openBridge} />
            ) : null}
            {!loading && !error && filtered.length > 0 ? (
              <>
                {viewMode === 'grid' ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {paginated.map((product) => (
                      <ProductCard key={product.codigo} product={product} onBridge={openBridge} />
                    ))}
                  </div>
                ) : (
                  <ProductTable rows={paginated} onBridge={openBridge} />
                )}
                <Pagination page={page} pageCount={pageCount} total={filtered.length} pageSize={pageSize} onChange={setPage} />
              </>
            ) : null}
          </div>
        </section>
      </main>

      <ModalShell open={filtersOpen} title="Central de filtros e relatórios" description="Relatórios rápidos e critérios do cadastro da lista atual de produtos." onClose={() => setFiltersOpen(false)}>
        <div className="space-y-6">
          <div className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Resumo ativo</div>
            <div className="mt-1 text-sm text-slate-600">{appliedFilterSummary}</div>
          </div>

          <section>
            <div className="mb-3 text-sm font-bold text-thermo-navy">Relatórios rápidos</div>
            <div className="space-y-3">
              <label className="flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={filters.semEstoqueMin} onChange={(event) => updateFilters({ semEstoqueMin: event.target.checked })} className="size-4 accent-thermo-navy" />Sem estoque mínimo</label>
              <label className="flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={filters.abaixoEstoqueMin} onChange={(event) => updateFilters({ abaixoEstoqueMin: event.target.checked })} className="size-4 accent-thermo-red" />Abaixo do estoque mínimo</label>
              <label className="flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={filters.acimaEstoqueMin} onChange={(event) => updateFilters({ acimaEstoqueMin: event.target.checked })} className="size-4 accent-emerald-600" />Acima do estoque mínimo</label>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={filters.proximoEstoqueMin} onChange={(event) => updateFilters({ proximoEstoqueMin: event.target.checked })} className="size-4 accent-amber-500" />Próximo do mínimo</label>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  até
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={filters.proximoPercent}
                    disabled={!filters.proximoEstoqueMin}
                    onChange={(event) => updateFilters({ proximoPercent: Math.min(100, Math.max(1, Number(event.target.value) || 10)) })}
                    className="w-20 rounded-xl border border-thermo-border px-2 py-1 disabled:bg-slate-100"
                  />
                  % acima do mínimo
                </label>
              </div>
              <label className="flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={filters.estoqueNegativo} onChange={(event) => updateFilters({ estoqueNegativo: event.target.checked })} className="size-4 accent-thermo-red" />Estoque negativo</label>
              <label className="flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-slate-700"><input type="checkbox" checked={filters.expedicaoNegativa} onChange={(event) => updateFilters({ expedicaoNegativa: event.target.checked })} className="mt-0.5 size-4 accent-orange-500" /><span><strong>Filtro da expedição</strong><br /><span className="text-xs text-orange-900">Somente produtos com saldo negativo em expedição.</span></span></label>
              <label className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-slate-700"><input type="checkbox" checked={filters.saldoDivergenteEndereco} onChange={(event) => updateFilters({ saldoDivergenteEndereco: event.target.checked })} className="mt-0.5 size-4 accent-thermo-red" /><span><strong>Omie diferente dos endereços</strong><br /><span className="text-xs text-red-700">Compara saldo do #ALMOX com os endereços vinculados.</span></span></label>
              <label className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-slate-700"><input type="checkbox" checked={filters.saldoEnderecoSemOmie} onChange={(event) => updateFilters({ saldoEnderecoSemOmie: event.target.checked })} className="mt-0.5 size-4 accent-thermo-red" /><span><strong>Saldo em endereço, mas zerado na Omie</strong><br /><span className="text-xs text-red-700">Localiza produtos que precisam de conferência entre o #ALMOX e seus endereços.</span></span></label>
            </div>
          </section>

          <section>
            <div className="mb-3 text-sm font-bold text-thermo-navy">Visibilidade do cadastro</div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex items-center gap-3 rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 text-sm text-slate-700"><input type="checkbox" checked={filters.showInactive} onChange={(event) => updateFilters({ showInactive: event.target.checked })} className="size-4 accent-thermo-navy" />Mostrar inativos</label>
              <label className="flex items-center gap-3 rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 text-sm text-slate-700"><input type="checkbox" checked={filters.hideObsolete} onChange={(event) => updateFilters({ hideObsolete: event.target.checked })} className="size-4 accent-thermo-navy" />Ocultar obsoletos</label>
              <label className="flex items-center gap-3 rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 text-sm text-slate-700"><input type="checkbox" checked={filters.hideEngineering} onChange={(event) => updateFilters({ hideEngineering: event.target.checked })} className="size-4 accent-thermo-navy" />Ocultar engenharia</label>
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <MultiSelectField label="Família" hint="Sem seleção exibe todas." value={filters.families} options={filtersMeta.families} onChange={(families) => updateFilters({ families })} />
            <MultiSelectField label="Tipo de item" hint="Sem seleção exibe todos." value={filters.typeItems} options={filtersMeta.typeItems} onChange={(typeItems) => updateFilters({ typeItems })} />

            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Origem do produto</label>
              <select
                multiple
                size={2}
                value={filters.origins}
                onChange={(event) => updateFilters({ origins: Array.from(event.target.selectedOptions, (option) => option.value as 'N' | 'I') })}
                className="min-h-24 w-full rounded-2xl border border-thermo-border bg-thermo-bg px-3 py-3 text-sm text-thermo-ink outline-none focus:border-thermo-navy"
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
                value={filters.purchaseStatus}
                onChange={(event) => updateFilters({ purchaseStatus: Array.from(event.target.selectedOptions, (option) => option.value as 'sem_compra' | 'em_compra') })}
                className="min-h-24 w-full rounded-2xl border border-thermo-border bg-thermo-bg px-3 py-3 text-sm text-thermo-ink outline-none focus:border-thermo-navy"
              >
                <option value="sem_compra">Não comprado ainda</option>
                <option value="em_compra">Em compra</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">Sem seleção exibe todas.</p>
            </div>

            <div className="lg:col-span-2">
              <MultiSelectField label="Com saldo positivo no estoque" hint="O produto aparece se tiver saldo positivo em qualquer local selecionado." value={filters.locationCodes} options={filtersMeta.locations} onChange={(locationCodes) => updateFilters({ locationCodes })} />
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-thermo-border pt-4">
            <div className="text-sm text-slate-500">
              <strong className="text-thermo-navy">O resultado aparece na própria lista de produtos.</strong> Você pode combinar relatórios e critérios.
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="thermo-button thermo-button-secondary" type="button" onClick={() => setFilters(defaultFilters)}>
                Limpar tudo
              </button>
              <button className="thermo-button thermo-button-primary" type="button" onClick={() => setFiltersOpen(false)}>
                <CheckCircle2 className="size-4" />
                Ver resultados
              </button>
            </div>
          </div>
        </div>
      </ModalShell>

      <ModalShell open={Boolean(bridgeState)} title={bridgeState ? bridgeCopy[bridgeState.key].title : 'Ponte'} description="Ação preservada como ponte explícita durante a migração da Lista de Produtos." onClose={() => setBridgeState(null)} panelStyle={{ width: 'min(92vw, 32rem)', maxWidth: '32rem', flexShrink: 0 }}>
        {bridgeState ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              {bridgeCopy[bridgeState.key].body}
            </div>
            {bridgeState.product ? (
              <div className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-4">
                <div className="font-mono text-xs font-semibold text-slate-500">{bridgeState.product.codigo}</div>
                <div className="mt-1 text-base font-bold text-thermo-navy">{bridgeState.product.descricao}</div>
                <div className="mt-2 text-sm text-slate-600">
                  Família {bridgeState.product.descricao_familia || 'Sem família'} · Compra {bridgeState.product.purchaseState === 'em_compra' ? bridgeState.product.compraStatus || 'Em compra' : 'Não comprado ainda'}
                </div>
              </div>
            ) : null}
            <button className="thermo-button thermo-button-primary" type="button" onClick={() => setBridgeState(null)}>
              Entendi
            </button>
          </div>
        ) : null}
      </ModalShell>
    </div>
  )
}

export default App
