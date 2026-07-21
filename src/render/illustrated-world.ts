import * as THREE from 'three';
import {
  BUNKERS,
  POND_WATER_LEVEL,
  COURSE_BOUNDS,
  bunkerSignedDistance,
  fairwaySignedDistance,
  greenSignedDistance,
  pondSignedDistance,
  sampleCourse,
  sampleCourseBoundaryLoops,
  sampleBunkerBoundaryLoops,
  sampleFairwayCenterline,
  samplePondBoundaryLoop,
  sampleRightBankEdge,
  teeSignedDistance,
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
import { ART_LIMITS, ART_PALETTE, ILLUSTRATION_LIGHT } from './art-style';
import { ReactiveSurface } from './reactive-surface';
import type { WorldEvent } from '../core/world-events';
import {
  type PropertyChunkConsumer,
  type PropertyChunkDescriptor,
  type PropertyChunkStreamer,
} from '../world/property-streamer';

const SURFACE_COLORS: Record<CourseSurface, number> = {
  tee: ART_PALETTE.tee,
  fairway: ART_PALETTE.fairway,
  green: ART_PALETTE.green,
  rough: ART_PALETTE.rough,
  deepRough: ART_PALETTE.deepRough,
  bunker: ART_PALETTE.bunker,
  water: ART_PALETTE.water,
  bank: ART_PALETTE.bank,
  cliff: ART_PALETTE.cliff,
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
  const detailAmount = new Float32Array(position.count);
  const fairwayDistances = new Float32Array(position.count);
  const greenDistances = new Float32Array(position.count);
  const teeDistances = new Float32Array(position.count);
  const bunkerDistances = new Float32Array(position.count);
  const waterDistances = new Float32Array(position.count);
  const color = new THREE.Color();

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index) + chunk.centerX;
    const z = position.getZ(index) + chunk.centerZ;
    const sample = propertyField.sample(x, z);
    const fairwayDistance = fairwaySignedDistance(x, z);
    const greenDistance = greenSignedDistance(x, z);
    const teeDistance = teeSignedDistance(x, z);
    const bunkerDistance = BUNKERS.reduce(
      (minimum, bunker) => Math.min(minimum, bunkerSignedDistance(bunker, x, z)),
      Number.POSITIVE_INFINITY,
    );
    const waterDistance = pondSignedDistance(x, z);
    position.setY(index, sample.height);
    (geometry.attributes.normal as THREE.BufferAttribute).setXYZ(
      index,
      sample.normal.x,
      sample.normal.y,
      sample.normal.z,
    );
    // Feature pigments are selected from interpolated signed distances in the
    // fragment shader. Keeping the vertex wash to its underlying land surface
    // avoids broad, meter-scale color halos around greens, tees, and bunkers.
    const baseSurface = sample.surface === 'green'
      || sample.surface === 'tee'
      || sample.surface === 'bunker'
      || sample.surface === 'water'
      ? fairwayDistance <= 0 ? 'fairway' : 'rough'
      : sample.surface;
    color.setHex(SURFACE_COLORS[baseSurface]);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
    detailAmount[index] = sample.grassDensity;
    fairwayDistances[index] = fairwayDistance;
    greenDistances[index] = greenDistance;
    teeDistances[index] = teeDistance;
    bunkerDistances[index] = bunkerDistance;
    waterDistances[index] = waterDistance;
  }

  position.needsUpdate = true;
  geometry.attributes.normal!.needsUpdate = true;
  geometry.setAttribute('aSurfaceColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aDetail', new THREE.BufferAttribute(detailAmount, 1));
  geometry.setAttribute('aFairwayDistance', new THREE.BufferAttribute(fairwayDistances, 1));
  geometry.setAttribute('aGreenDistance', new THREE.BufferAttribute(greenDistances, 1));
  geometry.setAttribute('aTeeDistance', new THREE.BufferAttribute(teeDistances, 1));
  geometry.setAttribute('aBunkerDistance', new THREE.BufferAttribute(bunkerDistances, 1));
  geometry.setAttribute('aWaterDistance', new THREE.BufferAttribute(waterDistances, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function createTerrainMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPaper: { value: new THREE.Color(ART_PALETTE.paper) },
      uInk: { value: new THREE.Color(ART_PALETTE.graphite) },
      uFairway: { value: new THREE.Color(ART_PALETTE.fairway) },
      uGreen: { value: new THREE.Color(ART_PALETTE.green) },
      uTee: { value: new THREE.Color(ART_PALETTE.tee) },
      uBunker: { value: new THREE.Color(ART_PALETTE.bunker) },
      uWater: { value: new THREE.Color(ART_PALETTE.water) },
      uLightDirection: {
        value: new THREE.Vector3(...ILLUSTRATION_LIGHT.direction).normalize(),
      },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aSurfaceColor;
      attribute float aDetail;
      attribute float aFairwayDistance;
      attribute float aGreenDistance;
      attribute float aTeeDistance;
      attribute float aBunkerDistance;
      attribute float aWaterDistance;

      varying vec3 vSurfaceColor;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying float vDetail;
      varying float vFairwayDistance;
      varying float vGreenDistance;
      varying float vTeeDistance;
      varying float vBunkerDistance;
      varying float vWaterDistance;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vSurfaceColor = aSurfaceColor;
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vDetail = aDetail;
        vFairwayDistance = aFairwayDistance;
        vGreenDistance = aGreenDistance;
        vTeeDistance = aTeeDistance;
        vBunkerDistance = aBunkerDistance;
        vWaterDistance = aWaterDistance;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec3 vSurfaceColor;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying float vDetail;
      varying float vFairwayDistance;
      varying float vGreenDistance;
      varying float vTeeDistance;
      varying float vBunkerDistance;
      varying float vWaterDistance;

      uniform vec3 uPaper;
      uniform vec3 uInk;
      uniform vec3 uFairway;
      uniform vec3 uGreen;
      uniform vec3 uTee;
      uniform vec3 uBunker;
      uniform vec3 uWater;
      uniform vec3 uLightDirection;

      float hash21(vec2 point) {
        point = fract(point * vec2(123.34, 456.21));
        point += dot(point, point + 45.32);
        return fract(point.x * point.y);
      }

      float lineAt(float value, float width) {
        float centered = abs(fract(value + 0.5) - 0.5);
        return 1.0 - smoothstep(width, width + fwidth(value) * 1.4, centered);
      }

      float insideMask(float signedDistance) {
        float antialiasWidth = max(fwidth(signedDistance) * 1.1, 0.012);
        return 1.0 - smoothstep(-antialiasWidth, antialiasWidth, signedDistance);
      }

      float bayer4(vec2 pixel) {
        vec2 p = mod(floor(pixel), 4.0);
        float index = p.x + p.y * 4.0;
        if (index < 0.5) return 0.0 / 16.0;
        if (index < 1.5) return 8.0 / 16.0;
        if (index < 2.5) return 2.0 / 16.0;
        if (index < 3.5) return 10.0 / 16.0;
        if (index < 4.5) return 12.0 / 16.0;
        if (index < 5.5) return 4.0 / 16.0;
        if (index < 6.5) return 14.0 / 16.0;
        if (index < 7.5) return 6.0 / 16.0;
        if (index < 8.5) return 3.0 / 16.0;
        if (index < 9.5) return 11.0 / 16.0;
        if (index < 10.5) return 1.0 / 16.0;
        if (index < 11.5) return 9.0 / 16.0;
        if (index < 12.5) return 15.0 / 16.0;
        if (index < 13.5) return 7.0 / 16.0;
        if (index < 14.5) return 13.0 / 16.0;
        return 5.0 / 16.0;
      }

      void main() {
        vec3 color = vSurfaceColor;
        vec2 world = vWorldPosition.xz;
        float slope = clamp(1.0 - vWorldNormal.y, 0.0, 0.72);
        float waterMask = insideMask(vWaterDistance);
        float sandMask = insideMask(vBunkerDistance) * (1.0 - waterMask);
        float greenMask = insideMask(vGreenDistance) * (1.0 - max(waterMask, sandMask));
        float teeMask = insideMask(vTeeDistance) * (1.0 - max(max(waterMask, sandMask), greenMask));
        float fairwayMask = insideMask(vFairwayDistance)
          * (1.0 - max(max(waterMask, sandMask), max(greenMask, teeMask)));

        color = mix(color, uFairway, fairwayMask);
        color = mix(color, uTee, teeMask);
        color = mix(color, uGreen, greenMask);
        color = mix(color, uBunker, sandMask);
        color = mix(color, uWater, waterMask);

        // Stable fibers and pigment wash stay anchored in world space.
        float broadFiber = sin(world.x * 0.31 + sin(world.y * 0.12) * 0.8) * 0.5 + 0.5;
        float pigment = hash21(floor(world * 5.5));
        float wash = sin(world.x * 0.071 + sin(world.y * 0.043) * 1.8) * 0.5 + 0.5;
        color += (broadFiber - 0.5) * 0.014;
        color += (pigment - 0.5) * 0.013;
        color = mix(color, uPaper, (wash - 0.5) * 0.055 + 0.025);

        // A few broken fairway fibers imply nap without carpeting the hole in
        // repeated mowing-stripe dashes.
        float quietMask = max(greenMask, waterMask);
        float grainFlow = world.x * 1.08
          + sin(world.y * 0.19) * 0.16
          + sin(world.x * 0.27 + world.y * 0.13) * 0.1;
        float grainLine = lineAt(grainFlow, 0.016);
        float grainGate = step(0.91, hash21(floor(world * vec2(0.41, 0.83))));
        color = mix(color, uInk, grainLine * grainGate * fairwayMask * 0.034);

        // Height contours appear only where the slope needs explaining and are intentionally broken.
        float contour = lineAt(vWorldPosition.y / 0.78, 0.035);
        float contourGate = smoothstep(0.19, 0.5, hash21(floor(world * vec2(0.11, 0.25))));
        float contourStrength = contour * contourGate * smoothstep(0.035, 0.16, slope);
        contourStrength *= (1.0 - quietMask * 0.82) * (1.0 - sandMask * 0.55);
        color = mix(color, uInk, contourStrength * 0.28);

        // Short grade strokes align with the local downhill vector, so their
        // direction changes with the land instead of repeating across it.
        vec2 downhill = vWorldNormal.xz;
        float downhillLength = length(downhill);
        downhill = downhillLength > 0.001 ? downhill / downhillLength : vec2(0.0, 1.0);
        vec2 acrossSlope = vec2(-downhill.y, downhill.x);
        vec2 hatchSpace = vec2(dot(world, acrossSlope) * 0.48, dot(world, downhill) * 0.31);
        float hatch = lineAt(hatchSpace.x, 0.026);
        float hatchLength = smoothstep(0.54, 0.76, sin(hatchSpace.y * 6.28318) * 0.5 + 0.5);
        float hatchCluster = step(0.74, hash21(floor(world * vec2(0.12, 0.1))));
        float hatchStrength = hatch * hatchLength * hatchCluster * smoothstep(0.08, 0.28, slope);
        hatchStrength *= (1.0 - quietMask) * (0.35 + vDetail * 0.65);
        color = mix(color, uInk, hatchStrength * 0.17);

        // Rare soft graphite flecks replace the former pixel-dense stipple.
        vec2 stippleCell = floor(world * 1.25);
        vec2 stippleLocal = fract(world * 1.25) - 0.5;
        float dotShape = 1.0 - smoothstep(0.055, 0.11, length(stippleLocal));
        float dotGate = step(0.965 - vDetail * 0.012, hash21(stippleCell));
        float stipple = dotShape * dotGate * (1.0 - quietMask) * (0.25 + vDetail * 0.75);
        color = mix(color, uInk, stipple * 0.075);

        // Wrapped daylight plus slope hatching describes 3D form without a glossy/PBR look.
        float daylight = dot(normalize(vWorldNormal), normalize(uLightDirection));
        float shade = (1.0 - smoothstep(-0.28, 0.86, daylight)) * 0.024 + slope * 0.012;
        float dither = bayer4(gl_FragCoord.xy);
        float ditherBand = smoothstep(dither - 0.08, dither + 0.08, shade * 5.2) * shade;
        color = mix(color, uInk, shade * 0.32 + ditherBand * 0.075);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

class TerrainChunkLayer implements PropertyChunkConsumer {
  readonly root = new THREE.Group();
  private readonly material = createTerrainMaterial();
  private readonly shadowMaterial = new THREE.ShadowMaterial({
    color: ART_PALETTE.shadow,
    opacity: ILLUSTRATION_LIGHT.shadowOpacity,
    transparent: true,
    depthWrite: false,
  });
  private readonly meshes = new Map<string, {
    base: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  }>();

  constructor() {
    this.root.name = 'streamed-terrain-chunks';
  }

  activateChunk(chunk: PropertyChunkDescriptor): void {
    if (this.meshes.has(chunk.key)) return;
    const geometry = createTerrainGeometry(chunk);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = `terrain-chunk-${chunk.key}`;
    mesh.position.set(chunk.centerX, 0, chunk.centerZ);
    mesh.userData.chunkKey = chunk.key;
    const shadow = new THREE.Mesh(geometry, this.shadowMaterial);
    shadow.name = `terrain-shadow-receiver-${chunk.key}`;
    shadow.position.copy(mesh.position);
    shadow.receiveShadow = true;
    shadow.renderOrder = 1;
    this.meshes.set(chunk.key, { base: mesh, shadow });
    this.root.add(mesh, shadow);
  }

  deactivateChunk(key: string): void {
    const mesh = this.meshes.get(key);
    if (!mesh) return;
    mesh.base.geometry.dispose();
    mesh.base.removeFromParent();
    mesh.shadow.removeFromParent();
    this.meshes.delete(key);
  }

  get count(): number {
    return this.meshes.size;
  }
}

function createGrassBladeGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([
      -0.045, 0, 0,
      0.045, 0, 0,
      0.0, 0.62, 0,
      0, 0, -0.04,
      0, 0, 0.04,
      0, 0.58, 0,
    ], 3),
  );
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  return geometry;
}

function createGrassMaterial(reactiveSurface: ReactiveSurface): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uInteractionCount: { value: ART_LIMITS.grassInteractions },
      uInteractions: { value: reactiveSurface.uniforms },
      uInk: { value: new THREE.Color(ART_PALETTE.grassInk) },
      uWind: { value: new THREE.Vector3(0.4, 0.8, 0.25) },
    },
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform int uInteractionCount;
      uniform vec4 uInteractions[${ART_LIMITS.grassInteractions}];
      uniform vec3 uWind;
      varying float vCoverage;

      float hash21(vec2 point) {
        point = fract(point * vec2(123.34, 456.21));
        point += dot(point, point + 45.32);
        return fract(point.x * point.y);
      }

      void main() {
        vec3 transformed = position;
        vec4 baseWorld = modelMatrix * instanceMatrix * vec4(vec3(0.0), 1.0);
        float heightFactor = clamp(position.y / 0.62, 0.0, 1.0);
        float phase = hash21(baseWorld.xz) * 6.2831853;

        float pocket = sin(baseWorld.x * 0.17 + baseWorld.z * 0.09 + phase);
        float breeze = sin(uTime * (0.58 + fract(phase) * 0.25) + phase) * 0.028;
        float windAmount = breeze * heightFactor * smoothstep(0.15, 0.72, pocket * 0.5 + 0.5) * uWind.z;
        float bend = 0.0;
        vec2 bendDirection = vec2(0.0);
        for (int index = 0; index < ${ART_LIMITS.grassInteractions}; index += 1) {
          if (index >= uInteractionCount) break;
          vec4 interaction = uInteractions[index];
          float distanceToContact = distance(baseWorld.xz, interaction.xy);
          float contact = (1.0 - smoothstep(0.0, max(0.01, interaction.z), distanceToContact)) * interaction.w;
          vec2 away = normalize(baseWorld.xz - interaction.xy + vec2(0.0001));
          bendDirection += away * contact;
          bend = max(bend, contact);
        }
        float flexibleTip = heightFactor * heightFactor;
        vec4 worldPosition = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        // Wind and contact are world-space fields. Applying them after the
        // random instance rotation keeps every blade bending coherently away.
        worldPosition.x += (windAmount * uWind.x + bendDirection.x * 0.28) * flexibleTip;
        worldPosition.z += (windAmount * uWind.y + bendDirection.y * 0.28) * flexibleTip;
        worldPosition.y -= bend * 0.2 * flexibleTip;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
        vCoverage = 0.3 + fract(phase * 0.618) * 0.15;
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform vec3 uInk;
      varying float vCoverage;

      float bayer4(vec2 pixel) {
        vec2 p = mod(floor(pixel), 4.0);
        float index = p.x + p.y * 4.0;
        if (index < 0.5) return 0.0 / 16.0;
        if (index < 1.5) return 8.0 / 16.0;
        if (index < 2.5) return 2.0 / 16.0;
        if (index < 3.5) return 10.0 / 16.0;
        if (index < 4.5) return 12.0 / 16.0;
        if (index < 5.5) return 4.0 / 16.0;
        if (index < 6.5) return 14.0 / 16.0;
        if (index < 7.5) return 6.0 / 16.0;
        if (index < 8.5) return 3.0 / 16.0;
        if (index < 9.5) return 11.0 / 16.0;
        if (index < 10.5) return 1.0 / 16.0;
        if (index < 11.5) return 9.0 / 16.0;
        if (index < 12.5) return 15.0 / 16.0;
        if (index < 13.5) return 7.0 / 16.0;
        if (index < 14.5) return 13.0 / 16.0;
        return 5.0 / 16.0;
      }

      void main() {
        if (bayer4(gl_FragCoord.xy) > vCoverage) discard;
        gl_FragColor = vec4(uInk, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

class GrassChunkLayer implements PropertyChunkConsumer {
  readonly root = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  private readonly geometry = createGrassBladeGeometry();
  private readonly meshes = new Map<string, THREE.InstancedMesh>();

  constructor(reactiveSurface: ReactiveSurface) {
    this.root.name = 'streamed-live-grass';
    this.material = createGrassMaterial(reactiveSurface);
  }

  activateChunk(chunk: PropertyChunkDescriptor): void {
    if (this.meshes.has(chunk.key)) return;
    const random = mulberry32(chunk.seed ^ 0x5e21a7);
    const candidates: Array<{
      x: number;
      z: number;
      height: number;
      scale: number;
      angle: number;
    }> = [];
    const spacing = 1.18;
    for (let z = chunk.minZ + spacing * 0.5; z < chunk.maxZ; z += spacing) {
      for (let x = chunk.minX + spacing * 0.5; x < chunk.maxX; x += spacing) {
        const worldX = x + (random() - 0.5) * spacing * 0.72;
        const worldZ = z + (random() - 0.5) * spacing * 0.72;
        const sample = propertyField.sample(worldX, worldZ);
        if (sample.surface === 'water' || sample.surface === 'bunker' || sample.surface === 'cliff') continue;
        const clusterSignal = (
          Math.sin(worldX * 0.14 + Math.sin(worldZ * 0.061) * 1.7) * 0.66
          + Math.sin(worldZ * 0.12 - worldX * 0.039) * 0.34
        ) * 0.5 + 0.5;
        const cluster = THREE.MathUtils.smoothstep(clusterSignal, 0.5, 0.9);
        if (random() > sample.grassDensity * cluster * 0.2) continue;
        const surfaceScale = sample.surface === 'deepRough' ? 1.18
          : sample.surface === 'rough' || sample.surface === 'bank' ? 0.82 : 0.34;
        candidates.push({
          x: worldX - chunk.centerX,
          z: worldZ - chunk.centerZ,
          height: sample.height + 0.025,
          scale: surfaceScale * (0.62 + random() * 0.76),
          angle: random() * Math.PI,
        });
      }
    }

    const mesh = new THREE.InstancedMesh(this.geometry, this.material, candidates.length);
    mesh.name = `live-grass-${chunk.key}`;
    mesh.position.set(chunk.centerX, 0, chunk.centerZ);
    const transform = new THREE.Object3D();
    candidates.forEach((candidate, index) => {
      transform.position.set(candidate.x, candidate.height, candidate.z);
      transform.rotation.set(0, candidate.angle, 0);
      transform.scale.set(candidate.scale, candidate.scale, candidate.scale);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.meshes.set(chunk.key, mesh);
    this.root.add(mesh);
  }

  deactivateChunk(key: string): void {
    const mesh = this.meshes.get(key);
    if (!mesh) return;
    mesh.removeFromParent();
    mesh.dispose();
    this.meshes.delete(key);
  }

  get count(): number {
    return this.meshes.size;
  }
}

function createWaterStrokes(): THREE.LineSegments {
  const points: THREE.Vector3[] = [];
  const random = mulberry32(9214);
  for (let z = -104; z <= 104; z += 2.35) {
    let runStart: number | null = null;
    for (let x = -65; x <= 65.25; x += 0.5) {
      const sample = sampleCourse(x, z);
      const isWater = sample.surface === 'water';
      if (isWater && runStart === null) runStart = x;
      if ((!isWater || x >= 65) && runStart !== null) {
        const runEnd = isWater ? x : x - 0.5;
        if (runEnd - runStart > 1.2 && random() > 0.32) {
          const y = POND_WATER_LEVEL + 0.035;
          let cursor = runStart + random() * 0.8;
          while (cursor < runEnd - 0.65) {
            const segmentEnd = Math.min(runEnd - random() * 0.35, cursor + 0.75 + random() * 1.2);
            if (segmentEnd - cursor > 0.58) {
              points.push(new THREE.Vector3(cursor, y, z), new THREE.Vector3(segmentEnd, y, z));
            }
            cursor = segmentEnd + 0.65 + random() * 1.55;
          }
        }
        runStart = null;
      }
    }
  }
  return new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: ART_PALETTE.graphiteSoft,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    }),
  );
}

function createWaterSurface(): {
  mesh: THREE.Mesh<THREE.ShapeGeometry, THREE.ShaderMaterial>;
  material: THREE.ShaderMaterial;
} {
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
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMotion: { value: 1 },
      uWater: { value: new THREE.Color(ART_PALETTE.water) },
    },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform float uMotion;
      uniform vec3 uWater;
      varying vec3 vWorldPosition;

      float hash21(vec2 point) {
        point = fract(point * vec2(123.34, 456.21));
        point += dot(point, point + 45.32);
        return fract(point.x * point.y);
      }

      void main() {
        vec2 world = vWorldPosition.xz;
        float drift = sin(world.x * 0.075 + world.y * 0.031 + uTime * 0.055 * uMotion);
        vec3 color = uWater;
        color += drift * 0.005;
        float granulation = hash21(floor(world * 3.2));
        color += (granulation - 0.5) * 0.007;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'quiet-water-surface';
  mesh.position.y = POND_WATER_LEVEL + 0.012;
  return { mesh, material };
}

function linePointsForBoundary(loop: CourseBoundaryLoop): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const skipEvery = loop.surface === 'water' ? 5
    : loop.surface === 'fairway' ? 8
      : loop.surface === 'green' ? 17
        : loop.surface === 'tee' ? 13
          : loop.surface === 'bunker' ? 14 : 0;
  const center = loop.points.reduce(
    (sum, point) => ({
      x: sum.x + point.x / loop.points.length,
      z: sum.z + point.z / loop.points.length,
    }),
    { x: 0, z: 0 },
  );
  loop.points.forEach((point, index) => {
    const next = loop.points[(index + 1) % loop.points.length]!;
    if (skipEvery > 0 && index % skipEvery === skipEvery - 1) return;
    const midpointX = (point.x + next.x) * 0.5;
    const midpointZ = (point.z + next.z) * 0.5;
    const inwardX = center.x - midpointX;
    const inwardZ = center.z - midpointZ;
    const inwardScale = 0.24 / Math.max(0.001, Math.hypot(inwardX, inwardZ));
    const visibleSurface = sampleCourse(
      midpointX + inwardX * inwardScale,
      midpointZ + inwardZ * inwardScale,
    ).surface;
    // Higher-precedence semantic regions occlude lower ones. This clips the
    // green/fairway outline where a bunker sits on top instead of drawing
    // independent Venn-diagram loops through each other.
    if (visibleSurface !== loop.surface) return;
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
    for (let index = 0; index < loop.points.length; index += 1) {
      const point = loop.points[index]!;
      const next = loop.points[(index + 1) % loop.points.length]!;
      const radialX = point.x - center.x;
      const radialZ = point.z - center.z;
      const inverseLength = 1 / Math.max(0.001, Math.hypot(radialX, radialZ));
      const directionX = radialX * inverseLength;
      const directionZ = radialZ * inverseLength;
      const shadeSide = directionX * ILLUSTRATION_LIGHT.direction[0]
        + directionZ * ILLUSTRATION_LIGHT.direction[2];
      if (shadeSide > -0.18) continue;

      // A broken inner contour carries most of the lip value on the shadowed
      // side; sparse short ticks describe the cut without an eyelash ring.
      if (index % 9 !== 7) {
        const nextRadialX = next.x - center.x;
        const nextRadialZ = next.z - center.z;
        const nextInverseLength = 1 / Math.max(0.001, Math.hypot(nextRadialX, nextRadialZ));
        const innerX = point.x - directionX * 0.24;
        const innerZ = point.z - directionZ * 0.24;
        const nextInnerX = next.x - nextRadialX * nextInverseLength * 0.24;
        const nextInnerZ = next.z - nextRadialZ * nextInverseLength * 0.24;
        points.push(
          new THREE.Vector3(innerX, sampleCourse(innerX, innerZ).height + 0.072, innerZ),
          new THREE.Vector3(nextInnerX, sampleCourse(nextInnerX, nextInnerZ).height + 0.072, nextInnerZ),
        );
      }
      if (index % 4 !== 0) continue;
      const length = 0.3 + (Math.sin(index * 1.73) * 0.5 + 0.5) * 0.34;
      const insideX = point.x - directionX * length;
      const insideZ = point.z - directionZ * length;
      points.push(
        new THREE.Vector3(insideX, sampleCourse(insideX, insideZ).height + 0.074, insideZ),
        new THREE.Vector3(point.x, sampleCourse(point.x, point.z).height + 0.074, point.z),
      );
    }
  }
  const lips = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: ART_PALETTE.graphite,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    }),
  );
  lips.name = 'bunker-lip-hatching';
  return lips;
}

