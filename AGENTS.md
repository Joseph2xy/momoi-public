# Agent guide

Momoi is a Twitch-authenticated voting app on TanStack Start, Cloudflare Workers,
Convex and Better Auth. Read [product](docs/product.md) for authoritative behavior,
[architecture](docs/architecture.md) for implementation decisions, and
[operations](docs/operations.md) for operational procedures.
Read [session handoff](docs/handoff.md) for current publication status and remaining work.
Use separate Convex Cloud deployments for development and production, with real
Twitch authentication. Follow [authentication](docs/architecture.md#authentication)
and [configuration](docs/operations.md#configuration) when changing those areas.

## Authorization

Deployment, cloud setup, Twitch configuration changes, and data resets require
explicit authorization. An explicit instruction identifying which records and
votes to delete counts as confirmation for that scope. Ask before proceeding if
the target, affected votes/history, or scope is unspecified or unclear; do not ask
again for authorization already given.

## Working philosophy

- **Choose the best solution without being constrained by the implementation.**
  During discussion, design and development, start from the user's goal and the
  best way to achieve it. Existing code, architecture, feature boundaries and
  sunk effort do not constrain the options. The user is willing to remove and
  replace entire features or implementations, substantially rework the app, or
  start from scratch when that produces a better result. Do not choose an inferior
  workaround or band-aid fix just to preserve the current implementation. Present
  the better approach with its benefits, costs and tradeoffs before committing
  to a major change. Distinguish implementation choices from explicit product,
  security and data requirements; discuss changes to those requirements too.
- **Ask about unstated decisions.** If intent, scope, requirements or handling an
  edge case has not been stated and is not obvious from the agreed context, ask
  the user directly before choosing or acting. Present concrete options, recommend
  one and explain the practical consequences. This includes product behavior,
  removal/replacement scope, and what happens to affected votes or history.
  Do not silently invent policy, introduce fallback behavior, or substitute
  archiving for deletion. While waiting, continue useful inspection and preparation
  that does not depend on the answer. Clearly implied implementation details can
  proceed without questioning every step; honor answers and authorization already
  given.
- **Proactively discuss; act on clear directions.** Keep development collaborative.
  Raise questions, meaningful alternatives and tradeoffs early, and invite discussion
  rather than keeping assumptions or concerns implicit until after implementation.
  The user does not need to initiate every design conversation. Carry out clear
  directions without asking for permission again. If an additional approval is
  needed, explain the specific reason. Discussion should help the user steer
  decisions and let clearly authorized work proceed.
- **Make features justify their complexity.** Apply this review across the whole
  app, not only playback. Identify who uses a feature, the concrete task it solves,
  and what is lost if it is removed. Check whether an existing app flow or native
  tool already does the job, including whether automation would override it.
  Prefer one clear place to perform each task. Remove unused paths and duplicate
  implementations; simplify useful features before removing them. Do not add
  abstractions or fallback modes for hypothetical future needs, or remove working
  features merely to reduce line count. Explain substantive behavior removals
  with a concrete before/after example so the user can steer. Preserve explicitly
  retained features and the invariants below.
- **Exercise independent judgment.** Be direct and honest. Challenge requests,
  assumptions, and your own proposals when they conflict with evidence or the
  intended outcome. Explain the problem and recommend a better path; agreement
  is not the goal. State uncertainty and limitations plainly.
- **Finish the cleanup thoroughly.** Cleanup is part of completing development.
  Remove obsolete or dead code, unnecessary folders and files, obsolete tests,
  unused dependencies, abandoned scripts/configuration, stale documentation and
  dangling references throughout the affected implementation and its dependents.
  Do not conservatively retain leftovers, compatibility paths or alternative
  implementations without a concrete current purpose. Trace removed behavior
  through routes, APIs, domain operations, UI, scripts, configuration, dependencies
  and tests; remove folders that become unnecessary and check surviving references.
  Delete obsolete tests while retaining valid coverage for surviving behavior and
  distinct failure modes; never delete a valid failing test to hide a regression.
  Proceed with cleanup clearly implied by the agreed change. If a file or behavior
  has an unclear purpose or removal consequence, investigate and ask with options
  rather than guessing. Live data, credentials and explicitly retained databases
  are separate from obsolete implementation files and follow the authorized scope
  and invariants below. Historical implementations belong in Git history, not
  the active checkout.

## Code ownership

- `src/routes/`: routes and HTTP entry points.
- `src/server.ts`: frontend Worker request entry.
- `src/shared/`: presentation types and shared input parsing.
- `convex/`: authoritative voting/history, authentication, provider maintenance and schema;
  Better Auth owns account/session tables.
- `src/components/`, `src/client/`, and the CSS files: interface and browser state.

## Invariants

- Convex is the live voting source of truth; D1 is retained historical data.
  Preserve existing databases, ballots, audit history, moderation,
  retirement records, and completed rounds when changing features or schema,
  except for specific data changes explicitly authorized by the user. If removing
  a feature or catalogue entry affects these records and their handling is not
  specified, ask with options before deciding; do not assume archival or deletion.
  Never solve a migration by deleting production data.
- Enforce eligibility, selection limits, session authority, and admin access on
  the server. Admin authority uses immutable Twitch IDs, never usernames.
- Keep authentication private and revocable, with server checks for live sessions
  and ownership. Twitch tokens remain server-side; follow the authentication
  architecture for cookie and integration-token handling.
- Keep ballot replacement, moderation, and round transition atomic. Preserve
  revision checks and completed-round inclusion when modifying those operations.
- Never commit secrets, private identifiers, environment files, database exports,
  local databases or browser/auth state. Honor `.gitignore`.

## Verification and documentation

Use the commands in [README](README.md#verification). For application changes,
run `npm run typecheck` and `npm run build`. Use real browser checks against an
authorized deployment when behavior changes. Use real authentication and data;
do not introduce mock providers, demo seeds or a specialized test/fixture harness.

Keep each fact in its owning document and link to it elsewhere. Update current
guidance when behavior changes. Use Git history for chronology; keep the handoff
as a current snapshot rather than a session diary.
For documentation-only changes, check links,
commands, and consistency with code; application tests are unnecessary.
