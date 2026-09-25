/** Shared between `server.ts` and the Playwright specs — same pattern as
 * `examples/fixture/constants.ts`, kept independent (its own port) so this
 * consumer never collides with the fixture's or the vanilla consumer's. */
export const HOST_PORT = Number(process.env.PORT ?? 4401);
