import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2, MailCheck } from 'lucide-react'
import { Logo, Notice } from '../components/ui'
import { api, type AuthResult } from '../lib/api'
import { Field, useFinish } from './Login'

type Kind = 'forgot' | 'reset' | 'verify'
const TITLE: Record<Kind, string> = { forgot: 'Reset your password', reset: 'Choose a new password', verify: 'Confirming your email' }

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center overflow-y-auto bg-bg p-5">
      <div className="card w-full max-w-md p-6">
        <Logo />
        <h1 className="mt-5 text-xl font-semibold">{title}</h1>
        <div className="mt-4 grid gap-4">{children}</div>
      </div>
    </div>
  )
}

/** One-time tokens must be used once, even when React runs effects twice in development. */
const used = new Set<string>()
function useOnce(key: string | null, run: (key: string) => void) {
  const ran = useRef(false)
  useEffect(() => {
    if (!key || ran.current || used.has(key)) return
    ran.current = true; used.add(key); run(key)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

export default function AuthPages({ kind }: { kind: Kind }) {
  const [params] = useSearchParams(), finish = useFinish()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [verified, setVerified] = useState<AuthResult | null>(null)
  const token = params.get('token')

  // Keep one-time tokens out of the address bar and browser history once read.
  useEffect(() => { if (token) history.replaceState(null, '', location.pathname) }, [token])

  useOnce(kind === 'verify' ? token : null, (t) => {
    api<AuthResult>('/auth/verify-email', { body: { token: t } }).then(setVerified).catch((e) => setErr(e.message))
  })

  const call = async (f: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await f() } catch (e: any) { setErr(e.message) } finally { setBusy(false) } }
  const back = <Link to="/login" className="btn-outline">Back to sign in</Link>

  if (kind === 'verify') {
    if (verified) return (
      <Shell title="Email verified">
        <p className="flex gap-2 text-sm text-muted"><CheckCircle2 size={20} className="shrink-0 text-emerald-600" />
          <span><b className="text-ink">{verified.user.email}</b> is now verified. Your JalMarg account is ready.</span></p>
        <button onClick={() => finish(verified)} className="btn-primary h-11">Continue to JalMarg</button>
      </Shell>
    )
    if (err && /already confirmed/i.test(err)) return (
      <Shell title="Email already verified">
        <p className="flex gap-2 text-sm text-muted"><CheckCircle2 size={20} className="shrink-0 text-emerald-600" />This email address is already verified. Sign in with your email and password.</p>
        <Link to="/login" className="btn-primary h-11">Sign in</Link>
      </Shell>
    )
    const problem = err || (!token ? 'This link is incomplete.' : null)
    return <Shell title={problem ? 'Link not valid' : TITLE.verify}>
      {problem ? <><Notice>{problem}</Notice>{back}</> : <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" />Verifying your email…</p>}
    </Shell>
  }

  if (kind === 'forgot') return (
    <Shell title={done ? 'Check your inbox' : TITLE.forgot}>
      {done ? <>
        <p className="flex gap-2 text-sm text-muted"><MailCheck size={18} className="shrink-0 text-accent" />If an account uses <b className="text-ink">{email}</b>, we've sent a link to reset the password. It works for 30 minutes.</p>
        {back}
      </> : <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); call(async () => { await api('/auth/forgot-password', { body: { email } }); setDone(true) }) }}>
        <p className="text-sm text-muted">Enter the email you signed up with and we'll send you a reset link.</p>
        <Field label="Email"><input type="email" autoFocus autoComplete="email" className="input h-11" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        {err && <Notice>{err}</Notice>}
        <button disabled={busy || !email.includes('@')} className="btn-primary h-11">{busy && <Loader2 size={16} className="animate-spin" />}Send reset link</button>
        <Link to="/login" className="text-center text-sm text-muted hover:text-ink">Back to sign in</Link>
      </form>}
    </Shell>
  )

  return (
    <Shell title={done ? 'Password updated' : TITLE.reset}>
      {done ? <>
        <p className="flex gap-2 text-sm text-muted"><CheckCircle2 size={18} className="shrink-0 text-emerald-600" />You've been signed out on every device. Sign in with your new password.</p>
        <Link to="/login" className="btn-primary">Sign in</Link>
      </> : !token ? <><Notice>This link is incomplete. Request a new one.</Notice><Link to="/forgot-password" className="btn-outline">Request a new link</Link></> : (
        <form className="grid gap-4" onSubmit={(e) => {
          e.preventDefault()
          if (password !== confirm) return setErr('Passwords do not match')
          call(async () => { await api('/auth/reset-password', { body: { token, password } }); setDone(true) })
        }}>
          <Field label="New password"><input type="password" autoFocus autoComplete="new-password" className="input h-11" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="Confirm new password"><input type="password" autoComplete="new-password" className="input h-11" maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          <p className="-mt-2 text-xs text-muted">At least 8 characters, with letters and numbers.</p>
          {err && <Notice action={/expired|invalid/i.test(err) ? <Link to="/forgot-password" className="shrink-0 text-sm font-semibold underline">New link</Link> : undefined}>{err}</Notice>}
          <button disabled={busy || password.length < 8 || !confirm} className="btn-primary h-11">{busy && <Loader2 size={16} className="animate-spin" />}Save new password</button>
        </form>
      )}
    </Shell>
  )
}
