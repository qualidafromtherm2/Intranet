import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IdentifyProductScreen, calculateDivision } from './IdentifyProductScreen'
import {
  deleteReceiptIdentification,
  loadPrinterSetup,
  loadReceiptIdentifications,
  printReceiptIdentifications,
  printSplitReceiptIdentification,
} from '../../services/logistics'

vi.mock('../../services/logistics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/logistics')>()
  return {
    ...actual,
    deleteReceiptIdentification: vi.fn(),
    loadPrinterSetup: vi.fn(),
    loadReceiptIdentifications: vi.fn(),
    printReceiptIdentifications: vi.fn(),
    printSplitReceiptIdentification: vi.fn(),
    reopenReceiptIdentification: vi.fn(),
    setReceiptIdentificationHidden: vi.fn(),
  }
})

const identification = {
  id: 44,
  numero_nfe: '4582',
  numero_pedido: '9001',
  lote: 'LT-24',
  codigo_produto: '07.MP.N.70005',
  descricao_produto: 'Compressor scroll 4TR',
  qtd: 20,
  unidade: 'UN',
  data_emissao: '20/08/2026',
  criado_em: '2026-08-20T10:00:00.000Z',
  oculto: false,
  impressa: false,
  pir: true,
  id_impresso: null,
}

describe('IdentifyProductScreen', () => {
  beforeEach(() => {
    vi.mocked(loadReceiptIdentifications).mockReset().mockResolvedValue({ etiquetas: [identification], filtro: 'todos' })
    vi.mocked(loadPrinterSetup).mockReset().mockResolvedValue({
      defaultValue: '__AGENT__:PC-LOG:Zebra P',
      options: [{ value: '__AGENT__:PC-LOG:Zebra P', label: 'Zebra P (PC-LOG)', kind: 'agent' }],
    })
    vi.mocked(printReceiptIdentifications).mockReset().mockResolvedValue({ kind: 'queued', quantity: 1 })
    vi.mocked(printSplitReceiptIdentification).mockReset().mockResolvedValue({ kind: 'queued', quantity: 4 })
    vi.mocked(deleteReceiptIdentification).mockReset().mockResolvedValue({ ok: true, identificacao: identification })
  })

  it('keeps whole-unit division validation and floor-plus-remainder packaging', () => {
    expect(calculateDivision(20, 'etiquetas', 3, 'UN')).toEqual({ valid: false, message: '20 UN não podem ser divididas igualmente em 3 etiquetas.' })
    expect(calculateDivision(20, 'embalagem', 6, 'UN')).toEqual({ valid: true, multiple: 6, labels: 4, perLabel: 6, remainder: 2 })
  })

  it('does not load data when navigation permission is denied', () => {
    render(<IdentifyProductScreen username="operador" allowed={false} />)

    expect(screen.getByLabelText('Sem permissão para Identificação do produto')).toBeInTheDocument()
    expect(loadReceiptIdentifications).not.toHaveBeenCalled()
  })

  it('renders audited fields and prints selected receipt ids using the active printer', async () => {
    const user = userEvent.setup()
    render(<IdentifyProductScreen username="operador" />)

    expect(await screen.findByText('Compressor scroll 4TR')).toBeInTheDocument()
    expect(screen.getByText('LT-24')).toBeInTheDocument()
    expect(screen.getByText('NF-e Nº 4582')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar 07.MP.N.70005' }))
    await user.click(screen.getByRole('button', { name: 'Imprimir 1 etiqueta' }))

    await waitFor(() => expect(printReceiptIdentifications).toHaveBeenCalledWith({
      ids: [44],
      printer: '__AGENT__:PC-LOG:Zebra P',
      username: 'operador',
    }))
  })

  it('preserves quantity-per-package semantics when splitting volumes', async () => {
    const user = userEvent.setup()
    render(<IdentifyProductScreen username="operador" />)
    await screen.findByText('Compressor scroll 4TR')

    await user.click(screen.getByRole('button', { name: 'Dividir volumes' }))
    await user.click(screen.getByLabelText(/Quantidade por embalagem/))
    await user.type(screen.getByRole('spinbutton'), '6')
    expect(await screen.findByText(/4 etiqueta\(s\)/)).toBeInTheDocument()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Imprimir etiquetas' }))

    await waitFor(() => expect(printSplitReceiptIdentification).toHaveBeenCalledWith({
      id: 44,
      multiple: 6,
      printer: '__AGENT__:PC-LOG:Zebra P',
      username: 'operador',
    }))
  })

  it('shows and executes deletion only for jair.r', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<IdentifyProductScreen username="operador" />)
    await screen.findByText('Compressor scroll 4TR')
    expect(screen.queryByRole('button', { name: 'Excluir identificação de 07.MP.N.70005' })).not.toBeInTheDocument()

    rerender(<IdentifyProductScreen username="jair.r" />)
    await user.click(await screen.findByRole('button', { name: 'Excluir identificação de 07.MP.N.70005' }))
    await user.click(screen.getByRole('button', { name: 'Excluir identificação' }))

    await waitFor(() => expect(deleteReceiptIdentification).toHaveBeenCalledWith(44))
  })
})
