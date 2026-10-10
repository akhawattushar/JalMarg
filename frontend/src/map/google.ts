import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { MarkerClusterer } from '@googlemaps/markerclusterer'
import type { Config } from '../lib/api'
import { dot, LINE, pin, type Engine, type EngineOpts, type MapIncident } from './engine'

let configured = false

export async function createGoogle(cfg: Config, o: EngineOpts): Promise<Engine> {
  if (!configured) { setOptions({ key: cfg.google_maps_key, v: 'weekly' }); configured = true }
  const [{ Map, Polyline }, { AdvancedMarkerElement }] = await Promise.all([importLibrary('maps'), importLibrary('marker')])
  const map = new Map(o.el, {
    center: o.center, zoom: o.zoom, mapId: cfg.google_map_id || 'DEMO_MAP_ID', disableDefaultUI: true, clickableIcons: false,
    zoomControl: o.interactive && matchMedia('(min-width:1024px)').matches, gestureHandling: o.interactive ? 'greedy' : 'none', keyboardShortcuts: o.interactive,
  })
  const clusterer = new MarkerClusterer({
    map, renderer: {
      render: ({ count, position }) => {
        const d = document.createElement('div')
        d.textContent = String(count)
        d.style.cssText = 'min-width:34px;height:34px;padding:0 8px;border-radius:17px;background:#0b1f3a;color:#fff;font:600 13px/34px Inter,sans-serif;text-align:center;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.35)'
        return new AdvancedMarkerElement({ position, content: d, zIndex: 1000 + count })
      },
    },
  })
  type M = google.maps.marker.AdvancedMarkerElement | null
  let lines: google.maps.Polyline[] = [], user: M = null, dest: M = null
  const place = (old: M, p: { lat: number; lng: number } | null, kind: 'user' | 'dest'): M => {
    if (old) old.map = null
    return p ? new AdvancedMarkerElement({ map, position: p, content: pin(kind), zIndex: 2000 }) : null
  }
  return {
    setIncidents(list: MapIncident[], selected) {
      clusterer.clearMarkers()
      clusterer.addMarkers(list.map((i) => {
        const m = new AdvancedMarkerElement({ position: i, content: dot(i, i.id === selected), zIndex: i.id === selected ? 999 : 1, gmpClickable: true })
        m.addListener('gmp-click', () => o.onSelect(i.id))
        return m
      }))
    },
    setLines(next) {
      lines.forEach((l) => l.setMap(null))
      lines = next.map((l) => new Polyline({ map, path: l.coords.map(([lng, lat]) => ({ lat, lng })), strokeColor: LINE[l.kind],
        strokeOpacity: l.kind === 'recommended' ? 1 : 0.8, strokeWeight: l.kind === 'recommended' ? 6 : 4, zIndex: l.kind === 'recommended' ? 2 : 1 }))
    },
    setUser(p) { user = place(user, p, 'user') },
    setDest(p) { dest = place(dest, p, 'dest') },
    flyTo(p, zoom) { map.panTo(p); if (zoom) map.setZoom(zoom) },
    fit(points, pad) {
      const b = new google.maps.LatLngBounds()
      points.forEach(([lng, lat]) => b.extend({ lat, lng }))
      map.fitBounds(b, pad)
    },
    destroy() { clusterer.clearMarkers(); clusterer.setMap(null); lines.forEach((l) => l.setMap(null)); if (user) user.map = null; if (dest) dest.map = null },
  }
}
