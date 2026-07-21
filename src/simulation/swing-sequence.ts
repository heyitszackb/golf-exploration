export type SwingPhase =
  | 'idle'
  | 'addressing'
  | 'ready'
  | 'backswing'
  | 'downswing'
  | 'follow-through'
  | 'recover';

export interface SwingPresentation {
  readonly phase: SwingPhase;
  readonly progress: number;
  readonly power: number;
  readonly shotHeading: number;
  readonly bodyHeading: number;
}

export type SwingSequenceEvent = 'stance-settled' | 'impact' | 'complete';

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Device-independent shot timing. Gameplay listens for the named impact event;
 * the renderer only consumes the presentation snapshot.
 */
export class SwingSequence {
  private currentPhase: SwingPhase = 'idle';
  private phaseTime = 0;
  private currentPower = 0;
  private heading = 0;
  private stanceBodyHeading = -Math.PI / 2;
  private addressHeading = 0;
  private addressBodyHeading = -Math.PI / 2;
  private gestureHeading = 0;
  private impacted = false;

  get active(): boolean {
    return this.currentPhase !== 'idle';
  }

  get acceptsGesture(): boolean {
    return this.currentPhase === 'ready' || this.currentPhase === 'backswing';
  }

  get phase(): SwingPhase {
    return this.currentPhase;
  }

  beginAddress(shotHeading: number, bodyHeading: number): void {
    this.heading = shotHeading;
    this.stanceBodyHeading = bodyHeading;
    this.addressHeading = shotHeading;
    this.addressBodyHeading = bodyHeading;
    this.currentPower = 0;
    this.phaseTime = 0;
    this.impacted = false;
    this.currentPhase = 'addressing';
  }

  settle(): SwingSequenceEvent {
    this.currentPhase = 'ready';
    this.phaseTime = 0;
    return 'stance-settled';
  }

  beginGesture(): boolean {
    if (this.currentPhase !== 'ready') return false;
    this.currentPhase = 'backswing';
    this.phaseTime = 0;
    this.currentPower = 0;
    this.gestureHeading = this.heading;
    return true;
  }

  updateGesture(horizontal: number, pull: number, minimumDimension: number, width: number): void {
    if (this.currentPhase !== 'backswing') return;
    const distance = Math.hypot(horizontal * 0.58, Math.max(0, pull));
    this.currentPower = smoothstep(distance / Math.max(1, minimumDimension * 0.42));
    const alignmentDelta = clamp(horizontal / Math.max(1, width) * 0.72, -0.18, 0.18);
    this.heading = clamp(
      this.gestureHeading + alignmentDelta,
      this.addressHeading - 0.18,
      this.addressHeading + 0.18,
    );
    this.stanceBodyHeading = this.addressBodyHeading + (this.heading - this.addressHeading);
  }

  nudgeAlignment(deltaRadians: number): void {
    if (this.currentPhase !== 'ready') return;
    const delta = clamp(deltaRadians, -0.035, 0.035);
    this.heading = clamp(
      this.heading + delta,
      this.addressHeading - 0.18,
      this.addressHeading + 0.18,
    );
    this.stanceBodyHeading = this.addressBodyHeading + (this.heading - this.addressHeading);
  }

  release(): boolean {
    if (this.currentPhase !== 'backswing') return false;
    if (this.currentPower < 0.075) {
      this.currentPhase = 'ready';
      this.phaseTime = 0;
      this.currentPower = 0;
      return false;
    }
    this.currentPhase = 'downswing';
    this.phaseTime = 0;
    this.impacted = false;
    return true;
  }

  cancelGesture(): void {
    if (this.currentPhase !== 'backswing') return;
    this.currentPhase = 'ready';
    this.phaseTime = 0;
    this.currentPower = 0;
  }

  cancel(): void {
    this.currentPhase = 'idle';
    this.phaseTime = 0;
    this.currentPower = 0;
    this.impacted = false;
  }

  step(delta: number): SwingSequenceEvent[] {
    if (delta <= 0 || this.currentPhase === 'idle' || this.currentPhase === 'addressing'
        || this.currentPhase === 'ready' || this.currentPhase === 'backswing') return [];
    this.phaseTime += delta;
    const events: SwingSequenceEvent[] = [];
    if (this.currentPhase === 'downswing') {
      if (!this.impacted && this.phaseTime >= 0.17) {
        this.impacted = true;
        events.push('impact');
      }
      if (this.phaseTime >= 0.31) {
        this.currentPhase = 'follow-through';
        this.phaseTime = 0;
      }
    } else if (this.currentPhase === 'follow-through' && this.phaseTime >= 0.52) {
      this.currentPhase = 'recover';
      this.phaseTime = 0;
    } else if (this.currentPhase === 'recover' && this.phaseTime >= 0.42) {
      this.currentPhase = 'idle';
      this.phaseTime = 0;
      events.push('complete');
    }
    return events;
  }

  snapshot(): SwingPresentation {
    const durations: Readonly<Record<SwingPhase, number>> = {
      idle: 1,
      addressing: 1,
      ready: 1,
      backswing: 1,
      downswing: 0.31,
      'follow-through': 0.52,
      recover: 0.42,
    };
    return {
      phase: this.currentPhase,
      progress: this.currentPhase === 'backswing'
        ? this.currentPower
        : clamp(this.phaseTime / durations[this.currentPhase], 0, 1),
      power: this.currentPower,
      shotHeading: this.heading,
      bodyHeading: this.stanceBodyHeading,
    };
  }
}
