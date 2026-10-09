import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, CircleDashed, CloudOff, Info, Loader2, MapPin, RotateCcw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import Camera from '../components/Camera'
import { Modal } from '../components/Sheet'
import { Empty, Notice, Row, SeverityTag, VerificationBadge } from '../components/ui'
import { api, getConfig, upload, type Config, type Incident, type Severity, type Signal, type Verification } from '../lib/api'
import { useSession } from '../lib/auth'
import { ago, dist, PROBLEM, SEVERITY } from '../lib/format'
import { useLocation, type Fix } from '../lib/geo'
import { formOf, keepOffline } from '../lib/queue'

type Match = { decision: string; distance_m: number | null; incident: Incident | null; road: { name: string | null; address: string } | null }
type Result = { decision: string; merged: boolean; report: { id: string; verification: Verification; signals: Signal[] }; incident: Incident }
const ICON = { pass: <CheckCircle2 size={17} className="text-emerald-600" />, warn: <AlertTriangle size={17} className="text-amber-600" />,
  fail: <XCircle size={17} className="text-rose-600" />, unavailable: <CircleDashed size={17} className="text-faint" />, info: <Info size={17} className="text-accent" /> }

export function SignalList({ signals }: { signals: Signal[] }) {
  return <ul className="grid gap-2">{signals.map((s) => <li key={s.key} className="flex items-start gap-2.5 text-sm">{ICON[s.status]}<span>{s.label}</span></li>)}</ul>
}

