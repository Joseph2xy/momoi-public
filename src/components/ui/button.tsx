import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '#/lib/utils'
import { Slot } from '@radix-ui/react-slot'

const buttonVariants = cva('ui-button', {
  variants: {
    variant: {
      default: 'ui-button-primary',
      secondary: 'ui-button-secondary',
      ghost: 'ui-button-ghost',
      link: 'ui-button-link'
    },
    size: { default: '', sm: 'ui-button-sm', icon: 'ui-button-icon' }
  },
  defaultVariants: { variant: 'default', size: 'default' }
})

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button }
