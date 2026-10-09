import { useState } from 'react'
import { Loader2, LocateFixed } from 'lucide-react'
import { toast } from 'sonner'
import { Notice } from './ui'
import { api } from '../lib/api'
import { refreshUser, type User } from '../lib/auth'
import { currentFix } from '../lib/geo'

export default function ProfileForm({ user, submitLabel = 'Save', onDone }: { user: User; submitLabel?: string; onDone?: () => void }) {
  const staff = user.role === 'worker' || user.role === 'ward_officer'
  const [name, setName] = useState(user.name || '')
  const [address, setAddress] = useState(user.address || '')
  const [busy, setBusy] = useState<'save' | 'locate' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const locate = async () => {
    setBusy('locate'); setErr(null)
    try {
      const f = await currentFix()
      setAddress((await api<{ address: string }>(`/places/reverse?lat=${f.lat}&lng=${f.lng}`)).address)
    } catch (e: any) { setErr(e.message) } finally { setBusy(null) }
  }
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy('save'); setErr(null)
    try {
      await api('/me', { method: 'PATCH', body: staff ? { address } : { name, address } })
      await refreshUser(() => api('/me'))
      toast.success('Profile saved'); onDone?.()
    } catch (x: any) { setErr(x.message) } finally { setBusy(null) }
  }
  return (
    <form onSubmit={save} className="grid gap-3">
      {!staff && <label className="grid gap-1.5 text-sm font-medium">Full name
        <input className="input" autoComplete="name" required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Asha Verma" /></label>}
      <label className="grid gap-1.5 text-sm font-medium">Address <span className="sr-only">optional</span>
        <textarea className="input h-20 resize-none py-2 font-normal" autoComplete="street-address" maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)}
          placeholder="House / street, area, city (optional)" /></label>
      <button type="button" onClick={locate} disabled={!!busy} className="btn-ghost justify-self-start px-2">
        {busy === 'locate' ? <Loader2 size={16} className="animate-spin" /> : <LocateFixed size={16} />}Use my current location</button>
      <p className="text-xs text-muted">Only you and municipal staff can see your name and address. Public pages never show them.</p>
      {err && <Notice>{err}</Notice>}
      <button disabled={!!busy || (!staff && name.trim().length < 2)} className="btn-primary">{busy === 'save' && <Loader2 size={16} className="animate-spin" />}{submitLabel}</button>
    </form>
  )
}
