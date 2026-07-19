import { propertyField } from '../world/property-field';
import type { CourseSurface } from '../world/course';

export interface TraversalPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface TraversalPhysics {
  moveKinematicAgent(id: string, delta: TraversalPosition): TraversalPosition & {
    readonly grounded: boolean;
    readonly collisions: number;
  };
  teleportKinematicAgent(id: string, position: TraversalPosition): void;
}

export interface GolferTraversalResult extends TraversalPosition {
  readonly heading: number;
  readonly speed: number;
  readonly surface: CourseSurface;
  readonly slopeRadians: number;
  readonly grounded: boolean;
  readonly blocked: boolean;
  readonly leftFootHeight: number;
  readonly rightFootHeight: number;
}

export type LocomotionEvent = 'footstep-left' | 'footstep-right';

const MAX_WALKABLE_SLOPE = Math.PI * 0.235;
const STEERING_ANGLES = [0, 0.34, -0.34, 0.68, -0.68] as const;

const SURFACE_SPEED: Readonly<Record<CourseSurface, number>> = Object.freeze({
  tee: 1,
  fairway: 1,
  green: 0.96,
  rough: 0.84,
  deepRough: 0.67,
  bunker: 0.56,
  water: 0,
  bank: 0.68,
  cliff: 0,
});

function shortestAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function rotate(x: number, z: number, angle: number): Readonly<{ x: number; z: number }> {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: x * cosine - z * sine, z: x * sine + z * cosine };
}

function desiredSpeed(distance: number): number {
  if (distance < 0.7) return 0;
  if (distance < 3) return 1.25;
  if (distance < 11) return 3.15;
  return 4.8;
}

export class GolferController {
  readonly agentId = 'golfer';
  private currentSpeed = 0;
  private stridePhase = 0;
  private previousStrideHalf = 0;

  constructor(
    private readonly physics: TraversalPhysics,
    private readonly onEvent?: (event: LocomotionEvent, surface: CourseSurface) => void,
  ) {}

  teleport(position: TraversalPosition): void {
    this.currentSpeed = 0;
    this.physics.teleportKinematicAgent(this.agentId, position);
  }

  step(
    position: TraversalPosition,
    heading: number,
    target: Readonly<{ x: number; z: number }> | null,
    delta: number,
  ): GolferTraversalResult {
    const sample = propertyField.sample(position.x, position.z);
    if (!target || delta <= 0) return this.stationary(position, heading, sample.surface);

    const toTargetX = target.x - position.x;
    const toTargetZ = target.z - position.z;
    const distance = Math.hypot(toTargetX, toTargetZ);
    const intendedSpeed = desiredSpeed(distance) * SURFACE_SPEED[sample.surface];
    const acceleration = intendedSpeed > this.currentSpeed ? 7.5 : 11;
    const speedDelta = acceleration * delta;
    this.currentSpeed += Math.max(-speedDelta, Math.min(speedDelta, intendedSpeed - this.currentSpeed));

    if (this.currentSpeed < 0.04 || distance < 1e-5) {
      return this.stationary(position, heading, sample.surface);
    }

    const directionX = toTargetX / distance;
    const directionZ = toTargetZ / distance;
    const stepLength = Math.min(distance, this.currentSpeed * delta);
    let chosen: Readonly<{ x: number; z: number }> | null = null;
    for (const angle of STEERING_ANGLES) {
      const direction = rotate(directionX, directionZ, angle);
      const x = position.x + direction.x * stepLength;
      const z = position.z + direction.z * stepLength;
      const candidate = propertyField.sample(x, z);
      const slope = Math.acos(Math.max(-1, Math.min(1, candidate.normal.y)));
      if (candidate.surface !== 'water'
          && candidate.surface !== 'cliff'
          && slope <= MAX_WALKABLE_SLOPE
          && propertyField.contains(x, z, 1.2)) {
        chosen = direction;
        break;
      }
    }

    if (!chosen) {
      this.currentSpeed = Math.max(0, this.currentSpeed - 14 * delta);
      return { ...this.stationary(position, heading, sample.surface), blocked: true };
    }

    const nextX = position.x + chosen.x * stepLength;
    const nextZ = position.z + chosen.z * stepLength;
    const nextHeight = propertyField.heightAt(nextX, nextZ);
    const moved = this.physics.moveKinematicAgent(this.agentId, {
      x: chosen.x * stepLength,
      y: nextHeight - position.y,
      z: chosen.z * stepLength,
    });
    const groundedY = propertyField.heightAt(moved.x, moved.z);
    const actualX = moved.x - position.x;
    const actualZ = moved.z - position.z;
    const actualDistance = Math.hypot(actualX, actualZ);
    const blocked = actualDistance < stepLength * 0.22 && stepLength > 0.001;
    if (blocked) this.currentSpeed *= 0.45;

    const desiredHeading = actualDistance > 1e-4 ? Math.atan2(actualX, actualZ) : heading;
    const nextHeading = heading
      + shortestAngle(heading, desiredHeading) * Math.min(1, delta * 8.5);
    const nextSample = propertyField.sample(moved.x, moved.z);
    const slopeRadians = Math.acos(Math.max(-1, Math.min(1, nextSample.normal.y)));
    this.advanceStride(actualDistance, nextSample.surface);
    const feet = this.sampleFeet(moved.x, moved.z, nextHeading);

    return {
      x: moved.x,
      y: groundedY,
      z: moved.z,
      heading: nextHeading,
      speed: delta > 0 ? actualDistance / delta : 0,
      surface: nextSample.surface,
      slopeRadians,
      grounded: moved.grounded || Math.abs(moved.y - groundedY) < 0.08,
      blocked,
      ...feet,
    };
  }

  private stationary(
    position: TraversalPosition,
    heading: number,
    surface: CourseSurface,
  ): GolferTraversalResult {
    this.currentSpeed = Math.max(0, this.currentSpeed - 0.25);
    const sample = propertyField.sample(position.x, position.z);
    return {
      ...position,
      heading,
      speed: 0,
      surface,
      slopeRadians: Math.acos(Math.max(-1, Math.min(1, sample.normal.y))),
      grounded: true,
      blocked: false,
      ...this.sampleFeet(position.x, position.z, heading),
    };
  }

  private sampleFeet(x: number, z: number, heading: number): {
    leftFootHeight: number;
    rightFootHeight: number;
  } {
    const sideX = Math.cos(heading) * 0.13;
    const sideZ = -Math.sin(heading) * 0.13;
    return {
      leftFootHeight: propertyField.heightAt(x - sideX, z - sideZ),
      rightFootHeight: propertyField.heightAt(x + sideX, z + sideZ),
    };
  }

  private advanceStride(distance: number, surface: CourseSurface): void {
    this.stridePhase = (this.stridePhase + distance / 1.35) % 1;
    const strideHalf = Math.floor(this.stridePhase * 2);
    if (strideHalf === this.previousStrideHalf) return;
    this.previousStrideHalf = strideHalf;
    this.onEvent?.(strideHalf === 0 ? 'footstep-left' : 'footstep-right', surface);
  }
}
