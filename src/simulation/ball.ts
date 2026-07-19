import { MathUtils, Quaternion, Vector3 } from "three";

/** The production clock can call `step` directly at this cadence. */
export const BALL_FIXED_STEP = 1 / 120;

export const BALL_SURFACES = [
  "tee",
  "fairway",
  "green",
  "rough",
  "deep-rough",
  "sand",
  "hard",
  "rock",
  "water",
] as const;

export type BallSurface = (typeof BALL_SURFACES)[number];
export type BallMotionState = "flight" | "rolling" | "resting" | "submerged";

/**
 * A sample from the same authoritative terrain field used by the renderer.
 * `height` is the solid terrain height. In water, `waterLevel` is the surface
 * of the water and should be above `height`.
 */
export interface BallTerrainSample {
  readonly height: number;
  readonly normal: Vector3;
  readonly surface: BallSurface;
  readonly waterLevel?: number;
}

/** Deliberately tiny boundary between the course implementation and the ball. */
export interface BallTerrainQuery {
  sample(x: number, z: number): BallTerrainSample;
}

export interface BallSurfaceResponse {
  /** Fraction of normal impact speed retained after a bounce. */
  readonly restitution: number;
  /** Fraction of tangential impact speed retained after a bounce. */
  readonly tangentialRetention: number;
  /** Constant deceleration while rolling, in metres per second squared. */
  readonly rollingResistance: number;
  /** Additional speed-proportional rolling drag. */
  readonly rollingDrag: number;
  /** Slope acceleration that must be exceeded before a nearly still ball moves. */
  readonly staticResistance: number;
  /** A smaller rebound than this transitions directly into rolling. */
  readonly bounceToRollSpeed: number;
  /** Fraction of angular velocity retained on impact. */
  readonly spinRetention: number;
}

export const DEFAULT_SURFACE_RESPONSES: Readonly<
  Record<BallSurface, Readonly<BallSurfaceResponse>>
> = Object.freeze({
  tee: {
    restitution: 0.34,
    tangentialRetention: 0.88,
    rollingResistance: 0.72,
    rollingDrag: 0.075,
    staticResistance: 0.2,
    bounceToRollSpeed: 0.95,
    spinRetention: 0.68,
  },
  fairway: {
    restitution: 0.36,
    tangentialRetention: 0.86,
    rollingResistance: 0.82,
    rollingDrag: 0.085,
    staticResistance: 0.24,
    bounceToRollSpeed: 0.9,
    spinRetention: 0.64,
  },
  green: {
    restitution: 0.17,
    tangentialRetention: 0.94,
    rollingResistance: 0.24,
    rollingDrag: 0.045,
    staticResistance: 0.055,
    bounceToRollSpeed: 0.72,
    spinRetention: 0.78,
  },
  rough: {
    restitution: 0.14,
    tangentialRetention: 0.58,
    rollingResistance: 2.15,
    rollingDrag: 0.22,
    staticResistance: 0.92,
    bounceToRollSpeed: 1.5,
    spinRetention: 0.42,
  },
  "deep-rough": {
    restitution: 0.055,
    tangentialRetention: 0.3,
    rollingResistance: 4.8,
    rollingDrag: 0.42,
    staticResistance: 1.8,
    bounceToRollSpeed: 2.8,
    spinRetention: 0.24,
  },
  sand: {
    restitution: 0.025,
    tangentialRetention: 0.22,
    rollingResistance: 5.8,
    rollingDrag: 0.5,
    staticResistance: 2.35,
    bounceToRollSpeed: 3.6,
    spinRetention: 0.16,
  },
  hard: {
    restitution: 0.56,
    tangentialRetention: 0.96,
    rollingResistance: 0.22,
    rollingDrag: 0.032,
    staticResistance: 0.045,
    bounceToRollSpeed: 0.52,
    spinRetention: 0.82,
  },
  rock: {
    restitution: 0.68,
    tangentialRetention: 0.97,
    rollingResistance: 0.3,
    rollingDrag: 0.035,
    staticResistance: 0.08,
    bounceToRollSpeed: 0.48,
    spinRetention: 0.86,
  },
  water: {
    restitution: 0.08,
    tangentialRetention: 0.3,
    rollingResistance: 8,
    rollingDrag: 1,
    staticResistance: 8,
    bounceToRollSpeed: 4,
    spinRetention: 0.12,
  },
});

