import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, Crosshair, MapPin, MapPinOff, Waves } from 'lucide-react'
import MapView from '../map/MapView'
import { Empty, Notice } from '../components/ui'
import { IncidentRow, IncidentSummary, WeatherStrip } from '../components/Context'
import { api, type Incident, type Risk, type Weather } from '../lib/api'
import { distance, useLocation, type Fix } from '../lib/geo'
import { canReport, useSession } from '../lib/auth'

const FILTERS = [['all', 'All'], ['verified', 'Verified'], ['severe', 'Waist-deep+'], ['resolved', 'Resolved']] as const
type F = (typeof FILTERS)[number][0]
const DEFAULT = { lat: 28.6139, lng: 77.209 }

export default function MapPage() {
  const session = useSession()
  const { fix, error } = useLocation()
  const [anchor, setAnchor] = useState<Fix | null>(null)
  const [items, setItems] = useState<Incident[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [wx, setWx] = useState<Weather | null>(null)
  const [risk, setRisk] = useState<Risk | null>(null)
  const [filter, setFilter] = useState<F>('all')
  const [sel, setSel] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ lat: number; lng: number } | null>(null)
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<string | null>(null)

  useEffect(() => { if (fix && (!anchor || distance(anchor, fix) > 1000)) { setAnchor(fix); setFocus(fix) } }, [fix]) // eslint-disable-line react-hooks/exhaustive-deps
  const at = anchor || (error ? DEFAULT : null)

  useEffect(() => {
    if (!at) return
    const load = () => api<Incident[]>(`/incidents/nearby?lat=${at.lat}&lng=${at.lng}&radius=10000`).then((x) => { setItems(x); setFailed(false) }).catch(() => setFailed(true))
    load()
    api<Weather>(`/weather?lat=${at.lat}&lng=${at.lng}`).then(setWx).catch(() => null)
    api<Risk>(`/risk?lat=${at.lat}&lng=${at.lng}`).then(setRisk).catch(() => null)
    if (anchor) api<{ address: string }>(`/places/reverse?lat=${at.lat}&lng=${at.lng}`).then((r) => setPlace(r.address)).catch(() => setPlace(null))
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [at?.lat, at?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (items || []).filter((i) => filter === 'all' ? true : filter === 'verified' ? i.verification === 'verified'
    : filter === 'severe' ? ['waist', 'impassable'].includes(i.severity) && i.status === 'active' : i.status !== 'active'), [items, filter])
  const markers = useMemo(() => shown.map((i) => ({ id: i.id, lat: i.lat, lng: i.lng, severity: i.severity, status: i.status })), [shown])
  const selected = shown.find((i) => i.id === sel) || null
  const active = (items || []).filter((i) => i.status === 'active').length
  const pick = (id: string) => { const i = shown.find((x) => x.id === id); if (i) { setSel(id); setFocus({ lat: i.lat, lng: i.lng }); setOpen(false) } }

  const list = (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {failed && <div className="p-4"><Notice>Couldn’t load incidents. Check your connection.</Notice></div>}
      {!at && !failed && <p className="p-4 text-sm text-muted">Finding your location…</p>}
      {items && !shown.length && <Empty icon={<Waves size={20} />} title={filter === 'all' ? 'No active waterlogging nearby' : 'Nothing matches this filter'}
        text={filter === 'all' && canReport(session) ? 'If a road near you is flooded, report it with a live photo.' : undefined} action={filter === 'all' && canReport(session) && <Link to="/report" className="btn-danger">Report waterlogging</Link>} />}
      {shown.map((i) => <IncidentRow key={i.id} i={i} active={i.id === sel} onClick={() => pick(i.id)} />)}
    </div>
  )
  const filters = (
    <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
      {FILTERS.map(([v, l]) => <button key={v} onClick={() => setFilter(v)} className={`chip ${filter === v ? 'chip-on' : ''}`}>{l}</button>)}
    </div>
  )

  return (
    <div className="flex h-full">
      <aside className="hidden w-[360px] shrink-0 flex-col border-r border-line bg-surface lg:flex xl:w-[400px]">
        <div className="grid gap-3 border-b border-line p-4">
          <div className="flex items-baseline justify-between gap-2"><h1 className="text-base font-semibold">Waterlogging near you</h1><span className="text-xs text-muted">{items ? `${active} active` : ''}</span></div>
          {place && <p className="-mt-1.5 flex items-start gap-1.5 text-xs text-muted"><MapPin size={13} className="mt-px shrink-0" /><span className="line-clamp-2">{place}</span></p>}
          <WeatherStrip wx={wx} risk={risk} />
          {filters}
        </div>
        {selected ? <div className="border-b border-line bg-subtle p-4"><IncidentSummary i={selected} onClose={() => setSel(null)} /></div> : null}
        {list}
      </aside>

      <div className="relative min-w-0 flex-1">
        <MapView center={at || DEFAULT} zoom={13} incidents={markers} selected={sel} onSelect={pick} user={fix} focus={focus}
          padding={{ top: 60, right: 40, bottom: 200, left: 40 }} />
        {error && <div className="absolute inset-x-3 top-3 z-10 lg:left-auto lg:w-96"><Notice tone="warn"><span className="flex items-center gap-1.5"><MapPinOff size={14} />{error}</span></Notice></div>}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 grid gap-2 p-3 pt-[max(.75rem,env(safe-area-inset-top))] lg:hidden">
          {!error && <div className="pointer-events-auto card grid gap-1 px-3 py-2 shadow-sm">
            {place && <p className="flex items-center gap-1.5 text-xs text-muted"><MapPin size={12} className="shrink-0" /><span className="truncate">{place}</span></p>}
            <WeatherStrip wx={wx} risk={risk} />{!wx && <span className="text-sm text-muted">Loading conditions…</span>}</div>}
          <div className="pointer-events-auto">{filters}</div>
        </div>
        {fix && <button aria-label="Center on my location" onClick={() => setFocus({ ...fix })} className="btn-outline absolute right-3 z-10 h-10 w-10 px-0 shadow-sm max-lg:bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-6 lg:right-14"><Crosshair size={18} /></button>}

        <div className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-xl border-t border-line bg-surface shadow-[0_-4px_20px_rgba(11,31,58,.12)] lg:hidden ${open ? 'h-[62%]' : ''}`}>
          {selected && !open ? <div className="p-4"><IncidentSummary i={selected} onClose={() => setSel(null)} /></div> : (
            <>
              <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex h-16 shrink-0 items-center gap-3 px-4 text-left">
                <span className={`grid h-9 w-9 place-items-center rounded-md ${active ? 'bg-rose-50 text-danger' : 'bg-subtle text-muted'}`}><Waves size={18} /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{items ? `${active} active incident${active === 1 ? '' : 's'} nearby` : 'Loading incidents…'}</span>
                  <span className="block truncate text-xs text-muted">{open ? 'Tap to collapse' : 'Tap to see the list'}</span></span>
                {open ? <ChevronDown size={18} className="text-muted" /> : <ChevronUp size={18} className="text-muted" />}
              </button>
              {open && <div className="flex min-h-0 flex-1 flex-col border-t border-line">{list}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
