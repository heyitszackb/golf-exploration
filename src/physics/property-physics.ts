import RAPIER, {
  ColliderDesc,
  Ray,
  RigidBodyDesc,
  World,
  type Collider,
  type KinematicCharacterController,
  type RigidBody,
} from '@dimforge/rapier3d-compat';
import { propertyField } from '../world/property-field';
import { PROPERTY_BLUEPRINT } from '../world/property-blueprint';
import {
  type PropertyChunkConsumer,
  type PropertyChunkDescriptor,
  type PropertyChunkStreamer,
} from '../world/property-streamer';

export interface KinematicAgentConfig {
  readonly radius: number;
  /** Length of the straight section above and below the capsule center. */
  readonly halfHeight: number;
  readonly stepHeight: number;
  readonly maxSlopeRadians: number;
}

export interface KinematicAgentPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface KinematicMoveResult extends KinematicAgentPosition {
  readonly grounded: boolean;
  readonly collisions: number;
}

interface KinematicAgent {
  readonly body: RigidBody;
  readonly collider: Collider;
  readonly controller: KinematicCharacterController;
  readonly footOffset: number;
}

function createChunkColliderVertices(chunk: PropertyChunkDescriptor): {
  vertices: Float32Array;
  indices: Uint32Array;
} {
  const segments = PROPERTY_BLUEPRINT.terrainSegmentsPerChunk;
  const verticesPerSide = segments + 1;
  const vertices = new Float32Array(verticesPerSide * verticesPerSide * 3);
  const indices = new Uint32Array(segments * segments * 6);
  const step = PROPERTY_BLUEPRINT.chunkSize / segments;

  let vertexOffset = 0;
  for (let z = 0; z <= segments; z += 1) {
    for (let x = 0; x <= segments; x += 1) {
      const localX = -PROPERTY_BLUEPRINT.chunkSize / 2 + x * step;
      const localZ = -PROPERTY_BLUEPRINT.chunkSize / 2 + z * step;
      const worldX = chunk.centerX + localX;
      const worldZ = chunk.centerZ + localZ;
      vertices[vertexOffset] = localX;
      vertices[vertexOffset + 1] = propertyField.heightAt(worldX, worldZ);
      vertices[vertexOffset + 2] = localZ;
      vertexOffset += 3;
    }
  }

  let indexOffset = 0;
  for (let z = 0; z < segments; z += 1) {
    for (let x = 0; x < segments; x += 1) {
      const a = z * verticesPerSide + x;
      const b = a + 1;
      const c = a + verticesPerSide;
      const d = c + 1;
      indices[indexOffset] = a;
      indices[indexOffset + 1] = c;
      indices[indexOffset + 2] = b;
      indices[indexOffset + 3] = b;
      indices[indexOffset + 4] = c;
      indices[indexOffset + 5] = d;
      indexOffset += 6;
    }
  }
  return { vertices, indices };
}

export class PropertyPhysics implements PropertyChunkConsumer {
  readonly rapierVersion: string;
  private readonly world: World;
  private readonly chunkColliders = new Map<string, Collider>();
  private readonly boundaryColliders: Collider[] = [];
  private readonly agents = new Map<string, KinematicAgent>();

  private constructor(streamer: PropertyChunkStreamer) {
    this.rapierVersion = RAPIER.version();
    this.world = new World({ x: 0, y: -9.81, z: 0 });
    this.createPhysicalBoundary();
    streamer.register(this);
  }

  static async create(streamer: PropertyChunkStreamer): Promise<PropertyPhysics> {
    await RAPIER.init();
    return new PropertyPhysics(streamer);
  }

  activateChunk(chunk: PropertyChunkDescriptor): void {
    if (this.chunkColliders.has(chunk.key)) return;
    const { vertices, indices } = createChunkColliderVertices(chunk);
    const descriptor = ColliderDesc.trimesh(vertices, indices)
      .setTranslation(chunk.centerX, 0, chunk.centerZ)
      .setFriction(0.8)
      .setRestitution(0.05);
    const collider = this.world.createCollider(descriptor);
    this.chunkColliders.set(chunk.key, collider);
  }

  deactivateChunk(key: string): void {
    const collider = this.chunkColliders.get(key);
    if (!collider) return;
    this.world.removeCollider(collider, false);
    this.chunkColliders.delete(key);
  }

