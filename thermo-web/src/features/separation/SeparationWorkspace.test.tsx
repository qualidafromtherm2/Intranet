import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SeparationWorkspace } from './SeparationWorkspace'

vi.mock('../../services/separationGateway', () => ({
  SEPARATION_COLUMN_ORDER: ['pendente', 'Stund-by', 'Separação', 'Separado', 'Aguardando retirada', 'Concluído'],
  SEPARATION_COLUMN_LABELS: {
    pendente: 'Solicitado',
    'Stund-by': 'Stund-by',
    'Separação': 'Em Separação',
    Separado: 'Separado',
    'Aguardando retirada': 'Aguardando retirada',
    'Concluído': 'Concluído',
  },
  loadSeparationPermissions: vi.fn(async () => ({
    userId: '12',
    username: 'jair.r',
    canRequest: true,
    reason: null,
    destinations: [{ code: '10717096386', label: 'Almoxarifado', isDefault: true }],
  })),
  loadSeparationCart: vi.fn(async () => ([
    { id: 1, codigoProduto: '07.MP.N.70005', descricao: 'Abraçadeira', unidade: 'UN', quantidade: 10, comentario: null, urgente: true, dataPrevista: null, horario: null, retiradaPor: null, nomeUser: 'jair.r' },
  ])),
  loadSeparationRequests: vi.fn(async () => ([
    {
      nSolic: 'SEP-1001',
      status: 'pendente',
      statusLabel: 'Solicitado',
      nomeUser: 'Jair.R',
      totalItens: 1,
      itensCount: 1,
      dataPrevista: null,
      horario: null,
      criadoEm: null,
      atualizadoEm: null,
      itemCriadoEm: null,
      usuarioSeparando: null,
      hasUrgent: true,
      hasPurchase: false,
      itemIds: [11],
      carrIds: [1],
      itens: [{ solicId: 11, carrId: 1, idUser: '12', nomeUser: 'Jair.R', codigoProduto: '07.MP.N.70005', descricao: 'Abraçadeira', unidade: 'UN', quantidade: 10, status: 'pendente', comentario: null, urgente: true, nSolic: 'SEP-1001', dataPrevista: null, horario: null, itemCriadoEm: null, usuarioSeparando: null, nomeLocal: null, codLocal: null, quantidadeSolicitada: null, quantidadeSeparada: null }],
    },
  ])),
  loadSeparationKanban: vi.fn(async () => ({
    totalCards: 1,
    columns: {
      pendente: [{
        nSolic: 'SEP-1001',
        status: 'pendente',
        statusLabel: 'Solicitado',
        nomeUser: 'Jair.R',
        totalItens: 1,
        itensCount: 1,
        dataPrevista: null,
        horario: null,
        criadoEm: null,
        atualizadoEm: null,
        itemCriadoEm: null,
        usuarioSeparando: null,
        hasUrgent: false,
        hasPurchase: false,
        itemIds: [11],
        carrIds: [1],
        itens: [],
      }],
      'Stund-by': [],
      'Separação': [],
      Separado: [],
      'Aguardando retirada': [],
      'Concluído': [],
    },
  })),
  loadSeparationItems: vi.fn(async () => ({
    itens: [{ solicId: 11, carrId: 1, idUser: '12', nomeUser: 'Jair.R', codigoProduto: '07.MP.N.70005', descricao: 'Abraçadeira', unidade: 'UN', quantidade: 10, status: 'pendente', comentario: null, urgente: true, nSolic: 'SEP-1001', dataPrevista: null, horario: null, itemCriadoEm: null, usuarioSeparando: null, nomeLocal: null, codLocal: null, quantidadeSolicitada: null, quantidadeSeparada: null }],
    itensDerivados: [],
  })),
  buildSeparationActionPreviews: vi.fn(() => ([{
    id: 'iniciar',
    title: 'Iniciar separação',
    method: 'PATCH',
    endpoint: '/api/logistica/itens_solicitados/separacao',
    confirmation: 'Confirme o início.',
    payload: { solic_ids: [11] },
    statusTarget: 'Separação',
  }])),
  summarizeRequest: vi.fn(() => 'Solicitado · 1 item(ns) · Sem prazo'),
}))

describe('SeparationWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders requests and opens preview modal', async () => {
    render(<SeparationWorkspace />)

    await waitFor(() => expect(screen.getByText('Lista, carrinho e kanban reais de Separação')).toBeInTheDocument())
    expect(screen.getByText('SEP-1001')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /1 ação\(ões\)/i }))

    await waitFor(() => expect(screen.getByText(/Preview de ação/i)).toBeInTheDocument())
    expect(screen.getByText('/api/logistica/itens_solicitados/separacao')).toBeInTheDocument()
  })

  it('switches to cart tab and shows cart row', async () => {
    render(<SeparationWorkspace />)
    await waitFor(() => expect(screen.getByText('Lista, carrinho e kanban reais de Separação')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Carrinho/i }))

    expect(screen.getByText('Abraçadeira')).toBeInTheDocument()
    expect(screen.getByText('Urgente')).toBeInTheDocument()
  })
})
