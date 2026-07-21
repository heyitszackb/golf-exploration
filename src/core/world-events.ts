import type { CourseSurface } from '../world/course';

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type WorldEvent =
  | {
    readonly type: 'golfer-moved';
    readonly position: WorldPoint;
    readonly speed: number;
    readonly surface: CourseSurface;
  }
  | {
    readonly type: 'footstep';
    readonly position: WorldPoint;
    readonly surface: CourseSurface;
    readonly strength: number;
  }
  | {
    readonly type: 'cart-moved';
    readonly position: WorldPoint;
    readonly previous: WorldPoint;
    readonly speed: number;
    readonly heading: number;
    readonly surface: CourseSurface;
  }
  | {
    readonly type: 'ball-moved';
    readonly ballId: string;
    readonly position: WorldPoint;
    readonly speed: number;
    readonly clearance: number;
  }
  | {
    readonly type: 'ball-launched';
    readonly ballId: string;
    readonly position: WorldPoint;
    readonly strength: number;
  }
  | {
    readonly type: 'ball-landed';
    readonly ballId: string;
    readonly position: WorldPoint;
    readonly surface: CourseSurface;
    readonly strength: number;
  }
  | {
    readonly type: 'water-splashed';
    readonly ballId: string;
    readonly position: WorldPoint;
    readonly strength: number;
  }
  | {
    readonly type: 'stance-settled';
    readonly position: WorldPoint;
  }
  | {
    readonly type: 'club-swing';
    readonly position: WorldPoint;
    readonly strength: number;
  }
  | {
    readonly type: 'club-impact';
    readonly ballId: string;
    readonly position: WorldPoint;
    readonly strength: number;
  };

export type WorldEventListener = (event: WorldEvent) => void;

/** Small synchronous domain-event seam; event producers never import render code. */
export class WorldEventBus {
  private readonly listeners = new Set<WorldEventListener>();

  subscribe(listener: WorldEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: WorldEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
