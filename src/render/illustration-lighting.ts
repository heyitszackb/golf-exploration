import * as THREE from 'three';
import { ART_PALETTE, ILLUSTRATION_LIGHT } from './art-style';

/** One restrained, stabilized shadow source shared by every presentation adapter. */
export class IllustrationLighting {
  readonly root = new THREE.Group();
  readonly key = new THREE.DirectionalLight(0xfff4d7, 1.05);
  private readonly fill = new THREE.HemisphereLight(0xf2e2be, 0x8b7355, 1.6);
  private readonly extent = ILLUSTRATION_LIGHT.shadowExtent;
  private readonly lightOffset = new THREE.Vector3(-44, 92, -42);
  private readonly lightForward = this.lightOffset.clone().multiplyScalar(-1).normalize();
  private readonly lightRight = new THREE.Vector3()
    .crossVectors(this.lightForward, new THREE.Vector3(0, 1, 0))
    .normalize();
  private readonly lightUp = new THREE.Vector3()
    .crossVectors(this.lightRight, this.lightForward)
    .normalize();
  private readonly snappedAnchor = new THREE.Vector3();

  constructor() {
    this.root.name = 'illustration-lighting';
    this.key.name = 'soft-drawn-daylight';
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(
      ILLUSTRATION_LIGHT.shadowMapSize,
      ILLUSTRATION_LIGHT.shadowMapSize,
    );
    const shadowCamera = this.key.shadow.camera as THREE.OrthographicCamera;
    shadowCamera.left = -this.extent / 2;
    shadowCamera.right = this.extent / 2;
    shadowCamera.top = this.extent / 2;
    shadowCamera.bottom = -this.extent / 2;
    shadowCamera.near = 18;
    shadowCamera.far = 180;
    shadowCamera.updateProjectionMatrix();
    this.key.shadow.bias = -0.00035;
    this.key.shadow.normalBias = 0.035;
    this.key.shadow.radius = 1.35;

    this.fill.name = 'paper-sky-fill';
    this.root.add(this.fill, this.key, this.key.target);
    this.update(new THREE.Vector3());
  }

  update(anchor: THREE.Vector3): void {
    const texel = this.extent / ILLUSTRATION_LIGHT.shadowMapSize;
    const lightX = anchor.dot(this.lightRight);
    const lightY = anchor.dot(this.lightUp);
    this.snappedAnchor.copy(anchor)
      .addScaledVector(this.lightRight, Math.round(lightX / texel) * texel - lightX)
      .addScaledVector(this.lightUp, Math.round(lightY / texel) * texel - lightY);
    this.key.target.position.copy(this.snappedAnchor);
    this.key.position.copy(this.snappedAnchor).add(this.lightOffset);
    this.key.target.updateMatrixWorld();
  }

  setHighContrast(enabled: boolean): void {
    this.key.intensity = enabled ? 1.18 : 1.05;
    this.fill.intensity = enabled ? 1.72 : 1.6;
    this.fill.groundColor.setHex(enabled ? ART_PALETTE.graphiteSoft : 0x8b7355);
  }
}
