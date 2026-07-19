# Founding Engineering Architecture

**Status:** Final recommendation  
**Date:** July 19, 2026  
**Product:** A continuous browser-based 3D golf landscape rendered as a living
pencil-and-ink illustration

This architecture implements the
[Founding Player Experience Guide](../player-experience/README.md), the
[Founding Art Direction Guide](../art-direction/README.md), and the fixed
camera decision recorded for the project.

## 1. Final recommendation

Build a browser-native 3D game with the following stack:

| Layer | Decision |
|---|---|
| Language | TypeScript with strict compiler settings |
| Build system | Vite |
| Rendering | Three.js `WebGLRenderer` on WebGL 2 |
| Camera | Fixed high-angle orthographic camera centered on the golfer |
| General collision | Rapier 3D through its JavaScript/WebAssembly package |
| Golf-ball simulation | Purpose-built fixed-step multi-ball solver |
| World | One property-wide authored blueprint, procedurally realized and streamed in chunks |
| Course authoring | Development-only in-browser spline and terrain editor |
| Procedural work | Web Workers producing transferable typed arrays |
| Shading | Custom GLSL terrain, ink, grass, water, prop, and compositing materials |
| Interface | Semantic HTML/CSS outside normal play; no UI framework required |
| Input | Pointer Events, keyboard, touch gestures, and optional Gamepad API |
| Audio | Native Web Audio with positional authored samples and procedural ambience |
| Persistence | Versioned IndexedDB world-session saves |
| Authored 3D assets | One rigged golfer `.glb` and one articulated cart `.glb` |
| GPU texture assets | KTX2/Basis Universal |
| Tests | Vitest, deterministic simulation fixtures, and Playwright browser tests |
| Delivery | Static HTTPS/CDN deployment with compressed content-hashed assets |

The game is a persistent place simulation, not a sequence of golf holes. Tees,
fairways, greens, bunkers, flags, paths, and cups exist as meaningful landscape
features, but they do not create level boundaries, objectives, scoring states,
or prescribed progression.

The 3D scene is generated almost entirely in code. Human-authored composition
is stored as compact data—splines, elevation controls, regions, paths, and
landmarks—rather than baked terrain meshes. Runtime code turns that data into
terrain, collision, surface behavior, vegetation, linework, water, and
interaction systems.

The golfer and cart are the two justified authored 3D exceptions. Both carry
critical silhouette, animation, attachment, and interaction responsibilities
that would cost more to reproduce convincingly from primitives than their very
small browser payload justifies.

## 2. Architectural promises

These are invariants, not optional features.

### The world is continuous

- The property is one connected coordinate space.
- There are no isolated hole scenes or loading transitions between holes.
- The golfer, cart, balls, traces, and ambient state retain their real
  positions.
- A shot may cross from one fairway or green into any other reachable region.
- Only genuine terrain and environmental boundaries restrict travel.

### Normal play shows only the world

There is no normal-play score, par, stroke count, club label, distance number,
wind number, minimap, waypoint, aim line, power meter, interaction prompt,
objective, success message, or tutorial text.

Posture, animation, sound, physical positioning, terrain, and object response
communicate the game state. DOM screens exist only outside normal play for
loading, pause, settings, accessibility, compatibility errors, controls
reference, and deliberate reset.

### The camera belongs to the golfer

- Projection is orthographic.
- Pitch, yaw, world orientation, and scale never change.
- The player cannot pan, rotate, or zoom.
- The camera never follows, frames, or recenters on a ball.
- The golfer remains at a fixed near-center screen anchor.
- The camera translates smoothly with the golfer, including while the golfer is
  seated in the cart.
- Terrain-height compensation may move the camera vertically to preserve the
  fixed composition and prevent clipping.

If a ball leaves the screen, it remains physical and continues to simulate. The
player walks or drives in the shot’s direction and finds it through memory,
terrain evidence, nearby sound, grass displacement, and the golfer’s local
attention. There is no global ball marker.

### Every action has a physical consequence

- Walking changes with slope and surface.
- A swing launches a continuously simulated ball.
- Grass bends and settles.
- Sand records feet, club contact, landing, and drag.
- Water produces restrained splashes and ripples.
- The cart grounds to terrain and leaves paired tracks.
- Balls remain wherever they stop, sink, or become inaccessible.
- The world never silently relocates a ball to fit a rule.

### One world model drives every subsystem

Visible terrain, collision, ball response, player traversal, cart traversal,
hatching, surface audio, plant placement, water, and environmental traces all
derive from one authoritative `CourseWorld` representation.

Rendering and physics may use different optimized data structures, but those
structures must be generated from the same source and covered by agreement
tests.

## 3. Why this browser architecture fits the game

Three.js provides direct control over procedural geometry, instancing, custom
materials, render targets, animation, and glTF loading without placing the
world inside a proprietary scene format. That control is important because the
signature renderer is not conventional PBR; it is a semantic pencil-and-ink
system whose marks respond to slope, surface, distance, and interaction.

