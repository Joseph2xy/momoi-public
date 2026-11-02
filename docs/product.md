# Product

Momoi lets a Twitch community choose games for the next VOD. Voters express
preferences during an open round. Finishing the current playlist selects the
next game from those preferences. Before playback is activated, voting remains
open; admins cannot choose a winner or advance the round manually.
This document defines product language, behavior, and interface intent.

## Users

Twitch community members browse games and express their preferences. Authorized
admins manage playlists, playback, voters and ballots. Viewers mostly use
desktops; mobile remains a supported interface.

## Product Purpose

Help the community express what it wants to see in the next VOD and help the
admin manage those preferences. Admin usability is a priority: make choosing
playlists and inspecting voters efficient. No quantitative usability target has
been established; evaluate improvements through concrete screen walkthroughs.

## Operating Context

Prioritize desktop workflows during review while checking mobile usability.
Review screens and their interaction states together with the user. Product
decisions and features may be reconsidered when a concrete usability benefit
emerges; existing rules remain authoritative until a change is agreed.

UI improvements must preserve the general theme and existing text. Layout,
components, and interactions may change within that constraint. Discuss any
proposed copy or product-rule change with the user separately.

Use white for titles, important values and actions on dark rose surfaces. Use
light neutral gray for supporting text and a quieter neutral gray for small hints
and metadata in the website and extension. Retain pink for selected accents and
dark labels on pale pink controls. Preserve text hierarchy without rose-tinted
body text.

## Evidence on Hand

