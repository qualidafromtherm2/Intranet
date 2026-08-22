import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as gateway from '../../services/separationGateway'
import { RequesterSeparationScreen } from './RequesterSeparationScreen'

vi.mock('../../services/separationGateway', async (original) => ({ ...(await original<typeof import('../../services/separationGateway')>()), loadRequesterSeparationKanban: vi.fn(), loadSeparationItems: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(gateway.loadRequesterSeparationKanban).mockResolvedValue({ ok: true, colunas: { carrinho: [], pendente: [{ n_solic: 'SEP-32', nome_user: 'Jair', data_prevista: null, horario: null, total_itens: 1, criado_em_min: null, item_criado_em: null, usuario_separando: null, itens_busca: 'Produto', tem_urgente: false, tem_em_compra: false, tem_pendente_sem_local: false, coluna: 'Solicitado' }], 'Stund-by': [], Separação: [], Separado: [], 'Aguardando retirada': [], Concluído: [], Devolvido: [] } })
  vi.mocked(gateway.loadSeparationItems).mockResolvedValue({ ok: true, itens: [] })
})

describe('RequesterSeparationScreen', () => {
  it('uses the session-scoped board and exposes all seven read-only states', async () => {
    render(<RequesterSeparationScreen />)
    expect(await screen.findByText('SEP-32')).toBeInTheDocument()
    expect(gateway.loadRequesterSeparationKanban).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: /Devolvido/ })).toBeInTheDocument()
    fireEvent.click(screen.getByText('SEP-32'))
    expect(await screen.findByText('Esta visão é somente para acompanhamento. Operações físicas ficam na aba Tela de separação.')).toBeInTheDocument()
  })
})
