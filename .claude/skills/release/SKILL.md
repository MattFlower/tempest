---
name: release
description: Cut a release for Tempest. Reads CHANGELOG.md, suggests a version, updates the changelog, tags, pushes, and verifies the GitHub release. Use when the user says "cut a release", "make a release", "release", or "tag a release".
allowed-tools: Bash, Read, Edit, AskUserQuestion
---

# Release Skill

Cut a new release for Tempest. Follow these steps exactly.

## Step 1: Determine the version

1. Read `CHANGELOG.md` and review the items under the `## Unreleased` section.
2. If the Unreleased section has no meaningful entries (only empty headings), stop and tell the user there is nothing to release.
3. Based on the scope of changes, suggest a version number following semver. Show the user the summary and your suggested version.
4. Ask the user to confirm or provide a different version number. Do not proceed until confirmed.

## Step 2: Determine today's date

Run `date +%Y-%m-%d` to get today's date. Do not guess or hardcode the date.

## Step 3: Update CHANGELOG.md

1. Replace `## Unreleased` with `## [VERSION] - YYYY-MM-DD` (using the confirmed version and today's date).
2. Immediately after the new version heading and its content, add a fresh Unreleased section with empty subsections:

```
## Unreleased

### Added

### Fixed

### Changed

### Removed
```

3. Verify the edit looks correct by reading the first 25 lines of CHANGELOG.md.

## Step 4: Update the app version

Update the version number in both places it appears:

1. **`electrobun.config.ts`** — change the `version` field in the `app` object to the new VERSION.
2. **`src/bun/pty-manager.ts`** — change the `TERM_PROGRAM_VERSION` value to the new VERSION.

Use the Edit tool for both changes.

## Step 5: Detect VCS and commit

1. Check whether the repo uses jujutsu or git:
   - If `.jj` directory exists: use jj commands
   - Else if `.git` directory exists: use git commands
   - **NEVER use git commands for commits, bookmarks, or branches in a jj repo.**

2. For **jujutsu** repos:
   ```
   jj describe -m "Release VERSION"
   jj new
   jj bookmark set main -r @-
   jj git push
   ```

3. For **git** repos:
   ```
   git add CHANGELOG.md
   git commit -m "Release VERSION"
   git push
   ```

## Step 6: Tag the release

1. For **jujutsu** repos:
   ```
   jj tag set vVERSION -r main
   ```
   Then push the tag via git (jj has no tag push support):
   ```
   git push origin vVERSION
   ```

2. For **git** repos:
   ```
   git tag -a vVERSION -m "Release VERSION"
   git push origin vVERSION
   ```

## Step 7: Verify the release workflow

1. Wait a few seconds, then check for the triggered workflow:
   ```
   gh run list --repo MattFlower/tempest --limit 3
   ```
2. Find the Release Build run triggered by the tag push and watch it:
   ```
   gh run watch RUN_ID --repo MattFlower/tempest --exit-status
   ```
   Run this in the background with a 10-minute timeout.

3. When the run completes:
   - If **success**: verify the GitHub release exists with `gh release view vVERSION --repo MattFlower/tempest` and report the URL to the user.
   - If **failure**: fetch logs with `gh run view RUN_ID --repo MattFlower/tempest --log-failed` and report the error to the user.
