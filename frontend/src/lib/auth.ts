import { useSyncExternalStore } from 'react'

export type Role = 'citizen' | 'commuter' | 'worker' | 'ward_officer' | 'admin'
export type User = { id: string; phone: string | null; role: Role; name: string | null; employee_id: string | null; ward: string | null; address: string | null; must_change_password: boolean; has_password: boolean }
export type Session = { token: string; exp: number; user: User }

const KEY = 'jm-session'
const read = (): Session | null => { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && s.exp > Date.now() ? s : null } catch { return null } }
let current = read()
const subs = new Set<() => void>()

export function setSession(s: Session | null) {
  current = s
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY) } catch { /* storage unavailable */ }
  subs.forEach((f) => f())
}
export const signOut = () => { setGuest(false); setSession(null) }
export const getToken = () => current?.token
export const useSession = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => current)

const LEVEL: Record<Role, number> = { citizen: 0, commuter: 0, worker: 1, ward_officer: 2, admin: 3 }
export const can = (s: Session | null, role: 'worker' | 'ward_officer' | 'admin') =>
  !!s && (role === 'worker' ? LEVEL[s.user.role] >= 1 : role === 'ward_officer' ? LEVEL[s.user.role] >= 2 : s.user.role === 'admin')

/** Pull the latest role from the server so staff changes apply without re-login. */
export async function refreshUser(fetchMe: () => Promise<Session['user']>) {
  if (!current) return
  try { const user = await fetchMe(); if (current && JSON.stringify(user) !== JSON.stringify(current.user)) setSession({ ...current, user }) } catch { /* offline: keep cached profile */ }
}

export const HOME: Record<Role, string> = { citizen: '/', commuter: '/', worker: '/work', ward_officer: '/ward', admin: '/admin' }
export const ROLE_LABEL: Record<Role, string> = { citizen: 'Citizen', commuter: 'Commuter', worker: 'Municipal worker', ward_officer: 'Ward officer', admin: 'Administrator' }
export const displayName = (u: User) => u.name || u.phone || u.employee_id || 'Account'

export const isGuest = () => { try { return sessionStorage.getItem('jm-guest') === '1' } catch { return false } }
export const setGuest = (on: boolean) => { try { on ? sessionStorage.setItem('jm-guest', '1') : sessionStorage.removeItem('jm-guest') } catch { /* storage unavailable */ } }
export const canReport = (s: Session | null) => !s || !['worker', 'ward_officer'].includes(s.user.role)
