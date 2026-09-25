// A minimal stand-in for a real host's own cookie-session module, so
// INSTALL.md's Next recipe (a) route handler (which imports
// `getCookieSession` from `@/lib/auth`) has something real to typecheck
// against. Not part of what INSTALL.md documents — this file only exists
// so the *sample* compiles as a host would actually write it.
export interface CookieSession {
  userId: string;
  role: string;
  surface: string;
  organisationId: string;
  aal2: boolean;
  agreementsAccepted: boolean;
  // The route handler sample also gates on this (design's identify()
  // contract: aal2, accepted agreements, an ACTIVE user) — a real host's
  // own session type has an equivalent field under whatever name it uses.
  active: boolean;
}

export async function getCookieSession(_request: Request): Promise<CookieSession | null> {
  return null;
}
