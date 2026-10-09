import { useEffect, useMemo, useState } from 'react'
import { Loader2, LocateFixed, MapPin, Navigation, ShieldCheck, TriangleAlert } from 'lucide-react'
import MapView from '../map/MapView'
import { Notice } from '../components/ui'
import { api } from '../lib/api'
import { dist, mins, SEVERITY } from '../lib/format'
import { useLocation } from '../lib/geo'

type Place = { name: string; address: string; lat: number; lng: number }
type Opt = { geometry: [number, number][]; duration_s: number; distance_m: number; hazards: { id: string; road_name: string | null; severity: keyof typeof SEVERITY; lat: number; lng: number; status: string }[] }
type Res = { recommended: Opt; fastest: Opt; options: Opt[]; recommended_index: number; summary: string; extra_min: number; provider: string }

export default function RoutePage() {
  const { fix, error } = useLocation()
  const [q, setQ] = useState('')
  const [places, setPlaces] = useState<Place[]>([])
  const [searching, setSearching] = useState(false)
  const [to, setTo] = useState<Place | null>(null)
  const [res, setRes] = useState<Res | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!fix || q.trim().length < 3 || q === to?.name) return setPlaces([])
    const t = setTimeout(() => {
      setSearching(true)
      api<Place[]>(`/places/search?q=${encodeURIComponent(q)}&lat=${fix.lat}&lng=${fix.lng}`).then(setPlaces).catch((e) => setErr(e.message)).finally(() => setSearching(false))
    }, 500)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = async (p: Place) => {
    setTo(p); setQ(p.name); setPlaces([]); setBusy(true); setErr(null); setRes(null)
    try { setRes(await api<Res>(`/route?origin=${fix!.lat},${fix!.lng}&destination=${p.lat},${p.lng}`)) } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  const lines = useMemo(() => res ? res.options.map((o, i) => ({ id: String(i), coords: o.geometry, kind: i === res.recommended_index ? 'recommended' as const : 'alternative' as const }))
    .sort((a) => (a.kind === 'recommended' ? 1 : -1)) : [], [res])
  const hazards = useMemo(() => [...new Map((res?.options.flatMap((o) => o.hazards) || []).map((h) => [h.id, h])).values()], [res])
  const fit = useMemo(() => (res ? res.options.flatMap((o) => o.geometry) : null), [res])
  const r = res?.recommended, safe = r && !r.hazards.length

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <div className="relative h-[42%] shrink-0 lg:order-2 lg:h-full lg:flex-1">
        <MapView center={fix || { lat: 28.6139, lng: 77.209 }} zoom={13} user={fix} dest={to} lines={lines} fit={fit} focus={fix && !res ? fix : null}
          incidents={hazards} />
      </div>
      <aside className="flex min-h-0 flex-1 flex-col border-line bg-surface lg:order-1 lg:w-[380px] lg:flex-none lg:border-r xl:w-[400px]">
        <div className="hidden h-14 shrink-0 items-center border-b border-line px-4 lg:flex"><h1 className="text-base font-semibold">Safe route</h1></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="rounded-lg border border-line">
            <div className="flex h-11 items-center gap-3 border-b border-line px-3 text-sm"><LocateFixed size={16} className="text-accent" />
              <span className={`truncate ${fix ? '' : 'text-muted'}`}>{fix ? 'Your location' : error ? 'Location unavailable' : 'Getting your location…'}</span></div>
            <div className="flex h-11 items-center gap-3 px-3"><MapPin size={16} className="text-navy" />
              <input aria-label="Destination" className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint" placeholder="Where to?" value={q} disabled={!fix}
                onChange={(e) => { setQ(e.target.value); setTo(null) }} />
              {searching && <Loader2 size={16} className="animate-spin text-muted" />}</div>
          </div>
          {error && <div className="mt-3"><Notice tone="warn">{error}</Notice></div>}
          {!!places.length && (
            <ul className="mt-2 overflow-hidden rounded-lg border border-line">
              {places.map((p) => <li key={p.lat + p.name}><button onClick={() => go(p)} className="w-full border-b border-line px-3 py-2.5 text-left last:border-0 hover:bg-subtle">
                <div className="truncate text-sm font-medium">{p.name}</div><div className="truncate text-xs text-muted">{p.address}</div></button></li>)}
            </ul>
          )}
          {err && <div className="mt-3"><Notice>{err}</Notice></div>}
          {busy && <p className="mt-4 flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" />Checking routes against active incidents…</p>}
          {r && (
            <div className="mt-4 grid gap-3">
              <div className={`rounded-lg border p-4 ${safe ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className={`flex items-center gap-2 text-sm font-semibold ${safe ? 'text-emerald-900' : 'text-amber-900'}`}>{safe ? <ShieldCheck size={17} /> : <TriangleAlert size={17} />}{safe ? 'Lower-risk route' : 'Caution'}</div>
                <p className="mt-1 text-sm">{res!.summary}</p>
                <div className="mt-3 flex items-end gap-4"><span className="text-2xl font-semibold tabular-nums">{mins(r.duration_s)}</span><span className="pb-1 text-sm text-muted">{dist(r.distance_m)}</span>
                  {res!.extra_min > 0 && <span className="pb-1 text-sm text-muted">+{res!.extra_min} min vs fastest</span>}</div>
              </div>
              {!!r.hazards.length && <div className="rounded-lg border border-line p-3 text-sm"><div className="eyebrow mb-1.5">Still on this route</div>
                {r.hazards.map((h) => <div key={h.id} className="flex justify-between py-1"><span className="truncate">{h.road_name || 'Unnamed road'}</span><span className="shrink-0 pl-2 font-medium" style={{ color: SEVERITY[h.severity].color }}>{SEVERITY[h.severity].label}</span></div>)}</div>}
              <a className="btn-navy h-11" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&origin=${fix!.lat},${fix!.lng}&destination=${to!.lat},${to!.lng}&travelmode=driving`}>
                <Navigation size={16} />Navigate</a>
              <p className="text-xs text-faint">Based on currently reported incidents ({hazards.length} on these routes). Not a guarantee of safety. Routing: {res!.provider === 'google' ? 'Google Routes' : 'OSRM / OpenStreetMap'}.</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
