import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildFilterMeta, defaultFilters, filterProducts, mergePilotData, paginateProducts } from '../lib/products'
import { getPilotMode, loadCart, loadLocations, loadProducts, loadPurchases, subscribeProductsStream } from '../services/pilotGateway'
import type { FiltersState, ProductFiltersMeta, ProductRecord, ProductStreamEvent, ViewMode } from '../types'

const pageSize = 50

export function usePilotData() {
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [filtersMeta, setFiltersMeta] = useState<ProductFiltersMeta>({ families: [], typeItems: [], locations: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [filters, setFilters] = useState<FiltersState>(defaultFilters)
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [cartCount, setCartCount] = useState(0)
  const [streamEvents, setStreamEvents] = useState<ProductStreamEvent[]>([])

  const loadAll = useCallback(async () => {
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
      setProducts(merged)
      setFiltersMeta(buildFilterMeta(merged, locationsResponse))
      setCartCount(Array.isArray(cartResponse.itens) ? cartResponse.itens.length : 0)
      setWarnings(nextWarnings)
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

    void loadAll()

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [loadAll])

  const filtered = useMemo(() => filterProducts(products, filters), [products, filters])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const paginated = useMemo(() => paginateProducts(filtered, currentPage, pageSize), [filtered, currentPage])

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
    reload: loadAll,
  }
}
