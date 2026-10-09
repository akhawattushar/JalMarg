import type { ReactNode } from 'react'
import * as D from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

/** Accessible modal: bottom sheet on phones, centered dialog on larger screens. */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-navy/40" />
        <D.Content aria-describedby={undefined} className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-xl bg-surface pb-[env(safe-area-inset-bottom)] shadow-xl outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <D.Title className="text-base font-semibold">{title}</D.Title>
            <D.Close aria-label="Close" className="btn-ghost h-8 w-8 px-0"><X size={18} /></D.Close>
          </div>
          <div className="p-4">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
