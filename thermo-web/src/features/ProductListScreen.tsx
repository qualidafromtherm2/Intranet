import { clsx } from 'clsx'
import {
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Filter,
  Grid2X2,
  List,
  PackageSearch,
  QrCode,
  RefreshCw,
  Search,
  ShoppingCart,
  SquarePen,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ModalShell } from '../components/ModalShell'
import { usePilotData } from '../hooks/usePilotData'
import { defaultFilters } from '../lib/products'
import { currency, quantity } from '../lib/format'
import { buildLegacyUrl } from '../services/authGateway'
import type { FiltersState, ProductFilterOption, ProductRecord } from '../types'

const originLabels = {
  N: 'Nacional',
  I: 'Importado',
}

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

function ProductCard({ product, onBridge }: { product: ProductRecord; onBridge: (key: BridgeKey, product?: ProductRecord) => void }) {
  const tone = statusTone(product)
  const localSummary = product.locaisPositivos.length > 0 ? product.locaisPositivos.map((item) => item.nome).join(' · ') : 'Sem local positivo'

  return (
    <article className="flex h-full flex-col rounded-xl border border-thermo-border bg-white shadow-sm" data-testid="product-card">
      <div className="flex items-start gap-3 border-b border-thermo-border px-3 py-3">
        <img
          src={product.imageUrl || '/branding/thermo-simbolo.png'}
          alt={`Imagem do produto ${product.codigo}`}
          className="h-14 w-14 rounded-lg border border-thermo-border object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] font-semibold text-slate-500">{product.codigo}</div>
          <h3 className="mt-0.5 line-clamp-2 text-[13px] leading-4 font-bold text-thermo-navy">{product.descricao}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <StatusBadge tone={tone}>{statusLabel(product)}</StatusBadge>
            <StatusBadge tone={product.purchaseState === 'em_compra' ? 'amber' : 'slate'}>
              {product.purchaseState === 'em_compra' ? product.compraStatus || 'Em compra' : 'Não comprado ainda'}
            </StatusBadge>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 px-3 py-3 text-xs">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Família</dt>
          <dd className="mt-0.5 line-clamp-2 text-thermo-ink">{product.descricao_familia || 'Sem família'}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Tipo item</dt>
          <dd className="mt-0.5 font-mono text-thermo-ink">{product.tipoCodigo || product.tipoitem || '—'}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Origem</dt>
          <dd className="mt-0.5 text-thermo-ink">{product.origemCodigo ? originLabels[product.origemCodigo] : 'Não definida'}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Estoque mínimo</dt>
          <dd className="mt-0.5 font-mono text-thermo-ink">{quantity(product.estoque_minimo, product.unidade)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">#ALMOX total</dt>
          <dd className="mt-0.5 font-mono text-thermo-ink">{quantity(product.saldo_almox, product.unidade)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Expedição</dt>
          <dd className="mt-0.5 font-mono text-thermo-ink">{quantity(product.saldo_expedicao, product.unidade)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Endereçado</dt>
          <dd className="mt-0.5 font-mono text-thermo-ink">{quantity(product.saldo_enderecado, product.unidade)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Valor unitário</dt>
          <dd className="mt-0.5 font-mono text-thermo-ink">{currency(product.valor_unitario)}</dd>
        </div>
      </dl>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-thermo-border px-3 py-3">
        <div className="min-w-0 text-[11px] text-slate-500">
          <span className="font-semibold text-slate-600">Locais:</span> <span className="line-clamp-2">{localSummary}</span>
        </div>
        <button className="thermo-button thermo-button-secondary shrink-0 px-3 py-2 text-xs" type="button" onClick={() => onBridge('detail', product)}>
          <ExternalLink className="size-4" />
          Abrir legado
        </button>
      </div>
    </article>
  )
}

function ProductTable({ rows, onBridge }: { rows: ProductRecord[]; onBridge: (key: BridgeKey, product?: ProductRecord) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-thermo-border">
      <table className="min-w-full border-collapse text-sm">
        <thead className="bg-thermo-bg text-left text-[10px] uppercase tracking-[0.14em] text-slate-500">
          <tr>
            <th className="px-3 py-2.5">Código</th>
            <th className="px-3 py-2.5">Descrição</th>
            <th className="px-3 py-2.5">Família</th>
            <th className="px-3 py-2.5">Tipo</th>
            <th className="px-3 py-2.5">Compra</th>
            <th className="px-3 py-2.5">#ALMOX</th>
            <th className="px-3 py-2.5">Locais</th>
            <th className="px-3 py-2.5">Mínimo</th>
            <th className="px-3 py-2.5">Ação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((product) => (
            <tr key={product.codigo} className="border-t border-thermo-border align-top">
              <td className="px-3 py-2.5 font-mono text-xs font-semibold text-slate-600">{product.codigo}</td>
              <td className="px-3 py-2.5">
                <div className="font-semibold text-thermo-navy">{product.descricao}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <StatusBadge tone={statusTone(product)}>{statusLabel(product)}</StatusBadge>
                  <StatusBadge tone={product.purchaseState === 'em_compra' ? 'amber' : 'slate'}>
                    {product.purchaseState === 'em_compra' ? product.compraStatus || 'Em compra' : 'Não comprado ainda'}
                  </StatusBadge>
                </div>
              </td>
              <td className="px-3 py-2.5 text-slate-600">{product.descricao_familia || 'Sem família'}</td>
              <td className="px-3 py-2.5 font-mono text-slate-600">{product.tipoCodigo || product.tipoitem || '—'}</td>
              <td className="px-3 py-2.5 text-slate-600">{product.purchaseState === 'em_compra' ? product.compraStatus || 'Em compra' : 'Não comprado ainda'}</td>
              <td className="px-3 py-2.5 font-mono text-slate-600">{quantity(product.saldo_almox, product.unidade)}</td>
              <td className="px-3 py-2.5 text-xs text-slate-500">{product.locaisPositivos.length > 0 ? product.locaisPositivos.map((location) => location.nome).join(' · ') : '—'}</td>
              <td className="px-3 py-2.5 font-mono text-slate-600">{quantity(product.estoque_minimo, product.unidade)}</td>
              <td className="px-3 py-2.5">
                <button className="thermo-button thermo-button-secondary whitespace-nowrap px-3 py-2 text-xs" type="button" onClick={() => onBridge('detail', product)}>
                  <ExternalLink className="size-4" />
                  Abrir legado
                </button>
              </td>
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
  canOpenCart,
  canOpenSeparation,
}: {
  canOpenCart: boolean
  canOpenSeparation: boolean
}) {
  const { filtered, paginated, loading, error, warnings, filters, setFilters, filtersMeta, page, setPage, pageCount, pageSize, viewMode, setViewMode, cartCount, streamEvents, dataMode, reload } = usePilotData()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [bridgeState, setBridgeState] = useState<{ key: BridgeKey; product?: ProductRecord } | null>(null)

  const appliedFilterCount = useMemo(() => countAppliedFilters(filters), [filters])
  const appliedFilterSummary = useMemo(() => describeAppliedFilters(filters), [filters])
  const latestEvent = streamEvents[0]?.message || (streamEvents[0]?.type === 'error' ? 'canal indisponível' : 'aguardando')

  const updateFilters = (next: Partial<FiltersState>) => {
    setPage(1)
    setFilters((current) => ({ ...current, ...next }))
  }

  const openBridge = (key: BridgeKey, product?: ProductRecord) => setBridgeState({ key, product })

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
    <>
      <section className="rounded-[28px] border border-thermo-border bg-white shadow-sm">
        <div className="border-b border-thermo-border px-4 py-4 md:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-xl bg-thermo-navy px-4 py-2 text-sm font-semibold text-white">
              Lista de produtos
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">{filtered.length}</span>
            </span>
          </div>
        </div>

        <div className="border-b border-thermo-border px-4 py-4 md:px-6">
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex min-w-[18rem] flex-1 items-center gap-2 rounded-xl border border-thermo-border bg-thermo-bg px-3 py-2.5">
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

            <button className="thermo-toolbar-button" type="button" title="Ler QR Code" aria-label="Ler QR Code" onClick={() => openBridge('qr')}>
              <QrCode className="size-4" />
              <span>QR</span>
            </button>
            <button className="thermo-toolbar-button" type="button" title="Filtrar produtos" aria-label="Filtrar produtos" onClick={() => setFiltersOpen(true)}>
              <Filter className="size-4" />
              <span>Filtrar</span>
            </button>
            <button className="thermo-toolbar-button" type="button" title="Atualizar produtos" aria-label="Atualizar produtos" onClick={() => void reload()}>
              <RefreshCw className={clsx('size-4', loading && 'animate-spin')} />
              <span>Atualizar</span>
            </button>
            <button className="thermo-toolbar-button" type="button" title="Editar em massa" aria-label="Editar em massa" onClick={() => openBridge('bulk')}>
              <SquarePen className="size-4" />
              <span>Em massa</span>
            </button>
            <button className={clsx('thermo-toolbar-button', viewMode === 'grid' && 'thermo-icon-button-active')} type="button" title="Visualização em cartões" aria-label="Visualização em cartões" onClick={() => setViewMode('grid')}>
              <Grid2X2 className="size-4" />
              <span>Cartões</span>
            </button>
            <button className={clsx('thermo-toolbar-button', viewMode === 'list' && 'thermo-icon-button-active')} type="button" title="Visualização em lista" aria-label="Visualização em lista" onClick={() => setViewMode('list')}>
              <List className="size-4" />
              <span>Lista</span>
            </button>
            {canOpenCart ? (
              <button className="thermo-toolbar-button" type="button" onClick={() => openBridge('cart')}>
                <ShoppingCart className="size-4" />
                Compras
                <span className="rounded-full bg-thermo-navy px-2 py-0.5 text-xs text-white">{cartCount}</span>
              </button>
            ) : null}
            {canOpenSeparation ? (
              <button className="thermo-toolbar-button" type="button" onClick={() => openBridge('separation')}>
                <ClipboardList className="size-4" />
                Separações
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs text-white">Legado</span>
              </button>
            ) : null}
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
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-thermo-border bg-thermo-bg px-4 py-3 text-sm">
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
          {!loading && !error && filtered.length === 0 ? <EmptyState onReset={() => setFilters(defaultFilters)} hasSearch={Boolean(filters.search.trim())} onBridge={openBridge} /> : null}
          {!loading && !error && filtered.length > 0 ? (
            <>
              {viewMode === 'grid' ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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

      <ModalShell open={filtersOpen} title="Central de filtros" description="Critérios equivalentes à tela atual da Lista de Produtos." onClose={() => setFiltersOpen(false)}>
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
              <label className="flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-slate-700"><input type="checkbox" checked={filters.expedicaoNegativa} onChange={(event) => updateFilters({ expedicaoNegativa: event.target.checked })} className="mt-0.5 size-4 accent-orange-500" /><span><strong>Expedição negativa</strong><br /><span className="text-xs text-orange-900">Somente produtos com saldo negativo em expedição.</span></span></label>
              <label className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-slate-700"><input type="checkbox" checked={filters.saldoDivergenteEndereco} onChange={(event) => updateFilters({ saldoDivergenteEndereco: event.target.checked })} className="mt-0.5 size-4 accent-thermo-red" /><span><strong>Omie diferente dos endereços</strong><br /><span className="text-xs text-red-700">Compara saldo do #ALMOX com os endereços vinculados.</span></span></label>
              <label className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-slate-700"><input type="checkbox" checked={filters.saldoEnderecoSemOmie} onChange={(event) => updateFilters({ saldoEnderecoSemOmie: event.target.checked })} className="mt-0.5 size-4 accent-thermo-red" /><span><strong>Saldo em endereço sem Omie</strong><br /><span className="text-xs text-red-700">Localiza produtos que precisam de conferência entre o #ALMOX e seus endereços.</span></span></label>
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
              <MultiSelectField label="Local" hint="O produto aparece se tiver saldo positivo em qualquer local selecionado." value={filters.locationCodes} options={filtersMeta.locations} onChange={(locationCodes) => updateFilters({ locationCodes })} />
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-thermo-border pt-4">
            <div className="text-sm text-slate-500">
              <strong className="text-thermo-navy">O resultado aparece na própria lista.</strong> Você pode combinar relatórios e critérios.
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
    </>
  )
}
