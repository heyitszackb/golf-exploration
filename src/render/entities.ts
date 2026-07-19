import * as THREE from 'three';

const ink = new THREE.MeshBasicMaterial({ color: 0x6f6554 });
const cloth = new THREE.MeshBasicMaterial({ color: 0x8b806a });
const paleCloth = new THREE.MeshBasicMaterial({ color: 0xcfc09f });
const skin = new THREE.MeshBasicMaterial({ color: 0x9c8261 });
const shadow = new THREE.MeshBasicMaterial({
  color: 0x76664f,
  transparent: true,
  opacity: 0.13,
  depthWrite: false,
});

function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  material: THREE.Material,
  radialSegments = 6,
): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, 1, false),
    material,
  );
}

function contactShadow(width: number, depth: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), shadow);
  mesh.scale.set(width, depth, 1);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.012;
  mesh.renderOrder = 2;
  return mesh;
}

export class GolferFigure extends THREE.Group {
  readonly visualRoot = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg: THREE.Mesh;
  private readonly rightLeg: THREE.Mesh;
  private readonly leftShoe: THREE.Mesh;
  private readonly rightShoe: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private locomotionSpeed = 0;
  private leftGroundOffset = 0;
  private rightGroundOffset = 0;
  private seated = false;
  private attentionYaw = 0;
  private attentionStrength = 0;
  private readonly club = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -1.14, 0.12),
      new THREE.Vector3(0.12, -1.18, 0.12),
    ]),
    new THREE.LineBasicMaterial({ color: 0x655b4c, transparent: true, opacity: 0.82 }),
  );

  constructor() {
    super();
    this.name = 'golfer-proxy';
    this.add(contactShadow(0.78, 0.34));
    this.add(this.visualRoot);

    const hips = cylinder(0.18, 0.21, 0.29, cloth);
    hips.position.y = 0.92;
    this.visualRoot.add(hips);

    const torso = cylinder(0.19, 0.25, 0.55, paleCloth);
    torso.position.y = 1.32;
    this.visualRoot.add(torso);

    this.head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.145, 1), skin);
    this.head.position.set(0, 1.78, 0.01);
    this.visualRoot.add(this.head);

    const capCrown = cylinder(0.15, 0.15, 0.09, ink, 8);
    capCrown.position.set(0, 1.91, 0);
    this.visualRoot.add(capCrown);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.025, 0.13), ink);
    brim.position.set(0, 1.9, 0.12);
    this.visualRoot.add(brim);

    this.leftLeg = cylinder(0.075, 0.065, 0.76, ink);
    this.leftLeg.position.set(-0.115, 0.47, 0);
    this.leftLeg.rotation.z = -0.045;
    this.visualRoot.add(this.leftLeg);
    this.rightLeg = this.leftLeg.clone();
    this.rightLeg.position.x = 0.115;
    this.rightLeg.rotation.z = 0.045;
    this.visualRoot.add(this.rightLeg);

    this.leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.29), ink);
    this.leftShoe.position.set(-0.13, 0.08, 0.065);
    this.visualRoot.add(this.leftShoe);
    this.rightShoe = this.leftShoe.clone();
    this.rightShoe.position.x = 0.13;
    this.visualRoot.add(this.rightShoe);

    this.leftArm.position.set(-0.23, 1.53, 0);
    this.leftArm.rotation.z = -0.24;
    const leftArmMesh = cylinder(0.052, 0.06, 0.58, paleCloth);
    leftArmMesh.position.y = -0.27;
    this.leftArm.add(leftArmMesh);
    this.visualRoot.add(this.leftArm);

    this.rightArm.position.set(0.23, 1.53, 0);
    this.rightArm.rotation.z = 0.24;
    const rightArmMesh = cylinder(0.052, 0.06, 0.58, paleCloth);
    rightArmMesh.position.y = -0.27;
    this.rightArm.add(rightArmMesh);
    this.visualRoot.add(this.rightArm);

    this.club.position.set(0.28, 1.27, 0.06);
    this.visualRoot.add(this.club);
  }

  update(elapsed: number): void {
    if (this.seated) {
      this.visualRoot.position.y = 0.82;
      this.visualRoot.rotation.x = -0.05;
      this.leftLeg.rotation.x = -1.15;
      this.rightLeg.rotation.x = -1.15;
      this.leftArm.rotation.x = -0.68;
      this.rightArm.rotation.x = -0.68;
      return;
    }

    const moving = THREE.MathUtils.clamp(this.locomotionSpeed / 4.8, 0, 1);
    const stride = Math.sin(elapsed * (4.5 + moving * 5.5)) * moving;
    const idleBreathe = Math.sin(elapsed * 1.35) * 0.008 * (1 - moving);
    const pelvisOffset = Math.min(this.leftGroundOffset, this.rightGroundOffset);
    this.visualRoot.position.y = idleBreathe + THREE.MathUtils.clamp(pelvisOffset, -0.14, 0.14) * 0.35;
    this.visualRoot.rotation.x = 0;
    this.visualRoot.rotation.y = Math.sin(elapsed * 0.32) * 0.025 * (1 - moving);
    this.leftLeg.rotation.x = stride * 0.58;
    this.rightLeg.rotation.x = -stride * 0.58;
    this.leftShoe.position.y = 0.08 + THREE.MathUtils.clamp(this.leftGroundOffset, -0.12, 0.16);
    this.rightShoe.position.y = 0.08 + THREE.MathUtils.clamp(this.rightGroundOffset, -0.12, 0.16);
    this.leftArm.rotation.x = -stride * 0.36 + Math.sin(elapsed * 0.65) * 0.018 * (1 - moving);
    this.rightArm.rotation.x = stride * 0.36 - Math.sin(elapsed * 0.65) * 0.018 * (1 - moving);
    this.head.rotation.y = this.attentionYaw * this.attentionStrength;
    this.head.rotation.x = -0.12 * this.attentionStrength;
  }

  setLocomotion(speed: number, leftGroundOffset: number, rightGroundOffset: number): void {
    this.locomotionSpeed = Math.max(0, speed);
    this.leftGroundOffset = leftGroundOffset;
    this.rightGroundOffset = rightGroundOffset;
  }

  setSeated(seated: boolean): void {
    this.seated = seated;
    if (!seated) this.visualRoot.position.set(0, 0, 0);
  }

  setAttention(localYaw: number, strength: number): void {
    this.attentionYaw = THREE.MathUtils.clamp(localYaw, -0.72, 0.72);
    this.attentionStrength = THREE.MathUtils.clamp(strength, 0, 1);
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
      new THREE.MeshBasicMaterial({
        color: 0x8e795e,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.82,
      }),
    );
    this.pennant.position.y = 2.47;
    this.pennant.rotation.y = -0.15;
    this.add(this.pennant);

    this.add(contactShadow(0.28, 0.16));
  }

  update(elapsed: number): void {
    const breathe = 1 + Math.sin(elapsed * 2.1) * 0.055 + Math.sin(elapsed * 3.7) * 0.025;
    this.pennant.scale.x = breathe;
    this.pennant.rotation.y = -0.15 + Math.sin(elapsed * 1.6) * 0.04;
  }
}

