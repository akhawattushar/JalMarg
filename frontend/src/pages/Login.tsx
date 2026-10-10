import { useEffect, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { BadgeCheck, HardHat, Loader2, MailCheck, ShieldCheck, UserRound } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { Logo, Notice } from '../components/ui'
import { API, api, ApiError, getConfig, type AuthResult } from '../lib/api'
import { HOME, safeNext, setGuest, setSession } from '../lib/auth'

type Who = 'citizen' | 'staff' | 'admin'
// Photo: Dibakar Roy on Unsplash (Unsplash License). Drop a copy at public/login-bg.jpg to serve it locally.
const PHOTO_REMOTE = 'https://unsplash.com/photos/Wo3JyKy_Ne8/download?force=true&w=2400'
const fallback = (e: SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget
  if (img.src.endsWith('/login-bg.jpg')) img.src = PHOTO_REMOTE
  else img.hidden = true
}
const WHO: { v: Who; label: string; icon: typeof UserRound; hint: string }[] = [
  { v: 'citizen', label: 'Citizen', icon: UserRound, hint: 'Report and track waterlogging' },
  { v: 'staff', label: 'Municipal staff', icon: HardHat, hint: 'Ward officers and field workers' },
  { v: 'admin', label: 'Admin', icon: ShieldCheck, hint: 'Municipal administrator' },
]

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-medium">{label}{children}</label>
}

/** Store the session and go to the requested page (same-app paths only) or the role's home. */
export function useFinish() {
  const nav = useNavigate()
  return (r: AuthResult, next?: string | null) => {
    setGuest(false)
    setSession({ token: r.token, user: r.user })
    nav(safeNext(next) || HOME[r.user.role], { replace: true })
  }
}

function GoogleButton({ next }: { next: string | null }) {
  return (
    <a href={`${API}/auth/google/start?next=${encodeURIComponent(safeNext(next) || '/')}`} className="btn-outline h-11 w-full gap-2.5">
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" /></svg>
      Continue with Google
    </a>
  )
}

