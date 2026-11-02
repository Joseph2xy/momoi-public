import { useEffect, useRef, useState } from 'react'
import { useConvex } from 'convex/react'
import { ConvexError } from 'convex/values'
import { api } from '../../convex/_generated/api'
import type { SearchGame } from '../../convex/catalogue'
import type { AdminGame } from '../shared/contracts'
import { playlistIdFromInput } from '../shared/playlist-id'
import { useAppState } from '../client/app-state'
import { useViewState } from '../client/view-state'
import { Artwork } from './shared'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'

function failure(error: unknown, adding: boolean) {
  const code = error instanceof ConvexError ? error.data : null
  if (code === 'IGDB_RATE_LIMITED') return 'Game lookup is busy. Wait a moment and try again.'
  if (code === 'IGDB_NOT_CONFIGURED') return 'Game lookup is not configured yet.'
  if (code === 'IGDB_GAME_NOT_FOUND') return 'This game is no longer available from IGDB. Search again.'
  if (code === 'INVALID_PLAYLIST_ID') return 'Enter a valid YouTube playlist URL or ID.'
  if (code === 'PLAYLIST_ALREADY_MAPPED') return 'This playlist is already linked to a catalogue entry. Edit that entry instead.'
  if (code === 'PLAYLIST_WRONG_CHANNEL') return 'Choose a playlist from LacariVOD.'
  if (code === 'PLAYLIST_NOT_FOUND') return 'The playlist could not be found. Check its link.'
  if (code === 'PLAYLIST_EMPTY' || code === 'PLAYLIST_VIDEO_UNAVAILABLE') return 'The playlist has unavailable videos. Resolve them before adding this game.'
  if (code === 'YOUTUBE_NOT_CONFIGURED') return 'YouTube playlist access is not configured yet.'
  if (code === 'YOUTUBE_RATE_LIMITED') return 'YouTube lookup is busy. Try again later.'
  if (code === 'PLAYLIST_CHANGED') return 'The playlist changed during lookup. Try adding it again.'
  if (code === 'PLAYLIST_TOO_LARGE') return 'This playlist exceeds the supported catalogue size.'
  if (code === 'UNAUTHENTICATED' || code === 'FORBIDDEN' || code === 'REAUTHENTICATION_REQUIRED') return 'Your admin session could not be verified. Sign in again before continuing.'
  return adding ? 'The addition could not be confirmed. Try Add again; an existing game will not be duplicated.' : 'Game search failed. Please try again.'
}

