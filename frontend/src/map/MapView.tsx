import { useEffect, useRef, useState } from 'react'
import { getConfig } from '../lib/api'
import { createEngine, type Engine, type MapIncident, type MapLine, type Point } from './engine'

type Props = {
  center: Point; zoom?: number; incidents?: MapIncident[]; selected?: string | null; onSelect?: (id: string) => void
  lines?: MapLine[]; user?: Point | null; dest?: Point | null; focus?: Point | null; fit?: [number, number][] | null
  padding?: { top: number; right: number; bottom: number; left: number }; interactive?: boolean
}

export default function MapView({ center, zoom = 13, incidents = [], selected = null, onSelect, lines = [], user = null, dest = null, focus, fit, padding, interactive = true }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<Engine | null>(null)
  const [error, setError] = useState(false)
  const select = useRef(onSelect)
  select.current = onSelect

  useEffect(() => {
    let e: Engine | null = null, dead = false
    // The map still renders (OpenStreetMap) when /config is unreachable.
    getConfig().catch(() => null).then((cfg) => createEngine(cfg, { el: el.current!, center, zoom, interactive, onSelect: (id) => select.current?.(id) }))
      .then((x) => { if (dead) x.destroy(); else { e = x; setEngine(x) } }).catch(() => setError(true))
    return () => { dead = true; e?.destroy() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { engine?.setIncidents(incidents, selected) }, [engine, incidents, selected])
  useEffect(() => { engine?.setLines(lines) }, [engine, lines])
  useEffect(() => { engine?.setUser(user) }, [engine, user?.lat, user?.lng]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { engine?.setDest(dest) }, [engine, dest?.lat, dest?.lng]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focus) engine?.flyTo(focus, 15) }, [engine, focus?.lat, focus?.lng]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (fit?.length) engine?.fit(fit, padding || { top: 48, right: 48, bottom: 48, left: 48 }) }, [engine, fit]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="absolute inset-0 bg-[#eef2f6]">
      <div ref={el} className="h-full w-full" />
      {error && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted">Map is unavailable right now. Check your connection.</div>}
    </div>
  )
}