export default function Login() {
  const nav = useNavigate(), [params] = useSearchParams(), next = params.get('next')
  const finish = useFinish()
  const [who, setWho] = useState<Who>('citizen')
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [empId, setEmpId] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [unverified, setUnverified] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [google, setGoogle] = useState(false)

  useEffect(() => { getConfig().then((c) => setGoogle(c.google_auth && !Capacitor.isNativePlatform())).catch(() => null) }, [])
  useEffect(() => { setErr(null); setUnverified(false); setPassword(''); setConfirm('') }, [who, mode])

  const call = async (f: () => Promise<unknown>) => {
    setBusy(true); setErr(null); setUnverified(false)
    try { await f() } catch (e: any) {
      setErr(e.message)
      if (e instanceof ApiError && e.data?.detail?.code === 'email_unverified') setUnverified(true)
    } finally { setBusy(false) }
  }
  const resend = () => call(async () => { await api('/auth/resend-verification', { body: { email } }); setSent(email) })
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (who === 'staff') return call(async () => finish(await api<AuthResult>('/auth/staff', { body: { employee_id: empId, password } }), next))
    if (mode === 'register' && who === 'citizen') {
      if (password !== confirm) return setErr('Passwords do not match')
      return call(async () => { await api('/auth/register', { body: { name, email, password } }); setSent(email) })
    }
    call(async () => finish(await api<AuthResult>('/auth/login', { body: { email, password } }), next))
  }
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.trim())
  const registering = who === 'citizen' && mode === 'register'
  const canSubmit = who === 'staff' ? empId.trim().length >= 3 && !!password
    : registering ? emailOk && name.trim().length >= 2 && password.length >= 8 && !!confirm : emailOk && !!password

  return (
    <div className="grid h-full overflow-y-auto bg-bg lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="relative hidden overflow-hidden bg-navy lg:block">
        <img src="/login-bg.jpg" onError={fallback} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy/90 via-navy/40 to-navy/60" />
        <div className="relative flex h-full flex-col justify-between p-10 text-white xl:p-12">
          <Logo dark />
          <div className="max-w-md rounded-2xl border border-white/20 bg-white/10 p-7 shadow-[0_20px_50px_-20px_rgba(0,0,0,.6)] backdrop-blur-lg backdrop-saturate-150">
            <h2 className="text-3xl font-semibold leading-tight xl:text-4xl">One trusted incident for every flooded road.</h2>
            <p className="mt-4 text-slate-100">Citizens report with live evidence, nearby people confirm, and the municipal team clears the drain — everyone sees the same record.</p>
            <ul className="mt-6 grid gap-3 text-sm text-white">
              {['Live camera + precise GPS evidence', 'Road-aware duplicate detection', 'Work orders that notify every reporter'].map((t) => <li key={t} className="flex items-center gap-2"><BadgeCheck size={17} className="text-cyan-300" />{t}</li>)}
            </ul>
          </div>
          <p className="text-xs text-slate-300">Photo: Dibakar Roy / Unsplash · Your email address is never shown publicly.</p>
        </div>
      </section>

      <section className="flex min-h-full flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-10">
        <div className="lg:hidden"><Logo /></div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8">
          {sent ? (
            <div className="grid gap-4">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent"><MailCheck size={22} /></span>
              <h1 className="text-2xl font-semibold">Check your inbox</h1>
              <p className="text-sm text-muted">If <b className="text-ink">{sent}</b> can be used, we've sent a link to confirm it. Open it on this device to finish signing in. The link works for 24 hours — check your spam folder too.</p>
              <button onClick={() => { setSent(null); setMode('signin') }} className="btn-primary h-11">Back to sign in</button>
            </div>
          ) : <>
            <h1 className="text-2xl font-semibold">{registering ? 'Create your account' : 'Sign in to JalMarg'}</h1>
            <p className="mt-1 text-sm text-muted">{registering ? 'Use your email address. We’ll send a link to confirm it.' : 'Choose how you use JalMarg.'}</p>

            {!registering && <>
              <div role="radiogroup" aria-label="Account type" className="mt-6 grid grid-cols-3 gap-2">
                {WHO.map(({ v, label, icon: I }) => (
                  <button key={v} role="radio" aria-checked={who === v} onClick={() => setWho(v)}
                    className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-3 text-center text-xs font-semibold leading-tight transition-colors ${who === v ? 'border-navy bg-navy text-white' : 'border-line-strong bg-surface text-ink hover:bg-subtle'}`}>
                    <I size={20} />{label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">{WHO.find((w) => w.v === who)!.hint}</p>
            </>}

            {who === 'citizen' && google && <div className="mt-5 grid gap-4">
              <GoogleButton next={next} />
              <div className="flex items-center gap-3 text-xs text-faint"><span className="h-px flex-1 bg-line" />or with email<span className="h-px flex-1 bg-line" /></div>
            </div>}

            <form className="mt-5 grid gap-4" onSubmit={submit}>
              {who === 'staff' ? <>
                <Field label="Employee ID"><input autoFocus autoCapitalize="characters" autoComplete="username" className="input h-11 uppercase" placeholder="JM-WRK-1001" value={empId} onChange={(e) => setEmpId(e.target.value)} /></Field>
                <Field label="Password"><input type="password" autoComplete="current-password" className="input h-11" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
                <p className="text-xs text-muted">Staff accounts and temporary passwords are issued by your municipal administrator.</p>
              </> : <>
                {registering && <Field label="Full name"><input autoFocus autoComplete="name" className="input h-11" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Asha Verma" /></Field>}
                <Field label={who === 'admin' ? 'Administrator email' : 'Email'}><input type="email" autoFocus={!registering} autoComplete="email" inputMode="email" className="input h-11" maxLength={254}
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
                <Field label="Password"><input type="password" autoComplete={registering ? 'new-password' : 'current-password'} className="input h-11" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
                {registering && <>
                  <Field label="Confirm password"><input type="password" autoComplete="new-password" className="input h-11" maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
                  <p className="-mt-2 text-xs text-muted">At least 8 characters, with letters and numbers.</p>
                </>}
              </>}
              {err && <Notice action={unverified ? <button type="button" onClick={resend} className="shrink-0 text-sm font-semibold underline">Resend link</button> : undefined}>{err}</Notice>}
              <button disabled={busy || !canSubmit} className="btn-primary h-11">{busy && <Loader2 size={16} className="animate-spin" />}{registering ? 'Create account' : 'Sign in'}</button>
              {who === 'citizen' && !registering && <div className="flex justify-between text-sm">
                <Link to="/forgot-password" className="text-muted hover:text-ink">Forgot password?</Link>
                <button type="button" onClick={() => setMode('register')} className="font-semibold text-accent">Create account</button></div>}
              {registering && <p className="text-center text-sm text-muted">Already have an account? <button type="button" onClick={() => setMode('signin')} className="font-semibold text-accent">Sign in</button></p>}
              {who === 'admin' && <p className="text-xs text-muted">The administrator account is configured on the server. To change its password, update ADMIN_PASSWORD_HASH.</p>}
            </form>

            {who === 'citizen' && <button onClick={() => { setGuest(true); nav('/', { replace: true }) }} className="mt-6 w-full text-center text-sm text-muted underline-offset-4 hover:underline">View the live map without signing in</button>}
          </>}
        </div>
      </section>
    </div>
  )
}