export function AddGame({ active, disabled, gamesById }: { active: boolean; disabled: boolean; gamesById: Map<string, Pick<AdminGame, 'id' | 'retired'>> }) {
  const client = useConvex()
  const { sessionQuery, beginAdmin, endAdmin, adminPending, isCurrentAdmin } = useAppState()
  const actor = sessionQuery.data?.user.id ?? 'signed-out'
  const [message, setMessage] = useViewState(`admin.catalogue.message.${actor}`, '')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [playlistInput, setPlaylistInput] = useState('')
  const playlistId = playlistIdFromInput(playlistInput)
  const [results, setResults] = useState<SearchGame[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState<number | null>(null)
  const request = useRef(0)
  const searchInFlight = useRef(false)
  const saving = adminPending.includes('addGame')
  // Searches belong to this view; saves deliberately survive navigation.
  useEffect(() => () => { ++request.current }, [])

  function existingGame(game: SearchGame) {
    const live = gamesById.get(game.existing?.id ?? `igdb-${game.igdbId}`)
    return live ? { id: live.id, retired: live.retired } : game.existing
  }

  async function search() {
    if (disabled || saving || searchInFlight.current || query.trim().length < 2) return
    const current = ++request.current
    searchInFlight.current = true
    setSearching(true); setResults(null); setMessage('')
    try {
      const games = await client.action(api.catalogue.search, { query: query.trim() })
      if (current === request.current && isCurrentAdmin(actor)) setResults(games)
    } catch (error) {
      if (current === request.current && isCurrentAdmin(actor)) setMessage(failure(error, false))
    } finally { searchInFlight.current = false; setSearching(false) }
  }

  async function add(game: SearchGame) {
    if (disabled || saving || !playlistId || existingGame(game) || !beginAdmin('addGame')) return
    setAdding(game.igdbId); setMessage(`Adding ${game.name}…`)
    try {
      const result = await client.action(api.catalogue.add, { igdbId: game.igdbId, playlistId })
      if (!isCurrentAdmin(actor)) return
      setResults(previous => previous?.map(item => item.igdbId === game.igdbId ? { ...item, existing: result.existing } : item) ?? null)
      setMessage(result.added ? `${result.name} added with its playlist.` : result.existing.retired ? `${result.name} is already retired and cannot be added.` : `${result.name} is already in the catalogue.`)
    } catch (error) {
      if (isCurrentAdmin(actor)) setMessage(failure(error, true))
    } finally { setAdding(null); endAdmin('addGame') }
  }

  return <div className="admin-add-game">
    <Dialog open={active && open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button disabled={disabled} title="Add a game with its LacariVOD playlist.">Add game</Button></DialogTrigger>
      <DialogContent className="add-game-dialog" onCloseAutoFocus={event => { if (!active) event.preventDefault() }}>
        <DialogHeader><DialogTitle>Add a game</DialogTitle><DialogDescription>Paste its LacariVOD playlist, then find the matching game. Adding checks every video before saving.</DialogDescription></DialogHeader>
        <label>YouTube playlist URL or ID<Input value={playlistInput} maxLength={2048} required disabled={disabled || saving} spellCheck={false}
          onChange={event => setPlaylistInput(event.target.value)} /></label>
        {playlistId ? <a href={`https://www.youtube.com/playlist?list=${playlistId}`} target="_blank" rel="noreferrer">View playlist on YouTube</a>
          : playlistInput.trim() ? <p>Enter a valid YouTube playlist URL or ID.</p> : null}
        <form className="admin-lookup-form" onSubmit={event => { event.preventDefault(); void search() }}>
          <label htmlFor="game-search">Game name<Input id="game-search" type="search" placeholder="Type a game name…" minLength={2} maxLength={100} required value={query}
            onChange={event => { ++request.current; setQuery(event.target.value); setResults(null) }} /></label>
          <Button variant="secondary" disabled={disabled || saving || searching || query.trim().length < 2}>{searching ? 'Searching…' : 'Search games'}</Button>
        </form>
        <p role="status">{disabled ? 'Waiting for confirmed admin data. Close this dialog to check the connection or reload the page.' : message || (searching ? 'Searching games…' : results ? results.length ? `${results.length} matching games. Add one below, or refine your search.` : 'No games found. Try another title.' : 'Enter at least two characters to search.')}</p>
        <ul className="game-search-results" aria-label="Matching games" aria-busy={searching}>
          {results?.map(game => {
            const existing = existingGame(game)
            const label = adding === game.igdbId ? 'Adding…' : existing ? existing.retired ? 'Retired' : 'Added' : 'Add'
            return <li key={game.igdbId}>
            <Artwork name={game.name} url={game.coverUrl} />
            <div><h3>{game.name}</h3><p>{[game.year, ...game.platforms].filter(Boolean).join(' · ') || 'Release details unavailable'}</p></div>
            <Button variant="secondary" disabled={disabled || saving || !!existing || !playlistId} aria-label={`${label}: ${game.name}`} onClick={() => { void add(game) }}>
              {label}
            </Button>
          </li>})}
        </ul>
        <p className="game-search-credit">Game data and artwork from <a href="https://www.igdb.com/" target="_blank" rel="noreferrer">IGDB</a>.</p>
      </DialogContent>
    </Dialog>
    {!open && message ? <p className="add-game-message" role="status">{message}</p> : null}
  </div>
}
