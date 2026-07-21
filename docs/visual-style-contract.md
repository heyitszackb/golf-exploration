# Visual Style Replacement Contract

The current pencil-and-paper rendering is a replaceable presentation layer. A future art direction can change substantially without invalidating traversal, golf, persistence, or world simulation if it preserves the following contracts.

## Stable inputs to any renderer

- `PROPERTY_BLUEPRINT` defines property bounds, chunk size, generator/schema identity, and the starting composition.
- `propertyField.sample(x, z)` is authoritative for terrain height, normal, semantic surface, water depth, friction, restitution, and grass density.
- `PropertyChunkStreamer` owns which world chunks are active around the golfer and moving balls.
- Golfer, cart, and ball transforms are meters in the same right-handed Y-up world space.
- `SwingPresentation` supplies the current `idle`, `addressing`, `ready`, `backswing`, `downswing`, `follow-through`, or `recover` phase plus progress, power, shot heading, and body heading. The presentation may visualize this state but cannot decide when impact occurs.
- Typed golfer, footstep, cart, ball, stance, club, landing, and water events describe what happened; render and audio code only decide how those events look and sound.
- The camera contract remains fixed orthographic projection, fixed orientation, fixed scale, golfer-centered translation, and no ball following.

## What may be replaced freely

- Terrain shader, palette, hatching, contours, stipple, paper composite, lighting, and post-processing
- Grass geometry and interaction-field implementation
- Water drawing, ripples, sand marks, footprints, divots, and track visualization
- Procedural props and vegetation presentation
- Golfer and cart proxy geometry
- Bird and ambient-life presentation
- Audio samples and mixing, provided the physical event mapping remains intact

## Current illustrated presentation

These details describe the implementation today, not new gameplay dependencies or requirements for a future style:

- `art-style.ts` is the shared source of paper, graphite, semantic pigment, cloth, skin, ball, shadow, daylight direction, and presentation-budget values.
- The visual grammar is warm parchment plus graphite contours, quiet colored pigment/wash, directional hatch, stipple, and stable screen-door texture. It avoids glossy highlights, heavy bloom, post-process noise, and multiple dramatic light directions.
- Bunkers use readable one-sided lips, broken directional rake hatching, and sparse interior marks. Water uses an outlined organic shore and short broken horizontal linework with restrained drift and pigment granulation.
- A single stabilized directional light supplies selective cast shadows and a hemisphere light supplies paper-toned fill. Terrain receives a low-opacity shadow layer. Analytic contact shadows remain a renderer-local legibility device for small figures, wheels, and balls.
- Grass is streamed as one deterministic `InstancedMesh` per active property chunk, sharing geometry and material. A bounded interaction-field interface drives shader bending for golfer, feet, cart, balls, landings, and club contact without per-blade CPU updates.
- Ambient birds are three low-frequency flocks of four. They consume nearby movement, club, landing, and splash events and can move among grounded, taking-off, circling, and landing states.

The backing implementation of grass interaction, shadows, wash, dithering, or flocks may change as long as the stable inputs and agreement tests below continue to hold.

## Swing and interaction boundary

- Entering stance may move the golfer to a safe side-on address position before the swing accepts input.
- Pointer motion during `backswing` supplies bounded power and alignment. Pointer release commits a valid downswing but does not directly launch the ball.
- Gameplay responds to the swing sequence's named impact event. The renderer must show a coherent downswing into that moment and a follow-through/recovery after it, but it cannot advance or duplicate the physics event.
- Pointer cancellation, lost capture, focus loss, page hiding, and pause cancel an unfinished gesture. A presentation adapter must never translate those cancellation paths into an impact or launch.
- Essential stance, gait, contact, and follow-through communication remains visible when reduced motion is enabled; optional wind, idle, water, and bird motion may be quieted.

## Accessibility and pause boundary

- Normal play remains free of persistent DOM overlays. The controls/settings surface is semantic DOM shown only while paused or otherwise out of play.
- Opening pause clears active input, checkpoints the session, and moves focus to the resume control; resuming returns focus to the canvas.
- Higher contrast may strengthen paper/ink UI and illustration lighting, larger balls may scale only their presentation, reduced motion may quiet nonessential animation, and stronger sound may raise cue strength. None of these settings may alter physical scale, collision, shot timing, or saved world state.

## Authored asset seam

The final golfer and cart should be meter-scale, Y-up glTF 2.0 binary `.glb` files. Renderer adapters should map named simulation states and events onto their clips rather than moving gameplay logic into animation code.

The current procedural adapter consumes distance-driven stride plus the swing presentation phases and the `footstep`, `stance-settled`, `club-swing`, and `club-impact` events. A final authored golfer should additionally expose or derive backswing apex, cart hand/seat contact, and exit-completion markers. Minimum cart anchors include driver seat, entry/exit reference, wheel centers, and track contact points.

Textures, if required, should ship as KTX2/Basis Universal. The nearly monochrome style should favor geometry, vertex data, and procedural materials over large baked texture sets.

## Non-negotiable agreement tests

1. Rendered terrain and `propertyField` height must agree at chunk vertices and sampled interior points.
2. Rendered semantic edges must describe the same surfaces used by traversal and ball response.
3. A style change cannot alter physical scale, collision placement, camera rotation, zoom, or golfer screen anchor.
4. A moving/off-screen ball remains simulated even when its renderer is culled.
5. Trace rendering may compact or fade marks but cannot mutate authoritative object state.
6. Missing art assets must fall back gracefully without preventing play or session restore.
7. A presentation change cannot move the swing impact event, launch on pointer cancellation, or skip the post-impact recovery required before traversal resumes.
8. Reactive grass and ambient flocks may respond to events but cannot feed state back into traversal, cart, or ball physics.
9. The active shadow-map count remains one unless a measured visual and performance review explicitly revises the presentation budget.

The practical consequence is that a watercolor, ink-wash, low-poly, or more dimensional illustrated renderer can replace the current look while reusing the property, physics, controls, ball behavior, saves, and tests.
