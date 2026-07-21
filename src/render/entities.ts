import * as THREE from 'three';
import type { SwingPresentation } from '../simulation/swing-sequence';
import { ART_PALETTE } from './art-style';

const ink = new THREE.MeshLambertMaterial({ color: ART_PALETTE.graphite, flatShading: true });
const cloth = new THREE.MeshLambertMaterial({ color: ART_PALETTE.cloth, flatShading: true });
const paleCloth = new THREE.MeshLambertMaterial({ color: ART_PALETTE.paleCloth, flatShading: true });
const skin = new THREE.MeshLambertMaterial({ color: ART_PALETTE.skin, flatShading: true });
const outlineMaterial = new THREE.LineBasicMaterial({
  color: ART_PALETTE.graphite,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
});
const shadow = new THREE.MeshBasicMaterial({
  color: ART_PALETTE.shadow,
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
});

const IDLE_SWING: SwingPresentation = Object.freeze({
  phase: 'idle',
  progress: 0,
  power: 0,
  shotHeading: 0,
  bodyHeading: 0,
});

function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  material: THREE.Material,
  radialSegments = 7,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, 1, false),
    material,
  );
  mesh.castShadow = true;
  return mesh;
}

function outlinedBox(width: number, height: number, depth: number, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  group.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 28), outlineMaterial);
  edges.renderOrder = 3;
  group.add(edges);
  return group;
}

function contactShadow(width: number, depth: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.5, 28), shadow.clone());
  mesh.name = 'analytic-contact-shadow';
  mesh.scale.set(width, depth, 1);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.018;
  mesh.renderOrder = 2;
  return mesh;
}

export class GolferFigure extends THREE.Group {
  readonly visualRoot = new THREE.Group();
  private readonly hips: THREE.Mesh;
  private readonly torso: THREE.Mesh;
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly leftShoe: THREE.Group;
  private readonly rightShoe: THREE.Group;
  private readonly head: THREE.Mesh;
  private readonly clubRig = new THREE.Group();
  private readonly clubHeadAnchor = new THREE.Object3D();
  private readonly impactStroke: THREE.LineSegments;
  private readonly impactStrokeMaterial: THREE.LineBasicMaterial;
  private readonly groundShadow = contactShadow(0.86, 0.4);
  private locomotionSpeed = 0;
  private stridePhase = 0;
  private leftGroundOffset = 0;
  private rightGroundOffset = 0;
  private seated = false;
  private attentionYaw = 0;
  private attentionStrength = 0;
  private swing: SwingPresentation = IDLE_SWING;

