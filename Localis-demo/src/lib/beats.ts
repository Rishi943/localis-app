export const BPM = 100;
export const FPS = 30;
/** Frames per beat: FPS * 60 / BPM = 18 */
export const BEAT = 18;
/** Frames per bar (4 beats) */
export const BAR = 72;

export const beat = (n: number): number => Math.round(n * BEAT);
export const bar = (n: number): number => Math.round(n * BAR);
