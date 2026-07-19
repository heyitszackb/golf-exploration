import * as THREE from 'three';
import type { TraceEvent } from '../world/trace-journal';

export type MarkKind = 'grass' | 'sand' | 'water' | 'hard';

interface AnimatedRipple {
  lines: THREE.LineLoop[];
  age: number;
}

interface FadingMark {
  object: THREE.Object3D;
  materials: THREE.Material[];
  age: number;
  lifetime: number;
}

const MARK_COLOR = 0x746751;
const MAX_TRAIL_POINTS = 18;
const MAX_CART_TRACK_SEGMENTS = 384;

function irregularRing(radius: number, segments: number, seed: number): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    const wobble = 1 + Math.sin(angle * 3 + seed) * 0.035 + Math.sin(angle * 7 - seed) * 0.018;
    points.push(new THREE.Vector3(Math.cos(angle) * radius * wobble, 0, Math.sin(angle) * radius * wobble));
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}

function lineMaterial(opacity: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: MARK_COLOR,
    transparent: true,
    opacity,
    depthWrite: false,
  });
}

export class InteractionMarks {
  readonly root = new THREE.Group();
  private readonly ripples: AnimatedRipple[] = [];
  private readonly fading: FadingMark[] = [];
  private readonly trailPositions: THREE.Vector3[] = [];
  private readonly trailGeometry = new THREE.BufferGeometry();
  private readonly trailBuffer = new Float32Array(MAX_TRAIL_POINTS * 3);
  private readonly trail: THREE.Line;
  private readonly cartTrackValues: number[] = [];
  private readonly cartTrackBuffer = new Float32Array(MAX_CART_TRACK_SEGMENTS * 2 * 3);
  private readonly cartTrackGeometry = new THREE.BufferGeometry();

