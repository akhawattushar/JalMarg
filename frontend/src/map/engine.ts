import type { Config, Severity } from '../lib/api'
import { SEVERITY } from '../lib/format'

export type MapIncident = { id: string; lat: number; lng: number; severity: Severity; status: string }
export type MapLine = { id: string; coords: [number, number][]; kind: 'recommended' | 'alternative' }
export type Point = { lat: number; lng: number }
export type EngineOpts = { el: HTMLElement; center: Point; zoom: number; interactive: boolean; onSelect: (id: string) => void }

export interface Engine {
  setIncidents(list: MapIncident[], selected: string | null): void
  setLines(lines: MapLine[]): void
  setUser(p: Point | null): void
  setDest(p: Point | null): void
  flyTo(p: Point, zoom?: number): void
  fit(points: [number, number][], pad: { top: number; right: number; bottom: number; left: number }): void
  destroy(): void
}

export const markerColor = (i: MapIncident) => (i.status === 'active' ? SEVERITY[i.severity].color : '#16a34a')
export const markerSize = (i: MapIncident, sel: boolean) => (sel ? 26 : 12 + SEVERITY[i.severity].level * 3)
export const LINE = { recommended: '#0e7490', alternative: '#94a3b8' }

export function dot(i: MapIncident, sel: boolean) {
  const d = document.createElement('div'), s = markerSize(i, sel)
  d.style.cssText = `width:${s}px;height:${s}px;border-radius:50%;background:${markerColor(i)};border:${sel ? 4 : 2.5}px solid ${sel ? '#0b1f3a' : '#fff'};` +
    'box-shadow:0 1px 4px rgba(11,31,58,.45);cursor:pointer;transition:transform .15s'
  d.setAttribute('role', 'button')
  d.setAttribute('aria-label', `${SEVERITY[i.severity].label} ${i.status === 'active' ? 'waterlogging' : 'resolved'}`)
  return d
}

export function pin(kind: 'user' | 'dest') {
  const d = document.createElement('div')
  d.innerHTML = kind === 'user'
    ? '<div style="width:18px;height:18px;border-radius:50%;background:#0891b2;border:3px solid #fff;box-shadow:0 0 0 6px rgba(8,145,178,.2),0 1px 4px rgba(0,0,0,.4)"></div>'
    : '<svg width="28" height="36" viewBox="0 0 28 36"><path d="M14 35s12-11.4 12-20.5A12 12 0 0 0 2 14.5C2 23.6 14 35 14 35z" fill="#0b1f3a" stroke="#fff" stroke-width="2"/><circle cx="14" cy="14" r="4.5" fill="#fff"/></svg>'
  return d
}

/** Google when configured; otherwise (or if Google fails to load) the open-source MapLibre + OpenStreetMap engine. */
export async function createEngine(cfg: Config | null, o: EngineOpts): Promise<Engine> {
  if (cfg?.map_provider === 'google' && cfg.google_maps_key) {
    try { return await (await import('./google')).createGoogle(cfg, o) } catch (e) { console.warn('Google Maps unavailable, using OpenStreetMap', e) }
  }
  return (await import('./libre')).createLibre(o)
}
