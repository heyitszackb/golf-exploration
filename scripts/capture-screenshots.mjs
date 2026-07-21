import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const baseUrl = process.env.STYLE_LAB_URL ?? 'http://127.0.0.1:4173';
const outputDirectory = new URL('../artifacts/screenshots/', import.meta.url);
const extendedReview = process.env.EXTENDED_ART_REVIEW === '1';
const foundationOnly = process.env.FOUNDATION_ONLY === '1';
const traversalOnly = process.env.TRAVERSAL_ONLY === '1';
const golfOnly = process.env.GOLF_ONLY === '1';
const environmentOnly = process.env.ENVIRONMENT_ONLY === '1';
const firstPlayableOnly = process.env.FIRST_PLAYABLE_ONLY === '1';
const ambientOnly = process.env.AMBIENT_ONLY === '1';
await mkdir(outputDirectory, { recursive: true });

let serverProcess;

async function canReachLab() {
  try {
    const response = await fetch(baseUrl);
    return response.ok;
  } catch {
    return false;
  }
}

if (!(await canReachLab())) {
  const viteEntry = new URL('../node_modules/vite/bin/vite.js', import.meta.url);
  serverProcess = spawn(process.execPath, [viteEntry.pathname, '--host', '127.0.0.1', '--port', '4173'], {
    cwd: new URL('..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let attempt = 0; attempt < 80 && !(await canReachLab()); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!(await canReachLab())) throw new Error('Could not start the local style-lab server.');
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

const failures = [];

async function openLab(viewport) {
  const page = await browser.newPage({ viewportSize: viewport, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => failures.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console error: ${message.text()}`);
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__STYLE_LAB__?.ready === true);
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    window.__STYLE_LAB__.diagnostics(false);
    window.__STYLE_LAB__.captureMode(true);
  });
  await page.waitForTimeout(80);
  return page;
}

async function capture(page, name) {
  await page.screenshot({
    path: new URL(`${name}.png`, outputDirectory).pathname,
    animations: 'disabled',
    timeout: 60_000,
  });
  process.stdout.write(`captured ${name}\n`);
}

async function captureGolferDetail(page, name) {
  const viewport = page.viewportSize();
  if (!viewport) return;
  const size = Math.min(180, viewport.width, viewport.height);
  await page.screenshot({
    path: new URL(`${name}.png`, outputDirectory).pathname,
    animations: 'disabled',
    clip: {
      x: Math.max(0, viewport.width * 0.5 - size * 0.5),
      y: Math.max(0, viewport.height * 0.5 - size * 0.5),
      width: size,
      height: size,
    },
    timeout: 60_000,
  });
  process.stdout.write(`captured ${name}\n`);
}

async function advanceUntil(page, eventType, maxSeconds = 5) {
  const steps = Math.ceil(maxSeconds / 0.05);
  for (let index = 0; index < steps; index += 1) {
    const state = await page.evaluate(() => {
      window.__STYLE_LAB__.simulate(0.05);
      return window.__STYLE_LAB__.state();
    });
    if (state.eventTypes.includes(eventType)) return state;
  }
  throw new Error(`Timed out waiting for ball event: ${eventType}`);
}

function arraysClose(actual, expected, epsilon = 1e-5) {
  return actual.length === expected.length
    && actual.every((value, index) => Math.abs(value - expected[index]) <= epsilon);
}

async function verifyContinuousProperty(page) {
  await page.setViewportSize({ width: 1000, height: 625 });
  await page.evaluate(() => window.__STYLE_LAB__.focus('tee'));
  const before = await page.evaluate(() => window.__STYLE_LAB__.state());
  const beforeOffset = before.camera.position.map((value, index) => value - before.golfer[index]);

  await page.evaluate(() => window.__STYLE_LAB__.moveTo(0, -47));
  await page.waitForTimeout(80);
  await page.evaluate(() => window.__STYLE_LAB__.captureMode(false));
  await page.waitForTimeout(160);
  await page.evaluate(() => window.__STYLE_LAB__.captureMode(true));
  await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').finish());
  const moved = await page.evaluate(() => window.__STYLE_LAB__.state());
  const movedOffset = moved.camera.position.map((value, index) => value - moved.golfer[index]);
  const foundation = moved.foundation;

  if (moved.foundation.primaryChunk === before.foundation.primaryChunk) {
    throw new Error('Property traversal did not cross a chunk boundary.');
  }
  if (!arraysClose(movedOffset, beforeOffset)
      || !arraysClose(moved.camera.quaternion, before.camera.quaternion)
      || moved.camera.zoom !== before.camera.zoom) {
    throw new Error('Fixed golfer-centered camera contract changed during property traversal.');
  }
  if (foundation.activeChunks !== foundation.renderedChunks
      || foundation.activeChunks !== foundation.renderedGrassChunks
      || foundation.activeChunks !== foundation.streamedColliders
      || foundation.totalColliders !== foundation.streamedColliders + 4) {
    throw new Error(`Stream consumer counts disagree: ${JSON.stringify(foundation)}`);
  }
  if (foundation.groundQueryDelta === null || Math.abs(foundation.groundQueryDelta) > 0.12) {
    throw new Error(`Rapier and field ground heights disagree by ${foundation.groundQueryDelta}.`);
  }
  if (foundation.persistenceStatus !== 'ready') {
    throw new Error(`IndexedDB is not ready: ${foundation.persistenceStatus}.`);
  }

  const saved = await page.evaluate(() => window.__STYLE_LAB__.save());
  if (!saved) throw new Error('IndexedDB world-session save failed.');
  const savedGolfer = moved.golfer;

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__STYLE_LAB__?.ready === true);
  await page.evaluate(() => {
    window.__STYLE_LAB__.diagnostics(false);
    window.__STYLE_LAB__.captureMode(true);
  });
  await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').finish());
  const restored = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (!restored.foundation.restoredSession || !arraysClose(restored.golfer, savedGolfer, 1e-4)) {
    throw new Error(`World-session restore failed: ${JSON.stringify(restored.foundation)}`);
  }
  await capture(page, '15-continuous-property-adjacent-chunk');
  await capture(page, '16-session-restored');
  process.stdout.write(`${JSON.stringify({
    stage1: 'passed',
    primaryChunk: foundation.primaryChunk,
    activeChunks: foundation.activeChunks,
    colliders: foundation.totalColliders,
    rapierVersion: foundation.rapierVersion,
    groundQueryDelta: foundation.groundQueryDelta,
    persistedGolfer: restored.golfer,
  }, null, 2)}\n`);
}

async function verifyEmbodiedTraversal(page) {
  const initial = await page.evaluate(() => {
    window.__STYLE_LAB__.focus('tee');
    return window.__STYLE_LAB__.state();
  });
  const initialOffset = initial.camera.position.map((value, index) => value - initial.golfer[index]);
  await page.evaluate(() => {
    window.__STYLE_LAB__.setMoveTarget(8, -50);
    window.__STYLE_LAB__.simulate(2);
    window.__STYLE_LAB__.releaseMove();
  });
  const walked = await page.evaluate(() => window.__STYLE_LAB__.state());
  const walkedDistance = Math.hypot(walked.golfer[0] - initial.golfer[0], walked.golfer[2] - initial.golfer[2]);
  const walkedOffset = walked.camera.position.map((value, index) => value - walked.golfer[index]);
  if (walkedDistance < 4.5 || walked.traversal.mode !== 'walking') {
    throw new Error(`Golfer traversal failed: ${JSON.stringify(walked.traversal)}`);
  }
  if (walked.environment.surfaceInteractions < 1) {
    throw new Error('Embodied walking did not reach the reactive grass field.');
  }
  if (!arraysClose(initialOffset, walkedOffset)
      || !arraysClose(initial.camera.quaternion, walked.camera.quaternion)) {
    throw new Error('Camera contract changed during embodied walking.');
  }
  await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').finish());
  await capture(page, '17-embodied-walking');

  await page.evaluate(() => {
    window.__STYLE_LAB__.moveTo(-5, -10);
    window.__STYLE_LAB__.setMoveTarget(-30, 4);
    window.__STYLE_LAB__.simulate(8);
    window.__STYLE_LAB__.releaseMove();
  });
  const shoreline = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (shoreline.traversal.surface === 'water' || shoreline.traversal.surface === 'cliff') {
    throw new Error(`Golfer entered unsafe terrain: ${shoreline.traversal.surface}.`);
  }

  await page.evaluate(() => {
    window.__STYLE_LAB__.moveTo(5, -64);
    window.__STYLE_LAB__.interact();
  });
  const entered = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (entered.traversal.mode !== 'driving') throw new Error('Cart entry failed.');
  const cartStart = entered.traversal.cart;
  const chunkStart = entered.foundation.primaryChunk;
  await page.keyboard.down('w');
  await page.evaluate(() => window.__STYLE_LAB__.simulate(7));
  await page.keyboard.up('w');
  const driven = await page.evaluate(() => window.__STYLE_LAB__.state());
  const cartDistance = Math.hypot(
    driven.traversal.cart[0] - cartStart[0],
    driven.traversal.cart[2] - cartStart[2],
  );
  if (cartDistance < 30 || driven.traversal.mode !== 'driving') {
    throw new Error(`Cart traversal failed: ${JSON.stringify(driven.traversal)}`);
  }
  const cartDirection = [
    (driven.traversal.cart[0] - cartStart[0]) / cartDistance,
    (driven.traversal.cart[2] - cartStart[2]) / cartDistance,
  ];
  const cartForwardDot = cartDirection[0] * driven.traversal.cartVisualForward[0]
    + cartDirection[1] * driven.traversal.cartVisualForward[2];
  if (cartForwardDot < 0.96) {
    throw new Error(`Cart visual long axis is not aligned with travel: ${cartForwardDot}.`);
  }
  if (driven.foundation.primaryChunk === chunkStart
      || driven.foundation.activeChunks !== driven.foundation.renderedChunks
      || driven.foundation.activeChunks !== driven.foundation.streamedColliders) {
    throw new Error('Cart-speed chunk streaming failed.');
  }
  await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').finish());
  await capture(page, '18-cart-traversal-and-tracks');
  await captureGolferDetail(page, '18-cart-driver-detail');
  await page.evaluate(() => window.__STYLE_LAB__.interact());
  const exited = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (exited.traversal.mode !== 'walking') throw new Error('Safe cart exit failed.');

  process.stdout.write(`${JSON.stringify({
    stage2: 'passed',
    walkedDistance,
    shorelineSurface: shoreline.traversal.surface,
    cartDistance,
    cartForwardDot,
    streamedChunk: driven.foundation.primaryChunk,
    exitMode: exited.traversal.mode,
  }, null, 2)}\n`);
}

async function verifyEmbodiedGolf(page) {
  await page.evaluate(() => {
    window.__STYLE_LAB__.focus('tee');
    window.__STYLE_LAB__.interact();
    window.__STYLE_LAB__.simulate(3);
  });
  const stance = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (stance.traversal.mode !== 'stance'
      || stance.traversal.swingPhase !== 'ready'
      || !stance.traversal.addressedBallId) {
    throw new Error(`Stance entry failed: ${JSON.stringify(stance.traversal)}`);
  }
  const bodyForward = [
    Math.sin(stance.traversal.golferHeading),
    Math.cos(stance.traversal.golferHeading),
  ];
  const shotForward = [
    Math.sin(stance.traversal.swingShotHeading),
    Math.cos(stance.traversal.swingShotHeading),
  ];
  const bodyShotDot = Math.abs(bodyForward[0] * shotForward[0] + bodyForward[1] * shotForward[1]);
  const clubBallDistance = Math.hypot(
    stance.traversal.clubHead[0] - stance.ball[0],
    stance.traversal.clubHead[2] - stance.ball[2],
  );
  if (bodyShotDot > 0.12 || clubBallDistance > 0.46) {
    throw new Error(`Address geometry is not side-on at the ball: ${JSON.stringify({ bodyShotDot, clubBallDistance })}`);
  }
  await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').finish());
  await capture(page, '19-ball-address-and-stance');
  await captureGolferDetail(page, '19a-address-detail');

  await page.keyboard.down('a');
  await page.evaluate(() => window.__STYLE_LAB__.simulate(10));
  await page.keyboard.up('a');
  const boundedAlignment = await page.evaluate(() => window.__STYLE_LAB__.state());
  const alignmentDelta = Math.atan2(
    Math.sin(boundedAlignment.traversal.swingShotHeading - stance.traversal.swingShotHeading),
    Math.cos(boundedAlignment.traversal.swingShotHeading - stance.traversal.swingShotHeading),
  );
  if (Math.abs(alignmentDelta) > 0.181 || Math.abs(alignmentDelta) < 0.17) {
    throw new Error(`Keyboard stance alignment was not bounded: ${alignmentDelta}.`);
  }
  await page.keyboard.down('d');
  await page.evaluate(() => window.__STYLE_LAB__.simulate(0.33));
  await page.keyboard.up('d');

  // A cancelled pull must return to address and must never launch a ball.
  const eventsBeforeCancel = stance.eventTypes.length;
  await page.mouse.move(480, 320);
  await page.mouse.down();
  await page.mouse.move(510, 440, { steps: 5 });
  await page.dispatchEvent('canvas', 'pointercancel', { pointerId: 1, bubbles: true });
  await page.mouse.up();
  const cancelled = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (cancelled.traversal.swingPhase !== 'ready'
      || cancelled.eventTypes.slice(eventsBeforeCancel).includes('launched')) {
    throw new Error(`Cancelled swing committed gameplay: ${JSON.stringify(cancelled.traversal)}`);
  }

  await page.mouse.move(480, 320);
  await page.mouse.down();
  await page.mouse.move(535, 515, { steps: 8 });
  await page.evaluate(() => window.__STYLE_LAB__.simulate(0));
  const backswing = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (backswing.traversal.swingPhase !== 'backswing' || backswing.traversal.swingPower < 0.25) {
    throw new Error(`Backswing presentation failed: ${JSON.stringify(backswing.traversal)}`);
  }
  await capture(page, '19b-visible-backswing');
  await captureGolferDetail(page, '19b-backswing-detail');
  await page.mouse.up();
  const released = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (released.traversal.swingPhase !== 'downswing' || released.eventTypes.includes('launched')) {
    throw new Error(`Release was not a delayed downswing: ${JSON.stringify(released.traversal)}`);
  }
  await page.evaluate(() => window.__STYLE_LAB__.simulate(0.12));
  const preImpact = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (preImpact.eventTypes.includes('launched')) {
    throw new Error('Ball launched before the named club-impact frame.');
  }
  await page.evaluate(() => window.__STYLE_LAB__.simulate(0.07));
  const impact = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (impact.traversal.mode !== 'stance'
      || !impact.golfEventTypes.some((event) => event.startsWith('club-impact:'))
      || !impact.eventTypes.includes('launched')) {
    throw new Error(`Drag/release swing failed: ${JSON.stringify(impact)}`);
  }
  await capture(page, '19c-club-impact');
  await captureGolferDetail(page, '19c-impact-detail');
  if (!arraysClose(impact.camera.quaternion, stance.camera.quaternion)
      || impact.camera.zoom !== stance.camera.zoom) {
    throw new Error('Camera changed during embodied swing.');
  }

  // Capture the held, readable finish rather than the first transitional
  // frame immediately after the downswing crosses into follow-through.
  await page.evaluate(() => window.__STYLE_LAB__.simulate(0.38));
  const followThrough = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (followThrough.traversal.swingPhase !== 'follow-through') {
    throw new Error(`Follow-through did not remain visible: ${followThrough.traversal.swingPhase}.`);
  }
  await capture(page, '19d-follow-through');
  await captureGolferDetail(page, '19d-follow-through-detail');
  await page.evaluate(() => window.__STYLE_LAB__.simulate(1.2));
  const recovered = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (recovered.traversal.mode !== 'walking' || recovered.traversal.swingPhase !== 'idle') {
    throw new Error(`Swing did not recover to traversal: ${JSON.stringify(recovered.traversal)}`);
  }

  await page.evaluate(() => window.__STYLE_LAB__.simulate(6.4));
  const offscreen = await page.evaluate(() => window.__STYLE_LAB__.state());
  const ballDistance = Math.hypot(
    offscreen.ball[0] - offscreen.golfer[0],
    offscreen.ball[2] - offscreen.golfer[2],
  );
  if (ballDistance < 24) throw new Error(`Shot did not leave the golfer's fixed view: ${ballDistance}.`);
  await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').finish());
  await capture(page, '20-ball-offscreen-camera-stays-with-golfer');

  await page.evaluate(({ x, z }) => {
    window.__STYLE_LAB__.setMoveTarget(x, z);
    window.__STYLE_LAB__.simulate(20);
    window.__STYLE_LAB__.releaseMove();
    window.__STYLE_LAB__.placeBall();
    window.__STYLE_LAB__.placeBall();
  }, { x: offscreen.ball[0], z: offscreen.ball[2] });
  const rediscovered = await page.evaluate(() => window.__STYLE_LAB__.state());
  const rediscoveryDistance = Math.hypot(
    rediscovered.ball[0] - rediscovered.golfer[0],
    rediscovered.ball[2] - rediscovered.golfer[2],
  );
  if (rediscoveryDistance > 2 || rediscovered.traversal.balls !== 3) {
    throw new Error(`Ball rediscovery or multi-ball placement failed: ${JSON.stringify(rediscovered.traversal)}`);
  }

  await page.evaluate(() => {
    window.__STYLE_LAB__.placeBallAt(1.8, 65.5);
    window.__STYLE_LAB__.simulate(0.05);
  });
  const cup = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (!cup.golfEventTypes.some((event) => event.startsWith('cup-entered:'))
      || cup.traversal.balls !== 4) {
    throw new Error('Cup capture did not occur without a completion state.');
  }

  const saved = await page.evaluate(() => window.__STYLE_LAB__.save());
  if (!saved) throw new Error('Multi-ball session save failed.');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__STYLE_LAB__?.ready === true);
  await page.evaluate(() => window.__STYLE_LAB__.captureMode(true));
  const restored = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (!restored.foundation.restoredSession || restored.traversal.balls !== 4) {
    throw new Error(`Multi-ball restore failed: ${JSON.stringify(restored.traversal)}`);
  }

  process.stdout.write(`${JSON.stringify({
    stage3: 'passed',
    addressedBall: stance.traversal.addressedBallId,
    bodyShotDot,
    clubBallDistance,
    cancelledSwingSafe: true,
    boundedAlignment: alignmentDelta,
    offscreenBallDistance: ballDistance,
    rediscoveryDistance,
    persistentBalls: restored.traversal.balls,
    cupCaptured: true,
  }, null, 2)}\n`);
}

async function verifyLivingResponse(page) {
  await page.evaluate(() => {
    window.__STYLE_LAB__.focus('tee');
    window.__STYLE_LAB__.setMoveTarget(10, -48);
    window.__STYLE_LAB__.simulate(3);
    window.__STYLE_LAB__.releaseMove();
    window.__STYLE_LAB__.moveTo(5, -64);
    window.__STYLE_LAB__.interact();
  });
  await page.keyboard.down('w');
  await page.evaluate(() => window.__STYLE_LAB__.simulate(3));
  await page.keyboard.up('w');
  await page.evaluate(() => {
    window.__STYLE_LAB__.focus('tee');
    window.__STYLE_LAB__.interact();
    window.__STYLE_LAB__.simulate(3);
  });
  await page.mouse.move(480, 320);
  await page.mouse.down();
  await page.mouse.move(525, 540, { steps: 8 });
  await page.mouse.up();
  await advanceUntil(page, 'terrain-impact', 9);
  await page.evaluate(() => window.__STYLE_LAB__.simulate(0.45));
  await page.waitForTimeout(80);
  const response = await page.evaluate(() => window.__STYLE_LAB__.state());
  const types = response.environment.traceTypes;
  if (types.footprint < 1 || types.cartTrack < 1 || types.divot < 1 || types.pitchMark < 1) {
    throw new Error(`Physical trace families are incomplete: ${JSON.stringify(types)}`);
  }
  if (response.environment.audioStatus === 'unavailable') {
    throw new Error('Web Audio was unavailable after a user gesture.');
  }
  await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').finish());
  await capture(page, '21-persistent-physical-traces');

  await page.evaluate(() => window.__STYLE_LAB__.pause(true));
  await page.check('#setting-contrast');
  await page.check('#setting-ball-size');
  await page.check('#setting-reduced-motion');
  await page.check('#setting-sound');
  const paused = await page.evaluate(() => ({
    state: window.__STYLE_LAB__.state(),
    panelHidden: document.querySelector('#pause-panel').hidden,
    diagnosticsHidden: document.querySelector('#diagnostics').hidden,
  }));
  if (!paused.state.environment.paused || paused.panelHidden || !paused.diagnosticsHidden
      || !Object.values(paused.state.environment.accessibility).every(Boolean)) {
    throw new Error(`Out-of-play accessibility surface failed: ${JSON.stringify(paused)}`);
  }
  await capture(page, '22-pause-and-accessibility');
  const traceCount = paused.state.environment.traces;
  await page.evaluate(() => {
    window.__STYLE_LAB__.pause(false);
    return window.__STYLE_LAB__.save();
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__STYLE_LAB__?.ready === true);
  await page.evaluate(() => window.__STYLE_LAB__.captureMode(true));
  const restored = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (restored.environment.traces !== traceCount
      || !Object.values(restored.environment.accessibility).every(Boolean)) {
    throw new Error(`Trace/settings persistence failed: ${JSON.stringify(restored.environment)}`);
  }

  process.stdout.write(`${JSON.stringify({
    stage4: 'passed',
    traces: restored.environment.traces,
    traceChunks: restored.environment.traceChunks,
    traceTypes: types,
    audioStatus: response.environment.audioStatus,
    accessibilityPersisted: true,
  }, null, 2)}\n`);
}

async function verifyFirstPlayable(page) {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.evaluate(() => {
    window.__STYLE_LAB__.captureMode(false);
    window.__STYLE_LAB__.focus('tee');
  });
  await page.waitForFunction(
    () => window.__STYLE_LAB__.state().performance.fps > 0,
    { timeout: 10_000 },
  );
  const mobile = await page.evaluate(() => ({
    state: window.__STYLE_LAB__.state(),
    pauseHidden: document.querySelector('#pause-panel').hidden,
    diagnosticsHidden: document.querySelector('#diagnostics').hidden,
  }));
  if (mobile.state.performance.fps < 18 || !mobile.pauseHidden || !mobile.diagnosticsHidden) {
    throw new Error(`Mobile world-only performance gate failed: ${JSON.stringify(mobile)}`);
  }

  await page.mouse.move(320, 430);
  await page.mouse.down();
  await page.waitForTimeout(80);
  const heldTarget = await page.evaluate(() => window.__STYLE_LAB__.state().traversal.cursorTarget);
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
  });
  await page.mouse.up();
  const cancelledTarget = await page.evaluate(() => window.__STYLE_LAB__.state().traversal.cursorTarget);
  if (!heldTarget || cancelledTarget !== null) throw new Error('Pointer cancellation did not safely stop intent.');

  await page.evaluate(() => window.__STYLE_LAB__.captureMode(true));
  const contextExtension = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    window.__contextRestore = () => extension.restoreContext();
    return true;
  });
  if (!contextExtension) throw new Error('WEBGL_lose_context is unavailable for recovery testing.');
  await page.waitForFunction(() => !document.querySelector('#loading').classList.contains('is-hidden'));
  await page.evaluate(() => window.__contextRestore());
  await page.waitForFunction(() => document.querySelector('#loading').classList.contains('is-hidden'));
  await page.waitForTimeout(100);
  await capture(page, '23-mobile-context-recovered');

  await page.evaluate(() => {
    window.__STYLE_LAB__.moveTo(42, -52);
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  });
  await page.waitForTimeout(120);
  const saved = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (!saved.foundation.lastSavedAt) throw new Error('Page lifecycle checkpoint did not save.');
  const savedGolfer = saved.golfer;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__STYLE_LAB__?.ready === true);
  const resumed = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (!resumed.foundation.restoredSession || !arraysClose(resumed.golfer, savedGolfer, 1e-4)) {
    throw new Error('First-playable lifecycle resume failed.');
  }

  process.stdout.write(`${JSON.stringify({
    stage5Mobile: 'passed',
    fps: mobile.state.performance.fps,
    frameMs: mobile.state.performance.frameMs,
    contextRecovered: true,
    pointerCancellation: true,
    lifecycleResume: true,
  }, null, 2)}\n`);
}

async function verifyDeniedStorage() {
  const context = await browser.newContext({ viewport: { width: 800, height: 500 } });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(`storage page error: ${error.message}`));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__STYLE_LAB__?.ready === true);
  await page.evaluate(() => {
    window.__STYLE_LAB__.captureMode(true);
    window.__STYLE_LAB__.setMoveTarget(7, -52);
    window.__STYLE_LAB__.simulate(2);
    window.__STYLE_LAB__.releaseMove();
  });
  const state = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (state.foundation.persistenceStatus !== 'unavailable'
      || Math.hypot(state.golfer[0], state.golfer[2] + 63) < 3) {
    throw new Error(`Denied-storage fallback was not playable: ${JSON.stringify(state.foundation)}`);
  }
  await context.close();
  return state.foundation.persistenceStatus;
}

