import { propertyField } from '../world/property-field';
import type { CourseSurface } from '../world/course';
import type { TraversalPhysics, TraversalPosition } from './golfer-controller';

export interface CartInput {
  readonly throttle: number;
  readonly steer: number;
  readonly brake: boolean;
}

export interface CartTraversalResult extends TraversalPosition {
  readonly heading: number;
  readonly speed: number;
  readonly surface: CourseSurface;
  readonly blocked: boolean;
}

const MAX_CART_SLOPE = Math.PI * 0.19;

export class CartController {
  readonly agentId = 'cart';
  private speed = 0;

  constructor(private readonly physics: TraversalPhysics) {}

  teleport(position: TraversalPosition): void {
    this.speed = 0;
    this.physics.teleportKinematicAgent(this.agentId, position);
  }

  step(
    position: TraversalPosition,
    heading: number,
    input: CartInput,
    delta: number,
  ): CartTraversalResult {
    const sample = propertyField.sample(position.x, position.z);
    const resistance = sample.surface === 'bunker' ? 0.58
      : sample.surface === 'deepRough' ? 0.7
        : sample.surface === 'rough' || sample.surface === 'bank' ? 0.82
          : 1;
    const throttle = Math.max(-1, Math.min(1, input.throttle));
    const targetSpeed = throttle >= 0 ? throttle * 10.5 * resistance : throttle * 3.8 * resistance;
    const acceleration = Math.abs(targetSpeed) > Math.abs(this.speed) ? 5.8 : 8.5;
    const speedStep = acceleration * delta;
    this.speed += Math.max(-speedStep, Math.min(speedStep, targetSpeed - this.speed));
    if (input.brake) this.speed *= Math.max(0, 1 - delta * 9.5);
    if (Math.abs(throttle) < 0.02) this.speed *= Math.max(0, 1 - delta * 1.8);

    const steerStrength = Math.max(-1, Math.min(1, input.steer));
    const speedRatio = Math.min(1, Math.abs(this.speed) / 3.2);
    const nextHeading = heading + steerStrength * Math.sign(this.speed || 1) * speedRatio * delta * 1.35;
    const distance = this.speed * delta;
    const moveX = Math.sin(nextHeading) * distance;
    const moveZ = Math.cos(nextHeading) * distance;
    const nextX = position.x + moveX;
    const nextZ = position.z + moveZ;
    const nextSample = propertyField.sample(nextX, nextZ);
    const slope = Math.acos(Math.max(-1, Math.min(1, nextSample.normal.y)));
    const safe = propertyField.contains(nextX, nextZ, 2.1)
      && nextSample.surface !== 'water'
      && nextSample.surface !== 'cliff'
      && slope <= MAX_CART_SLOPE;

    if (!safe) {
      this.speed *= Math.max(0, 1 - delta * 12);
      return { ...position, heading, speed: this.speed, surface: sample.surface, blocked: true };
    }

    const groundHeight = propertyField.heightAt(nextX, nextZ);
    const moved = this.physics.moveKinematicAgent(this.agentId, {
      x: moveX,
      y: groundHeight - position.y,
      z: moveZ,
    });
    const actualDistance = Math.hypot(moved.x - position.x, moved.z - position.z);
    const blocked = Math.abs(distance) > 0.002 && actualDistance < Math.abs(distance) * 0.22;
    if (blocked) this.speed *= 0.3;
    return {
      x: moved.x,
      y: propertyField.heightAt(moved.x, moved.z),
      z: moved.z,
      heading: nextHeading,
      speed: this.speed,
      surface: nextSample.surface,
      blocked,
    };
  }

  findSafeExit(position: TraversalPosition, heading: number): TraversalPosition | null {
    for (const [side, back] of [
      [-1.65, -0.1],
      [1.65, -0.1],
      [-1.5, -1.2],
      [1.5, -1.2],
    ] as const) {
      const x = position.x + Math.cos(heading) * side + Math.sin(heading) * back;
      const z = position.z - Math.sin(heading) * side + Math.cos(heading) * back;
      const sample = propertyField.sample(x, z);
      const slope = Math.acos(Math.max(-1, Math.min(1, sample.normal.y)));
      if (propertyField.contains(x, z, 1.1)
          && sample.surface !== 'water'
          && sample.surface !== 'cliff'
          && slope < Math.PI * 0.24) {
        return { x, y: sample.height, z };
      }
    }
    return null;
  }
}
