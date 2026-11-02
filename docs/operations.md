# Operations

[Product](product.md) owns behavior; [architecture](architecture.md) owns implementation.
The [session handoff](handoff.md) records publication status, completed checks and
remaining work and deferred checks.
The live app at https://momoi.joe2xyb.workers.dev uses Convex production
`YOUR_PRODUCTION_DEPLOYMENT`; cloud development uses `YOUR_DEVELOPMENT_DEPLOYMENT`. The previous
D1 database is retained and is no longer written by this Worker.
Deployment, cloud setup, Twitch configuration changes, and
vote resets require explicit authorization. No reset runs during startup or deployment.

## Configuration

Use Node 22.12+ and `npm ci`. Run `npm run configure:backend` once to sign in and
select the intended project with a hosted development deployment. It runs
`convex dev --configure --dev-deployment cloud --once`. Use an existing Momoi
project if available; create one only when needed. No local Convex database is used.

After setup, `npm run dev:backend` syncs code to that cloud development deployment.
Run `npm run dev` in another terminal and use http://localhost:3000. Development
and production have separate databases, environment variables, and endpoints;
never point ordinary development commands at production. This follows
[Convex's deployment workflow](https://docs.convex.dev/production/overview).

Set these variables on each Convex deployment:

| Variable | Value |
| --- | --- |
| `SITE_URL` | Exact frontend origin, such as `http://localhost:3000` for development or the HTTPS production origin |
| `BETTER_AUTH_SECRET` | A private, randomly generated secret |
| `TWITCH_CLIENT_ID` | Twitch application client ID |
| `TWITCH_CLIENT_SECRET` | Twitch application secret |
| `ADMIN_TWITCH_IDS` | Comma-separated immutable Twitch IDs |
| `YOUTUBE_API_KEY` | Server-side YouTube Data API v3 key, required only for playlist preparation |

IGDB lookup also uses `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` on the Convex
deployment for [Twitch client-credentials authentication](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#client-credentials-grant-flow).
It needs no additional browser credentials, user scopes, or callback changes.
If lookup fails, verify these backend application credentials and IGDB access;
never put the application secret or access token in a `VITE_*` variable.

Convex supplies `CONVEX_SITE_URL`. The Twitch application's allowed callback must
match `<SITE_URL>/api/auth/callback/twitch`. Login requests Twitch email permission;
there is no separate email/password login. Secure cookies require HTTPS except
for browsers' localhost allowance.

The production callback registered in Twitch is exactly
`https://momoi.joe2xyb.workers.dev/api/auth/callback/twitch`. A
`redirect_mismatch` error means the requested callback is not registered for
the configured Twitch client ID. Update that application's OAuth Redirect URLs,
save, and start a fresh sign-in from the site. No new secret is needed.

The cloud development deployment has the existing Twitch application's client
credentials and admin allowlist configured, with `SITE_URL=http://localhost:3000`.
That Twitch application also accepts `http://localhost:3000/api/auth/callback/twitch`.
Complete interactive sign-in with the admin's own browser session to use the
authenticated controls.

The frontend requires `VITE_CONVEX_URL` (the Convex client URL) and
`VITE_CONVEX_SITE_URL` (the same deployment's HTTP actions URL). Use environment
variables or an ignored `.env.local` for development. The selected cloud
deployment supplies its HTTPS client and HTTP actions URLs; remove old loopback
URLs when switching away from a local backend. Production builds need
production values. These URLs are public; never put secrets in `VITE_*` variables.
Vite rejects missing endpoints rather than connecting to a fixture server.
The frontend Worker has no private auth bindings or D1/session cron.

## Diagnosing Twitch sign-in failures

For `?error=unable_to_get_user_info`, capture the attempt time with timezone and
the error value. This failure occurs during Twitch token validation, profile
lookup or profile persistence, before a Momoi session is created. A missing
profile does not identify which step failed.

After the diagnostic backend change is deployed, inspect production Convex logs:

```powershell
npx convex logs --deployment YOUR_PRODUCTION_DEPLOYMENT --history 1000
```

Start watching before asking the affected voter to retry once. Search for
`twitch_sign_in_failed` near their attempt time, or use the Convex dashboard's
request details. The event contains a fixed `stage` and `reason`, an HTTP `status`
when available, and elapsed `durationMs` when profile retrieval was attempted.
It contains no username, email, Twitch ID, token, cookie, callback URL or provider
response. Concurrent attempts need timing/request correlation; these events do
not identify a voter by username.

`missing_email` means the profile response lacked an email; check the account's
Twitch email settings. `missing_email_scope` means the grant lacked
`user:read:email`. `timeout`, `network_error` and `http_error` distinguish provider
request failures; HTTP 429 indicates rate limiting. Other reasons identify a
rejected identity/profile field. `profile_persistence` with `unexpected_error`
means the validated profile could not be saved; inspect that request's mutation
failure. Better Auth's unrestricted provider logger remains disabled.

The current publication and verification status is in the
[handoff](handoff.md#publication-and-verification-state). Deployment still
requires explicit authorization. Do not request tokens, email addresses, full
callback URLs or unredacted network exports from voters.

## Deployment

Select the intended Convex production deployment and Cloudflare account.
`wrangler.jsonc` targets the existing `momoi` Worker at
`https://momoi.joe2xyb.workers.dev`. Set backend variables and the Twitch callback
for that origin. Supply the production `VITE_CONVEX_SITE_URL` to the build
environment; do not reuse the development HTTP actions URL.

For this production deployment, run the following after deployment is authorized:

```powershell
$env:VITE_CONVEX_SITE_URL = 'https://YOUR_PRODUCTION_DEPLOYMENT.convex.site'
npm run deploy
```

The package command runs:

```powershell
npx convex deploy --cmd "npm run build"
npx wrangler deploy --config dist/server/wrangler.json
```

The package script stops if either the build or backend deployment fails.
Convex supplies the production `VITE_CONVEX_URL` to the build command. In CI,
provide the selected production `CONVEX_DEPLOY_KEY` and restricted Cloudflare
credentials through the CI secret store. Never commit credentials.
This follows [Convex's build/deploy flow](https://docs.convex.dev/production/hosting/custom)
and [Cloudflare's TanStack Start integration](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/).

Deployment updates code; it does not populate games, reset votes, or migrate D1.
Further data changes require explicit authorization. Rollback must use a release
compatible with the current Convex records and preserve all votes and history.
The retired D1 implementation in Git history is not a rollback target for the
current live voting database.

## Verification

Run the [typecheck and build commands](../README.md#verification). Browser checks
use the real Twitch flow and write to the selected deployment. Check sign-in,
sign-out, account-age restrictions, ballot saves, rankings, and admin access.
Also check mobile layout and updates between two browser tabs. There is no
maintained fixture or automated test harness.

Accepted authentication limitations are in
[architecture](architecture.md#integration-limits); completed checks and remaining
verification are recorded in the [handoff](handoff.md#publication-and-verification-state).

## Admin use

Sign in at `/admin` with an allowlisted immutable Twitch ID. Admin access does
not require voting age. Playback opens by default; Games & playlists owns games and
playlist links, and Viewers owns voter moderation. Winners are selected only
when playlist playback completes. Search/filter accounts and use
Manage for independent voting bans and current-ballot exclusions.

In Games & playlists, use Add game, enter a title, and select Search games. Check the
artwork, year and platforms. Paste its LacariVOD playlist URL/ID in the same
dialog, then click Add on the correct result. The game and prepared playlist are
saved together. Before playback activation it appears in voting immediately;
during playback it can join a future round. Added and Retired results cannot be added again. If a save cannot
be confirmed, retrying Add is safe. A busy lookup can be retried after a moment.

Use Add playlist in the same section for cooking, trips, podcasts or a specific
playlist spanning game versions. Paste a LacariVOD playlist URL or ID, then add it. Its title, thumbnail and complete playback sequence are
saved together. Repeated adds return the existing entry. Skip dedicated PvP games
and general stream/variety VOD collections.

Entries without a prepared playlist are unavailable for new votes and winner
selection. New game additions require a playlist in the same save. When removing unlinked catalogue
entries, confirm the games and current selections to remove with the user first.
The admin-only `catalogue:removeUnlinked` API accepts `entries` with source IDs and
exact creation times, `expectedRoundId`, `expectedVoteCount` and
`confirmVoteRemoval: true`. It checks the absence of prepared playlists and removes
those game records and current selections atomically, preserving other choices
and recording ballot audit revisions. A changed round or vote count stops the
operation for review. Historical round/playback references require a separately
agreed scope. There is no archiving fallback or alternate unlinked-entry list.
The admin-only `catalogue:removeUnusedAddition` API supports correcting accidental
additions using the game source ID and exact `expectedCreatedAt`. It rejects entries
referenced by votes, audit history, rounds, playback, retirements, winners or pending
choices. There is no general catalogue deletion control; preserving records takes
precedence over removing an accidental entry with history.

A round transition preserves completed ballots and opens an empty successor.
It is not a destructive vote reset. Any requested reset waits for explicit
confirmation of its target and scope.

## Catalogue and artwork

For an empty deployment, run `npx convex run setup:initialize` against the
selected development backend. It opens the first round atomically with an empty
catalogue. Add prepared playlists through the [admin flow](#admin-use). It refuses
to run if games, rounds, the current-round pointer, or ballots already exist. It never
resets votes and does not run automatically during startup or deployment.
Before initialization, voting queries report a configuration error; there is no
normal "voting has not opened yet" screen.
Production initialization requires separate authorization and an explicit
production target.

[Brand artwork sources](../data/brand-artwork.json) document `public/brand/`.
Existing games retain their accepted artwork URLs in Convex; detailed sourcing
records remain in Git history. Record attribution when changing catalogue artwork.
Retired D1 migrations are available in Git history and are not part of the current deployment.

Games added through Admin store their IGDB ID and cover URL from
[IGDB](https://api-docs.igdb.com/#images); the search dialog credits that source.
Existing accepted artwork stays intact. No catalogue file regeneration or data
initialization is needed to release the addition feature.

Entries added directly from a playlist use the channel-provided playlist thumbnail;
their title and artwork come from YouTube rather than IGDB.

After an authorized deployment, verify search, empty results, artwork fallback,
addition and its live appearance in another voting tab. Check duplicate/repeated
adds, retired matches, concurrent adds from two admin tabs, and rejection for
signed-out/non-admin callers. Confirm existing choices and round history remain
unchanged.

## Recovery

Use Convex's standard backup/export and restore facilities. Keep compatible code
and private configuration separately. Backups contain private ballots and auth
records and must have restricted access.

Before restoring, isolate the target and set `MOMOI_MAINTENANCE=restore`. Deploy
compatible code, restore the backup, then call `recovery.invalidateRestoredAuth`
repeatedly, passing `nextCursor` as `cursor`, until it returns no cursor and
`changed: 0`. Verify the restored data before removing the maintenance variable.
Everyone must sign in again: a backup can contain a session revoked after it was
taken. This recovery support remains part of the real backend.

## Local playback extension

Most playback verification can run on a development computer using the unpacked
extension, real YouTube and the authorized Convex Cloud development backend.
Use a matching backend release and an authorized active development run for
playback checks. Local testing does not require OBS or the streaming computer;
reserve final capture/audio and machine-specific checks for that computer.

### Coordinating with the streaming-computer owner

The API key and YouTube Premium playback are separate setup tasks. The maintainer
can own the API project; the owner signs into Premium locally. Never request
passwords in chat. Follow [YouTube API setup](#youtube-api-setup) for the server key.
Arrange access to the Windows computer, permission to install an unpacked extension,
the intended Chrome/Edge profile, and the current playlist/video/position to preserve.
Prepare the extension first; transfer no private environment files.

No OBS WebSocket, scene setup or live broadcast is required for playback checks.
The owner configures ordinary window capture independently. The development endpoint
is https://YOUR_DEVELOPMENT_DEPLOYMENT.convex.site; localhost is only the maintainer's Admin UI.
Pairing, activation and deployment require appropriate explicit authorization.

### Build and installation

Run the extension build command in [README](../README.md#verification). Install
the build only after its matching backend is released; a protocol mismatch blocks
pairing and progress sync with an update-required response. See the
[protocol contract](architecture.md#local-playback-extension).
Copy `extension/dist/` to a persistent folder on the computer being tested. In Chrome 120+
or corresponding Edge, open the extensions page, enable Developer mode, choose
Load unpacked and select the folder. Pin Momoi Playback; its icon opens a toolbar
popup. Pair there using the procedure below.

Sign into YouTube Premium in that profile and avoid extensions that alter playback.
With a run assigned, click **Play** to open or reuse the dedicated tab in the current browser window
and play from the saved position. Native YouTube controls handle pause, resume,
seeking and playlist navigation. Other YouTube tabs remain independent.
Pause YouTube or close its tab before ending the broadcast; Momoi does not
observe OBS. There is no separate Stop button.

Unexpected exits recover from periodic checkpoints using Play / Resume; allow a
short replay after an abrupt interruption. Retry retries a failed
video. Rebuild and copy updates to the same folder, then use the browser's Reload
button for the extension and click Play / Resume to restore the managed tab with
the updated page script. Enter YouTube player fullscreen again after that reload.
Pairing, the active run and saved progress remain intact. Uninstalling clears
local credentials and checkpoints. This is a private
unpacked installation, not a store release.

### Remote inspection and recovery

Open Admin → Playback to load the saved position and request fresh player
information automatically. The initial report arrives after the browser discovers
the request; updates continue while this panel is visible. Switching sections,
hiding the website or disconnecting stops renewal, and frequent reporting expires
within about a minute of the last successful renewal. Other admins share the
same lease. The panel shows the last player report and cloud recovery save
separately. Open current video on YouTube helps inspect unavailable media.
Browser contact in Browser settings does not prove that the YouTube player is
currently playing. See [reporting](architecture.md#reporting-and-remote-inspection)
for background checks, checkpoint cadence and request deadlines.

If the video stops, use **Retry playback** to attempt to restore and play the
same video from the extension's latest valid local position, including if it was
paused. Keep the managed YouTube tab open. Wait for confirmation that playback
resumed or for the reported failure; sending the request alone is not success.
If the tab is closed, use Play / Resume in the extension instead. Retry cannot
wake the computer, open a closed browser or fix an unavailable network. An
expired request must be deliberately requested again. None of these actions
selects a playlist or manually completes a voting round.

To bypass a stuck video, use **Skip video** in Admin Playback. It requests the
next video from the beginning using the installed protocol-4 extension; no
extension update is needed. Keep the streaming browser and managed tab open,
and check fresh player status to confirm playback. Skip is disabled on the last
video and while the browser has not acknowledged the current video. Skipping
does not change votes or the voting round.

After an authorized release and matching extension installation, check:

- Verify automatic observation, first-report acknowledgment, renewal and shared
  leases. Leave/hide the panel and confirm frequent reporting expires; reopen it
  to resume. Stale echoes must not restart an expired lease.
- Player-report timestamps stay separate from browser contact, and saved
  positions do not move between reports. Check background authority requests
  and cloud checkpoints outside an observation lease. Unchanged paused progress
  must not produce new checkpoint timestamps or writes.
- Retry on an errored or unresponsive player and on a paused video. Confirm
  resumed playback before success appears, and preserve the latest local seek.
- Closed tabs, changed videos, pending endings, expired requests and duplicate
  delivery do not cause a delayed reload or reopen a tab.
- Switching Admin sections pauses hidden reads and preserves filters, edits
  and the eventual outcome of an operation already in flight.
- Retry remains available during unrelated catalogue work; viewer search combines
  typing while keeping input immediate and moderation disabled on stale results.

These checks use the existing authorized run and real browser state; they do
not require resetting votes, repeating initial activation or synthetic records.

### Game-to-playlist mappings

After the [YouTube API setup](#youtube-api-setup), open Admin → Games & playlists, find
the game, and choose Link playlist or Edit playlist. Inspect the saved YouTube
link, paste a replacement playlist URL/ID, then Save. The server verifies channel ownership and the complete video list
before replacing the link. No separate preparation or bulk mapping step is needed.
A paired device is not required for catalogue work.

If saving fails, the existing link remains unchanged. If another admin changed
the mapping, reopen the editor to review it before saving again. Previously stored
pending links can be completed or corrected in this same editor; they cannot
be loaded or used as voting candidates until saving succeeds. Correcting a
prepared link leaves active playback, checkpoints, games, ballots and history
intact. The next run for that game uses the corrected link.

### YouTube API setup

Playlist preparation uses public metadata through a server-side API
key. Momoi needs no Google OAuth client, consent screen, or Google account login;
signing into Google is only needed to manage the Cloud project. This follows
[YouTube's credential guidance](https://developers.google.com/youtube/registering_an_application).

1. Sign into the [Google Cloud console](https://console.cloud.google.com/), open
   the project selector, and choose New project. Name it `Momoi`, create it, and
   select it. Keep the project under an account you control.
2. Open APIs & Services → Library, find **YouTube Data API v3**, and select Enable.
   See [YouTube's setup instructions](https://developers.google.com/youtube/v3/getting-started#before-you-start).
3. Open APIs & Services → Credentials → Create credentials → API key. Give it a
   descriptive name such as `Momoi development`. Use a standard API key without a
   service-account binding.
4. Under API restrictions, choose Restrict key and select **YouTube Data API v3**,
   then save. For this Convex setup, leave Application restrictions as None:
   requests originate in the cloud backend, so website/HTTP-referrer restrictions
   for localhost or the frontend would reject them. Do not restrict to the
   streaming computer's IP either. Server IP restrictions need a known, stable
   backend egress address, which this setup does not configure. Google documents
   the [restriction types](https://docs.cloud.google.com/docs/authentication/api-keys#api_key_restrictions).
5. In your own terminal, from the repository directory, run the following command
   and paste the key only into its hidden interactive prompt:

   ```powershell
   npx convex env set YOUTUBE_API_KEY --deployment YOUR_DEVELOPMENT_DEPLOYMENT
   ```

Keep the key out of chat, shell command arguments, repository files, `VITE_*`
variables, and extension settings. The command targets development explicitly;
setting this variable does not deploy code, change ballots, or start playback.
Production credentials belong to the later authorized release; use a separate
restricted key there. Playback starts only after pairing and explicit playlist
selection in Admin.

### Device pairing and playback checks

Deploy matching backend/frontend code to the intended development target only
when authorized. Production release requires separate authorization. Complete
[YouTube API setup](#youtube-api-setup) and prepare mappings through the
[Catalogue editor](#game-to-playlist-mappings). Saving links preserves votes and
does not enable automatic transitions.

In Admin Playback, use **Create pairing details** under Connect your browser
(or **Pair another browser** in Browser settings). Use **Copy pairing details**,
paste into the extension's **Pairing details** field, click **Connect**, and approve access to that exact
backend. Use the Convex HTTP actions endpoint ending in `.convex.site`, not its
`.convex.cloud` client endpoint or the frontend URL. Codes last ten minutes; creating
another invalidates the previous code. Pairing replaces the active device.
Keep codes private; the long-lived token stays in the extension.
Unfinished input survives closing and reopening the popup for the current browser session; successful pairing or disconnect clears it.

Admin shows the saved playlist position and automatically requests fresh player
information while Playback is visible. Disconnect browser in Browser settings pauses the
device on its next successful authorization check. Disconnect in the popup removes
local credentials; use Disconnect browser in Admin to invalidate server authority too.
Pairing alone does not start a run or change ballots.

Verify real pairing, replacement/revocation, expired codes and unauthorized API
rejection. Check playlist ownership, unavailable entries, duplicate mappings,
stale edits and preservation of ballots. Failed saves preserve the old mapping;
corrections affect future runs. Check Admin section switches retain edits and
history-read failures do not block voting. No fixture harness is required.

With an authorized active development run, verify:

- Play / Resume opens the saved entry/position; repeated clicks neither rewind
  nor create duplicate players.
- Native pause/play updates Momoi. Forward/backward seeks save their new positions.
  Playlist-panel navigation updates the entry without completing a voting round.
- Closing the tab/browser, sleep/wake and restart recover through Play / Resume.
  Restored tabs stay paused until started. Abrupt exits may replay a few seconds.
- Cloud connection loss permits current playback and local saving, but an ending
  waits for reconnection. Recovery must not duplicate transitions.
- Errors stop at the affected video; Retry playback restores it. No unavailable
  entry is silently skipped. Other YouTube tabs stay untouched.
- Native autoplay cannot bypass a pending server handoff. Ads and buffering are
  not completion. Test repeated video IDs and playlist edits against the saved
  sequence, including navigation to earlier entries.
- Enter YouTube player fullscreen, then let an entry and a whole playlist finish.
  Both successors must play automatically and appear fullscreen without another
  click; a brief exit and automatic return is acceptable. Initial startup
  and explicit Retry may require entering fullscreen again.
- Long playback and captured picture/audio work on the real streaming computer.
  No live broadcast is needed for Momoi's checks; OBS is not connected.

See [architecture](architecture.md#local-playback-extension) for implementation
boundaries and [product](product.md#local-playback-extension) for behavior.

### Automatic playlist activation

Complete authenticated connected checks on the intended cloud development
deployment, followed by the real streaming-computer trial, before production activation.
No setup, deployment, pairing or service restart automatically starts a run.

For an active run, use [remote inspection and recovery](#remote-inspection-and-recovery).
YouTube and the extension own ordinary pause and resume. Keep the managed tab
open and the extension connected. If Admin asks for an extension update, replace
the unpacked files only after the matching backend is released, then reload the
extension in Chrome/Edge; the connection and saved progress remain.

After pairing and catalogue checks, save playlists for at least two nonretired
games. In Playback’s Choose your first playlist,
review any existing-ballot mapping blockers, select the current playlist, exact
video and seconds, then confirm Use this playlist. Existing ballots must all remain
eligible; no reset or selection removal is performed. A retired game's playlist
may be used as the initial playback without reactivating it for voting.

Click Play in the extension. Validate consecutive video
endings, repeated video IDs, a whole-playlist winner transition, ties and zero-vote
selection, rotation exhaustion, and preservation of completed ballots. These are
real development rounds and records, not fixtures or production vote resets.
Also check duplicate completion reports/reconnects, native pause around an ending,
cloud interruption at an ending, and browser restart. Verify mapping edits leave
the current run unchanged.

When replacing a streaming computer, pair it; the saved playlist is assigned
automatically at the cloud checkpoint. Existing paired devices reconcile on their
next sync. Review the saved position before Play / Resume; the last
local checkpoint on the old computer may be newer. Revocation and backup recovery
keep run/history records but invalidate device authority. Pause on YouTube or
close its tab to stop local playback; disconnect the browser in Admin to revoke
its server authority.

Production deployment requires authorization. It does not select an initial
playlist or start playback. Record verified results and remaining limitations
in the [handoff](handoff.md).
