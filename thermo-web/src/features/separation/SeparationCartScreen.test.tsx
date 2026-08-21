import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SeparationCartScreen } from './SeparationCartScreen'
import * as gateway from '../../services/separationGateway'

vi.mock('../../services/separationGateway', () => ({
  clearSeparationCart: vi.fn(),
  loadSeparationActiveUsers: vi.fn(),
  loadSeparationCart: vi.fn(),
  loadSeparationStockLocations: vi.fn(),
  removeSeparationCartItem: vi.fn(),
  submitSeparation: vi.fn(),
  updateSeparationCartComment: vi.fn(),
  updateSeparationCartQuantity: vi.fn(),
  updateSeparationCartUrgency: vi.fn(),
}))

describe('SeparationCartScreen', () => {
  beforeEach(() => {
    vi.mocked(gateway.loadSeparationCart).mockResolvedValue({ ok: true, itens: [{ id: 31, codigo_produto: '07.MP.N.70005', descricao: 'Compressor scroll', unidade: 'UN', quantidade: '2', comentario: null, urgente: false, criado_em: '2026-08-21T10:00:00Z' }] })
    vi.mocked(gateway.loadSeparationActiveUsers).mockResolvedValue({ usuarios: [{ username: 'Jair' }] })
    vi.mocked(gateway.loadSeparationStockLocations).mockResolvedValue({ ok: true, fonte: 'db_local', locais: [{ codigo: '', descricao: 'Almoxarifado', codigo_local_estoque: '10717096386', padrao: true, inativo: false }] })
    vi.mocked(gateway.removeSeparationCartItem).mockResolvedValue({ ok: true })
    vi.mocked(gateway.clearSeparationCart).mockResolvedValue({ ok: true, deleted: 1 })
    vi.mocked(gateway.updateSeparationCartComment).mockResolvedValue({ ok: true })
    vi.mocked(gateway.updateSeparationCartQuantity).mockResolvedValue({ ok: true })
    vi.mocked(gateway.updateSeparationCartUrgency).mockResolvedValue({ ok: true })
    vi.mocked(gateway.submitSeparation).mockResolvedValue({ ok: true, total: 1, n_solic: 'SEP-1042', reutilizada: false })
  })

  it('renders real cart vocabulary and never removes before explicit confirmation', async () => {
    const user = userEvent.setup()
    render(<SeparationCartScreen />)

    expect(await screen.findByText('Compressor scroll')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remover item 07.MP.N.70005' }))

    expect(gateway.removeSeparationCartItem).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Remover item da lista?' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remover item' }))
    expect(gateway.removeSeparationCartItem).toHaveBeenCalledWith(31)
  })

  it('does not submit the cart until the user confirms the reviewed destination', async () => {
    const user = userEvent.setup()
    render(<SeparationCartScreen />)

    await screen.findByText('Compressor scroll')
    await user.click(screen.getByRole('button', { name: 'Enviar separação' }))
    expect(gateway.submitSeparation).not.toHaveBeenCalled()

    await user.click(within(screen.getByRole('alertdialog', { name: 'Enviar solicitação de separação?' })).getByRole('button', { name: 'Enviar separação' }))
    expect(gateway.submitSeparation).toHaveBeenCalledWith(expect.objectContaining({ solicitado_para: 'Jair', local_estoque: '10717096386' }))
  })
})
