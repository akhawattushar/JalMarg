import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera as CamIcon, CheckCircle2, HardHat, Loader2, MapPin, RotateCcw, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import Camera from '../components/Camera'
import { Modal } from '../components/Sheet'
import { Empty, Notice, Page, Row, SeverityTag, Spinner } from '../components/ui'
import { Prio } from './Ward'
import { api, fileUrl, upload, type Severity } from '../lib/api'
import { can, useSession } from '../lib/auth'
import { ago, dist, when, WORK } from '../lib/format'
import { useLocation, type Fix } from '../lib/geo'

type WO = { id: string; incident_id: string; status: string; priority: 'P1' | 'P2' | 'P3'; note: string; created_at: number; updated_at: number; completed_at: number | null
  completion_note: string | null; review_note: string | null; assignee: { name: string; employee_id: string } | null; completion_distance_m: number | null
  completion_evidence: { image_url: string; original_url: string; captured_at: number; gps_accuracy: number } | null
  incident: { road_name: string | null; locality: string | null; lat: number; lng: number; severity: Severity; status: string } }
const NEXT: Record<string, [string, string]> = { assigned: ['on_the_way', 'I’m on the way'], on_the_way: ['in_progress', 'Start work'] }
const TABS = [['verify', 'To verify'], ['open', 'In progress'], ['done', 'Completed']] as const

function WorkCard({ w, children }: { w: WO; children?: React.ReactNode }) {
  return (
    <div className="card grid gap-3 p-4">
      <div className="flex items-start gap-3"><Prio p={w.priority} />
        <Link to={`/incidents/${w.incident_id}`} className="min-w-0 flex-1"><div className="truncate font-semibold">{w.incident.road_name || 'Unnamed road'}</div>
          <div className="text-xs text-muted">{w.id} · {WORK[w.status]} · {ago(w.updated_at)}{w.assignee ? ` · ${w.assignee.name}` : ''}</div></Link>
        <SeverityTag s={w.incident.severity} /></div>
      {w.note && <p className="rounded-md bg-subtle px-3 py-2 text-sm">{w.note}</p>}
      {w.review_note && w.status === 'in_progress' && <Notice tone="warn">Sent back by officer: {w.review_note}</Notice>}
      {children}
    </div>
  )
}

