import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { loadProduction3d } from '../../services/production3dGateway'
import type { Production3dItem } from './types'

export function Production3dScreen() {
  const [items, setItems] = useState<Production3dItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = async () => { setLoading(true); try { const result = await loadProduction3d(); setItems(result.itens); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao carregar Produção 3D.') } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  return <main className="mx-auto max-w-[1440px] space-y-4 p-3 sm:p-6"><header className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-cyan-700">Produção / Visualização</p><h1 className="text-2xl font-bold text-thermo-navy">Produção 3D</h1><p className="text-sm text-slate-600">Consulta somente leitura.</p></div><button className="thermo-button thermo-button-secondary" type="button" onClick={() => void load()} disabled={loading}><RefreshCw className="size-4"/>Atualizar</button></header>{error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}<section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((item) => <article className="rounded-lg border bg-white p-4" key={item.id}><h2 className="font-semibold">{item.codigo || 'Modelo sem código'}</h2><p className="text-sm">OP {item.n_op || '—'}</p><p className="text-sm text-slate-600">{item.descricao || 'Descrição não informada'}</p>{item.foto_url ? <a className="text-sky-700 underline" href={item.foto_url} target="_blank" rel="noreferrer">Abrir visualização</a> : <span className="text-sm text-slate-500">Sem visualização</span>}</article>)}{!loading && !items.length && <p className="col-span-full rounded border bg-white p-8 text-center text-slate-500">Nenhuma OP encontrada.</p>}</section></main>
}
