# Architecture

## Authentication

The application uses Convex as the authority for voting, moderation, history and
authentication. TanStack Start renders the frontend on Cloudflare Workers and
proxies Better Auth through same-origin `/api/auth/*`. The Worker has no D1
binding or session-maintenance cron. The live Worker uses the production Convex
deployment. The former D1 database remains intact, with no vote migration.

The pinned integration is `convex@1.45.0`,
`@convex-dev/better-auth@0.12.5`, and `better-auth@1.6.30`, installed without
peer overrides. The [supported TanStack integration](https://labs.convex.dev/better-auth/framework-guides/tanstack-start)
owns the proxy and React auth bridge. One Convex client belongs to each mounted
application instance. Private identity is not server-rendered; there is no shared
authenticated SSR client. Login, logout and sign-in errors use the voting page.
The backend's default OAuth error redirect also targets that page, so failures
before the saved per-flow callback is recovered do not reach a blocked auth route.

Better Auth owns its account, session, verification and signing-key tables.
Momoi stores immutable Twitch identity, Helix account creation time and provider
maintenance metadata. OAuth tokens stay encrypted in the library's account
record; no second session database or custom root-token bridge exists.

### Twitch sign-in and private sessions

Login uses Twitch authorization-code OAuth with `user:read:email`. There is no
Momoi registration, email/password form or account-linking endpoint. Better Auth
owns state, signed flow cookies, code exchange and callback processing. Its
supported Twitch `getUserInfo` override validates the access token and reads
Helix Get Users. It checks client ID, subject agreement, required scope, expiry
and creation time. It does not trust a decoded ID token or request OpenID scopes.

Root cookies are host-only, Secure, HttpOnly, SameSite=Lax and path `/`.
Sessions use a 30-day inactivity window, renewed at most daily, and a
five-minute Convex JWT in browser memory. Separate browser sessions share one
Twitch grant. Logout removes the current
session and reloads the document to destroy private caches. The final session's
logout/expiry also discards the retained provider tokens.

`requireIdentity` checks the live Better Auth session, its ownership by the JWT
subject, provider authority and expiry. `requireAdmin` additionally checks the
immutable Twitch ID against `ADMIN_TWITCH_IDS`, independently of voting age.
Every protected query, mutation and action uses these guards. Actions repeat
authority checks in their final mutation after external I/O.

The backend itself allowlists login, callback, session, logout, JWT and JWKS
routes. Bypassing the frontend cannot expose token retrieval/refresh, account
editing/linking, alternate login or root bearer authentication. POST routes
require the exact Origin. Private responses use no-store; the default session
token JSON field and root-token response header are stripped. The redundant SSR
JWT cookie is removed. No credential or private ballot is persisted in browser
storage.

Pending-choice intent travels in database-backed OAuth state and attaches to the
new session. It is not put in redirects or cookies. The before-hook captures the
verified state because Better Auth's after-transaction hook runs outside request
context. Consumption is an atomic voting mutation that checks original round,
eligibility, current revision and selection limits. Conflicts retain the intent
for deliberate dismissal.

### Provider maintenance and expiry

`providerWork` is one small due-work record per library account and the sole
authority for live Twitch grant freshness. Better Auth remains the authority for
browser sessions. The work record's `validUntil` is the earlier of the last validation plus one
hour and token expiry; `requireIdentity` checks it along with revocation and the
session invalidation cutoff. Profile validation timestamps initialize this
record during sign-in, but routine maintenance does not read or update
`twitchProfiles`. Public standings therefore do not depend on routine provider
freshness writes. Existing profile timestamp fields remain readable.
A minute cron claims at most 25 due grants, with 30-second leases.
Validation is due at 40 minutes or before access expiry, leaving headroom for
[Twitch's hourly validation requirement](https://dev.twitch.tv/docs/authentication/validate-tokens).
Routine maintenance calls the shared `validateTwitchGrant` helper, checking the
client, immutable subject, required scope and expiry without fetching Helix
profile/email data. Sign-in still uses the full profile checks. Token expiry and
validation timestamps are captured before any subsequent profile lookup.
The sweep includes retained inactive sessions and bounded cleanup of expired
sessions and OAuth state. Background work never extends browser inactivity.

External calls run in actions. Claims, generations and expected encrypted-token
values fence their final mutation against newer login, logout, refresh or
revocation. Only this worker refreshes provider tokens. Transient failures back off durably; expired leases can be reclaimed after a crash.
Definitive authorization loss clears credentials, immediately denies all older
sessions, and deletes those sessions in bounded pages. A revocation cutoff
prevents later cleanup from deleting a new login.

Scheduled mutations delete expired sessions and invalidate stale provider
authority so open subscriptions update when time passes. Every protected call
also checks time directly. The website follows those subscriptions and the auth
bridge; it does not maintain a second local expiry clock or a sticky signed-out
flag that could override a renewed session.
[Scheduled actions are not automatically retried](https://docs.convex.dev/api/interfaces/server.Scheduler);
the persisted due-work record owns retry behavior. Uncertain external refresh
results may ultimately require sign-in again; live Twitch token rotation remains
unverified.

Maintenance logs include bounded counts, backlog age and failure classifications.
They omit cookies, tokens, callback strings and private choices.

### Integration limits

- Distinct Twitch IDs sharing an email receive an explicit
  `account_not_linked` failure and are never merged. Missing email fails login.
  Shared-email rejection is an accepted minor limitation, not a staging or release
  blocker. Do not build a custom identity adapter or prioritize this edge case
  unless actual usage justifies revisiting it. Do not enable automatic linking
  or fabricate email addresses; domain identity remains the immutable Twitch ID.
  Retain Better Auth while investigating the reported account-specific missing-email
  failure. Email-free authentication changes are deferred unless more reports
  justify revisiting the integration.
- The adapter's exported React AuthClient type infers session data as never with
  this package/TypeScript set. A documented cast exists only at the provider
  boundary; the actual client remains typed.
- OAuth signup involves multiple adapter calls rather than one transaction.
  Partial signup and simultaneous initial-login recovery require staging-level
  scrutiny.
- Natural expiry/refresh, provider-side revocation, hosted latency/capacity and
  hosted recovery remain unverified. See [verification](operations.md#verification)
  for the current login verification status.

## Voting backend

`convex/voting.ts` owns indexed users/profiles, stable source IDs, games, rounds,
the current-round pointer, ballots and durable histories. Ballots embed at most
three game IDs. A full replacement carries the expected round and revision;
the mutation derives the actor and enforces age, ban, distinctness, availability,
selection limit and revision. Identical choices are a no-op. Changed choices
and their audit revision commit atomically.

`currentRound` requires the initialized current-round pointer and an open round.
A missing pointer raises `VOTING_NOT_INITIALIZED`; an invalid referenced round
raises `INVALID_ROUND_STATE`. Successful snapshots and ballots always contain a
round ID; `undefined` in the client represents a query still loading, not a
round awaiting opening. Public results do not expose a playback-activation flag.

Bans and ballot exclusions retain independent intervals. Playlist completion
atomically freezes each ballot's inclusion, preserves choices and audits, records
the winner, closes the round and opens its successor with rotation eligibility.
It includes excluded, banned and empty ballots when freezing completion state.
Stale-round reports reject; successor ballots are implicitly empty. Historical
permanent retirement records remain effective, but no manual winner operation
creates new retirements.

Public queries return catalogue, aggregate counts and winner cards without
attribution. `publicSnapshot` owns current catalogue and standings;
`winnerHistory` independently reads completed rounds and legacy winner cards.
Both subscriptions live at the application root so navigation retains loaded data.
History failures do not block ballot editing. Counts derive directly from indexed
current-round ballots and read only the profiles of nonexcluded voters with
selections. The round/user index
also serves round-wide reads through its round prefix.
Private ballot results own pending sign-in choices and omit exclusions; identity
results own eligibility and account authority. Admin directory results contain only
current inspection fields and the open-round ID; they do not read completed-round
history. They paginate at 25 accounts after filtering, using the same page-size
constant as the admin interface. Presentation types derive
from these query results rather than maintaining duplicate response contracts. Legacy
winner cards retain order without invented dates or vote metadata.

Schema indexes serve current query paths. Audit/history records retain every
field and source ID, but unused secondary indexes are not maintained; adding an
indexed inspection path later does not require reconstructing those records.

## Game lookup and addition

`convex/catalogue.ts` owns admin-only search and addition. Actions check the live
admin session before external I/O; the search result query and final insertion
mutation repeat that check afterward. The browser supplies an IGDB ID and
playlist ID when adding. `convex/igdb.ts` fetches fresh name, slug and cover metadata from the
[IGDB games API](https://api-docs.igdb.com/#game), with bounded timeouts and sanitized
errors. Release year and platforms help identify search results but are not stored.

IGDB uses a server-side Twitch application token obtained through client
credentials, independently of user grants and provider maintenance. Warm action
isolates reuse it until shortly before expiry; cold isolates can obtain a new one.
Credentials and tokens never enter frontend responses. Rate limits and provider
failures surface as retryable errors rather than automatic write retries.

New games use `igdb-<ID>` source IDs and the existing optional `igdbId` field.
The addition action fetches IGDB metadata and prepares the supplied playlist
in parallel. One serializable mutation repeats live admin authorization, checks
game and playlist uniqueness, and inserts the game, mapping and immutable sequence
together. Provider failure creates no partial entry. The mutation inserts only when absent, so
concurrent additions and uncertain retries cannot duplicate an IGDB identity.
For legacy games without IGDB IDs, normalized names/slugs are compared with the
provider's title, slug and alternative names. Legacy winner cards are checked too.
This conservative fallback can block a distinct same-named legacy title and cannot
recognize an unrelated legacy alias absent from IGDB. It never rewrites or assigns
identities to existing records. Retired matches stay retired. No migration or
changes to existing games, ballots, rounds, retirements or history are required.
Existing catalogue subscriptions publish newly inserted games to Admin and to
the catalogue before playback activation; a prepared playlist is required before
new votes. Playlist rounds retain their fixed candidate membership.

`catalogue.addPlaylist` prepares a channel playlist before a serializable insertion
of its game record, mapping and immutable sequence. These entries use
`playlist-<playlist ID>` source IDs and `kind: playlist`; title and artwork come
from YouTube. They are excluded from legacy IGDB name matching. Playlist identity
checks make retries and concurrent additions return the existing record.
`playlistAvailability.ts` shares preparation checks between voting and playback.
Unavailable existing choices can remain in a ballot and standings, but cannot be
newly selected. No ballot or history is rewritten to hide an unavailable entry.

The admin-only unused-addition correction mutation checks the exact creation time
and every durable game reference atomically before deleting the unused game and
mapping. A sequence is removed only when no run or other mapping uses it.
The unlinked-entry removal mutation rejects prepared playlists and requires an
explicit vote-removal confirmation, expected round, vote count and game creation
times. It removes the specified current selections, increments each affected
ballot's revision, writes a `game_removal` audit event, clears matching pending
choices and deletes the game records atomically. Prior audit records remain intact.
Completed ballots, candidate snapshots, winners, retirements and playback references
block deletion. No game-archiving field or automatic archival fallback remains.

## Reactive client

The root owns confirmed ballot, latest unsent draft and one submitted mutation.
Clicks render immediately; further clicks coalesce. Convex owns transport,
subscription consistency and retries of that submitted call. Rejections discard
queued stale intent and reconcile saved choices before editing resumes.
Disconnects drop unsent edits; there is no durable offline queue.

Round/account changes fence late results. Public counts come from public
subscriptions, never optimistic private choices. Catalogue row order and
search/sort survive navigation. Admin search, pagination and inspection state
also survive navigation; disconnection disables mutations while retaining the
last view. The ballot subscription owns catalogue-related selection updates;
the voting page does not launch a competing reconciliation read. Explicit
reconciliation remains for uncertain saves and reconnect recovery. Private state
disappears on verified session loss.

Admin operations are serialized by task (playback, playlist saves, game additions)
or affected viewer, rather than by a global busy flag. Unrelated operations remain
available while a request is in flight. Each backend mutation still verifies
authority, current revisions and its domain constraints atomically. The shared
pending-operation set also owns the navigation-away warning.

Admin directory, catalogue and playback reads subscribe only while their section
and the website are visible, using the Page Visibility API. Components retain
inspection context and in-flight mutation outcomes while skipped. Playback status
stays subscribed while visible; local timestamp timers do not issue backend
requests. Viewer search combines keystrokes with a 250ms delay, retaining the
previous results and disabling moderation until the requested search is loaded.
The directory reads game metadata only for its returned page's choices; winner
history reads only the distinct games referenced by completed rounds.

There is no healthy-path public polling or query invalidation framework.
Convex's native `useQueries` owns read subscriptions and errors. A small wrapper
retains the last successful result for the same query and arguments, clearing it
when the query is skipped or changes. Exceptional read failures offer a document
reload rather than custom subscription retries. Admin mutation rejections use the
existing subscribed directory instead of issuing a duplicate reconciliation query.
Local playback-status timestamp timers do not make HTTP requests. Existing theme/components remain;
[product](product.md) owns presentation behavior.

## Fresh start and recovery

`setup.initialize` opens the first round only on an empty voting database.
It does not import games; admins populate the catalogue through prepared playlists
or game lookup with its required playlist. Existing winner history is retained;
there is no winner-entry or reconstruction tool. Any vote reset requires explicit
confirmation; startup and deployment never reset data.
There is no D1 importer, conversion pipeline or source-to-target mapping store.
The retired D1 implementation and migrations remain in Git history. The old
cloud D1 database remains intact; current deployments do not read or write it.

Recovery uses Convex's standard ZIP export/import. Compatible code and private
configuration are restored separately. `MOMOI_MAINTENANCE=restore` blocks public
and private access, login and provider work while a restore is prepared.
`recovery.invalidateRestoredAuth` deletes restored sessions, OAuth state, JWT
keys and pending choices, clears Twitch credentials and invalidates provider
work in bounded batches. Account identities and voting/history stay intact.
Fresh login rebuilds maintenance. Never unlock a restore before invalidation
finishes: a backup can contain a session revoked after it was taken.

## Local playback extension

The extension and playback HTTP endpoints use protocol version 4. Sync accepts
an optional progress report, known sequence ID, observation ID and terminal retry
receipt. It returns a nullable assignment, observation and pending retry request.
The assignment contains the current run header and sequence ID; ordered video
IDs are included only when the extension does not already hold that immutable
sequence. Matching cached sequences avoid both the database sequence read and
its retransmission. Reports carry playback progress and control state, without
video-quality telemetry.
Mismatched protocol versions receive HTTP 426 before pairing or report processing.
Backend and extension must be released together. Existing device credentials,
version-2 local checkpoints and stored historical records remain valid; the local
checkpoint version is separate from the HTTP protocol version. Schema validators
retain fields needed to read existing records, including old quality reports and
commands, without producing them in the current protocol.

The Manifest V3 Chrome/Edge extension in `extension/` builds separately with
`scripts/build-extension.mjs`. Chrome 120+ supports its half-minute recovery alarm.
The toolbar popup owns connection setup, status and Play / Resume. Go to YouTube
only focuses the existing tab; Retry restores playback after a failure. There is no OBS
connection, separate control tab, general remote-control queue or temporary-video
mode. YouTube and the extension own ordinary pause and resume; Admin offers
requested inspection and a bounded Retry playback action for recovery.

Connection requests go to the worker before the popup awaits anything. The worker
requests host permission synchronously in the click's message handler, then owns
the pairing continuation so closing the popup does not cancel it. Permission denial
does not start pairing. This follows Chrome's [user-gesture requirement](https://developer.chrome.com/docs/extensions/reference/api/permissions#method-request).

The background worker owns one managed tab, local checkpoints and device
sync. Content scripts report bounded playback observations and apply assignment
restoration. They receive no device credentials. Managed watch URLs retain playlist
context so YouTube's native playlist panel works. An entry is identified by both
its sequence index and video ID, allowing repeated videos without ambiguity.
Player navigation must match the active immutable sequence; arbitrary navigation
cannot invent entries or complete a round. Other YouTube tabs are not controlled.

Native pause and seeking update local progress. Periodic checkpoints preserve
unexpected-exit recovery independently of shutdown events. Startup restoration
waits for Play / Resume rather than treating a browser launch as permission to
resume. Restoring seeks before playing; an already playing tab is reused without
rewinding. An ending remains pending until the backend acknowledges it, preventing
native autoplay from bypassing the authoritative next assignment.

Local checkpoints are written about every five seconds and on pause, entry
changes, native seeks and endings. Media events queued during a heartbeat are
reported afterward so short seeks and pauses are saved promptly. Browser-session storage retains the
managed tab and pending restoration across worker suspension; a browser restart
restores paused. YouTube player identity and playlist index are inspected in
the page's MAIN world before accepting progress. Those undocumented website
APIs, native navigation and ending-event order require real browser validation.
Only the popup's playback action creates a tab in the current browser window or focuses the existing tab. Automatic assignments
update an existing tab without reopening one the owner closed. Media metadata
must belong to the selected entry before it can update the saved timestamp;
playback errors stay paused across navigation until Retry restores playback.

Restoration sets the requested seek position before starting playback, without
waiting for the seek to finish buffering: a paused seek can otherwise prevent
YouTube from loading. The worker accepts the matching restoration acknowledgment
before media is ready, but does not save progress while seeking. Remote Retry
still requires ready, playing, non-seeking media before reporting success.
The page applies each restoration once, when metadata is available, setting the
seek destination and requested playback together. Media events can apply a pending
restoration immediately; the heartbeat also discovers a late-loaded player and
checks worker liveness. There is no separate quarter-second pause loop. Native
Pause cancellations do not become playback failures, and asynchronous Play
failures are fenced to their navigation and playback attempt. Ending, invalid-entry
and authority holds remain enforced on media events and worker replies.
Retry reloads a pending or unready player, including when restoring only the URL's owner fragment;
a fragment change alone does not clear the page script's latched recovery state.
Ending capture runs on the window before document-level
listeners; navigation alone is never evidence of completion.

Credentials and checkpoints stay in trusted extension-local storage, not page
storage or cloud-synchronized browser storage. This storage is not encrypted.
No Twitch tokens, Google credentials, root sessions or ballots enter the extension.

### Device connection

Admin copies the endpoint and invitation code together, separated by a space.
The popup parses this single value and validates the endpoint before requesting
permission. Unfinished input
is kept in trusted `chrome.storage.session`, survives popup closure, and is
cleared by the worker after successful pairing or disconnect, or by browser exit.

`convex/playback.ts` owns one active device, expiring pairing invitations and status.
Admin operations retain live-session authorization. Invitation codes and device
tokens are stored as SHA-256 digests. The extension proposes a random 256-bit token;
reusing an invitation with that token is idempotent while valid. New invitations
invalidate previous ones; replacement pairing revokes the old device without
removing its records. In the same mutation, pairing assigns the active run to the
new device, increments its revision, and pauses at the existing cloud checkpoint.
Authenticated sync also reconciles an older pairing whose device does not own
the active run, before accepting progress reports. Matching ownership is a no-op;
retries do not repeatedly pause playback or increment revisions. Locked backup recovery invalidates restored credentials.

The dedicated POST routes `/playback/pair` and `/playback/sync` require protocol
version 4. Pairing authenticates its invitation code; sync authenticates the device
token, not browser cookies or root sessions.
Old extensions are rejected rather than allowed to continue the removed OBS
protocol. Device authority permits status/progress reporting and receiving its
assignment, never ballot access, moderation or choosing a winner. A valid ending
can trigger the server's atomic winner selection. Maintenance mode blocks these
routes. Optional host access is limited to the selected HTTPS Convex endpoint;
YouTube scripts never receive its credentials.

Network outages leave the current video playing with local saving. Its ending
waits for reconnection; completion evidence is retained locally for acknowledgment.
Definitive revocation pauses playback on its next authorization check. Historical
command and report schema fields remain readable for existing records, but the
legacy command execution API is removed. Current recovery uses a single bounded
request on the device rather than a generic command queue. No destructive
migration is required.

### Reporting and remote inspection

The extension checks device authority, current assignment and pending requests
about every 30 seconds, with the half-minute alarm recovering a suspended worker.
Cloud progress checkpoints are sent about every 60 seconds while playing, with
prompt reports for pause/resume, seeks, entry changes, endings and errors. Local
saving continues independently of network sync. Unchanged paused progress does
not cause periodic cloud checkpoint writes.

While Playback is visible and connected, Admin calls `playback.requestObservation`
about every 30 seconds to renew a shared 60-second device lease. Renewals keep its
ID; recently renewed leases avoid duplicate writes from multiple admins. Its
first matching report acknowledges the existing deadline without extending it.
During an acknowledged lease, the extension reports about every five seconds.
Expired or replaced echoes cannot restart it. Leaving/hiding the panel or losing
the Admin connection stops renewal; an already submitted request can leave a
bounded tail. Browser responses include the pending deadline, so an outage cannot
keep the extension's observation timer running after expiry. Browser scheduling
and network delays can postpone delivery; timers are not exact cadence guarantees.

The device's `lastSeen` changes on every authorized contact; `reportAt` changes
only with a player report. Ordinary authority checks do not rewrite the saved
report or run checkpoint. Admin displays the report timestamp and stored
position without extrapolation. Runs also record optional `checkpointAt` on
actual progress/pause/navigation changes, new runs and advancement, separately
from mere device contact. Existing runs need no migration or invented save time.
Expiry is derived from timestamps without scheduled cleanup mutations. Outside an observation lease, only recovery
checkpoints and meaningful events carry progress reports.

### Playlist catalogue

`convex/youtube.ts` reads YouTube's official Data API using `YOUTUBE_API_KEY`.
It resolves `LacariVOD` through `channels.list(forHandle=...)` and checks each
playlist's channel ID. Preparation checks every ordered
playlist position and fetches video durations/statuses in batches of 50, rejecting
missing/private/unprocessed/live entries. Limits are 1,000 entries, seven days per
video, a 700KB prepared snapshot and a 45-second provider deadline; no truncation
is allowed. Region/account playback restrictions still require runtime checks.

`convex/playlists.ts` exposes a single save action for linking, refreshing or
correcting an existing game's playlist. It authorizes and checks the expected
mapping/sequence before provider I/O, fetches the channel-verified video list,
then repeats authorization, expected-state and uniqueness checks in the final
serializable mutation. Failed provider reads or stale edits leave the old mapping
intact. Games can use the IGDB addition path; direct playlist additions prepare
and store their title, thumbnail and sequence together.

Prepared metadata points to an immutable `playbackSequences` document, separately
from games and history. Replacement updates the current mapping and creates a
sequence; it does not alter any existing run, checkpoint, ballot or retirement.
The next run for that game uses the revised mapping. Existing pending records
retain optional channel, sequence and count fields until successfully saved.
`isPreparedPlaylist` requires all three before playback or candidate selection.

Catalogue metadata and selected sequence contents have separate queries from
device status, so heartbeats do not retransmit the entire catalogue. Provider
actions share `identity.authorizeAdmin` for session checks around external reads.

### Durable playlist runs

`convex/playbackRuns.ts` owns progress and automatic round completion. The existing
`appState` singleton points to one `playbackRuns` record and holds rotation
membership. Each run retains its immutable sequence reference, current video,
index, checkpoint, revision, device, voting round and completion time. Ordinary
progress validates the current video against this small run record. Native
selection, advancement and initial sequence delivery read the saved sequence;
cached assignments do not.

Admin's `playback.retryPlayback` checks live admin authority, current
run/revision/device and device contact within 90 seconds. It does not require a
healthy player report. A single device request targets the exact run, revision,
video index and video ID, expires after 90 seconds and joins a matching pending
request. Requesting it does not increment the run revision. Sync never delivers
an expired request and fails a pending request if its target changes.

The extension persists a receipt before touching the existing managed tab,
preventing duplicate reloads after an uncertain response or worker restart. It
rejects changed targets, pending completion and closed tabs, then restores the
latest local checkpoint and attempts Play, including if paused. Each
attempt rechecks authority, the target and expiry after tab lookup and storage
writes, before navigation. Its persisted receipt owns the generated control so
failed preparation or timeout can cancel it. An applied
receipt requires the matching restored player to be ready and playing with its
control acknowledged and no error. Same-ID terminal receipts are processed
before timeout cleanup, allowing confirmation that arrives after recovery's
deadline; expired requests cannot start a new attempt. Device ownership and
target matching still apply. Reports mark restoration in progress so it cannot
checkpoint or complete a video before the control is applied.
Admin shows a recovery outcome only while its run, revision and video still
match the current playback, so an old result does not describe a later video.

Admin has no ordinary pause or resume API. Existing run records, historical
commands and version-2 local checkpoints remain readable. Former pause/resume
revision reasons normalize to transfer when restoring an assignment; pending
experimental pause/resume controls are discarded without removing the local
checkpoint. Retry recovery does not write reload revisions.

Admin's `playback.skipVideo` checks live admin authority, the exact active
run/revision/device, contact within 90 seconds and a matching current-video
report without a pending control or completion. It rejects the final entry.
The mutation atomically selects the next saved sequence entry at zero, increments
the revision and writes a playing `reload` assignment. Existing protocol-4
extensions load that assignment in the managed tab and attempt Play even when
the previous video was paused. A matching report is required before another skip;
stale clicks and reports cannot advance it again. No round or ballot changes occur.
Skip does not reopen a closed tab, and a new player report is needed to establish
whether playback actually started.

An authenticated `startRun` explicitly selects initial playback after pairing.
Start checks the current round, device, chosen video ID/index and position.
It snapshots `eligibleGameIds` on the
existing round only if every existing ballot choice remains eligible, including
excluded and banned ballots. It never rewrites ballots. Legacy rounds without that
field keep their original catalogue rules. Pending choices and ballot replacements
check the same candidate membership on the server.

Every device report names its run, revision and video index. Only the assigned
device can checkpoint it. Native selection within the saved sequence validates
both index and video ID and bumps the run revision. Completion additionally
requires a matching video and plausible end position against player duration.
A confirmed ending can be acknowledged after reconnection even when the player
is no longer connected. Pause, close and ordinary navigation never imply completion.
Duplicate or stale reports return the current assignment without advancing twice.
Assignments contain the playlist ID and immutable sequence ID, with ordered
video IDs supplied when missing locally; they are
durable state rather than expiring commands.
Each revision identifies whether it acknowledges native navigation, advances a
finished entry, or transfers playback. A lost navigation acknowledgment therefore
cannot rewind a newer local selection when the device reconnects.

Automatic extension advancement dispatches YouTube's native `yt-navigate` watch
endpoint in the existing page instead of loading a new document. This retains
the player and its user activation/fullscreen across video and playlist changes.
Before navigation, an extension-only message clears the acknowledged ending latch;
the new server assignment still controls identity, checkpoint restoration and Play.
This depends on YouTube's internal navigation event, alongside the existing player
identity API. If the navigation handler is unavailable, playback stops with Retry
instead of silently reloading and losing fullscreen. Explicit recovery
continue to load the saved watch URL.

At a playlist ending, one mutation freezes ballot inclusion, tallies the fixed
candidate set, chooses a tied leader using Convex's seeded randomness, records the
winner, completes the run/round and creates the successor run/round. Zero votes
tie all candidates. This follows Convex's [transaction guarantees](https://docs.convex.dev/functions/mutation-functions#transactions)
and [randomness semantics](https://docs.convex.dev/functions/runtimes#using-randomness-and-time-in-queries-and-mutations).
It writes no permanent retirement. Missing candidate mappings stop the handoff.
There is no manual winner-selection mutation.

The extension persists its run tuple and connection owner alongside progress and
pending completion. Repeated assignments preserve newer local progress. Pairing
or revocation cannot confer an old connection's authority on a new one. Transfer
to a replacement device happens atomically with pairing and creates a paused
assignment at the cloud checkpoint. An offline device may have a newer local
checkpoint, so transfer can replay content. Browser/cloud outages never choose
a winner locally.
