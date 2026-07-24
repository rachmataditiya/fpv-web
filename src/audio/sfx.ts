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
    this.rifle(1, 1);
  }

  /**
   * Enemy rifle — the player blaster pitched down and slightly quieter, so
   * incoming fire is audibly distinct from your own.
   */
  botShoot(): void {
    this.rifle(0.55, 0.85);
  }

  /** Burst-fire round — the player blaster pitched up a touch, one call per
   *  round of the 3-round burst. */
  burst(): void {
    this.rifle(1.2, 0.9);
  }

  /**
   * Railgun discharge — heavy layered one-shot: a low 50 Hz boom, a bright
   * band-passed noise zap sweeping down fast, and a ~0.4 s tail. Louder than
   * the blaster.
   */
  railgun(): void {
    this.ensureContext();
    if (Sfx.disabled || !Sfx.ctx || !Sfx.masterGain) return;

    const now = Sfx.ctx.currentTime;
    if (Sfx.activeCount >= Sfx.MAX_ACTIVE) return;
    Sfx.activeCount++;

    let remainingSources = 3; // boom + zap + tail
    const onEnded = () => {
      if (--remainingSources === 0) Sfx.activeCount--;
    };

    // (1) BOOM — low sine thud, the chest hit.
    const boom = Sfx.ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(50, now);
    boom.frequency.exponentialRampToValueAtTime(32, now + 0.4);
    const boomGain = Sfx.ctx.createGain();
    boomGain.gain.setValueAtTime(0.95, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    boom.connect(boomGain).connect(Sfx.masterGain);
    boom.start(now);
    boom.stop(now + 0.42);
    boom.onended = () => {
      boom.disconnect();
      boomGain.disconnect();
      onEnded();
    };

    // (2) ZAP — bright band-passed noise with a fast downward sweep.
    const zap = Sfx.ctx.createBufferSource();
    zap.buffer = this.getNoiseBuffer();
    const zapBp = Sfx.ctx.createBiquadFilter();
    zapBp.type = 'bandpass';
    zapBp.frequency.setValueAtTime(3800, now);
    zapBp.frequency.exponentialRampToValueAtTime(500, now + 0.14);
    zapBp.Q.value = 1.4;
    const zapGain = Sfx.ctx.createGain();
    zapGain.gain.setValueAtTime(0.8, now);
    zapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    zap.connect(zapBp).connect(zapGain).connect(Sfx.masterGain);
    zap.start(now);
    zap.stop(now + 0.17);
    zap.onended = () => {
      zap.disconnect();
      zapBp.disconnect();
      zapGain.disconnect();
      onEnded();
    };

    // (3) TAIL — low-passed noise wash decaying over ~0.4 s.
    const tail = Sfx.ctx.createBufferSource();
    tail.buffer = this.getNoiseBuffer();
    const tailLp = Sfx.ctx.createBiquadFilter();
    tailLp.type = 'lowpass';
    tailLp.frequency.setValueAtTime(1400, now);
    tailLp.frequency.exponentialRampToValueAtTime(120, now + 0.4);
    const tailGain = Sfx.ctx.createGain();
    tailGain.gain.setValueAtTime(0.45, now);
    tailGain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    tail.connect(tailLp).connect(tailGain).connect(Sfx.masterGain);
    tail.start(now);
    tail.stop(now + 0.44);
    tail.onended = () => {
      tail.disconnect();
      tailLp.disconnect();
      tailGain.disconnect();
      onEnded();
    };
  }

  /** Railgun charge-up — quiet rising sine 300→900 Hz over ~0.8 s, fired when
   *  a charge STARTS (the release gets railgun()). */
  chargeUp(): void {
    this.ensureContext();
    if (Sfx.disabled || !Sfx.ctx || !Sfx.masterGain) return;

    const now = Sfx.ctx.currentTime;
    if (Sfx.activeCount >= Sfx.MAX_ACTIVE) return;
    Sfx.activeCount++;

    const dur = 0.8;
    const osc = Sfx.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.linearRampToValueAtTime(900, now + dur);
    const gainNode = Sfx.ctx.createGain();
    gainNode.gain.setValueAtTime(0.001, now);
    gainNode.gain.exponentialRampToValueAtTime(0.12, now + 0.08);
    gainNode.gain.setValueAtTime(0.12, now + dur - 0.1);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gainNode).connect(Sfx.masterGain);
    osc.start(now);
    osc.stop(now + dur);
    osc.onended = () => {
      osc.disconnect();
      gainNode.disconnect();
      Sfx.activeCount--;
    };
  }

  /** Pickup acquired — pleasant two-tone blip (660→990 triangle, like lap()
   *  but shorter). */
  pickup(): void {
    this.ensureContext();
    if (Sfx.disabled || !Sfx.ctx || !Sfx.masterGain) return;

    const now = Sfx.ctx.currentTime;
    if (Sfx.activeCount >= Sfx.MAX_ACTIVE) return;
    Sfx.activeCount++;

    let remainingSources = 2;
    const onEnded = () => {
      if (--remainingSources === 0) Sfx.activeCount--;
    };

    // --- first tone: 660 Hz, 60 ms ---
    const osc1 = Sfx.ctx.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(660, now);
    const gain1 = Sfx.ctx.createGain();
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc1.connect(gain1).connect(Sfx.masterGain);
    osc1.start(now);
    osc1.stop(now + 0.06);
    osc1.onended = () => {
      osc1.disconnect();
      gain1.disconnect();
      onEnded();
    };

    // --- second tone: 990 Hz, starts at 0.06 s ---
    const start2 = now + 0.06;
    const osc2 = Sfx.ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(990, start2);
    const gain2 = Sfx.ctx.createGain();
    gain2.gain.setValueAtTime(0.3, start2);
    gain2.gain.exponentialRampToValueAtTime(0.001, start2 + 0.06);
    osc2.connect(gain2).connect(Sfx.masterGain);
    osc2.start(start2);
    osc2.stop(start2 + 0.06);
    osc2.onended = () => {
      osc2.disconnect();
      gain2.disconnect();
      onEnded();
    };
  }

  /**
   * Enemy drone rotor whirr, pinged periodically while one is nearby.
   * distance01: 0 = on top of you, 1 = at the edge of earshot.
   */
  droneWhirr(distance01: number): void {
    this.ensureContext();
    if (Sfx.disabled || !Sfx.ctx || !Sfx.masterGain) return;

    const now = Sfx.ctx.currentTime;
    if (Sfx.activeCount >= Sfx.MAX_ACTIVE) return;
    Sfx.activeCount++;

    const d = Math.min(1, Math.max(0, distance01));
    const dur = 0.32;
    let remainingSources = 2;
    const onEnded = () => {
      if (--remainingSources === 0) Sfx.activeCount--;
    };

    // prop chop: saw with a fast tremolo, closer = higher + louder
    const osc = Sfx.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150 + 90 * (1 - d), now);
    osc.frequency.linearRampToValueAtTime(170 + 90 * (1 - d), now + dur);
    const bp = Sfx.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 480;
    bp.Q.value = 1.2;
    const trem = Sfx.ctx.createGain();
    trem.gain.value = 0.55;
    const lfo = Sfx.ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 27; // blade-pass wobble
    const lfoDepth = Sfx.ctx.createGain();
    lfoDepth.gain.value = 0.45;
    lfo.connect(lfoDepth).connect(trem.gain);
    const env = Sfx.ctx.createGain();
    const peak = 0.2 * (1 - d * 0.8);
    env.gain.setValueAtTime(0.001, now);
    env.gain.exponentialRampToValueAtTime(Math.max(0.01, peak), now + 0.05);
    env.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(bp).connect(trem).connect(env).connect(Sfx.masterGain);
    osc.start(now);
    lfo.start(now);
    osc.stop(now + dur);
    lfo.stop(now + dur);
    osc.onended = () => {
      osc.disconnect();
      lfo.disconnect();
      lfoDepth.disconnect();
      bp.disconnect();
      trem.disconnect();
      env.disconnect();
      onEnded();
    };

    // motor whine on top
    const whine = Sfx.ctx.createOscillator();
    whine.type = 'triangle';
    whine.frequency.setValueAtTime(880 + 320 * (1 - d), now);
    const whineGain = Sfx.ctx.createGain();
    whineGain.gain.setValueAtTime(0.05 * (1 - d * 0.8), now);
    whineGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    whine.connect(whineGain).connect(Sfx.masterGain);
    whine.start(now);
    whine.stop(now + dur);
    whine.onended = () => {
      whine.disconnect();
      whineGain.disconnect();
      onEnded();
    };
  }

  /** Layered rifle report (CS-like): high-passed crack + band-passed body +
   *  low sine thump. pitch scales all frequencies, gain the overall level. */
  private rifle(pitch: number, gain: number): void {
    this.ensureContext();
    if (Sfx.disabled || !Sfx.ctx || !Sfx.masterGain) return;

    const now = Sfx.ctx.currentTime;
    if (Sfx.activeCount >= Sfx.MAX_ACTIVE) return;  // drop excess

    Sfx.activeCount++;
    let remainingSources = 3;   // crack + body + thump

    const onEnded = () => {
      if (--remainingSources === 0) Sfx.activeCount--;
    };

    // (1) CRACK — high-passed noise transient, very short. The "snap".
    const crack = Sfx.ctx.createBufferSource();
    crack.buffer = this.getNoiseBuffer();
    const crackHp = Sfx.ctx.createBiquadFilter();
    crackHp.type = 'highpass';
    crackHp.frequency.value = 2200 * pitch;
    const crackGain = Sfx.ctx.createGain();
    crackGain.gain.setValueAtTime(1.0 * gain, now);
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
    bodyBp.frequency.setValueAtTime(700 * pitch, now);
    bodyBp.frequency.exponentialRampToValueAtTime(250 * pitch, now + 0.12);
    bodyBp.Q.value = 0.9;
    const bodyGain = Sfx.ctx.createGain();
    bodyGain.gain.setValueAtTime(0.55 * gain, now);
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
    thump.frequency.setValueAtTime(140 * pitch, now);
    thump.frequency.exponentialRampToValueAtTime(55 * pitch, now + 0.08);
    const thumpGain = Sfx.ctx.createGain();
    thumpGain.gain.setValueAtTime(0.5 * gain, now);
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

  private static perBusGain: { engine: number; combat: number; ambience: number } = {
    engine: 1,
    combat: 1,
    ambience: 1,
  };

  private ambienceSource?: AudioBufferSourceNode;
  private ambienceGain?: GainNode;
  private ambienceFilter?: BiquadFilterNode;
  private ambienceLFO?: OscillatorNode;
  private ambienceLFOGain?: GainNode;

  /**
   * Gunshot variant with lowpass filter to simulate occlusion.
   */
  shootOccluded(): void {
    this.playOccludedShot(1);
  }

  /**
   * Bot gunshot: occluded + pitched down (0.55 rate).
   */
  botShootOccluded(): void {
    this.playOccludedShot(0.55);
  }

  private playOccludedShot(rate: number): void {
    this.ensureContext();
    if (Sfx.disabled || !Sfx.ctx || !Sfx.masterGain) return;

    const now = Sfx.ctx.currentTime;
    if (Sfx.activeCount >= Sfx.MAX_ACTIVE) return;
    Sfx.activeCount++;

    const busGain = Sfx.perBusGain.combat;

    const source = Sfx.ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer();
    source.playbackRate.value = rate;

    const filter = Sfx.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 1;

    const gainNode = Sfx.ctx.createGain();
    gainNode.gain.setValueAtTime(0.001, now);
    gainNode.gain.exponentialRampToValueAtTime(0.4 * busGain, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    source.connect(filter).connect(gainNode).connect(Sfx.masterGain);
    source.start(now);
    source.stop(now + 0.2);

    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gainNode.disconnect();
      Sfx.activeCount--;
    };
  }

  /**
   * Explosion from distance: lowpass cutoff decreases, gain fades with distance.
   * distance01: 0 = close/full, 1 = far (100m).
   */
  explodeFar(distance01: number): void {
    this.ensureContext();
    if (Sfx.disabled || !Sfx.ctx || !Sfx.masterGain) return;

    const d = Math.min(1, Math.max(0, distance01));
    const now = Sfx.ctx.currentTime;
    if (Sfx.activeCount >= Sfx.MAX_ACTIVE) return;
    Sfx.activeCount++;

    const busGain = Sfx.perBusGain.combat;
    const volume = 1 - d;

    const source = Sfx.ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer();
    source.playbackRate.value = 0.8;

    const filter = Sfx.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400 + (1 - d) * 1600;
    filter.Q.value = 0.8;

    const gainNode = Sfx.ctx.createGain();
    gainNode.gain.setValueAtTime(0.001, now);
    gainNode.gain.exponentialRampToValueAtTime(0.8 * volume * busGain, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    source.connect(filter).connect(gainNode).connect(Sfx.masterGain);
    source.start(now);
    source.stop(now + 0.8);

    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gainNode.disconnect();
      Sfx.activeCount--;
    };
  }

  /**
   * Set per-bus gain multiplier (applied to one-shots and ambience).
   * bus: 'engine' | 'combat' | 'ambience'
   * gain01: 0..1
   */
  setBus(bus: 'engine' | 'combat' | 'ambience', gain01: number): void {
    Sfx.perBusGain[bus] = Math.max(0, Math.min(1, gain01));
  }

  /**
   * Start ambient bed (looping, very quiet ≤ 0.06).
   * kind: 'desert' (brown noise lowpass 300Hz) | 'nature' (wind-like bandpass).
   */
  startAmbience(kind: 'desert' | 'nature'): void {
    if (this.ambienceSource) return;

    this.ensureContext();
    if (Sfx.disabled || !Sfx.ctx || !Sfx.masterGain) return;

    const now = Sfx.ctx.currentTime;
    const busGain = Sfx.perBusGain.ambience;

    const buffer = kind === 'desert'
      ? this.createBrownNoiseBuffer(3)
      : this.getNoiseBuffer();

    this.ambienceSource = Sfx.ctx.createBufferSource();
    this.ambienceSource.buffer = buffer;
    this.ambienceSource.loop = true;

    this.ambienceFilter = Sfx.ctx.createBiquadFilter();
    this.ambienceFilter.type = kind === 'desert' ? 'lowpass' : 'bandpass';
    this.ambienceFilter.frequency.value = kind === 'desert' ? 300 : 600;
    this.ambienceFilter.Q.value = 1;

    this.ambienceGain = Sfx.ctx.createGain();
    this.ambienceGain.gain.setValueAtTime(0, now);
    this.ambienceGain.gain.setTargetAtTime(0.06 * busGain, now, 0.1);

    this.ambienceLFO = Sfx.ctx.createOscillator();
    this.ambienceLFO.frequency.value = 0.15;
    this.ambienceLFO.type = 'sine';

    this.ambienceLFOGain = Sfx.ctx.createGain();
    this.ambienceLFOGain.gain.value = 0.02;

    this.ambienceLFO.connect(this.ambienceLFOGain);
    if (kind === 'desert') {
      this.ambienceLFOGain.connect(this.ambienceGain.gain);
    } else {
      this.ambienceLFOGain.connect(this.ambienceFilter.frequency);
    }

    this.ambienceSource.connect(this.ambienceFilter);
    this.ambienceFilter.connect(this.ambienceGain);
    this.ambienceGain.connect(Sfx.masterGain);

    this.ambienceSource.start(now);
    this.ambienceLFO.start(now);
  }

  /**
   * Stop ambient bed (fade out ~0.05s).
   */
  stopAmbience(): void {
    if (!this.ambienceSource) return;

    const now = Sfx.ctx?.currentTime ?? 0;
    if (this.ambienceGain) {
      this.ambienceGain.gain.setTargetAtTime(0.001, now, 0.05);
    }

    setTimeout(() => {
      try {
        this.ambienceSource?.stop();
        this.ambienceLFO?.stop();
      } catch { /* already stopped */ }

      this.ambienceSource?.disconnect();
      this.ambienceGain?.disconnect();
      this.ambienceFilter?.disconnect();
      this.ambienceLFO?.disconnect();
      this.ambienceLFOGain?.disconnect();

      this.ambienceSource = undefined;
      this.ambienceGain = undefined;
      this.ambienceFilter = undefined;
      this.ambienceLFO = undefined;
      this.ambienceLFOGain = undefined;
    }, 100);
  }

  private createBrownNoiseBuffer(durationSec: number): AudioBuffer {
    if (!Sfx.ctx) throw new Error('AudioContext not initialized');

    const sampleRate = Sfx.ctx.sampleRate;
    const length = sampleRate * durationSec;
    const buffer = Sfx.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    let lastOut = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.5;
    }

    return buffer;
  }

}
