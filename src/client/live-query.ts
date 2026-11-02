import { useEffect, useMemo, useRef } from 'react'
import { useConvex, useQueries, type RequestForQueries } from 'convex/react'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { getFunctionName } from 'convex/server'
import { convexToJson } from 'convex/values'

// Convex owns subscriptions and reconnection. Keep only the last successful
// result for this query so an exceptional read failure doesn't blank the view.
export function useLiveQuery<Q extends FunctionReference<'query'>>(query: Q, args: FunctionArgs<Q> | 'skip') {
  type Data = FunctionReturnType<Q>
  const client = useConvex()
  const key = JSON.stringify([getFunctionName(query), convexToJson(args)])
  // Like Convex's useQuery, stabilize the request by serialized arguments.
  const requests = useMemo((): RequestForQueries => {
    if (args === 'skip') return {}
    return { result: { query, args } }
  }, [key])
  const result = useQueries(requests).result as Data | Error | undefined
  const error = result instanceof Error ? result : undefined
  const data = error ? undefined : result as Data | undefined
  const last = useRef<{ client: typeof client; key: string; data: Data } | null>(null)
  const sameQuery = last.current?.client === client && last.current.key === key
  useEffect(() => {
    if (data !== undefined) last.current = { client, key, data }
    else if (!sameQuery) last.current = null
  }, [client, key, data, sameQuery])
  return {
    data: data !== undefined ? data : sameQuery ? last.current?.data : undefined,
    error, isError: !!error, isFetching: args !== 'skip' && result === undefined,
  }
}
