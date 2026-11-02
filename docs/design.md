# Interface implementation

[Product](product.md) owns behavior and visual identity. This guide covers how
the interface is assembled; CSS owns exact sizes, colors, and breakpoints.

## Components

The project owns its UI components in `src/components/ui/` and styles them with
ordinary CSS. Dialog uses Radix's dialog primitive for keyboard interaction and
focus handling; notifications use Sonner.
There is no Tailwind build step or component generator configuration.

Semantic CSS variables define the fixed dark theme. Global element defaults live
in the CSS base layer; unlayered component and page styles override them. Use
`#/lib/utils` for conditional classes. Review added components for CSS interactions,
unused dependencies and theme assumptions; do not overwrite locally customized
source with registry defaults.

## Style ownership

- `src/styles.css`: global typography, semantic color tokens, base elements, and shared
  layout primitives used by pages and portalled ballot content.
- `src/public.css`: the voting room, navigation, catalogue, and winner history.
- `src/results.css`: rankings composition and its responsive rules.
- `src/admin.css`: game lookup, playlist catalogue, directory and viewer details.
- `src/playback.css`: admin playback status and device controls.
- `src/components/ui/ui.css`: portalled dialogs, notifications,
  and the ballot drawer. These selectors must work outside `.public-site`.

Keep screen sizes and responsive overrides in their owning page stylesheet. Avoid
adding competing base-layer versions of those properties: unlayered page CSS wins
regardless of the base selector or media breakpoint. Shared ballot and artwork
styles must continue to work outside `.public-site` in portalled dialogs.

Keep focus and content hierarchy intact when adapting these components. Artwork
must retain its dimensions if an image fails. Dialogs need meaningful titles,
descriptions, Escape handling, and a focus destination on close. Modal backgrounds
remain inert; a viewer removed by the active filter returns focus to search.

The shared application runtime owns voting feedback, so route components must
not create competing save notifications. Durable recovery instructions remain
in the affected interface even after transient feedback disappears.

Voting composes `BallotPanel`, `VotingAccount`, and `GameRow`; the desktop panel
and mobile drawer use the same ballot content. `ViewerDialog` owns account
controls and shares its choice-list rendering with the admin directory.

Admin separates Playback, Games & playlists and Viewers while retaining their mounted
views across section switches. Catalogue and viewer directories use aligned desktop
columns and stacked mobile rows, with search in a bordered toolbar above results.
Catalogue additions share the section heading; page controls return focus to search. First-time playback setup is visible; infrequent connection management uses expandable sections.
Pairing uses one compact create/copy card without a setup checklist or nested
disclosures. Copy is the primary action once details exist; expiry and regeneration
sit in its footer. The popup presents a single labelled input and Connect, with
a pending state during connection. Routine playback status does not repeat
instructions; recovery text appears when there is an action to take.
The extension uses the existing Momoi portrait for its toolbar and installation
icons and a small static popup mark. The popup uses a flat plum surface, restrained
pink actions, and compact typography. It has no animated or decorative banner.
Games & playlists has game lookup with a required playlist and one playlist editor for adding
playlists or linking existing games; saving performs validation and video
preparation together. Root subscriptions retain current
standings and winner history independently across route navigation.

Buttons, inputs, and native selects use the local UI components. `Notice` and
`EmptyState` in `feedback.tsx` own shared feedback markup. `controls.css` owns
their appearance and variants, including 44px
minimum control heights. Page styles should own placement and sizing rather
than redefine their colors or interaction states. Native selects retain platform keyboard
and mobile selection behavior. Button composition preserves native form submit
behavior; use `type="button"` for non-submit actions inside forms.

## Review

Follow [verification](../README.md#verification) against an authorized deployment.
Review both populated and empty screens, desktop and narrow
mobile layouts, game-image failures, tied rankings, modal keyboard interaction,
and delayed or uncertain saves.
