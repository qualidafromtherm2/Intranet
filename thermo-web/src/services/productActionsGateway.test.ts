import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser, PermissionNode, ProductRecord } from '../types'
import {
  addProductToCart,
  deriveProductActionAccess,
  requestSeparation,
  saveProductMultiple,
} from './productActionsGateway'

const product = {
  codigo: '07.MP.N.70005',
  codigo_produto: 101,
  descricao: 'Abraçadeira de nylon',
  descricao_familia: 'Fixadores',
  unidade: 'UN',
  primeira_imagem: null,
} as ProductRecord

const user = {
  id: '1',
  username: 'supervisor.log',
  roles: [],
  setor: 'Logística',
  sector_id: 3,
  funcao_nome: 'Supervisor de Logística',
} as AuthUser

const nodes = [
  { key: 'system-shortcut:compras-carrinho', allowed: true },
  { key: 'system-shortcut:separacao-carrinho', allowed: true },
  { key: 'side:log:envio-mercadoria', allowed: true },
  { key: 'top:produto', allowed: true },
] as PermissionNode[]

describe('productActionsGateway', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('espelha as regras reais de permissão do menu legado', () => {
    const access = deriveProductActionAccess(user, nodes, {
      canOpenCart: false,
      canOpenSeparation: false,
      canEditCatalog: false,
      cartReason: null,
      separationReason: null,
    })

    expect(access.purchase).toBe(true)
    expect(access.separation).toBe(true)
    expect(access.dispatch).toBe(true)
    expect(access.quickEdit).toBe(true)
    expect(access.movement).toBe(true)
    expect(access.addresses).toBe(true)
    expect(access.stockAudit).toBe(false)
  })

  it('envia compra real com os mesmos campos padrão do catálogo legado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, id: 7 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await addProductToCart(product, 12)

    const [path, init] = fetchMock.mock.calls[0]!
    expect(path).toBe('/api/compras/carrinho')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({
      produto_codigo: product.codigo,
      produto_descricao: product.descricao,
      quantidade: 12,
      codigo_omie: 101,
      retorno_cotacao: 'Não',
      categoria_compra_codigo: '2.14.94',
      requisicao_direta: false,
    })
  })

  it('envia separação real com o payload do legado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, merged: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await requestSeparation(product, 5)

    const [path, init] = fetchMock.mock.calls[0]!
    expect(path).toBe('/api/logistica/separacao')
    expect(JSON.parse(String(init.body))).toEqual({
      codigo: product.codigo,
      descricao: product.descricao,
      quantidade: 5,
      unidade: 'UN',
    })
  })

  it('grava múltiplo real em vez de manter uma prévia sem efeito', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      codigo: product.codigo,
      multiplo: 20,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await saveProductMultiple(product.codigo, 20)

    const [path, init] = fetchMock.mock.calls[0]!
    expect(path).toBe(`/api/produtos/${encodeURIComponent(product.codigo)}/multiplo`)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({ multiplo: 20 })
  })
})
