SQL that ships with `@papergiant/feedback`; hosts copy each file into their own migration unchanged (see `src/limit`, task P4).

- `postgres-limiter.sql` — the rate limiter behind `rpcLimiter()` (`src/limit/index.ts`). Read its header comment before copying it; it names the one placeholder a host must replace (`__FEEDBACK_SERVER_ROLE__`) and where to add host-specific privilege revokes.

Tests for this file live in `test/sql/` (see `test/sql/README.md` for how to run them against a real Postgres server), not here — this directory is packaged SQL only, and its `files` entry in `package.json` is what ships to consumers.
