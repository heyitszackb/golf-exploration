# Golf Exploration

A browser-native 3D golf landscape that plays like a living pencil-and-ink drawing on warm parchment. The player can walk continuously, drive the cart, place and hit multiple balls, leave physical traces, lose a ball off-screen, find it again, and resume the same place after reloading. Normal play contains no HUD, score, minimap, aim line, or camera controls.

![A pencil-drawn overhead view of the golfer exploring the course](docs/images/gameplay.png)

The implementation follows the immutable product, player-experience, art-direction, and engineering guides in [`founding-documents`](./founding-documents).

## Run it

```bash
npm install
npm run dev
```

Open the URL printed by Vite. The production build is created with `npm run build`.

## How to play

- Hold or drag on the landscape to walk toward the pointer.
- Use `WASD` or the arrow keys for keyboard movement; hold `Shift` to reach farther at a brisk walk. The golfer turns into the route before accelerating and uses a distance-driven gait rather than sliding.
- Press `E` or `Space` near a ball. The golfer walks into a side-on address automatically. After the stance settles, pull the pointer back/down to raise the club and set power; a small sideways component adjusts the shot direction. Release to begin the downswing. The ball leaves only when the club reaches the named impact moment, and the golfer completes a follow-through before returning to walking.
- While settled at address, `A`/`D` or the left/right arrows make small alignment adjustments. `Escape`, `E`, or `Space` leaves stance without taking a shot.
- Hold `B` to place another ball on nearby safe ground.
- Press `E` or `Space` near the cart to enter it. Use `W`/`S` to accelerate or reverse, `A`/`D` to steer, `Space` to brake, and `E` to park and exit at a safe point.
- Press `Escape` outside stance to open the semantic pause, controls, and accessibility sheet. It offers higher contrast, larger balls, reduced ambient motion, and stronger sound cues.

Releasing a walking pointer stops the route. A canceled/lost pointer, focus loss, page hiding, or opening pause also clears active movement and cancels an unfinished backswing; none of those cancellation paths can launch the ball.

The camera always stays with the golfer. It never pans to a ball and cannot rotate or zoom. If a shot leaves the screen, walk or drive in its direction to find it.

Developer shot scenarios are available only on a Vite development URL that includes `?debug`:

- `1`: deterministic fairway shot
- `2`: bunker shot
- `3`: water shot
- `4`: green approach

Maintenance and diagnostics keys are also available:

- `R`: reset the starting composition
- `F3`: diagnostics
- `P`: save immediately

## What is implemented

- A property-wide, versioned analytic field with seamless 48 m render/collision chunks and physical outer boundaries.
- Rapier kinematic collision for the golfer and cart, plus a custom deterministic 120 Hz multi-ball golf solver.
- Faster cursor-led traversal with turn-before-translation steering, smooth acceleration/deceleration, surface resistance, slope limits, water/cliff safety, independent foot grounding, a distance-driven gait, and named footstep events.
- A longitudinally modeled, drivable, parkable cart with steering/wheel motion, safe entry/exit, ground alignment, and persistent paired tracks.
- Embodied ball acknowledgment, automatic walk-to-address, body alignment, pointer-driven backswing, delayed named club impact, follow-through/recovery, ball placement, cup capture, off-screen simulation, and rediscovery.
- IndexedDB sessions for golfer, cart, all retained balls, traces, world time/weather, and accessibility settings; denied storage falls back to a fully playable in-memory session.
- Persistent compact trace journals for footprints, cart tracks, divots, pitch marks, and sand marks.
- Procedural positional Web Audio for footsteps, club movement/contact, cart cadence, landings, sand, water, and cup response, unlocked only after a user gesture.
- A synchronous typed world-event seam that fans physical events out to audio, reactive surfaces, and ambient life without putting presentation imports in event producers.
- A shared parchment/graphite palette, pigmented terrain wash, semantic ink contours, directional hatching and stipple, hatched bunker lips/raking, still-water linework, restrained dithering, and soft contact shading.
- Streamed instanced grass, chunk-for-chunk with the terrain, using a fixed-budget shader interaction field for golfer, foot, cart, ball, landing, and club disturbances.
- Three low-frequency procedural bird flocks (twelve birds) that can rest, take off, circle, and land, and react to nearby golfer, cart, club, landing, and water events.
- One camera-stabilized directional shadow source with a paper-sky fill, tight shadow budget, terrain receivers, and inexpensive analytic contact shadows.
- Fixed high-angle orthographic rendering centered on the golfer, with no pan, rotation, zoom, or ball-follow path.
- A semantic pause/settings surface outside play with contrast, ball-size, reduced-motion, and stronger-sound options. Reduced motion preserves the essential gait and swing language while quieting ambient motion.
- WebGL context recovery, hidden/page lifecycle checkpoints, pointer cancellation that cannot commit a swing, and phone-layout verification.

