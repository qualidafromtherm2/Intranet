import { describe,expect,it } from 'vitest'
import { classifyMinimumStock } from './minimumStockGateway'
describe('minimum stock metrics',()=>{it('classifies zero minimum separately',()=>expect(classifyMinimumStock({estoque_minimo:0,saldo:0})).toBe('sem-minimo'));it('classifies deficit and near threshold',()=>{expect(classifyMinimumStock({estoque_minimo:100,saldo_almox:80})).toBe('abaixo');expect(classifyMinimumStock({estoque_minimo:100,saldo_almox:108})).toBe('proximo');expect(classifyMinimumStock({estoque_minimo:100,saldo_almox:111})).toBe('acima')})})
