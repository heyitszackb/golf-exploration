/**
 * Analytic Milestone 1 course field.
 *
 * Coordinates are metres in an X/Z ground plane with Y up. The hole runs from
 * the tee in the south (negative Z) to the green in the north (positive Z).
 * Rendering geometry, semantic boundary lines, and ball queries should all use
 * this module so the drawn course and the physical course remain coincident.
 */

export type CourseSurface =
  | "tee"
  | "fairway"
  | "green"
  | "rough"
  | "deepRough"
  | "bunker"
  | "water"
  | "bank"
  | "cliff";

export interface CoursePoint2 {
  readonly x: number;
  readonly z: number;
}

export interface CourseNormal {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CourseSample {
  /** Elevation of the terrain bed. In water, height + waterDepth is the surface. */
  readonly height: number;
  readonly normal: CourseNormal;
  readonly surface: CourseSurface;
  /** Rolling resistance used by the prototype ball solver. */
  readonly friction: number;
  /** Normal-velocity multiplier used at ball impact. */
  readonly restitution: number;
  readonly waterDepth: number;
  /** 0..1 placement density, not visual opacity. */
  readonly grassDensity: number;
}

export interface CourseBoundaryLoop {
  readonly id: string;
  readonly surface: CourseSurface;
  /** A logically closed loop. The first point is not duplicated at the end. */
  readonly points: readonly CoursePoint2[];
}

interface OrganicHarmonic {
  readonly frequency: number;
  readonly amplitude: number;
  readonly phase: number;
}

export interface OrganicRegion {
  readonly id: string;
  readonly centerX: number;
  readonly centerZ: number;
  readonly radiusX: number;
  readonly radiusZ: number;
  readonly harmonics: readonly OrganicHarmonic[];
}

interface SurfacePhysics {
  readonly friction: number;
  readonly restitution: number;
  readonly grassDensity: number;
}

export const COURSE_BOUNDS = Object.freeze({
  minX: -58,
  maxX: 58,
  minZ: -84,
  maxZ: 82,
});

export const FAIRWAY_Z_MIN = -63;
export const FAIRWAY_Z_MAX = 54;
export const POND_WATER_LEVEL = 0.14;

export const GREEN: OrganicRegion = Object.freeze({
  id: "green",
  centerX: -1.5,
  centerZ: 64,
  radiusX: 12.2,
  radiusZ: 9.7,
  harmonics: Object.freeze([
    { frequency: 2, amplitude: 0.075, phase: 0.65 },
    { frequency: 3, amplitude: -0.045, phase: -0.35 },
  ]),
});

export const TEE: OrganicRegion = Object.freeze({
  id: "tee",
  centerX: 1.2,
  centerZ: -70.4,
  radiusX: 7.4,
  radiusZ: 4.8,
  harmonics: Object.freeze([
    { frequency: 2, amplitude: 0.025, phase: 0.2 },
    { frequency: 4, amplitude: 0.018, phase: 1.1 },
  ]),
});

export const POND: OrganicRegion = Object.freeze({
  id: "pond",
  centerX: -28.2,
  centerZ: 3.5,
  radiusX: 18.5,
  radiusZ: 30.5,
  harmonics: Object.freeze([
    { frequency: 2, amplitude: 0.065, phase: -0.7 },
    { frequency: 3, amplitude: 0.085, phase: 0.55 },
    { frequency: 5, amplitude: 0.028, phase: -1.4 },
  ]),
});

export const BUNKERS: readonly OrganicRegion[] = Object.freeze([
  Object.freeze({
    id: "bunker-fairway-west",
    centerX: -14.1,
    centerZ: -18.5,
    radiusX: 4.8,
    radiusZ: 8.1,
    harmonics: Object.freeze([
      { frequency: 2, amplitude: 0.09, phase: 0.8 },
      { frequency: 3, amplitude: 0.055, phase: -0.4 },
    ]),
  }),
  Object.freeze({
    id: "bunker-fairway-east",
    centerX: 14.5,
    centerZ: 18.5,
    radiusX: 5.2,
    radiusZ: 7.1,
    harmonics: Object.freeze([
      { frequency: 2, amplitude: -0.08, phase: 0.2 },
      { frequency: 4, amplitude: 0.045, phase: 1.25 },
    ]),
  }),
  Object.freeze({
    id: "bunker-green-front",
    centerX: -11.7,
    centerZ: 53.9,
    radiusX: 5.7,
    radiusZ: 4.5,
    harmonics: Object.freeze([
      { frequency: 2, amplitude: 0.1, phase: -0.9 },
      { frequency: 3, amplitude: 0.04, phase: 0.35 },
    ]),
  }),
  Object.freeze({
    id: "bunker-green-east",
    centerX: 10.1,
    centerZ: 66.5,
    radiusX: 4.6,
    radiusZ: 6.4,
    harmonics: Object.freeze([
      { frequency: 2, amplitude: -0.075, phase: 0.4 },
      { frequency: 5, amplitude: 0.035, phase: -0.5 },
    ]),
  }),
]);

export const SURFACE_PHYSICS: Readonly<Record<CourseSurface, SurfacePhysics>> =
  Object.freeze({
    tee: Object.freeze({ friction: 0.1, restitution: 0.38, grassDensity: 0.04 }),
    fairway: Object.freeze({ friction: 0.11, restitution: 0.36, grassDensity: 0.08 }),
    green: Object.freeze({ friction: 0.052, restitution: 0.3, grassDensity: 0.015 }),
    rough: Object.freeze({ friction: 0.25, restitution: 0.22, grassDensity: 0.4 }),
    deepRough: Object.freeze({ friction: 0.42, restitution: 0.15, grassDensity: 0.68 }),
    bunker: Object.freeze({ friction: 0.66, restitution: 0.075, grassDensity: 0 }),
    water: Object.freeze({ friction: 0.95, restitution: 0, grassDensity: 0 }),
    bank: Object.freeze({ friction: 0.31, restitution: 0.19, grassDensity: 0.52 }),
    cliff: Object.freeze({ friction: 0.18, restitution: 0.24, grassDensity: 0.06 }),
  });

const FAIRWAY_CENTER_KNOTS: readonly CoursePoint2[] = Object.freeze([
  { x: 1.2, z: FAIRWAY_Z_MIN },
  { x: -3.8, z: -43 },
  { x: 2.8, z: -17 },
  { x: 0.3, z: 8 },
  { x: 5.2, z: 31 },
  { x: -1.5, z: FAIRWAY_Z_MAX },
]);

const FAIRWAY_WIDTH_KNOTS: readonly CoursePoint2[] = Object.freeze([
  { x: 6.7, z: FAIRWAY_Z_MIN },
  { x: 9.8, z: -43 },
  { x: 12.1, z: -17 },
  { x: 11.6, z: 8 },
  { x: 10.3, z: 31 },
  { x: 7.8, z: FAIRWAY_Z_MAX },
]);

const NORMAL_SAMPLE_OFFSET = 0.18;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function interpolateKnots(knots: readonly CoursePoint2[], z: number): number {
  if (z <= knots[0]!.z) return knots[0]!.x;

  const last = knots[knots.length - 1]!;
  if (z >= last.z) return last.x;

  for (let index = 0; index < knots.length - 1; index += 1) {
    const from = knots[index]!;
    const to = knots[index + 1]!;
    if (z <= to.z) {
      const t = smoothstep(from.z, to.z, z);
      return lerp(from.x, to.x, t);
    }
  }

  return last.x;
}

/** Fairway center X at a given world Z. Values outside the hole clamp to an end. */
export function fairwayCenterX(z: number): number {
  return interpolateKnots(FAIRWAY_CENTER_KNOTS, z);
}

/** Fairway half-width in metres at a given world Z. */
export function fairwayHalfWidth(z: number): number {
  return interpolateKnots(FAIRWAY_WIDTH_KNOTS, z);
}

function organicRadiusScale(region: OrganicRegion, theta: number): number {
  let scale = 1;
  for (const harmonic of region.harmonics) {
    scale += harmonic.amplitude * Math.sin(harmonic.frequency * theta + harmonic.phase);
  }
  return scale;
}

function organicNormalizedRadius(region: OrganicRegion, x: number, z: number): number {
  const nx = (x - region.centerX) / region.radiusX;
  const nz = (z - region.centerZ) / region.radiusZ;
  const theta = Math.atan2(nz, nx);
  return Math.hypot(nx, nz) / organicRadiusScale(region, theta);
}

function organicSignedDistance(region: OrganicRegion, x: number, z: number): number {
  return (organicNormalizedRadius(region, x, z) - 1) * Math.min(region.radiusX, region.radiusZ);
}

/** Negative inside the fairway, positive outside. */
export function fairwaySignedDistance(x: number, z: number): number {
  if (z < FAIRWAY_Z_MIN) {
    return Math.hypot(x - fairwayCenterX(FAIRWAY_Z_MIN), z - FAIRWAY_Z_MIN) -
      fairwayHalfWidth(FAIRWAY_Z_MIN);
  }
  if (z > FAIRWAY_Z_MAX) {
    return Math.hypot(x - fairwayCenterX(FAIRWAY_Z_MAX), z - FAIRWAY_Z_MAX) -
      fairwayHalfWidth(FAIRWAY_Z_MAX);
  }
  return Math.abs(x - fairwayCenterX(z)) - fairwayHalfWidth(z);
}

export function greenSignedDistance(x: number, z: number): number {
  return organicSignedDistance(GREEN, x, z);
}

export function teeSignedDistance(x: number, z: number): number {
  return organicSignedDistance(TEE, x, z);
}

export function pondSignedDistance(x: number, z: number): number {
  return organicSignedDistance(POND, x, z);
}

export function bunkerSignedDistance(bunker: OrganicRegion, x: number, z: number): number {
  return organicSignedDistance(bunker, x, z);
}

/** The irregular foot of the raised eastern bank. */
export function rightBankEdgeX(z: number): number {
  return 39.5 + 2.2 * Math.sin((z + 12) * 0.027) + 0.9 * Math.sin((z - 9) * 0.073);
}

function gaussian(
  x: number,
  z: number,
  centerX: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
): number {
  const dx = (x - centerX) / radiusX;
  const dz = (z - centerZ) / radiusZ;
  return Math.exp(-0.5 * (dx * dx + dz * dz));
}

function terrainBeforePond(x: number, z: number): number {
  const gradualRise = 0.0115 * (z + 72);
  const westernShoulder = 0.82 * gaussian(x, z, -15, -29, 27, 34);
  const centralSwale = -1.02 * gaussian(x, z, 2, 8, 17, 25);
  const northernShoulder = 0.58 * gaussian(x, z, 14, 39, 24, 29);
  const greenCrown = 0.38 * gaussian(x, z, GREEN.centerX - 1, GREEN.centerZ + 1, 11, 10);
  const greenRunoff = -0.23 * gaussian(x, z, GREEN.centerX + 8, GREEN.centerZ - 9, 10, 8);
  const longUndulation = 0.13 * Math.sin(x * 0.052 + z * 0.019);
  const crossUndulation = 0.08 * Math.sin(z * 0.063 - x * 0.026 + 0.7);

  const bankStart = rightBankEdgeX(z) - 1.1;
  const bankTop = bankStart + 6.4;
  const bankRise = 5.4 * smoothstep(bankStart, bankTop, x);

  return gradualRise + westernShoulder + centralSwale + northernShoulder +
    greenCrown + greenRunoff + longUndulation + crossUndulation + bankRise;
}

/**
 * Terrain-bed elevation. The pond is a carved basin; use sampleCourse().waterDepth
 * (or POND_WATER_LEVEL) to place its live water surface.
 */
export function courseHeightAt(x: number, z: number): number {
  const landHeight = terrainBeforePond(x, z);
  const pondRadius = organicNormalizedRadius(POND, x, z);

  if (pondRadius <= 1) {
    const inward = clamp((1 - pondRadius) / 0.78, 0, 1);
    const depth = 2.15 * smoothstep(0, 1, inward);
    return POND_WATER_LEVEL - depth;
  }

  // Pull a narrow shore apron to the water level so the analytic shoreline and
  // the water mesh meet without cracks, then ease back into the rolling terrain.
  if (pondRadius < 1.17) {
    return lerp(POND_WATER_LEVEL, landHeight, smoothstep(1, 1.17, pondRadius));
  }

  return landHeight;
}

function courseNormalAt(x: number, z: number): CourseNormal {
  const dx =
    (courseHeightAt(x + NORMAL_SAMPLE_OFFSET, z) -
      courseHeightAt(x - NORMAL_SAMPLE_OFFSET, z)) /
    (2 * NORMAL_SAMPLE_OFFSET);
  const dz =
    (courseHeightAt(x, z + NORMAL_SAMPLE_OFFSET) -
      courseHeightAt(x, z - NORMAL_SAMPLE_OFFSET)) /
    (2 * NORMAL_SAMPLE_OFFSET);
  const inverseLength = 1 / Math.hypot(dx, 1, dz);

  return {
    x: -dx * inverseLength,
    y: inverseLength,
    z: -dz * inverseLength,
  };
}

function containsAnyBunker(x: number, z: number): boolean {
  for (const bunker of BUNKERS) {
    if (bunkerSignedDistance(bunker, x, z) <= 0) return true;
  }
  return false;
}

export function courseSurfaceAt(x: number, z: number): CourseSurface {
  if (pondSignedDistance(x, z) <= 0) return "water";
  if (containsAnyBunker(x, z)) return "bunker";
  if (greenSignedDistance(x, z) <= 0) return "green";
  if (teeSignedDistance(x, z) <= 0) return "tee";
  if (fairwaySignedDistance(x, z) <= 0) return "fairway";

  const bankOffset = x - rightBankEdgeX(z);
  if (bankOffset >= -1.1 && bankOffset <= 5.5) return "cliff";
  if (bankOffset > 5.5) return "bank";

  const nearFairway = fairwaySignedDistance(x, z) <= 5.2;
  const nearGreen = greenSignedDistance(x, z) <= 4.1;
  const nearTee = teeSignedDistance(x, z) <= 2.8;
  return nearFairway || nearGreen || nearTee ? "rough" : "deepRough";
}

export function sampleCourse(x: number, z: number): CourseSample {
  const surface = courseSurfaceAt(x, z);
  const height = courseHeightAt(x, z);
  const physics = SURFACE_PHYSICS[surface];
  const waterDepth = surface === "water" ? Math.max(0, POND_WATER_LEVEL - height) : 0;

  return {
    height,
    normal: courseNormalAt(x, z),
    surface,
    friction: physics.friction,
    restitution: physics.restitution,
    waterDepth,
    grassDensity: physics.grassDensity,
  };
}

function normalizedSampleCount(sampleCount: number, minimum = 12): number {
  return Math.max(minimum, Math.floor(sampleCount));
}

export function sampleFairwayCenterline(sampleCount = 80): readonly CoursePoint2[] {
  const count = normalizedSampleCount(sampleCount, 2);
  const points: CoursePoint2[] = [];
  for (let index = 0; index < count; index += 1) {
    const z = lerp(FAIRWAY_Z_MIN, FAIRWAY_Z_MAX, index / (count - 1));
    points.push({ x: fairwayCenterX(z), z });
  }
  return points;
}

export function sampleFairwayBoundaryLoop(samplesPerSide = 80): readonly CoursePoint2[] {
  const sideCount = normalizedSampleCount(samplesPerSide, 8);
  const capCount = Math.max(6, Math.floor(sideCount * 0.16));
  const points: CoursePoint2[] = [];

  for (let index = 0; index < sideCount; index += 1) {
    const z = lerp(FAIRWAY_Z_MIN, FAIRWAY_Z_MAX, index / (sideCount - 1));
    points.push({ x: fairwayCenterX(z) - fairwayHalfWidth(z), z });
  }

  const northX = fairwayCenterX(FAIRWAY_Z_MAX);
  const northRadius = fairwayHalfWidth(FAIRWAY_Z_MAX);
  for (let index = 1; index <= capCount; index += 1) {
    const theta = Math.PI - (Math.PI * index) / capCount;
    points.push({
      x: northX + Math.cos(theta) * northRadius,
      z: FAIRWAY_Z_MAX + Math.sin(theta) * northRadius,
    });
  }

  for (let index = sideCount - 2; index >= 0; index -= 1) {
    const z = lerp(FAIRWAY_Z_MIN, FAIRWAY_Z_MAX, index / (sideCount - 1));
    points.push({ x: fairwayCenterX(z) + fairwayHalfWidth(z), z });
  }

  const southX = fairwayCenterX(FAIRWAY_Z_MIN);
  const southRadius = fairwayHalfWidth(FAIRWAY_Z_MIN);
  for (let index = 1; index < capCount; index += 1) {
    const theta = -(Math.PI * index) / capCount;
    points.push({
      x: southX + Math.cos(theta) * southRadius,
      z: FAIRWAY_Z_MIN + Math.sin(theta) * southRadius,
    });
  }

  return points;
}

function sampleOrganicBoundary(region: OrganicRegion, sampleCount: number): readonly CoursePoint2[] {
  const count = normalizedSampleCount(sampleCount);
  const points: CoursePoint2[] = [];
  for (let index = 0; index < count; index += 1) {
    const theta = (index / count) * Math.PI * 2;
    const scale = organicRadiusScale(region, theta);
    points.push({
      x: region.centerX + Math.cos(theta) * region.radiusX * scale,
      z: region.centerZ + Math.sin(theta) * region.radiusZ * scale,
    });
  }
  return points;
}

export function sampleGreenBoundaryLoop(sampleCount = 72): readonly CoursePoint2[] {
  return sampleOrganicBoundary(GREEN, sampleCount);
}

export function sampleTeeBoundaryLoop(sampleCount = 48): readonly CoursePoint2[] {
  return sampleOrganicBoundary(TEE, sampleCount);
}

export function samplePondBoundaryLoop(sampleCount = 112): readonly CoursePoint2[] {
  return sampleOrganicBoundary(POND, sampleCount);
}

export function sampleBunkerBoundaryLoops(sampleCount = 52): readonly CourseBoundaryLoop[] {
  return BUNKERS.map((bunker) => ({
    id: bunker.id,
    surface: "bunker" as const,
    points: sampleOrganicBoundary(bunker, sampleCount),
  }));
}

export function sampleRightBankEdge(sampleCount = 100): readonly CoursePoint2[] {
  const count = normalizedSampleCount(sampleCount, 2);
  const points: CoursePoint2[] = [];
  for (let index = 0; index < count; index += 1) {
    const z = lerp(COURSE_BOUNDS.minZ, COURSE_BOUNDS.maxZ, index / (count - 1));
    points.push({ x: rightBankEdgeX(z), z });
  }
  return points;
}

export function sampleCourseBoundaryLoops(samplesPerLoop = 80): readonly CourseBoundaryLoop[] {
  return [
    {
      id: "fairway",
      surface: "fairway",
      points: sampleFairwayBoundaryLoop(samplesPerLoop),
    },
    {
      id: GREEN.id,
      surface: "green",
      points: sampleGreenBoundaryLoop(samplesPerLoop),
    },
    ...sampleBunkerBoundaryLoops(samplesPerLoop),
    {
      id: POND.id,
      surface: "water",
      points: samplePondBoundaryLoop(samplesPerLoop),
    },
    {
      id: TEE.id,
      surface: "tee",
      points: sampleTeeBoundaryLoop(samplesPerLoop),
    },
  ];
}
