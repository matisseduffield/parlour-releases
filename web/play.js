// A phone in the room: join with a code and a name, then answer what's on the TV.
(function () {
  const $ = id => document.getElementById(id);
  const { CATS, GENERAL, PACKS, LETTERS, KINDS, AWARDS, esc, ordinal, plural, thousands } = P;
  const NAME = 'parlour.name', TOKEN = 'parlour.token.';
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

  const LETTER_RE = /[^BCDFGHJKLMNPQRSTVWXZ]/g;

  // ---------- joining ----------
  function showJoin(error = '') {
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
    if (renaming) $('f-name').focus();
    else if (!code && $('f-code').value.length < 4) $('f-code').focus();
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
      sock.send({ t: 'join', name });
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
    } catch {
      return showError('Can’t reach the game. Check your connection.');
    }
    name = n;
    renamed = true;
    store.set(NAME, n);
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
      if (name) sock.send({ t: 'join', name });
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
      return gone(m.why === 'kicked' ? 'The host took you out of the room.' : 'The host closed the room.');
    }
    if (m.t === 'note') {
      trouble = 'Couldn’t load the questions. Try again.';
      if (view && !renaming) render();
      return;
    }
    if (m.t !== 'view' || !m.me) return;
    if (renamed) { renamed = false; sock.send({ t: 'join', name }); }
    P.sync(m.now);
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
  function gone(note, again = false) {
    if (sock) sock.close();
    sock = null;
    goneAgain = again;
    $('offline').hidden = true;
    $('s-join').hidden = true;
    $('s-play').hidden = true;
    $('s-gone').hidden = false;
    $('gone-note').textContent = note;
    $('gone-again').textContent = again ? 'Join as a new player' : 'Join another room';
  }

  // ---------- drawing ----------
  const meOf = v => v.players.find(p => p.pid === v.me.pid);

  function render() {
    const v = view;
    const me = meOf(v);
    $('s-join').hidden = true;
    $('s-gone').hidden = true;
    $('s-play').hidden = false;
    $('me').innerHTML = me ? `<span class="name pname p${me.colour}">${esc(me.name)}</span>` : '';
    // After the last question the score is the final one: kept back for the TV's countdown.
    const last = v.phase === 'reveal' && v.i === v.total - 1;
    $('my-score').textContent = me && v.phase !== 'lobby' && v.phase !== 'end' && !last ? thousands(me.score) : '';

    // The first player in holds the remote: start, pause, skip and end from here.
    const boss = !!me && v.remote === me.pid;
    const playing = ['intro', 'question', 'reveal', 'board'].includes(v.phase);
    // Pause is one tap; once paused, the bar has the rest. Everyone else sees "Paused" in a line of text.
    $('r-pause').hidden = !boss || !playing || v.paused != null;
    const bar = boss && playing && v.paused != null;
    if (!bar) sure(false);
    $('pausebar').hidden = !bar;
    if ((!boss || v.phase !== 'lobby') && $('topics').open) $('topics').close();
    clearTimeout(endTimer);

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
    else if (v.phase === 'intro') stage.innerHTML = `<p class="kicker num">${v.i + 1} of ${v.total}${held ? ' · ' + held : ''}</p><p class="headline">${esc(CATS[v.cat] || '')}</p><p class="sub">${esc(KINDS[v.kind] || '')}</p>${v.double ? '<p class="double">Last question · Double points</p>' : ''}`;
    else if (v.phase === 'question') question(v, fresh);
    else if (v.phase === 'reveal') stage.innerHTML = reveal(v, me, held);
    else if (v.phase === 'board') stage.innerHTML = standing(v, me, false, held);
    else if (v.phase === 'end') {
      // Not before the TV has shown the final scores.
      const wait = (v.at || 0) + P.finale(v.players.length).done - P.now();
      if (wait > 0) {
        stage.innerHTML = '<p class="kicker">Final scores</p><p class="headline">Eyes on the TV</p>';
        endTimer = setTimeout(() => { if (view && !renaming) render(); }, wait + 50);
      } else stage.innerHTML = standing(v, me, true);
    }
    say(spoken(v));
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
    return [text('.verdict'), text('.points'), text('.headline'), text('.headline + .sub')].filter(Boolean).join(', ') + paused;
  }

  // Drawn once, then filled in, so the Questions picker isn't swept away when someone joins.
  function lobby(v, me) {
    const others = v.players.length - 1;
    const boss = !!me && v.remote === me.pid;
    const shape = boss ? 'boss' : 'player';
    if (lobbyShape !== shape) {
      lobbyShape = shape;
      $('stage').innerHTML = `<p class="headline">You’re in</p>
        <p class="sub">${boss ? 'Start when everyone’s in, here or on the TV.' : 'Watch the TV. The game starts when the host is ready.'}</p>
        <p class="sub num" id="l-others"></p>
        ${boss ? `<div class="card">
          <div class="row"><label class="row-hit"><span class="row-k">Questions</span><span class="row-v num" id="l-count"></span>
            <select class="over" id="l-len" aria-label="Questions">${[10, 15, 20].map(n => `<option value="${n}">${n}</option>`).join('')}</select></label></div>
          <div class="row"><button class="row-hit" type="button" id="l-topics" aria-haspopup="dialog"><span class="row-k">Topics</span><span class="row-v" id="l-cats"></span></button></div>
        </div>
        <button class="btn primary start" type="button" data-r="start">Start the game</button>
        <p class="sub" id="l-note" role="status"></p>` : ''}
        <button class="link" id="rename" type="button">Change name</button>`;
    }
    $('l-others').textContent = others ? `${plural(others, 'other player')} here` : 'Nobody else yet';
    if (!boss) { trouble = ''; return; }
    const { count, cats } = wanted();
    $('l-count').textContent = count;
    if ($('l-len').value !== String(count)) $('l-len').value = String(count);
    $('l-cats').textContent = topicsText(cats);
    ticks(cats);
    $('l-note').textContent = trouble;
  }

  // What the Topics row says: none picked is the everyday mix.
  const topicsText = cats => !cats.length ? 'Everyday' : cats.length === 1 ? CATS[cats[0]] || '1 topic' : `${cats.length} topics`;

  // The topic sheet: a plain checklist, everyday topics then packs. Same rules as the TV.
  const check = ([k, label]) => `<button type="button" class="check" data-cat="${k}" aria-pressed="false"><span>${esc(label)}</span><i aria-hidden="true"></i></button>`;
  $('topics-list').innerHTML = Object.entries(GENERAL).map(check).join('') + '<p class="sec">Packs</p>' + Object.entries(PACKS).map(check).join('');
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
      stage.innerHTML = `<p class="kicker">Locked in</p>${summary(s, mine)}<p class="sub">${v.paused != null ? 'Paused' : 'Waiting for the others'}</p>`;
      return;
    }
    // Which game as well as which question: the stage may still hold the last game's.
    const which = `${v.game || 0}:${v.i}`;
    if (!fresh && stage.dataset.q === which) { pausedNote(v); return; }
    stage.dataset.q = which;
    const head = `<p class="q-where num" id="q-where"></p><h1 class="q-text${s.text.length > 90 ? ' long' : ''}" id="q-text" tabindex="-1">${esc(s.text)}</h1>`;
    if (s.type === 'choice') {
      stage.innerHTML = head + `<div class="choices">${s.options.map((o, i) => `<button class="choice opt-${'abcd'[i]}" data-i="${i}"><span class="letter">${LETTERS[i]}</span><span class="text">${esc(o)}</span></button>`).join('')}</div>`;
    } else if (s.type === 'number') {
      draft = draft ?? '';
      stage.innerHTML = head + `<div class="entry"><output class="typed num" id="typed"></output>${s.unit ? `<span class="unit">${esc(s.unit)}</span>` : ''}</div>
        <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
        ${s.negative ? '<button data-k="-" aria-label="Minus">−</button>' : '<span></span>'}<button data-k="0">0</button><button data-k="back" aria-label="Delete">⌫</button></div>
        <button class="btn primary lock" id="lock" disabled>Lock in</button>`;
      typed();
    } else {
      draft = draft ?? [];
      stage.innerHTML = head + `<p class="sub">Tap them in order.</p><div class="order">${s.items.map((o, i) => `<button class="item opt-${'abcd'[i]}" data-i="${i}"><span class="pos num"></span><span class="letter">${LETTERS[i]}</span><span class="text">${esc(o)}</span></button>`).join('')}</div>
        <button class="btn primary lock" id="lock" disabled>Lock in</button>`;
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
    if (where) where.innerHTML = `${v.i + 1} of ${v.total} · ${esc(CATS[v.cat] || '')}${v.double ? ' · Double points' : ''}${v.paused != null && !boss ? ' · <b>Paused</b>' : ''}`;
  }

  function typed() {
    const out = $('typed');
    if (!out) return;
    const neg = draft.startsWith('-');
    const digits = draft.replace('-', '');
    out.textContent = draft === '' ? '–' : (neg ? '−' : '') + (digits ? Number(digits).toLocaleString('en-AU', { useGrouping: !view.shown.year }) : '');
    out.classList.toggle('empty', draft === '');
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
    if (v.late && mine == null) return `<p class="headline">${v.i < v.total - 1 ? 'Next question soon' : 'Final scores next'}</p>${held ? `<p class="sub">${held}</p>` : ''}`;
    const gain = me?.gain || 0;
    const single = v.double ? gain / 2 : gain;   // the verdict goes by the usual points
    let verdict, detail = '';
    if (s.type === 'choice') {
      verdict = mine == null ? 'No answer' : mine === r.key ? 'Right' : 'Wrong';
      if (mine !== r.key) detail = `<p class="answer-label">The answer</p><div class="picked opt-${'abcd'[r.key]}"><span class="letter">${LETTERS[r.key]}</span><span class="text">${esc(r.answer)}</span></div>`;
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
    // No points line at zero: "Wrong" or "No answer" says it.
    return `<p class="verdict ${good ? 'good' : 'bad'}">${verdict}</p>
      ${good ? `<p class="points num">+${thousands(gain)}${v.double ? ' <span class="x2">double</span>' : ''}</p>` : ''}
      ${detail}
      <p class="sub num">${[place, held].filter(Boolean).join(' · ')}</p>`;
  }

  function standing(v, me, end, held = '') {
    if (!me) return '';
    const boss = v.remote === me.pid;
    const again = boss ? '<button class="btn primary again" type="button" data-r="again">Play again</button>' : '<p class="sub">The host can start another game.</p>';
    // Joined too late to play any of this game: no result of theirs to show.
    if (end && v.played === false) return `<p class="headline">Next game soon</p>${again}`;
    const top = v.players.length > 1 && me.place === 1;
    const ahead = v.players.filter(p => p.place < me.place).pop();
    const moved = me.moved ? `<p class="sub moved ${me.moved > 0 ? 'rise' : 'fall'}">${me.moved > 0 ? 'Up' : 'Down'} ${plural(Math.abs(me.moved), 'place')}</p>` : '';
    const mine = end ? (v.awards || []).filter(a => a.pid === me.pid) : [];
    return `<p class="kicker">${end ? 'Final' : `After ${v.i + 1} of ${v.total}${held ? ' · ' + held : ''}`}</p>
      <p class="headline num">${end && top ? 'You won' : ordinal(me.place)}</p>
      <p class="sub num">${thousands(me.score)} points${!end && ahead ? `, ${thousands(ahead.score - me.score)} behind ${esc(ahead.name)}` : ''}</p>
      ${moved}
      ${mine.map(a => `<p class="award"><strong>${esc(AWARDS[a.kind])}</strong>${P.awardDetail(a) ? `<span class="num">${esc(P.awardDetail(a))}</span>` : ''}</p>`).join('')}
      ${end ? again : ''}`;
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
  // End game asks first, in the bar itself.
  function sure(on) { $('pause-do').hidden = on; $('pause-sure').hidden = !on; }
  $('r-end').addEventListener('click', () => sure(true));
  $('r-keep').addEventListener('click', () => sure(false));

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
    code = null; typing = true; history.replaceState(null, '', '/'); showJoin();
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
