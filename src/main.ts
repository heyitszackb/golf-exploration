import * as THREE from 'three';
import './style.css';
import {
  BALL_FIXED_STEP,
  GolfBallSimulation,
  type BallEvent,
  type BallSurface,
  type ShotPresetName,
} from './simulation/ball';
import { IllustratedWorld } from './render/illustrated-world';
import { POND_WATER_LEVEL, type CourseSurface } from './world/course';
import { propertyField } from './world/property-field';
import { PROPERTY_BLUEPRINT, PROPERTY_SCHEMA_ID } from './world/property-blueprint';
import { PropertyChunkStreamer } from './world/property-streamer';
import {
  GolferController,
  type GolferTraversalResult,
  type LocomotionEvent,
} from './simulation/golfer-controller';
import { CartController, type CartTraversalResult } from './simulation/cart-controller';
import { TraceJournal, type NewTraceEvent } from './world/trace-journal';
import { WorldAudio } from './audio/world-audio';
import { WorldEventBus } from './core/world-events';
import { ART_LIMITS, ART_PALETTE } from './render/art-style';
import { IllustrationLighting } from './render/illustration-lighting';
import { SwingSequence, type SwingPhase } from './simulation/swing-sequence';
import {
  SessionStore,
  type WorldSessionV1,
} from './persistence/session-store';

const CAMERA_VERTICAL_SPAN = 36;
const CAMERA_OFFSET = new THREE.Vector3(27, 104, -62);

type LabFocus = 'tee' | 'hill' | 'water' | 'green' | 'bank' | 'property';

interface PerformanceStats {
  fps: number;
  frameMs: number;
  calls: number;
  triangles: number;
  points: number;
}

interface StyleLabApi {
  readonly ready: boolean;
  readonly cameraContract: Readonly<{
    projection: 'orthographic';
    verticalSpan: number;
    yawLocked: true;
    pitchLocked: true;
    zoomLocked: true;
    ballFollow: false;
  }>;
  focus(area: LabFocus): void;
  shoot(preset?: ShotPresetName): void;
  reset(): void;
  simulate(seconds: number): void;
  captureMode(enabled: boolean): void;
  diagnostics(visible: boolean): void;
  moveTo(x: number, z: number): void;
  setMoveTarget(x: number, z: number): void;
  releaseMove(): void;
  interact(): void;
  placeBall(): boolean;
  placeBallAt(x: number, z: number): string;
  pause(visible: boolean): void;
  save(): Promise<boolean>;
  clearSave(): Promise<void>;
  state(): {
    focus: LabFocus;
    golfer: number[];
    ball: number[];
    motion: string;
    surface: string;
    sleeping: boolean;
    submerged: boolean;
    eventTypes: string[];
    golfEventTypes: string[];
    camera: { position: number[]; quaternion: number[]; zoom: number };
    foundation: {
      propertySchemaId: string;
      primaryChunk: string;
      activeChunks: number;
      activeChunkKeys: readonly string[];
      renderedChunks: number;
      renderedGrassChunks: number;
      rapierVersion: string;
      streamedColliders: number;
      totalColliders: number;
      groundQueryDelta: number | null;
      persistenceStatus: string;
      lastSavedAt: number | null;
      restoredSession: boolean;
    };
    traversal: {
      mode: 'walking' | 'driving' | 'stance';
      speed: number;
      surface: string;
      blocked: boolean;
      golferHeading: number;
      cart: number[];
      cartHeading: number;
      cursorTarget: number[] | null;
      balls: number;
      addressedBallId: string | null;
      swingPower: number;
      swingPhase: SwingPhase;
      swingProgress: number;
      swingShotHeading: number;
      swingBodyHeading: number;
      cartVisualForward: number[];
      clubHead: number[];
    };
    environment: {
      paused: boolean;
      traces: number;
      traceChunks: number;
      traceTypes: Record<string, number>;
      audioStatus: string;
      audioVoices: number;
      accessibility: typeof accessibilitySettings;
      weather: string;
      weatherIntensity: number;
      wind: number[];
      ambientBirds: number;
      ambientFlocks: number;
      airborneBirds: number;
      surfaceInteractions: number;
    };
    performance: PerformanceStats;
  };
}

