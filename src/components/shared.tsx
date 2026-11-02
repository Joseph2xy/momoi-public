import { Notice } from './feedback'
import { Button } from './ui/button'
import { Link, useLocation } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { useAppState } from '../client/app-state'
import { reloadPage } from '../client/reload-page'
import { ConvexError } from 'convex/values'

export function PageFrame({ children }: { children: ReactNode }) {
  const { sessionQuery, ballot } = useAppState()
  const pathname = useLocation({ select: location => location.pathname })
  return (
    <div className="public-site">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Link to="/" className="brand" aria-label="Momoi home">
          <img className="brand-image" src="/brand/momoi.webp" width="42" height="42" alt="" />
          <span>
            MOMOI<span className="brand-long"> — Ministry of Monitoring, Oversight &amp; Integrity</span>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          <Link to="/" activeOptions={{ exact: true }}>
            Vote
          </Link>
          <Link to="/results">
            Rankings
          </Link>
          {sessionQuery.data?.admin ? <Link to="/admin">
            Admin
          </Link> : null}
        </nav>
      </header>
      {pathname === '/results' && sessionQuery.isError && sessionQuery.data !== null ?
        <Notice className="app-save-notice"><p>Your account could not be loaded.</p>
          <Button variant="secondary" onClick={reloadPage}>Reload page</Button>
        </Notice> : null}
      {pathname !== '/' && ballot.status === 'error' && ballot.session ?
        <div className="app-save-notice" role="status">
          <span>Your last choices could not be confirmed.</span>
          <Link to="/">Review choices</Link>
        </div> : null}
      {children}
      <footer className="site-footer">
        <span>made by <strong>joe_momoi</strong></span><img className="reaction-emote" src="/brand/reaction.webp" width="24" height="24" alt="Animated reaction emote" />
      </footer>
    </div>
  )
}
export function Artwork({ name, url }: { name: string; url: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const src = url && url !== failedUrl ? url : null
  return (
    <div className="artwork" aria-hidden="true">
      <span>
        {name
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join('')}
      </span>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(src)}
        />
      ) : null}
    </div>
  )
}
export function PublicNotice({
  error,
  loaded,
}: {
  error: Error | undefined
  loaded: boolean
}) {
  if (error)
    return (
      <Notice className="notice">
        <p>
          {error instanceof ConvexError && error.data === 'VOTING_NOT_INITIALIZED'
            ? 'Voting is not configured. An admin must initialize the backend.'
            : loaded
            ? 'Updates paused. These are the last available standings.'
            : 'The game catalogue could not be loaded.'}
        </p>
        <Button variant="secondary" onClick={reloadPage}>Reload page</Button>
      </Notice>
    )
  if (!loaded)
    return (
      <div className="notice public-loading" role="status">
        <img src="/brand/momoi-hype.gif" width="72" height="72" alt="" />
        <p>Loading<span className="loading-dots" aria-hidden="true">…</span><span className="sr-only"> the voting room</span></p>
      </div>
    )
  return null
}

export function WinnerHistoryNotice({ error }: { error: boolean }) {
  return error ? <Notice className="notice">
    <p>Winner history could not be loaded.</p>
    <Button variant="secondary" onClick={reloadPage}>Reload page</Button>
  </Notice> : null
}
