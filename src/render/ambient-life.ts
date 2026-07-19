import * as THREE from 'three';
import { propertyField } from '../world/property-field';
import type { EnvironmentSample } from '../world/environment';

interface Bird {
  readonly root: THREE.LineSegments;
  readonly homeX: number;
  readonly homeZ: number;
  readonly radius: number;
  readonly speed: number;
  readonly phase: number;
}

function birdGeometry(): THREE.BufferGeometry {
  return new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.34, 0, 0), new THREE.Vector3(0, 0.08, 0.08),
    new THREE.Vector3(0, 0.08, 0.08), new THREE.Vector3(0.34, 0, 0),
  ]);
}

export class AmbientLife {
  readonly root = new THREE.Group();
  private readonly birds: Bird[] = [];

  constructor() {
    this.root.name = 'procedural-ambient-life';
    const material = new THREE.LineBasicMaterial({
      color: 0x6b604f,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
    });
    const homes = [
      [-24, -18], [30, 18], [-12, 48], [42, -42], [-38, 62], [8, 4],
    ] as const;
    homes.forEach(([homeX, homeZ], index) => {
      const root = new THREE.LineSegments(birdGeometry(), material);
      root.name = `ambient-bird-${index + 1}`;
      root.frustumCulled = false;
      this.root.add(root);
      this.birds.push({
        root,
        homeX,
        homeZ,
        radius: 5.5 + (index % 3) * 2.2,
        speed: 0.12 + index * 0.013,
        phase: index * 1.73,
      });
    });
  }

  update(time: number, environment: EnvironmentSample, reducedMotion: boolean): void {
    const motionTime = reducedMotion ? 0 : time;
    for (const bird of this.birds) {
      const angle = motionTime * bird.speed + bird.phase;
      const x = bird.homeX + Math.cos(angle) * bird.radius + environment.windX * 0.35;
      const z = bird.homeZ + Math.sin(angle * 0.82) * bird.radius + environment.windZ * 0.35;
      const landingCycle = Math.sin(angle * 0.47 + bird.phase) * 0.5 + 0.5;
      const flightHeight = THREE.MathUtils.smoothstep(landingCycle, 0.16, 0.48) * 6.5;
      bird.root.position.set(x, propertyField.heightAt(x, z) + 0.24 + flightHeight, z);
      bird.root.rotation.y = -angle + Math.PI / 2;
      const flap = flightHeight > 1 ? Math.sin(motionTime * 7.2 + bird.phase) * 0.24 : 0;
      bird.root.rotation.z = flap;
      bird.root.scale.setScalar(flightHeight > 1 ? 1 : 0.62);
    }
  }

  get count(): number {
    return this.birds.length;
  }
}
