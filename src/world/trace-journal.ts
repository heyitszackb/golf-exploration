import { propertyChunkAt, propertyChunkKey } from './property-streamer';

export type TraceType =
  | 'footprint'
  | 'bent-grass'
  | 'cart-track'
  | 'pitch-mark'
  | 'divot'
  | 'sand-crater'
  | 'sand-drag';

export interface TraceEvent {
  readonly id: string;
  readonly chunkId: string;
  readonly type: TraceType;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly directionX: number;
  readonly directionZ: number;
  readonly scale: number;
  readonly strength: number;
  readonly createdAt: number;
  readonly lifetime: number | 'session';
}

export type NewTraceEvent = Omit<TraceEvent, 'id' | 'chunkId' | 'createdAt'> & {
  readonly createdAt?: number;
};

const TYPE_CAPS: Readonly<Record<TraceType, number>> = Object.freeze({
  footprint: 96,
  'bent-grass': 72,
  'cart-track': 96,
  'pitch-mark': 32,
  divot: 32,
  'sand-crater': 28,
  'sand-drag': 40,
});

let traceSequence = 1;

export class TraceJournal {
  private readonly chunks = new Map<string, TraceEvent[]>();

  add(input: NewTraceEvent): TraceEvent {
    const chunk = propertyChunkAt(input.x, input.z);
    const chunkId = propertyChunkKey(chunk.x, chunk.z);
    const event: TraceEvent = Object.freeze({
      ...input,
      id: `trace-${traceSequence++}`,
      chunkId,
      createdAt: input.createdAt ?? Date.now(),
    });
    const events = this.chunks.get(chunkId) ?? [];
    events.push(event);
    this.compact(events, event.type);
    this.chunks.set(chunkId, events);
    return event;
  }

  restore(events: readonly TraceEvent[]): void {
    this.chunks.clear();
    for (const event of events) {
      const restored = Object.freeze({ ...event });
      const chunkEvents = this.chunks.get(restored.chunkId) ?? [];
      chunkEvents.push(restored);
      this.compact(chunkEvents, restored.type);
      this.chunks.set(restored.chunkId, chunkEvents);
      const sequence = /^trace-(\d+)$/.exec(restored.id);
      if (sequence) traceSequence = Math.max(traceSequence, Number(sequence[1]) + 1);
    }
  }

  eventsForChunk(chunkId: string): readonly TraceEvent[] {
    return this.chunks.get(chunkId) ?? [];
  }

  all(): readonly TraceEvent[] {
    return [...this.chunks.values()].flat();
  }

  get size(): number {
    let count = 0;
    for (const events of this.chunks.values()) count += events.length;
    return count;
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  count(type: TraceType): number {
    let count = 0;
    for (const events of this.chunks.values()) {
      for (const event of events) if (event.type === type) count += 1;
    }
    return count;
  }

  clear(): void {
    this.chunks.clear();
  }

  private compact(events: TraceEvent[], type: TraceType): void {
    const matching = events.filter((event) => event.type === type);
    const excess = matching.length - TYPE_CAPS[type];
    if (excess <= 0) return;
    const removeIds = new Set(matching.slice(0, excess).map((event) => event.id));
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (removeIds.has(events[index]!.id)) events.splice(index, 1);
    }
  }
}
