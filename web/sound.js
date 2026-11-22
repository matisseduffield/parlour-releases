// The TV's music and sound effects. All of it is made here as it plays, with Web Audio:
// there are no sound files. Phones stay silent. Nothing in here may stop the game: with
// no AudioContext, or one the browser won't start, every call does nothing.
//
// Two halves: `rig` is the band (instruments, tunes, effects) on any audio context, a
// real one or an offline one for checking; below it, the part that listens to the game.
(function (root) {
  const AC = root.AudioContext || root.webkitAudioContext;

  // ---------- notes ----------
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = s => { const k = /^([A-G])([#b]?)(\d)$/.exec(s); return 12 * (+k[3] + 1) + SEMI[k[1]] + (k[2] === '#' ? 1 : k[2] === 'b' ? -1 : 0); };
  const notes = s => s.split(' ').map(midi);
  const hz = n => 440 * 2 ** ((n - 69) / 12);
  // A line of tune: "step:note:steps", sixteen steps to the bar.
  const line = s => s ? s.split(' ').map(x => { const [at, n, len] = x.split(':'); return [+at, midi(n), +len]; }) : [];

  // Every chord the music uses: its bass note, and how the electric piano voices it.
  const CHORDS = {};
  for (const [name, bass, voicing] of [
    ['Dm9', 'D2', 'F3 A3 C4 E4'], ['G13', 'G2', 'F3 A3 B3 E4'], ['Cmaj9', 'C3', 'E3 G3 B3 D4'],
    ['Am7', 'A2', 'G3 A3 C4 E4'], ['A7', 'A2', 'G3 A3 C#4 E4'], ['C9', 'C3', 'E3 G3 Bb3 D4'],
    ['Fmaj9', 'F2', 'A3 C4 E4 G4'], ['Em7', 'E2', 'G3 B3 D4 E4'], ['G9sus', 'G2', 'F3 A3 C4 D4'],
    ['G7', 'G2', 'F3 B3 D4'], ['Am9', 'A2', 'G3 B3 C4 E4'], ['E7sus', 'E2', 'A3 B3 D4 E4'],
    ['E7', 'E2', 'G#3 B3 D4 E4'],
  ]) CHORDS[name] = { root: midi(bass), ep: notes(voicing) };

  // The lobby: C major, 32 bars. A, A again turning to the bridge, the bridge, and A.
  const A = 'Dm9 G13 Cmaj9 Am7 Dm9 G13 Cmaj9 ';
  const LOBBY = (A + 'A7 ' + A + 'C9 Fmaj9 Em7 Dm9 G13 Fmaj9 Em7 Dm9 G9sus|G7 ' + A + 'A7').split(' ');
  // Its tunes, by bar of the eight: the main one, a sparser one, and the bridge's.
  const TUNES = {
    main: ['0:A4:2 3:C5:2 6:E5:4 12:D5:2 14:C5:2', '0:B4:6 8:A4:2 10:G4:2 12:E4:4', '2:E4:2 4:G4:2 6:B4:2 8:D5:6', '0:C5:4 6:A4:2 8:G4:2 10:E4:4',
      '0:F5:3 3:E5:3 6:D5:2 8:A4:6', '0:B4:2 2:D5:2 4:F5:4 10:E5:2 12:D5:4', '0:E5:8 10:G4:2 12:C5:4', ''],
    spare: ['8:D5:2 10:E5:2 12:F5:4', '0:E5:4 6:D5:2 8:B4:6', '4:E5:2 6:D5:2 8:G4:8', '4:A4:2 6:C5:2 8:E5:6',
      '8:D5:2 10:E5:2 12:F5:4', '0:E5:4 6:D5:2 8:B4:6', '4:E5:2 6:G5:2 8:E5:8', ''],
    bridge: ['0:A4:4 4:C5:4 8:E5:6 14:D5:2', '0:D5:4 4:B4:4 8:G4:8', '0:F4:4 4:A4:4 8:C5:6 14:D5:2', '0:B4:8 10:A4:2 12:G4:4',
      '0:A4:4 4:C5:4 8:E5:6 14:G5:2', '0:G5:4 4:E5:4 8:D5:8', '0:F5:4 4:E5:4 8:D5:6 14:C5:2', '0:C5:8 8:B4:8'],
    // Over the standings: C major, four bars.
    scores: ['0:E5:2 2:G5:2 4:E5:2 6:D5:4 12:C5:4', '0:A4:2 2:C5:2 4:E5:4 8:D5:2 10:C5:4', '0:E5:2 2:G5:2 4:B5:4 8:G5:6', '0:F5:2 2:E5:2 4:D5:4 8:B4:2 10:D5:2 12:G5:4'],
  };
  for (const k of Object.keys(TUNES)) TUNES[k] = TUNES[k].map(line);
  const REST = ['Cmaj9', 'Fmaj9', 'Cmaj9', 'Dm9|G13'];      // between questions and under the standings
  const THINK = ['Am9', 'Am9', 'Fmaj9', 'E7sus'];           // while a question is open: A minor
  // How the bass walks a bar: [step, root / fifth / octave, steps long, how hard]. (Under a
  // high root the fifth is the one below and the octave is the root again: it stays a bass.)
  const WALKS = [
    [[0, 'r', 3, 1], [6, 'o', 1, .6], [8, 'r', 2, .85], [11, 'f', 1, .6], [14, 'f', 2, .8]],
    [[0, 'r', 4, 1], [7, 'r', 1, .6], [10, 'o', 2, .8], [14, 'f', 2, .75]],
    [[0, 'r', 2, 1], [3, 'r', 1, .5], [6, 'f', 2, .8], [8, 'r', 3, .85], [12, 'o', 1, .7], [14, 'r', 1, .6]],
  ];
  // How the piano plays a bar's chord: [step, steps long, how hard].
  const COMPS = [[[0, 5, .9], [6, 6, .65]], [[0, 3, .9], [3, 2, .5], [10, 5, .7]], [[2, 4, .8], [7, 2, .55], [10, 5, .75]]];
  const PENT = notes('C5 D5 E5 G5 A5 C6 D6 E6');            // each new player a step up it
  const APENT = notes('A5 C6 D6 E6 G6');                    // answers landing, over the A minor
  const CMAJ = notes('C6 D6 E6 F6 G6 A6 B6 C7');
  const FANFARE = 4.5;       // seconds, the winner's
  const MUSIC = 0.15, EFFECTS = 1, MASTER = 0.9;

  // ---------- the band ----------
  function rig(ctx, opt = {}) {
    const rnd = opt.rand || Math.random;
    const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const filter = (type, freq, q = 0.7) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; };
    const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };

    // Music and effects each at their own level; the music dips under an effect (`duck`)
    // and while there is something to read (`read`). Then one gentle compressor and a
    // soft ceiling, so nothing can clip or leap out of the TV.
    const music = gain(MUSIC), read = gain(1), duck = gain(1), fx = gain(EFFECTS), mix = gain(1), out = gain(MASTER);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    const ceiling = ctx.createWaveShaper();
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) { const x = i / 1024 - 1, a = Math.abs(x); curve[i] = Math.sign(x) * (a < 0.5 ? a : 0.5 + 0.35 * Math.tanh((a - 0.5) / 0.35)); }
    ceiling.curve = curve;
    music.connect(read).connect(duck).connect(mix);
    fx.connect(mix);
    mix.connect(comp).connect(ceiling).connect(out).connect(opt.dest || ctx.destination);

    const noise = ctx.createBuffer(1, Math.round(ctx.sampleRate), ctx.sampleRate);
    { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }

    // Every sound that is started is counted, and forgotten once it has ended.
    let made = 0;
    const ends = [];
    function run(src, t, end, tail, offset) {
      if (offset == null) src.start(t); else src.start(t, offset);
      src.stop(end);
      made++;
      ends.push(end);
      if (tail) src.onended = () => { try { tail.disconnect(); } catch {} };
    }

    // The two shapes of loudness. Both start from nothing and end at nothing.
    // Struck: up in `a`, dying away over `d`.
    function struck(p, t, peak, a, d) {
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(peak, t + a);
      p.exponentialRampToValueAtTime(peak * 0.001, t + a + d);
      p.linearRampToValueAtTime(0, t + a + d + 0.008);
      return t + a + d + 0.01;
    }
    // Held: up in `a`, easing to `sus` of that, let go after `len` and gone in `r`.
    function held(p, t, peak, a, len, r, sus = 1, dec = 0.1) {
      const off = Math.max(t + a + 0.005, t + len);
      let v = peak;
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(peak, t + a);
      if (sus < 1 && off > t + a + dec) { v = peak * sus; p.exponentialRampToValueAtTime(v, t + a + dec); }
      p.setValueAtTime(v, off);
      p.linearRampToValueAtTime(0, off + r);
      return off + r + 0.005;
    }

    // ---------- instruments ----------
    // Electric piano: one sine bending another, hard at the strike and mellowing.
    function piano(to, t, n, len, vel) {
      const f = hz(n), car = osc('sine', f), mod = osc('sine', f), bend = gain(0), amp = gain(0);
      const depth = f * (0.5 + 1.5 * vel) * Math.min(1, 330 / f);
      bend.gain.setValueAtTime(depth, t);
      bend.gain.exponentialRampToValueAtTime(depth * 0.4, t + 0.5);
      mod.connect(bend).connect(car.frequency);
      car.connect(amp).connect(to);
      const end = held(amp.gain, t, 0.13 * vel, 0.005, len, 0.18, 0.45, 0.5) + 0.01;
      run(mod, t, end);
      run(car, t, end, amp);
    }
    function chord(to, t, list, len, vel) { list.forEach((n, k) => piano(to, t + k * 0.007, n, len, vel)); }

    // A round bass: a saw closed down by a filter, on a sine.
    function bass(to, t, n, len, vel) {
      const f = hz(n), saw = osc('sawtooth', f), sub = osc('sine', f), lp = filter('lowpass', 1100, 1.5), low = gain(0.35), amp = gain(0);
      lp.frequency.setValueAtTime(1100, t);
      lp.frequency.exponentialRampToValueAtTime(450, t + 0.16);
      saw.connect(lp).connect(amp);
      sub.connect(low).connect(amp);
      amp.connect(to);
      const end = held(amp.gain, t, 0.15 * vel, 0.006, len, 0.06, 0.75, 0.15) + 0.01;
      run(saw, t, end);
      run(sub, t, end, amp);
    }

    // A burst of noise through a filter: the makings of most of the drums.
    function hiss(to, t, peak, a, d, type, freq, q) {
      const s = ctx.createBufferSource(), f = filter(type, freq, q), amp = gain(0);
      s.buffer = noise;
      s.loop = true;
      s.connect(f).connect(amp).connect(to);
      run(s, t, struck(amp.gain, t, peak, a, d) + 0.01, amp, rnd() * 0.9);
      return f;
    }
    // A pitched knock: a sine (or triangle) that falls as it dies.
    function knock(to, t, f0, f1, peak, d, type = 'sine', fall = 0.09) {
      const o = osc(type, f0), amp = gain(0);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + fall);
      o.connect(amp).connect(to);
      run(o, t, struck(amp.gain, t, peak, 0.002, d) + 0.01, amp);
    }
    const kick = (to, t, vel) => { knock(to, t, 160, 58, 0.3 * vel, 0.18); hiss(to, t, 0.05 * vel, 0.001, 0.015, 'bandpass', 2500, 1); };
    const snare = (to, t, vel) => { hiss(to, t, 0.5 * vel, 0.001, 0.24, 'bandpass', 2100, 0.7); knock(to, t, 210, 170, 0.1 * vel, 0.07); };
    const stick = (to, t, vel, f = 1700) => { hiss(to, t, 0.24 * vel, 0.001, 0.05, 'bandpass', 1800, 5); knock(to, t, f, f * 0.97, 0.1 * vel, 0.03, 'triangle', 0.03); };
    const hat = (to, t, vel, open) => hiss(to, t, 0.26 * vel, 0.001, open ? 0.32 : 0.07, 'highpass', 6500);
    const shaker = (to, t, vel) => hiss(to, t, 0.16 * vel, 0.012, 0.08, 'bandpass', 5500, 1.2);
    const conga = (to, t, n, vel) => knock(to, t, hz(n) * 1.25, hz(n), 0.22 * vel, 0.16, 'sine', 0.03);
    const tom = (to, t, n, vel) => { knock(to, t, hz(n) * 1.5, hz(n), 0.26 * vel, 0.3, 'sine', 0.06); hiss(to, t, 0.08 * vel, 0.001, 0.05, 'bandpass', 900, 1); };
    const crash = (to, t, vel, d = 1.4) => hiss(to, t, 0.2 * vel, 0.002, d, 'highpass', 3800);

    // Brass: two saws a little apart, a filter that opens as the note speaks.
    function brass(to, t, n, len, vel, bend) {
      const f = hz(n), lp = filter('lowpass', f * 1.2, 0.8), amp = gain(0);
      lp.frequency.setValueAtTime(f * 1.2, t);
      lp.frequency.linearRampToValueAtTime(Math.min(7000, f * (3 + 5 * vel)), t + 0.05);
      lp.frequency.setTargetAtTime(f * 3, t + 0.05, 0.3);
      const end = held(amp.gain, t, 0.095 * vel, 0.03, len, 0.09, 0.8, 0.2) + 0.01;
      for (const cents of [-7, 7]) {
        const s = osc('sawtooth', f);
        s.detune.setValueAtTime(cents, t);
        if (bend) { s.detune.setValueAtTime(cents, t + len * 0.3); s.detune.linearRampToValueAtTime(cents + bend * 100, end); }
        s.connect(lp);
        run(s, t, end, cents > 0 ? amp : null);
      }
      lp.connect(amp).connect(to);
    }
    // A bell or a vibraphone bar: a sine with one high partial that dies first.
    function bell(to, t, n, vel, d = 0.7) {
      const f = hz(n), o = osc('sine', f), hi = osc('sine', f * 4), amp = gain(0), top = gain(0);
      o.connect(amp).connect(to);
      hi.connect(top).connect(to);
      const end = struck(amp.gain, t, 0.24 * vel, 0.003, d) + 0.01;
      run(hi, t, struck(top.gain, t, 0.045 * vel, 0.002, d * 0.35) + 0.01, top);
      run(o, t, end, amp);
    }
    // A blip that slides from one note to another.
    function blip(to, t, n0, n1, d, vel, type = 'triangle') { knock(to, t, hz(n0), hz(n1), 0.42 * vel, d, type, d * 0.8); }
    // Two notes of a chord scratched through a wah.
    function wah(to, t, list, vel) {
      const f = filter('bandpass', 500, 4), amp = gain(0);
      f.frequency.setValueAtTime(500, t);
      f.frequency.exponentialRampToValueAtTime(1800, t + 0.06);
      f.connect(amp).connect(to);
      const end = struck(amp.gain, t, 0.1 * vel, 0.003, 0.09) + 0.01;
      list.forEach((n, k) => { const o = osc('square', hz(n)); o.connect(f); run(o, t, end, k ? null : amp); });
    }
    // A room cheering, more or less: three bands of noise that swell and die away.
    function cheer(to, t, len, vel) {
      for (const [f, q, v] of [[950, 0.7, 1], [2100, 0.9, 0.7], [3600, 1.2, 0.4]]) {
        const s = ctx.createBufferSource(), bp = filter('bandpass', f, q), amp = gain(0), peak = 0.1 * vel * v;
        s.buffer = noise;
        s.loop = true;
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(peak, t + 0.25);
        amp.gain.linearRampToValueAtTime(peak * 0.7, t + len * 0.6);
        amp.gain.linearRampToValueAtTime(0, t + len);
        s.connect(bp).connect(amp).connect(to);
        run(s, t, t + len + 0.02, amp, rnd() * 0.9);
      }
    }
    // Noise swept upward: the channel changing.
    function whoosh(to, t, len, vel) {
      const s = ctx.createBufferSource(), f = filter('bandpass', 350, 1.4), amp = gain(0);
      s.buffer = noise;
      s.loop = true;
      f.frequency.setValueAtTime(350, t);
      f.frequency.exponentialRampToValueAtTime(5200, t + len);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.26 * vel, t + len * 0.7);
      amp.gain.linearRampToValueAtTime(0, t + len);
      s.connect(f).connect(amp).connect(to);
      run(s, t, t + len + 0.02, amp, rnd() * 0.5);
    }

    // ---------- the tunes ----------
    // A bed is played a sixteenth at a time: `b` says where it is (bar, step, the length
    // of a step) and what is wanted of it (tension, lead).
    const part = (form, b) => { const [first, second] = form[b.bar % form.length].split('|'); return CHORDS[b.step >= 8 && second ? second : first]; };
    const pick = list => list[Math.floor(rnd() * list.length)];
    function walk(b, t, c, pattern) {
      for (const [at, which, len, vel] of pattern) if (at === b.step) bass(b.out, t, c.root + (which === 'r' ? 0 : c.root >= 45 ? (which === 'f' ? -5 : 0) : which === 'f' ? 7 : 12), len * b.d, vel);
    }
    function comp_(b, t, c, pattern, vel = 1) {
      for (const [at, len, v] of pattern) if (at === b.step) chord(b.keys, t, c.ep, len * b.d, v * vel);
    }
    function tune(b, t, bars, k, vel = 1) {
      for (const [at, n, len] of bars[k] || []) if (at === b.step) bell(b.out, t, n, 0.85 * vel, 0.25 + len * b.d * 1.6);
    }

    const BEDS = {
      // A funk-lounge groove at 104, lightly swung. It changes as it goes round: which tune
      // (or none), how the bass walks and the piano comps, the fill, a verse without drums.
      lobby: {
        bpm: () => 104, swing: 0.14,
        play(b, t) {
          const s = b.step, k = b.bar % 8, sec = (b.bar >> 3) % 4, round = b.bar >> 5;
          if (!s) {
            if (!k) {
              b.tune = sec === 2 ? (rnd() < 0.8 ? 'bridge' : '') : sec === 1 ? 'main' : sec === 3 ? pick(['spare', 'main', '']) : round && rnd() < 0.45 ? 'spare' : '';
              b.thin = sec === 0 && round > 0 && rnd() < 0.35;
              b.fill = Math.floor(rnd() * 3);
            }
            b.walk = k % 4 === 0 ? 0 : Math.floor(rnd() * 3);
            b.comp = k % 2 === 0 ? 0 : 1 + Math.floor(rnd() * 2);
            b.push = rnd() < 0.3;
          }
          const c = part(LOBBY, b), split = LOBBY[b.bar % 32].includes('|');
          const filling = k === 7 && s >= 12;
          // Drums.
          if (!b.thin) {
            if (s === 0 || s === 10 || (b.push && s === 7)) kick(b.out, t, s === 0 ? 1 : 0.8);
            if ((s === 4 || s === 12) && !(filling && b.fill < 2)) snare(b.kit, t, 0.8);
            if (filling && b.fill === 0 && s !== 13) snare(b.kit, t, 0.55 + (s - 12) * 0.12);
            if (filling && b.fill === 1) tom(b.kit, t, [50, 50, 47, 43][s - 12], 0.5);
            if (filling && b.fill === 2 && s === 15) kick(b.out, t, 0.8);
          } else if (s % 8 === 4) stick(b.kit, t, 0.8);
          if (s % 2 === 0) hat(b.kit, t, s % 4 === 0 ? 0.8 : 0.5, s === 14 && b.push && !filling);
          else if (rnd() < 0.35) hat(b.kit, t, 0.3);
          if (sec === 2 && (s === 3 || s === 6 || s === 11 || s === 14)) conga(b.kit, t, s % 3 ? 55 : 60, 0.6);
          // Bass and piano.
          if (b.thin && k < 4) { if (s === 0) bass(b.out, t, c.root, 6 * b.d, 0.9); }
          else walk(b, t, c, WALKS[b.walk]);
          if (split) { if (s % 8 === 0) chord(b.keys, t, c.ep, 7 * b.d, 0.8); }
          else comp_(b, t, c, COMPS[b.comp]);
          // The tune, and in the bridge a scratch of wah guitar.
          if (b.tune) tune(b, t, TUNES[b.tune], k);
          if (sec === 2 && (s % 8 === 2 || s % 8 === 3)) wah(b.out, t, [c.ep[1] + 12, c.ep[2] + 12], s % 2 ? 0.9 : 0.5);
        },
      },
      // Thinking music: A minor at 92, a piano figure over a tick and a tock. `tension`
      // comes from the question's own clock: a half at ten seconds, then one to five
      // through the last five, each quicker and busier, over the dominant.
      think: {
        bpm: b => 92 + 6 * Math.max(0, Math.floor(b.tension)), swing: 0,
        play(b, t) {
          const s = b.step, x = b.tension;
          const c = x >= 5 ? CHORDS.E7 : x >= 3 ? CHORDS.E7sus : part(THINK, b);
          if (x !== b.was) { b.was = x; b.keysLp.frequency.setTargetAtTime(1500 + 450 * x, t, 0.1); b.out.gain.setTargetAtTime(1 + 0.1 * x, t, 0.1); }
          if (s % 4 === 0) stick(b.kit, t, 0.7, s % 8 ? 1250 : 1700);
          if (x >= 1 ? true : x > 0 ? s % 2 === 0 : s % 4 === 2) shaker(b.kit, t, s % 2 ? 0.5 : 0.9);
          if (x >= 2 ? s % 4 === 0 : s === 0) kick(b.out, t, 0.7);
          if (x >= 4 && s % 2 === 0) hat(b.kit, t, 0.6);
          if (x >= 3 ? s % 2 === 0 : s === 0 || s === 10) bass(b.out, t, c.root, (x >= 3 ? 1.5 : s ? 2 : 6) * b.d, x >= 3 ? 0.75 : 0.9);
          // The figure: up the chord and back, in quavers, then semiquavers.
          if (x >= 1 || s % 2 === 0) {
            const at = x >= 1 ? s : s / 2;
            piano(b.keys, t, c.ep[[0, 1, 2, 3, 2, 1][at % 6] % c.ep.length] + 12, 2.5 * b.d, at % 6 ? 0.5 : 0.7);
          }
          if (s === 0 && x < 3) chord(b.keys, t, c.ep, 12 * b.d, 0.45);
        },
      },
      // Between questions and under the standings: C major at 100, congas and a shaker.
      // The standings add a tune (`lead`).
      rest: {
        bpm: () => 100, swing: 0.1,
        play(b, t) {
          const s = b.step, k = b.bar % 4, c = part(REST, b);
          if (!s) { b.walk = k === 3 ? 1 : Math.floor(rnd() * 3); b.comp = 1 + Math.floor(rnd() * 2); }
          if (s === 0 || s === 8 || s === 11) kick(b.out, t, s === 0 ? 0.9 : 0.6);
          if (s === 4 || s === 12) stick(b.kit, t, 0.8);
          shaker(b.kit, t, s % 2 ? 0.45 : 0.8);
          if (s === 4 || s === 7 || s === 10 || s === 12 || s === 14) conga(b.kit, t, s === 12 || s === 14 ? 55 : 60, s === 4 ? 0.8 : 0.6);
          if (k === 3) { if (s % 8 === 0) { bass(b.out, t, c.root, 3 * b.d, 0.9); chord(b.keys, t, c.ep, 6 * b.d, 0.8); } if (s % 8 === 6) bass(b.out, t, c.root + 7, 2 * b.d, 0.7); }
          else { walk(b, t, c, WALKS[b.walk]); comp_(b, t, c, COMPS[b.comp]); }
          if (b.lead) tune(b, t, TUNES.scores, k);
        },
      },
    };

    // ---------- the conductor ----------
    // Notes are booked a little ahead on the audio clock, so the rhythm holds while the
    // page is busy. A timer that stalls (a hidden tab) never books the missed notes late:
    // the bed skips to where it should be.
    let bed = null;
    const dying = [];
    const api = { ahead: 0.3 };

    function stop(fade = 0.12) {
      if (!bed) return;
      const now = ctx.currentTime, b = bed;
      bed = null;
      b.out.gain.cancelScheduledValues(now);
      b.out.gain.setTargetAtTime(0, Math.max(now, b.from), fade / 3);
      try { b.lfo.stop(now + fade * 2 + api.ahead + 0.5); } catch {}
      dying.push([b.out, now + fade * 2 + api.ahead + 0.5]);
    }
    // Starts a bed (or with no name, stops the music). `at` is when its first bar begins.
    api.bed = (id, o = {}) => {
      stop(o.fade);
      if (!id || !BEDS[id]) return;
      const def = BEDS[id], from = Math.max(ctx.currentTime + 0.03, o.at || 0);
      const outG = gain(1), kit = gain(2), keys = gain(1), trem = gain(1), keysLp = filter('lowpass', 3200, 0.5), lfo = osc('sine', 5.2), depth = gain(0.1);
      lfo.connect(depth).connect(trem.gain);
      keys.connect(trem).connect(keysLp).connect(outG).connect(music);
      kit.connect(outG);     // the drums but the kick, which carry further than they measure
      lfo.start(from);
      bed = { id, def, out: outG, kit, keys, keysLp: id === 'think' ? keysLp : null, lfo, from, next: from, bar: 0, step: 0, tension: o.tension || 0, lead: !!o.lead };
      bed.d = 15 / def.bpm(bed);
      api.tick();
    };
    api.mood = m => { if (bed) { if (m.tension != null) bed.tension = m.tension; if (m.lead != null) bed.lead = m.lead; } };
    api.bedId = () => bed ? bed.id : null;
    const move = b => { b.next += b.d; if (++b.step === 16) { b.step = 0; b.bar++; } b.d = 15 / b.def.bpm(b); };
    api.tick = () => {
      const now = ctx.currentTime;
      while (ends.length && ends[0] <= now) ends.shift();
      if (ends.length > 64) for (let i = ends.length - 1; i >= 0; i--) if (ends[i] <= now) ends.splice(i, 1);
      for (let i = dying.length - 1; i >= 0; i--) if (dying[i][1] <= now) { try { dying[i][0].disconnect(); } catch {} dying.splice(i, 1); }
      if (!bed) return;
      const b = bed;
      while (b.next < now + 0.01) move(b);
      while (b.next < now + api.ahead) {
        b.def.play(b, b.next + (b.step % 2 ? b.d * b.def.swing : 0));
        move(b);
      }
    };
    api.stats = () => { const now = ctx.currentTime; return { made, live: ends.filter(e => e > now).length, dying: dying.length }; };

    // The music's level while there is reading to do, now or `after` seconds from now.
    api.read = (v, after = 0) => { const t = ctx.currentTime + after; if (!after) read.gain.cancelScheduledValues(t); read.gain.setTargetAtTime(v, t, after ? 0.5 : 0.08); };
    const dip = (to, len) => { const t = ctx.currentTime; duck.gain.cancelScheduledValues(t); duck.gain.setTargetAtTime(to, t, 0.03); duck.gain.setTargetAtTime(1, t + len, 0.25); };
    api.master = on => { const t = ctx.currentTime; out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(on ? MASTER : 0, t, 0.03); };

    // ---------- effects ----------
    // The longer ones (stings, the finale) go through `seq`, so a change of screen can
    // cut them short; the short ones go straight out.
    let seq = gain(1);
    seq.connect(fx);
    api.hush = () => {
      const now = ctx.currentTime, old = seq;
      old.gain.setTargetAtTime(0, now, 0.03);
      dying.push([old, now + 0.4]);
      seq = gain(1);
      seq.connect(fx);
    };
    const stab = (to, t, list, len, vel) => list.forEach(n => brass(to, t, n, len, vel));

    const CUES = {
      // A player joins: a rising blip, a step higher for each in a rush.
      join(t, o) { const n = PENT[(o.n || 0) % PENT.length]; blip(fx, t, n - 5, n, 0.09, 0.8); bell(fx, t + 0.07, n + 12, 0.5, 0.35); },
      remote(t) { blip(fx, t, 79, 79, 0.05, 0.35, 'square'); blip(fx, t + 0.09, 84, 84, 0.07, 0.35, 'square'); stick(fx, t, 1); },
      chip(t, o) { blip(fx, t, o.on ? 81 : 88, o.on ? 88 : 81, 0.05, 0.6, 'sine'); },
      // The game starts: the channel changes.
      start(t) { knock(fx, t, 2400, 180, 0.12, 0.12, 'sine', 0.1); whoosh(fx, t, 0.45, 1.6); hiss(fx, t + 0.43, 0.2, 0.001, 0.06, 'highpass', 2500); kick(fx, t + 0.45, 0.9); },
      back(t) { whoosh(fx, t, 0.35, 1); },
      // The title card: twice on the dominant and home. G13, G13, C6/9, the last chord in
      // one of four voicings (`alt`) so it isn't the same sting every question. The brass
      // stabs are for the first question, the middle one and (in `double`) the last: `full`.
      // The others have the piano and bass alone, with a stick for the snare.
      intro(t, o) {
        const home = ['E4 A4 D5', 'E4 A4 D5 G5', 'G4 A4 D5 E5', 'A4 D5 E5 G5'][(o.alt || 0) % 4];
        dip(o.full ? 0.3 : 0.45, o.full ? 1.6 : 1.2);
        for (const at of [0, 0.22]) {
          if (o.full) { stab(seq, t + at, notes('F4 B4 E5'), 0.12, 0.6); snare(seq, t + at, 0.7); } else stick(seq, t + at, 0.8);
          chord(seq, t + at, CHORDS.G13.ep, 0.12, 0.9); bass(seq, t + at, 43, 0.12, o.full ? 0.9 : 0.7);
        }
        if (o.full) { stab(seq, t + 0.44, notes(home), 0.8, 0.675); kick(seq, t + 0.44, 1); }
        else chord(seq, t + 0.44, notes(home), 0.7, 0.8);
        chord(seq, t + 0.44, notes('E3 A3 D4 G4'), 0.9, 0.9);
        bass(seq, t + 0.44, 48, 0.8, o.full ? 1 : 0.8); hat(seq, t + 0.44, o.full ? 1 : 0.6, true);
        bell(seq, t + 0.5, 84, o.full ? 0.7 : 0.5, 0.9);
      },
      // The last question: a bell three times, then the big cadence. Ab, Bb, C.
      double(t) {
        dip(0.3, 2.4);
        for (let k = 0; k < 3; k++) { bell(seq, t + k * 0.16, 88, 0.9, 0.3); bell(seq, t + k * 0.16, 91, 0.7, 0.3); }
        for (let k = 0; k < 9; k++) snare(seq, t + 0.5 + k * 0.05, 0.3 + k * 0.06);
        [['Ab4 C5 Eb5', 44], ['Bb4 D5 F5', 46], ['C5 E5 G5 C6', 48]].forEach(([c, b], k) => {
          const at = t + 0.95 + k * 0.24, len = k < 2 ? 0.16 : 1.1;
          stab(seq, at, notes(c), len, 1); bass(seq, at, b, len, 1); tom(seq, at, b, 0.8);
        });
        crash(seq, t + 1.43, 0.9, 1.2);
        bell(seq, t + 1.5, 96, 0.8, 1.1);
      },
      // The answers arrive, one pop each; an answer lands, a soft tick.
      pills(t, o) { const up = notes('A4 C5 E5 G5'); for (let k = 0; k < o.n; k++) blip(fx, t + 0.22 + k * 0.07, up[k] - 3, up[k], 0.06, 0.65); },
      answer(t, o) { const n = APENT[(o.pid || 0) % APENT.length]; stick(fx, t, 1, 2100); bell(fx, t, n, 0.45, 0.2); },
      // The last five seconds, harder each time; then time is up.
      tick(t, o) { const v = 1.3 + (5 - o.secs) * 0.2; stick(fx, t, v, 1900); blip(fx, t, 88, 88, 0.05, v * 0.3, 'sine'); },
      // Ten seconds left: one soft kick.
      ten(t) { kick(fx, t, 0.55); },
      // The remote: the ring moving, OK on a button, a question coming up on the screen.
      move(t) { stick(fx, t, 0.25); },
      ok(t) { blip(fx, t, 84, 84, 0.04, 0.3, 'sine'); },
      ask(t) { bell(fx, t, 76, 0.3, 0.25); bell(fx, t + 0.09, 72, 0.3, 0.35); },
      timeup(t) {
        const lp = filter('lowpass', 900, 1), amp = gain(0);
        const end = held(amp.gain, t, 0.10, 0.01, 0.38, 0.06) + 0.01;
        for (const n of [45, 52]) { const o = osc('sawtooth', hz(n)); o.connect(lp); run(o, t, end, n === 52 ? amp : null); }
        lp.connect(amp).connect(fx);
        stick(fx, t, 1, 1300);
      },
      // Somebody was right: a chime up the chord of C, and the points counted. By how the
      // room did (`mix`), so it isn't the one sound twenty times a game: everyone right has
      // a crash on it; under a quarter of them right ('few') is the bells alone, nothing counted.
      right(t, o) {
        dip(0.35, o.mix === 'few' ? 1.1 : 1.7);
        notes('C5 E5 G5 C6').forEach((n, k) => bell(seq, t + k * 0.07, n, k === 3 ? 1 : 0.8, k === 3 ? 1.2 : 0.5));
        if (o.mix === 'few') return;
        chord(seq, t, notes('E4 G4 C5'), 0.8, 0.7);
        if (o.mix === 'all') { crash(seq, t, 0.8, 1.2); kick(seq, t, 0.8); }
        const count = Math.max(5, Math.min(14, Math.round((o.points || 500) / 80)));
        for (let k = 0; k < count; k++) blip(seq, t + 0.75 + k * 0.045, CMAJ[k % 8], CMAJ[k % 8], 0.03, 0.22, 'square');
        bell(seq, t + 0.78 + count * 0.045, 96, 0.6, 0.6);
        hat(seq, t + 0.78 + count * 0.045, 0.8, true);
      },
      // Nobody was: the air goes out of it. D, C sharp, C, and a long sagging B.
      wrong(t) {
        dip(0.35, 2.2);
        [62, 61, 60].forEach((n, k) => brass(seq, t + k * 0.3, n, 0.24, 0.85, -0.4));
        brass(seq, t + 0.9, 59, 0.9, 0.85, -3);
        tom(seq, t + 0.9, 43, 0.5);
      },
      // The standings: up the chord, then a blip for each player who moved.
      board(t, o) {
        dip(0.5, 1);
        notes('C4 E4 G4 B4 D5 G5').forEach((n, k) => bell(seq, t + k * 0.05, n, 0.6, 0.5));
        let k = 0;
        for (const m of o.moves || []) if (m && k < 8) { const at = t + 0.75 + k++ * 0.18; if (m > 0) blip(seq, at, 79, 84, 0.1, 0.7); else blip(seq, at, 76, 69, 0.12, 0.6); }
      },
      pause(t) { blip(fx, t, 76, 76, 0.07, 0.7); blip(fx, t + 0.1, 69, 69, 0.12, 0.7); },
      resume(t) { blip(fx, t, 69, 69, 0.07, 0.7); blip(fx, t + 0.1, 76, 76, 0.12, 0.7); },
      // The final scores. A drum roll under the names coming in, a step for each (third on
      // F, second on G), and the winner's fanfare in C. `rows` is [seconds from now, place,
      // how far up the list]; `win` is when the winner comes.
      finale(t, o) {
        const win = o.win;
        if (win > 0.2) {
          const len = win - 0.07, n = Math.floor(len * 22);
          for (let k = 0; k < n; k++) { const p = k / n; hiss(seq, t + k / 22, (0.035 + 0.11 * p * p) * (k % 2 ? 0.8 : 1), 0.001, 0.05, 'bandpass', 2200, 0.7); }
          for (let at = Math.max(0, len - 1.2); at < len - 0.05; at += 0.15) tom(seq, t + at, 43, 0.25 + 0.4 * (1 - (len - at) / 1.2));
        }
        for (const [due, place, up] of o.rows || []) {
          // (One due a moment ago is the one coming in now.)
          if (due < -0.4 || due > win) continue;
          const at = Math.max(0, due);
          if (place === 3) { stab(seq, t + at, notes('A4 C5 F5'), 0.3, 0.8); bass(seq, t + at, 41, 0.3, 1); tom(seq, t + at, 41, 0.8); }
          else if (place === 2) { stab(seq, t + at, notes('B4 D5 G5'), 0.35, 0.9); bass(seq, t + at, 43, 0.35, 1); tom(seq, t + at, 43, 0.9); }
          else blip(seq, t + at, PENT[up % 5] - 12, PENT[up % 5] - 12, 0.1, 0.6);
        }
        if (win > -0.5) fanfare(t + Math.max(0, win));
      },
    };
    // C, C, C, C up through its notes; F; G; and C held, with the bells running up it.
    function fanfare(t) {
      const beat = 0.44;
      const hits = [[0, 0.6, 'E4 G4 C5', 48], [0.75, 0.2, 'E4 G4 C5'], [1, 0.42, 'G4 C5 E5'], [1.5, 0.42, 'C5 E5 G5'], [2, 0.9, 'C5 F5 A5', 41], [3, 0.9, 'D5 G5 B5', 43], [4, 5.2, 'E5 G5 C6', 48]];
      for (const [at, len, c, b] of hits) {
        const when = t + at * beat;
        stab(seq, when, notes(c), len * beat, 1);
        snare(seq, when, 0.8);
        if (b) { bass(seq, when, b, len * beat, 1); tom(seq, when, b, 0.9); kick(seq, when, 1); }
      }
      crash(seq, t, 0.9);
      crash(seq, t + 4 * beat, 1, 2);
      notes('C6 E6 G6 C7 G6 C7').forEach((n, k) => bell(seq, t + 4 * beat + 0.08 + k * 0.11, n, 0.7, k === 5 ? 1.4 : 0.5));
      // And the room, after the last chord has landed.
      cheer(seq, t + 4 * beat + 0.35, 1.5, 1);
    }

    // Plays an effect now, or `o.delay` seconds from now.
    api.cue = (name, o = {}) => { if (CUES[name]) CUES[name](ctx.currentTime + 0.03 + (o.delay || 0), o); };
    api.cues = Object.keys(CUES);
    api.beds = Object.keys(BEDS);
    return api;
  }

  // ---------- listening to the game ----------
  const MUSIC_KEY = 'parlour.music';
  let ctx = null, R = null;       // the audio context and the band, once a press has allowed them
  let on = true, musicOn = true;
  let els = {};                   // the Sound and Music buttons
  let view = null;                // the room's view last drawn
  let running = false;
  let woke = 0;                   // when a press last started the sound
  let holdUntil = 0;              // the music waits for an effect to finish (audio clock)
  let tension = 0, up = false, upAt = -9, ticked = '', ended = '', joins = 0, joinedAt = 0;

  const live = () => !!(on && R && ctx.state === 'running');
  // Sound is wanted but the browser is waiting for a click or a key.
  const blocked = () => !!(AC && on && (!ctx || ctx.state !== 'running'));
  const touch = (() => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } })();

  function label() {
    if (els.sound) {
      const ask = blocked();
      els.sound.textContent = !on ? 'Sound off' : ask ? els.ask || 'Press for sound' : 'Sound on';
      els.sound.classList.toggle('wants', ask);
    }
    if (els.music) { els.music.hidden = !on; els.music.textContent = musicOn ? 'Music on' : 'Music off'; }
  }

  // Called from a click or a key: the only time a browser lets sound start.
  function wake() {
    if (!AC || !on) return;
    if (!ctx) {
      ctx = new AC();
      R = root.Sound.rig(ctx);
      ctx.onstatechange = settle;
      setInterval(() => { try { if (live()) R.tick(); } catch {} }, 60);
      document.addEventListener('visibilitychange', () => {
        try {
          // A hidden tab's timers run once a second: book further ahead while it is.
          R.ahead = document.hidden ? 2.6 : 0.3;
          if (!document.hidden && on && ctx.state !== 'running') ctx.resume().catch(() => {});
        } catch {}
      });
    }
    R.master(true);
    if (ctx.state !== 'running') ctx.resume().then(settle, () => {});
    settle();
  }
  // After anything that may have started or stopped the sound.
  function settle() {
    try {
      label();
      const now = live();
      if (now && !running && view) pickUp();
      running = now;
    } catch {}
  }

  // Which music a screen has. An open question's stops when its time is up.
  function bedFor(v) {
    if (!v || !musicOn || v.paused != null) return null;
    if (v.phase === 'lobby' || v.phase === 'end') return 'lobby';
    if (v.phase === 'question') return up ? null : 'think';
    if (v.phase === 'reveal' || v.phase === 'board') return 'rest';
    return null;
  }
  function music() {
    if (!live()) return;
    const want = bedFor(view), mood = { tension, lead: view?.phase === 'board' };
    if (want !== R.bedId()) R.bed(want, { at: holdUntil, ...mood });
    else R.mood(mood);
  }
  // The sound starting part way through something (the first press after a reload, sound
  // turned back on): the music for the screen, and what is left of a finale. No effects.
  function pickUp() {
    holdUntil = 0;
    R.read(view.phase === 'reveal' ? 0.6 : 1);
    if (view.phase === 'end') finale(view);
    music();
  }

  // The final scores, timed as the TV draws them (P.finale) from when the game ended, so
  // one that is part way through plays only what is left. Once a game.
  function finale(v) {
    const key = `${v.game || 0}:${v.at}`;
    if (ended === key || !root.P) return;
    ended = key;
    if (v.players.every(p => !p.score)) return; // nobody scored: no winner to play in
    const n = v.players.length, f = root.P.finale(n, root.P.firsts ? root.P.firsts(v) : 1), gone = root.P.now() - (v.at || root.P.now());
    const win = (f.winnerAt - gone) / 1000;
    if (!n || win <= -0.5) return;
    const rows = v.players.map((p, k) => [(f.at(k, p.place === 1) - gone) / 1000, p.place, n - 1 - k]).filter(r => r[1] !== 1);
    R.cue('finale', { rows, win });
    holdUntil = ctx.currentTime + Math.max(0, win) + FANFARE;
  }

  // What a screen sounds like as it arrives.
  function arrive(v, before) {
    const t = ctx.currentTime;
    if (v.phase === 'lobby') R.cue('back');
    else if (v.phase === 'intro') {
      const first = before.phase === 'lobby' || before.phase === 'end';
      if (first) R.cue('start');
      R.cue(v.double ? 'double' : 'intro', { delay: first ? 0.45 : 0, alt: v.i % 4, full: v.i === 0 || v.i === Math.floor(v.total / 2) });
    } else if (v.phase === 'question') {
      R.cue('pills', { n: v.shown?.type === 'number' ? 2 : 4 });
      // Quiet while the question is read, then up.
      holdUntil = t + 0.5;
      R.read(0.5);
      R.read(1, 3.5);
    } else if (v.phase === 'reveal') {
      // With the picture: four answers have the right one pop 0.9 s in (the TV dims the wrong ones first).
      const delay = Math.max(v.shown && v.shown.type === 'choice' ? 0.9 : 0, upAt + 0.55 - t);
      const points = Math.max(0, ...v.players.map(p => p.gain || 0));
      const n = v.players.length, scored = v.players.filter(p => p.gain > 0).length;
      const mix = n > 1 && scored === n ? 'all' : scored < n / 4 ? 'few' : '';
      R.cue(points ? 'right' : 'wrong', { delay, points, mix });
      holdUntil = t + delay + (points ? 1.5 : 2.1);
    } else if (v.phase === 'board') R.cue('board', { moves: v.players.map(p => p.moved || 0) });
  }

  // What changed on a screen that was already up.
  function change(v, before) {
    if ((v.paused == null) !== (before.paused == null)) R.cue(v.paused == null ? 'resume' : 'pause');
    if (v.phase === 'lobby') {
      const known = new Set(before.players.map(p => p.pid));
      const t = ctx.currentTime;
      if (t - joinedAt > 6) joins = 0;
      let k = 0;
      for (const p of v.players) if (!known.has(p.pid)) { R.cue('join', { n: joins++, delay: k++ * 0.11 }); joinedAt = t; }
      if (v.remote != null && before.remote != null && v.remote !== before.remote) R.cue('remote');
      const a = before.settings, b = v.settings;
      if (a && b && (a.count !== b.count || String(a.cats) !== String(b.cats))) R.cue('chip', { on: a.count !== b.count || (b.cats.length || 8) >= (a.cats.length || 8) });
    } else if (v.phase === 'question') {
      const had = new Set(before.players.filter(p => p.answered).map(p => p.pid));
      let k = 0;
      for (const p of v.players) if (p.answered && !had.has(p.pid)) R.cue('answer', { pid: p.pid, delay: k++ * 0.07 });
    }
  }

  // Every public call is safe to make whatever state the sound is in.
  const safe = (f, fallback) => (...a) => { try { return f(...a); } catch { return fallback; } };

  root.Sound = {
    rig,
    // Once, from the TV: whether sound is on, and the Sound and Music buttons to keep labelled.
    setup: safe(o => {
      on = o.on !== false;
      els = { sound: o.sound, music: o.music, ask: o.ask };
      try { const v = localStorage.getItem(MUSIC_KEY); musicOn = v == null ? true : JSON.parse(v) !== false; } catch {}
      els.music?.addEventListener('click', safe(() => {
        musicOn = !musicOn;
        try { localStorage.setItem(MUSIC_KEY, JSON.stringify(musicOn)); } catch {}
        label();
        music();
      }));
      // Any press anywhere lets the sound start. One that did is remembered for a moment,
      // so that pressing the Sound button to start it doesn't also turn it off.
      const press = safe(() => { const ask = blocked(); wake(); if (ask) woke = performance.now(); });
      for (const type of ['pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(type, press, true);
      label();
    }),
    // Sound on or off; says which it now is.
    toggle() {
      try {
        if (on && performance.now() - woke < 500) { woke = 0; return on; }
        on = !on;
        if (on) wake();
        else if (R) { R.bed(null); R.master(false); running = false; setTimeout(() => { try { if (!on) ctx.suspend(); } catch {} }, 300); }
        label();
      } catch {}
      return on;
    },
    // The room's view as the TV draws it: the one before it (none on a reload or in a new
    // room), and whether this is a new screen. A view that is only a redraw plays nothing.
    scene: safe((v, before, arrived) => {
      view = v || null;
      if (arrived || !v) { tension = 0; up = false; if (!v || v.phase !== 'end') ended = ''; }
      if (!live()) return;
      if (arrived || !v) { R.hush(); holdUntil = 0; R.read(v && v.phase === 'reveal' ? 0.6 : 1); }
      if (v && arrived && before) arrive(v, before);
      else if (v && before && before !== v && before.phase === v.phase) change(v, before);
      if (v && v.phase === 'end') finale(v);
      music();
    }),
    // The seconds left on an open question, each time the TV's own countdown changes them.
    clock: safe(secs => {
      const v = view;
      if (!v || v.phase !== 'question' || v.paused != null) return;
      const key = `${v.game || 0}:${v.i}:${secs}`;
      if (key === ticked) return;
      ticked = key;
      tension = secs > 10 ? 0 : secs > 5 ? 0.5 : secs > 0 ? 6 - secs : 5;
      if (secs === 0) up = true;
      if (!live()) return;
      if (secs === 10) R.cue('ten');
      if (secs > 0 && secs <= 5) R.cue('tick', { secs });
      if (secs === 0) { upAt = ctx.currentTime; R.cue('timeup'); }
      music();
    }),
    // The remote: 'move' as the ring goes to another button, 'ok' as one is pressed, 'ask'
    // as a question comes up on the screen. Nothing until the sound is awake.
    ui: safe(name => { if (live() && (name === 'move' || name === 'ok' || name === 'ask')) R.cue(name); }),
    // For checking: what is going on inside.
    state: () => ({ on, musicOn, blocked: blocked(), context: ctx ? ctx.state : null, bed: R ? R.bedId() : null, ...(R ? R.stats() : {}) }),
  };
})(window);
