import { sampleCourse, type CourseSample, type CourseSurface } from './course';
import { PROPERTY_BLUEPRINT, type PropertyBounds } from './property-blueprint';

const NORMAL_OFFSET = 0.2;
const COURSE_CORE_HALF_WIDTH = 100;
const COURSE_CORE_HALF_DEPTH = 122;
const COURSE_BLEND_BAND = 24;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function openGroundHeight(x: number, z: number): number {
  const longRise = z * 0.0018;
  const broad = Math.sin(x * 0.018 + z * 0.006) * 0.42;
  const crossing = Math.sin(z * 0.014 - x * 0.009 + 0.8) * 0.3;
  const small = Math.sin(x * 0.043 + z * 0.031) * 0.08;
  return longRise + broad + crossing + small;
}

function coreWeight(x: number, z: number): number {
  const outsideX = Math.max(0, Math.abs(x) - COURSE_CORE_HALF_WIDTH);
  const outsideZ = Math.max(0, Math.abs(z) - COURSE_CORE_HALF_DEPTH);
  const outside = Math.hypot(outsideX, outsideZ);
  return 1 - smoothstep(0, COURSE_BLEND_BAND, outside);
}

function distanceToInsideEdge(x: number, z: number, bounds: PropertyBounds): number {
  return Math.min(x - bounds.minX, bounds.maxX - x, z - bounds.minZ, bounds.maxZ - z);
}

function rawHeight(x: number, z: number): number {
  const bounds = PROPERTY_BLUEPRINT.bounds;
  const clampedX = clamp(x, bounds.minX, bounds.maxX);
  const clampedZ = clamp(z, bounds.minZ, bounds.maxZ);
  const course = sampleCourse(clampedX, clampedZ);
  const weight = coreWeight(clampedX, clampedZ);
  let height = mix(openGroundHeight(clampedX, clampedZ), course.height, weight);

  const edgeDistance = distanceToInsideEdge(clampedX, clampedZ, bounds);
  const boundaryAmount = 1 - smoothstep(0, PROPERTY_BLUEPRINT.boundaryBand, edgeDistance);
  height += boundaryAmount * boundaryAmount * 4.8;

  if (x !== clampedX || z !== clampedZ) {
    const outsideDistance = Math.hypot(x - clampedX, z - clampedZ);
    height += Math.min(12, outsideDistance * 1.8);
  }
  return height;
}

function surfaceAt(x: number, z: number): CourseSurface {
  const bounds = PROPERTY_BLUEPRINT.bounds;
  const edgeDistance = distanceToInsideEdge(x, z, bounds);
  if (edgeDistance < 0) return 'cliff';
  if (edgeDistance < 3.5) return 'cliff';
  if (edgeDistance < PROPERTY_BLUEPRINT.boundaryBand) return 'bank';
  if (coreWeight(x, z) > 0.5) return sampleCourse(x, z).surface;

  const pathNoise = Math.sin(x * 0.021 - z * 0.013) + Math.sin(z * 0.008 + 1.2) * 0.45;
  return pathNoise > 1.13 ? 'rough' : 'deepRough';
}

function surfacePhysics(surface: CourseSurface): Pick<CourseSample, 'friction' | 'restitution' | 'grassDensity'> {
  switch (surface) {
    case 'tee': return { friction: 0.1, restitution: 0.38, grassDensity: 0.04 };
    case 'fairway': return { friction: 0.11, restitution: 0.36, grassDensity: 0.08 };
    case 'green': return { friction: 0.052, restitution: 0.3, grassDensity: 0.015 };
    case 'rough': return { friction: 0.25, restitution: 0.22, grassDensity: 0.4 };
    case 'deepRough': return { friction: 0.42, restitution: 0.15, grassDensity: 0.68 };
    case 'bunker': return { friction: 0.66, restitution: 0.075, grassDensity: 0 };
    case 'water': return { friction: 0.95, restitution: 0, grassDensity: 0 };
    case 'bank': return { friction: 0.31, restitution: 0.19, grassDensity: 0.52 };
    case 'cliff': return { friction: 0.18, restitution: 0.24, grassDensity: 0.06 };
  }
}

export interface PropertyField {
  readonly bounds: PropertyBounds;
  contains(x: number, z: number, margin?: number): boolean;
  clampPosition(x: number, z: number, margin?: number): Readonly<{ x: number; z: number }>;
  heightAt(x: number, z: number): number;
  sample(x: number, z: number): CourseSample;
}

export const propertyField: PropertyField = Object.freeze({
  bounds: PROPERTY_BLUEPRINT.bounds,

  contains(x: number, z: number, margin = 0): boolean {
    const bounds = PROPERTY_BLUEPRINT.bounds;
    return x >= bounds.minX + margin && x <= bounds.maxX - margin
      && z >= bounds.minZ + margin && z <= bounds.maxZ - margin;
  },

  clampPosition(x: number, z: number, margin = 0): Readonly<{ x: number; z: number }> {
    const bounds = PROPERTY_BLUEPRINT.bounds;
    return {
      x: clamp(x, bounds.minX + margin, bounds.maxX - margin),
      z: clamp(z, bounds.minZ + margin, bounds.maxZ - margin),
    };
  },

  heightAt(x: number, z: number): number {
    return rawHeight(x, z);
  },

  sample(x: number, z: number): CourseSample {
    const height = rawHeight(x, z);
    const dx = (rawHeight(x + NORMAL_OFFSET, z) - rawHeight(x - NORMAL_OFFSET, z)) / (NORMAL_OFFSET * 2);
    const dz = (rawHeight(x, z + NORMAL_OFFSET) - rawHeight(x, z - NORMAL_OFFSET)) / (NORMAL_OFFSET * 2);
    const inverseLength = 1 / Math.hypot(dx, 1, dz);
    const surface = surfaceAt(x, z);
    const physics = surfacePhysics(surface);
    const courseSample = coreWeight(x, z) > 0.5 ? sampleCourse(x, z) : undefined;
    return {
      height,
      normal: { x: -dx * inverseLength, y: inverseLength, z: -dz * inverseLength },
      surface,
      friction: physics.friction,
      restitution: physics.restitution,
      grassDensity: physics.grassDensity,
      waterDepth: surface === 'water' ? courseSample?.waterDepth ?? 0 : 0,
    };
  },
});

