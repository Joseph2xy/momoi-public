# Momoi

A website where Twitch viewers vote on what to watch next. Viewers choose up to
three games or playlists, and the winning playlist plays automatically through
a paired browser extension.

**Built with:** TypeScript, React, TanStack Start, Convex and Cloudflare Workers.

![Momoi voting screen showing selected games and the game catalogue](docs/images/voting.png)

The website handles Twitch sign-in, voting and live rankings. Convex stores the
ballots and voting rounds; a Chrome/Edge extension manages YouTube playback and
saves progress. Built for a specific Twitch community.

## Development

Running your own instance requires a Convex deployment, Twitch OAuth credentials
and a YouTube Data API key. See the [setup guide](docs/operations.md#configuration).

## Verification

```sh
npm run typecheck
npx tsc -p convex/tsconfig.json --noEmit
npm run build
npm run build:extension
```

[Architecture](docs/architecture.md) · [Product behavior](docs/product.md) ·
[Deployment and operations](docs/operations.md)

## License

[MIT](LICENSE) for original code. Third-party artwork and dependencies retain
their own rights and notices. [Artwork sources](data/brand-artwork.json).
