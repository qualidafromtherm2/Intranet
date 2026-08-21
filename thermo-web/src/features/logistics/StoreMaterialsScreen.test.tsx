import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StoreMaterialsScreen } from './StoreMaterialsScreen'
import {
  loadPrintedReceipt,
  loadPrintedReceipts,
  loadWarehouseLocations,
  returnPrintedReceipt,
  storePrintedReceipt,
} from '../../services/logistics'

vi.mock('../../services/logistics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/logistics')>()
  return {
    ...actual,
    loadPrintedReceipt: vi.fn(),
    loadPrintedReceipts: vi.fn(),
    loadPrinterSetup: vi.fn(),
    loadProductAddressReferences: vi.fn().mockResolvedValue([]),
    loadWarehouseLocations: vi.fn(),
    reprintPrintedReceipt: vi.fn(),
    returnPrintedReceipt: vi.fn(),
    storePrintedReceipt: vi.fn(),
  }
})

const receipt = {
  id: 1850,
  id_rotulo: '1850.1',
  id_pai: 1850,
  numero_nfe: '4582',
  numero_pedido: '9001',
  lote: 'LT-24',
  codigo_produto: '07.MP.N.70005',
  descricao_produto: 'Compressor scroll 4TR',
  qtd: 20,
  unidade: 'UN',
  fornecedor: 'TermoParts',
  data_emissao: '20/08/2026',
  impresso_em: '2026-08-20T10:00:00.000Z',
  usuario_criacao: 'jair.r',
}

const detail = {
  id: 1850,
  id_rotulo: '1850.1',
  id_pai: 1850,
  qtd: 20,
  unidade: 'UN',
  endereco: null,
  complemento: null,
  codigo_omie: '12345',
  descricao: 'Compressor scroll 4TR',
  codigo: '07.MP.N.70005',
}

describe('StoreMaterialsScreen', () => {
  beforeEach(() => {
    vi.mocked(loadPrintedReceipts).mockReset().mockResolvedValue({ etiquetas: [receipt] })
    vi.mocked(loadWarehouseLocations).mockReset().mockResolvedValue([
      { codigo: '#ALMOX', descricao: 'Porta Pallet (Almoxarifado)', codigo_local_estoque: '10717096386' },
    ])
    vi.mocked(loadPrintedReceipt).mockReset().mockResolvedValue({ ok: true, etiqueta: detail })
    vi.mocked(storePrintedReceipt).mockReset().mockResolvedValue({
      ok: true,
      id: 1850,
      id_rotulo: '1850.1',
      endereco: '01-03-21-002',
      local_destino_codigo: '10717096386',
      local_destino_nome: 'Porta Pallet (Almoxarifado)',
    })
    vi.mocked(returnPrintedReceipt).mockReset().mockResolvedValue({
      ok: true,
      modo: 'todas',
      saldo_retornado: 20,
      origem_id: 900,
      impressos_removidos: 2,
      origens_consolidadas: 1,
    })
  })

  it('blocks the entire screen when the navigation permission was not granted', () => {
    render(<StoreMaterialsScreen username="operador" allowed={false} />)

    expect(screen.getByLabelText('Sem permissão para Guardar materiais')).toBeInTheDocument()
    expect(loadPrintedReceipts).not.toHaveBeenCalled()
  })

  it('renders real legacy fields and keeps the receiving flow in the list request', async () => {
    render(<StoreMaterialsScreen username="jair.r" />)

    expect(await screen.findByText('Compressor scroll 4TR')).toBeInTheDocument()
    expect(screen.getByText('LT-24')).toBeInTheDocument()
    expect(screen.getByText('NF-e Nº 4582')).toBeInTheDocument()
    expect(screen.getByText('ETQ 1850.1')).toBeInTheDocument()
    expect(loadPrintedReceipts).toHaveBeenCalledWith({ query: '', flow: 'recebimento' })
  })

  it('validates the address beside the field and stores using the audited payload', async () => {
    const user = userEvent.setup()
    render(<StoreMaterialsScreen username="jair.r" />)
    await screen.findByText('Compressor scroll 4TR')

    await user.click(screen.getByRole('button', { name: 'Guardar material' }))
    expect(await screen.findByText('ETQ 1850.1 adicionada. Inclua outras ETQs ou informe o endereço.')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('01-03-21-002'), 'endereco-invalido')
    await user.click(screen.getByRole('button', { name: 'Guardar 1 material' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Use o formato 01-03-21-002 ou 01-03-21-P01.')
    expect(storePrintedReceipt).not.toHaveBeenCalled()

    await user.clear(screen.getByPlaceholderText('01-03-21-002'))
    await user.type(screen.getByPlaceholderText('01-03-21-002'), '01-03-21-002')
    await user.type(screen.getByText('Complemento (opcional)').nextElementSibling as HTMLInputElement, 'Caixa azul')
    await user.click(screen.getByRole('button', { name: 'Guardar 1 material' }))

    await waitFor(() => expect(storePrintedReceipt).toHaveBeenCalledWith({
      id: 1850,
      address: '01-03-21-002',
      complement: 'Caixa azul',
      destinationCode: '10717096386',
    }))
  })

  it('preserves return-all semantics for the same product and lot', async () => {
    const user = userEvent.setup()
    render(<StoreMaterialsScreen username="jair.r" />)
    await screen.findByText('Compressor scroll 4TR')

    await user.click(screen.getByRole('button', { name: 'Retornar' }))
    await user.click(screen.getByRole('button', { name: /Todas deste produto/i }))

    await waitFor(() => expect(returnPrintedReceipt).toHaveBeenCalledWith(1850, 'todas'))
    expect(await screen.findByText(/Saldo 20 UN devolvido para Identificação do produto/)).toBeInTheDocument()
  })
})
