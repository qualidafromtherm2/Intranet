import { afterEach, describe, expect, it, vi } from 'vitest'
import { approveAdjustment, createAdjustment, rejectAdjustment, validateAdjustment } from './stockAdjustmentGateway'

const input={tipo_operacao:'ENT' as const,local_estoque:'10717096386',local_nome:'Almoxarifado',data_movimentacao:'2026-08-21',solicitante:'jair.r',motivo:'INV',obs:'Diferença confirmada no inventário',itens:[{codigo:'01.MP.N.10000',descricao:'Produto',qtd:2,cmc:10,codigo_produto:123}]}
const response=(body:unknown)=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}})

describe('stockAdjustmentGateway',()=>{
  afterEach(()=>vi.unstubAllGlobals())
  it('valida tipo, motivo, justificativa e itens antes de qualquer escrita',()=>{expect(()=>validateAdjustment({...input,obs:''})).toThrow(/justificativa/);expect(()=>validateAdjustment({...input,itens:[]})).toThrow(/produto/);expect(()=>validateAdjustment({...input,motivo:'PER'})).toThrow(/incompatível/)})
  it('exige frase forte e preserva payload real da solicitação',async()=>{const f=vi.fn().mockResolvedValue(response({ok:true,registros:[]}));vi.stubGlobal('fetch',f);await expect(createAdjustment(input,'sim')).rejects.toThrow('SOLICITAR ENT');expect(f).not.toHaveBeenCalled();await createAdjustment(input,'SOLICITAR ENT');expect(f).toHaveBeenCalledWith('/api/ajustes',expect.objectContaining({method:'POST',body:JSON.stringify(input)}))})
  it('protege aprovação que executa na Omie',async()=>{const f=vi.fn().mockResolvedValue(response({ok:true,registro:{}}));vi.stubGlobal('fetch',f);await expect(approveAdjustment(42,'jair.r','EXECUTAR')).rejects.toThrow('EXECUTAR 42');expect(f).not.toHaveBeenCalled();await approveAdjustment(42,'jair.r','EXECUTAR 42');expect(JSON.parse(String(f.mock.calls[0]![1].body))).toEqual({aprovadoPor:'jair.r'})})
  it('exige justificativa e confirmação para reprovar',async()=>{const f=vi.fn().mockResolvedValue(response({ok:true,registro:{}}));vi.stubGlobal('fetch',f);await expect(rejectAdjustment(9,'jair.r','não','REPROVAR 9')).rejects.toThrow(/5 caracteres/);expect(f).not.toHaveBeenCalled();await rejectAdjustment(9,'jair.r','Contagem inconsistente','REPROVAR 9');expect(f.mock.calls[0]![0]).toBe('/api/ajustes/9/reprovar');expect(JSON.parse(String(f.mock.calls[0]![1].body))).toEqual({reprovadoPor:'jair.r',motivo:'Contagem inconsistente'})})
})
