// The TV: opens a room, shows the way in, then runs the questions on screen.
(function () {
  const $ = id => document.getElementById(id);
  const { CATS, LETTERS, KINDS, AWARDS, esc, who, ordinal, plural, thousands } = P;
  const SAVED = 'parlour.host', ASKED = 'parlour.asked', SOUND = 'parlour.sound';
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    drop(k) { try { localStorage.removeItem(k); } catch {} },
  };

  let room = null;      // { code, key }
  let sock = null;
  let view = null;
  let shownKey = '';    // what's on screen, so a repeat message doesn't redraw it
  let trouble = '';     // why Start did nothing, shown by the button until the next try
  let sound = store.get(SOUND, true);
  let lock = null;           // the screen wake lock, while held
  const touch = matchMedia('(pointer: coarse)').matches;

  // ---------- screens ----------
  const SCREENS = ['s-wait', 's-lobby', 's-intro', 's-q', 's-board', 's-gone'];
  const show = id => { for (const s of SCREENS) $(s).hidden = s !== id; $('legal').hidden = id !== 's-lobby'; };

  function waiting(note, retry) {
    show('s-wait');
    $('wait-note').textContent = note;
    $('wait-retry').hidden = !retry;
    $('controls').hidden = true;
  }

  // ---------- opening a room ----------
  async function open() {
    waiting('Opening a room…');
    const saved = store.get(SAVED, null);
    try {
      if (saved && saved.code && saved.key) {
        const info = await about(saved);
        // Open, and still ours: the code may belong to someone else's room by now.
        if (info.open && info.host !== false) return join(saved);
      }
      const res = await fetch('/api/rooms', { method: 'POST' });
      if (!res.ok) throw new Error(res.status);
      const made = await res.json();
      store.set(SAVED, made);
      join(made);
    } catch {
      waiting('Couldn’t open a room. Check the internet connection.', true);
    }
  }

  function join(r) {
    room = r;
    shownKey = '';
    const url = `${location.host}/${room.code}`;
    $('join-url').textContent = location.host;
    $('code').textContent = room.code;
    drawQr(`${location.protocol}//${url}`);
    sock = P.connect(() => P.wsUrl(`/api/rooms/${room.code}/ws?role=host&key=${encodeURIComponent(room.key)}`), {
      onMessage,
      onState: s => {
        $('offline').hidden = s !== 'down';
        if (s === 'open') { shareAsked(); awake(); }
        if (s === 'closed') return gone('This room has closed.');
        if (s === 'down') stillOpen(room).then(open => { if (open === false) gone('This room has closed.'); });
      },
    });
  }

  // What the Worker says of a room, asked with its key so it can say whether it's ours
  // (`host`; an older Worker doesn't say).
  const about = r => fetch(`/api/rooms/${r.code}?key=${encodeURIComponent(r.key)}`, { cache: 'no-store' }).then(res => res.json());
  // Whether our room is still there: true, false, or null if there's no telling.
  const stillOpen = r => about(r).then(i => !!i.open && i.host !== false).catch(() => null);

  function gone(note) {
    if (sock) sock.close();
    sock = null;
    view = null;
    lock?.release().catch(() => {});
    store.drop(SAVED);
    show('s-gone');
    $('gone-note').textContent = note;
    $('controls').hidden = true;
    $('paused').hidden = true;
  }

  function drawQr(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
    $('qr').innerHTML = `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#F3EDE0"/><path d="${d}" fill="#11201B"/></svg>`;
  }

  // ---------- messages ----------
  function onMessage(m) {
    if (m.t === 'gone') return gone(m.why === 'closed' ? 'This room has closed.' : 'This room has closed.');
    if (m.t === 'note') {
      trouble = 'Couldn’t load the questions. Try again.';
      if (view?.phase === 'lobby') render(view);
      return;
    }
    if (m.t !== 'view') return;
    P.sync(m.now);
    const before = view;
    view = m;
    if (view.phase === 'end' && view.asked) remember(view.asked);
    render(before);
  }

  function remember(ids) {
    const list = store.get(ASKED, []);
    const seen = new Set(list);
    const before = list.length;
    for (const id of ids) if (!seen.has(id)) list.push(id);
    store.set(ASKED, list.slice(-3000));
    if (list.length !== before) shareAsked();
  }

  // The room keeps a copy of what this TV has asked, so a game started from the
  // remote steers clear of them too.
  const shareAsked = () => send({ t: 'avoid', ids: store.get(ASKED, []) });

  const send = msg => sock && sock.send(msg);

  // Redraws only when something on screen changed, so a phone coming or going
  // doesn't restart animations.
  const fill = (el, html) => { if (el._html === html) return false; el.innerHTML = html; el._html = html; return true; };
  let stage = '';          // the phase and question last drawn, so sounds play once
  let fanfare = null;      // the winner's sound, due part way through the final scores

  // ---------- drawing ----------
  // Connected and looking at the phone: offline and locked phones are shown alike.
  const here = p => p.online && !p.away;

  function render(before) {
    const v = view;
    const playing = ['intro', 'question', 'reveal', 'board'].includes(v.phase);
    $('controls').hidden = !playing;
    // A question shows Paused where the seconds are; other screens in the same corner.
    $('paused').hidden = v.paused == null || v.phase === 'question' || v.phase === 'reveal';
    $('c-pause').textContent = v.paused == null ? 'Pause' : 'Resume';
    const now = `${v.phase}:${v.i}:${v.total}`;
    const arrived = now !== stage;
    stage = now;
    // More than eight players need the tighter layouts.
    document.body.classList.toggle('crowd', v.players.length > 8);
    if (v.phase !== 'lobby') trouble = '';
    if (v.phase === 'lobby') return lobby(before);
    if (v.phase === 'intro') return intro(arrived);
    if (v.phase === 'question' || v.phase === 'reveal') return ask(before);
    return board(arrived);
  }

  function lobby(before) {
    show('s-lobby');
    const v = view;
    const list = v.players.slice().sort((a, b) => a.pid - b.pid);
    $('count').textContent = list.length ? `${list.length} of 16` : '';
    $('lobby-empty').hidden = list.length > 0;
    const known = new Set((before?.players || []).map(p => p.pid));
    fill($('lobby-players'), list.map(p =>
      `<li><button class="player${here(p) ? '' : ' away'}${known.has(p.pid) || !before ? '' : ' new'}" data-pid="${p.pid}" title="Remove ${esc(p.name)}"><span class="name p${p.colour}">${esc(p.name)}</span></button></li>`).join(''));
    if (before && list.some(p => !known.has(p.pid))) play('join');

    const { count, cats } = v.settings;
    // Redrawing the toggles drops focus; put it back, or the next Enter would start the game.
    const had = document.activeElement?.closest?.('.settings [data-cat], .settings [data-len]');
    const again = had && (had.dataset.cat ? `[data-cat="${had.dataset.cat}"]` : `[data-len="${had.dataset.len}"]`);
    $('lengths').innerHTML = [10, 15, 20].map(n => `<button class="${n === count ? 'on' : ''}" data-len="${n}" data-label="${n}" aria-pressed="${n === count}">${n}</button>`).join('');
    const rows = P.topicRows(cats, esc);
    $('cats').innerHTML = rows.general;
    $('packs').innerHTML = rows.packs;
    if (again) document.querySelector('.settings ' + again)?.focus();
    // Once the settings are drawn: they take room from the list.
    pack();
    $('start').disabled = !list.length;
    // No keyboard to press Enter on a touch screen.
    $('start-hint').textContent = trouble || (!list.length ? 'Needs one player' : touch ? '' : 'or press Enter');
  }

  // Each step makes room only when the names need it: settings a little tighter, then
  // full-size names three across, and only then smaller names four across.
  const FITS = [[], ['snug'], ['snug', 'three'], ['snug', 'packed']];
  function pack() {
    const lobby = $('s-lobby'), list = $('lobby-players');
    // The row itself, not its name: a name that has just arrived is still sliding in.
    const over = () => list.lastElementChild && list.lastElementChild.getBoundingClientRect().bottom > list.getBoundingClientRect().bottom;
    for (const fit of FITS) {
      lobby.classList.remove('snug', 'three', 'packed');
      lobby.classList.add(...fit);
      if (!over()) break;
    }
  }

  // The font arriving changes every name's width.
  document.fonts?.ready.then(() => { if (view?.phase === 'lobby') pack(); });

  function intro(arrived) {
    show('s-intro');
    const v = view;
    fill($('intro-n'), `${v.i + 1}<small> of ${v.total}</small>`);
    $('intro-cat').textContent = CATS[v.cat] || '';
    $('intro-kind').textContent = KINDS[v.kind] || '';
    $('intro-double').hidden = !v.double;
    if (arrived) play(v.double ? 'end' : 'intro');
  }

  function ask(before) {
    show('s-q');
    const v = view;
    const s = v.shown;
    // The game too: question 3 of this game isn't question 3 of the last one.
    const key = `${v.game || 0}:${v.i}:${v.phase}`;
    const fresh = key !== shownKey;
    shownKey = key;
    $('q-where').textContent = `${v.i + 1} of ${v.total} · ${CATS[v.cat] || ''}${v.double ? ' · Double points' : ''}`;
    $('q-text').textContent = s.text;
    $('s-q').className = `screen ask t-${s.type} ph-${v.phase}${v.paused != null ? ' held' : ''}`;
    $('q-text').classList.toggle('long', s.text.length > 80);

    if (v.phase === 'question') {
      // While paused the label is ours, so no stray ticks as the views come in.
      const held = v.paused != null;
      P.countdown($('q-timer'), held ? null : $('q-secs'), v.until, v.limit, v.paused, secs => { if (secs <= 5 && secs > 0) play('tick'); });
      if (held) $('q-secs').textContent = 'Paused';
      if (fresh) {
        fill($('q-body'), body(s));
        $('q-fact').hidden = true;
      }
      const done = v.players.filter(p => p.answered).length;
      fill($('q-answered'), `<span class="who">${v.players.slice().sort((a, b) => a.pid - b.pid).map(p => `<span class="dot p${p.colour}${p.answered ? ' in' : ''}${here(p) ? '' : ' away'}">${esc(p.name)}</span>`).join('')}</span><span class="tally num">${done} of ${v.players.length} in</span>`);
    } else {
      cancelAnimationFrame($('q-timer')._raf);
      $('q-timer').firstElementChild.style.transform = 'scaleX(0)';
      $('q-secs').textContent = v.paused != null ? 'Paused' : '';
      if (fresh) play('reveal');
      const drawn = fill($('q-body'), answer(s, v.reveal));
      $('q-fact').hidden = !v.reveal.fact;
      $('q-fact').textContent = v.reveal.fact;
      // Only who scored: a full room's zeros would wrap the row.
      const order = v.players.filter(p => p.gain > 0).sort((a, b) => b.gain - a.gain || a.pid - b.pid);
      const quick = v.reveal.quickest && v.players.find(p => p.pid === v.reveal.quickest.pid);
      fill($('q-answered'), `<span class="gains">${order.length ? order.map(p => `<span class="gain">${who(p)}<span class="num">+${thousands(p.gain)}</span></span>`).join('') : '<span class="gain none">Nobody scored</span>'}</span>${quick ? `<span class="quick">Quickest: <strong>${esc(quick.name)}</strong> <span class="num">${(v.reveal.quickest.at / 1000).toFixed(1)} s</span></span>` : ''}`);
      // Once the fact and the points below are in, so it knows the room it has.
      if (drawn) fitGuesses();
    }
  }

  function body(s) {
    if (s.type === 'choice') return `<ol class="options">${s.options.map((o, i) => `<li class="opt opt-${'abcd'[i]}"><span class="letter">${LETTERS[i]}</span><span class="text">${esc(o)}</span></li>`).join('')}</ol>`;
    if (s.type === 'number') return `<p class="guess">Type your guess on your phone${s.unit ? ` <span class="unit">(${esc(s.unit)})</span>` : ''}</p>`;
    return `<ol class="options items">${s.items.map((o, i) => `<li class="opt opt-${'abcd'[i]}"><span class="letter">${LETTERS[i]}</span><span class="text">${esc(o)}</span></li>`).join('')}</ol>`;
  }

  function answer(s, r) {
    const byPid = new Map(view.players.map(p => [p.pid, p]));
    const pickers = test => Object.entries(r.answers).filter(([, v]) => test(v)).map(([pid]) => byPid.get(Number(pid))).filter(Boolean);
    if (s.type === 'choice') {
      return `<ol class="options">${s.options.map((o, i) => {
        const picked = pickers(v => v === i);
        return `<li class="opt opt-${'abcd'[i]} ${i === r.key ? 'right' : 'dim'}"><span class="letter">${LETTERS[i]}</span><span class="text">${esc(o)}</span><span class="pickers">${picked.map(who).join('')}</span></li>`;
      }).join('')}</ol>`;
    }
    if (s.type === 'number') {
      const unit = s.unit ? ` <span class="unit">${esc(s.unit)}</span>` : '';
      const guesses = Object.entries(r.answers).map(([pid, g]) => ({ p: byPid.get(Number(pid)), g })).filter(x => x.p)
        .sort((a, b) => Math.abs(a.g - r.answer) - Math.abs(b.g - r.answer));
      const plain = n => s.year ? String(n) : thousands(n);
      // The closest eight, or as many as the screen has room for (fitGuesses); the
      // rest are in the points below.
      const more = guesses.length - 8;
      return `<div class="number"><p class="big-answer num">${plain(r.answer)}${unit}</p>
        <ol class="guesses" data-more="${Math.max(0, more)}">${guesses.slice(0, 8).map(({ p, g }) => `<li><span class="name p${p.colour}">${esc(p.name)}</span><span class="g num">${plain(g)}</span><span class="off num">${g === r.answer ? 'spot on' : (g > r.answer ? '+' : '−') + plain(Math.abs(g - r.answer))}</span></li>`).join('')}<li class="more"${more > 0 ? '' : ' hidden'}>and ${more} further off</li></ol></div>`;
    }
    return `<ol class="right-order">${r.items.map((it, k) => {
      const shownAt = r.key[k];
      return `<li class="opt opt-${'abcd'[shownAt]}"><span class="place num">${k + 1}</span><span class="letter">${LETTERS[shownAt]}</span><span class="text">${esc(it.label)}</span>${it.note ? `<span class="note num">${esc(it.note)}</span>` : ''}</li>`;
    }).join('')}</ol>`;
  }

  // Drops the furthest guesses until the list fits the space it has.
  function fitGuesses() {
    const body = $('q-body'), list = body.querySelector('.guesses');
    if (!list) return;
    const more = list.querySelector('.more');
    let extra = Number(list.dataset.more);
    const rows = [...list.querySelectorAll('li:not(.more)')];
    while ((body.scrollHeight > body.clientHeight + 1 || list.scrollHeight > list.clientHeight + 1) && rows.length > 1) {
      rows.pop().remove();
      extra += 1;
      more.hidden = false;
      more.textContent = `and ${extra} further off`;
    }
  }
  // A new size of TV window: draw a number answer again so it fits. Not on a phone,
  // where the page scrolls (and the address bar coming and going resizes it).
  const flowing = matchMedia('(orientation: portrait), (max-height: 479px)');
  let sized = `${innerWidth}x${innerHeight}`, refit = null;
  addEventListener('resize', () => {
    clearTimeout(refit);
    refit = setTimeout(() => {
      const now = `${innerWidth}x${innerHeight}`;
      if (now === sized) return;
      sized = now;
      if (view?.phase === 'lobby') pack();
      if (flowing.matches || !sock || $('s-q').hidden || view?.phase !== 'reveal' || view.shown?.type !== 'number') return;
      $('q-body')._html = '';
      render(view);
    }, 150);
  });

  function board(arrived) {
    show('s-board');
    const v = view;
    const end = v.phase === 'end';
    $('board-title').textContent = end ? (v.players.length ? 'Final scores' : 'Game over') : `After ${v.i + 1} of ${v.total}`;
    $('s-board').classList.toggle('final', end);
    $('end-actions').hidden = !end;
    $('standings').classList.toggle('many', v.players.length > 7);
    const drawn = fill($('standings'), v.players.map(p => `<li class="${p.place === 1 && end ? 'winner' : ''}">
      <span class="place num">${ordinal(p.place)}</span><span class="name p${p.colour}">${esc(p.name)}</span>
      <span class="moved num ${p.moved > 0 ? 'rise' : 'fall'}">${P.moveText(p.moved)}</span>
      ${!end && p.gain ? `<span class="up num">+${thousands(p.gain)}</span>` : '<span class="up"></span>'}
      <span class="score num">${thousands(p.score)}</span></li>`).join(''));
    const byPid = new Map(v.players.map(p => [p.pid, p]));
    const awards = end ? v.awards.filter(a => byPid.has(a.pid)) : [];
    const drawnAwards = fill($('awards'), awards.map(a => `<li><span class="award-title">${esc(AWARDS[a.kind])}</span>
      <span class="award-who"><span class="name p${byPid.get(a.pid).colour}">${esc(byPid.get(a.pid).name)}</span>${P.awardDetail(a) ? `<span class="award-detail num">${esc(P.awardDetail(a))}</span>` : ''}</span></li>`).join(''));
    $('awards').hidden = !awards.length;
    $('s-board').classList.toggle('awarded', awards.length > 0);
    if (!end) return;
    // The final scores come in from the bottom, the winner last. Timed from when
    // the game ended, so a TV that reloads part way picks up where it was.
    const f = P.finale(v.players.length);
    const gone = P.now() - (v.at || P.now());
    if (drawn) [...$('standings').children].forEach((li, k) => { li.style.animationDelay = `${f.at(k, v.players[k].place === 1) - gone}ms`; });
    if (drawnAwards) for (const li of $('awards').children) li.style.animationDelay = `${f.done - gone}ms`;
    // Set once per game: changing it while it runs would bring the buttons in early.
    if ($('end-actions')._at !== v.at) { $('end-actions')._at = v.at; $('end-actions').style.animationDelay = `${f.done - gone}ms`; }
    clearTimeout(fanfare);
    if (arrived && f.winnerAt - gone > -500) fanfare = setTimeout(() => { if (view?.phase === 'end') play('end'); }, Math.max(0, f.winnerAt - gone));
  }

  // ---------- sound ----------
  let audio = null;
  function play(kind) {
    if (!sound) return;
    try {
      audio ||= new AudioContext();
      if (audio.state === 'suspended') audio.resume();
      const notes = { join: [[660, 0, .08]], tick: [[880, 0, .05]], intro: [[523, 0, .1], [784, .1, .14]], reveal: [[659, 0, .12], [988, .12, .2]], end: [[523, 0, .12], [659, .12, .12], [784, .24, .12], [1047, .36, .3]] }[kind];
      const t0 = audio.currentTime;
      for (const [freq, at, len] of notes) {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'triangle';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(kind === 'tick' ? 0.05 : 0.12, t0 + at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
        o.connect(g).connect(audio.destination);
        o.start(t0 + at);
        o.stop(t0 + at + len + 0.02);
      }
    } catch {}
  }
  const soundLabel = () => { $('c-sound').textContent = sound ? 'Sound on' : 'Sound off'; };

  // ---------- controls ----------
  function settings(change) {
    const s = { ...view.settings, ...change };
    send({ t: 'settings', count: s.count, cats: s.cats });
  }

  function start() {
    if (!view || view.phase !== 'lobby' || !view.players.length) return;
    play('join');
    if (trouble) { trouble = ''; render(view); }
    send({ t: 'start', avoid: store.get(ASKED, []) });
  }

  $('lengths').addEventListener('click', e => {
    const b = e.target.closest('[data-len]');
    if (b) settings({ count: Number(b.dataset.len) });
  });
  for (const id of ['cats', 'packs']) $(id).addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    const cats = b && P.toggle(view.settings.cats, b.dataset.cat);
    if (cats) settings({ cats });
  });
  $('lobby-players').addEventListener('click', e => {
    const b = e.target.closest('[data-pid]');
    if (!b) return;
    const p = view.players.find(x => x.pid === Number(b.dataset.pid));
    if (p && confirm(`Remove ${p.name} from the room?`)) send({ t: 'kick', pid: p.pid });
  });
  $('start').addEventListener('click', start);
  const pause = () => { if (view) send({ t: view.paused == null ? 'pause' : 'resume' }); };
  $('c-pause').addEventListener('click', pause);
  // A skip says which screen it's for, so one that lands after the screen moved on does nothing.
  const skip = () => { if (view) send({ t: 'skip', for: `${view.game || 0}:${view.i}:${view.phase}` }); };
  $('c-skip').addEventListener('click', skip);
  $('c-end').addEventListener('click', () => { if (confirm('End this game now and show the scores?')) send({ t: 'stop' }); });
  $('again').addEventListener('click', () => send({ t: 'again' }));
  const fresh = () => { send({ t: 'close' }); if (sock) sock.close(); sock = null; store.drop(SAVED); open(); };
  $('new-room').addEventListener('click', fresh);
  $('gone-new').addEventListener('click', () => { store.drop(SAVED); open(); });
  $('wait-retry').addEventListener('click', open);
  const full = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  $('c-full').addEventListener('click', full);
  // iPhones have no full screen for pages.
  $('c-full').hidden = !document.documentElement.requestFullscreen;
  document.addEventListener('fullscreenchange', () => { $('c-full').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; });
  $('c-sound').addEventListener('click', () => { sound = !sound; store.set(SOUND, sound); soundLabel(); });
  soundLabel();

  document.addEventListener('keydown', e => {
    if (e.target.closest?.('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ' && view && view.phase !== 'lobby' && view.phase !== 'end') { e.preventDefault(); pause(); }
    else if (e.key === 'ArrowRight' && view && !['lobby', 'end'].includes(view.phase)) skip();
    else if (e.key === 'Enter' && view?.phase === 'lobby' && !e.target.closest?.('button')) start();
    else if (e.key === 'f' || e.key === 'F') full();
    else if (e.key === 'm' || e.key === 'M') { sound = !sound; store.set(SOUND, sound); soundLabel(); }
  });

  // The controls fade away while nobody touches the mouse.
  let idleTimer = null;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
  };
  for (const type of ['mousemove', 'mousedown', 'keydown', 'focusin']) document.addEventListener(type, wake, { passive: true });
  wake();

  // Keep the screen on through a game: nobody touches the computer while it runs.
  // Some browsers only allow it after a tap, so every click tries again if needed.
  let asking = false;
  async function awake() {
    if (!('wakeLock' in navigator) || lock || asking || document.hidden || !sock) return;
    asking = true;
    try { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } catch {}
    asking = false;
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) awake(); });
  document.addEventListener('click', awake);

  open();
})();