export interface ShotPreset {
  readonly speed: number;
  readonly launchAngleDegrees: number;
  readonly backspin: number;
}

/**
 * Art/physics-lab shots, not a club or progression system. The hazard presets
 * are intentionally useful for deterministic screenshot scenarios.
 */
export const SHOT_PRESETS = Object.freeze({
  fairway: { speed: 35, launchAngleDegrees: 22, backspin: 185 },
  green: { speed: 24, launchAngleDegrees: 31, backspin: 235 },
  bunker: { speed: 20, launchAngleDegrees: 34, backspin: 205 },
  water: { speed: 28, launchAngleDegrees: 24, backspin: 170 },
} satisfies Readonly<Record<string, ShotPreset>>);

export type ShotPresetName = keyof typeof SHOT_PRESETS;

export interface ShotLaunchOptions {
  /** A visual-lab power multiplier. Values are clamped to 0.1-1.5. */
  readonly power?: number;
  /** Optionally place the ball before launching it. */
  readonly origin?: Vector3;
  /** Multiplies the preset's backspin. */
  readonly spinScale?: number;
  /** Spin around world-up, in radians per second. */
  readonly sideSpin?: number;
}

interface BallEventBase {
  readonly ballId: string;
  readonly time: number;
  readonly position: Vector3;
}

export interface BallLaunchedEvent extends BallEventBase {
  readonly type: "launched";
  readonly velocity: Vector3;
  readonly angularVelocity: Vector3;
  readonly preset?: ShotPresetName;
}

export interface BallTerrainImpactEvent extends BallEventBase {
  readonly type: "terrain-impact";
  readonly surface: BallSurface;
  readonly normal: Vector3;
  readonly impactSpeed: number;
  readonly velocityBefore: Vector3;
  readonly velocityAfter: Vector3;
  /** Useful for choosing between a subtle dent and a stronger sand mark. */
  readonly buried: boolean;
}

export interface BallEnteredBunkerEvent extends BallEventBase {
  readonly type: "bunker-entered";
  readonly speed: number;
}

export interface BallLeftBunkerEvent extends BallEventBase {
  readonly type: "bunker-left";
  readonly speed: number;
}

export interface BallEnteredWaterEvent extends BallEventBase {
  readonly type: "water-entered";
  readonly entryVelocity: Vector3;
  readonly waterLevel: number;
  /** Normalized 0-1 value for restrained splash/ripple effects. */
  readonly intensity: number;
}

export interface BallSkippedWaterEvent extends BallEventBase {
  readonly type: "water-skipped";
  readonly velocityAfter: Vector3;
  readonly waterLevel: number;
  readonly intensity: number;
}

export interface BallCameToRestEvent extends BallEventBase {
  readonly type: "came-to-rest";
  readonly surface: BallSurface;
  readonly submerged: boolean;
}

export type BallEvent =
  | BallLaunchedEvent
  | BallTerrainImpactEvent
  | BallEnteredBunkerEvent
  | BallLeftBunkerEvent
  | BallEnteredWaterEvent
  | BallSkippedWaterEvent
  | BallCameToRestEvent;

export type BallEventSink = (event: BallEvent) => void;

export interface BallPhysicsOptions {
  readonly id?: string;
  readonly initialPosition?: Vector3;
  readonly radius?: number;
  readonly gravity?: number;
  readonly fixedStep?: number;
  readonly maxCatchUpSteps?: number;
  readonly airDrag?: number;
  readonly magnusCoefficient?: number;
  readonly flightSpinDamping?: number;
  readonly waterDrag?: number;
  readonly waterSinkAcceleration?: number;
  readonly restSpeed?: number;
  readonly restDelay?: number;
  readonly surfaceResponses?: Partial<
    Record<BallSurface, Partial<BallSurfaceResponse>>
  >;
  readonly onEvent?: BallEventSink;
}

export interface BallSnapshot {
  readonly id: string;
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly angularVelocity: Vector3;
  readonly orientation: Quaternion;
  readonly motion: BallMotionState;
  readonly surface: BallSurface;
  readonly sleeping: boolean;
  readonly submerged: boolean;
}

interface TerrainHit {
  readonly t: number;
  readonly height: number;
  readonly normal: Vector3;
  readonly surface: BallSurface;
  readonly waterLevel?: number;
}

