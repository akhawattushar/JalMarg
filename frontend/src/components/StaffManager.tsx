import { useCallback, useEffect, useState } from 'react'
import { Copy, KeyRound, Star, UserMinus, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from './Sheet'
import { Empty, Notice, Spinner } from './ui'
import { api } from '../lib/api'
import { ROLE_LABEL, useSession, type Role } from '../lib/auth'
import { ago } from '../lib/format'

type Staff = { id: string; employee_id: string | null; name: string | null; role: Role; ward: string | null; phone: string | null; status: string
  must_change_password: number; last_seen: number | null; completed: number; rating: number | null }
type Cred = { employee_id: string; temporary_password: string; name?: string }

/** Admins manage officers and workers; ward officers manage field workers. */
export default function StaffManager() {
  const s = useSession()!
  const isAdmin = s.user.role === 'admin'
  const [staff, setStaff] = useState<Staff[] | null>(null)
  const [cred, setCred] = useState<Cred | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Staff | null>(null)
  const load = useCallback(() => { api<Staff[]>('/staff').then(setStaff).catch((e) => toast.error(e.message)) }, [])
  useEffect(load, [load])
  const patch = (m: Staff, body: object, ok: string) => api(`/staff/${m.id}`, { method: 'PATCH', body }).then(() => { toast.success(ok); load() }).catch((e) => toast.error(e.message))

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{isAdmin ? 'Ward officers and field workers' : 'Your field workers'} sign in with an Employee ID issued here.</p>
        <button onClick={() => setAdding(true)} className="btn-navy"><UserPlus size={16} />{isAdmin ? 'Add staff member' : 'Add field worker'}</button>
      </div>
      {!staff ? <Spinner /> : !staff.length ? <div className="card"><Empty icon={<UserPlus size={20} />} title="No staff yet" text="Add field workers to assign and complete work orders." /></div> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-subtle text-left text-xs text-muted"><tr>{['Name', 'Employee ID', 'Role', 'Ward', 'Jobs done', 'Rating', 'Last sign-in', 'Status', ''].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{staff.map((m) => (
              <tr key={m.id} className="border-t border-line">
                <td className="px-4 py-2.5 font-medium">{m.name || m.phone || '—'}{m.must_change_password ? <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800 ring-1 ring-amber-200">Temp password</span> : null}</td>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">{m.employee_id || '—'}</td>
                <td className="px-4 py-2.5">{isAdmin ? <select aria-label="Role" className="input h-9 w-36" value={m.role} onChange={(e) => patch(m, { role: e.target.value }, 'Role updated')}>
                  <option value="worker">Field worker</option><option value="ward_officer">Ward officer</option></select> : ROLE_LABEL[m.role]}</td>
                <td className="px-4 py-2.5">{m.ward || '—'}</td>
                <td className="px-4 py-2.5 tabular-nums">{m.completed}</td>
                <td className="whitespace-nowrap px-4 py-2.5">{m.rating == null ? <span className="text-muted">—</span> : <span className="inline-flex items-center gap-1 font-medium"><Star size={14} className="fill-amber-400 text-amber-400" />{m.rating}</span>}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-muted">{ago(m.last_seen)}</td>
                <td className="px-4 py-2.5"><select aria-label="Status" className="input h-9 w-28" value={m.status} onChange={(e) => patch(m, { status: e.target.value }, 'Status updated')}>
                  <option value="active">Active</option><option value="blocked">Blocked</option></select></td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <button onClick={() => api<Cred>(`/staff/${m.id}/reset-password`, { body: {} }).then((c) => setCred({ ...c, name: m.name || '' })).catch((e) => toast.error(e.message))}
                    className="btn-outline h-8 px-3 text-xs"><KeyRound size={14} />Reset password</button>
                  <button aria-label={`Remove ${m.name}`} onClick={() => setRemoving(m)} className="btn-ghost ml-1 h-8 px-2 text-xs text-danger"><UserMinus size={15} />Remove</button>
                </td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      <AddStaff open={adding} admin={isAdmin} onClose={() => setAdding(false)} onCreated={(c) => { setAdding(false); setCred(c); load() }} />
      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Remove staff member">
        {removing && <div className="grid gap-3">
          <p className="text-sm">Remove <b>{removing.name}</b> ({removing.employee_id})? They can no longer sign in, and their open jobs return to the queue for reassignment. Their completed work stays on record.</p>
          <div className="grid grid-cols-2 gap-2"><button onClick={() => setRemoving(null)} className="btn-outline">Cancel</button>
            <button onClick={() => patch(removing, { status: 'removed' }, 'Staff member removed').then(() => setRemoving(null))} className="btn-danger">Remove</button></div>
        </div>}
      </Modal>
      <Modal open={!!cred} onClose={() => setCred(null)} title="Staff sign-in details">
        {cred && <div className="grid gap-3">
          <Notice tone="warn">Share these securely with {cred.name || 'the staff member'}. The temporary password is shown only once; they must change it at first sign-in.</Notice>
          {[['Employee ID', cred.employee_id], ['Temporary password', cred.temporary_password]].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
              <div className="min-w-0"><div className="text-xs text-muted">{k}</div><div className="truncate font-mono text-sm font-semibold">{v}</div></div>
              <button aria-label={`Copy ${k}`} onClick={() => navigator.clipboard?.writeText(v).then(() => toast.success('Copied'))} className="btn-ghost h-8 w-8 px-0"><Copy size={15} /></button>
            </div>))}
          <button onClick={() => setCred(null)} className="btn-navy">Done</button>
        </div>}
      </Modal>
    </>
  )
}

function AddStaff({ open, admin, onClose, onCreated }: { open: boolean; admin: boolean; onClose: () => void; onCreated: (c: Cred) => void }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<'worker' | 'ward_officer'>('worker')
  const [ward, setWard] = useState('')
  const [phone, setPhone] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    const digits = phone.replace(/\D/g, '')
    try {
      const c = await api<Cred>('/staff', { body: { name, role: admin ? role : 'worker', ward, phone: digits ? '+91' + digits.slice(-10) : null } })
      onCreated({ ...c, name }); setName(''); setWard(''); setPhone('')
    } catch (x: any) { setErr(x.message) }
  }
  return (
    <Modal open={open} onClose={onClose} title={admin ? 'Add staff member' : 'Add field worker'}>
      <form onSubmit={submit} className="grid gap-3">
        <label className="grid gap-1.5 text-sm font-medium">Full name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} /></label>
        {admin && <label className="grid gap-1.5 text-sm font-medium">Role<select className="input" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          <option value="worker">{ROLE_LABEL.worker} — completes work orders</option><option value="ward_officer">{ROLE_LABEL.ward_officer} — assigns and verifies work</option></select></label>}
        <label className="grid gap-1.5 text-sm font-medium">Ward<input className="input" placeholder={admin ? 'e.g. Ward 12' : 'Defaults to your ward'} value={ward} onChange={(e) => setWard(e.target.value)} maxLength={60} /></label>
        <label className="grid gap-1.5 text-sm font-medium">Mobile (optional)<input className="input" inputMode="numeric" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        {err && <Notice>{err}</Notice>}
        <button className="btn-navy">Create account</button>
        <p className="text-xs text-muted">An Employee ID and a one-time temporary password are generated.</p>
      </form>
    </Modal>
  )
}
