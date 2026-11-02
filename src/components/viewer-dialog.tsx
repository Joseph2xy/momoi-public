import { Notice } from './feedback'
import { Button } from './ui/button'
import type { AdminGame, AdminUser, AdminIntent } from '../shared/contracts'
import { Artwork } from './shared'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'

export function voterStatus(user: AdminUser) {
  if (user.banned) return user.ballot?.excluded ? 'Banned · ballot excluded' : 'Voting banned'
  if (user.ballot?.excluded) return 'Ballot excluded'
  return user.ballot?.gameIds.length ? 'Votes counted' : 'No current votes'
}

export function CurrentChoices({
  gameIds,
  gamesById,
  label
}: {
  gameIds: string[] | undefined
  gamesById: Map<string, AdminGame>
  label?: string
}) {
  if (!gameIds?.length) return <p>No votes in the current round.</p>
  return (
    <ul aria-label={label}>
      {gameIds.map((id) => {
        const game = gamesById.get(id)
        return (
          <li key={id}>
            <Artwork name={game?.name ?? id} url={game?.coverUrl ?? null} />
            <span>{game?.name ?? id}</span>
          </li>
        )
      })}
    </ul>
  )
}

export function ViewerDialog({
  user,
  gamesById,
  message,
  error,
  saving,
  disabled,
  mutate,
  onClose,
  onCloseAutoFocus
}: {
  user: AdminUser | undefined
  gamesById: Map<string, AdminGame>
  message: string
  error: boolean
  saving: boolean
  disabled: boolean
  mutate: (action: AdminIntent, confirmation?: string) => void
  onClose: () => void
  onCloseAutoFocus: (event: Event) => void
}) {
  const ballot = user?.ballot
  return (
    <Dialog
      open={!!user}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="viewer-dialog" onCloseAutoFocus={onCloseAutoFocus}>
        {user ? (
          <>
            <DialogHeader>
              <DialogTitle>{user.displayName}</DialogTitle>
              <DialogDescription>
                {user.displayName.toLocaleLowerCase() !== user.login.toLocaleLowerCase()
                  ? '@' + user.login + ' · '
                  : ''}
                Account ID: {user.id}
              </DialogDescription>
            </DialogHeader>
            <span className="admin-voter-status">{voterStatus(user)}</span>
            <section className="viewer-choices" aria-label="Current choices">
              <h3>Current choices</h3>
              <CurrentChoices gameIds={ballot?.gameIds} gamesById={gamesById} />
            </section>
            <Notice className="admin-dialog-notice">
              {error
                ? 'Admin data could not be loaded. Close this dialog and reload the page before making changes.'
                : message}
            </Notice>
            <div className="admin-manage-panel" aria-busy={saving}>
              {saving ? <p role="status">Saving changes…</p> : null}
              <div>
                <h4>Voting access</h4>
                <p>
                  {user.banned
                    ? 'This account cannot vote. The ban continues across rounds until lifted.'
                    : 'A ban prevents voting in this and future rounds until lifted.'}
                </p>
                <Button
                  variant="secondary"
                  disabled={disabled || saving}
                  onClick={() =>
                    void mutate(
                      { action: user.banned ? 'unban' : 'ban', userId: user.id },
                      `${user.banned ? 'Lift the voting ban for' : 'Ban voting for'} ${user.displayName} (@${user.login})? ${user.banned ? 'Any ballot exclusion remains in place.' : 'Their current votes will not count, and they cannot vote until the ban is lifted.'}`
                    )
                  }
                >
                  {user.banned ? 'Lift ban' : 'Ban voting'}
                  <span className="sr-only"> for {user.login}</span>
                </Button>
              </div>
              <div>
                <h4>This ballot</h4>
                <p>
                  {!ballot?.gameIds.length
                    ? 'There are no current votes to exclude.'
                    : ballot.included
                      ? 'These votes count. Exclusion removes them from this round without banning the account.'
                      : user.banned && ballot.excluded
                        ? 'These votes do not count: both a voting ban and a ballot exclusion apply. Remove both to count them.'
                        : user.banned
                          ? 'These votes do not count because this account is banned.'
                          : 'These votes do not count because this ballot is excluded.'}
                </p>
                {ballot && (ballot.gameIds.length > 0 || ballot.excluded) ? (
                  <Button
                    variant="secondary"
                    disabled={disabled || saving}
                    onClick={() =>
                      void mutate(
                        { action: ballot.excluded ? 'unexclude' : 'exclude', ballotId: ballot.id },
                        `${ballot.excluded ? 'Remove the exclusion from' : 'Exclude'} ${user.displayName}’s current ballot? ${user.banned ? 'The voting ban will still keep these votes out.' : 'Voting access in later rounds is unchanged.'}`
                      )
                    }
                  >
                    {ballot.excluded ? 'Remove exclusion' : 'Exclude ballot'}
                    <span className="sr-only"> for {user.login}</span>
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
