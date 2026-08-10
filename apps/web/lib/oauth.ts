/**
 * Cookie carrying the PKCE `state` through the Microsoft round trip.
 *
 * Lives here rather than in the route: a Next.js route module may only export
 * HTTP handlers and its config fields, so exporting a constant from one fails
 * the build with "not a valid Route export field".
 */
export const OAUTH_STATE_COOKIE = 'ms_oauth_state';