declare global {
  interface Window {
    __STYLE_LAB__?: StyleLabApi;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#world');
const loading = document.querySelector<HTMLDivElement>('#loading');
const diagnostics = document.querySelector<HTMLOutputElement>('#diagnostics');
const pausePanel = document.querySelector<HTMLElement>('#pause-panel');
const resumeButton = document.querySelector<HTMLButtonElement>('#resume-button');
const contrastSetting = document.querySelector<HTMLInputElement>('#setting-contrast');
const ballSizeSetting = document.querySelector<HTMLInputElement>('#setting-ball-size');
const reducedMotionSetting = document.querySelector<HTMLInputElement>('#setting-reduced-motion');
const soundSetting = document.querySelector<HTMLInputElement>('#setting-sound');

if (!canvas || !loading || !diagnostics || !pausePanel || !resumeButton
    || !contrastSetting || !ballSizeSetting || !reducedMotionSetting || !soundSetting) {
  throw new Error('The illustration laboratory shell is incomplete.');
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(ART_PALETTE.paper, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, ART_LIMITS.maximumDevicePixelRatio));

const scene = new THREE.Scene();
scene.background = new THREE.Color(ART_PALETTE.paper);
const environmentPaperColor = new THREE.Color(ART_PALETTE.paper);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 520);
const cameraTarget = new THREE.Vector3();
const audioForward = new THREE.Vector3();
const audioUp = new THREE.Vector3();
const fixedCameraQuaternion = new THREE.Quaternion();
{
  // Cameras look down local -Z; using a generic Object3D here would point the
  // view exactly backwards even though the quaternion appears well formed.
  const orientationProbe = new THREE.OrthographicCamera();
  orientationProbe.position.copy(CAMERA_OFFSET);
  orientationProbe.lookAt(0, 0, 0);
  fixedCameraQuaternion.copy(orientationProbe.quaternion);
}

const streamer = new PropertyChunkStreamer();
const world = new IllustratedWorld(streamer);
scene.add(world.root);
const lighting = new IllustrationLighting();
scene.add(lighting.root);

loading.textContent = 'Surveying the property…';
const sessionStore = new SessionStore();
const [propertyPhysics, restoredSession] = await Promise.all([
  import('./physics/property-physics')
    .then(({ PropertyPhysics }) => PropertyPhysics.create(streamer)),
  sessionStore.load(),
]);
propertyPhysics.createKinematicAgent('golfer', world.golfer.position, {
  radius: 0.28,
  halfHeight: 0.55,
  stepHeight: 0.28,
  maxSlopeRadians: Math.PI * 0.235,
});
propertyPhysics.createKinematicAgent('cart', world.cart.position, {
  radius: 0.74,
  halfHeight: 0.38,
  stepHeight: 0.2,
  maxSlopeRadians: Math.PI * 0.19,
});
const worldAudio = new WorldAudio();
const worldEvents = new WorldEventBus();
worldEvents.subscribe((event) => world.handleWorldEvent(event));
worldEvents.subscribe((event) => worldAudio.handleWorldEvent(event));

function mapSurface(surface: CourseSurface): BallSurface {
  switch (surface) {
    case 'deepRough': return 'deep-rough';
    case 'bunker': return 'sand';
    case 'bank': return 'rough';
    case 'cliff': return 'rock';
    default: return surface;
  }
}

const terrainQuery = {
  sample(x: number, z: number) {
    const sample = propertyField.sample(x, z);
    return {
      height: sample.height,
      normal: new THREE.Vector3(sample.normal.x, sample.normal.y, sample.normal.z),
      surface: mapSurface(sample.surface),
      ...(sample.surface === 'water' ? { waterLevel: sample.height + sample.waterDepth } : {}),
    };
  },
};

const recentEvents: BallEvent[] = [];
const lastMarkedImpactTimeByBall = new Map<string, number>();
const simulation = new GolfBallSimulation(terrainQuery, {
  initialPosition: new THREE.Vector3(0.42, propertyField.heightAt(0.42, -60.9), -60.9),
  onEvent: handleBallEvent,
});
const balls: GolfBallSimulation[] = [simulation];
world.bindPrimaryBall(simulation.id);
let addressedBall: GolfBallSimulation | null = null;
let swingPower = 0;
let swingPointerStart: Readonly<{ x: number; y: number }> | null = null;
let stanceTarget: THREE.Vector3 | null = null;
const swingSequence = new SwingSequence();
const golfDomainEvents: string[] = [];

const locomotionEvents: string[] = [];
const pendingFootsteps: Array<{ event: LocomotionEvent; surface: CourseSurface }> = [];
const traceJournal = new TraceJournal();
function recordTrace(event: NewTraceEvent): void {
  traceJournal.add(event);
}
const golferController = new GolferController(propertyPhysics, (event, surface) => {
  pendingFootsteps.push({ event, surface });
});

function flushFootsteps(): void {
  for (const { event, surface } of pendingFootsteps.splice(0)) {
    locomotionEvents.push(`${event}:${surface}`);
    if (locomotionEvents.length > 24) locomotionEvents.shift();
    const position = world.golfer.position.clone();
    const strength = surface === 'bunker' ? 0.95 : surface === 'deepRough' ? 0.42 : 0.62;
    recordTrace({
      type: 'footprint',
      x: position.x,
      y: propertyField.heightAt(position.x, position.z),
      z: position.z,
      directionX: Math.sin(world.golfer.rotation.y),
      directionZ: Math.cos(world.golfer.rotation.y),
      scale: 0.24,
      strength,
      lifetime: 'session',
    });
    world.addFootprint(position, world.golfer.rotation.y, strength);
    worldEvents.emit({ type: 'footstep', position, surface, strength });
  }
}
const cartController = new CartController(propertyPhysics);
let playerMode: 'walking' | 'driving' | 'stance' = 'walking';
let pointerTarget: Readonly<{ x: number; z: number }> | null = null;
let activePointerId: number | null = null;
let traversalAccumulator = 0;
let lastCartTrackPosition = world.cart.position.clone();
let golferTraversal: GolferTraversalResult = {
  x: world.golfer.position.x,
  y: world.golfer.position.y,
  z: world.golfer.position.z,
  heading: world.golfer.rotation.y,
  speed: 0,
  stridePhase: 0,
  surface: propertyField.sample(world.golfer.position.x, world.golfer.position.z).surface,
  slopeRadians: 0,
  grounded: true,
  blocked: false,
  leftFootHeight: world.golfer.position.y,
  rightFootHeight: world.golfer.position.y,
};
let cartTraversal: CartTraversalResult = {
  x: world.cart.position.x,
  y: world.cart.position.y,
  z: world.cart.position.z,
  heading: world.cart.rotation.y,
  speed: 0,
  surface: propertyField.sample(world.cart.position.x, world.cart.position.z).surface,
  blocked: false,
};
const traversalNormal = new THREE.Vector3(0, 1, 0);
const cartPreviousPosition = new THREE.Vector3();

let currentFocus: LabFocus = 'tee';
let diagnosticsVisible = false;
let manualCaptureMode = false;
let paused = false;
let accessibilitySettings = {
  highContrast: false,
  largerBalls: false,
  reducedMotion: false,
  strongerSound: false,
};
let previousTime = performance.now() / 1000;
let elapsed = 0;
let fpsElapsed = 0;
let fpsFrames = 0;
let movementSaveElapsed = 0;
let saveTimer: number | undefined;
let ballPlacementTimer: number | undefined;
let lastGroundQueryDelta: number | null = null;
const movementKeys = new Set<string>();
const movementCodes = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
  'ShiftLeft', 'ShiftRight',
]);
const debugControlsEnabled = import.meta.env.DEV
  && new URLSearchParams(window.location.search).has('debug');
let performanceStats: PerformanceStats = {
  fps: 0,
  frameMs: 0,
  calls: 0,
  triangles: 0,
  points: 0,
};

function makeSession(): WorldSessionV1 {
  return {
    id: 'autosave',
    schemaVersion: 1,
    propertySchemaId: PROPERTY_SCHEMA_ID,
    savedAt: Date.now(),
    golfer: {
      x: world.golfer.position.x,
      y: world.golfer.position.y,
      z: world.golfer.position.z,
      heading: world.golfer.rotation.y,
    },
    cart: {
      x: world.cart.position.x,
      y: world.cart.position.y,
      z: world.cart.position.z,
      heading: world.cart.rotation.y,
      parked: playerMode !== 'driving',
    },
    balls: balls.map((ball) => ({
      id: ball.id,
      position: { x: ball.position.x, y: ball.position.y, z: ball.position.z },
      velocity: { x: ball.velocity.x, y: ball.velocity.y, z: ball.velocity.z },
      angularVelocity: {
        x: ball.angularVelocity.x,
        y: ball.angularVelocity.y,
        z: ball.angularVelocity.z,
      },
      motion: ball.motion,
      surface: ball.surface,
      sleeping: ball.sleeping,
      submerged: ball.submerged,
    })),
    traces: traceJournal.all(),
    selectedClub: 'versatile',
    worldTimeSeconds: elapsed,
    weather: {
      kind: world.environmentState.weather,
      intensity: world.environmentState.intensity,
    },
    accessibility: { ...accessibilitySettings },
  };
}

async function saveSession(): Promise<boolean> {
  if (saveTimer !== undefined) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  return sessionStore.save(makeSession());
}

function scheduleSave(delay = 700): void {
  if (saveTimer !== undefined) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    void saveSession();
  }, delay);
}

