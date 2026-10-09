import { CloudRain, Droplets, ThermometerSun, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Incident, Risk, Weather } from '../lib/api'
import { ago, dist, hour, PROBLEM, temp, WORK } from '../lib/format'
import { RiskBadge, SeverityTag, VerificationBadge } from './ui'

export function WeatherStrip({ wx, risk }: { wx: Weather | null; risk: Risk | null }) {
  if (!wx) return null
  if (!wx.available) return <div className="flex items-center gap-2 text-sm text-muted"><CloudRain size={16} />Weather data is temporarily unavailable.</div>
  const c = wx.current!
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <span className="flex items-center gap-1.5 font-medium" title={`Source: ${wx.provider}`}><ThermometerSun size={16} className="text-muted" />{temp(c.temp_c)} {c.condition}</span>
      <span className="flex items-center gap-1.5 text-muted"><Droplets size={16} />{wx.next_6h_mm} mm next 6 h</span>
      {risk && <RiskBadge level={risk.level} />}
    </div>
  )
}

export function WeatherDetail({ wx }: { wx: Weather | null }) {
  if (!wx) return null
  if (!wx.available) return <p className="text-sm text-muted">Weather data is temporarily unavailable.</p>
  const c = wx.current!, max = Math.max(1, ...wx.hourly!.map((h) => h.precip_mm))
  return (
    <div className="grid gap-4">
      {wx.alerts?.map((a) => <div key={a.title} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">{a.title}</div>)}
      <dl className="grid grid-cols-3 gap-3 text-sm sm:grid-cols-6">
        {[['Now', c.condition], ['Temp', temp(c.temp_c)], ['Feels like', temp(c.feels_c)], ['Rain, last 6 h', `${wx.past_6h_mm} mm`],
          ['Rain, next 6 h', `${wx.next_6h_mm} mm`], ['Humidity', c.humidity != null ? `${c.humidity}%` : '—']].map(([k, v]) => (
          <div key={k} className="min-w-0"><dt className="truncate text-xs text-muted">{k}</dt><dd className="truncate font-semibold">{v ?? '—'}</dd></div>
        ))}
      </dl>
      <div>
        <div className="mb-2 flex justify-between text-xs text-muted"><span>Hourly rainfall (mm)</span><span>{wx.provider}</span></div>
        <div className="flex h-20 items-end gap-1" role="img" aria-label="Hourly rainfall forecast">
          {wx.hourly!.map((h) => (
            <div key={h.time} className="group relative flex h-full flex-1 flex-col justify-end" title={`${hour(h.time)}: ${h.precip_mm} mm${h.probability != null ? `, ${h.probability}%` : ''}`}>
              <div className="rounded-t-[3px] bg-accent/80 group-hover:bg-accent" style={{ height: `${Math.max(2, (h.precip_mm / max) * 100)}%`, opacity: h.precip_mm ? 1 : 0.25 }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-faint"><span>{hour(wx.hourly![0].time)}</span><span>{hour(wx.hourly![wx.hourly!.length - 1].time)}</span></div>
      </div>
    </div>
  )
}

export function RiskDetail({ risk }: { risk: Risk | null }) {
  if (!risk) return null
  return (
    <div className="grid gap-3 text-sm">
      <div className="flex items-center gap-3"><RiskBadge level={risk.level} /><span className="text-muted">Score {risk.score}/100 · rule-based estimate</span></div>
      <p>{risk.statement}</p>
      <ul className="grid gap-1.5 text-muted">{risk.factors.map((f) => <li key={f} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-faint" />{f}</li>)}</ul>
    </div>
  )
}

export function IncidentRow({ i, active, onClick }: { i: Incident; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left last:border-0 ${active ? 'bg-accent-soft' : 'hover:bg-subtle'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold">{i.road_name || 'Unnamed road'}</span>
          {i.distance_m != null && <span className="shrink-0 text-xs text-muted">{dist(i.distance_m)}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <SeverityTag s={i.severity} resolved={i.status !== 'active'} />
          <span className="flex items-center gap-1 text-xs text-muted"><Users size={12} />{i.confirmation_count}</span>
          <span className="text-xs text-muted">{ago(i.last_observed_at)}</span>
        </div>
      </div>
    </button>
  )
}

export function IncidentSummary({ i, onClose }: { i: Incident; onClose?: () => void }) {
  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{i.road_name || 'Unnamed road'}</div>
          <div className="truncate text-xs text-muted">{PROBLEM[i.problem_type]}{i.locality ? ` · ${i.locality}` : ''}{i.distance_m != null ? ` · ${dist(i.distance_m)} away` : ''}</div>
        </div>
        <VerificationBadge v={i.verification} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
        <SeverityTag s={i.severity} resolved={i.status !== 'active'} />
        <span>Confirmed by {i.confirmation_count} {i.confirmation_count === 1 ? 'person' : 'people'}</span>
        <span>Last observed {ago(i.last_observed_at)}</span>
        {i.work_status && <span className="font-medium text-navy">{WORK[i.work_status]}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {onClose ? <button onClick={onClose} className="btn-outline">Close</button> : <span />}
        <Link to={`/incidents/${i.id}`} className="btn-navy">View incident</Link>
      </div>
    </div>
  )
}
