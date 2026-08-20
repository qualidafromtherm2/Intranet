import { clsx } from 'clsx'
import {
  Bot,
  Boxes,
  ChartColumn,
  ChevronRight,
  ExternalLink,
  Factory,
  Folder,
  Headset,
  Home,
  Lock,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings2,
  ShoppingCart,
  ShieldCheck,
  Users,
  Warehouse,
  Wrench,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ModalShell } from './components/ModalShell'
import { ProductListScreen } from './features/ProductListScreen'
import { getPilotDataCacheState, prefetchPilotData } from './hooks/usePilotData'
import { buildNavigationCatalog, isSelectorAllowed } from './lib/navigation'
import { buildLegacyUrl, getAuthStatus, getPermissionTree, login, logout } from './services/authGateway'
import { loadRecentActivity, loadRemindersMonth, loadReservationsMonth } from './services/homeGateway'
import type {
  ActivityEvent,
  AppView,
  AuthUser,
  PermissionNode,
  ReminderItem,
  ReservationItem,
  ShellNavItem,
  ShellNavigationCatalog,
} from './types'

const sidebarStateKey = 'thermo.shell.sidebar.collapsed'
const todayIso = () => new Date().toISOString().slice(0, 10)

const iconMap = {
  home: Home,
  boxes: Boxes,
  warehouse: Warehouse,
  'shopping-cart': ShoppingCart,
  factory: Factory,
  'badge-check': ShieldCheck,
  headset: Headset,
  chart: ChartColumn,
  users: Users,
  drafting: Wrench,
  refresh: RefreshCw,
  settings: Settings2,
  bot: Bot,
  layout: Folder,
  dot: ChevronRight,
} as const

function formatDateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function formatTime(value: string | null | undefined) {
  const trimmed = String(value || '').trim()
  return trimmed ? trimmed.slice(0, 5) : '--:--'
}

function statusTone(item: ReservationItem) {
  if (item.cancelada) return 'border-red-200 bg-red-50 text-red-700'
  if (item.realizada) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-slate-200 bg-slate-100 text-slate-700'
}

function getIconComponent(icon: string) {
  return iconMap[icon as keyof typeof iconMap] ?? iconMap.dot
}

