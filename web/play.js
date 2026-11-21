// A phone in the room: join with a code and a name, then answer what's on the TV.
(function () {
  const $ = id => document.getElementById(id);
  const { CATS, GENERAL, PACKS, LETTERS, KINDS, AWARDS, esc, ordinal, plural, thousands } = P;
  const NAME = 'parlour.name', TOKEN = 'parlour.token.', FACE = 'parlour.face';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  let code = null, token = null, sock = null, view = null;
  let name = store.get(NAME) || '';
  let stageKey = '';       // what the stage was built for
  let draft = null;        // a number or order answer still being made
  let sent = null;         // what this phone sent for the current question
  let sentFor = null;      // which game and question that was, as "game:i"
  let sentAt = 0;          // when, on the room's clock
  let renamed = false;     // a new name to pass on once the room answers
  let renaming = false;    // the name form is open over a game in progress
  let resent = false;      // an answer sent again after the room missed it
  let confirmTimer = null; // waits for the room to show the answer back
  let endTimer = null;     // holds the final result back while the TV reveals the scores
  let typing = false;      // they asked to type a room code rather than use the one in the link
  let lobbyShape = '';     // which lobby is drawn, so a select open on it isn't redrawn away
  let pending = null;      // settings sent from here that the room hasn't shown back yet
  let pendingTimer = null;
  let trouble = '';        // why Start did nothing, shown under the button until the next try

  let freshAsk = false;    // Start fresh was pressed and is asking whether they mean it
  let endAsk = false;      // End was pressed without being held (a keyboard, a screen reader) and is asking

  const LETTER_RE = /[^BCDFGHJKLMNPQRSTVWXZ]/g;

  // ---------- characters ----------
  // faces.js draws them. A page without it (cached from before there were any, or the file
  // never came) has none: no picker, nothing sent, and everything else as it was.
  const F = window.Faces && Array.isArray(window.Faces.ids) && window.Faces.ids.length ? window.Faces : null;
  let taken = new Set();   // the ones others in the room have, as far as this phone has heard
  let roomTakes = false;   // the room has said which are taken: so it is one that has characters
  const anyFace = () => { const free = F.ids.filter(id => !taken.has(id)); const from = free.length ? free : F.ids; return from[Math.floor(Math.random() * from.length)]; };
  // The one from last time, or one at random, so nobody has to choose.
  let face = !F ? null : F.ids.includes(store.get(FACE)) ? store.get(FACE) : anyFace();
  const hi = () => ({ t: 'join', name, ...(face ? { face } : {}) });
  // The tiles of a picker: `mine` marked, the ones in `gone` (somebody else's) not to be had.
  const tiles = (mine, gone) => F.ids.map(id => {
    const out = gone.has(id) && id !== mine;
    return `<button type="button" class="tile${out ? ' taken' : ''}" data-face="${esc(id)}" aria-pressed="${id === mine}"${out ? ' aria-disabled="true"' : ''} aria-label="${esc(F.name(id))}${out ? ', taken' : ''}">${F.svg(id)}</button>`;
  }).join('');
  const setTiles = (list, html) => { if (list._html !== html) { list._html = html; list.innerHTML = html; } };
  // The picker on the join screen. `find`: bring the chosen one into view, inside the picker's own scroll.
  function drawFaces(find = false) {
    const box = $('f-faces-field'), list = $('f-faces');
    if (!box || !list) return;
    box.hidden = !F || renaming || !roomTakes;
    if (box.hidden) return;
    setTiles(list, tiles(face, taken));
    const on = find && list.querySelector('[aria-pressed="true"]');
    if (on && (on.offsetTop < list.scrollTop || on.offsetTop + on.offsetHeight > list.scrollTop + list.clientHeight)) list.scrollTop = on.offsetTop - (list.clientHeight - on.offsetHeight) / 2;
  }
  // What the room says is taken. An older room doesn't say, and has no characters: no picker
  // for it, rather than one that does nothing. One taken since it was picked here gives way
  // to another; the room would do the same.
  function heard(info) {
    if (!F || !info || !info.open) return;
    roomTakes = Array.isArray(info.faces);
    taken = new Set(roomTakes ? info.faces : []);
    if (taken.has(face)) face = anyFace();
    if (!$('s-join').hidden) drawFaces(true);
  }
  const seeTaken = c => { if (F && c && c.length === 4) fetch(`/api/rooms/${c}`, { cache: 'no-store' }).then(r => r.json()).then(heard).catch(() => {}); };
  $('f-faces')?.addEventListener('click', e => {
    const b = e.target.closest('[data-face]');
    if (!b || b.classList.contains('taken')) return;
    face = b.dataset.face;
    drawFaces();
  });
  // Another character from the lobby or the final scores, in a room that takes one (it says
  // so by keeping rounds: the two came together). The sheet shows who has what as it changes.
  const canFace = v => !!F && !!v.rounds && !!$('faces') && (v.phase === 'lobby' || v.phase === 'end');
  function fillFaces() {
    const me = meOf(view);
    if (!me) return;
    setTiles($('faces-list'), tiles(me.face, new Set(view.players.filter(p => p.pid !== me.pid && p.face).map(p => p.face))));
  }
  $('faces-list')?.addEventListener('click', e => {
    const b = e.target.closest('[data-face]');
    if (!b || b.classList.contains('taken') || !view || !sock) return;
    face = b.dataset.face;
    store.set(FACE, face);
    sock.send({ t: 'face', face });
    $('faces').close();
  });
  $('faces-done')?.addEventListener('click', () => $('faces').close());
  // Handing the remote over, from the lobby or the final scores: the holder picks who from a
  // list of the others whose phones are here. Only in a room that says it takes it (`hand`).
  const canHand = v => !!v.hand && !!$('hand') && (v.phase === 'lobby' || v.phase === 'end') && !!v.me && v.remote === v.me.pid && v.players.some(p => p.pid !== v.me.pid && p.online);
  function fillHand() {
    const others = view.players.filter(p => p.pid !== view.me.pid && p.online).sort((a, b) => a.pid - b.pid);
    setTiles($('hand-list'), others.map(p => `<button type="button" class="who p${p.colour}" data-hand="${p.pid}">${P.face?.(p) || '<span class="face none"></span>'}<span class="pname">${esc(p.name)}</span></button>`).join(''));
  }
  // Names in full: one too wide for its tile is set smaller, by itself. (Once the sheet is open: nothing has a width before.)
  function fitHand() {
    for (const name of $('hand-list').querySelectorAll('.pname')) {
      name.style.fontSize = '';
      for (let k = 1, tries = 0; name.scrollWidth > name.clientWidth && tries < 6; tries++) {
        k *= Math.min(.97, (name.clientWidth - .5) / name.scrollWidth);
        name.style.fontSize = `${k.toFixed(3)}em`;
      }
    }
  }
  addEventListener('resize', () => { if ($('hand')?.open) fitHand(); });
  $('hand-list')?.addEventListener('click', e => {
    const b = e.target.closest('[data-hand]');
    if (!b || !view || !sock) return;
    sock.send({ t: 'hand', pid: Number(b.dataset.hand) });
    $('hand').close();
  });
  $('hand-done')?.addEventListener('click', () => $('hand').close());
  $('hand')?.addEventListener('click', e => { if (e.target === $('hand')) $('hand').close(); });
  // A name in its colour with its character, for a line of words.
  const whoIs = p => `${P.face?.(p) || ''}<span class="pname p${p.colour}">${esc(p.name)}</span>`;
  $('faces')?.addEventListener('click', e => { if (e.target === $('faces')) $('faces').close(); });

  // ---------- joining ----------
  // `still`: nothing is focused, so no keyboard comes up unasked.
  function showJoin(error = '', still = false) {
    $('s-join').hidden = false;
    $('s-play').hidden = true;
    $('s-gone').hidden = true;
    $('f-code').value = code || $('f-code').value;
    $('f-name').value = name;
    $('f-error').textContent = error;
    $('f-go').disabled = false;
    $('f-go').textContent = renaming ? 'Save' : 'Join';
    $('f-cancel').hidden = !renaming;
    // A code from the link is shown as a line; the keyboard only comes up when there's a code to type.
    $('f-room').hidden = renaming || !code || typing;
    $('f-room-code').textContent = code || '';
    $('f-code-field').hidden = renaming || (!!code && !typing);
    // Changing your name is asking to type; an empty code is the first thing to fill in.
    drawFaces(true);
    if (!renaming) seeTaken(code);
    if (renaming) $('f-name').focus();
    else if (!still && !code && $('f-code').value.length < 4) $('f-code').focus();
  }

  $('f-cancel').addEventListener('click', () => { renaming = false; if (view) render(); });
  $('f-room').addEventListener('click', () => {
    typing = true;
    $('f-room').hidden = true;
    $('f-code-field').hidden = false;
    $('f-code').select();
  });

  $('f-code').addEventListener('input', e => {
    const v = e.target.value.toUpperCase().replace(LETTER_RE, '').slice(0, 4);
    if (v !== e.target.value) e.target.value = v;
    if (v.length === 4 && document.activeElement === e.target) $('f-name').focus();
    if (v.length === 4) seeTaken(v);
  });

  $('s-join').addEventListener('submit', async e => {
    e.preventDefault();
    const c = $('f-code').value.toUpperCase();
    const n = $('f-name').value.replace(/\s+/g, ' ').trim();
    if (c.length !== 4) return showError('Enter the four-letter code from the TV.', 'f-code');
    if (!n) return showError('Enter your name.', 'f-name');
    if (renaming && c === code && sock) {
      // Already in this room: just pass the new name on.
      renaming = false;
      name = n;
      store.set(NAME, n);
      sock.send(hi());
      if (view) render();
      return;
    }
    renaming = false;
    $('f-go').disabled = true;
    $('f-error').textContent = '';
    try {
      const info = await (await fetch(`/api/rooms/${c}`, { cache: 'no-store' })).json();
      // A full room isn't turned away here: the room may let this name take over a player
      // of that name left offline, and says so itself if not.
      if (!info.open) return showError('No room with that code. Check the TV.', 'f-code');
      heard(info);
    } catch {
      return showError('Can’t reach the game. Check your connection.');
    }
    name = n;
    renamed = true;
    store.set(NAME, n);
    if (face) store.set(FACE, face);
    enter(c);
  });

  function showError(msg, field) {
    $('f-error').textContent = msg;
    $('f-go').disabled = false;
    // A wrong code from the link: open it up to fix.
    if (field === 'f-code') { typing = true; $('f-room').hidden = true; $('f-code-field').hidden = false; }
    if (field) $(field).focus();
  }

  function newToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function enter(c) {
    if (sock) sock.close();
    code = c;
    token = store.get(TOKEN + c) || newToken();
    store.set(TOKEN + c, token);
    if (location.pathname !== '/' + c) history.replaceState(null, '', '/' + c);
    view = null;
    stageKey = '';
    lobbyShape = '';
    sock = P.connect(() => P.wsUrl(`/api/rooms/${code}/ws?role=player&token=${token}`), {
      onMessage,
      onState: s => {
        $('offline').hidden = s !== 'down';
        // A new socket counts as looking at the phone until told otherwise.
        if (s === 'open' && document.hidden) sock.send({ t: 'away' });
        if (s === 'closed') return gone('That room has closed.');
        if (s === 'down') {
          const c = code;
          fetch(`/api/rooms/${c}`, { cache: 'no-store' }).then(r => r.json()).then(info => {
            if (!info.open && c === code) gone('That room has closed.');
          }).catch(() => {});
        }
      },
    });
    awake();
  }

  // ---------- messages ----------
  function onMessage(m) {
    if (m.t === 'hello') {
      renamed = false;
      // Even when full: see the note where the code is checked.
      if (name) sock.send(hi());
      else showJoin();
      return;
    }
    if (m.t === 'error') {
      sock.close();
      return showJoin(m.why === 'full' ? 'That room is full.' : 'Enter your name.');
    }
    if (m.t === 'gone') {
      // Typing the code in again joins afresh, so a removal can be undone; reconnecting can't.
      // Moved: someone joined under this name on another phone and has this place now.
      if (m.why === 'kicked' || m.why === 'moved') store.del(TOKEN + code);
      sent = null;
      if (m.why === 'moved') return gone('You’re playing on another phone.', true);
      if (m.why === 'kicked') return gone('The host took you out of the room.');
      // Most often the host has opened a new room: say where its code is.
      return gone('The host closed the room.', false, 'A new room has a new code. It’s on the TV.');
    }
    if (m.t === 'note') {
      trouble = 'Couldn’t load the questions. Try again.';
      if (view && !renaming) render();
      return;
    }
    if (m.t !== 'view' || !m.me) return;
    if (renamed) { renamed = false; sock.send(hi()); }
    P.sync(m.now);
    // The host's own packs, if this room has any: named, and listed with the topics.
    if (P.own && P.own(m.own) !== listed) topics();
    view = m;
    if (pending && m.settings && same(pending, m.settings)) donePending();
    recheck(m);
    if (!renaming) render();
  }

  // An answer this phone sent that the room doesn't have: it went missing in a
  // reconnect, or landed during a pause. Send it once more, or let them answer again.
  // Only ever for the question it was sent for: never carried on to the next one.
  function recheck(v) {
    if (sent == null) return;
    if (v.phase !== 'question' || sentFor !== `${v.game || 0}:${v.i}`) { sent = null; return; }
    if (v.mine != null) return;
    // Sent (or sent again) before the room could have had it: wait for a newer view.
    if (v.now < sentAt + 1500) return;
    if (v.paused != null) return forget();
    if (!resent) { if (sock && sock.send({ t: 'answer', v: sent, for: sentFor })) { resent = true; sentAt = P.now(); } }
    else forget();
  }
  // The room never got it: show the question again so they can answer.
  function forget() {
    sent = null;
    delete $('stage').dataset.q;
  }


  // `again`: back into this room as a new player, rather than off to another room.
  let goneAgain = false;
  // `hint`: a line under the note, when the way on is a new code to type.
  function gone(note, again = false, hint = '') {
    if (sock) sock.close();
    sock = null;
    goneAgain = again;
    $('offline').hidden = true;
    $('s-join').hidden = true;
    $('s-play').hidden = true;
    $('s-gone').hidden = false;
    $('gone-note').textContent = note;
    // (A page cached from before the hint has nowhere to put it.)
    if ($('gone-hint')) $('gone-hint').textContent = hint;
    $('gone-again').textContent = again ? 'Join as a new player' : hint ? 'Enter the new code' : 'Join another room';
  }

  // ---------- drawing ----------
  const meOf = v => v.players.find(p => p.pid === v.me.pid);

  // Puts a screen on the stage. The same screen again is left alone; a changed one is
  // drawn afresh, and told how long ago its kind of screen arrived (--since), so what
  // came in with an animation carries on from there rather than coming in again.
  let paintKey = '', paintAt = 0;
  // A little scenery for the empty lower half of a screen with nothing to press: a
  // rainbow, a sun and stripes. It takes only spare room, and none when there is none.
  const SCENE = '<div class="scene" aria-hidden="true"></div>';
  // Where next() writes what is coming.
  const NEXT = '<p class="sub num" id="next"></p>';
  // How to play, in three lines: on the waiting screen, where a first-timer has time to read.
  // (Pick one is the only kind that pays for speed: numbers go by closeness, orders by place.)
  const HOW = '<ul class="how" aria-label="How to play"><li>Answer on your phone</li><li>Pick one: faster scores more</li><li>Last question counts double</li></ul>';
  function put(html, sub = '') {
    const stage = $('stage');
    const key = `${stageKey}:${sub}`;
    if (key !== paintKey) { paintKey = key; paintAt = performance.now(); }
    if (stage._html === html) return;
    stage._html = html;
    stage.innerHTML = html;
    stage.style.setProperty('--since', `${Math.round(paintAt - performance.now())}ms`);
  }

  function render() {
    const v = view;
    const me = meOf(v);
    $('s-join').hidden = true;
    $('s-gone').hidden = true;
    $('s-play').hidden = false;
    $('me').innerHTML = me ? `${P.face?.(me) || ''}<span class="name pname p${me.colour}">${esc(me.name)}</span>` : '';
    // Whoever holds the remote: start, pause, skip and end from here.
    const boss = !!me && v.remote === me.pid;
    const playing = ['intro', 'question', 'reveal', 'board'].includes(v.phase);
    // (The remote's buttons share the line through a game: the name has it to itself then too.)
    $('me').parentElement.classList.toggle('long', !!me && (me.name.length > 9 || (boss && playing && !!ender)));
    // After the last question the score is the final one: kept back for the TV's countdown.
    const last = v.phase === 'reveal' && v.i === v.total - 1;
    $('my-score').textContent = me && v.phase !== 'lobby' && v.phase !== 'end' && !last ? thousands(me.score) : '';

    // Pause is one tap, and End is held, at any point in a game; once paused, the bar has
    // Resume and Next. Everyone else sees "Paused" in a line of text.
    $('r-pause').hidden = !boss || !playing || v.paused != null;
    if ($('r-stop')) $('r-stop').hidden = !boss || !playing || !ender;
    const bar = boss && playing && v.paused != null;
    // (Without the hold, a page or a shared.js from before it, End is in the bar and asks, as it did.)
    if (!boss || !playing || (!ender && !bar)) endAsk = false;
    $('pausebar').hidden = !bar && !endAsk;
    $('pause-do').hidden = endAsk;
    $('pause-sure').hidden = !endAsk;
    $('r-end').hidden = !!ender;
    if ((!boss || v.phase !== 'lobby') && $('topics').open) $('topics').close();
    if ($('hand')?.open) { if (canHand(v)) { fillHand(); fitHand(); } else $('hand').close(); }
    if ($('faces')?.open) { if (canFace(v)) fillFaces(); else $('faces').close(); }
    if (v.phase !== 'end') freshAsk = false;
    clearTimeout(endTimer);
    clearTimeout(nextTimer);

    const key = `${v.game || 0}:${v.phase}:${v.i}:${v.total}`;
    const fresh = key !== stageKey;
    if (fresh) { stageKey = key; if (v.phase === 'question') { draft = null; sent = null; resent = false; buzz(); } }

    const timer = $('timer');
    timer.hidden = v.phase !== 'question';
    if (v.phase === 'question') P.countdown(timer, null, v.until, v.limit, v.paused);
    else cancelAnimationFrame(timer._raf);

    const stage = $('stage');
    stage.className = `stage ${v.phase}`;
    if (v.phase !== 'lobby') { lobbyShape = ''; trouble = ''; }
    const held = v.paused != null && !boss ? 'Paused' : '';
    if (v.phase === 'lobby') lobby(v, me);
    else if (v.phase === 'intro') put(`<p class="kicker num">Question ${v.i + 1} of ${v.total}${held ? ' · ' + held : ''}</p><p class="headline">${esc(CATS[v.cat] || '')}</p><p class="sub">${esc(KINDS[v.kind] || '')}</p>${v.double ? '<p class="double">Last question · Double points</p>' : ''}${SCENE}`);
    else if (v.phase === 'question') question(v, fresh);
    else if (v.phase === 'reveal') { put(reveal(v, me, held)); countUp(v); if (fresh) feel(v, me); }
    else if (v.phase === 'board') put(standing(v, me, false, held));
    else if (v.phase === 'end') {
      // Not before the TV has shown the final scores.
      const wait = (v.at || 0) + P.finale(v.players.length, P.firsts ? P.firsts(v) : 1).done - P.now();
      if (wait > 0) {
        put('<p class="kicker">Final scores</p><p class="headline">Eyes on the TV</p>' + SCENE, 'wait');
        endTimer = setTimeout(() => { if (view && !renaming) render(); }, wait + 50);
      } else put(standing(v, me, true));
    }
    next();
    say(spoken(v));
    fitMe();
  }

  // The name at the top is never cut short: one too long for its line is set smaller until
  // it fits (the line keeps its height). Again when the phone turns or the font arrives.
  function fitMe() {
    const el = $('me').querySelector('.name');
    if (!el) return;
    el.style.fontSize = el.style.lineHeight = '';
    const need = el.scrollWidth, room = el.clientWidth;
    if (!room || need <= room) return;
    const k = Math.max(.4, (room - 1) / need);
    el.style.fontSize = `${k.toFixed(3)}em`;
    el.style.lineHeight = (1.15 / k).toFixed(3);
  }
  addEventListener('resize', fitMe);
  document.fonts?.ready.then(fitMe);

  // Under a result or the standings: what comes next and in how many seconds, counted from
  // the time the room gives for the end of this screen (`until`). It is a label only: it
  // moves nothing on, and says nothing while paused or if the room gave no time.
  let nextTimer = null;
  function next() {
    clearTimeout(nextTimer);
    const el = $('next'), v = view;
    if (!el || !v) return;
    const left = v.until - P.now();
    if (v.paused != null || !(v.until > 0) || left > 60000) { el.textContent = ''; return; }
    const what = v.phase === 'board' ? 'Next question' : v.i >= v.total - 1 ? 'Final scores' : 'Moving on';
    const secs = Math.ceil(left / 1000);
    const text = secs > 0 ? `${what} in ${secs}` : `${what} now`;
    if (el.textContent !== text) el.textContent = text;
    if (secs > 0) nextTimer = setTimeout(next, left - (secs - 1) * 1000 + 20);
  }

  // One short line for screen readers, since the stage is redrawn under them.
  function say(text) { if ($('say').textContent !== text) $('say').textContent = text; }
  function spoken(v) {
    const paused = v.paused != null ? ', paused' : '';
    if (v.phase === 'lobby') return 'You’re in';
    if (v.phase === 'intro' || (v.phase === 'question' && (v.mine ?? sent) == null)) return `Question ${v.i + 1} of ${v.total}, ${CATS[v.cat] || ''}${paused}`;
    if (v.phase === 'question') return 'Locked in' + paused;
    // Otherwise what the stage leads with: the verdict and points, or the place and score.
    const text = sel => $('stage').querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() || '';
    // (The points as they will be, not wherever the count has got to.)
    const points = $('pts') ? `+${thousands(Number($('pts').dataset.to))}` : '';
    return [text('.verdict'), points, text('.headline'), text('.headline + .sub')].filter(Boolean).join(', ') + paused;
  }

  // Drawn once, then filled in, so the Questions picker isn't swept away when someone joins.
  function lobby(v, me) {
    const others = v.players.length - 1;
    const boss = !!me && v.remote === me.pid;
    const shape = (boss ? 'boss' : 'player') + (canFace(v) ? ' faces' : '') + (canHand(v) ? ' hand' : '');
    const links = ['<button class="link" id="rename" type="button">Change name</button>', canFace(v) ? '<button class="link" id="reface" type="button">Change character</button>' : '', canHand(v) ? HAND : ''].filter(Boolean);
    if (lobbyShape !== shape) {
      lobbyShape = shape;
      put(`<p class="headline">You’re in</p>
        <p class="sub" id="l-how"></p>
        <p class="sub num" id="l-others"></p>
        <p class="sub num" id="l-round"></p>
        ${boss ? `<div class="spare">${HOW}${SCENE}</div><div class="card">
          <div class="row"><div class="row-hit"><span class="row-k">Questions</span><span class="row-v num" id="l-count" hidden></span>
            <div class="seg" id="l-seg" role="group" aria-label="Questions">${[10, 15, 20].map(n => `<button type="button" class="num" data-len="${n}" aria-pressed="false">${n}</button>`).join('')}</div>
            <select id="l-len" aria-label="Questions" hidden>${[10, 15, 20].map(n => `<option value="${n}">${n}</option>`).join('')}</select></div></div>
          <div class="row"><button class="row-hit" type="button" id="l-topics" aria-haspopup="dialog"><span class="row-k">Topics</span><span class="row-v" id="l-cats"></span></button></div>
        </div>
        <button class="btn primary start" type="button" data-r="start">Start the game</button>
        <p class="sub" id="l-note" role="status"></p>` : HOW + SCENE}
        ${links.length > 1 ? `<div class="links">${links.join('')}</div>` : links[0]}`, shape);
    }
    // Between rounds: which round is next, and what they take into it.
    $('l-round').textContent = v.round > 1 && me ? `Round ${v.round} is next. You have ${thousands(me.score)} points.` : '';
    // Who starts it: this phone, another with the remote, or nobody's phone at all.
    const holder = v.players.find(p => p.pid === v.remote);
    const how = boss ? 'Start when everyone’s in, here or on the TV.' : holder ? `Watch the TV. ${whoIs(holder)} has the remote and starts the game.` : 'Watch the TV. The game starts from there.';
    if ($('l-how')._html !== how) $('l-how').innerHTML = $('l-how')._html = how;
    $('l-others').textContent = others ? `${plural(others, 'other player')} here` : 'Nobody else yet';
    if (!boss) { trouble = ''; return; }
    const { count, cats } = wanted();
    $('l-count').textContent = count;
    if ($('l-len').value !== String(count)) $('l-len').value = String(count);
    for (const b of $('l-seg').children) b.setAttribute('aria-pressed', b.dataset.len === String(count));
    $('l-cats').textContent = topicsText(cats);
    ticks(cats);
    $('l-note').textContent = trouble;
  }

  const HAND = '<button class="link" id="rehand" type="button">Hand over the remote</button>';

  // What the Topics row says: none picked is the everyday mix.
  // (A shared.js from before the short names, met for a minute in a release, has no P.chip.)
  const chip = k => P.chip ? P.chip(k) : CATS[k];
  const topicsText = cats => !cats.length ? 'Everyday' : cats.length === 1 ? chip(cats[0]) || '1 topic' : `${cats.length} topics`;

  // The topic sheet: a plain checklist under the TV's headings. Same rules as the TV.
  const check = ([k, label]) => `<button type="button" class="check" data-cat="${k}" aria-pressed="false"><span>${esc(label)}</span><svg class="tick" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 10.5 4 4 8-9"/></svg></button>`;
  const mine = ([k, label]) => check([esc(k), label]).replace('class="check"', 'class="check own"');
  let listed = '';         // the host's own packs the sheet lists, first among the packs
  function topics() {
    const own = P.owned ? P.owned() : {};
    listed = Object.keys(own).join();
    const named = list => Object.keys(list).map(k => [k, chip(k)]);
    // Under the same headings as the TV's picker (a shared.js from before them has the two lists).
    $('topics-list').innerHTML = P.groups ? P.groups().map(g => `<p class="sec">${esc(g.title)}</p>` + g.keys.map(k => (g.own ? mine : check)([k, chip(k)])).join('')).join('')
      : named(GENERAL).map(check).join('') + '<p class="sec">Packs</p>' + Object.entries(own).map(mine).join('') + named(PACKS).map(check).join('');
  }
  topics();
  function ticks(cats) {
    const on = new Set(cats.length ? cats : Object.keys(GENERAL));
    for (const b of $('topics-list').querySelectorAll('[data-cat]')) b.setAttribute('aria-pressed', on.has(b.dataset.cat));
  }
  $('topics-done').addEventListener('click', () => $('topics').close());
  // A tap on the dimmed page behind closes it.
  $('topics').addEventListener('click', e => { if (e.target === $('topics')) $('topics').close(); });

  // ---------- answering ----------
  function question(v, fresh) {
    const s = v.shown;
    const stage = $('stage');
    const mine = v.mine ?? sent;
    if (mine != null) {
      stage.classList.add('locked');
      // What they sent, in the middle of the screen, stamped.
      put(`<div class="lockbox"><p class="stamp">Locked in</p>${summary(s, mine)}</div><p class="sub">${v.paused != null ? 'Paused' : 'Waiting for the others'}</p>`, 'locked');
      return;
    }
    // Which game as well as which question: the stage may still hold the last game's.
    const which = `${v.game || 0}:${v.i}`;
    if (!fresh && stage.dataset.q === which) { pausedNote(v); return; }
    stage.dataset.q = which;
    // A little rainbow over the answers, where there is room for one.
    const head = `<p class="q-where num" id="q-where"></p><h1 class="q-text${s.text.length > 90 ? ' long' : ''}" id="q-text" tabindex="-1">${esc(s.text)}</h1>`;
    const ARC = '<div class="arc" aria-hidden="true"></div>';
    // Long answers get smaller type, all four alike.
    const long = list => list.some(o => String(o).length > 15) ? ' long' : '';
    if (s.type === 'choice') {
      put(head + ARC + `<div class="choices${long(s.options)}">${s.options.map((o, i) => `<button class="choice opt-${'abcd'[i]}" data-i="${i}"><span class="letter">${LETTERS[i]}</span><span class="text">${esc(o)}</span></button>`).join('')}</div>`);
    } else if (s.type === 'number') {
      draft = draft ?? '';
      put(head + '<div class="arc flat" aria-hidden="true"></div>' + `<div class="entry"><output class="typed num" id="typed"></output>${s.unit ? `<span class="unit">${esc(s.unit)}</span>` : ''}</div>
        <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
        ${s.negative ? '<button data-k="-" aria-label="Minus">−</button>' : '<span></span>'}<button data-k="0">0</button><button data-k="back" aria-label="Delete"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5.5h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9L3 12zM12 9.5l5 5M17 9.5l-5 5"/></svg></button></div>
        <button class="btn primary lock" id="lock" disabled>Lock in</button>`);
      typed();
    } else {
      draft = draft ?? [];
      put(head + '<p class="sub">Tap them in order.</p>' + ARC + `<div class="order${long(s.items)}">${s.items.map((o, i) => `<button class="item opt-${'abcd'[i]}" data-i="${i}"><span class="pos num"></span><span class="letter">${LETTERS[i]}</span><span class="text">${esc(o)}</span></button>`).join('')}</div>
        <button class="btn primary lock" id="lock" disabled>Lock in</button>`);
      ordered();
    }
    pausedNote(v);
    // A screen reader starts at the new question. Only when focus was on the old stage or
    // nowhere, so it never takes anyone's place (and a heading brings up no keyboard).
    const at = document.activeElement;
    if (!at || at === document.body) $('q-text').focus({ preventScroll: true });
  }


  // Paused shows in the line above the question, for all but the remote (it has the bar).
  function pausedNote(v) {
    $('stage').classList.toggle('is-paused', v.paused != null);
    const me = meOf(v), boss = !!me && v.remote === me.pid;
    const where = $('q-where');
    if (where) where.innerHTML = `Question ${v.i + 1} of ${v.total} · ${esc(CATS[v.cat] || '')}${v.double ? ' · Double points' : ''}${v.paused != null && !boss ? ' · <b>Paused</b>' : ''}`;
  }

  function typed() {
    const out = $('typed');
    if (!out) return;
    const neg = draft.startsWith('-');
    const digits = draft.replace('-', '');
    out.textContent = draft === '' ? '–' : (neg ? '−' : '') + (digits ? Number(digits).toLocaleString('en-AU', { useGrouping: !view.shown.year }) : '');
    out.classList.toggle('empty', draft === '');
    out.classList.toggle('long', digits.length > 7);
    $('lock').disabled = !/\d/.test(draft);
  }

  function ordered() {
    for (const b of document.querySelectorAll('.item')) {
      const at = draft.indexOf(Number(b.dataset.i));
      b.classList.toggle('placed', at >= 0);
      b.querySelector('.pos').textContent = at >= 0 ? at + 1 : '';
    }
    $('lock').disabled = draft.length !== 4;
  }

  function answer(v) {
    if (!view || view.phase !== 'question' || view.paused != null) return;
    // Shown as locked in only once it has actually gone.
    const which = `${view.game || 0}:${view.i}`;
    if (!sock || !sock.send({ t: 'answer', v, for: which })) return;
    sent = v;
    sentFor = which;
    sentAt = P.now();
    resent = false;
    if (navigator.vibrate) navigator.vibrate(15);
    question(view, false);
    say(spoken(view));
    // A socket can look open and be dead. A ping after the answer gets a pong back on any
    // line that works, however slow the room; if not even that has come in, start a new
    // socket: its first view lets recheck() send the answer again.
    const at = Date.now();
    sock.ping();
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => {
      if (sock && sent != null && sentFor === which && view && view.mine == null && sock.heard() < at) sock.reopen();
    }, 3000);
  }

  $('stage').addEventListener('click', e => {
    if (!view) return;
    if (e.target.closest('#rename')) { renaming = true; return showJoin(); }
    if (e.target.closest('#reface')) { if (canFace(view)) { fillFaces(); $('faces').showModal(); } return; }
    if (e.target.closest('#rehand')) { if (canHand(view)) { fillHand(); $('hand').showModal(); fitHand(); } return; }
    if (e.target.closest('#fresh-ask, #fresh-no')) { freshAsk = !!e.target.closest('#fresh-ask'); return render(); }
    if (view.phase !== 'question' || view.paused != null) return;
    const s = view.shown;
    const choice = e.target.closest('.choice');
    if (choice) return answer(Number(choice.dataset.i));
    const key = e.target.closest('[data-k]');
    if (key) {
      const k = key.dataset.k;
      if (k === 'back') draft = draft.slice(0, -1);
      else if (k === '-') draft = draft.startsWith('-') ? draft.slice(1) : '-' + draft;
      else if (draft.replace('-', '').length < 10) draft = (draft.replace('-', '') === '0' ? draft.replace('0', '') : draft) + k;
      return typed();
    }
    const item = e.target.closest('.item');
    if (item) {
      const i = Number(item.dataset.i);
      const at = draft.indexOf(i);
      if (at >= 0) draft.splice(at, 1); else draft.push(i);
      return ordered();
    }
    if (e.target.closest('#lock')) {
      if (s.type === 'number' && /\d/.test(draft)) answer(Number(draft));
      if (s.type === 'order' && draft.length === 4) answer(draft.slice());
    }
  });

  // What you sent, shown back while you wait.
  function summary(s, mine) {
    if (s.type === 'choice') return `<div class="picked opt-${'abcd'[mine]}"><span class="letter">${LETTERS[mine]}</span><span class="text">${esc(s.options[mine])}</span></div>`;
    if (s.type === 'number') return `<p class="headline num">${numberText(mine)}${s.unit ? ` <span class="unit">${esc(s.unit)}</span>` : ''}</p>`;
    return `<ol class="mini-order">${mine.map(i => `<li class="opt-${'abcd'[i]}"><span class="letter">${LETTERS[i]}</span>${esc(s.items[i])}</li>`).join('')}</ol>`;
  }
  const numberText = n => (view.shown.year ? String(n) : thousands(n)).replace('-', '−');

  // ---------- results ----------
  function reveal(v, me, held) {
    const s = v.shown, r = v.reveal, mine = v.mine;
    // Joined after it was asked and didn't answer: no verdict on a question they never saw.
    if (v.late && mine == null) return `<p class="headline">${v.i < v.total - 1 ? 'Next question soon' : 'Final scores next'}</p>${held ? `<p class="sub">${held}</p>` : ''}${SCENE}`;
    const gain = me?.gain || 0;
    const single = v.double ? gain / 2 : gain;   // the verdict goes by the usual points
    let verdict, detail = '';
    if (s.type === 'choice') {
      verdict = mine == null ? 'No answer' : mine === r.key ? 'Right' : 'Wrong';
      // Wrong: what they picked, gone dark, over what it was.
      if (mine !== r.key) detail = `${mine != null && s.options[mine] != null ? `<p class="answer-label">You picked</p><div class="picked was opt-${'abcd'[mine]}"><span class="letter">${LETTERS[mine]}</span><span class="text">${esc(s.options[mine])}</span></div>` : ''}<p class="answer-label">The answer</p><div class="picked opt-${'abcd'[r.key]}"><span class="letter">${LETTERS[r.key]}</span><span class="text">${esc(r.answer)}</span></div>`;
      else if (me && r.quickest?.pid === me.pid && v.players.length > 1) detail = '<p class="sub">Quickest in the room</p>';
    } else if (s.type === 'number') {
      verdict = mine == null ? 'No answer' : mine === r.answer ? 'Spot on' : single >= 500 ? 'Close' : single > 0 ? 'Some way off' : 'Way off';
      detail = `<p class="sub">The answer: <strong class="num">${numberText(r.answer)}${s.unit ? ' ' + esc(s.unit) : ''}</strong>${mine != null && mine !== r.answer ? `<br>You said <span class="num">${numberText(mine)}</span>` : ''}</p>`;
    } else {
      const right = mine ? mine.filter((x, k) => x === r.key[k]).length : 0;
      verdict = mine == null ? 'No answer' : right === 4 ? 'All in order' : `${right} of 4 in place`;
      // The years and figures behind the order are on the TV.
      detail = `<ol class="mini-order">${r.items.map((it, k) => `<li class="opt-${'abcd'[r.key[k]]}${mine && mine[k] === r.key[k] ? ' ok' : ''}"><span class="letter">${LETTERS[r.key[k]]}</span>${esc(it.label)}</li>`).join('')}</ol>`;
    }
    const good = gain > 0;
    const place = me && v.i < v.total - 1 ? `${ordinal(me.place)} of ${v.players.length}` : '';
    // In the middle of the screen: their character on a starburst, the verdict, and the
    // points counting up (countUp, below). No points line at zero: "Wrong" or "No answer" says it.
    return `<div class="result"><div class="star ${good ? 'good' : 'bad'}">${P.face?.(me) || ''}</div>
      <p class="verdict ${good ? 'good' : 'bad'}">${verdict}</p>
      ${good ? `<p class="points num"><span id="pts" data-to="${gain}">+${thousands(gain)}</span>${v.double ? ' <span class="x2">double</span>' : ''}</p>` : ''}</div>
      ${detail}
      <p class="sub num">${[place, held].filter(Boolean).join(' · ')}</p>${NEXT}`;
  }

  // The points on a result count up from nothing, once: timed from when the result came,
  // so a redraw (or a reload) carries on from where the count was.
  let ptsKey = '', ptsAt = 0, ptsFrame = 0;
  function countUp(v) {
    cancelAnimationFrame(ptsFrame);
    if (!$('pts')) return;
    if (ptsKey !== stageKey) { ptsKey = stageKey; ptsAt = performance.now() - Math.max(0, P.now() - (v.at || P.now())); }
    let still = false;
    try { still = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
    const step = () => {
      const el = $('pts');
      if (!el) return;
      const k = still ? 1 : Math.min(1, Math.max(0, (performance.now() - ptsAt - 300) / 800));
      const text = '+' + thousands(Math.round(Number(el.dataset.to) * (1 - (1 - k) * (1 - k))));
      if (el.textContent !== text) el.textContent = text;
      if (k < 1) ptsFrame = requestAnimationFrame(step);
    };
    step();
  }
  // A result is felt as well as seen: two short buzzes for points, one long one for a wrong answer.
  function feel(v, me) {
    if (!navigator.vibrate || !me || v.late) return;
    try { if (me.gain > 0) navigator.vibrate([40, 60, 40]); else if (v.mine != null) navigator.vibrate(120); } catch {}
  }

  function standing(v, me, end, held = '') {
    if (!me) return '';
    const boss = v.remote === me.pid;
    // Whoever holds the remote, by name, when it is one of the players.
    const holder = v.players.find(p => p.pid === v.remote);
    // A room that keeps the scores from round to round has two ways on: Next round, with the
    // scores kept, and Start fresh, which is what Play again was (and, once there is more
    // than a round to lose, asks first). An older room has only Play again.
    const later = v.round > 1;
    const quiet = end ? [canFace(v) ? '<button class="link" id="reface" type="button">Change character</button>' : '', canHand(v) ? HAND : ''].filter(Boolean) : [];
    const swap = quiet.length > 1 ? `<div class="links">${quiet.join('')}</div>` : quiet.join('');
    const again = (!boss ? `<p class="sub fin">${holder ? `${whoIs(holder)} can start ${v.rounds ? 'the next round' : 'another game'}.` : `${v.rounds ? 'The next round' : 'Another game'} starts from the TV.`}</p>`
      : !v.rounds ? '<button class="btn primary again" type="button" data-r="again">Play again</button>'
      : freshAsk ? '<p class="sub fin">Everyone’s scores go back to zero.</p><button class="btn primary again" type="button" data-r="fresh">Start fresh</button><button class="btn" type="button" id="fresh-no">Cancel</button>'
      : `<button class="btn primary again" type="button" data-r="again">Next round</button><button class="btn" type="button" ${later ? 'id="fresh-ask"' : 'data-r="fresh"'}>Start fresh</button>`) + swap;
    // (The winner's is large, on a starburst.)
    const crowned = end && v.players.length > 1 && me.place === 1 && !v.players.every(p => !p.score);
    const hero = P.face?.(me) ? `<div class="hero${crowned ? ' won' : ''}">${P.face(me)}</div>` : '';
    // Joined too late to play any of this game: no result of theirs to show.
    if (end && v.played === false) return `<p class="headline">Next game soon</p>${SCENE}${again}`;
    const top = v.players.length > 1 && me.place === 1;
    // A game nobody scored in has no winner (and no "1st" for everyone).
    const nil = end && v.players.every(p => !p.score);
    const ahead = v.players.filter(p => p.place < me.place).pop();
    const moved = me.moved ? `<p class="sub moved ${me.moved > 0 ? 'rise' : 'fall'}${crowned ? ' mid' : ''}">${me.moved > 0 ? 'Up' : 'Down'} ${plural(Math.abs(me.moved), 'place')}</p>` : '';
    const mine = end ? (v.awards || []).filter(a => a.pid === me.pid) : [];
    const mid = crowned ? ' mid' : '';
    return `${hero}<p class="kicker${mid}">${end ? (later ? `Round ${v.round} · Final` : 'Final') : `After ${v.i + 1} of ${v.total}${held ? ' · ' + held : ''}`}</p>
      <p class="headline num${crowned ? ' won' : ''}">${nil ? 'Nobody scored' : end && top ? 'You won' : ordinal(me.place)}</p>
      <p class="sub num${mid}">${thousands(me.score)} points${end && later && me.pts != null ? `, ${thousands(me.pts)} this round` : ''}${!end && ahead ? `, ${thousands(ahead.score - me.score)} behind ${esc(ahead.name)}` : ''}</p>
      ${moved}${end ? '' : NEXT}
      ${mine.map(a => `<p class="award"><i class="rosette" aria-hidden="true"></i><strong>${esc(AWARDS[a.kind])}</strong>${P.awardDetail(a) ? `<span class="num">${esc(P.awardDetail(a))}</span>` : ''}</p>`).join('')}
      ${SCENE}${end ? again : ''}`;
  }

  // ---------- the remote ----------
  // Settings changed here count from what was last sent, not the last view, so quick taps
  // on a slow link build on each other instead of undoing each other.
  const wanted = () => pending || view.settings;
  const same = (a, b) => a.count === b.count && a.cats.join() === b.cats.join();
  function donePending() { pending = null; clearTimeout(pendingTimer); }
  function settings(count, cats) {
    pending = { count, cats };
    clearTimeout(pendingTimer);
    // The room has the last word: if it never echoes these back, show what it has.
    pendingTimer = setTimeout(() => { pending = null; if (view && !renaming) render(); }, 4000);
    sock.send({ t: 'settings', count, cats });
    if (view.phase === 'lobby') lobby(view, meOf(view));
  }
  document.addEventListener('click', e => {
    if (!view || !sock) return;
    const cat = e.target.closest('[data-cat]');
    if (cat) {
      const cats = P.toggle(wanted().cats, cat.dataset.cat);
      if (cats) settings(wanted().count, cats);
      return;
    }
    if (e.target.closest('#l-topics')) return $('topics').showModal();
    // The Questions switch sets the unseen select, which is still what is read.
    const len = e.target.closest('#l-seg [data-len]');
    if (len) {
      const sel = $('l-len');
      if (sel.value !== len.dataset.len) { sel.value = len.dataset.len; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      return;
    }
    const r = e.target.closest('[data-r]');
    if (!r) return;
    let t = r.dataset.r;
    if (t === 'pause' && view.paused != null) t = 'resume';
    if (t === 'start' && trouble) { trouble = ''; render(); }
    // A skip says which screen it's for, so one that lands after the screen moved on does nothing.
    sock.send(t === 'skip' ? { t, for: `${view.game || 0}:${view.i}:${view.phase}` } : { t });
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'l-len' && view && sock) settings(Number(e.target.value), wanted().cats);
  });
  // Focus rings for the keyboard only: a tapped row shouldn't stay ringed.
  addEventListener('keydown', () => document.documentElement.classList.add('kbd'), true);
  addEventListener('pointerdown', () => document.documentElement.classList.remove('kbd'), true);
  // End is held, not tapped: 1.2 s with a finger on it, a fill sweeping across, and the game
  // ends with nothing more asked; let go early and it says "Hold to end". A press that came
  // without a finger at all (a keyboard, a screen reader) asks in the bar instead, as End
  // used to; so does the bar's own End on a page from before the hold.
  const askEnd = on => { endAsk = on; if (view && !renaming) render(); };
  const ender = P.hold && $('r-stop') ? P.hold($('r-stop'), { ms: 1200, hint: 'Hold to end', done: () => { if (view && sock && !$('r-stop').hidden) sock.send({ t: 'stop' }); }, other: () => askEnd(true) }) : null;
  $('r-end').addEventListener('click', () => askEnd(true));
  $('r-keep').addEventListener('click', () => askEnd(false));

  // ---------- phone niceties ----------
  function buzz() { if (navigator.vibrate) navigator.vibrate(30); }

  let lock = null;
  async function awake() {
    try { if ('wakeLock' in navigator && !lock && !document.hidden) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } } catch {}
  }
  // A locked phone or one in a pocket: the room needn't wait for its answer.
  document.addEventListener('visibilitychange', () => {
    if (!sock) return;
    sock.send({ t: document.hidden ? 'away' : 'back' });
    if (!document.hidden) awake();
  });

  $('gone-again').addEventListener('click', () => {
    if (goneAgain) return showJoin();
    // The old code goes from the box (it is full, so a new one couldn't be typed over it).
    code = null; typing = true; history.replaceState(null, '', '/'); $('f-code').value = ''; showJoin('', true);
  });
  $('host-link').textContent = location.host;

  // ---------- start ----------
  const fromPath = location.pathname.slice(1).toUpperCase();
  if (/^[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(fromPath)) {
    code = fromPath;
    // Back in a room this phone was already in: straight to the game.
    if (store.get(TOKEN + code) && name) enter(code);
    else showJoin();
  } else {
    showJoin();
  }
})();
