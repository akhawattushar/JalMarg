import { useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BadgeCheck, HardHat, Loader2, ShieldCheck, UserRound } from 'lucide-react'
import { Logo, Notice } from '../components/ui'
import { api } from '../lib/api'
import { HOME, setGuest, setSession, type Session } from '../lib/auth'

type Who = 'citizen' | 'staff' | 'admin'
// Photo: Dibakar Roy on Unsplash (Unsplash License). Drop a copy at public/login-bg.jpg to serve it locally.
const PHOTO_REMOTE = 'https://unsplash.com/photos/Wo3JyKy_Ne8/download?force=true&w=2400'
const fallback = (e: SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget
  if (img.src.endsWith('/login-bg.jpg')) img.src = PHOTO_REMOTE
  else img.hidden = true
}
type Auth = { token: string; expires_in: number; user: Session['user'] }
const WHO: { v: Who; label: string; icon: typeof UserRound; hint: string }[] = [
  { v: 'citizen', label: 'Citizen', icon: UserRound, hint: 'Report and track waterlogging' },
  { v: 'staff', label: 'Municipal staff', icon: HardHat, hint: 'Ward officers and field workers' },
  { v: 'admin', label: 'Admin', icon: ShieldCheck, hint: 'Registered administrator number' },
]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-medium">{label}{children}</label>
}

function PhoneInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex h-11 overflow-hidden rounded-md border border-line-strong bg-surface focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15">
      <span className="grid place-items-center border-r border-line px-3 text-sm text-muted">+91</span>
      <input autoFocus inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d ]/g, ''))}
        className="min-w-0 flex-1 bg-transparent px-3 text-[15px] outline-none" />
    </div>
  )
}

export default function Login() {
  const nav = useNavigate(), [params] = useSearchParams()
  const [who, setWho] = useState<Who>('citizen')
  const [method, setMethod] = useState<'otp' | 'password'>('otp')
  const [phone, setPhone] = useState('')
  const [empId, setEmpId] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [wait, setWait] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)
  const digits = phone.replace(/\D/g, '').slice(-10), e164 = '+91' + digits, phoneOk = /^[6-9]\d{9}$/.test(digits)
  const purpose = who === 'admin' ? 'admin' : 'citizen'
  const otp = who === 'admin' || (who === 'citizen' && method === 'otp')

  useEffect(() => { if (wait) { const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t) } }, [wait])
  useEffect(() => { setErr(null); setSent(false); setCode(''); setPassword('') }, [who, method])

  const call = async (f: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await f() } catch (e: any) { setErr(e.message) } finally { setBusy(false) } }
  const finish = (r: Auth) => {
    setGuest(false)
    setSession({ token: r.token, exp: Date.now() + r.expires_in * 1000, user: r.user })
    nav(params.get('next') || HOME[r.user.role], { replace: true })
  }
  const send = () => call(async () => { await api('/auth/otp/start', { body: { phone: e164, purpose } }); setSent(true); setWait(30); setTimeout(() => codeRef.current?.focus(), 50) })
  const verify = (c = code) => call(async () => finish(await api<Auth>('/auth/otp/verify', { body: { phone: e164, code: c, purpose } }))).finally(() => setCode(''))
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (who === 'staff') call(async () => finish(await api<Auth>('/auth/staff', { body: { employee_id: empId, password } })))
    else if (!otp) call(async () => finish(await api<Auth>('/auth/password', { body: { phone: e164, password } })))
    else sent ? verify() : send()
  }
  const canSubmit = who === 'staff' ? empId.trim().length >= 3 && !!password : !phoneOk ? false : otp ? (!sent || code.length === 6) : !!password

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
          <p className="text-xs text-slate-300">Photo: Dibakar Roy / Unsplash · Your phone number is never shown publicly.</p>
        </div>
      </section>

      <section className="flex min-h-full flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-10">
        <div className="lg:hidden"><Logo /></div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8">
          <h1 className="text-2xl font-semibold">Sign in to JalMarg</h1>
            <p className="mt-1 text-sm text-muted">Choose how you use JalMarg.</p>

            <div role="radiogroup" aria-label="Account type" className="mt-6 grid grid-cols-3 gap-2">
              {WHO.map(({ v, label, icon: I }) => (
                <button key={v} role="radio" aria-checked={who === v} onClick={() => setWho(v)}
                  className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-3 text-center text-xs font-semibold leading-tight transition-colors ${who === v ? 'border-navy bg-navy text-white' : 'border-line-strong bg-surface text-ink hover:bg-subtle'}`}>
                  <I size={20} />{label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">{WHO.find((w) => w.v === who)!.hint}</p>

            {who === 'citizen' && (
              <div className="mt-5 grid grid-cols-2 rounded-md border border-line-strong p-0.5 text-sm font-semibold">
                {(['otp', 'password'] as const).map((m) => <button key={m} onClick={() => setMethod(m)} className={`h-9 rounded ${method === m ? 'bg-subtle text-ink shadow-sm ring-1 ring-line' : 'text-muted'}`}>{m === 'otp' ? 'One-time code' : 'Password'}</button>)}
              </div>
            )}

            <form className="mt-5 grid gap-4" onSubmit={submit}>
              {who === 'staff' ? <>
                <Field label="Employee ID"><input autoFocus autoCapitalize="characters" autoComplete="username" className="input h-11 uppercase" placeholder="JM-WRK-1001" value={empId} onChange={(e) => setEmpId(e.target.value)} /></Field>
                <Field label="Password"><input type="password" autoComplete="current-password" className="input h-11" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
                <p className="text-xs text-muted">Staff accounts and temporary passwords are issued by your municipal administrator.</p>
              </> : sent ? (
                <Field label={`Code sent to ${e164}`}>
                  <input ref={codeRef} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} className="input h-11 text-center text-lg tracking-[0.5em]"
                    onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setCode(v); if (v.length === 6) verify(v) }} />
                </Field>
              ) : <>
                <Field label={who === 'admin' ? 'Administrator mobile number' : 'Mobile number'}><PhoneInput value={phone} onChange={setPhone} /></Field>
                {!otp && <Field label="Password"><input type="password" autoComplete="current-password" className="input h-11" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
              </>}
              {err && <Notice>{err}</Notice>}
              <button disabled={busy || !canSubmit} className="btn-primary h-11">{busy && <Loader2 size={16} className="animate-spin" />}
                {who === 'staff' || !otp ? 'Sign in' : sent ? 'Verify code' : 'Send code'}</button>
              {otp && sent && <div className="flex justify-between text-sm">
                <button type="button" onClick={() => setSent(false)} className="text-muted hover:text-ink">Change number</button>
                <button type="button" disabled={wait > 0 || busy} onClick={send} className="text-accent disabled:text-faint">{wait ? `Resend in ${wait}s` : 'Resend code'}</button></div>}
              {who === 'citizen' && method === 'password' && <p className="text-xs text-muted">No password yet? Sign in with a one-time code, then set one in Account.</p>}
            </form>

            {who === 'citizen' && <button onClick={() => { setGuest(true); nav('/', { replace: true }) }} className="mt-6 w-full text-center text-sm text-muted underline-offset-4 hover:underline">View the live map without signing in</button>}
        </div>
      </section>
    </div>
  )
}
