// shadcn/ui Dialog, adapted to Momoi's CSS tokens. Radix owns focus and dismissal.
import type { ComponentProps } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'
import { cn } from '#/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger

export function DialogContent({ className, children, showCloseButton = true, onInteractOutside, ...props }:
  ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="ui-dialog-overlay" />
    <DialogPrimitive.Content className={cn('ui-dialog', className)} {...props} onInteractOutside={event => {
      // A notification can be dismissed without dismissing the task underneath it.
      if (event.target instanceof Element && event.target.closest('[data-sonner-toast]')) event.preventDefault()
      else onInteractOutside?.(event)
    }}>
      {children}
      {showCloseButton ? <DialogPrimitive.Close className="ui-dialog-close" aria-label="Close">
        <XIcon aria-hidden="true" />
      </DialogPrimitive.Close> : null}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
}
export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('ui-dialog-header', className)} {...props} />
}
export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('ui-dialog-footer', className)} {...props} />
}
export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('ui-dialog-title', className)} {...props} />
}
export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('ui-dialog-description', className)} {...props} />
}
