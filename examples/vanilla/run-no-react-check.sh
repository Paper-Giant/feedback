#!/usr/bin/env bash
# Runs no-react-check.ts from a directory *outside* this repository.
#
# Why: this project (examples/vanilla) lives nested inside the
# @papergiant/feedback package's own repository, which has its own
# `node_modules/react` (a devDependency the package root genuinely needs,
# to build and test itself). Node's module resolution for a bare
# specifier walks every ancestor directory's `node_modules` looking for a
# match — with no boundary at a `package.json` in between — so run from
# here, `@papergiant/feedback/react`'s `import ... from 'react'` would
# keep climbing straight past this project's own (React-free)
# `node_modules`, past `examples/`, and land on the *repository root's*
# `node_modules/react`, resolving successfully. That's an artifact of
# nesting inside this monorepo-shaped checkout, not something a real,
# standalone consumer (whose own project isn't inside this repository)
# would ever see — so the check runs from a scratch directory that has no
# such ancestor, which is what actually proves "no React resolvable
# anywhere reachable from a real consumer's own project."
#
# Only `@papergiant/feedback` itself is copied (not the rest of
# node_modules) — the package promises zero runtime dependencies (design
# §3), so nothing else it imports needs to be present for this to be a
# faithful reproduction.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cp "$here/no-react-check.ts" "$tmp/"
# Marks this scratch directory as ESM — otherwise tsx has nothing to infer
# module type from and treats a bare .ts file as CommonJS, which can't run
# this file's top-level `await`.
echo '{"type":"module"}' > "$tmp/package.json"
mkdir -p "$tmp/node_modules/@papergiant"
cp -R "$here/node_modules/@papergiant/feedback" "$tmp/node_modules/@papergiant/feedback"

(cd "$tmp" && FEEDBACK_VANILLA_PROJECT_DIR="$here" "$here/node_modules/.bin/tsx" no-react-check.ts)
