import { useEffect, useRef, useState } from 'react'
import { Camera as CamIcon, MapPin, X } from 'lucide-react'
import { isNative, nativeCapture, toJpeg } from '../lib/camera'
import type { Fix } from '../lib/geo'

/** Full-screen live camera with GPS accuracy readout. Returns a fresh JPEG and the fix taken at the shutter. */
export default function Camera({ fix, geoError, maxAccuracy, title, onShot, onClose }: {
  fix: Fix | null; geoError: string | null; maxAccuracy: number; title: string; onShot: (photo: Blob, fix: Fix, at: number) => void; onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const precise = !!fix && fix.accuracy <= maxAccuracy

  useEffect(() => {
    if (isNative) return
    let stream: MediaStream | null = null
    if (!navigator.mediaDevices?.getUserMedia) { setErr('This browser cannot open the camera. Use the JalMarg app or Chrome/Safari on your phone.'); return }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      .then((s) => { stream = s; if (video.current) video.current.srcObject = s })
      .catch(() => setErr('Camera permission is required to take live evidence. Allow camera access and try again.'))
    return () => stream?.getTracks().forEach((t) => t.stop())
  }, [])

  const shoot = async () => {
    if (!fix) return
    const at = Date.now(), f = fix
    if (isNative) return nativeCapture().then((b) => onShot(b, f, at)).catch((e) => !/cancel/i.test(e?.message) && setErr('Could not open the camera'))
    const v = video.current!
    onShot(await toJpeg(v, v.videoWidth, v.videoHeight), f, at)
  }

  return (
    <div className="relative flex h-full flex-col bg-black text-white">
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))]">
        <button aria-label="Close camera" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-black/40"><X size={20} /></button>
        <div className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</div>
      </div>
      {isNative ? <div className="flex-1" /> : <video ref={video} autoPlay playsInline muted onLoadedData={() => setReady(true)} className="min-h-0 flex-1 object-cover" />}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-14 text-center">
        <p className="text-sm text-white/90">Take a live photo of the waterlogged road.</p>
        <div className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${precise ? 'bg-emerald-500/25 text-emerald-200' : 'bg-amber-500/25 text-amber-100'}`}>
          <MapPin size={13} />{geoError ? 'Location unavailable' : !fix ? 'Getting your location…' : `Location ±${fix.accuracy} m${precise ? '' : ' — approximate, will be reviewed'}`}
        </div>
        {(err || geoError) && <p className="mx-auto mt-2 max-w-sm text-xs text-rose-200">{err || geoError}</p>}
        <div className="mt-4 flex justify-center">
          <button aria-label="Take photo" onClick={shoot} disabled={!fix || (!isNative && !ready)}
            className="grid h-[72px] w-[72px] place-items-center rounded-full border-4 border-white disabled:opacity-40">
            {isNative ? <CamIcon size={28} /> : <span className="h-14 w-14 rounded-full bg-white" />}
          </button>
        </div>
      </div>
    </div>
  )
}
