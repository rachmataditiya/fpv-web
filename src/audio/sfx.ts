// sfx.ts — Procedural WebAudio sound effects for the drone sim.
// Requirements:
//  • One shared AudioContext + master GainNode, created on first use in a try/catch.
//  • Noise buffer (0.5 s white noise) generated lazily once.
//  • Every play uses fresh source nodes; envelopes use setValueAtTime/
//    exponentialRampToValueAtTime (target = 0.001, never 0).
//  • Sources are scheduled with stop() and cleaned up after onended.
//  • Rate‑limited to 8 concurrent one‑shots; extras are silently dropped.
//  • setVolume(0…1) controls the master GainNode (default 0.5).

export class Sfx {
  private static ctx: AudioContext | null = null;
  private static masterGain: GainNode | null = null;
  private static noiseBuffer: AudioBuffer | null = null;
  private static disabled = false;          // set if AudioContext construction fails
  private static activeCount = 0;
  private static readonly MAX_ACTIVE = 8;

  /**
   * Play a punchy blaster: 60 ms noise burst + a sine sweep 400→120 Hz.
   */
  shoot(): void {
    this.ensureContext();
    if (Sfx.disabled || !Sfx.ctx || !Sfx.masterGain) return;

    const now = Sfx.ctx.currentTime;
    if (Sfx.activeCount >= Sfx.MAX_ACTIVE) return;  // drop excess

    Sfx.activeCount++;
    let remainingSources = 3;   // crack + body + thump

    const onEnded = () => {
      if (--remainingSources === 0) Sfx.activeCount--;
    };

    // Rifle-style layered report (CS-like):
    // (1) CRACK — high-passed noise transient, very short. The "snap".
    const crack = Sfx.ctx.createBufferSource();
    crack.buffer = this.getNoiseBuffer();
    const crackHp = Sfx.ctx.createBiquadFilter();
    crackHp.type = 'highpass';
    crackHp.frequency.value = 2200;
    const crackGain = Sfx.ctx.createGain();
    crackGain.gain.setValueAtTime(1.0, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    crack.connect(crackHp).connect(crackGain).connect(Sfx.masterGain);
    crack.start(now);
    crack.stop(now + 0.04);
    crack.onended = () => {
      crack.disconnect();
      crackHp.disconnect();
      crackGain.disconnect();
      onEnded();
    };

    // (2) BODY — band-passed noise, the mid "bark" with a short tail.
    const body = Sfx.ctx.createBufferSource();
    body.buffer = this.getNoiseBuffer();
    const bodyBp = Sfx.ctx.createBiquadFilter();
    bodyBp.type = 'bandpass';
    bodyBp.frequency.setValueAtTime(700, now);
    bodyBp.frequency.exponentialRampToValueAtTime(250, now + 0.12);
    bodyBp.Q.value = 0.9;
    const bodyGain = Sfx.ctx.createGain();
    bodyGain.gain.setValueAtTime(0.55, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    body.connect(bodyBp).connect(bodyGain).connect(Sfx.masterGain);
    body.start(now);
    body.stop(now + 0.15);
    body.onended = () => {
      body.disconnect();
      bodyBp.disconnect();
      bodyGain.disconnect();
      onEnded();
    };

    // (3) THUMP — low sine punch for chest feel.
    const thump = Sfx.ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(140, now);
    thump.frequency.exponentialRampToValueAtTime(55, now + 0.08);
    const thumpGain = Sfx.ctx.createGain();
    thumpGain.gain.setValueAtTime(0.5, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    thump.connect(thumpGain).connect(Sfx.masterGain);
    thump.start(now);
    thump.stop(now + 0.09);
    thump.onended = () => {
      thump.disconnect();
      thumpGain.disconnect();
      onEnded();
    };
  }

  /**
   * Boom: low‑pass filtered noise 0.5 s, filter sweep 800→80 Hz,
   * with gain decay.
   */
  explode(): void {
    this.ensureContext();
    if (Sfx.disabled || !Sfx.ctx || !Sfx.masterGain) return;

    const now = Sfx.ctx.currentTime;
    if (Sfx.activeCount >= Sfx.MAX_ACTIVE) return;
    Sfx.activeCount++;

    // --- low‑pass filter ---
    const filter = Sfx.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(80, now + 0.5);

    // --- noise source ---
    const noiseSrc = Sfx.ctx.createBufferSource();
    noiseSrc.buffer = this.getNoiseBuffer();
    const noiseGain = Sfx.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    noiseSrc.connect(filter).connect(noiseGain).connect(Sfx.masterGain);
    noiseSrc.start(now);
    noiseSrc.stop(now + 0.5);

    noiseSrc.onended = () => {
      noiseSrc.disconnect();
      filter.disconnect();
      noiseGain.disconnect();
      Sfx.activeCount--;
    };
  }

  /**
   * 60 ms beep, 880 Hz triangle wave.
   */
  gate(): void {
    this.ensureContext();
    if (Sfx.disabled || !Sfx.ctx || !Sfx.masterGain) return;

    const now = Sfx.ctx.currentTime;
    if (Sfx.activeCount >= Sfx.MAX_ACTIVE) return;
    Sfx.activeCount++;

    const osc = Sfx.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, now);
    const gainNode = Sfx.ctx.createGain();
    gainNode.gain.setValueAtTime(0.3, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gainNode).connect(Sfx.masterGain);
    osc.start(now);
    osc.stop(now + 0.06);
    osc.onended = () => {
      osc.disconnect();
      gainNode.disconnect();
      Sfx.activeCount--;
    };
  }

  /**
   * Two‑tone lap indicator: 660 Hz then 990 Hz, 90 ms each.
   */
  lap(): void {
    this.ensureContext();
    if (Sfx.disabled || !Sfx.ctx || !Sfx.masterGain) return;

    const now = Sfx.ctx.currentTime;
    if (Sfx.activeCount >= Sfx.MAX_ACTIVE) return;
    Sfx.activeCount++;

    // We need two oscillators, one for each tone.
    let remainingSources = 2;

    const onEnded = () => {
      if (--remainingSources === 0) Sfx.activeCount--;
    };

    // --- first tone: 660 Hz, 90 ms ---
    const osc1 = Sfx.ctx.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(660, now);
    const gain1 = Sfx.ctx.createGain();
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc1.connect(gain1).connect(Sfx.masterGain);
    osc1.start(now);
    osc1.stop(now + 0.09);
    osc1.onended = () => {
      osc1.disconnect();
      gain1.disconnect();
      onEnded();
    };

    // --- second tone: 990 Hz, starts at 0.09 s ---
    const start2 = now + 0.09;
    const osc2 = Sfx.ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(990, start2);
    const gain2 = Sfx.ctx.createGain();
    gain2.gain.setValueAtTime(0.3, start2);
    gain2.gain.exponentialRampToValueAtTime(0.001, start2 + 0.09);
    osc2.connect(gain2).connect(Sfx.masterGain);
    osc2.start(start2);
    osc2.stop(start2 + 0.09);
    osc2.onended = () => {
      osc2.disconnect();
      gain2.disconnect();
      onEnded();
    };
  }

  /**
   * Set master volume. Clamped to [0, 1]. Default is 0.5.
   */
  setVolume(v: number): void {
    const clamped = Math.min(1, Math.max(0, v));
    if (Sfx.masterGain) {
      Sfx.masterGain.gain.value = clamped;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Lazy‑initialise the AudioContext and master GainNode.
   * If the constructor throws we flag everything disabled.
   */
  private ensureContext(): void {
    if (Sfx.disabled) return;
    if (Sfx.ctx) return;

    try {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.5;          // default volume
      master.connect(ctx.destination);
      Sfx.ctx = ctx;
      Sfx.masterGain = master;
    } catch (_) {
      Sfx.disabled = true;              // e.g. headless environment
    }
  }

  /**
   * The pre‑rendered white‑noise buffer (0.5 s, one channel).
   * Created lazily and reused forever.
   */
  private getNoiseBuffer(): AudioBuffer {
    if (!Sfx.noiseBuffer && Sfx.ctx) {
      const sampleRate = Sfx.ctx.sampleRate;
      const length = sampleRate * 0.5;   // 0.5 s
      const buffer = Sfx.ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      Sfx.noiseBuffer = buffer;
    }
    return Sfx.noiseBuffer!;
  }
}
