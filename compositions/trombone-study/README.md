# Trombone Study

Three measures for solo trombone in concert pitch and bass clef, transcribed from the supplied pitches and rhythms. The meters are 4/4, 3/4, and 4/4. No key signature, tempo, dynamics, or articulations were added.

The single C in measure 2 is a sixteenth note, followed by a dotted eighth A-flat. Octaves were unspecified; the selected register is Gb2–F3 (scientific pitch notation, middle C = C4):

- Bar 1: G2 quarter, G2 quarter, G2 quarter, quarter rest.
- Bar 2: C3 sixteenth, Ab2 dotted eighth, E3 quarter, quarter rest.
- Bar 3: Eb3, D3, A2, B2 sixteenths; quarter rest; sixteenth rest; F3, C#3, Bb2 sixteenths; Gb2 quarter.

## Files

- `trombone-study.pdf`: one-page printable score, US Letter.
- `trombone-study.html`: self-contained score preview with embedded fonts, file downloads, and a link to Author.
- `trombone-study.png` / `.svg`: raster / vector score images.
- `trombone-study.music-notes.json`: editable Music Notes project; import with Document → Open project or musical HTML.
- `trombone-study.music.html`: accepted musical source for import or editing.
- `edit.html`: launches this score in Author using a separate recovery slot. Existing work in that slot takes precedence on subsequent visits.
- `verification.json`: exact musical comparison and browser/PDF check evidence.

Run `npm run dev -- --host 127.0.0.1 --port 5173` from the repository root and open `http://127.0.0.1:5173/compositions/trombone-study/edit.html` for editing. The static preview and PDF preserve this authored version; changes in Author are saved to its local recovery slot and can be downloaded as a new project.

Validated with Playwright 1.62.1 / Chromium 151.0.7922.34 in an isolated browser context. The Author import and reload worked, all 18 musical events matched their specified pitches and values, measure totals were 4, 3, and 4 quarter-note beats, and the renderer reported no diagnostics. The PDF was rendered with Poppler and visually inspected. Font and renderer licenses are included in `THIRD_PARTY_NOTICES.md`.

## Audio preview

`trombone-study-80bpm.mp3` plays this score with a synthesized trombone at quarter note = 80 BPM. The tempo is a playback assumption; the written score is unchanged. The three measures last 8.25 seconds, with a 0.65-second release tail. All 14 notes and 4 rests are preserved. The sampler uses a small articulation gap (94% note gate).

A lossless 44.1 kHz stereo WAV and a General MIDI file are also included as `trombone-study-80bpm.wav` and `trombone-study-80bpm.mid`. `playback-verification.json` records the decoded pitch, rest, duration, and clipping checks.


## Current editor correction

The first audio used the original on-disk score and did not include subsequent edits saved in the browser. `trombone-study-editor.music.html` captures the current editor pitches and articulations; `trombone-study-editor-80bpm.mp3`, `.wav`, and `.mid` regenerate that version. This includes opening G3s, Ab3 staccato, E3 tenuto, and D4/C#4 in the last measure. `playback-editor-verification.json` records the checks. The original files remain historical exports. Author's Listen view now renders directly from current accepted editor music and downloads its browser-synthesized audio as WAV.
