import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
import StaffManager from '../components/StaffManager'
import { Empty, Page } from '../components/ui'
import { can, useSession } from '../lib/auth'

export default function Team() {
  const s = useSession()
  if (!can(s, 'ward_officer')) return <Page title="Team"><div className="card"><Empty icon={<Users size={20} />} title="Ward officers only" action={<Link to="/login?next=/team" className="btn-primary">Sign in</Link>} /></div></Page>
  return <Page title="Field team" subtitle="Add, block or remove the field workers you assign" width="max-w-6xl"><StaffManager /></Page>
}
