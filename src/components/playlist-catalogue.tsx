import { useMemo, useRef } from 'react'
import { ExternalLink } from 'lucide-react'
import { useConvex } from 'convex/react'
import { ConvexError } from 'convex/values'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../convex/_generated/api'
import { playlistIdFromInput } from '../shared/playlist-id'
import { ADMIN_PAGE_SIZE } from '../shared/admin-pagination'
import { useAppState } from '../client/app-state'
import { useLiveQuery } from '../client/live-query'
import { useViewState } from '../client/view-state'
import { reloadPage } from '../client/reload-page'
import { Artwork } from './shared'
import { AddGame } from './add-game'
import { Notice } from './feedback'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

type CatalogueGame = FunctionReturnType<typeof api.playlists.mappings>['games'][number]
type Edit = { game: CatalogueGame | null; input: string }

function failure(error: unknown) {
  const code = error instanceof ConvexError ? String(error.data) : ''
  if (['UNAUTHENTICATED', 'FORBIDDEN', 'REAUTHENTICATION_REQUIRED'].includes(code)) return 'Your admin session could not be verified. Sign in again before continuing.'
  if (code.includes('NOT_CONFIGURED')) return 'YouTube playlist access is not configured yet.'
  if (code.includes('RATE_LIMIT') || code.includes('QUOTA')) return 'YouTube lookup is busy. Try again later.'
  if (code === 'PLAYLIST_ALREADY_MAPPED') return 'This playlist is already linked to another game. Choose a different playlist.'
  if (code === 'MAPPING_CHANGED') return 'This game’s playlist changed. Close the editor and review the current playlist before trying again.'
  if (code === 'INVALID_PLAYLIST_ID') return 'Enter a valid YouTube playlist URL or ID.'
  if (code === 'PLAYLIST_WRONG_CHANNEL') return 'Choose a playlist from LacariVOD.'
  if (code === 'PLAYLIST_NOT_FOUND') return 'This playlist could not be found. Check its URL and try again.'
  if (code === 'GAME_NOT_FOUND') return 'This game is no longer available. Choose an existing game.'
  if (code === 'PLAYLIST_EMPTY' || code === 'PLAYLIST_VIDEO_UNAVAILABLE') return 'This playlist has unavailable videos. Resolve those videos before selecting it.'
  if (code === 'PLAYLIST_CHANGED') return 'The playlist changed during lookup. Try saving it again.'
  if (code === 'PLAYLIST_TOO_LARGE') return 'This playlist exceeds the supported catalogue size.'
  return 'The request could not be confirmed. Review the current status before trying again.'
}

