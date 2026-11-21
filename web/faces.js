// The characters a guest can pick to sit beside their name: seventies kitsch and
// Australian backyard, drawn flat in the room's own colours. Each is one inline SVG
// on a 64 square, with no ids inside, so the same face can sit on a page many times.
//   Faces.ids        the 28 ids, in the order the picker shows them
//   Faces.name(id)   what to call one; '' for an id nobody drew
//   Faces.svg(id)    the whole <svg>…</svg> as a string; '' likewise
//   Faces.has(id)    whether there is such a face
(function (root) {
  const K = '#1C0D06', C = '#F7E8C9', M = '#F0B12B', O = '#E9682A', R = '#B93B1C', T = '#2C9686',
    D = '#4479B8', A = '#E2542C', P = '#F5A7BA', S = '#1B6F62', G = '#B9B0A5', V = '#C9D2D6',
    TN = '#D2924A', PA = '#DDA94B', BR = '#7A4420', W = '#FFF6DF';
  const NS = ' stroke="none"';
  const p = (d, f, x) => `<path d="${d}" fill="${f || 'none'}"${x || ''}/>`;
  const c = (x, y, r, f, e) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${f || 'none'}"${e || ''}/>`;
  const el = (x, y, rx, ry, f, e) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${f}"${e || ''}/>`;
  const rc = (x, y, w, h, r, f, e) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${f}"${e || ''}/>`;
  const n1 = v => +v.toFixed(1);
  const dot = (x, y, r) => c(x, y, r || 2.4, K, NS);
  // An eye: a cream ball and a pupil, pushed (dx, dy) off centre to look somewhere.
  const eye = (x, y, r, dx, dy) => c(x, y, r, C) + c(n1(x + (dx || 0)), n1(y + (dy || 0)), n1(r * .5), K, NS);
  // The same with the lid half down, in the colour of whatever it sits on.
  const lid = (x, y, r, f) => eye(x, y, r, 0, r * .4) + p(`M${n1(x - r)} ${y}a${r} ${r} 0 0 1 ${2 * r} 0z`, f);
  // A line with an outline: cords, straps, handles.
  const tube = (d, f, w) => p(d, '', ` stroke-width="${w}"`) + p(d, '', ` stroke="${f}" stroke-width="${n1(w - 4)}"`);
  const ring = (cx, cy, rad, n, fn, a0) => Array.from({ length: n }, (_, i) => {
    const a = (a0 || 0) + i * 2 * Math.PI / n;
    return fn(n1(cx + rad * Math.cos(a)), n1(cy + rad * Math.sin(a)));
  }).join('');

  const ART = {
    disco: ['Disco ball', () =>
      p('M32 3v11') + c(32, 36, 22, V)
      + rc(23, 17.5, 9, 8.5, 0, M, NS) + rc(22, 46.5, 10, 7.5, 0, P, NS) + rc(33, 46, 8, 8, 0, T, NS)
      + p('M10 36h44M13 25q19 4 38 0M13 47q19-4 38 0M32 14v44M22 16.5q-7 19.5 0 39M42 16.5q7 19.5 0 39', '', ' stroke-width="1.2" opacity=".5"')
      + p('M11 29h42') + p('M14 29h15v5a7.5 7.5 0 0 1-15 0zM35 29h15v5a7.5 7.5 0 0 1-15 0z', K)
      + p('M18 32.5h4M39 32.5h4', '', ` stroke="${C}" stroke-width="1.6"`)
      + p('M26 48q7 5 13-1') + p('M54 5l1.6 4.4 4.4 1.6-4.4 1.6-1.6 4.4-1.6-4.4-4.4-1.6 4.4-1.6z', M)],
    lava: ['Lava lamp', () =>
      p('M25 3h14l3 9H22z', M) + p('M22 12h20l8 34H14z', T)
      + c(26, 20, 3.6, M, NS) + c(38, 18, 2.2, O, NS) + el(25, 42, 5, 3, M, NS) + el(40, 41, 4, 3, O, NS) + c(33, 43, 1.8, O, NS)
      + lid(26, 30, 4.6, T) + lid(38, 30, 4.6, T) + p('M28 38q4 3 8 0')
      + p('M14 46h36l-6 9H20z', M) + p('M20 55h24l6 7H14z', R)],
    cocky: ['Cocky', () =>
      p('M22 24Q9 15 12 4Q22 9 28 20z', M) + p('M28 21Q21 8 30 3Q36 9 35 20z', M) + p('M34 21Q35 9 46 6Q46 15 40 23z', M)
      + p('M10 66Q10 46 30 46Q50 46 50 66z', C) + c(30, 34, 16, C) + c(25, 41, 3.2, M, NS)
      + p('M43 29q11 1 10 11q-1 6-8 8q2-7-5-9z', '#4E443C')
      + eye(36, 30, 4.6, 1.6, .4) + p('M28.5 23.5l12 3', '', ' stroke-width="3.2"')],
    ibis: ['Bin chicken', () =>
      p('M24 44C20 32 22 22 30 16l8 7C33 27 33 34 36 44z', C)
      + p('M40 8Q59 11 60 39Q51 25 39 21.5z', '#5A524B') + c(35, 15, 8.5, '#5A524B')
      + c(36, 13, 3.6, C, ' stroke-width="1.6"') + dot(36.8, 13, 1.5)
      + p('M13 42h34l-3 18q0 2-2 2H18q-2 0-2-2z', T) + rc(10, 38, 40, 6.5, 3, S)
      + p('M24 49v8M36 49v8', '', ' opacity=".4"')],
    maggie: ['Swooping maggie', () => {
      const s = p('M5 9L25 13Q45 18 51 36Q52 48 41 50Q25 47 15 27zM23 19Q29 3 51 3Q46 15 38 27zM17 26Q4 31 3 48Q14 43 27 36z', K);
      return `<g stroke="${C}" stroke-width="5">${s}</g>` + s
        + p('M30 13.5Q37 8 45 6.5Q41 12 36 19zM13.5 32.5Q8 36 6.5 43.5Q13 40 20 36.5zM28 25q10-1 14 5q-8-1-12 4z', C, NS)
        + p('M47 40l14 12-17-3z', '#E3E8E8') + c(42, 39, 4, M, NS) + dot(42.8, 39.6, 1.8)
        + p('M36.5 33.5l10 3.5', '', ' stroke-width="3.4"');
    }],
    roo: ['Aerobics roo', () =>
      p('M23 24Q11 10 17 2Q28 8 29 21z', TN) + p('M22 17Q17.5 10 19.5 6.5Q24 11 25 19z', P, NS)
      + p('M41 24Q53 10 47 2Q36 8 35 21z', TN) + p('M42 17Q46.5 10 44.5 6.5Q40 11 39 19z', P, NS)
      + p('M19 31Q19 17 32 17Q45 17 45 31L43 49Q41 60 32 60Q23 60 21 49z', TN) + el(32, 51.5, 8, 7, C, NS)
      + p('M19.2 26.5Q32 20.5 44.8 26.5v6.5Q32 27 19.2 33z', A) + p('M21 29.6Q32 24 43 29.6', '', ` stroke="${C}" stroke-width="1.5"`)
      + eye(26, 39.5, 3.6, .7, 0) + eye(38, 39.5, 3.6, -.7, 0) + p('M21.5 34.5l7.5 2M42.5 34.5l-7.5 2')
      + el(32, 48.5, 4, 2.8, K, NS) + p('M28 54.5q4 3 8 0') + p('M51 34q3.5 5 0 7q-3.5-2 0-7z', '#9CC5F2')],
    koala: ['Over-it koala', () =>
      c(13, 23, 10, G) + c(13, 23, 5, P, NS) + c(51, 23, 10, G) + c(51, 23, 5, P, NS) + el(32, 37, 20, 18, G)
      + lid(22.5, 34, 4.4, G) + lid(41.5, 34, 4.4, G)
      + p('M19 41q3.5 2 7 0M38 41q3.5 2 7 0', '', ' stroke-width="1.5"')
      + el(32, 41, 5.2, 7, K, NS) + p('M30 37.5q1-1.5 2.5-1.5', '', ` stroke="${G}" stroke-width="1.5"`)
      + p('M26 52h11') + p('M37 52q7-2 10 4q-7 2-10-4z', T)],
    pie: ['Meat pie', () =>
      p('M8 27L13 50Q32 58 51 50L56 27z', PA) + el(32, 26, 24, 10, '#C5853A') + el(32, 26, 18, 6, PA, NS)
      + p('M20 25q0-7 8-5q5-6 11-1q8-1 6 6q-1 5-8 3q-5 4-10 0q-7 1-7-3z', A)
      + eye(24, 40, 3.8, 0, .6) + eye(40, 40, 3.8, 0, .6) + p('M27 45.5h10q0 5.5-5 5.5t-5-5.5z', R)],
    snag: ['Snag in bread', () =>
      rc(12, 12, 40, 40, 8, PA) + rc(16.5, 16.5, 31, 31, 4.5, W, NS)
      + '<g transform="rotate(-38 32 32)">' + rc(2, 23.5, 60, 17, 8.5, R)
      + p('M6.5 32q2.5-5 5 0t5 0M47.5 32q2.5-5 5 0t5 0', '', ` stroke="${M}"`)
      + eye(26, 30, 3, 0, .5) + eye(38, 30, 3, 0, .5) + p('M28 35.5q4 3 8 0') + '</g>'],
    goon: ['Goon bag', () =>
      rc(40, 48, 10, 10, 2.5, A) + rc(48.5, 51, 7, 4.5, 1.5, R)
      + p('M9 13Q32 20 55 13Q50 33 55 53Q32 46 9 53Q14 33 9 13z', V)
      + p('M19 21q9 3 18 2', '', ' stroke="#fff" stroke-width="2.2"') + p('M11.5 16l6 5M52.5 16l-6 5M11.5 50l6-5', '', ' stroke-width="1.4"')
      + c(17.5, 38, 3.2, P, NS) + c(46.5, 38, 3.2, P, NS)
      + eye(24, 30, 5.4, 1.2, 1.2) + eye(40, 31, 3.6, -1, -.6) + p('M23 41q3 4.5 6 0t6 0 6 0')],
    coffee: ['Iced coffee', () =>
      rc(22, 3.5, 20, 7, 1.5, C) + p('M16 22l6-12h20l6 12z', C) + el(32, 16, 2.6, 3.6, BR, NS)
      + rc(16, 22, 32, 39, 2.5, M) + p('M16 49q8-6 16 0t16 0v9.5q0 2.5-2.5 2.5h-27q-2.5 0-2.5-2.5z', BR)
      + c(25, 33, 5.6, C) + dot(25, 33, 1.7) + c(39, 33, 5.6, C) + dot(39, 33, 1.7)
      + p('M19.5 25l8 1.5M44.5 24.5l-8 2')
      + rc(25, 41, 14, 5, 2, C) + p('M29.7 41v5M34.3 41v5', '', ' stroke-width="1.5"')],
    thong: ['Thong', () =>
      '<g transform="rotate(14 32 32)">' + p('M32 3C45 3 50 17 48 32C47 46 44 61 32 61C20 61 17 46 16 32C14 17 19 3 32 3z', D)
      + tube('M19.5 36Q21 23 32 14.5Q43 23 44.5 36', M, 7.5) + c(32, 14.5, 2.6, M)
      + p('M24 45q3-4 6 0M34 45q3-4 6 0') + p('M27 51q5 4 10 0') + '</g>'],
    esky: ['Esky', () =>
      tube('M15 22v-10q0-4 4-4h26q4 0 4 4v10', G, 7)
      + p('M9 28h46l-2 28q0 4-4 4H15q-4 0-4-4z', A) + p('M10.2 47h43.6', '', ` stroke="${C}" stroke-width="3"`)
      + rc(6, 19, 52, 10, 3.5, C) + rc(28.5, 25, 7, 7, 2, M)
      + eye(23, 39, 4.2, 0, .8) + eye(41, 39, 4.2, 0, .8) + p('M26 51q6 5 12 0')],
    phone: ['Rotary phone', () =>
      p('M11 59Q9 37 21 30h22Q55 37 53 59z', O)
      + p('M7 24Q6 10 19 10h26Q58 10 57 24q0 3-3 3h-7q-3 0-3-3v-2.5H23V24q0 3-3 3h-7q-3 0-3-3z', R)
      + eye(24.5, 34.5, 3.2, 0, -.6) + eye(39.5, 34.5, 3.2, 0, -.6)
      + c(32, 48, 9.5, C) + ring(32, 48, 6.2, 7, (x, y) => dot(x, y, 1.5), .4) + c(32, 48, 2.6, M, ' stroke-width="1.5"')],
    tape: ['Mixtape', () =>
      rc(4, 13, 56, 40, 4.5, T) + rc(9, 17.5, 46, 25, 3, C) + p('M10.5 22h43', '', ` stroke="${O}" stroke-width="3"`)
      + eye(21.5, 32.5, 6.2, 1, 0) + eye(42.5, 32.5, 6.2, -1, 0) + p('M28 37.5q4 3.5 8 0')
      + p('M16 53l3.5-7.5h25L48 53z', S) + dot(26, 49.5, 1.4) + dot(38, 49.5, 1.4)],
    skate: ['Roller skate', () =>
      c(22, 54, 7.5, A) + c(22, 54, 2.4, C, NS) + c(46, 54, 7.5, A) + c(46, 54, 2.4, C, NS) + c(57.5, 46.5, 3.2, O)
      + rc(11, 42.5, 45, 5.5, 2.5, M) + p('M12 7h19l1.5 16Q50 26 54 37v6H12z', P) + rc(10, 4, 23, 7.5, 3.7, C)
      + p('M32.2 15.5h-7M32.8 21h-7', '', ' stroke-width="2"')
      + eye(24.5, 31, 3.5, .8, 0) + eye(36, 32, 3.5, .8, 0) + p('M26 38q5 3 10 1')],
    host: ['The host', () =>
      p('M6 66Q8 51 24 50h16Q56 51 58 66z', T) + c(17, 31, 3.6, M) + c(47, 31, 3.6, M) + rc(18, 12, 28, 38, 13, M)
      + p('M16.5 31Q11 5 33 5Q54 5 47.5 31Q47 21 42 17Q30 21 20 19Q17 24 16.5 31z', R)
      + dot(26, 30) + dot(38, 30) + p('M22 25q4-3 8-1M34 24q4-2 8 1', '', ' stroke-width="2"')
      + p('M25 43h14q0 5.5-7 5.5t-7-5.5z', C)
      + p('M32 37.5Q24 31 16 41Q25 45.5 32 40.5Q39 45.5 48 41Q40 31 32 37.5z', R)
      + p('M32 56L21 50.5v11zM32 56l11-5.5v11z', P) + c(32, 56, 2.6, P)],
    perm: ['The perm', () =>
      ring(32, 31, 17.5, 9, (x, y) => c(x, y, 9.5, O), -1.57) + c(32, 31, 20, O, NS)
      + p('M23 12q4-4 8 0M41 14q5 1 5 6M10 29q0-5 5-5M49 50q4-2 4-6M14 47q2 4 6 4M33 20q4-2 6 2', '', ' stroke-width="1.7" opacity=".55"')
      + p('M16.5 32.5l-5-2M47.5 32.5l5-2M30 33q2-2 4 0') + c(23.5, 34.5, 7.2, T) + c(40.5, 34.5, 7.2, T)
      + p('M19.5 33q1-3 4-3.5M36.5 33q1-3 4-3.5', '', ` stroke="${C}" stroke-width="1.6"`)
      + p('M27 48q5 3.5 10 0')],
    vinyl: ['Vinyl', () =>
      c(32, 32, 28, K, ` stroke="${C}"`) + c(32, 32, 23, '', ' stroke="#6A4532" stroke-width="1.2"') + c(32, 32, 18.5, '', ' stroke="#6A4532" stroke-width="1.2"')
      + p('M9.5 24A24 24 0 0 1 24 9.5M54.5 40A24 24 0 0 1 40 54.5', '', ` stroke="${C}" stroke-width="2" opacity=".55"`)
      + c(32, 32, 14, A) + dot(26.5, 29, 2.3) + dot(37.5, 29, 2.3) + c(32, 33, 1.6, C, NS) + p('M25.5 36.5q6.5 5.5 13 0')],
    macrame: ['Macramé fern', () =>
      tube('M32 4L16 37M32 4L48 37M20 50l12 8 12-8', PA, 6.5)
      + p('M30 36Q22 12 6 20Q18 22 24 38z', T) + p('M34 36Q42 12 58 20Q46 22 40 38z', T)
      + p('M22 37Q8 34 5 47Q14 39 26 40z', T) + p('M42 37Q56 34 59 47Q50 39 38 40z', T) + p('M27 36Q24 12 32 7Q40 12 37 36z', T)
      + p('M28.5 57h7l2 7h-11z', C) + p('M17 38h30l-4 16q-11 5-22 0z', O) + rc(15, 34, 34, 6.5, 2.5, R)
      + eye(26, 46, 3.3, 0, .5) + eye(38, 46, 3.3, 0, .5) + p('M29 51q3 2.5 6 0')],
    fondue: ['Fondue', () =>
      tube('M24 27L15 7M41 27L49 8', G, 6) + c(15, 6.5, 3.4, T) + c(49, 7.5, 3.4, P)
      + p('M19 48l-5 14h5l6-11zM45 48l5 14h-5l-6-11z', BR) + p('M32 63.5q-6-4 0-10q6 6 0 10z', M)
      + rc(52, 30, 10, 5.5, 2.7, BR) + p('M11 25h42v8q0 20-21 20T11 33z', A)
      + p('M11 25h42v5q-2 5-5 0q-3 9-7 0q-3 6-6 0q-4 10-8 0q-3 5-6 0q-3 8-6 0q-2 3-4 0z', M)
      + eye(25, 42, 3.6, 0, .6) + eye(39, 42, 3.6, 0, .6) + p('M28 47.5q4 3 8 0')],
    pineapple: ['Pineapple', () =>
      p('M24 27Q16 15 9 13Q20 9 29 22z', T) + p('M40 27Q48 15 55 13Q44 9 35 22z', T)
      + p('M27 25Q19 9 22 4Q30 9 32 22z', S) + p('M37 25Q45 9 42 4Q34 9 32 22z', S) + p('M28 25Q27 9 32 2Q37 9 36 25z', T)
      + el(32, 42, 17, 20, M)
      + p('M22 30l20 22M18 40l14 18M30 26l16 18M42 30L22 52M46 40L32 58M34 26L18 44', '', ' stroke="#B97A12" stroke-width="1.3"')
      + eye(25.5, 38, 4.2, .8, 0) + eye(38.5, 38, 4.2, .8, 0) + p('M23 46h18q-1 8-9 8t-9-8z', C) + p('M24.5 49.5h15', '', ' stroke-width="1.4"')],
    prawn: ['Raw prawn', () =>
      tube('M47 19Q59 21 61 36M46 22Q54 28 53 41', O, 6) + p('M40 9l17-4.5-9 10z', A)
      + p('M42 45l15-6-3 10 5 9-15-3z', A)
      + p('M42 9C22 5 7 20 9 38C11 53 30 62 46 53L41 44C32 49 22 45 21 36C20 28 28 22 41 24z', O)
      + p('M30 9l3 13.5M19 15l8 10M11 27l11 4M10 41l11-3M17 52l8-9M31 58l2-11', '', ' stroke-width="1.8"')
      + p('M27 30l5 3M25 36h6M28 42l4-3', '', ` stroke="${O}"`)
      + eye(44, 14.5, 4.6, 1.2, 0) + p('M35 18.5q2 3 5 1.5', '', ' stroke-width="2"')],
    shark: ['Shark', () =>
      p('M16 44L3 56h13zM48 44l13 12H48z', D) + p('M32 3C46 13 52 34 50 62H14C12 34 18 13 32 3z', D)
      + p('M21 62C21 50 24 40 32 40C40 40 43 50 43 62z', C, NS)
      + p('M17 36Q32 43 47 36Q46 54 32 54Q18 54 17 36z', R)
      + p('M17 36l4.5 6.5 3-4 3.5 5.5 4-4.5 4 4.5 3.5-5.5 3 4 4.5-6.5Q32 43 17 36z', C, ' stroke-width="1.6"')
      + dot(22.5, 27, 2.8) + dot(41.5, 27, 2.8) + p('M17.5 21.5l8 3M46.5 21.5l-8 3')
      + p('M1 59q5.2-5 10.4 0t10.4 0 10.4 0 10.4 0 10.4 0 10.4 0v7H1z', T)],
    croc: ['Croc', () =>
      '<g transform="translate(0 4)">' + p('M24 34L61 25 58 44z', '#6E2410') + p('M6 27l2-9 4 5 3-7 3 6z', S)
      + p('M6 34L24 34L58 44Q60 50 54 50L16 52Q6 50 6 34z', '#8ED1BC')
      + p('M32 36.4l2.5-4.5L37 37.8l2.5-4.5L42 39.3l2.5-4.5L47 40.8l2.5-4.5L52 42.2z', W, ' stroke-width="1.5"')
      + p('M6 34Q4 18 18 16Q22 6 31 15L56 18Q62 19 61 25L24 34z', T)
      + p('M30 32.5l2.5 5L35 31.3l2.5 5L40 30.1l2.5 5L45 28.9l2.5 5L50 27.7l2.5 5L55 26.5z', W, ' stroke-width="1.5"')
      + c(23, 17, 4.8, M) + el(23, 17, 1.4, 3.6, K, NS) + dot(55.5, 21, 1.3) + '</g>'],
    wombat: ['Wombat', () =>
      c(16, 23, 5.5, '#A06B3C') + c(48, 23, 5.5, '#A06B3C') + el(20, 58, 7, 4, TN) + el(44, 58, 7, 4, TN)
      + rc(7, 19, 50, 39, 19, '#A06B3C')
      + dot(20, 35, 2.6) + dot(44, 35, 2.6) + p('M15 29l9 3.5M49 29l-9 3.5')
      + el(32, 42, 8.5, 6, '#4A2713') + p('M28 40q2-1.5 4-1.5', '', ' stroke="#A06B3C" stroke-width="1.5"') + p('M28 53q4-3 8 0')],
    cactus: ['Cactus in flares', () =>
      rc(12, 58, 18, 6, 2.5, M) + rc(34, 58, 18, 6, 2.5, M)
      + tube('M24 31h-6q-6 0-6-6v-7M40 27h7q6 0 6-6v-8', T, 10.5)
      + rc(22, 5, 20, 40, 10, T) + c(38.5, 6.5, 3.6, P)
      + p('M22 41h20l8 19H34l-2-10-2 10H14z', D) + rc(21.5, 38.5, 21, 4.5, 1.5, R)
      + eye(28, 20, 3.3, .7, 0) + eye(37, 20, 3.3, .7, 0) + p('M28 27.5q5 3.5 9-.5')],
    fairy: ['Fairy bread', () =>
      p('M32 6L58 55H6z', PA) + p('M32 15.5L50.5 50.5h-37z', W, NS)
      + [[32, 22, A], [28, 28, T], [36.5, 29, D], [32, 31, P], [19, 44, D], [45, 44, T], [17.5, 48, A], [46.5, 48, D], [23, 48, T], [41, 48, P]].map(s => c(s[0], s[1], 1.8, s[2], NS)).join('')
      + eye(26, 39, 3.8, 0, -.5) + eye(38, 39, 3.8, 0, -.5) + p('M27.5 44.5h9q0 4.5-4.5 4.5t-4.5-4.5z', A)],
  };

  const ids = Object.keys(ART);
  const has = id => typeof id === 'string' && Object.prototype.hasOwnProperty.call(ART, id);
  const made = {};
  function svg(id) {
    if (!has(id)) return '';
    return made[id] || (made[id] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true">'
      + `<g stroke="${K}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">${ART[id][1]()}</g></svg>`);
  }
  const Faces = { ids, has, svg, name: id => (has(id) ? ART[id][0] : '') };
  root.Faces = Faces;
  if (typeof module === 'object' && module && module.exports) module.exports = Faces;
})(typeof window !== 'undefined' ? window : globalThis);