function useShellHomeData(user: AuthUser | null) {
  const [monthRef, setMonthRef] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [reservations, setReservations] = useState<ReservationItem[]>([])
  const [reminders, setReminders] = useState<ReminderItem[]>([])
  const [activities, setActivities] = useState<ActivityEvent[]>([])
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const [activityError, setActivityError] = useState<string | null>(null)
  const [loadingCalendar, setLoadingCalendar] = useState(false)
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [kpi, setKpi] = useState({
    belowMin: 0,
    negative: 0,
    inPurchase: null as number | null,
    purchaseUnavailable: false,
  })

  useEffect(() => {
    let cancelled = false

    const syncProductMetrics = async () => {
      const cached = getPilotDataCacheState()
      if (cached.products.length > 0) {
        if (!cancelled) {
          setKpi({
            belowMin: cached.products.filter((product) => product.abaixo_minimo).length,
            negative: cached.products.filter((product) => product.estoque_negativo || product.expedicao_negativa).length,
            inPurchase: cached.warnings.some((warning) => warning.includes('Situação de compra indisponível'))
              ? null
              : cached.products.filter((product) => product.purchaseState === 'em_compra').length,
            purchaseUnavailable: cached.warnings.some((warning) => warning.includes('Situação de compra indisponível')),
          })
        }
      }

      try {
        const snapshot = await prefetchPilotData()
        if (cancelled) return
        setKpi({
          belowMin: snapshot.products.filter((product) => product.abaixo_minimo).length,
          negative: snapshot.products.filter((product) => product.estoque_negativo || product.expedicao_negativa).length,
          inPurchase: snapshot.warnings.some((warning) => warning.includes('Situação de compra indisponível'))
            ? null
            : snapshot.products.filter((product) => product.purchaseState === 'em_compra').length,
          purchaseUnavailable: snapshot.warnings.some((warning) => warning.includes('Situação de compra indisponível')),
        })
      } catch {
        if (!cancelled) {
          setKpi((current) => ({ ...current, inPurchase: null, purchaseUnavailable: true }))
        }
      }
    }

    void syncProductMetrics()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoadingCalendar(true)
    setCalendarError(null)

    Promise.all([
      loadReservationsMonth(monthRef.getFullYear(), monthRef.getMonth() + 1),
      loadRemindersMonth(monthRef.getFullYear(), monthRef.getMonth() + 1, user.username),
    ])
      .then(([reservationResponse, reminderResponse]) => {
        if (cancelled) return
        setReservations(Array.isArray(reservationResponse.reservas) ? reservationResponse.reservas : [])
        setReminders(Array.isArray(reminderResponse.lembretes) ? reminderResponse.lembretes : [])
      })
      .catch((error) => {
        if (cancelled) return
        setCalendarError(error instanceof Error ? error.message : 'Falha ao carregar o calendário operacional.')
      })
      .finally(() => {
        if (!cancelled) setLoadingCalendar(false)
      })

    return () => {
      cancelled = true
    }
  }, [monthRef, user])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoadingActivity(true)
    setActivityError(null)

    loadRecentActivity(user.username, 12)
      .then((response) => {
        if (!cancelled) setActivities(Array.isArray(response.eventos) ? response.eventos : [])
      })
      .catch((error) => {
        if (!cancelled) setActivityError(error instanceof Error ? error.message : 'Falha ao carregar a cronologia.')
      })
      .finally(() => {
        if (!cancelled) setLoadingActivity(false)
      })

    return () => {
      cancelled = true
    }
  }, [user])

  return {
    monthRef,
    setMonthRef,
    reservations,
    reminders,
    activities,
    calendarError,
    activityError,
    loadingCalendar,
    loadingActivity,
    kpi,
  }
}

function LoginScreen({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean
  error: string | null
  onSubmit: (user: string, senha: string) => Promise<void>
}) {
  const [user, setUser] = useState('')
  const [senha, setSenha] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await onSubmit(user.trim(), senha)
  }

  return (
    <div className="min-h-screen bg-thermo-bg px-4 py-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <section className="hidden rounded-[32px] border border-thermo-border bg-thermo-navy px-8 py-10 text-white shadow-xl lg:flex lg:flex-col lg:justify-between">
          <div>
            <img src="/branding/thermo-logo-fundo-escuro.png" alt="Thermo" className="h-10 w-auto" />
            <div className="mt-8 max-w-xl text-4xl font-bold">Thermo sobre a base real da Intranet, sem trocar backend nem regras operacionais.</div>
          </div>
          <div className="grid gap-3 text-sm text-slate-200 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
              <div className="font-semibold text-white">Sessão real</div>
              <div className="mt-1">Login, permissões e logout continuam no backend atual.</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
              <div className="font-semibold text-white">Migração incremental</div>
              <div className="mt-1">Só a Lista de Produtos está clicável como tela migrada neste piloto.</div>
            </div>
          </div>
        </section>

        <section className="flex items-center">
          <div className="w-full rounded-[28px] border border-thermo-border bg-white p-6 shadow-sm md:p-8">
            <div className="mb-6 flex items-center justify-between gap-4">
              <img src="/branding/thermo-logo-principal.png" alt="Thermo" className="h-9 w-auto" />
              <img src="/branding/thermo-simbolo.png" alt="" className="size-10 rounded-2xl object-cover" />
            </div>
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-thermo-navy">Entrar</h1>
              <p className="mt-2 text-sm text-slate-500">Use o mesmo usuário e senha da Intranet atual.</p>
            </div>

            <form className="space-y-4" onSubmit={submit}>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-thermo-navy">Usuário</span>
                <input
                  value={user}
                  onChange={(event) => setUser(event.target.value)}
                  className="w-full rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 outline-none focus:border-thermo-navy"
                  autoComplete="username"
                  required
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-thermo-navy">Senha</span>
                <input
                  type="password"
                  value={senha}
                  onChange={(event) => setSenha(event.target.value)}
                  className="w-full rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 outline-none focus:border-thermo-navy"
                  autoComplete="current-password"
                  required
                />
              </label>

              {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

              <button className="thermo-button thermo-button-primary w-full justify-center py-3" type="submit" disabled={busy}>
                Entrar
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  )
}

