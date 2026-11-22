// What the TV and the phones share: the connection to the room and small helpers.
(function (root) {
  // General topics mix by default; packs are for a room of fans and play only when picked.
  const GENERAL = {
    australia: 'Australia', world: 'World', science: 'Science', history: 'History',
    sport: 'Sport', screen: 'Screen & music', food: 'Food & drink', words: 'Words & books',
  };
  const PACKS = {
    geography: 'Geography', space: 'Space', animals: 'Animals', body: 'Human body',
    myths: 'Mythology', inventions: 'Inventions', maths: 'Maths', money: 'Money',
    landmarks: 'Landmarks', languages: 'Languages', art: 'Art', ancient: 'Ancient world',
    wars: 'World wars', royals: 'Royals', crime: 'True crime', aushistory: 'Aussie history',
    auspolitics: 'Aussie politics', explorers: 'Explorers', movies: 'Movies', tv: 'Binge TV',
    animation: 'Animation', superheroes: 'Superheroes', fantasy: 'Fantasy & sci-fi', horror: 'Horror',
    reality: 'Reality TV', sitcoms: 'Sitcoms', anime: 'Anime', ausscreen: 'Aussie screen',
    books: 'Books', musicals: 'Musicals', music: 'Music', m80s: '80s music',
    m90s: '90s music', m00s: '2000s music', hits: 'Modern hits', hiphop: 'Hip hop & R&B',
    rock: 'Rock & metal', ausmusic: 'Aussie music', onehit: 'One-hit wonders', epl: 'Premier League',
    afl: 'AFL', nrl: 'NRL', cricket: 'Cricket', rugby: 'Rugby union',
    basketball: 'Basketball', tennis: 'Tennis', golf: 'Golf', f1: 'Formula 1',
    motors: 'Bikes & Supercars', olympics: 'Olympics', worldcup: 'World Cup', combat: 'Boxing & UFC',
    boardsports: 'Surf, skate & snow', nightsout: 'Nights out', drinks: 'Drinks', coffee: 'Coffee',
    travel: 'Travel', cars: 'Cars', fashion: 'Fashion', brands: 'Brands & ads',
    celebs: 'Celebrities', pets: 'Dogs & cats', boardgames: 'Board games', gaming: 'Video games',
    internet: 'Internet', kids: '2000s kids', toys: 'Toys & crazes', truefalse: 'Myth or fact',
    years: 'Guess the year', records: 'World records', strange: 'Strange but true', beforefame: 'Before fame',
  };
  const CATS = { ...GENERAL, ...PACKS };
  // What a topic's button says: its name. (Every name is short enough for a button now; the
  // pages still ask through this, as they did when some names had a shorter one for theirs.)
  const chip = key => CATS[key] || '';
  // The topics a room's settings stand for: none listed means the general ones.
  const picked = cats => new Set(cats.length ? cats : Object.keys(GENERAL));
  // The host's own packs, in a room opened with their key: the room's view lists them as
  // [{ id, name }], and from then on they are named like any topic. A room without them
  // says nothing, and nor does an older one. Gives back the ids as one string, to tell a change by.
  let OWN = {};
  const mine = key => Object.prototype.hasOwnProperty.call(OWN, key);
  function own(list) {
    for (const k of Object.keys(OWN)) delete CATS[k];
    OWN = {};
    for (const p of Array.isArray(list) ? list : []) {
      if (!p || typeof p.id !== 'string' || p.id in CATS) continue;
      OWN[p.id] = CATS[p.id] = String(p.name || 'Your pack');
    }
    return Object.keys(OWN).join();
  }
  // Turns one topic on or off. Null if that would leave none.
  // The host's own pack is the whole game when picked from the everyday mix (it would be
  // lost among several hundred questions); topics picked after that play beside it. Taking
  // the last thing away, if it is that pack, goes back to the everyday mix.
  function toggle(cats, key) {
    if (mine(key) && !cats.length) return [key];
    const on = picked(cats);
    if (on.has(key)) on.delete(key); else on.add(key);
    if (!on.size) return mine(key) ? [] : null;
    const general = Object.keys(GENERAL);
    if (on.size === general.length && general.every(k => on.has(k))) return [];
    return [...Object.keys(OWN), ...Object.keys(GENERAL), ...Object.keys(PACKS)].filter(k => on.has(k));
  }
  // The two rows of topic buttons for the TV. data-label keeps room for the bold "on" weight.
  // The host's own packs come first among the packs.
  const topicRows = (cats, esc) => {
    const on = picked(cats);
    const row = (list, kind = '') => Object.keys(list).map(k => [k, chip(k)]).map(([k, label]) => `<button type="button" class="${kind}${on.has(k) ? 'on' : ''}" data-cat="${esc(k)}" data-label="${esc(label)}" aria-pressed="${on.has(k)}">${esc(label)}</button>`).join('');
    return { general: row(GENERAL), packs: row(OWN, 'own ') + row(PACKS) };
  };
  // The topics under their headings, for the TV's picker and the remote's sheet: every topic
  // the game is to have (questions/review/planned-packs.json), each in its place already.
  // Only the ones in GENERAL and PACKS above are shown, and a heading with none of them is
  // left out, so a new pack needs only its name in PACKS (here and in worker/game.js). One
  // in no list here is still shown, under "More packs". The host's own come first, in a
  // room that has them.
  const GROUPS = [
    { title: 'Everyday', keys: ['australia', 'world', 'science', 'history', 'sport', 'screen', 'food', 'words'] },
    { title: 'Know-it-all', keys: ['geography', 'space', 'animals', 'body', 'myths', 'inventions', 'maths', 'money', 'landmarks', 'languages', 'art'] },
    { title: 'History', keys: ['ancient', 'wars', 'royals', 'crime', 'aushistory', 'auspolitics', 'explorers'] },
    { title: 'Screen & stories', keys: ['movies', 'tv', 'animation', 'superheroes', 'fantasy', 'horror', 'reality', 'sitcoms', 'anime', 'ausscreen', 'books', 'musicals'] },
    { title: 'Music', keys: ['music', 'm80s', 'm90s', 'm00s', 'hits', 'hiphop', 'rock', 'ausmusic', 'onehit'] },
    { title: 'Sport', keys: ['epl', 'afl', 'nrl', 'cricket', 'rugby', 'basketball', 'tennis', 'golf', 'f1', 'motors', 'olympics', 'worldcup', 'combat', 'boardsports'] },
    { title: 'Lifestyle', keys: ['nightsout', 'drinks', 'coffee', 'travel', 'cars', 'fashion', 'brands', 'celebs', 'pets', 'boardgames', 'gaming', 'internet', 'kids', 'toys'] },
    { title: 'Party twists', keys: ['truefalse', 'years', 'records', 'strange', 'beforefame'] },
  ];
  function groups() {
    const placed = new Set(GROUPS.flatMap(g => g.keys));
    const mine = Object.keys(OWN);
    const rest = [...Object.keys(GENERAL), ...Object.keys(PACKS)].filter(k => !placed.has(k));
    return [
      ...(mine.length ? [{ title: mine.length > 1 ? 'Your packs' : 'Your pack', keys: mine, own: true }] : []),
      ...GROUPS.map(g => ({ title: g.title, keys: g.keys.filter(k => k in GENERAL || k in PACKS) })).filter(g => g.keys.length),
      ...(rest.length ? [{ title: 'More packs', keys: rest }] : []),
    ];
  }
  // The headings with what is picked under each (`on`, in the heading's own order), and which
  // of them a picker opens on (`first`): the one holding the first topic picked, which for
  // the everyday mix is Everyday. A heading is shown one at a time, so its count is how the
  // rest of the choice is seen.
  function headings(cats) {
    const on = picked(cats);
    const list = groups().map(g => ({ ...g, on: g.keys.filter(k => on.has(k)) }));
    return { list, first: Math.max(0, list.findIndex(g => g.on.length)) };
  }
  // Everything picked, by name and in the order of the headings, for the line of it over the
  // TV's picker. All eight everyday topics are said as one, "Everyday mix", whatever is
  // picked beside them: a pack pressed from the everyday mix is that mix and the pack.
  function picks(cats) {
    const on = picked(cats);
    const mix = Object.keys(GENERAL).every(k => on.has(k));
    const names = [];
    let said = false;
    for (const k of groups().flatMap(g => g.keys)) {
      if (!on.has(k)) continue;
      if (mix && k in GENERAL) { if (!said) names.push('Everyday mix'); said = true; }
      else names.push(chip(k));
    }
    return names;
  }
  // What the settings say is picked, in a line: the everyday mix, or the first topic picked
  // (the host's own pack before any other) and how many more. The names are the picker's:
  // all eight everyday topics are the one mix, so the mix and a pack is "Everyday mix +1 more".
  function summary(cats) {
    if (!cats.length) return { first: 'Everyday mix', more: 0 };
    const order = groups().flatMap(g => g.keys).filter(k => cats.includes(k));
    const names = picks(cats);
    return { first: names[0] || 'Topics', more: Math.max(0, names.length - 1), key: order[0] };
  }

  // A button that has to be held down: `ms` with the pointer on it, a fill sweeping across
  // as it is held (the stylesheet draws it while the button is 'holding'), then `done`.
  // Let go early, it says `hint` for a moment and nothing happens. A click that came with no
  // pointer at all (a keyboard, a screen reader) is `other`'s to deal with. `begin` and
  // `cancel` are for a caller that counts a hold some other way (a key held down).
  function hold(btn, { ms = 1200, hint = 'Hold to end', done, other }) {
    let timer = null, tip = null, label = '', pointed = false, lift = null;
    btn.style.setProperty('--hold', `${ms}ms`);
    const unhint = () => { if (!tip) return; clearTimeout(tip); tip = null; btn.classList.remove('hinting'); if (btn.textContent === hint) btn.textContent = label; };
    const begin = () => { unhint(); btn.classList.add('holding'); };
    const cancel = say => {
      clearTimeout(timer); timer = null;
      btn.classList.remove('holding');
      if (!say) return;
      unhint();
      label = btn.textContent;
      btn.textContent = hint;
      btn.classList.add('hinting');
      tip = setTimeout(unhint, 1600);
    };
    btn.addEventListener('pointerdown', e => {
      clearTimeout(lift);
      pointed = true;
      // (Busy: a press of it is already on its way, and its words are not its own just now.)
      if (e.button !== 0 || btn.disabled || timer || btn.classList.contains('busy')) return;
      begin();
      try { btn.setPointerCapture(e.pointerId); } catch {}
      timer = setTimeout(() => { cancel(false); done(); }, ms);
    });
    // Slid off the button while holding: that is letting go.
    btn.addEventListener('pointermove', e => {
      if (!timer) return;
      const r = btn.getBoundingClientRect(), pad = 12;
      if (e.clientX < r.left - pad || e.clientX > r.right + pad || e.clientY < r.top - pad || e.clientY > r.bottom + pad) cancel(true);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(type, () => {
      if (timer) cancel(true);
      // (The click that follows a pointer is not a press of its own: see below.)
      clearTimeout(lift);
      lift = setTimeout(() => { pointed = false; }, 500);
    });
    // A long press must not bring up the browser's menu instead.
    btn.addEventListener('contextmenu', e => e.preventDefault());
    btn.addEventListener('click', e => { if (!pointed && other) other(e); });
    return { begin, cancel, unhint };
  }

  const LETTERS = ['A', 'B', 'C', 'D'];
  const KINDS = { choice: 'Pick one', number: 'Closest guess wins', order: 'Put them in order' };

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // A player's name in their colour.
  const who = p => `<span class="pname p${p.colour}">${esc(p.name)}</span>`;
  // A player's character, beside their name. The drawings are faces.js's; a player without
  // one, an id this page doesn't know, or a page that never got faces.js, has none.
  const face = p => {
    let svg = '';
    try { svg = p && p.face && root.Faces ? String(root.Faces.svg(p.face) || '') : ''; } catch {}
    return svg ? `<span class="face" aria-hidden="true">${svg}</span>` : '';
  };
  const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const thousands = n => Number(n).toLocaleString('en-AU');

  // A socket that comes back by itself. `onMessage` gets every message; `onState`
  // hears 'open', 'down' (reconnecting) and 'closed' (the room sent it away for good).
  // Only the newest socket counts: events from one it has replaced are ignored.
  // A connection can die without the browser noticing (Wi-Fi gone, no goodbye), so the
  // room is pinged every 20 s, and a ping that hears nothing back means a new socket.
  // The room reads the pings too: a socket that stops pinging is a phone gone.
  // `reopen` starts a new socket now, for a caller with its own doubts.
  const PING = 20000;     // a ping this often
  const DEAF = 10000;     // a ping with nothing back for this long: the socket is dead
  const GAP = 35000;      // back on screen after this long without a message: don't trust it
  const BACK = 4000;      // back on screen sooner than that: the line is tried, and has this long to answer
  function connect(url, { onMessage, onState }) {
    let ws = null, wait = 500, closed = false, timer = null;
    let heard = 0, pinged = 0;   // last message in (pongs count), last ping out
    let due = 0;                 // when the next ping goes
    let retiring = [];           // sockets replaced, closed once the new one is open
    let doubt = null;            // waits on the ping sent as the page came back on screen
    const retire = () => { for (const old of retiring) try { old.close(); } catch {} retiring = []; };
    const open = () => {
      if (closed) return;
      clearTimeout(timer);
      // The old socket stays open until the new one is, so the room never sees this
      // screen gone for a moment (the remote would move on to someone else).
      if (ws) { ws.onopen = ws.onmessage = ws.onclose = null; retiring.push(ws); }
      heard = Date.now(); pinged = 0; due = heard + PING;
      const sock = ws = new WebSocket(url());
      sock.onopen = () => {
        if (sock !== ws) return;
        retire();
        wait = 500;
        heard = Date.now();
        onState && onState('open');
      };
      sock.onmessage = e => { if (sock !== ws) return; heard = Date.now(); let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
      sock.onclose = e => {
        if (sock !== ws) return;
        retire();
        if (closed) return;
        if (e.code === 4000 || e.code === 4001) { closed = true; onState && onState('closed'); return; }
        onState && onState('down');
        timer = setTimeout(open, wait);
        wait = Math.min(wait * 2, 8000);
      };
    };
    const reopen = () => {
      if (closed) return;
      wait = 500;
      onState && onState('down');
      open();
    };
    const send = msg => { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; } return false; };
    const ping = () => { if (send({ t: 'ping' })) { pinged = Date.now(); due = pinged + PING; } };
    // Judged by the ping, not by a quiet spell: a page in the background has its timers
    // slowed to once a minute, and a quiet minute there isn't a dead socket.
    const watch = setInterval(() => {
      if (closed) return clearInterval(watch);
      if (!ws) return;
      const now = Date.now();
      if (ws.readyState === 0 && now - heard > GAP) return reopen();   // stuck connecting
      if (ws.readyState !== 1) return;
      const waiting = pinged > heard;
      if (waiting && now - pinged > DEAF) return reopen();
      if (!waiting && now >= due) ping();
    }, 5000);
    // A phone coming back from the lock screen shouldn't wait out the backoff, or trust
    // a socket that has heard nothing for a long while. After a shorter while the socket is
    // tried with a ping, and given only a few seconds to answer: a line that died while the
    // phone was locked is not left on screen, looking live, until the usual watch finds it.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || closed || !ws) return;
      if (ws.readyState > 1 || Date.now() - heard > GAP) return reopen();
      if (ws.readyState !== 1) return;
      if (!(pinged > heard)) ping();
      const sock = ws, at = Date.now();
      clearTimeout(doubt);
      doubt = setTimeout(() => { if (!closed && !document.hidden && sock === ws && heard < at) reopen(); }, BACK);
    });
    open();
    // `heard` is when anything last came in, for a caller judging the line itself.
    return { send, ping, reopen, heard: () => heard, close: () => { closed = true; clearTimeout(timer); clearTimeout(doubt); clearInterval(watch); retire(); ws && ws.close(); } };
  }

  // The room's clock, from the time on its last message.
  let skew = 0;
  const sync = serverNow => { skew = serverNow - Date.now(); };
  const now = () => Date.now() + skew;

  // Runs the drain on a .timer bar and an optional seconds label until `until`.
  function countdown(bar, label, until, limit, paused, onTick) {
    cancelAnimationFrame(bar._raf);
    const frame = () => {
      const left = paused != null ? paused : Math.max(0, until - now());
      bar.firstElementChild.style.transform = `scaleX(${limit ? left / limit : 0})`;
      bar.classList.toggle('low', left < 5000);
      const secs = Math.ceil(left / 1000);
      if (label && label.textContent !== String(secs)) { label.textContent = secs; onTick && onTick(secs); }
      if (paused == null && left > 0) bar._raf = requestAnimationFrame(frame);
    };
    frame();
  }

  const wsUrl = path => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;

  // The final scores come in from the bottom, the winner last after a pause. The
  // phones hold their own result back until the TV is done.
  // The last three are made to wait: a longer breath before third, another before second,
  // and the longest before the winner. (A breath only where somebody has come in before it.)
  // `w` is how many are tied for first (they come in together): the wait is counted from
  // the last one before them, so a tie leaves no longer a gap than a lone winner does.
  function finale(n, w = 1) {
    const step = n > 1 ? Math.min(700, 4200 / (n - 1)) : 0;
    const held = k => (k <= 2 && n > 3 ? 900 : 0) + (k <= 1 && n > 2 ? 900 : 0);
    const due = k => (n - 1 - k) * step + held(k);
    const winnerAt = n > w ? due(w) + 3000 : 600;
    // `first` says whether row k is a winner: everyone tied for first comes in together, last.
    return { step, winnerAt, done: winnerAt + 1100, at: (k, first) => (first ? winnerAt : due(k)) };
  }

  // How many share first place in the final scores (one, where nobody scored at all).
  const firsts = v => v.players.every(p => !p.score) ? 1 : Math.max(1, v.players.filter(p => p.place === 1).length);

  const AWARDS = { quick: 'Quickest fingers', near: 'Best guesser', run: 'Longest run' };
  const awardDetail = a => a.kind === 'quick' ? `${(a.ms / 1000).toFixed(1)} s per right answer`
    : a.kind === 'run' ? `${a.n} right in a row` : '';   // Best guesser says it already
  const moveText = m => !m ? '' : `${m > 0 ? '↑' : '↓'}${Math.abs(m)}`;

  root.P = { CATS, GENERAL, PACKS, GROUPS, groups, headings, picks, summary, hold, chip, own, owned: () => ({ ...OWN }), toggle, topicRows, LETTERS, KINDS, AWARDS, esc, who, face, ordinal, plural, thousands, connect, sync, now, countdown, wsUrl, finale, firsts, awardDetail, moveText };
})(window);
