import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, ClipboardList, CloudOff, HardHat, LogOut, Navigation, Shield, Trash2, Users } from 'lucide-react'
import PasswordForm from '../components/PasswordForm'
import ProfileForm from '../components/ProfileForm'
import { Page, Row, Section } from '../components/ui'
import { logout } from '../lib/api'
import { can, displayName, ROLE_LABEL, useSession } from '../lib/auth'
import { ago } from '../lib/format'
import { discard, retryPending, usePending } from '../lib/queue'

const Item = ({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) => (
  <Link to={to} className="flex h-12 items-center gap-3 border-b border-line px-4 text-sm font-medium last:border-0 hover:bg-subtle">{icon}<span className="flex-1">{label}</span><ChevronRight size={16} className="text-faint" /></Link>
)

export default function Account() {
  const s = useSession(), pending = usePending(), u = s?.user, nav = useNavigate()
  return (
    <Page title="Account" width="max-w-2xl">
      <div className="grid gap-4">
        <div className="card flex items-center justify-between gap-3 p-4">
          <div className="min-w-0"><div className="truncate font-semibold">{u ? displayName(u) : 'Guest'}</div><div className="text-sm text-muted">{u ? ROLE_LABEL[u.role] : 'Sign in to report and confirm incidents'}</div></div>
          {s ? <button onClick={() => { logout(); nav('/login', { replace: true }) }} className="btn-outline"><LogOut size={16} />Sign out</button> : <Link to="/login?next=/account" className="btn-primary">Sign in</Link>}
        </div>
        {u && <Section title="Profile">
          {u.employee_id && <Row k="Employee ID" v={u.employee_id} />}
          {u.employee_id && <Row k="Name" v={u.name} />}
          {u.ward && <Row k="Ward" v={u.ward} />}
          {u.email && <Row k="Email" v={u.email} />}
          {u.phone && <Row k="Mobile" v={u.phone} />}
          <Row k="Role" v={ROLE_LABEL[u.role]} />
          <div className="mt-4 border-t border-line pt-4"><ProfileForm user={u} /></div>
        </Section>}
        {!!pending.length && (
          <Section title="Waiting to upload" action={<button onClick={() => retryPending()} className="btn-ghost h-8">Retry all</button>}>
            <ul className="grid gap-2">{pending.map((p) => (
              <li key={p.id} className="flex items-center gap-3 text-sm"><CloudOff size={16} className="shrink-0 text-amber-700" />
                <span className="min-w-0 flex-1"><span className="block">Report captured {ago(p.created / 1000)}</span>{p.error && <span className="block text-xs text-danger">{p.error}</span>}</span>
                <button aria-label="Discard saved report" onClick={() => discard(p.id)} className="text-faint hover:text-danger"><Trash2 size={15} /></button></li>))}</ul>
          </Section>
        )}
        <div className="card overflow-hidden">
          <Item to="/route" icon={<Navigation size={18} className="text-muted" />} label="Safe route" />
          {can(s, 'worker') && <Item to="/work" icon={<HardHat size={18} className="text-muted" />} label="Work orders" />}
          {can(s, 'ward_officer') && <Item to="/ward" icon={<ClipboardList size={18} className="text-muted" />} label="Ward dashboard" />}
          {u?.role === 'ward_officer' && <Item to="/team" icon={<Users size={18} className="text-muted" />} label="Field team" />}
          {can(s, 'admin') && <Item to="/admin" icon={<Shield size={18} className="text-muted" />} label="Admin" />}
        </div>
        {u && u.role !== 'admin' && <Section title={u.has_password ? 'Change password' : 'Set a password'}>
          {!u.has_password && <p className="mb-3 text-sm text-muted">Optional. Lets you sign in with your email and a password as well as with Google.</p>}
          <PasswordForm user={u} />
        </Section>}
        <Section title="Privacy">
          <p className="text-sm leading-relaxed text-muted">Precise location is collected only with a report or confirmation, for verification, road matching, duplicate detection and municipal response. Your email address is never shown publicly. Original photos are visible only to municipal staff; the public sees the watermarked evidence image.</p>
        </Section>
      </div>
    </Page>
  )
}
