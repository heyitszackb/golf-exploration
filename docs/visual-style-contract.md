# Visual Style Replacement Contract

The current pencil-and-paper rendering is a replaceable presentation layer. A future art direction can change substantially without invalidating traversal, golf, persistence, or world simulation if it preserves the following contracts.

## Stable inputs to any renderer

- `PROPERTY_BLUEPRINT` defines property bounds, chunk size, generator/schema identity, and the starting composition.
- `propertyField.sample(x, z)` is authoritative for terrain height, normal, semantic surface, water depth, friction, restitution, and grass density.
- `PropertyChunkStreamer` owns which world chunks are active around the golfer and moving balls.
- Golfer, cart, and ball transforms are meters in the same right-handed Y-up world space.
- Ball, locomotion, cart, trace, weather, and interaction events describe what happened; render code only decides how it looks.
- The camera contract remains fixed orthographic projection, fixed orientation, fixed scale, golfer-centered translation, and no ball following.

## What may be replaced freely

- Terrain shader, palette, hatching, contours, stipple, paper composite, lighting, and post-processing
- Grass geometry and interaction-field implementation
- Water drawing, ripples, sand marks, footprints, divots, and track visualization
- Procedural props and vegetation presentation
- Golfer and cart proxy geometry
- Bird and ambient-life presentation
- Audio samples and mixing, provided the physical event mapping remains intact

## Authored asset seam

The final golfer and cart should be meter-scale, Y-up glTF 2.0 binary `.glb` files. Renderer adapters should map named simulation states and events onto their clips rather than moving gameplay logic into animation code.

Minimum golfer event names include foot contacts, stance settled, backswing apex, club impact, ball release, cart hand/seat contacts, and exit completion. Minimum cart anchors include driver seat, entry/exit reference, wheel centers, and track contact points.

Textures, if required, should ship as KTX2/Basis Universal. The nearly monochrome style should favor geometry, vertex data, and procedural materials over large baked texture sets.

## Non-negotiable agreement tests

1. Rendered terrain and `propertyField` height must agree at chunk vertices and sampled interior points.
2. Rendered semantic edges must describe the same surfaces used by traversal and ball response.
3. A style change cannot alter physical scale, collision placement, camera rotation, zoom, or golfer screen anchor.
4. A moving/off-screen ball remains simulated even when its renderer is culled.
5. Trace rendering may compact or fade marks but cannot mutate authoritative object state.
6. Missing art assets must fall back gracefully without preventing play or session restore.

The practical consequence is that a watercolor, ink-wash, low-poly, or more dimensional illustrated renderer can replace the current look while reusing the property, physics, controls, ball behavior, saves, and tests.

