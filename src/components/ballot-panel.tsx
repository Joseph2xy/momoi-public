import { Button } from './ui/button'
import type { PublicGame } from '../shared/contracts'
import { Artwork } from './shared'
import { useAppState } from '../client/app-state'
import { useState } from 'react'

type Ballot = ReturnType<typeof useAppState>['ballot']

export function BallotPanel({
  ballot,
  selected,
  editable,
  onSignIn
}: {
  ballot: Ballot
  selected: PublicGame[]
  editable: boolean
  onSignIn: () => void
}) {
  const banned = !!ballot.session?.banned
  const uncertain = ballot.status === 'error'
  const signedOut = !ballot.session && ['ready', 'expired'].includes(ballot.status)
  return (
    <>
      <div className="ballot-heading">
        <h2>Your choices</h2>
        <span>{selected.length} of 3</span>
      </div>
      {selected.length ? (
        <ul className="ballot-slots">
          {selected.map((game) => (
            <li key={game.id} className="filled">
              <Artwork name={game.name} url={game.coverUrl} />
              <span className="slot-name">{game.name}{!game.available ? <small>Unavailable for new votes · vote saved</small> : null}</span>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                className="remove-button"
                aria-label={`Remove ${game.name}`}
                disabled={!editable}
                onClick={() => ballot.toggle(game.id)}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </Button>
            </li>
          ))}
        </ul>
      ) : !banned ? (
        <p className="ballot-empty">Your choices will appear here.</p>
      ) : null}
      {ballot.message ? (
        <p
          className={`save-status ${uncertain ? 'attention' : ''}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {ballot.message}
        </p>
      ) : null}
      {uncertain ? (
        <Button variant="default" className="full-width" onClick={ballot.reload}>
          Reload page
        </Button>
      ) : null}
      {ballot.pendingGameId ? <Button variant="secondary" disabled={ballot.status === 'saving' || ballot.status === 'loading'} onClick={() => { void ballot.dismissPending() }}>Dismiss remembered choice</Button> : null}
      {signedOut ? (
        <Button variant="default" className="full-width" onClick={onSignIn}>
          Sign in with Twitch
        </Button>
      ) : null}
      {ballot.session?.eligible ? <p className="automatic-save-note">Changes save automatically.</p> : null}
    </>
  )
}

export function VotingAccount({ ballot }: { ballot: Ballot }) {
  const { signOut } = useAppState()
  const [error, setError] = useState('')
  return ballot.session ? (
    <div className="account">
      <span>
        Signed in as <strong>{ballot.session.user.displayName}</strong>
      </span>
      <form onSubmit={event => { event.preventDefault(); void signOut().catch(() => setError('Sign out failed. Please try again.')) }}>
        <Button variant="link" size="sm" disabled={ballot.status === 'saving'}>
          Sign out
        </Button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  ) : null
}
