import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ClipboardList, ShieldAlert } from 'lucide-react'
import MapView from '../map/MapView'
import { Empty, Notice, Page, Section, SeverityTag, Spinner, VerificationBadge } from '../components/ui'
import { WorkOrderModal } from './Incident'
import { toast } from 'sonner'
import { api, fileUrl, type Incident } from '../lib/api'
import { can, useSession } from '../lib/auth'
import { ago, WORK } from '../lib/format'

type Item = Incident & { priority: 'P1' | 'P2' | 'P3'; priority_score: number; age_s: number }
type Dash = { queue: Record<'new' | 'verified' | 'high' | 'unassigned' | 'aging', Item[]>; incidents: Item[]
  counts: { active: number; p1: number; open_work: number; resolved_30d: number; to_verify: number; open_issues: number }; analytics: { daily_incidents: { day: string; n: number }[]; avg_response_min: number | null } }
type Issue = { id: string; work_order_id: string; incident_id: string; text: string; status: string; note: string | null; created_at: number; road_name: string | null
  author: string; worker: { name: string; employee_id: string } | null; evidence: { image_url: string; captured_at: number } | null }
type Hot = { road_segment_id: string; road_name: string | null; locality: string | null; incidents: number; avg_duration_s: number | null; last_observed_at: number; active: number }
const TABS = [['all', 'All active'], ['new', 'New'], ['verified', 'Verified'], ['high', 'High severity'], ['unassigned', 'Unassigned'], ['aging', 'Aging 3 h+']] as const
const PRIO = { P1: 'bg-rose-600 text-white', P2: 'bg-amber-500 text-white', P3: 'bg-slate-200 text-slate-700' }
export const Prio = ({ p }: { p: keyof typeof PRIO }) => <span className={`inline-grid h-6 w-8 place-items-center rounded text-xs font-bold ${PRIO[p]}`}>{p}</span>

