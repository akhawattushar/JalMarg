import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Bell, BellRing, Camera as CamIcon, CheckCircle2, Hospital, Loader2, Send, Star, Users } from 'lucide-react'
import { toast } from 'sonner'
import Camera from '../components/Camera'
import { RiskDetail, WeatherDetail } from '../components/Context'
import { Modal } from '../components/Sheet'
import { Notice, Page, Row, Section, SeverityTag, Spinner, VerificationBadge } from '../components/ui'
import MapView from '../map/MapView'
import { api, fileUrl, getConfig, upload, type Incident as Inc, type Risk, type Weather } from '../lib/api'
import { can, useSession } from '../lib/auth'
import { ago, dist, PROBLEM, STATUS, when, WORK } from '../lib/format'
import { currentFix, useLocation, type Fix } from '../lib/geo'

type Detail = Inc & {
  evidence: { id: string; kind: string; image_url: string; original_url?: string; captured_at: number; gps_accuracy: number }[]; report_count: number
  timeline: { kind: string; at: number; who: string }[]; weather: (Weather & { available?: boolean }) | null; risk: Risk
  work: { id: string; status: string; priority: string; completed_at: number | null; completion_note: string | null; review_note: string | null
    assignee: { name: string; employee_id: string } | null; rating: number | null; ratings: number } | null
  me: { reported: boolean; confirmed: boolean; following: boolean; cleared: boolean; participant: boolean; rated: boolean; issue_open: boolean }
}
type Comment = { id: string; text: string; at: number; who: string }
const KIND: Record<string, string> = { reported: 'reported this', confirm: 'confirmed — I SEE IT TOO', clear: 'reported the road is clear', still_flooded: 'reported it is still flooded' }

