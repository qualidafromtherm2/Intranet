import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReceivingScreen } from './ReceivingScreen'
import * as gateway from '../../services/receivingGateway'

vi.mock('../../services/receivingGateway', async () => {
  const actual = await vi.importActual<typeof import('../../services/receivingGateway')>('../../services/receivingGateway')
  return { ...actual, loadPendingReceipts: vi.fn(), loadReceivedProducts: vi.fn() }
})

describe('ReceivingScreen states', () => {
  afterEach(() => vi.clearAllMocks())

  it('exibe permissão negada sem disparar leitura', () => {
    render(<ReceivingScreen allowed={false} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Acesso não permitido')
    expect(gateway.loadPendingReceipts).not.toHaveBeenCalled()
  })

  it('exibe vazio do recebimento depois do carregamento real', async () => {
    vi.mocked(gateway.loadPendingReceipts).mockResolvedValue([])
    render(<ReceivingScreen />)
    expect(await screen.findByText('Nenhum pedido aguardando recebimento.')).toBeInTheDocument()
  })

  it('distingue erro de rede do estado vazio', async () => {
    vi.mocked(gateway.loadPendingReceipts).mockRejectedValue(new Error('Backend indisponível.'))
    render(<ReceivingScreen />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Backend indisponível.'))
    expect(screen.getByText('Nenhum pedido aguardando recebimento.')).toBeInTheDocument()
  })
})
