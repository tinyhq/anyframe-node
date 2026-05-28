# Publishing `anyframe`

This SDK is published to two registries:

- **[npm](https://www.npmjs.com/package/anyframe)** — the primary registry; serves npm, pnpm, yarn, and (transitively) Bun via `bun add anyframe`.
- **[JSR](https://jsr.io/@anyframe/sdk)** — the Bun / Deno-first registry, for `bun add @anyframe/sdk` (with native types) and Deno's `import` map.

Day-to-day you don't run any of this by hand: every push to `main` triggers `.github/workflows/release.yml`, which calls [semantic-release](https://semantic-release.gitbook.io/) to bump the version, generate the changelog, tag the release, and publish. This document explains how the automation is wired up and how to bootstrap a fresh install of it.

---

## 1. How a release happens

Every commit on `main` is read by semantic-release. The commit type drives the bump:

| Commit type                                        | Release      |
| -------------------------------------------------- | ------------ |
| `fix:`, `perf:`, `refactor:`                       | patch (1.0.x) |
| `feat:`                                            | minor (1.x.0) |
| `feat!:` / `fix!:` / `BREAKING CHANGE:` in footer  | major (x.0.0) |
| `docs:`, `chore:`, `test:`, `build:`, `ci:`, `style:` | no release  |

If at least one releasable commit landed since the last release tag, semantic-release will:

1. Compute the next version.
2. Update `package.json`, `package-lock.json`, and `CHANGELOG.md`.
3. Commit with `chore(release): vX.Y.Z` (skipped from the release pass via `ci skip`).
4. Tag `vX.Y.Z`, create a GitHub Release with the generated notes.
5. Run `npm publish --provenance` against the public npm registry.
6. (Optional, if wired up) Run `npx jsr publish` against JSR.

That entire pipeline takes ~3 minutes for a clean run.

If your push contained only `docs:` / `chore:` / `test:` commits, semantic-release will report "No release published" and exit 0 — that's the intended behavior.

---

## 2. First-time setup

You only need to do this once per repository.

### 2.1 npm Trusted Publisher (preferred — no token)

npm now supports OIDC-based trusted publishing. With this configured, GitHub Actions publishes to npm without a long-lived `NPM_TOKEN` secret, and every published artifact carries a verifiable provenance attestation.

1. Visit <https://www.npmjs.com/package/anyframe/access> (after the first manual publish — see §3) and add a **Trusted Publisher**:
   - Repository owner: `tinyhq`
   - Repository: `anyframe-node`
   - Workflow filename: `release.yml`
   - Environment name: leave blank (or `npm` if you prefer a gated environment)
2. Remove any legacy `NPM_TOKEN` secret from the repo settings.
3. That's it — the existing `release.yml` already exports `NPM_CONFIG_PROVENANCE=true` and uses OIDC.

### 2.2 npm token (fallback)

If your registry doesn't support OIDC (legacy npm orgs, private registry):

1. Create an automation token on npm: `npm token create --read-only=false --cidr=0.0.0.0/0 --automation` (or via the npm dashboard → Access Tokens → "Granular access token", scoped to publish on `anyframe`).
2. Add it to the repo as the `NPM_TOKEN` secret (Settings → Secrets and variables → Actions).
3. `release.yml` already wires `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.

### 2.3 GitHub permissions

The `release.yml` workflow needs:

- `contents: write` — to push the version-bump commit and tag.
- `issues: write`, `pull-requests: write` — for semantic-release's release-notes comments.
- `id-token: write` — to mint the OIDC token used by npm provenance and JSR publishing.

These are already set on the workflow.

### 2.4 (Optional) JSR setup

To also publish to JSR (recommended for Bun and Deno users — JSR ships native types and is faster than tarball-based npm for those runtimes):

1. Sign in to <https://jsr.io> with the `tinyhq` GitHub org account.
2. Claim the `@anyframe` scope.
3. Add a `jsr.json` to the repo root (see template below).
4. Either:
   - **OIDC (preferred)**: link the GitHub repo on the JSR scope page; no token needed.
   - **Token**: add `JSR_TOKEN` to repo secrets.
5. Uncomment the JSR publish step in `release.yml` (see §5).

Template `jsr.json` (already shipped — see the repo root):

```json
{
  "name": "@anyframe/sdk",
  "version": "1.0.0",
  "exports": "./src/index.ts",
  "publish": {
    "include": ["src/**/*.ts", "README.md", "LICENSE", "CHANGELOG.md"]
  }
}
```

JSR publishes TypeScript source directly — there's no build step. It type-checks against the source and serves types to consumers.

---

## 3. Bootstrapping the first release manually

semantic-release needs a base version to start incrementing from. For the very first publish, run once locally (or as a one-off workflow_dispatch):

```bash
# Make sure you have a clean working tree on main with no pending releases.
npm ci
npm run lint
npm run typecheck
npm test
npm run build

# Log into npm as a member of the tinyhq org with publish rights on the
# `anyframe` package name. If the name is unclaimed, the first publish
# claims it.
npm whoami
npm publish --access public --provenance
```

After the first publish lands, set up the Trusted Publisher in §2.1. From then on, every push to `main` with a releasable commit ships automatically.

For JSR's first publish:

```bash
npx jsr publish
```

---

## 4. Publishing pre-releases / RC builds

To cut a pre-release (e.g. for testing a major version), push to a branch named `next` or `beta`:

```bash
git checkout -b next
git push -u origin next
```

semantic-release recognizes those branch names by convention and publishes with a dist-tag like `next` or `beta`:

```bash
npm install anyframe@next
```

The default `latest` tag is reserved for `main`.

To configure other channels, extend `.releaserc.json`'s `branches` array:

```json
{
  "branches": [
    "main",
    { "name": "beta", "prerelease": true },
    { "name": "alpha", "prerelease": true }
  ]
}
```

---

## 5. Bun / JSR publish workflow

When you're ready to publish to JSR alongside npm, append this job to `release.yml` (or add it as a step in the existing `release` job, gated on whether semantic-release actually released):

```yaml
- name: Publish to JSR
  if: steps.semantic.outputs.new-release-published == 'true'
  env:
    JSR_OIDC_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    # Sync the version into jsr.json so JSR matches npm.
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const jsr = JSON.parse(fs.readFileSync('jsr.json', 'utf8'));
      jsr.version = pkg.version;
      fs.writeFileSync('jsr.json', JSON.stringify(jsr, null, 2) + '\n');
    "
    npx jsr publish --allow-dirty
```

JSR also has a GitHub Action: <https://github.com/jsr-io/setup-jsr> — use that if you want pinned tooling.

### Bun + JSR consumer experience

Once JSR is wired up, Bun and Deno users can do:

```bash
# Bun
bunx jsr add @anyframe/sdk
# import { Anyframe } from "@anyframe/sdk";

# Deno
deno add jsr:@anyframe/sdk
# import { Anyframe } from "@anyframe/sdk";
```

npm consumers continue to do `npm install anyframe` and get the bundled tarball — no change for them.

---

## 6. Verifying a release

After the workflow finishes:

1. **npm**: `npm view anyframe versions --json` should include the new version; `npm view anyframe dist-tags` should map `latest` to it.
2. **Provenance**: `npm install anyframe` then `npm audit signatures` should report the package as verified.
3. **JSR** (if enabled): visit <https://jsr.io/@anyframe/sdk>.
4. **GitHub**: the new tag should appear at <https://github.com/tinyhq/anyframe-node/tags>, and a Release with auto-generated notes at /releases.
5. **Install** the new version into a sample project and run a smoke test:

   ```bash
   mkdir /tmp/anyframe-smoke && cd $_
   npm init -y && npm install anyframe
   node -e "const m = require('anyframe'); console.log('v', m.VERSION);"
   ```

---

## 7. Rolling back a bad release

semantic-release does not support unpublishing automatically. If a bad version slips out:

1. **Don't unpublish on npm** — that breaks downstream lockfiles. Instead, immediately publish a follow-up patch with the fix and mark the bad version deprecated:

   ```bash
   npm deprecate anyframe@X.Y.Z "Broken: use X.Y.Z+1 — see #ISSUE for details"
   ```

2. Push the fix as a `fix:` commit. semantic-release will release `X.Y.Z+1` on the next CI run.

3. If the bad version is **less than 72 hours old** and **has zero downloads**, npm allows unpublish: `npm unpublish anyframe@X.Y.Z`. After 72 hours, deprecate-only.

---

## 8. Cheat sheet

```bash
# Release a patch
git commit -m "fix: handle empty preview list"
git push origin main

# Release a minor
git commit -m "feat: support codex runtime"
git push origin main

# Release a major
git commit -m "feat!: rename agents.skills.create signature

BREAKING CHANGE: the third arg is now an options object rather than positional flags."
git push origin main

# Skip the release
git commit -m "docs: clarify retry behaviour"
git push origin main

# Manually run all the pre-publish checks
npm run lint && npm run typecheck && npm test && npm run build
```
