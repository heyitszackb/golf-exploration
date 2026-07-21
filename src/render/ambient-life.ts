import * as THREE from 'three';
import { propertyField } from '../world/property-field';
import type { EnvironmentSample } from '../world/environment';
import type { WorldEvent, WorldPoint } from '../core/world-events';
import { ART_PALETTE } from './art-style';

type FlockState = 'grounded' | 'taking-off' | 'circling' | 'landing';

interface Bird {
  readonly root: THREE.Group;
  readonly leftWing: THREE.Line;
  readonly rightWing: THREE.Line;
  readonly offsetX: number;
  readonly offsetZ: number;
  readonly phase: number;
}

interface Flock {
  readonly id: number;
  readonly birds: Bird[];
  readonly center: THREE.Vector2;
  state: FlockState;
  stateTime: number;
  stateDuration: number;
  escapeX: number;
  escapeZ: number;
}

const ink = new THREE.LineBasicMaterial({
  color: ART_PALETTE.graphite,
  transparent: true,
  opacity: 0.76,
  depthWrite: false,
});
const bodyMaterial = new THREE.MeshLambertMaterial({
  color: ART_PALETTE.graphite,
  flatShading: true,
});

function makeBird(index: number): Bird {
  const root = new THREE.Group();
  root.name = `ambient-bird-${index + 1}`;
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.085, 0), bodyMaterial);
  body.scale.set(0.72, 0.52, 1.2);
  body.rotation.x = Math.PI / 2;
  root.add(body);
  const leftWing = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.02, 0),
      new THREE.Vector3(-0.34, 0, -0.06),
    ]),
    ink,
  );
  const rightWing = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.02, 0),
      new THREE.Vector3(0.34, 0, -0.06),
    ]),
    ink,
  );
  root.add(leftWing, rightWing);
  const column = index % 3;
  const row = Math.floor(index / 3) % 2;
  return {
    root,
    leftWing,
    rightWing,
    offsetX: (column - 1) * 1.18 + Math.sin(index * 2.1) * 0.34,
    offsetZ: (row - 0.5) * 1.5 + Math.cos(index * 1.7) * 0.42,
    phase: index * 1.73,
  };
}

function distanceTo(point: WorldPoint, center: THREE.Vector2): number {
  return Math.hypot(point.x - center.x, point.z - center.y);
}

/** Seeded low-frequency flock state with a renderer-local procedural fallback. */
export class AmbientLife {
  readonly root = new THREE.Group();
  private readonly flocks: Flock[] = [];

  constructor() {
    this.root.name = 'procedural-ambient-life';
    const centers = [
      [13, -47],
      [-11, 27],
      [18, 57],
    ] as const;
    let birdIndex = 0;
    centers.forEach(([x, z], flockIndex) => {
      const birds: Bird[] = [];
      for (let index = 0; index < 4; index += 1) {
        const bird = makeBird(birdIndex);
        birdIndex += 1;
        birds.push(bird);
        this.root.add(bird.root);
      }
      this.flocks.push({
        id: flockIndex,
        birds,
        center: new THREE.Vector2(x, z),
        state: flockIndex === 1 ? 'circling' : 'grounded',
        stateTime: flockIndex * 3.7,
        stateDuration: flockIndex === 1 ? 14 : 24 + flockIndex * 7,
        escapeX: 0,
        escapeZ: 1,
      });
    });
  }

  handleWorldEvent(event: WorldEvent): void {
    let radius = 0;
    let strength = 0;
    switch (event.type) {
      case 'ball-landed':
        radius = 14;
        strength = event.strength;
        break;
      case 'water-splashed':
        radius = 17;
        strength = event.strength;
        break;
      case 'club-impact':
        radius = 10;
        strength = event.strength;
        break;
      case 'cart-moved':
        radius = 7 + Math.min(5, Math.abs(event.speed));
        strength = Math.min(1, Math.abs(event.speed) / 5);
        break;
      case 'golfer-moved':
        radius = 4.2;
        strength = Math.min(0.7, event.speed / 5);
        break;
      default:
        return;
    }
    if (strength <= 0.08) return;
    for (const flock of this.flocks) {
      if (flock.state !== 'grounded' && flock.state !== 'landing') continue;
      if (distanceTo(event.position, flock.center) > radius) continue;
      const awayX = flock.center.x - event.position.x;
      const awayZ = flock.center.y - event.position.z;
      const inverseLength = 1 / Math.max(0.001, Math.hypot(awayX, awayZ));
      flock.escapeX = awayX * inverseLength;
      flock.escapeZ = awayZ * inverseLength;
      flock.state = 'taking-off';
      flock.stateTime = 0;
      flock.stateDuration = 1.55;
    }
  }