function SidebarItemButton({
  item,
  collapsed,
  activeView,
  onNavigate,
}: {
  item: ShellNavItem
  collapsed: boolean
  activeView: AppView
  onNavigate: (view: AppView) => void
}) {
  const Icon = getIconComponent(item.icon)
  const isActive = item.view === activeView && item.status === 'migrated'
  const isClickable = item.status === 'migrated' && item.view !== null
  const statusLabel = item.status === 'migrated' ? 'Migrado' : 'Ainda não migrado'

  return (
    <button
      type="button"
      aria-disabled={!isClickable}
      disabled={!isClickable}
      onClick={() => {
        if (isClickable && item.view) onNavigate(item.view)
      }}
      className={clsx(
        'group relative flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition',
        isClickable ? 'border-transparent text-slate-200 hover:border-white/10 hover:bg-white/8 hover:text-white' : 'border-transparent text-slate-500 opacity-90',
        isActive && 'border-red-400/40 bg-red-500/15 text-white',
        collapsed && 'justify-center px-2',
      )}
      title={!collapsed ? undefined : `${item.label} · ${statusLabel}`}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed ? (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          <span
            className={clsx(
              'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]',
              item.status === 'migrated' ? 'bg-emerald-50 text-emerald-700' : 'bg-white/8 text-slate-300',
            )}
          >
            {item.status === 'migrated' ? 'Migrado' : 'Pendente'}
          </span>
          {item.status !== 'migrated' ? <Lock className="size-3.5 text-slate-400" /> : null}
        </>
      ) : (
        <span className="pointer-events-none absolute left-full z-20 ml-3 hidden whitespace-nowrap rounded-lg border border-thermo-border bg-white px-3 py-2 text-xs font-semibold text-thermo-ink shadow-lg group-hover:block group-focus-visible:block">
          {item.label} · {statusLabel}
        </span>
      )}
    </button>
  )
}