function createBunkerRakeDrawing(): THREE.LineSegments {
  const points: THREE.Vector3[] = [];
  for (const [bunkerIndex, bunker] of BUNKERS.entries()) {
    const random = mulberry32(7619 + bunkerIndex * 1907);
    let accepted = 0;
    for (let attempt = 0; attempt < 360 && accepted < 30; attempt += 1) {
      const centerX = bunker.centerX + (random() - 0.5) * bunker.radiusX * 1.55;
      const centerZ = bunker.centerZ + (random() - 0.5) * bunker.radiusZ * 1.55;
      if (sampleCourse(centerX, centerZ).surface !== 'bunker') continue;
      const angle = 0.38 + Math.sin(centerZ * 0.19) * 0.1 + (random() - 0.5) * 0.13;
      const length = 0.62 + random() * 1.15;
      const halfX = Math.cos(angle) * length * 0.5;
      const halfZ = Math.sin(angle) * length * 0.5;
      const startX = centerX - halfX;
      const startZ = centerZ - halfZ;
      const endX = centerX + halfX;
      const endZ = centerZ + halfZ;
      if (sampleCourse(startX, startZ).surface !== 'bunker'
          || sampleCourse(endX, endZ).surface !== 'bunker') continue;
      points.push(
        new THREE.Vector3(startX, sampleCourse(startX, startZ).height + 0.068, startZ),
        new THREE.Vector3(endX, sampleCourse(endX, endZ).height + 0.068, endZ),
      );
      accepted += 1;
    }
  }

  const rakes = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: ART_PALETTE.graphiteSoft,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    }),
  );
  rakes.name = 'bunker-directional-rake-drawing';
  return rakes;
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
        if (gate < 5) continue;
        if (intersections.length === 2) points.push(intersections[0]!, intersections[1]!);
        else if (intersections.length === 4) {
          points.push(intersections[0]!, intersections[1]!, intersections[2]!, intersections[3]!);
        }
      }
    }
  }

  const contours = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: ART_PALETTE.graphiteSoft,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
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
      ? 0.72
      : loop.surface === 'water'
        ? 0.58
        : 0.52;
    const line = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(linePointsForBoundary(loop)),
      new THREE.LineBasicMaterial({
        color: loop.surface === 'bunker' ? ART_PALETTE.graphite : ART_PALETTE.graphiteSoft,
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
    color: ART_PALETTE.graphiteSoft,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const topMaterial = new THREE.LineBasicMaterial({
    color: ART_PALETTE.graphite,
    transparent: true,
    opacity: 0.64,
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
    new THREE.LineBasicMaterial({
      color: ART_PALETTE.graphiteSoft,
      transparent: true,
      opacity: 0.42,
    }),
  ));
  return group;
}

function createRockClusters(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'code-generated-rocks';
  const random = mulberry32(33491);
  const material = new THREE.MeshLambertMaterial({ color: ART_PALETTE.bank, flatShading: true });
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: ART_PALETTE.graphiteSoft,
    transparent: true,
    opacity: 0.55,
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
      rock.castShadow = true;
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
    new THREE.LineBasicMaterial({
      color: ART_PALETTE.graphiteSoft,
      transparent: true,
      opacity: 0.62,
    }),
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
    new THREE.LineBasicMaterial({
      color: ART_PALETTE.graphiteSoft,
      transparent: true,
      opacity: 0.58,
    }),
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
    new THREE.LineBasicMaterial({
      color: ART_PALETTE.graphiteSoft,
      transparent: true,
      opacity: 0.3,
    }),
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
  private readonly reactiveSurface = new ReactiveSurface();
  private readonly grassLayer = new GrassChunkLayer(this.reactiveSurface);
  private readonly grassMaterial: THREE.ShaderMaterial;
  private readonly waterMaterial: THREE.ShaderMaterial;
  private readonly ballVisuals = new Map<string, THREE.Group>();
  private primaryBallId = 'primary-ball';
  private reducedMotion = false;
  private ballScale = 1;
  private environment: EnvironmentSample = sampleEnvironment(0);

  constructor(streamer: PropertyChunkStreamer) {
    this.root.name = 'illustrated-course';
    this.root.add(this.terrainLayer.root);
    streamer.register(this.terrainLayer);

    this.grassMaterial = this.grassLayer.material;
    this.root.add(this.grassLayer.root);
    streamer.register(this.grassLayer);
    const water = createWaterSurface();
    this.waterMaterial = water.material;
    this.root.add(water.mesh);
    this.root.add(createWaterStrokes());
    this.root.add(createSemanticBoundaries());
    this.root.add(createBunkerLipDrawing());
    this.root.add(createBunkerRakeDrawing());
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
    this.golfer.scale.setScalar(1.15);
    this.root.add(this.golfer);

    this.positionGrounded(this.cart, 5.8, -64.5);
    this.cart.rotation.y = -0.08;
    this.cart.scale.setScalar(0.98);
    this.root.add(this.cart);

    this.positionGrounded(this.flag, 1.8, 65.5);
    this.root.add(this.flag);

    this.positionGrounded(this.ball, 0.42, -60.9);
    this.root.add(this.ball);
  }

  update(elapsed: number, delta: number): void {
    const visualTime = this.reducedMotion ? 0 : elapsed;
    this.environment = sampleEnvironment(elapsed);
    // Essential locomotion and swing language must remain legible in reduced motion.
    this.golfer.update(elapsed);
    this.flag.update(visualTime, this.environment.windX, this.environment.windZ);
    this.grassMaterial.uniforms.uTime!.value = visualTime;
    this.waterMaterial.uniforms.uTime!.value = visualTime;
    this.waterMaterial.uniforms.uMotion!.value = this.reducedMotion ? 0 : 1;
    const windLength = Math.max(0.001, Math.hypot(this.environment.windX, this.environment.windZ));
    (this.grassMaterial.uniforms.uWind!.value as THREE.Vector3).set(
      this.environment.windX / windLength,
      this.environment.windZ / windLength,
      0.65 + this.environment.intensity * 1.4,
    );
    this.ambientLife.update(elapsed, delta, this.environment, this.reducedMotion);
    this.reactiveSurface.update(delta);
    this.marks.update(delta);
  }

  setBallPosition(position: THREE.Vector3, moving: boolean): void {
    this.updateBallVisual(this.primaryBallId, this.ball, position, moving, true);
  }

  bindPrimaryBall(id: string): void {
    this.primaryBallId = id;
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
    this.updateBallVisual(id, visual, position, moving, trace);
    visual.visible = visible;
    const ballMesh = visual.children[0];
    if (ballMesh) ballMesh.quaternion.copy(orientation);
  }

  removeBallVisual(id: string): void {
    const visual = this.ballVisuals.get(id);
    if (!visual || visual === this.ball) return;
    visual.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
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

  handleWorldEvent(event: WorldEvent): void {
    this.reactiveSurface.handle(event);
    this.ambientLife.handleWorldEvent(event);
  }

  private updateBallVisual(
    id: string,
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
    if (trace) this.marks.updateTrail(id, position, moving);
  }

  addImpact(kind: MarkKind, position: THREE.Vector3): void {
    this.marks.addImpact(kind, position);
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
    this.reactiveSurface.clear();
  }

  private positionGrounded(object: THREE.Object3D, x: number, z: number): void {
    object.position.set(x, propertyField.heightAt(x, z), z);
  }

  get streamedChunkCount(): number {
    return this.terrainLayer.count;
  }

  get streamedGrassChunkCount(): number {
    return this.grassLayer.count;
  }

  get activeSurfaceInteractionCount(): number {
    return this.reactiveSurface.activeCount;
  }
}
