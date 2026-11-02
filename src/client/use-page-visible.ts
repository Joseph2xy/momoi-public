import { useSyncExternalStore } from 'react'

function subscribe(changed: () => void) {
  document.addEventListener('visibilitychange', changed)
  return () => document.removeEventListener('visibilitychange', changed)
}

export function usePageVisible() {
  return useSyncExternalStore(subscribe, () => !document.hidden, () => false)
}
