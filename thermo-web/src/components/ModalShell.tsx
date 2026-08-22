import { clsx } from 'clsx'
import { X } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

export function ModalShell({
  open,
  title,
  onClose,
  children,
  description,
  panelClassName,
  panelStyle,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  description?: string
  panelClassName?: string
  panelStyle?: CSSProperties
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" role="presentation">
      <button type="button" className="absolute inset-0 bg-slate-950/45" aria-label={`Fechar ${title} pelo fundo`} onClick={onClose} />
      <section
        className={clsx('relative z-10 flex h-full max-w-[min(96vw,42rem)] flex-col bg-white shadow-2xl', panelClassName)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={description ? `${title}-description` : undefined}
        style={panelStyle}
        data-testid="modal-panel"
      >
        <header className="flex items-start justify-between gap-3 border-b border-thermo-border px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-thermo-navy">{title}</h2>
            {description ? <p id={`${title}-description`} className="mt-1 text-sm text-slate-500">{description}</p> : null}
          </div>
          <button className="thermo-icon-button" type="button" onClick={onClose} aria-label={`Fechar ${title.toLowerCase()}`}>
            <X className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </section>
    </div>
  )
}
