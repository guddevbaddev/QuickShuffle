import { REF_W, REF_H } from './fingerprint.ts';
import type { Matcher, MatchResult } from './matcher.ts';

// Extra margin captured around the guide box so the matcher can search a few
// offsets/scales (see candidateRects).
export const PAD = 0.12;
// Captured at 2x the reference size; the fingerprint averages it down.
const CAP_W = Math.round(REF_W * (1 + 2 * PAD) * 2);
const CAP_H = Math.round(REF_H * (1 + 2 * PAD) * 2);

// Scores below this mean "no card in the box" (empty frames score ~0.2).
const EMPTY_SCORE = 0.45;
// Consecutive agreeing frames needed before a card is accepted.
const STABLE_FRAMES = 2;
// Frames without a confident card before the same card can be counted again.
const CLEAR_FRAMES = 3;

export interface ScannerOptions {
  video: HTMLVideoElement;
  guide: HTMLElement;
  matcher: () => Matcher;
  threshold: () => number;
  onDetect: (res: MatchResult) => void;
  onFrame?: (res: MatchResult | null) => void;
}

export class Scanner {
  private stream: MediaStream | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private running = false;
  private paused = false;
  private streakId: string | null = null;
  private streak = 0;
  private lockedId: string | null = null;
  private clear = 0;
  private opts: ScannerOptions;

  constructor(opts: ScannerOptions) {
    this.opts = opts;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CAP_W;
    this.canvas.height = CAP_H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  async start(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    const v = this.opts.video;
    v.srcObject = this.stream;
    await v.play();
    try {
      // Continuous autofocus where supported; ignored elsewhere.
      await this.track()?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] });
    } catch {
      /* not supported */
    }
    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  get active(): boolean {
    return this.stream !== null;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.streak = 0;
  }

  // Lets the same card be counted again immediately (e.g. after an undo).
  rearm(): void {
    this.lockedId = null;
    this.streak = 0;
  }

  private track(): MediaStreamTrack | undefined {
    return this.stream?.getVideoTracks()[0];
  }

  hasTorch(): boolean {
    const t = this.track();
    const caps = t?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
    return !!caps?.torch;
  }

  async setTorch(on: boolean): Promise<void> {
    await this.track()?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
  }

  private loop = (): void => {
    if (!this.running) return;
    if (!this.paused && this.opts.video.readyState >= 2) {
      const res = this.grab();
      this.opts.onFrame?.(res);
      if (res) this.step(res);
    }
    // Throttle a little so slower phones stay responsive.
    setTimeout(() => requestAnimationFrame(this.loop), 60);
  };

  private step(res: MatchResult): void {
    const best = res.best;
    const confident = best !== null && best.score >= this.opts.threshold();
    if (!best || best.score < EMPTY_SCORE) {
      this.streak = 0;
      this.streakId = null;
      if (++this.clear >= CLEAR_FRAMES) this.lockedId = null;
      return;
    }
    if (!confident) {
      this.streak = 0;
      return;
    }
    this.clear = 0;
    const id = best.card.id;
    if (id === this.lockedId) return;
    this.streak = id === this.streakId ? this.streak + 1 : 1;
    this.streakId = id;
    if (this.streak >= STABLE_FRAMES) {
      this.lockedId = id;
      this.streak = 0;
      this.opts.onDetect(res);
    }
  }

  // Maps the on-screen guide box to video pixels (the video uses object-fit: cover).
  private grab(): MatchResult | null {
    const v = this.opts.video;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return null;
    const vr = v.getBoundingClientRect();
    const gr = this.opts.guide.getBoundingClientRect();
    const scale = Math.max(vr.width / vw, vr.height / vh);
    const offX = (vr.width - vw * scale) / 2;
    const offY = (vr.height - vh * scale) / 2;
    const gx = (gr.left - vr.left - offX) / scale;
    const gy = (gr.top - vr.top - offY) / scale;
    const gw = gr.width / scale;
    const gh = gr.height / scale;
    const sx = gx - gw * PAD;
    const sy = gy - gh * PAD;
    const sw = gw * (1 + 2 * PAD);
    const sh = gh * (1 + 2 * PAD);
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, CAP_W, CAP_H);
    // Clamp the source rect to the frame; Safari draws nothing if it overflows.
    const cx0 = Math.max(0, sx);
    const cy0 = Math.max(0, sy);
    const cx1 = Math.min(vw, sx + sw);
    const cy1 = Math.min(vh, sy + sh);
    if (cx1 <= cx0 || cy1 <= cy0) return null;
    const kx = CAP_W / sw;
    const ky = CAP_H / sh;
    this.ctx.drawImage(v, cx0, cy0, cx1 - cx0, cy1 - cy0, (cx0 - sx) * kx, (cy0 - sy) * ky, (cx1 - cx0) * kx, (cy1 - cy0) * ky);
    const img = this.ctx.getImageData(0, 0, CAP_W, CAP_H);
    return this.opts.matcher().match(img.data, CAP_W, CAP_H, PAD, 6);
  }
}
