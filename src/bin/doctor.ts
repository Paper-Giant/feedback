#!/usr/bin/env node
/**
 * `papergiant-feedback` — the package's CLI entry point (task P11).
 *
 * Today this has exactly one subcommand, `doctor` (design §3 "Install
 * contract": read-only install checks — see `src/doctor/`), invoked as
 * `npx @papergiant/feedback doctor [options]`. This file is deliberately
 * a thin dispatcher: everything `doctor` actually does lives in
 * `src/doctor/`, both so it's unit-testable without spawning a process
 * and so a future second subcommand only has to add a branch here.
 *
 * Note for whoever wires up `package.json`: this file is built to
 * `dist/bin/doctor.js` and is the target of the package's one `bin`
 * entry. The **key** in `package.json`'s `bin` map is what `npm`/`npx`
 * expose as a command name — `doctor` is too generic for that (it would
 * shadow or collide with other tools named `doctor` on a person's PATH
 * once installed globally); the file itself keeps its name.
 */
import { runDoctorCommand } from '../doctor/index.js';
import { topLevelUsage } from '../doctor/help.js';
import { describeArg } from '../doctor/redact.js';

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === '--help' || command === '-h') {
    process.stdout.write(topLevelUsage());
    return 0;
  }

  if (command === undefined) {
    process.stderr.write(`papergiant-feedback: a command is required\n\n${topLevelUsage()}`);
    return 2;
  }

  if (command !== 'doctor') {
    // command is whatever a person (or a script) typed as the very first
    // argument — "-----BEGIN..." (a pasted private key) is exactly as
    // plausible here as a typo, and this message must not become the
    // place that key leaks out. See src/doctor/redact.ts.
    process.stderr.write(`papergiant-feedback: unknown command ${describeArg(command)}\n\n${topLevelUsage()}`);
    return 2;
  }

  const result = await runDoctorCommand(rest, process.env);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    // A genuine bug in doctor itself, not a usage error or a failed
    // check (both of which are handled, and exit 2 / 1, above). This is
    // the last line of defence, not a place to trust: an unexpected
    // exception's own `.message` is not guaranteed to be free of
    // whatever value was in scope when it was thrown (a future code
    // path could, for instance, let a malformed URL's own text end up
    // inside a TypeError), so it goes through the same redaction as
    // every other doctor message rather than being assumed safe because
    // this file's own code doesn't currently embed anything in it.
    // `.name` (e.g. "TypeError") is a fixed, class-level string, never
    // derived from a value, so it's always safe to print as-is.
    const err = error instanceof Error ? error : new Error(String(error));
    const name = err.name || 'Error';
    process.stderr.write(`papergiant-feedback doctor: unexpected ${name}: ${describeArg(err.message)}\n`);
    process.exitCode = 1;
  });
