import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Shield } from 'lucide-react'
import { toast } from 'sonner'
import { SignalList } from './Report'
import StaffManager from '../components/StaffManager'
import { Empty, Page, SeverityTag, Spinner, VerificationBadge } from '../components/ui'
import { api, fileUrl, type Severity, type Signal, type Verification } from '../lib/api'
import { can, useSession, type Role } from '../lib/auth'
import { ago, VERIFICATION, when } from '../lib/format'

type Rep = { id: string; incident_id: string; road_name: string | null; address: string | null; severity: Severity; verification: Verification; gps_accuracy: number
  captured_at: number; server_received_at: number; match_decision: string; note: string; reporter: string; signals: Signal[]; evidence: { image_url: string; original_url: string; original_hash: string } | null }
type User = { id: string; email: string | null; email_verified: number; phone: string | null; name: string | null; address: string | null; role: Role; status: string; created_at: number; last_seen: number; reports: number; flagged: number }
type Audit = { id: string; action: string; target: string; detail: string; created_at: number; phone: string }
const TABS = ['reports', 'staff', 'citizens', 'audit'] as const

export default function Admin() {
  const s = useSession()
  const [tab, setTab] = useState<(typeof TABS)[number]>('reports')
  const [filter, setFilter] = useState('needs_review')
  const [reps, setReps] = useState<Rep[] | null>(null)
  const [users, setUsers] = useState<User[] | null>(null)
  const [audit, setAudit] = useState<Audit[] | null>(null)
  const load = useCallback(() => {
    const go = { reports: () => api<Rep[]>(`/admin/reports${filter ? `?verification=${filter}` : ''}`).then(setReps), citizens: () => api<User[]>('/admin/users').then(setUsers), staff: async () => undefined, audit: () => api<Audit[]>('/admin/audit').then(setAudit) }[tab]
    go().catch((e) => toast.error(e.message))
  }, [tab, filter])
  useEffect(() => { if (can(s, 'admin')) load() }, [s, load])
  const act = (f: Promise<unknown>, ok: string) => f.then(() => { toast.success(ok); load() }).catch((e) => toast.error(e.message))

  if (!can(s, 'admin')) return <Page title="Admin"><div className="card"><Empty icon={<Shield size={20} />} title="Admins only" action={<Link to="/login?next=/admin" className="btn-primary">Sign in</Link>} /></div></Page>
  return (
    <Page title="Admin" width="max-w-7xl" actions={
      <div className="flex overflow-x-auto rounded-md border border-line-strong p-0.5 [scrollbar-width:none]">{TABS.map((t) => <button key={t} onClick={() => setTab(t)} className={`h-8 rounded px-3 text-xs font-semibold capitalize ${tab === t ? 'bg-navy text-white' : 'text-muted'}`}>{t}</button>)}</div>}>
      {tab === 'reports' && <>
        <div className="mb-4 flex gap-2 overflow-x-auto [scrollbar-width:none]">
          {['needs_review', 'suspicious', 'likely', 'verified', 'rejected', ''].map((v) => <button key={v} onClick={() => setFilter(v)} className={`chip ${filter === v ? 'chip-on' : ''}`}>{v ? VERIFICATION[v as Verification].label : 'All'}</button>)}
        </div>
        {!reps ? <Spinner /> : !reps.length ? <div className="card"><Empty icon={<Shield size={20} />} title="Nothing to review" /></div> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{reps.map((r) => (
            <article key={r.id} className="card flex min-w-0 flex-col overflow-hidden">
              {r.evidence && <img src={fileUrl(r.evidence.image_url)} alt="" className="aspect-[4/3] w-full bg-black object-contain" />}
              <div className="grid flex-1 content-start gap-3 p-4">
                <div className="flex items-start justify-between gap-2"><Link to={`/incidents/${r.incident_id}`} className="min-w-0 truncate font-semibold hover:underline">{r.road_name || 'Road not matched'}</Link><VerificationBadge v={r.verification} /></div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted"><SeverityTag s={r.severity} /><span>{r.reporter}</span><span>{when(r.captured_at)}</span><span>{r.match_decision.replace(/_/g, ' ').toLowerCase()}</span></div>
                <SignalList signals={r.signals} />
                {r.evidence && <a href={fileUrl(r.evidence.original_url)} target="_blank" rel="noreferrer" className="truncate text-xs text-accent underline">Original image · sha256 {r.evidence.original_hash.slice(0, 12)}…</a>}
                <div className="mt-auto grid grid-cols-3 gap-2 pt-1">
                  {(['verified', 'suspicious', 'rejected'] as const).map((v) => <button key={v} onClick={() => act(api(`/admin/reports/${r.id}/verification`, { body: { state: v } }), 'Updated')}
                    className={v === 'verified' ? 'btn-primary h-9 px-2 text-xs' : 'btn-outline h-9 px-2 text-xs'}>{VERIFICATION[v].label}</button>)}
                </div>
              </div>
            </article>))}</div>
        )}
      </>}
      {tab === 'staff' && <StaffManager />}
      {tab === 'citizens' && (!users ? <Spinner /> : !users.length ? <div className="card"><Empty icon={<Shield size={20} />} title="No citizens have signed in yet" /></div> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-subtle text-left text-xs text-muted"><tr>{['Citizen', 'Type', 'Reports', 'Flagged', 'Last seen', 'Status'].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="max-w-[240px] px-4 py-2.5"><div className="truncate font-medium">{u.name || u.email}{!u.email_verified && <span className="ml-2 text-[11px] font-normal text-amber-700">unverified</span>}</div>
                  <div className="truncate text-xs text-muted" title={u.address || ''}>{u.name ? u.email : ''}{u.address ? `${u.name ? ' · ' : ''}${u.address}` : ''}</div></td>
                <td className="px-4 py-2.5"><select aria-label="Type" className="input h-9 w-32" value={u.role} onChange={(e) => act(api(`/admin/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } }), 'Updated')}>
                  <option value="citizen">Citizen</option><option value="commuter">Commuter</option></select></td>
                <td className="px-4 py-2.5 tabular-nums">{u.reports}</td><td className="px-4 py-2.5 tabular-nums">{u.flagged}</td><td className="px-4 py-2.5 text-muted">{ago(u.last_seen)}</td>
                <td className="px-4 py-2.5"><select aria-label="Status" className="input h-9 w-28" value={u.status}
                  onChange={(e) => act(api(`/admin/users/${u.id}`, { method: 'PATCH', body: { status: e.target.value } }), 'Status updated')}>
                  <option value="active">Active</option><option value="blocked">Blocked</option></select></td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}
      {tab === 'audit' && (!audit ? <Spinner /> : !audit.length ? <div className="card"><Empty icon={<Shield size={20} />} title="No staff actions yet" /></div> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-subtle text-left text-xs text-muted"><tr>{['When', 'Who', 'Action', 'Target', 'Detail'].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{audit.map((a) => <tr key={a.id} className="border-t border-line"><td className="whitespace-nowrap px-4 py-2.5 text-muted">{when(a.created_at)}</td><td className="px-4 py-2.5">{a.phone}</td>
              <td className="px-4 py-2.5 font-medium">{a.action}</td><td className="px-4 py-2.5 font-mono text-xs">{a.target}</td><td className="max-w-xs truncate px-4 py-2.5 text-muted">{a.detail}</td></tr>)}</tbody>
          </table>
        </div>
      ))}
    </Page>
  )
}

