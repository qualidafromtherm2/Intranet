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
