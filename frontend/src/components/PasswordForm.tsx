import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Notice } from './ui'
import { api } from '../lib/api'
import { refreshUser, type User } from '../lib/auth'

export default function PasswordForm({ user, onDone }: { user: User; onDone?: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const askCurrent = user.has_password && !user.must_change_password
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (next !== confirm) return setErr('Passwords do not match')
    setBusy(true); setErr(null)
    try {
      await api('/me/password', { body: { current, new: next } })
      await refreshUser(() => api('/me'))
      toast.success('Password saved'); setCurrent(''); setNext(''); setConfirm(''); onDone?.()
    } catch (x: any) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="grid gap-3">
      {askCurrent && <label className="grid gap-1.5 text-sm font-medium">Current password<input type="password" autoComplete="current-password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>}
      <label className="grid gap-1.5 text-sm font-medium">New password<input type="password" autoComplete="new-password" className="input" value={next} onChange={(e) => setNext(e.target.value)} /></label>
      <label className="grid gap-1.5 text-sm font-medium">Confirm new password<input type="password" autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
      <p className="text-xs text-muted">At least 8 characters, with letters and numbers.</p>
      {err && <Notice>{err}</Notice>}
      <button disabled={busy || !next} className="btn-primary">{busy && <Loader2 size={16} className="animate-spin" />}Save password</button>
    </form>
  )
}
