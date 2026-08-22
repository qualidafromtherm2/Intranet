import { AlertCircle, Bolt, CheckCircle2, ClipboardList, RefreshCw, Save, Send, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  clearSeparationCart,
  loadSeparationActiveUsers,
  loadSeparationCart,
  loadSeparationStockLocations,
  removeSeparationCartItem,
  submitSeparation,
  updateSeparationCartComment,
  updateSeparationCartQuantity,
  updateSeparationCartUrgency,
} from '../../services/separationGateway'
import { ConfirmationDialog } from './ConfirmationDialog'
import type { SeparationCartItem, SeparationStockLocation, SubmitSeparationInput } from './types'

interface PendingConfirmation {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  action: () => Promise<void>
}

const quantityText = (value: number | string) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return String(value || '')
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(parsed)
}

const todayIso = () => {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export function SeparationCartScreen() {
  const [items, setItems] = useState<SeparationCartItem[]>([])
  const [users, setUsers] = useState<string[]>([])
  const [locations, setLocations] = useState<SeparationStockLocation[]>([])
  const [quantityDrafts, setQuantityDrafts] = useState<Record<number, string>>({})
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null)
  const [form, setForm] = useState<SubmitSeparationInput>({
    solicitado_para: '',
    local_estoque: '',
    local_estoque_nome: '',
    data_prevista: todayIso(),
    horario: '',
    observacao: '',
  })

  const hydrateDrafts = useCallback((nextItems: SeparationCartItem[]) => {
    setQuantityDrafts(Object.fromEntries(nextItems.map((item) => [item.id, quantityText(item.quantidade)])))
    setCommentDrafts(Object.fromEntries(nextItems.map((item) => [item.id, item.comentario || ''])))
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cartResponse, usersResponse, locationsResponse] = await Promise.all([
        loadSeparationCart(),
        loadSeparationActiveUsers(),
        loadSeparationStockLocations(),
      ])
      const nextItems = Array.isArray(cartResponse.itens) ? cartResponse.itens : []
      const nextUsers = (usersResponse.usuarios || []).map((user) => String(user.username || '').trim()).filter(Boolean)
      const nextLocations = (locationsResponse.locais || []).filter((location) => !location.inativo)
      setItems(nextItems)
      setUsers(nextUsers)
      setLocations(nextLocations)
      hydrateDrafts(nextItems)
      setForm((current) => {
        const defaultLocation = nextLocations.find((location) => location.padrao) || nextLocations[0]
        return {
          ...current,
          solicitado_para: current.solicitado_para || nextUsers[0] || '',
          local_estoque: current.local_estoque || defaultLocation?.codigo_local_estoque || '',
          local_estoque_nome: current.local_estoque_nome || defaultLocation?.descricao || '',
        }
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Falha ao carregar a lista de separação.')
    } finally {
      setLoading(false)
    }
  }, [hydrateDrafts])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- initial synchronization with the legacy API
    void reload()
  }, [reload])

  const selectedLocation = useMemo(
    () => locations.find((location) => location.codigo_local_estoque === form.local_estoque),
    [form.local_estoque, locations],
  )

  const execute = async (action: () => Promise<void>, successMessage: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      setNotice(successMessage)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Não foi possível concluir a ação.')
    } finally {
      setBusy(false)
    }
  }

  const saveQuantity = async (item: SeparationCartItem) => {
    const parsed = Number(String(quantityDrafts[item.id] || '').replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Informe uma quantidade maior que zero.')
      return
    }
    await execute(async () => {
      await updateSeparationCartQuantity(item.id, parsed)
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, quantidade: parsed } : entry)))
      setQuantityDrafts((current) => ({ ...current, [item.id]: quantityText(parsed) }))
    }, `Quantidade de ${item.codigo_produto} atualizada.`)
  }

  const saveComment = async (item: SeparationCartItem) => {
    const comentario = String(commentDrafts[item.id] || '').trim()
    await execute(async () => {
      await updateSeparationCartComment(item.id, comentario)
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, comentario } : entry)))
    }, comentario ? `Comentário de ${item.codigo_produto} salvo.` : `Comentário de ${item.codigo_produto} removido.`)
  }

  const toggleUrgency = async (item: SeparationCartItem) => {
    const urgente = !item.urgente
    await execute(async () => {
      await updateSeparationCartUrgency(item.id, urgente)
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, urgente } : entry)))
    }, urgente ? `${item.codigo_produto} marcado como urgente.` : `Urgência removida de ${item.codigo_produto}.`)
  }

  const requestRemove = (item: SeparationCartItem) => {
    setConfirmation({
      title: 'Remover item da lista?',
      description: `${item.codigo_produto} será removido do carrinho aberto. A ação só ocorre após esta confirmação.`,
      confirmLabel: 'Remover item',
      danger: true,
      action: async () => {
        await removeSeparationCartItem(item.id)
        setItems((current) => current.filter((entry) => entry.id !== item.id))
      },
    })
  }

  const requestClear = () => {
    setConfirmation({
      title: 'Limpar toda a lista?',
      description: `Os ${items.length} itens do carrinho aberto serão removidos.`,
      confirmLabel: 'Limpar lista',
      danger: true,
      action: async () => {
        await clearSeparationCart()
        setItems([])
      },
    })
  }

  const requestSubmit = () => {
    if (!form.solicitado_para || !form.local_estoque) {
      setError('Selecione o responsável pela retirada e o local de estoque.')
      return
    }
    setConfirmation({
      title: 'Enviar solicitação de separação?',
      description: `${items.length} ${items.length === 1 ? 'item será enviado' : 'itens serão enviados'} para ${form.solicitado_para}, com destino ${selectedLocation?.descricao || form.local_estoque_nome}.`,
      confirmLabel: 'Enviar separação',
      action: async () => {
        const response = await submitSeparation({
          ...form,
          local_estoque_nome: selectedLocation?.descricao || form.local_estoque_nome,
          observacao: form.observacao?.trim() || null,
          horario: form.horario || null,
        })
        setItems([])
        setNotice(`Separação ${response.n_solic} enviada com ${response.total} ${response.total === 1 ? 'item' : 'itens'}${response.reutilizada ? ' e unificada à SEP aberta.' : '.'}`)
      },
    })
  }

  const confirmAction = async () => {
    const pending = confirmation
    if (!pending) return
    await execute(pending.action, 'Ação concluída.')
    setConfirmation(null)
  }

  return (
    <section aria-labelledby="separation-cart-title" className="min-w-0">
      <header className="mb-4 flex flex-col gap-3 border-b-2 border-thermo-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-thermo-red"><ClipboardList className="size-4" />THM-010</div>
          <h1 className="text-xl font-bold text-thermo-navy" id="separation-cart-title">Lista de separação</h1>
          <p className="mt-1 text-sm text-slate-600">Revise quantidades, comentários, responsável e destino antes de enviar.</p>
        </div>
        <button className="thermo-button thermo-button-secondary min-h-11" disabled={loading || busy} onClick={() => void reload()} type="button">
          <RefreshCw className="size-4" />Atualizar
        </button>
      </header>

      {error ? <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</div> : null}
      {notice ? <div className="mb-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{notice}</div> : null}

      {loading ? <div className="rounded-[10px] border border-thermo-border bg-white px-5 py-12 text-center text-sm text-slate-500">Carregando lista real de separação…</div> : null}
      {!loading && items.length === 0 ? <div className="rounded-[10px] border border-dashed border-slate-300 bg-white px-5 py-12 text-center"><ClipboardList className="mx-auto size-7 text-slate-400" /><h2 className="mt-3 text-sm font-semibold text-thermo-navy">Lista vazia</h2><p className="mt-1 text-sm text-slate-500">Adicione produtos pela Lista de Produtos para preparar uma solicitação.</p></div> : null}

      {!loading && items.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,.75fr)]">
          <div className="space-y-3">
            {items.map((item) => (
              <article className={`rounded-[10px] border bg-white p-4 shadow-sm ${item.urgente ? 'border-l-4 border-l-thermo-red border-y-thermo-border border-r-thermo-border' : 'border-thermo-border'}`} key={item.id}>
                <div className="flex flex-col gap-4 md:flex-row md:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-thermo-navy">{item.codigo_produto}</span>
                      {item.urgente ? <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700"><Bolt className="size-3" />Urgente</span> : null}
                    </div>
                    <h2 className="mt-1 break-words text-sm font-semibold text-thermo-ink">{item.descricao || 'Produto sem descrição'}</h2>
                    <div className="mt-4 grid gap-3 lg:grid-cols-[13rem_minmax(0,1fr)]">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Quantidade
                        <div className="mt-1 flex items-center gap-2">
                          <input
                            aria-label={`Quantidade de ${item.codigo_produto}`}
                            className="min-h-11 min-w-0 flex-1 rounded-md border border-slate-300 px-3 font-mono text-sm focus:border-thermo-navy focus:outline-none focus:ring-2 focus:ring-thermo-navy/15"
                            inputMode="decimal"
                            onChange={(event) => setQuantityDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                            value={quantityDrafts[item.id] ?? ''}
                          />
                          <span className="text-sm font-medium text-slate-500">{item.unidade || 'UN'}</span>
                          <button aria-label={`Salvar quantidade de ${item.codigo_produto}`} className="thermo-icon-button" disabled={busy} onClick={() => void saveQuantity(item)} type="button"><Save className="size-4" /></button>
                        </div>
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Comentário do item
                        <div className="mt-1 flex items-start gap-2">
                          <textarea
                            aria-label={`Comentário de ${item.codigo_produto}`}
                            className="min-h-11 min-w-0 flex-1 resize-y rounded-md border border-slate-300 px-3 py-2 text-sm normal-case tracking-normal focus:border-thermo-navy focus:outline-none focus:ring-2 focus:ring-thermo-navy/15"
                            onChange={(event) => setCommentDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                            rows={2}
                            value={commentDrafts[item.id] ?? ''}
                          />
                          <button aria-label={`Salvar comentário de ${item.codigo_produto}`} className="thermo-icon-button" disabled={busy} onClick={() => void saveComment(item)} type="button"><Save className="size-4" /></button>
                        </div>
                      </label>
                    </div>
                  </div>
                  <div className="flex gap-2 md:flex-col">
                    <button className="thermo-button thermo-button-secondary min-h-11" disabled={busy} onClick={() => void toggleUrgency(item)} type="button"><Bolt className="size-4" />{item.urgente ? 'Remover urgência' : 'Marcar urgente'}</button>
                    <button aria-label={`Remover item ${item.codigo_produto}`} className="thermo-button border-red-200 bg-white text-red-700 hover:bg-red-50" disabled={busy} onClick={() => requestRemove(item)} type="button"><Trash2 className="size-4" />Remover</button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <aside className="h-fit rounded-[10px] border border-thermo-border bg-white p-4 shadow-sm xl:sticky xl:top-4">
            <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-sm font-bold text-thermo-navy">Dados da retirada</h2><span className="rounded-full bg-thermo-bg px-2.5 py-1 text-xs font-semibold text-slate-600">{items.length} {items.length === 1 ? 'item' : 'itens'}</span></div>
            <div className="space-y-4">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Responsável pela retirada
                <select className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-thermo-navy focus:outline-none focus:ring-2 focus:ring-thermo-navy/15" onChange={(event) => setForm((current) => ({ ...current, solicitado_para: event.target.value }))} value={form.solicitado_para}><option value="">Selecione</option>{users.map((user) => <option key={user} value={user}>{user}</option>)}</select>
              </label>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Local de estoque
                <select className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-thermo-navy focus:outline-none focus:ring-2 focus:ring-thermo-navy/15" onChange={(event) => { const location = locations.find((entry) => entry.codigo_local_estoque === event.target.value); setForm((current) => ({ ...current, local_estoque: event.target.value, local_estoque_nome: location?.descricao || '' })) }} value={form.local_estoque}><option value="">Selecione</option>{locations.map((location) => <option key={location.codigo_local_estoque} value={location.codigo_local_estoque}>{location.descricao}</option>)}</select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Data prevista<input className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm focus:border-thermo-navy focus:outline-none focus:ring-2 focus:ring-thermo-navy/15" onChange={(event) => setForm((current) => ({ ...current, data_prevista: event.target.value || null }))} type="date" value={form.data_prevista || ''} /></label>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Horário<input className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm focus:border-thermo-navy focus:outline-none focus:ring-2 focus:ring-thermo-navy/15" onChange={(event) => setForm((current) => ({ ...current, horario: event.target.value || null }))} type="time" value={form.horario || ''} /></label>
              </div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Observação geral<textarea className="mt-1 min-h-24 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm normal-case tracking-normal focus:border-thermo-navy focus:outline-none focus:ring-2 focus:ring-thermo-navy/15" onChange={(event) => setForm((current) => ({ ...current, observacao: event.target.value }))} value={form.observacao || ''} /></label>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <button className="thermo-button border-red-200 bg-white text-red-700 hover:bg-red-50" disabled={busy} onClick={requestClear} type="button"><Trash2 className="size-4" />Limpar lista</button>
                <button className="thermo-button thermo-button-primary" disabled={busy} onClick={requestSubmit} type="button"><Send className="size-4" />Enviar separação</button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      <ConfirmationDialog
        busy={busy}
        confirmLabel={confirmation?.confirmLabel || 'Confirmar'}
        danger={confirmation?.danger}
        description={confirmation?.description || ''}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirmAction()}
        open={Boolean(confirmation)}
        title={confirmation?.title || ''}
      />
    </section>
  )
}
