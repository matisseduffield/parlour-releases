// The TV: opens a room, shows the way in, then runs the questions on screen.
(function () {
  const $ = id => document.getElementById(id);
  const { CATS, LETTERS, KINDS, AWARDS, esc, who, ordinal, plural, thousands } = P;
  const SAVED = 'parlour.host', ASKED = 'parlour.asked', SOUND = 'parlour.sound', PACK = 'parlour.pack';
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    drop(k) { try { localStorage.removeItem(k); } catch {} },
  };

  // The host's own pack: its key comes after the # of the link (/host#the-key), a part of an
  // address no server is sent. It is kept on this computer, so a reload or a new room still
  // has it. /host#forget drops it at once, and the room is told as soon as there is one to
  // tell (a note of that is kept too, in case this page is closed first). Whatever comes
  // after the # is taken out of the address bar, a key or not: a mistyped one is still not
  // for the TV to show.
  const FORGET = 'parlour.pack.forget', NO_PACK = 'That pack link didn’t work';
  let packNote = '';    // said quietly in the lobby when a key was shown and no pack came
  let packTimer = null;
  function keyFromLink() {
    const got = location.hash.slice(1);
    if (!got) return;
    if (got === 'forget') { store.drop(PACK); store.set(FORGET, true); packNote = ''; }
    else if (/^[A-Za-z0-9_-]{20,64}$/.test(got)) store.set(PACK, got);
    else packNote = NO_PACK;
    try { history.replaceState(null, '', location.pathname + location.search); } catch { try { location.hash = ''; } catch {} }
  }
  keyFromLink();

  let room = null;      // { code, key }
  let sock = null;
  let view = null;
  let shownKey = '';    // what's on screen, so a repeat message doesn't redraw it
  let trouble = '';     // why Start did nothing, shown by the button until the next try
  let sound = store.get(SOUND, true);
  let lock = null;           // the screen wake lock, while held

  // ---------- screens ----------
  const SCREENS = ['s-wait', 's-lobby', 's-intro', 's-q', 's-board', 's-gone'];
  let showing = '', flick = false;
  const show = id => {
    for (const s of SCREENS) $(s).hidden = s !== id;
    $('legal').hidden = id !== 's-lobby';
    if (id === showing) return;
    // A new screen: the scenery moves and the channel changes. The one wipe under two
    // names, turn about, so it runs again each time (and never on a mere redraw).
    const first = !showing;
    showing = id;
    document.body.dataset.screen = id;
    // What the scenery goes by on the standings (set again by board() when that is the screen).
    if (id !== 's-board') document.body.classList.remove('at-final', 'at-many');
    if (id !== 's-board' && $('confetti')) $('confetti').hidden = true;
    // The stripes cross the screen for the title card only; the others fade.
    document.body.classList.toggle('wiping', id === 's-intro');
    gauge();
    if (first) return;
    flick = !flick;
    document.body.classList.toggle('flick-a', flick);
    document.body.classList.toggle('flick-b', !flick);
  };

  function waiting(note, retry) {
    closePicker();
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
    // One tile a letter.
    $('code').innerHTML = [...room.code].map(c => `<b>${esc(c)}</b>`).join('');
    $('code').setAttribute('aria-label', room.code);
    drawQr(`${location.protocol}//${url}`);
    sock = P.connect(() => P.wsUrl(`/api/rooms/${room.code}/ws?role=host&key=${encodeURIComponent(room.key)}`), {
      onMessage,
      onState: s => {
        $('offline').hidden = s !== 'down';
        if (s === 'open') { shareAsked(); unlock(); awake(); }
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
    closePicker();
    if (sock) sock.close();
    sock = null;
    view = null;
    Sound?.scene(null);
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
    // Four modules of cream all round, as the standard asks: a camera across the room needs them.
    $('qr').innerHTML = `<svg viewBox="-4 -4 ${n + 8} ${n + 8}" shape-rendering="crispEdges"><rect x="-4" y="-4" width="${n + 8}" height="${n + 8}" fill="#F7E8C9"/><path d="${d}" fill="#2B160C"/></svg>`;
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
    // (A shared.js from before there were such packs, met for a minute in a release, has no P.own.)
    P.own?.(m.own);
    if (m.own) { packNote = ''; clearTimeout(packTimer); }
    const before = view;
    view = m;
    if (view.phase === 'end' && view.asked) remember(view.asked);
    if (carry) carried();
    render(before);
  }

  // A new room opened from the last one's final scores keeps its length and its topics: the
  // TV sends them on, as its settings, once the new room has shown itself. A pack of the
  // host's own can be picked only when the room has it (it is shown the key as it opens),
  // so that part is given a few seconds to arrive.
  let carry = null;
  function carried() {
    carry.by ||= Date.now() + 6000;
    if (view.phase !== 'lobby' || !view.settings || Date.now() > carry.by) { carry = null; return; }
    const has = new Set((view.own || []).map(p => p.id));
    const cats = carry.cats.filter(c => !c.startsWith('own:') || has.has(c));
    const all = cats.length === carry.cats.length;
    // Only the host's own pack was picked, and it isn't here yet: nothing to say until it is.
    if (!all && !cats.length) return;
    if (view.settings.count !== carry.count || view.settings.cats.join() !== cats.join()) send({ t: 'settings', count: carry.count, cats });
    if (all) carry = null;
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

  // Shows the room the key of the host's own pack, each time it connects (the room gives
  // the pack up when its TV has been gone a while). A room that doesn't know the key, or an
  // older one, says nothing back and plays as ever: if no pack has come in a few seconds,
  // the lobby says so in a line. A key to forget is passed on first.
  function unlock() {
    if (!room) return;
    if (store.get(FORGET, false) && send({ t: 'lock' })) store.drop(FORGET);
    const key = store.get(PACK, null);
    if (typeof key !== 'string' || !send({ t: 'unlock', key })) return;
    clearTimeout(packTimer);
    packTimer = setTimeout(() => {
      if (!view || view.own) return;
      packNote = NO_PACK;
      if (view.phase === 'lobby') render(view);
    }, 4000);
  }
  addEventListener('hashchange', () => { keyFromLink(); unlock(); if (view?.phase === 'lobby') render(view); });

  const send = msg => sock && sock.send(msg);

  // Redraws only when something on screen changed, so a phone coming or going
  // doesn't restart animations.
  const fill = (el, html) => { if (el._html === html) return false; el.innerHTML = html; el._html = html; return true; };
  let stage = '';          // the phase and question last drawn, so sounds play once

  // ---------- drawing ----------
  // Connected and looking at the phone: offline and locked phones are shown alike.
  const here = p => p.online && !p.away;
  // A player's character, to go before their name (none with a shared.js from before them).
  const face = p => P.face?.(p) || '';
  // A name with its character, where there is room for both: not in a full room's tight spots.
  // (A full room's names go without their characters: the stylesheet sees to that. A player
  // with no character has a disc of their colour where one would be.)
  const named = p => `<span class="pname p${p.colour}">${face(p) || '<span class="face none"></span>'}<span class="nm">${esc(p.name)}</span></span>`;
  // Round 2 and on, in a room that keeps the scores from round to round (an older one has no rounds).
  const later = v => v.round > 1;
  const roundTag = v => later(v) ? `Round ${v.round}` : '';

  function render(before) {
    const v = view;
    const playing = ['intro', 'question', 'reveal', 'board'].includes(v.phase);
    // The room has answered: whatever was pressed has been done (or wasn't to be).
    settle();
    // A question asked on the screen about something that is no longer so is taken away.
    if (!$('sure').hidden && sureFor && !sureFor(v)) unsure(false);
    // The topics are the lobby's to pick: the picker goes when the game starts under it.
    if (v.phase !== 'lobby') closePicker();
    if (!inGame(v)) stopKeyHold();
    $('controls').hidden = !playing;
    document.body.classList.toggle('playing', playing);
    // A question shows Paused where the seconds are; other screens in the same corner.
    $('paused').hidden = v.paused == null || v.phase === 'question' || v.phase === 'reveal';
    $('c-pause').textContent = v.paused == null ? 'Pause' : 'Resume';
    const now = `${v.phase}:${v.i}:${v.total}`;
    const arrived = now !== stage;
    stage = now;
    Sound?.scene(v, before, arrived);
    // More than eight players need the tighter layouts.
    document.body.classList.toggle('crowd', v.players.length > 8);
    if (v.phase !== 'lobby') trouble = '';
    // The sun gives way to words that reach it: the lobby says so for itself, and a long fact under an answer.
    document.body.classList.toggle('no-sun', v.phase === 'reveal' && !!v.reveal && (v.reveal.fact || '').length > 60);
    if (v.phase === 'lobby') lobby(before);
    else if (v.phase === 'intro') intro(arrived);
    else if (v.phase === 'question' || v.phase === 'reveal') ask(before);
    else board(arrived);
    home();
  }

  // Run from the keys (a television's remote), the ring is never lost when the screen
  // changes under it: it goes to the button that screen is for. Start in the lobby, Pause
  // through a game (never End), Next round at the final scores.
  let homeTimer = null;
  const HOME = ['start', 'again', 'c-pause', 'wait-retry', 'gone-new'];
  function home() {
    if (!keyed || !ringed || !$('sure').hidden || picking()) return;
    const at = document.activeElement;
    if (at && at !== document.body && reach(at)) return;
    const first = HOME.map($).find(el => el && reach(el));
    if (first) first.focus();
  }

  function lobby(before) {
    show('s-lobby');
    const v = view;
    const list = v.players.slice().sort((a, b) => a.pid - b.pid);
    $('count').textContent = list.length ? `${list.length} of 16` : '';
    // Between rounds: which round is next, and beside each name what they have so far.
    const round = $('round');
    if (round) { round.hidden = !later(v); round.textContent = roundTag(v); }
    $('lobby-empty').hidden = list.length > 0;
    const known = new Set((before?.players || []).map(p => p.pid));
    // When each new name came in. Its roll-in is marked for a moment only, and a redraw
    // in that moment carries the roll on from where it was rather than starting it again.
    const at = Date.now();
    for (const p of list) if (before && !known.has(p.pid) && !arrivals.has(p.pid)) arrivals.set(p.pid, at);
    for (const pid of [...arrivals.keys()]) if (!list.some(p => p.pid === pid)) arrivals.delete(pid);
    const rolling = p => arrivals.has(p.pid) && at - arrivals.get(p.pid) < ROLL;
    // A card gives that player the remote (or takes it back); the cross in its corner
    // removes them. Redrawing drops focus, so it goes back to the same button.
    const on = document.activeElement?.closest?.('#lobby-players button');
    const focused = on && (on.dataset.give ? `[data-give="${on.dataset.give}"]` : `[data-kick="${on.dataset.kick}"]`);
    $('lobby-players').classList.toggle('totals', later(v));
    const drawn = fill($('lobby-players'), list.map(p => {
      const holds = p.pid === v.remote;
      const title = holds ? `Take the remote back from ${p.name}` : p.online ? `Give ${p.name} the remote` : `${p.name} is offline`;
      return `<li class="p${p.colour}${rolling(p) ? ' new' : ''}" data-pid="${p.pid}"><button class="player${here(p) ? '' : ' away'}" data-give="${p.pid}"${v.give ? ` title="${esc(title)}"` : ''}>${face(p) || '<span class="face none"></span>'}<span class="name">${esc(p.name)}</span>${later(v) ? `<span class="tot num">${thousands(p.score)}</span>` : ''}${holds ? REMOTE : ''}</button><button class="drop" data-kick="${p.pid}" title="Remove ${esc(p.name)}" aria-label="Remove ${esc(p.name)}">${CROSS}</button></li>`;
    }).join(''));
    if (drawn) for (const li of $('lobby-players').querySelectorAll('li.new')) li.style.animationDelay = `${arrivals.get(Number(li.dataset.pid)) - at}ms`;
    if (drawn && focused) $('lobby-players').querySelector(focused)?.focus();
    // Who has the remote, in words, after the badge their card wears.
    const holder = list.find(p => p.pid === v.remote);
    const hint = $('give-hint');
    hint.hidden = !holder;
    fill(hint, holder ? `${REMOTE}<span>${named(holder)} has the remote</span>` : '');

    const { count, cats } = v.settings;
    // Redrawing a setting drops focus; put it back, or the next Enter would start the game.
    const had = document.activeElement?.closest?.('#lengths [data-len]');
    // Drawn again only when they change: a button that is replaced while the mouse is down on it never hears the click.
    fill($('lengths'), [10, 15, 20].map(n => `<button class="${n === count ? 'on' : ''}" data-len="${n}" aria-pressed="${n === count}">${n}</button>`).join(''));
    if (had) $('lengths').querySelector(`[data-len="${had.dataset.len}"]`)?.focus();
    // What is picked, in a tag: the everyday mix, or the first topic and how many more.
    // (A shared.js from before the picker, met for a minute in a release, has no P.summary.)
    const sum = P.summary ? P.summary(cats) : { first: cats.length ? CATS[cats[0]] || 'Topics' : 'Everyday mix', more: Math.max(0, cats.length - 1) };
    if (fill($('topics-now'), `<span class="tag"><span>${esc(sum.first)}</span></span>${sum.more ? `<span class="more num">+${sum.more} more</span>` : ''}`)) fitTag();
    if (picking()) drawPicker();
    // Once the settings are drawn: they take room from the cards.
    pack();
    $('start').disabled = !list.length;
    $('start-hint').textContent = trouble || packNote || (!list.length ? 'Waiting for a player' : '');
    // A longer word than usual: the scenery beside it makes room.
    $('start-hint').classList.toggle('long', !!(trouble || packNote));
    document.body.classList.toggle('no-sun', !!(trouble || packNote) || !list.length);
  }

  // A television's own browser: its remote has OK where a keyboard has Enter.
  const TV = /Tizen|Web0S|webOS|SMART-TV|SmartTV|BRAVIA|AFT[A-Z]|GoogleTV|Android TV|HbbTV|VIDAA|NetCast/i.test(navigator.userAgent);
  const arrivals = new Map(), ROLL = 900;

  // Who holds the remote: a small drawn remote on a badge, in the corner of their card, named for screen readers.
  const REMOTE = '<svg class="holds" viewBox="-4 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" role="img" aria-label="holds the remote"><rect x=".8" y=".8" width="8.4" height="16.4" rx="2.6"/><circle cx="5" cy="5" r="1.4" fill="currentColor" stroke="none"/><path d="M3.6 9.5h2.8M3.6 12.6h2.8"/></svg>';
  const CROSS = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m2.5 2.5 7 7M9.5 2.5l-7 7"/></svg>';

  // The players' cards. How many across goes by how many players: three for up to six,
  // four for seven and eight, five for nine and ten, four again from eleven (four rows of
  // four at sixteen). A card is as tall as its number of rows wants (CARD), or as the room
  // allows: the lobby makes room in steps and only when the cards would be squeezed for it,
  // the settings and Start a little tighter, then no how-to-play strip ('bare'), then both
  // as trim as they go ('tight'). What is in a card is sized from its height; a name too
  // long for its card is then set smaller, by itself, until all of it shows. No name is ever cut.
  const COLS = n => (n <= 6 ? 3 : n <= 8 ? 4 : n <= 10 ? 5 : 4);
  const CARD = [10, 8.2, 6.6, 4.75], CARD_TOTALS = [10.6, 9, 7.2, 4.9], NAME = [2.2, 1.9, 1.5, 1.3];
  const STEPS = [{}, { snug: true }, { snug: true, bare: true }, { snug: true, bare: true, tight: true }];
  function pack() {
    const lobby = $('s-lobby'), list = $('lobby-players'), cards = [...list.children];
    const n = cards.length, flow = flowing.matches;
    const totals = list.classList.contains('totals');
    const cols = flow ? 2 : COLS(n), rows = Math.max(1, Math.ceil(n / cols)), k = Math.min(rows, 4) - 1;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    list.style.setProperty('--cols', cols);
    // Where the page flows (the host on a phone) every card is the one size, two across.
    const ideal = flow ? (totals ? 7 : 6.2) : (totals ? CARD_TOTALS : CARD)[k];
    let h = ideal;
    for (const fit of flow || !n ? [{}] : STEPS) {
      lobby.classList.toggle('snug', !!fit.snug);
      lobby.classList.toggle('bare', !!fit.bare);
      lobby.classList.toggle('tight', !!fit.tight);
      if (flow || !n) break;
      // The list has whatever the rest of the lobby leaves it: that, shared between its rows.
      const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
      const each = (list.clientHeight - gap * (rows - 1)) / rows / rem;
      h = Math.max(3, Math.min(ideal, each));
      if (each >= ideal * .93) break;
    }
    // In a card: the character, the name under it, and between rounds the total under that.
    const tt = totals ? Math.min(1.15, Math.max(.8, h * .15)) : 0;
    const used = .8 + (tt ? tt * 1.15 + .05 : 0) + .1;
    let nm = flow ? 1.4 : cols > 4 && k === 1 ? 1.5 : NAME[k];
    // (The character keeps clear of the badge and the cross in the card's top corners, where the cards are narrow.)
    const bd = Math.min(1.6, Math.max(1.3, h * .17));
    const wide = n ? cards[0].clientWidth / rem : 9;
    let f = Math.min(h * .52, h - used - nm * 1.12, Math.max(h * .36, wide - 2 * bd - .5));
    if (f < h * .36) { f = h * .36; nm = Math.min(nm, (h - used - f) / 1.12); }
    const set = (name, v) => list.style.setProperty(name, `${v.toFixed(3)}rem`);
    set('--h', h); set('--f', f); set('--nm', nm); set('--tt', tt || 1); set('--bd', bd);
    for (const li of cards) {
      const name = li.querySelector('.name');
      if (!name) continue;
      name.style.fontSize = '';
      // (Measured by its box, not by where it is drawn: a card still rolling in is turned a little.)
      for (let size = nm, tries = 0; name.scrollWidth > name.clientWidth && tries < 6; tries++) {
        size *= Math.min(.97, (name.clientWidth - .5) / name.scrollWidth);
        name.style.fontSize = `${size.toFixed(3)}rem`;
      }
    }
  }

  // The tag that says what is picked: a long name (a pack of the host's own) is set smaller
  // until the tag, "+2 more" and Change all sit on the one line.
  function fitTag() {
    const now = $('topics-now'), row = now.parentElement, tag = now.querySelector('.tag');
    if (!tag) return;
    const text = tag.firstElementChild;
    const fits = () => row.scrollWidth <= row.clientWidth + 1 && text.scrollWidth <= text.clientWidth + 1 && text.scrollHeight <= text.clientHeight + 1;
    tag.classList.remove('two');
    shrink(now, '--tag', tag, fits, .78);
    if (fits()) return;
    // Still too long for the line: on two, the tag as wide as the row leaves it.
    tag.classList.add('two');
    shrink(now, '--tag', tag, fits, .6);
  }

  // ---------- the topic picker ----------
  // Over the lobby, from Change: every topic and pack under its heading (the groups are
  // shared.js's, the host's own pack first), a button each. Same rules as ever: P.toggle.
  // It is a step in the browser's history while open, so a remote's Back closes it.
  function picking() { return !!$('picker') && !$('picker').hidden; }
  let ownBack = 0;         // steps back in history this page took itself: nothing to do when they land
  function drawPicker() {
    const cats = view.settings.cats;
    const on = new Set(cats.length ? cats : Object.keys(P.GENERAL));
    const groups = P.groups ? P.groups() : [{ title: 'Topics', keys: Object.keys(CATS) }];
    const had = document.activeElement?.closest?.('#picker-groups [data-cat]');
    const drawn = fill($('picker-groups'), groups.map(g => `<section><h3 class="label">${esc(g.title)}</h3><div class="topics${g.own ? ' own' : ''}">${g.keys.map(k => `<button type="button" class="${on.has(k) ? 'on' : ''}" data-cat="${esc(k)}" aria-pressed="${on.has(k)}"><span>${esc(P.chip(k))}</span></button>`).join('')}</div></section>`).join(''));
    $('picker-count').textContent = `${on.size} picked`;
    if (drawn && had) [...$('picker-groups').querySelectorAll('[data-cat]')].find(b => b.dataset.cat === had.dataset.cat)?.focus();
    if (drawn) fitPicker();
  }
  // The card fits the screen: its heights step down together until it does. A name too
  // long for its button (only a pack of the host's own can be) is set smaller.
  function fitPicker() {
    const card = $('picker-card');
    card.style.removeProperty('--u');
    for (const span of card.querySelectorAll('.topics button span')) {
      span.style.fontSize = '';
      if (span.scrollWidth > span.clientWidth) span.style.fontSize = `${Math.max(.6, (span.clientWidth - 1) / span.scrollWidth).toFixed(3)}em`;
    }
    if (flowing.matches) return;
    for (let u = 1; u > .6 && card.scrollHeight > card.clientHeight + 1; u -= .04) card.style.setProperty('--u', (u - .04).toFixed(2));
  }
  function openPicker() {
    if (!view || view.phase !== 'lobby' || picking() || !$('sure').hidden) return;
    $('picker').hidden = false;
    $('picker-groups')._html = null;
    drawPicker();
    try { history.pushState({ picker: 1 }, ''); } catch {}
    // With the keys the ring starts on the first topic; with the mouse nothing is ringed.
    (keyed ? $('picker-groups').querySelector('[data-cat]') : $('picker-card'))?.focus();
  }
  // `back`: the browser has already stepped back (a remote's Back button).
  function closePicker(back) {
    if (!picking()) return;
    $('picker').hidden = true;
    if (!back) try { if (history.state && history.state.picker) { ownBack++; setTimeout(() => { ownBack = 0; }, 1000); history.back(); } } catch {}
    // The ring goes back to Change, where it came from.
    const from = $('topics-change');
    if (keyed && view?.phase === 'lobby' && from.getClientRects().length) from.focus();
    else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  }

  // The font arriving changes every name's width.
  document.fonts?.ready.then(fitAgain);

  // Whatever on screen was fitted to its room, fitted again: the window changed, or the fonts came.
  function fitAgain() {
    if (!view || !sock) return;
    if (view.phase === 'lobby') { pack(); fitTag(); if (picking()) fitPicker(); return; }
    if (view.phase === 'question' && !$('s-q').hidden) fitWho();
    if (view.phase === 'reveal' && !$('s-q').hidden) { fitGains(); fitOptions(); }
    if (view.phase === 'board' && !$('s-board').hidden) fitBoard();
    if (view.phase === 'end' && !$('s-board').hidden) { fitPods(); fitRest(); }
  }

  // Type that steps down until its box fits. `name` is the custom property the stylesheet
  // sizes it by, `probe` something drawn at that size; never below `floor` of where it began.
  function shrink(el, name, probe, fits, floor = .7) {
    el.style.removeProperty(name);
    if (!probe) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const full = parseFloat(getComputedStyle(probe).fontSize) / rem;
    for (let k = 1; k > floor + .01 && !fits();) { k -= .05; el.style.setProperty(name, `${(full * k).toFixed(3)}rem`); }
  }

  function intro(arrived) {
    show('s-intro');
    const v = view;
    fill($('intro-n'), `<span class="q-label">Question</span><b>${v.i + 1}</b><small>of ${v.total}</small>`);
    $('intro-cat').textContent = CATS[v.cat] || '';
    $('intro-cat').classList.toggle('long', (CATS[v.cat] || '').length > 16);
    $('intro-kind').textContent = KINDS[v.kind] || '';
    $('intro-double').hidden = !v.double;
  }

  function ask(before) {
    show('s-q');
    const v = view;
    const s = v.shown;
    // The game too: question 3 of this game isn't question 3 of the last one.
    const key = `${v.game || 0}:${v.i}:${v.phase}`;
    const fresh = key !== shownKey;
    shownKey = key;
    fill($('q-where'), `<span class="lab num">Question ${v.i + 1} of ${v.total}</span><b>${esc(CATS[v.cat] || '')}</b>${v.double ? '<em>Double points</em>' : ''}`);
    $('q-text').textContent = s.text;
    $('s-q').className = `screen ask t-${s.type} ph-${v.phase}${v.paused != null ? ' held' : ''}`;
    $('q-text').classList.toggle('long', s.text.length > 80);

    if (v.phase === 'question') {
      // While paused the label is ours, so no stray ticks as the views come in.
      const held = v.paused != null;
      // The flip clock shows the same seconds the countdown counts: it has no timer of its own.
      P.countdown($('q-timer'), held ? null : $('q-secs'), v.until, v.limit, v.paused, secs => { flip(secs); beat(secs); Sound?.clock(secs); });
      if (held) $('q-secs').textContent = 'Paused';
      flip(Math.ceil((held ? v.paused : Math.max(0, v.until - P.now())) / 1000));
      if (fresh) {
        fill($('q-body'), body(s));
        $('q-fact').hidden = true;
      }
      const done = v.players.filter(p => p.answered).length;
      // The names are drawn once and then only marked, so a name lights up as its answer
      // lands and the others stay as they are.
      const order = v.players.slice().sort((a, b) => a.pid - b.pid);
      fill($('q-answered'), `<span class="tally num"></span><span class="who">${order.map(p => `<span class="dot p${p.colour}">${face(p)}${esc(p.name)}</span>`).join('')}</span>`);
      const dots = $('q-answered').lastElementChild.children;
      order.forEach((p, k) => { dots[k].classList.toggle('in', !!p.answered); dots[k].classList.toggle('away', !here(p)); });
      $('q-answered').firstElementChild.textContent = `${done} of ${v.players.length} in`;
      if (fresh || $('q-answered')._fit !== order.length) { $('q-answered')._fit = order.length; fitWho(); }
    } else {
      cancelAnimationFrame($('q-timer')._raf);
      $('q-timer').firstElementChild.style.transform = 'scaleX(0)';
      $('q-secs').textContent = v.paused != null ? 'Paused' : '';
      // When this answer came up: everything in it is timed from then (see the stylesheet),
      // so that what is drawn again part way carries on rather than starting over. Each part
      // is told only as it is drawn: a delay changed under a running animation would jump it.
      // (Four answers have the beat to themselves; the other kinds start their words 0.9 s sooner.)
      if (fresh) beatAt = Math.min(P.now(), v.at || P.now());
      const since = `${Math.round(Math.min(0, beatAt - P.now())) - (s.type === 'choice' ? 0 : 900)}ms`;
      const drawn = fill($('q-body'), answer(s, v.reveal));
      if (drawn) $('q-body').style.setProperty('--since', since);
      // The wrong ones go dark one after another. (Set here, not written into the HTML: the page's policy drops a style attribute.)
      if (drawn) $('q-body').querySelectorAll('.opt.dim').forEach((li, k) => li.style.setProperty('--dim', `${k * 200}ms`));
      if (fresh) $('q-fact').style.setProperty('--since', since);
      $('q-fact').hidden = !v.reveal.fact;
      $('q-fact').textContent = v.reveal.fact;
      // A long one is set a little smaller, to stay on one line.
      $('q-fact').classList.toggle('long', v.reveal.fact.length > 82);
      $('q-fact').classList.toggle('longer', v.reveal.fact.length > 90);
      // Only who scored: a full room's zeros would wrap the row.
      const order = v.players.filter(p => p.gain > 0).sort((a, b) => b.gain - a.gain || a.pid - b.pid);
      const quick = v.reveal.quickest && v.players.find(p => p.pid === v.reveal.quickest.pid);
      if (fill($('q-answered'), `<span class="gains${order.length > 4 ? ' many' : ''}">${order.length ? order.map(p => `<span class="gain">${who(p)}<span class="num">+${thousands(p.gain)}</span></span>`).join('') : '<span class="gain none">Nobody got it</span>'}</span>${quick ? `<span class="quick">Quickest: <strong>${esc(quick.name)}</strong> <span class="num">${(v.reveal.quickest.at / 1000).toFixed(1)} s</span></span>` : ''}`)) $('q-answered').style.setProperty('--since', since);
      // Once the fact and the points below are in, so they know the room they have.
      if (drawn) { fitGains(); fitGuesses(); fitOptions(); }
    }
  }

  let beatAt = 0;          // when the answer on screen came up, on the room's clock
  // The clock beats once a second through the last five: two names, turn about, as the flaps have.
  function beat(secs) {
    const el = $('q-flip');
    if (!el) return;
    if (secs > 5 || secs < 1) { el.classList.remove('beat-a', 'beat-b'); return; }
    const a = el.classList.contains('beat-a');
    el.classList.toggle('beat-a', !a);
    el.classList.toggle('beat-b', a);
  }

  // Two names for the one flap, turn about, so a card flaps again on every change.
  function flip(secs) {
    // Not there in a page cached from before the flip clock: nothing to turn.
    const el = $('q-flip');
    if (!el) return;
    const cards = el.children, text = String(Math.max(0, Math.min(99, secs))).padStart(2, '0');
    for (let k = 0; k < 2; k++) {
      if (cards[k].textContent === text[k]) continue;
      cards[k].textContent = text[k];
      cards[k].className = cards[k].className === 'flap-a' ? 'flap-b' : 'flap-a';
    }
  }

  // Long answers get smaller type, all four alike.
  const long = list => list.some(o => String(o).length > 22) ? ' long' : '';
  const RAYS = '<svg class="burst" aria-hidden="true"><use href="#rays"/></svg>';

  function body(s) {
    if (s.type === 'choice') return `<ol class="options${long(s.options)}">${s.options.map((o, i) => `<li class="opt opt-${'abcd'[i]}"><span class="letter">${LETTERS[i]}</span><span class="text">${esc(o)}</span></li>`).join('')}</ol>`;
    if (s.type === 'number') return `<div class="guess"><svg class="handset" aria-hidden="true"><use href="#handset"/></svg><p>Type your guess on your phone${s.unit ? ` <span class="unit">(${esc(s.unit)})</span>` : ''}</p></div>`;
    return `<ol class="options items${long(s.items)}">${s.items.map((o, i) => `<li class="opt opt-${'abcd'[i]}"><span class="letter">${LETTERS[i]}</span><span class="text">${esc(o)}</span></li>`).join('')}</ol>`;
  }

  function answer(s, r) {
    const byPid = new Map(view.players.map(p => [p.pid, p]));
    const pickers = test => Object.entries(r.answers).filter(([, v]) => test(v)).map(([pid]) => byPid.get(Number(pid))).filter(Boolean);
    if (s.type === 'choice') {
      // ('names' and 'picked' say where there are names, for the stylesheet.)
      return `<ol class="options${long(s.options)}${Object.keys(r.answers).length ? ' names' : ''}">${s.options.map((o, i) => {
        const picked = pickers(v => v === i);
        return `<li class="opt opt-${'abcd'[i]} ${i === r.key ? 'right' : 'dim'}${picked.length ? ' picked' : ''}">${i === r.key ? RAYS : ''}<span class="letter">${LETTERS[i]}</span><span class="text">${esc(o)}</span>${picked.length ? `<span class="pickers">${picked.map(named).join('')}<b class="cnt num">${picked.length}</b></span>` : ''}</li>`;
      }).join('')}</ol>`;
    }
    if (s.type === 'number') {
      const unit = s.unit ? ` <span class="unit">${esc(s.unit)}</span>` : '';
      const guesses = Object.entries(r.answers).map(([pid, g]) => ({ p: byPid.get(Number(pid)), g })).filter(x => x.p)
        .sort((a, b) => Math.abs(a.g - r.answer) - Math.abs(b.g - r.answer));
      const plain = n => s.year ? String(n) : thousands(n);
      // Up to eight players, every guess is shown: up to four in one list, set larger, more
      // than that two across. A fuller room has the closest eight, or as many as the screen
      // has room for (fitGuesses); the rest are in the points below.
      const more = guesses.length - 8;
      const rows = Math.ceil(Math.min(guesses.length, 8) / 2);
      const kind = view.players.length > 8 ? '' : guesses.length > 4 ? ' two' : ' few';
      const side = k => kind !== ' two' ? '' : k < rows ? ' class="lead"' : k === rows ? ' class="top"' : '';
      return `<div class="number"><div class="answer-card">${RAYS}<p class="big-answer num">${plain(r.answer)}${unit}</p></div>
        <ol class="guesses${kind}" data-rows="${rows}" data-more="${Math.max(0, more)}">${guesses.slice(0, 8).map(({ p, g }, k) => `<li${side(k)}><span class="name p${p.colour}">${view.players.length > 8 ? '' : face(p)}${esc(p.name)}</span><span class="g num">${plain(g)}</span><span class="off num">${g === r.answer ? 'spot on' : (g > r.answer ? '+' : '−') + plain(Math.abs(g - r.answer))}</span></li>`).join('')}<li class="more"${more > 0 ? '' : ' hidden'}>and ${more} further off</li></ol></div>`;
    }
    return `<ol class="right-order">${r.items.map((it, k) => {
      const shownAt = r.key[k];
      return `<li class="opt opt-${'abcd'[shownAt]}"><span class="place num">${k + 1}</span><span class="letter">${LETTERS[shownAt]}</span><span class="text">${esc(it.label)}</span>${it.note ? `<span class="note num">${esc(it.note)}</span>` : ''}</li>`;
    }).join('')}</ol>`;
  }

  // Under a question, a full room's names keep to three lines, and under its answer the
  // points to three: the type steps down for that, so the answers above keep their room.
  function fitWho() {
    const foot = $('q-answered'), who = foot.querySelector('.who');
    foot.style.removeProperty('--dot');
    foot.style.removeProperty('--gn');
    if (!who || flowing.matches || !who.children.length) return;
    const line = () => parseFloat(getComputedStyle(who.firstElementChild).lineHeight) || 1;
    shrink(foot, '--dot', who.firstElementChild, () => who.offsetHeight <= line() * 3.4, .62);
  }
  function fitGains() {
    const foot = $('q-answered'), gains = foot.querySelector('.gains');
    foot.style.removeProperty('--dot');
    foot.style.removeProperty('--gn');
    if (!gains || flowing.matches || !gains.children.length) return;
    const name = gains.querySelector('.pname');
    if (!name) return;
    const tall = () => gains.offsetHeight > name.getBoundingClientRect().height * 3.5;
    for (let k = 1; k > .66 && tall(); k -= .04) foot.style.setProperty('--gn', (k - .04).toFixed(2));
  }

  // Fits the guesses to the space they have: names in full always, so the type steps down
  // first, and only then are the furthest guesses dropped.
  function fitGuesses() {
    const body = $('q-body'), list = body.querySelector('.guesses');
    if (!list) return;
    const more = list.querySelector('.more');
    let extra = Number(list.dataset.more);
    const rows = [...list.querySelectorAll('li:not(.more)')];
    list.style.setProperty('--rows', list.dataset.rows);
    // Too wide counts only on a TV; where the page flows the stylesheet sizes the list.
    const tv = !flowing.matches;
    const over = () => body.scrollHeight > body.clientHeight + 1 || list.scrollHeight > list.clientHeight + 1 || (tv && list.scrollWidth > list.clientWidth + 1);
    if (tv) {
      shrink(list, '--g', rows[0], () => !over(), .8);
      // Still too much: the answer itself gives a little, then the guesses a little more.
      const big = body.querySelector('.big-answer');
      if (over() && big) shrink(big, '--big', big, () => !over(), .7);
      if (over()) shrink(list, '--g', rows[0], () => !over(), .6);
    }
    while (over() && rows.length > 1) {
      rows.pop().remove();
      extra += 1;
      more.hidden = false;
      more.textContent = `and ${extra} further off`;
    }
  }
  // The answers at the reveal. The names beside an answer keep to a share of its pill, and
  // both they and the answers are set as large as fits, all four alike. A few shares are
  // tried, and the one that leaves the two largest between them is kept.
  function fitOptions() {
    const list = $('q-body').querySelector('.options');
    if (!list) return;
    const opts = [...list.children];
    list.style.removeProperty('--cap');
    list.style.removeProperty('--pk');
    const named = opts.filter(o => o.querySelector('.pickers'));
    const box = o => o.querySelector('.pickers');
    const asNames = o => { box(o).classList.remove('faces', 'only'); box(o).style.removeProperty('--fc'); };
    for (const o of opts) o.style.fontSize = '';
    for (const o of named) asNames(o);
    // Where the page flows, the stylesheet sizes them.
    if (flowing.matches) return;
    // (The last few answer sizes are for the tightest screens only: a long question and a long fact.)
    const SIZES = [2.5, 2.3, 2.1, 1.95, 1.8, 1.65, 1.5, 1.38, 1.26, 1.15, 1.05, .96, .88, .8];
    // Names are never set smaller than reads from the sofa.
    const PICKS = document.body.classList.contains('crowd') ? [1.15, 1.05] : [1.4, 1.28, 1.16, 1.05];
    const FACES = [1.5, 1.3, 1.1];
    const pad = parseFloat(getComputedStyle(opts[0]).paddingTop) * 2;
    // An answer's names: no taller than their pill, and no name broken over two lines.
    const fitsNames = o => {
      const p = box(o), line = parseFloat(getComputedStyle(p).fontSize) * 1.2;
      return p.offsetHeight <= o.clientHeight - line * .4 && [...p.querySelectorAll('.pname')].every(n => n.offsetHeight < line * 1.5);
    };
    // One whose names won't go in even at the smallest size shows their characters and how
    // many, as large as fit; and if not even those fit, how many.
    const asFaces = o => {
      const p = box(o);
      p.classList.add('faces');
      p.classList.remove('only');
      // (Measured by where each one is: what overflows a row that is packed to its right end does so unseen by scrollWidth.)
      const inside = () => { const r = p.getBoundingClientRect(); return [...p.children].every(c => { if (!c.getClientRects().length) return true; const b = c.getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1; }); };
      for (const f of FACES) { p.style.setProperty('--fc', `${f}rem`); if (p.offsetHeight <= o.clientHeight - 4 && inside()) return f; }
      p.classList.add('only');
      return 0;
    };
    // Lays the names out for one share of the pill: which answers keep names, and the largest size those take.
    const lay = cap => {
      list.style.setProperty('--cap', `${cap}%`);
      list.style.setProperty('--pk', `${PICKS[PICKS.length - 1]}rem`);
      for (const o of named) asNames(o);
      const faced = named.filter(o => !fitsNames(o));
      const fc = faced.map(asFaces);
      const keep = named.filter(o => !faced.includes(o));
      const pk = PICKS.find(size => { list.style.setProperty('--pk', `${size}rem`); return keep.every(fitsNames); }) || PICKS[PICKS.length - 1];
      list.style.setProperty('--pk', `${pk}rem`);
      return { pk, faced: faced.length, fc: fc.reduce((a, b) => a + b, 0) };
    };
    // The answers: no taller than their pill, and no word broken.
    const answers = size => {
      for (const o of opts) o.style.fontSize = `${size}rem`;
      return opts.every(o => { const t = o.querySelector('.text'); return t.offsetHeight <= o.clientHeight - pad && t.scrollWidth <= t.clientWidth + 1; });
    };
    const last = a => a[a.length - 1];
    list.classList.add('fitting');
    let best = null;
    for (const cap of named.length ? [50, 58, 42, 34, 27, 66, 74] : [50]) {
      const { pk, faced, fc } = lay(cap);
      const size = SIZES.find(answers);
      // The answer counts for twice the names, and for more again once it is getting small:
      // names are not kept at the cost of an answer nobody can read. An answer that falls
      // back on characters counts a little against its share (less, the larger they are);
      // a broken word counts most.
      const score = 2 * (size ?? 0) / SIZES[0] + pk / PICKS[0] - faced * .3 + fc / FACES[0] * .3 - Math.max(0, 1.26 - (size ?? 0)) * 3 - (size ? 0 : 8);
      if (!best || score > best.score + .001) best = { cap, size: size ?? last(SIZES), score };
    }
    list.classList.remove('fitting');
    lay(best.cap);
    for (const o of opts) o.style.fontSize = `${best.size}rem`;
  }

  // The standings between questions, set as large as the screen has room for: larger for a
  // few players than for many, and never so large that a name would have to be cut.
  function fitBoard() {
    const list = $('standings'), title = $('board-title');
    list.style.removeProperty('--bf');
    const n = list.children.length;
    if (flowing.matches || !n) return;
    const m = getComputedStyle(title);
    const foot = parseFloat(getComputedStyle($('s-board')).paddingBottom) || 0;
    const fits = () => list.scrollWidth <= list.clientWidth + 1
      && title.offsetHeight + parseFloat(m.marginTop) + parseFloat(m.marginBottom) + list.offsetHeight <= $('s-board').clientHeight - foot;
    for (let size = n > 8 ? 1.75 : n > 6 ? 1.9 : n > 4 ? 2.1 : 2.4; size > .95; size -= .08) {
      list.style.setProperty('--bf', `${size.toFixed(2)}rem`);
      if (fits()) break;
    }
  }

  // The names on the podium: each as large as its plate has room for, the whole name always.
  // The line keeps its height, so the three plates stay the same shape.
  function fitPods() {
    for (const name of $('standings').querySelectorAll('.plate .name')) {
      name.style.fontSize = name.style.lineHeight = '';
      const need = name.scrollWidth, room = name.clientWidth;
      if (!room || need <= room) continue;
      const k = Math.max(.3, (room - 1) / need);
      name.style.fontSize = `${k.toFixed(3)}em`;
      name.style.lineHeight = (1.2 / k).toFixed(3);
    }
  }

  // The list beside the podium: names in full, so its type steps down if it is too wide.
  function fitRest() {
    const list = $('standings'), rest = list.querySelector('.rest');
    if (!rest) return;
    rest.style.removeProperty('--rf');
    if (!flowing.matches) shrink(rest, '--rf', rest.querySelector('li[data-k]'), () => list.scrollWidth <= list.clientWidth + 1, .66);
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
      fitAgain();
      if (flowing.matches || !sock || $('s-q').hidden || view?.phase !== 'reveal' || view.shown?.type !== 'number') return;
      $('q-body')._html = '';
      render(view);
    }, 150);
  });

  function board(arrived) {
    show('s-board');
    const v = view;
    const end = v.phase === 'end';
    // From the second round on the title says which round, and the scores are the running totals.
    fill($('board-title'), `${later(v) ? `<small>${roundTag(v)}</small>` : ''}${end ? (v.players.length ? 'Final scores' : 'Game over') : `After ${v.i + 1} of ${v.total}`}`);
    $('s-board').classList.toggle('final', end);
    document.body.classList.toggle('at-final', end);
    document.body.classList.toggle('at-many', !end && v.players.length > 7);
    $('end-actions').hidden = !end;
    // Next round keeps the scores; Start fresh is what Play again was. A room from before
    // rounds has only the one, under its old name.
    $('again').textContent = v.rounds ? 'Next round' : 'Play again';
    if ($('fresh')) $('fresh').hidden = !v.rounds;
    // What each made this round, after their total: only once there is more than one round in it.
    const won = p => later(v) && p.pts != null ? `<span class="won num">+${thousands(p.pts)}</span>` : '';
    $('standings').classList.toggle('many', !end && v.players.length > 7);
    if (!end && $('confetti')) $('confetti').hidden = true;
    // Between questions: one list, each score straight after its name. At the end: the
    // first three on a podium and the rest listed beside it. data-k is the player's row.
    // (Between questions the score is written twice: once unseen, to keep its room, and once to count up.)
    const row = (p, k) => `<li data-k="${k}"><span class="place num">${ordinal(p.place)}</span><span class="name p${p.colour}">${face(p)}${esc(p.name)}</span><span class="score num">${end ? thousands(p.score) : `<i>${thousands(p.score)}</i><b>${thousands(p.score)}</b>`}</span>${end ? won(p) || '<span></span>' : `<span class="up num">${p.gain ? '+' + thousands(p.gain) : ''}</span><span class="moved num ${p.moved > 0 ? 'rise' : 'fall'}">${P.moveText(p.moved)}</span>`}</li>`;
    const pod = (p, k) => `<li class="pod pl-${Math.min(p.place, 3)}${p.place === 1 ? ' winner' : ''}" data-k="${k}"><div class="plate">${p.place === 1 ? RAYS : ''}${face(p)}<span class="name p${p.colour}">${esc(p.name)}</span><span class="score num">${thousands(p.score)}${won(p)}</span></div><div class="col"><b class="num">${p.place}</b><small>${ordinal(p.place).slice(-2)}</small></div></li>`;
    // A game nobody scored in has no winner: no podium, everyone in one plain list.
    const nil = end && v.players.length > 0 && v.players.every(p => !p.score);
    const plain = (p, k) => `<li data-k="${k}"><span class="name p${p.colour}">${face(p)}${esc(p.name)}</span><span class="score num">${thousands(p.score)}</span></li>`;
    const others = v.players.slice(3);
    // These standings for the first time: what the last ones of this game were is kept to
    // slide from, and these are kept for the next.
    const game = v.game || 0;
    if (!end && boardKey !== `${game}:${v.i}`) {
      boardKey = `${game}:${v.i}`;
      boardAt = Math.min(P.now(), v.at || P.now());
      boardFrom = lastBoard && lastBoard.game === game ? lastBoard : null;
      lastBoard = { game, order: v.players.map(p => p.pid), scores: new Map(v.players.map(p => [p.pid, p.score])) };
    }
    $('standings').classList.toggle('slid', !end && !!boardFrom);
    const drawn = fill($('standings'), !end ? v.players.map(row).join('')
      : nil ? `<li class="rest flat"><ol class="${v.players.length > 7 ? 'two' : ''}">${v.players.map(plain).join('')}</ol></li>`
      : (v.players.length ? `<li class="pods"><div class="bow bow-half" aria-hidden="true"><i></i><i></i><i></i><i></i></div><ol>${v.players.slice(0, 3).map(pod).join('')}</ol></li>` : '')
        + (others.length ? `<li class="rest"><ol>${others.map((p, k) => row(p, k + 3)).join('')}</ol></li>` : ''));
    const byPid = new Map(v.players.map(p => [p.pid, p]));
    const awards = end ? v.awards.filter(a => byPid.has(a.pid)) : [];
    const drawnAwards = fill($('awards'), awards.map(a => `<li><span class="rosette" aria-hidden="true"></span><span class="award-title">${esc(AWARDS[a.kind])}</span>
      <span class="award-who"><span class="name p${byPid.get(a.pid).colour}">${esc(byPid.get(a.pid).name)}</span>${P.awardDetail(a) ? `<span class="award-detail num">${esc(P.awardDetail(a))}</span>` : ''}</span></li>`).join(''));
    $('awards').hidden = !awards.length;
    $('s-board').classList.toggle('awarded', awards.length > 0);
    // How many are listed beside the podium, for the stylesheet to size them by.
    if (drawn && end) $('standings').querySelector('.rest:not(.flat) > ol')?.style.setProperty('--n', Math.max(7, others.length));
    if (drawn) { if (end) { fitPods(); fitRest(); } else { fitBoard(); slide(); } }
    if (!end) return count();
    // The final scores come in from the bottom, the winner last. Timed from when
    // the game ended, so a TV that reloads part way picks up where it was.
    const f = P.finale(v.players.length, P.firsts(v));
    const gone = P.now() - (v.at || P.now());
    // The rainbow behind the podium is drawn as the winner comes up.
    if (drawn) $('standings').style.setProperty('--win', `${Math.round(f.winnerAt - gone)}ms`);
    if (!nil && v.players.length) confetti(v, f.winnerAt - gone);
    else if ($('confetti')) $('confetti').hidden = true;
    if (drawn) for (const li of $('standings').querySelectorAll('[data-k]')) { const k = Number(li.dataset.k); li.style.setProperty('--at', `${Math.round(f.at(k, !nil && v.players[k].place === 1) - gone)}ms`); }
    if (drawnAwards) for (const li of $('awards').children) li.style.animationDelay = `${f.done - gone}ms`;
    // Set once per game: changing it while it runs would bring the buttons in early.
    if ($('end-actions')._at !== v.at) { $('end-actions')._at = v.at; $('end-actions').style.animationDelay = `${f.done - gone}ms`; clearTimeout(homeTimer); homeTimer = setTimeout(home, Math.max(0, f.done - gone) + 700); }
  }

  // Between questions, from the second standings of a game on: each row is drawn where it
  // was last time and slides to where it is now (the stylesheet does the moving; here each
  // row is told how far back its old place is). The ones that changed place go one after
  // another, in step with the sound's blips. All timed from when these standings came up,
  // so a redraw carries on. The scores count up from what they were (from nothing, the
  // first time) over the first 0.8 s.
  let boardKey = '', boardAt = 0, boardFrom = null, lastBoard = null, counting = 0;
  function slide() {
    const list = $('standings'), rows = [...list.children];
    list.style.setProperty('--since', `${Math.round(Math.min(0, boardAt - P.now()))}ms`);
    for (const li of rows) for (const name of ['--dy', '--go']) li.style.removeProperty(name);
    if (!boardFrom) return;
    const here = new Set(view.players.map(p => p.pid));
    const was = boardFrom.order.filter(pid => here.has(pid));
    const at = rows.map(li => li.getBoundingClientRect());
    let moved = 0;
    rows.forEach((li, k) => {
      const p = view.players[k], old = p ? was.indexOf(p.pid) : -1;
      // (Someone who has joined since has nowhere to come from.)
      if (old < 0 || old >= at.length) return;
      li.classList.remove('hop');
      // One that changes column (a full room's standings have two) doesn't slide across: the
      // columns are not the same width, so it would not fit where it was. It comes in where it is now.
      if (Math.abs(at[old].left - at[k].left) > 1) li.classList.add('hop');
      else li.style.setProperty('--dy', `${Math.round(at[old].top - at[k].top)}px`);
      li.style.setProperty('--go', `${750 + (p.moved ? Math.min(moved++, 7) : 0) * 180}ms`);
    });
  }
  function count() {
    cancelAnimationFrame(counting);
    let still = false;
    try { still = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
    const step = () => {
      if (!view || view.phase !== 'board' || $('s-board').hidden) return;
      const k = still ? 1 : Math.min(1, Math.max(0, (P.now() - boardAt) / 800)), ease = 1 - (1 - k) * (1 - k);
      for (const li of $('standings').children) {
        const p = view.players[Number(li.dataset.k)], b = li.querySelector('.score b');
        if (!p || !b) continue;
        const from = boardFrom ? (boardFrom.scores.has(p.pid) ? boardFrom.scores.get(p.pid) : p.score) : 0;
        const text = thousands(Math.round(from + (p.score - from) * ease));
        if (b.textContent !== text) b.textContent = text;
      }
      if (k < 1) counting = requestAnimationFrame(step);
    };
    step();
  }

  // Confetti for the winner: 24 pieces, each with its own place across the screen, colour,
  // drift and tumble, falling from when the winner comes. Made once a game, from the game's
  // own number so that a redraw (or a reload part way) makes the same ones.
  const CONFETTI = ['var(--must)', 'var(--org)', 'var(--cream)', 'var(--rust)', '#2C9686', '#4479B8'];
  function confetti(v, winAt) {
    const box = $('confetti');
    if (!box) return;
    box.hidden = false;
    if (box._at === v.at) return;
    box._at = v.at;
    // Swept up once they have all landed (and not made at all for a reload after that).
    const landed = winAt + 3400;
    clearTimeout(box._sweep);
    if (landed <= 0) { box.innerHTML = ''; return; }
    box._sweep = setTimeout(() => { box.innerHTML = ''; }, landed);
    let seed = ((v.at || 1) % 2147483647) || 1;
    const rnd = () => (seed = seed * 48271 % 2147483647) / 2147483647;
    box.style.setProperty('--win', `${Math.round(winAt)}ms`);
    box.innerHTML = '<i></i>'.repeat(24);
    // (Each piece is told its own after it is made: the page's policy drops a style attribute.)
    [...box.children].forEach((piece, k) => {
      const set = (name, value) => piece.style.setProperty(name, value);
      set('--x', `${(2 + (k + rnd()) * 4).toFixed(1)}%`);
      set('--tint', CONFETTI[k % CONFETTI.length]);
      set('--sx', `${(rnd() * 16 - 8).toFixed(1)}rem`);
      set('--r', `${(1 + rnd() * 3).toFixed(2)}turn`);
      set('--lag', `${Math.round(rnd() * 700)}ms`);
    });
  }

  // ---------- sound ----------
  // The music and the effects are sound.js's. It is shown each view as it is drawn (in
  // render, with whether the screen is new, so nothing plays twice) and the countdown's
  // seconds, and it labels its own two buttons. A page cached from before it has none.
  const Sound = window.Sound;
  const soundLabel = () => { if (!Sound) $('c-sound').textContent = sound ? 'Sound on' : 'Sound off'; };
  const mute = () => { sound = Sound ? Sound.toggle() : !sound; store.set(SOUND, sound); soundLabel(); };

  // ---------- pressing ----------
  // A press shows at once: the button sits down (and Start and End say what they are doing)
  // before the room has answered. It counts once: until the room answers, or a few seconds
  // pass with no word, the same button does nothing more, so pressing again does no harm.
  const pressed = new Map();
  function press(btn, doing, go) {
    if (!btn || pressed.has(btn)) return;
    pressed.set(btn, { was: btn.textContent, doing, timer: setTimeout(() => settle(btn), 4000) });
    btn.classList.add('busy');
    if (doing) btn.textContent = doing;
    go();
  }
  function settle(only) {
    for (const [btn, p] of pressed) {
      if (only && btn !== only) continue;
      clearTimeout(p.timer);
      btn.classList.remove('busy');
      if (p.doing && btn.textContent === p.doing) btn.textContent = p.was;
      pressed.delete(btn);
    }
  }

  // Are you sure? Asked on the screen itself, never in a box of the browser's (which stops
  // the page, and on a television is a struggle to answer). It waits for an answer; it goes
  // by itself only when what it asks about is no longer so (`still` says, of each new view).
  let sureThen = null, sureFor = null, sureFrom = null;
  function sure(text, yes, then, still) {
    $('sure-text').textContent = text;
    $('sure-yes').textContent = yes;
    sureThen = then; sureFor = still || null;
    sureFrom = document.activeElement;
    $('sure').hidden = false;
    try { history.pushState({ sure: 1 }, ''); } catch {}
    Sound?.ui?.('ask');
    // The ring starts on Cancel: nothing is ended or removed by pressing OK twice by mistake.
    $('sure-no').focus();
  }
  function unsure(go, back) {
    if ($('sure').hidden) return;
    $('sure').hidden = true;
    // (The step in the browser's history that a remote's Back would have used up is taken away.)
    if (!back) try { if (history.state && history.state.sure) history.back(); } catch {}
    const then = sureThen, from = sureFrom;
    sureThen = sureFor = sureFrom = null;
    // Focus goes back where it was, if that was a button the keyboard was on.
    if (keyed && from && from !== document.body && from.isConnected && from.getClientRects().length) from.focus();
    else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if (go && then) then();
  }
  addEventListener('popstate', () => {
    if (ownBack) { ownBack--; return; }
    unsure(false, true);
    closePicker(true);
  });
  $('sure-yes').addEventListener('click', () => unsure(true));
  $('sure-no').addEventListener('click', () => unsure(false));

  // A press is the mouse going down and coming up on the same button. If the lobby is drawn
  // again in between (someone joined), the button under the mouse is a new one and the
  // browser sends no click: the press is finished here, on the button now in its place.
  const KEYED = '[data-cat], [data-len], [data-give], [data-kick]';   // (a topic in the picker, a length, a card, a cross)
  const keyOf = el => ['cat', 'len', 'give', 'kick'].map(k => (el.dataset[k] != null ? `${k}:${el.dataset[k]}` : '')).join('');
  let down = null;
  document.addEventListener('pointerdown', e => { const el = e.button === 0 && e.target.closest?.(KEYED); down = el ? { el, key: keyOf(el) } : null; }, true);
  document.addEventListener('pointerup', e => {
    const was = down;
    down = null;
    if (!was || was.el.isConnected) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(KEYED);
    if (el && keyOf(el) === was.key) el.click();
  }, true);

  // ---------- controls ----------
  // Shown as chosen at once, so quick presses build on each other; the room's word, a
  // moment later, is the last one.
  function settings(change) {
    carry = null;
    const s = { ...view.settings, ...change };
    if (!send({ t: 'settings', count: s.count, cats: s.cats })) return;
    view = { ...view, settings: s };
    if (view.phase === 'lobby') lobby(view);
  }

  function start() {
    if (!view || view.phase !== 'lobby' || !view.players.length || picking()) return;
    if (trouble) { trouble = ''; render(view); }
    press($('start'), 'Starting…', () => send({ t: 'start', avoid: store.get(ASKED, []) }));
  }

  $('lengths').addEventListener('click', e => {
    const b = e.target.closest('[data-len]');
    if (b) settings({ count: Number(b.dataset.len) });
    // Clicked with the mouse: focus doesn't stay on the setting, so the next Enter starts
    // the game. From the keyboard it stays (and is put back on a redraw).
    if (b && e.detail) document.activeElement?.blur?.();
  });
  $('topics-change').addEventListener('click', openPicker);
  $('picker-groups').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    // (Null if that would leave no topic at all: the last one stays.)
    const cats = b && view && P.toggle(view.settings.cats, b.dataset.cat);
    if (cats) settings({ cats });
  });
  $('picker-mix').addEventListener('click', () => { if (view && view.settings.cats.length) settings({ cats: [] }); });
  $('picker-done').addEventListener('click', () => closePicker());
  // A click on the dimmed lobby behind closes it.
  $('picker').addEventListener('click', e => { if (e.target === $('picker')) closePicker(); });
  $('lobby-players').addEventListener('click', e => {
    const b = e.target.closest('[data-give], [data-kick]');
    if (!b) return;
    const p = view.players.find(x => x.pid === Number(b.dataset.give || b.dataset.kick));
    if (!p) return;
    // Removing is the cross's alone, and still asks.
    if (b.dataset.kick) sure(`Remove ${p.name} from the room?`, 'Remove', () => send({ t: 'kick', pid: p.pid }), v => v.phase === 'lobby' && v.players.some(x => x.pid === p.pid));
    else {
      // The holder's own card takes it back: nobody has it then, and only the TV runs the game.
      if (p.pid === view.remote) send({ t: 'give', pid: null });
      else if (p.online) send({ t: 'give', pid: p.pid });
      // Clicked with the mouse: focus doesn't stay on the name, so the next Enter starts
      // the game. From the keyboard it stays (and is put back when the list is redrawn).
      if (e.detail) b.blur();
    }
  });
  $('start').addEventListener('click', start);
  const inGame = v => !!v && ['intro', 'question', 'reveal', 'board'].includes(v.phase);
  const pause = () => { if (inGame(view)) press($('c-pause'), null, () => send({ t: view.paused == null ? 'pause' : 'resume' })); };
  $('c-pause').addEventListener('click', pause);
  // A skip says which screen it's for, so one that lands after the screen moved on does nothing.
  const skip = () => { if (inGame(view)) press($('c-skip'), null, () => send({ t: 'skip', for: `${view.game || 0}:${view.i}:${view.phase}` })); };
  $('c-skip').addEventListener('click', skip);
  // End is held, not pressed: 1.2 s with the mouse or a finger on it, a fill sweeping across,
  // and the game ends with nothing more asked; let go early and it says "Hold to end".
  // From the keys the same, with OK (Enter) held down, but only while the key is seen to be
  // held: by its repeats. A remote that sends none (and many send no key-up either) could
  // not tell a hold from a press, so a press with no repeat inside 0.7 s, or one let go
  // early, asks on the screen instead (Cancel first), as End always used to. One press
  // never ends a game by itself.
  const HOLD = 1200, REPEAT_BY = 700, REPEAT_GAP = 450;
  const endNow = () => { if (inGame(view)) press($('c-end'), 'Ending…', () => send({ t: 'stop' })); };
  const askEnd = () => { if (inGame(view) && $('sure').hidden) sure('End this game now and show the scores?', 'End game', endNow, inGame); };
  // (A shared.js from before the hold, met for a minute in a release: End asks, as it did.)
  const ender = P.hold ? P.hold($('c-end'), { ms: HOLD, hint: 'Hold to end', done: endNow, other: askEnd }) : null;
  if (!ender) $('c-end').addEventListener('click', askEnd);
  let keyHold = null;      // OK held on End: when it went down, when it last repeated, how often
  function keyOnEnd(e) {
    if (e.repeat) { if (keyHold) { keyHold.last = Date.now(); keyHold.n++; } return; }
    stopKeyHold();
    keyHold = { at: Date.now(), last: 0, n: 0, timer: setInterval(watchKeyHold, 40) };
    ender.begin();
  }
  function watchKeyHold() {
    const k = keyHold, now = Date.now();
    if (!k) return;
    if (!inGame(view) || document.activeElement !== $('c-end')) return stopKeyHold();
    // Still down, as far as can be told: repeats coming, or too soon for the first of them.
    const down = k.n ? now - k.last < REPEAT_GAP : now - k.at < REPEAT_BY;
    if (!down) { stopKeyHold(); askEnd(); }
    else if (now - k.at >= HOLD && k.n >= 2) { stopKeyHold(); endNow(); }
  }
  function stopKeyHold() {
    if (!keyHold) return;
    clearInterval(keyHold.timer);
    keyHold = null;
    ender?.cancel(false);
  }
  // Let go before the time was up: a short press.
  addEventListener('keyup', e => { if (keyHold && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); stopKeyHold(); askEnd(); } }, true);
  $('again').addEventListener('click', () => press($('again'), null, () => send({ t: 'again' })));
  // Start fresh throws the night's scores away, so from the second round on it asks first.
  $('fresh')?.addEventListener('click', () => {
    const go = () => press($('fresh'), null, () => send({ t: 'fresh' }));
    if (view && later(view)) sure('Start fresh? Everyone’s scores go back to zero.', 'Start fresh', go, v => v.phase === 'end');
    else go();
  });
  const fresh = () => {
    // The new room is given this one's length and topics (see carried).
    carry = view?.settings ? { count: view.settings.count, cats: [...view.settings.cats] } : null;
    send({ t: 'close' }); if (sock) sock.close(); sock = null; store.drop(SAVED); open();
  };
  // A new room leaves everybody and their scores behind, so it asks.
  $('new-room').addEventListener('click', () => sure('Close this room and open a new one? Everyone joins again.', 'New room', () => press($('new-room'), 'Opening…', fresh), v => v.phase === 'end'));
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
  $('c-sound').addEventListener('click', mute);
  Sound?.setup({ on: sound, sound: $('c-sound'), music: $('c-music'), ask: TV ? 'Press OK for sound' : 'Press for sound' });
  // A mouse click leaves these alone, so the next Enter still starts the game.
  for (const id of ['c-sound', 'c-music', 'c-full', 'c-pause', 'c-skip', 'c-end', 'again', 'fresh', 'new-room']) $(id)?.addEventListener('click', e => { if (e.detail) e.currentTarget.blur(); });
  soundLabel();

  // ---------- the keyboard, and a television's remote ----------
  // Everything can be run with the arrows and Enter (OK on a remote), a cream ring showing
  // where they are. The arrows move from one button to the nearest in that direction. The
  // shortcuts stay: Enter starts from the lobby, Space pauses, M and F. No arrow does anything
  // but move the ring: the first one only puts it on this screen's button (Escape takes it off).
  let keyed = false;   // the keyboard was the last thing used, not the mouse
  let ringed = false;  // and the arrows have been: the ring is in use, and kept on some button (see home)
  const keys = on => { keyed = on; if (!on) ringed = false; document.body.classList.toggle('keys', on); };
  // Whether this press is the one the browser was waiting for before it would play a sound
  // (the Sound button was asking): seen here, before sound.js hears the same press.
  let forSound = false, woken = false;   // (only ever the one press: if the sound never does start, Enter still starts the game)
  addEventListener('keydown', () => { forSound = $('c-sound').classList.contains('wants'); keys(true); }, true);
  addEventListener('pointerdown', () => keys(false), true);
  const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  const BACK = ['Escape', 'Backspace', 'BrowserBack', 'GoBack'];
  // (A button still faded out, as the final three are while the podium fills, can't be reached yet.)
  const seen = el => { const a = el.closest('.end-actions'); return !a || Number(getComputedStyle(a).opacity) > .1; };
  const reach = el => !el.disabled && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && seen(el);
  // A remote's Back, by the codes Samsung and LG send for it.
  const isBack = e => BACK.includes(e.key) || e.key === 'XF86Back' || e.keyCode === 10009 || e.keyCode === 461;
  // The ring's tick, once for a press: not rattled off while an arrow is held down.
  let repeating = false;
  const tick = () => { if (!repeating) Sound?.ui?.('move'); };
  function move(dir) {
    // (While the topic picker is open the ring keeps to it.)
    const all = [...document.querySelectorAll(picking() ? '#picker button' : '#tv button, .controls button, .corner button, .corner a')].filter(reach);
    const at = document.activeElement;
    ringed = true;
    if (!at || !all.includes(at)) {
      // Nowhere yet: the button this screen is for.
      const first = (picking() ? null : HOME.map($).find(el => el && all.includes(el))) || all[0];
      if (first) { first.focus(); tick(); }
      return;
    }
    const a = at.getBoundingClientRect();
    const across = dir === 'left' || dir === 'right';
    let best = null, least = Infinity;
    for (const el of all) {
      if (el === at) continue;
      // The cross in the corner of a card is reached from that card alone, by the right arrow:
      // going up, down or along the cards, the ring goes from card to card.
      if (el.classList.contains('drop') && !(dir === 'right' && el.parentElement === at.parentElement)) continue;
      const b = el.getBoundingClientRect();
      // How far on it is in the direction pressed (it must be on that side), and how far off to the side.
      const on = dir === 'left' ? a.left + a.width / 2 - (b.left + b.width / 2) : dir === 'right' ? b.left + b.width / 2 - (a.left + a.width / 2)
        : dir === 'up' ? a.top + a.height / 2 - (b.top + b.height / 2) : b.top + b.height / 2 - (a.top + a.height / 2);
      if (on < 2) continue;
      const gap = Math.max(0, dir === 'left' ? a.left - b.right : dir === 'right' ? b.left - a.right : dir === 'up' ? a.top - b.bottom : b.top - a.bottom);
      const off = across ? Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)) : Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
      // One in line with this one (off 0) before any that is not, then the nearest.
      const far = gap + off * 4 + (off ? 60 : 0) + on * .01;
      if (far < least) { best = el; least = far; }
    }
    if (best) { best.focus(); best.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); tick(); }
  }

  document.addEventListener('keydown', e => {
    if (e.target.closest?.('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const dir = ARROWS[e.key];
    repeating = e.repeat;
    // OK on End is a hold (see keyOnEnd): its repeats are what say it is still down.
    if ((e.key === 'Enter' || e.key === ' ') && ender && document.activeElement === $('c-end') && $('sure').hidden && inGame(view) && sock) {
      e.preventDefault();
      if (!e.repeat) Sound?.ui?.('ok');
      return keyOnEnd(e);
    }
    // A key held down counts once: OK held on Next must not run through the game.
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); return; }
    // A question on the screen takes every key: the arrows go between its two answers,
    // Enter gives the one the ring is on, Escape (or a remote's Back) says no.
    if (!$('sure').hidden) {
      if (isBack(e)) { e.preventDefault(); unsure(false); }
      else if (dir || e.key === 'Tab') { e.preventDefault(); (document.activeElement === $('sure-yes') ? $('sure-no') : $('sure-yes')).focus(); tick(); }
      else if (e.key === 'Enter' && $('sure').contains(document.activeElement)) Sound?.ui?.('ok');
      else if (e.key === 'Enter' || e.key === ' ') { if (!$('sure').contains(document.activeElement)) { e.preventDefault(); $('sure-no').focus(); } }
      return;
    }
    // So does the topic picker: the arrows go from topic to topic, Enter presses the one
    // the ring is on, Escape (or Back) closes it. Nothing behind it hears a key.
    if (picking()) {
      const on = document.activeElement?.closest?.('#picker button');
      if (isBack(e)) { e.preventDefault(); closePicker(); }
      else if (dir) { e.preventDefault(); move(dir); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        const all = [...$('picker').querySelectorAll('button')].filter(reach);
        all[(all.indexOf(on) + (e.shiftKey ? all.length - 1 : 1)) % all.length]?.focus();
      }
      else if (e.key === 'Enter' && on) Sound?.ui?.('ok');
      else if (e.key === 'Enter' || e.key === ' ') { if (!on) { e.preventDefault(); move('down'); } }
      return;
    }
    const game = inGame(view) && !!sock;
    const onButton = !!document.activeElement?.closest?.('button, a');
    // OK on the button the ring is on.
    if (e.key === 'Enter' && onButton && !e.repeat) Sound?.ui?.('ok');
    if (dir) { e.preventDefault(); return move(dir); }
    // Escape, or a remote's Back with nothing open: the ring comes off, and the page is not left.
    if (isBack(e)) { if (e.key !== 'Escape') e.preventDefault(); ringed = false; if (onButton) document.activeElement.blur(); return; }
    if (e.key === ' ' && game) { if (!onButton) { e.preventDefault(); pause(); } }
    // (An Enter that only woke the sound, the first press on a television's remote as often as not, doesn't also start the game.)
    else if (e.key === 'Enter' && view?.phase === 'lobby' && !e.target.closest?.('button, a')) { if (forSound && !woken) woken = true; else start(); }
    else if (e.key === 'f' || e.key === 'F') full();
    else if (e.key === 'm' || e.key === 'M') mute();
  });

  // The sound and full-screen buttons are fainter through a game while nobody touches the
  // mouse. Nothing is ever switched off by this: a button out of sight would swallow the press meant for it.
  let idleTimer = null;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
  };
  for (const type of ['mousemove', 'mousedown', 'keydown', 'focusin']) document.addEventListener(type, wake, { passive: true });
  wake();

  // ---------- an easier picture for a slow screen ----------
  // Frames are counted for three seconds as a screen comes in. Twice running under 25 a
  // second (or a third of them late), and the scenery that turns for ever holds still from
  // then on ('easy' in the stylesheet). Nothing changes place, and nothing is timed by it.
  let gauging = false, gauged = 0, strikes = 0;
  function gauge() {
    if (gauging || gauged >= 8 || document.hidden || document.body.classList.contains('easy')) return;
    gauging = true;
    gauged++;
    let n = 0, late = 0, last = 0, t0 = 0;
    const tick = t => {
      if (!t0) t0 = t;
      if (last) { n++; if (t - last > 50) late++; }
      last = t;
      if (t - t0 < 3000 && !document.hidden) return requestAnimationFrame(tick);
      gauging = false;
      if (document.hidden || t - t0 < 3000) return;
      strikes = n < 75 || late > n / 3 ? strikes + 1 : 0;
      if (strikes >= 2) document.body.classList.add('easy');
    };
    requestAnimationFrame(tick);
  }

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
