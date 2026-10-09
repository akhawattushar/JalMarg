import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'

export const isNative = Capacitor.isNativePlatform()

export function toJpeg(src: CanvasImageSource, w: number, h: number, max = 1600): Promise<Blob> {
  const k = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas')
  c.width = Math.round(w * k)
  c.height = Math.round(h * k)
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height)
  return new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('Could not process photo'))), 'image/jpeg', 0.88))
}

/** Native camera only — the gallery is never offered for live evidence. */
export async function nativeCapture(): Promise<Blob> {
  const p = await Camera.getPhoto({ source: CameraSource.Camera, resultType: CameraResultType.DataUrl, quality: 88, width: 1600, correctOrientation: true, saveToGallery: false })
  const img = new Image()
  img.src = p.dataUrl!
  await img.decode()
  return toJpeg(img, img.naturalWidth, img.naturalHeight)
}
