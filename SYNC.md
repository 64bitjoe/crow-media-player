# Keeping this fork in step with upstream

This fork is [jamesmcginnis/crow-media-player](https://github.com/jamesmcginnis/crow-media-player) plus a
YouTube artwork fallback. Crow Media Player is the work of [James McGinnis](https://github.com/jamesmcginnis),
and all credit for it goes to the original project. This fork changes as little as it can.

## What the fork adds: YouTube artwork

An Apple TV playing the YouTube app reports the title and channel, but no picture. With `youtube_artwork: true`
on the card (or **YouTube Artwork** in the card editor, under iTunes Artwork Fallback), the card looks the
video up through a `rest_command` in Home Assistant and shows its thumbnail. The API key stays in Home Assistant.

```yaml
rest_command:
  youtube_search:
    url: "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q={{ q | urlencode }}"
    method: GET
    headers:
      X-goog-api-key: !secret youtube_api_key
```

Each video is looked up once (each lookup costs 100 units of the YouTube Data API's 10,000 a day). A real
picture from the player always wins. Without the `rest_command`, or if a lookup fails, the card behaves
exactly like the original.

## What the fork adds: the Apple TV keyboard everywhere

Upstream already has an **Apple TV Keyboard** panel (`atv_keyboard_panel`, on by default), but only in the
remote view. With `apple_tv_keyboard: true` (or **Apple TV Keyboard Everywhere** in the card editor):

- the panel also opens in the full view whenever the TV has a text field open, and closes when it doesn't;
- the compact view gets a small keyboard button instead, which also appears after you close the panel;
- a **Clear** button calls `apple_tv.clear_keyboard_text`;
- with `keyboard_live` (on unless set to `false`; **Live Typing** in the editor), the TV updates as you type:
  about 300 ms after you stop, the whole field is sent with `apple_tv.set_keyboard_text`. Enter and Send
  still send straight away.

Everything is found from the selected player: the `binary_sensor` on the same device ending in
`_keyboard_focus` (or with the `keyboard_focus` translation key), and the config entry from the device, or
from the entity registry when the device belongs to more than one. With no such sensor nothing changes.
If the lookup fails, upstream's own panel takes over as before. An iPhone or iPad only raises its
keyboard after a tap, so when the panel opens on its own, tap the field once (the compact button does both).

## How main is built

`main` is always:

```
upstream/main  →  the fork's patch commits  →  one "Build (yt)" commit
```

- **Patch commits** change only readable files: `source/`, `const.py`, `.github/workflows/sync-upstream.yml`, `FORK.md`,
  this file. They never touch `custom_components/crow_media_player/www/`, `README.md` or `info.md`.
- **Build (yt)** is generated. It holds `www/` rebuilt from `source/` and is thrown away and made again on
  every sync, because the minified one-line files would conflict on every upstream release. It also puts the
  fork notice from `FORK.md` under the title of upstream's `README.md` and `info.md`, so the fork never edits
  upstream's docs directly and they can't conflict. To change the notice, edit `FORK.md`.

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
| `source/crow-media-youtube.js` | new: the whole YouTube artwork feature |
| `source/crow-media-atv-keyboard.js` | new: the whole Apple TV keyboard feature |
| `source/crow-media-player-card.js` | one line at the top of `set hass`, one at the top of `_checkAppleTVKeyboard`, two entries in `CROW_MEDIA_FILES` |
| `source/crow-media-editor.js` | the "YouTube Artwork" toggle under "iTunes Artwork Fallback"; "Apple TV Keyboard Everywhere" and "Live Typing" under "Apple TV Keyboard Panel" |
| `custom_components/crow_media_player/const.py` | two entries in `LAZY_FILES` |
| `README.md`, `info.md` | none in the patches; the build commit adds `FORK.md` under the title |

All of these are marked `fork:` except the editor toggles, which are found by their ids (`youtube_artwork`,
`apple_tv_keyboard`, `keyboard_live`).