export default function Work() {
  const s = useSession()
  const isWorker = s?.user.role === 'worker'
  const [list, setList] = useState<WO[] | null>(null)
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('verify')
  const [finishing, setFinishing] = useState<WO | null>(null)
  const [shot, setShot] = useState<{ blob: Blob; fix: Fix; at: number } | null>(null)
  const [camera, setCamera] = useState(false)
  const [note, setNote] = useState('')
  const [reviewing, setReviewing] = useState<WO | null>(null)
  const [busy, setBusy] = useState(false)
  const geo = useLocation(camera)
  const preview = useMemo(() => (shot ? URL.createObjectURL(shot.blob) : ''), [shot])
  const load = useCallback(() => { api<WO[]>('/work-orders').then(setList).catch((e) => toast.error(e.message)) }, [])
  useEffect(() => { if (can(s, 'worker')) load() }, [s, load])

  if (!can(s, 'worker')) return <Page title="Work orders"><div className="card"><Empty icon={<HardHat size={20} />} title="Municipal staff only" action={<Link to="/login?next=/work" className="btn-primary">Sign in</Link>} /></div></Page>
  if (camera) return <div className="fixed inset-0 z-50"><Camera fix={geo.fix} geoError={geo.error} maxAccuracy={50} title="Completion photo — show the cleared site"
    onClose={() => setCamera(false)} onShot={(blob, fix, at) => { setShot({ blob, fix, at }); setCamera(false) }} /></div>

  const run = async (f: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await f(); toast.success(ok); load(); return true } catch (e: any) { toast.error(e.message); return false } finally { setBusy(false) }
  }
  const startFinish = (w: WO) => { setFinishing(w); setShot(null); setNote(''); setCamera(true) }
  const submitDone = () => run(async () => {
    const f = new FormData()
    Object.entries({ lat: shot!.fix.lat, lng: shot!.fix.lng, accuracy: shot!.fix.accuracy, captured_at: shot!.at, note }).forEach(([k, v]) => f.append(k, String(v)))
    f.append('photo', shot!.blob, 'completion.jpg')
    await upload(`/work-orders/${finishing!.id}/complete`, f)
  }, 'Sent to the ward officer for verification').then((ok) => ok && setFinishing(null))
  const review = (approve: boolean) => run(() => api(`/work-orders/${reviewing!.id}/review`, { body: { approve, note } }),
    approve ? 'Approved — citizens notified' : 'Sent back to the worker').then((ok) => ok && setReviewing(null))

  const rows = (list || []).filter((w) => isWorker ? true : tab === 'verify' ? w.status === 'pending_review' : tab === 'done' ? w.status === 'done' : !['pending_review', 'done'].includes(w.status))
  const open = rows.filter((w) => w.status !== 'done'), closed = rows.filter((w) => w.status === 'done')

  return (
    <Page title="Work orders" subtitle={isWorker ? 'Jobs assigned to you' : 'Verify completed work and track progress'} width="max-w-3xl">
      {!isWorker && list && <div className="mb-4 flex gap-2 overflow-x-auto [scrollbar-width:none]">
        {TABS.map(([v, l]) => <button key={v} onClick={() => setTab(v)} className={`chip ${tab === v ? 'chip-on' : ''}`}>{l} · {(list || []).filter((w) => v === 'verify' ? w.status === 'pending_review' : v === 'done' ? w.status === 'done' : !['pending_review', 'done'].includes(w.status)).length}</button>)}
      </div>}
      {!list ? <Spinner /> : !rows.length ? <div className="card"><Empty icon={<HardHat size={20} />} title={isWorker ? 'No work orders' : tab === 'verify' ? 'Nothing to verify' : 'No work orders here'}
        text={isWorker ? 'New assignments appear here.' : undefined} /></div> : (
        <div className="grid gap-3">
          {open.map((w) => (
            <WorkCard key={w.id} w={w}>
              {isWorker ? (
                <div className="grid grid-cols-2 gap-2">
                  <a className="btn-outline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${w.incident.lat},${w.incident.lng}`}><MapPin size={16} />Directions</a>
                  {NEXT[w.status] ? <button disabled={busy} onClick={() => run(() => api(`/work-orders/${w.id}`, { method: 'PATCH', body: { status: NEXT[w.status][0] } }), 'Status updated')} className="btn-navy">{NEXT[w.status][1]}</button>
                    : w.status === 'in_progress' ? <button disabled={busy} onClick={() => startFinish(w)} className="btn-primary"><CamIcon size={16} />Mark done</button>
                      : <span className="grid place-items-center rounded-md bg-amber-50 px-2 text-center text-xs font-semibold text-amber-900 ring-1 ring-amber-200">Awaiting officer verification</span>}
                </div>
              ) : w.status === 'pending_review' ? <button onClick={() => { setReviewing(w); setNote('') }} className="btn-navy">Review completion</button>
                : <p className="text-xs text-muted">{w.assignee ? `Progress is updated by ${w.assignee.name}.` : 'Not assigned yet — assign a worker from the incident page.'}</p>}
            </WorkCard>
          ))}
          {!!closed.length && isWorker && <h2 className="eyebrow mt-3">Completed</h2>}
          {closed.map((w) => <Link key={w.id} to={`/incidents/${w.incident_id}`} className="card flex items-center justify-between gap-3 p-3 text-sm">
            <span className="truncate">{w.incident.road_name || 'Unnamed road'}{w.assignee && !isWorker ? ` · ${w.assignee.name}` : ''}</span><span className="shrink-0 text-muted">Verified {ago(w.completed_at)}</span></Link>)}
        </div>
      )}

      <Modal open={!!finishing && !camera} onClose={() => setFinishing(null)} title="Mark work done">
        <div className="grid gap-3">
          {shot ? <img src={preview} alt="Completion photo" className="max-h-64 w-full rounded-md border border-line bg-black object-contain" />
            : <Notice tone="warn">A live completion photo is required.</Notice>}
          {shot && <p className="text-xs text-muted">Location ±{shot.fix.accuracy} m · {new Date(shot.at).toLocaleTimeString('en-IN')} · stamped on the photo</p>}
          <button onClick={() => setCamera(true)} className="btn-outline"><RotateCcw size={16} />{shot ? 'Retake photo' : 'Take photo'}</button>
          <label className="grid gap-1.5 text-sm font-medium">What was done?<textarea className="input h-20 py-2 font-normal" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Drain desilted, water cleared" /></label>
          <button disabled={busy || !shot} onClick={submitDone} className="btn-primary">{busy && <Loader2 size={16} className="animate-spin" />}Submit for verification</button>
          <p className="text-xs text-muted">The ward officer checks the photo before citizens are told the work is complete.</p>
        </div>
      </Modal>

      <Modal open={!!reviewing} onClose={() => setReviewing(null)} title="Verify completed work">
        {reviewing && <div className="grid gap-3">
          {reviewing.completion_evidence && <img src={fileUrl(reviewing.completion_evidence.image_url)} alt="Completion photo" className="max-h-72 w-full rounded-md border border-line bg-black object-contain" />}
          <div className="rounded-md border border-line px-3">
            <Row k="Road" v={reviewing.incident.road_name || 'Unnamed road'} />
            <Row k="Worker" v={reviewing.assignee ? `${reviewing.assignee.name} · ${reviewing.assignee.employee_id}` : '—'} />
            {reviewing.completion_evidence && <Row k="Photo taken" v={`${when(reviewing.completion_evidence.captured_at)} · ±${Math.round(reviewing.completion_evidence.gps_accuracy)} m`} />}
            <Row k="Distance from site" v={reviewing.completion_distance_m == null ? '—' : <span className={reviewing.completion_distance_m > 300 ? 'text-danger' : ''}>{dist(reviewing.completion_distance_m)}</span>} />
            {reviewing.completion_note && <Row k="Worker note" v={reviewing.completion_note} />}
          </div>
          {reviewing.completion_distance_m != null && reviewing.completion_distance_m > 300 && <Notice tone="warn">The photo was taken more than 300 m from the incident.</Notice>}
          <label className="grid gap-1.5 text-sm font-medium">Note to worker <span className="sr-only">required to send back</span>
            <input className="input font-normal" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Required if sending back" /></label>
          <div className="grid grid-cols-2 gap-2">
            <button disabled={busy || !note.trim()} onClick={() => review(false)} className="btn-outline"><Undo2 size={16} />Send back</button>
            <button disabled={busy} onClick={() => review(true)} className="btn-primary"><CheckCircle2 size={16} />Approve</button>
          </div>
        </div>}
      </Modal>
    </Page>
  )
}