async function verifyAmbientBreadth(page) {
  const beforeReaction = await page.evaluate(() => {
    window.__STYLE_LAB__.focus('tee');
    return window.__STYLE_LAB__.state().environment.airborneBirds;
  });
  await page.evaluate(() => {
    window.__STYLE_LAB__.setMoveTarget(13, -47);
    window.__STYLE_LAB__.simulate(4.5);
    window.__STYLE_LAB__.releaseMove();
  });
  const reacted = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (reacted.environment.airborneBirds < beforeReaction + 4) {
    throw new Error(`Nearby flock did not react to the golfer: ${JSON.stringify(reacted.environment)}.`);
  }
  await capture(page, '24a-flock-reacts-to-golfer');

  await page.evaluate(() => {
    window.__STYLE_LAB__.focus('hill');
    for (let index = 0; index < 7; index += 1) window.__STYLE_LAB__.simulate(20);
  });
  const breeze = await page.evaluate(() => window.__STYLE_LAB__.state());
  if (breeze.environment.ambientBirds < 12
      || breeze.environment.ambientFlocks < 3
      || breeze.environment.airborneBirds < 4
      || breeze.environment.weather !== 'breeze'
      || Math.hypot(...breeze.environment.wind) < 0.5) {
    throw new Error(`Shared ambient environment failed: ${JSON.stringify(breeze.environment)}`);
  }
  const normalPlayText = await page.evaluate(() => {
    const pause = document.querySelector('#pause-panel');
    const diagnostics = document.querySelector('#diagnostics');
    return !pause.hidden || !diagnostics.hidden;
  });
  if (normalPlayText) throw new Error('Ambient breadth introduced normal-play interface text.');
  await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').finish());
  await capture(page, '24-ambient-life-and-shared-breeze');

  await page.evaluate(() => {
    for (let index = 0; index < 4; index += 1) window.__STYLE_LAB__.simulate(20);
  });
  const overcast = await page.evaluate(() => window.__STYLE_LAB__.state().environment);
  if (overcast.weather !== 'overcast') {
    throw new Error(`Weather evolution did not reach its restrained overcast state: ${overcast.weather}.`);
  }
  process.stdout.write(`${JSON.stringify({
    stage6: 'passed',
    reactiveTakeoffBirds: reacted.environment.airborneBirds - beforeReaction,
    ambientBirds: breeze.environment.ambientBirds,
    ambientFlocks: breeze.environment.ambientFlocks,
    airborneBirds: breeze.environment.airborneBirds,
    breezeWind: breeze.environment.wind,
    weatherSequence: [breeze.environment.weather, overcast.weather],
    normalPlayRemainsWorldOnly: true,
  }, null, 2)}\n`);
}