The production renderer is `WebGLRenderer`. Three.js currently describes its
newer `WebGPURenderer` as experimental and recommends `WebGLRenderer` for pure
WebGL 2 applications. The required effects—instanced grass, render-target
interaction fields, derivatives, world-space hatching, depth/normal edges, and
pooled particles—fit within WebGL 2. See the official
[Three.js renderer guidance](https://threejs.org/manual/en/webgpurenderer).

Rapier is a core dependency because direct walking, cart driving, persistent
props, cliff/water safety, and safe entry/exit require robust collision and
spatial queries from the first playable. Rapier supports heightfields,
triangle meshes, shape casts, character control, and continuous collision
detection. It is not responsible for the complete golf-ball model; that remains
a specialized solver so golf aerodynamics, bounce, spin, roll, sand, water, and
cup behavior stay understandable and tuneable.

No application server is required for the first release. The world, simulation,
assets, and saves run in the browser and can be deployed as static files.

## 4. Runtime topology

```text
Browser application shell
  |
  +-- Lifecycle and capability manager
  +-- Fixed-step simulation clock
  +-- Input action mapper
  +-- Audio graph
  +-- IndexedDB session store
  |
  +-- CourseWorld
  |     |
  |     +-- property blueprint + generator version + seed
  |     +-- authoritative height/surface/traversal field
  |     +-- streamed render and collision chunks
  |     +-- deterministic prop and vegetation placement
  |     +-- per-chunk trace journals
  |
  +-- Concurrent simulation
  |     |
  |     +-- golfer state and kinematic controller
  |     +-- cart state and kinematic vehicle model
  |     +-- independent ball states and custom ball solver
  |     +-- Rapier collision/query world
  |     +-- wind, ambience, and spatial event systems
  |
  +-- Three.js renderer
        |
        +-- fixed golfer-centered orthographic camera
        +-- terrain and semantic ink
        +-- instanced grass and props
        +-- water and interaction memory
        +-- selective prop outlines
        +-- paper composite
```

Simulation, world generation, rendering, audio, and persistence communicate
through typed domain events. For example, `BallEnteredSand` carries a world
position, velocity, ball ID, and surface data. The sand renderer, audio system,
trace journal, and nearby wildlife may respond, but none of them decides ball
physics or game rules.

## 5. Continuous-world representation

### Property blueprint

The shipped course is a versioned data document representing the entire
property:

```ts
interface CourseBlueprint {
  schemaVersion: number;
  generatorVersion: number;
  seed: string;
  bounds: PropertyBounds;
  start: StartComposition;
  palette: PalettePreset;
  terrain: ElevationFeature[];
  surfaces: SurfaceRegion[];
  water: WaterRegion[];
  cliffs: CliffRegion[];
  paths: PathSpline[];
  holes: LandscapeHole[];
  scenery: SceneryRegion[];
  wildlife: WildlifeRegion[];
  physicalBoundaries: BoundaryFeature[];
}
```

`LandscapeHole` groups a tee, fairway, green, flag, bunker arrangement, and
composition intent. It is metadata for authoring and scenery, not a level or a
progression state.

The blueprint stores:

- Property extent and real physical perimeter
- Starting golfer, ball, and cart composition
- Broad hills, ridges, swales, bowls, terraces, and height anchors
- Fairway, first-cut, green, rough, deep-rough, sand, hard-ground, and dry-ground
  splines or polygons
- Lakes, ponds, streams, coastal water, depth profiles, and shore types
- Cliff, raised-bank, and shoreline regions
- Tee, cup, flag, path, practice, and maintenance features
- Cart paths and traversable connections
- Sparse explicit landmarks
- Plant, rock, and wildlife density regions
- Wind and palette presets
- A deterministic generation seed

### Authoritative field

The `CourseWorld` exposes stable world-space queries:

```ts
interface WorldSample {
  height: number;
  normal: Vec3;
  surface: SurfaceId;
  waterDepth: number;
  walkability: number;
  cartability: number;
  edgeDanger: number;
  vegetationDensity: number;
  semanticRegions: readonly RegionId[];
}

interface CourseWorld {
  sample(x: number, z: number): WorldSample;
  signedDistance(region: RegionId, x: number, z: number): number;
  queryObstacles(bounds: Bounds3): readonly ObstacleRef[];
  chunkAt(x: number, z: number): ChunkId;
}
```

The same query drives:

- Render-mesh elevation and normal
- Rapier terrain/collision generation
- Ball slope, bounce, roll, and lie
- Cursor-to-ground ray resolution
- Golfer movement speed and caution
- Cart traction, grounding, and safe steering
- Contour and hatch direction
- Surface-specific sound
- Vegetation placement and density
- Trace type and lifetime

### Coordinates and precision

- Use meters and Y-up everywhere.
- Store authoritative entity positions as JavaScript double-precision numbers.
- Center the property near the world origin.
- Build render chunks using local vertex coordinates plus a chunk origin.
- Keep the initial property within a documented size budget where Rapier’s and
  GPU float precision remains comfortably below golf-ball scale.
- Add player-relative physics rebasing only if a future property exceeds that
  measured budget; do not introduce it preemptively.

### Chunk generation

The property is continuous even though rendering and detailed collision are
chunked.

Each deterministic chunk contains:

- Shared-border terrain samples
- Terrain render buffers
- Rapier heightfield or static collision data
- Surface and semantic masks
- Explicit boundary ribbons
- Grass and plant instance buffers
- Rock/pebble instance buffers
- Water geometry
- Interaction render targets
- A compact persistent trace journal
- References to sleeping entities in the chunk

Chunk borders sample the same global field coordinates and share edge values.
Automated seam tests must verify height, normal, surface, line, collision, and
trace continuity.

### Streaming sets

Maintain separate data sets:

1. **Global coarse field:** always queryable for terrain, surface, water, and
   property boundaries.
2. **Golfer render set:** detailed chunks visible from the fixed camera plus a
   movement prefetch ring.
3. **General collision set:** detailed chunks around the golfer/cart and nearby
   obstacles.
4. **Moving-ball corridors:** lightweight collision and deterministic prop data
   ahead of every moving ball.
5. **Sleeping entity records:** positions and states without loaded render
   objects.

A ball may cross several chunks while off-screen. Its physics never waits for
the renderer. The worker prioritizes its predictive corridor, while the global
course field remains a valid terrain fallback.

A cart can move faster than a walking golfer, so its forward streaming radius
and generation priority are larger. If required data is late, the cart eases
down naturally rather than exposing an invisible wall or loading screen.

### Physical property edge

The finite property ends through visible, physical landscape:

- Coast or deep water
- Cliff
- Dense untraversable woodland
- Wall, fence, hedge, or rock boundary consistent with the setting

The golfer and cart respond through caution and collision. Balls may cross into
inaccessible space and remain abandoned. There is no out-of-bounds message,
penalty, or reset.

## 6. Code-first course creation

The course itself does not require Blender.

### Runtime generation

1. Load and validate the property blueprint.
2. Construct a continuous height function from broad elevation primitives,
   radial basis falloffs, ridges, swales, bowls, tiers, and limited seeded
   imperfection.
3. Resolve surface regions from spline signed-distance fields.
4. Protect authored areas such as tee pads, cup surrounds, bunker lips, paths,
   and shorelines from destructive noise.
5. Sample chunks into transferable typed arrays in a Web Worker.
6. Build terrain meshes, collision heightfields, boundaries, and water.
7. Generate vegetation and rocks through seeded clustered distributions with
   semantic exclusion zones.
8. Register chunk data in the render, collision, trace, and entity systems.

Heightfields cannot express genuine overhangs. Normal cliffs use generated
vertical skirts and static collision faces. The founding style does not require
caves or elaborate overhangs, so the course pipeline does not need authored
terrain meshes.

### Development course editor

Create a development-only route using the same renderer and fixed gameplay
camera. It edits the blueprint rather than a mesh:

- Move the golfer anchor to inspect composition from actual gameplay views.
- Draw and edit surface splines.
- Adjust fairway widths and green shapes.
- Place tee pads, cups, flags, water, cliffs, paths, and landmarks.
- Add elevation anchors, ridges, swales, bowls, and tier transitions.
- Paint vegetation, wildlife, walkability, cartability, and edge-danger regions.
- Preview hatching, grass, collision, ball rolls, walking, and cart traversal.
- Export deterministic, schema-validated JSON.

This is still a code-generated scene. The editor provides art direction and
golf-layout control without converting the property into a static 3D asset.

### Blueprint validation

Reject or repair technical invalidity:

- NaN or unbounded terrain values
- Cracks or mismatched chunk borders
- Degenerate terrain triangles
- Intersecting water/cliff definitions that break collision
- A starting golfer, ball, or cart embedded in geometry
- A cart entry side with no possible safe exit
- A cup placed in technically invalid mesh or water geometry
- A physical property boundary with a traversable hole
- Missing collision around a visible obstacle
- Excessive terrain frequency that makes hatching or movement unstable

Do not reject unusual golf outcomes. Cross-fairway shots, difficult lies,
inaccessible balls, steep regions, abandoned balls, and nontraditional routes
are intentional parts of the experience.

## 7. Fixed player-centered camera

### Projection contract

Use one `OrthographicCamera` with:

- Fixed yaw
- Fixed pitch
- Fixed roll
- Fixed vertical world span
- Fixed gameplay scale
- Fixed world orientation
- A constant screen anchor for the golfer near the center

[Orthographic projection](https://threejs.org/docs/pages/OrthographicCamera.html)
keeps object scale independent of distance and preserves the illustrated map
quality.

Aspect-ratio changes do not alter scale:

- The vertical world span remains invariant.
- Wider screens reveal more horizontal world.
- Narrower screens reveal less horizontal world.
- The golfer anchor remains constant within safe screen insets.
- The game never zooms to fit a hole, shot, ball, cart route, or landmark.

### Follow behavior

The camera position is derived only from:

- Golfer X/Z position
- A fixed world-space camera offset
- Smoothed terrain-height compensation
- A tightly bounded follow lag that never moves the golfer outside the defined
  near-center region

When the golfer enters the cart, the camera still follows the golfer’s seated
root, not a separate cart camera. Entering stance, swinging, impact, ball
flight, water entry, cup entry, and wildlife events do not alter the camera
target, scale, or orientation.

### Explicitly absent

- No pan
- No rotation
- No zoom
- No recenter control
- No free-look
- No target look-ahead that displaces the golfer materially
- No ball camera
- No cinematic cut
- No shot-follow transition
- No off-screen ball arrow, edge marker, minimap, or locator ping

### Occlusion

A fixed oblique view can place terrain or props between the camera and golfer.
Handle this in the illustration language:

- Choose a high enough pitch to minimize terrain occlusion.
- Enforce sparse tall props in the golfer’s immediate composition zone.
- Fade or break only the occluding strokes within a soft local mask.
- Reduce nearby deep-grass opacity while preserving bent-blade silhouettes.
- Draw a restrained semantic golfer outline after selected occluders.

Do not x-ray the whole character through the world or add a marker.

### Camera tests

Automated tests should assert every frame that:

- The target identity is the golfer.
- Orthographic bounds/scale have not changed.
- Rotation matches the project constants.
- The golfer remains inside the allowed screen-anchor tolerance.
- No ball state can mutate camera target or projection.

## 8. Illustration renderer

### Render layers

1. **Paper:** warm base value and subtle screen-stable grain
2. **Terrain:** generated 3D surface with semantic values
3. **Ink:** contours, hatching, stippling, and explicit boundaries
4. **Living surface:** grass, reeds, water lines, and wind response
5. **Props:** golfer, cart, ball, flag, rocks, plants, and clubs
6. **Interaction memory:** tracks, footprints, trails, marks, and ripples
7. **Selective edges:** meaningful silhouettes and overlaps
8. **Palette composite:** final two- or three-tone restraint and light dither

Normal play contains no DOM overlay.

### Terrain material

The terrain shader combines:

- Paper, drawing, and optional midtone palette values
- Surface IDs and distances
- Height contours
- Slope-aligned hatching
- Green/fairway directional grain
- Rough/deep-rough stroke density
- Sand rake lines
- Dry-ground stippling
- Seeded line spacing, dropout, and curvature imperfection
- Distance and derivative-based antialiasing

Terrain marks are anchored in world space. Paper grain is anchored in screen
space. This prevents ink from swimming when the camera translates.

The fixed camera scale is an advantage: semantic line widths and hatch density
can be tuned once for a stable gameplay size rather than continuously adapting
to zoom.

### Semantic boundaries and outlines

- Fairway, green, bunker, water, path, and cliff lines derive from region
  signed-distance fields or explicit generated ribbons.
- Height contours derive from the height field.
- Terrain triangle edges are never outlined.
- Golfer, cart, rocks, flags, and important overlaps may use a selective
  depth/normal/object-ID edge pass.
- Internal golfer/cart accents derive from named material regions or modeled
  line geometry.

Generic full-scene outlines would expose mesh tessellation and produce a CAD
look. Every visible edge must have semantic value.

### Lighting

Use a restrained forward pipeline:

- Primarily unlit or wrapped-diffuse custom materials
- One mild ambient/hemisphere contribution
- Very soft directional separation for the golfer, cart, and props
- Height/slope-derived terrain value
- Analytic contact marks under the golfer, cart, ball, and rocks
- No glossy reflection or metallic response

Do not use bloom, depth of field, dramatic shadow maps, strong SSAO, HDR
spectacle, volumetrics, lens effects, or realistic water reflections.

### Live grass

Grass uses three representations:

| Range | Representation |
|---|---|
| Near golfer/cart | Instanced tapered blades or ink ribbons with local bending |
| Middle | Terrain-fragment strokes sampling wind and interaction fields |
| Far | Quiet tonal value, sparse hatch, and clustered silhouettes |

Three.js `InstancedMesh` reduces draw calls for repeated blade and plant
geometry. See the official
[instancing documentation](https://threejs.org/docs/pages/InstancedMesh.html).

No blade receives an individual JavaScript update. Instance placement is
static per chunk; vertex shaders combine:

- Shared low-frequency wind
- Surface-specific stiffness
- A chunk interaction texture
- Per-instance phase and imperfection
- Distance simplification

Short green and fairway grass barely moves. Deep rough bends farther and
settles more slowly. Wind is local and restrained, not a synchronized global
wave.

### Interaction fields

Each detailed chunk owns bounded GPU fields for:

- Bend/compression direction
- Bend/compression intensity
- Short-lived age/decay
- Longer-lived surface marks

The golfer’s feet, ball, club, and cart wheels stamp into the fields. Ping-pong
render targets decay short-lived values. Long-lived events are also written to
the chunk’s CPU journal so they survive GPU eviction and session reload.

### Water

Generate water from region masks and simple planes or shallow meshes:

- Sparse broken horizontal line bands
- Large open areas
- Gentle shared wind variation
- Directional line flow for streams
- Long restrained fields for coastal water
- No glossy transparency or expensive reflection

Impacts create a small pooled splash and two or three analytic line rings.
Off-screen ripples may expire normally; the ball’s persistent submerged state
and any lasting shoreline evidence remain.

### Sand and hard ground

Sand combines procedural rake lines with stamps for:

- Footprints
- Club contact
- Landing crater
- Drag/roll trace
- Buried-ball depression

Hard ground and cart paths use sparse stipple/line changes and sharper
surface-specific impact responses. They do not need texture maps.

### Rocks, plants, and flags

- Rocks and pebbles are seeded deformations of low-poly primitives.
- Grass clumps, reeds, shrubs, and simple biome plants are generated from
  curves, ribbons, and instanced branches.
- The flagpole, cup rim, and tee markers are procedural primitives.
- The flag is a generated subdivided plane driven by the same wind field.
- Sparse placement and negative space are enforced in generation budgets.

## 9. Simulation architecture

Use concurrent state machines rather than a hole/round progression machine.

```text
Session
  loading -> arrival -> inhabiting <-> paused

Golfer
  idle <-> turning <-> walking <-> brisk_walking
  idle <-> acknowledging_ball <-> entering_stance
       <-> aligning <-> backswing <-> impact <-> follow_through <-> idle
  idle <-> placing_ball <-> idle
  idle <-> approaching_cart <-> entering_cart
       <-> driving <-> exiting_cart <-> idle

Each ball
  placed/resting -> flight -> contact -> bounce/roll -> resting
                                  \-> submerged
                                  \-> inaccessible/abandoned

World
  streaming + wind + ambience + traces + wildlife + autosave
```

There is no current hole, hole-complete state, round state, score state,
penalty state, drop state, or automatic next activity.

An internal `lastStruckBallId` may support local golfer attention, sound, and
save continuity. It never changes the camera and never invalidates other balls.

### Fixed clocks

- Render at the display refresh rate.
- Run golfer, cart, Rapier, and world interaction at a fixed 60 Hz.
- Run moving balls at a fixed 120 Hz or equivalent bounded substeps.
- Interpolate display transforms between simulation states.
- Cap catch-up work after a slow frame.
- Freeze simulation on page hide.
- Resume from saved state without applying a giant elapsed-time delta.

## 10. Cursor-led golfer movement

### Input interpretation

1. Raycast the pointer/touch position through the fixed orthographic camera.
2. Resolve the ray against the authoritative terrain.
3. Convert the relative screen/world displacement from golfer to target into
   turn, slow walk, normal walk, or brisk walk intent.
4. While primary input remains held, continuously update intent.
5. On release, cancellation, focus loss, or pause, ease safely to rest.

No destination mark is rendered.

### Kinematic controller

Represent the golfer with a Rapier capsule controlled kinematically.

Each fixed step:

- Compute desired facing and velocity.
- Sample terrain height, normal, surface, walkability, and edge danger.
- Apply surface and slope speed modifiers.
- Sweep the capsule through Rapier.
- Evaluate a short set of nearby steering arcs.
- Prefer the arc closest to player intent that remains physically safe.
- Project impossible cliff/water movement along the boundary.
- Feed final motion, slope, surface, and turn rate to animation.

This is local steering, not long-route navigation. Hold-to-walk input gives the
player continuous authority, so a global navmesh would produce unnecessary and
surprising detours.

### Terrain behavior

- Fairway/green: normal grounded stride
- Rough: mild resistance and grass response
- Deep rough: greater resistance and stronger local bending
- Sand: shorter steps, soft sinking, footprints, slower acceleration
- Steep slope: reduced speed, shortened stride, stance adjustment
- Deep water: cautious stop and tangential redirection
- Cliff edge: anticipatory slowdown and tangential redirection

Direct intent into a safe bunker or rough must be honored. Safety logic should
feel like a person protecting their footing, not like an invisible wall.

### Foot placement

Use runtime two-foot IK:

- Ray/sample beneath each foot
- Adjust foot height and orientation
- Apply a bounded pelvis offset
- Blend out at fast motion or unreliable ground
- Use animation variants for sand/deep rough rather than extreme IK

## 11. Wordless interaction system

Interaction candidates are physical entities with:

- Position and orientation
- Reach and facing conditions
- Priority
- Acknowledgment animation
- Physical sound
- State transition

### Ball acknowledgment

When a golfer approaches a ball:

- Head and gaze shift locally
- Walking eases
- Stance availability increases
- The camera does nothing
- No prompt or label appears

### Cart acknowledgment

Near the driver side:

- The golfer glances toward the seat
- Posture indicates availability
- The interaction action starts entry
- No cart icon or text appears

### Ball placement

While standing:

1. Hold the ball-placement action.
2. Search a small visible area near the golfer for stable, unoccupied ground.
3. The golfer removes and places a ball through animation.
4. Spawn the ball at the hand-release/ground-contact animation event.
5. Confirm through the physical placement sound and final pose.

Invalid steep, submerged, occupied, or inaccessible placement should cause a
natural hesitation/cancel animation, not an error message.

## 12. Embodied shot system

### Entering stance

The shot action near a ball asks the local planner to position the golfer on a
valid side of it. The golfer:

- Walks or shuffles into place
- Grounds the club
- Aligns feet and shoulders
- Adjusts stance to local slope
- Looks along the intended direction

The transition remains interruptible.

### Aiming

Pointer motion rotates the golfer around the ball:

- Feet make small alignment steps.
- Shoulders and club face follow.
- The club head remains near the ball.
- The fixed camera does not rotate, pan, zoom, or reframe.
- No line, cone, degrees, target, or distance appears.

### Swing

Use a drag-and-release gesture:

1. Begin the shot gesture while in stance.
2. Pull opposite the intended strike to drive backswing phase.
3. Backswing length and motion control coil and potential power.
4. Release or sweep forward to commit.
5. Input rhythm/direction, stance, lie, and club parameters determine impact.
6. A named animation impact event launches the ball.
7. Follow-through and sound communicate strike quality.

The first playable uses one general-purpose club and one polished swing family.
Power is communicated through body coil, tempo, sound, follow-through, and ball
speed. Accuracy comes from alignment and legible input, with bounded—not
arbitrary—imperfection.

The same gesture away from a hittable ball or with the practice action triggers
a practice swing and a small grass response.

After follow-through, walking control returns while the ball continues its
independent simulation. The camera remains with the golfer throughout.

## 13. Multi-ball golf simulation

### Solver ownership

The custom solver owns every ball’s:

- Position and orientation
- Linear and angular velocity
- Flight/impact/roll/rest state
- Surface/lie state
- Water/submerged state
- Sleep status
- Persistence metadata
- Last-interaction time

Rapier supplies spatial queries against nonterrain colliders. The authoritative
course field supplies height, normal, surface, and water. Ball-ball collision
uses a small spatial hash over active nearby balls.

### Flight

- Gravity
- Shared world wind
- Quadratic drag
- Magnus lift from spin
- Tuned launch speed, loft, spin, and bounded strike error
- Swept motion over each substep

### Contact and bounce

- Swept sphere/terrain intersection prevents tunneling.
- Terrain normal comes from the same field used by rendering.
- Surface presets control restitution, tangential loss, and spin change.
- Rapier shape casts handle rocks, cart, flag, golfer, and other static props.
- Nearby moving balls use continuous sphere-sphere checks.

### Roll and rest

- Project gravity along the terrain tangent.
- Couple residual spin into roll.
- Apply surface-specific rolling and static resistance.
- Preserve side-slope break, uphill slowdown, downhill acceleration, ridges,
  bowls, and swales.
- Use hysteresis in the rest threshold to avoid jitter and endless creeping.
- Allow a final partial rotation or physical settling without an abrupt visual
  clamp.

### Surface behavior

| Surface | Required ball behavior |
|---|---|
| Green | Minimal bounce, long smooth roll, strong slope response |
| Fairway | Moderate bounce and predictable roll |
| Rough | Softened bounce, reduced roll, grass displacement |
| Deep rough | Abrupt bounded settling and partial concealment |
| Sand | Damped impact, indentation, short roll, possible buried state |
| Hard path | Sharp bounce, skip, longer energetic roll |
| Rock/cliff | Hard impact and physically directed deflection |
| Water | Skip when physically plausible, splash, submerge, then inert persistence |

### Cup

The cup is a local physical feature with:

- Rim collision
- Speed/approach-sensitive lip behavior
- Capture
- A final subtle motion and cup sound

Capture does not trigger completion, score, reward, camera movement, or forced
control change. The ball remains a physical object in the cup.

### Off-screen simulation

Moving balls continue at full logical fidelity outside the camera:

- Query the global terrain field.
- Request predictive prop/collision corridors.
- Emit spatial events and persistent trace events.
- Create audio only within physically meaningful hearing range.
- Sleep normally at rest.
- Instantiate detailed rendering only when in a loaded visual set.

There is no special off-screen assistance. When the golfer later approaches,
the ball can become discoverable through local grass displacement, a subtle
physical glint if enabled by the art direction, nearby golfer gaze, and normal
surface sound.

### Ball persistence and budget

Sleeping balls are cheap data records and should normally persist for the
session.

Use a generous tested budget. If a hard resource limit is reached:

- Never retire a moving ball.
- Never retire a nearby or currently acknowledged ball.
- Never retire the most recently struck or placed balls.
- Prefer the oldest distant sleeping or deeply submerged ball.
- Retire it only while outside all visible and audible ranges.
- Record the policy deterministically for save consistency.

No visible ball vanishes because another ball becomes “current.”

### Numerical recovery

Recovery exists only for corrupted simulation:

- NaN/infinite state
- Ball below all valid world data
- Unbounded speed caused by a bug
- Invalid collider penetration

Restore the last valid simulation snapshot and log diagnostics. Do not present
numerical recovery as a golf penalty or normal reset.

## 14. Golf cart system

The cart is part of the first playable.

### Motion model

Use a controlled kinematic vehicle rather than a fully dynamic arcade car:

- Bicycle steering model
- Bounded acceleration and braking
- Speed-dependent steering limit
- Surface traction and rolling resistance
- Slope acceleration/deceleration
- Four wheel terrain samples
- Smoothed body pitch and roll
- Small suspension response
- Rapier shape casts for obstacles
- Predictive cliff and water caution

The cart cannot drift, jump theatrically, or roll over during normal use.
Physical restraint is more important than maximum vehicle simulation.

### Entry and exit

- Entry is available only near the driver side.
- The golfer aligns to an authored entry anchor.
- Animation and cart/player transforms synchronize through named events.
- While driving, the golfer remains the camera anchor.
- Exit searches several nearby ground candidates.
- Candidates must be dry, stable, unoccupied, and away from cliff danger.
- If no candidate is safe, the golfer stays seated and communicates hesitation
  physically.

### Persistence and tracks

- The cart remains exactly where parked.
- Wheel rotation derives from distance.
- Steering nodes follow steering angle.
- Tracks emit from both rear/primary tire contact points.
- Surface controls track form and contrast.
- Parked cart state is saved independently of golfer position.

### Streaming safety

The cart prefetches chunks along velocity and steering. When detailed data is
not ready, throttle/terrain resistance eases speed down naturally. Never snap
the cart, relocate it, or expose a loading barrier.

## 15. Environmental memory and ambient life

### Event journals

Every persistent interaction is a compact world-space event:

```ts
interface TraceEvent {
  id: string;
  chunkId: ChunkId;
  type: TraceType;
  position: Vec3;
  direction: Vec2;
  scale: number;
  strength: number;
  createdAt: number;
  lifetime: number | "session";
}
```

Examples:

- Footprint
- Bent grass
- Cart track segment
- Pitch mark
- Divot
- Sand crater
- Sand drag
- Ball trail
- Disturbed plant
- Displaced pebble

Immediate visual response is stamped into GPU fields. Persistent events remain
in chunk journals. When a render chunk unloads, its GPU textures are disposable;
the journal rebuilds them on return.

### Restraint policy

- Merge overlapping cart segments.
- Reduce contrast with age.
- Fade short-lived grass and dust.
- Retain pitch marks, divots, and cart tracks longer.
- Cap each trace class per chunk.
- Simplify old distant paths.
- Never let repeated practice turn the course into a dark scribble.

### Shared wind

One world wind field drives:

- Ball aerodynamics
- Flag motion
- Grass and reeds
- Sparse drifting debris
- Water-line variation
- Ambient audio

This guarantees that visible wind and physical wind agree without displaying a
number or arrow.

### Wildlife

Wildlife is secondary content, but the architecture exposes spatial events from
the start:

- `GolferApproached`
- `CartPassed`
- `BallPassed`
- `BallLanded`
- `WaterSplashed`
- `LoudImpact`

Wildlife agents use low-frequency schedules, distance activation, and local
steering. They never create UI, objectives, collectibles, camera behavior, or
progression.

## 16. Authored and procedural asset plan

### Static 3D budget

The first playable ships two primary authored 3D files:

1. `golfer.glb`
2. `golf-cart.glb`

Both use binary glTF 2.0 because glTF is designed for runtime transmission and
supports meshes, skins, skeletons, morph targets, and animation. See
[Khronos glTF](https://www.khronos.org/gltf/) and the
[Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html).

Editable `.blend` sources remain in `assets-src/`. Do not ship Blender, FBX,
OBJ, or source texture files to the browser.

### Complete asset matrix

| Asset | Creation | Runtime form |
|---|---|---|
| Property/terrain | Blueprint + code | JSON plus generated typed arrays |
| Surface regions | Splines/SDF code | JSON plus generated fields |
| Cliffs and banks | Generated boundary extrusion | GPU buffers/Rapier colliders |
| Water | Generated region mesh | GPU buffers/shader |
| Fairway/green/rough ink | Procedural shader | GLSL |
| Grass/reeds | Generated blade/ribbon families | Instanced GPU geometry |
| Shrubs/simple plants | Parametric curves/branches | Instanced GPU geometry |
| Rocks/pebbles | Deformed primitive families | Instanced GPU geometry |
| Tee markers/cup/flagpole | Generated primitives | GPU geometry |
| Flag | Generated plane | GPU geometry/vertex animation |
| Ball | Generated sphere | GPU geometry/custom simulation |
| First club | Generated shaft and head profile | GPU geometry |
| Golfer | Blender-authored rig and clips | `golfer.glb` |
| Cart and attached bag | Blender-authored hierarchy | `golf-cart.glb` |
| Pencil stroke/dot family | Drawn or scanned master | Small KTX2 atlas |
| Paper grain | Scanned or generated master | Small KTX2 texture |
| Normal-play UI | None | None |
| Pause/settings icons | Vector source | SVG |
| Typeface | Licensed source | WOFF2 |
| Audio masters | Recorded/synthesized WAV | Compressed browser audio |
| Course/session data | Typed schema | Versioned JSON/IndexedDB |
| Animation events | Authored metadata | JSON or glTF `extras` |

Use [KTX2/Basis Universal](https://www.khronos.org/ktx/) for GPU textures. Use
UASTC settings where the pencil atlas’s thin alpha detail needs higher quality.
There is no PBR texture set for terrain, golfer, or cart.

Apply Meshopt compression to GLB geometry only after measuring decode and size.
These assets are deliberately small, so compression must earn its decoder cost.

### Golfer asset specification

The golfer is the primary interaction interface and therefore needs a
purpose-built rig.

Required structure:

- Clear low-poly human silhouette
- Minimal facial detail
- Topology that produces stable thin outlines
- One skeleton with named root, pelvis, spine, head, hands, and feet
- Club attachment points
- Cart alignment/seat attachment
- Foot IK targets
- Semantic material regions or vertex colors instead of PBR textures
- Root motion separated from code-controlled translation

Required first-playable clips:

- Idle/breathing
- Attention/look toward nearby ball
- Attention/look toward cart
- Turn in place
- Walk start, loop, and stop
- Brisk-walk loop
- Sand/rough locomotion variation
- Enter stance
- Alignment shuffle
- Backswing/impact/follow-through/recovery for one club
- Practice swing
- Exit stance
- Place ball
- Approach/enter cart
- Seated driving pose
- Exit cart
- Edge-caution or hesitation

Runtime IK and additive layers handle moderate terrain slope, gaze direction,
hands/club alignment, and foot placement.

Impact, foot plants, ball release, seat attach, and seat detach use named events
stored in a sidecar JSON file or glTF metadata. Gameplay must not depend on
unversioned hard-coded animation times.

### Cart asset specification

The cart GLB uses a simple, lightly detailed, hand-drawn-friendly silhouette.

Required named nodes:

- `cart_root`
- `body`
- `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr`
- Front steering pivots
- Steering wheel
- Driver seat/root anchor
- Driver entry/exit anchors
- Bag/club attachment
- Track emission/contact anchors

No baked outline or large material textures. The common runtime ink material
creates silhouette, value separation, and restrained hatching. Wheel spin,
steering, suspension, body lean, and grounding are procedural.

### Future organic assets

Wildlife is not required for the first playable. When added, begin with
procedural articulated silhouettes for small birds/insects. If an animal’s
natural movement cannot meet the foundational standard, its runtime format is a
small rigged `.glb` governed by the same no-PBR, silhouette-first policy. It is
an explicit content exception, never terrain-production workflow.

### Audio formats

Keep lossless WAV masters in `assets-src/`. Ship:

- Opus in WebM or Ogg as the preferred format
- AAC or MP3 fallback selected by capability
- Short effects decoded into `AudioBuffer` objects
- Long optional music streamed rather than fully decoded

Use content hashes and an asset manifest. Every font, sound, texture, and model
must carry provenance and license metadata.

## 17. Sound as interface

Sound is a core system in the first playable.

### Required sound families

- Footsteps on green, fairway, rough, deep rough, sand, and hard ground
- Cloth/body movement
- Club through air
- Clean and poor impact variation
- Ball impact, bounce, and roll by surface
- Sand entry, spray, drag, and settling
- Water entry and ripple
- Cup and flagstick
- Cart motor, acceleration, braking, tire surface, and suspension
- Flag cloth
- Grass/reeds and restrained wind
- Water ambience
- Sparse birds and environmental life

### Audio architecture

- Use one listener bound to the golfer/camera anchor.
- Use positional panners for physical world sources.
- Use surface and velocity data to select and modulate samples.
- Limit simultaneous voices and prioritize nearby meaningful sounds.
- Preserve silence; do not fill the world with constant loops or reward cues.
- Use procedural filtered noise for some wind and distant texture, not for
  every physical impact.
- Resume the `AudioContext` only after a user gesture because browsers restrict
  autoplay.

An off-screen ball makes only the sound its distance and environment justify.
There is no artificial locator ping or global success cue.

## 18. Interface and accessibility

### Normal play

The canvas shows the world only.

Do not implement:

- Score or scorecard
- Par, stroke, penalty, or hole counters
- Club names or inventory counts
- Distance, elevation, wind, lie, or power numbers
- Minimap or map overlay
- Aim line or projected trajectory
- Ball marker or off-screen indicator
- Interaction prompts
- Objectives, missions, achievements, or rewards
- Tutorial panels or success banners

### Out-of-play DOM

Use semantic HTML/CSS for:

- Initial loading and audio-start gesture
- Unsupported-browser/GPU explanation
- Pause
- Settings
- Accessibility options
- Controls reference
- Deliberate reset confirmation
- Save/storage error

The page uses the same paper, graphite, typography, and quiet transitions, but
it remains accessible DOM rather than canvas text.

### Accessibility settings

Disabled by default and configured outside normal play:

- Higher contrast
- Larger or more legible ball rendering
- Slower swing timing
- Simplified hold/release swing
- Alternate movement input
- Reduced camera follow easing
- Reduced grass/water/environmental motion
- Stronger physical sound cues
- Optional visible aiming aid
- Optional slope overlay
- Remappable keyboard and controller actions

The fixed no-pan/no-rotation/no-zoom camera and no automatic ball following
remain the product behavior. Any future ball-location accessibility aid requires
an explicit foundational decision rather than being silently introduced.

## 19. Input mapping

Gameplay consumes named actions, never raw device events:

- Move/primary hold
- Enter or cancel stance
- Shot gesture start/update/release
- Practice swing
- Place ball
- Interact/enter/exit cart
- Cart accelerate/steer/brake
- Pause

Pointer Events provide one model for mouse, touch, and pen. Use pointer capture
for held movement, swing gestures, and cart control. Handle:

- Release outside canvas
- `pointercancel`
- Browser focus loss
- Page visibility change
- Multi-touch ambiguity
- Orientation change
- Duplicate compatibility mouse events
- A pause invoked mid-gesture

Touch cannot depend on hover, right-click, or small targets. Keyboard and
controller mappings feed the same actions. There are no camera actions.

## 20. World-session persistence

Save the place, not a round.

### Saved state

- Blueprint, generator, schema, simulation, and asset versions
- Golfer position, facing, locomotion state, and held club
- Cart position, facing, steering/wheel pose, and parked state
- Every retained ball’s position, orientation, velocities, state, surface,
  water state, and recency
- Long-lived trace journals or compacted chunk state
- Time/weather/wind state when implemented
- Deterministic ambient seeds
- User and accessibility settings

### Checkpoints

- Arrival complete
- Ball placed
- Ball reaches rest or becomes submerged
- Golfer/cart transition completes
- Cart parks
- Meaningful movement interval
- Persistent trace batch
- Pause
- `visibilitychange` and page lifecycle signals

Never write IndexedDB every frame. Keep an in-memory dirty set and serialize
small versioned transactions.

If the page closes during a swing or ball flight, restore either:

- The last stable checkpoint, or
- A validated quantized simulation snapshot containing all moving balls

Do not advance the world by real elapsed wall-clock time while the page was
closed unless a future ambient-time design explicitly requires it.

Browser storage may be denied or evicted. The session must remain playable in
memory and disclose save failure only through the out-of-play settings/pause
surface.

## 21. Browser lifecycle and delivery

### Startup

1. Load the paper-toned HTML shell and capability check.
2. Receive the first gesture and initialize audio.
3. Load Three.js, Rapier, essential shaders, golfer/cart GLBs, and first audio.
4. Load the global coarse course field.
5. Generate detailed chunks around the starting composition in workers.
6. Build collision and renderer resources.
7. Fade from paper into the world.
8. Continue prefetching surrounding property chunks without a visible
   transition.

### Runtime lifecycle

- Pause simulation on hidden tabs.
- Cap restored frame delta.
- Autosave at safe checkpoints.
- Handle WebGL context loss by preserving CPU/session state, rebuilding GPU
  resources, then resuming.
- Dispose render targets, geometries, materials, and textures when chunks leave
  all streaming sets.
- Keep coarse field, entity records, and trace journals independent of GPU
  lifetime.
- Suspend or fade audio appropriately when focus changes.

### Deployment

- Static HTTPS hosting
- Brotli/gzip at the server/CDN
- Immutable caching for content-hashed assets
- Short caching for the HTML entry point
- Correct MIME types for JavaScript, WebAssembly, KTX2, GLB, and audio
- Self-hosted production assets and decoders
- Content Security Policy without runtime `eval`

A service worker may cache the shell and active property after the normal web
build is stable. IndexedDB remains the authoritative session store; HTTP cache
is not a save system.

## 22. Performance architecture

Initial quality goals:

- 60 frames per second on a representative integrated-GPU laptop
- 60 preferred and 30 minimum stable frames per second on supported mobile
- Fixed simulation results independent of render frame rate
- No hitch when the cart crosses a chunk boundary
- No hitch when an off-screen ball crosses a chunk boundary
- No per-blade, per-stipple, or per-track JavaScript objects
- No large PBR texture sets

### Adaptive quality

Use a short measured benchmark and ongoing frame timing, not user-agent strings.

Quality may reduce:

- Device pixel ratio
- Near-grass radius and density
- Interaction-texture resolution and update rate
- Stipple/hatch density
- Secondary prop-edge pass
- Water-line and particle counts
- Distant vegetation density
- Audio voice limit

Quality may not change:

- Camera scale/orientation
- Terrain shape or collision
- Ball physics
- Player/cart control
- Surface readability
- Essential boundary lines
- Persistent entity state

The DOM pause/settings surface remains at native resolution even when the canvas
render scale decreases.

### Memory ownership

Every GPU resource has one owner and explicit `dispose()` behavior.

- Chunk manager owns terrain/water geometry and masks.
- Vegetation manager owns instance buffers.
- Interaction manager owns render targets.
- Asset manager owns shared golfer/cart/textures.
- Renderer owns shared passes.
- Entity render proxies never own simulation state.

Track GPU memory proxies, active chunks, draw calls, triangles, render-target
bytes, active balls, Rapier colliders, trace events, and audio buffers in a
development diagnostics panel that never ships in normal play.

## 23. Edge-case contract

| Situation | Required behavior |
|---|---|
| Ball leaves the screen | Camera remains on golfer; ball continues simulating |
| Ball crosses unloaded visual chunks | Global field and predictive collision corridor continue physics |
| Player cannot remember the landing | Exploration is the intended response; no marker appears |
| Several balls move at once | Each remains independent; spatial hash handles local ball-ball contact |
| Ball lands on another green/fairway | It stays there with that surface behavior |
| Ball enters deep water | It splashes, submerges, persists inertly, and does not trigger a reset |
| Ball enters inaccessible land | It remains abandoned; player may place another ball |
| Ball goes through a cup | Dedicated rim/capture model decides physically; no completion state |
| Ball rests on a surface boundary | Stable priority/tolerance prevents lie flicker |
| Ball creeps forever | Rest hysteresis resolves near-zero motion without visible snapping |
| Ball tunnels at high speed | Swept collision/substeps prevent missed contact |
| Simulation produces NaN | Restore last valid snapshot and log; no gameplay penalty |
| Player directs into bunker | Honor intent and use sand locomotion |
| Player directs into deep water/cliff | Slow and redirect tangentially through natural caution |
| Local steering sees an obstacle | Choose a short safe arc; never take a surprising long detour |
| Ball placement ground is invalid | Physical hesitation/cancel; no error text |
| Cart has no safe exit side | Keep golfer seated and communicate physically |
| Cart outruns chunk generation | Ease speed through terrain response while generation catches up |
| Cart reaches cliff or water | Predictive braking/steering safety; no snap or invisible reset |
| Cart is left far away | Persist and unload its render proxy; restore when revisited |
| Visible hill/prop occludes golfer | Local stroke fade and semantic silhouette treatment |
| Aspect ratio changes | Fixed vertical span and scale; horizontal coverage changes |
| Window/device orientation changes | Rebuild frustum at same scale and preserve golfer anchor |
| Pointer releases outside canvas | Pointer capture ends action safely |
| Focus is lost mid-swing | Cancel uncommitted gesture or preserve committed impact deterministically |
| Tab sleeps mid-flight | Freeze simulation; do not integrate the missing wall time |
| Audio is locked | Wait for explicit gesture and represent muted state outside play |
| WebGL context is lost | Pause, retain CPU state, recreate GPU resources, resume |
| Storage is unavailable | Continue in memory; disclose outside normal play |
| Trace fields exceed budget | Merge, age, simplify, and fade while retaining important recent marks |
| Old save uses prior generator | Load stored resolved blueprint or run explicit migration |
| Real property edge is reached | Visible physical boundary handles it; no out-of-bounds rule |
| Low contrast hides gameplay | Accessibility contrast strengthens semantic values and outlines |

## 24. Suggested repository structure

```text
src/
  app/
    bootstrap/             capability checks and startup
    lifecycle/             focus, visibility, context loss, pause
    diagnostics/           development-only metrics
  core/
    clock/                 fixed-step scheduling and interpolation
    events/                typed spatial/domain events
    math/                  deterministic helpers and coordinate types
    resources/             asset and GPU lifecycle
  world/
    schema/                CourseBlueprint and validation
    field/                 authoritative height/surface/traversal queries
    generation/            terrain, water, boundaries, scattering
    chunks/                streaming sets and worker coordination
    editor/                development-only blueprint editor
    traces/                journals, compaction, GPU replay
    wind/                  shared wind field
    wildlife/              secondary ambient agents
  render/
    camera/                fixed golfer-centered camera
    materials/             terrain ink, props, grass, water, paper
    boundaries/            semantic line geometry
    vegetation/            instance buffers and LOD
    interaction/           bend/track/sand fields and ripple pools
    passes/                selective edges and palette composite
  simulation/
    session/               arrival, inhabiting, pause
    golfer/                locomotion, steering, IK, interactions
    cart/                  vehicle model, entry/exit, grounding
    ball/                  multi-ball flight/contact/roll/rest
    collision/             Rapier adapter and query bridge
    animation/             clips, layers, named event dispatch
  input/
    actions/               device-independent actions
    pointer/
    keyboard/
    touch/
    gamepad/
  audio/
    graph/                 listener, buses, voice limits
    events/                physical event-to-sound mapping
    ambience/
  persistence/
    indexeddb/             transactions and migrations
    snapshots/             session and moving-ball state
  ui/
    loading/
    pause/
    settings/
    accessibility/
    compatibility/
  workers/
    terrain.worker.ts
    scattering.worker.ts
    trace-compaction.worker.ts
  tests/
    simulation/
    generation/
    persistence/
    visual/
    browser/

assets-src/
  blender/
    golfer.blend
    golf-cart.blend
  audio/
  ink/
  fonts/

public/assets/
  models/
    golfer.glb
    golf-cart.glb
  audio/
  textures/
  fonts/
  courses/
```

## 25. Verification strategy

### Simulation tests

- Identical ball result across 30/60/120 Hz render schedules
- Flight, bounce, roll, slope, rest, and every surface preset
- Multi-ball collision
- Cup lip/capture
- Water skip/submerge
- Off-screen multi-chunk flight
- Fixed-step cart and golfer movement
- Cart grounding and surface response
- Cliff/water safety
- Ball placement validation

### World tests

- Blueprint schema and migration
- Deterministic generation
- Height/normal/surface agreement across chunk seams
- Render field versus collision field samples
- Physical property boundary continuity
- Stream priority for golfer, cart, and moving balls
- Chunk unload/reload with sleeping balls and parked cart
- Trace journal reconstruction and compaction

### Camera tests

- Fixed yaw, pitch, roll, and scale
- Constant orthographic vertical span across resize
- Golfer anchor tolerance during walk, stance, swing, cart entry, and driving
- No camera dependency on any ball
- Occlusion treatment at representative hills and props

### Visual tests

- Fixed-seed screenshots for every surface and interaction
- Temporal camera-translation captures for hatch/contour stability
- Grass bending and recovery
- Track aging and merging
- Sand marks
- Water ripple restraint
- Golfer/cart silhouette and line consistency
- Default, low-quality, high-contrast, and reduced-motion profiles

### Experience tests

A first-time player should be able to discover without normal-play text:

- How to walk and stop
- That a nearby ball can be addressed
- How body alignment changes direction
- How the swing gesture changes power
- How to place another ball
- That the cart can be entered and driven
- How surfaces change movement and ball behavior
- That an off-screen ball must be found physically

If players are confused, first adjust composition, animation, sound, timing, and
physical response. Do not default to adding labels or HUD.

### Browser/device tests

- Current Chrome, Edge, Firefox, and Safari
- Real iOS Safari and Android Chrome devices
- Integrated-GPU laptop
- Mouse, touch, keyboard, and controller
- Portrait, landscape, ultrawide, resize, and orientation change
- Audio interruption/resume
- Hidden tab during ball flight and cart movement
- WebGL context loss/restoration
- Storage denial and eviction
- Slow network and partial asset failure
- Thermal throttling over an extended free-roaming session

### Asset validation

- Khronos glTF validation
- Required golfer/cart node names
- Required animation clips and event metadata
- Consistent meter scale and Y-up transforms
- No unexpected textures or materials
- KTX2 thin-alpha review
- Browser audio fallback coverage
- License/provenance manifest

## 26. Implementation order

The following stages are internal development slices. The first public
playable is not released until all foundational systems in Stage 5 are present.

### Stage 0 — Illustration and physics laboratory

Build a disposable but production-relevant test containing:

- Fixed orthographic camera
- Generated hill, swale, bunker, green, rough, water, and bank
- Paper, contours, hatching, stippling, and semantic lines
- Instanced grass and interaction texture
- Ball flight/bounce/roll
- Sand mark, water ripple, and cart-track prototype

Gate:

- It looks like a living drawing in stillness and motion.
- Terrain drawing and ball behavior agree.
- Lines remain stable while the camera translates.
- WebGL 2 mobile performance is viable.

### Stage 1 — Continuous property foundation

- Property-wide blueprint and schema
- Authoritative global course field
- Seamless chunk generation and streaming
- Physical property boundary
- Rapier collision/query world
- Fixed golfer-centered camera contract
- IndexedDB session schema

### Stage 2 — Embodied traversal

- Final/provisional golfer GLB and animation event pipeline
- Cursor-led kinematic walking
- Slope, rough, bunker, water, and cliff behavior
- Foot IK and local steering
- Cart GLB, entry/exit, direct driving, parking, and tracks
- Streaming fast enough for cart travel

### Stage 3 — Embodied golf

- Ball acknowledgment and stance entry
- Body-based alignment
- One excellent drag/release swing
- Named impact event
- Custom multi-ball solver
- Ball placement
- Off-screen simulation and rediscovery
- Cup behavior without completion state

### Stage 4 — Living response and wordless language

- Grass, sand, water, divot, footprint, and track systems
- Persistent chunk journals
- Full surface audio and positional sound
- Physical interaction acknowledgment
- No-text arrival composition
- Accessibility settings outside play

### Stage 5 — First playable and browser hardening

The small continuous test property must let the player:

- Arrive without instructional UI
- Walk freely across varied terrain
- Enter and leave a bunker
- Place multiple balls
- Address, align, and swing
- Watch a ball leave the fixed screen
- Walk or drive to rediscover it
- Drive, park, exit, and return to the cart
- See and hear the property respond
- Leave balls and marks behind
- Reload and resume the same physical place

It must also pass:

- Real mobile performance
- Context-loss recovery
- Hidden-tab handling
- Storage failure behavior
- Input cancellation
- Fixed-camera invariants
- Session persistence

### Stage 6 — Secondary life and breadth

Only after the founding experience passes:

- Wildlife
- Additional clubs and a physical bag/caddy interaction
- Weather variation
- More persistent footprint/divot detail
- Expanded continuous property
- Day/time variation
- More sophisticated vegetation

Do not add scoring, progression, tournaments, economy, achievements,
multiplayer, course-selection workflow, or a conventional sports-game HUD to
solve a lack of engagement. The intended engagement is inhabiting the place.

## 27. Acceptance definition

The architecture succeeds when:

1. The world feels continuous even though rendering and collision stream.
2. The golfer remains near the center of one fixed-scale, fixed-orientation
   camera at all times.
3. A ball can leave the screen, cross the property, stop, persist, and later be
   found without the camera or UI revealing it.
4. Walking, cart driving, stance, swing, ball placement, and nearby affordances
   are understandable through physical language.
5. Terrain visuals and physics always agree.
6. Grass, sand, water, tracks, and sound respond locally and quietly.
7. Multiple balls and the parked cart remain independent persistent objects.
8. Normal play contains no text or conventional golf interface.
9. The course, vegetation, linework, water, and common props are generated from
   code and compact data.
10. The only required authored 3D assets are a small golfer GLB and cart GLB.
11. The same session can be resumed after reload.
12. Supported browsers maintain readable lines, stable control, and the
    appropriate performance quality.

The decisive technical prototype is therefore not “complete one hole.” It is:

> Enter one small continuous living landscape, understand it without text,
> freely walk and drive through it, take embodied shots that may leave the
> fixed view, find their physical consequences, and return later to the same
> quietly changed place.

## Primary technical references

- [Three.js `WebGLRenderer`](https://threejs.org/docs/pages/WebGLRenderer.html)
- [Three.js `OrthographicCamera`](https://threejs.org/docs/pages/OrthographicCamera.html)
- [Three.js renderer guidance](https://threejs.org/manual/en/webgpurenderer)
- [Three.js `InstancedMesh`](https://threejs.org/docs/pages/InstancedMesh.html)
- [Three.js `GLTFLoader`](https://threejs.org/docs/pages/GLTFLoader.html)
- [Khronos glTF](https://www.khronos.org/gltf/)
- [Khronos KTX2](https://www.khronos.org/ktx/)
- [Rapier colliders and heightfields](https://rapier.rs/docs/user_guides/javascript/colliders/)
- [Rapier continuous collision detection](https://rapier.rs/docs/user_guides/javascript/rigid_body_ccd/)
- [Rapier determinism](https://rapier.rs/docs/user_guides/javascript/determinism/)
- [MDN Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- [MDN IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [MDN Web Audio autoplay guidance](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
- [MDN WebGL context loss](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event)
