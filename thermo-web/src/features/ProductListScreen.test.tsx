import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductListScreen } from './ProductListScreen'
import type { FiltersState, ProductRecord } from '../types'

const setFilters = vi.fn()
const setPage = vi.fn()
const reload = vi.fn()
const setViewMode = vi.fn()

const baseFilters: FiltersState = {
  search: '',
  families: [],
  typeItems: [],
  origins: [],
  purchaseStatus: [],
  locationCodes: [],
  showInactive: false,
  hideObsolete: false,
  hideEngineering: false,
  semEstoqueMin: false,
  abaixoEstoqueMin: false,
  acimaEstoqueMin: false,
  proximoEstoqueMin: false,
  proximoPercent: 10,
  estoqueNegativo: false,
  expedicaoNegativa: false,
  saldoEnderecoSemOmie: false,
  saldoDivergenteEndereco: false,
}

const baseProduct: ProductRecord = {
  codigo_produto: 1,
  codigo_produto_integracao: null,
  codigo: '4237',
  descricao: 'Produto sem foto',
  descricao_familia: null,
  unidade: 'UN',
  tipoitem: null,
  ncm: null,
  valor_unitario: null,
  quantidade_estoque: 1,
  estoque_minimo: 0,
  saldo_almox: 1,
  saldo_expedicao: 0,
  saldo_enderecado: 0,
  abaixo_minimo: false,
  estoque_negativo: false,
  expedicao_negativa: false,
  saldo_endereco_sem_omie: false,
  saldo_divergente_endereco: false,
  diferenca_saldo_endereco: 0,
  item_limitado: false,
  inativo: null,
  bloqueado: null,
  marca: null,
  modelo: null,
  dalt: null,
  halt: null,
  dinc: null,
  hinc: null,
  primeira_imagem: null,
  compraStatus: null,
  purchaseState: 'sem_compra',
  origemCodigo: null,
  tipoCodigo: null,
  imageUrl: null,
  locaisPositivos: [],
  isInactive: false,
  isObsolete: false,
  isEngineering: false,
}

let hookState = {
  filtered: [baseProduct],
  paginated: [baseProduct],
  loading: false,
  error: null as string | null,
  warnings: [] as string[],
  filters: baseFilters,
  setFilters,
  filtersMeta: {
    families: [{ value: 'Ferramentas', label: 'Ferramentas' }],
    typeItems: [{ value: 'MP', label: 'Matéria-prima' }],
    locations: [{ value: 'ALMOX', label: '#ALMOX' }],
  },
  page: 1,
  setPage,
  pageCount: 1,
  pageSize: 50,
  viewMode: 'grid' as const,
  setViewMode,
  cartCount: 0,
  streamEvents: [],
  dataMode: 'proxy' as const,
  reload,
  fetchedAt: Date.now(),
}

vi.mock('../hooks/usePilotData', () => ({
  usePilotData: () => hookState,
}))

describe('ProductListScreen', () => {
  beforeEach(() => {
    setFilters.mockClear()
    setPage.mockClear()
    reload.mockClear()
    setViewMode.mockClear()
    hookState = {
      ...hookState,
      filtered: [baseProduct],
      paginated: [baseProduct],
      loading: false,
      error: null,
      warnings: [],
      filters: { ...baseFilters },
      page: 1,
      pageCount: 1,
      viewMode: 'grid',
      cartCount: 0,
      streamEvents: [],
      dataMode: 'proxy',
      fetchedAt: Date.now(),
    }
  })

  it('renders neutral placeholder when product has no image and hides "Não comprado ainda"', () => {
    render(
      <ProductListScreen
        permissions={{
          canOpenCart: true,
          canOpenSeparation: true,
          canEditCatalog: true,
          cartReason: null,
          separationReason: null,
        }}
      />,
    )

    expect(screen.getByLabelText('Produto 4237 sem imagem')).toBeInTheDocument()
    expect(screen.queryByText('Não comprado ainda')).not.toBeInTheDocument()
  })

  it('restores draft filters on cancel and applies only after confirmation', async () => {
    const user = userEvent.setup()

    render(
      <ProductListScreen
        permissions={{
          canOpenCart: true,
          canOpenSeparation: true,
          canEditCatalog: true,
          cartReason: null,
          separationReason: null,
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: /filtrar produtos/i }))
    await user.click(screen.getByLabelText(/estoque negativo/i))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(setFilters).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /filtrar produtos/i }))
    expect(screen.getByLabelText(/estoque negativo/i)).not.toBeChecked()

    await user.click(screen.getByLabelText(/estoque negativo/i))
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect(setPage).toHaveBeenCalledWith(1)
    expect(setFilters).toHaveBeenCalledTimes(1)
    expect(setFilters.mock.calls[0][0]).toEqual({ ...baseFilters, estoqueNegativo: true })
  })

  it('clears draft filters without mutating applied filters before confirmation', async () => {
    const user = userEvent.setup()
    hookState = {
      ...hookState,
      filters: {
        ...baseFilters,
        estoqueNegativo: true,
        families: ['Ferramentas'],
      },
    }

    render(
      <ProductListScreen
        permissions={{
          canOpenCart: true,
          canOpenSeparation: true,
          canEditCatalog: true,
          cartReason: null,
          separationReason: null,
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: /filtrar produtos/i }))
    await user.click(screen.getAllByRole('button', { name: 'Limpar tudo' }).at(-1)!)
    expect(screen.getByLabelText(/estoque negativo/i)).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(setFilters).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /filtrar produtos/i }))
    expect(screen.getByLabelText(/estoque negativo/i)).toBeChecked()
  })
})
