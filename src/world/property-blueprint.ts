export interface PropertyBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface PropertyBlueprint {
  readonly id: string;
  readonly schemaVersion: number;
  readonly generatorVersion: number;
  readonly seed: number;
  readonly bounds: PropertyBounds;
  readonly chunkSize: number;
  readonly renderRadiusChunks: number;
  readonly colliderRadiusChunks: number;
  readonly terrainSegmentsPerChunk: number;
  readonly boundaryBand: number;
  readonly start: Readonly<{ x: number; z: number; heading: number }>;
}

/**
 * Stage 1 property contract. Dimensions are exact multiples of the chunk size,
 * which keeps chunk ownership deterministic at the physical property edge.
 */
export const PROPERTY_BLUEPRINT: PropertyBlueprint = Object.freeze({
  id: 'founding-property',
  schemaVersion: 1,
  generatorVersion: 1,
  seed: 0x71c3a9,
  bounds: Object.freeze({
    minX: -288,
    maxX: 288,
    minZ: -384,
    maxZ: 384,
  }),
  chunkSize: 48,
  renderRadiusChunks: 2,
  colliderRadiusChunks: 2,
  terrainSegmentsPerChunk: 22,
  boundaryBand: 14,
  start: Object.freeze({ x: 0, z: -63, heading: 0.05 }),
});

export const PROPERTY_SCHEMA_ID = `${PROPERTY_BLUEPRINT.id}:schema-${PROPERTY_BLUEPRINT.schemaVersion}:generator-${PROPERTY_BLUEPRINT.generatorVersion}`;

