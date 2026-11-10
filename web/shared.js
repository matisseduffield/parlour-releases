// What the TV and the phones share: the connection to the room and small helpers.
(function (root) {
  // General topics mix by default; packs are for a room of fans and play only when picked.
  const GENERAL = {
    australia: 'Australia', world: 'World', science: 'Science', history: 'History',
    sport: 'Sport', screen: 'Screen & music', food: 'Food & drink', words: 'Words & books',
  };
  const PACKS = {
    epl: 'Premier League', afl: 'AFL', cricket: 'Cricket', golf: 'Golf',
    tennis: 'Tennis', f1: 'Formula 1', movies: 'Movies', music: 'Music',
  };
  const CATS = { ...GENERAL, ...PACKS };
  // The topics a room's settings stand for: none listed means the general ones.
  const picked = cats => new Set(cats.length ? cats : Object.keys(GENERAL));
  // Turns one topic on or off. Null if that would leave none.
  function toggle(cats, key) {
    const on = picked(cats);
    if (on.has(key)) on.delete(key); else on.add(key);
    if (!on.size) return null;
    const general = Object.keys(GENERAL);
    if (on.size === general.length && general.every(k => on.has(k))) return [];
    return Object.keys(CATS).filter(k => on.has(k));
  }
  // The two rows of topic buttons for the TV. data-label keeps room for the bold "on" weight.
  const topicRows = (cats, esc) => {
    const on = picked(cats);
    const row = list => Object.entries(list).map(([k, label]) => `<button type="button" class="${on.has(k) ? 'on' : ''}" data-cat="${k}" data-label="${esc(label)}" aria-pressed="${on.has(k)}">${esc(label)}</button>`).join('');
    return { general: row(GENERAL), packs: row(PACKS) };
  };
  const LETTERS = ['A', 'B', 'C', 'D'];
  const KINDS = { choice: 'Pick one', number: 'Closest guess wins', order: 'Put them in order' };

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // A player's name in their colour.
  const who = p => `<span class="pname p${p.colour}">${esc(p.name)}</span>`;
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
  function connect(url, { onMessage, onState }) {
    let ws = null, wait = 500, closed = false, timer = null;
    let heard = 0, pinged = 0;   // last message in (pongs count), last ping out
    let due = 0;                 // when the next ping goes
    let retiring = [];           // sockets replaced, closed once the new one is open
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
    // a socket that has heard nothing for a long while.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || closed || !ws) return;
      if (ws.readyState > 1 || Date.now() - heard > GAP) reopen();
      else if (ws.readyState === 1 && !(pinged > heard)) ping();
    });
    open();
    // `heard` is when anything last came in, for a caller judging the line itself.
    return { send, ping, reopen, heard: () => heard, close: () => { closed = true; clearTimeout(timer); clearInterval(watch); retire(); ws && ws.close(); } };
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
  function finale(n) {
    const step = n > 1 ? Math.min(700, 4200 / (n - 1)) : 0;
    const winnerAt = n > 1 ? (n - 2) * step + 1400 : 600;
    // `first` says whether row k is a winner: everyone tied for first comes in together, last.
    return { step, winnerAt, done: winnerAt + 1100, at: (k, first) => (first ? winnerAt : (n - 1 - k) * step) };
  }

  const AWARDS = { quick: 'Quickest fingers', near: 'Best guesser', run: 'Longest run' };
  const awardDetail = a => a.kind === 'quick' ? `${(a.ms / 1000).toFixed(1)} s a right answer`
    : a.kind === 'run' ? `${a.n} right in a row` : '';   // Best guesser says it already
  const moveText = m => !m ? '' : `${m > 0 ? '↑' : '↓'}${Math.abs(m)}`;

  root.P = { CATS, GENERAL, PACKS, toggle, topicRows, LETTERS, KINDS, AWARDS, esc, who, ordinal, plural, thousands, connect, sync, now, countdown, wsUrl, finale, awardDetail, moveText };
})(window);
