import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser, ProductRecord } from '../../types'
import type { ProductActionAccess } from '../../services/productActionsGateway'
import { ProductActionsPanel } from './ProductActionsPanel'

const gateway = vi.hoisted(() => ({
  addProductToCart: vi.fn(),
  loadProductActionContext: vi.fn(),
  loadProductMultiple: vi.fn(),
  requestSeparation: vi.fn(),
}))

vi.mock('../../services/productActionsGateway', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/productActionsGateway')>(),
  ...gateway,
}))

const product = {
  codigo_produto: 101,
  codigo: '07.MP.N.70005',
  descricao: 'Abraçadeira de nylon',
  unidade: 'UN',
} as ProductRecord

const user = {
  id: '1',
  username: 'supervisor.log',
  roles: [],
  setor: 'Logística',
  sector_id: 3,
  funcao_nome: 'Supervisor de Logística',
} as AuthUser

const access: ProductActionAccess = {
  purchase: true,
  separation: true,
  movement: false,
  dispatch: true,
  information: true,
  quickEdit: true,
  latestPurchases: true,
  addresses: true,
  movementHistory: true,
  stockAudit: true,
  manualReceipt: true,
  identificationHistory: true,
  manuals: true,
  reasons: { movement: 'Somente supervisores autorizados.' },
}

const permissions = {
  canOpenCart: true,
  canOpenSeparation: true,
  canEditCatalog: true,
  cartReason: null,
  separationReason: null,
}

describe('ProductActionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateway.loadProductActionContext.mockResolvedValue({ user, nodes: [], access })
    gateway.addProductToCart.mockResolvedValue({ ok: true, id: 7 })
    gateway.loadProductMultiple.mockResolvedValue({ ok: true, codigo: product.codigo, multiplo: 5 })
    gateway.requestSeparation.mockResolvedValue({ ok: true, merged: false })
  })

  it('expõe as 13 ações reais e bloqueia a opção sem permissão', async () => {
    render(<ProductActionsPanel open product={product} permissions={permissions} onClose={vi.fn()} onChanged={vi.fn()} />)

    const labels = [
      'Compra',
      'Separação',
      'Movimentação',
      'Expedição',
      'Informações',
      'Editar produto',
      'Últimas compras',
      'Endereços',
      'Histórico de movimentação',
      'Auditar saldo no endereço',
      'Recebimento sem NF-e',
      'Histórico de identificações',
      'Manual de instrução',
    ]

    for (const label of labels) expect(await screen.findByText(label)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Movimentação/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Movimentação/ })).toHaveAttribute('title', 'Somente supervisores autorizados.')
  })

  it('registra compra com a quantidade informada e atualiza a lista', async () => {
    const onChanged = vi.fn()
    const interaction = userEvent.setup()
    render(<ProductActionsPanel open product={product} permissions={permissions} onClose={vi.fn()} onChanged={onChanged} />)

    await interaction.click(await screen.findByRole('button', { name: /^Compra/ }))
    await interaction.type(screen.getByLabelText('Quantidade'), '12')
    await interaction.click(screen.getByRole('button', { name: 'Adicionar ao carrinho' }))

    await waitFor(() => expect(gateway.addProductToCart).toHaveBeenCalledWith(product, 12))
    expect(onChanged).toHaveBeenCalledOnce()
    expect(screen.getByText('Produto adicionado ao carrinho de compras.')).toBeInTheDocument()
  })

  it('carrega o múltiplo real e registra a separação', async () => {
    const onChanged = vi.fn()
    const interaction = userEvent.setup()
    render(<ProductActionsPanel open product={product} permissions={permissions} onClose={vi.fn()} onChanged={onChanged} />)

    await interaction.click(await screen.findByRole('button', { name: /^Separação/ }))
    expect(await screen.findByDisplayValue('5')).toBeInTheDocument()
    await interaction.type(screen.getByLabelText('Quantidade'), '10')
    await interaction.click(screen.getByRole('button', { name: 'Enviar separação' }))

    await waitFor(() => expect(gateway.requestSeparation).toHaveBeenCalledWith(product, 10))
    expect(onChanged).toHaveBeenCalledOnce()
    expect(screen.getByText('Separação registrada com sucesso.')).toBeInTheDocument()
  })
})
