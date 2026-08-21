import { render,screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach,describe,expect,it,vi } from 'vitest'
import { WarehouseScreen } from './WarehouseScreen'
import * as gateway from '../../services/warehouseGateway'
vi.mock('../../services/warehouseGateway',()=>({loadWarehouseLocations:vi.fn(),loadMovementPermission:vi.fn(),loadWarehouseStock:vi.fn(),requestTransfer:vi.fn(),requestAdjustment:vi.fn()}))
beforeEach(()=>{vi.clearAllMocks();vi.mocked(gateway.loadWarehouseLocations).mockResolvedValue({ok:true,locais:[{codigo:'#A',codigo_local_estoque:'1',descricao:'Origem'},{codigo:'#B',codigo_local_estoque:'2',descricao:'Destino'}]});vi.mocked(gateway.loadMovementPermission).mockResolvedValue({ok:true,regra:null});vi.mocked(gateway.loadWarehouseStock).mockResolvedValue({ok:true,local:'1',dados:[{codigo:'MP1',descricao:'Peça',saldo:5,cmc:2,codOmie:99}]});vi.mocked(gateway.requestTransfer).mockResolvedValue({ok:true})})
describe('WarehouseScreen safety',()=>{
 it('loads read-only stock without mutation',async()=>{render(<WarehouseScreen username="ana"/>);expect(await screen.findByText(/MP1/)).toBeInTheDocument();expect(gateway.requestTransfer).not.toHaveBeenCalled();expect(gateway.requestAdjustment).not.toHaveBeenCalled()})
 it('requires distinct destination, valid item and explicit confirmation',async()=>{const u=userEvent.setup();render(<WarehouseScreen username="ana"/>);await screen.findByText(/MP1/);await u.click(screen.getByRole('button',{name:'Transferência'}));await u.click(screen.getByRole('button',{name:'Adicionar'}));const submit=screen.getByRole('button',{name:'Solicitar transferência'});expect(submit).toBeDisabled();await u.selectOptions(screen.getByLabelText('Destino'),'2');expect(submit).toBeDisabled();await u.click(screen.getByText(/Confirmo locais/));expect(submit).toBeEnabled();expect(gateway.requestTransfer).not.toHaveBeenCalled()})
})
