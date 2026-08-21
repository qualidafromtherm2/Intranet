import { clsx } from 'clsx'
import {
  ContactRound,
  ArrowLeftRight,
  Ban,
  BadgeCheck,
  Bell,
  Binoculars,
  BookOpen,
  Bot,
  Boxes,
  BriefcaseMedical,
  Bug,
  Building2,
  Calculator,
  ChartColumn,
  ChartLine,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Coffee,
  Cog,
  Cpu,
  DraftingCompass,
  ExternalLink,
  Factory,
  FileChartColumn,
  FilePen,
  FileSignature,
  FlaskConical,
  Folder,
  Hand,
  History,
  Headphones,
  Home,
  IdCard,
  Landmark,
  Lock,
  LogOut,
  Map as MapIcon,
  Menu,
  Monitor,
  PackageCheck,
  PackageSearch,
  Palmtree,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  Receipt,
  RefreshCw,
  Search,
  ScanSearch,
  ScanLine,
  SearchCheck,
  Send,
  Settings2,
  Shield,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  SquarePlus,
  TriangleAlert,
  Truck,
  Users,
  Warehouse,
  Wrench,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ModalShell } from './components/ModalShell'
import { ProductListScreen } from './features/ProductListScreen'
import { CalendarScreen } from './features/calendar'
import { ChatbotMonitorScreen } from './features/chatbot-monitor'
import { EngineeringChangesScreen } from './features/engineering-changes/EngineeringChangesScreen'
import { FreightSimulatorScreen } from './features/freight'
import { FirstPieceScreen } from './features/first-piece'
import { InspectionRecordsScreen } from './features/inspection-records'
import { IdentifyProductScreen, StoreMaterialsScreen } from './features/logistics'
import { MachineStockScreen } from './features/inventory/MachineStockScreen'
import { LogisticsReportScreen } from './features/logistics-report/LogisticsReportScreen'
import { MinimumStockScreen } from './features/minimum-stock'
import { ProductsReceivedScreen, ReceivingScreen } from './features/receiving'
import { PirScreen } from './features/pir'
import { PrintAgentConfigScreen } from './features/print-agent-config'
import { ProductRegistrationScreen } from './features/product-registration'
import { ProductionRegistrationScreen } from './features/production-registration'
import { ProductionRecordsScreen } from './features/production-records'
import { ProductionIncidentsScreen } from './features/production-incidents'
import { ProductionGembaScreen } from './features/production-gemba'
import { PreparationsScreen } from './features/preparations'
import { ProductionReportScreen } from './features/production-report'
import { ProductionTestsScreen } from './features/production-tests'
import { PurchaseAccountsScreen } from './features/purchase-accounts'
import { PurchaseSettingsScreen } from './features/purchase-settings'
import { QualityManualsScreen } from './features/quality-manuals'
import { RedAreaScreen } from './features/red-area'
import { SalesReportScreen } from './features/sales-report'
import { SeparationWorkspace } from './features/separation/SeparationWorkspace'
import { ShippingScreen } from './features/shipping/ShippingScreen'
import { SalesControlScreen } from './features/sales-control'
import { SalesChartsScreen } from './features/sales-charts'
import { SalesMapScreen } from './features/sales-map'
import { SacReportScreen } from './features/sac-report'
import { SacShippingRequestScreen } from './features/sac-shipping-request'
import { StockAdjustmentScreen } from './features/stock-adjustment'
import { WarehouseScreen } from './features/warehouses'
import { getPilotDataCacheState, prefetchPilotData } from './hooks/usePilotData'
import { buildNavigationCatalog, isSelectorAllowed } from './lib/navigation'
import { getAuthStatus, getPermissionTree, login, logout } from './services/authGateway'
import { loadActiveUsers, loadRecentActivity, loadRemindersMonth, loadReservationsMonth } from './services/homeGateway'
import type {
  ActivityEvent,
  AppView,
  AuthUser,
  PermissionNode,
  ReminderItem,
  ReservationItem,
  ShellNavItem,
  ShellNavigationCatalog,
  ShellNavSection,
} from './types'

const sidebarStateKey = 'thermo.shell.sidebar.collapsed'
const todayIso = new Date().toISOString().slice(0, 10)

const iconMap = {
  home: Home,
  layout: Folder,
  boxes: Boxes,
  'square-plus': SquarePlus,
  settings: Settings2,
  warehouse: Warehouse,
  'arrow-left-right': ArrowLeftRight,
  'file-pen': FilePen,
  calculator: Calculator,
  'file-chart-column': FileChartColumn,
  'truck-ramp': Truck,
  'package-check': PackageCheck,
  hand: Hand,
  printer: Printer,
  truck: Truck,
  cog: Cog,
  'shopping-cart': ShoppingCart,
  landmark: Landmark,
  factory: Factory,
  'badge-check': BadgeCheck,
  'clipboard-list': ClipboardList,
  'scan-search': ScanSearch,
  wrench: Wrench,
  binoculars: Binoculars,
  'triangle-alert': TriangleAlert,
  'package-search': PackageSearch,
  'clipboard-check': ClipboardCheck,
  'flask-conical': FlaskConical,
  'book-open': BookOpen,
  ban: Ban,
  send: Send,
  'briefcase-medical': BriefcaseMedical,
  chart: ChartColumn,
  'chart-column': ChartColumn,
  receipt: Receipt,
  map: MapIcon,
  users: Users,
  'id-card': IdCard,
  'address-book': ContactRound,
  headset: Headphones,
  'palm-tree': Palmtree,
  shield: Shield,
  'file-signature': FileSignature,
  bug: Bug,
  cpu: Cpu,
  history: History,
  drafting: DraftingCompass,
  'chart-line': ChartLine,
  refresh: RefreshCw,
  'search-check': SearchCheck,
  bot: Bot,
  'sliders-horizontal': SlidersHorizontal,
  'scan-line': ScanLine,
  dot: ChevronRight,
} as const

const legendItems = [
  { icon: ClipboardList, label: 'Auditório', tone: 'text-violet-700' },
  { icon: Users, label: 'Sala de reunião', tone: 'text-emerald-700' },
  { icon: Bell, label: 'Lembrete', tone: 'text-amber-700' },
  { icon: Coffee, label: 'Com café', tone: 'text-amber-700' },
  { icon: ContactRound, label: 'Você é participante', tone: 'text-emerald-700' },
  { icon: Monitor, label: 'Reunião online', tone: 'text-sky-700' },
  { icon: Building2, label: 'Visita', tone: 'text-orange-700' },
  { icon: Sparkles, label: 'Evento', tone: 'text-pink-700' },
] as const

function getIconComponent(icon: string) {
  return iconMap[icon as keyof typeof iconMap] ?? iconMap.dot
}

function formatDateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function formatTime(value: string | null | undefined) {
  const trimmed = String(value || '').trim()
  return trimmed ? trimmed.slice(0, 5) : '--:--'
}

function getReservationTypeTone(item: ReservationItem) {
  const type = String(item.tipo || '').toLowerCase()
  if (type.includes('audit')) return 'border-violet-200 bg-violet-50 text-violet-800'
  if (type.includes('online')) return 'border-sky-200 bg-sky-50 text-sky-800'
  if (type.includes('visita')) return 'border-orange-200 bg-orange-50 text-orange-800'
  if (type.includes('evento')) return 'border-pink-200 bg-pink-50 text-pink-800'
  return 'border-emerald-200 bg-emerald-50 text-emerald-800'
}

function getReservationTypeLabel(item: ReservationItem) {
  const type = String(item.tipo || '').trim()
  return type || 'Sala de reunião'
}

function flattenItems(items: ShellNavItem[]): ShellNavItem[] {
  return items.flatMap((item) => [item, ...flattenItems(item.children)])
}

function useHomeData(user: AuthUser | null) {
  const [monthRef, setMonthRef] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [reservations, setReservations] = useState<ReservationItem[]>([])
  const [reminders, setReminders] = useState<ReminderItem[]>([])
  const [activities, setActivities] = useState<ActivityEvent[]>([])
  const [activeUsers, setActiveUsers] = useState<string[]>([])
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
      if (!cancelled && cached.products.length > 0) {
        setKpi({
          belowMin: cached.products.filter((product) => product.abaixo_minimo).length,
          negative: cached.products.filter((product) => product.estoque_negativo || product.expedicao_negativa).length,
          inPurchase: cached.warnings.some((warning) => warning.includes('Situação de compra indisponível'))
            ? null
            : cached.products.filter((product) => product.purchaseState === 'em_compra').length,
          purchaseUnavailable: cached.warnings.some((warning) => warning.includes('Situação de compra indisponível')),
        })
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
        if (!cancelled) setKpi((current) => ({ ...current, inPurchase: null, purchaseUnavailable: true }))
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
      loadActiveUsers(),
    ])
      .then(([reservationResponse, reminderResponse, users]) => {
        if (cancelled) return
        setReservations(Array.isArray(reservationResponse.reservas) ? reservationResponse.reservas : [])
        setReminders(Array.isArray(reminderResponse.lembretes) ? reminderResponse.lembretes : [])
        setActiveUsers(users.sort((left, right) => left.localeCompare(right, 'pt-BR')))
      })
      .catch((error) => {
        if (!cancelled) setCalendarError(error instanceof Error ? error.message : 'Falha ao carregar o calendário operacional.')
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
    activeUsers,
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
  const displayError = error?.replace(/backend legado/gi, 'serviço de autenticação')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await onSubmit(user.trim(), senha)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-thermo-bg px-4 py-8">
      <section className="w-full max-w-sm">
          <div className="w-full rounded-2xl border border-thermo-border bg-white p-6 shadow-sm md:p-8">
            <div className="mb-7 flex justify-center">
              <div className="relative h-[62px] w-[220px] overflow-hidden" role="img" aria-label="Thermo — Sistema de Gestão">
                <img src="/branding/thermo-logo-principal.png" alt="" className="absolute left-0 top-[-30px] w-[220px] max-w-none" />
              </div>
            </div>
            <div className="mb-6">
              <h1 className="text-center text-xl font-bold text-thermo-navy">Acessar o sistema</h1>
            </div>

            <form className="space-y-4" onSubmit={submit}>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-thermo-navy">Usuário</span>
                <input
                  value={user}
                  onChange={(event) => setUser(event.target.value)}
                  className="w-full rounded-lg border border-thermo-border bg-white px-4 py-3 outline-none focus:border-thermo-navy focus:ring-2 focus:ring-thermo-navy/10"
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
                  className="w-full rounded-lg border border-thermo-border bg-white px-4 py-3 outline-none focus:border-thermo-navy focus:ring-2 focus:ring-thermo-navy/10"
                  autoComplete="current-password"
                  required
                />
              </label>

              {displayError ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{displayError}</div> : null}

              <button className="thermo-button thermo-button-primary w-full justify-center py-3" type="submit" disabled={busy}>
                Entrar
              </button>
            </form>
          </div>
      </section>
    </div>
  )
}