interface WaterHit {
  readonly t: number;
  readonly waterLevel: number;
}

const UP = new Vector3(0, 1, 0);
const FALLBACK_DIRECTION = new Vector3(0, 0, 1);
const ZERO = new Vector3();
const SWEEP_PROBES = 4;
const SWEEP_REFINEMENTS = 9;
const CONTACT_SKIN = 0.0015;
let nextBallId = 1;

/**
 * A small deterministic golf-ball solver for the Milestone 1 style lab.
 *
 * Call `advance(frameDelta)` when the class owns its accumulator, or call
 * `step(BALL_FIXED_STEP)` from an application-level fixed simulation clock.
 */
export class GolfBallSimulation {
  public readonly id: string;
  public readonly position = new Vector3();
  public readonly previousPosition = new Vector3();
  public readonly velocity = new Vector3();
  public readonly angularVelocity = new Vector3();
  public readonly orientation = new Quaternion();
  public readonly wind = new Vector3();

  public motion: BallMotionState = "resting";
  public surface: BallSurface = "fairway";
  public sleeping = true;
  public submerged = false;

  public readonly radius: number;
  public readonly fixedStep: number;

  private readonly terrain: BallTerrainQuery;
  private readonly gravity: number;
  private readonly maxCatchUpSteps: number;
  private readonly airDrag: number;
  private readonly magnusCoefficient: number;
  private readonly flightSpinDamping: number;
  private readonly waterDrag: number;
  private readonly waterSinkAcceleration: number;
  private readonly restSpeed: number;
  private readonly restDelay: number;
  private readonly responses: Record<BallSurface, BallSurfaceResponse>;

  private eventSink?: BallEventSink;
  private accumulator = 0;
  private simulationTime = 0;
  private restTimer = 0;
  private waterSkips = 0;
  private activeWaterLevel = 0;

  private readonly candidate = new Vector3();
  private readonly relativeAir = new Vector3();
  private readonly acceleration = new Vector3();
  private readonly contactNormal = new Vector3();
  private readonly tangent = new Vector3();
  private readonly normalComponent = new Vector3();
  private readonly slopeAcceleration = new Vector3();
  private readonly rollSpin = new Vector3();
  private readonly shotDirection = new Vector3();
  private readonly shotVelocity = new Vector3();
  private readonly shotSpin = new Vector3();
  private readonly sweepPoint = new Vector3();
  private readonly rotationAxis = new Vector3();
  private readonly rotationDelta = new Quaternion();

  public constructor(terrain: BallTerrainQuery, options: BallPhysicsOptions = {}) {
    this.terrain = terrain;
    this.id = options.id ?? `ball-${nextBallId++}`;
    const restoredSequence = /^ball-(\d+)$/.exec(this.id);
    if (restoredSequence) nextBallId = Math.max(nextBallId, Number(restoredSequence[1]) + 1);
    this.radius = options.radius ?? 0.12;
    this.gravity = options.gravity ?? 9.81;
    this.fixedStep = options.fixedStep ?? BALL_FIXED_STEP;
    this.maxCatchUpSteps = options.maxCatchUpSteps ?? 24;
    this.airDrag = options.airDrag ?? 0.0074;
    this.magnusCoefficient = options.magnusCoefficient ?? 0.000052;
    this.flightSpinDamping = options.flightSpinDamping ?? 0.085;
    this.waterDrag = options.waterDrag ?? 5.2;
    this.waterSinkAcceleration = options.waterSinkAcceleration ?? 2.1;
    this.restSpeed = options.restSpeed ?? 0.11;
    this.restDelay = options.restDelay ?? 0.42;
    this.eventSink = options.onEvent;

    this.responses = {} as Record<BallSurface, BallSurfaceResponse>;
    for (const surface of BALL_SURFACES) {
      this.responses[surface] = {
        ...DEFAULT_SURFACE_RESPONSES[surface],
        ...options.surfaceResponses?.[surface],
      };
    }

    this.place(options.initialPosition ?? ZERO);
  }

  public setEventSink(sink?: BallEventSink): void {
    this.eventSink = sink;
  }