function SidebarSection({
  section,
  collapsed,
  activeView,
  onNavigate,
}: {
  section: ShellNavigationCatalog['sections'][number]
  collapsed: boolean
  activeView: AppView
  onNavigate: (view: AppView) => void
}) {
  const SectionIcon = getIconComponent(section.icon)

  return (
    <section className="space-y-2">
      <div className={clsx('flex items-center gap-2 px-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400', collapsed && 'justify-center px-0')}>
        <SectionIcon className="size-3.5" />
        {!collapsed ? <span>{section.label}</span> : null}
      </div>
      <div className="space-y-1">
        {section.children.map((item) => (
          <div key={item.id} className="space-y-1">
            <SidebarItemButton item={item} collapsed={collapsed} activeView={activeView} onNavigate={onNavigate} />
            {!collapsed && item.children.length > 0 ? (
              <div className="ml-4 space-y-1 border-l border-white/10 pl-3">
                {item.children.map((child) => (
                  <SidebarItemButton key={child.id} item={child} collapsed={false} activeView={activeView} onNavigate={onNavigate} />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function Sidebar({
  open,
  collapsed,
  onToggleCollapsed,
  activeView,
  onClose,
  onNavigate,
  navigation,
}: {
  open: boolean
  collapsed: boolean
  onToggleCollapsed: () => void
  activeView: AppView
  onClose: () => void
  onNavigate: (view: AppView) => void
  navigation: ShellNavigationCatalog
}) {
  const content = (
    <aside className={clsx('flex h-full flex-col bg-thermo-navy text-slate-100 transition-[width] duration-150', collapsed ? 'w-[88px]' : 'w-[320px]')}>
      <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-4">
        <div className={clsx('flex items-center gap-3 overflow-hidden', collapsed && 'justify-center')}>
          <img src="/branding/thermo-simbolo.png" alt="" className="size-9 shrink-0 rounded-2xl" />
          {!collapsed ? <img src="/branding/thermo-logo-fundo-escuro.png" alt="Thermo" className="h-7 w-auto" /> : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="hidden rounded-xl border border-white/10 bg-white/5 p-2 text-slate-100 md:inline-flex"
            aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
            onClick={onToggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
          <button className="rounded-xl border border-white/10 p-2 text-white md:hidden" type="button" onClick={onClose} aria-label="Fechar navegação">
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="px-3 py-3">
        <button
          type="button"
          onClick={() => {
            onNavigate('home')
            onClose()
          }}
          className={clsx(
            'group relative flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition',
            activeView === 'home' ? 'border-red-400/40 bg-red-500/15 text-white' : 'border-transparent text-slate-200 hover:border-white/10 hover:bg-white/8 hover:text-white',
            collapsed && 'justify-center px-2',
          )}
          title={!collapsed ? undefined : 'Página inicial'}
        >
          <Home className="size-4 shrink-0" />
          {!collapsed ? <span className="flex-1 truncate">Página inicial</span> : <span className="pointer-events-none absolute left-full z-20 ml-3 hidden whitespace-nowrap rounded-lg border border-thermo-border bg-white px-3 py-2 text-xs font-semibold text-thermo-ink shadow-lg group-hover:block group-focus-visible:block">Página inicial</span>}
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {navigation.sections.map((section) => (
          <SidebarSection key={section.id} section={section} collapsed={collapsed} activeView={activeView} onNavigate={onNavigate} />
        ))}
      </div>
    </aside>
  )

  if (!open) return <div className="hidden h-full md:block">{content}</div>

  return (
    <ModalShell open title="Navegação operacional" onClose={onClose} panelStyle={{ width: 'min(92vw, 24rem)', maxWidth: '24rem', flexShrink: 0 }} panelClassName="bg-transparent">
      <div className="-mx-5 -my-4 h-[calc(100%+2rem)]">{content}</div>
    </ModalShell>
  )
}

function HomeScreen({
  user,
  onOpenProducts,
}: {
  user: AuthUser
  onOpenProducts: () => void
}) {
  const { monthRef, setMonthRef, reservations, reminders, activities, calendarError, activityError, loadingCalendar, loadingActivity, kpi } = useShellHomeData(user)
  const [selectedDate, setSelectedDate] = useState(todayIso())
  const selectedDateReservations = useMemo(() => reservations.filter((item) => item.data.slice(0, 10) === selectedDate), [reservations, selectedDate])
  const selectedDateReminders = useMemo(() => reminders.filter((item) => item.data.slice(0, 10) === selectedDate), [reminders, selectedDate])

  useEffect(() => {
    const monthIso = `${monthRef.getFullYear()}-${String(monthRef.getMonth() + 1).padStart(2, '0')}`
    if (!selectedDate.startsWith(monthIso)) {
      const firstReservation = reservations[0]?.data?.slice(0, 10)
      setSelectedDate(firstReservation ?? `${monthIso}-01`)
    }
  }, [monthRef, reservations, selectedDate])

  const meetingsToday = useMemo(() => reservations.filter((item) => item.data.slice(0, 10) === todayIso()).length, [reservations])
  const upcomingWeek = useMemo(() => {
    const now = new Date()
    const limit = new Date(now)
    limit.setDate(now.getDate() + 7)
    return reservations.filter((item) => {
      const date = new Date(`${item.data.slice(0, 10)}T00:00:00`)
      return date >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) && date <= limit
    }).length
  }, [reservations])

  const monthDays = useMemo(() => {
    const first = new Date(monthRef.getFullYear(), monthRef.getMonth(), 1)
    const totalDays = new Date(monthRef.getFullYear(), monthRef.getMonth() + 1, 0).getDate()
    const startOffset = first.getDay()
    const days: Array<{ iso: string; day: number; out: boolean }> = []

    for (let index = 0; index < startOffset; index += 1) {
      const prevDate = new Date(monthRef.getFullYear(), monthRef.getMonth(), index - startOffset + 1)
      days.push({ iso: prevDate.toISOString().slice(0, 10), day: prevDate.getDate(), out: true })
    }

    for (let day = 1; day <= totalDays; day += 1) {
      const current = new Date(monthRef.getFullYear(), monthRef.getMonth(), day)
      days.push({ iso: current.toISOString().slice(0, 10), day, out: false })
    }

    while (days.length % 7 !== 0) {
      const nextDate = new Date(monthRef.getFullYear(), monthRef.getMonth(), totalDays + (days.length % 7) + 1)
      days.push({ iso: nextDate.toISOString().slice(0, 10), day: nextDate.getDate(), out: true })
    }

    return days
  }, [monthRef])

  const countsByDay = useMemo(() => {
    const counts = new Map<string, { reservations: number; reminders: number; mine: number }>()

    for (const item of reservations) {
      const key = item.data.slice(0, 10)
      const current = counts.get(key) ?? { reservations: 0, reminders: 0, mine: 0 }
      current.reservations += 1
      if (item.participantes.some((name) => name.toLowerCase() === user.username.toLowerCase()) || String(item.criadoPor || '').toLowerCase() === user.username.toLowerCase()) {
        current.mine += 1
      }
      counts.set(key, current)
    }

    for (const item of reminders) {
      const key = item.data.slice(0, 10)
      const current = counts.get(key) ?? { reservations: 0, reminders: 0, mine: 0 }
      current.reminders += 1
      counts.set(key, current)
    }

    return counts
  }, [reminders, reservations, user.username])

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-thermo-border bg-white px-5 py-5 shadow-sm md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-500">Home operacional</div>
            <h1 className="mt-1 text-2xl font-bold text-thermo-navy">Calendário e rotina de {user.username}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Esta home preserva a agenda real da Intranet, resume indicadores sustentados por APIs existentes e mantém a Lista de Produtos como tela migrada.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="thermo-button thermo-button-primary" type="button" onClick={onOpenProducts}>
              <Boxes className="size-4" />
              Abrir Lista de Produtos
            </button>
            <a className="thermo-button thermo-button-secondary" href={buildLegacyUrl('/menu_produto.html')} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
              Abrir agenda legado
            </a>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        <article className="rounded-3xl border border-thermo-border bg-white px-4 py-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Reuniões hoje</div>
          <div className="mt-3 text-3xl font-bold text-thermo-navy">{meetingsToday}</div>
          <div className="mt-2 text-sm text-slate-500">Reservas retornadas por /api/rh/reservas para {formatDateLabel(todayIso())}.</div>
        </article>
        <article className="rounded-3xl border border-thermo-border bg-white px-4 py-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Próximos 7 dias</div>
          <div className="mt-3 text-3xl font-bold text-thermo-navy">{upcomingWeek}</div>
          <div className="mt-2 text-sm text-slate-500">Ocorrências visíveis na agenda mensal atual.</div>
        </article>
        <article className="rounded-3xl border border-thermo-border bg-white px-4 py-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Abaixo do mínimo</div>
          <div className="mt-3 text-3xl font-bold text-thermo-navy">{kpi.belowMin}</div>
          <div className="mt-2 text-sm text-slate-500">Contagem real da mesma cache usada pela Lista de Produtos.</div>
        </article>
        <article className="rounded-3xl border border-thermo-border bg-white px-4 py-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Em compra</div>
          <div className="mt-3 text-3xl font-bold text-thermo-navy">{kpi.inPurchase ?? '—'}</div>
          <div className="mt-2 text-sm text-slate-500">{kpi.purchaseUnavailable ? 'Indisponível: endpoint auxiliar não respondeu para esta sessão.' : 'Produtos marcados por /api/compras/produtos-em-compra.'}</div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.85fr)]">
        <article className="rounded-[28px] border border-thermo-border bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Calendário de reuniões</div>
              <h2 className="mt-1 text-lg font-bold text-thermo-navy">
                {monthRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
              </h2>
            </div>
            <div className="flex gap-2">
              <button className="thermo-button thermo-button-secondary" type="button" onClick={() => setMonthRef(new Date(monthRef.getFullYear(), monthRef.getMonth() - 1, 1))}>
                Anterior
              </button>
              <button className="thermo-button thermo-button-secondary" type="button" onClick={() => setMonthRef(new Date(monthRef.getFullYear(), monthRef.getMonth() + 1, 1))}>
                Próximo
              </button>
            </div>
          </div>

          {calendarError ? <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{calendarError}</div> : null}
          {loadingCalendar ? <div className="mb-4 rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 text-sm text-slate-500">Carregando agenda real…</div> : null}

          <div className="grid grid-cols-7 gap-2 text-center text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((label) => (
              <div key={label} className="px-1 py-2">
                {label}
              </div>
            ))}
            {monthDays.map((day) => {
              const counters = countsByDay.get(day.iso)
              const selected = selectedDate === day.iso
              const isToday = day.iso === todayIso()
              return (
                <button
                  key={day.iso}
                  type="button"
                  onClick={() => setSelectedDate(day.iso)}
                  className={clsx(
                    'min-h-[96px] rounded-2xl border p-2 text-left transition',
                    selected ? 'border-thermo-navy bg-slate-50' : 'border-thermo-border bg-thermo-bg hover:border-thermo-navy/30',
                    day.out && 'opacity-45',
                    isToday && 'ring-1 ring-thermo-red/50',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-thermo-navy">{day.day}</span>
                    {isToday ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">Hoje</span> : null}
                  </div>
                  <div className="mt-2 space-y-1 text-[11px]">
                    <div className="rounded-lg bg-white px-2 py-1 text-slate-600">{counters?.reservations ?? 0} reunião(ões)</div>
                    <div className="rounded-lg bg-white px-2 py-1 text-slate-500">{counters?.mine ?? 0} minha(s)</div>
                    {counters?.reminders ? <div className="rounded-lg bg-amber-50 px-2 py-1 text-amber-800">{counters.reminders} lembrete(s)</div> : null}
                  </div>
                </button>
              )
            })}
          </div>
        </article>

        <article className="space-y-4">
          <section className="rounded-[28px] border border-thermo-border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Detalhes do dia</div>
                <h3 className="mt-1 text-lg font-bold text-thermo-navy">{formatDateLabel(selectedDate)}</h3>
              </div>
              <a className="thermo-button thermo-button-secondary" href={buildLegacyUrl('/menu_produto.html')} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                Agenda legado
              </a>
            </div>

            <div className="mt-4 space-y-3">
              {selectedDateReservations.length === 0 && selectedDateReminders.length === 0 ? (
                <div className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-4 text-sm text-slate-500">Nenhuma reunião ou lembrete visível nesta data.</div>
              ) : null}

              {selectedDateReservations.map((item) => (
                <article key={`${item.id}-${item.data}`} className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-thermo-navy">{item.tema || 'Sem tema'}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {formatTime(item.inicio)}–{formatTime(item.fim)} · {item.tipo || 'Reserva'} · {item.criadoPor || 'Responsável não informado'}
                      </div>
                    </div>
                    <span className={clsx('rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]', statusTone(item))}>
                      {item.cancelada ? 'Cancelada' : item.realizada ? 'Realizada' : 'Programada'}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                    <span className="rounded-full border border-thermo-border bg-white px-3 py-1">{item.participantes.length} participante(s)</span>
                    {item.participantes.some((name) => name.toLowerCase() === user.username.toLowerCase()) ? <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-700">Você participa</span> : null}
                    {item.cafe ? <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-800">Com café</span> : null}
                    {item.avisoEmail ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">Aviso e-mail</span> : null}
                    {item.avisoWhatsapp ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">Aviso WhatsApp</span> : null}
                  </div>
                </article>
              ))}

              {selectedDateReminders.map((item) => (
                <article key={`reminder-${item.id}`} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                  <div className="text-sm font-bold text-amber-900">{item.texto}</div>
                  <div className="mt-1 text-xs text-amber-800">Criado por {item.criadoPor || '—'} · {item.destinatarios.length} destinatário(s)</div>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-thermo-border bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Minhas atividades recentes</div>
                <h3 className="mt-1 text-lg font-bold text-thermo-navy">Cronologia operacional</h3>
              </div>
            </div>
            {activityError ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{activityError}</div> : null}
            {loadingActivity ? <div className="mt-4 rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 text-sm text-slate-500">Carregando cronologia…</div> : null}
            <div className="mt-4 space-y-3">
              {!loadingActivity && !activityError && activities.length === 0 ? <div className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-4 text-sm text-slate-500">Nenhuma atividade recente disponível para esta sessão.</div> : null}
              {activities.map((event) => (
                <article key={event.id} className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-thermo-navy">{event.acao}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {new Date(event.ocorrido_em).toLocaleString('pt-BR')} · {event.usuario_nome || user.username}
                      </div>
                    </div>
                    <span className={clsx('rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]', event.sucesso === false ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700')}>
                      {event.sucesso === false ? 'Erro' : 'Sucesso'}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    {[event.codigo_produto || event.codigo_produto_omie, event.n_solic, event.sessao_descricao, event.rota].filter(Boolean).join(' · ') || 'Sem contexto adicional'}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </article>
      </section>
    </div>
  )
}

function LoadingShell({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-thermo-bg px-4">
      <div className="rounded-[28px] border border-thermo-border bg-white px-6 py-8 text-center shadow-sm">
        <img src="/branding/thermo-logo-principal.png" alt="Thermo" className="mx-auto h-10 w-auto" />
        <div className="mt-4 text-sm text-slate-500">{message}</div>
      </div>
    </div>
  )
}

function App() {
  const [busy, setBusy] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [activeView, setActiveView] = useState<AppView>('home')
  const [menuOpen, setMenuOpen] = useState(false)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [permissionNodes, setPermissionNodes] = useState<PermissionNode[]>([])
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.sessionStorage.getItem(sidebarStateKey) === '1'
  })

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(sidebarStateKey, collapsed ? '1' : '0')
    }
  }, [collapsed])

  useEffect(() => {
    const loadSession = async () => {
      setBusy(true)
      setAuthError(null)
      setPermissionError(null)

      try {
        const status = await getAuthStatus()
        if (!status.loggedIn || !status.user) {
          setUser(null)
          setPermissionNodes([])
          return
        }

        setUser(status.user)
        const tree = await getPermissionTree()
        setPermissionNodes(tree.nodes)
        void prefetchPilotData()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao validar a sessão atual.'
        if (!user) setAuthError(message)
        else setPermissionError(message)
        setUser(null)
      } finally {
        setBusy(false)
      }
    }

    void loadSession()
  }, [])

  const loginSubmit = async (username: string, password: string) => {
    setBusy(true)
    setAuthError(null)

    try {
      await login(username, password)
      const [status, tree] = await Promise.all([getAuthStatus(), getPermissionTree()])
      setUser(status.user)
      setPermissionNodes(tree.nodes)
      setActiveView('home')
      void prefetchPilotData()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Falha no login.')
    } finally {
      setBusy(false)
    }
  }

  const doLogout = async () => {
    setBusy(true)
    try {
      await logout()
    } finally {
      setUser(null)
      setPermissionNodes([])
      setActiveView('home')
      setBusy(false)
    }
  }

  const navigation = useMemo(() => buildNavigationCatalog(permissionNodes), [permissionNodes])
  const canOpenCart = useMemo(() => isSelectorAllowed('#cart-icon', navigation.selectorMap), [navigation.selectorMap])
  const canOpenSeparation = useMemo(() => isSelectorAllowed('#menu-solicitacao-transferencia', navigation.selectorMap), [navigation.selectorMap])
  const canEditCatalog = useMemo(() => isSelectorAllowed('#menu-produto', navigation.selectorMap) || isSelectorAllowed('#btn-definicoes', navigation.selectorMap), [navigation.selectorMap])

  const topRightLabel = useMemo(() => {
    if (!user) return null
    const role = user.funcao_nome || user.roles[0] || 'Sessão ativa'
    return `${role}${user.setor ? ` · ${user.setor}` : ''}`
  }, [user])

  if (busy && !user && !authError) return <LoadingShell message="Validando sessão real…" />
  if (!user) return <LoginScreen busy={busy} error={authError} onSubmit={loginSubmit} />

  return (
    <div className="min-h-screen bg-thermo-bg text-thermo-ink">
      <div className="flex min-h-screen">
        <Sidebar
          open={menuOpen}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((current) => !current)}
          activeView={activeView}
          onClose={() => setMenuOpen(false)}
          onNavigate={(view) => {
            setActiveView(view)
            setMenuOpen(false)
          }}
          navigation={navigation}
        />

        <div className="min-w-0 flex-1">
          <header className="border-b border-thermo-border bg-white">
            <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-4 px-4 py-4 md:px-6 xl:px-8">
              <div className="flex items-center gap-3">
                <button className="rounded-xl border border-thermo-border p-2 md:hidden" type="button" onClick={() => setMenuOpen(true)} aria-label="Abrir navegação">
                  <Menu className="size-4 text-thermo-navy" />
                </button>
                <img src="/branding/thermo-logo-principal.png" alt="Thermo" className="h-8 w-auto md:h-9" />
                <span className="hidden items-center gap-2 rounded-full border border-thermo-border bg-thermo-bg px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-500 md:inline-flex">
                  {activeView === 'home' ? <Home className="size-3.5 text-thermo-navy" /> : <Boxes className="size-3.5 text-thermo-navy" />}
                  {activeView === 'home' ? 'Home operacional' : 'Lista de produtos'}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-2 text-right md:block">
                  <div className="text-sm font-semibold text-thermo-navy">{user.username}</div>
                  <div className="text-xs text-slate-500">{topRightLabel}</div>
                </div>
                <button className="thermo-button thermo-button-secondary" type="button" onClick={() => void doLogout()}>
                  <LogOut className="size-4" />
                  Sair
                </button>
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-[1680px] px-4 py-5 md:px-6 xl:px-8">
            {permissionError ? (
              <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {permissionError}
              </div>
            ) : null}

            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className="thermo-chip">
                <ShieldCheck className="size-4 text-emerald-600" />
                Sessão real ativa
              </span>
              <span className="thermo-chip">
                <Lock className="size-4 text-slate-600" />
                Itens não migrados ficam visíveis, mas bloqueados no shell
              </span>
            </div>

            {activeView === 'home' ? (
              <HomeScreen user={user} onOpenProducts={() => setActiveView('products')} />
            ) : (
              <ProductListScreen
                permissions={{
                  canOpenCart,
                  canOpenSeparation,
                  canEditCatalog,
                  cartReason: canOpenCart ? null : 'Sua árvore de permissões não liberou o painel de compras (#cart-icon).',
                  separationReason: canOpenSeparation ? null : 'Sua árvore de permissões não liberou a Solicitação de transferência (#menu-solicitacao-transferencia).',
                }}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

export default App
