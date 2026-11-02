import * as React from 'react'
import { cn } from '#/lib/utils'
import { ChevronDownIcon } from 'lucide-react'

function NativeSelect({
  className,
  ...props
}: React.ComponentProps<'select'>) {
  return (
    <div className="ui-native-select" data-slot="native-select-wrapper">
      <select data-slot="native-select" className={cn('ui-input', className)} {...props} />
      <ChevronDownIcon className="ui-native-select-icon" aria-hidden="true" data-slot="native-select-icon" />
    </div>
  )
}

function NativeSelectOption({ className, ...props }: React.ComponentProps<'option'>) {
  return (
    <option
      data-slot="native-select-option"
      className={cn('ui-native-select-option', className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOption }
