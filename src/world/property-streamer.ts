import { PROPERTY_BLUEPRINT } from './property-blueprint';

export interface PropertyFocus {
  readonly x: number;
  readonly z: number;
  readonly radiusChunks?: number;
}

export interface PropertyChunkDescriptor {
  readonly key: string;
  readonly x: number;
  readonly z: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly seed: number;
}

export interface PropertyChunkConsumer {
  activateChunk(chunk: PropertyChunkDescriptor): void;
  deactivateChunk(key: string): void;
}

function hashChunk(x: number, z: number): number {
  let value = PROPERTY_BLUEPRINT.seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(z, 0x85ebca77);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return value >>> 0;
}

export function propertyChunkKey(x: number, z: number): string {
  return `${x}:${z}`;
}

export function propertyChunkAt(worldX: number, worldZ: number): Readonly<{ x: number; z: number }> {
  const { bounds, chunkSize } = PROPERTY_BLUEPRINT;
  return {
    x: Math.floor((worldX - bounds.minX) / chunkSize),
    z: Math.floor((worldZ - bounds.minZ) / chunkSize),
  };
}

function makeDescriptor(x: number, z: number): PropertyChunkDescriptor {
  const { bounds, chunkSize } = PROPERTY_BLUEPRINT;
  const minX = bounds.minX + x * chunkSize;
  const minZ = bounds.minZ + z * chunkSize;
  return Object.freeze({
    key: propertyChunkKey(x, z),
    x,
    z,
    centerX: minX + chunkSize / 2,
    centerZ: minZ + chunkSize / 2,
    minX,
    maxX: minX + chunkSize,
    minZ,
    maxZ: minZ + chunkSize,
    seed: hashChunk(x, z),
  });
}

export class PropertyChunkStreamer {
  private readonly consumers = new Set<PropertyChunkConsumer>();
  private readonly active = new Map<string, PropertyChunkDescriptor>();
  private centerX = 0;
  private centerZ = 0;

  register(consumer: PropertyChunkConsumer): () => void {
    this.consumers.add(consumer);
    for (const chunk of this.active.values()) consumer.activateChunk(chunk);
    return () => {
      this.consumers.delete(consumer);
      for (const chunk of this.active.values()) consumer.deactivateChunk(chunk.key);
    };
  }

  update(foci: readonly PropertyFocus[]): void {
    if (foci.length === 0) return;
    this.centerX = foci[0]!.x;
    this.centerZ = foci[0]!.z;
    const required = new Map<string, PropertyChunkDescriptor>();
    const { bounds, chunkSize, renderRadiusChunks } = PROPERTY_BLUEPRINT;
    const chunkCountX = Math.round((bounds.maxX - bounds.minX) / chunkSize);
    const chunkCountZ = Math.round((bounds.maxZ - bounds.minZ) / chunkSize);

    for (const focus of foci) {
      const center = propertyChunkAt(focus.x, focus.z);
      const radius = focus.radiusChunks ?? renderRadiusChunks;
      for (let z = center.z - radius; z <= center.z + radius; z += 1) {
        if (z < 0 || z >= chunkCountZ) continue;
        for (let x = center.x - radius; x <= center.x + radius; x += 1) {
          if (x < 0 || x >= chunkCountX) continue;
          const descriptor = makeDescriptor(x, z);
          required.set(descriptor.key, descriptor);
        }
      }
    }

    for (const [key] of this.active) {
      if (required.has(key)) continue;
      for (const consumer of this.consumers) consumer.deactivateChunk(key);
      this.active.delete(key);
    }

    const additions = [...required.values()]
      .filter((chunk) => !this.active.has(chunk.key))
      .sort((a, b) => {
        const distanceA = Math.hypot(a.centerX - this.centerX, a.centerZ - this.centerZ);
        const distanceB = Math.hypot(b.centerX - this.centerX, b.centerZ - this.centerZ);
        return distanceA - distanceB;
      });
    for (const chunk of additions) {
      this.active.set(chunk.key, chunk);
      for (const consumer of this.consumers) consumer.activateChunk(chunk);
    }
  }

  get activeChunks(): readonly PropertyChunkDescriptor[] {
    return [...this.active.values()];
  }

  get activeKeys(): readonly string[] {
    return [...this.active.keys()].sort();
  }

  get primaryChunkKey(): string {
    const center = propertyChunkAt(this.centerX, this.centerZ);
    return propertyChunkKey(center.x, center.z);
  }
}

