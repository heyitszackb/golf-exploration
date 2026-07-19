import * as THREE from 'three';
import {
  POND_WATER_LEVEL,
  COURSE_BOUNDS,
  sampleCourse,
  sampleCourseBoundaryLoops,
  sampleBunkerBoundaryLoops,
  sampleFairwayCenterline,
  samplePondBoundaryLoop,
  sampleRightBankEdge,
  type CourseBoundaryLoop,
  type CoursePoint2,
  type CourseSurface,
} from '../world/course';
import { CartFigure, FlagFigure, GolferFigure, makeBallVisual } from './entities';
import { InteractionMarks, type MarkKind } from './interaction-marks';
import { propertyField } from '../world/property-field';
import { PROPERTY_BLUEPRINT } from '../world/property-blueprint';
import type { TraceEvent } from '../world/trace-journal';
import { sampleEnvironment, type EnvironmentSample } from '../world/environment';
import { AmbientLife } from './ambient-life';
import {
  type PropertyChunkConsumer,
  type PropertyChunkDescriptor,
  type PropertyChunkStreamer,
} from '../world/property-streamer';

const SURFACE_COLORS: Record<CourseSurface, number> = {
  tee: 0xdcc7a3,
  fairway: 0xd7c09a,
  green: 0xddcaa7,
  rough: 0xd0b992,
  deepRough: 0xccb38c,
  bunker: 0xe1cba6,
  water: 0xd9c6a5,
  bank: 0xcdb28b,
  cliff: 0xc5a780,
};

