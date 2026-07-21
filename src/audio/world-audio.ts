import type { CourseSurface } from '../world/course';
import type { WorldEvent } from '../core/world-events';

export type AudioStatus = 'locked' | 'running' | 'suspended' | 'unavailable';

interface SoundPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const FOOTSTEP_TONE: Readonly<Record<CourseSurface, number>> = Object.freeze({
  tee: 980,
  fairway: 900,
  green: 1080,
  rough: 620,
  deepRough: 470,
  bunker: 310,
  water: 260,
  bank: 520,
  cliff: 1350,
});

export class WorldAudio {
  status: AudioStatus = 'locked';
  strongerCues = false;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = 0;
  private lastCartCueAt = Number.NEGATIVE_INFINITY;
  private lastWaterCueAt = Number.NEGATIVE_INFINITY;

  async resume(): Promise<void> {
    if (!('AudioContext' in window)) {
      this.status = 'unavailable';
      return;
    }
    this.context ??= new AudioContext({ latencyHint: 'interactive' });
    this.master ??= this.context.createGain();
    this.master.gain.value = 0.36;
    this.master.connect(this.context.destination);
    if (this.context.state !== 'running') await this.context.resume();
    this.status = this.context.state === 'running' ? 'running' : 'suspended';
  }

  setListener(
    position: SoundPosition,
    forward?: SoundPosition,
    up?: SoundPosition,
  ): void {
    if (!this.context) return;
    const listener = this.context.listener;
    listener.positionX.value = position.x;
    listener.positionY.value = position.y + 1.4;
    listener.positionZ.value = position.z;
    if (forward) {
      listener.forwardX.value = forward.x;
      listener.forwardY.value = forward.y;
      listener.forwardZ.value = forward.z;
    }
    if (up) {
      listener.upX.value = up.x;
      listener.upY.value = up.y;
      listener.upZ.value = up.z;
    }
  }

  footstep(surface: CourseSurface, position: SoundPosition, strength = 1): void {
    const weight = this.normalizedStrength(strength);
    if (weight <= 0) return;
    const center = FOOTSTEP_TONE[surface];
    if (surface === 'bunker') {
      this.noiseSweep(position, center * 0.68, center * 1.9, 0.075, 0.044 * weight, 0.5);
      return;
    }
    this.noiseSweep(position, center * 1.08, center * 0.72, 0.052, 0.042 * weight, 0.82);
  }

  clubSwing(position: SoundPosition, strength: number): void {
    const weight = this.normalizedStrength(strength);
    if (weight <= 0) return;
    // A short rising band of air makes the downswing readable without sounding
    // like an impact. Contact is deliberately left to the club-impact event.
    this.noiseSweep(position, 520, 2_650, 0.105, 0.047 * weight, 0.62);
  }

  impact(kind: 'club' | 'grass' | 'sand' | 'water' | 'cup' | 'cart', position: SoundPosition, strength: number): void {
    const weight = this.normalizedStrength(strength);
    if (weight <= 0) return;

    switch (kind) {
      case 'club':
        // Compact transient, wooden body, and a restrained low impulse. The
        // layers share a very short envelope so contact stays crisp at distance.
        this.noiseSweep(position, 4_800, 2_100, 0.026, 0.082 * weight, 0.72);
        this.tone(position, 920, 0.064, 0.034 * weight, 0.54, 'triangle');
        this.tone(position, 190, 0.044, 0.014 * weight, 0.7, 'sine');
        break;
      case 'grass':
        this.noiseSweep(position, 1_050, 390, 0.09, 0.052 * weight, 0.62);
        if (weight > 0.45) this.tone(position, 155, 0.07, 0.012 * weight, 0.72, 'sine');
        break;
      case 'sand':
        this.noiseSweep(position, 260, 1_450, 0.16, 0.062 * weight, 0.42);
        this.noiseSweep(position, 1_850, 720, 0.085, 0.027 * weight, 0.74, 0.012);
        break;
      case 'water':
        this.noiseSweep(position, 1_250, 260, 0.27, 0.072 * weight, 0.48);
        this.tone(position, 205, 0.19, 0.023 * weight, 0.46, 'sine', 0.008);
        break;
      case 'cup':
        this.noiseSweep(position, 4_300, 2_600, 0.022, 0.048 * weight, 0.9);
        this.tone(position, 1_920, 0.22, 0.031 * weight, 0.94, 'sine');
        this.tone(position, 2_870, 0.16, 0.014 * weight, 0.96, 'sine', 0.006);
        break;
      case 'cart':
        this.noiseSweep(position, 260, 125, 0.08, 0.039 * weight, 0.56);
        this.tone(position, 112, 0.075, 0.013 * weight, 0.74, 'triangle');
        break;
    }
  }

