# Fork patches

This fork (`jmatthewpryor/roughdraft`) exists to run a locally patched build of
[Roughdraft](https://github.com/Lex-Inc/roughdraft) while waiting for fixes to
land upstream. The patched build is installed globally in place of the published
npm package.

## Currently applied patches

Patches are merged into `main`, so this fork's `main` is the patched line, not
a mirror of upstream. Each upstream PR is also kept on its own `pr-*` branch so
individual patches are easy to inspect or drop once they land upstream.

| Upstream PR | What it does | Branch |
| --- | --- | --- |
| [Lex-Inc/roughdraft#126](https://github.com/Lex-Inc/roughdraft/pull/126) | Fixes [#127](https://github.com/Lex-Inc/roughdraft/issues/127) — `roughdraft open`/`watch` crashes with `UND_ERR_HEADERS_TIMEOUT` when a review sits open longer than ~5 minutes | `pr-126-watch-idle-timeout` |
| [Lex-Inc/roughdraft#110](https://github.com/Lex-Inc/roughdraft/pull/110) | Fixes [#109](https://github.com/Lex-Inc/roughdraft/issues/109) — declares `yaml` as a root dependency so fresh global installs don't crash with `ERR_MODULE_NOT_FOUND`; adds a packaging guard test | `pr-110-yaml-root-dep` |
| [Lex-Inc/roughdraft#135](https://github.com/Lex-Inc/roughdraft/pull/135) | Fixes single-tilde text (`~57%`, `~100h`) being misparsed as strikethrough | `pr-135-single-tilde` |
| [Lex-Inc/roughdraft#112](https://github.com/Lex-Inc/roughdraft/pull/112) | Fixes legacy multiline inline comments leaking raw CriticMarkup into the rendered page | `pr-112-multiline-legacy-comments` |
| [Lex-Inc/roughdraft#131](https://github.com/Lex-Inc/roughdraft/pull/131) | Feature: 👍/👎/❓ reactions on comments and replies, surfaced in the review index agents read back. **Extends the RFM spec** — docs using reactions aren't fully understood by stock Roughdraft | `pr-131-comment-reactions` |
| [Lex-Inc/roughdraft#102](https://github.com/Lex-Inc/roughdraft/pull/102) | Feature: renders ` ```mermaid ` fences as diagrams (lossless round-trip, lazy-loaded chunk) | `pr-102-mermaid` |
| [Lex-Inc/roughdraft#103](https://github.com/Lex-Inc/roughdraft/pull/103) | Feature: Appearance settings (Light/Warm/Dark/System theme, font, size, width) + syntax highlighting in code blocks | `pr-103-appearance` |

Merge-conflict notes (relevant when dropping patches or syncing upstream):

- `packages/app/src/style.css` — #102 and #103 both append rules at end-of-file;
  resolved by keeping both blocks.
- `packages/app/src/critic-markup/index.ts` — import list is the union of
  #102's and the earlier patches' imports.
- `pnpm-lock.yaml` — regenerated with `pnpm install` after the #103 merge
  rather than hand-merged.

### What the #126 fix does

In `runWatch` (`packages/server/src/cli.ts`), the long-poll to
`POST /api/review-events/watch` had no `AbortSignal` in the default
(no `--timeout`) path, so undici's built-in ~5 minute `headersTimeout` killed
the CLI with an unhandled `TypeError: fetch failed` before the reviewer clicked
**Done Reviewing**. The fix wraps the fetch in a retry loop that catches
recognised idle-timeout error codes (`UND_ERR_HEADERS_TIMEOUT`,
`UND_ERR_BODY_TIMEOUT`, `UND_ERR_SOCKET`, `ECONNRESET`,
`UND_ERR_CONNECT_TIMEOUT`) and re-polls from session start, so a Done event
fired during the reconnect gap is not lost. The explicit `--timeout` path is
unchanged.

## Version scheme

The fork version is the **next patch version above the upstream base**, with a
`-patched.X` prerelease suffix (e.g. upstream `0.1.10` → fork
`0.1.11-patched.0`). Bump `X` whenever the patch set changes on the same
upstream base. The table above is the authoritative list of what's included.

Two reasons for this scheme:

1. `npm ls -g roughdraft` shows at a glance that the installed build is the
   patched fork, not the published package.
2. The app's update banner compares the running version against the npm
   registry's latest release. A suffix on the *same* base version (like
   `0.1.10-patched.0`) sorts **below** the published `0.1.10`, so the app
   permanently nags "update available" — and following that prompt would
   clobber the patched build. Versioning above the release silences the false
   banner; it reappears exactly when upstream publishes something genuinely
   newer, which is the signal to refresh the fork.

## Applying another upstream PR

```bash
cd <this repo>

# 1. Fetch the PR head from upstream into a local branch
git fetch https://github.com/Lex-Inc/roughdraft.git pull/<PR>/head:pr-<PR>-<short-name>

# 2. Merge it into main
git checkout main
git merge pr-<PR>-<short-name>

# 3. Bump the version suffix in package.json (see version scheme above)

# 4. Rebuild, test, and reinstall (next section), then push
git push origin main pr-<PR>-<short-name>
```

## Build, test, and install globally

```bash
pnpm install
pnpm build
pnpm --filter @roughdraft/server test
pnpm --filter @roughdraft/rfm test

# Pack and install over the published package
npm pack .                      # produces roughdraft-<version>.tgz
npm install -g ./roughdraft-<version>.tgz

# Verify
npm ls -g roughdraft            # should show the -fixNNN suffix
roughdraft --version
```

## Reverting to the official package

Once upstream releases a version containing the fixes:

```bash
npm install -g roughdraft@latest
```

## Keeping the fork current with upstream

```bash
git remote add upstream https://github.com/Lex-Inc/roughdraft.git  # once
git fetch upstream
git checkout main && git merge upstream/main
```

Since `main` carries the patches, expect an occasional conflict when upstream
touches the same code (that usually means the fix landed upstream — drop the
local patch and take upstream's version). Watch for upstream version bumps in
`package.json`: re-apply the `-fixNNN.X` suffix to the new upstream version if
any local patches are still needed. Then rebuild and reinstall as above.
