import { PROPERTY_BLUEPRINT, PROPERTY_SCHEMA_ID } from '../world/property-blueprint';
import type { TraceEvent } from '../world/trace-journal';
import type { WeatherKind } from '../world/environment';

const DATABASE_NAME = 'golf-exploration';
const DATABASE_VERSION = 1;
const SESSION_STORE = 'world-sessions';
const AUTOSAVE_ID = 'autosave';

export interface PersistedVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PersistedBall {
  readonly id: string;
  readonly position: PersistedVector3;
  readonly velocity: PersistedVector3;
  readonly angularVelocity: PersistedVector3;
  readonly motion: 'flight' | 'rolling' | 'resting' | 'submerged';
  readonly surface: string;
  readonly sleeping: boolean;
  readonly submerged: boolean;
}

export interface WorldSessionV1 {
  readonly id: typeof AUTOSAVE_ID;
  readonly schemaVersion: 1;
  readonly propertySchemaId: string;
  readonly savedAt: number;
  readonly golfer: Readonly<PersistedVector3 & { heading: number }>;
  readonly cart: Readonly<PersistedVector3 & { heading: number; parked: boolean }>;
  readonly balls: readonly PersistedBall[];
  readonly traces: readonly TraceEvent[];
  readonly selectedClub: 'versatile';
  readonly worldTimeSeconds: number;
  readonly weather: Readonly<{ kind: WeatherKind; intensity: number }>;
  readonly accessibility: Readonly<{
    highContrast: boolean;
    largerBalls: boolean;
    reducedMotion: boolean;
    strongerSound: boolean;
  }>;
}

export type SessionStoreStatus = 'idle' | 'opening' | 'ready' | 'saving' | 'unavailable' | 'error';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed.')), { once: true });
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')), { once: true });
  });
}

function isCompatibleSession(value: unknown): value is WorldSessionV1 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorldSessionV1>;
  return candidate.id === AUTOSAVE_ID
    && candidate.schemaVersion === 1
    && candidate.propertySchemaId === PROPERTY_SCHEMA_ID
    && typeof candidate.savedAt === 'number'
    && Array.isArray(candidate.balls)
    && Boolean(candidate.golfer)
    && Boolean(candidate.cart);
}

export class SessionStore {
  status: SessionStoreStatus = 'idle';
  lastSavedAt: number | null = null;
  lastError: string | null = null;
  private databasePromise?: Promise<IDBDatabase | null>;

  async load(): Promise<WorldSessionV1 | null> {
    const database = await this.open();
    if (!database) return null;
    try {
      const transaction = database.transaction(SESSION_STORE, 'readonly');
      const result = await requestResult(transaction.objectStore(SESSION_STORE).get(AUTOSAVE_ID));
      await transactionComplete(transaction);
      if (!isCompatibleSession(result)) return null;
      this.lastSavedAt = result.savedAt;
      return result;
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  async save(session: WorldSessionV1): Promise<boolean> {
    const database = await this.open();
    if (!database) return false;
    this.status = 'saving';
    try {
      const transaction = database.transaction(SESSION_STORE, 'readwrite');
      transaction.objectStore(SESSION_STORE).put(session);
      await transactionComplete(transaction);
      this.status = 'ready';
      this.lastSavedAt = session.savedAt;
      this.lastError = null;
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  async clear(): Promise<void> {
    const database = await this.open();
    if (!database) return;
    const transaction = database.transaction(SESSION_STORE, 'readwrite');
    transaction.objectStore(SESSION_STORE).delete(AUTOSAVE_ID);
    await transactionComplete(transaction);
    this.lastSavedAt = null;
  }

  private async open(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') {
      this.status = 'unavailable';
      return null;
    }
    this.databasePromise ??= this.openDatabase();
    return this.databasePromise;
  }

  private async openDatabase(): Promise<IDBDatabase | null> {
    this.status = 'opening';
    try {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.addEventListener('upgradeneeded', () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SESSION_STORE)) {
          database.createObjectStore(SESSION_STORE, { keyPath: 'id' });
        }
      });
      const database = await requestResult(request);
      database.addEventListener('versionchange', () => database.close());
      this.status = 'ready';
      this.lastError = null;
      return database;
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  private fail(error: unknown): void {
    this.status = 'error';
    this.lastError = error instanceof Error ? error.message : String(error);
  }
}

export function createDefaultSession(): WorldSessionV1 {
  const { start } = PROPERTY_BLUEPRINT;
  return {
    id: AUTOSAVE_ID,
    schemaVersion: 1,
    propertySchemaId: PROPERTY_SCHEMA_ID,
    savedAt: Date.now(),
    golfer: { x: start.x, y: 0, z: start.z, heading: start.heading },
    cart: { x: 5.8, y: 0, z: -64.5, heading: -0.08, parked: true },
    balls: [],
    traces: [],
    selectedClub: 'versatile',
    worldTimeSeconds: 0,
    weather: { kind: 'clear', intensity: 0 },
    accessibility: {
      highContrast: false,
      largerBalls: false,
      reducedMotion: false,
      strongerSound: false,
    },
  };
}
