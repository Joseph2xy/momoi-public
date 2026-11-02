import { EmptyState } from './feedback'
import { Button } from './ui/button'
import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useAppState } from '../client/app-state'
import { rankGames } from '../client/rankings'
import { Artwork, PublicNotice, WinnerHistoryNotice } from './shared'

function RankingRows({ rankings, leaders = false }: { rankings: ReturnType<typeof rankGames>; leaders?: boolean }) {
  return <ol className={leaders ? 'standings leaders' : 'standings remaining-standings'} aria-label={leaders ? 'Leading games' : 'Remaining rankings'}>
    {rankings.map(({ game, place, tied }) => <li key={game.id} className={place <= 3 ? 'ranking-leader' : undefined}>
      <span className="rank" aria-label={tied ? `Tied for rank ${place}` : `Rank ${place}`}>{tied ? `Tied #${place}` : `#${place}`}</span>
      <Artwork name={game.name} url={game.coverUrl} />
      <div className="standing-game"><h2>{game.name}</h2>{!game.available ? <p>Unavailable for new votes · existing votes preserved</p> : null}<div className="share-track" aria-hidden="true"><span style={{ transform: `scaleX(${game.voteShare / 100})` }} /></div></div>
      <div className="standing-count"><strong>{game.selectionCount.toLocaleString()} {game.selectionCount === 1 ? 'vote' : 'votes'}</strong><span>{game.voteShare.toFixed(1)}%</span></div>
    </li>)}
  </ol>
}

export function ResultsPage() {
  const { publicQuery: { data, error }, historyQuery } = useAppState()
  const winners = historyQuery.data
  const rankings = useMemo(() => rankGames(data?.games ?? []), [data?.games])
  const leaders = rankings.filter(game => game.place <= 3)
  const remaining = rankings.filter(game => game.place > 3)
  return (
    <>
      <main id="main" className="results-layout">
        <header className="rankings-heading">
          <h1>Current <em>rankings</em></h1>
          {data ? <dl className="rankings-totals">
            <div><dt>{data.totals.voters === 1 ? 'Voter' : 'Voters'}</dt><dd>{data.totals.voters.toLocaleString()}</dd></div>
            <div><dt>Votes cast</dt><dd>{data.totals.selections.toLocaleString()}</dd></div>
          </dl> : null}
        </header>
        <PublicNotice error={error} loaded={!!data} />
        {data ? <>
          {rankings.length ? <>
            <section aria-labelledby="leaders-title">
              <div className="results-section-heading"><h2 id="leaders-title">The top three ranks</h2><Link to="/">Cast your votes</Link></div>
              <RankingRows rankings={leaders} leaders />
            </section>
            {remaining.length ? <section aria-labelledby="remaining-title">
              <div className="results-section-heading"><h2 id="remaining-title">Standings continued</h2><p>{remaining.length} more {remaining.length === 1 ? 'game' : 'games'}</p></div>
              <RankingRows rankings={remaining} />
            </section> : null}
          </> : <EmptyState className="results-empty" title="No votes yet" description="Be the first to choose what comes next."><Button asChild><Link to="/">Vote now</Link></Button></EmptyState>}
        </> : null}
        <details className="winner-history" id="past-winners">
          <summary>Past winners {winners ? <span>{winners.length} {winners.length === 1 ? 'game' : 'games'}</span> : null}</summary>
          <WinnerHistoryNotice error={historyQuery.isError} />
          {winners ? winners.length ? <ul className="winner-grid">{winners.map(winner => <li key={winner.id}>
            <Artwork name={winner.game.name} url={winner.game.coverUrl} /><h3>{winner.game.name}</h3>
          </li>)}</ul> : <p>No round winners yet.</p> : !historyQuery.isError ? <p role="status">Loading past winners…</p> : null}
        </details>
      </main>
    </>
  )
}