export function PlaylistCatalogue({ actor, active, disabled }: {
  actor: string; active: boolean; disabled: boolean
}) {
  const client = useConvex()
  const { isCurrentAdmin, beginAdmin, endAdmin, adminPending } = useAppState()
  const catalogue = useLiveQuery(api.playlists.mappings, active ? {} : 'skip')
  const lastCatalogue = useRef<typeof catalogue.data>(undefined)
  if (catalogue.data) lastCatalogue.current = catalogue.data
  const data = catalogue.data ?? lastCatalogue.current
  const [search, setSearch] = useViewState(`admin.playlists.search.${actor}`, '')
  const [pageIndex, setPageIndex] = useViewState(`admin.playlists.page-index.${actor}`, 0)
  const [edit, setEdit] = useViewState<Edit | null>(`admin.playlists.edit.${actor}`, null)
  const [message, setMessage] = useViewState(`admin.playlists.message.${actor}`, '')
  const [savingId, setSavingId] = useViewState<string | null>(`admin.playlists.saving.${actor}`, null)
  const returnFocusId = useRef(edit?.game?.id ?? null)
  const addButton = useRef<HTMLButtonElement | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  const editButtons = useRef(new Map<string, HTMLButtonElement>())
  const unavailable = disabled || !active || catalogue.isError || !catalogue.data || catalogue.isFetching
  const blocked = unavailable || adminPending.includes('playlists')
  const youtubeConfigured = !!data?.youtubeConfigured
  const games = data?.games
  const gamesById = useMemo(() => new Map(games?.map(game => [game.id, game])), [games])
  const term = search.trim().toLocaleLowerCase()
  const matchingGames = games?.filter(game => game.name.toLocaleLowerCase().includes(term) || game.mapping?.title.toLocaleLowerCase().includes(term)) ?? []
  const currentPage = Math.min(pageIndex, Math.max(0, Math.ceil(matchingGames.length / ADMIN_PAGE_SIZE) - 1))
  const start = currentPage * ADMIN_PAGE_SIZE
  const visibleGames = matchingGames.slice(start, start + ADMIN_PAGE_SIZE)
  const parsedId = edit ? playlistIdFromInput(edit.input) : null
  const liveGame = games?.find(game => game.id === edit?.game?.id)
  const editCurrent = !!edit && (!edit.game || !!liveGame && edit.game.mapping?.id === liveGame.mapping?.id
    && edit.game.mapping?.sequenceId === liveGame.mapping?.sequenceId)

  async function save() {
    if (blocked || !youtubeConfigured || !edit || !parsedId || !editCurrent || !beginAdmin('playlists')) return
    const { game } = edit
    setSavingId(game?.id ?? 'new-playlist'); setMessage('')
    try {
      if (game) {
        await client.action(api.playlists.save, { gameId: game.id, playlistId: parsedId,
          expectedMapping: game.mapping ? { id: game.mapping.id, sequenceId: game.mapping.sequenceId } : null })
      } else {
        const result = await client.action(api.catalogue.addPlaylist, { playlistId: parsedId })
        if (isCurrentAdmin(actor)) setMessage(result.added ? `${result.name} added with its playlist and thumbnail.`
          : `${result.name} is already in the catalogue${result.existing.retired ? ' and retired' : ''}.`)
      }
      if (!isCurrentAdmin(actor)) return
      if (game) setMessage(`${game.name}: playlist saved for future playback.`)
      setEdit(null)
    } catch (error) {
      if (isCurrentAdmin(actor)) setMessage(failure(error))
    } finally {
      endAdmin('playlists')
      if (isCurrentAdmin(actor)) setSavingId(null)
    }
  }

  return <section className="playlist-catalogue" aria-labelledby="playlist-catalogue-title">
    <div className="admin-catalogue-heading"><div className="admin-section-heading"><h2 id="playlist-catalogue-title">Games &amp; playlists</h2>
      <p>Link a LacariVOD playlist to each game, or add a non-game playlist with its thumbnail. Skip PvP games.</p></div>
    <div className="admin-catalogue-actions"><AddGame active={active} gamesById={gamesById}
      disabled={unavailable || !youtubeConfigured} />
    <Button ref={addButton} variant="secondary" disabled={blocked || !youtubeConfigured} aria-haspopup="dialog"
      onClick={() => { returnFocusId.current = null; setMessage(''); setEdit({ game: null, input: '' }) }}>Add playlist</Button>
    </div></div>
    <Notice>{catalogue.isError ? <><p>Playlists could not be loaded. Reload before saving changes.</p><Button variant="secondary" onClick={reloadPage}>Reload page</Button></> : message || null}</Notice>
    {!data && !catalogue.isError ? <p role="status">Loading playlists…</p> : null}
    {data && !youtubeConfigured ? <p>YouTube playlist access is not configured yet.</p> : null}
    <div className="admin-directory-tools"><label className="playlist-search">Find a game or playlist<Input ref={searchInput} type="search" placeholder="Search catalogue…" value={search} onChange={event => { setSearch(event.target.value); setPageIndex(0) }} /></label></div>
    <div className="admin-directory-results">
    <div className="playlist-table-heading" aria-hidden="true"><span>Game</span><span>Playlist</span><span /></div>
    <ul className="playlist-game-list" aria-label="Game playlists">
      {visibleGames.map(game => <li key={game.id}>
        <div className="playlist-game-identity">
        <Artwork name={game.name} url={game.coverUrl} />
        <div className="playlist-game-details"><h3>{game.name}</h3>
          {game.retired ? <p>Retired from voting</p> : null}
        </div></div>
        <div className="playlist-game-mapping">
          {game.mapping ? <><a href={`https://www.youtube.com/playlist?list=${game.mapping.playlistId}`} target="_blank" rel="noreferrer">{game.mapping.title}<ExternalLink size={14} aria-hidden="true" /></a>
            {!game.mapping.prepared ? <p>Open the playlist editor and save to check its videos.</p> : null}</> : null}
          <span className="playlist-readiness" data-ready={!!game.mapping?.prepared}>{game.mapping?.prepared ? 'Playlist ready' : game.mapping ? 'Needs checking · unavailable for new votes' : 'Needs a playlist · unavailable for new votes'}</span>
        </div>
        <Button variant="secondary" disabled={blocked} aria-haspopup="dialog" ref={button => { if (button) editButtons.current.set(game.id, button); else editButtons.current.delete(game.id) }}
          onClick={() => { returnFocusId.current = game.id; setMessage(''); setEdit({ game, input: game.mapping?.playlistId ?? '' }) }}>
          {savingId === game.id ? 'Saving…' : game.mapping ? 'Edit playlist' : 'Link playlist'}<span className="sr-only"> for {game.name}</span>
        </Button>
      </li>)}
    </ul>
    {data && !visibleGames.length ? <p>No games found. Try another name or clear your search.</p> : null}
    {data ? <div className="admin-pagination">
      <p role="status">{matchingGames.length ? `Showing ${start + 1}–${start + visibleGames.length} of ${matchingGames.length}` : '0 games'}</p>
      <Button variant="secondary" disabled={currentPage === 0} onClick={() => { setPageIndex(currentPage - 1); searchInput.current?.focus() }}>Previous games</Button>
      <Button variant="secondary" disabled={start + ADMIN_PAGE_SIZE >= matchingGames.length} onClick={() => { setPageIndex(currentPage + 1); searchInput.current?.focus() }}>Next games</Button>
    </div> : null}
    </div>
    <Dialog open={active && !!edit} onOpenChange={open => { if (!open) setEdit(null) }}>
      <DialogContent className="playlist-editor" onCloseAutoFocus={event => {
        event.preventDefault()
        if (!active) return
        const target = returnFocusId.current ? editButtons.current.get(returnFocusId.current) : null
        ;(target ?? addButton.current ?? searchInput.current)?.focus()
      }}>
        <DialogHeader><DialogTitle>{edit?.game?.name ?? 'Add playlist'}</DialogTitle><DialogDescription>Paste a LacariVOD playlist URL or ID. Saving checks that every video is available.</DialogDescription></DialogHeader>
        {edit ? <form className="playlist-editor-form" onSubmit={event => { event.preventDefault(); void save() }}>
          <label>YouTube playlist URL or ID<Input value={edit.input} maxLength={500} required disabled={blocked} spellCheck={false}
            onChange={event => setEdit({ ...edit, input: event.target.value })} /></label>
          {parsedId ? <a href={`https://www.youtube.com/playlist?list=${parsedId}`} target="_blank" rel="noreferrer">View playlist on YouTube</a>
            : edit.input.trim() ? <p>Enter a YouTube URL containing a playlist, or paste its playlist ID.</p> : null}
          <Notice>{catalogue.isError ? 'Playlists could not be loaded. Close this editor and reload before saving changes.' : message || null}</Notice>
          {!editCurrent && !savingId ? <p role="status">This game’s playlist changed. Close the editor and review the current playlist.</p> : null}
          {savingId ? <p role="status">Checking and saving playlist videos…</p> : null}
          <DialogFooter><Button type="button" variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
            <Button disabled={blocked || !youtubeConfigured || !parsedId || !editCurrent}>{savingId ? 'Saving…' : edit.game ? 'Save playlist' : 'Add playlist'}</Button></DialogFooter>
        </form> : null}
      </DialogContent>
    </Dialog>
  </section>
}
