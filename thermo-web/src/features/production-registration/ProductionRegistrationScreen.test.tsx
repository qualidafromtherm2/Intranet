import { render,screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach,describe,expect,it,vi } from 'vitest'
import { ProductionRegistrationScreen,productionColumn } from './ProductionRegistrationScreen'
import * as gateway from '../../services/productionRegistrationGateway'
vi.mock('../../services/productionRegistrationGateway',()=>({loadProductionSnapshot:vi.fn(),loadStopReasons:vi.fn(),startProduction:vi.fn(),finishProductionStep:vi.fn(),moveProductionBack:vi.fn(),linkSaleOrder:vi.fn(),createProductionStop:vi.fn(),resumeProduction:vi.fn()}))
beforeEach(()=>{vi.clearAllMocks();vi.mocked(gateway.loadProductionSnapshot).mockResolvedValue({orders:[{id:7,identificacao:'OP7',quantidade:2,produto:{identificacao:'PA1',descricao:'Produto'}}],sales:[],programs:[],riByOrder:{},stopsByOrder:{},occurrencesByOrder:{},timesByOrder:{}});vi.mocked(gateway.loadStopReasons).mockResolvedValue({success:true,motivos:[]})})
describe('production registration rules',()=>{
 it('maps the seven proven states',()=>{expect(['','Montagem hermética','Montagem elétrica','Teste','Teste final','Embalagem','Finalizado'].map(status=>productionColumn({id:1,status}))).toEqual(['programado','solicitado','produzindo','teste','inspecao_final','embalagem','finalizado'])})
 it('never writes while loading or opening an OP and requires strong confirmation',async()=>{const u=userEvent.setup();render(<ProductionRegistrationScreen username="ana"/>);await u.click(await screen.findByRole('button',{name:/OP OP7/}));const submit=screen.getByRole('button',{name:'Confirmar apontamento'});expect(submit).toBeDisabled();await u.click(screen.getByText('Iniciar produção'));expect(submit).toBeDisabled();expect(gateway.startProduction).not.toHaveBeenCalled()})
 it('does not read when permission is denied',()=>{render(<ProductionRegistrationScreen allowed={false}/>);expect(screen.getByRole('alert')).toHaveTextContent('Acesso não permitido');expect(gateway.loadProductionSnapshot).not.toHaveBeenCalled()})
})
