import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  playbackSequences: defineTable({
    videos: v.array(v.object({ videoId: v.string(), title: v.string(), duration: v.number() })),
  }),
  playbackRuns: defineTable({
    sequenceId: v.id('playbackSequences'), playlistId: v.string(), gameId: v.string(), title: v.string(),
    deviceId: v.id('playbackDevices'), roundId: v.string(), rotation: v.number(),
    videoIndex: v.number(), position: v.number(), revision: v.number(), paused: v.boolean(), checkpointAt: v.optional(v.number()),
    // Preserve former Admin control reasons in existing run records.
    revisionReason: v.optional(v.union(v.literal('navigation'), v.literal('advance'), v.literal('transfer'), v.literal('pause'), v.literal('resume'), v.literal('reload'))),
    videoCount: v.number(), video: v.object({ videoId: v.string(), title: v.string(), duration: v.number() }),
    status: v.union(v.literal('playing'), v.literal('completed')),
    startedAt: v.number(), completedAt: v.union(v.number(), v.null()), startedBy: v.string(),
  }),
  playlists: defineTable({
    playlistId: v.string(), gameId: v.string(), channelId: v.optional(v.string()), title: v.string(),
    thumbnailUrl: v.union(v.string(), v.null()),
    sequenceId: v.optional(v.id('playbackSequences')), videoCount: v.optional(v.number()),
    updatedAt: v.number(), selectedBy: v.string(),
  }).index('playlistId', ['playlistId']).index('gameId', ['gameId']),
  playbackPairings: defineTable({
    codeHash: v.string(), name: v.string(), createdBy: v.string(), expiresAt: v.number(),
    consumedTokenHash: v.optional(v.string()),
  }).index('codeHash', ['codeHash']),
  playbackDevices: defineTable({
    name: v.string(), tokenHash: v.string(), createdBy: v.string(), createdAt: v.number(), revoked: v.boolean(),
    lastSeen: v.union(v.number(), v.null()),
    reportAt: v.optional(v.number()),
    observation: v.optional(v.object({ id: v.string(), requestedAt: v.number(), waitUntil: v.number(), endsAt: v.optional(v.number()) })),
    retry: v.optional(v.object({ id: v.string(), runId: v.id('playbackRuns'), revision: v.number(), videoIndex: v.number(), videoId: v.string(),
      expiresAt: v.number(), status: v.union(v.literal('pending'), v.literal('applied'), v.literal('failed')), error: v.optional(v.string()) })),
    report: v.optional(v.object({ videoId: v.union(v.string(), v.null()), position: v.number(), duration: v.number(),
      paused: v.boolean(), completed: v.boolean(), playerConnected: v.optional(v.boolean()), live: v.optional(v.boolean()),
      // Existing reports retain this former telemetry field; new reports omit it.
      quality: v.optional(v.number()), notice: v.string(),
      run: v.optional(v.object({ id: v.string(), revision: v.number(), videoIndex: v.number() })), interrupted: v.optional(v.boolean()),
      adminControls: v.optional(v.boolean()), controlling: v.optional(v.boolean()) })),
    // Retain historical command records; browser-only playback no longer issues or executes them.
    command: v.optional(v.object({ id: v.string(), kind: v.union(v.literal('pause'), v.literal('resume'), v.literal('retry'), v.literal('restore'), v.literal('seek'), v.literal('load'), v.literal('return')),
      expectedRunId: v.optional(v.string()), expectedRunRevision: v.optional(v.number()),
      videoId: v.optional(v.string()), expectedVideoId: v.optional(v.string()), position: v.optional(v.number()), createdAt: v.number(),
      status: v.union(v.literal('pending'), v.literal('done'), v.literal('failed')), error: v.optional(v.string()) })),
  }).index('tokenHash', ['tokenHash']).index('revoked', ['revoked']),
  providerWork: defineTable({
    accountId: v.string(), userId: v.string(), twitchId: v.string(),
    generation: v.number(), dueAt: v.number(), checkedAt: v.number(), validUntil: v.number(),
    claim: v.optional(v.string()), claimedUntil: v.optional(v.number()), failures: v.number(), revoked: v.boolean(), invalidatedBefore: v.optional(v.number()),
  }).index('accountId', ['accountId']).index('dueAt', ['dueAt']),
  twitchProfiles: defineTable({
    twitchId: v.string(), login: v.string(), createdAt: v.number(),
    validatedAt: v.number(), accessExpiresAt: v.number(),
    displayName: v.optional(v.string()), image: v.optional(v.string()),
    banned: v.optional(v.boolean()), sourceId: v.optional(v.string()),
  }).index('twitchId', ['twitchId']),
  pendingChoices: defineTable({
    sessionId: v.string(), gameId: v.string(), roundId: v.string(),
  }).index('sessionId', ['sessionId']),
  games: defineTable({
    sourceId: v.string(), name: v.string(), slug: v.string(), coverUrl: v.union(v.string(), v.null()),
    retired: v.boolean(), createdAt: v.number(), updatedAt: v.number(),
    kind: v.optional(v.literal('playlist')),
    igdbId: v.optional(v.union(v.number(), v.null())), customArtworkKey: v.optional(v.union(v.string(), v.null())),
  }).index('sourceId', ['sourceId']),
  rounds: defineTable({
    sourceId: v.string(), status: v.union(v.literal('open'), v.literal('completed')),
    winnerGameId: v.union(v.string(), v.null()), openedAt: v.number(), closedAt: v.union(v.number(), v.null()),
    openedBy: v.union(v.string(), v.null()), closedBy: v.union(v.string(), v.null()),
    eligibleGameIds: v.optional(v.array(v.string())), rotation: v.optional(v.number()),
  }).index('sourceId', ['sourceId']).index('status', ['status']),
  appState: defineTable({ key: v.literal('current'), roundId: v.string(),
    playbackRunId: v.optional(v.id('playbackRuns')), rotation: v.optional(v.number()), playedGameIds: v.optional(v.array(v.string())),
  }).index('key', ['key']),
  ballots: defineTable({
    sourceId: v.string(), roundId: v.string(), twitchId: v.string(), gameIds: v.array(v.string()),
    revision: v.number(), excluded: v.boolean(), includedAtCompletion: v.union(v.boolean(), v.null()),
    createdAt: v.number(), updatedAt: v.number(),
  }).index('round_user', ['roundId', 'twitchId']),
  ballotChanges: defineTable({
    sourceId: v.string(), ballotId: v.string(), revision: v.number(), source: v.union(v.literal('voter'), v.literal('game_retirement'), v.literal('game_removal')),
    actorId: v.union(v.string(), v.null()), beforeGameIds: v.array(v.string()), afterGameIds: v.array(v.string()), changedAt: v.number(),
  }),
  moderation: defineTable({
    sourceId: v.string(), kind: v.union(v.literal('ban'), v.literal('exclusion')), targetId: v.string(),
    startedBy: v.string(), startedAt: v.number(), liftedBy: v.union(v.string(), v.null()), liftedAt: v.union(v.number(), v.null()),
  }).index('kind_target', ['kind', 'targetId']),
  retirements: defineTable({
    sourceId: v.string(), gameId: v.string(), source: v.union(v.literal('manual'), v.literal('round_winner')),
    roundId: v.union(v.string(), v.null()), retiredBy: v.string(), retiredAt: v.number(),
    liftedBy: v.union(v.string(), v.null()), liftedAt: v.union(v.number(), v.null()),
  }),
  winnerChanges: defineTable({
    sourceId: v.string(), roundId: v.string(), previousGameId: v.union(v.string(), v.null()),
    nextGameId: v.string(), changedBy: v.string(), changedAt: v.number(),
  }),
  legacyWinners: defineTable({
    sourceId: v.string(), gameId: v.string(), name: v.string(), slug: v.string(), coverUrl: v.union(v.string(), v.null()), displayOrder: v.number(),
  }),
})