  /**
   * Domain-event integration seam. Simulation code can publish one semantic
   * event without knowing how many audio layers make that event perceptible.
   */
  handleWorldEvent(event: WorldEvent): void {
    switch (event.type) {
      case 'footstep':
        this.footstep(event.surface, event.position, event.strength);
        break;
      case 'cart-moved': {
        if (!this.context || this.context.state !== 'running' || Math.abs(event.speed) < 0.65) break;
        const cadence = Math.max(0.16, 0.38 - Math.abs(event.speed) * 0.025);
        if (this.context.currentTime - this.lastCartCueAt < cadence) break;
        this.lastCartCueAt = this.context.currentTime;
        this.impact('cart', event.position, Math.min(0.72, 0.16 + Math.abs(event.speed) / 13));
        break;
      }
      case 'stance-settled':
        this.noiseSweep(event.position, 820, 470, 0.042, 0.012, 0.7);
        break;
      case 'club-swing':
        this.clubSwing(event.position, event.strength);
        break;
      case 'club-impact':
        this.impact('club', event.position, event.strength);
        break;
      case 'ball-landed':
        if (event.surface === 'water') this.waterResponse(event.position, event.strength);
        else this.impact(event.surface === 'bunker' ? 'sand' : 'grass', event.position, event.strength);
        break;
      case 'water-splashed':
        this.waterResponse(event.position, event.strength);
        break;
      case 'golfer-moved':
      case 'ball-moved':
      case 'ball-launched':
        // Continuous movement is represented by discrete steps, wheel cadence,
        // the swing sequence, and landing events instead of a constant audio bed.
        break;
    }
  }

  get activeVoices(): number {
    return this.voices;
  }

  private waterResponse(position: SoundPosition, strength: number): void {
    if (!this.context || this.context.state !== 'running') return;
    // A solver may publish both landed(water) and water-splashed for one contact.
    // Collapse those adjacent semantic events into a single splash.
    if (this.context.currentTime - this.lastWaterCueAt < 0.06) return;
    this.lastWaterCueAt = this.context.currentTime;
    this.impact('water', position, strength);
  }

  private noiseSweep(
    position: SoundPosition,
    startFrequency: number,
    endFrequency: number,
    duration: number,
    gain: number,
    q = 0.75,
    delay = 0,
  ): void {
    if (!this.context || !this.master || this.context.state !== 'running' || this.voices >= 16) return;
    this.noise ??= this.createNoiseBuffer(this.context);
    const start = this.context.currentTime + Math.max(0, delay);
    const length = Math.max(0.008, duration);
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(Math.max(30, startFrequency), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), start + length);
    filter.Q.value = Math.max(0.1, q);
    const envelope = this.context.createGain();
    const volume = Math.max(0.0001, gain * (this.strongerCues ? 1.45 : 1));
    const attack = Math.min(0.006, length * 0.16);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(volume, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
    const panner = this.createPanner(position);
    source.connect(filter).connect(envelope).connect(panner).connect(this.master);
    this.voices += 1;
    source.addEventListener('ended', () => {
      this.voices = Math.max(0, this.voices - 1);
      source.disconnect();
      filter.disconnect();
      envelope.disconnect();
      panner.disconnect();
    }, { once: true });
    source.start(start);
    source.stop(start + length + 0.02);
  }

  private tone(
    position: SoundPosition,
    frequency: number,
    duration: number,
    gain: number,
    endRatio = 0.68,
    waveform: OscillatorType = 'sine',
    delay = 0,
  ): void {
    if (!this.context || !this.master || this.context.state !== 'running' || this.voices >= 16) return;
    const start = this.context.currentTime + Math.max(0, delay);
    const length = Math.max(0.008, duration);
    const oscillator = this.context.createOscillator();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(Math.max(30, frequency), start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency * endRatio), start + length);
    const envelope = this.context.createGain();
    const volume = Math.max(0.0001, gain * (this.strongerCues ? 1.45 : 1));
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(volume, start + Math.min(0.004, length * 0.12));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
    const panner = this.createPanner(position);
    oscillator.connect(envelope).connect(panner).connect(this.master);
    this.voices += 1;
    oscillator.addEventListener('ended', () => {
      this.voices = Math.max(0, this.voices - 1);
      oscillator.disconnect();
      envelope.disconnect();
      panner.disconnect();
    }, { once: true });
    oscillator.start(start);
    oscillator.stop(start + length + 0.02);
  }

  private normalizedStrength(strength: number): number {
    if (!Number.isFinite(strength)) return 0;
    return Math.max(0, Math.min(1.5, strength));
  }

  private createPanner(position: SoundPosition): PannerNode {
    const panner = this.context!.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 2.5;
    panner.maxDistance = 90;
    panner.rolloffFactor = 1.15;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;
    return panner;
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.35), context.sampleRate);
    const channel = buffer.getChannelData(0);
    let state = 0x65a39;
    for (let index = 0; index < channel.length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      channel[index] = (state / 0xffffffff) * 2 - 1;
    }
    return buffer;
  }
}
