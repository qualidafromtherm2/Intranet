import type {
  FiltersState,
  InventoryLocationsResponse,
  ProductFilterOption,
  ProductFiltersMeta,
  ProductListResponse,
  ProductPurchaseResponse,
  ProductRecord,
} from '../types'

export const defaultFilters: FiltersState = {
  search: '',
  families: [],
  typeItems: [],
  origins: [],
  purchaseStatus: [],
  locationCodes: [],
  showInactive: false,
  hideObsolete: false,
  hideEngineering: false,
  semEstoqueMin: false,
  abaixoEstoqueMin: false,
  acimaEstoqueMin: false,
  proximoEstoqueMin: false,
  proximoPercent: 10,
  estoqueNegativo: false,
  expedicaoNegativa: false,
  saldoEnderecoSemOmie: false,
  saldoDivergenteEndereco: false,
}

export function extractTipoFromCodigo(codigo: string | null | undefined) {
  if (!codigo) return null
  const parts = String(codigo).split('.')
  if (parts.length >= 2 && /^[A-Za-z]{2}$/.test(parts[1] ?? '')) return parts[1]!.toUpperCase()
  return null
}

export function extractOrigemFromCodigo(codigo: string | null | undefined) {
  const parts = String(codigo || '').split('.')
  const origem = String(parts[2] || '').toUpperCase()
  return origem === 'N' || origem === 'I' ? origem : null
}

