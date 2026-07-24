export class EngineAudio {
  private static _ctx: AudioContext | undefined;

  private static ensureContext(): AudioContext {
    if (!EngineAudio._ctx) {
      try {
        EngineAudio._ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (EngineAudio._ctx.state === 'suspended') {
          EngineAudio._ctx.resume();
        }
      } catch {
        throw new Error('Failed to create AudioContext');
      }
    }
    return EngineAudio._ctx;
  }

  private ctx: AudioContext;
  private masterGain: GainNode;
  private isRunning = false;

  // engine nodes
  private engineOsc1?: OscillatorNode;
  private engineOsc2?: OscillatorNode;
  private engineGain?: GainNode;
  private engineFilter?: BiquadFilterNode;

  // wind nodes
  private windSource?: AudioBufferSourceNode;
  private windBuffer?: AudioBuffer;
  private windGain?: GainNode;
  private windFilter?: BiquadFilterNode;

  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? EngineAudio.ensureContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(this.ctx.destination);
  }

  start(): void {
    if (this.isRunning) return;

    const ctx = this.ctx;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // --- Engine oscillators ---
    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc2 = ctx.createOscillator();
    this.engineGain = ctx.createGain();
    this.engineFilter = ctx.createBiquadFilter();

    this.engineOsc1.type = 'sawtooth';
    this.engineOsc2.type = 'triangle';

    const idleFreq = 80;
    const idleGain = 0.12;

    this.engineOsc1.frequency.value = idleFreq;
    this.engineOsc2.frequency.value = idleFreq;
    this.engineOsc1.detune.value = 3;
    this.engineOsc2.detune.value = -3;

    this.engineGain.gain.value = idleGain;

    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 800;
    this.engineFilter.Q.value = 1;

    // connect: oscs -> gain -> filter -> masterGain -> destination
    this.engineOsc1.connect(this.engineGain);
    this.engineOsc2.connect(this.engineGain);
    this.engineGain.connect(this.engineFilter);
    this.engineFilter.connect(this.masterGain);

    this.engineOsc1.start();
    this.engineOsc2.start();

    // --- Wind noise ---
    this.windBuffer = createWhiteNoiseBuffer(ctx, 2);
    this.windSource = ctx.createBufferSource();
    this.windSource.buffer = this.windBuffer;
    this.windSource.loop = true;

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 200;
    this.windFilter.Q.value = 1;

    this.windSource.connect(this.windGain);
    this.windGain.connect(this.windFilter);
    this.windFilter.connect(this.masterGain);

    this.windSource.start();

    this.masterGain.gain.value = 0;
    // fade in
    this.masterGain.gain.setTargetAtTime(1, ctx.currentTime, 0.01);

    this.isRunning = true;
  }

  update(throttle01: number, airspeedMs: number): void {
    if (!this.isRunning) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    // engine
    const freq = 80 + throttle01 * (220 - 80);
    const gainVal = 0.12 + throttle01 * (0.4 - 0.12);
    if (this.engineOsc1) {
      this.engineOsc1.frequency.setTargetAtTime(freq, now, 0.05);
      this.engineOsc1.detune.setTargetAtTime(3, now, 0.05);
    }
    if (this.engineOsc2) {
      this.engineOsc2.frequency.setTargetAtTime(freq, now, 0.05);
      this.engineOsc2.detune.setTargetAtTime(-3, now, 0.05);
    }
    if (this.engineGain) {
      this.engineGain.gain.setTargetAtTime(gainVal, now, 0.05);
    }

    // wind
    const speedFactor = Math.min(1, airspeedMs / 35);
    const windGain = speedFactor * 0.5;
    const cutoff = 200 + speedFactor * (2000 - 200);
    if (this.windGain) {
      this.windGain.gain.setTargetAtTime(windGain, now, 0.05);
    }
    if (this.windFilter) {
      this.windFilter.frequency.setTargetAtTime(cutoff, now, 0.05);
    }
  }

  stop(): void {
    if (!this.isRunning) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    // ramp down
    this.masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    // schedule cleanup after ramp
    setTimeout(() => {
      this.cleanup();
    }, 250);
  }

  setVolume(v: number): void {
    this.masterGain.gain.value = Math.max(0, Math.min(1, v));
  }

  get running(): boolean {
    return this.isRunning;
  }

  private cleanup(): void {
    if (!this.isRunning) return;

    try {
      this.engineOsc1?.stop();
      this.engineOsc2?.stop();
      this.windSource?.stop();
    } catch { /* may already be stopped */ }

    this.engineOsc1?.disconnect();
    this.engineOsc2?.disconnect();
    this.engineGain?.disconnect();
    this.engineFilter?.disconnect();
    this.windSource?.disconnect();
    this.windGain?.disconnect();
    this.windFilter?.disconnect();

    this.engineOsc1 = undefined;
    this.engineOsc2 = undefined;
    this.engineGain = undefined;
    this.engineFilter = undefined;
    this.windSource = undefined;
    this.windGain = undefined;
    this.windFilter = undefined;

    this.isRunning = false;
  }
}

function createWhiteNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * durationSec;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}
