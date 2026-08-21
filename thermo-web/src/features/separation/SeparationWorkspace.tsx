import { ClipboardList, Columns3 } from 'lucide-react'
import { useState } from 'react'
import { SeparationCartScreen } from './SeparationCartScreen'
import { SeparationKanbanScreen } from './SeparationKanbanScreen'

type SeparationView = 'cart' | 'kanban'

export function SeparationWorkspace() {
  const [view, setView] = useState<SeparationView>('cart')

  return (
    <div className="min-h-dvh bg-thermo-bg p-4 sm:p-6">
      <div className="mx-auto max-w-[1440px]">
        <nav aria-label="Frentes de separação" className="mb-5 inline-flex w-full rounded-[10px] border border-thermo-border bg-white p-1 shadow-sm sm:w-auto">
          <button aria-current={view === 'cart' ? 'page' : undefined} className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition sm:flex-none ${view === 'cart' ? 'bg-thermo-navy text-white' : 'text-slate-600 hover:bg-thermo-bg hover:text-thermo-navy'}`} onClick={() => setView('cart')} type="button"><ClipboardList className="size-4" />Lista / carrinho</button>
          <button aria-current={view === 'kanban' ? 'page' : undefined} className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition sm:flex-none ${view === 'kanban' ? 'bg-thermo-navy text-white' : 'text-slate-600 hover:bg-thermo-bg hover:text-thermo-navy'}`} onClick={() => setView('kanban')} type="button"><Columns3 className="size-4" />Kanban</button>
        </nav>
        {view === 'cart' ? <SeparationCartScreen /> : <SeparationKanbanScreen />}
      </div>
    </div>
  )
}
