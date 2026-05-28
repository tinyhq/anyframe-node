# Publishing `anyframe`

This document is the full, no-prior-knowledge guide for publishing the AnyFrame TypeScript SDK. It covers:

1. [Which registries we ship to and why](#1-registries-overview)
2. [One-time accounts and access to set up](#2-one-time-account-setup)
3. [How releases work (CI auto-publish)](#3-how-releases-work-ci-auto-publish)
4. [Cutting the first manual release to bootstrap](#4-the-first-release-manual-bootstrap)
5. [Day-to-day release workflow](#5-day-to-day-release-workflow)
6. [Pre-release / beta channels](#6-pre-release--beta-channels)
7. [Publishing to JSR (Bun + Deno)](#7-publishing-to-jsr-bun--deno)
8. [Verifying a release](#8-verifying-a-release)
9. [Rolling back a bad release](#9-rolling-back-a-bad-release)
10. [Cheat sheet](#10-cheat-sheet)

---

## 1. Registries overview

We publish to two registries:

| Registry | Package name        | Who consumes it                                           |
| -------- | ------------------- | --------------------------------------------------------- |
| **npm**  | `anyframe`          | npm, pnpm, yarn, Bun (`bun add anyframe`), Deno via `npm:`|
| **JSR**  | `@anyframe/sdk`     | Native JSR clients: Bun (`bunx jsr add @anyframe/sdk`), Deno (`deno add jsr:@anyframe/sdk`) |

**npm is mandatory** — it's the default registry for the entire JS ecosystem. Bun, pnpm, yarn, and Deno's npm-compat all install from npm.

**JSR is optional and recommended for Bun / Deno**. JSR ships TypeScript source directly (no build step needed) and is the canonical registry that Bun and Deno's teams recommend for new packages. Setting it up is a one-time scope claim. The npm tarball remains the source of truth for tooling-level installs.

> **Note for Bun specifically**: Bun reads `package.json` and installs from npm by default. `bun add anyframe` works without any JSR setup. JSR is a *nicer-but-optional* path — it gives Bun users native TypeScript types and lower install latency.

---

## 2. One-time account setup

Do this once for the lifetime of the package.

### 2.1 npm account and `tinyhq` org

1. **Create / sign in to an npm account** at <https://www.npmjs.com/signup>. Use a work email; enable 2FA from <https://www.npmjs.com/settings/your-username/profile>.
2. **Create the `tinyhq` org** (if it doesn't exist) at <https://www.npmjs.com/org/create>. The org is free for public packages.
3. **Add yourself and any co-maintainers** to the org as members at <https://www.npmjs.com/settings/tinyhq/members>. Require 2FA for the org from <https://www.npmjs.com/settings/tinyhq/security>.
4. The package name `anyframe` will be claimed on first publish (see §4). To pre-reserve the name without publishing yet, run:
   ```bash
   npm whoami    # confirm you're logged into the right account
   ```

### 2.2 npm Trusted Publisher (preferred — no token in CI)

npm now supports **OIDC-based publishing** so GitHub Actions can publish without any long-lived `NPM_TOKEN` secret, and every artifact gets a verifiable provenance attestation. **Set this up after §4 (the first publish) — npm requires the package to exist before you can add Trusted Publishers.**

1. After the first publish, go to <https://www.npmjs.com/package/anyframe/access> → **Trusted Publishers** → **Add Trusted Publisher**.
2. Fill in:
   - **Provider**: GitHub Actions
   - **Repository owner**: `tinyhq`
   - **Repository**: `anyframe-node`
   - **Workflow filename**: `release.yml`
   - **Environment name**: leave blank (or set to `npm` for an extra gate)
3. Save. From this point on, the `release.yml` workflow publishes via OIDC. The existing workflow already exports `NPM_CONFIG_PROVENANCE=true`, so attestations are produced automatically.
4. **Delete any legacy `NPM_TOKEN` secret** from <https://github.com/tinyhq/anyframe-node/settings/secrets/actions> if you had one.

### 2.3 npm token (fallback only)

If your environment doesn't support OIDC (legacy npm orgs, mirror registries, etc.):

1. Visit <https://www.npmjs.com/settings/your-username/tokens> → **Generate New Token** → **Granular Access Token**.
2. Configure:
   - **Expiration**: 90 days (rotate before expiry).
   - **Packages and scopes**: select `anyframe` (or scope `tinyhq` for all org packages).
   - **Permissions**: Read and write.
3. Copy the token (starts with `npm_`). Add it to the GitHub repo at Settings → Secrets and variables → Actions as `NPM_TOKEN`. The existing `release.yml` reads it via `NODE_AUTH_TOKEN`.

### 2.4 GitHub repo settings

The `release.yml` workflow needs the following permissions, which are **already set** in the workflow YAML but require the repo's Actions settings to allow them:

1. Settings → Actions → General → Workflow permissions: **Read and write permissions**.
2. Settings → Actions → General → **Allow GitHub Actions to create and approve pull requests**.

If your org enforces stricter defaults, override per-workflow with the `permissions:` block at the top of `release.yml` (already done).

### 2.5 (Optional) JSR account and `@anyframe` scope

Skip this if you're only publishing to npm.

1. Sign in to <https://jsr.io> with GitHub. Use the same GitHub account that owns the `tinyhq` org.
2. Go to <https://jsr.io/new> → **Create scope** → enter `anyframe` (this becomes `@anyframe`). Scopes are free.
3. On the scope page → **GitHub Actions** tab → link the `tinyhq/anyframe-node` GitHub repo. This enables OIDC publishing — no JSR token needed.
4. Add the JSR publish step to `release.yml` (see §7 below).

### 2.6 Bun

**No account setup needed for Bun.** Bun installs from npm by default, so `bun add anyframe` works as soon as the npm package is live. If you also publish to JSR (§2.5 + §7), Bun users get an additional `bunx jsr add @anyframe/sdk` option that ships TypeScript source directly.

---

## 3. How releases work (CI auto-publish)

Every push to `main` runs `.github/workflows/release.yml`, which calls [semantic-release](https://semantic-release.gitbook.io/). The flow:

```
push to main
   ↓
release.yml fires
   ↓
npm ci  →  lint  →  typecheck  →  test  →  build
   ↓
semantic-release reads commits since the last release tag
   ↓
any releasable commits?
  no  → exit 0 ("No release published")
  yes → bump version → write CHANGELOG.md → push tag → GitHub Release
         ↓
         npm publish --provenance  (OIDC, no token)
         ↓
         (optionally) jsr publish
```

Commit-type → version-bump mapping (defined in `.releaserc.json`):

| Commit prefix                                              | Effect       |
| ---------------------------------------------------------- | ------------ |
| `fix:`, `perf:`, `refactor:`                               | patch (1.0.x)|
| `feat:`                                                    | minor (1.x.0)|
| `feat!:` / `fix!:` / `BREAKING CHANGE:` footer             | major (x.0.0)|
| `docs:`, `chore:`, `test:`, `build:`, `ci:`, `style:`      | no release   |

Multiple releasable commits in one push → semantic-release picks the highest bump (any breaking change wins over feats, which win over fixes).

The release commit is itself a `chore(release):` so it doesn't recursively trigger another release.

---

## 4. The first release (manual bootstrap)

`anyframe` doesn't exist on npm yet, so semantic-release has nothing to compute the next version from. Run **one** manual publish to seed the registry:

```bash
# 1. Confirm working tree is clean and on main.
git checkout main && git pull && git status

# 2. Install deps, validate, and build.
npm ci
npm run lint
npm run typecheck
npm test
npm run build

# 3. Log into npm as a tinyhq org member with publish rights.
npm login              # opens a browser; 2FA in your authenticator
npm whoami             # should print your npm username

# 4. Publish. --access public is required for new scoped packages;
# we use it for bare names too as a belt-and-suspenders.
npm publish --access public --provenance
```

If npm complains the name is taken (`E403`), pick a different name or claim the existing one through npm support. If you get `EOTP`, enter your 2FA code when prompted.

After this publish lands:
1. **Set up the Trusted Publisher** (§2.2) — required before CI can auto-publish.
2. From now on, every push to `main` with a releasable commit ships automatically.

---

## 5. Day-to-day release workflow

Once §4 + §2.2 are done, you never run `npm publish` manually again. The workflow:

```bash
# Make a change. Use conventional commits.
git checkout -b my-feature
# ... edit files ...
git commit -m "feat: add retry hooks to events()"
git push -u origin my-feature
gh pr create

# After review + merge to main:
#   1. ci.yml fires on the PR (lint + test + build smoke).
#   2. After merge, release.yml fires on main and publishes vX.Y.Z.
#   3. semantic-release pushes a `chore(release): X.Y.Z` commit back
#      to main with the updated CHANGELOG.md.
```

**Releasable vs non-releasable commits**:

- `feat:`, `fix:`, `perf:`, `refactor:` → produces a release.
- `docs:`, `chore:`, `test:`, `ci:`, `build:`, `style:` → does not produce a release.

If you push a series of `docs:` and `chore:` commits, the release workflow runs, finds nothing to release, and exits cleanly. No version bump, no npm publish. The next `feat:` or `fix:` triggers the release.

To make a **breaking change**, add a `!` after the type or a `BREAKING CHANGE:` footer:

```
feat!: rename agents.skills.create arg shape

BREAKING CHANGE: third argument is now an options object rather than positional flags.
```

This produces a major version bump.

### Skip a release intentionally

Add `[skip ci]` to the commit message to skip the release workflow entirely (even if the commit type is releasable).

---

## 6. Pre-release / beta channels

To cut a pre-release (e.g., for testing a major version before promoting it):

```bash
git checkout -b next
git push -u origin next
```

semantic-release recognizes `next`, `beta`, and `alpha` branch names by convention and publishes with a corresponding npm dist-tag. Users opt in:

```bash
npm install anyframe@next
npm install anyframe@beta
```

The default `latest` tag is reserved for `main`. To add custom channels, extend `.releaserc.json`:

```json
{
  "branches": [
    "main",
    { "name": "next", "prerelease": true },
    { "name": "beta", "prerelease": true }
  ]
}
```

---

## 7. Publishing to JSR (Bun + Deno)

After §2.5 (JSR scope claim), the JSR step is **already wired into `release.yml`** alongside the npm publish. The release job runs:

1. `semantic-release` — bump version, tag, GitHub Release (does **not** publish to npm itself).
2. `npm publish --provenance` — publishes to npm via the GitHub OIDC token. No `NPM_TOKEN` needed.
3. **Sync `jsr.json`** to the new version that `semantic-release` just wrote into `package.json`.
4. `npx jsr publish --allow-dirty` — publishes to JSR via OIDC (the scope link from §2.5 is the only auth).

So `npm publish` and `jsr publish` ship side-by-side on every release.

**Consumer experience once JSR is wired up:**

```bash
# Bun
bunx jsr add @anyframe/sdk
# code: import { Anyframe } from "@anyframe/sdk";

# Deno
deno add jsr:@anyframe/sdk
# code: import { Anyframe } from "@anyframe/sdk";

# npm / pnpm / yarn — unchanged, still install from npm
npm install anyframe
# code: import Anyframe from "anyframe";
```

The repo already ships a `jsr.json` template — semantic-release will update its `version` field after every release if you add the sync step above.

---

## 8. Verifying a release

After the workflow finishes:

1. **npm dist-tags**:
   ```bash
   npm view anyframe versions --json
   npm view anyframe dist-tags
   ```
   The new version should appear; `latest` should map to it.

2. **Provenance attestation**:
   ```bash
   mkdir /tmp/anyframe-smoke && cd $_
   npm init -y
   npm install anyframe
   npm audit signatures
   # Should say `verified registry signatures, audited N packages in 2s`
   ```

3. **GitHub Release**: a new tag and Release should appear at <https://github.com/tinyhq/anyframe-node/releases>.

4. **JSR** (if wired up): visit <https://jsr.io/@anyframe/sdk>.

5. **Functional smoke**:
   ```bash
   node -e "const m = require('anyframe'); console.log('v', m.VERSION);"
   ```

---

## 9. Rolling back a bad release

**Do not unpublish.** npm allows unpublishing only within 72 hours of publish, and it breaks downstream lockfiles. The standard recovery is **deprecate + patch forward**:

1. Mark the bad version deprecated so installers see a warning:
   ```bash
   npm deprecate anyframe@X.Y.Z "Broken: use X.Y.(Z+1) — see #ISSUE-NUMBER"
   ```

2. Push the fix as a `fix:` commit. The next CI run will publish `X.Y.(Z+1)`.

3. If the version is **less than 72 hours old AND has zero downloads**, npm allows:
   ```bash
   npm unpublish anyframe@X.Y.Z
   ```
   Beyond that window, deprecate is the only option.

---

## 10. Cheat sheet

```bash
# Release a patch
git commit -m "fix: handle empty preview list"
git push origin main

# Release a minor
git commit -m "feat: support codex runtime"
git push origin main

# Release a major
git commit -m "feat!: rename agents.skills.create signature

BREAKING CHANGE: the third arg is now an options object."
git push origin main

# Skip a release explicitly
git commit -m "docs: clarify retry behaviour"
git push origin main

# Run the full guardrail locally (the same checks CI does)
npm run lint && npm run typecheck && npm test && npm run build

# Smoke-test the built tarball
npm pack
# → produces anyframe-X.Y.Z.tgz
cd /tmp && mkdir smoke && cd smoke && npm init -y
npm install /path/to/anyframe-X.Y.Z.tgz
node -e "const { Anyframe } = require('anyframe'); console.log(new Anyframe({ apiKey: 'afm_x' }).baseURL);"

# Deprecate a bad version
npm deprecate anyframe@1.2.3 "Use 1.2.4+ — see issue #42"
```
