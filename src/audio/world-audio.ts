import type { CourseSurface } from '../world/course';

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

  setListener(position: SoundPosition): void {
    if (!this.context) return;
    const listener = this.context.listener;
    listener.positionX.value = position.x;
    listener.positionY.value = position.y + 1.4;
    listener.positionZ.value = position.z;
  }

  footstep(surface: CourseSurface, position: SoundPosition, strength = 1): void {
    this.noiseBurst(position, FOOTSTEP_TONE[surface], 0.055, 0.045 * strength);
  }

  clubSwing(position: SoundPosition, strength: number): void {
    this.noiseBurst(position, 1500, 0.12, 0.045 * strength);
  }

  impact(kind: 'club' | 'grass' | 'sand' | 'water' | 'cup' | 'cart', position: SoundPosition, strength: number): void {
    const frequencies = { club: 1250, grass: 720, sand: 260, water: 420, cup: 1850, cart: 180 };
    const duration = kind === 'water' ? 0.24 : kind === 'cart' ? 0.08 : 0.11;
    this.noiseBurst(position, frequencies[kind], duration, 0.075 * strength);
    if (kind === 'club' || kind === 'cup') this.tone(position, frequencies[kind], duration * 1.4, 0.035 * strength);
  }

  get activeVoices(): number {
    return this.voices;
  }

  private noiseBurst(position: SoundPosition, frequency: number, duration: number, gain: number): void {
    if (!this.context || !this.master || this.context.state !== 'running' || this.voices >= 16) return;
    this.noise ??= this.createNoiseBuffer(this.context);
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 0.75;
    const envelope = this.context.createGain();
    const volume = gain * (this.strongerCues ? 1.45 : 1);
    envelope.gain.setValueAtTime(volume, this.context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + duration);
    const panner = this.createPanner(position);
    source.connect(filter).connect(envelope).connect(panner).connect(this.master);
    this.voices += 1;
    source.addEventListener('ended', () => {
      this.voices = Math.max(0, this.voices - 1);
      source.disconnect();
    }, { once: true });
    source.start();
    source.stop(this.context.currentTime + duration + 0.02);
  }

  private tone(position: SoundPosition, frequency: number, duration: number, gain: number): void {
    if (!this.context || !this.master || this.context.state !== 'running' || this.voices >= 16) return;
    const oscillator = this.context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, this.context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.68, this.context.currentTime + duration);
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(gain, this.context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + duration);
    const panner = this.createPanner(position);
    oscillator.connect(envelope).connect(panner).connect(this.master);
    this.voices += 1;
    oscillator.addEventListener('ended', () => {
      this.voices = Math.max(0, this.voices - 1);
      oscillator.disconnect();
    }, { once: true });
    oscillator.start();
    oscillator.stop(this.context.currentTime + duration + 0.02);
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
