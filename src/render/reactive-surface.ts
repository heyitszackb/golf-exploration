import * as THREE from 'three';
import type { WorldEvent } from '../core/world-events';
import { ART_LIMITS } from './art-style';

interface SurfaceImpulse {
  readonly key: string;
  x: number;
  z: number;
  radius: number;
  strength: number;
  decay: number;
  refreshed: boolean;
}

/**
 * A fixed-budget interaction field consumed entirely in the grass vertex shader.
 * The public event seam is intentionally independent of whether the backing
 * implementation is uniforms today or per-chunk render targets in the future.
 */
export class ReactiveSurface {
  readonly uniforms = Array.from(
    { length: ART_LIMITS.grassInteractions },
    () => new THREE.Vector4(10_000, 10_000, 0, 0),
  );
  private readonly impulses = new Map<string, SurfaceImpulse>();
  private serial = 0;

  handle(event: WorldEvent): void {
    switch (event.type) {
      case 'golfer-moved':
        this.refresh(
          'actor:golfer',
          event.position.x,
          event.position.z,
          1.05,
          THREE.MathUtils.clamp(event.speed / 4.8, 0, 0.88),
          2.6,
        );
        break;
      case 'footstep':
        this.stamp(
          event.position.x,
          event.position.z,
          event.surface === 'deepRough' ? 1.25 : 0.82,
          0.36 + event.strength * 0.42,
          event.surface === 'deepRough' ? 0.38 : 0.7,
        );
        break;
      case 'cart-moved':
        this.refresh(
          'actor:cart',
          event.position.x,
          event.position.z,
          2.15,
          THREE.MathUtils.clamp(Math.abs(event.speed) / 8, 0, 0.96),
          1.8,
        );
        break;
      case 'ball-moved':
        this.refresh(
          `actor:ball:${event.ballId}`,
          event.position.x,
          event.position.z,
          event.clearance < 0.3 ? 1.5 : 0.72,
          event.clearance < 0.65 ? THREE.MathUtils.clamp(event.speed / 11, 0, 1) : 0,
          3.8,
        );
        break;
      case 'ball-landed':
        this.stamp(event.position.x, event.position.z, 1.75, 0.55 + event.strength * 0.42, 0.48);
        break;
      case 'club-impact':
        this.stamp(event.position.x, event.position.z, 1.3, 0.75 + event.strength * 0.25, 0.55);
        break;
      default:
        break;
    }
  }

  update(delta: number): void {
    for (const [key, impulse] of this.impulses) {
      if (!impulse.refreshed) impulse.strength = Math.max(0, impulse.strength - delta * impulse.decay);
      impulse.refreshed = false;
      if (impulse.strength <= 0.01) this.impulses.delete(key);
    }

    const active = [...this.impulses.values()]
      .sort((left, right) => right.strength - left.strength)
      .slice(0, ART_LIMITS.grassInteractions);
    for (let index = 0; index < this.uniforms.length; index += 1) {
      const target = this.uniforms[index]!;
      const impulse = active[index];
      if (impulse) target.set(impulse.x, impulse.z, impulse.radius, impulse.strength);
      else target.set(10_000, 10_000, 0, 0);
    }
  }

  clear(): void {
    this.impulses.clear();
    for (const uniform of this.uniforms) uniform.set(10_000, 10_000, 0, 0);
  }

  get activeCount(): number {
    return this.impulses.size;
  }

  private refresh(
    key: string,
    x: number,
    z: number,
    radius: number,
    strength: number,
    decay: number,
  ): void {
    const existing = this.impulses.get(key);
    if (existing) {
      existing.x = x;
      existing.z = z;
      existing.radius = radius;
      existing.strength = strength;
      existing.decay = decay;
      existing.refreshed = true;
      return;
    }
    if (strength <= 0.01) return;
    this.impulses.set(key, { key, x, z, radius, strength, decay, refreshed: true });
  }

  private stamp(x: number, z: number, radius: number, strength: number, decay: number): void {
    this.serial += 1;
    const key = `stamp:${this.serial}`;
    this.impulses.set(key, { key, x, z, radius, strength, decay, refreshed: false });
    if (this.impulses.size <= ART_LIMITS.grassInteractions * 3) return;
    const oldestStamp = [...this.impulses.keys()].find((candidate) => candidate.startsWith('stamp:'));
    if (oldestStamp) this.impulses.delete(oldestStamp);
  }
}