function SidebarItem({
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
  const isActive = item.view === activeView && item.migrationStatus === 'migrated'
  const isClickable = item.allowed && item.migrationStatus === 'migrated' && item.view !== null
  const statusText = isClickable ? 'Disponível' : 'Indisponível nesta tela'

  return (
    <button
      type="button"
      onClick={() => {
        if (isClickable && item.view) onNavigate(item.view)
      }}
      disabled={!isClickable}
      aria-disabled={!isClickable}
      title={collapsed ? `${item.label} · ${statusText}` : undefined}
      className={clsx(
        'group relative flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition',
        collapsed && 'justify-center px-2',
        isActive ? 'border-red-400/40 bg-red-500/15 text-white' : 'border-transparent',
        isClickable ? 'text-slate-200 hover:border-white/10 hover:bg-white/8 hover:text-white' : 'cursor-not-allowed text-slate-500 opacity-95',
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed ? (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {!isClickable ? <span className="text-[10px] font-semibold text-slate-400">Indisponível</span> : null}
          {!isClickable ? <Lock className="size-3.5 text-slate-400" aria-hidden="true" /> : null}
        </>
      ) : (
        <span className="pointer-events-none absolute left-full z-20 ml-3 hidden whitespace-nowrap rounded-lg border border-thermo-border bg-white px-3 py-2 text-xs font-semibold text-thermo-ink shadow-lg group-hover:block group-focus-visible:block">
          {item.label} · {statusText}
        </span>
      )}
    </button>
  )
}

function SidebarSection({
  section,
  collapsed,
  opened,
  onToggle,
  activeView,
  onNavigate,
}: {
  section: ShellNavSection
  collapsed: boolean
  opened: boolean
  onToggle: () => void
  activeView: AppView
  onNavigate: (view: AppView) => void
}) {
  const SectionIcon = getIconComponent(section.icon)

  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={opened}
        className={clsx('flex w-full items-center gap-2 px-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400', collapsed ? 'justify-center px-0' : 'justify-between')}
      >
        <span className="flex items-center gap-2">
          <SectionIcon className="size-3.5" />
          {!collapsed ? <span>{section.label}</span> : null}
        </span>
        {!collapsed ? <ChevronRight className={clsx('size-3.5 transition-transform', opened && 'rotate-90')} /> : null}
      </button>
      {opened ? <div className="space-y-1">
        {section.children.map((item) => (
          <div key={item.id} className="space-y-1">
            <SidebarItem item={item} collapsed={collapsed} activeView={activeView} onNavigate={onNavigate} />
            {!collapsed && item.children.length > 0 ? (
              <div className="ml-4 space-y-1 border-l border-white/10 pl-3">
                {item.children.map((child) => (
                  <SidebarItem key={child.id} item={child} collapsed={false} activeView={activeView} onNavigate={onNavigate} />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div> : null}
    </section>
  )
}

function useAccordionState(storageKey: string, ids: string[]) {
  const idsKey = ids.join('|')
  const [openIds, setOpenIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return ids
    try {
      const raw = window.sessionStorage.getItem(storageKey)
      if (!raw) return ids
      const parsed = JSON.parse(raw) as string[]
      return Array.isArray(parsed) ? parsed : ids
    } catch {
      return ids
    }
  })

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(storageKey, JSON.stringify(openIds))
    }
  }, [openIds, storageKey])

  useEffect(() => {
    setOpenIds((current) => {
      const next = current.filter((id) => ids.includes(id))
      if (next.length === current.length && next.every((id, index) => id === current[index])) {
        return current
      }
      return next
    })
  }, [ids, idsKey])

  return {
    openIds,
    setOpenIds,
    toggle: (id: string) => setOpenIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])),
    collapseAll: () => setOpenIds([]),
    expandAll: () => setOpenIds(ids),
  }
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
  const sectionIds = navigation.sections.filter((section) => section.key !== 'top').map((section) => section.id)
  const topItems = navigation.sections.find((section) => section.key === 'top')?.children ?? []
  const accordion = useAccordionState('thermo.sidebar.sections', sectionIds)

  const content = (
    <aside className={clsx('flex h-full flex-col bg-thermo-navy text-slate-100 transition-[width] duration-150', collapsed ? 'w-[88px]' : 'w-[320px]')}>
      <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-4">
        <div className={clsx('flex min-w-0 items-center overflow-hidden', collapsed && 'justify-center')}>
          {collapsed ? (
            <img src="/branding/thermo-simbolo.png" alt="Thermo" className="size-9 shrink-0 object-contain" />
          ) : (
            <div className="relative h-12 w-[168px] overflow-hidden" role="img" aria-label="Thermo — Sistema de Gestão">
              <img src="/branding/thermo-logo-fundo-escuro.png" alt="" className="absolute left-0 top-[-20px] w-[168px] max-w-none" />
            </div>
          )}
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
            collapsed && 'justify-center px-2',
            activeView === 'home' ? 'border-red-400/40 bg-red-500/15 text-white' : 'border-transparent text-slate-200 hover:border-white/10 hover:bg-white/8 hover:text-white',
          )}
          title={collapsed ? 'Página inicial' : undefined}
        >
          <Home className="size-4 shrink-0" />
          {!collapsed ? <span className="flex-1 truncate">Página inicial</span> : <span className="pointer-events-none absolute left-full z-20 ml-3 hidden whitespace-nowrap rounded-lg border border-thermo-border bg-white px-3 py-2 text-xs font-semibold text-thermo-ink shadow-lg group-hover:block group-focus-visible:block">Página inicial</span>}
        </button>
      </div>

      <div className="space-y-1 px-3 pb-3">
        {topItems.map((item) => (
          <SidebarItem key={`top-${item.id}`} item={item} collapsed={collapsed} activeView={activeView} onNavigate={onNavigate} />
        ))}
      </div>

      {!collapsed ? (
        <div className="flex items-center justify-end gap-2 px-3 pb-2 text-[11px] font-semibold text-slate-300">
          <button type="button" onClick={accordion.collapseAll}>Recolher todos</button>
          <span>·</span>
          <button type="button" onClick={accordion.expandAll}>Expandir todos</button>
        </div>
      ) : null}

      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {navigation.sections.filter((section) => section.key !== 'top').map((section) => (
          <SidebarSection
            key={section.id}
            section={section}
            collapsed={collapsed}
            opened={accordion.openIds.includes(section.id)}
            onToggle={() => accordion.toggle(section.id)}
            activeView={activeView}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </aside>
  )

  if (!open) return <div className="hidden h-full md:block">{content}</div>

  return (
    <ModalShell open title="Navegação" onClose={onClose} panelStyle={{ width: 'min(88vw, 360px)', maxWidth: '360px', minHeight: '100dvh', flexShrink: 0 }} panelClassName="bg-transparent">
      <aside className="-mx-5 -my-4 flex h-[100dvh] w-[min(88vw,360px)] flex-col bg-thermo-navy text-slate-100">
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-3">
            <img src="/branding/thermo-simbolo.png" alt="" className="size-9 rounded-2xl" />
            <div>
              <div className="text-sm font-bold text-white">Navegação</div>
              <div className="text-xs text-slate-400">Menu</div>
            </div>
          </div>
          <button className="flex size-11 items-center justify-center rounded-xl border border-white/10" type="button" onClick={onClose} aria-label="Fechar navegação">
            <X className="size-5" />
          </button>
        </div>
        <div className="border-t border-white/8 px-3 py-3">
          <button
            type="button"
            onClick={() => {
              onNavigate('home')
              onClose()
            }}
            className={clsx(
              'flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm',
              activeView === 'home' ? 'border-red-400/40 bg-red-500/15 text-white' : 'border-transparent text-slate-100',
            )}
          >
            <Home className="size-5 shrink-0" />
            <span className="flex-1">Página inicial</span>
          </button>
        </div>
        <div className="space-y-1 border-t border-white/8 px-3 py-3">
          {topItems.map((item) => (
            <SidebarItem key={`mobile-top-${item.id}`} item={item} collapsed={false} activeView={activeView} onNavigate={(view) => { onNavigate(view); onClose() }} />
          ))}
        </div>
        <div className="flex items-center justify-between px-3 pb-2 text-[11px] font-semibold text-slate-300">
          <button type="button" onClick={accordion.collapseAll}>Recolher todos</button>
          <button type="button" onClick={accordion.expandAll}>Expandir todos</button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {navigation.sections.filter((section) => section.key !== 'top').map((section) => (
            <SidebarSection
              key={`mobile-${section.id}`}
              section={section}
              collapsed={false}
              opened={accordion.openIds.includes(section.id)}
              onToggle={() => accordion.toggle(section.id)}
              activeView={activeView}
              onNavigate={(view) => {
                onNavigate(view)
                onClose()
              }}
            />
          ))}
        </div>
      </aside>
    </ModalShell>
  )
}

function ModulesSection({
  sections,
  activeView,
  onNavigate,
}: {
  sections: ShellNavSection[]
  activeView: AppView
  onNavigate: (view: AppView) => void
}) {
  const [query, setQuery] = useState('')
  type SectionWithEntries = ShellNavSection & { _entries?: ReturnType<typeof flattenItems> }
  const filteredSections = useMemo(() => {
    const search = query.trim().toLowerCase()
    if (!search) return sections
    return sections
      .map((section) => {
        const children = flattenItems(section.children).filter((item) => item.label.toLowerCase().includes(search))
        return { ...section, _entries: children }
      })
      .filter((section) => section._entries.length > 0)
  }, [query, sections]) as SectionWithEntries[]
  const sectionIds = filteredSections.map((section) => section.id)
  const accordion = useAccordionState('thermo.home.modules', sectionIds)

  useEffect(() => {
    const currentSection = sections.find((section) => flattenItems(section.children).some((item) => item.view === activeView && item.migrationStatus === 'migrated'))
    if (currentSection) {
      accordion.setOpenIds((current) => (current.includes(currentSection.id) ? current : [...current, currentSection.id]))
    }
  }, [activeView, sections])

  useEffect(() => {
    if (query.trim()) {
      accordion.expandAll()
    }
  }, [query, sectionIds.join('|')])

  return (
    <section className="rounded-lg border border-thermo-border bg-white p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Módulos</div>
          <h3 className="mt-0.5 text-sm font-bold text-thermo-navy">Áreas disponíveis</h3>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          <button type="button" onClick={accordion.collapseAll}>Recolher todos</button>
          <span>·</span>
          <button type="button" onClick={accordion.expandAll}>Expandir todos</button>
        </div>
      </div>
      <label className="mb-2 flex items-center gap-2 rounded-lg border border-thermo-border bg-thermo-bg px-3 py-2 text-sm text-slate-600">
        <Search className="size-4 text-slate-400" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent outline-none" placeholder="Pesquisar página ou módulo" />
      </label>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {filteredSections.map((section) => {
          const Icon = getIconComponent(section.icon)
          const opened = accordion.openIds.includes(section.id)
          const entries = section._entries ?? flattenItems(section.children)
          return (
            <article key={section.id} className="rounded-lg border border-thermo-border bg-thermo-bg">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                aria-expanded={opened}
                onClick={() => accordion.toggle(section.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-8 items-center justify-center rounded-lg border border-thermo-border bg-white text-thermo-navy">
                    <Icon className="size-4" />
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-thermo-navy">{section.label}</div>
                    <div className="text-xs text-slate-500">{entries.length} página(s)</div>
                  </div>
                </div>
                <ChevronRight className={clsx('size-4 text-slate-400 transition-transform', opened && 'rotate-90')} />
              </button>
              {opened ? (
                <div className="space-y-1 border-t border-thermo-border p-2">
                  {entries.map((item) => {
                    const ItemIcon = getIconComponent(item.icon)
                    const clickable = item.allowed && item.migrationStatus === 'migrated' && item.view !== null
                    const active = clickable && item.view === activeView
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={clsx(
                          'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm',
                          clickable ? 'border-transparent bg-white text-thermo-ink hover:border-thermo-border' : 'cursor-not-allowed border-transparent bg-slate-100 text-slate-500',
                          active && 'border-red-200 bg-red-50 text-red-700',
                        )}
                        disabled={!clickable}
                        aria-disabled={!clickable}
                        onClick={() => {
                          if (clickable && item.view) onNavigate(item.view)
                        }}
                      >
                        <ItemIcon className="size-4 shrink-0" />
                        <span className="flex-1 truncate">{item.label}</span>
                        {!clickable ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500"><Lock className="size-3" aria-hidden="true" />Indisponível</span> : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function HomeScreen({
  user,
  sections,
  onNavigate,
}: {
  user: AuthUser
  sections: ShellNavSection[]
  onNavigate: (view: AppView) => void
}) {
  const { monthRef, setMonthRef, reservations, reminders, activities, activeUsers, calendarError, activityError, loadingCalendar, loadingActivity, kpi } = useHomeData(user)
  const [selectedDate, setSelectedDate] = useState(todayIso)
  const [onlyMine, setOnlyMine] = useState(false)
  const [selectedUser, setSelectedUser] = useState('')
  const [detailDay, setDetailDay] = useState<string | null>(null)
  const [bridgeDay, setBridgeDay] = useState<string | null>(null)

  const filteredReservations = useMemo(() => {
    const currentUser = user.username.toLowerCase()
    return reservations.filter((item) => {
      if (selectedUser) {
        const normalized = selectedUser.toLowerCase()
        const participant = item.participantes.some((name) => name.toLowerCase() === normalized)
        const creator = String(item.criadoPor || '').toLowerCase() === normalized
        if (!participant && !creator) return false
      }
      if (onlyMine) {
        const mine = item.participantes.some((name) => name.toLowerCase() === currentUser) || String(item.criadoPor || '').toLowerCase() === currentUser
        if (!mine) return false
      }
      return true
    })
  }, [onlyMine, reservations, selectedUser, user.username])

  const filteredReminders = useMemo(() => {
    if (!selectedUser || selectedUser.toLowerCase() === user.username.toLowerCase()) return reminders
    return []
  }, [reminders, selectedUser, user.username])

  const countsByDay = useMemo(() => {
    const map = new Map<string, { reservations: ReservationItem[]; reminders: ReminderItem[] }>()
    for (const item of filteredReservations) {
      const key = item.data.slice(0, 10)
      const current = map.get(key) ?? { reservations: [], reminders: [] }
      current.reservations.push(item)
      map.set(key, current)
    }
    for (const item of filteredReminders) {
      const key = item.data.slice(0, 10)
      const current = map.get(key) ?? { reservations: [], reminders: [] }
      current.reminders.push(item)
      map.set(key, current)
    }
    return map
  }, [filteredReminders, filteredReservations])

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
      const last = days.length - startOffset - totalDays + 1
      const nextDate = new Date(monthRef.getFullYear(), monthRef.getMonth() + 1, last)
      days.push({ iso: nextDate.toISOString().slice(0, 10), day: nextDate.getDate(), out: true })
    }

    return days
  }, [monthRef])

  const meetingsToday = useMemo(() => filteredReservations.filter((item) => item.data.slice(0, 10) === todayIso).length, [filteredReservations])
  const upcomingWeek = useMemo(() => {
    const now = new Date(`${todayIso}T00:00:00`)
    const limit = new Date(now)
    limit.setDate(limit.getDate() + 7)
    return filteredReservations.filter((item) => {
      const date = new Date(`${item.data.slice(0, 10)}T00:00:00`)
      return date >= now && date <= limit
    }).length
  }, [filteredReservations])

  const dayDetails = detailDay ? countsByDay.get(detailDay) : null

  useEffect(() => {
    const monthKey = `${monthRef.getFullYear()}-${String(monthRef.getMonth() + 1).padStart(2, '0')}`
    if (!selectedDate.startsWith(monthKey)) setSelectedDate(`${monthKey}-01`)
  }, [monthRef, selectedDate])

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-thermo-border bg-white px-4 py-4 shadow-sm md:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Visão geral</div>
            <h1 className="mt-1 text-xl font-bold text-thermo-navy">Agenda e indicadores</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="thermo-button thermo-button-primary" type="button" onClick={() => onNavigate('products')}>
              <Boxes className="size-4" />
              Lista de Produtos
            </button>
            <button className="thermo-button thermo-button-secondary" type="button" onClick={() => onNavigate('calendar')}>
              <ExternalLink className="size-4" />
              Abrir agenda
            </button>
          </div>
        </div>
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <section className="min-w-0 rounded-lg border border-thermo-border bg-white p-3 shadow-sm md:p-4">
            <div className="mb-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
              <article className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Reuniões hoje</div>
                <div className="mt-2 text-2xl font-bold text-thermo-navy">{meetingsToday}</div>
              </article>
              <article className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Próximos 7 dias</div>
                <div className="mt-2 text-2xl font-bold text-thermo-navy">{upcomingWeek}</div>
              </article>
              <article className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Abaixo do mínimo</div>
                <div className="mt-2 text-2xl font-bold text-thermo-navy">{kpi.belowMin}</div>
              </article>
              <article className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Em compra</div>
                <div className="mt-2 text-2xl font-bold text-thermo-navy">{kpi.inPurchase ?? '—'}</div>
                {kpi.purchaseUnavailable ? <div className="mt-1 text-[11px] text-amber-700">Dado indisponível</div> : null}
              </article>
            </div>

            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                className={clsx('inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold', onlyMine ? 'border-thermo-navy bg-thermo-navy text-white' : 'border-thermo-border bg-white text-thermo-navy')}
                onClick={() => setOnlyMine((current) => !current)}
                aria-pressed={onlyMine}
              >
                <Check className="size-4" />
                Somente minhas
              </button>

              <label className="flex min-w-[16rem] items-center gap-2 rounded-xl border border-thermo-border bg-white px-3 py-2 text-sm text-slate-600">
                <Users className="size-4 text-slate-400" />
                <select value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)} className="min-w-0 flex-1 bg-transparent outline-none">
                  <option value="">Filtrar por usuário...</option>
                  {activeUsers.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              {legendItems.map((item) => {
                const Icon = item.icon
                return (
                <span key={item.label} className="rounded-full border border-thermo-border bg-white px-3 py-1">
                  <Icon className={clsx('mr-1 inline size-3.5', item.tone)} aria-hidden="true" />
                  {item.label}
                </span>
                )
              })}
            </div>

            <div className="mb-3 flex items-center justify-between gap-3">
              <button className="thermo-button thermo-button-secondary" type="button" onClick={() => setMonthRef(new Date(monthRef.getFullYear(), monthRef.getMonth() - 1, 1))} aria-label="Mês anterior">
                <ChevronLeft className="size-4" />
              </button>
              <div className="text-center">
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Calendário de reuniões</div>
                <h2 className="mt-1 text-lg font-bold capitalize text-thermo-navy">{formatMonthLabel(monthRef)}</h2>
              </div>
              <button className="thermo-button thermo-button-secondary" type="button" onClick={() => setMonthRef(new Date(monthRef.getFullYear(), monthRef.getMonth() + 1, 1))} aria-label="Próximo mês">
                <ChevronRight className="size-4" />
              </button>
            </div>

            {calendarError ? <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{calendarError}</div> : null}
            {loadingCalendar ? <div className="mb-4 rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 text-sm text-slate-500">Carregando agenda real…</div> : null}

            <div className="grid min-w-0 grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500 md:gap-2 md:text-[11px]">
              {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((label) => (
                <div key={label} className="px-1 py-2">
                  {label}
                </div>
              ))}
              {monthDays.map((day) => {
                const dayData = countsByDay.get(day.iso)
                const dayReservations = dayData?.reservations ?? []
                const dayReminders = dayData?.reminders ?? []
                const selected = selectedDate === day.iso
                const isToday = day.iso === todayIso
                const isPast = day.iso < todayIso
                const visibleDayItems = [
                  ...dayReservations.slice(0, 2).map((item) => ({
                    key: `reservation-${item.id}-${item.data}`,
                    label: `${formatTime(item.inicio)} ${item.tema || getReservationTypeLabel(item)}`,
                    tone: getReservationTypeTone(item),
                  })),
                  ...dayReminders.slice(0, 1).map((item) => ({
                    key: `reminder-${item.id}`,
                    label: `Lembrete ${item.texto}`,
                    tone: 'border-amber-200 bg-amber-50 text-amber-800',
                  })),
                ].slice(0, 2)
                const overflowCount = Math.max(dayReservations.length + dayReminders.length - visibleDayItems.length, 0)
                const toneCounts = {
                  violets: dayReservations.filter((item) => String(item.tipo || '').toLowerCase().includes('audit')).length,
                  greens: dayReservations.filter((item) => {
                    const type = String(item.tipo || '').toLowerCase()
                    return !type.includes('audit') && !type.includes('online') && !type.includes('visita') && !type.includes('evento')
                  }).length,
                  skies: dayReservations.filter((item) => String(item.tipo || '').toLowerCase().includes('online')).length,
                  oranges: dayReservations.filter((item) => String(item.tipo || '').toLowerCase().includes('visita')).length,
                  pinks: dayReservations.filter((item) => String(item.tipo || '').toLowerCase().includes('evento')).length,
                  reminders: dayReminders.length,
                }
                return (
                  <button
                    key={day.iso}
                    type="button"
                    onClick={() => {
                      setSelectedDate(day.iso)
                      if (dayReservations.length > 0 || dayReminders.length > 0) setDetailDay(day.iso)
                      else setBridgeDay(day.iso)
                    }}
                    className={clsx(
                      'min-w-0 min-h-[62px] rounded-lg border p-1 text-left transition focus:outline-none focus:ring-2 focus:ring-thermo-navy/40 md:min-h-[92px] md:p-2',
                      selected ? 'border-thermo-navy bg-slate-50' : 'border-thermo-border bg-thermo-bg hover:border-thermo-navy/30',
                      day.out && 'opacity-35',
                      isPast && 'opacity-55',
                      isToday && 'ring-1 ring-thermo-red/50',
                    )}
                    title={[
                      formatDateLabel(day.iso),
                      ...dayReservations.slice(0, 3).map((item) => `${formatTime(item.inicio)} ${item.tema || getReservationTypeLabel(item)} · ${getReservationTypeLabel(item)}`),
                      ...dayReminders.slice(0, 1).map((item) => `Lembrete · ${item.texto}`),
                    ].join('\n')}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-bold text-thermo-navy md:text-sm">{day.day}</span>
                      {isToday ? <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-bold text-red-700">Hoje</span> : null}
                    </div>

                    <div className="flex min-h-[32px] flex-1 flex-col justify-end gap-1 md:min-h-[44px]">
                      {visibleDayItems.length > 0 ? (
                        <div className="space-y-1">
                          {visibleDayItems.slice(0, 1).map((item) => (
                            <div
                              key={item.key}
                              className={clsx(
                                'truncate rounded-md border px-1.5 py-0.5 text-[9px] font-semibold leading-tight md:text-[10px]',
                                item.tone,
                              )}
                            >
                              {item.label}
                            </div>
                          ))}
                          {visibleDayItems.length > 1 ? (
                            <div
                              className={clsx(
                                'hidden truncate rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-tight md:block',
                                visibleDayItems[1]?.tone,
                              )}
                            >
                              {visibleDayItems[1]?.label}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-1">
                        {toneCounts.violets > 0 ? <span className="size-2 rounded-full bg-violet-500" aria-label={`Auditório ${toneCounts.violets}`} /> : null}
                        {toneCounts.greens > 0 ? <span className="size-2 rounded-full bg-emerald-500" aria-label={`Sala ${toneCounts.greens}`} /> : null}
                        {toneCounts.skies > 0 ? <span className="size-2 rounded-full bg-sky-500" aria-label={`Online ${toneCounts.skies}`} /> : null}
                        {toneCounts.oranges > 0 ? <span className="size-2 rounded-full bg-orange-500" aria-label={`Visita ${toneCounts.oranges}`} /> : null}
                        {toneCounts.pinks > 0 ? <span className="size-2 rounded-full bg-pink-500" aria-label={`Evento ${toneCounts.pinks}`} /> : null}
                        {toneCounts.reminders > 0 ? <span className="size-2 rounded-full bg-amber-400" aria-label={`Lembrete ${toneCounts.reminders}`} /> : null}
                      </div>
                      {dayReservations.length + dayReminders.length > 0 ? (
                        <div className="text-[10px] font-semibold text-slate-500 md:text-[11px]">
                          {overflowCount > 0 ? `+${overflowCount}` : `${dayReservations.length + dayReminders.length} item(ns)`}
                        </div>
                      ) : (
                        <div className="text-[10px] font-medium text-slate-400">Livre</div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          <ModulesSection sections={sections.filter((section) => section.key !== 'top')} activeView="home" onNavigate={onNavigate} />
        </div>

        <aside className="space-y-4">
          <section className="rounded-3xl border border-thermo-border bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Últimas coisas feitas</div>
            <h3 className="mt-1 text-base font-bold text-thermo-navy">Cronologia operacional</h3>
            {activityError ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{activityError}</div> : null}
            {loadingActivity ? <div className="mt-4 rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 text-sm text-slate-500">Carregando cronologia…</div> : null}
            <div className="mt-4 space-y-3">
              {!loadingActivity && !activityError && activities.length === 0 ? <div className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-4 text-sm text-slate-500">Nenhuma atividade recente disponível para esta sessão.</div> : null}
              {activities.map((event) => (
                <article key={event.id} className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-thermo-navy">{event.acao}</div>
                      <div className="mt-1 text-xs text-slate-500">{new Date(event.ocorrido_em).toLocaleString('pt-BR')}</div>
                    </div>
                    <span className={clsx('rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]', event.sucesso === false ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700')}>
                      {event.sucesso === false ? 'Erro' : 'Sucesso'}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-slate-600">{[event.usuario_nome || user.username, event.codigo_produto || event.codigo_produto_omie, event.n_solic, event.sessao_descricao].filter(Boolean).join(' · ') || 'Sem contexto adicional'}</div>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </section>

      <ModalShell
        open={Boolean(detailDay)}
        title={detailDay ? `Detalhes do dia · ${formatDateLabel(detailDay)}` : 'Detalhes do dia'}
        description="Dados reais de reuniões e lembretes para a data selecionada."
        onClose={() => setDetailDay(null)}
        panelStyle={{ width: 'min(96vw, 44rem)', maxWidth: '44rem', flexShrink: 0 }}
      >
        <div className="space-y-4">
          {(dayDetails?.reservations ?? []).map((item) => (
            <article key={`${item.id}-${item.data}`} className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-base font-bold text-thermo-navy">{item.tema || 'Sem tema'}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {formatTime(item.inicio)}–{formatTime(item.fim)} · {getReservationTypeLabel(item)}
                  </div>
                </div>
                <span className={clsx('rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]', getReservationTypeTone(item))}>
                  {item.cancelada ? 'Cancelada' : item.realizada ? 'Realizada' : 'Programada'}
                </span>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Organizador</div>
                  <div className="mt-1 text-sm text-thermo-ink">{item.criadoPor || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Participantes</div>
                  <div className="mt-1 text-sm text-thermo-ink">{item.participantes.length ? item.participantes.join(', ') : '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Avisos</div>
                  <div className="mt-1 text-sm text-thermo-ink">
                    {[item.avisoEmail ? 'E-mail' : null, item.avisoWhatsapp ? 'WhatsApp' : null].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Participação</div>
                  <div className="mt-1 text-sm text-thermo-ink">
                    {item.participantes.some((name) => name.toLowerCase() === user.username.toLowerCase()) ? 'Você é participante' : 'Sem participação direta'}
                  </div>
                </div>
              </div>
            </article>
          ))}

          {(dayDetails?.reminders ?? []).map((item) => (
            <article key={`rem-${item.id}`} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
              <div className="text-base font-bold text-amber-900">{item.texto}</div>
              <div className="mt-1 text-sm text-amber-800">Criado por {item.criadoPor || '—'} · {item.destinatarios.join(', ') || 'Sem destinatários'}</div>
            </article>
          ))}

          <div className="flex flex-wrap gap-2">
            <button className="thermo-button thermo-button-primary" type="button" onClick={() => { setDetailDay(null); onNavigate('calendar') }}>
              <ExternalLink className="size-4" />
              Abrir agenda
            </button>
            <button className="thermo-button thermo-button-secondary" type="button" onClick={() => setDetailDay(null)}>
              Fechar
            </button>
          </div>
        </div>
      </ModalShell>

      <ModalShell
        open={Boolean(bridgeDay)}
        title={bridgeDay ? `Reservar · ${formatDateLabel(bridgeDay)}` : 'Reservar'}
        description="A reserva é registrada na Agenda."
        onClose={() => setBridgeDay(null)}
        panelStyle={{ width: 'min(92vw, 32rem)', maxWidth: '32rem', flexShrink: 0 }}
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            Para registrar uma reserva nesta data, continue na Agenda.
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="thermo-button thermo-button-primary" type="button" onClick={() => { setBridgeDay(null); onNavigate('calendar') }}>
              <ExternalLink className="size-4" />
              Abrir agenda
            </button>
            <button className="thermo-button thermo-button-secondary" type="button" onClick={() => setBridgeDay(null)}>
              Fechar
            </button>
          </div>
        </div>
      </ModalShell>
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

function PermissionDenied({ feature }: { feature: string }) {
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
      <Lock className="size-6" />
      <h1 className="mt-3 text-xl font-bold">Acesso bloqueado</h1>
      <p className="mt-1 text-sm">Sua árvore real de permissões não liberou {feature}.</p>
    </section>
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
    if (typeof window !== 'undefined') window.sessionStorage.setItem(sidebarStateKey, collapsed ? '1' : '0')
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
        setAuthError(message)
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
  const canStoreMaterials = useMemo(() => isSelectorAllowed('#menu-guardar-materiais', navigation.selectorMap) || isSelectorAllowed('#menu-guardar-materiais-expedicao', navigation.selectorMap), [navigation.selectorMap])
  const canIdentifyProduct = useMemo(() => isSelectorAllowed('#menu-identificacao-produto', navigation.selectorMap) || isSelectorAllowed('#menu-identificacao-produto-expedicao', navigation.selectorMap), [navigation.selectorMap])
  const canReceive = useMemo(() => isSelectorAllowed('#menu-recebimento', navigation.selectorMap), [navigation.selectorMap])
  const canViewReceived = useMemo(() => isSelectorAllowed('#menu-produto-recebido', navigation.selectorMap), [navigation.selectorMap])
  const canShip = useMemo(() => isSelectorAllowed('#menu-envio-mercadoria', navigation.selectorMap), [navigation.selectorMap])
  const canViewMachineStock = useMemo(() => isSelectorAllowed('#menu-estoque-maquinas', navigation.selectorMap), [navigation.selectorMap])
  const canSimulateFreight = useMemo(() => isSelectorAllowed('#menu-simulador-frete', navigation.selectorMap), [navigation.selectorMap])
  const canUsePir = useMemo(() => isSelectorAllowed('#menu-qualidade-fabrica', navigation.selectorMap) || isSelectorAllowed('#menu-engenharia-pir-eng', navigation.selectorMap), [navigation.selectorMap])
  const canViewSalesReport = useMemo(() => isSelectorAllowed('#menu-vendas-relatorio', navigation.selectorMap), [navigation.selectorMap])
  const canConfigurePrintAgent = useMemo(() => isSelectorAllowed('#menu-configurar-agente', navigation.selectorMap), [navigation.selectorMap])
  const canUseWarehouses = useMemo(() => isSelectorAllowed('#menu-armazens', navigation.selectorMap), [navigation.selectorMap])
  const canRequestStockAdjustment = useMemo(() => isSelectorAllowed('#menu-solicitacao-ajuste', navigation.selectorMap), [navigation.selectorMap])
  const canViewLogisticsReport = useMemo(() => isSelectorAllowed('#menu-log-relatorio', navigation.selectorMap), [navigation.selectorMap])
  const canViewMinimumStock = useMemo(() => isSelectorAllowed('#menu-estoque-minimo', navigation.selectorMap), [navigation.selectorMap])
  const canRegisterProduction = useMemo(() => isSelectorAllowed('#menu-registrar-producao', navigation.selectorMap), [navigation.selectorMap])
  const canViewSalesControl = useMemo(() => isSelectorAllowed('#menu-vendas-controle', navigation.selectorMap), [navigation.selectorMap])
  const canUseFirstPiece = useMemo(() => isSelectorAllowed('#menu-producao-primeira-peca-ok', navigation.selectorMap), [navigation.selectorMap])
  const canViewProductionRecords = useMemo(() => isSelectorAllowed('#menu-registro-producao', navigation.selectorMap), [navigation.selectorMap])
  const canViewSalesCharts = useMemo(() => isSelectorAllowed('#menu-vendas-graficos', navigation.selectorMap), [navigation.selectorMap])
  const canViewProductionIncidents = useMemo(() => isSelectorAllowed('#menu-producao-ocorrencias', navigation.selectorMap), [navigation.selectorMap])
  const canWriteProductionIncidents = useMemo(() => permissionNodes.some((node) => node.allowed && node.selector === '#menu-producao-ocorrencias' && /(?:write|edit|escrever|editar)/i.test(node.key)), [permissionNodes])
  const canViewInspectionRecords = useMemo(() => isSelectorAllowed('#menu-ri-registro-inspecao', navigation.selectorMap), [navigation.selectorMap])
  const canViewSalesMap = useMemo(() => isSelectorAllowed('#menu-vendas-mapa', navigation.selectorMap), [navigation.selectorMap])
  const canUsePreparations = useMemo(() => isSelectorAllowed('#menu-preparacoes', navigation.selectorMap), [navigation.selectorMap])
  const canViewQualityManuals = useMemo(() => isSelectorAllowed('#menu-qualidade-manuais', navigation.selectorMap), [navigation.selectorMap])
  const canViewProductionReport = useMemo(() => isSelectorAllowed('#menu-producao-relatorio', navigation.selectorMap), [navigation.selectorMap])
  const canViewProductionTests = useMemo(() => isSelectorAllowed('#menu-producao-testes', navigation.selectorMap), [navigation.selectorMap])
  const canViewRedArea = useMemo(() => isSelectorAllowed('#menu-qualidade-area-vermelha', navigation.selectorMap), [navigation.selectorMap])
  const canViewPurchaseAccounts = useMemo(() => isSelectorAllowed('#menu-compras-contas-utilizadas', navigation.selectorMap), [navigation.selectorMap])
  const canViewPurchaseSettings = useMemo(() => isSelectorAllowed('#menu-compras-configuracoes', navigation.selectorMap), [navigation.selectorMap])
  const canWritePurchaseSettings = useMemo(() => permissionNodes.some((node) => node.allowed && node.selector === '#menu-compras-configuracoes' && /(?:write|edit|escrever|editar|crud)/i.test(node.key)), [permissionNodes])
  const canViewSacShippingRequest = useMemo(() => isSelectorAllowed('#menu-sac-solicitacao-envio', navigation.selectorMap), [navigation.selectorMap])
  const canViewSacReport = useMemo(() => isSelectorAllowed('#menu-sac-at-relatorio', navigation.selectorMap), [navigation.selectorMap])
  const canViewProductionGemba = useMemo(() => isSelectorAllowed('#menu-producao-gemba', navigation.selectorMap), [navigation.selectorMap])
  const canViewEngineeringChanges = useMemo(() => isSelectorAllowed('#menu-engenharia-alteracoes', navigation.selectorMap), [navigation.selectorMap])
  const canViewChatbotMonitor = useMemo(() => isSelectorAllowed('#menu-chatbot-monitor', navigation.selectorMap), [navigation.selectorMap])

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
            <div className="mx-auto flex h-14 max-w-[1760px] items-center justify-between gap-3 px-4 md:px-6 xl:px-8">
              <div className="flex items-center gap-3">
                <button className="rounded-lg border border-thermo-border p-2 md:hidden" type="button" onClick={() => setMenuOpen(true)} aria-label="Abrir navegação">
                  <Menu className="size-4 text-thermo-navy" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="hidden text-sm font-semibold text-thermo-navy sm:inline">{user.username}</span>
                <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-thermo-border bg-white px-3 text-sm font-semibold text-thermo-navy hover:bg-slate-50" type="button" onClick={() => void doLogout()}>
                  <LogOut className="size-4" />
                  <span className="hidden sm:inline">Sair</span>
                </button>
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-[1760px] px-4 py-4 md:px-6 xl:px-8">
            {permissionError ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{permissionError}</div> : null}

            {activeView === 'home' ? (
              <HomeScreen
                user={user}
                sections={navigation.sections}
                onNavigate={(view) => setActiveView(view)}
              />
            ) : activeView === 'calendar' ? (
              <CalendarScreen currentUser={user.username} />
            ) : activeView === 'products' ? (
              <ProductListScreen
                permissions={{
                  canOpenCart,
                  canOpenSeparation,
                  canEditCatalog,
                  cartReason: canOpenCart ? null : 'Sua árvore de permissões não liberou o painel de compras (#cart-icon).',
                  separationReason: canOpenSeparation ? null : 'Sua árvore de permissões não liberou a Solicitação de transferência (#menu-solicitacao-transferencia).',
                }}
              />
            ) : activeView === 'product-registration' ? (
              <ProductRegistrationScreen hasPermission={canEditCatalog} />
            ) : activeView === 'separation' ? (
              <SeparationWorkspace />
            ) : activeView === 'store-materials' ? (
              <StoreMaterialsScreen username={user.username} allowed={canStoreMaterials} />
            ) : activeView === 'identify-product' ? (
              <IdentifyProductScreen username={user.username} allowed={canIdentifyProduct} />
            ) : activeView === 'receiving' ? (
              <ReceivingScreen allowed={canReceive} />
            ) : activeView === 'products-received' ? (
              <ProductsReceivedScreen allowed={canViewReceived} />
            ) : activeView === 'shipping' ? (
              <ShippingScreen allowed={canShip} />
            ) : activeView === 'freight-simulator' ? (
              <FreightSimulatorScreen allowed={canSimulateFreight} canEditProducts={canEditCatalog} />
            ) : activeView === 'pir' ? (
              canUsePir ? <PirScreen /> : <PermissionDenied feature="PIR" />
            ) : activeView === 'sales-report' ? (
              canViewSalesReport ? <SalesReportScreen /> : <PermissionDenied feature="Relatório Gerencial de Vendas" />
            ) : activeView === 'print-agent-config' ? (
              canConfigurePrintAgent ? <PrintAgentConfigScreen /> : <PermissionDenied feature="Configurador do agente de impressão" />
            ) : activeView === 'warehouses' ? (
              canUseWarehouses ? <WarehouseScreen username={user.username} /> : <PermissionDenied feature="Armazéns" />
            ) : activeView === 'stock-adjustment' ? (
              <StockAdjustmentScreen currentUser={user.username} allowed={canRequestStockAdjustment} />
            ) : activeView === 'logistics-report' ? (
              canViewLogisticsReport ? <LogisticsReportScreen /> : <PermissionDenied feature="Relatório Logística" />
            ) : activeView === 'minimum-stock' ? (
              canViewMinimumStock ? <MinimumStockScreen /> : <PermissionDenied feature="Estoque mínimo" />
            ) : activeView === 'production-registration' ? (
              <ProductionRegistrationScreen username={user.username} allowed={canRegisterProduction} />
            ) : activeView === 'sales-control' ? (
              <SalesControlScreen allowed={canViewSalesControl} />
            ) : activeView === 'first-piece' ? (
              <FirstPieceScreen allowed={canUseFirstPiece} />
            ) : activeView === 'production-records' ? (
              canViewProductionRecords ? <ProductionRecordsScreen /> : <PermissionDenied feature="Registro de produção" />
            ) : activeView === 'sales-charts' ? (
              canViewSalesCharts ? <SalesChartsScreen /> : <PermissionDenied feature="Gráficos de Vendas" />
            ) : activeView === 'production-incidents' ? (
              <ProductionIncidentsScreen allowed={canViewProductionIncidents} canWrite={canWriteProductionIncidents} />
            ) : activeView === 'inspection-records' ? (
              <InspectionRecordsScreen allowed={canViewInspectionRecords} />
            ) : activeView === 'sales-map' ? (
              canViewSalesMap ? <SalesMapScreen /> : <PermissionDenied feature="Mapa de Vendas" />
            ) : activeView === 'preparations' ? (
              <PreparationsScreen username={user.username} allowed={canUsePreparations} />
            ) : activeView === 'quality-manuals' ? (
              <QualityManualsScreen allowed={canViewQualityManuals} canManageProducts={false} canUploadMaster={false} />
            ) : activeView === 'production-report' ? (
              canViewProductionReport ? <ProductionReportScreen /> : <PermissionDenied feature="Relatório de produção" />
            ) : activeView === 'production-tests' ? (
              <ProductionTestsScreen allowed={canViewProductionTests} />
            ) : activeView === 'red-area' ? (
              <RedAreaScreen allowed={canViewRedArea} canWrite={false} currentUser={user.username} />
            ) : activeView === 'purchase-accounts' ? (
              canViewPurchaseAccounts ? <PurchaseAccountsScreen /> : <PermissionDenied feature="Contas utilizadas" />
            ) : activeView === 'purchase-settings' ? (
              <PurchaseSettingsScreen allowed={canViewPurchaseSettings} canWrite={canWritePurchaseSettings} />
            ) : activeView === 'sac-shipping-request' ? (
              <SacShippingRequestScreen allowed={canViewSacShippingRequest} canWrite={false} canCreate={false} />
            ) : activeView === 'sac-report' ? (
              canViewSacReport ? <SacReportScreen /> : <PermissionDenied feature="Relatório SAC/AT" />
            ) : activeView === 'production-gemba' ? (
              canViewProductionGemba ? <ProductionGembaScreen /> : <PermissionDenied feature="Gemba de produção" />
            ) : activeView === 'engineering-changes' ? (
              canViewEngineeringChanges ? <EngineeringChangesScreen /> : <PermissionDenied feature="Alterações de engenharia" />
            ) : activeView === 'chatbot-monitor' ? (
              canViewChatbotMonitor ? <ChatbotMonitorScreen /> : <PermissionDenied feature="Monitor do chatbot" />
            ) : (
              <MachineStockScreen allowed={canViewMachineStock} />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

export default App
