<p align="center">
  <img src="assets/flicker-github-banner.png" alt="Flicker" width="640">
</p>

# Flicker

**Keep. Delete. Move on.**

A local media triage app for Windows — a full-screen, swipe-style way to burn through a
folder of photos and videos and decide the fate of each one: keep, delete, or move.
Built with Electron, no cloud, no accounts, nothing leaves your machine.

## Why

Camera rolls and download folders accumulate thousands of near-duplicate photos and
screenshots. Flicker turns cleanup into a single-file-at-a-time flow: one file fills the
screen, you make one decision, the next file appears. Arrow keys, on-screen buttons, or a
swipe — whatever's fastest.

## Features

- **Delete Mode** — left = delete, right = keep. Deleted files move to a `_deleted`
  subfolder inside the source (never permanently gone).
- **Move Mode** — left = keep, right = move to a chosen destination folder.
- **Undo** — reverse the last action at any point.
- **Session summary** — a quick tally of what was kept, moved, and deleted when you end a
  session.
- Handles both images (jpg, png, gif, webp, bmp, svg, avif, heic) and videos (mp4, webm,
  mov, m4v, mkv, avi, ogg), with proper video seeking via range-request streaming.

## Running from source

```bash
npm install
npm start
```

## Building a Windows executable

```bash
npm run dist
```

Produces a portable, single-file `.exe` in `dist/` — no installer, just run it.

## Tech

Electron main process owns the filesystem (folder picking, file moves/deletes, and a
custom `flicker-media://` protocol for streaming media with `Range` support). The
renderer is a single static HTML/CSS/JS file with no framework and no build step. IPC
between them is scoped to four calls exposed through a `contextBridge` preload, with
`contextIsolation` and `sandbox` on.

## License

ISC
