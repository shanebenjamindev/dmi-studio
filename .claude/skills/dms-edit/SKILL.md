---
name: dms-edit
description: Edit DMI Studio video projects (storyboard scenes, text, durations, colors, AI clips/voice) through the dms CLI. Use when the user asks to change, shorten, reorder, rewrite or regenerate anything in a DMI Studio video/project — e.g. "sửa video", "đổi cảnh 2", "rút ngắn còn 15s", "tạo giọng đọc cho dự án X", "làm video mới về…".
---

# Editing DMI Studio projects with the `dms` CLI

The CLI talks to the running DMI Studio server's REST API. Run it from the repo root:

```bash
npm run -s dms -- <command> ...
```

## Before editing
1. `npm run -s dms -- projects`: if it says the server is unreachable, ask the user to run `npm start` (do not start it yourself against their real data). If it says not signed in, ask the user to run `npm run -s dms -- login` in their own terminal, because it prompts for a password. Never ask them to paste the password into the chat.
2. `npm run -s dms -- show <project>` to see the scenes. `<project>` is the list number, the `p_…` id, or part of the title.
3. Remind the user once to close that project in the browser editor, because its autosave can overwrite CLI changes.

## Choosing the right command
- Small, precise changes (one field, a few scenes): `set`, for example
  `set 2 3 headline="Bóng như gương" duration=4`, `set 2 all animation=zoom`, `set 2 title="…" palette.accent=#16c3f6`.
- Structure: `add <p> [after] k=v…`, `rm <p> 2,4`, `mv <p> 5 2`, `dup <p> 3`.
- Many coordinated edits (rewrite all captions, rebalance timing to hit a total length): `get <p> --out <temp file>.json` (a temp/scratch path, not inside the repo), edit the JSON yourself, then `put <p> file.json`. Keep each kept scene's `id` so its generated media and voice survive. Omit `id` on new scenes. Do not touch `media`/`voice` objects unless asked.
- New video from a brief: write the storyboard JSON yourself (schema in `server/storyboard.ts`: title, palette, font, music {mood, bpm}, voice_style, scenes[]) to a temp file, then `create <file.json> --aspect 9:16`. No API cost.
- No paid APIs exist in DMI Studio any more: `refine` and `new` run through the server's Claude Code CLI (the signed-in Claude account). There is no clip, image or voice generation. Scenes use the animated `background`. It is often faster to write the storyboard yourself with `set`, `add` or `get`/`put`.
- Client footage on Google Drive: `new "brief" --drive <folder link>` (Claude views every thumbnail, keeps only matching clips/photos and sets them as scene backgrounds), or `drive <p> <link>` to attach a folder to an existing project, then `refine <p> "…"` to re-filter by a chat request. `show` prints each scene's `source:` file.
- Projects built from a request sheet are in edit mode (`storyboard.mode = "edit"`): each scene is a voice-over beat with `shots` (clip + `from` in-point + `dur` + camera `move`) and timed `texts` (`text`, `at`, `dur`, `style` price|title|tag|lower|cta, `pos`), plus `storyboard.logo` (client logo). Layout/animation/background fields do not apply there. Edit them with `get`/`put` or `refine`, and keep a scene's `duration` equal to the sum of its shot durations.
- Mistake? `undo <p>` restores the state before the last CLI write. Backups are kept per project in `~/.dms/backups`.

## Content rules (same as the app's AI)
- On-screen text short (headline ≤ ~8 words). `caption` is the spoken voice-over, about 2.5 words per second of `duration`.
- `visual_prompt` is always English, no on-screen text, logos or real people's names.
- Detailers Movement brand: font `brand`, palettes night/blue/light/ink, last scene layout `outro` with a 2–3 word CTA in `subtext`.
- Valid values: layout title|bullets|stat|quote|split|outro; animation fade|slide-up|zoom|typewriter|pop; background gradient|particles|grid|waves|blobs|solid; duration 1–15s.

After editing, run `show` and summarize what changed. Exporting the MP4 still happens in the browser (⤓ Xuất video).