export class CartFigure extends THREE.Group {
  constructor() {
    super();
    this.name = 'cart-proxy';
    this.add(contactShadow(2.7, 1.28));

    const body = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.42, 1.12), paleCloth);
    body.position.y = 0.63;
    this.add(body);

    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.25, 0.66), cloth);
    seat.position.set(0.22, 1.02, -0.13);
    this.add(seat);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.08, 1.25), paleCloth);
    roof.position.y = 2.03;
    this.add(roof);

    for (const x of [-0.82, 0.82]) {
      for (const z of [-0.6, 0.6]) {
        const wheel = cylinder(0.3, 0.3, 0.16, ink, 12);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x, 0.34, z);
        this.add(wheel);
      }
    }

    const frameMaterial = new THREE.LineBasicMaterial({
      color: 0x706654,
      transparent: true,
      opacity: 0.75,
    });
    const frame = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.83, 0.84, -0.48), new THREE.Vector3(-0.83, 2, -0.48),
        new THREE.Vector3(0.83, 0.84, -0.48), new THREE.Vector3(0.83, 2, -0.48),
        new THREE.Vector3(-0.83, 0.84, 0.48), new THREE.Vector3(-0.83, 2, 0.48),
        new THREE.Vector3(0.83, 0.84, 0.48), new THREE.Vector3(0.83, 2, 0.48),
      ]),
      frameMaterial,
    );
    this.add(frame);
  }
}

export function makeBallVisual(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ball-visual';

  const ball = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.18, 2),
    new THREE.MeshBasicMaterial({ color: 0xeee4c9 }),
  );
  ball.position.y = 0.18;
  group.add(ball);
  const ballShadow = contactShadow(0.46, 0.23);
  ballShadow.material = shadow.clone();
  ballShadow.name = 'ball-ground-shadow';
  group.add(ballShadow);

  return group;
}
