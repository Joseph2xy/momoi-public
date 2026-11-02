/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as catalogue from "../catalogue.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as igdb from "../igdb.js";
import type * as operations from "../operations.js";
import type * as pending from "../pending.js";
import type * as playback from "../playback.js";
import type * as playbackHttp from "../playbackHttp.js";
import type * as playbackRuns from "../playbackRuns.js";
import type * as playlistAvailability from "../playlistAvailability.js";
import type * as playlists from "../playlists.js";
import type * as provider from "../provider.js";
import type * as recovery from "../recovery.js";
import type * as setup from "../setup.js";
import type * as twitch from "../twitch.js";
import type * as voting from "../voting.js";
import type * as youtube from "../youtube.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  catalogue: typeof catalogue;
  crons: typeof crons;
  http: typeof http;
  identity: typeof identity;
  igdb: typeof igdb;
  operations: typeof operations;
  pending: typeof pending;
  playback: typeof playback;
  playbackHttp: typeof playbackHttp;
  playbackRuns: typeof playbackRuns;
  playlistAvailability: typeof playlistAvailability;
  playlists: typeof playlists;
  provider: typeof provider;
  recovery: typeof recovery;
  setup: typeof setup;
  twitch: typeof twitch;
  voting: typeof voting;
  youtube: typeof youtube;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
