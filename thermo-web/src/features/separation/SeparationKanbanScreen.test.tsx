import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SeparationKanbanScreen } from './SeparationKanbanScreen'
import * as gateway from '../../services/separationGateway'
import type { SeparationKanbanColumns } from './types'

vi.mock('../../services/separationGateway', () => ({
  completeSeparation: vi.fn(),
  loadSeparationItems: vi.fn(),
  loadSeparationKanban: vi.fn(),
  moveSeparationToAwaitingPickup: vi.fn(),
  startSeparation: vi.fn(),
}))

const emptyColumns = (): SeparationKanbanColumns => ({ Solicitado: [], 'Stund-by': [], 'Em Separação': [], Separado: [], 'Aguardando retirada': [], Concluído: [], Devolvido: [] })

describe('SeparationKanbanScreen', () => {
  beforeEach(() => {
    const colunas = emptyColumns()
    colunas.Solicitado = [{ n_solic: 'SEP-1042', nome_user: 'Jair', data_prevista: null, horario: null, total_itens: 1, criado_em_min: '2026-08-21T10:00:00Z', item_criado_em: '2026-08-21T10:00:00Z', usuario_separando: null, itens_busca: '70005 Compressor', tem_urgente: true, tem_em_compra: false, tem_pendente_sem_local: false, coluna: 'Solicitado' }]
    vi.mocked(gateway.loadSeparationKanban).mockResolvedValue({ ok: true, colunas })
    vi.mocked(gateway.loadSeparationItems).mockResolvedValue({ ok: true, itens: [{ carr_id: 31, solic_id: 91, status: 'pendente', observacao: null, motivo: 'Produção', cod_local: '10717096386', nome_local: 'Almoxarifado', usuario_separando: null, comentario_item: null, urgente: true, id_user: '10', codigo_produto: '07.MP.N.70005', descricao: 'Compressor', unidade: 'UN', quantidade: '2', quantidade_solicitada: null, quantidade_separada: null, omie_sep_origem: null, omie_sep_destino: null, omie_sep_qtd: null, etq_sep_endereco: null, etq_sep_qtd: null, etq_sep_detalhes: null, data_prevista: null, horario: null, criado_em: '2026-08-21T10:00:00Z', cod_omie: '1', nome_user: 'Jair', codigo_produto_ant: null, descricao_ant: null, codigo_produto_novo: null, descricao_novo: null, endereco_pp: [] }] })
    vi.mocked(gateway.startSeparation).mockResolvedValue({ ok: true, atualizados: 1 })
    vi.mocked(gateway.moveSeparationToAwaitingPickup).mockResolvedValue({ ok: true })
    vi.mocked(gateway.completeSeparation).mockResolvedValue({ ok: true })
  })

  it('covers all six requested labels and keeps stage mutations behind confirmation', async () => {
    const user = userEvent.setup()
    render(<SeparationKanbanScreen />)

    expect(await screen.findByText('SEP-1042')).toBeInTheDocument()
    for (const label of ['Solicitado', 'Stand-by', 'Separação', 'Separado', 'Aguardando retirada', 'Concluído']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(gateway.startSeparation).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Iniciar separação de SEP-1042' }))
    expect(await screen.findByRole('alertdialog', { name: 'Iniciar separação?' })).toBeInTheDocument()
    expect(gateway.startSeparation).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Iniciar separação' }))
    expect(gateway.startSeparation).toHaveBeenCalledWith([91])
  })
})
