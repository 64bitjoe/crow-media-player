# Keeping this fork in step with upstream

This fork is [jamesmcginnis/crow-media-player](https://github.com/jamesmcginnis/crow-media-player) plus a
YouTube artwork fallback. `main` is always:

```
upstream/main  →  the fork's patch commits  →  one "Build (yt)" commit
```

- **Patch commits** change only readable files: `source/`, `const.py`, `.github/workflows/sync-upstream.yml`,
  this file. They never touch `custom_components/crow_media_player/www/`.
- **Build (yt)** is generated. It holds `www/` rebuilt from `source/` and is thrown away and made again on
  every sync, because the minified one-line files would conflict on every upstream release.

## What happens automatically

`.github/workflows/sync-upstream.yml` runs every day at 05:17 UTC, and from **Actions → Sync upstream → Run
workflow**. It:

1. fetches upstream, drops the old `Build (yt)` commit and replays the patch commits on `upstream/main`;
2. runs `npm run build` in `source/` and commits the result as `Build (yt)`;
3. if anything changed, pushes `main` with `--force-with-lease` and releases `v<upstream version>-yt.<n>`
   (for example `v0.0.5-yt.1`) so HACS offers the update.

If a patch no longer applies, nothing is pushed or released. Instead an issue labelled `upstream-sync` lists
the conflicting files and the new upstream commits. The next clean sync closes it.

One-time setup: the repository secret `SYNC_TOKEN`, a fine-grained personal access token for this repository
only, with **Contents: read and write** and **Workflows: read and write**. Without it the workflow falls back
to `GITHUB_TOKEN`, which GitHub refuses to let push commits that touch `.github/workflows/`. Scheduled
workflows on a fork also have to be switched on once in the **Actions** tab.

## Fixing a conflict by hand

```sh
git checkout main
git fetch upstream
git fetch origin && git reset --hard origin/main   # start from what's published

# take out the generated build commit (it is always the last one), then rebase the patches
git reset --hard HEAD~1                             # only if `git log -1` shows "Build (yt)"
git rebase upstream/main

# for each conflict: fix the file (keep upstream's change and re-add the one-line `// fork:` hook), then
git add <file>
git rebase --continue

git push --force-with-lease origin main
```

Then run **Actions → Sync upstream → Run workflow**. It rebuilds `www/`, pushes `Build (yt)` and makes the
release. You don't need Node locally. If you'd rather build locally anyway:
`cd source && npm install && npm run build`, but commit only `source/` changes: the workflow regenerates
the build commit and throws a local one away.

If a conflict is in a built file under `www/` (usually because the `Build (yt)` commit wasn't taken out
first), take upstream's version with `git checkout --ours <file>` (while rebasing, "ours" is the upstream
side), `git add` it, and let the workflow rebuild it.

## Where the fork touches upstream files

| File | Change |
| --- | --- |
| `source/crow-media-youtube.js` | new: the whole feature |
| `source/crow-media-player-card.js` | one line at the top of `set hass`, one entry in `CROW_MEDIA_FILES` |
| `source/crow-media-editor.js` | the "YouTube Artwork" toggle under "iTunes Artwork Fallback" |
| `custom_components/crow_media_player/const.py` | one entry in `LAZY_FILES` |

All of these are marked `fork:` except the editor toggle, which is found by its `youtube_artwork` id.
