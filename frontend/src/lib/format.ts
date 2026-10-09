import type { Severity, Verification } from './api'

export const SEVERITY: Record<Severity, { label: string; color: string; level: number }> = {
  ankle: { label: 'Ankle-deep', color: '#ca8a04', level: 1 }, knee: { label: 'Knee-deep', color: '#ea580c', level: 2 },
  waist: { label: 'Waist-deep', color: '#dc2626', level: 3 }, impassable: { label: 'Impassable', color: '#7f1d1d', level: 4 },
}
export const VERIFICATION: Record<Verification, { label: string; cls: string }> = {
  verified: { label: 'Verified', cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  likely: { label: 'Likely', cls: 'bg-cyan-50 text-cyan-800 ring-cyan-200' },
  needs_review: { label: 'Needs review', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  suspicious: { label: 'Suspicious', cls: 'bg-rose-50 text-rose-800 ring-rose-200' },
  rejected: { label: 'Rejected', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
}
export const PROBLEM: Record<string, string> = { waterlogging: 'Waterlogging', blocked_drain: 'Blocked drain', sewer_overflow: 'Sewer overflow' }
export const STATUS: Record<string, string> = { active: 'Active', resolved: 'Resolved', cleared: 'Reported clear', expired: 'Expired', rejected: 'Rejected' }
export const WORK: Record<string, string> = { created: 'Work order created', assigned: 'Assigned', on_the_way: 'Crew on the way', in_progress: 'Work in progress', pending_review: 'Awaiting verification', done: 'Completed' }
export const RISK_CLS: Record<string, string> = { LOW: 'text-emerald-700 bg-emerald-50 ring-emerald-200', MODERATE: 'text-amber-800 bg-amber-50 ring-amber-200',
  HIGH: 'text-orange-800 bg-orange-50 ring-orange-200', SEVERE: 'text-rose-800 bg-rose-50 ring-rose-200' }

export function ago(t?: number | null) {
  if (!t) return '—'
  const s = Math.max(0, Date.now() / 1000 - t)
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`
}
export const dist = (m?: number) => (m == null ? '' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`)
export const mins = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`)
export const hour = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true })
export const when = (t: number) => new Date(t * 1000).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
export const temp = (c?: number | null) => (c == null ? '—' : `${c.toFixed(1)}°C`)
