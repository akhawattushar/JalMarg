import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { LINE, markerColor, markerSize, pin, type Engine, type EngineOpts } from './engine'

const STYLE = 'https://tiles.openfreemap.org/styles/positron'
const BLANK = { version: 8 as const, sources: {}, layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#eef2f6' } }] }
const fc = (features: object[]) => ({ type: 'FeatureCollection', features }) as never

export function createLibre(o: EngineOpts): Promise<Engine> {
  const map = new maplibregl.Map({ container: o.el, style: STYLE, center: [o.center.lng, o.center.lat], zoom: o.zoom, interactive: o.interactive,
    attributionControl: false, dragRotate: false, pitchWithRotate: false })
  map.touchZoomRotate.disableRotation()
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '© OpenStreetMap contributors' }), 'bottom-right')
  if (o.interactive && matchMedia('(min-width:1024px)').matches) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
  let user: maplibregl.Marker | null = null, dest: maplibregl.Marker | null = null
  const place = (old: maplibregl.Marker | null, p: { lat: number; lng: number } | null, kind: 'user' | 'dest') => {
    old?.remove()
    return p ? new maplibregl.Marker({ element: pin(kind), anchor: kind === 'user' ? 'center' : 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map) : null
  }
  const engine: Engine = {
    setIncidents(list, selected) {
      ;(map.getSource('inc') as maplibregl.GeoJSONSource)?.setData(fc(list.map((i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [i.lng, i.lat] },
        properties: { id: i.id, color: markerColor(i), r: markerSize(i, i.id === selected) / 2, sel: i.id === selected } }))))
    },
    setLines(lines) {
      ;(map.getSource('lines') as maplibregl.GeoJSONSource)?.setData(fc(lines.map((l) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: l.coords },
        properties: { color: LINE[l.kind], w: l.kind === 'recommended' ? 6 : 4, z: l.kind === 'recommended' ? 1 : 0 } }))))
    },
    setUser(p) { user = place(user, p, 'user') },
    setDest(p) { dest = place(dest, p, 'dest') },
    flyTo(p, zoom) { map.easeTo({ center: [p.lng, p.lat], zoom: zoom ?? map.getZoom(), duration: 600 }) },
    fit(points, pad) {
      const b = new maplibregl.LngLatBounds()
      points.forEach((p) => b.extend(p))
      map.fitBounds(b, { padding: pad, maxZoom: 16, duration: 600 })
    },
    destroy() { map.remove() },
  }
  return new Promise((ok) => {
    let done = false
    const init = () => {
      if (done) return
      done = true
      map.addSource('lines', { type: 'geojson', data: fc([]) })
      map.addSource('inc', { type: 'geojson', data: fc([]), cluster: true, clusterRadius: 44, clusterMaxZoom: 15 })
      map.addLayer({ id: 'lines', type: 'line', source: 'lines', layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'z'] },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'] } })
      map.addLayer({ id: 'clusters', type: 'circle', source: 'inc', filter: ['has', 'point_count'],
        paint: { 'circle-color': '#0b1f3a', 'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 24], 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } })
      if (map.getStyle().glyphs) map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'inc', filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#fff' } })
      map.addLayer({ id: 'points', type: 'circle', source: 'inc', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['get', 'r'], 'circle-stroke-width': ['case', ['get', 'sel'], 4, 2.5],
          'circle-stroke-color': ['case', ['get', 'sel'], '#0b1f3a', '#ffffff'] } })
      map.on('click', 'points', (e) => { const id = e.features?.[0]?.properties?.id; if (id) o.onSelect(id) })
      map.on('click', 'clusters', async (e) => {
        const f = e.features![0], src = map.getSource('inc') as maplibregl.GeoJSONSource
        map.easeTo({ center: (f.geometry as any).coordinates, zoom: await src.getClusterExpansionZoom(f.properties!.cluster_id) })
      })
      for (const l of ['points', 'clusters']) {
        map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', l, () => { map.getCanvas().style.cursor = '' })
      }
      ok(engine)
    }
    map.once('style.load', init)
    const fallback = () => { if (!done) { map.setStyle(BLANK); map.once('style.load', init) } }
    map.on('error', fallback)
    setTimeout(fallback, 6000)
  })
}
