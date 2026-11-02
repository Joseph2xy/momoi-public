import { EmptyState, Notice } from './feedback'
import { NativeSelect, NativeSelectOption } from './ui/native-select'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Gamepad2, Radio, Users } from 'lucide-react'
import { useAdmin } from '../client/use-admin'
import { useAppState } from '../client/app-state'
import { ViewerDialog, CurrentChoices, voterStatus } from './viewer-dialog'
import { PlaybackAdmin } from './playback-admin'
import { PlaylistCatalogue } from './playlist-catalogue'
import { useViewState } from '../client/view-state'
import { usePageVisible } from '../client/use-page-visible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { reloadPage } from '../client/reload-page'
import { ADMIN_PAGE_SIZE } from '../shared/admin-pagination'

export function AdminPage() {
  const { signIn, sessionQuery } = useAppState()
  const pageVisible = usePageVisible()
  const actor = sessionQuery.data?.user.id ?? 'signed-out'
  const [section, setSection] = useViewState<'playback' | 'catalogue' | 'community'>(`admin.section.${actor}`, 'playback')
  const [loginError, setLoginError] = useState('')
  const returnToViewer = useRef<string | null>(null)
  const {
    filters, expandedId, setExpandedId,
    message, confirmation, setConfirmation, authorized, query, data,
    showingPrevious, visibleFilters, denied, ready, disconnected, confirmationPending, pending,
    mutate, gamesById, managedUser, disabled, show,
  } = useAdmin(pageVisible && section === 'community')
  const expanded = useRef(expandedId)
  expanded.current = expandedId
  const voterSearch = useRef<HTMLInputElement>(null)
  const voterButtons = useRef(new Map<string, HTMLButtonElement>())

  function expand(id: string | null) {
    if (id) returnToViewer.current = id
    expanded.current = id
    setExpandedId(id)
  }
  useEffect(() => {
    if (section !== 'community' || !data || showingPrevious) return
    if (expanded.current && !data.users.some(user => user.id === expanded.current)) {
      expand(null)
      voterSearch.current?.focus()
    }
  }, [section, data, showingPrevious])

  return <>
    <main id="main" className="admin-layout">
      <header className="admin-heading">
        <div><h1>Admin</h1><p>Playback, game playlists, and viewer access.</p></div>
        <Link className="admin-ranking-link" to="/results">View rankings <span aria-hidden="true">→</span></Link>
      </header>
      <Notice className="admin-notice">
        {denied ? <p>Sign in with an authorized admin Twitch account to use these tools.</p>
          : sessionQuery.isError || section === 'community' && query.isError ? <><p>Admin data could not be loaded. Reload the page before making changes.</p><Button variant="secondary" onClick={reloadPage}>Reload page</Button></>
          : disconnected ? <p>Connection interrupted. Reconnecting automatically; changes are paused.</p>
          : !authorized ? <p>Loading admin tools…</p> : section === 'community' && message ? <p>{message}</p> : null}
      </Notice>
      {loginError ? <p role="alert">{loginError}</p> : null}
      {denied ? <Button variant="default" onClick={() => { void signIn().catch(() => setLoginError('Twitch sign-in could not start. Please try again.')) }}>Sign in with Twitch</Button> : null}
      {authorized ? <>
      <div className="admin-sections" role="group" aria-label="Admin sections">
        {(['playback', 'catalogue', 'community'] as const).map(item => <Button key={item} variant={section === item ? 'default' : 'secondary'} aria-pressed={section === item}
          aria-controls={`admin-${item}`} onClick={() => setSection(item)}>
          {item === 'playback' ? <Radio size={18} aria-hidden="true" /> : item === 'catalogue' ? <Gamepad2 size={18} aria-hidden="true" /> : <Users size={18} aria-hidden="true" />}
          {item === 'playback' ? 'Playback' : item === 'catalogue' ? 'Games & playlists' : 'Viewers'}</Button>)}
      </div>
      <div id="admin-playback" hidden={section !== 'playback'}>
        <PlaybackAdmin active={pageVisible && section === 'playback'} disabled={!ready} />
      </div>
      <div id="admin-catalogue" hidden={section !== 'catalogue'}>
        <PlaylistCatalogue key={actor} actor={actor} active={pageVisible && section === 'catalogue'} disabled={!ready} />
      </div>
      <div id="admin-community" hidden={section !== 'community'}><section id="voters" className="admin-moderation" aria-labelledby="voters-title" aria-busy={query.isFetching}>
        <div className="admin-section-heading"><h2 id="voters-title">Viewers</h2><p>Review current votes and manage voting access.</p></div>
        <div className="admin-directory-tools"><div className="admin-viewer-filters">
          <label>Find a viewer
            <Input ref={voterSearch} type="search" maxLength={100} value={filters.query ?? ''} onChange={event => show({ query: event.target.value, scope: filters.scope })} placeholder="Twitch login, name, or account ID" />
          </label>
          <label>Show
            <NativeSelect aria-label="Filter accounts" value={filters.scope ?? 'voted'} onChange={event => show({ query: filters.query, scope: event.target.value as NonNullable<typeof filters.scope> })}>
              <NativeSelectOption value="voted">Current voters</NativeSelectOption>
              <NativeSelectOption value="all">All accounts</NativeSelectOption>
              <NativeSelectOption value="excluded">Excluded ballots</NativeSelectOption>
              <NativeSelectOption value="banned">Banned accounts</NativeSelectOption>
            </NativeSelect>
          </label>
        </div>
        </div>
        {!data && !query.isError ? <p role="status">Loading viewers…</p> : null}
        {data ? <div className="admin-directory-results" aria-busy={showingPrevious}>
        <div className="admin-table-heading" aria-hidden="true"><span>Account</span><span>Current choices</span><span>Status</span><span /></div>
        <ul className="admin-voter-list">
          {data.users.map(user => {
            const ballot = user.ballot
            return <li key={user.id} className="admin-voter-row" data-user-id={user.id}>
              <div className="admin-identity"><h3>{user.displayName}</h3>{user.displayName.toLocaleLowerCase() !== user.login.toLocaleLowerCase() ? <span>@{user.login}</span> : null}</div>
              <div className="admin-current-choices">
                <CurrentChoices gameIds={ballot?.gameIds} gamesById={gamesById} label={`Current choices for ${user.login}`} />
              </div>
              <span className="admin-voter-status" data-muted={!user.banned && !ballot?.excluded}>{voterStatus(user)}</span>
              <Button variant="secondary" className="admin-manage" ref={element => { if (element) voterButtons.current.set(user.id, element); else voterButtons.current.delete(user.id) }}
                aria-haspopup="dialog" onClick={() => expand(user.id)}>Manage<span className="sr-only"> {user.login}</span></Button>
            </li>
          })}
        </ul>
        {!data.users.length ? <EmptyState className="admin-empty" title="No matching accounts" description="Try another name or change the filter.">
          {filters.query || (filters.scope ?? 'voted') !== 'all' || filters.usersOffset ? <Button variant="secondary" onClick={() => show({ scope: 'all' })}>Clear filters</Button> : null}
        </EmptyState> : null}
        <div className="admin-pagination">
          <p role="status">{showingPrevious ? 'Loading viewers…' : data.users.length ? `Showing ${(visibleFilters.usersOffset ?? 0) + 1}–${(visibleFilters.usersOffset ?? 0) + data.users.length}` : '0 accounts'}</p>
          <Button variant="secondary" disabled={showingPrevious || !(filters.usersOffset ?? 0)} onClick={() => {
            show({ ...filters, usersOffset: Math.max(0, (filters.usersOffset ?? 0) - ADMIN_PAGE_SIZE) })
            voterSearch.current?.focus()
          }}>Previous voters</Button>
          <Button variant="secondary" disabled={showingPrevious || !data.hasMoreUsers} onClick={() => {
            show({ ...filters, usersOffset: (filters.usersOffset ?? 0) + ADMIN_PAGE_SIZE })
            voterSearch.current?.focus()
          }}>Next voters</Button>
        </div>
        </div> : null}
      </section>
      </div></> : null}
      <ViewerDialog user={section === 'community' ? managedUser : undefined} gamesById={gamesById} message={disconnected ? 'Connection interrupted. Reconnecting automatically; changes are paused.' : message} error={query.isError}
        saving={!!managedUser && pending.includes(managedUser.id)} disabled={disabled} mutate={mutate} onClose={() => expand(null)}
        onCloseAutoFocus={event => {
          event.preventDefault()
          if (section !== 'community') return
          const trigger = returnToViewer.current ? voterButtons.current.get(returnToViewer.current) : null
          ;(trigger ?? voterSearch.current)?.focus()
        }} />
      <Dialog open={section === 'community' && !!confirmation && authorized} onOpenChange={open => { if (!open) setConfirmation(null) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader><DialogTitle>Confirm moderation change</DialogTitle><DialogDescription>{confirmation?.text}</DialogDescription></DialogHeader>
          {disabled ? <p role="status">Admin data is unavailable. Cancel to check the connection or reload the page.</p> : null}
          <DialogFooter>
            <Button variant="secondary" autoFocus onClick={() => setConfirmation(null)}>Cancel</Button>
            <Button variant="default" disabled={disabled || confirmationPending} onClick={() => {
              if (!confirmation || disabled) return
              mutate(confirmation.action)
              setConfirmation(null)
            }}>Confirm change</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  </>
}
