import { Button } from './ui/button'
import type { PublicGame } from '../shared/contracts'
import { Artwork } from './shared'
import { cn } from '../lib/utils'

export function GameRow({
  game,
  selected,
  editable,
  signedOut,
  onVote,
  onSignIn
}: {
  game: PublicGame
  selected: boolean
  editable: boolean
  signedOut: boolean
  onVote: (game: PublicGame) => void
  onSignIn: (game: PublicGame) => void
}) {
  return (
    <li className={cn('game-row', selected && 'selected')}>
      <Artwork name={game.name} url={game.coverUrl} />
      <div className="game-info">
        <h3>{game.name}</h3>
        <span>
          {game.selectionCount} {game.selectionCount === 1 ? 'vote' : 'votes'}
        </span>
      </div>
      {signedOut ? (
        <Button
          variant="secondary"
          size="sm"
          type="button"
          aria-label={`Sign in to select ${game.name}`}
          aria-haspopup="dialog"
          disabled={!game.available}
          onClick={() => onSignIn(game)}
        >
          Vote +
        </Button>
      ) : (
        <Button
          variant={selected ? 'default' : 'secondary'}
          size="sm"
          type="button"
          aria-label={`${selected ? 'Remove' : 'Select'} ${game.name}`}
          aria-pressed={selected}
          disabled={!editable || !selected && !game.available}
          onClick={() => onVote(game)}
        >
          {selected ? 'Voted ✓' : 'Vote +'}
        </Button>
      )}
    </li>
  )
}
