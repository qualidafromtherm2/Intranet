import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prefetchPilotData, resetPilotDataCache } from './usePilotData'

vi.mock('../services/pilotGateway', () => ({
  getPilotMode: () => 'proxy',
  loadProducts: vi.fn(async () => ({
    total: 1,
    page: 1,
    limit: 500,
    itens: [
      {
        codigo_produto: 1,
        codigo_produto_integracao: null,
        codigo: '4237',
        descricao: 'Produto 4237',
        descricao_familia: null,
        unidade: 'UN',
        tipoitem: null,
        ncm: null,
        valor_unitario: null,
        quantidade_estoque: 1,
        estoque_minimo: 0,
        saldo_almox: 1,
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
  })),
  loadPurchases: vi.fn(async () => ({ ok: true, total: 0, itens: [] })),
  loadLocations: vi.fn(async () => ({ ok: true, locais: [] })),
  loadCart: vi.fn(async () => ({ ok: true, itens: [] })),
  subscribeProductsStream: vi.fn(() => () => undefined),
}))

describe('prefetchPilotData', () => {
  beforeEach(() => {
    resetPilotDataCache()
    vi.clearAllMocks()
  })

  it('reuses one in-flight fetch and avoids duplicate requests', async () => {
    const gateway = await import('../services/pilotGateway')

    await Promise.all([prefetchPilotData(), prefetchPilotData()])
    await prefetchPilotData()

    expect(gateway.loadProducts).toHaveBeenCalledTimes(1)
    expect(gateway.loadPurchases).toHaveBeenCalledTimes(1)
    expect(gateway.loadLocations).toHaveBeenCalledTimes(1)
    expect(gateway.loadCart).toHaveBeenCalledTimes(1)
  })
})
