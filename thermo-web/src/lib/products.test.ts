import { describe, expect, it } from 'vitest'
import { demoSnapshot } from '../data/demo'
import { defaultFilters, filterProducts, mergePilotData, paginateProducts } from './products'

const merged = mergePilotData(demoSnapshot.products, demoSnapshot.purchases, demoSnapshot.locations)

describe('product pilot filters', () => {
  it('marks purchase status and health from merged sources', () => {
    const compressor = merged.find((product) => product.codigo === 'COMP-4TR-01')
    expect(compressor?.compraStatus).toBe('Pedido aguardando aprovação')
    expect(compressor?.health).toBe('abaixo-minimo')
  })

  it('filters by purchase and location together', () => {
    const filtered = filterProducts(merged, { ...defaultFilters, purchaseStatus: ['em_compra'], locations: ['Depósito 01 - Almoxarifado'] })
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every((product) => product.compraStatus)).toBe(true)
  })

  it('paginates deterministically', () => {
    const firstPage = paginateProducts(merged, 1, 4)
    const secondPage = paginateProducts(merged, 2, 4)
    expect(firstPage).toHaveLength(4)
    expect(secondPage[0]?.codigo).not.toBe(firstPage[0]?.codigo)
  })
})
