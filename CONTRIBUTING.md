# Contributing to Rome Apps

Thanks for helping improve Rome Apps. This repository contains first-party apps that run inside Rome, so changes should be small, testable, and safe to install in an existing environment.

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- Search [existing issues](https://github.com/rome-os/rome-apps/issues) and pull requests before opening a duplicate.
- Open an issue before a large feature, new app, schema change, or breaking behavior so maintainers can confirm the direction.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md), not in a public issue.

## Development setup

You need Node.js 24.11.1 or newer and pnpm 10.33.2 or newer.

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm test
```

Keep the primary checkout on `main` and use a worktree for each change:

```bash
git checkout main
git pull --ff-only origin main
git worktree add ../rome-apps-my-change -b feat/my-change
cd ../rome-apps-my-change
pnpm install
```

## Making a change

Each app lives under `apps/<app-id>/` and declares its capabilities in `app.yaml`.

- Follow the patterns already used by that app.
- Do not import runtime code from another app.
- Import only files from the same app, Node.js built-ins, declared dependencies, `@rome-os/app-runtime`, or `@rome-os/app-web-sdk`.
- Build from `src/` into `dist/` where the app uses a build step; the Rome daemon loads `dist/`.
- Add focused tests for new behavior and regressions when the app has a test suite.
- Update the app's `app.yaml` version using semantic versioning. Breaking changes require a major version bump.
- Keep unrelated formatting, generated files, and dependency changes out of the pull request.

For the complete app contract, read the [Rome App building guide](https://romeos.cc/docs/building-apps).

## Validate locally

At minimum, run:

```bash
pnpm typecheck
pnpm test
```

Build the changed app if it has a build script:

```bash
pnpm --filter "./apps/<app-id>" run build
```

For UI, API, action, database, or agent changes, install the app into a development Rome instance and exercise the changed behavior end to end. Describe that validation in the pull request.

## Third-party material

Do not copy code, skills, media, fonts, or other material into this repository unless its license permits redistribution.

When third-party material is necessary:

- Preserve its copyright and license files.
- Add its source and license to [NOTICES.md](NOTICES.md).
- Clearly identify modifications.
- Avoid material with missing, ambiguous, non-commercial, or no-redistribution terms.

## Pull requests

Use a concise English title and explain:

- What changed and why.
- Which app versions changed.
- How the change was tested.
- Any migration, compatibility, security, or publishing implications.

Pull requests should be ready for review, focused on one coherent change, and pass all CI checks. Maintainers may ask for changes before merging.

Unless stated otherwise, contributions intentionally submitted to this repository are licensed under the repository's [MIT License](LICENSE).
