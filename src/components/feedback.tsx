import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

export function Notice({ children, className }: { children: ReactNode; className?: string }) {
  if (!children) return null
  return (
    <div data-slot="alert" role="status" aria-live="polite" className={cn('ui-alert', className)}>
      <div data-slot="alert-description" className="ui-alert-description">{children}</div>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  children,
  className
}: {
  title: string
  description: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div data-slot="empty" className={cn('ui-empty', className)}>
      <div data-slot="empty-header" className="ui-empty-header">
        <div data-slot="empty-title" className="ui-empty-title">
          <h2>{title}</h2>
        </div>
        <div data-slot="empty-description" className="ui-empty-description">{description}</div>
      </div>
      {children ? <div data-slot="empty-content" className="ui-empty-content">{children}</div> : null}
    </div>
  )
}
