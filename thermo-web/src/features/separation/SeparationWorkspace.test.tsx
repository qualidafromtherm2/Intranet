import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as gateway from '../../services/separationGateway'
import { SeparationWorkspace } from './SeparationWorkspace'
import type { SeparationItem, SeparationKanbanCard } from './types'

vi.mock('./SeparationCartScreen', () => ({ SeparationCartScreen: () => <div>Carrinho real</div> }))
vi.mock('../../services/separationGateway', async (original) => ({ ...(await original<typeof import('../../services/separationGateway')>()), loadSeparationKanban: vi.fn(), loadSeparationOperatorContext: vi.fn(), loadSeparationItems: vi.fn(), assumeSeparation: vi.fn(), cancelSeparation: vi.fn(), startSeparation: vi.fn(), deleteSeparation: vi.fn(), deleteSeparationItem: vi.fn() }))

const card = (status: SeparationKanbanCard['coluna'], owner: string | null = null): SeparationKanbanCard => ({ n_solic: `SEP-${status}`, nome_user: 'Solicitante', data_prevista: null, horario: null, total_itens: 1, criado_em_min: null, item_criado_em: null, usuario_separando: owner, itens_busca: null, tem_urgente: false, tem_em_compra: false, tem_pendente_sem_local: false, coluna: status })
const item = (status: string, owner: string | null, author = '7'): SeparationItem => ({ carr_id: 31, solic_id: 91, status, observacao: null, motivo: null, cod_local: '10', nome_local: 'Expedição', usuario_separando: owner, comentario_item: null, urgente: false, id_user: author, codigo_produto: 'PROD-1', descricao: 'Produto', unidade: 'UN', quantidade: 2, quantidade_solicitada: 2, quantidade_separada: null, omie_sep_origem: null, omie_sep_destino: null, omie_sep_qtd: null, etq_sep_endereco: null, etq_sep_qtd: null, etq_sep_detalhes: null, data_prevista: null, horario: null, criado_em: null, cod_omie: '1', nome_user: 'Solicitante', codigo_produto_ant: null, descricao_ant: null, codigo_produto_novo: null, descricao_novo: null, endereco_pp: [] })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(gateway.loadSeparationOperatorContext).mockResolvedValue({ id: '7', username: 'Jair', restringir_destinos: true, destinos_codigos: ['10'], destinos_chaves: ['10|Expedição'] })
  vi.mocked(gateway.loadSeparationKanban).mockResolvedValue({ ok: true, colunas: { Solicitado: [card('Solicitado')], 'Em Separação': [card('Em Separação', 'Outro')] } as never })
})

describe('SeparationWorkspace operational permissions', () => {
  it('starts in cart and exposes the collaborator destination scope', async () => {
    render(<SeparationWorkspace />)
    expect(screen.getByText('Carrinho real')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Kanban operacional' }))
    expect(await screen.findByText('Destinos: 10|Expedição')).toBeInTheDocument()
  })

  it('allows assuming another operator but hides item mutations until ownership changes', async () => {
    vi.mocked(gateway.loadSeparationItems).mockResolvedValue({ ok: true, itens: [item('Em Separação', 'Outro')] })
    render(<SeparationWorkspace />); fireEvent.click(screen.getByRole('button', { name: 'Kanban operacional' }))
    fireEvent.click(await screen.findByRole('button', { name: /SEP-Em Separação/ }))
    expect(await screen.findByRole('button', { name: 'Assumir separação' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Separar total' })).not.toBeInTheDocument()
  })

  it('shows destructive delete actions only to the author in Solicitado', async () => {
    vi.mocked(gateway.loadSeparationItems).mockResolvedValue({ ok: true, itens: [item('pendente', null)] })
    render(<SeparationWorkspace />); fireEvent.click(screen.getByRole('button', { name: 'Kanban operacional' }))
    fireEvent.click(await screen.findByRole('button', { name: /SEP-Solicitado/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Excluir SEP' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Excluir item' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancelar separação' })).not.toBeInTheDocument()
  })
})
