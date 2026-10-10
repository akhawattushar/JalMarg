import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Bell, Camera, ClipboardList, HardHat, Map, Navigation, Shield, UserRound, Users } from 'lucide-react'
import { Logo, Spinner } from './components/ui'
import PasswordForm from './components/PasswordForm'
import ProfileForm from './components/ProfileForm'
import { api, logout } from './lib/api'
import { can, canReport, displayName, HOME, isGuest, refreshUser, ROLE_LABEL, useSession } from './lib/auth'
import MapPage from './pages/MapPage'

const Report = lazy(() => import('./pages/Report'))
const Incident = lazy(() => import('./pages/Incident'))
const RoutePage = lazy(() => import('./pages/RoutePage'))
const Alerts = lazy(() => import('./pages/Alerts'))
const Ward = lazy(() => import('./pages/Ward'))
const Work = lazy(() => import('./pages/Work'))
const Team = lazy(() => import('./pages/Team'))
const Admin = lazy(() => import('./pages/Admin'))
const Login = lazy(() => import('./pages/Login'))
const AuthPages = lazy(() => import('./pages/AuthPages'))
const Account = lazy(() => import('./pages/Account'))

const PUBLIC = ['/login', '/forgot-password', '/reset-password', '/verify-email', '/auth/callback']

function useNav() {
  const s = useSession(), staff = can(s, 'worker')
  const map = { to: '/', icon: Map, label: 'Live map', short: 'Map' }
  const work = { to: '/work', icon: HardHat, label: 'Work orders', short: 'Work' }
  const ward = { to: '/ward', icon: ClipboardList, label: 'Ward dashboard', short: 'Ward' }
  return [
    ...(can(s, 'ward_officer') ? [ward, work] : staff ? [work] : []), map,
    ...(staff ? [] : [{ to: '/route', icon: Navigation, label: 'Safe route', short: 'Route' }]),
    { to: '/alerts', icon: Bell, label: 'Alerts', short: 'Alerts' },
    ...(s?.user.role === 'ward_officer' ? [{ to: '/team', icon: Users, label: 'Field team', short: 'Team' }] : []),
    ...(can(s, 'admin') ? [{ to: '/admin', icon: Shield, label: 'Admin', short: 'Admin' }] : []),
  ]
}

function Sidebar() {
  const s = useSession(), items = useNav()
  const link = ({ isActive }: { isActive: boolean }) => `flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium ${isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-navy lg:flex">
      <Link to={s ? HOME[s.user.role] : '/'} aria-label="JalMarg home" className="flex h-14 items-center px-5"><Logo dark /></Link>
      {canReport(s) && <div className="px-3 py-2"><NavLink to="/report" className="btn-danger w-full"><Camera size={17} /> Report waterlogging</NavLink></div>}
      <nav className="mt-2 grid gap-0.5 px-3">
        {items.map(({ to, icon: I, label }) => <NavLink key={to} to={to} end={to === '/'} className={link}><I size={18} />{label}</NavLink>)}
      </nav>
      <NavLink to="/account" className="mt-auto flex items-center gap-3 border-t border-white/10 px-5 py-4 text-slate-300 hover:bg-white/5">
        <UserRound size={18} />
        <span className="min-w-0 text-sm"><span className="block truncate font-medium text-white">{s ? displayName(s.user) : 'Guest'}</span>
          <span className="block truncate text-xs">{s ? ROLE_LABEL[s.user.role] : 'Sign in to report'}</span></span>
      </NavLink>
    </aside>
  )
}

function Tabs() {
  const s = useSession(), items = useNav()
  const tabs = [items[0], items[1], ...(canReport(s) ? [{ to: '/report', icon: Camera, short: 'Report', label: '' }] : []), items.find((i) => i.to === '/alerts')!,
    { to: '/account', icon: UserRound, short: 'Account', label: '' }].filter((t, i, a) => a.findIndex((x) => x.to === t.to) === i)
  return (
    <nav style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} className="grid shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      {tabs.map(({ to, icon: I, short }) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${isActive ? 'text-accent' : 'text-muted'}`}>
          {to === '/report' ? <span className="grid h-9 w-12 place-items-center rounded-md bg-danger text-white"><I size={19} /></span> : <><I size={20} /><span className="truncate">{short}</span></>}
        </NavLink>
      ))}
    </nav>
  )
}

function MustChangePassword() {
  const s = useSession()!
  return (
    <div className="grid h-dvh place-items-center overflow-y-auto bg-bg p-5">
      <div className="card w-full max-w-md p-6">
        <Logo />
        <h1 className="mt-5 text-xl font-semibold">Set your password</h1>
        <p className="mt-1 text-sm text-muted">Welcome, {displayName(s.user)}{s.user.employee_id ? ` (${s.user.employee_id})` : ''}. Replace the temporary password from your administrator before continuing.</p>
        <div className="mt-5"><PasswordForm user={s.user} /></div>
        <button onClick={() => { logout(); location.assign('/login') }} className="btn-ghost mt-2 w-full">Sign out</button>
      </div>
    </div>
  )
}

function CompleteProfile() {
  const s = useSession()!
  return (
    <div className="grid h-dvh place-items-center overflow-y-auto bg-bg p-5">
      <div className="card w-full max-w-md p-6">
        <Logo />
        <h1 className="mt-5 text-xl font-semibold">Complete your profile</h1>
        <p className="mt-1 text-sm text-muted">Signed in as {s.user.email}. Your name helps municipal staff follow up on your reports.</p>
        <div className="mt-5"><ProfileForm user={s.user} submitLabel="Continue" /></div>
      </div>
    </div>
  )
}

function Shell() {
  const { pathname } = useLocation()
  const s = useSession()
  useEffect(() => { refreshUser(() => api('/me')) }, [pathname])
  const open = PUBLIC.includes(pathname)
  if (!s && !isGuest() && !open) return <Navigate to={`/login${pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`}`} replace />
  if (s?.user.must_change_password && !open) return <MustChangePassword />
  if (s && !s.user.name && !s.user.employee_id && !open) return <CompleteProfile />
  if (pathname === '/report' && !canReport(s)) return <Navigate to={HOME[s!.user.role]} replace />
  const bare = open || pathname === '/report'
  return (
    <div className="flex h-dvh w-full overflow-hidden">
      {!bare && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="/" element={<MapPage />} />
              <Route path="/report" element={<Report />} />
              <Route path="/incidents/:id" element={<Incident />} />
              <Route path="/route" element={<RoutePage />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/ward" element={<Ward />} />
              <Route path="/work" element={<Work />} />
              <Route path="/team" element={<Team />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<AuthPages kind="forgot" />} />
              <Route path="/reset-password" element={<AuthPages kind="reset" />} />
              <Route path="/verify-email" element={<AuthPages kind="verify" />} />
              <Route path="/auth/callback" element={<AuthPages kind="google" />} />
              <Route path="/account" element={<Account />} />
              <Route path="*" element={<MapPage />} />
            </Routes>
          </Suspense>
        </main>
        {!bare && <Tabs />}
      </div>
      <Toaster position="top-center" richColors closeButton />
    </div>
  )
}

export default function App() {
  return <BrowserRouter><Shell /></BrowserRouter>
}
