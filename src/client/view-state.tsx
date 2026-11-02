import { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { PublicSession } from '../shared/contracts'

const ViewsContext = createContext<{ values: Record<string, unknown>; setValues: Dispatch<SetStateAction<Record<string, unknown>>> } | null>(null)

export function ViewStateProvider({ session, children }: { session: PublicSession | null | undefined; children: ReactNode }) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const actorId = session?.user.id
  const admin = session?.admin
  useEffect(() => {
    setValues(previous => Object.fromEntries(Object.entries(previous).filter(([key]) =>
      !key.startsWith('admin.') || admin && key.endsWith('.' + actorId))))
  }, [actorId, admin])
  return <ViewsContext.Provider value={{ values, setValues }}>{children}</ViewsContext.Provider>
}

export function useViewState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const context = useContext(ViewsContext)
  if (!context) throw new Error('AppStateProvider is required')
  const setValue: Dispatch<SetStateAction<T>> = useCallback(value => context.setValues(previous => ({
    ...previous, [key]: typeof value === 'function' ? (value as (old: T) => T)((previous[key] as T | undefined) ?? initial) : value,
  })), [context.setValues, key, initial])
  return [(context.values[key] as T | undefined) ?? initial, setValue]
}
