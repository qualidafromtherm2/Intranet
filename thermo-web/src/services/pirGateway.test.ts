import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decidePirEngineering, loadPirPending, registerPirInspection, setNecessaryEngineering } from './pirGateway'

const response = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } }))
beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => response({ ok: true, etiquetas: [] }))))

describe('pirGateway legacy contracts', () => {
  it('uses the real pending filters', async () => {
    await loadPirPending('ABC 10', 'eng')
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/etiquetas/recebimento/pendentes-pir?q=ABC+10&necessario_eng=1'), expect.objectContaining({ credentials: 'include' }))
  })
  it('sends inspection quantities with the real payload', async () => {
    await registerPirInspection({ cod_produto: 'MP1', nfe: '42', frequencia: '100%', quantidade_ok: 8, quantidade_nok: 2 })
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/qualidade/produtos-liberado'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ cod_produto: 'MP1', nfe: '42', frequencia: '100%', quantidade_ok: 8, quantidade_nok: 2 }) }))
  })
  it('persists engineering flag on receipt and product', async () => {
    await setNecessaryEngineering(9, 'MP/1', true)
    expect(fetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/etiquetas/recebimento/9/necessario-eng'), expect.objectContaining({ method: 'PATCH' }))
    expect(fetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/produtos/MP%2F1/pir-necessario-eng'), expect.objectContaining({ method: 'PUT' }))
  })
  it('records engineering audit before changing receipt status', async () => {
    await decidePirEngineering({ status: 'reprovado', codigo_produto: 'MP1', codigo: 'MP1', etq_recebimento_id: 9 })
    expect(fetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/engenharia/produto-aprovacao'), expect.objectContaining({ method: 'POST' }))
    expect(fetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/etiquetas/recebimento/9/pir-eng-status'), expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'reprovado' }) }))
  })
})
