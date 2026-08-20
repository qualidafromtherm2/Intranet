import type {
  FiltersState,
  InventoryLocationsResponse,
  InventoryHealth,
  ProductListResponse,
  ProductPurchaseResponse,
  ProductRecord,
} from '../types'

export const defaultFilters: FiltersState = {
  search: '',
  family: [],
  purchaseStatus: [],
  locations: [],
  health: [],
  limitedOnly: false,
  inactiveVisible: false,
}

const computeHealth = (product: ProductRecord): InventoryHealth => {
  if (product.estoque_negativo) return 'estoque-negativo'
  if (product.expedicao_negativa) return 'expedicao-negativa'
  if (product.saldo_divergente_endereco || product.saldo_endereco_sem_omie) return 'divergente'
  if (product.abaixo_minimo) return 'abaixo-minimo'
  return 'normal'
}

export const mergePilotData = (
  products: ProductListResponse,
  purchases: ProductPurchaseResponse,
  locations: InventoryLocationsResponse,
): ProductRecord[] => {
  const purchaseMap = new Map(purchases.itens.map((entry) => [entry.codigo.trim().toUpperCase(), entry.status]))
  const locationMap = new Map<string, string[]>()

  for (const location of locations.locais) {
    for (const code of location.codigos) {
      const key = code.trim().toUpperCase()
      const current = locationMap.get(key) ?? []
      current.push(location.local_nome)
      locationMap.set(key, current)
    }
  }

  return products.itens.map((product) => {
    const code = product.codigo.trim().toUpperCase()
    const record: ProductRecord = {
      ...product,
      compraStatus: purchaseMap.get(code) ?? null,
      locaisPositivos: locationMap.get(code) ?? [],
      health: 'normal',
      imageUrl: product.primeira_imagem,
    }

    record.health = computeHealth(record)
    return record
  })
}

export const filterProducts = (products: ProductRecord[], filters: FiltersState) => {
  const search = filters.search.trim().toLowerCase()

  return products.filter((product) => {
    if (!filters.inactiveVisible && String(product.inativo || '').toUpperCase() === 'S') {
      return false
    }

    if (filters.limitedOnly && !product.item_limitado) {
      return false
    }

    if (
      search &&
      ![
        product.codigo,
        product.descricao,
        product.descricao_familia ?? '',
        product.codigo_produto_integracao ?? '',
        product.marca ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(search)
    ) {
      return false
    }

    if (filters.family.length && !filters.family.includes(product.descricao_familia ?? 'Sem família')) {
      return false
    }

    if (filters.locations.length) {
      const matchedLocation = product.locaisPositivos.some((location) => filters.locations.includes(location))
      if (!matchedLocation) return false
    }

    if (filters.purchaseStatus.length) {
      const purchaseState = product.compraStatus ? 'em_compra' : 'sem_compra'
      if (!filters.purchaseStatus.includes(purchaseState)) return false
    }

    if (filters.health.length && !filters.health.includes(product.health)) {
      return false
    }

    return true
  })
}

export const paginateProducts = (products: ProductRecord[], page: number, pageSize: number) => {
  const safePage = Math.max(1, page)
  const start = (safePage - 1) * pageSize
  return products.slice(start, start + pageSize)
}

export const collectFamilies = (products: ProductRecord[]) =>
  [...new Set(products.map((product) => product.descricao_familia ?? 'Sem família'))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  )

export const collectLocations = (locations: InventoryLocationsResponse) =>
  locations.locais.map((location) => location.local_nome).sort((a, b) => a.localeCompare(b, 'pt-BR'))