  constructor() {
    super();
    this.name = 'golfer-proxy';
    this.add(this.groundShadow, this.visualRoot);

    this.hips = cylinder(0.18, 0.21, 0.29, cloth);
    this.hips.position.y = 0.92;
    this.visualRoot.add(this.hips);

    this.torso = cylinder(0.19, 0.25, 0.58, paleCloth);
    this.torso.position.y = 1.34;
    this.visualRoot.add(this.torso);

    this.head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 1), skin);
    this.head.position.set(0, 1.79, 0.01);
    this.head.castShadow = true;
    this.visualRoot.add(this.head);

    const capCrown = cylinder(0.155, 0.155, 0.09, ink, 8);
    capCrown.position.set(0, 1.92, 0);
    this.visualRoot.add(capCrown);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.025, 0.14), ink);
    brim.position.set(0, 1.91, 0.12);
    brim.castShadow = true;
    this.visualRoot.add(brim);

    this.leftLeg.position.set(-0.115, 0.83, 0);
    this.rightLeg.position.set(0.115, 0.83, 0);
    const leftLegMesh = cylinder(0.075, 0.06, 0.72, ink);
    leftLegMesh.position.y = -0.34;
    const rightLegMesh = leftLegMesh.clone();
    rightLegMesh.material = ink;
    this.leftShoe = outlinedBox(0.17, 0.085, 0.3, ink);
    this.leftShoe.position.set(0, -0.72, 0.075);
    this.rightShoe = outlinedBox(0.17, 0.085, 0.3, ink);
    this.rightShoe.position.set(0, -0.72, 0.075);
    this.leftLeg.add(leftLegMesh, this.leftShoe);
    this.rightLeg.add(rightLegMesh, this.rightShoe);
    this.visualRoot.add(this.leftLeg, this.rightLeg);

    this.leftArm.position.set(-0.23, 1.55, 0);
    this.rightArm.position.set(0.23, 1.55, 0);
    const leftArmMesh = cylinder(0.05, 0.06, 0.58, paleCloth);
    leftArmMesh.position.y = -0.27;
    const rightArmMesh = leftArmMesh.clone();
    rightArmMesh.material = paleCloth;
    this.leftArm.add(leftArmMesh);
    this.rightArm.add(rightArmMesh);
    this.visualRoot.add(this.leftArm, this.rightArm);

    this.clubRig.name = 'club-rig';
    const club = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.02, -1.04, 0.55),
        new THREE.Vector3(0.2, -1.08, 0.61),
      ]),
      new THREE.LineBasicMaterial({
        color: ART_PALETTE.graphite,
        transparent: true,
        opacity: 0.94,
        depthTest: false,
        depthWrite: false,
      }),
    );
    club.renderOrder = 7;
    this.clubRig.position.set(0, 1.23, 0.08);
    this.clubHeadAnchor.position.set(0.2, -1.08, 0.61);
    this.clubHeadAnchor.name = 'club-head-anchor';
    const shaftDirection = new THREE.Vector3(0.02, -1.04, 0.55);
    const shaft = cylinder(0.012, 0.014, shaftDirection.length(), ink, 5);
    shaft.position.copy(shaftDirection).multiplyScalar(0.5);
    shaft.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      shaftDirection.clone().normalize(),
    );
    const clubHead = outlinedBox(0.24, 0.055, 0.105, ink);
    clubHead.rotation.y = -0.18;
    this.clubHeadAnchor.add(clubHead);
    this.clubRig.add(club, shaft, this.clubHeadAnchor);
    this.visualRoot.add(this.clubRig);

    this.impactStrokeMaterial = new THREE.LineBasicMaterial({
      color: ART_PALETTE.graphite,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    this.impactStroke = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.11, 0.01, 0.05), new THREE.Vector3(-0.37, 0.14, -0.13),
        new THREE.Vector3(-0.01, 0.01, 0.02), new THREE.Vector3(0.04, 0.18, -0.17),
        new THREE.Vector3(0.1, 0.01, 0.05), new THREE.Vector3(0.34, 0.11, -0.03),
      ]),
      this.impactStrokeMaterial,
    );
    this.impactStroke.name = 'club-impact-turf-strokes';
    this.impactStroke.position.set(0.18, 0.03, 0.68);
    this.impactStroke.renderOrder = 5;
    this.impactStroke.visible = false;
    this.visualRoot.add(this.impactStroke);
  }

  update(elapsed: number): void {
    if (this.seated) {
      this.applySeatedPose();
      return;
    }

    const moving = THREE.MathUtils.clamp(this.locomotionSpeed / 5.8, 0, 1);
    const stride = Math.sin(this.stridePhase * Math.PI * 2) * moving;
    const idleBreathe = Math.sin(elapsed * 1.35) * 0.008 * (1 - moving);
    const pelvisOffset = Math.min(this.leftGroundOffset, this.rightGroundOffset);
    this.visualRoot.position.set(
      0,
      idleBreathe + THREE.MathUtils.clamp(pelvisOffset, -0.14, 0.14) * 0.35,
      0,
    );
    this.visualRoot.rotation.set(0, Math.sin(elapsed * 0.32) * 0.025 * (1 - moving), 0);
    this.hips.position.set(0, 0.92, 0);
    this.hips.rotation.set(0, 0, 0);
    this.torso.position.set(0, 1.34, 0);
    this.torso.rotation.set(0, 0, 0);
    this.leftLeg.position.set(-0.115, 0.83, 0);
    this.rightLeg.position.set(0.115, 0.83, 0);
    this.leftLeg.rotation.set(stride * 0.62, 0, -0.045);
    this.rightLeg.rotation.set(-stride * 0.62, 0, 0.045);
    this.leftShoe.position.set(
      0,
      -0.72 + THREE.MathUtils.clamp(this.leftGroundOffset, -0.12, 0.16),
      0.075,
    );
    this.rightShoe.position.set(
      0,
      -0.72 + THREE.MathUtils.clamp(this.rightGroundOffset, -0.12, 0.16),
      0.075,
    );
    this.leftShoe.rotation.set(0, 0, 0);
    this.rightShoe.rotation.set(0, 0, 0);
    this.leftArm.rotation.set(-stride * 0.38, 0, -0.24);
    this.rightArm.rotation.set(stride * 0.38, 0, 0.24);
    this.clubRig.rotation.set(0, 0, 0);
    this.clubRig.position.set(0, 1.23, 0.08);
    this.clubRig.visible = true;
    this.impactStroke.visible = false;
    this.impactStrokeMaterial.opacity = 0;
    this.groundShadow.visible = true;
    this.head.rotation.set(-0.12 * this.attentionStrength, this.attentionYaw * this.attentionStrength, 0);

    if (this.swing.phase !== 'idle') this.applySwingPose(elapsed);
  }

  setLocomotion(
    speed: number,
    leftGroundOffset: number,
    rightGroundOffset: number,
    stridePhase = this.stridePhase,
  ): void {
    this.locomotionSpeed = Math.max(0, speed);
    this.leftGroundOffset = leftGroundOffset;
    this.rightGroundOffset = rightGroundOffset;
    this.stridePhase = stridePhase;
  }

  setSeated(seated: boolean): void {
    this.seated = seated;
    if (seated) this.applySeatedPose();
    else {
      this.visualRoot.position.set(0, 0, 0);
      this.visualRoot.scale.set(1, 1, 1);
      this.groundShadow.visible = true;
      this.clubRig.visible = true;
    }
  }

  setAttention(localYaw: number, strength: number): void {
    this.attentionYaw = THREE.MathUtils.clamp(localYaw, -0.72, 0.72);
    this.attentionStrength = THREE.MathUtils.clamp(strength, 0, 1);
  }

  setSwingPresentation(presentation: SwingPresentation): void {
    this.swing = presentation;
  }

  setGroundNormal(normal: THREE.Vector3): void {
    const localNormal = normal.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.rotation.y);
    this.groundShadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), localNormal);
  }

  getClubHeadWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.clubHeadAnchor.getWorldPosition(target);
  }

  private applySeatedPose(): void {
    // Offset the driver toward the left-hand seat and keep their cap and
    // shoulders just beneath the canopy so the top-down camera reads a person,
    // not an empty cart proxy.
    this.visualRoot.position.set(-0.22, 0.34, -0.22);
    this.visualRoot.scale.set(0.92, 0.84, 0.92);
    this.visualRoot.rotation.set(-0.06, 0, 0);
    this.hips.position.set(0, 0.92, 0);
    this.hips.rotation.set(0, 0, 0);
    this.torso.position.set(0, 1.34, 0.04);
    this.torso.rotation.set(-0.12, 0, 0);
    this.head.rotation.set(-0.08, 0, 0);
    this.leftLeg.position.set(-0.13, 0.83, 0.02);
    this.rightLeg.position.set(0.13, 0.83, 0.02);
    this.leftLeg.rotation.set(-1.16, 0, -0.05);
    this.rightLeg.rotation.set(-1.16, 0, 0.05);
    this.leftArm.rotation.set(-0.86, 0.08, -0.18);
    this.rightArm.rotation.set(-0.86, -0.08, 0.18);
    this.clubRig.visible = false;
    this.impactStroke.visible = false;
    this.impactStrokeMaterial.opacity = 0;
    this.groundShadow.visible = false;
  }

  private applySwingPose(elapsed: number): void {
    const { phase, progress, power } = this.swing;
    const stanceWidth = 0.2 + power * 0.035;
    this.leftLeg.position.x = -stanceWidth;
    this.rightLeg.position.x = stanceWidth;
    this.leftLeg.rotation.set(0.04, 0, -0.08);
    this.rightLeg.rotation.set(-0.04, 0, 0.08);
    this.leftArm.rotation.set(-0.18, 0, -0.36);
    this.rightArm.rotation.set(-0.18, 0, 0.36);
    this.head.rotation.set(-0.32, 0, 0);
    this.torso.rotation.x = 0.12;

    let clubAngle = 0;
    let clubLift = 0;
    let shoulderCoil = 0;
    let hipCoil = 0;
    let bodyShift = 0;
    let rootTravel = 0;
    let trailingHeel = 0;
    let armLift = 0;
    let finish = 0;
    let impactWindow = 0;
    if (phase === 'ready' || phase === 'addressing') {
      clubAngle = phase === 'ready' ? Math.sin(elapsed * 2.2) * 0.028 : 0;
    } else if (phase === 'backswing') {
      clubAngle = -2.35 * progress;
      clubLift = -1.12 * progress;
      shoulderCoil = -0.82 * progress;
      hipCoil = -0.38 * progress;
      bodyShift = -0.075 * progress;
      armLift = progress;
    } else if (phase === 'downswing') {
      const toContact = THREE.MathUtils.clamp(progress / 0.58, 0, 1);
      const pastContact = THREE.MathUtils.clamp((progress - 0.58) / 0.42, 0, 1);
      const hipRelease = THREE.MathUtils.smoothstep(progress, 0.08, 0.72);
      const shoulderRelease = THREE.MathUtils.smoothstep(progress, 0.18, 0.82);
      clubAngle = progress <= 0.58
        ? THREE.MathUtils.lerp(-2.35 * power, 0.04, toContact)
        : THREE.MathUtils.lerp(0.04, 1.52, pastContact);
      clubLift = progress <= 0.58
        ? THREE.MathUtils.lerp(-1.12 * power, 0, toContact)
        : THREE.MathUtils.lerp(0, -0.66, pastContact);
      hipCoil = THREE.MathUtils.lerp(-0.38 * power, 0.76, hipRelease);
      shoulderCoil = THREE.MathUtils.lerp(-0.82 * power, 0.82, shoulderRelease);
      bodyShift = THREE.MathUtils.lerp(-0.075 * power, 0.14, hipRelease);
      rootTravel = pastContact * 0.055;
      trailingHeel = THREE.MathUtils.smoothstep(progress, 0.42, 0.9);
      armLift = progress <= 0.58 ? 1 - toContact : pastContact * 0.58;
      impactWindow = 1 - THREE.MathUtils.clamp(Math.abs(progress - 0.57) / 0.2, 0, 1);
    } else if (phase === 'follow-through') {
      finish = THREE.MathUtils.smoothstep(progress, 0, 0.38);
      clubAngle = THREE.MathUtils.lerp(1.52, 2.35, finish);
      clubLift = THREE.MathUtils.lerp(-0.66, -1.32, finish);
      shoulderCoil = THREE.MathUtils.lerp(0.82, 1.02, finish);
      hipCoil = THREE.MathUtils.lerp(0.76, 0.9, finish);
      bodyShift = THREE.MathUtils.lerp(0.14, 0.17, finish);
      rootTravel = THREE.MathUtils.lerp(0.055, 0.09, finish);
      trailingHeel = THREE.MathUtils.lerp(0.7, 1, finish);
      armLift = THREE.MathUtils.lerp(0.58, 1, finish);
    } else if (phase === 'recover') {
      clubAngle = THREE.MathUtils.lerp(2.35, 0, progress);
      clubLift = THREE.MathUtils.lerp(-1.32, 0, progress);
      shoulderCoil = THREE.MathUtils.lerp(1.02, 0, progress);
      hipCoil = THREE.MathUtils.lerp(0.9, 0, progress);
      bodyShift = THREE.MathUtils.lerp(0.17, 0, progress);
      rootTravel = THREE.MathUtils.lerp(0.09, 0, progress);
      trailingHeel = THREE.MathUtils.lerp(1, 0, progress);
      armLift = THREE.MathUtils.lerp(1, 0, progress);
      finish = 1 - progress;
    }

    // Keep the club-head contact point almost fixed until impact; the visible
    // transfer comes from hips, torso, and feet, then the whole body releases
    // slightly toward the target after the ball has gone.
    this.visualRoot.position.x += rootTravel;
    this.hips.position.x = bodyShift * 0.58;
    this.torso.position.x = bodyShift;
    this.hips.rotation.set(0, hipCoil, -bodyShift * 0.95);
    this.torso.rotation.set(0.12 - finish * 0.08, shoulderCoil, -bodyShift * 1.35);
    this.clubRig.position.y = 1.23 + finish * 0.38;
    this.clubRig.position.z = 0.08 - finish * 0.12;
    this.clubRig.rotation.set(clubLift, clubAngle, shoulderCoil * 0.18 + finish * 0.2);

    const followArm = Math.max(finish, phase === 'recover' ? 1 - progress : 0);
    this.leftArm.rotation.x = -0.18 - armLift * 0.72 + followArm * 0.42;
    this.rightArm.rotation.x = -0.18 - armLift * 0.58 + followArm * 0.55;
    this.leftArm.rotation.y = shoulderCoil * 0.82;
    this.rightArm.rotation.y = shoulderCoil * 0.82;
    this.leftArm.rotation.z = -0.36 - armLift * 0.31 + followArm * 0.18;
    this.rightArm.rotation.z = 0.36 - armLift * 0.5 - followArm * 0.28;

    this.leftLeg.rotation.x = 0.04 - bodyShift * 0.18;
    this.leftLeg.rotation.z = -0.08 + bodyShift * 0.48;
    this.rightLeg.position.x = stanceWidth - trailingHeel * 0.085;
    this.rightLeg.position.z = -trailingHeel * 0.055;
    this.rightLeg.rotation.x = -0.04 - trailingHeel * 0.27;
    this.rightLeg.rotation.y = trailingHeel * 0.34;
    this.rightLeg.rotation.z = 0.08 + bodyShift * 0.5;
    this.rightShoe.position.y = -0.72 + trailingHeel * 0.1;
    this.rightShoe.rotation.set(-trailingHeel * 0.42, trailingHeel * 0.42, 0);
    this.head.rotation.set(-0.32 + finish * 0.15, -shoulderCoil * 0.16 + finish * 0.24, 0);

    this.impactStroke.visible = impactWindow > 0.02;
    this.impactStrokeMaterial.opacity = 0.18 + impactWindow * 0.58;
    this.impactStroke.scale.setScalar(0.8 + impactWindow * 0.28);
  }
}

