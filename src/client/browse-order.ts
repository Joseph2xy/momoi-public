import type { PublicGame } from '../shared/contracts'

// Capture IDs separately so live counts can update without moving browse targets.
export function createBrowseOrder(games: PublicGame[], sort: string): { gameIds: string[] } {
  const alphabetical = (a: PublicGame, b: PublicGame) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  return {
    gameIds: [...games].sort((a, b) => sort === 'popular'
      ? b.selectionCount - a.selectionCount || alphabetical(a, b)
      : alphabetical(a, b)).map(game => game.id),
  }
}
