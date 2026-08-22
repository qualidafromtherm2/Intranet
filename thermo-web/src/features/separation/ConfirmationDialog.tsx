import { AlertTriangle, X } from 'lucide-react'

interface ConfirmationDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4" role="presentation">
      <section
        aria-describedby="separation-confirm-description"
        aria-labelledby="separation-confirm-title"
        aria-modal="true"
        className="w-full max-w-md overflow-hidden rounded-[14px] border border-thermo-border bg-white shadow-2xl"
        role="alertdialog"
      >
        <header className="flex items-center gap-3 bg-thermo-navy px-4 py-3 text-white">
          <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
          <h2 className="flex-1 text-sm font-semibold" id="separation-confirm-title">{title}</h2>
          <button
            aria-label="Fechar confirmação"
            className="inline-flex size-11 items-center justify-center rounded-md text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/70"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>
        <p className="px-5 py-5 text-sm leading-6 text-slate-600" id="separation-confirm-description">{description}</p>
        <footer className="flex justify-end gap-2 border-t border-thermo-border bg-thermo-bg px-4 py-3">
          <button className="thermo-button thermo-button-secondary" disabled={busy} onClick={onCancel} type="button">Cancelar</button>
          <button
            autoFocus
            className={danger ? 'thermo-button border-thermo-red bg-thermo-red text-white hover:bg-red-700' : 'thermo-button thermo-button-primary'}
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? 'Processando…' : confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  )
}