export class FlagFigure extends THREE.Group {
  private readonly pennant: THREE.Mesh;

  constructor() {
    super();
    this.name = 'flag-proxy';
    const pole = cylinder(0.018, 0.025, 2.55, ink, 6);
    pole.position.y = 1.275;
    this.add(pole);

    const flagShape = new THREE.Shape();
    flagShape.moveTo(0, 0);
    flagShape.lineTo(0.88, -0.24);
    flagShape.lineTo(0, -0.48);
    flagShape.closePath();
    this.pennant = new THREE.Mesh(
      new THREE.ShapeGeometry(flagShape),
      new THREE.MeshLambertMaterial({
        color: ART_PALETTE.cloth,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.pennant.castShadow = true;
    this.pennant.position.y = 2.47;
    this.add(this.pennant, contactShadow(0.28, 0.16));
  }

  update(elapsed: number, windX = 0.6, windZ = 1): void {
    const breathe = 1 + Math.sin(elapsed * 2.1) * 0.05 + Math.sin(elapsed * 3.7) * 0.02;
    this.pennant.scale.x = breathe;
    this.rotation.y = Math.atan2(-windZ, windX);
    this.pennant.rotation.y = Math.sin(elapsed * 1.6) * 0.04;
  }
}

export class CartFigure extends THREE.Group {
  private readonly visualRoot = new THREE.Group();
  private readonly frontWheels: THREE.Group[] = [];
  private readonly wheelMeshes: THREE.Mesh[] = [];
  private readonly groundShadow = contactShadow(1.42, 2.72);
  private wheelSpin = 0;

  constructor() {
    super();
    this.name = 'cart-proxy';
    this.add(this.groundShadow, this.visualRoot);

    const body = outlinedBox(1.14, 0.42, 2.25, paleCloth);
    body.position.y = 0.63;
    this.visualRoot.add(body);
    const nose = outlinedBox(0.96, 0.36, 0.68, paleCloth);
    nose.position.set(0, 0.82, 0.78);
    this.visualRoot.add(nose);
    const seat = outlinedBox(1.02, 0.25, 0.82, cloth);
    seat.position.set(0, 1.04, -0.25);
    this.visualRoot.add(seat);
    const roof = outlinedBox(
      1.28,
      0.08,
      2.18,
      new THREE.MeshLambertMaterial({
        color: ART_PALETTE.paperLight,
        flatShading: true,
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
      }),
    );
    roof.position.y = 2.03;
    roof.traverse((part) => {
      if (part instanceof THREE.Mesh) part.castShadow = false;
    });
    this.visualRoot.add(roof);

    for (const x of [-0.63, 0.63]) {
      for (const z of [-0.82, 0.82]) {
        const pivot = new THREE.Group();
        pivot.position.set(x, 0.34, z);
        const wheel = cylinder(0.3, 0.3, 0.16, ink, 12);
        wheel.rotation.z = Math.PI / 2;
        pivot.add(wheel);
        this.visualRoot.add(pivot);
        this.wheelMeshes.push(wheel);
        if (z > 0) this.frontWheels.push(pivot);
      }
    }

    const frame = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.5, 0.84, -0.72), new THREE.Vector3(-0.5, 2, -0.72),
        new THREE.Vector3(0.5, 0.84, -0.72), new THREE.Vector3(0.5, 2, -0.72),
        new THREE.Vector3(-0.5, 0.84, 0.72), new THREE.Vector3(-0.5, 2, 0.72),
        new THREE.Vector3(0.5, 0.84, 0.72), new THREE.Vector3(0.5, 2, 0.72),
      ]),
      outlineMaterial,
    );
    this.visualRoot.add(frame);
  }

  setMotion(speed: number, steering: number, normal: THREE.Vector3, delta: number): void {
    this.wheelSpin += speed * delta / 0.3;
    for (const wheel of this.wheelMeshes) wheel.rotation.y = this.wheelSpin;
    for (const wheel of this.frontWheels) wheel.rotation.y = steering * 0.38;

    const localNormal = normal.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.rotation.y);
    const targetPitch = Math.atan2(localNormal.z, Math.max(0.1, localNormal.y));
    const targetRoll = -Math.atan2(localNormal.x, Math.max(0.1, localNormal.y));
    const blend = 1 - Math.exp(-Math.max(0, delta) * 7);
    this.visualRoot.rotation.x = THREE.MathUtils.lerp(this.visualRoot.rotation.x, targetPitch, blend);
    this.visualRoot.rotation.z = THREE.MathUtils.lerp(this.visualRoot.rotation.z, targetRoll, blend);
  }

  getForward(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(0, 0, 1).applyQuaternion(this.quaternion).normalize();
  }
}

export function makeBallVisual(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ball-visual';

  const ball = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.18, 2),
    new THREE.MeshLambertMaterial({ color: ART_PALETTE.ball, flatShading: true }),
  );
  ball.position.y = 0.18;
  ball.castShadow = true;
  group.add(ball);
  const ballShadow = contactShadow(0.46, 0.23);
  ballShadow.name = 'ball-ground-shadow';
  group.add(ballShadow);
  return group;
}
