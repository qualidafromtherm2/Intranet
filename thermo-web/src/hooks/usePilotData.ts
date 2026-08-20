import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildFilterMeta, defaultFilters, filterProducts, mergePilotData, paginateProducts } from '../lib/products'
import { getPilotMode, loadCart, loadLocations, loadProducts, loadPurchases, subscribeProductsStream } from '../services/pilotGateway'
import type { FiltersState, ProductFiltersMeta, ProductRecord, ProductStreamEvent, ViewMode } from '../types'

const pageSize = 50
const cacheTtlMs = 5 * 60 * 1000
const sessionStorageKey = 'thermo.pilot.products.state'

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

type PilotSnapshot = Pick<PilotCacheState, 'products' | 'filtersMeta' | 'cartCount' | 'warnings' | 'fetchedAt'>

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
let inFlightPrefetch: Promise<PilotSnapshot> | null = null

const hasUsableCache = () => pilotCache.products.length > 0
const cacheExpired = () => !pilotCache.fetchedAt || Date.now() - pilotCache.fetchedAt > cacheTtlMs

const readSessionState = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(sessionStorageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PilotCacheState>
    return parsed
  } catch {
    return null
  }
}

const persistSessionState = () => {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(
      sessionStorageKey,
      JSON.stringify({
        filters: pilotCache.filters,
        page: pilotCache.page,
        viewMode: pilotCache.viewMode,
      }),
    )
  } catch {
    // ignore session persistence issues
  }
}

const hydrateSessionState = () => {
  const saved = readSessionState()
  if (!saved) return
  pilotCache = {
    ...pilotCache,
    filters: saved.filters ? { ...defaultFilters, ...saved.filters } : pilotCache.filters,
    page: typeof saved.page === 'number' ? saved.page : pilotCache.page,
    viewMode: saved.viewMode === 'list' ? 'list' : pilotCache.viewMode,
  }
}

hydrateSessionState()

const saveCache = (next: Partial<PilotCacheState>) => {
  pilotCache = {
    ...pilotCache,
    ...next,
    filters: next.filters ? { ...next.filters } : pilotCache.filters,
  }
  persistSessionState()
}

async function fetchPilotSnapshot(): Promise<PilotSnapshot> {
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

  const snapshot = {
    products: merged,
    filtersMeta: nextFiltersMeta,
    cartCount: nextCartCount,
    warnings: nextWarnings,
    fetchedAt: Date.now(),
  }

  saveCache(snapshot)
  return snapshot
}

export async function prefetchPilotData({ force = false }: { force?: boolean } = {}) {
  if (!force && hasUsableCache() && !cacheExpired()) {
    return {
      products: pilotCache.products,
      filtersMeta: pilotCache.filtersMeta,
      cartCount: pilotCache.cartCount,
      warnings: pilotCache.warnings,
      fetchedAt: pilotCache.fetchedAt,
    }
  }
  if (!force && inFlightPrefetch) return inFlightPrefetch

  const task = fetchPilotSnapshot()
    .catch((error) => {
      throw error
    })
    .finally(() => {
      if (inFlightPrefetch === task) inFlightPrefetch = null
    })

  inFlightPrefetch = task
  return task
}

export function resetPilotDataCache() {
  pilotCache = initialCacheState()
  inFlightPrefetch = null
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(sessionStorageKey)
  }
}

export function getPilotDataCacheState() {
  return {
    ...pilotCache,
    filters: { ...pilotCache.filters },
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
      const snapshot = await prefetchPilotData({ force })
      setProducts(snapshot.products)
      setFiltersMeta(snapshot.filtersMeta)
      setCartCount(snapshot.cartCount)
      setWarnings(snapshot.warnings)
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
