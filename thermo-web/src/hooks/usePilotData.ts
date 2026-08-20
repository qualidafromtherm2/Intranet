import { useEffect, useMemo, useState } from 'react'
import { collectFamilies, collectLocations, defaultFilters, filterProducts, mergePilotData, paginateProducts } from '../lib/products'
import { getDemoUser, getPilotMode, loadCart, loadLocations, loadProducts, loadPurchases, subscribeProductsStream } from '../services/pilotGateway'
import type { FiltersState, ProductRecord, ProductStreamEvent, ViewMode } from '../types'

const pageSize = 8

export function usePilotData() {
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<FiltersState>(defaultFilters)
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [cartCount, setCartCount] = useState(0)
  const [streamEvents, setStreamEvents] = useState<ProductStreamEvent[]>([])
  const [locationNames, setLocationNames] = useState<string[]>([])
  const [familyNames, setFamilyNames] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    const unsubscribe = subscribeProductsStream((event) => {
      setStreamEvents((current) => [event, ...current].slice(0, 4))
    })

    async function run() {
      setLoading(true)
      setError(null)
      try {
        const [productsResponse, purchasesResponse, locationsResponse, cartResponse] = await Promise.all([loadProducts(), loadPurchases(), loadLocations(), loadCart()])
        if (cancelled) return
        const merged = mergePilotData(productsResponse, purchasesResponse, locationsResponse)
        setProducts(merged)
        setCartCount(cartResponse.itens.length)
        setLocationNames(collectLocations(locationsResponse))
        setFamilyNames(collectFamilies(merged))
      } catch (loadError) {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar o piloto.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const filtered = useMemo(() => filterProducts(products, filters), [products, filters])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const paginated = useMemo(() => paginateProducts(filtered, currentPage, pageSize), [filtered, currentPage])

  return {
    filtered,
    paginated,
    loading,
    error,
    filters,
    setFilters,
    page: currentPage,
    setPage,
    pageCount,
    viewMode,
    setViewMode,
    cartCount,
    streamEvents,
    locationNames,
    familyNames,
    dataMode: getPilotMode(),
    user: getDemoUser(),
  }
}
