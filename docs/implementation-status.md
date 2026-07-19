# Implementation Status

This file records implementation evidence. The founding documents remain unchanged and authoritative.

## Completed development slices

| Stage | Implemented gate | Automated evidence |
|---|---|---|
| 0 — Illustration laboratory | Generated terrain/surfaces, fixed camera, paper/ink layers, grass, water, ball physics, restrained marks | Original desktop/phone scene and shot captures |
| 1 — Continuous property | Global field/schema, seamless chunk streaming, Rapier terrain queries, physical boundary, IndexedDB | 25 render chunks = 25 streamed colliders; 29 including four boundary colliders; field/collider error 0.00031 m |
| 2 — Embodied traversal | Cursor/keyboard golfer controller, slope/surface safety, foot events, cart entry/drive/park/exit/tracks | 6.91 m walking test; shoreline remained safe rough; 64.08 m cart chunk crossing |
| 3 — Embodied golf | Ball acknowledgment, stance, drag/release swing, named impact, multi-ball placement, cup, off-screen rediscovery | 69.26 m off-screen shot; rediscovered within 0.65 m; four balls restored |
| 4 — Living response | Compact persistent traces, procedural positional audio, pause/accessibility settings | 53 traces in two chunks restored; Web Audio running; four settings restored |
| 5 — First-playable hardening | Mobile/software performance, context restoration, input cancellation, lifecycle resume, denied-storage fallback | 54 fps at 430×932 in software WebGL; every recovery/fallback assertion passed |
| 6 — Ambient breadth slice | Procedural birds, shared wind, restrained weather/paper evolution | Six birds; breeze wind `[1.12, 1.26]`; breeze → overcast sequence |

## Current architecture decisions

- Three.js `WebGLRenderer`, TypeScript, and Vite remain the browser-native stack.
- Rapier loads asynchronously in a separate chunk and owns general collision/query work.
- Golf-ball behavior remains a custom deterministic solver rather than a generic rigid body.
- The property field is authoritative; render meshes and Rapier trimeshes are generated from it.
- The renderer is replaceable and does not own gameplay state.
- The camera has no pan, rotation, zoom, or ball-follow action.
- IndexedDB saves a physical place, not a round or score state.
- Normal play remains canvas-only; semantic DOM is used only while paused/out of play.

## Remaining before public production

- Replace provisional golfer/cart figures with validated, licensed, optimized `.glb` assets and final animation clips.
- Add authored, licensed physical sound recordings while keeping the current procedural fallback.
- Move expensive property generation into Web Workers and implement the development course authoring editor.
- Reduce or reconsider the approximately 843 kB gzip Rapier compatibility chunk.
- Add real-device coverage for iOS Safari, Android Chrome, thermals, touch ergonomics, orientation change, audio interruptions, and storage eviction.
- Add formal unit/property tests (Vitest) alongside the current deterministic Playwright acceptance suites.
- Validate keyboard remapping, controller input, screen-reader behavior of pause/settings, and platform reduced-motion/contrast behavior.
- Tune art composition outside the founding core property; the world field is continuous, but distant regions intentionally have sparser authored landmarks.