export default function Report() {
  const nav = useNavigate()
  const session = useSession()
  const { fix, error } = useLocation(!!session)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [shot, setShot] = useState<{ photo: Blob; fix: Fix; at: number } | null>(null)
  const [problem, setProblem] = useState('waterlogging')
  const [severity, setSeverity] = useState<Severity>('knee')
  const [note, setNote] = useState('')
  const [match, setMatch] = useState<Match | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const [offline, setOffline] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const preview = useMemo(() => (shot ? URL.createObjectURL(shot.photo) : ''), [shot])
  useEffect(() => { getConfig().then(setCfg).catch(() => setErr('Can’t reach JalMarg. Check your connection.')) }, [])

  if (!session) return (
    <div className="grid h-full place-items-center bg-bg p-6"><div className="card w-full max-w-sm">
      <Empty icon={<MapPin size={20} />} title="Sign in to report" text="Reports are linked to your account so duplicate observations can be merged and you get updates."
        action={<div className="flex gap-2"><button onClick={() => nav(-1)} className="btn-outline">Back</button><Link to="/login?next=/report" className="btn-primary">Sign in</Link></div>} />
    </div></div>
  )
  if (!shot) return <Camera fix={fix} geoError={error} maxAccuracy={cfg?.max_gps_accuracy_m ?? 50} title="Report waterlogging"
    onShot={(photo, f, at) => setShot({ photo, fix: f, at })} onClose={() => nav(-1)} />

  const fields = (extra: Record<string, string> = {}) => ({
    lat: String(shot.fix.lat), lng: String(shot.fix.lng), accuracy: String(shot.fix.accuracy), captured_at: String(shot.at), device_time: String(Date.now()),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, problem_type: problem, severity, note, capture_mode: 'live_camera', ...extra,
  })

  async function send(extra: Record<string, string> = {}) {
    setBusy(true); setErr(null); setProgress(0); setMatch(null)
    try {
      setResult(await upload<Result>('/reports', formOf(shot!.photo, fields(extra)), setProgress))
    } catch (e: any) {
      if (e.status === 0) { await keepOffline(shot!.photo, fields(extra)); setOffline(true) }
      else if (e.status === 409) setMatch(e.data)
      else setErr(e.message)
    } finally { setBusy(false) }
  }

  async function submit() {
    setBusy(true); setErr(null)
    try {
      const m = await api<Match>('/reports/check', { body: { lat: shot!.fix.lat, lng: shot!.fix.lng, accuracy: shot!.fix.accuracy, problem_type: problem } })
      if (m.decision === 'POSSIBLE_DUPLICATE' || m.decision === 'SAME_USER') { setMatch(m); setBusy(false) } else await send()
    } catch (e: any) { if (e.status === 0) await send(); else { setErr(e.message); setBusy(false) } }
  }

  async function attach(kind: 'confirm' | 'evidence') {
    const inc = match!.incident!
    setBusy(true)
    try {
      const f = new FormData()
      for (const [k, v] of Object.entries({ lat: shot!.fix.lat, lng: shot!.fix.lng, accuracy: shot!.fix.accuracy, captured_at: shot!.at })) f.append(k, String(v))
      f.append('photo', shot!.photo, 'capture.jpg')
      await upload(`/incidents/${inc.id}/${kind}`, f)
      toast.success(kind === 'confirm' ? 'Thanks — your confirmation was added' : 'Live evidence added')
      nav(`/incidents/${inc.id}`, { replace: true })
    } catch (e: any) { setErr(e.message); setMatch(null) } finally { setBusy(false) }
  }

  const done = result || offline
  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-4 pt-[env(safe-area-inset-top)]">
        <h1 className="flex-1 truncate text-base font-semibold">{result ? (result.merged ? 'Added to existing incident' : 'Report submitted') : offline ? 'Saved on this device' : 'Report details'}</h1>
        <button onClick={() => nav('/')} className="btn-ghost h-9">{done ? 'Done' : 'Cancel'}</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-4xl gap-4 p-4 lg:grid-cols-[1fr_1fr] lg:gap-6 lg:p-6">
          <div className="grid content-start gap-2">
            <img src={preview} alt="Your live photo" className="max-h-[38dvh] w-full rounded-lg border border-line bg-black object-contain lg:max-h-[70dvh]" />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>GPS ±{shot.fix.accuracy} m</span><span>{shot.fix.lat.toFixed(5)}, {shot.fix.lng.toFixed(5)}</span><span>{new Date(shot.at).toLocaleTimeString('en-IN')}</span>
            </div>
            {!done && <button onClick={() => setShot(null)} className="btn-ghost justify-self-start px-2"><RotateCcw size={16} />Retake</button>}
          </div>

          {result ? (
            <div className="card grid content-start gap-4 p-4">
              <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{result.incident.road_name || 'Road not matched'}</span><VerificationBadge v={result.report.verification} /></div>
              <p className="text-sm text-muted">{result.merged ? 'Someone already reported this on the same road segment. Your observation strengthens that incident.'
                : result.decision === 'NEEDS_REVIEW' ? 'We could not match the road, so a reviewer will check this report.' : 'Your report is live. People nearby can now confirm it.'}</p>
              <div><div className="eyebrow mb-2">Evidence checks</div><SignalList signals={result.report.signals} /></div>
              <p className="text-xs text-faint">Report {result.report.id}. The watermark adds context; it is not proof against tampering.</p>
              <Link to={`/incidents/${result.incident.id}`} className="btn-navy">View incident</Link>
            </div>
          ) : offline ? (
            <div className="card grid content-start gap-3 p-4">
              <div className="flex items-center gap-2 font-semibold"><CloudOff size={18} />Not submitted yet</div>
              <p className="text-sm text-muted">You’re offline. The photo and location are stored on this device and will upload when you reconnect. You can also retry from Account.</p>
              <button onClick={() => { setOffline(false); send() }} className="btn-primary">Retry now</button>
            </div>
          ) : (
            <div className="grid content-start gap-4">
              <fieldset><legend className="mb-2 text-sm font-semibold">Problem</legend>
                <div className="grid grid-cols-3 gap-2">
                  {(cfg?.problem_types || ['waterlogging']).map((p) => <button key={p} onClick={() => setProblem(p)} className={`btn h-auto min-h-10 whitespace-normal border px-2 py-2 text-xs ${problem === p ? 'border-navy bg-navy text-white' : 'border-line-strong bg-surface'}`}>{PROBLEM[p]}</button>)}
                </div>
              </fieldset>
              <fieldset><legend className="mb-2 text-sm font-semibold">Water depth</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(Object.keys(SEVERITY) as Severity[]).map((s) => (
                    <button key={s} onClick={() => setSeverity(s)} className={`flex h-12 items-center justify-center rounded-md border ${severity === s ? 'border-navy bg-subtle ring-2 ring-navy' : 'border-line-strong bg-surface'}`}><SeverityTag s={s} /></button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted">Your estimate. It isn’t inferred from the photo.</p>
              </fieldset>
              <label className="grid gap-1.5 text-sm font-semibold">Note <span className="sr-only">optional</span>
                <textarea className="input h-20 resize-none py-2 font-normal" maxLength={280} placeholder="Optional — e.g. near the bridge, bikes turning back" value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              {err && <Notice>{err}</Notice>}
              <button disabled={busy} onClick={submit} className="btn-danger h-12 text-[15px]">
                {busy ? <><Loader2 size={18} className="animate-spin" />{progress ? `Uploading ${progress}%` : 'Checking nearby incidents…'}</> : 'Submit live report'}
              </button>
            </div>
          )}
        </div>
      </div>

      <Modal open={!!match?.incident} onClose={() => setMatch(null)} title={match?.decision === 'SAME_USER' ? 'Already reported by you' : 'This problem may already be reported'}>
        {match?.incident && (
          <div className="grid gap-4">
            <p className="text-sm text-muted">{match.decision === 'SAME_USER' ? 'You already have an active report for this problem.'
              : `An active ${PROBLEM[match.incident.problem_type].toLowerCase()} incident was reported nearby on ${match.incident.road_name || 'this road'}.`}</p>
            <div className="rounded-md border border-line px-3">
              <Row k="Distance" v={dist(match.distance_m ?? 0)} />
              <Row k="Reported" v={ago(match.incident.created_at)} />
              <Row k="Status" v={<VerificationBadge v={match.incident.verification} />} />
              <Row k="Confirmed by" v={`${match.incident.confirmation_count} people`} />
            </div>
            {err && <Notice>{err}</Notice>}
            <div className="grid gap-2">
              {match.decision === 'POSSIBLE_DUPLICATE' && <button disabled={busy} onClick={() => attach('confirm')} className="btn-navy h-11">I SEE IT TOO</button>}
              <button disabled={busy} onClick={() => attach('evidence')} className="btn-outline">Add live evidence</button>
              <div className="grid grid-cols-2 gap-2">
                <Link to={`/incidents/${match.incident.id}#comments`} className="btn-outline">Add comment</Link>
                <Link to={`/incidents/${match.incident.id}`} className="btn-outline">{match.decision === 'SAME_USER' ? 'View my report' : 'View incident'}</Link>
              </div>
              {match.decision === 'POSSIBLE_DUPLICATE' && <button disabled={busy} onClick={() => send({ new_incident: 'true' })} className="btn-ghost text-xs">It’s a different problem — report separately</button>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
