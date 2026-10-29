// gifenc ships no types; these cover the calls the GIF check makes.
declare module 'gifenc' {
  export type Palette = number[][];
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: object): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: string): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number, options?: { palette?: Palette; delay?: number; repeat?: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}
