import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react'
import type { Severity, Verification } from '../lib/api'
import { RISK_CLS, SEVERITY, VERIFICATION } from '../lib/format'

export function Page({ title, subtitle, back, actions, children, width = 'max-w-5xl' }: {
  title: string; subtitle?: ReactNode; back?: boolean; actions?: ReactNode; children: ReactNode; width?: string
}) {
  const nav = useNavigate()
  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
        <div className={`mx-auto flex min-h-14 w-full items-center gap-2 px-4 py-2 lg:px-8 ${width}`}>
          {back && <button aria-label="Back" onClick={() => nav(-1)} className="btn-ghost -ml-2 h-9 w-9 px-0"><ArrowLeft size={20} /></button>}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">{title}</h1>
            {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto w-full px-4 py-4 pb-8 lg:px-8 lg:py-6 ${width}`}>{children}</div>
      </div>
    </div>
  )
}

export const Spinner = ({ label = 'Loading…' }: { label?: string }) => (
  <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-muted"><Loader2 className="animate-spin" size={18} />{label}</div>
)

export function Notice({ tone = 'error', children, action }: { tone?: 'error' | 'warn' | 'info'; children: ReactNode; action?: ReactNode }) {
  const cls = { error: 'border-rose-200 bg-rose-50 text-rose-900', warn: 'border-amber-200 bg-amber-50 text-amber-900', info: 'border-cyan-200 bg-accent-soft text-cyan-950' }[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm ${cls}`}>
      <AlertTriangle size={16} className="mt-0.5 shrink-0" /><div className="min-w-0 flex-1">{children}</div>{action}
    </div>
  )
}

export const Empty = ({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) => (
  <div className="flex flex-col items-center px-6 py-10 text-center">
    <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-subtle text-faint ring-1 ring-line">{icon}</div>
    <div className="text-sm font-semibold">{title}</div>
    {text && <p className="mt-1 max-w-xs text-sm text-muted">{text}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
)

export const VerificationBadge = ({ v }: { v: Verification }) => (
  <span className={`inline-flex h-6 items-center whitespace-nowrap rounded px-2 text-xs font-semibold ring-1 ring-inset ${VERIFICATION[v].cls}`}>{VERIFICATION[v].label}</span>
)

export function SeverityTag({ s, resolved }: { s: Severity; resolved?: boolean }) {
  const { label, color, level } = SEVERITY[s]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold" style={{ color: resolved ? '#15803d' : color }}>
      <span aria-hidden className="flex items-end gap-px">{[1, 2, 3, 4].map((n) => <span key={n} className="w-1 rounded-sm" style={{ height: 3 + n * 2.5, background: n <= level ? 'currentColor' : '#cbd3de' }} />)}</span>
      {resolved ? 'Resolved' : label}
    </span>
  )
}

export const RiskBadge = ({ level }: { level: string }) => (
  <span className={`inline-flex h-6 items-center whitespace-nowrap rounded px-2 text-xs font-bold tracking-wide ring-1 ring-inset ${RISK_CLS[level]}`}>{level} RISK</span>
)

export const Row = ({ k, v }: { k: ReactNode; v: ReactNode }) => (
  <div className="flex items-start justify-between gap-4 border-b border-line py-2.5 text-sm last:border-0"><span className="shrink-0 text-muted">{k}</span><span className="min-w-0 text-right font-medium break-words">{v}</span></div>
)

export const Section = ({ title, action, children, className = '' }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={`card ${className}`}>
    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4"><h2 className="text-sm font-semibold">{title}</h2>{action}</div>
    <div className="p-4">{children}</div>
  </section>
)

export function Logo({ dark }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden><rect width="26" height="26" rx="6" fill={dark ? '#0e7490' : '#0b1f3a'} />
        <path d="M13 5c-3 4.1-5.6 7.3-5.6 10a5.6 5.6 0 0 0 11.2 0c0-2.7-2.6-5.9-5.6-10z" fill="#fff" /></svg>
      <span className={`text-[17px] font-bold tracking-tight ${dark ? 'text-white' : 'text-navy'}`}>JalMarg</span>
    </span>
  )
}
