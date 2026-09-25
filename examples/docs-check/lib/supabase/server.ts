// A minimal stand-in for a real host's own server-only Supabase client
// module, so INSTALL.md's Next recipe (a) route handler (which imports
// `createServiceRoleClient` from `@/lib/supabase/server`) has something
// real to typecheck against. Not part of what INSTALL.md documents.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Untyped client (no Database generic) — the most permissive shape a
// real host's own client could have, so this stub can never be stricter
// than what INSTALL.md's sample actually needs.
export function createServiceRoleClient(): SupabaseClient {
  return createClient('https://example.supabase.co', 'service-role-key');
}