export default function Incident() {
  const { id } = useParams()
  const s = useSession()
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [camera, setCamera] = useState<null | 'confirm' | 'evidence' | 'issue'>(null)
  const [issueShot, setIssueShot] = useState<{ photo: Blob; fix: Fix; at: number } | null>(null)
  const [issueText, setIssueText] = useState('')
  const [stars, setStars] = useState(0)
  const [review, setReview] = useState('')
  const [maxAcc, setMaxAcc] = useState(50)
  const [woOpen, setWoOpen] = useState(false)
  const [shown, setShown] = useState(0)
  const geo = useLocation(!!camera)

  const load = useCallback(() => {
    api<Detail>(`/incidents/${id}`).then(setD).catch((e) => setErr(e.message))
    api<Comment[]>(`/incidents/${id}/comments`).then(setComments).catch(() => null)
  }, [id])
  useEffect(() => { load(); getConfig().then((c) => setMaxAcc(c.max_gps_accuracy_m)).catch(() => null) }, [load])

  const run = async (f: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await f(); toast.success(ok); load(); return true } catch (e: any) { toast.error(e.message); return false } finally { setBusy(false) }
  }

  const withFix = (path: string, ok: string) => run(async () => { const f = await currentFix(); await api(path, { body: { lat: f.lat, lng: f.lng } }) }, ok)
  const confirmNoPhoto = () => run(async () => {
    const f = await currentFix(), form = new FormData()
    Object.entries({ lat: f.lat, lng: f.lng, accuracy: f.accuracy }).forEach(([k, v]) => form.append(k, String(v)))
    await upload(`/incidents/${id}/confirm`, form)
  }, 'Thanks — confirmation added')
  const onShot = (photo: Blob, f: Fix, at: number) => {
    const kind = camera!
    setCamera(null)
    if (kind === 'issue') return setIssueShot({ photo, fix: f, at })
    const form = new FormData()
    Object.entries({ lat: f.lat, lng: f.lng, accuracy: f.accuracy, captured_at: at }).forEach(([k, v]) => form.append(k, String(v)))
    form.append('photo', photo, 'capture.jpg')
    run(() => upload(`/incidents/${id}/${kind}`, form), kind === 'confirm' ? 'Thanks — confirmation added' : 'Live evidence added')
  }

  if (camera) return <div className="fixed inset-0 z-50"><Camera fix={geo.fix} geoError={geo.error} maxAccuracy={maxAcc} title={camera === 'confirm' ? 'I SEE IT TOO — live photo' : camera === 'issue' ? 'Photo of the problem with the work' : 'Add live evidence'} onShot={onShot} onClose={() => setCamera(null)} /></div>
  if (!d) return <Page title="Incident" back>{err ? <Notice>{err}</Notice> : <Spinner />}</Page>

  const activeInc = d.status === 'active', recentlyFixed = ['resolved', 'cleared'].includes(d.status) && Date.now() / 1000 - (d.resolved_at || 0) < 86400
  const signIn = <Link to={`/login?next=/incidents/${id}`} className="btn-primary">Sign in to take part</Link>

  return (
    <Page title={d.road_name || 'Unnamed road'} subtitle={`${PROBLEM[d.problem_type]}${d.locality ? ` · ${d.locality}` : ''}`} back width="max-w-6xl"
      actions={<VerificationBadge v={d.verification} />}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-6">
        <div className="grid min-w-0 content-start gap-4">
          {d.evidence.length ? (() => {
            const e = d.evidence[Math.min(shown, d.evidence.length - 1)]
            return (
              <div className="grid gap-2">
                <img src={fileUrl(e.image_url)} alt={`Evidence captured ${when(e.captured_at)}`} className="aspect-[4/3] w-full rounded-lg border border-line bg-black object-contain" />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span className="capitalize">{e.kind} evidence · {when(e.captured_at)} · ±{Math.round(e.gps_accuracy)} m</span>
                  {e.original_url && <a href={fileUrl(e.original_url)} target="_blank" rel="noreferrer" className="text-accent underline">View original</a>}</div>
                {d.evidence.length > 1 && <div className="flex gap-2 overflow-x-auto pb-1">{d.evidence.map((x, n) => (
                  <button key={x.id} aria-label={`Show evidence ${n + 1}`} onClick={() => setShown(n)} className={`h-14 w-20 shrink-0 overflow-hidden rounded-md border-2 ${n === shown ? 'border-navy' : 'border-transparent opacity-70'}`}>
                    <img src={fileUrl(x.image_url)} alt="" className="h-full w-full object-cover" /></button>))}</div>}
              </div>
            )
          })() : <div className="grid aspect-[4/3] place-items-center rounded-lg border border-line bg-subtle text-sm text-muted">No photo evidence</div>}

          <div className="card p-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <SeverityTag s={d.severity} resolved={!activeInc} />
              <span className="flex items-center gap-1.5 text-sm"><Users size={15} className="text-muted" />Confirmed by <b>{d.confirmation_count}</b> {d.confirmation_count === 1 ? 'person' : 'people'}</span>
              <span className="text-sm text-muted">Last observed {ago(d.last_observed_at)}</span>
            </div>
            {d.reopened_count > 0 && <p className="mt-2 text-xs text-amber-800">Reopened {d.reopened_count}× after work was marked complete.</p>}
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {!s ? <div className="sm:col-span-2">{signIn}</div> : activeInc ? (
                d.me.reported ? <p className="text-sm text-muted sm:col-span-2">You reported this. You’ll be notified about work on it.</p> : d.me.confirmed
                  ? <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 sm:col-span-2"><CheckCircle2 size={16} />You confirmed this incident</p>
                  : <><button disabled={busy} onClick={() => setCamera('confirm')} className="btn-navy h-11"><CamIcon size={17} />I SEE IT TOO</button>
                    <button disabled={busy} onClick={confirmNoPhoto} className="btn-outline h-11">Confirm without photo</button></>
              ) : recentlyFixed ? <>
                <button disabled={busy || d.me.cleared} onClick={() => withFix(`/incidents/${id}/clear`, 'Thanks for confirming')} className="btn-outline h-11">Confirm road is clear</button>
                <button disabled={busy} onClick={() => withFix(`/incidents/${id}/reopen`, 'Incident reopened')} className="btn-danger h-11">Still flooded</button>
              </> : <p className="text-sm text-muted sm:col-span-2">This incident is {STATUS[d.status]?.toLowerCase()}. If the road is flooded again, file a new live report.</p>}
              {s && activeInc && <>
                <button disabled={busy} onClick={() => setCamera('evidence')} className="btn-ghost justify-start px-2"><CamIcon size={16} />Add live evidence</button>
                {!d.me.cleared && <button disabled={busy} onClick={() => withFix(`/incidents/${id}/clear`, 'Thanks — noted')} className="btn-ghost justify-start px-2"><CheckCircle2 size={16} />Road is clear now</button>}
              </>}
              {s && <button disabled={busy || d.me.following} onClick={() => run(() => api(`/incidents/${id}/subscribe`, { body: {} }), 'You’ll get updates')} className="btn-ghost justify-start px-2">
                {d.me.following ? <><BellRing size={16} />Following</> : <><Bell size={16} />Follow updates</>}</button>}
            </div>
            <p className="mt-2 text-xs text-faint">Confirming needs you to be near this spot. Confirmations are one verification signal, not proof.</p>
          </div>

          <Section title={`Comments · ${comments.length}`}>
            <div id="comments" className="grid gap-3">
              {s ? (
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/incidents/${id}/comments`, { body: { text } }); setText('') }, 'Comment posted') }}>
                  <input className="input" maxLength={280} placeholder="e.g. Water is knee deep near the bridge" value={text} onChange={(e) => setText(e.target.value)} />
                  <button aria-label="Post comment" disabled={busy || !text.trim()} className="btn-primary w-10 px-0"><Send size={16} /></button>
                </form>
              ) : <p className="text-sm text-muted">Sign in to comment.</p>}
              {comments.map((c) => <div key={c.id} className="rounded-md bg-subtle px-3 py-2 text-sm"><div className="text-xs text-muted">{c.who} · {ago(c.at)}</div><p className="mt-0.5 break-words">{c.text}</p></div>)}
              {!comments.length && <p className="text-sm text-muted">No comments yet.</p>}
            </div>
          </Section>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <div className="relative h-52 overflow-hidden rounded-lg border border-line"><MapView center={d} zoom={15} incidents={[{ id: d.id, lat: d.lat, lng: d.lng, severity: d.severity, status: d.status }]} selected={d.id} interactive={false} /></div>
          <Section title="Status">
            <Row k="Incident" v={STATUS[d.status]} />
            <Row k="Municipal work" v={d.work ? `${WORK[d.work.status]} · ${d.work.priority}` : 'Not yet assigned'} />
            {d.work?.assignee && <Row k="Field worker" v={`${d.work.assignee.name} · ${d.work.assignee.employee_id}`} />}
            {d.work?.rating != null && <Row k="Citizen rating" v={<span className="inline-flex items-center gap-1"><Star size={14} className="fill-amber-400 text-amber-400" />{d.work.rating} ({d.work.ratings})</span>} />}
            {d.work?.completion_note && <Row k="Work note" v={d.work.completion_note} />}
            <Row k="Reports merged" v={d.report_count} />
            <Row k="First reported" v={when(d.created_at)} />
            {d.address && <Row k="Address" v={d.address} />}
            {can(s, 'ward_officer') && activeInc && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {!d.work || d.work.status === 'done' ? <button onClick={() => setWoOpen(true)} className="btn-navy">Create work order</button> : <span />}
                <button disabled={busy} onClick={() => run(() => api(`/incidents/${id}/resolve`, { body: {} }), 'Incident resolved')} className="btn-outline">Mark resolved</button>
              </div>
            )}
          </Section>
          {d.work?.status === 'done' && d.me.participant && (
            <Section title="How was the work?">
              {d.me.rated ? <p className="text-sm text-emerald-700">Thanks — your rating was recorded.</p> : (
                <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); run(() => api(`/work-orders/${d.work!.id}/rating`, { body: { rating: stars, text: review } }), 'Thanks for rating the work') }}>
                  <div role="radiogroup" aria-label="Rating" className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => (
                    <button type="button" key={n} role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setStars(n)} className="p-1">
                      <Star size={28} className={n <= stars ? 'fill-amber-400 text-amber-400' : 'text-line-strong'} /></button>))}</div>
                  <textarea className="input h-20 py-2" maxLength={500} placeholder="Write a review (optional)" value={review} onChange={(e) => setReview(e.target.value)} />
                  <button disabled={busy || !stars} className="btn-primary">Submit rating</button>
                </form>
              )}
              <div className="mt-4 border-t border-line pt-4">
                {d.me.issue_open ? <p className="text-sm text-muted">Your issue was sent to the ward officer.</p> : <>
                  <p className="text-sm text-muted">Work not done properly? Tell the ward officer with a live photo from the spot.</p>
                  <button onClick={() => { setIssueText(''); setCamera('issue') }} className="btn-outline mt-2"><CamIcon size={16} />Report a problem with the work</button></>}
              </div>
            </Section>
          )}
          {!!d.critical.length && (
            <Section title="Critical places within 500 m">
              {d.critical.map((c) => <Row key={c.name} k={<span className="flex items-center gap-2"><Hospital size={14} />{c.name}</span>} v={dist(c.distance_m)} />)}
            </Section>
          )}
          <Section title="Waterlogging risk"><RiskDetail risk={d.risk} /></Section>
          <Section title="Weather at this location"><WeatherDetail wx={d.weather ? { ...d.weather, available: true } : { available: false, provider: '' }} /></Section>
          <Section title="Activity">
            <ol className="grid gap-2.5">{d.timeline.map((t, i) => <li key={i} className="flex gap-2.5 text-sm"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-line-strong" />
              <span className="min-w-0"><b className="font-medium">{t.who}</b> <span className="text-muted">{KIND[t.kind] || t.kind}</span> <span className="block text-xs text-faint">{ago(t.at)}</span></span></li>)}</ol>
          </Section>
        </div>
      </div>
      <Modal open={!!issueShot} onClose={() => setIssueShot(null)} title="Report a problem with the work">
        {issueShot && <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData()
          Object.entries({ lat: issueShot.fix.lat, lng: issueShot.fix.lng, accuracy: issueShot.fix.accuracy, captured_at: issueShot.at, text: issueText }).forEach(([k, v]) => f.append(k, String(v)))
          f.append('photo', issueShot.photo, 'issue.jpg')
          run(() => upload(`/work-orders/${d.work!.id}/issue`, f), 'Issue sent to the ward officer').then((ok) => ok && setIssueShot(null))
        }}>
          <img src={URL.createObjectURL(issueShot.photo)} alt="Issue photo" className="max-h-56 w-full rounded-md border border-line bg-black object-contain" />
          <textarea className="input h-24 py-2" required minLength={5} maxLength={500} placeholder="What is still wrong? e.g. Drain still blocked, water back after 1 hour" value={issueText} onChange={(e) => setIssueText(e.target.value)} />
          <button disabled={busy || issueText.trim().length < 5} className="btn-navy">Send to ward officer</button>
        </form>}
      </Modal>
      <WorkOrderModal open={woOpen} incidentId={d.id} onClose={() => setWoOpen(false)} onDone={load} />
    </Page>
  )
}

export function WorkOrderModal({ open, incidentId, onClose, onDone }: { open: boolean; incidentId: string; onClose: () => void; onDone: () => void }) {
  const [workers, setWorkers] = useState<{ id: string; label: string }[]>([])
  const [assignee, setAssignee] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) api('/workers').then(setWorkers).catch(() => null) }, [open])
  const create = async () => {
    setBusy(true)
    try { await api('/work-orders', { body: { incident_id: incidentId, assignee_id: assignee || null, note } }); toast.success('Work order created'); onClose(); onDone() }
    catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Create work order">
      <div className="grid gap-3">
        <label className="grid gap-1.5 text-sm font-medium">Assign to
          <select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Unassigned</option>{workers.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
          {!workers.length && <span className="text-xs font-normal text-muted">No municipal workers yet. An admin can assign the worker role.</span>}
        </label>
        <label className="grid gap-1.5 text-sm font-medium">Instructions
          <textarea className="input h-20 py-2 font-normal" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </label>
        <button disabled={busy} onClick={create} className="btn-navy">{busy && <Loader2 size={16} className="animate-spin" />}Create work order</button>
      </div>
    </Modal>
  )
}
