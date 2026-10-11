import { getToken, signOut } from './auth'

export const API = ((import.meta.env.VITE_API_URL as string) || 'http://localhost:8000').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: any) { super(message) }
}

const message = (d: any, status: number) =>
  typeof d?.detail === 'string' ? d.detail : typeof d?.detail?.message === 'string' ? d.detail.message : Array.isArray(d?.detail) ? d.detail.map((x: any) => x.msg).join(', ') : status === 0 ? 'No internet connection' : `Request failed (${status})`

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(API + path, { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined })
  } catch { throw new ApiError(0, 'No internet connection') }
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && token) signOut()
  if (!res.ok) throw new ApiError(res.status, message(data, res.status), data)
  return data
}

/** Multipart upload with progress. Rejects with status 0 when offline. */
export function upload<T = any>(path: string, form: FormData, onProgress?: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('POST', API + path)
    const token = getToken()
    if (token) x.setRequestHeader('Authorization', `Bearer ${token}`)
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100))
    x.onerror = () => reject(new ApiError(0, 'No internet connection'))
    x.onload = () => {
      let d: any = {}
      try { d = JSON.parse(x.responseText) } catch { /* empty body */ }
      if (x.status === 401 && token) signOut()
      x.status < 300 ? resolve(d) : reject(new ApiError(x.status, message(d, x.status), d))
    }
    x.send(form)
  })
}

// Private files come back from the API as short-lived signed URLs, so no session token is ever put in a URL.
export const fileUrl = (p?: string | null) => (p ? API + p : '')

/** Ends the session on the server too, so a copied token stops working. */
export function logout() {
  const token = getToken()
  signOut()
  if (token) fetch(API + '/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => null)
}

export type AuthResult = { token: string; user: import('./auth').User }

export type Config = {
  map_provider: 'google' | 'osm'; map_attribution: string; weather_provider: string; google_maps_key: string; google_map_id: string
  max_gps_accuracy_m: number; problem_types: string[]; severities: string[]
}
let cfg: Promise<Config> | null = null
export const getConfig = () => (cfg ??= api<Config>('/config').catch((e) => { cfg = null; throw e }))

export type Incident = {
  id: string; road_name: string | null; locality: string | null; address: string | null; lat: number; lng: number
  problem_type: string; severity: Severity; status: string; verification: Verification; created_at: number; last_observed_at: number
  confirmation_count: number; clear_count: number; resolved_at: number | null; reopened_count: number; work_status: string | null
  critical: { name: string; type: string; distance_m: number }[]; distance_m?: number
}
export type Severity = 'ankle' | 'knee' | 'waist' | 'impassable'
export type Verification = 'verified' | 'likely' | 'needs_review' | 'suspicious' | 'rejected'
export type Signal = { key: string; label: string; status: 'pass' | 'warn' | 'fail' | 'unavailable' | 'info' }
export type Weather = {
  available: boolean; provider: string; current?: { condition?: string; temp_c?: number; feels_c?: number; humidity?: number; precip_mm?: number; wind_kmh?: number; pressure_hpa?: number; cloud_pct?: number }
  hourly?: { time: string; precip_mm: number; probability: number | null }[]; past_6h_mm?: number; next_6h_mm?: number; next_12h_mm?: number
  max_probability?: number; rain_window?: [string, string] | null; alerts?: { title: string; severity: string; until?: string }[]
}
export type Risk = { level: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE'; score: number; factors: string[]; weather_available: boolean; statement: string }