const parseNumber = (value: number | string | null | undefined) => {
  if (typeof value === 'number') return value
  const normalized = String(value ?? '').trim().replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

const normalizeText = (value: string | null | undefined, fallback = '') => {
  const text = String(value ?? '').trim()
  return text || fallback
}

const compareText = (left: string | null | undefined, right: string | null | undefined) =>
  normalizeText(left).localeCompare(normalizeText(right), 'pt-BR')

const isInactive = (value: string | null | undefined) => String(value || '').toUpperCase() === 'S'
const isObsolete = (descricao: string | null | undefined) => String(descricao || '').toUpperCase().startsWith('OBSOLETO')
const isEngineering = (descricao: string | null | undefined) => String(descricao || '').toUpperCase().startsWith('ENGENHARIA')

const buildLocationMaps = (locations: InventoryLocationsResponse) => {
  const byProduct = new Map<string, Array<{ codigo: string; nome: string }>>()
  const locationOptions = locations.locais
    .map((location) => {
      const codigo = normalizeText(location.local_codigo)
      const label = normalizeText(location.local_nome, codigo || 'Sem local informado')

      if (!codigo) return null

      return {
        value: codigo,
        label,
        count: Number(location.total || 0),
      }
    })
    .filter((location): location is ProductFilterOption => Boolean(location))

  for (const location of locations.locais) {
    const codigoLocal = normalizeText(location.local_codigo)
    const nomeLocal = normalizeText(location.local_nome, codigoLocal || 'Sem local informado')
    if (!codigoLocal) continue

    for (const code of location.codigos || []) {
      const key = normalizeText(code).toUpperCase()
      if (!key) continue
      const current = byProduct.get(key) ?? []
      current.push({ codigo: codigoLocal, nome: nomeLocal })
      byProduct.set(key, current)
    }
  }

  return {
    byProduct,
    locationOptions: locationOptions.sort((a, b) => compareText(a.label, b.label)),
  }
}

export const mergePilotData = (
  products: ProductListResponse,
  purchases: ProductPurchaseResponse,
  locations: InventoryLocationsResponse,
): ProductRecord[] => {
  const purchaseMap = new Map(purchases.itens.map((entry) => [entry.codigo.trim().toUpperCase(), entry.status]))
  const { byProduct } = buildLocationMaps(locations)

  return products.itens.map((product) => {
    const code = product.codigo.trim().toUpperCase()
    const compraStatus = purchaseMap.get(code) ?? null

    return {
      ...product,
      compraStatus,
      purchaseState: compraStatus ? 'em_compra' : 'sem_compra',
      origemCodigo: extractOrigemFromCodigo(product.codigo),
      tipoCodigo: extractTipoFromCodigo(product.codigo),
      imageUrl: product.primeira_imagem,
      locaisPositivos: byProduct.get(code) ?? [],
      isInactive: isInactive(product.inativo),
      isObsolete: isObsolete(product.descricao),
      isEngineering: isEngineering(product.descricao),
    }
  })
}

export const filterProducts = (products: ProductRecord[], filters: FiltersState) => {
  const search = filters.search.trim().toLowerCase()
  const terms = search.split(/\s+/).filter(Boolean)

  return products.filter((product) => {
    if (!filters.showInactive && product.isInactive) return false
    if (filters.hideObsolete && product.isObsolete) return false
    if (filters.hideEngineering && product.isEngineering) return false

    if (terms.length > 0) {
      const hay = `${product.codigo || ''} ${product.descricao || ''}`.toLowerCase()
      const matched = terms.every((term) => {
        const base = term.includes('-----') ? term.split('-----')[0] ?? term : term
        if (hay.includes(term) || hay.includes(base)) return true
        const code = String(product.codigo || '').toLowerCase()
        return code.length >= 4 && (term.includes(code) || base.includes(code))
      })
      if (!matched) return false
    }

    if (filters.families.length > 0) {
      const family = (product.descricao_familia || '').trim()
      if (!filters.families.includes(family)) return false
    }

    if (filters.typeItems.length > 0) {
      const typeValue = product.tipoCodigo ?? '__outros__'
      if (!filters.typeItems.includes(typeValue)) return false
    }

    if (filters.origins.length > 0) {
      if (!product.origemCodigo || !filters.origins.includes(product.origemCodigo)) return false
    }

    if (filters.locationCodes.length > 0) {
      const hasLocation = product.locaisPositivos.some((location) => filters.locationCodes.includes(location.codigo))
      if (!hasLocation) return false
    }

    if (filters.purchaseStatus.length === 1 && !filters.purchaseStatus.includes(product.purchaseState)) return false

    if (filters.semEstoqueMin) {
      const minimo = parseNumber(product.estoque_minimo)
      if ((Number.isFinite(minimo) && minimo > 0) || product.item_limitado) return false
    }

    if (filters.estoqueNegativo && !product.estoque_negativo) return false
    if (filters.expedicaoNegativa && !product.expedicao_negativa) return false
    if (filters.saldoEnderecoSemOmie && !product.saldo_endereco_sem_omie) return false
    if (filters.saldoDivergenteEndereco && !product.saldo_divergente_endereco) return false

    if (filters.abaixoEstoqueMin || filters.acimaEstoqueMin || filters.proximoEstoqueMin) {
      const minimo = parseNumber(product.estoque_minimo)
      const saldoAlmox = parseNumber(product.saldo_almox)
      if (!Number.isFinite(minimo) || minimo <= 0 || !Number.isFinite(saldoAlmox)) return false

      const abaixo = saldoAlmox < minimo
      const acima = saldoAlmox >= minimo
      const limiteProximo = minimo * (1 + Math.max(1, filters.proximoPercent) / 100)
      const proximo = saldoAlmox >= minimo && saldoAlmox <= limiteProximo
      const atende =
        (filters.abaixoEstoqueMin && abaixo) ||
        (filters.acimaEstoqueMin && acima) ||
        (filters.proximoEstoqueMin && proximo)

      if (!atende) return false
    }

    return true
  })
}

export const paginateProducts = (products: ProductRecord[], page: number, pageSize: number) => {
  const safePage = Math.max(1, page)
  const start = (safePage - 1) * pageSize
  return products.slice(start, start + pageSize)
}

const buildCountOptions = (entries: string[]) => {
  const counts = new Map<string, number>()
  for (const value of entries) {
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([value, count]) => ({ value, label: value, count }))
}

export const buildFilterMeta = (products: ProductRecord[], locations: InventoryLocationsResponse): ProductFiltersMeta => {
  const families = buildCountOptions(products.map((product) => (product.descricao_familia || '').trim()).filter(Boolean))
  const typeCounts = new Map<string, number>()

  for (const product of products) {
    const key = product.tipoCodigo ?? '__outros__'
    typeCounts.set(key, (typeCounts.get(key) ?? 0) + 1)
  }

  const typeItems: ProductFilterOption[] = [...typeCounts.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([value, count]) => ({
      value,
      label: value === '__outros__' ? 'Outros' : value,
      count,
    }))

  const { locationOptions } = buildLocationMaps(locations)

  return {
    families,
    typeItems,
    locations: locationOptions,
  }
}