  update(
    time: number,
    delta: number,
    environment: EnvironmentSample,
    reducedMotion: boolean,
  ): void {
    for (const flock of this.flocks) {
      let remaining = Math.max(0, delta);
      let transitions = 0;
      while (remaining > 0 && transitions < 12) {
        const untilTransition = Math.max(0, flock.stateDuration - flock.stateTime);
        if (remaining < untilTransition) {
          flock.stateTime += remaining;
          remaining = 0;
        } else {
          remaining -= untilTransition;
          this.advanceFlock(flock);
          transitions += 1;
        }
      }
      this.positionFlock(flock, time, environment, reducedMotion);
    }
  }

  private advanceFlock(flock: Flock): void {
    flock.stateTime = 0;
    switch (flock.state) {
      case 'grounded':
        flock.state = 'taking-off';
        flock.stateDuration = 1.7;
        flock.escapeX = Math.sin(flock.id * 2.4 + 0.7);
        flock.escapeZ = Math.cos(flock.id * 1.8 + 0.4);
        break;
      case 'taking-off':
        flock.state = 'circling';
        flock.stateDuration = 11 + flock.id * 3.5;
        break;
      case 'circling':
        flock.state = 'landing';
        flock.stateDuration = 2.5;
        break;
      case 'landing':
        flock.state = 'grounded';
        flock.stateDuration = 21 + flock.id * 8;
        break;
    }
  }

  private positionFlock(
    flock: Flock,
    time: number,
    environment: EnvironmentSample,
    reducedMotion: boolean,
  ): void {
    const progress = THREE.MathUtils.clamp(flock.stateTime / Math.max(0.001, flock.stateDuration), 0, 1);
    for (let index = 0; index < flock.birds.length; index += 1) {
      const bird = flock.birds[index]!;
      const stagger = index * 0.09;
      const localProgress = THREE.MathUtils.clamp((progress - stagger) / Math.max(0.1, 1 - stagger), 0, 1);
      let x = flock.center.x + bird.offsetX;
      let z = flock.center.y + bird.offsetZ;
      let height = 0.18;
      let airborne = false;

      if (flock.state === 'taking-off') {
        airborne = true;
        const lift = THREE.MathUtils.smoothstep(localProgress, 0, 1);
        x += flock.escapeX * lift * (4.4 + index * 0.42);
        z += flock.escapeZ * lift * (4.4 + index * 0.42);
        height += lift * (3.8 + index * 0.28);
      } else if (flock.state === 'circling') {
        airborne = true;
        const angle = time * (0.28 + flock.id * 0.035) + bird.phase;
        const radius = 4.3 + (index % 2) * 1.25;
        x += Math.cos(angle) * radius + environment.windX * 0.42;
        z += Math.sin(angle * 0.86) * radius + environment.windZ * 0.42;
        height += 4.3 + Math.sin(angle * 1.4) * 0.55 + index * 0.18;
        bird.root.rotation.y = -angle + Math.PI / 2;
      } else if (flock.state === 'landing') {
        airborne = localProgress < 0.9;
        const settle = 1 - THREE.MathUtils.smoothstep(localProgress, 0, 1);
        const angle = time * 0.22 + bird.phase;
        x += Math.cos(angle) * 4.2 * settle;
        z += Math.sin(angle) * 3.4 * settle;
        height += settle * 4.2;
      } else if (!reducedMotion) {
        x += Math.sin(time * 0.34 + bird.phase) * 0.16;
        z += Math.cos(time * 0.27 + bird.phase) * 0.11;
      }

      const ground = propertyField.heightAt(x, z);
      bird.root.position.set(x, ground + height, z);
      const flap = airborne && !reducedMotion ? Math.sin(time * 11.5 + bird.phase) : 0;
      bird.leftWing.rotation.z = flap * 0.7;
      bird.rightWing.rotation.z = -flap * 0.7;
      bird.root.rotation.x = !airborne && !reducedMotion
        ? Math.max(0, Math.sin(time * 0.72 + bird.phase)) * 0.34
        : 0;
      bird.root.scale.setScalar(airborne ? 1 : 0.78);
    }
  }

  get count(): number {
    return this.flocks.reduce((total, flock) => total + flock.birds.length, 0);
  }

  get flockCount(): number {
    return this.flocks.length;
  }

  get airborneCount(): number {
    return this.flocks.reduce(
      (total, flock) => total + (flock.state === 'grounded' ? 0 : flock.birds.length),
      0,
    );
  }
}
