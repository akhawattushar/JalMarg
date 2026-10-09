import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { upload } from './api'

export type Pending = { id: string; created: number; fields: Record<string, string>; photo: string; error?: string }
const KEY = 'jm-pending'
const subs = new Set<() => void>()
let cache: Pending[] = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } })()

function save(list: Pending[]) {
  cache = list
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { toast.error('Not enough storage to keep the report offline') }
  subs.forEach((f) => f())
}
export const usePending = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => cache)
export const discard = (id: string) => save(cache.filter((p) => p.id !== id))

export async function keepOffline(photo: Blob, fields: Record<string, string>) {
  const dataUrl = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(photo) })
  save([...cache, { id: crypto.randomUUID(), created: Date.now(), fields, photo: dataUrl }].slice(-5))
}

export function formOf(photo: Blob, fields: Record<string, string>) {
  const f = new FormData()
  Object.entries(fields).forEach(([k, v]) => f.append(k, v))
  f.append('photo', photo, 'capture.jpg')
  return f
}

let running = false
export async function retryPending() {
  if (running || !cache.length || !navigator.onLine) return
  running = true
  for (const p of [...cache]) {
    try {
      await upload('/reports', formOf(await (await fetch(p.photo)).blob(), p.fields))
      discard(p.id)
      toast.success('Saved report uploaded')
    } catch (e: any) {
      if (e.status) save(cache.map((x) => (x.id === p.id ? { ...x, error: e.message } : x)))
    }
  }
  running = false
}
