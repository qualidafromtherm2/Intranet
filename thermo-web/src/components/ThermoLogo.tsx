export function ThermoLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 100 100" className="size-9 shrink-0" fill="none" aria-hidden="true">
        <path d="M22,58 A30,30 0 1 1 66,26" stroke="#E31837" strokeWidth="11" strokeLinecap="round" />
        <path d="M50,17 L70,20 L60,37 Z" fill="#E31837" />
        <path d="M78,42 A30,30 0 1 1 34,74" stroke="#FFFFFF" strokeWidth="11" strokeLinecap="round" />
        <path d="M50,83 L30,80 L40,63 Z" fill="#FFFFFF" />
      </svg>
      {!compact && (
        <div className="leading-none">
          <div className="text-base font-extrabold tracking-tight text-white">Thermo</div>
          <div className="mt-1 text-[0.55rem] font-semibold tracking-[0.28em] text-slate-400">SISTEMA DE GESTAO</div>
        </div>
      )}
    </div>
  )
}
