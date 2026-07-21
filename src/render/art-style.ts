/**
 * The shared visual grammar for the illustration renderer.
 *
 * Keeping the palette and light language here prevents terrain, props, marks,
 * water, and future authored assets from drifting into separate art styles.
 */
export const ART_PALETTE = Object.freeze({
  paper: 0xebd9b3,
  paperLight: 0xf1e3c3,
  graphite: 0x493f33,
  graphiteSoft: 0x6d5e49,
  grassInk: 0xa08d70,
  shadow: 0x604f3d,
  tee: 0xe3cfa3,
  fairway: 0xd7c398,
  green: 0xddc99f,
  rough: 0xd0bb90,
  deepRough: 0xc9b186,
  bunker: 0xe8d2a7,
  water: 0xcec1a6,
  bank: 0xbfa174,
  cliff: 0xab875c,
  cloth: 0x88775d,
  paleCloth: 0xd4c39e,
  skin: 0xa08663,
  ball: 0xf1e8cf,
});

export const ILLUSTRATION_LIGHT = Object.freeze({
  /** Direction from the surface toward the implied soft daylight. */
  direction: Object.freeze([-0.42, 0.82, -0.39] as const),
  shadowMapSize: 1024,
  shadowExtent: 82,
  shadowOpacity: 0.115,
});

export const ART_LIMITS = Object.freeze({
  grassInteractions: 12,
  maximumRenderedBalls: 24,
  maximumDevicePixelRatio: 1.65,
});