  constructor() {
    this.root.name = 'interaction-marks';
    this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailBuffer, 3));
    this.trailGeometry.setDrawRange(0, 0);
    this.trail = new THREE.Line(this.trailGeometry, lineMaterial(0.24));
    this.trail.frustumCulled = false;
    this.root.add(this.trail);
    this.cartTrackGeometry.setAttribute('position', new THREE.BufferAttribute(this.cartTrackBuffer, 3));
    this.cartTrackGeometry.setDrawRange(0, 0);
    const cartTracks = new THREE.LineSegments(this.cartTrackGeometry, lineMaterial(0.16));
    cartTracks.name = 'live-cart-tracks';
    cartTracks.frustumCulled = false;
    this.root.add(cartTracks);
  }

  addImpact(kind: MarkKind, position: THREE.Vector3): void {
    if (kind === 'water') {
      this.addRipple(position);
      return;
    }

    const group = new THREE.Group();
    group.position.copy(position);
    group.position.y += 0.035;
    const materials: THREE.Material[] = [];

    if (kind === 'sand') {
      const rimMaterial = lineMaterial(0.31);
      materials.push(rimMaterial);
      const rim = new THREE.LineLoop(irregularRing(0.42, 30, position.x), rimMaterial);
      group.add(rim);

      const strokes: THREE.Vector3[] = [];
      for (let index = 0; index < 7; index += 1) {
        const angle = (index / 7) * Math.PI * 2 + 0.2;
        const center = new THREE.Vector3(Math.cos(angle) * 0.18, 0, Math.sin(angle) * 0.18);
        const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(0.11);
        strokes.push(center.clone().sub(tangent), center.clone().add(tangent));
      }
      const strokeMaterial = lineMaterial(0.19);
      materials.push(strokeMaterial);
      group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(strokes), strokeMaterial));
    } else {
      const scale = kind === 'grass' ? 0.28 : 0.22;
      const material = lineMaterial(kind === 'grass' ? 0.2 : 0.27);
      materials.push(material);
      const mark = new THREE.LineLoop(irregularRing(scale, 20, position.z), material);
      mark.scale.z = 0.62;
      group.add(mark);
    }

    this.root.add(group);
    this.fading.push({ object: group, materials, age: 0, lifetime: kind === 'sand' ? 42 : 24 });
  }

  updateTrail(position: THREE.Vector3, moving: boolean): void {
    if (moving) {
      const last = this.trailPositions.at(-1);
      if (!last || last.distanceToSquared(position) > 0.4) {
        this.trailPositions.push(position.clone());
        if (this.trailPositions.length > MAX_TRAIL_POINTS) this.trailPositions.shift();
      }
    }

    for (let index = 0; index < this.trailPositions.length; index += 1) {
      const point = this.trailPositions[index]!;
      const offset = index * 3;
      this.trailBuffer[offset] = point.x;
      this.trailBuffer[offset + 1] = point.y;
      this.trailBuffer[offset + 2] = point.z;
    }
    this.trailGeometry.setDrawRange(0, this.trailPositions.length);
    this.trailGeometry.attributes.position!.needsUpdate = true;
  }

  clearTrail(): void {
    this.trailPositions.length = 0;
    this.trailGeometry.setDrawRange(0, 0);
  }

  addCartTrack(from: THREE.Vector3, to: THREE.Vector3, heading: number): void {
    const sideX = Math.cos(heading) * 0.62;
    const sideZ = -Math.sin(heading) * 0.62;
    for (const side of [-1, 1]) {
      this.cartTrackValues.push(
        from.x + sideX * side, from.y + 0.045, from.z + sideZ * side,
        to.x + sideX * side, to.y + 0.045, to.z + sideZ * side,
      );
    }
    const maximumValues = MAX_CART_TRACK_SEGMENTS * 2 * 3;
    if (this.cartTrackValues.length > maximumValues) {
      this.cartTrackValues.splice(0, this.cartTrackValues.length - maximumValues);
    }
    this.cartTrackBuffer.fill(0);
    this.cartTrackBuffer.set(this.cartTrackValues);
    this.cartTrackGeometry.setDrawRange(0, this.cartTrackValues.length / 3);
    this.cartTrackGeometry.attributes.position!.needsUpdate = true;
  }

  addFootprint(position: THREE.Vector3, heading: number, strength = 1): void {
    const material = lineMaterial(0.13 * strength);
    const geometry = irregularRing(0.13, 14, position.x + position.z);
    const mark = new THREE.LineLoop(geometry, material);
    mark.position.copy(position);
    mark.position.y += 0.035;
    mark.scale.z = 0.42;
    mark.rotation.y = heading;
    this.root.add(mark);
    this.fading.push({ object: mark, materials: [material], age: 0, lifetime: 150 });
  }

  addDivot(position: THREE.Vector3, heading: number, strength = 1): void {
    const group = new THREE.Group();
    group.position.copy(position);
    group.position.y += 0.04;
    group.rotation.y = heading;
    const material = lineMaterial(0.22 * strength);
    const crescent = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.22, 0, -0.08),
        new THREE.Vector3(-0.12, 0, 0.02),
        new THREE.Vector3(0, 0, 0.075),
        new THREE.Vector3(0.14, 0, 0.02),
        new THREE.Vector3(0.24, 0, -0.09),
      ]),
      material,
    );
    group.add(crescent);
    this.root.add(group);
    this.fading.push({ object: group, materials: [material], age: 0, lifetime: 240 });
  }

  replayTrace(event: TraceEvent): void {
    const position = new THREE.Vector3(event.x, event.y, event.z);
    const heading = Math.atan2(event.directionX, event.directionZ);
    switch (event.type) {
      case 'footprint':
        this.addFootprint(position, heading, event.strength);
        break;
      case 'cart-track': {
        const from = position.clone().add(new THREE.Vector3(
          -event.directionX * event.scale,
          0,
          -event.directionZ * event.scale,
        ));
        this.addCartTrack(from, position, heading);
        break;
      }
      case 'divot':
        this.addDivot(position, heading, event.strength);
        break;
      case 'sand-crater':
      case 'sand-drag':
        this.addImpact('sand', position);
        break;
      case 'pitch-mark':
      case 'bent-grass':
        this.addImpact('grass', position);
        break;
    }
  }

  update(delta: number): void {
    for (let index = this.ripples.length - 1; index >= 0; index -= 1) {
      const ripple = this.ripples[index]!;
      ripple.age += delta;
      for (let ringIndex = 0; ringIndex < ripple.lines.length; ringIndex += 1) {
        const line = ripple.lines[ringIndex]!;
        const localAge = ripple.age - ringIndex * 0.16;
        line.visible = localAge >= 0;
        if (!line.visible) continue;
        const material = line.material as THREE.LineBasicMaterial;
        const progress = THREE.MathUtils.clamp(localAge / 2.2, 0, 1);
        const scale = 1 + progress * (2.8 + ringIndex * 0.55);
        line.scale.setScalar(scale);
        material.opacity = Math.sin(progress * Math.PI) * (0.19 - ringIndex * 0.035);
      }
      if (ripple.age > 2.85) {
        for (const line of ripple.lines) {
          line.geometry.dispose();
          (line.material as THREE.Material).dispose();
          line.removeFromParent();
        }
        this.ripples.splice(index, 1);
      }
    }

    for (let index = this.fading.length - 1; index >= 0; index -= 1) {
      const mark = this.fading[index]!;
      mark.age += delta;
      const fade = THREE.MathUtils.clamp((mark.lifetime - mark.age) / 6, 0, 1);
      for (const material of mark.materials) {
        if ('opacity' in material) material.opacity = Number(material.opacity) * Math.min(1, fade + 0.02);
      }
      if (mark.age > mark.lifetime) {
        mark.object.traverse((child) => {
          if (child instanceof THREE.Line || child instanceof THREE.LineSegments) child.geometry.dispose();
        });
        for (const material of mark.materials) material.dispose();
        mark.object.removeFromParent();
        this.fading.splice(index, 1);
      }
    }
  }

  reset(): void {
    for (const ripple of this.ripples) {
      for (const line of ripple.lines) line.removeFromParent();
    }
    for (const mark of this.fading) mark.object.removeFromParent();
    this.ripples.length = 0;
    this.fading.length = 0;
    this.clearTrail();
    this.cartTrackValues.length = 0;
    this.cartTrackGeometry.setDrawRange(0, 0);
  }

  private addRipple(position: THREE.Vector3): void {
    const lines: THREE.LineLoop[] = [];
    for (let index = 0; index < 3; index += 1) {
      const material = lineMaterial(0);
      const line = new THREE.LineLoop(irregularRing(0.43 + index * 0.1, 46, index + position.z), material);
      line.position.copy(position);
      line.position.y += 0.045 + index * 0.002;
      line.scale.z = 0.58;
      this.root.add(line);
      lines.push(line);
    }
    this.ripples.push({ lines, age: 0 });
  }
}
