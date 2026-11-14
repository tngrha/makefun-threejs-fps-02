// Synthesized sound, no audio files: every effect is a short WebAudio patch,
// so the game ships with nothing but code. The context starts on the first
// user gesture; shot captures run silent.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
    return ctx;
  }

  function unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume();
  }

  function burst(duration, filterFreq, gainValue, type = 'lowpass') {
    const c = ensure();
    if (!c) return;
    const length = Math.max(1, Math.floor(c.sampleRate * duration));
    const buffer = c.createBuffer(1, length, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = c.createBufferSource();
    source.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = c.createGain();
    gain.gain.setValueAtTime(gainValue, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start();
  }

  function tone(freq, duration, gainValue, type = 'sine', slideTo = 0) {
    const c = ensure();
    if (!c) return;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + duration);
    const gain = c.createGain();
    gain.gain.setValueAtTime(gainValue, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    osc.connect(gain).connect(master);
    osc.start();
    osc.stop(c.currentTime + duration);
  }

  return {
    unlock,
    play(name) {
      switch (name) {
        case 'pistol': burst(0.09, 2400, 0.5); tone(190, 0.07, 0.25, 'square', 90); break;
        case 'smg': burst(0.07, 3000, 0.4); tone(240, 0.05, 0.2, 'square', 120); break;
        case 'rifle': burst(0.12, 1800, 0.6); tone(150, 0.09, 0.3, 'square', 70); break;
        case 'reload': tone(520, 0.06, 0.15, 'sine'); setTimeout(() => tone(760, 0.06, 0.15, 'sine'), 120); break;
        case 'hit': tone(980, 0.06, 0.2, 'sine'); break;
        case 'kill': tone(660, 0.09, 0.25, 'sine'); setTimeout(() => tone(990, 0.12, 0.25, 'sine'), 90); break;
        case 'hurt': tone(140, 0.15, 0.35, 'sawtooth', 80); break;
        case 'plant': tone(880, 0.1, 0.2, 'sine'); break;
        case 'beep': tone(1180, 0.07, 0.18, 'sine'); break;
        case 'explosion': burst(0.7, 500, 0.9); tone(60, 0.6, 0.5, 'sine', 30); break;
        case 'win': [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.18, 0.22, 'sine'), i * 130)); break;
        case 'lose': [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.2, 0.22, 'sine'), i * 140)); break;
        case 'buy': tone(700, 0.05, 0.18, 'sine'); break;
        case 'click': tone(600, 0.04, 0.12, 'sine'); break;
        default: break;
      }
    },
  };
}