const SURFACE_CODES: Record<CourseSurface, number> = {
  tee: 0,
  fairway: 1,
  green: 2,
  rough: 3,
  deepRough: 4,
  bunker: 5,
  water: 6,
  bank: 7,
  cliff: 8,
};

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function createTerrainGeometry(chunk: PropertyChunkDescriptor): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(
    PROPERTY_BLUEPRINT.chunkSize,
    PROPERTY_BLUEPRINT.chunkSize,
    PROPERTY_BLUEPRINT.terrainSegmentsPerChunk,
    PROPERTY_BLUEPRINT.terrainSegmentsPerChunk,
  );
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const surfaceCodes = new Float32Array(position.count);
  const detailAmount = new Float32Array(position.count);
  const color = new THREE.Color();

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index) + chunk.centerX;
    const z = position.getZ(index) + chunk.centerZ;
    const sample = propertyField.sample(x, z);
    position.setY(index, sample.height);
    (geometry.attributes.normal as THREE.BufferAttribute).setXYZ(
      index,
      sample.normal.x,
      sample.normal.y,
      sample.normal.z,
    );
    color.setHex(SURFACE_COLORS[sample.surface]);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
    surfaceCodes[index] = SURFACE_CODES[sample.surface];
    detailAmount[index] = sample.grassDensity;
  }

  position.needsUpdate = true;
  geometry.attributes.normal!.needsUpdate = true;
  geometry.setAttribute('aSurfaceColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSurface', new THREE.BufferAttribute(surfaceCodes, 1));
  geometry.setAttribute('aDetail', new THREE.BufferAttribute(detailAmount, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function createTerrainMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec3 aSurfaceColor;
      attribute float aSurface;
      attribute float aDetail;

      varying vec3 vSurfaceColor;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying float vSurface;
      varying float vDetail;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vSurfaceColor = aSurfaceColor;
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vSurface = aSurface;
        vDetail = aDetail;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec3 vSurfaceColor;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying float vSurface;
      varying float vDetail;

      float hash21(vec2 point) {
        point = fract(point * vec2(123.34, 456.21));
        point += dot(point, point + 45.32);
        return fract(point.x * point.y);
      }

      float lineAt(float value, float width) {
        float centered = abs(fract(value + 0.5) - 0.5);
        return 1.0 - smoothstep(width, width + fwidth(value) * 1.4, centered);
      }

      void main() {
        vec3 color = vSurfaceColor;
        vec2 world = vWorldPosition.xz;
        float slope = clamp(1.0 - vWorldNormal.y, 0.0, 0.72);

        // Stable fibers and tiny pigment variation; both are anchored in world space.
        float broadFiber = sin(world.x * 0.31 + sin(world.y * 0.12) * 0.8) * 0.5 + 0.5;
        float pigment = hash21(floor(world * 5.5));
        color += (broadFiber - 0.5) * 0.010;
        color += (pigment - 0.5) * 0.011;

        // Fine fairway grain follows the long axis without reading as mowing stripes.
        float fairwayMask = 1.0 - smoothstep(0.3, 0.72, abs(vSurface - 1.0));
        float greenMask = 1.0 - smoothstep(0.25, 0.65, abs(vSurface - 2.0));
        float sandMask = 1.0 - smoothstep(0.25, 0.65, abs(vSurface - 5.0));
        float waterMask = 1.0 - smoothstep(0.25, 0.65, abs(vSurface - 6.0));
        float quietMask = max(greenMask, waterMask);
        float grainLine = lineAt(world.x * 1.15 + sin(world.y * 0.2) * 0.12, 0.018);
        float grainGate = step(0.62, hash21(floor(world * vec2(0.7, 1.8))));
        color = mix(color, vec3(0.46, 0.40, 0.31), grainLine * grainGate * fairwayMask * 0.055);

        // Height contours appear only where the slope needs explaining and are intentionally broken.
        float contour = lineAt(vWorldPosition.y / 0.78, 0.035);
        float contourGate = smoothstep(0.19, 0.5, hash21(floor(world * vec2(0.11, 0.25))));
        float contourStrength = contour * contourGate * smoothstep(0.035, 0.16, slope);
        contourStrength *= (1.0 - quietMask * 0.82) * (1.0 - sandMask * 0.55);
        color = mix(color, vec3(0.43, 0.38, 0.30), contourStrength * 0.16);

        // Short slope hatches use two spatial gates so they cluster rather than carpet the course.
        vec2 hatchSpace = vec2(world.x * 0.42 + world.y * 0.12, world.y * 0.23 - world.x * 0.035);
        float hatch = lineAt(hatchSpace.x, 0.026);
        float hatchLength = smoothstep(0.54, 0.76, sin(hatchSpace.y * 6.28318) * 0.5 + 0.5);
        float hatchCluster = step(0.51, hash21(floor(world * vec2(0.13, 0.09))));
        float hatchStrength = hatch * hatchLength * hatchCluster * smoothstep(0.08, 0.28, slope);
        hatchStrength *= (1.0 - quietMask) * (0.35 + vDetail * 0.65);
        color = mix(color, vec3(0.42, 0.37, 0.29), hatchStrength * 0.15);

        // Sparse dry/rough stipple. One cell in several gets a sub-pixel dot.
        vec2 stippleCell = floor(world * 2.2);
        vec2 stippleLocal = fract(world * 2.2) - 0.5;
        float dotShape = 1.0 - smoothstep(0.065, 0.095, length(stippleLocal));
        float dotGate = step(0.84 - vDetail * 0.055, hash21(stippleCell));
        float stipple = dotShape * dotGate * (1.0 - quietMask) * (0.25 + vDetail * 0.75);
        color = mix(color, vec3(0.43, 0.37, 0.29), stipple * 0.19);

        // Sand keeps its clean body but receives a few faint rake scratches.
        float rake = lineAt(world.x * 0.72 + world.y * 0.06, 0.016);
        float rakeGate = step(0.72, hash21(floor(world * vec2(0.21, 0.44))));
        color = mix(color, vec3(0.48, 0.41, 0.32), rake * rakeGate * sandMask * 0.07);

        // This is illustrative form separation, not scene lighting.
        color -= slope * 0.016;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

class TerrainChunkLayer implements PropertyChunkConsumer {
  readonly root = new THREE.Group();
  private readonly material = createTerrainMaterial();
  private readonly meshes = new Map<string, THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>>();

  constructor() {
    this.root.name = 'streamed-terrain-chunks';
  }

  activateChunk(chunk: PropertyChunkDescriptor): void {
    if (this.meshes.has(chunk.key)) return;
    const mesh = new THREE.Mesh(createTerrainGeometry(chunk), this.material);
    mesh.name = `terrain-chunk-${chunk.key}`;
    mesh.position.set(chunk.centerX, 0, chunk.centerZ);
    mesh.userData.chunkKey = chunk.key;
    this.meshes.set(chunk.key, mesh);
    this.root.add(mesh);
  }

  deactivateChunk(key: string): void {
    const mesh = this.meshes.get(key);
    if (!mesh) return;
    mesh.geometry.dispose();
    mesh.removeFromParent();
    this.meshes.delete(key);
  }

  get count(): number {
    return this.meshes.size;
  }
}

function createGrassField(): { mesh: THREE.InstancedMesh; material: THREE.ShaderMaterial } {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([
      -0.045, 0, 0,
      0.045, 0, 0,
      0.0, 0.62, 0,
    ], 3),
  );
  geometry.setIndex([0, 1, 2]);

  const random = mulberry32(739391);
  const candidates: Array<{ x: number; z: number; height: number; scale: number; angle: number; phase: number }> = [];
  for (let z = COURSE_BOUNDS.minZ - 18; z < COURSE_BOUNDS.maxZ + 18; z += 1.22) {
    for (let x = COURSE_BOUNDS.minX - 18; x < COURSE_BOUNDS.maxX + 18; x += 1.22) {
      const jitterX = (random() - 0.5) * 0.92;
      const jitterZ = (random() - 0.5) * 0.92;
      const worldX = x + jitterX;
      const worldZ = z + jitterZ;
      const sample = sampleCourse(worldX, worldZ);
      const clusterSignal = (
        Math.sin(worldX * 0.16 + Math.sin(worldZ * 0.075) * 1.4) * 0.66
        + Math.sin(worldZ * 0.13 - worldX * 0.035) * 0.34
      ) * 0.5 + 0.5;
      const cluster = THREE.MathUtils.smoothstep(clusterSignal, 0.56, 0.88);
      const chance = sample.grassDensity * cluster * 0.38;
      if (random() > chance || sample.surface === 'water' || sample.surface === 'bunker') continue;
      const surfaceScale = sample.surface === 'deepRough' ? 1.2 : sample.surface === 'rough' ? 0.84 : 0.46;
      candidates.push({
        x: worldX,
        z: worldZ,
        height: sample.height + 0.025,
        scale: surfaceScale * (0.65 + random() * 0.7),
        angle: random() * Math.PI,
        phase: random() * Math.PI * 2,
      });
    }
  }

  const phases = new Float32Array(candidates.length);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uInteraction: { value: new THREE.Vector4(10_000, 10_000, 0, 0) },
      uInk: { value: new THREE.Color(0x756953) },
      uWind: { value: new THREE.Vector3(0.4, 0.8, 0.25) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime;
      uniform vec4 uInteraction;
      uniform vec3 uWind;
      varying float vOpacity;

      void main() {
        vec3 transformed = position;
        vec4 baseWorld = modelMatrix * instanceMatrix * vec4(vec3(0.0), 1.0);
        float heightFactor = clamp(position.y / 0.62, 0.0, 1.0);

        float pocket = sin(baseWorld.x * 0.17 + baseWorld.z * 0.09 + aPhase);
        float breeze = sin(uTime * (0.58 + fract(aPhase) * 0.25) + aPhase) * 0.022;
        float windAmount = breeze * heightFactor * smoothstep(0.15, 0.72, pocket * 0.5 + 0.5) * uWind.z;
        transformed.x += windAmount * uWind.x;
        transformed.z += windAmount * uWind.y;

        float distanceToBall = distance(baseWorld.xz, uInteraction.xy);
        float contact = (1.0 - smoothstep(0.0, max(0.01, uInteraction.z), distanceToBall)) * uInteraction.w;
        vec2 away = normalize(baseWorld.xz - uInteraction.xy + vec2(0.0001));
        transformed.x += away.x * contact * 0.16 * heightFactor;
        transformed.z += away.y * contact * 0.16 * heightFactor;
        transformed.y -= contact * 0.12 * heightFactor;

        vec4 worldPosition = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
        vOpacity = 0.21 + fract(aPhase * 0.618) * 0.13;
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform vec3 uInk;
      varying float vOpacity;
      void main() {
        gl_FragColor = vec4(uInk, vOpacity);
        #include <colorspace_fragment>
      }
    `,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, candidates.length);
  mesh.name = 'live-grass';
  const transform = new THREE.Object3D();
  candidates.forEach((candidate, index) => {
    transform.position.set(candidate.x, candidate.height, candidate.z);
    transform.rotation.set(0, candidate.angle, 0);
    transform.scale.set(candidate.scale, candidate.scale, candidate.scale);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    phases[index] = candidate.phase;
  });
  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return { mesh, material };
}

function createWaterStrokes(): THREE.LineSegments {
  const points: THREE.Vector3[] = [];
  const random = mulberry32(9214);
  for (let z = -104; z <= 104; z += 2.65) {
    let runStart: number | null = null;
    for (let x = -65; x <= 65.25; x += 0.5) {
      const sample = sampleCourse(x, z);
      const isWater = sample.surface === 'water';
      if (isWater && runStart === null) runStart = x;
      if ((!isWater || x >= 65) && runStart !== null) {
        const runEnd = isWater ? x : x - 0.5;
        if (runEnd - runStart > 1.2 && random() > 0.19) {
          const y = POND_WATER_LEVEL + 0.035;
          let cursor = runStart + random() * 0.8;
          while (cursor < runEnd - 0.8) {
            const segmentEnd = Math.min(runEnd - random() * 0.65, cursor + 4.2 + random() * 7.4);
            if (segmentEnd - cursor > 1.1) {
              points.push(new THREE.Vector3(cursor, y, z), new THREE.Vector3(segmentEnd, y, z));
            }
            cursor = segmentEnd + 1.1 + random() * 2.4;
          }
        }
        runStart = null;
      }
    }
  }
  return new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x88785e, transparent: true, opacity: 0.14 }),
  );
}

function createWaterSurface(): THREE.Mesh {
  const points = samplePondBoundaryLoop(144);
  const shape = new THREE.Shape();
  points.forEach((point, index) => {
    const shapeY = -point.z;
    if (index === 0) shape.moveTo(point.x, shapeY);
    else shape.lineTo(point.x, shapeY);
  });
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape, 18);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ color: 0xd8c6a5, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'quiet-water-surface';
  mesh.position.y = POND_WATER_LEVEL + 0.012;
  return mesh;
}

function linePointsForBoundary(loop: CourseBoundaryLoop): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const skipEvery = loop.surface === 'water' ? 5 : loop.surface === 'fairway' ? 8 : 0;
  loop.points.forEach((point, index) => {
    const next = loop.points[(index + 1) % loop.points.length]!;
    if (skipEvery > 0 && index % skipEvery === skipEvery - 1) return;
    if (loop.surface === 'fairway') {
      const midpointSurface = sampleCourse((point.x + next.x) * 0.5, (point.z + next.z) * 0.5).surface;
      if (midpointSurface === 'bunker' || midpointSurface === 'water' || midpointSurface === 'green') return;
    }
    const y = loop.surface === 'water'
      ? POND_WATER_LEVEL + 0.058
      : sampleCourse(point.x, point.z).height + 0.055;
    const nextY = loop.surface === 'water'
      ? POND_WATER_LEVEL + 0.058
      : sampleCourse(next.x, next.z).height + 0.055;
    points.push(
      new THREE.Vector3(point.x, y, point.z),
      new THREE.Vector3(next.x, nextY, next.z),
    );
  });
  return points;
}

function createBunkerLipDrawing(): THREE.LineSegments {
  const points: THREE.Vector3[] = [];
  for (const loop of sampleBunkerBoundaryLoops(68)) {
    const center = loop.points.reduce(
      (sum, point) => ({ x: sum.x + point.x / loop.points.length, z: sum.z + point.z / loop.points.length }),
      { x: 0, z: 0 },
    );
    for (let index = 0; index < loop.points.length; index += 2) {
      if (index % 10 === 8) continue;
      const point = loop.points[index]!;
      const radialX = point.x - center.x;
      const radialZ = point.z - center.z;
      const inverseLength = 1 / Math.max(0.001, Math.hypot(radialX, radialZ));
      const directionX = radialX * inverseLength;
      const directionZ = radialZ * inverseLength;
      const farEdge = directionX * 27 - directionZ * 62 < 4;
      if (!farEdge) continue;
      const length = 0.44 + (Math.sin(index * 1.73) * 0.5 + 0.5) * 0.42;
      const insideX = point.x - directionX * length;
      const insideZ = point.z - directionZ * length;
      const outsideX = point.x + directionX * 0.06;
      const outsideZ = point.z + directionZ * 0.06;
      points.push(
        new THREE.Vector3(insideX, sampleCourse(insideX, insideZ).height + 0.07, insideZ),
        new THREE.Vector3(outsideX, sampleCourse(outsideX, outsideZ).height + 0.07, outsideZ),
      );
    }
  }
  const lips = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x71614b, transparent: true, opacity: 0.31 }),
  );
  lips.name = 'bunker-lip-hatching';
  return lips;
}

function createTerrainContourDrawing(): THREE.LineSegments {
  const points: THREE.Vector3[] = [];
  const step = 2;
  const interval = 0.42;
  const makeIntersection = (
    ax: number,
    az: number,
    ah: number,
    bx: number,
    bz: number,
    bh: number,
    level: number,
  ): THREE.Vector3 | null => {
    if ((ah < level && bh < level) || (ah > level && bh > level) || ah === bh) return null;
    const t = (level - ah) / (bh - ah);
    if (t < 0 || t > 1) return null;
    return new THREE.Vector3(
      THREE.MathUtils.lerp(ax, bx, t),
      level + 0.065,
      THREE.MathUtils.lerp(az, bz, t),
    );
  };

  for (let z = COURSE_BOUNDS.minZ; z < COURSE_BOUNDS.maxZ; z += step) {
    for (let x = COURSE_BOUNDS.minX; x < COURSE_BOUNDS.maxX; x += step) {
      const centerSample = sampleCourse(x + step * 0.5, z + step * 0.5);
      if (
        centerSample.surface !== 'rough'
        && centerSample.surface !== 'deepRough'
        && centerSample.surface !== 'bank'
        && centerSample.surface !== 'cliff'
      ) continue;

      const h00 = sampleCourse(x, z).height;
      const h10 = sampleCourse(x + step, z).height;
      const h11 = sampleCourse(x + step, z + step).height;
      const h01 = sampleCourse(x, z + step).height;
      const minimum = Math.min(h00, h10, h11, h01);
      const maximum = Math.max(h00, h10, h11, h01);
      const startLevel = Math.ceil(minimum / interval) * interval;

      for (let level = startLevel; level <= maximum; level += interval) {
        const intersections = [
          makeIntersection(x, z, h00, x + step, z, h10, level),
          makeIntersection(x + step, z, h10, x + step, z + step, h11, level),
          makeIntersection(x + step, z + step, h11, x, z + step, h01, level),
          makeIntersection(x, z + step, h01, x, z, h00, level),
        ].filter((point): point is THREE.Vector3 => point !== null);
        const cellX = Math.round((x - COURSE_BOUNDS.minX) / step);
        const cellZ = Math.round((z - COURSE_BOUNDS.minZ) / step);
        const gate = Math.abs((cellX * 92821 + cellZ * 68917 + Math.round(level * 100) * 37) % 13);
        if (gate < 2) continue;
        if (intersections.length === 2) points.push(intersections[0]!, intersections[1]!);
        else if (intersections.length === 4) {
          points.push(intersections[0]!, intersections[1]!, intersections[2]!, intersections[3]!);
        }
      }
    }
  }

  const contours = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x766850, transparent: true, opacity: 0.16 }),
  );
  contours.name = 'broken-terrain-contours';
  return contours;
}

function createSemanticBoundaries(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'semantic-boundary-lines';
  const loops = sampleCourseBoundaryLoops(112);
  for (const loop of loops) {
    const opacity = loop.surface === 'green' || loop.surface === 'bunker'
      ? 0.48
      : loop.surface === 'water'
        ? 0.39
        : 0.28;
    const line = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(linePointsForBoundary(loop)),
      new THREE.LineBasicMaterial({
        color: loop.surface === 'bunker' ? 0x76664f : 0x796b55,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    );
    line.name = `${loop.id}-boundary`;
    group.add(line);
  }
  return group;
}

function groundedLine(points: readonly CoursePoint2[], xOffset = 0): THREE.Vector3[] {
  return points.map((point) => {
    const x = point.x + xOffset;
    return new THREE.Vector3(x, sampleCourse(x, point.z).height + 0.075, point.z);
  });
}

function brokenGroundedSegments(
  points: readonly CoursePoint2[],
  xOffset: number,
  skipEvery: number,
): THREE.Vector3[] {
  const grounded = groundedLine(points, xOffset);
  const segments: THREE.Vector3[] = [];
  for (let index = 0; index < grounded.length - 1; index += 1) {
    if (index % skipEvery === skipEvery - 1) continue;
    segments.push(grounded[index]!, grounded[index + 1]!);
  }
  return segments;
}

function createBankDrawing(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'raised-bank-drawing';
  const edge = sampleRightBankEdge(132);
  const material = new THREE.LineBasicMaterial({
    color: 0x71634e,
    transparent: true,
    opacity: 0.43,
    depthWrite: false,
  });
  const topMaterial = new THREE.LineBasicMaterial({
    color: 0x695d4a,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
  });
  group.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(brokenGroundedSegments(edge, 0, 11)),
    material,
  ));
  group.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(brokenGroundedSegments(edge, 5.45, 14)),
    topMaterial,
  ));

  const hatches: THREE.Vector3[] = [];
  for (let index = 2; index < edge.length - 2; index += 4) {
    if (index % 20 === 18) continue;
    const point = edge[index]!;
    const next = edge[Math.min(edge.length - 1, index + 1)]!;
    const wobble = Math.sin(point.z * 0.37) * 0.22;
    const footX = point.x + 0.2;
    const topX = point.x + 4.6 + wobble;
    hatches.push(
      new THREE.Vector3(footX, sampleCourse(footX, point.z).height + 0.08, point.z),
      new THREE.Vector3(topX, sampleCourse(topX, next.z).height + 0.08, next.z),
    );
  }
  group.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(hatches),
    new THREE.LineBasicMaterial({ color: 0x74644e, transparent: true, opacity: 0.3 }),
  ));
  return group;
}

function createRockClusters(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'code-generated-rocks';
  const random = mulberry32(33491);
  const material = new THREE.MeshBasicMaterial({ color: 0xc5ad87 });
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x746650,
    transparent: true,
    opacity: 0.38,
  });

  const clusters = [
    { x: 46, z: -26, count: 7 },
    { x: -46, z: 45, count: 5 },
    { x: 48, z: 54, count: 8 },
  ];
  for (const cluster of clusters) {
    for (let index = 0; index < cluster.count; index += 1) {
      const x = cluster.x + (random() - 0.5) * 9;
      const z = cluster.z + (random() - 0.5) * 12;
      const sample = sampleCourse(x, z);
      if (sample.surface === 'water') continue;
      const radius = 0.3 + random() * 0.72;
      const geometry = new THREE.DodecahedronGeometry(radius, 0);
      const rock = new THREE.Mesh(geometry, material);
      rock.scale.y = 0.46 + random() * 0.42;
      rock.rotation.set(random(), random() * Math.PI, random() * 0.3);
      rock.position.set(x, sample.height + radius * rock.scale.y * 0.48, z);
      group.add(rock);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 31), edgeMaterial);
      edges.scale.copy(rock.scale);
      edges.rotation.copy(rock.rotation);
      edges.position.copy(rock.position);
      group.add(edges);
    }
  }
  return group;
}

function createIllustrativeTufts(): THREE.LineSegments {
  const random = mulberry32(449173);
  const points: THREE.Vector3[] = [];
  let accepted = 0;
  for (let attempt = 0; attempt < 1500 && accepted < 78; attempt += 1) {
    const x = THREE.MathUtils.lerp(COURSE_BOUNDS.minX + 2, COURSE_BOUNDS.maxX - 2, random());
    const z = THREE.MathUtils.lerp(COURSE_BOUNDS.minZ + 2, COURSE_BOUNDS.maxZ - 2, random());
    const sample = sampleCourse(x, z);
    if (sample.surface !== 'deepRough' && sample.surface !== 'rough' && sample.surface !== 'bank') continue;
    const clusterSignal = Math.sin(x * 0.1 + Math.sin(z * 0.04) * 1.7) * 0.5 + 0.5;
    const clusterChance = THREE.MathUtils.smoothstep(clusterSignal, 0.5, 0.86) * 0.82;
    if (random() > clusterChance) continue;

    const blades = 7 + Math.floor(random() * 6);
    const baseHeight = sample.height + 0.05;
    const tuftScale = 0.9 + random() * 0.88;
    for (let bladeIndex = 0; bladeIndex < blades; bladeIndex += 1) {
      const fan = bladeIndex / Math.max(1, blades - 1) - 0.5;
      const orientation = random() * Math.PI * 2;
      const spread = fan * (0.72 + random() * 0.42) * tuftScale;
      const height = (0.55 + Math.sin((bladeIndex / blades) * Math.PI) * 0.62 + random() * 0.25) * tuftScale;
      const baseX = x + (random() - 0.5) * 0.16;
      const baseZ = z + (random() - 0.5) * 0.16;
      const directionX = Math.cos(orientation) * spread;
      const directionZ = Math.sin(orientation) * spread;
      const base = new THREE.Vector3(baseX, baseHeight, baseZ);
      const middle = new THREE.Vector3(
        baseX + directionX * 0.42,
        baseHeight + height * 0.57,
        baseZ + directionZ * 0.42,
      );
      const tip = new THREE.Vector3(
        baseX + directionX,
        baseHeight + height,
        baseZ + directionZ,
      );
      points.push(base, middle, middle.clone(), tip);
    }
    accepted += 1;
  }

  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x746650, transparent: true, opacity: 0.5 }),
  );
  lines.name = 'illustrative-grass-clumps';
  return lines;
}

function createSmallRockDrawing(): THREE.LineSegments {
  const random = mulberry32(729541);
  const points: THREE.Vector3[] = [];
  let accepted = 0;
  for (let attempt = 0; attempt < 500 && accepted < 52; attempt += 1) {
    const x = THREE.MathUtils.lerp(COURSE_BOUNDS.minX + 2, COURSE_BOUNDS.maxX - 2, random());
    const z = THREE.MathUtils.lerp(COURSE_BOUNDS.minZ + 2, COURSE_BOUNDS.maxZ - 2, random());
    const sample = sampleCourse(x, z);
    if (sample.surface !== 'deepRough' && sample.surface !== 'rough' && sample.surface !== 'bank') continue;
    if (random() < 0.38) continue;
    const width = 0.26 + random() * 0.48;
    const height = width * (0.42 + random() * 0.28);
    const orientation = random() * Math.PI;
    const axisX = Math.cos(orientation);
    const axisZ = Math.sin(orientation);
    for (let segment = 0; segment < 7; segment += 1) {
      const angleA = Math.PI - (segment / 7) * Math.PI;
      const angleB = Math.PI - ((segment + 1) / 7) * Math.PI;
      const makePoint = (angle: number) => {
        const along = Math.cos(angle) * width;
        return new THREE.Vector3(
          x + axisX * along,
          sample.height + 0.045 + Math.sin(angle) * height,
          z + axisZ * along,
        );
      };
      points.push(makePoint(angleA), makePoint(angleB));
    }
    accepted += 1;
  }
  const rocks = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x756650, transparent: true, opacity: 0.47 }),
  );
  rocks.name = 'small-rock-pencil-marks';
  return rocks;
}

function createCartTrackDrawing(): THREE.LineSegments {
  const centerline = sampleFairwayCenterline(170);
  const points: THREE.Vector3[] = [];
  for (const offset of [-0.72, 0.72]) {
    for (let index = 0; index < centerline.length - 1; index += 1) {
      if (index % 7 === 5 || index % 7 === 6) continue;
      const current = centerline[index]!;
      const next = centerline[index + 1]!;
      const before = centerline[Math.max(0, index - 1)]!;
      const after = centerline[Math.min(centerline.length - 1, index + 1)]!;
      const tangentX = after.x - before.x;
      const tangentZ = after.z - before.z;
      const inverseLength = 1 / Math.max(0.001, Math.hypot(tangentX, tangentZ));
      const normalX = -tangentZ * inverseLength;
      const normalZ = tangentX * inverseLength;
      const nextBefore = current;
      const nextAfter = centerline[Math.min(centerline.length - 1, index + 2)]!;
      const nextTangentX = nextAfter.x - nextBefore.x;
      const nextTangentZ = nextAfter.z - nextBefore.z;
      const nextInverseLength = 1 / Math.max(0.001, Math.hypot(nextTangentX, nextTangentZ));
      const nextNormalX = -nextTangentZ * nextInverseLength;
      const nextNormalZ = nextTangentX * nextInverseLength;
      const x1 = current.x + normalX * offset;
      const z1 = current.z + normalZ * offset;
      const x2 = next.x + nextNormalX * offset;
      const z2 = next.z + nextNormalZ * offset;
      points.push(
        new THREE.Vector3(x1, sampleCourse(x1, z1).height + 0.055, z1),
        new THREE.Vector3(x2, sampleCourse(x2, z2).height + 0.055, z2),
      );
    }
  }
  const tracks = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x7d6e56, transparent: true, opacity: 0.2 }),
  );
  tracks.name = 'quiet-cart-tracks';
  return tracks;
}

export class IllustratedWorld {
  readonly root = new THREE.Group();
  readonly golfer = new GolferFigure();
  readonly cart = new CartFigure();
  readonly flag = new FlagFigure();
  readonly ball = makeBallVisual();
  readonly marks = new InteractionMarks();
  readonly ambientLife = new AmbientLife();
  private readonly terrainLayer = new TerrainChunkLayer();
  private readonly grassMaterial: THREE.ShaderMaterial;
  private interactionStrength = 0;
  private readonly ballVisuals = new Map<string, THREE.Group>();
  private reducedMotion = false;
  private ballScale = 1;
  private environment: EnvironmentSample = sampleEnvironment(0);

  constructor(streamer: PropertyChunkStreamer) {
    this.root.name = 'illustrated-course';
    this.root.add(this.terrainLayer.root);
    streamer.register(this.terrainLayer);

    const grass = createGrassField();
    this.grassMaterial = grass.material;
    this.root.add(grass.mesh);
    this.root.add(createWaterSurface());
    this.root.add(createWaterStrokes());
    this.root.add(createSemanticBoundaries());
    this.root.add(createBunkerLipDrawing());
    this.root.add(createTerrainContourDrawing());
    this.root.add(createBankDrawing());
    this.root.add(createCartTrackDrawing());
    this.root.add(createIllustrativeTufts());
    this.root.add(createSmallRockDrawing());
    this.root.add(createRockClusters());
    this.root.add(this.marks.root);
    this.root.add(this.ambientLife.root);

    this.positionGrounded(this.golfer, 0, -63);
    this.golfer.rotation.y = 0.05;
    this.root.add(this.golfer);

    this.positionGrounded(this.cart, 5.8, -64.5);
    this.cart.rotation.y = -0.08;
    this.cart.scale.setScalar(0.82);
    this.root.add(this.cart);

    this.positionGrounded(this.flag, 1.8, 65.5);
    this.root.add(this.flag);

    this.positionGrounded(this.ball, 0.42, -60.9);
    this.root.add(this.ball);
  }

  update(elapsed: number, delta: number): void {
    const visualTime = this.reducedMotion ? 0 : elapsed;
    this.golfer.update(visualTime);
    this.flag.update(visualTime);
    this.grassMaterial.uniforms.uTime!.value = visualTime;
    this.environment = sampleEnvironment(elapsed);
    const windLength = Math.max(0.001, Math.hypot(this.environment.windX, this.environment.windZ));
    (this.grassMaterial.uniforms.uWind!.value as THREE.Vector3).set(
      this.environment.windX / windLength,
      this.environment.windZ / windLength,
      0.65 + this.environment.intensity * 1.4,
    );
    this.ambientLife.update(elapsed, this.environment, this.reducedMotion);
    this.interactionStrength = Math.max(0, this.interactionStrength - delta * 0.82);
    (this.grassMaterial.uniforms.uInteraction!.value as THREE.Vector4).w = this.interactionStrength;
    this.marks.update(delta);
  }

  setBallPosition(position: THREE.Vector3, moving: boolean): void {
    this.updateBallVisual(this.ball, position, moving, true);
  }

  bindPrimaryBall(id: string): void {
    this.ballVisuals.set(id, this.ball);
  }

  ensureBallVisual(id: string): THREE.Group {
    const existing = this.ballVisuals.get(id);
    if (existing) return existing;
    const visual = makeBallVisual();
    visual.name = `ball-visual-${id}`;
    this.ballVisuals.set(id, visual);
    visual.scale.setScalar(this.ballScale);
    this.root.add(visual);
    return visual;
  }

  setBallState(
    id: string,
    position: THREE.Vector3,
    moving: boolean,
    orientation: THREE.Quaternion,
    visible: boolean,
    trace: boolean,
  ): void {
    const visual = this.ensureBallVisual(id);
    this.updateBallVisual(visual, position, moving, trace);
    visual.visible = visible;
    const ballMesh = visual.children[0];
    if (ballMesh) ballMesh.quaternion.copy(orientation);
  }

  removeBallVisual(id: string): void {
    const visual = this.ballVisuals.get(id);
    if (!visual || visual === this.ball) return;
    visual.traverse((child) => {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
    visual.removeFromParent();
    this.ballVisuals.delete(id);
  }

  get ballVisualCount(): number {
    return this.ballVisuals.size;
  }

  setBallScale(scale: number): void {
    this.ballScale = scale;
    for (const visual of this.ballVisuals.values()) visual.scale.setScalar(scale);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  get environmentState(): EnvironmentSample {
    return this.environment;
  }

  private updateBallVisual(
    visual: THREE.Group,
    position: THREE.Vector3,
    moving: boolean,
    trace: boolean,
  ): void {
    visual.position.copy(position);
    visual.visible = position.y > -50;
    const courseSample = propertyField.sample(position.x, position.z);
    const groundY = courseSample.surface === 'water'
      ? courseSample.height + courseSample.waterDepth
      : courseSample.height;
    const clearance = Math.max(0, position.y - groundY);
    const ballShadow = visual.getObjectByName('ball-ground-shadow');
    if (ballShadow instanceof THREE.Mesh && ballShadow.material instanceof THREE.MeshBasicMaterial) {
      ballShadow.position.y = groundY - position.y + 0.012;
      ballShadow.material.opacity = 0.13 * THREE.MathUtils.lerp(1, 0.12, THREE.MathUtils.clamp(clearance / 12, 0, 1));
      const spread = 1 + THREE.MathUtils.clamp(clearance / 18, 0, 0.38);
      ballShadow.scale.set(0.46 * spread, 0.23 * spread, 1);
    }
    const interaction = this.grassMaterial.uniforms.uInteraction!.value as THREE.Vector4;
    interaction.x = position.x;
    interaction.y = position.z;
    interaction.z = moving ? 1.7 : 1.1;
    if (moving && position.y - groundY < 0.65) {
      this.interactionStrength = Math.min(1, this.interactionStrength + 0.13);
    }
    if (trace) this.marks.updateTrail(position, moving);
  }

  addImpact(kind: MarkKind, position: THREE.Vector3): void {
    this.marks.addImpact(kind, position);
    this.interactionStrength = kind === 'water' ? 0 : 1;
  }

  addCartTrack(from: THREE.Vector3, to: THREE.Vector3, heading: number): void {
    this.marks.addCartTrack(from, to, heading);
  }

  addFootprint(position: THREE.Vector3, heading: number, strength: number): void {
    this.marks.addFootprint(position, heading, strength);
  }

  addDivot(position: THREE.Vector3, heading: number, strength: number): void {
    this.marks.addDivot(position, heading, strength);
  }

  replayTrace(event: TraceEvent): void {
    this.marks.replayTrace(event);
  }

  clearInteractions(): void {
    this.marks.reset();
    this.interactionStrength = 0;
  }

  private positionGrounded(object: THREE.Object3D, x: number, z: number): void {
    object.position.set(x, propertyField.heightAt(x, z), z);
  }

  get streamedChunkCount(): number {
    return this.terrainLayer.count;
  }
}
