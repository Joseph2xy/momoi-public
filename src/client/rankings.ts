import type { PublicGame } from '../shared/contracts'

export function rankGames(games: PublicGame[]) {
  const sorted = games.filter(game => game.selectionCount > 0)
    .sort((a, b) => b.selectionCount - a.selectionCount || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  let place = 1
  return sorted.map((game, index) => {
    if (index > 0 && game.selectionCount !== sorted[index - 1].selectionCount) place = index + 1
    const tied = sorted[index - 1]?.selectionCount === game.selectionCount || sorted[index + 1]?.selectionCount === game.selectionCount
    return { game, place, tied }
  })
}