  /** Place a quiet ball. By default its Y position is snapped to the terrain. */
  public place(worldPosition: Vector3, snapToTerrain = true): void {
    this.position.copy(worldPosition);
    const sample = this.terrain.sample(this.position.x, this.position.z);
    this.copyUpwardNormal(sample.normal, this.contactNormal);
    if (snapToTerrain) {
      this.position.y = this.contactCenterY(sample.height, this.contactNormal);
    }

    this.previousPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.orientation.identity();
    this.motion = "resting";
    this.surface = sample.surface;
    this.sleeping = true;
    this.submerged = false;
    this.accumulator = 0;
    this.restTimer = 0;
    this.waterSkips = 0;
  }

  /** Launch with explicit world-space linear and angular velocity. */
  public launch(linearVelocity: Vector3, spin: Vector3 = ZERO): void {
    this.launchInternal(linearVelocity, spin);
  }

  /** Launch one of the deterministic visual-lab scenarios. */
  public launchPreset(
    presetName: ShotPresetName,
    direction: Vector3,
    options: ShotLaunchOptions = {},
  ): void {
    if (options.origin !== undefined) {
      this.place(options.origin);
    }

    const preset = SHOT_PRESETS[presetName];
    const power = MathUtils.clamp(options.power ?? 1, 0.1, 1.5);
    const spinScale = Math.max(0, options.spinScale ?? 1);

    this.shotDirection.set(direction.x, 0, direction.z);
    if (this.shotDirection.lengthSq() < 1e-8) {
      this.shotDirection.copy(FALLBACK_DIRECTION);
    } else {
      this.shotDirection.normalize();
    }

    const launchAngle = MathUtils.degToRad(preset.launchAngleDegrees);
    const speed = preset.speed * power;
    this.shotVelocity
      .copy(this.shotDirection)
      .multiplyScalar(Math.cos(launchAngle) * speed);
    this.shotVelocity.y = Math.sin(launchAngle) * speed;

    // direction x up gives the backspin axis that produces upward Magnus lift.
    this.shotSpin
      .crossVectors(this.shotDirection, UP)
      .normalize()
      .multiplyScalar(preset.backspin * spinScale);
    this.shotSpin.y += options.sideSpin ?? 0;

    this.launchInternal(this.shotVelocity, this.shotSpin, presetName);
  }

  /**
   * Advance with a render-frame delta. Returns the interpolation alpha between
   * `previousPosition` and `position`.
   */
  public advance(frameDeltaSeconds: number): number {
    if (!Number.isFinite(frameDeltaSeconds) || frameDeltaSeconds <= 0) {
      return this.accumulator / this.fixedStep;
    }

    this.accumulator += Math.min(frameDeltaSeconds, 0.25);
    let steps = 0;
    while (
      this.accumulator + Number.EPSILON >= this.fixedStep &&
      steps < this.maxCatchUpSteps
    ) {
      this.step(this.fixedStep);
      this.accumulator -= this.fixedStep;
      steps += 1;
    }

    if (steps === this.maxCatchUpSteps && this.accumulator >= this.fixedStep) {
      // Prevent a permanent spiral after a suspended/backgrounded tab.
      this.accumulator %= this.fixedStep;
    }

    return MathUtils.clamp(this.accumulator / this.fixedStep, 0, 1);
  }

