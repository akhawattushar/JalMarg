import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'

export type Fix = { lat: number; lng: number; accuracy: number; at: number }
export type GeoState = { fix: Fix | null; error: string | null }

const toFix = (c: GeolocationCoordinates | { latitude: number; longitude: number; accuracy: number }): Fix =>
  ({ lat: c.latitude, lng: c.longitude, accuracy: Math.round(c.accuracy), at: Date.now() })

const reason = (e: any) => (e?.code === 1 || /denied/i.test(e?.message) ? 'Location permission is required. Allow location access in your settings.'
  : 'Unable to get your location. Retry outdoors with GPS enabled.')

/** Continuous high-accuracy GPS. */
export function useLocation(enabled = true): GeoState {
  const [s, set] = useState<GeoState>({ fix: null, error: null })
  useEffect(() => {
    if (!enabled) return
    let id: string | null = null, dead = false
    const opts = { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
    ;(async () => {
      if (Capacitor.isNativePlatform()) await Geolocation.requestPermissions().catch(() => null)
      id = await Geolocation.watchPosition(opts, (p, err) => {
        if (dead) return
        if (p) set({ fix: toFix(p.coords), error: null }); else if (err) set((x) => ({ ...x, error: reason(err) }))
      })
    })().catch((e) => set((x) => ({ ...x, error: reason(e) })))
    return () => { dead = true; if (id) Geolocation.clearWatch({ id }) }
  }, [enabled])
  return s
}

export async function currentFix(): Promise<Fix> {
  try {
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 })
    return toFix(p.coords)
  } catch (e) { throw new Error(reason(e)) }
}

export function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180, x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2
  return 12742000 * Math.asin(Math.sqrt(x))
}