function handleBallEvent(event: BallEvent): void {
  recentEvents.push(event);
  if (recentEvents.length > 32) recentEvents.shift();

  if (event.type === 'launched') {
    worldEvents.emit({
      type: 'ball-launched',
      ballId: event.ballId,
      position: event.position,
      strength: THREE.MathUtils.clamp(event.velocity.length() / 55, 0.1, 1),
    });
    return;
  }

  if (event.type === 'came-to-rest') scheduleSave(120);

  if (event.type === 'water-entered') {
    worldEvents.emit({
      type: 'water-splashed',
      ballId: event.ballId,
      position: event.position,
      strength: event.intensity,
    });
    const markPosition = event.position.clone();
    markPosition.y = event.waterLevel;
    world.addImpact('water', markPosition);
    return;
  }

  if (event.type === 'water-skipped') {
    worldEvents.emit({
      type: 'water-splashed',
      ballId: event.ballId,
      position: event.position,
      strength: event.intensity * 0.65,
    });
    const markPosition = event.position.clone();
    markPosition.y = event.waterLevel;
    world.addImpact('water', markPosition);
    return;
  }

  if (event.type !== 'terrain-impact' || event.impactSpeed < 0.72) return;
  const landedSurface = propertyField.sample(event.position.x, event.position.z).surface;
  worldEvents.emit({
    type: 'ball-landed',
    ballId: event.ballId,
    position: event.position,
    surface: landedSurface,
    strength: THREE.MathUtils.clamp(event.impactSpeed / 10, 0.12, 1),
  });
  const lastMarkedImpactTime = lastMarkedImpactTimeByBall.get(event.ballId) ?? Number.NEGATIVE_INFINITY;
  if (event.time - lastMarkedImpactTime < 0.19) return;
  lastMarkedImpactTimeByBall.set(event.ballId, event.time);
  const markPosition = event.position.clone();
  const sample = propertyField.sample(markPosition.x, markPosition.z);
  markPosition.y = sample.surface === 'water' ? POND_WATER_LEVEL : sample.height;
  const horizontalSpeed = Math.hypot(event.velocityAfter.x, event.velocityAfter.z);
  recordTrace({
    type: event.surface === 'sand' ? 'sand-crater' : 'pitch-mark',
    x: markPosition.x,
    y: markPosition.y,
    z: markPosition.z,
    directionX: horizontalSpeed > 0.01 ? event.velocityAfter.x / horizontalSpeed : 0,
    directionZ: horizontalSpeed > 0.01 ? event.velocityAfter.z / horizontalSpeed : 1,
    scale: THREE.MathUtils.clamp(event.impactSpeed / 12, 0.2, 1),
    strength: THREE.MathUtils.clamp(event.impactSpeed / 9, 0.2, 1),
    lifetime: 'session',
  });
  if (event.surface === 'sand') world.addImpact('sand', markPosition);
  else if (event.surface === 'rock' || event.surface === 'hard') world.addImpact('hard', markPosition);
  else world.addImpact('grass', markPosition);
}

function updateCamera(): void {
  cameraTarget.copy(world.golfer.position);
  cameraTarget.y += 0.72;
  camera.position.copy(cameraTarget).add(CAMERA_OFFSET);
  camera.quaternion.copy(fixedCameraQuaternion);
  camera.updateMatrixWorld();
  lighting.update(cameraTarget);
  camera.getWorldDirection(audioForward);
  audioUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  worldAudio.setListener(world.golfer.position, audioForward, audioUp);
}

function updateStreaming(): void {
  const foci = [{
    x: world.golfer.position.x,
    z: world.golfer.position.z,
    radiusChunks: PROPERTY_BLUEPRINT.renderRadiusChunks,
  }];
  for (const ball of balls) {
    if (ball.sleeping || ball.submerged || foci.length >= 7) continue;
    foci.push({
      x: ball.position.x,
      z: ball.position.z,
      radiusChunks: 1,
    });
  }
  streamer.update(foci);
  const queriedHeight = propertyPhysics.queryGroundHeight(world.golfer.position.x, world.golfer.position.z);
  lastGroundQueryDelta = queriedHeight === null
    ? null
    : queriedHeight - propertyField.heightAt(world.golfer.position.x, world.golfer.position.z);
}

function resize(): void {
  const width = Math.max(1, canvas!.clientWidth);
  const height = Math.max(1, canvas!.clientHeight);
  const aspect = width / height;
  camera.left = -(CAMERA_VERTICAL_SPAN * aspect) / 2;
  camera.right = (CAMERA_VERTICAL_SPAN * aspect) / 2;
  camera.top = CAMERA_VERTICAL_SPAN / 2;
  camera.bottom = -CAMERA_VERTICAL_SPAN / 2;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, ART_LIMITS.maximumDevicePixelRatio));
  renderer.setSize(width, height, false);
  // Resizing clears WebGL's drawing buffer. Render immediately so a paused or
  // deterministic capture frame never presents an empty sheet of paper.
  renderer.render(scene, camera);
}

function syncBallVisual(ball: GolfBallSimulation, trace = ball === addressedBall || ball === simulation): void {
  const visualPosition = ball.position.clone();
  visualPosition.y -= ball.radius;
  const sample = propertyField.sample(ball.position.x, ball.position.z);
  const waterLevel = sample.height + sample.waterDepth;
  world.setBallState(
    ball.id,
    visualPosition,
    !ball.sleeping && !ball.submerged,
    ball.orientation,
    !ball.submerged || ball.position.y >= waterLevel - 0.5,
    trace,
  );
  worldEvents.emit({
    type: 'ball-moved',
    ballId: ball.id,
    position: ball.position,
    speed: ball.velocity.length(),
    clearance: Math.max(0, ball.position.y - (sample.surface === 'water' ? waterLevel : sample.height)),
  });
}

function syncBallVisuals(): void {
  for (const ball of balls) syncBallVisual(ball);
}

function syncEnvironment(): void {
  const environment = world.environmentState;
  for (const ball of balls) ball.wind.set(environment.windX, 0, environment.windZ);
  environmentPaperColor.setHex(ART_PALETTE.paper).offsetHSL(0, 0, environment.paperTone);
  scene.background = environmentPaperColor;
  renderer.setClearColor(environmentPaperColor, 1);
}

function setGolferPosition(x: number, z: number): void {
  const clamped = propertyField.clampPosition(x, z, 2.5);
  world.golfer.position.set(clamped.x, propertyField.heightAt(clamped.x, clamped.z), clamped.z);
  golferController.teleport(world.golfer.position);
  updateStreaming();
  updateCamera();
}

function setCartPosition(x: number, z: number, heading = world.cart.rotation.y): void {
  const clamped = propertyField.clampPosition(x, z, 3);
  world.cart.position.set(clamped.x, propertyField.heightAt(clamped.x, clamped.z), clamped.z);
  world.cart.rotation.y = heading;
  cartController.teleport(world.cart.position);
  lastCartTrackPosition.copy(world.cart.position);
}

function placeBallNearGolfer(): void {
  const origin = world.golfer.position.clone();
  origin.x += 0.42;
  origin.z += 2.1;
  simulation.place(origin);
  syncBallVisual(simulation);
}

function spawnBall(position: THREE.Vector3, id?: string, snapToTerrain = true): GolfBallSimulation {
  if (balls.length >= 24) return balls[balls.length - 1]!;
  const ball = new GolfBallSimulation(terrainQuery, {
    ...(id ? { id } : {}),
    initialPosition: position,
    onEvent: handleBallEvent,
  });
  if (!snapToTerrain) ball.place(position, false);
  balls.push(ball);
  world.ensureBallVisual(ball.id);
  syncBallVisual(ball, false);
  return ball;
}

function findBallPlacement(): THREE.Vector3 | null {
  const heading = world.golfer.rotation.y;
  for (const [forward, side] of [
    [1.15, 0.42], [1.15, -0.42], [0.9, 0.75], [0.9, -0.75], [1.55, 0],
  ] as const) {
    const x = world.golfer.position.x + Math.sin(heading) * forward + Math.cos(heading) * side;
    const z = world.golfer.position.z + Math.cos(heading) * forward - Math.sin(heading) * side;
    const sample = propertyField.sample(x, z);
    const slope = Math.acos(Math.max(-1, Math.min(1, sample.normal.y)));
    if (sample.surface === 'water' || sample.surface === 'cliff' || slope > Math.PI * 0.22) continue;
    if (balls.some((ball) => Math.hypot(ball.position.x - x, ball.position.z - z) < 0.5)) continue;
    return new THREE.Vector3(x, sample.height, z);
  }
  return null;
}