  /** Simulate an exact interval. Fixed callers should normally pass 1/120. */
  public step(deltaSeconds = this.fixedStep): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return;
    }

    let remaining = deltaSeconds;
    while (remaining > 1e-9) {
      const substep = Math.min(remaining, this.fixedStep);
      this.simulationTime += substep;
      this.simulateSubstep(substep);
      remaining -= substep;
    }
  }

  public getInterpolatedPosition(alpha: number, target = new Vector3()): Vector3 {
    return target
      .copy(this.previousPosition)
      .lerp(this.position, MathUtils.clamp(alpha, 0, 1));
  }

  public snapshot(): BallSnapshot {
    return {
      id: this.id,
      position: this.position.clone(),
      velocity: this.velocity.clone(),
      angularVelocity: this.angularVelocity.clone(),
      orientation: this.orientation.clone(),
      motion: this.motion,
      surface: this.surface,
      sleeping: this.sleeping,
      submerged: this.submerged,
    };
  }

  private launchInternal(
    linearVelocity: Vector3,
    spin: Vector3,
    preset?: ShotPresetName,
  ): void {
    this.previousPosition.copy(this.position);
    this.velocity.copy(linearVelocity);
    this.angularVelocity.copy(spin);
    this.motion = "flight";
    this.sleeping = false;
    this.submerged = false;
    this.restTimer = 0;
    this.waterSkips = 0;

    this.emit({
      type: "launched",
      ballId: this.id,
      time: this.simulationTime,
      position: this.position.clone(),
      velocity: this.velocity.clone(),
      angularVelocity: this.angularVelocity.clone(),
      ...(preset === undefined ? {} : { preset }),
    });
  }

  private simulateSubstep(deltaSeconds: number): void {
    this.previousPosition.copy(this.position);
    if (this.sleeping) {
      return;
    }

    switch (this.motion) {
      case "flight":
        this.stepFlight(deltaSeconds);
        break;
      case "rolling":
        this.stepRolling(deltaSeconds);
        break;
      case "submerged":
        this.stepSubmerged(deltaSeconds);
        break;
      case "resting":
        this.sleeping = true;
        break;
    }

    this.integrateOrientation(deltaSeconds);
  }

  private stepFlight(deltaSeconds: number): void {
    this.relativeAir.copy(this.velocity).sub(this.wind);
    const relativeSpeed = this.relativeAir.length();

    this.acceleration.set(0, -this.gravity, 0);
    if (relativeSpeed > 1e-6) {
      this.acceleration.addScaledVector(
        this.relativeAir,
        -this.airDrag * relativeSpeed,
      );
      this.tangent
        .crossVectors(this.angularVelocity, this.relativeAir)
        .multiplyScalar(this.magnusCoefficient);
      this.acceleration.add(this.tangent);
    }

    this.velocity.addScaledVector(this.acceleration, deltaSeconds);
    this.angularVelocity.multiplyScalar(
      Math.exp(-this.flightSpinDamping * deltaSeconds),
    );
    this.candidate.copy(this.position).addScaledVector(this.velocity, deltaSeconds);

    const waterHit = this.findWaterHit(this.position, this.candidate);
    if (waterHit !== null) {
      this.resolveWaterHit(waterHit);
      return;
    }

    const terrainHit = this.findTerrainHit(this.position, this.candidate);
    if (terrainHit !== null) {
      this.resolveTerrainImpact(terrainHit);
      return;
    }

    this.position.copy(this.candidate);
  }

  private stepRolling(deltaSeconds: number): void {
    let sample = this.terrain.sample(this.position.x, this.position.z);
    if (sample.surface === "water") {
      this.enterWaterAtCurrentPosition(sample);
      return;
    }

    this.updateSurface(sample.surface);
    let response = this.responses[this.surface];
    this.copyUpwardNormal(sample.normal, this.contactNormal);
    this.position.y = this.contactCenterY(sample.height, this.contactNormal);

    // Constrain velocity and gravity to the local tangent plane.
    this.velocity.addScaledVector(
      this.contactNormal,
      -this.velocity.dot(this.contactNormal),
    );
    this.slopeAcceleration
      .set(0, -this.gravity, 0)
      .addScaledVector(
        this.contactNormal,
        this.gravity * this.contactNormal.y,
      );

    const initialSpeed = this.velocity.length();
    const slopeStrength = this.slopeAcceleration.length();
    const heldByStaticFriction =
      initialSpeed < this.restSpeed && slopeStrength <= response.staticResistance;

    if (!heldByStaticFriction) {
      this.velocity.addScaledVector(this.slopeAcceleration, deltaSeconds);
    }

    let speed = this.velocity.length();
    if (speed > 1e-7) {
      const resistance =
        response.rollingResistance + response.rollingDrag * speed;
      const nextSpeed = Math.max(0, speed - resistance * deltaSeconds);
      this.velocity.multiplyScalar(nextSpeed / speed);
      speed = nextSpeed;
    } else {
      this.velocity.set(0, 0, 0);
      speed = 0;
    }

    this.candidate.copy(this.position).addScaledVector(this.velocity, deltaSeconds);
    sample = this.terrain.sample(this.candidate.x, this.candidate.z);
    this.position.copy(this.candidate);

    if (sample.surface === "water") {
      this.enterWaterAtCurrentPosition(sample);
      return;
    }

    this.updateSurface(sample.surface);
    response = this.responses[this.surface];
    this.copyUpwardNormal(sample.normal, this.contactNormal);
    this.position.y = this.contactCenterY(sample.height, this.contactNormal);
    this.velocity.addScaledVector(
      this.contactNormal,
      -this.velocity.dot(this.contactNormal),
    );

    this.rollSpin
      .crossVectors(this.contactNormal, this.velocity)
      .multiplyScalar(1 / this.radius);
    this.angularVelocity.lerp(
      this.rollSpin,
      Math.min(1, deltaSeconds * 14),
    );

    speed = this.velocity.length();
    this.slopeAcceleration
      .set(0, -this.gravity, 0)
      .addScaledVector(
        this.contactNormal,
        this.gravity * this.contactNormal.y,
      );
    const canSettle =
      speed <= this.restSpeed &&
      this.slopeAcceleration.length() <= response.staticResistance;

    if (canSettle) {
      this.restTimer += deltaSeconds;
      if (this.restTimer >= this.restDelay) {
        this.comeToRest(this.surface, false);
      }
    } else if (speed > this.restSpeed * 1.75) {
      this.restTimer = 0;
    } else {
      this.restTimer = Math.max(0, this.restTimer - deltaSeconds * 0.5);
    }
  }

  private stepSubmerged(deltaSeconds: number): void {
    const damping = Math.exp(-this.waterDrag * deltaSeconds);
    this.velocity.multiplyScalar(damping);
    this.velocity.y -= this.waterSinkAcceleration * deltaSeconds;
    this.angularVelocity.multiplyScalar(Math.exp(-3.5 * deltaSeconds));
    this.candidate.copy(this.position).addScaledVector(this.velocity, deltaSeconds);

    const sample = this.terrain.sample(this.candidate.x, this.candidate.z);
    if (sample.surface === "water" && sample.waterLevel !== undefined) {
      this.activeWaterLevel = sample.waterLevel;
    }

    this.copyUpwardNormal(sample.normal, this.contactNormal);
    const bottomY = this.contactCenterY(sample.height, this.contactNormal);
    this.position.copy(this.candidate);
    // Keep a sinking ball below the water plane even if an aggressive launch
    // step placed its centre just above it.
    this.position.y = Math.min(
      this.position.y,
      this.activeWaterLevel + this.radius * 0.35,
    );

    if (this.position.y <= bottomY) {
      this.position.y = bottomY;
      this.velocity.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
      this.comeToRest("water", true);
    }
  }

  private findTerrainHit(start: Vector3, end: Vector3): TerrainHit | null {
    const startSample = this.terrain.sample(start.x, start.z);
    let priorT = 0;
    let priorClearance = this.terrainClearance(start, startSample);
    let low = 0;
    let high = 0;
    let found = false;

    for (let probe = 1; probe <= SWEEP_PROBES; probe += 1) {
      const t = probe / SWEEP_PROBES;
      this.sweepPoint.lerpVectors(start, end, t);
      const sample = this.terrain.sample(this.sweepPoint.x, this.sweepPoint.z);
      const clearance =
        sample.surface === "water"
          ? Number.POSITIVE_INFINITY
          : this.terrainClearance(this.sweepPoint, sample);

      if (clearance <= 0 && (priorClearance > 0 || priorT === 0)) {
        low = priorT;
        high = t;
        found = true;
        break;
      }

      priorT = t;
      priorClearance = clearance;
    }

    if (!found) {
      return null;
    }

    for (let refinement = 0; refinement < SWEEP_REFINEMENTS; refinement += 1) {
      const mid = (low + high) * 0.5;
      this.sweepPoint.lerpVectors(start, end, mid);
      const sample = this.terrain.sample(this.sweepPoint.x, this.sweepPoint.z);
      const clearance =
        sample.surface === "water"
          ? Number.POSITIVE_INFINITY
          : this.terrainClearance(this.sweepPoint, sample);
      if (clearance <= 0) {
        high = mid;
      } else {
        low = mid;
      }
    }

    this.sweepPoint.lerpVectors(start, end, high);
    const hitSample = this.terrain.sample(this.sweepPoint.x, this.sweepPoint.z);
    this.copyUpwardNormal(hitSample.normal, this.contactNormal);
    return {
      t: high,
      height: hitSample.height,
      normal: this.contactNormal.clone(),
      surface: hitSample.surface,
      ...(hitSample.waterLevel === undefined
        ? {}
        : { waterLevel: hitSample.waterLevel }),
    };
  }

  private findWaterHit(start: Vector3, end: Vector3): WaterHit | null {
    let low = 0;
    let high = 0;
    let found = false;

    for (let probe = 1; probe <= SWEEP_PROBES; probe += 1) {
      const t = probe / SWEEP_PROBES;
      this.sweepPoint.lerpVectors(start, end, t);
      const sample = this.terrain.sample(this.sweepPoint.x, this.sweepPoint.z);
      if (this.isBelowWaterSurface(this.sweepPoint, sample)) {
        low = (probe - 1) / SWEEP_PROBES;
        high = t;
        found = true;
        break;
      }
    }

    if (!found) {
      return null;
    }

    for (let refinement = 0; refinement < SWEEP_REFINEMENTS; refinement += 1) {
      const mid = (low + high) * 0.5;
      this.sweepPoint.lerpVectors(start, end, mid);
      const sample = this.terrain.sample(this.sweepPoint.x, this.sweepPoint.z);
      if (this.isBelowWaterSurface(this.sweepPoint, sample)) {
        high = mid;
      } else {
        low = mid;
      }
    }

    this.sweepPoint.lerpVectors(start, end, high);
    const sample = this.terrain.sample(this.sweepPoint.x, this.sweepPoint.z);
    return { t: high, waterLevel: this.waterLevel(sample) };
  }

  private resolveTerrainImpact(hit: TerrainHit): void {
    this.position.lerpVectors(this.position, this.candidate, hit.t);
    this.contactNormal.copy(hit.normal);
    this.position.y = Math.max(
      this.position.y,
      this.contactCenterY(hit.height, this.contactNormal),
    );

    const velocityBefore = this.velocity.clone();
    this.updateSurface(hit.surface);
    const response = this.responses[this.surface];
    const normalVelocity = this.velocity.dot(this.contactNormal);
    const impactSpeed = Math.max(0, -normalVelocity);

    this.tangent
      .copy(this.velocity)
      .addScaledVector(this.contactNormal, -normalVelocity);
    this.normalComponent
      .copy(this.contactNormal)
      .multiplyScalar(-normalVelocity * response.restitution);
    this.velocity
      .copy(this.tangent)
      .multiplyScalar(response.tangentialRetention)
      .add(this.normalComponent);
    this.angularVelocity.multiplyScalar(response.spinRetention);

    const buried = this.surface === "sand" && impactSpeed >= 4.2;
    this.emit({
      type: "terrain-impact",
      ballId: this.id,
      time: this.simulationTime,
      position: this.position.clone(),
      surface: this.surface,
      normal: this.contactNormal.clone(),
      impactSpeed,
      velocityBefore,
      velocityAfter: this.velocity.clone(),
      buried,
    });

    const reboundSpeed = Math.max(0, this.velocity.dot(this.contactNormal));
    const forcedSettle = this.surface === "sand" || this.surface === "deep-rough";
    if (forcedSettle || reboundSpeed <= response.bounceToRollSpeed) {
      this.motion = "rolling";
      this.velocity.addScaledVector(
        this.contactNormal,
        -this.velocity.dot(this.contactNormal),
      );
      if (buried) {
        this.velocity.multiplyScalar(0.2);
      }
      this.restTimer = 0;
    } else {
      this.motion = "flight";
      this.position.addScaledVector(this.contactNormal, CONTACT_SKIN);
    }
  }

  private resolveWaterHit(hit: WaterHit): void {
    this.position.lerpVectors(this.position, this.candidate, hit.t);
    this.position.y = hit.waterLevel + this.radius + CONTACT_SKIN;
    const entryVelocity = this.velocity.clone();
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const downwardSpeed = Math.max(0, -this.velocity.y);
    const intensity = MathUtils.clamp(this.velocity.length() / 38, 0.08, 1);
    const canSkip =
      this.waterSkips < 2 &&
      horizontalSpeed >= 17 &&
      downwardSpeed <= Math.max(3.2, horizontalSpeed * 0.13);

    this.updateSurface("water");
    this.activeWaterLevel = hit.waterLevel;

    if (canSkip) {
      this.velocity.x *= 0.78;
      this.velocity.z *= 0.78;
      this.velocity.y = Math.max(1.1, downwardSpeed * 0.2);
      this.angularVelocity.multiplyScalar(0.62);
      this.motion = "flight";
      this.waterSkips += 1;
      this.emit({
        type: "water-skipped",
        ballId: this.id,
        time: this.simulationTime,
        position: this.position.clone(),
        velocityAfter: this.velocity.clone(),
        waterLevel: hit.waterLevel,
        intensity,
      });
      return;
    }

    this.motion = "submerged";
    this.submerged = true;
    this.velocity.multiplyScalar(0.22);
    this.velocity.y = Math.min(this.velocity.y, -0.35);
    this.angularVelocity.multiplyScalar(0.2);
    this.emit({
      type: "water-entered",
      ballId: this.id,
      time: this.simulationTime,
      position: this.position.clone(),
      entryVelocity,
      waterLevel: hit.waterLevel,
      intensity,
    });
  }

  private enterWaterAtCurrentPosition(sample: BallTerrainSample): void {
    const waterLevel = this.waterLevel(sample);
    this.activeWaterLevel = waterLevel;
    const entryVelocity = this.velocity.clone();
    this.updateSurface("water");
    this.motion = "submerged";
    this.submerged = true;
    this.position.y = Math.min(
      this.position.y,
      waterLevel + this.radius * 0.35,
    );
    this.velocity.multiplyScalar(0.2);
    this.velocity.y = Math.min(this.velocity.y, -0.25);
    this.angularVelocity.multiplyScalar(0.2);
    this.emit({
      type: "water-entered",
      ballId: this.id,
      time: this.simulationTime,
      position: this.position.clone(),
      entryVelocity,
      waterLevel,
      intensity: MathUtils.clamp(entryVelocity.length() / 24, 0.06, 0.55),
    });
  }

  private updateSurface(nextSurface: BallSurface): void {
    if (nextSurface === this.surface) {
      return;
    }

    if (this.surface === "sand" && nextSurface !== "sand") {
      this.emit({
        type: "bunker-left",
        ballId: this.id,
        time: this.simulationTime,
        position: this.position.clone(),
        speed: this.velocity.length(),
      });
    }

    this.surface = nextSurface;
    if (nextSurface === "sand") {
      this.emit({
        type: "bunker-entered",
        ballId: this.id,
        time: this.simulationTime,
        position: this.position.clone(),
        speed: this.velocity.length(),
      });
    }
  }

  private comeToRest(surface: BallSurface, underwater: boolean): void {
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.motion = underwater ? "submerged" : "resting";
    this.surface = surface;
    this.sleeping = true;
    this.submerged = underwater;
    this.emit({
      type: "came-to-rest",
      ballId: this.id,
      time: this.simulationTime,
      position: this.position.clone(),
      surface,
      submerged: underwater,
    });
  }

  private terrainClearance(
    point: Vector3,
    sample: BallTerrainSample,
  ): number {
    this.copyUpwardNormal(sample.normal, this.contactNormal);
    return (
      (point.y - sample.height) * Math.max(0.16, this.contactNormal.y) -
      this.radius
    );
  }

  private contactCenterY(height: number, normal: Vector3): number {
    return height + this.radius / Math.max(0.16, normal.y) + CONTACT_SKIN;
  }

  private isBelowWaterSurface(
    point: Vector3,
    sample: BallTerrainSample,
  ): boolean {
    return (
      sample.surface === "water" &&
      point.y - this.radius <= this.waterLevel(sample)
    );
  }

  private waterLevel(sample: BallTerrainSample): number {
    return sample.waterLevel ?? sample.height + 0.35;
  }

  private copyUpwardNormal(source: Vector3, target: Vector3): void {
    target.copy(source);
    if (
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y) ||
      !Number.isFinite(target.z) ||
      target.lengthSq() < 1e-10
    ) {
      target.copy(UP);
      return;
    }

    target.normalize();
    if (target.y < 0) {
      target.negate();
    }
  }

  private integrateOrientation(deltaSeconds: number): void {
    const angularSpeed = this.angularVelocity.length();
    if (angularSpeed <= 1e-7) {
      return;
    }

    this.rotationAxis.copy(this.angularVelocity).multiplyScalar(1 / angularSpeed);
    this.rotationDelta.setFromAxisAngle(
      this.rotationAxis,
      angularSpeed * deltaSeconds,
    );
    this.orientation.premultiply(this.rotationDelta).normalize();
  }

  private emit(event: BallEvent): void {
    this.eventSink?.(event);
  }
}
