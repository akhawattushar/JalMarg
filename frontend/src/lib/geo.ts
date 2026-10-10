import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'

export type Fix = { lat: number; lng: number; accuracy: number; at: number }
export type GeoState = { fix: Fix | null; error: string | null }

const toFix = (c: GeolocationCoordinates | { latitude: number; longitude: number; accuracy: number }): Fix =>
  ({ lat: c.latitude, lng: c.longitude, accuracy: Math.round(c.accuracy), at: Date.now() })

const INSECURE = 'Location needs a secure connection. Open JalMarg over https:// (or use the Android app).'
const reason = (e: any) => (e?.code === 1 || /denied/i.test(e?.message) ? 'Location permission is required. Allow location access in your settings.'
  : e?.code === 3 || /timeout/i.test(e?.message) ? 'Getting your location is taking too long. Retry outdoors with GPS enabled.'
    : 'Unable to get your location. Retry outdoors with GPS enabled.')

/** Browsers only expose geolocation on https:// or localhost; say so instead of failing silently. */
function unavailable() {
  if (Capacitor.isNativePlatform()) return null
  if (!window.isSecureContext) return INSECURE
  if (!('geolocation' in navigator)) return 'This browser cannot share your location.'
  return null
}

async function permitted() {
  if (!Capacitor.isNativePlatform()) return true
  const p = await Geolocation.requestPermissions().catch(() => null)
  return !p || p.location !== 'denied'
}

/**
 * Continuous high-accuracy GPS. With `quick`, a coarse network fix is shown first so the map can
 * centre immediately; precise fixes replace it as soon as GPS locks. Evidence screens leave `quick` off.
 */
export function useLocation(enabled = true, quick = false): GeoState {
  const [s, set] = useState<GeoState>({ fix: null, error: null })
  useEffect(() => {
    if (!enabled) return
    const blocked = unavailable()
    if (blocked) { set({ fix: null, error: blocked }); return }
    let id: string | null = null, dead = false, precise = false
    const opts = { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
    ;(async () => {
      if (!(await permitted())) throw { code: 1 }
      if (dead) return
      if (quick) Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 })
        .then((p) => { if (!dead && !precise) set({ fix: toFix(p.coords), error: null }) }).catch(() => null)
      const watch = await Geolocation.watchPosition(opts, (p, err) => {
        if (dead) return
        if (p) { precise = true; set({ fix: toFix(p.coords), error: null }) } else if (err) set((x) => ({ ...x, error: x.fix ? null : reason(err) }))
      })
      if (dead) Geolocation.clearWatch({ id: watch }); else id = watch
    })().catch((e) => { if (!dead) set((x) => ({ ...x, error: reason(e) })) })
    return () => { dead = true; if (id) Geolocation.clearWatch({ id }) }
  }, [enabled, quick])
  return s
}

export async function currentFix(): Promise<Fix> {
  const blocked = unavailable()
  if (blocked) throw new Error(blocked)
  try {
    if (!(await permitted())) throw { code: 1 }
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 })
    return toFix(p.coords)
  } catch (e) { throw new Error(reason(e)) }
}

export function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180, x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2
  return 12742000 * Math.asin(Math.sqrt(x))
}
