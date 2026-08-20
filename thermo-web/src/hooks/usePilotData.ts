import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildFilterMeta, defaultFilters, filterProducts, mergePilotData, paginateProducts } from '../lib/products'
import { getPilotMode, loadCart, loadLocations, loadProducts, loadPurchases, subscribeProductsStream } from '../services/pilotGateway'
import type { FiltersState, ProductFiltersMeta, ProductRecord, ProductStreamEvent, ViewMode } from '../types'

const pageSize = 50
const cacheTtlMs = 5 * 60 * 1000

type PilotCacheState = {
  products: ProductRecord[]
  filtersMeta: ProductFiltersMeta
  warnings: string[]
  cartCount: number
  fetchedAt: number | null
  filters: FiltersState
  page: number
  viewMode: ViewMode
}

const initialCacheState = (): PilotCacheState => ({
  products: [],
  filtersMeta: { families: [], typeItems: [], locations: [] },
  warnings: [],
  cartCount: 0,
  fetchedAt: null,
  filters: { ...defaultFilters },
  page: 1,
  viewMode: 'grid',
})

let pilotCache = initialCacheState()

const hasUsableCache = () => pilotCache.products.length > 0
const cacheExpired = () => !pilotCache.fetchedAt || Date.now() - pilotCache.fetchedAt > cacheTtlMs

const saveCache = (next: Partial<PilotCacheState>) => {
  pilotCache = {
    ...pilotCache,
    ...next,
    filters: next.filters ? { ...next.filters } : pilotCache.filters,
  }
}

export function usePilotData() {
  const [products, setProducts] = useState<ProductRecord[]>(() => pilotCache.products)
  const [filtersMeta, setFiltersMeta] = useState<ProductFiltersMeta>(() => pilotCache.filtersMeta)
  const [loading, setLoading] = useState(() => !hasUsableCache())
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>(() => pilotCache.warnings)
  const [filters, setFiltersState] = useState<FiltersState>(() => ({ ...pilotCache.filters }))
  const [page, setPageState] = useState(() => pilotCache.page)
  const [viewMode, setViewModeState] = useState<ViewMode>(() => pilotCache.viewMode)
  const [cartCount, setCartCount] = useState(() => pilotCache.cartCount)
  const [streamEvents, setStreamEvents] = useState<ProductStreamEvent[]>([])

  const setFilters = useCallback((value: FiltersState | ((current: FiltersState) => FiltersState)) => {
    setFiltersState((current) => {
      const next = typeof value === 'function' ? value(current) : value
      saveCache({ filters: next })
      return next
    })
  }, [])

  const setPage = useCallback((value: number | ((current: number) => number)) => {
    setPageState((current) => {
      const next = typeof value === 'function' ? value(current) : value
      saveCache({ page: next })
      return next
    })
  }, [])

  const setViewMode = useCallback((value: ViewMode | ((current: ViewMode) => ViewMode)) => {
    setViewModeState((current) => {
      const next = typeof value === 'function' ? value(current) : value
      saveCache({ viewMode: next })
      return next
    })
  }, [])

  const loadAll = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    if (!force && hasUsableCache() && !cacheExpired()) {
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const productsResponse = await loadProducts()
      const [purchasesResult, locationsResult, cartResult] = await Promise.allSettled([loadPurchases(), loadLocations(), loadCart()])

      const nextWarnings: string[] = []
      const purchasesResponse =
        purchasesResult.status === 'fulfilled'
          ? purchasesResult.value
          : (nextWarnings.push('Situação de compra indisponível no momento.'), { ok: false, total: 0, itens: [] })

      const locationsResponse =
        locationsResult.status === 'fulfilled'
          ? locationsResult.value
          : (nextWarnings.push('Locais de inventário indisponíveis no momento.'), { ok: false, locais: [] })

      const cartResponse =
        cartResult.status === 'fulfilled'
          ? cartResult.value
          : (nextWarnings.push('Carrinho indisponível no momento.'), { ok: false, itens: [] })

      const merged = mergePilotData(productsResponse, purchasesResponse, locationsResponse)
      const nextFiltersMeta = buildFilterMeta(merged, locationsResponse)
      const nextCartCount = Array.isArray(cartResponse.itens) ? cartResponse.itens.length : 0

      setProducts(merged)
      setFiltersMeta(nextFiltersMeta)
      setCartCount(nextCartCount)
      setWarnings(nextWarnings)

      saveCache({
        products: merged,
        filtersMeta: nextFiltersMeta,
        cartCount: nextCartCount,
        warnings: nextWarnings,
        fetchedAt: Date.now(),
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar a Lista de Produtos real.')
      setWarnings([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const unsubscribe = subscribeProductsStream((event) => {
      if (cancelled) return
      setStreamEvents((current) => [event, ...current].slice(0, 5))
    })

    void loadAll({ force: !hasUsableCache() || cacheExpired() })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [loadAll])

  const filtered = useMemo(() => filterProducts(products, filters), [products, filters])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const paginated = useMemo(() => paginateProducts(filtered, currentPage, pageSize), [filtered, currentPage])

  useEffect(() => {
    if (page !== currentPage) {
      setPage(currentPage)
    }
  }, [currentPage, page, setPage])

  return {
    filtered,
    paginated,
    loading,
    error,
    warnings,
    filters,
    setFilters,
    filtersMeta,
    page: currentPage,
    setPage,
    pageCount,
    pageSize,
    viewMode,
    setViewMode,
    cartCount,
    streamEvents,
    dataMode: getPilotMode(),
    reload: () => loadAll({ force: true }),
    fetchedAt: pilotCache.fetchedAt,
    cacheStale: cacheExpired(),
  }
}
