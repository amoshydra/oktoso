# Publishing

Oktoso uses **release-please** to manage versions, changelogs, release PRs, and
GitHub releases. The release workflow publishes to npm with trusted publishing
(OIDC) and provenance.

- Workflow: [`../.github/workflows/publish.yml`](../.github/workflows/publish.yml)
- Config: [`../release-please-config.json`](../release-please-config.json)
- Manifest: [`../.release-please-manifest.json`](../.release-please-manifest.json)

There is no `NPM_TOKEN` secret.

## One-time npm setup

On npm:

1. Open the `@amoshydra/oktoso` package settings.
2. Open **Trusted Publisher** → **GitHub Actions**.
3. Set:
   - Organization or user: `amoshydra`
   - Repository: `oktoso`
   - Workflow filename: `publish.yml`
   - Environment: leave blank
4. Save.

The same setup from the npm CLI:

```sh
npm trust github @amoshydra/oktoso \
  --file publish.yml \
  --repo amoshydra/oktoso \
  --allow-publish \
  -y
```

The workflow filename must be `publish.yml`. If an
npm environment is configured, add `environment: npm` (or the configured name)
to the `publish` job.

The repository must be public for provenance. If it is private, remove
`--provenance` and `NPM_CONFIG_PROVENANCE` from the workflow, or make the
repository public before publishing.

## Release flow

Use conventional commits:

```text
fix: ...
feat: ...
feat!: ...
chore: ...
docs: ...
refactor: ...
```

On every push to `main`:

1. Release-please opens or updates a **release PR**.
2. The release PR contains the next version and `CHANGELOG.md` entries.
3. Review the PR, then merge it.
4. The same workflow runs again, creates the release and tag, and the publish
   job runs because `release_created == 'true'`.
5. The publish job checks out the new tag, verifies the tag matches
   `package.json`, runs the checks, builds the single-port package, and runs
   `npm publish --provenance --ignore-scripts`.

Do not create version tags by hand. Release-please owns `vX.Y.Z` tags and
`CHANGELOG.md`.

The `extra-files` entry in `release-please-config.json` also bumps the Even G2
manifest and package versions, so the app listing cannot drift from the hub
release.

### Pre-1.0 version policy

Until `1.0.0`, the repository intentionally keeps feature releases on the patch
line:

```json
"bump-minor-pre-major": true,
"bump-patch-for-minor-pre-major": true
```

The resulting policy is:

| Commit | Version bump before 1.0.0 |
|---|---|
| `fix:` | patch |
| `feat:` | patch |
| `feat!:` / `BREAKING CHANGE:` | minor |

After `1.0.0`, remove both options and use normal SemVer: fix → patch, feat →
minor, breaking change → major.

`.release-please-manifest.json` tracks the latest published version. Release
PRs always compare against that baseline.

## Verify a release

```sh
npm view @amoshydra/oktoso version dist.attestations
npx --yes @amoshydra/oktoso@<version> --version
```

The attestations output confirms the OIDC/provenance publish path.

## Troubleshooting

### `404 Not Found` on publish

- Confirm the package name in `package.json` is exactly `@amoshydra/oktoso`.
- Confirm the trusted publisher entry uses repo `amoshydra/oktoso` and workflow
  `publish.yml`.
- Confirm the npm account owns or belongs to the `@amoshydra` scope.
- Confirm the package is public.

### `EOTP` or `E401`

OIDC publishing does not use a long-lived npm token. If npm asks for a one-time
password or returns 401, the trusted publisher entry is not being matched.
Check the repository, workflow filename, and environment fields.

### Version already exists

npm does not allow republishing an existing version. Close the release PR, bump
the version through a new conventional commit, and let release-please open a new
PR.

### npm CLI too old

Trusted publishing requires npm 11.5.1 or newer. The workflow checks this and
fails with a clear message. Node 24 images currently ship a suitable npm.

### Release PR was not created

- Confirm the push was to `main`.
- Confirm the commit messages use conventional prefixes.
- Confirm the workflow has `contents: write` and `pull-requests: write`.
