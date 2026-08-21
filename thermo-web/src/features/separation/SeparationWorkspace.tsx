import { AlertCircle, CheckCircle2, ClipboardCheck, Layers3, LoaderCircle, PackageSearch, ShieldAlert, ShoppingBasket, TimerReset, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ModalShell } from '../../components/ModalShell'
import { quantity, relativeLabel } from '../../lib/format'
import {
  buildSeparationActionPreviews,
  loadSeparationCart,
  loadSeparationItems,
  loadSeparationKanban,
  loadSeparationPermissions,
  loadSeparationRequests,
  type SeparationActionPreview,
  type SeparationCartItem,
  type SeparationColumnKey,
  type SeparationKanbanBoard,
  type SeparationPermissionSummary,
  type SeparationRequestCard,
  SEPARATION_COLUMN_LABELS,
  SEPARATION_COLUMN_ORDER,
  summarizeRequest,
} from '../../services/separationGateway'

type SectionKey = 'cart' | 'requests' | 'kanban'

function toneByStatus(status: SeparationColumnKey) {
  switch (status) {
    case 'pendente':
      return 'border-sky-200 bg-sky-50 text-sky-900'
    case 'Stund-by':
      return 'border-pink-200 bg-pink-50 text-pink-900'
    case 'Separação':
      return 'border-amber-200 bg-amber-50 text-amber-900'
    case 'Separado':
      return 'border-emerald-200 bg-emerald-50 text-emerald-900'
    case 'Aguardando retirada':
      return 'border-violet-200 bg-violet-50 text-violet-900'
    default:
      return 'border-slate-200 bg-slate-100 text-slate-800'
  }
}

function EmptyBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-thermo-border bg-white px-5 py-10 text-center">
      <PackageSearch className="mx-auto size-10 text-slate-400" />
      <div className="mt-3 text-base font-bold text-thermo-navy">{title}</div>
      <p className="mt-2 text-sm text-slate-500">{body}</p>
    </div>
  )
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-thermo-border bg-white px-5 py-10 text-center text-sm text-slate-500">
      <LoaderCircle className="mx-auto mb-3 size-8 animate-spin text-thermo-navy" />
      {label}
    </div>
  )
}

function ErrorBlock({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-5 text-sm text-red-800">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-bold">Falha ao carregar Separação</div>
          <div className="mt-2 whitespace-pre-wrap">{error}</div>
          <button className="thermo-button thermo-button-primary mt-4" type="button" onClick={onRetry}>
            Tentar novamente
          </button>
        </div>
      </div>
    </div>
  )
}

