import { describe, expect, it } from 'vitest'
import { demoSnapshot } from '../data/demo'
import type { InventoryLocationsResponse, ProductStockBatchResponse } from '../types'
import { buildFilterMeta, defaultFilters, filterProducts, mergePilotData, paginateProducts } from './products'

const merged = mergePilotData(demoSnapshot.products, demoSnapshot.purchases, demoSnapshot.locations)

describe('product pilot filters', () => {
  it('marks purchase status and health from merged sources', () => {
    const compressor = merged.find((product) => product.codigo === 'COMP-4TR-01')
    expect(compressor?.compraStatus).toBe('Pedido aguardando aprovação')
    expect(compressor?.abaixo_minimo).toBe(true)
  })

  it('filters by purchase and location together', () => {
    const filtered = filterProducts(merged, { ...defaultFilters, purchaseStatus: ['em_compra'], locationCodes: ['10717096386'] })
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every((product) => product.compraStatus && product.locaisPositivos.some((location) => location.codigo === '10717096386'))).toBe(true)
  })

  it('paginates deterministically', () => {
    const firstPage = paginateProducts(merged, 1, 4)
    const secondPage = paginateProducts(merged, 2, 4)
    expect(firstPage).toHaveLength(4)
    expect(secondPage[0]?.codigo).not.toBe(firstPage[0]?.codigo)
  })

  it('normalizes null inventory labels without dropping products', () => {
    const locations: InventoryLocationsResponse = {
      ok: true,
      locais: [
        {
          local_codigo: '4237-A1',
          local_nome: null,
          codigos: ['4237'],
          total: 1,
        },
      ],
    }

    const products = mergePilotData(
      {
        total: 1,
        page: 1,
        limit: 500,
        itens: [
          {
            codigo_produto: 10,
            codigo_produto_integracao: null,
            codigo: '4237',
            descricao: 'Produto real 4237',
            descricao_familia: null,
            unidade: 'UN',
            tipoitem: null,
            ncm: null,
            valor_unitario: null,
            quantidade_estoque: null,
            estoque_minimo: 0,
            saldo_almox: 1,
            saldo_expedicao: 0,
            saldo_enderecado: 1,
            abaixo_minimo: false,
            estoque_negativo: false,
            expedicao_negativa: false,
            saldo_endereco_sem_omie: false,
            saldo_divergente_endereco: false,
            diferenca_saldo_endereco: 0,
            item_limitado: false,
            inativo: null,
            bloqueado: null,
            marca: null,
            modelo: null,
            dalt: null,
            halt: null,
            dinc: null,
            hinc: null,
            primeira_imagem: null,
          },
        ],
      },
      { ok: true, total: 0, itens: [] },
      locations,
    )

    const meta = buildFilterMeta(products, locations)

    expect(products).toHaveLength(1)
    expect(products[0]?.locaisPositivos[0]).toEqual({ codigo: '4237-A1', nome: '4237-A1' })
    expect(meta.locations[0]).toEqual({ value: '4237-A1', label: '4237-A1', count: 1 })
  })

  it('preserves dynamic warehouse balances from batch payload', () => {
    const stock: ProductStockBatchResponse = {
      ok: true,
      dados: {
        '4237': [
          { local_codigo: '10717096386', local_nome: 'Porta Pallet (Almoxarifado)', saldo: 0, unidade: 'UN' },
          { local_codigo: 'PROD', local_nome: 'Produção', saldo: 5, unidade: 'UN' },
          { local_codigo: 'EXP', local_nome: 'Expedição', saldo: -2, unidade: 'UN' },
          { local_codigo: 'X7', local_nome: 'Armazém X7', saldo: 7, unidade: 'UN' },
        ],
      },
      minimos: {
        '4237': { min: 20, saldoAlmox: 0, abaixo: true },
      },
    }

    const products = mergePilotData(
      {
        total: 1,
        page: 1,
        limit: 500,
        itens: [
          {
            codigo_produto: 10,
            codigo_produto_integracao: null,
            codigo: '4237',
            descricao: 'Produto real 4237',
            descricao_familia: null,
            unidade: 'UN',
            tipoitem: null,
            ncm: null,
            valor_unitario: null,
            quantidade_estoque: null,
            estoque_minimo: 0,
            saldo_almox: 0,
            saldo_expedicao: 0,
            saldo_enderecado: 0,
            abaixo_minimo: false,
            estoque_negativo: false,
            expedicao_negativa: false,
            saldo_endereco_sem_omie: false,
            saldo_divergente_endereco: false,
            diferenca_saldo_endereco: 0,
            item_limitado: false,
            inativo: null,
            bloqueado: null,
            marca: null,
            modelo: null,
            dalt: null,
            halt: null,
            dinc: null,
            hinc: null,
            primeira_imagem: null,
          },
        ],
      },
      { ok: true, total: 0, itens: [] },
      { ok: true, locais: [] },
      stock,
    )

    expect(products[0]?.warehouseBalances).toHaveLength(4)
    expect(products[0]?.saldo_almox).toBe(0)
    expect(products[0]?.estoque_minimo).toBe(20)
    expect(products[0]?.estoque_negativo).toBe(true)
  })
})
