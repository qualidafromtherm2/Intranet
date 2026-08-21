import { ClipboardList, Columns3, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as gateway from '../../services/separationGateway'
import type { SeparationItem, SeparationKanbanCard, SeparationWorkflowStatus } from './types'
import { SeparationCartScreen } from './SeparationCartScreen'

type View = 'cart' | 'kanban'
const statuses: SeparationWorkflowStatus[] = ['Solicitado', 'Stund-by', 'Em Separação', 'Separado', 'Aguardando retirada', 'Concluído']
const active = new Set(['Separação', 'Em Separação', 'Separado'])
const norm = (value: unknown) => String(value || '').trim().toLocaleLowerCase('pt-BR')
const itemIds = (items: SeparationItem[]) => items.map((item) => Number(item.solic_id)).filter((id) => Number.isInteger(id) && id > 0)

function OperationalKanban() {
  const [cards, setCards] = useState<Partial<Record<SeparationWorkflowStatus, SeparationKanbanCard[]>>>({})
  const [operator, setOperator] = useState<gateway.SeparationOperatorContext | null>(null)
  const [selected, setSelected] = useState<{ card: SeparationKanbanCard; status: SeparationWorkflowStatus } | null>(null)
  const [items, setItems] = useState<SeparationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [board, context] = await Promise.all([gateway.loadSeparationKanban(), gateway.loadSeparationOperatorContext()])
      setCards(board.colunas || {}); setOperator(context)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao carregar a separação.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- synchronize with the filtered legacy API on mount
    void reload()
  }, [reload])

  const open = async (card: SeparationKanbanCard, status: SeparationWorkflowStatus) => {
    setBusy(true); setError(null)
    try { const data = await gateway.loadSeparationItems(card.n_solic, { includeDerived: true }); setItems(data.itens || []); setSelected({ card, status }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao abrir a SEP.') }
    finally { setBusy(false) }
  }
  const refreshItems = async () => {
    if (!selected) return
    const data = await gateway.loadSeparationItems(selected.card.n_solic, { includeDerived: true })
    setItems(data.itens || [])
  }
  const mutate = async (message: string, run: () => Promise<unknown>, close = false) => {
    setBusy(true); setError(null); setNotice(null)
    try { await run(); setNotice(message); if (close) setSelected(null); else await refreshItems(); await reload() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Operação recusada pelo backend legado.') }
    finally { setBusy(false) }
  }

  const owner = useMemo(() => items.find((item) => active.has(String(item.status)) && item.usuario_separando)?.usuario_separando || selected?.card.usuario_separando || '', [items, selected])
  const mine = Boolean(operator && owner && norm(owner) === norm(operator.username))
  const otherOwner = Boolean(operator && owner && norm(owner) !== norm(operator.username))
  const isAuthor = (item: SeparationItem) => Boolean(operator && String(item.id_user) === operator.id)
  const activeIds = itemIds(items.filter((item) => active.has(String(item.status))))

  const execution = (item: SeparationItem) => {
    const origin = window.prompt('Código do armazém de origem:', item.omie_sep_origem || '')?.trim()
    if (!origin) throw new Error('Selecione o armazém de origem antes de separar.')
    if (origin === '10717096386') throw new Error('Ação bloqueada: o armazém principal exige IDs/endereços ETQ; o leitor não pertence à fase THM-022.')
    return { solic_ids: [Number(item.solic_id)], carr_ids: [item.carr_id], cod_local_origem: origin, codigo_produto: item.codigo_produto }
  }
  const manual = async (item: SeparationItem) => {
    const raw = window.prompt(`Quantidade separada (${item.unidade || 'UN'}):`, String(item.quantidade_separada ?? item.quantidade_solicitada ?? item.quantidade))
    if (raw === null) return
    const quantidade = Number(raw.replace(',', '.')); const total = Number(item.quantidade_solicitada ?? item.quantidade)
    if (!(quantidade > 0)) return setError('Quantidade inválida.')
    const motivo = quantidade < total ? window.prompt('Motivo da separação parcial:', '')?.trim() : ''
    if (quantidade < total && !motivo) return setError('Informe o motivo da separação parcial.')
    const payload = { ...execution(item), carr_ids: [item.carr_id], quantidade_separada: quantidade, motivo: motivo || '' }
    await mutate('Quantidade manual registrada.', () => gateway.registerManualSeparationQuantity(payload))
  }
  const separate = async (item: SeparationItem, partial: boolean) => {
    const total = Number(item.quantidade_solicitada ?? item.quantidade)
    const raw = partial ? window.prompt(`Quantidade parcial (${item.unidade || 'UN'}):`, String(total)) : String(total)
    if (raw === null) return
    const quantidade = Number(raw.replace(',', '.')); if (!(quantidade > 0)) return setError('Quantidade inválida.')
    const motivo = partial ? window.prompt('Motivo da separação parcial:', '')?.trim() : ''
    if (partial && !motivo) return setError('Informe o motivo da separação parcial.')
    if (!window.confirm(`Confirmar baixa de ${quantidade} ${item.unidade || 'UN'}?`)) return
    const payload = execution(item)
    await mutate('Item separado.', () => partial ? gateway.separateItemPartially({ ...payload, carr_ids: [item.carr_id], quantidade_separada: quantidade, motivo: motivo || '' }) : gateway.separateItem(payload))
  }
  const decline = async (item: SeparationItem) => {
    const reason = window.prompt('Justificativa obrigatória para não separar:', '')?.trim()
    if (reason && window.confirm('Confirmar que este item não será separado?')) await mutate('Item não separado.', () => gateway.declineSeparationItem(Number(item.solic_id), reason))
  }
  const swap = async (item: SeparationItem) => {
    const query = window.prompt('Código ou descrição do substituto:', '')?.trim(); if (!query) return
    try {
      const options = (await gateway.searchSeparationProducts(query)).resultados || []
      const code = window.prompt(options.slice(0, 8).map((p) => `${p.codigo} — ${p.descricao}`).join('\n'), options[0]?.codigo)?.trim()
      const product = options.find((candidate) => candidate.codigo === code)
      if (!product || !window.confirm(`Trocar ${item.codigo_produto} por ${product.codigo}?`)) return
      await mutate('Produto trocado.', () => gateway.swapSeparationProduct({ solic_id: Number(item.solic_id), codigo_novo: product.codigo, descricao_novo: product.descricao || '', unidade_novo: product.unidade || 'UN', quantidade_nova: Number(item.quantidade_solicitada ?? item.quantidade) || null }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao trocar produto.') }
  }

  return <section>
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b-2 border-thermo-border pb-4"><div><div className="text-xs font-semibold uppercase tracking-[.12em] text-thermo-red">THM-022</div><h1 className="text-xl font-bold text-thermo-navy">Gateway operacional de separação</h1><p className="text-sm text-slate-600">Ações reais limitadas por estado, autoria e responsável.</p></div><button className="thermo-button thermo-button-secondary" disabled={busy || loading} onClick={() => void reload()} type="button"><RefreshCw className="size-4" />Atualizar</button></header>
    {operator ? <div className="mb-4 flex flex-wrap gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900"><ShieldCheck className="size-4" /><strong>{operator.username}</strong><span>{operator.restringir_destinos ? `Destinos: ${operator.destinos_chaves.join(', ') || 'nenhum'}` : 'Todos os destinos liberados'}</span></div> : null}
    {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</div> : null}{notice ? <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{notice}</div> : null}
    {loading ? <p className="rounded-md border bg-white p-8 text-center text-sm">Carregando…</p> : <div className="grid gap-3 lg:grid-cols-3 xl:grid-cols-6">{statuses.map((status) => <section className="rounded-md border bg-thermo-bg" key={status}><h2 className="border-b bg-white px-3 py-2 text-xs font-bold">{status} ({cards[status]?.length || 0})</h2><div className="space-y-2 p-2">{(cards[status] || []).map((card) => <button className="w-full rounded-md border bg-white p-3 text-left" key={card.n_solic} onClick={() => void open(card, status)} type="button"><span className="font-mono text-xs font-semibold">{card.n_solic}</span><span className="block truncate text-xs">{card.nome_user}</span>{card.usuario_separando ? <span className="block truncate text-[11px] text-amber-800">Responsável: {card.usuario_separando}</span> : null}</button>)}</div></section>)}</div>}
    {selected ? <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/55 sm:items-center sm:p-4"><section aria-modal="true" className="max-h-[94dvh] w-full overflow-y-auto rounded-t-[10px] bg-white p-4 sm:max-w-4xl sm:rounded-[10px]" role="dialog"><header className="mb-4 flex justify-between gap-3"><div><div className="font-mono text-xs text-thermo-red">{selected.card.n_solic}</div><h2 className="text-lg font-bold">Operação · {selected.status}</h2><p className="text-xs">Responsável: {owner || 'não assumida'} · Solicitante: {selected.card.nome_user}</p></div><button className="thermo-button thermo-button-secondary" onClick={() => setSelected(null)} type="button">Fechar</button></header>
      <div className="mb-3 flex flex-wrap gap-2">{['Solicitado', 'Stund-by'].includes(selected.status) ? <button className="thermo-button thermo-button-primary" disabled={busy} onClick={() => window.confirm(`Iniciar ${selected.card.n_solic}?`) && void mutate('Separação iniciada.', () => gateway.startSeparation(itemIds(items.filter((item) => ['pendente', 'Stund-by'].includes(String(item.status))))))} type="button">Iniciar separação</button> : null}{otherOwner && ['Em Separação', 'Separado'].includes(selected.status) ? <button className="thermo-button thermo-button-primary" onClick={() => window.confirm(`Assumir de ${owner}?`) && void mutate('Separação assumida.', () => gateway.assumeSeparation(activeIds))} type="button">Assumir separação</button> : null}{mine && ['Em Separação', 'Separado'].includes(selected.status) ? <button className="thermo-button border-red-300 text-red-700" onClick={() => window.confirm('Cancelar a separação?') && void mutate('Separação cancelada.', () => gateway.cancelSeparation(activeIds), true)} type="button">Cancelar separação</button> : null}{selected.status === 'Solicitado' && items.length > 0 && items.every(isAuthor) ? <button className="thermo-button border-red-300 text-red-700" onClick={() => window.confirm(`Excluir ${selected.card.n_solic} inteira?`) && void mutate('SEP excluída.', () => gateway.deleteSeparation(selected.card.n_solic), true)} type="button"><Trash2 className="size-4" />Excluir SEP</button> : null}</div>
      {otherOwner ? <p className="mb-3 rounded-md bg-amber-50 p-3 text-sm">Em andamento por <strong>{owner}</strong>. Assuma para alterar.</p> : null}
      <div className="space-y-3">{items.map((item) => { const status = String(item.status); const canOperate = mine && ['Separação', 'Em Separação'].includes(status); return <article className="rounded-md border p-3" key={`${item.solic_id}-${item.carr_id}`}><div className="flex justify-between gap-2"><div><div className="font-mono text-xs font-semibold">{item.codigo_produto}</div><div className="text-sm">{item.descricao || 'Sem descrição'}</div></div><span className="text-xs">{status}</span></div><div className="mt-3 flex flex-wrap gap-2">{canOperate ? <><button className="thermo-button thermo-button-secondary" onClick={() => void manual(item)} type="button">Quantidade manual</button><button className="thermo-button thermo-button-primary" onClick={() => void separate(item, false)} type="button">Separar total</button><button className="thermo-button thermo-button-secondary" onClick={() => void separate(item, true)} type="button">Separar parcial</button><button className="thermo-button thermo-button-secondary" onClick={() => void decline(item)} type="button">Não separar</button><button className="thermo-button thermo-button-secondary" onClick={() => void swap(item)} type="button">Trocar produto</button></> : null}{mine && status === 'Separado' ? <button className="thermo-button thermo-button-secondary" onClick={() => window.confirm('Reverter separação?') && void mutate('Separação revertida.', () => gateway.reverseSeparatedItem([Number(item.solic_id)]))} type="button">Reverter separação</button> : null}{mine && status === 'Aguardando retirada' ? <button className="thermo-button thermo-button-secondary" onClick={() => window.confirm('Reverter conferência?') && void mutate('Conferência revertida.', () => gateway.reverseCheckedItem([Number(item.solic_id)]))} type="button">Reverter conferência</button> : null}{selected.status === 'Solicitado' && isAuthor(item) ? <button className="thermo-button border-red-300 text-red-700" onClick={() => window.confirm('Remover item e devolver ao carrinho?') && void mutate('Item removido.', () => gateway.deleteSeparationItem(Number(item.solic_id)))} type="button">Excluir item</button> : null}</div></article> })}</div>
    </section></div> : null}
  </section>
}

export function SeparationWorkspace() {
  const [view, setView] = useState<View>('cart')
  return <div className="min-h-dvh bg-thermo-bg p-4 sm:p-6"><div className="mx-auto max-w-[1440px]"><nav aria-label="Frentes de separação" className="mb-5 inline-flex w-full rounded-[10px] border bg-white p-1 sm:w-auto"><button aria-current={view === 'cart' ? 'page' : undefined} className={`flex min-h-11 flex-1 items-center gap-2 rounded-md px-4 text-sm font-semibold ${view === 'cart' ? 'bg-thermo-navy text-white' : ''}`} onClick={() => setView('cart')} type="button"><ClipboardList className="size-4" />Lista / carrinho</button><button aria-current={view === 'kanban' ? 'page' : undefined} className={`flex min-h-11 flex-1 items-center gap-2 rounded-md px-4 text-sm font-semibold ${view === 'kanban' ? 'bg-thermo-navy text-white' : ''}`} onClick={() => setView('kanban')} type="button"><Columns3 className="size-4" />Kanban operacional</button></nav>{view === 'cart' ? <SeparationCartScreen /> : <OperationalKanban />}</div></div>
}
