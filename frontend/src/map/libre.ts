import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre builds its worker URL at runtime, so bundlers never emit the file and production maps stay blank.
// Bundle it explicitly (as a .js asset, which static hosts serve with the right MIME type) and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { LINE, markerColor, markerSize, pin, type Engine, type EngineOpts } from './engine'

maplibregl.setWorkerUrl(workerUrl)

const STYLE = 'https://tiles.openfreemap.org/styles/positron'
// Fallback when the vector style can't load: standard OSM raster tiles (no labels on clusters, but a real map).
const RASTER = {
  version: 8 as const,
  sources: { osm: { type: 'raster' as const, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#eef2f6' } }, { id: 'osm', type: 'raster' as const, source: 'osm' }],
}
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
    let fellBack = false
    map.once('style.load', init)
    // Only a failure of the style itself (not a single tile) should switch styles; slow mobile networks get 15 s.
    const fallback = () => { if (!done && !fellBack) { fellBack = true; map.setStyle(RASTER); map.once('style.load', init) } }
    map.on('error', (e) => { if (!map.isStyleLoaded()) { console.warn('map style failed, using raster tiles', e.error); fallback() } })
    setTimeout(fallback, 15000)
  })
}
