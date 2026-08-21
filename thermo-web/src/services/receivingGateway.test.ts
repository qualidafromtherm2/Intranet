import { afterEach, describe, expect, it, vi } from 'vitest'
import { confirmNfeAssociation, findNfeKey, loadNfeDetails, loadPendingReceipts, loadReceivedProducts, previewNfeAssociation } from './receivingGateway'

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('receivingGateway', () => {
  afterEach(() => vi.restoreAllMocks())

  it('usa os endpoints reais das duas listas e preserva credenciais', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response([{ id: 1 }]))
    await loadPendingReceipts(); await loadReceivedProducts()
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/compras/solicitacoes-recebimento')
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/compras/pedidos-recebidos')
    expect(fetchMock.mock.calls[0]![1]).toEqual(expect.objectContaining({ credentials: 'include', cache: 'no-store' }))
  })

  it('consulta chave e detalhes com os parâmetros do legado', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ ok: true, chave_nfe: '1'.repeat(44) }))
      .mockResolvedValueOnce(response({ ok: true, chave_nfe: '1'.repeat(44), data: {} }))
    await findNfeKey('1234'); await loadNfeDetails('1'.repeat(44), '1234')
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/compras/nfe-buscar-chave?numero_nfe=1234')
    expect(fetchMock.mock.calls[1]![0]).toBe(`/api/compras/nfe-xml-detalhes?chave_nfe=${'1'.repeat(44)}&numero_nfe=1234`)
  })

  it('envia o mesmo payload comprovado na prévia e confirmação', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ ok: true, preview: {} }))
      .mockResolvedValueOnce(response({ ok: true }))
    const input = { numero_nfe: '7788', numero_pedido: '9001', n_cod_ped: 42 }
    await previewNfeAssociation(input); await confirmNfeAssociation(input)
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/compras/pedidos-omie/nfe-associar-pedido/preview')
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/compras/pedidos-omie/nfe-associar-pedido')
    expect(fetchMock.mock.calls[0]![1]).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }))
    expect(fetchMock.mock.calls[1]![1]).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }))
  })

  it('propaga mensagem do backend em erro de permissão', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ok: false, error: 'Acesso negado.' }, 403))
    await expect(loadPendingReceipts()).rejects.toMatchObject({ message: 'Acesso negado.', status: 403 })
  })
})
