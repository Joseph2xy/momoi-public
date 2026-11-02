// shadcn/ui Sonner, using Momoi's fixed theme and responsive ballot clearance.
import type { CSSProperties } from 'react'
import { Toaster as Sonner } from 'sonner'

export function Toaster() {
  return <Sonner theme="dark" position="bottom-right" closeButton visibleToasts={2}
    offset={24} mobileOffset={{ bottom: 104, left: 16, right: 16 }}
    toastOptions={{ duration: 4500 }}
    style={{ '--normal-bg': 'var(--surface)', '--normal-text': 'var(--foreground)',
      '--normal-border': 'var(--border-strong)', '--border-radius': '12px',
      fontFamily: 'inherit', pointerEvents: 'auto' } as CSSProperties} />
}
