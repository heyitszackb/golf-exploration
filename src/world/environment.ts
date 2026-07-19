export type WeatherKind = 'clear' | 'breeze' | 'overcast';

export interface EnvironmentSample {
  readonly weather: WeatherKind;
  readonly intensity: number;
  readonly windX: number;
  readonly windZ: number;
  readonly paperTone: number;
}

export function sampleEnvironment(timeSeconds: number): EnvironmentSample {
  const cycle = ((timeSeconds % 240) + 240) % 240;
  const weather: WeatherKind = cycle < 132 ? 'clear' : cycle < 196 ? 'breeze' : 'overcast';
  const weatherAmount = weather === 'clear' ? 0.24 : weather === 'breeze' ? 0.62 : 0.38;
  const pulse = Math.sin(timeSeconds * 0.071) * 0.12 + Math.sin(timeSeconds * 0.019 + 1.4) * 0.08;
  const intensity = Math.max(0.08, Math.min(0.82, weatherAmount + pulse));
  const direction = 0.42 + Math.sin(timeSeconds * 0.0067) * 0.38;
  return {
    weather,
    intensity,
    windX: Math.sin(direction) * (0.6 + intensity * 2.2),
    windZ: Math.cos(direction) * (0.6 + intensity * 2.2),
    paperTone: weather === 'overcast' ? -0.025 : Math.sin(timeSeconds * 0.0017) * 0.008,
  };
}

