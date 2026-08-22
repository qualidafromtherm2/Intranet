import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReceivingScreen } from './ReceivingScreen'
import * as gateway from '../../services/receivingGateway'

vi.mock('../../services/receivingGateway', async () => {
  const actual = await vi.importActual<typeof import('../../services/receivingGateway')>('../../services/receivingGateway')
  return { ...actual, loadPendingReceipts: vi.fn(), loadReceivedProducts: vi.fn(), locateNfe: vi.fn(), locatePurchaseOrder: vi.fn(), previewNfeAssociation: vi.fn(), confirmNfeAssociation: vi.fn(), loadActivePurchaseCategories: vi.fn() }
})

describe('ReceivingScreen states', () => {
  afterEach(() => vi.clearAllMocks())

  it('exibe permissão negada sem disparar leitura', () => {
    render(<ReceivingScreen allowed={false} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Acesso não permitido')
    expect(gateway.loadPendingReceipts).not.toHaveBeenCalled()
  })

  it('exibe vazio do recebimento depois do carregamento real', async () => {
    vi.mocked(gateway.loadPendingReceipts).mockResolvedValue([])
    render(<ReceivingScreen />)
    expect(await screen.findByText('Nenhum pedido aguardando recebimento.')).toBeInTheDocument()
  })

  it('distingue erro de rede do estado vazio', async () => {
    vi.mocked(gateway.loadPendingReceipts).mockRejectedValue(new Error('Backend indisponível.'))
    render(<ReceivingScreen />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Backend indisponível.'))
    expect(screen.getByText('Nenhum pedido aguardando recebimento.')).toBeInTheDocument()
  })

  it('exige remapeamento e nova prévia antes de habilitar confirmação', async () => {
    const user = userEvent.setup()
    vi.mocked(gateway.loadPendingReceipts).mockResolvedValue([{ id: 1, n_cod_ped: 42, cnumero: 'P-42', produto_codigo: 'A' }])
    vi.mocked(gateway.previewNfeAssociation).mockResolvedValue({ ok: true, preview: { itens_nf_total: 1, itens_sem_match_total: 1, itens: [{ n_sequencia: 1, nf_codigo_produto: 'NF-A', nf_qtde: 2, nf_unidade: 'UN', requer_revisao: true }], itens_pedido_informativos: [{ pedido_n_cod_item: 9, pedido_n_cod_ped: 42, pedido_codigo_produto: 'PED-A', pedido_qtde: 2, pedido_unidade: 'UN' }] } })
    render(<ReceivingScreen />)
    await user.click(await screen.findByRole('button', { name: 'Associar NF-e' })); await user.type(screen.getByLabelText('Número da NF-e'), '123'); await user.click(screen.getByRole('button', { name: 'Gerar prévia' }))
    const confirm = await screen.findByRole('button', { name: 'Confirmar associação' }); expect(confirm).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Item do pedido para sequência 1'), '9'); expect(confirm).toBeDisabled(); expect(screen.getByText(/Regenere a prévia/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Regerar prévia' })); await waitFor(()=>expect(screen.getByRole('button', { name: 'Confirmar associação' })).toBeEnabled()); expect(gateway.confirmNfeAssociation).not.toHaveBeenCalled()
  })

  it('localiza NF-e, ordena sugestões deterministicamente e abre a prévia do pedido escolhido', async () => {
    const user = userEvent.setup()
    vi.mocked(gateway.loadPendingReceipts).mockResolvedValue([])
    vi.mocked(gateway.locateNfe).mockResolvedValue({ ok: true, nfe: { c_numero_nfe: '372', c_nome_fornecedor: 'Fornecedor A', n_valor_nfe: 100, c_etapa: '40' }, itens: [{ codigo: 'A', descricao: 'Bomba calor', qtd: 1, unidade: 'UN', vlr_item: 100 }], pedidos_sugeridos: [{ n_cod_ped: 2, cnumero: 'P-2', fornecedor: 'Outro', itens: [{ produto_descricao: 'Item diferente', quantidade: 9, valor_item: 400 }] }, { n_cod_ped: 1, cnumero: 'P-1', fornecedor: 'Fornecedor A', itens: [{ n_cod_item: 11, produto_codigo: 'A', produto_descricao: 'Bomba calor', quantidade: 1, unidade: 'UN', valor_item: 100 }] }] })
    render(<ReceivingScreen />)
    await user.type(screen.getByPlaceholderText('Número ou chave da NF-e'), '372')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))
    const suggestions = await screen.findAllByRole('button', { name: /Pedido P-/ })
    expect(suggestions[0]).toHaveTextContent('Pedido P-1')
    await user.click(suggestions[0]!)
    expect(screen.getByRole('dialog', { name: 'Associar NF-e ao pedido P-1' })).toBeInTheDocument()
    expect(screen.getByLabelText('Número da NF-e')).toHaveValue('372')
  })

  it('mantém notas recebidas e concluídas somente para consulta', async () => {
    const user = userEvent.setup()
    vi.mocked(gateway.loadPendingReceipts).mockResolvedValue([])
    vi.mocked(gateway.locateNfe).mockResolvedValue({ ok: true, nfe: { c_numero_nfe: '10', c_recebido: 'S', c_etapa: '80' }, itens: [], pedidos_sugeridos: [{ n_cod_ped: 1, cnumero: 'P-1' }] })
    render(<ReceivingScreen />)
    await user.type(screen.getByPlaceholderText('Número ou chave da NF-e'), '10'); await user.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(await screen.findByText('Somente consulta')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pedido P-1/ })).not.toBeInTheDocument()
  })
})
