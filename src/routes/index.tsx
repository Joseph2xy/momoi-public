import { createFileRoute } from '@tanstack/react-router'
import { VotingPage } from '../components/voting-page'
export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { error?: string } => ({ error: typeof search.error === 'string' ? search.error : undefined }),
  component: VoteRoute,
})

function VoteRoute() {
  const { error } = Route.useSearch()
  return <VotingPage authError={error} />
}
