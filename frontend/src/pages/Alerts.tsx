import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, MapPin, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { RiskDetail, WeatherDetail } from '../components/Context'
import { Empty, Page, Section, Spinner } from '../components/ui'
import { api, type Risk, type Weather } from '../lib/api'
import { useSession } from '../lib/auth'
import { ago } from '../lib/format'
import { currentFix, useLocation } from '../lib/geo'

type Note = { id: string; incident_id: string | null; kind: string; title: string; body: string; created_at: number; read_at: number | null }
type Sub = { id: string; name: string; lat: number; lng: number; radius_m: number }

export default function Alerts() {
  const s = useSession()
  const { fix } = useLocation()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [subs, setSubs] = useState<Sub[]>([])
  const [wx, setWx] = useState<Weather | null>(null)
  const [risk, setRisk] = useState<Risk | null>(null)
  const [name, setName] = useState('')
  const [radius, setRadius] = useState(1500)

  const load = useCallback(() => {
    if (!s) return
    api<Note[]>('/notifications').then(setNotes).catch(() => setNotes([]))
    api<Sub[]>('/subscriptions').then(setSubs).catch(() => null)
  }, [s])
  useEffect(load, [load])
  useEffect(() => {
    if (!fix || wx) return
    api<Weather>(`/weather?lat=${fix.lat}&lng=${fix.lng}`).then(setWx).catch(() => setWx({ available: false, provider: '' }))
    api<Risk>(`/risk?lat=${fix.lat}&lng=${fix.lng}`).then(setRisk).catch(() => null)
  }, [fix]) // eslint-disable-line react-hooks/exhaustive-deps

  const savePlace = async () => {
    try { const f = await currentFix(); await api('/subscriptions', { body: { name: name.trim() || 'Saved place', lat: f.lat, lng: f.lng, radius_m: radius } }); setName(''); toast.success('Place saved'); load() }
    catch (e: any) { toast.error(e.message) }
  }
  const unread = notes?.filter((n) => !n.read_at).length || 0

  return (
    <Page title="Alerts" subtitle="Weather, nearby incidents and updates on what you follow" width="max-w-6xl"
      actions={unread > 0 && <button className="btn-ghost h-9" onClick={() => api('/notifications/read-all', { body: {} }).then(load)}>Mark all read</button>}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6">
        <div className="grid min-w-0 content-start gap-4">
          <Section title="Weather where you are">{fix ? (wx ? <WeatherDetail wx={wx} /> : <Spinner />) : <p className="text-sm text-muted">Allow location access to see local weather.</p>}</Section>
          {risk && <Section title="Waterlogging risk"><RiskDetail risk={risk} /></Section>}
        </div>
        <div className="grid min-w-0 content-start gap-4">
          {!s ? <div className="card"><Empty icon={<Bell size={20} />} title="Sign in for alerts" text="Get notified about waterlogging near your saved places and work on incidents you follow." action={<Link to="/login?next=/alerts" className="btn-primary">Sign in</Link>} /></div> : <>
            <Section title={`Notifications${unread ? ` · ${unread} new` : ''}`}>
              {!notes ? <Spinner /> : !notes.length ? <Empty icon={<Bell size={20} />} title="No notifications yet" text="You’ll hear about incidents near your saved places and updates on reports you made or confirmed." /> : (
                <ul className="-my-2">{notes.map((n) => (
                  <li key={n.id} className="border-b border-line last:border-0">
                    <Link to={n.incident_id ? `/incidents/${n.incident_id}` : '#'} onClick={() => !n.read_at && api(`/notifications/${n.id}/read`, { body: {} })} className="flex gap-3 py-3">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : 'bg-accent'}`} />
                      <span className="min-w-0"><span className="block text-sm font-semibold">{n.title}</span><span className="block text-sm text-muted">{n.body}</span><span className="text-xs text-faint">{ago(n.created_at)}</span></span>
                    </Link>
                  </li>))}</ul>
              )}
            </Section>
            <Section title="Saved places">
              <ul className="grid gap-2">{subs.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2 text-sm"><MapPin size={15} className="text-muted" />
                  <span className="min-w-0 flex-1 truncate">{p.name} <span className="text-muted">· {p.radius_m >= 1000 ? `${p.radius_m / 1000} km` : `${p.radius_m} m`} radius</span></span>
                  <button aria-label={`Remove ${p.name}`} onClick={() => api(`/subscriptions/${p.id}`, { method: 'DELETE' }).then(load)} className="text-faint hover:text-danger"><Trash2 size={15} /></button></li>))}
              </ul>
              {subs.length < 5 && <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <input className="input" placeholder="Name (Home, Office…)" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
                <select aria-label="Alert radius" className="input sm:w-28" value={radius} onChange={(e) => setRadius(+e.target.value)}>{[500, 1000, 1500, 3000, 5000].map((r) => <option key={r} value={r}>{r >= 1000 ? `${r / 1000} km` : `${r} m`}</option>)}</select>
                <button onClick={savePlace} className="btn-primary"><Plus size={16} />Save here</button></div>}
              <p className="mt-2 text-xs text-faint">Saves your current GPS position. One alert per incident — never one per report.</p>
            </Section>
          </>}
        </div>
      </div>
    </Page>
  )
}