## Can the visual style change later?

Yes. Gameplay does not depend on the pencil renderer.

The authoritative property field, chunk streamer, Rapier world, golfer/cart controllers, swing sequence, ball solver, trace journal, session schema, input actions, and domain events are independent of the current Three.js materials and generated drawing marks. A future renderer can replace the paper palette, linework, grass, water, props, characters, or even the entire visual language while continuing to consume the same world samples, transforms, swing snapshots, and events.

The key rule is to preserve the contracts documented in [`docs/visual-style-contract.md`](./docs/visual-style-contract.md). A replacement renderer must keep visual terrain coincident with `propertyField`, keep world-space scale and coordinates, and preserve physical attachment points and named animation events. This permits a new shader style or authored golfer/cart GLBs without rewriting traversal, golf physics, persistence, or course data.

## Architecture

```text
Property blueprint + authoritative field
                |
        deterministic chunk streamer
          /                         \
 illustrated terrain             Rapier world
          \                         /
 golfer/cart controllers + swing + multi-ball solver
          |                  |
  typed world events    session snapshots + traces
       /       \                  |
 renderer    positional audio  IndexedDB
```

Important source boundaries:

- `src/world`: property schema, field, chunks, traces, and environment
- `src/physics`: streamed Rapier collision/query world and kinematic agents
- `src/simulation`: golfer, cart, swing-sequence, and golf-ball state machines
- `src/core`: renderer-agnostic typed world-event contract and synchronous fan-out
- `src/render`: replaceable illustrated renderer, centralized art grammar/lighting, provisional figures, chunked reactive grass, marks, and ambient flocks
- `src/audio`: replaceable event-driven Web Audio presentation
- `src/persistence`: versioned world-session storage and graceful fallback
- `src/main.ts`: lifecycle and typed orchestration

See [`docs/implementation-status.md`](./docs/implementation-status.md) for milestone evidence and remaining production work.

## Validation

```bash
npm run build
npm run screenshots
npm run verify:foundation
npm run verify:traversal
npm run verify:golf
npm run verify:environment
npm run verify:first-playable
npm run verify:ambient
```

The browser suites use deterministic scenarios in Chromium with software WebGL and write ignored review images to `artifacts/screenshots/`. They verify renderer/physics agreement, chunk transitions, persistence, camera invariants, walking and cart safety, swing/multi-ball behavior, environmental memory, accessibility, context recovery, denied storage, and ambient breadth.

## Honest production gaps

The current golfer and cart are code-generated provisional figures. The architecture is ready for the two approved authored `.glb` assets, but final modeling, rigging, clips, and animation-event metadata are not included. Procedural Web Audio proves the spatial/event architecture but should be supplemented with restrained authored recordings. The development course editor and worker-based chunk generation from the founding architecture are not yet built. Rapier is asynchronously split from the initial app code, but its compatibility bundle is still large. Real iOS/Android hardware, assistive technology, and broader browser/device testing remain necessary before a public release.