function placeAdditionalBall(): boolean {
  if (playerMode !== 'walking' || balls.length >= 24) return false;
  const position = findBallPlacement();
  if (!position) return false;
  addressedBall = spawnBall(position);
  golfDomainEvents.push(`ball-placed:${addressedBall.id}`);
  if (golfDomainEvents.length > 32) golfDomainEvents.shift();
  scheduleSave(120);
  return true;
}

function placeBallAt(x: number, z: number): string {
  const clamped = propertyField.clampPosition(x, z, 0.5);
  const ball = spawnBall(new THREE.Vector3(
    clamped.x,
    propertyField.heightAt(clamped.x, clamped.z),
    clamped.z,
  ));
  addressedBall = ball;
  return ball.id;
}

function nearestActionableBall(maximumDistance = 3.4): GolfBallSimulation | null {
  let nearest: GolfBallSimulation | null = null;
  let nearestDistance = maximumDistance;
  for (const ball of balls) {
    if (ball.submerged || !ball.sleeping) continue;
    const distance = Math.hypot(
      ball.position.x - world.golfer.position.x,
      ball.position.z - world.golfer.position.z,
    );
    if (distance < nearestDistance) {
      nearest = ball;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function enterStance(ball: GolfBallSimulation): void {
  const toBallX = ball.position.x - world.golfer.position.x;
  const toBallZ = ball.position.z - world.golfer.position.z;
  const distance = Math.hypot(toBallX, toBallZ);
  if (distance > 2.6 || distance < 0.001) return;

  const shotHeading = Math.atan2(toBallX, toBallZ);
  const rightX = Math.cos(shotHeading);
  const rightZ = -Math.sin(shotHeading);
  const candidates = [
    {
      x: ball.position.x + rightX * 0.72,
      z: ball.position.z + rightZ * 0.72,
      bodyHeading: shotHeading - Math.PI / 2,
    },
    {
      x: ball.position.x - rightX * 0.72,
      z: ball.position.z - rightZ * 0.72,
      bodyHeading: shotHeading + Math.PI / 2,
    },
  ].filter((candidate) => {
    const sample = propertyField.sample(candidate.x, candidate.z);
    return sample.surface !== 'water' && sample.surface !== 'cliff';
  }).sort((left, right) => (
    Math.hypot(left.x - world.golfer.position.x, left.z - world.golfer.position.z)
      - Math.hypot(right.x - world.golfer.position.x, right.z - world.golfer.position.z)
  ));
  const candidate = candidates[0];
  if (!candidate) return;

  addressedBall = ball;
  playerMode = 'stance';
  pointerTarget = null;
  swingPower = 0;
  stanceTarget = new THREE.Vector3(
    candidate.x,
    propertyField.heightAt(candidate.x, candidate.z),
    candidate.z,
  );
  swingSequence.beginAddress(shotHeading, candidate.bodyHeading);
  world.golfer.setSwingPresentation(swingSequence.snapshot());
  golfDomainEvents.push(`stance-entered:${ball.id}`);
  if (golfDomainEvents.length > 32) golfDomainEvents.shift();
}

function leaveStance(): void {
  if (playerMode !== 'stance') return;
  cancelPointerInput();
  playerMode = 'walking';
  swingPointerStart = null;
  swingPower = 0;
  stanceTarget = null;
  swingSequence.cancel();
  world.golfer.setSwingPresentation(swingSequence.snapshot());
}

function performClubImpact(): void {
  const swing = swingSequence.snapshot();
  if (playerMode !== 'stance' || !addressedBall || swing.power < 0.075) return;
  const direction = new THREE.Vector3(
    Math.sin(swing.shotHeading),
    0,
    Math.cos(swing.shotHeading),
  );
  golfDomainEvents.push(`club-impact:${addressedBall.id}`);
  if (golfDomainEvents.length > 32) golfDomainEvents.shift();
  const divotPosition = new THREE.Vector3(
    addressedBall.position.x,
    propertyField.heightAt(addressedBall.position.x, addressedBall.position.z),
    addressedBall.position.z,
  );
  recordTrace({
    type: 'divot',
    x: divotPosition.x,
    y: divotPosition.y,
    z: divotPosition.z,
    directionX: direction.x,
    directionZ: direction.z,
    scale: 0.45,
    strength: swing.power,
    lifetime: 'session',
  });
  world.addDivot(divotPosition, swing.shotHeading, swing.power);
  worldEvents.emit({
    type: 'club-impact',
    ballId: addressedBall.id,
    position: addressedBall.position,
    strength: swing.power,
  });
  addressedBall.launchPreset('fairway', direction, {
    power: THREE.MathUtils.lerp(0.22, 1.05, swing.power),
  });
  syncBallVisual(addressedBall, true);
  scheduleSave(120);
}

function checkCupCaptures(): void {
  const cupX = 1.8;
  const cupZ = 65.5;
  for (const ball of balls) {
    if (ball.submerged || ball.motion === 'flight') continue;
    const distance = Math.hypot(ball.position.x - cupX, ball.position.z - cupZ);
    if (distance > 0.24 || ball.velocity.length() > 3.2) continue;
    ball.position.set(cupX, propertyField.heightAt(cupX, cupZ) - 0.22, cupZ);
    ball.velocity.set(0, 0, 0);
    ball.angularVelocity.set(0, 0, 0);
    ball.motion = 'resting';
    ball.sleeping = true;
    ball.submerged = true;
    golfDomainEvents.push(`cup-entered:${ball.id}`);
    if (golfDomainEvents.length > 32) golfDomainEvents.shift();
    scheduleSave(120);
    worldAudio.impact('cup', ball.position, 0.75);
  }
}

function focus(area: LabFocus): void {
  cancelPointerInput();
  swingSequence.cancel();
  world.golfer.setSwingPresentation(swingSequence.snapshot());
  stanceTarget = null;
  swingPower = 0;
  playerMode = 'walking';
  world.golfer.setSeated(false);
  pointerTarget = null;
  currentFocus = area;
  const positions: Record<LabFocus, readonly [number, number]> = {
    tee: [0, -63],
    hill: [-2, -39],
    water: [-3, -10],
    green: [-1, 54],
    bank: [32, 25],
    property: [world.golfer.position.x, world.golfer.position.z],
  };
  const [x, z] = positions[area];
  setGolferPosition(x, z);
  placeBallNearGolfer();
  renderer.render(scene, camera);
  scheduleSave();
}

function launchToward(
  preset: ShotPresetName,
  golferX: number,
  golferZ: number,
  targetX: number,
  targetZ: number,
  power: number,
): void {
  setGolferPosition(golferX, golferZ);
  const origin = new THREE.Vector3(golferX + 0.42, 0, golferZ + 2.05);
  simulation.place(origin);
  world.clearInteractions();
  recentEvents.length = 0;
  lastMarkedImpactTimeByBall.clear();
  const direction = new THREE.Vector3(targetX - origin.x, 0, targetZ - origin.z).normalize();
  simulation.launchPreset(preset, direction, { power });
  syncBallVisual(simulation);
  updateStreaming();
  renderer.render(scene, camera);
  scheduleSave();
}

function shoot(preset: ShotPresetName = 'fairway'): void {
  switch (preset) {
    case 'fairway':
      currentFocus = 'tee';
      launchToward('fairway', 0, -63, -2.5, -7, 0.9);
      break;
    case 'green':
      currentFocus = 'green';
      launchToward('green', 2, 27, -1.5, 64, 0.88);
      break;
    case 'bunker':
      currentFocus = 'hill';
      launchToward('bunker', -7, -32, -14.1, -18.5, 0.65);
      break;
    case 'water':
      currentFocus = 'water';
      launchToward('water', -3, -24, -25, 0.5, 0.72);
      break;
  }
}

function reset(): void {
  world.clearInteractions();
  traceJournal.clear();
  recentEvents.length = 0;
  lastMarkedImpactTimeByBall.clear();
  focus('tee');
}

function moveTo(x: number, z: number): void {
  cancelPointerInput();
  swingSequence.cancel();
  world.golfer.setSwingPresentation(swingSequence.snapshot());
  stanceTarget = null;
  swingPower = 0;
  playerMode = 'walking';
  world.golfer.setSeated(false);
  pointerTarget = null;
  currentFocus = 'property';
  setGolferPosition(x, z);
  renderer.render(scene, camera);
  scheduleSave();
}

const pointerRaycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(fixedCameraQuaternion);
const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(fixedCameraQuaternion);
screenRight.y = 0;
screenUp.y = 0;
screenRight.normalize();
screenUp.normalize();

function pointerGroundTarget(clientX: number, clientY: number): Readonly<{ x: number; z: number }> | null {
  const bounds = canvas!.getBoundingClientRect();
  pointerNdc.set(
    ((clientX - bounds.left) / bounds.width) * 2 - 1,
    -((clientY - bounds.top) / bounds.height) * 2 + 1,
  );
  pointerRaycaster.setFromCamera(pointerNdc, camera);
  const ray = pointerRaycaster.ray;
  let low = 0;
  let lowDelta = ray.origin.y - propertyField.heightAt(ray.origin.x, ray.origin.z);
  for (let distance = 4; distance <= 500; distance += 4) {
    const x = ray.origin.x + ray.direction.x * distance;
    const y = ray.origin.y + ray.direction.y * distance;
    const z = ray.origin.z + ray.direction.z * distance;
    const delta = y - propertyField.heightAt(x, z);
    if (delta <= 0 && lowDelta >= 0) {
      let high = distance;
      for (let iteration = 0; iteration < 14; iteration += 1) {
        const middle = (low + high) / 2;
        const middleX = ray.origin.x + ray.direction.x * middle;
        const middleY = ray.origin.y + ray.direction.y * middle;
        const middleZ = ray.origin.z + ray.direction.z * middle;
        if (middleY - propertyField.heightAt(middleX, middleZ) > 0) low = middle;
        else high = middle;
      }
      const hit = (low + high) / 2;
      return {
        x: ray.origin.x + ray.direction.x * hit,
        z: ray.origin.z + ray.direction.z * hit,
      };
    }
    low = distance;
    lowDelta = delta;
  }
  return null;
}

function keyboardWalkTarget(): Readonly<{ x: number; z: number }> | null {
  let horizontal = 0;
  let vertical = 0;
  if (movementKeys.has('KeyA') || movementKeys.has('ArrowLeft')) horizontal -= 1;
  if (movementKeys.has('KeyD') || movementKeys.has('ArrowRight')) horizontal += 1;
  if (movementKeys.has('KeyW') || movementKeys.has('ArrowUp')) vertical += 1;
  if (movementKeys.has('KeyS') || movementKeys.has('ArrowDown')) vertical -= 1;
  if (horizontal === 0 && vertical === 0) return null;
  const inverseLength = 1 / Math.hypot(horizontal, vertical);
  const reach = movementKeys.has('ShiftLeft') || movementKeys.has('ShiftRight') ? 18 : 8;
  return {
    x: world.golfer.position.x
      + (screenRight.x * horizontal + screenUp.x * vertical) * inverseLength * reach,
    z: world.golfer.position.z
      + (screenRight.z * horizontal + screenUp.z * vertical) * inverseLength * reach,
  };
}

function updateTraversalStep(delta: number): void {
  currentFocus = 'property';
  if (playerMode === 'walking') {
    const target = keyboardWalkTarget() ?? pointerTarget;
    golferTraversal = golferController.step(
      world.golfer.position,
      world.golfer.rotation.y,
      target,
      delta,
    );
    world.golfer.position.set(golferTraversal.x, golferTraversal.y, golferTraversal.z);
    world.golfer.rotation.y = golferTraversal.heading;
    world.golfer.setLocomotion(
      golferTraversal.speed,
      golferTraversal.leftFootHeight - golferTraversal.y,
      golferTraversal.rightFootHeight - golferTraversal.y,
      golferTraversal.stridePhase,
    );
    flushFootsteps();
    const groundSample = propertyField.sample(golferTraversal.x, golferTraversal.z);
    traversalNormal.set(groundSample.normal.x, groundSample.normal.y, groundSample.normal.z);
    world.golfer.setGroundNormal(traversalNormal);
    if (golferTraversal.speed > 0.02) {
      worldEvents.emit({
        type: 'golfer-moved',
        position: world.golfer.position,
        speed: golferTraversal.speed,
        surface: golferTraversal.surface,
      });
    }
    addressedBall = nearestActionableBall();
    if (addressedBall) {
      const ballHeading = Math.atan2(
        addressedBall.position.x - world.golfer.position.x,
        addressedBall.position.z - world.golfer.position.z,
      );
      const localYaw = Math.atan2(
        Math.sin(ballHeading - world.golfer.rotation.y),
        Math.cos(ballHeading - world.golfer.rotation.y),
      );
      const distance = world.golfer.position.distanceTo(addressedBall.position);
      world.golfer.setAttention(localYaw, THREE.MathUtils.clamp(1 - (distance - 1) / 4, 0, 1));
    } else {
      world.golfer.setAttention(0, 0);
    }
  } else if (playerMode === 'driving') {
    const cartInput = {
      throttle: (movementKeys.has('KeyW') || movementKeys.has('ArrowUp') ? 1 : 0)
        - (movementKeys.has('KeyS') || movementKeys.has('ArrowDown') ? 1 : 0),
      steer: (movementKeys.has('KeyA') || movementKeys.has('ArrowLeft') ? 1 : 0)
        - (movementKeys.has('KeyD') || movementKeys.has('ArrowRight') ? 1 : 0),
      brake: movementKeys.has('Space'),
    };
    cartPreviousPosition.copy(world.cart.position);
    cartTraversal = cartController.step(
      world.cart.position,
      world.cart.rotation.y,
      cartInput,
      delta,
    );
    world.cart.position.set(cartTraversal.x, cartTraversal.y, cartTraversal.z);
    world.cart.rotation.y = cartTraversal.heading;
    const cartGround = propertyField.sample(cartTraversal.x, cartTraversal.z);
    traversalNormal.set(cartGround.normal.x, cartGround.normal.y, cartGround.normal.z);
    world.cart.setMotion(cartTraversal.speed, cartInput.steer, traversalNormal, delta);
    if (Math.abs(cartTraversal.speed) > 0.02) {
      worldEvents.emit({
        type: 'cart-moved',
        position: world.cart.position,
        previous: cartPreviousPosition,
        speed: cartTraversal.speed,
        heading: cartTraversal.heading,
        surface: cartTraversal.surface,
      });
    }
    if (world.cart.position.distanceToSquared(lastCartTrackPosition) > 0.32) {
      const trackDistance = world.cart.position.distanceTo(lastCartTrackPosition);
      world.addCartTrack(lastCartTrackPosition, world.cart.position, world.cart.rotation.y);
      recordTrace({
        type: 'cart-track',
        x: world.cart.position.x,
        y: world.cart.position.y,
        z: world.cart.position.z,
        directionX: Math.sin(world.cart.rotation.y),
        directionZ: Math.cos(world.cart.rotation.y),
        scale: trackDistance,
        strength: cartTraversal.surface === 'bunker' ? 0.95 : 0.62,
        lifetime: 'session',
      });
      lastCartTrackPosition.copy(world.cart.position);
    }
    world.golfer.position.copy(world.cart.position);
    world.golfer.rotation.y = world.cart.rotation.y;
    world.golfer.setLocomotion(0, 0, 0);
    world.golfer.setAttention(0, 0);
  } else {
    let swing = swingSequence.snapshot();
    if (swing.phase === 'addressing' && stanceTarget) {
      golferTraversal = golferController.step(
        world.golfer.position,
        world.golfer.rotation.y,
        stanceTarget,
        delta,
      );
      world.golfer.position.set(golferTraversal.x, golferTraversal.y, golferTraversal.z);
      world.golfer.rotation.y = golferTraversal.heading;
      world.golfer.setLocomotion(
        golferTraversal.speed,
        golferTraversal.leftFootHeight - golferTraversal.y,
        golferTraversal.rightFootHeight - golferTraversal.y,
        golferTraversal.stridePhase,
      );
      flushFootsteps();
      if (golferTraversal.speed > 0.02) {
        worldEvents.emit({
          type: 'golfer-moved',
          position: world.golfer.position,
          speed: golferTraversal.speed,
          surface: golferTraversal.surface,
        });
      }
      const remaining = Math.hypot(
        stanceTarget.x - world.golfer.position.x,
        stanceTarget.z - world.golfer.position.z,
      );
      if (remaining <= 0.075) {
        const headingError = Math.atan2(
          Math.sin(swing.bodyHeading - world.golfer.rotation.y),
          Math.cos(swing.bodyHeading - world.golfer.rotation.y),
        );
        world.golfer.rotation.y += THREE.MathUtils.clamp(headingError, -delta * 4.8, delta * 4.8);
        if (Math.abs(headingError) <= 0.045) {
          world.golfer.position.copy(stanceTarget);
          world.golfer.rotation.y = swing.bodyHeading;
          golferController.teleport(world.golfer.position);
          swingSequence.settle();
          swing = swingSequence.snapshot();
          worldEvents.emit({ type: 'stance-settled', position: world.golfer.position });
          golfDomainEvents.push(`stance-settled:${addressedBall?.id ?? 'none'}`);
          if (golfDomainEvents.length > 32) golfDomainEvents.shift();
        }
      }
    } else {
      if (swing.phase === 'ready') {
        const turn = (movementKeys.has('KeyA') || movementKeys.has('ArrowLeft') ? 1 : 0)
          - (movementKeys.has('KeyD') || movementKeys.has('ArrowRight') ? 1 : 0);
        swingSequence.nudgeAlignment(turn * delta * 0.56);
      }
      for (const event of swingSequence.step(delta)) {
        if (event === 'impact') performClubImpact();
        else if (event === 'complete') {
          golfDomainEvents.push(`swing-complete:${addressedBall?.id ?? 'none'}`);
          if (golfDomainEvents.length > 32) golfDomainEvents.shift();
          playerMode = 'walking';
          stanceTarget = null;
          swingPointerStart = null;
          addressedBall = null;
        }
      }
      swing = swingSequence.snapshot();
      world.golfer.rotation.y = swing.phase === 'idle'
        ? world.golfer.rotation.y
        : swing.bodyHeading;
      world.golfer.setLocomotion(0, 0, 0, golferTraversal.stridePhase);
    }
    const stanceGround = propertyField.sample(world.golfer.position.x, world.golfer.position.z);
    traversalNormal.set(stanceGround.normal.x, stanceGround.normal.y, stanceGround.normal.z);
    world.golfer.setGroundNormal(traversalNormal);
    swing = swingSequence.snapshot();
    swingPower = swing.power;
    world.golfer.setSwingPresentation(swing);
    world.golfer.setAttention(0, 1);
  }

  const moving = playerMode === 'walking'
    ? golferTraversal.speed > 0.04
    : playerMode === 'driving' && Math.abs(cartTraversal.speed) > 0.04;
  if (moving) {
    movementSaveElapsed += delta;
    if (movementSaveElapsed >= 0.8) {
      movementSaveElapsed = 0;
      scheduleSave(250);
    }
  } else {
    movementSaveElapsed = 0;
  }
  updateStreaming();
  updateCamera();
}

function interact(): void {
  if (playerMode === 'stance') {
    leaveStance();
    return;
  }
  if (playerMode === 'walking') {
    const ball = nearestActionableBall(2.6);
    if (ball) {
      enterStance(ball);
      return;
    }
    if (world.golfer.position.distanceTo(world.cart.position) > 3.2) return;
    playerMode = 'driving';
    pointerTarget = null;
    world.golfer.setSeated(true);
    world.golfer.position.copy(world.cart.position);
    world.golfer.rotation.y = world.cart.rotation.y;
    scheduleSave(120);
    return;
  }

  const exit = cartController.findSafeExit(world.cart.position, world.cart.rotation.y);
  if (!exit) return;
  playerMode = 'walking';
  world.golfer.setSeated(false);
  world.golfer.position.set(exit.x, exit.y, exit.z);
  world.golfer.rotation.y = world.cart.rotation.y;
  golferController.teleport(world.golfer.position);
  pointerTarget = null;
  updateStreaming();
  updateCamera();
  scheduleSave(120);
}

function setMoveTarget(x: number, z: number): void {
  if (playerMode !== 'walking') return;
  pointerTarget = propertyField.clampPosition(x, z, 1.2);
}

function releaseMove(): void {
  pointerTarget = null;
}

function cancelPointerInput(): void {
  const pointerId = activePointerId;
  activePointerId = null;
  pointerTarget = null;
  swingPointerStart = null;
  swingSequence.cancelGesture();
  swingPower = swingSequence.snapshot().power;
  world.golfer.setSwingPresentation(swingSequence.snapshot());
  if (pointerId !== null && canvas!.hasPointerCapture(pointerId)) {
    canvas!.releasePointerCapture(pointerId);
  }
}

function simulate(seconds: number): void {
  const safeSeconds = THREE.MathUtils.clamp(seconds, 0, 20);
  elapsed += safeSeconds;
  const steps = Math.floor(safeSeconds / BALL_FIXED_STEP);
  for (let index = 0; index < steps; index += 1) {
    for (const ball of balls) ball.step(BALL_FIXED_STEP);
    checkCupCaptures();
  }
  const traversalSteps = Math.min(1200, Math.floor(safeSeconds * 60));
  for (let index = 0; index < traversalSteps; index += 1) {
    updateTraversalStep(1 / 60);
    propertyPhysics.step(1 / 60);
  }
  if (traversalSteps === 0) propertyPhysics.step(BALL_FIXED_STEP);
  syncBallVisuals();
  updateStreaming();
  world.update(elapsed, safeSeconds);
  syncEnvironment();
  updateCamera();
  renderer.render(scene, camera);
}

function setCaptureMode(enabled: boolean): void {
  manualCaptureMode = enabled;
  previousTime = performance.now() / 1000;
  updateCamera();
  renderer.render(scene, camera);
}

function applyAccessibilitySettings(): void {
  document.body.classList.toggle('high-contrast', accessibilitySettings.highContrast);
  world.setBallScale(accessibilitySettings.largerBalls ? 1.65 : 1);
  world.setReducedMotion(accessibilitySettings.reducedMotion);
  lighting.setHighContrast(accessibilitySettings.highContrast);
  worldAudio.strongerCues = accessibilitySettings.strongerSound;
  contrastSetting!.checked = accessibilitySettings.highContrast;
  ballSizeSetting!.checked = accessibilitySettings.largerBalls;
  reducedMotionSetting!.checked = accessibilitySettings.reducedMotion;
  soundSetting!.checked = accessibilitySettings.strongerSound;
}

function setPaused(next: boolean): void {
  paused = next;
  pausePanel!.hidden = !paused;
  movementKeys.clear();
  cancelPointerInput();
  previousTime = performance.now() / 1000;
  if (paused) {
    void saveSession();
    resumeButton!.focus();
  } else {
    canvas!.focus();
  }
}

function updateDiagnostics(delta: number): void {
  fpsElapsed += delta;
  fpsFrames += 1;
  if (fpsElapsed < 0.45) return;
  performanceStats = {
    fps: Math.round(fpsFrames / fpsElapsed),
    frameMs: Number(((fpsElapsed / fpsFrames) * 1000).toFixed(2)),
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    points: renderer.info.render.points,
  };
  fpsElapsed = 0;
  fpsFrames = 0;
  if (diagnosticsVisible) {
    diagnostics!.textContent = [
      `${performanceStats.fps} fps  ${performanceStats.frameMs.toFixed(2)} ms`,
      `${performanceStats.calls} calls  ${performanceStats.triangles.toLocaleString()} tris`,
      `ball ${simulation.motion} / ${simulation.surface}`,
      `camera ortho ${CAMERA_VERTICAL_SPAN}m / locked`,
      `chunk ${streamer.primaryChunkKey}  ${streamer.activeChunks.length} active`,
      `rapier ${propertyPhysics.streamedColliderCount} streamed / ${propertyPhysics.totalColliderCount} total`,
      `save ${sessionStore.status}${sessionStore.lastSavedAt ? ` / ${new Date(sessionStore.lastSavedAt).toLocaleTimeString()}` : ''}`,
    ].join('\n');
  }
}

function setDiagnostics(visible: boolean): void {
  diagnosticsVisible = visible;
  diagnostics!.hidden = !visible;
}

function restoreWorldSession(session: WorldSessionV1): void {
  elapsed = Math.max(0, session.worldTimeSeconds);
  currentFocus = 'property';
  setGolferPosition(session.golfer.x, session.golfer.z);
  world.golfer.rotation.y = session.golfer.heading;
  setCartPosition(session.cart.x, session.cart.z, session.cart.heading);
  accessibilitySettings = session.accessibility ?? accessibilitySettings;
  applyAccessibilitySettings();

  const savedPrimary = session.balls[0];
  if (savedPrimary) {
    restoreBallState(simulation, savedPrimary);
    for (const savedBall of session.balls.slice(1, 24)) {
      const extra = spawnBall(
        new THREE.Vector3(savedBall.position.x, savedBall.position.y, savedBall.position.z),
        savedBall.id,
        false,
      );
      restoreBallState(extra, savedBall);
    }
  } else {
    placeBallNearGolfer();
  }
  traceJournal.restore(session.traces ?? []);
  for (const trace of traceJournal.all()) world.replayTrace(trace);
  syncBallVisuals();
  if (!session.cart.parked) {
    playerMode = 'driving';
    world.golfer.setSeated(true);
    world.golfer.position.copy(world.cart.position);
    world.golfer.rotation.y = world.cart.rotation.y;
  }
  updateStreaming();
  updateCamera();
}

function restoreBallState(ball: GolfBallSimulation, saved: WorldSessionV1['balls'][number]): void {
  ball.place(new THREE.Vector3(saved.position.x, saved.position.y, saved.position.z), false);
  ball.velocity.set(saved.velocity.x, saved.velocity.y, saved.velocity.z);
  ball.angularVelocity.set(
    saved.angularVelocity.x,
    saved.angularVelocity.y,
    saved.angularVelocity.z,
  );
  ball.motion = saved.motion;
  ball.surface = saved.surface as BallSurface;
  ball.sleeping = saved.sleeping;
  ball.submerged = saved.submerged;
}

function animate(nowMilliseconds: number): void {
  const now = nowMilliseconds / 1000;
  if (manualCaptureMode || paused) {
    previousTime = now;
    requestAnimationFrame(animate);
    return;
  }
  const delta = Math.min(0.05, Math.max(0, now - previousTime));
  previousTime = now;
  elapsed += delta;

  traversalAccumulator = Math.min(0.1, traversalAccumulator + delta);
  let traversalSteps = 0;
  while (traversalAccumulator >= 1 / 60 && traversalSteps < 6) {
    updateTraversalStep(1 / 60);
    propertyPhysics.step(1 / 60);
    traversalAccumulator -= 1 / 60;
    traversalSteps += 1;
  }
  for (const ball of balls) ball.advance(delta);
  checkCupCaptures();
  syncBallVisuals();
  updateStreaming();
  world.update(elapsed, delta);
  syncEnvironment();
  updateCamera();
  renderer.render(scene, camera);
  updateDiagnostics(delta);
  requestAnimationFrame(animate);
}

window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => {
  previousTime = performance.now() / 1000;
  if (document.visibilityState === 'hidden') {
    movementKeys.clear();
    cancelPointerInput();
    void saveSession();
  }
});
window.addEventListener('pagehide', () => void saveSession());
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  loading.textContent = 'The paper is being redrawn…';
  loading.classList.remove('is-hidden');
});
canvas.addEventListener('webglcontextrestored', () => {
  loading.classList.add('is-hidden');
  resize();
  renderer.render(scene, camera);
});
canvas.addEventListener('pointerdown', (event) => {
  void worldAudio.resume();
  if (event.button !== 0 || playerMode === 'driving') return;
  if (playerMode === 'stance') {
    if (!swingSequence.beginGesture()) return;
    activePointerId = event.pointerId;
    swingPointerStart = { x: event.clientX, y: event.clientY };
    swingPower = 0;
    world.golfer.setSwingPresentation(swingSequence.snapshot());
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  const target = pointerGroundTarget(event.clientX, event.clientY);
  if (!target) return;
  activePointerId = event.pointerId;
  pointerTarget = target;
  canvas.setPointerCapture(event.pointerId);
  event.preventDefault();
});
canvas.addEventListener('pointermove', (event) => {
  if (activePointerId !== event.pointerId) return;
  if (playerMode === 'stance' && swingPointerStart) {
    const bounds = canvas!.getBoundingClientRect();
    const deltaX = event.clientX - swingPointerStart.x;
    const deltaY = event.clientY - swingPointerStart.y;
    swingSequence.updateGesture(
      deltaX,
      deltaY,
      Math.min(bounds.width, bounds.height),
      bounds.width,
    );
    const swing = swingSequence.snapshot();
    swingPower = swing.power;
    world.golfer.rotation.y = swing.bodyHeading;
    world.golfer.setSwingPresentation(swing);
    return;
  }
  if (playerMode !== 'walking') return;
  const target = pointerGroundTarget(event.clientX, event.clientY);
  if (target) pointerTarget = target;
});
function endPointerMovement(event: PointerEvent, commitSwing: boolean): void {
  if (activePointerId !== event.pointerId) return;
  const wasSwingGesture = playerMode === 'stance' && swingPointerStart !== null;
  activePointerId = null;
  swingPointerStart = null;
  pointerTarget = null;
  if (canvas!.hasPointerCapture(event.pointerId)) canvas!.releasePointerCapture(event.pointerId);
  if (!wasSwingGesture) return;
  if (commitSwing && swingSequence.release()) {
    const swing = swingSequence.snapshot();
    swingPower = swing.power;
    worldEvents.emit({
      type: 'club-swing',
      position: world.golfer.position,
      strength: swing.power,
    });
    golfDomainEvents.push(`swing-committed:${addressedBall?.id ?? 'none'}`);
    if (golfDomainEvents.length > 32) golfDomainEvents.shift();
  } else {
    swingSequence.cancelGesture();
    swingPower = swingSequence.snapshot().power;
  }
  world.golfer.setSwingPresentation(swingSequence.snapshot());
}
canvas.addEventListener('pointerup', (event) => endPointerMovement(event, true));
canvas.addEventListener('pointercancel', (event) => endPointerMovement(event, false));
canvas.addEventListener('lostpointercapture', (event) => {
  if (activePointerId === event.pointerId) {
    activePointerId = null;
    pointerTarget = null;
    swingPointerStart = null;
    swingSequence.cancelGesture();
    swingPower = swingSequence.snapshot().power;
    world.golfer.setSwingPresentation(swingSequence.snapshot());
  }
});
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
resumeButton.addEventListener('click', () => setPaused(false));
for (const setting of [contrastSetting, ballSizeSetting, reducedMotionSetting, soundSetting]) {
  setting.addEventListener('change', () => {
    accessibilitySettings = {
      highContrast: contrastSetting.checked,
      largerBalls: ballSizeSetting.checked,
      reducedMotion: reducedMotionSetting.checked,
      strongerSound: soundSetting.checked,
    };
    applyAccessibilitySettings();
    scheduleSave(120);
  });
}

window.addEventListener('keydown', (event) => {
  void worldAudio.resume();
  if (paused && event.code !== 'Escape') return;
  if (movementCodes.has(event.code)) {
    movementKeys.add(event.code);
    event.preventDefault();
    return;
  }
  if (event.repeat) return;
  switch (event.code) {
    case 'Space':
      event.preventDefault();
      if (playerMode === 'driving') movementKeys.add('Space');
      else interact();
      break;
    case 'Digit1': if (debugControlsEnabled) shoot('fairway'); break;
    case 'Digit2': if (debugControlsEnabled) shoot('bunker'); break;
    case 'Digit3': if (debugControlsEnabled) shoot('water'); break;
    case 'Digit4': if (debugControlsEnabled) shoot('green'); break;
    case 'KeyR': reset(); break;
    case 'KeyE': interact(); break;
    case 'KeyB':
      if (ballPlacementTimer === undefined) {
        ballPlacementTimer = window.setTimeout(() => {
          ballPlacementTimer = undefined;
          placeAdditionalBall();
        }, 320);
      }
      break;
    case 'Escape':
      if (playerMode === 'stance') leaveStance();
      else setPaused(!paused);
      break;
    case 'F3': event.preventDefault(); setDiagnostics(!diagnosticsVisible); break;
    case 'KeyP': void saveSession(); break;
  }
});
window.addEventListener('keyup', (event) => {
  movementKeys.delete(event.code);
  if (event.code === 'KeyB' && ballPlacementTimer !== undefined) {
    window.clearTimeout(ballPlacementTimer);
    ballPlacementTimer = undefined;
  }
});
window.addEventListener('blur', () => {
  movementKeys.clear();
  cancelPointerInput();
});

resize();
if (restoredSession) restoreWorldSession(restoredSession);
else reset();
renderer.render(scene, camera);

window.__STYLE_LAB__ = {
  ready: true,
  cameraContract: Object.freeze({
    projection: 'orthographic',
    verticalSpan: CAMERA_VERTICAL_SPAN,
    yawLocked: true,
    pitchLocked: true,
    zoomLocked: true,
    ballFollow: false,
  }),
  focus,
  shoot,
  reset,
  simulate,
  captureMode: setCaptureMode,
  diagnostics: setDiagnostics,
  moveTo,
  setMoveTarget,
  releaseMove,
  interact,
  placeBall: placeAdditionalBall,
  placeBallAt,
  pause: setPaused,
  save: saveSession,
  clearSave: () => sessionStore.clear(),
  state: () => ({
    focus: currentFocus,
    golfer: world.golfer.position.toArray(),
    ball: simulation.position.toArray(),
    motion: simulation.motion,
    surface: simulation.surface,
    sleeping: simulation.sleeping,
    submerged: simulation.submerged,
    eventTypes: recentEvents.map((event) => event.type),
    golfEventTypes: [...golfDomainEvents],
    camera: {
      position: camera.position.toArray(),
      quaternion: camera.quaternion.toArray(),
      zoom: camera.zoom,
    },
    foundation: {
      propertySchemaId: PROPERTY_SCHEMA_ID,
      primaryChunk: streamer.primaryChunkKey,
      activeChunks: streamer.activeChunks.length,
      activeChunkKeys: streamer.activeKeys,
      renderedChunks: world.streamedChunkCount,
      renderedGrassChunks: world.streamedGrassChunkCount,
      rapierVersion: propertyPhysics.rapierVersion,
      streamedColliders: propertyPhysics.streamedColliderCount,
      totalColliders: propertyPhysics.totalColliderCount,
      groundQueryDelta: lastGroundQueryDelta,
      persistenceStatus: sessionStore.status,
      lastSavedAt: sessionStore.lastSavedAt,
      restoredSession: restoredSession !== null,
    },
    traversal: {
      mode: playerMode,
      speed: playerMode === 'walking' ? golferTraversal.speed : cartTraversal.speed,
      surface: playerMode === 'walking' ? golferTraversal.surface : cartTraversal.surface,
      blocked: playerMode === 'walking' ? golferTraversal.blocked : cartTraversal.blocked,
      golferHeading: world.golfer.rotation.y,
      cart: world.cart.position.toArray(),
      cartHeading: world.cart.rotation.y,
      cursorTarget: pointerTarget ? [pointerTarget.x, pointerTarget.z] : null,
      balls: balls.length,
      addressedBallId: addressedBall?.id ?? null,
      swingPower,
      swingPhase: swingSequence.phase,
      swingProgress: swingSequence.snapshot().progress,
      swingShotHeading: swingSequence.snapshot().shotHeading,
      swingBodyHeading: swingSequence.snapshot().bodyHeading,
      cartVisualForward: world.cart.getForward().toArray(),
      clubHead: world.golfer.getClubHeadWorldPosition().toArray(),
    },
    environment: {
      paused,
      traces: traceJournal.size,
      traceChunks: traceJournal.chunkCount,
      traceTypes: {
        footprint: traceJournal.count('footprint'),
        cartTrack: traceJournal.count('cart-track'),
        pitchMark: traceJournal.count('pitch-mark'),
        divot: traceJournal.count('divot'),
        sandCrater: traceJournal.count('sand-crater'),
      },
      audioStatus: worldAudio.status,
      audioVoices: worldAudio.activeVoices,
      accessibility: { ...accessibilitySettings },
      weather: world.environmentState.weather,
      weatherIntensity: world.environmentState.intensity,
      wind: [world.environmentState.windX, world.environmentState.windZ],
      ambientBirds: world.ambientLife.count,
      ambientFlocks: world.ambientLife.flockCount,
      airborneBirds: world.ambientLife.airborneCount,
      surfaceInteractions: world.activeSurfaceInteractionCount,
    },
    performance: { ...performanceStats },
  }),
};

requestAnimationFrame(() => {
  requestAnimationFrame(() => loading.classList.add('is-hidden'));
});
requestAnimationFrame(animate);
