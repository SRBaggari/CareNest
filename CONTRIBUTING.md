# Contributing to CareNest

CareNest is developed by two people, each with their own copy of the repository:

| Remote | Repository |
|---|---|
| `origin` | https://github.com/SRBaggari/CareNest |
| `peer` | https://github.com/manishreddy1767/CareNest |

Both repositories always hold the same `main`.

## 1. Set your commit identity for this repository

GitHub credits a commit to the account that owns the commit's **email address**. The name doesn't
matter. If several people share one computer, set the identity **per repository** rather than globally:

```bash
git config --local user.name  "Your Name"
git config --local user.email "an-email-verified-on-your-github-account@example.com"
git config user.email   # check before committing
```

If commits don't appear on your GitHub profile, check that this email is listed and verified under
GitHub → Settings → Emails.

### Credit both developers on every commit

Shared work is credited to both accounts. End every commit message with a co-author trailer for the
other developer (GitHub counts co-authored commits on both profiles):

```
Co-authored-by: SAHASRA REDDY BAGGARI <baggarisahasra07@gmail.com>
Co-authored-by: MANISH REDDY <manishreddy1767@gmail.com>
```

Leave out the line for whoever is the commit's author.

## 2. Remotes with the right login

Put each owner's username in the remote URL, so Git Credential Manager uses the matching stored login:

```bash
git remote set-url origin https://SRBaggari@github.com/SRBaggari/CareNest
git remote add     peer   https://manishreddy1767@github.com/manishreddy1767/CareNest
```

## 3. Workflow

1. Branch from an up-to-date `main`: `feat/m<N>-<feature>` (or `docs/…`, `fix/…`).
2. Each feature comes with unit tests (`src/**/*.test.ts`) and integration tests (`tests/integration`).
3. Run `npm run check` (lint, typecheck, all tests). It must pass before merging.
4. Merge with `git merge --no-ff` into `main`.
5. Push the branch and `main` to **both** remotes:
   ```bash
   git push origin main <branch>
   git push peer   main <branch>
   ```
6. Tag each finished milestone (`m0`, `m1`, …) and push the tag to both remotes.

**Never force-push.** If a push is rejected, the other repository has new commits. Fetch them, merge,
and push again, so nobody's work is overwritten.

See [AGENTS.md](AGENTS.md) for code conventions and [docs/PLAN.md](docs/PLAN.md) for the roadmap.
