import { describe, expect, it } from 'vitest'
import { buildNavigationCatalog } from './navigation'
import type { PermissionNode } from '../types'

function node(overrides: Partial<PermissionNode> & Pick<PermissionNode, 'id' | 'key' | 'label'>): PermissionNode {
  return {
    parent_id: null,
    pos: 'side',
    sort: 0,
    allowed: true,
    user_override: null,
    selector: null,
    ...overrides,
  }
}

describe('buildNavigationCatalog', () => {
  it('treats migrated screens as leaves and hides internal form fields', () => {
    const catalog = buildNavigationCatalog([
      node({ id: 1, key: 'side:produtos', label: 'Produtos' }),
      node({ id: 2, parent_id: 1, key: 'product-create', label: 'Cadastrar Produto', selector: '#menu-produto' }),
      node({ id: 3, parent_id: 2, key: 'product-data', label: 'Dados do produto' }),
      node({ id: 4, parent_id: 2, key: 'product-photos', label: 'Fotos' }),
    ])

    const products = catalog.sections.find((section) => section.key === 'side:produtos')
    expect(products?.children.map((item) => item.label)).toEqual(['Cadastrar Produto'])
    expect(products?.children[0]?.children).toEqual([])
  })

  it('does not duplicate the fixed Home entry with the legacy top Inicio item', () => {
    const catalog = buildNavigationCatalog([
      node({ id: 10, key: 'home', label: 'Início', pos: 'top', selector: '#menu-inicio' }),
      node({ id: 11, key: 'internal-field', label: 'Dados do produto', pos: 'top', selector: '#tab-dados-produto' }),
      node({ id: 12, key: 'product-create', label: 'Cadastrar Produto', pos: 'top', selector: '#menu-produto' }),
    ])

    expect(catalog.sections.find((section) => section.key === 'top')?.children.map((item) => item.label)).toEqual(['Cadastrar Produto'])
  })

  it('removes migrated top shortcuts when the same destination already exists in a module', () => {
    const catalog = buildNavigationCatalog([
      node({ id: 30, key: 'product-list-shortcut', label: 'Lista de produtos', pos: 'top', sort: 1, selector: '#btn-omie-list1' }),
      node({ id: 31, key: 'side:produtos', label: 'Produtos', sort: 2 }),
      node({ id: 32, parent_id: 31, key: 'product-list-module', label: 'Lista de produtos', sort: 1, selector: '#menu-lista-produtos' }),
    ])

    expect(catalog.sections.find((section) => section.key === 'top')).toBeUndefined()
    expect(catalog.sections.find((section) => section.key === 'side:produtos')?.children.map((item) => item.label)).toEqual(['Lista de produtos'])
  })

  it('deduplicates alias entries for the same migrated screen and preserves access if any alias is allowed', () => {
    const catalog = buildNavigationCatalog([
      node({ id: 40, key: 'side:log', label: 'Logística' }),
      node({ id: 41, parent_id: 40, key: 'store-materials-main', label: 'Guardar materiais', sort: 1, selector: '#menu-guardar-materiais', allowed: false }),
      node({ id: 42, parent_id: 40, key: 'store-materials-exp', label: 'Guardar materiais (Expedição)', sort: 2, selector: '#menu-guardar-materiais-expedicao', allowed: true }),
      node({ id: 43, parent_id: 40, key: 'identify-main', label: 'Identificação', sort: 3, selector: '#menu-identificacao-produto', allowed: true }),
      node({ id: 44, parent_id: 40, key: 'identify-exp', label: 'Identificação (Expedição)', sort: 4, selector: '#menu-identificacao-produto-expedicao', allowed: false }),
    ])

    const logistics = catalog.sections.find((section) => section.key === 'side:log')
    expect(logistics?.children.map((item) => item.label)).toEqual(['Guardar materiais', 'Identificação'])
    expect(logistics?.children.map((item) => item.allowed)).toEqual([true, true])
    expect(catalog.selectorMap.get('#menu-guardar-materiais')?.map((item) => item.id)).toEqual([41])
    expect(catalog.selectorMap.get('#menu-guardar-materiais-expedicao')?.map((item) => item.id)).toEqual([42])
    expect(catalog.selectorMap.get('#menu-identificacao-produto')?.map((item) => item.id)).toEqual([43])
    expect(catalog.selectorMap.get('#menu-identificacao-produto-expedicao')?.map((item) => item.id)).toEqual([44])
  })

  it('keeps receiving and products received as separate destinations', () => {
    const catalog = buildNavigationCatalog([
      node({ id: 50, key: 'side:log', label: 'Logística' }),
      node({ id: 51, parent_id: 50, key: 'receiving', label: 'Recebimento', sort: 1, selector: '#menu-recebimento' }),
      node({ id: 52, parent_id: 50, key: 'received-products', label: 'Produtos recebidos', sort: 2, selector: '#menu-produto-recebido' }),
    ])

    expect(catalog.sections.find((section) => section.key === 'side:log')?.children.map((item) => item.view)).toEqual(['receiving', 'products-received'])
  })

  it('keeps real non-migrated destinations visible while hiding empty metadata leaves', () => {
    const catalog = buildNavigationCatalog([
      node({ id: 20, key: 'side:produtos', label: 'Produtos' }),
      node({ id: 21, parent_id: 20, key: 'legacy-route', label: 'Tela legada', selector: '#menu-ainda-nao-migrado' }),
      node({ id: 22, parent_id: 20, key: 'metadata', label: 'Campo interno' }),
    ])

    const products = catalog.sections.find((section) => section.key === 'side:produtos')
    expect(products?.children.map((item) => item.label)).toEqual(['Tela legada'])
    expect(products?.children[0]?.migrationStatus).toBe('pending')
  })
})