The current application supplies the implemented flows and copy. The public
catalogue and artwork sources are documented in
[operations](operations.md#catalogue-and-artwork). The user has
identified desktop as the primary device context and admin usability as an
improvement opportunity. No observed user-testing findings are recorded.

## Product Principles

- Make browsing, selecting, and revising preferences understandable.
- Make admin actions and their consequences clear before acting, and provide
  reliable feedback afterward.
- Preserve private voter information and durable voting history.
- Evaluate existing features against the user's task; discuss substantive
  changes rather than treating current implementation choices as fixed.

## Feature scope and simplification

Every feature should have a concrete user task that justifies its interface,
state and failure handling. Prefer a single place to perform the task; do not
turn setup and recovery tools into required daily work. Removal should reduce
real maintenance or operator effort, not merely move complexity elsewhere.
The agent guide applies this check to future work across the application.

Current decisions:

| Area | Decision and reason |
| --- | --- |
| Voting, search, rankings and winner history | Keep: choosing games, finding them and seeing outcomes are the public product. |
| Automatic saving and conflict recovery | Keep: rapid edits, multiple tabs and round changes must not overwrite newer votes or falsely report success. |
| Bans and ballot exclusions | Keep both: account-wide voting access differs from excluding a single round's ballot. |
| Viewer directory | Moderation uses accounts already recorded in Momoi. There is no external Twitch account lookup. |
| Game lookup and playlist editor | Adding a game requires its prepared playlist in the same save. The playlist editor owns correction and refresh; direct playlist additions use YouTube metadata. |
| Playlist URL entry | Paste a LacariVOD playlist URL or ID in the editor; discover playlists on YouTube. There is no in-app channel browser. |
| Extension controls | One toolbar popup owns connection setup, status and the appropriate Play, Resume, Retry or Go to YouTube action. Native YouTube controls own pause, resume, seeking and playlist navigation. |
| OBS integration and temporary playback | Remove: OBS captures the browser independently; arbitrary-video interruptions and return controls are outside the agreed scope. |
| Playback inspection and recovery | Playback updates automatically while its panel is visible; frequent reporting expires shortly after leaving or hiding it. Reports and cloud recovery saves have distinct timestamps. Retry playback attempts to resume the existing managed tab, including if paused, and remains available during unrelated catalogue work. Play / Resume in the extension can reopen a closed tab; there is no separate Stop button. |
| Device pairing and revocation | Pairing automatically assigns the saved playlist to the new browser, paused at its cloud checkpoint. Replacement preserves progress and revokes the old device. |
| Setup and backup recovery | Keep: infrequent operational tools protect existing records. Pairing and explicit initial playlist selection control playback startup. |

## Voting and identity

A **Twitch voter** is a Twitch account at least 30 days old. Eligibility follows
the account, not the person or device; one person may own multiple qualifying
accounts. An **admin** is an explicitly authorized Twitch account. Admin access
is independent of voting eligibility, and an eligible admin has one ordinary,
equally weighted ballot.

Sign-in persists across visits and renews during use, with no fixed logout date
measured from the original sign-in. Signing out, loss of Twitch authorization,
or a missing browser cookie requires signing in again. Abandoned browser sessions
eventually expire; the current inactivity window is defined in
[architecture](architecture.md#twitch-sign-in-and-private-sessions).

A **ballot** belongs to one voter in one voting round and holds up to three
distinct **selections**. Each selection has equal weight. Choosing a selected
game removes it; unused selections have no effect. Changes save automatically
without a submit step. Attempting a fourth selection leaves the ballot unchanged
and shows a nonblocking toast asking the voter to remove a choice first.
Adding or removing a choice shows an updating toast naming the game, followed
by success only when the server confirms the save. Rapid edits reuse one toast.
Buttons retain their ordinary voted/unvoted labels. Failed or uncertain saves
retain an in-page recovery message after the notification disappears.

Signing in after choosing a game can resume that one choice in its original
round. If the round or eligibility changes during sign-in, the interface explains
the conflict and lets the voter dismiss it or make a fresh choice. A stale tab
or uncertain save reloads confirmed choices before accepting new edits.
When that reconciliation succeeds, editing resumes immediately with an explanation.
If reconciliation fails, the voter can explicitly reload the page. Ordinary
background refreshes keep confirmed choices visible and do not interrupt selection.

Exceptional account, catalogue, or ballot read failures show an error and a
Reload page action, including when the first read fails. Previously confirmed
information stays visible where available; failed reads pause voting changes.
Ordinary connection interruptions reconnect automatically. An explicit recovery
reload resets search, filters, and open dialogs, but preserves server-saved votes
and any still-valid login. Leaving during a save retains the unconfirmed-change warning.

## Rounds and catalogue

A **voting round** stays open until a **round transition**: the current playlist
finishes and the votes choose its successor. That ends the current round and
immediately opens the next one.
There is no scheduled ending or intermediate locked period. Every voter begins
the new round with an empty ballot; completed ballots remain preserved.
An initialized app always has an open voting round. A missing round is a backend
configuration error, not a public waiting state. Vote explains when the winning
playlist will play without a separate pre-activation message.

The **round winner** in playlist mode is the eligible game with the most included
selections. Tied leaders are chosen randomly; with no votes, all candidates tie.
Games already selected in a rotation leave voting until that rotation is
exhausted. The next rotation excludes the currently playing game to prevent an
immediate repeat. Existing permanent retirement records remain effective.

The **game catalogue** stores games and specific non-game playlists such as cooking
and trips. Dedicated PvP games and general stream/variety VOD collections are
outside the requested playlist catalogue. Each item available for a new vote must
have a complete, prepared LacariVOD playlist. Unlinked entries are removed from
the catalogue on admin request. Deleting entries with current votes requires
explicit confirmation to remove those selections. Other choices remain intact,
and each changed ballot receives an audit revision. Do not archive entries as an
assumed alternative to a requested deletion.

Admins can
search IGDB from Admin, review matching titles with artwork, release year and
platforms, and add a game with its LacariVOD playlist in one save. Metadata and
artwork are filled in automatically. The complete playlist is prepared before
the game, mapping and video sequence are saved atomically; failures create no
partial entry. Before playback activation, prepared additions become available
without changing existing choices. Add playlist uses the
channel's title and thumbnail for non-game topics or playlists spanning game versions.
Playlist mode instead uses selected LacariVOD
playlists; newly saved games can join a subsequent round and do not change its
current candidate snapshot. Existing games cannot be added again, including retired
games and past winners. Missing or failed artwork falls back to initials.
The application provides no manual metadata entry, editing, general deletion, manual
retirement or reactivation, bulk import, winner correction, or historical ballot
inspection. Admin APIs support unused-addition correction and removal of unlinked
entries after checking creation time and durable references atomically. Confirmed
unlinked removal clears only the requested current selections and pending sign-in
choices, preserves prior audit records, and deletes the game records. Completed
ballots, round membership/winners, retirements and playback references block this
operation; their removal requires a separately agreed scope.

Use “voting round,” “round transition,” and “round winner” in explanations.
Avoid election terminology and treating a
changeable Twitch username as an identity.

## Results and privacy

**Public results** show current aggregate standings without authentication.
They never identify individual voters or their ballots. The participating-voter
total counts included ballots with at least one selection.

**Vote share** is a game's included selection count divided by all included
selections. Shares total 100 percent apart from rounding when there are votes;
they are not percentages of voters. Rankings use competition ranks with ties
and omit unvoted games. Empty results provide a clear path back to voting.

Rankings feature the top three ranks with larger artwork and titles above the
remaining compact rows, with equal treatment for ties. Every game shows its
position, vote count, percentage, and a consistently scaled percentage track.
The heading shows total voters and total votes. A separate "Standings continued"
section holds the remaining games with votes; unvoted games are omitted.
Rankings use a direct heading without a promotional tagline. Rank badges use
white text on opaque dark backgrounds; vote counts and totals also use white.

**Winner history** is a read-only collection of winner game cards. It does not
expose completed ballots, historical totals, final rankings, or voting controls.
Imported legacy winner cards have no invented round dates or vote metadata.

Past winners has one expandable section beneath the rankings. It loads separately
from current standings and remains available when current results are empty or
unavailable. A history read failure retains previously loaded winners and offers
Reload page; it does not interrupt voting or current results.

## Moderation

A **ballot exclusion** reversibly omits one current-round ballot from results
without notifying its voter. It does not prevent editing or affect eligibility
in later rounds.

A **voting ban** makes an account ineligible until lifted, omits its current
ballot, and persists across rounds. An admin can ban an account before it votes.
Bans and exclusions are independent: lifting one does not undo the other.

A banned voter can still browse Vote and Rankings. Vote displays “You're banned
from voting.” and disables adding, removing, and replacing choices. Live session
updates reveal a newly applied ban and restore voting after an unban when the
account also meets the age requirement. Every save checks current eligibility
on the server. Saved choices remain visible. A ban does not remove an admin's
access to moderation tools.

The admin can inspect a voter's current game choices and attribution. Public
results never reveal that attribution. Completed-round inclusion is captured at
transition and cannot be rewritten by later bans or exclusions. Audit records
remain stored internally.

## Interface

The browser tab title is `momoi`; the site header retains the full ministry name.

Navigation presents Vote, Rankings, and then Admin for authorized accounts.
Once verified, Admin stays visible during background account checks and temporary
read failures. Confirmed logout or loss of admin access removes it. Moving between
pages retains loaded data, voting search and sort, and admin inspection context.
Saves continue across navigation; leaving the application while a save is in
flight warns about unconfirmed changes.
Admin has Playback, Games & playlists and Viewers sections, initially opening Playback.
Playback shows one current-playlist summary and a next action. Initial connection
and playlist selection are visible during setup; connection management stays in settings.
Games & playlists groups Add game and Add playlist in its heading. Its directory
shows artwork and game names alongside playlist links, readiness and Edit playlist.
Search matches game names and linked playlist titles. Games and viewers use
25-row pages with search above the list; changing search resets the page.
Viewers owns the voter directory.
Switching sections preserves ongoing operations and the current inspection context.
An ongoing operation blocks another operation on the same task or viewer;
unrelated admin work remains available.
Hidden sections pause their read subscriptions while retaining filters, edits and
the results of operations already in progress. Hiding the website also pauses
Admin reads. Playback subscribes while visible and requests fresh player reports
automatically; switching sections or hiding the website stops renewal.
Add game opens a labelled dialog with a required playlist URL/ID and game search;
each result has its own Add button, enabled only with a valid playlist input.
Search runs on submission and shows up to twenty matches; refine the title to
narrow results. Existing matches show Added or Retired. Search and addition show
progress and recoverable errors. Closing the dialog during an addition does not
cancel it; reopening or returning to Admin shows its outcome.

The voter directory shows each account's current choices, game thumbnails, and
moderation status without a separate inspection step. The display name appears
once; a separate @login appears only when it differs beyond capitalization.
Search filters the directory as the admin types, with a short delay that combines
keystrokes into one request, matching any part of the login, display name, or
immutable ID without a submit step. Previous results remain visible while the
new search loads; moderation waits for matching results. The directory defaults to
current voters; the filter also offers all accounts, excluded ballots,
or banned accounts. All accounts includes viewers who have not voted in the
current round. Current voters includes any nonempty current ballot, even
if moderation omits it from results. Excluded ballots includes current exclusions
on empty ballots so they can still be reversed.

Manage opens a dialog with illustrated choices and separate account-ban and
current-ballot-exclusion controls on desktop and mobile. Closing it returns
focus to the originating row and preserves search and pagination. The interface explains
the combined effect of bans and exclusions. When an action removes the account
from the active filter, focus returns to search. The directory only manages accounts
already recorded in Momoi, including retained accounts from earlier lookups.
Failed reads disable mutations until data is reloaded.
The directory refreshes automatically while visible, retaining the inspected
account. Background updates do not blank the directory. A failed read preserves
the last view and provides a Reload page action; recovery resets inspection context.
Connection interruptions reconnect automatically with mutations paused.
Account moderation shows progress
and results in the dialog, which can be closed while the action finishes.

Desktop voting combines a dense illustrated catalogue with a ballot sidebar.
Prominent search and sort are local browsing controls, initially sorted by most
votes. The catalogue heading states “Choose up to 3 vods” on desktop and mobile,
with automatic saving and the ability to change choices explained beneath it.
Each game row has a full-row selection target; choices are unnumbered,
with artwork, removal controls, and a selected count. An empty ballot explains
that fewer than three choices are valid. Game rows have no About section.

Catalogue positions are captured when browsing begins and refresh on search/sort
changes or round/catalogue membership changes. Public updates change counts
without moving voting targets. There is no separate Trending block or extra
Rankings link on Vote; main navigation owns that destination.

Vote shows the current round's start date and latest winner with a known round.
Legacy cards are not presented as a dated latest outcome. A round changing while
the page is open explains the reset; completed ballots stay preserved.

Mobile prioritizes search and catalogue browsing. The fixed control opens Twitch
sign-in for signed-out visitors and a ballot drawer for other states.
Its text reflects loading, saving, confirmed choices, eligibility, and recovery;
account controls are available in the drawer. Sign-in explains the thirty-day
account requirement and that choices are private from viewers but visible to
admins. Rankings emphasize the top three ranks on desktop and mobile; winner
history uses illustrated cards without manufactured metadata.

The visual identity uses near-black plum, a subtle grid, burgundy surfaces,
blush actions, pill navigation, and dense game artwork. Preserve the Momoi
character, loading GIF, reaction emote, ministry name, “next VOD” headline, and
creator credit. On Vote and Rankings, the credit sits below the initial viewport
and is reached by scrolling. Outfit carries headings and prose; DM Mono carries compact counts
and status. CSS owns exact values and breakpoints.

Provide visible loading, save, expiry, conflict, and error states with recovery
controls. Preserve labelled inputs, native buttons, pressed selection states,
status announcements, a skip link, visible focus, and dialog focus trapping, focus restoration, and Escape
behavior. Respect reduced motion. Failed artwork keeps its dimensions and falls
back to initials.

## Local playback extension

Browser setup uses one **Copy pairing details** action in Admin and one paste
field in the extension. Unfinished pairing input survives popup closure during
the browser session.
Pairing automatically assigns any existing playlist to that browser at its saved
cloud position. Previously paired browsers lose access on their next sync;
the extension pauses playback and retains its local checkpoint. The user presses Play / Resume in the extension to begin;
Admin has no separate transfer action.

The unpacked Momoi Playback extension controls one dedicated YouTube playlist
tab on the streaming computer. Its toolbar popup contains concise playback
status, connection settings and a state-specific action: **Play**, **Resume**,
**Retry playback** or **Go to YouTube**. Play and Resume open or reuse the
managed tab in the current browser window, restore the saved video and timestamp, and start playback.
Repeated clicks do not create duplicate players or restart a video already playing.
Opening the browser alone does not start playback. OBS captures the window
independently; there are no OBS credentials, scene controls or broadcast checks.

Admin's Playback panel requests fresh status automatically while visible. Admins
share one expiring observation lease; viewing renews it, while leaving the panel,
hiding the website or disconnecting stops renewal. Frequent reports expire within
about a minute of the last successful renewal. The panel keeps the saved position
visible while waiting for a report, shows stale information explicitly and never
estimates a moving position. Browser contact, player reports and cloud recovery
saves have distinct timestamps. Older saved positions without a recorded save
time remain usable. **Open current video on YouTube** opens that video for admin
inspection without controlling the streaming browser.

Admin's **Retry playback** attempts to restore and resume the current video in
the existing managed tab from its latest valid local checkpoint, including if
paused. A recently responding extension can attempt recovery even when the
YouTube player has stopped reporting. The request targets the assigned device,
run and exact video; it expires and cannot act on changed playback or an ending
awaiting acknowledgment. Admin reports success only when the extension confirms
that the restored player is ready and playing. A closed tab, browser, sleeping
computer or unavailable network cannot be recovered by this action. It does
not reopen a closed tab; use Play / Resume locally. Requesting recovery alone
does not change the playlist or voting round.

Admin's **Skip video** moves to the next entry in the current playlist, starting
at zero and attempting playback in the existing managed tab. It works while
paused and uses the existing extension; no extension update is required.
It requires recent browser contact and waits for the current assignment to be
reported before another skip. Skip is disabled on the last video: only its
natural finish completes the playlist and selects the next voting round's winner.
Skipping an earlier video leaves votes and the voting round unchanged.

YouTube's native controls remain available for ordinary viewing. Pause saves
the position and updates Momoi's status; Play continues. Seeking saves the new
position, including backwards seeks. Selecting an earlier or later entry from
YouTube's playlist panel updates the current video and checkpoint. Other YouTube
tabs remain outside Momoi control. There is no separate Stop playback button,
custom playlist navigation, temporary-video loading, or holding screen.

Periodic local checkpoints preserve the video and position without depending on
a shutdown notification. Pausing also saves progress. Closing the playback tab,
browser or computer does not finish a playlist; the next Play / Resume restores
the checkpoint. An abrupt shutdown may replay a few seconds. The owner pauses
YouTube or closes its tab before ending the broadcast; stopping OBS alone
cannot stop playback.

The extension saves locally, sends cloud recovery checkpoints and reports
meaningful changes. Frequent reports for remote inspection occur only while an
observation lease remains valid. Background checks still discover requests and
verify device authority. When Momoi is unreachable,
the current video may continue with local saving, but its ending waits for a
server response before advancing. Admin distinguishes stale player information
from a browser that has stopped contacting Momoi.
No winner is selected locally. Playback errors stop at the affected video and
appear in the popup and Admin; Retry restores playback after recovery. Unavailable
entries are never silently skipped.

A confirmed video ending advances to the next entry.
Successor videos and the winning playlist start playing automatically and appear
in player fullscreen if the owner was watching fullscreen. A brief exit and
automatic return to fullscreen is acceptable; continuous fullscreen is not a
separate product requirement. An owner who exits fullscreen keeps ordinary viewing.
Restoring a checkpoint within the final two seconds replays up to the last five
seconds so the ending can be
recorded after loading. Finishing the final entry atomically selects the winning
game and opens the next voting round, even if the
owner deliberately sought or navigated past earlier content. Selecting another
entry, pausing, buffering, and disconnecting are not completion events. Each run
uses the sequence saved when it began; refreshed mappings affect future runs.
A native playlist change that does not match that saved sequence must not rewrite
it or trigger a voting transition.

An admin pairs a device using a ten-minute code, inspects playback status, or
revokes access. Pairing a replacement revokes the old device and automatically
assigns the active run, paused at the cloud checkpoint. The owner presses Play /
Resume locally; there is no separate transfer action. That cloud checkpoint may
be older than the old device's local checkpoint.

Games & playlists shows each game's linked playlist with a YouTube link for inspection.
An admin can link or change it by pasting a LacariVOD playlist URL/ID.
One Save checks channel
ownership and prepares the complete sequence before replacing the mapping.
Failed or stale saves preserve the old link. Empty, incomplete, inaccessible and
live-video playlists are rejected. Pending links remain visible but are neither
playable nor eligible for automatic voting until successfully prepared.

Each game and playlist has at most one current mapping. Existing game metadata,
ballots and retirement records remain intact. New games use Add game in Games & playlists
with a required playlist link in the same save. Changing a link never changes an active run, existing
ballots, or the current round's candidate membership.

Initial activation requires a connected paired browser, at least two prepared nonretired
games, and an explicitly selected starting video/position. A retired historical
game may be the initial playback but stays excluded from voting. Every existing
ballot choice, including excluded or banned ballots, must remain mapped, prepared
and eligible; the initial playing game cannot appear in those ballots. Blockers
are reported instead of deleting or rewriting selections. Unvoted unmapped games
remain stored but leave the playlist voting catalogue. The initial assignment is
paused until the owner clicks Play / Resume. Before explicit activation, voting
remains open with no manual winner-selection or round-transition operation.

The real streaming computer must validate native playlist navigation, capture,
restart recovery and long playback before unattended use. Installation and the
walkthrough are in [operations](operations.md#local-playback-extension).
