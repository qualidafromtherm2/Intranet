import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PirScreen } from './PirScreen'
import * as gateway from '../../services/pirGateway'

vi.mock('../../services/pirGateway', () => ({ loadPirPending: vi.fn(), searchPirProducts: vi.fn(), registerPirInspection: vi.fn(), setProductCustom: vi.fn(), setNecessaryEngineering: vi.fn(), setDirectIdentification: vi.fn(), releasePirReceipt: vi.fn(), decidePirEngineering: vi.fn(), uploadProductPhoto: vi.fn(), loadPirReport: vi.fn(), loadPirCodes: vi.fn(), setPirVerification: vi.fn() }))
const item = { id: 7, lote: 'L-1', codigo_produto: 'MP1', descricao_produto: 'Matéria prima', numero_nfe: '55', qtd: 10, unidade: 'UN', necessario_eng: true }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(gateway.loadPirPending).mockResolvedValue({ etiquetas: [item], filtro: '' }); vi.mocked(gateway.decidePirEngineering).mockResolvedValue({ ok: true }); vi.mocked(gateway.registerPirInspection).mockResolvedValue({ ok: true, id: 1 }); vi.mocked(gateway.releasePirReceipt).mockResolvedValue({ ok: true }) })
describe('PirScreen safety', () => {
  it('loads PIR_ENG with the real flag and never mutates on view/open', async () => {
    const user=userEvent.setup(); render(<PirScreen/>); await screen.findByText(/Matéria prima/); await user.click(screen.getByRole('button',{name:/PIR_ENG/})); await waitFor(()=>expect(gateway.loadPirPending).toHaveBeenCalledWith('', 'eng')); await user.click(screen.getByRole('button',{name:'Inspecionar'})); expect(screen.getByRole('button',{name:'Aprovar produto'})).toBeDisabled(); expect(gateway.decidePirEngineering).not.toHaveBeenCalled()
  })
  it('requires strong confirmation before an engineering decision', async () => {
    const user=userEvent.setup(); render(<PirScreen/>); await screen.findByText(/Matéria prima/); await user.click(screen.getByRole('button',{name:/PIR_ENG/})); await user.click(await screen.findByRole('button',{name:'Inspecionar'})); await user.click(screen.getByText(/Confirmo código/)); await user.click(screen.getByRole('button',{name:'Projeto'})); await waitFor(()=>expect(gateway.decidePirEngineering).toHaveBeenCalledWith({status:'projeto',codigo_produto:'MP1',codigo:'MP1',etq_recebimento_id:7}))
  })
})
