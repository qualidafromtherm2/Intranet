import { clsx } from 'clsx'
import { Boxes, ExternalLink, Home, LogOut, Menu, ShieldCheck, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ModalShell } from './components/ModalShell'
import { ProductListScreen } from './features/ProductListScreen'
import { buildAllowedAreas } from './lib/navigation'
import { buildLegacyUrl, getAuthStatus, getPermissionTree, login, logout } from './services/authGateway'
import type { AppView, AuthUser, ShellAction } from './types'

function isPermissionEnabled(selector: string, areaActions: ShellAction[]) {
  return areaActions.some((action) => action.selector === selector)
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
            <div className="mt-8 max-w-xl text-4xl font-bold">Migração progressiva da Intranet para Thermo sem quebrar regras de negócio.</div>
            <p className="mt-4 max-w-xl text-base text-slate-200">
              Este piloto mantém autenticação, sessão e dados reais do legado. A casca React/Tailwind serve apenas a navegação que já existe hoje.
            </p>
          </div>
          <div className="grid gap-3 text-sm text-slate-200 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
              <div className="font-semibold text-white">Login real</div>
              <div className="mt-1">Usa /api/auth/login, /api/auth/status e /api/auth/logout do backend atual.</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
              <div className="font-semibold text-white">Lista real</div>
              <div className="mt-1">Produtos, paginação, pesquisa e filtros continuam conectados às APIs do sistema atual.</div>
            </div>
          </div>
        </section>

        <section className="flex items-center">
          <div className="w-full rounded-[28px] border border-thermo-border bg-white p-6 shadow-sm md:p-8">
            <div className="mb-6 flex items-center justify-between gap-4">
              <img src="/branding/thermo-logo-principal.png" alt="Thermo" className="h-9 w-auto" />
              <img src="/branding/thermo-app-icon.png" alt="" className="size-10 rounded-2xl" />
            </div>
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-thermo-navy">Entrar</h1>
              <p className="mt-2 text-sm text-slate-500">Use seu usuário e senha atuais da Intranet.</p>
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

function Sidebar({
  open,
  activeView,
  onClose,
  onNavigate,
  onSelectArea,
  currentAreaId,
  areaEntries,
}: {
  open: boolean
  activeView: AppView
  onClose: () => void
  onNavigate: (view: AppView) => void
  onSelectArea: (areaId: string) => void
  currentAreaId: string | null
  areaEntries: Array<{ id: string; title: string }>
}) {
  const content = (
    <aside className="flex h-full w-full max-w-80 flex-col bg-thermo-navy px-4 py-5 text-slate-100">
      <div className="mb-6 flex items-center justify-between gap-3">
        <img src="/branding/thermo-logo-fundo-escuro.png" alt="Thermo" className="h-8 w-auto" />
        <button className="rounded-xl border border-white/15 p-2 text-white md:hidden" type="button" onClick={onClose} aria-label="Fechar navegação">
          <X className="size-4" />
        </button>
      </div>

      <nav className="space-y-2">
        <button className={clsx('thermo-sidebar-link', activeView === 'home' && 'thermo-sidebar-link-active')} type="button" onClick={() => { onNavigate('home'); onClose() }}>
          <Home className="size-4" />
          Página inicial
        </button>
        <button className={clsx('thermo-sidebar-link', activeView === 'products' && 'thermo-sidebar-link-active')} type="button" onClick={() => { onNavigate('products'); onClose() }}>
          <Boxes className="size-4" />
          Lista de produtos
        </button>
      </nav>

      <div className="mt-8 border-t border-white/10 pt-5">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Áreas permitidas</div>
        <div className="space-y-2">
          {areaEntries.slice(0, 4).map((area) => (
            <button key={area.id} className={clsx('thermo-sidebar-link', currentAreaId === area.id && 'thermo-sidebar-link-active')} type="button" onClick={() => { onSelectArea(area.id); onNavigate('home'); onClose() }}>
              {area.title}
            </button>
          ))}
          {areaEntries.length > 4 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-300">
              Mais {areaEntries.length - 4} área(s) disponível(is) na página inicial.
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  )

  if (!open) {
    return <div className="hidden h-full md:block">{content}</div>
  }

  return (
    <ModalShell open title="Navegação operacional" onClose={onClose} panelStyle={{ width: 'min(88vw, 24rem)', maxWidth: '24rem', flexShrink: 0 }} panelClassName="bg-transparent">
      <div className="-mx-5 -my-4 h-[calc(100%+2rem)]">{content}</div>
    </ModalShell>
  )
}

function HomeScreen({
  user,
  areaId,
  onSelectArea,
  onOpenProducts,
  allowedAreas,
}: {
  user: AuthUser
  areaId: string | null
  onSelectArea: (areaId: string) => void
  onOpenProducts: () => void
  allowedAreas: ReturnType<typeof buildAllowedAreas>
}) {
  const currentArea = allowedAreas.find((area) => area.id === areaId) ?? allowedAreas[0] ?? null

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-thermo-border bg-white px-5 py-5 shadow-sm md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-500">Sessão ativa</div>
            <h1 className="mt-1 text-2xl font-bold text-thermo-navy">Olá, {user.username}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Esta home usa permissões reais da sua sessão atual para listar apenas módulos e rotinas liberados. O que ainda não foi migrado abre a Intranet legada em URL real.
            </p>
          </div>
          <div className="rounded-2xl border border-thermo-border bg-thermo-bg px-4 py-3 text-sm text-slate-600">
            <div className="font-semibold text-thermo-navy">{user.funcao_nome || 'Função não informada'}</div>
            <div>{user.setor || 'Setor não informado'}</div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="rounded-[28px] border border-thermo-border bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-thermo-navy">Módulos liberados</h2>
            <span className="rounded-full border border-thermo-border bg-thermo-bg px-3 py-1 text-xs font-semibold text-slate-600">{allowedAreas.length}</span>
          </div>
          <div className="space-y-3">
            {allowedAreas.map((area) => (
              <button key={area.id} className={clsx('w-full rounded-2xl border px-4 py-4 text-left transition', areaId === area.id ? 'border-thermo-navy bg-slate-50' : 'border-thermo-border hover:border-thermo-navy/30')} type="button" onClick={() => onSelectArea(area.id)}>
                <div className="flex items-center justify-between gap-3">
                  <span className={clsx('rounded-full border px-3 py-1 text-xs font-bold', area.accent)}>{area.title}</span>
                  <span className="text-xs font-semibold text-slate-500">{area.actions.length} rotina(s)</span>
                </div>
                <div className="mt-2 text-sm text-slate-600">{area.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[28px] border border-thermo-border bg-white p-5 shadow-sm">
          {currentArea ? (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-thermo-navy">{currentArea.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">{currentArea.description}</p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {currentArea.actions.map((action) => (
                  <article key={action.id} className="rounded-2xl border border-thermo-border bg-thermo-bg p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-bold text-thermo-navy">{action.title}</div>
                        <div className="mt-1 text-sm text-slate-600">{action.description}</div>
                      </div>
                      <span className={clsx('rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]', action.view === 'products' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>
                        {action.view === 'products' ? 'Migrado' : 'Legado'}
                      </span>
                    </div>
                    <div className="mt-4">
                      {action.view === 'products' ? (
                        <button className="thermo-button thermo-button-primary" type="button" onClick={onOpenProducts}>
                          <Boxes className="size-4" />
                          Abrir lista migrada
                        </button>
                      ) : (
                        <a className="thermo-button thermo-button-secondary" href={action.legacyPath || buildLegacyUrl('/menu_produto.html')} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-4" />
                          Abrir no legado
                        </a>
                      )}
                    </div>
                    {action.legacyHint ? <div className="mt-2 text-xs text-slate-500">{action.legacyHint}</div> : null}
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              Sua sessão está ativa, mas nenhuma rotina navegável foi encontrada no mapa atual de permissões.
            </div>
          )}
        </div>
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
  const [areaId, setAreaId] = useState<string | null>('logistica')
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [allowedAreas, setAllowedAreas] = useState<ReturnType<typeof buildAllowedAreas>>([])

  useEffect(() => {
    const loadSession = async () => {
      setBusy(true)
      setAuthError(null)
      setPermissionError(null)

      try {
        const status = await getAuthStatus()
        if (!status.loggedIn || !status.user) {
          setUser(null)
          setAllowedAreas([])
          return
        }

        setUser(status.user)

        try {
          const tree = await getPermissionTree()
          const nextAreas = buildAllowedAreas(tree.nodes)
          setAllowedAreas(nextAreas)
          setAreaId(nextAreas[0]?.id || null)
        } catch (error) {
          setPermissionError(error instanceof Error ? error.message : 'Falha ao carregar permissões reais.')
          setAllowedAreas([])
        }
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'Falha ao validar a sessão atual.')
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
      const nextAreas = buildAllowedAreas(tree.nodes)
      setAllowedAreas(nextAreas)
      setAreaId(nextAreas[0]?.id || null)
      setActiveView('home')
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
      setAllowedAreas([])
      setAreaId('logistica')
      setActiveView('home')
      setBusy(false)
    }
  }

  const currentLogistica = allowedAreas.find((area) => area.id === 'logistica')
  const canOpenCart = currentLogistica ? (isPermissionEnabled('#cart-icon', currentLogistica.actions) || currentLogistica.actions.some((action) => action.id === 'compras')) : true
  const canOpenSeparation = currentLogistica ? (isPermissionEnabled('#menu-solicitacao-transferencia', currentLogistica.actions) || currentLogistica.actions.some((action) => action.id === 'expedicao')) : true

  const topRightLabel = useMemo(() => {
    if (!user) return null
    const role = user.funcao_nome || user.roles[0] || 'Sessão ativa'
    return `${role}${user.setor ? ` · ${user.setor}` : ''}`
  }, [user])

  if (busy && !user && !authError) return <LoadingShell message="Validando sessão real…" />

  if (!user) {
    return <LoginScreen busy={busy} error={authError} onSubmit={loginSubmit} />
  }

  return (
    <div className="min-h-screen bg-thermo-bg text-thermo-ink">
      <div className="flex min-h-screen">
        <Sidebar
          open={menuOpen}
          activeView={activeView}
          onClose={() => setMenuOpen(false)}
          onNavigate={setActiveView}
          onSelectArea={setAreaId}
          currentAreaId={areaId}
          areaEntries={allowedAreas.map((area) => ({ id: area.id, title: area.title }))}
        />

        <div className="min-w-0 flex-1">
          <header className="border-b border-thermo-border bg-white">
            <div className="mx-auto flex max-w-[1540px] items-center justify-between gap-4 px-4 py-4 md:px-6 xl:px-8">
              <div className="flex items-center gap-3">
                <button className="rounded-xl border border-thermo-border p-2 md:hidden" type="button" onClick={() => setMenuOpen(true)} aria-label="Abrir navegação">
                  <Menu className="size-4 text-thermo-navy" />
                </button>
                <img src="/branding/thermo-logo-principal.png" alt="Thermo" className="h-8 w-auto md:h-9" />
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

          <main className="mx-auto max-w-[1540px] px-4 py-5 md:px-6 xl:px-8">
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
                {activeView === 'home' ? <Home className="size-4 text-thermo-navy" /> : <Boxes className="size-4 text-thermo-navy" />}
                {activeView === 'home' ? 'Página inicial' : 'Lista de produtos'}
              </span>
            </div>

            {activeView === 'home' ? (
              <HomeScreen user={user} areaId={areaId} onSelectArea={setAreaId} onOpenProducts={() => setActiveView('products')} allowedAreas={allowedAreas} />
            ) : (
              <ProductListScreen canOpenCart={canOpenCart} canOpenSeparation={canOpenSeparation} />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

export default App