export default function Ward() {
  const s = useSession(), nav = useNavigate()
  const [d, setD] = useState<Dash | null>(null)
  const [hot, setHot] = useState<Hot[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('all')
  const [wo, setWo] = useState<string | null>(null)
  const load = useCallback(() => {
    api<Dash>('/ward/dashboard').then(setD).catch((e) => setErr(e.message))
    api<Hot[]>('/hotspots').then(setHot).catch(() => null)
    api<Issue[]>('/ward/issues').then(setIssues).catch(() => null)
  }, [])
  useEffect(() => { if (can(s, 'ward_officer')) { load(); const t = setInterval(load, 60000); return () => clearInterval(t) } }, [s, load])
  const handleIssue = (id: string, action: 'reopen' | 'close') => {
    const note = prompt(action === 'reopen' ? 'Message to the citizen (optional)' : 'Why is it being closed?') ?? ''
    api(`/ward/issues/${id}`, { body: { action, note } }).then(() => { toast.success(action === 'reopen' ? 'Incident reopened' : 'Issue closed'); load() }).catch((e) => toast.error(e.message))
  }
  const rows = d ? (tab === 'all' ? d.incidents : d.queue[tab]) : []
  const markers = useMemo(() => (d?.incidents || []).map((i) => ({ id: i.id, lat: i.lat, lng: i.lng, severity: i.severity, status: i.status })), [d])
  const fit = useMemo(() => (markers.length > 1 ? markers.map((m) => [m.lng, m.lat] as [number, number]) : null), [markers])

  if (!can(s, 'ward_officer')) return <Page title="Ward dashboard"><div className="card"><Empty icon={<ShieldAlert size={20} />} title="Ward officers only" text="Sign in with a ward officer account." action={<Link to="/login?next=/ward" className="btn-primary">Sign in</Link>} /></div></Page>
  const maxDay = Math.max(1, ...(d?.analytics.daily_incidents.map((x) => x.n) || [1]))

  return (
    <Page title="Ward dashboard" subtitle="Real reports only · priority by severity, people affected, duration, risk and critical places" width="max-w-7xl">
      {err && <Notice>{err}</Notice>}
      {!d ? <Spinner /> : (
        <div className="grid gap-4 lg:gap-6">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
            {([['Active incidents', d.counts.active], ['Priority P1', d.counts.p1], ['Open work orders', d.counts.open_work], ['To verify', d.counts.to_verify, '/work'],
              ['Citizen issues', d.counts.open_issues, '#issues'], ['Resolved (30 days)', d.counts.resolved_30d],
              ['Avg response', d.analytics.avg_response_min == null ? 'No data yet' : `${d.analytics.avg_response_min} min`]] as [string, number | string, string?][]).map(([k, v, to]) => {
              const body = <><dt className="text-xs leading-tight text-muted">{k}</dt><dd className={`mt-1 truncate text-xl font-semibold tabular-nums ${to && v ? 'text-accent' : ''}`}>{v}</dd></>
              return to ? <a key={k} href={to} onClick={(e) => { if (to.startsWith('/')) { e.preventDefault(); nav(to) } }} className="card min-w-0 p-3.5 hover:bg-subtle">{body}</a> : <div key={k} className="card min-w-0 p-3.5">{body}</div>
            })}
          </dl>
          <div className="grid gap-4 lg:gap-6">
            <section className="card min-w-0 overflow-hidden">
              <div className="flex gap-2 overflow-x-auto border-b border-line p-3 [scrollbar-width:none]">
                {TABS.map(([v, l]) => <button key={v} onClick={() => setTab(v)} className={`chip ${tab === v ? 'chip-on' : ''}`}>{l}{d && v !== 'all' ? ` · ${d.queue[v].length}` : ''}</button>)}
              </div>
              {!rows.length ? <Empty icon={<ClipboardList size={20} />} title="Queue is clear" text="Incidents appear here as citizens report them." /> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-subtle text-left text-xs text-muted"><tr>{['', 'Road', 'Depth', 'Status', 'People', 'Age', 'Work', ''].map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                    <tbody>{rows.map((i) => (
                      <tr key={i.id} onClick={() => nav(`/incidents/${i.id}`)} className="cursor-pointer border-t border-line hover:bg-subtle">
                        <td className="px-3 py-2.5"><Prio p={i.priority} /></td>
                        <td className="max-w-[220px] px-3 py-2.5"><div className="truncate font-medium">{i.road_name || 'Unnamed road'}</div><div className="truncate text-xs text-muted">{i.locality || '—'}</div></td>
                        <td className="px-3 py-2.5"><SeverityTag s={i.severity} /></td>
                        <td className="px-3 py-2.5"><VerificationBadge v={i.verification} /></td>
                        <td className="px-3 py-2.5 tabular-nums">{i.confirmation_count + 1}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted">{ago(i.created_at)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">{i.work_status ? WORK[i.work_status] : <span className="text-muted">None</span>}</td>
                        <td className="px-3 py-2.5 text-right">{(!i.work_status || i.work_status === 'done') && <button onClick={(e) => { e.stopPropagation(); setWo(i.id) }} className="btn-outline h-8 px-3 text-xs">Create work</button>}</td>
                      </tr>))}</tbody>
                  </table>
                </div>
              )}
            </section>
            <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3 lg:gap-6">
              <div className="relative h-72 overflow-hidden rounded-lg border border-line md:col-span-2 xl:col-span-1 xl:h-auto xl:min-h-72"><MapView center={markers[0] || { lat: 28.6139, lng: 77.209 }} zoom={12} incidents={markers} fit={fit}
                onSelect={(id) => nav(`/incidents/${id}`)} /></div>
              <Section title="Incidents per day (14 days)">
                {d.analytics.daily_incidents.length < 2 ? <p className="text-sm text-muted">Not enough data yet.</p> : (
                  <div className="flex h-28 items-end gap-1" role="img" aria-label="Incidents per day">
                    {d.analytics.daily_incidents.map((x) => <div key={x.day} title={`${x.day}: ${x.n}`} className="flex-1 rounded-t-[3px] bg-navy/80 hover:bg-navy" style={{ height: `${(x.n / maxDay) * 100}%` }} />)}
                  </div>
                )}
              </Section>
              <Section title="Recurring hotspots (30 days)">
                {!hot.length ? <p className="text-sm text-muted">Hotspots appear once a road segment has 3 or more incidents.</p> : hot.map((h) => (
                  <div key={h.road_segment_id} className="border-b border-line py-2.5 text-sm last:border-0">
                    <div className="flex justify-between gap-2"><b className="truncate font-semibold">{h.road_name || 'Unnamed road'}</b><span className="shrink-0 text-muted">{h.incidents} incidents</span></div>
                    <div className="text-xs text-muted">{h.avg_duration_s ? `Avg duration ${Math.round(h.avg_duration_s / 60)} min · ` : ''}Last observed {ago(h.last_observed_at)}{h.active ? ` · ${h.active} active` : ''}</div>
                  </div>))}
              </Section>
            </div>
          </div>
        </div>
      )}
      {d && <section id="issues" className="mt-6"><Section title={`Citizen issues · ${issues.filter((i) => i.status === 'open').length} open`}>
        {!issues.length ? <p className="text-sm text-muted">Citizens can raise an issue with a photo if completed work wasn’t done properly.</p> : (
          <div className="grid gap-3 md:grid-cols-2">{issues.map((i) => (
            <div key={i.id} className={`flex gap-3 rounded-md border border-line p-3 ${i.status === 'open' ? '' : 'opacity-60'}`}>
              {i.evidence && <a href={fileUrl(i.evidence.image_url)} target="_blank" rel="noreferrer" className="shrink-0"><img src={fileUrl(i.evidence.image_url)} alt="Issue photo" className="h-24 w-28 rounded object-cover" /></a>}
              <div className="grid min-w-0 flex-1 content-start gap-1 text-sm">
                <Link to={`/incidents/${i.incident_id}`} className="truncate font-semibold hover:underline">{i.road_name || 'Unnamed road'}</Link>
                <p className="break-words">{i.text}</p>
                <p className="text-xs text-muted">{i.author} · {ago(i.created_at)}{i.worker ? ` · work by ${i.worker.name}` : ''}</p>
                {i.status === 'open' ? <div className="mt-1 flex flex-wrap gap-2">
                  <button onClick={() => handleIssue(i.id, 'reopen')} className="btn-navy h-8 px-3 text-xs">Reopen incident</button>
                  <button onClick={() => handleIssue(i.id, 'close')} className="btn-outline h-8 px-3 text-xs">Close issue</button></div>
                  : <p className="text-xs text-muted">Closed{i.note ? ` — ${i.note}` : ''}</p>}
              </div>
            </div>))}</div>
        )}
      </Section></section>}
      {wo && <WorkOrderModal open incidentId={wo} onClose={() => setWo(null)} onDone={load} />}
    </Page>
  )
}
