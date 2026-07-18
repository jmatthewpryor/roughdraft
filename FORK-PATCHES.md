# Fork patches

This fork (`jmatthewpryor/roughdraft`) exists to run a locally patched build of
[Roughdraft](https://github.com/Lex-Inc/roughdraft) while waiting for fixes to
land upstream. The patched build is installed globally in place of the published
npm package.

## Currently applied patches

Patches are merged into `main`, so this fork's `main` is the patched line, not
a mirror of upstream. Each upstream PR is also kept on its own `pr-*` branch so
individual patches are easy to inspect or drop once they land upstream.

| Upstream PR | Fixes | Branch |
| --- | --- | --- |
| [Lex-Inc/roughdraft#126](https://github.com/Lex-Inc/roughdraft/pull/126) | [#127](https://github.com/Lex-Inc/roughdraft/issues/127) — `roughdraft open`/`watch` crashes with `UND_ERR_HEADERS_TIMEOUT` when a review sits open longer than ~5 minutes | `pr-126-watch-idle-timeout` |

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

The published upstream version gets a `-fixNNN.X` suffix, where `NNN` is the
upstream issue (or PR) number and `X` is a local revision counter:

```
0.1.10-fix127.0
```

This makes `npm ls -g roughdraft` show at a glance that the installed build is
the patched fork, not the published package. Bump the suffix (or add another
`fixNNN` segment) whenever the patch set changes.

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
