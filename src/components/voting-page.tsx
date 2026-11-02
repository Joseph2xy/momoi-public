import { EmptyState } from './feedback'
import { NativeSelect, NativeSelectOption } from './ui/native-select'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from '../client/app-state'
import { useViewState } from '../client/view-state'
import { PublicNotice, WinnerHistoryNotice } from './shared'
import { BallotPanel, VotingAccount } from './ballot-panel'
import { GameRow } from './game-row'
import { createBrowseOrder } from '../client/browse-order'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import type { PublicGame } from '../shared/contracts'

const openedDate = (value: number) => new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const EMPTY_GAMES: PublicGame[] = []

export function VotingPage({ authError }: { authError?: string }) {
  const { publicQuery: { data, error }, historyQuery, ballot, signIn: startSignIn } = useAppState()
  const roundId = data?.round.id
  const [loginError, setLoginError] = useState('')
  const [loginPending, setLoginPending] = useState(false)
  const [search, setSearch] = useViewState('vote.search', '')
  const [sort, setSort] = useViewState('vote.sort', 'popular')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const restoreFocus = (event: Event) => { event.preventDefault(); returnFocus.current?.focus() }
  const [pendingGame, setPendingGame] = useState<PublicGame | null>(null)
  const [roundContext, setRoundContext] = useState<{ id: string | undefined; changed: boolean }>({ id: roundId, changed: false })
  if (data && roundContext.id !== roundId) {
    setRoundContext({ id: roundId, changed: roundContext.id !== undefined })
  }
  const games = data?.games ?? EMPTY_GAMES
  const availableGames = useMemo(() => games.filter(game => game.available), [games])
  const catalogueKey = useMemo(() => availableGames.map(game => game.id).sort().join('|'), [availableGames])
  const searchTerm = search.trim().toLocaleLowerCase()
  const browseKey = JSON.stringify([roundId, catalogueKey, sort, searchTerm])
  const [storedBrowse, setStoredBrowse] = useViewState<({ key: string } & ReturnType<typeof createBrowseOrder>) | null>('vote.order', null)
  const browse = useMemo(() => storedBrowse?.key === browseKey ? storedBrowse
    : { key: browseKey, ...createBrowseOrder(availableGames, sort) }, [storedBrowse, browseKey, availableGames, sort])
  // Retain targets across navigation as well as background count updates.
  useEffect(() => { if (storedBrowse !== browse) setStoredBrowse(browse) }, [storedBrowse, browse, setStoredBrowse])
  const gamesById = useMemo(() => new Map(games.map(game => [game.id, game])), [games])
  const filtered = useMemo(() => browse.gameIds.flatMap(id => {
    const game = gamesById.get(id)
    return game && game.name.toLocaleLowerCase().includes(searchTerm) ? [game] : []
  }), [browse.gameIds, gamesById, searchTerm])
  const selected = ballot.selectedGameIds.flatMap(id => {
    const game = gamesById.get(id)
    return game ? [game] : []
  })
  const banned = !!ballot.session?.banned
  const editable = !!roundId && !!ballot.session?.eligible && ['ready', 'saving', 'saved'].includes(ballot.status)
  const signedOut = !ballot.session && ['ready', 'expired'].includes(ballot.status)
  const uncertain = ballot.status === 'error'
  const latestWinner = historyQuery.data?.find(winner => winner.roundId !== null)
  const dockTitle = signedOut ? 'Sign in to vote' : 'Your choices'
  const dockMessage = banned ? ballot.message : ballot.status === 'loading' ? 'Loading your ballot…'
    : uncertain ? 'Choices not confirmed · tap to reload'
    : ballot.status === 'saving' ? 'Saving your choices…'
    : signedOut ? 'Use your Twitch account'
    : !ballot.session?.eligible ? 'Account not eligible · tap for details'
    : ballot.status === 'saved' ? 'All choices saved · tap to edit'
    : selected.length ? 'Saved choices · tap to edit' : 'Choose up to 3 different games'

  function vote(game: PublicGame) {
    if (editable && (game.available || ballot.selectedGameIds.includes(game.id))) ballot.toggle(game.id)
  }
  function signIn(game: PublicGame | null = null) {
    setPendingGame(game)
    returnFocus.current = document.activeElement as HTMLElement
    setSignInOpen(true)
  }

  return <>
    <main id="main" className="voting-layout">
      <aside className="voting-sidebar">
        <div className="intro">
          <h1>Vote for the<br /><em>next VOD.</em></h1>
        </div>
        <section className="ballot-panel desktop-ballot" aria-label="Your ballot"><BallotPanel ballot={ballot} selected={selected} editable={editable} onSignIn={() => signIn()} /></section>
        <div className="desktop-account"><VotingAccount ballot={ballot} /></div>
      </aside>
      <section className="catalogue" aria-labelledby="catalogue-title">
        {authError ? <p role="alert">{authError === 'account_not_linked'
          ? 'This Twitch account shares an email with another account and cannot sign in. No accounts were merged.'
          : 'Twitch sign-in could not be completed. Please try again.'}</p> : null}
        <div className="catalogue-toolbar">
          <div className="section-heading"><div>
            <h2 id="catalogue-title">Choose up to 3 vods</h2>
            <p>Changes save automatically. You can change your choices while voting is open.</p>
          </div></div>
          <div className="browse-controls">
            <label className="search-label">
              <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
              <span className="sr-only">Search games</span>
              <Input type="search" placeholder="Search games…" value={search} onChange={event => setSearch(event.target.value)} />
            </label>
            <label><span className="sr-only">Sort games</span><NativeSelect value={sort} onChange={event => setSort(event.target.value)}>
              <NativeSelectOption value="name">A–Z</NativeSelectOption><NativeSelectOption value="popular">Most votes</NativeSelectOption>
            </NativeSelect></label>
          </div>
        </div>
        <PublicNotice error={error} loaded={!!data} />
        <WinnerHistoryNotice error={historyQuery.isError} />
        {data ? <div className="voting-round-context">
          <p>Voting open · Started {openedDate(data.round.openedAt)}</p>
          <p>The winner will be played right after the current playlist ends.</p>
          {latestWinner ? <p>Last chosen: <strong>{latestWinner.game.name}</strong>.</p> : null}
          <p className="round-change-message" role="status">{roundContext.changed ? 'A new voting round has started. Previous ballots stay with the completed round; choose again for this round.' : null}</p>
        </div> : null}
        {data ? <p className="catalogue-count">{filtered.length} {filtered.length === 1 ? 'game' : 'games'}{searchTerm ? ` matching “${search.trim()}”` : ' to choose from'}</p> : null}
        {data && !filtered.length ? <EmptyState className="empty-state" title={availableGames.length ? 'No games found' : 'The catalogue is on its way'}
          description={availableGames.length ? 'Try another name or clear your search.' : 'Games will appear here when their playlists are ready.'}>
          {search ? <Button variant="secondary" onClick={() => setSearch('')}>Clear search</Button> : null}
        </EmptyState> : null}
        <ul className="game-list">
          {filtered.map(game => <GameRow key={game.id} game={game} selected={ballot.selectedGameIds.includes(game.id)}
            editable={editable} signedOut={signedOut && !!roundId} onVote={vote} onSignIn={signIn} />)}
        </ul>
      </section>
    </main>
    <Button variant="secondary" className="mobile-ballot-trigger" aria-haspopup="dialog"
      onClick={() => { if (signedOut) signIn(); else { returnFocus.current = document.activeElement as HTMLElement; setDrawerOpen(true) } }}>
      <span>{dockTitle}<small role="status" aria-live="polite" aria-atomic="true">{dockMessage}</small></span>
      {!signedOut && ballot.status !== 'loading' && ballot.session ? <strong>{selected.length} of 3</strong> : null}
    </Button>
    <Dialog open={signInOpen} onOpenChange={open => { setSignInOpen(open); if (!open) setPendingGame(null) }}>
    <DialogContent className="sign-in-dialog" onCloseAutoFocus={restoreFocus}>
      <DialogTitle>Sign in to vote</DialogTitle>
      <DialogDescription>Sign in with Twitch{pendingGame ? <> to choose <strong>{pendingGame.name}</strong></> : ' to save your choices'}. Your Twitch account must be at least 30 days old.</DialogDescription>
      <p className="sign-in-privacy">Other viewers see totals, not your choices. Admins can inspect individual ballots.</p>
      {loginError ? <p role="alert">{loginError}</p> : null}
      <form onSubmit={event => { event.preventDefault(); setLoginPending(true); setLoginError(''); void startSignIn(pendingGame?.id).catch(() => { setLoginPending(false); setLoginError('Twitch sign-in could not start. Please try again.') }) }}>
        <Button variant="default" autoFocus className="full-width" disabled={loginPending}>Sign in with Twitch</Button>
      </form>
      <Button variant="secondary" type="button" className="full-width" onClick={() => setSignInOpen(false)}>Keep browsing</Button>
    </DialogContent></Dialog>
    <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}><DialogContent className="ballot-drawer" showCloseButton={false} onCloseAutoFocus={restoreFocus}>
      <DialogTitle className="sr-only">Your ballot</DialogTitle>
      <DialogDescription className="sr-only">Review and edit your choices for the current voting round.</DialogDescription>
      <div className="drawer-top"><Button variant="secondary" autoFocus onClick={() => setDrawerOpen(false)}>Close</Button></div>
      <BallotPanel ballot={ballot} selected={selected} editable={editable} onSignIn={() => signIn()} />
      <VotingAccount ballot={ballot} />
    </DialogContent></Dialog>
  </>
}
