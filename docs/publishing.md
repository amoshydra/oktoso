# Publishing

The package is published as `@amoshydra/oktoso` from GitHub Actions using npm
trusted publishing (OIDC). The workflow is
[`../.github/workflows/publish.yml`](../.github/workflows/publish.yml).

There is no `NPM_TOKEN` secret. npm exchanges a short-lived GitHub OIDC token
for a publish credential, and npm records provenance for the release.

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

The workflow filename must match exactly. If an npm environment is configured,
add `environment: npm` (or the configured name) to the `publish` job.

The repository must be public for provenance. If it is private, remove
`--provenance` and `NPM_CONFIG_PROVENANCE` from the workflow, or make the
repository public before publishing.

## Release flow

Update the version, commit it, tag the same version, and push the commit and tag:

```sh
npm version patch --no-git-tag-version
git add package.json
git commit -m "chore: release v0.1.1"
git tag v0.1.1
git push origin main --tags
```

The tag must be `v` followed by the exact `package.json` version. The workflow
fails before publishing if they differ.

The workflow then:

1. Installs with a frozen lockfile.
2. Runs typecheck, tests, the OpenAPI check, the single-port build, and
   `npm pack --dry-run`.
3. Checks that npm is at least 11.5.1.
4. Builds again and publishes with `npm publish --provenance --ignore-scripts`.

`--ignore-scripts` is intentional: the workflow has already built the package.
Local `npm publish` still runs `prepublishOnly` and builds automatically.

## Verify a release

```sh
npm view @amoshydra/oktoso version dist.attestations
npx --yes @amoshydra/oktoso@<version> --version
```

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

npm does not allow republishing an existing version. Bump `package.json`, commit,
and create a new tag. The currently published version is `0.1.0`; the first
workflow release must be a later version.

### npm CLI too old

Trusted publishing requires npm 11.5.1 or newer. The workflow checks this and
fails with a clear message. Node 24 images currently ship a suitable npm.