try {
  if (ambientOnly) {
    const ambientPage = await openLab({ width: 1000, height: 625 });
    await verifyAmbientBreadth(ambientPage);
    await ambientPage.close();
  } else if (firstPlayableOnly) {
    const firstPlayablePage = await openLab({ width: 430, height: 932 });
    await verifyFirstPlayable(firstPlayablePage);
    await firstPlayablePage.close();
    const storageStatus = await verifyDeniedStorage();
    process.stdout.write(`${JSON.stringify({ stage5Storage: 'passed', storageStatus })}\n`);
  } else if (environmentOnly) {
    const environmentPage = await openLab({ width: 1000, height: 625 });
    await verifyLivingResponse(environmentPage);
    await environmentPage.close();
  } else if (golfOnly) {
    const golfPage = await openLab({ width: 1000, height: 625 });
    await verifyEmbodiedGolf(golfPage);
    await golfPage.close();
  } else if (traversalOnly) {
    const traversalPage = await openLab({ width: 1000, height: 625 });
    await verifyEmbodiedTraversal(traversalPage);
    await traversalPage.close();
  } else if (foundationOnly) {
    const foundationPage = await openLab({ width: 1000, height: 625 });
    await verifyContinuousProperty(foundationPage);
    await foundationPage.close();
  } else {
  const desktop = await openLab({ width: 1440, height: 900 });
  const quickFocus = process.env.QUICK_FOCUS;
  if (process.env.QUICK_ART_CHECK === '1' && quickFocus) {
    await desktop.evaluate((focusArea) => window.__STYLE_LAB__.focus(focusArea), quickFocus);
    await desktop.waitForTimeout(80);
  }
  await capture(
    desktop,
    process.env.QUICK_ART_CHECK === '1' && quickFocus
      ? `preview-${quickFocus}`
      : '01-tee-desktop-clean',
  );

  if (process.env.QUICK_ART_CHECK === '1') {
    await desktop.close();
  } else {
  for (const [area, name] of [
    ['hill', '03-hill-swale'],
    ['green', '04-green-transition'],
    ['bank', '05-raised-bank'],
    ['water', '06-water-shoreline'],
  ]) {
    await desktop.evaluate((focusArea) => window.__STYLE_LAB__.focus(focusArea), area);
    await desktop.waitForTimeout(80);
    await capture(desktop, name);
  }

  await desktop.evaluate(() => window.__STYLE_LAB__.shoot('bunker'));
  if (extendedReview) await capture(desktop, '07-sand-flight');
  const sandState = await advanceUntil(desktop, 'terrain-impact', 4);
  if (sandState.surface !== 'sand') throw new Error(`Bunker preset landed on ${sandState.surface}.`);
  await capture(desktop, '08-sand-impact');
  if (extendedReview) {
    await desktop.evaluate(() => window.__STYLE_LAB__.simulate(2));
    await capture(desktop, '09-sand-settled');
  }

  await desktop.evaluate(() => window.__STYLE_LAB__.shoot('water'));
  if (extendedReview) await capture(desktop, '10-water-flight');
  await advanceUntil(desktop, 'water-entered', 5);
  await desktop.evaluate(() => window.__STYLE_LAB__.simulate(0.55));
  await capture(desktop, '11-water-impact');
  if (extendedReview) {
    await desktop.evaluate(() => window.__STYLE_LAB__.simulate(2.5));
    await capture(desktop, '12-water-settled');
  }

  await desktop.evaluate(() => window.__STYLE_LAB__.shoot('fairway'));
  const cameraBeforeFlight = await desktop.evaluate(() => window.__STYLE_LAB__.state().camera);
  await desktop.evaluate(() => window.__STYLE_LAB__.simulate(0.5));
  await capture(desktop, '13-ball-in-flight-camera-locked');
  const cameraCheck = await desktop.evaluate(() => ({
    contract: window.__STYLE_LAB__.cameraContract,
    state: window.__STYLE_LAB__.state(),
  }));
  if (JSON.stringify(cameraCheck.state.camera) !== JSON.stringify(cameraBeforeFlight)) {
    throw new Error('Camera pose changed while the ball was in flight.');
  }
  process.stdout.write(`${JSON.stringify(cameraCheck, null, 2)}\n`);
  await desktop.setViewportSize({ width: 430, height: 932 });
  await desktop.evaluate(() => window.__STYLE_LAB__.focus('tee'));
  await desktop.waitForTimeout(80);
  await capture(desktop, '02-tee-phone-portrait');
  await desktop.evaluate(() => window.__STYLE_LAB__.focus('water'));
  await desktop.waitForTimeout(80);
  if (extendedReview) await capture(desktop, '14-water-phone-portrait');
  // Reuse the proven WebGL page for the final persistence/foundation gate.
  // Opening a second software-rendered page after the extended gallery can
  // exhaust Chromium's SwiftShader context even though the game is healthy.
  await verifyContinuousProperty(desktop);
  await desktop.close();
  }
  }
} finally {
  await browser.close();
  serverProcess?.kill('SIGTERM');
}

if (failures.length > 0) {
  throw new Error(`Browser errors:\n${failures.join('\n')}`);
}

process.stdout.write(`Captured screenshots in ${outputDirectory.pathname}\n`);