  step(delta: number): void {
    this.world.timestep = Math.min(1 / 30, Math.max(1 / 240, delta));
    this.world.step();
  }

  createKinematicAgent(
    id: string,
    groundPosition: KinematicAgentPosition,
    config: KinematicAgentConfig,
  ): void {
    if (this.agents.has(id)) return;
    const footOffset = config.halfHeight + config.radius;
    const body = this.world.createRigidBody(
      RigidBodyDesc.kinematicPositionBased().setTranslation(
        groundPosition.x,
        groundPosition.y + footOffset,
        groundPosition.z,
      ),
    );
    const collider = this.world.createCollider(
      ColliderDesc.capsule(config.halfHeight, config.radius).setFriction(0),
      body,
    );
    const controller = this.world.createCharacterController(0.025);
    controller.setSlideEnabled(true);
    controller.enableAutostep(config.stepHeight, config.radius * 1.4, false);
    controller.enableSnapToGround(0.32);
    controller.setMaxSlopeClimbAngle(config.maxSlopeRadians);
    controller.setMinSlopeSlideAngle(config.maxSlopeRadians + 0.08);
    this.agents.set(id, { body, collider, controller, footOffset });
  }

  teleportKinematicAgent(id: string, groundPosition: KinematicAgentPosition): void {
    const agent = this.requireAgent(id);
    const center = {
      x: groundPosition.x,
      y: groundPosition.y + agent.footOffset,
      z: groundPosition.z,
    };
    agent.body.setTranslation(center, true);
    agent.body.setNextKinematicTranslation(center);
  }

  moveKinematicAgent(
    id: string,
    desiredGroundDelta: KinematicAgentPosition,
  ): KinematicMoveResult {
    const agent = this.requireAgent(id);
    agent.controller.computeColliderMovement(
      agent.collider,
      desiredGroundDelta,
      undefined,
      undefined,
      (collider) => {
        for (const candidate of this.agents.values()) {
          if (candidate.collider.handle === collider.handle) return false;
        }
        return true;
      },
    );
    const movement = agent.controller.computedMovement();
    const current = agent.body.translation();
    const next = {
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    };
    agent.body.setNextKinematicTranslation(next);
    return {
      x: next.x,
      y: next.y - agent.footOffset,
      z: next.z,
      grounded: agent.controller.computedGrounded(),
      collisions: agent.controller.numComputedCollisions(),
    };
  }

  queryGroundHeight(x: number, z: number): number | null {
    const expected = propertyField.heightAt(x, z);
    const originY = expected + 24;
    const hit = this.world.castRay(
      new Ray({ x, y: originY, z }, { x: 0, y: -1, z: 0 }),
      48,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (collider) => {
        for (const agent of this.agents.values()) {
          if (agent.collider.handle === collider.handle) return false;
        }
        return true;
      },
    );
    return hit ? originY - hit.timeOfImpact : null;
  }

  get streamedColliderCount(): number {
    return this.chunkColliders.size;
  }

  get totalColliderCount(): number {
    return this.chunkColliders.size + this.boundaryColliders.length;
  }

  private createPhysicalBoundary(): void {
    const { bounds } = PROPERTY_BLUEPRINT;
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    const thickness = 2;
    const halfHeight = 8;
    const walls = [
      ColliderDesc.cuboid(width / 2 + thickness, halfHeight, thickness)
        .setTranslation(centerX, halfHeight, bounds.minZ - thickness),
      ColliderDesc.cuboid(width / 2 + thickness, halfHeight, thickness)
        .setTranslation(centerX, halfHeight, bounds.maxZ + thickness),
      ColliderDesc.cuboid(thickness, halfHeight, depth / 2 + thickness)
        .setTranslation(bounds.minX - thickness, halfHeight, centerZ),
      ColliderDesc.cuboid(thickness, halfHeight, depth / 2 + thickness)
        .setTranslation(bounds.maxX + thickness, halfHeight, centerZ),
    ];
    for (const wall of walls) this.boundaryColliders.push(this.world.createCollider(wall));
  }

  private requireAgent(id: string): KinematicAgent {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Unknown kinematic agent: ${id}`);
    return agent;
  }
}
