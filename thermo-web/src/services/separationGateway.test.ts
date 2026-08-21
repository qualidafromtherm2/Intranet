import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSeparationActionPreviews, loadSeparationCart, loadSeparationKanban, loadSeparationPermissions, loadSeparationRequests } from './separationGateway'

describe('separationGateway', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes permission and destinations from legacy endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: '12', username: 'jair.r' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        destino_padrao_codigo: '10717096386',
        destinos: [
          { codigo: '10717096386', descricao: 'Almoxarifado' },
          { codigo: '2', descricao: 'Expedição' },
        ],
      }), { status: 200 })))

    const data = await loadSeparationPermissions()

    expect(data.userId).toBe('12')
    expect(data.username).toBe('jair.r')
    expect(data.canRequest).toBe(true)
    expect(data.destinations).toHaveLength(2)
    expect(data.destinations[0]).toMatchObject({ code: '10717096386', isDefault: true })
  })

  it('normalizes cart, requests and kanban responses', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        itens: [{ id: 1, codigo_produto: '07.MP.N.70005', descricao: 'Abraçadeira', unidade: 'UN', quantidade: 10, urgente: true }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        grupos: [{
          n_solic: 'SEP-1001',
          status: 'pendente',
          nome_user: 'Jair.R',
          total_itens: 1,
          itens: [{ solic_id: 11, carr_id: 1, codigo_produto: '07.MP.N.70005', descricao: 'Abraçadeira', unidade: 'UN', quantidade: 10, status: 'pendente' }],
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        colunas: {
          pendente: [{ n_solic: 'SEP-1001', nome_user: 'Jair.R', itens: [{ solic_id: 11, carr_id: 1, codigo_produto: '07.MP.N.70005', descricao: 'Abraçadeira', unidade: 'UN', quantidade: 10, status: 'pendente' }] }],
          'Stund-by': [],
          'Separação': [],
          Separado: [],
          'Aguardando retirada': [],
          'Concluído': [],
        },
      }), { status: 200 })))

    const cart = await loadSeparationCart()
    const requests = await loadSeparationRequests()
    const kanban = await loadSeparationKanban()

    expect(cart[0]).toMatchObject({ codigoProduto: '07.MP.N.70005', urgente: true })
    expect(requests[0]).toMatchObject({ nSolic: 'SEP-1001', status: 'pendente', itensCount: 1 })
    expect(kanban.columns.pendente[0]?.nSolic).toBe('SEP-1001')
    expect(kanban.totalCards).toBe(1)
  })

  it('builds preview actions for mutable separation flows', () => {
    const actions = buildSeparationActionPreviews({
      nSolic: 'SEP-1009',
      status: 'Separação',
      statusLabel: 'Em Separação',
      nomeUser: 'Jair.R',
      totalItens: 1,
      itensCount: 1,
      dataPrevista: null,
      horario: null,
      criadoEm: null,
      atualizadoEm: null,
      itemCriadoEm: null,
      usuarioSeparando: 'jair.r',
      hasUrgent: false,
      hasPurchase: false,
      itemIds: [45],
      carrIds: [67],
      itens: [{
        solicId: 45,
        carrId: 67,
        idUser: '12',
        nomeUser: 'Jair.R',
        codigoProduto: '07.MP.N.70005',
        descricao: 'Abraçadeira',
        unidade: 'UN',
        quantidade: 10,
        status: 'Separação',
        comentario: null,
        urgente: false,
        nSolic: 'SEP-1009',
        dataPrevista: null,
        horario: null,
        itemCriadoEm: null,
        usuarioSeparando: 'jair.r',
        nomeLocal: 'Almox',
        codLocal: '10717096386',
        quantidadeSolicitada: null,
        quantidadeSeparada: null,
      }],
    })

    expect(actions.some((action) => action.endpoint === '/api/logistica/itens_solicitados/separar')).toBe(true)
    expect(actions.some((action) => action.endpoint === '/api/logistica/itens_solicitados/nao-separar')).toBe(true)
  })
})
