import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteReceiptIdentification,
  extractPrintedReceiptId,
  loadPrintedReceipts,
  loadReceiptIdentifications,
  printReceiptIdentifications,
  printSplitReceiptIdentification,
  reprintPrintedReceipt,
  setReceiptIdentificationHidden,
  storePrintedReceipt,
  validateWarehouseAddress,
} from './logistics'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('logistics gateway', () => {
  afterEach(() => vi.restoreAllMocks())

  it('preserves receipt list query and flow used by the legacy screen', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ etiquetas: [] }))

    await loadPrintedReceipts({ query: '07.MP', flow: 'expedicao' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/etiquetas/rec-impresso?q=07.MP&fluxo=expedicao',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('normalizes and validates the exact warehouse address formats from the legacy flow', () => {
    expect(validateWarehouseAddress(' 01_03_21_p01 ')).toBe('01-03-21-P01')
    expect(validateWarehouseAddress('01-03-21-002')).toBe('01-03-21-002')
    expect(() => validateWarehouseAddress('A-3-21')).toThrow('Use o formato 01-03-21-002 ou 01-03-21-P01.')
    expect(extractPrintedReceiptId('COD|DESCRIÇÃO|LOTE|ID1850.1')).toBe('1850.1')
  })

  it('sends destination, address and optional complement without changing the backend contract', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true, id: 1850 }))

    await storePrintedReceipt({
      id: 1850,
      address: '01-03-21-002',
      complement: 'Caixa azul',
      destinationCode: '10717096386',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/etiquetas/rec-impresso/1850/endereco',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          endereco: '01-03-21-002',
          complemento: 'Caixa azul',
          local_destino_codigo: '10717096386',
        }),
      }),
    )
  })

  it('routes an existing ETQ reprint to the configured agent and preserves id and format', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true, quantidade: 1, via: 'fila' }))

    await reprintPrintedReceipt({
      id: 1850,
      format: 'grande',
      printer: '__AGENT__:PC-LOG:Zebra G',
      username: 'jair.r',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/etiquetas/rec-impresso/imprimir-ids',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          ids: [1850],
          usuario: 'jair.r',
          via_fila: true,
          formato: 'grande',
          destino_agente: 'PC-LOG',
          impressora: 'Zebra G',
        }),
      }),
    )
  })

  it('preserves identification filters and receiving/expedition split', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ etiquetas: [], filtro: 'sem_mp' }))

    await loadReceiptIdentifications({ query: 'LT-24', flow: 'recebimento', showHidden: true, withoutMp: true })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/etiquetas/recebimento/pendentes?q=LT-24&mostrar_ocultos=1&sem_mp=1&fluxo=recebimento',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('keeps hide and Jair-only deletion on their audited endpoints', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ ok: true }))

    await setReceiptIdentificationHidden(44, true)
    await deleteReceiptIdentification(44)

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/etiquetas/recebimento/44/oculto', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ oculto: true }) }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/etiquetas/recebimento/44/identificacao', expect.objectContaining({ method: 'DELETE' }))
  })

  it('uses the real queue contracts for selected and split agent printing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ ok: true, quantidade: 2 }))

    await printReceiptIdentifications({ ids: [44, 45], printer: '__AGENT__:PC-LOG:Zebra P', username: 'jair.r' })
    await printSplitReceiptIdentification({ id: 44, multiple: 6, printer: '__AGENT__:PC-LOG:Zebra P', username: 'jair.r' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/etiquetas/fila', expect.objectContaining({
      body: JSON.stringify({ ids: [44, 45], usuario: 'jair.r', destino_agente: 'PC-LOG', impressora: 'Zebra P' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/etiquetas/fila', expect.objectContaining({
      body: JSON.stringify({ ids: [44], multiplo: 6, usuario: 'jair.r', destino_agente: 'PC-LOG', impressora: 'Zebra P' }),
    }))
  })
})