function RequestBadge({ card }: { card: SeparationRequestCard }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${toneByStatus(card.status)}`}>
      {card.statusLabel}
    </span>
  )
}

function RequestCard({
  card,
  onOpenItems,
  onPreviewActions,
}: {
  card: SeparationRequestCard
  onOpenItems: (card: SeparationRequestCard) => void
  onPreviewActions: (card: SeparationRequestCard) => void
}) {
  const actions = buildSeparationActionPreviews(card)
  return (
    <article className="rounded-2xl border border-thermo-border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-xs font-semibold text-slate-500">{card.nSolic}</div>
          <h3 className="mt-1 text-base font-bold text-thermo-navy">{card.nomeUser}</h3>
          <p className="mt-1 text-sm text-slate-500">{summarizeRequest(card)}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <RequestBadge card={card} />
          {card.hasUrgent ? <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700">Urgente</span> : null}
          {card.hasPurchase ? <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-700">Em compra</span> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-thermo-border bg-thermo-bg px-3 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Prazo</div>
          <div className="mt-1 text-sm font-semibold text-thermo-ink">{card.dataPrevista ? relativeLabel(card.dataPrevista) : 'Sem prazo'}</div>
        </div>
        <div className="rounded-xl border border-thermo-border bg-thermo-bg px-3 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Horário</div>
          <div className="mt-1 text-sm font-semibold text-thermo-ink">{card.horario || 'Não informado'}</div>
        </div>
        <div className="rounded-xl border border-thermo-border bg-thermo-bg px-3 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Itens</div>
          <div className="mt-1 text-sm font-semibold text-thermo-ink">{card.itensCount} item(ns)</div>
        </div>
        <div className="rounded-xl border border-thermo-border bg-thermo-bg px-3 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Separador</div>
          <div className="mt-1 text-sm font-semibold text-thermo-ink">{card.usuarioSeparando || 'Ainda livre'}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="thermo-button thermo-button-secondary" type="button" onClick={() => onOpenItems(card)}>
          <Layers3 className="size-4" />
          Ver itens reais
        </button>
        <button className="thermo-button thermo-button-secondary" type="button" onClick={() => onPreviewActions(card)} disabled={actions.length === 0}>
          <ClipboardCheck className="size-4" />
          {actions.length === 0 ? 'Sem ações mutáveis' : `${actions.length} ação(ões)`}
        </button>
      </div>
    </article>
  )
}

function CartTable({ rows }: { rows: SeparationCartItem[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-thermo-border bg-white">
      <table className="min-w-full border-collapse text-sm">
        <thead className="bg-thermo-bg text-left text-[10px] uppercase tracking-[0.14em] text-slate-500">
          <tr>
            <th className="px-4 py-3">Código</th>
            <th className="px-4 py-3">Descrição</th>
            <th className="px-4 py-3">Quantidade</th>
            <th className="px-4 py-3">Prazo</th>
            <th className="px-4 py-3">Retirada</th>
            <th className="px-4 py-3">Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.id} className="border-t border-thermo-border">
              <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-600">{item.codigoProduto}</td>
              <td className="px-4 py-3">
                <div className="font-semibold text-thermo-navy">{item.descricao}</div>
                {item.comentario ? <div className="mt-1 text-xs text-slate-500">{item.comentario}</div> : null}
              </td>
              <td className="px-4 py-3 font-mono text-slate-700">{quantity(item.quantidade, item.unidade)}</td>
              <td className="px-4 py-3 text-slate-600">{item.dataPrevista ? relativeLabel(item.dataPrevista) : 'Sem prazo'}</td>
              <td className="px-4 py-3 text-slate-600">{item.retiradaPor || item.nomeUser || '—'}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  {item.urgente ? <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700">Urgente</span> : null}
                  {item.horario ? <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700">{item.horario}</span> : null}
                  {!item.urgente && !item.horario ? '—' : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function KanbanColumn({
  status,
  cards,
  onOpenItems,
  onPreviewActions,
}: {
  status: SeparationColumnKey
  cards: SeparationRequestCard[]
  onOpenItems: (card: SeparationRequestCard) => void
  onPreviewActions: (card: SeparationRequestCard) => void
}) {
  return (
    <section className="rounded-2xl border border-thermo-border bg-white shadow-sm">
      <header className={`flex items-center justify-between gap-3 rounded-t-2xl border-b px-4 py-3 ${toneByStatus(status)}`}>
        <div className="font-bold">{SEPARATION_COLUMN_LABELS[status]}</div>
        <div className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-bold">{cards.length}</div>
      </header>
      <div className="space-y-3 p-3">
        {cards.length === 0 ? <div className="rounded-xl border border-dashed border-thermo-border px-3 py-6 text-center text-sm text-slate-400">Nenhuma SEP</div> : null}
        {cards.map((card) => (
          <div key={`${status}-${card.nSolic}`} className="rounded-xl border border-thermo-border bg-thermo-bg p-3">
            <div className="font-mono text-[11px] font-semibold text-slate-500">{card.nSolic}</div>
            <div className="mt-1 text-sm font-bold text-thermo-navy">{card.nomeUser}</div>
            <div className="mt-1 text-xs text-slate-500">{card.itensCount} item(ns) · {card.dataPrevista ? relativeLabel(card.dataPrevista) : 'Sem prazo'}</div>
            {card.usuarioSeparando ? <div className="mt-2 text-xs text-slate-500">Separando: <strong>{card.usuarioSeparando}</strong></div> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="thermo-button thermo-button-secondary px-3 py-1.5 text-xs" type="button" onClick={() => onOpenItems(card)}>
                Ver itens
              </button>
              <button className="thermo-button thermo-button-secondary px-3 py-1.5 text-xs" type="button" onClick={() => onPreviewActions(card)} disabled={buildSeparationActionPreviews(card).length === 0}>
                Ações
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function SeparationWorkspace() {
  const [section, setSection] = useState<SectionKey>('requests')
  const [permissions, setPermissions] = useState<SeparationPermissionSummary | null>(null)
  const [cart, setCart] = useState<SeparationCartItem[]>([])
  const [requests, setRequests] = useState<SeparationRequestCard[]>([])
  const [kanban, setKanban] = useState<SeparationKanbanBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCard, setSelectedCard] = useState<SeparationRequestCard | null>(null)
  const [selectedItems, setSelectedItems] = useState<{ loading: boolean; rows: SeparationRequestCard['itens'] }>({ loading: false, rows: [] })
  const [previewAction, setPreviewAction] = useState<SeparationActionPreview | null>(null)

  const totals = useMemo(() => ({
    cart: cart.length,
    requests: requests.length,
    kanban: kanban?.totalCards || 0,
  }), [cart.length, requests.length, kanban?.totalCards])

  async function loadAll() {
    setLoading(true)
    setError(null)
    try {
      const [permissionData, cartData, requestData, kanbanData] = await Promise.all([
        loadSeparationPermissions(),
        loadSeparationCart(),
        loadSeparationRequests(),
        loadSeparationKanban(),
      ])
      setPermissions(permissionData)
      setCart(cartData)
      setRequests(requestData)
      setKanban(kanbanData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido ao carregar Separação.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAll()
  }, [])

  async function openItems(card: SeparationRequestCard) {
    setSelectedCard(card)
    setSelectedItems({ loading: true, rows: [] })
    try {
      const response = await loadSeparationItems(card.nSolic, { includeDerivados: true })
      setSelectedItems({ loading: false, rows: [...response.itens, ...response.itensDerivados] })
    } catch {
      setSelectedItems({ loading: false, rows: card.itens })
    }
  }

  function openPreviewActions(card: SeparationRequestCard) {
    const previews = buildSeparationActionPreviews(card)
    setSelectedCard(card)
    setPreviewAction(previews[0] || null)
  }

  const tabs: Array<{ id: SectionKey; label: string; count: number; icon: typeof ShoppingBasket }> = [
    { id: 'cart', label: 'Carrinho', count: totals.cart, icon: ShoppingBasket },
    { id: 'requests', label: 'Solicitado', count: totals.requests, icon: ClipboardCheck },
    { id: 'kanban', label: 'Kanban', count: totals.kanban, icon: Layers3 },
  ]

  return (
    <div className="space-y-6">
      <header className="rounded-[1.5rem] border border-thermo-border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Logística · Separação</div>
            <h1 className="mt-2 text-2xl font-bold text-thermo-navy">Lista, carrinho e kanban reais de Separação</h1>
            <p className="mt-2 max-w-4xl text-sm text-slate-500">
              Esta frente usa os contratos atuais de `/api/logistica/carrinho`, `/api/logistica/solicitacoes-kanban`, `/api/logistica/kanban` e `/api/logistica/kanban/itens`.
              As ações mutáveis permanecem em modo preview com confirmação, sem execução automática neste QA.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="thermo-button thermo-button-secondary" type="button" onClick={() => void loadAll()}>
              <TimerReset className="size-4" />
              Atualizar
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Permissão atual</div>
            <div className="mt-2 text-sm font-semibold text-thermo-ink">{permissions?.canRequest ? 'Separação liberada' : 'Separação bloqueada'}</div>
            <div className="mt-1 text-xs text-slate-500">{permissions?.reason || 'Sem bloqueio informado pelo legado.'}</div>
          </div>
          <div className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Usuário</div>
            <div className="mt-2 text-sm font-semibold text-thermo-ink">{permissions?.username || 'Sessão não identificada'}</div>
            <div className="mt-1 text-xs text-slate-500">{permissions?.userId || 'Sem userId'}</div>
          </div>
          <div className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Destinos liberados</div>
            <div className="mt-2 text-sm font-semibold text-thermo-ink">{permissions?.destinations.length || 0} destino(s)</div>
            <div className="mt-1 text-xs text-slate-500">
              {permissions?.destinations.find((destination) => destination.isDefault)?.label || 'Sem destino padrão informado'}
            </div>
          </div>
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-red-500">Mutações</div>
            <div className="mt-2 text-sm font-semibold text-red-700">Preview apenas</div>
            <div className="mt-1 text-xs text-red-600">Os botões mostram endpoint, payload e confirmação; o piloto não executa alterações.</div>
          </div>
        </div>

        {!permissions?.canRequest ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-5 shrink-0" />
              <div>
                <div className="font-bold">Permissão restrita para solicitar separação</div>
                <div className="mt-1">{permissions?.reason || 'O backend não liberou a ação para a sessão atual.'}</div>
              </div>
            </div>
          </div>
        ) : null}
      </header>

      <nav className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              className={`thermo-chip ${section === tab.id ? 'thermo-chip-active' : ''}`}
              type="button"
              onClick={() => setSection(tab.id)}
            >
              <Icon className="size-4" />
              {tab.label}
              <span className="rounded-full bg-black/6 px-2 py-0.5 text-[11px] font-bold">{tab.count}</span>
            </button>
          )
        })}
      </nav>

      {loading ? <LoadingBlock label="Carregando carrinho, solicitações e kanban reais…" /> : null}
      {!loading && error ? <ErrorBlock error={error} onRetry={() => void loadAll()} /> : null}

      {!loading && !error && section === 'cart' ? (
        cart.length ? <CartTable rows={cart} /> : <EmptyBlock title="Carrinho de separação vazio" body="Nenhum item aberto no carrinho do usuário atual." />
      ) : null}

      {!loading && !error && section === 'requests' ? (
        requests.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {requests.map((card) => (
              <RequestCard key={card.nSolic} card={card} onOpenItems={openItems} onPreviewActions={openPreviewActions} />
            ))}
          </div>
        ) : (
          <EmptyBlock title="Nenhuma SEP em aberto" body="A consulta em /api/logistica/solicitacoes-kanban não retornou grupos ativos." />
        )
      ) : null}

      {!loading && !error && section === 'kanban' ? (
        kanban ? (
          <div className="grid gap-4 xl:grid-cols-3">
            {SEPARATION_COLUMN_ORDER.map((status) => (
              <KanbanColumn key={status} status={status} cards={kanban.columns[status]} onOpenItems={openItems} onPreviewActions={openPreviewActions} />
            ))}
          </div>
        ) : (
          <EmptyBlock title="Kanban indisponível" body="O backend não retornou colunas do kanban." />
        )
      ) : null}

      <ModalShell
        open={Boolean(selectedCard) && previewAction == null}
        title={selectedCard ? `Itens reais · ${selectedCard.nSolic}` : 'Itens reais'}
        description={selectedCard ? `Dados de /api/logistica/kanban/itens para ${selectedCard.statusLabel}.` : undefined}
        onClose={() => {
          setSelectedCard(null)
          setSelectedItems({ loading: false, rows: [] })
        }}
        panelStyle={{ width: 'min(96vw, 50rem)', maxWidth: '50rem' }}
      >
        {selectedItems.loading ? <LoadingBlock label="Carregando itens detalhados…" /> : null}
        {!selectedItems.loading && selectedItems.rows.length === 0 ? <EmptyBlock title="Sem itens detalhados" body="O legado não retornou itens para esta SEP." /> : null}
        {!selectedItems.loading && selectedItems.rows.length > 0 ? (
          <div className="space-y-3">
            {selectedItems.rows.map((item) => (
              <article key={`${item.solicId}-${item.carrId}`} className="rounded-xl border border-thermo-border bg-thermo-bg px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs font-semibold text-slate-500">{item.codigoProduto}</div>
                    <div className="mt-1 text-base font-bold text-thermo-navy">{item.descricao}</div>
                    <div className="mt-1 text-sm text-slate-500">{item.status} · {quantity(item.quantidade, item.unidade)}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.urgente ? <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700">Urgente</span> : null}
                    {item.usuarioSeparando ? <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">{item.usuarioSeparando}</span> : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">SEP</div><div className="mt-1 text-sm text-thermo-ink">{item.nSolic || 'Sem número'}</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Prazo</div><div className="mt-1 text-sm text-thermo-ink">{item.dataPrevista ? relativeLabel(item.dataPrevista) : 'Sem prazo'}</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Horário</div><div className="mt-1 text-sm text-thermo-ink">{item.horario || 'Não informado'}</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Destino</div><div className="mt-1 text-sm text-thermo-ink">{item.nomeLocal || item.codLocal || 'Sem destino'}</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Qtd solicitada</div><div className="mt-1 text-sm text-thermo-ink">{item.quantidadeSolicitada != null ? quantity(item.quantidadeSolicitada, item.unidade) : '—'}</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Qtd separada</div><div className="mt-1 text-sm text-thermo-ink">{item.quantidadeSeparada != null ? quantity(item.quantidadeSeparada, item.unidade) : '—'}</div></div>
                  {item.comentario ? <div className="md:col-span-2"><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Comentário</div><div className="mt-1 text-sm text-thermo-ink">{item.comentario}</div></div> : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </ModalShell>

      <ModalShell
        open={Boolean(previewAction)}
        title={previewAction ? `Preview de ação · ${previewAction.title}` : 'Preview de ação'}
        description={selectedCard ? `SEP ${selectedCard.nSolic} · ${selectedCard.statusLabel}` : undefined}
        onClose={() => {
          setPreviewAction(null)
        }}
        panelStyle={{ width: 'min(96vw, 44rem)', maxWidth: '44rem' }}
      >
        {previewAction ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              <div className="flex items-start gap-3">
                <TriangleAlert className="mt-0.5 size-5 shrink-0" />
                <div>
                  <div className="font-bold">Mutação bloqueada neste QA</div>
                  <div className="mt-1">
                    O piloto mostra endpoint, payload e confirmação para validação funcional. A execução real continua desabilitada até integração controlada.
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-thermo-border bg-thermo-bg px-4 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Método</div>
                <div className="mt-1 text-sm font-semibold text-thermo-ink">{previewAction.method}</div>
              </div>
              <div className="rounded-xl border border-thermo-border bg-thermo-bg px-4 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Status alvo</div>
                <div className="mt-1 text-sm font-semibold text-thermo-ink">{previewAction.statusTarget || 'Sem mudança de status'}</div>
              </div>
            </div>

            <div className="rounded-xl border border-thermo-border bg-thermo-bg px-4 py-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Endpoint real</div>
              <div className="mt-2 font-mono text-sm text-thermo-navy">{previewAction.endpoint}</div>
            </div>

            <div className="rounded-xl border border-thermo-border bg-thermo-bg px-4 py-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Confirmação exigida</div>
              <div className="mt-2 text-sm text-thermo-ink">{previewAction.confirmation}</div>
            </div>

            <div className="rounded-xl border border-thermo-border bg-slate-950 px-4 py-4 text-sm text-slate-100">
              <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Payload previsto</div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">{JSON.stringify(previewAction.payload, null, 2)}</pre>
            </div>

            <div className="flex flex-wrap gap-2">
              <button className="thermo-button thermo-button-secondary" type="button" onClick={() => setPreviewAction(null)}>
                Fechar preview
              </button>
              <button className="thermo-button border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100" type="button" disabled>
                {previewAction.destructive ? <TriangleAlert className="size-4" /> : <CheckCircle2 className="size-4" />}
                Execução bloqueada no piloto
              </button>
            </div>
          </div>
        ) : null}
      </ModalShell>
    </div>
  )
}
