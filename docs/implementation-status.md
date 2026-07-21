# Implementation Status

This file records implementation evidence. The founding documents remain unchanged and authoritative.

## Completed development slices

| Stage | Implemented gate | Automated evidence |
|---|---|---|
| 0 — Illustration laboratory | Generated terrain/surfaces, fixed camera, cohesive parchment/graphite palette, pigment wash, ink/hatching/stipple, still-water drawing, grass, ball physics, restrained marks | Desktop/phone scene and shot captures |
| 1 — Continuous property | Global field/schema, seamless chunk streaming, Rapier terrain queries, physical boundary, IndexedDB | 25 terrain chunks = 25 grass chunks = 25 streamed colliders; 29 colliders including four boundaries; field/collider error below 0.00036 m |
| 2 — Embodied traversal | Faster cursor/keyboard controller, turn-before-translation steering, smooth acceleration, distance-driven gait, slope/surface safety, foot events, longitudinal cart entry/drive/park/exit/tracks | 8.41 m in the two-second walking test; shoreline remained safe rough; 64.08 m cart chunk crossing; cart visual/travel dot product above 0.9999; reactive surface field active while walking |
| 3 — Embodied golf | Ball acknowledgment, automatic walk-to-address, pointer backswing, delayed named impact, follow-through/recovery, cancellation safety, multi-ball placement, cup, off-screen rediscovery | 68.74 m off-screen shot; rediscovered within 0.05 m; four balls restored; side-on body/shot dot product 0; cancelled drag launched nothing |
| 4 — Living response | Compact persistent traces, procedural positional audio, pause/accessibility settings | 57 traces in three chunks restored, including footprints, tracks, pitch mark, and divot; Web Audio running; four settings restored |
| 5 — First-playable hardening | Mobile/software performance, context restoration, input cancellation, lifecycle resume, denied-storage fallback | 50 fps / 20.2 ms at 430×932 in software WebGL; every recovery/fallback assertion passed |
| 6 — Ambient breadth slice | Three reactive four-bird flocks, shared wind, restrained weather/paper evolution, chunked reactive grass | Twelve birds in three flocks; approaching a grounded flock triggered four takeoffs; breeze wind about `[1.08, 1.20]`; breeze → overcast sequence |

## Current cohesion pass

- `art-style.ts` centralizes the warm paper, graphite, surface pigment, shadow, and shared budget values used across the illustrated renderer.
- Terrain combines semantic surface pigment with slope-aware daylight, broken contours, restrained hatching/stipple, bunker rake marks and lips, stable screen-door dithering, and horizontal broken water lines.
- The scene uses one directional shadow caster, snapped to shadow texels around the fixed golfer-centered camera, plus one hemisphere fill. Terrain receives that restrained shadow layer; small analytic contact marks keep feet, wheels, and balls legible without multiplying shadow-map work.
- Grass is one deterministic instanced mesh per active property chunk. All chunks share geometry and material, and a fixed twelve-entry interaction field bends nearby blades for golfer, footsteps, cart, low balls, landings, and club contact.
- Ambient life is organized into three deterministic flocks with grounded, taking-off, circling, and landing states. Nearby movement and physical golf events can trigger a reaction; reduced motion suppresses flapping and idle jitter without removing the birds.
- The procedural golfer has articulated legs with attached shoes, distance-driven stride, ground-normal adaptation, automatic walk-to-address, and an explicit address/backswing/downswing/follow-through/recovery presentation sequence.
- Releasing a valid backswing commits the sequence but does not launch the ball immediately. Gameplay launches at the named impact event during the downswing; the follow-through and recovery finish before walking resumes.
- `pointercancel`, lost pointer capture, window blur, page hiding, and opening pause clear active input and cancel an unfinished backswing. Those paths do not reuse the pointer-up commit path.
- Physical producers publish a small typed event union. The illustrated world and positional audio subscribe independently, so reactive grass, flocks, swing/impact sound, and future presentation adapters do not become simulation dependencies.

## Current architecture decisions

- Three.js `WebGLRenderer`, TypeScript, and Vite remain the browser-native stack.
- Rapier loads asynchronously in a separate chunk and owns general collision/query work.
- Golf-ball behavior remains a custom deterministic solver rather than a generic rigid body.
- The property field is authoritative; render meshes and Rapier trimeshes are generated from it.
- The renderer is replaceable and does not own traversal, swing timing, or ball state.
- The camera is fixed high-angle orthographic, translated only to keep the golfer centered; it has no pan, rotation, zoom, or ball-follow action.
- The swing sequence owns address/gesture/timing phases and publishes named semantic moments; the golfer renderer consumes only a presentation snapshot.
- A typed synchronous world-event bus separates physical event producers from illustrated and audio consumers.
- Grass is streamed with property chunks and uses a bounded shader interaction field rather than per-blade JavaScript updates.
- One stabilized directional light is the only shadow-map source; ambient fill and analytic contact shadows provide the rest of the grounding language.
- IndexedDB saves a physical place, not a round or score state.
- Normal play remains canvas-only; semantic DOM is used only while paused/out of play.
- Pause cancels active input, checkpoints the session, and moves focus into a semantic sheet. Reduced-motion mode preserves essential locomotion and club communication while reducing environmental motion.

## Remaining before public production

- Replace provisional golfer/cart figures with validated, licensed, optimized `.glb` assets and final animation clips.
- Add authored, licensed physical sound recordings while keeping the current procedural fallback.
- Move expensive property generation into Web Workers and implement the development course authoring editor.
- Reduce or reconsider the approximately 843 kB gzip Rapier compatibility chunk.
- Add real-device coverage for iOS Safari, Android Chrome, thermals, touch ergonomics, orientation change, audio interruptions, and storage eviction.
- Add formal unit/property tests (Vitest) alongside the current deterministic Playwright acceptance suites.
- Validate keyboard remapping, controller input, screen-reader behavior of pause/settings, and platform reduced-motion/contrast behavior.
- Tune art composition outside the founding core property; the world field is continuous, but distant regions intentionally have sparser authored landmarks.
- Continue visual QA on real displays for ink density, shadow stability, dither behavior, grass readability, and the timing clarity of address/impact/follow-through.
