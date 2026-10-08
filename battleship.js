'use strict';
// ⚓ Морской бой: сайт ↔ сайт, сайт ↔ Telegram, Telegram ↔ Telegram.
// Один общий движок игры, у каждого лобби свой случайный код (меняется при каждом создании).
// Игры хранятся в памяти сервера (после перезапуска Render активные партии сбрасываются).
const crypto = require('crypto');

const N = 10;
const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]; // классика: 1×4, 2×3, 3×2, 4×1. Корабли не касаются друг друга
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих символов (0/O, 1/I)
const COLS = 'ABCDEFGHIJ';

const games = new Map();  // код -> игра
const active = new Map(); // ключ игрока -> код его текущей игры (один игрок = одна игра)
const rnd = n => crypto.randomInt(n);
const grid = v => Array.from({ length: N }, () => Array(N).fill(v));
const inb = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const cellName = (r, c) => COLS[c] + (r + 1);
const normCode = t => { const c = String(t || '').trim().toUpperCase(); return /^[A-Z0-9]{6}$/.test(c) ? c : null; };

let botApi = null, botNameFn = () => '', siteUrl = '';
const links = {
  tg: code => (botNameFn() ? `https://t.me/${botNameFn()}?start=bs_${code}` : ''),
  site: code => (siteUrl ? `${siteUrl}/battleship?code=${code}` : ''),
};

// ---------- расстановка ----------
const cellsOf = s => Array.from({ length: s.len }, (_, i) => [s.r + (s.h ? 0 : i), s.c + (s.h ? i : 0)]);

function validFleet(list) {
  if (!Array.isArray(list) || list.length !== FLEET.length) return null;
  if (!list.every(s => s && Number.isInteger(s.len) && Number.isInteger(s.r) && Number.isInteger(s.c) && typeof s.h === 'boolean')) return null;
  if (list.map(s => s.len).sort((a, b) => b - a).join() !== FLEET.join()) return null;
  const occ = grid(-1), ships = [];
  for (let i = 0; i < list.length; i++) {
    const cells = cellsOf(list[i]);
    for (const [r, c] of cells) { if (!inb(r, c) || occ[r][c] !== -1) return null; occ[r][c] = i; }
    ships.push({ cells, hits: 0 });
  }
  for (let i = 0; i < ships.length; i++) for (const [r, c] of ships[i].cells)
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (inb(rr, cc) && occ[rr][cc] !== -1 && occ[rr][cc] !== i) return null; // корабли касаются
    }
  return { ships, occ };
}

function randomFleet() {
  for (;;) {
    const list = [], blocked = grid(0); let ok = true;
    for (const len of FLEET) {
      let placed = false;
      for (let t = 0; t < 200 && !placed; t++) {
        const h = rnd(2) === 0, s = { r: rnd(h ? N : N - len + 1), c: rnd(h ? N - len + 1 : N), len, h };
        if (cellsOf(s).every(([r, c]) => !blocked[r][c])) {
          for (const [r, c] of cellsOf(s)) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (inb(r + dr, c + dc)) blocked[r + dr][c + dc] = 1;
          list.push(s); placed = true;
        }
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return list;
  }
}

function applyFleet(p, list) {
  const v = validFleet(list); if (!v) return false;
  p.ships = v.ships; p.board = v.occ; p.shots = grid(0); return true;
}

// ---------- игра ----------
function newCode() { for (;;) { let c = ''; for (let i = 0; i < 6; i++) c += ALPHA[rnd(ALPHA.length)]; if (!games.has(c)) return c; } }
const mkPlayer = (key, name, plat, chat) => ({ key, name: String(name || 'Игрок').slice(0, 32), plat, chat: chat || null,
  ships: null, board: grid(-1), shots: grid(0), ready: false, col: null, tg: null, q: Promise.resolve(), seen: Date.now() });
const idxOf = (g, key) => g.players.findIndex(p => p && p.key === key);
const gameOf = key => { const c = active.get(key); const g = c && games.get(c); return g && idxOf(g, key) >= 0 ? g : null; };
const touch = g => { g.updated = Date.now(); };
const notSunk = s => s.hits < s.cells.length;

function createGame(p) {
  const g = { code: newCode(), players: [p, null], phase: 'lobby', turn: 0, winner: null, reason: null, log: [], created: Date.now(), updated: Date.now() };
  games.set(g.code, g); active.set(p.key, g.code); return g;
}

function joinGame(g, p) {
  g.players[1] = p; g.phase = 'place'; active.set(p.key, g.code); touch(g);
  for (const q of g.players) if (q.plat === 'tg' && !q.ships) applyFleet(q, randomFleet()); // в Telegram расстановка случайная, можно перемешать
}

function setReady(g, i) {
  const p = g.players[i];
  if (g.phase !== 'place' || !p.ships) return false;
  p.ready = true; touch(g);
  if (g.players[0].ready && g.players[1] && g.players[1].ready) { g.phase = 'play'; g.turn = rnd(2); }
  return true;
}

function finish(g, winner, reason) {
  g.phase = 'over'; g.winner = winner; g.reason = reason; touch(g);
  for (const p of g.players) if (p) active.delete(p.key);
}

function shoot(g, i, r, c) {
  if (g.phase !== 'play') return { err: 'Игра сейчас не идёт' };
  if (g.turn !== i) return { err: 'Сейчас ход соперника' };
  if (!Number.isInteger(r) || !Number.isInteger(c) || !inb(r, c)) return { err: 'Неверная клетка' };
  const o = g.players[1 - i];
  if (o.shots[r][c]) return { err: 'Сюда уже стреляли' };
  o.shots[r][c] = 1; touch(g);
  const si = o.board[r][c], ev = { w: i, c: cellName(r, c) };
  if (si < 0) { g.turn = 1 - i; ev.r = 'miss'; g.log.push(ev); return { res: 'miss' }; }
  const sh = o.ships[si]; sh.hits++;
  if (notSunk(sh)) { ev.r = 'hit'; g.log.push(ev); return { res: 'hit' }; } // попал — стреляешь ещё раз
  for (const [rr, cc] of sh.cells) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) // вокруг потопленного клетки открываются сами
    if (inb(rr + dr, cc + dc) && o.board[rr + dr][cc + dc] < 0) o.shots[rr + dr][cc + dc] = 1;
  if (o.ships.every(s => !notSunk(s))) { ev.r = 'win'; g.log.push(ev); finish(g, i, 'win'); return { res: 'win' }; }
  ev.r = 'sunk'; g.log.push(ev); return { res: 'sunk' };
}

// выход / сдача. Возвращает { g, deleted } или null
function quit(key) {
  const code = active.get(key); if (!code) return null;
  active.delete(key);
  const g = games.get(code); if (!g) return null;
  const i = idxOf(g, key); if (i < 0) return null;
  if (g.phase === 'lobby') { games.delete(code); return { g, deleted: true }; }
  if (g.phase === 'place') finish(g, 1 - i, 'left');
  else if (g.phase === 'play') finish(g, 1 - i, 'surrender');
  return { g, deleted: false };
}

function viewFor(g, i) {
  const me = g.players[i], o = g.players[1 - i], over = g.phase === 'over';
  const mine = grid(0), enemy = grid(0);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { // 0 вода, 1 корабль, 2 попали в корабль, 3 мимо
    const b = me.board[r][c], s = me.shots[r][c];
    mine[r][c] = b >= 0 ? (s ? 2 : 1) : (s ? 3 : 0);
  }
  if (o) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { // 0 не стреляли, 1 мимо, 2 попали, 3 потоплен, 4 (в конце игры) нераскрытый корабль
    const b = o.board[r][c];
    if (o.shots[r][c]) enemy[r][c] = b < 0 ? 1 : (o.ships[b].hits >= o.ships[b].cells.length ? 3 : 2);
    else if (over && b >= 0) enemy[r][c] = 4;
  }
  const started = g.phase === 'play' || over;
  return {
    code: g.code, phase: g.phase,
    me: { name: me.name, ready: me.ready, plat: me.plat },
    opp: o ? { name: o.name, ready: o.ready, plat: o.plat } : null,
    turn: g.phase === 'play' ? (g.turn === i ? 'me' : 'opp') : null,
    winner: g.winner == null ? null : (g.winner === i ? 'me' : 'opp'), reason: g.reason,
    mine, enemy,
    myLeft: started && me.ships ? me.ships.filter(notSunk).map(s => s.cells.length) : [],
    oppLeft: started && o && o.ships ? o.ships.filter(notSunk).map(s => s.cells.length) : [],
    log: g.log.slice(-6).map(e => ({ you: e.w === i, c: e.c, r: e.r })),
    tg: botNameFn() || '',
  };
}

// ---------- Telegram: тексты ----------
const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const HDR = '　ＡＢＣＤＥＦＧＨＩＪ';
const E_MINE = ['🟦', '🟩', '🟥', '⬜'];
const E_ENEMY = ['🟦', '⬜', '🟥', '⬛', '🟩'];
const board = (cells, em) => HDR + '\n' + cells.map((row, r) => NUM[r] + row.map(v => em[v]).join('')).join('\n');
const platName = p => (p.plat === 'tg' ? 'Telegram' : 'сайт');
const evText = e => `${e.you ? 'Вы' : 'Соперник'} → ${e.c}: ` + ({ miss: 'мимо 💧', hit: 'попадание 🔥', sunk: 'корабль потоплен ☠️', win: 'последний корабль потоплен 🏆' }[e.r] || '');

function tgText(g, i) {
  const v = viewFor(g, i), me = g.players[i], o = g.players[1 - i], L = [];
  if (g.phase === 'lobby') {
    L.push('⚓ <b>Морской бой</b>', '', `🔑 Код лобби: <code>${g.code}</code> (нажмите на код, чтобы скопировать)`, '',
      'Отправьте код другу. Он может войти по нему и в этом боте («🔑 Войти по коду»), и на сайте — раздел «Морской бой».');
    if (links.tg(g.code)) L.push('', 'Ссылка для Telegram:', links.tg(g.code));
    if (links.site(g.code)) L.push('', 'Ссылка для сайта:', links.site(g.code));
    L.push('', '⏳ Ждём соперника…');
    return L.join('\n');
  }
  L.push(`⚓ <b>Морской бой</b> · <code>${g.code}</code>`, `👤 Соперник: <b>${esc(o.name)}</b> (${platName(o)})`, '');
  if (g.phase === 'place') {
    L.push('🧭 Расстановка кораблей. Ваше поле:', board(v.mine, E_MINE), '');
    if (me.ready) L.push(o.ready ? '✅ Оба готовы…' : '✅ Вы готовы. Ждём, пока соперник расставит корабли…');
    else L.push('Не нравится — «🎲 Перемешать». Нравится — «✅ Готов».', o.ready ? '(соперник уже готов)' : '');
    return L.join('\n');
  }
  if (g.phase === 'play') {
    L.push(v.turn === 'me' ? '🎯 <b>Ваш ход</b>. Выберите столбец кнопками или напишите клетку, например <code>B5</code>' : '⏳ <b>Ход соперника</b>…', '',
      'Поле соперника:', board(v.enemy, E_ENEMY), '', 'Ваше поле:', board(v.mine, E_MINE), '',
      `Кораблей: вы ${v.myLeft.length} · соперник ${v.oppLeft.length}`);
    if (v.log.length) L.push(evText(v.log[v.log.length - 1]));
    return L.join('\n');
  }
  const why = v.winner === 'me' ? { surrender: 'Соперник сдался', left: 'Соперник вышел из игры' }[v.reason] : { surrender: 'Вы сдались', left: 'Вы вышли из игры' }[v.reason];
  L.push(v.winner === 'me' ? '🏆 <b>Вы победили!</b>' : '💀 <b>Вы проиграли</b>', why || '', '', 'Поле соперника:', board(v.enemy, E_ENEMY), '', 'Ваше поле:', board(v.mine, E_MINE));
  return L.join('\n');
}

function tgKb(g, i, IK) {
  const k = new IK(), p = g.players[i], c = g.code;
  if (g.phase === 'lobby') k.text('❌ Отменить лобби', `bs:x:${c}`);
  else if (g.phase === 'place') {
    if (!p.ready) k.text('🎲 Перемешать', `bs:rnd:${c}`).text('✅ Готов', `bs:ok:${c}`).row();
    k.text('🚪 Выйти', `bs:x:${c}`);
  } else if (g.phase === 'play') {
    if (g.turn === i) {
      const o = g.players[1 - i];
      if (p.col == null) for (let n = 0; n < N; n++) { k.text(COLS[n], `bs:c:${c}:${n}`); if (n % 5 === 4) k.row(); }
      else {
        for (let n = 0; n < N; n++) { k.text(o.shots[n][p.col] ? '✖' : String(n + 1), o.shots[n][p.col] ? 'bs:n' : `bs:r:${c}:${n}`); if (n % 5 === 4) k.row(); }
        k.text(`⬅️ Другой столбец (сейчас ${COLS[p.col]})`, `bs:b:${c}`).row();
      }
    }
    k.text('🏳 Сдаться', `bs:x:${c}`);
  } else k.text('⚓ Новая игра', 'bs').text('⬅️ В меню', 'home');
  return k;
}

// ---------- сайт (HTTP API) ----------
function site(app, getUser, opts = {}) {
  siteUrl = (opts.siteUrl || '').replace(/\/+$/, ''); if (opts.botName) botNameFn = opts.botName;
  const auth = async (req, res, next) => {
    const u = await getUser(req).catch(() => null);
    if (!u) return res.status(401).json({ error: 'Войдите через Steam' });
    req.bs = { key: 's:' + u.steam_id, name: u.name || 'Игрок' }; next();
  };
  const bad = (res, error, code = 400) => res.status(code).json({ error });
  const find = req => { const code = normCode(req.body?.code || req.query?.code); const g = code && games.get(code); const i = g ? idxOf(g, req.bs.key) : -1; return g && i >= 0 ? { g, i } : null; };
  const leaveOld = key => { const q = quit(key); if (q) pushAll(q.g); };

  app.get('/api/bs/mine', auth, (req, res) => { const g = gameOf(req.bs.key); res.json({ code: g ? g.code : null }); });

  app.post('/api/bs/create', auth, (req, res) => {
    leaveOld(req.bs.key);
    const g = createGame(mkPlayer(req.bs.key, req.bs.name, 'site'));
    res.json({ code: g.code });
  });

  app.post('/api/bs/join', auth, (req, res) => {
    const code = normCode(req.body?.code); if (!code) return bad(res, 'Код лобби — 6 символов, например K7M2QX');
    const g = games.get(code); if (!g) return bad(res, 'Лобби с таким кодом нет. Проверьте код — он каждый раз новый');
    if (g.players[0].key === req.bs.key) return res.json({ code }); // это ваше же лобби
    if (g.phase !== 'lobby') return bad(res, 'В этом лобби уже идёт игра');
    leaveOld(req.bs.key);
    joinGame(g, mkPlayer(req.bs.key, req.bs.name, 'site'));
    pushAll(g); res.json({ code });
  });

  app.get('/api/bs/state', auth, (req, res) => {
    const f = find(req); if (!f) return bad(res, 'Игра не найдена', 404);
    f.g.players[f.i].seen = Date.now(); res.json(viewFor(f.g, f.i));
  });

  app.post('/api/bs/ready', auth, (req, res) => {
    const f = find(req); if (!f) return bad(res, 'Игра не найдена', 404);
    if (f.g.phase !== 'place') return bad(res, 'Сейчас нельзя расставлять корабли');
    const p = f.g.players[f.i]; if (p.ready) return res.json({ ok: true });
    if (!applyFleet(p, req.body?.ships)) return bad(res, 'Неверная расстановка: нужно 10 кораблей (1×4, 2×3, 3×2, 4×1), и они не должны касаться');
    setReady(f.g, f.i); pushAll(f.g); res.json({ ok: true });
  });

  app.post('/api/bs/shoot', auth, (req, res) => {
    const f = find(req); if (!f) return bad(res, 'Игра не найдена', 404);
    const r = shoot(f.g, f.i, req.body?.r, req.body?.c); if (r.err) return bad(res, r.err);
    pushAll(f.g); res.json({ res: r.res });
  });

  app.post('/api/bs/leave', auth, (req, res) => {
    const f = find(req); if (!f) return res.json({ ok: true });
    const q = quit(req.bs.key); if (q) pushAll(q.g); res.json({ ok: true });
  });
}

// ---------- Telegram: бот ----------
async function pushOne(g, i, fresh, IK) {
  const p = g.players[i]; if (!p || p.plat !== 'tg' || !botApi) return;
  p.q = p.q.then(async () => {
    const text = tgText(g, i), extra = { parse_mode: 'HTML', reply_markup: tgKb(g, i, IK), link_preview_options: { is_disabled: true } };
    if (p.tg && !fresh) {
      try { await botApi.editMessageText(p.chat, p.tg, text, extra); return; }
      catch (e) { if (/not modified/i.test(e.message)) return; }
    }
    if (p.tg && fresh) botApi.deleteMessage(p.chat, p.tg).catch(() => {});
    try { p.tg = (await botApi.sendMessage(p.chat, text, extra)).message_id; } catch (e) { console.error('bs push:', e.message); }
  }).catch(() => {});
}
let pushIK = null;
function pushAll(g) { if (pushIK) g.players.forEach((p, i) => pushOne(g, i, false, pushIK)); }

function telegram({ bot, InlineKeyboard, show, botName, siteUrl: su }) {
  botApi = bot.api; pushIK = InlineKeyboard; if (botName) botNameFn = botName; if (su) siteUrl = String(su).replace(/\/+$/, '');
  const awaiting = new Map(); // tg-ключ -> время: ждём от человека код лобби
  const who = ctx => mkPlayer('t:' + ctx.from.id, ctx.from.first_name || ctx.from.username || 'Игрок', 'tg', ctx.chat.id);
  const leaveOld = key => { const q = quit(key); if (q) pushAll(q.g); };

  const menu = async ctx => {
    awaiting.delete('t:' + ctx.from.id);
    const g = gameOf('t:' + ctx.from.id);
    const k = new InlineKeyboard().text('🆕 Создать лобби', 'bs:new').text('🔑 Войти по коду', 'bs:join').row();
    if (g) k.text(`▶️ Продолжить игру (${g.code})`, `bs:go:${g.code}`).row();
    k.text('⬅️ Назад', 'home');
    return show(ctx, '⚓ Морской бой\n\nИграйте с другом: оба в Telegram или один здесь, а второй на сайте. Создайте лобби — получите код и отправьте его другу. Код каждый раз новый.', k);
  };

  const create = async ctx => {
    const p = who(ctx); leaveOld(p.key);
    const g = createGame(p);
    if (ctx.callbackQuery) p.tg = ctx.callbackQuery.message.message_id;
    await pushOne(g, 0, !ctx.callbackQuery, InlineKeyboard);
  };

  const join = async (ctx, code) => {
    const g = games.get(code), key = 't:' + ctx.from.id;
    if (!g) return ctx.reply('🤷 Лобби с таким кодом нет. Проверьте код — он каждый раз новый.', { reply_markup: new InlineKeyboard().text('🔑 Ввести код ещё раз', 'bs:join').row().text('⚓ Меню', 'bs') });
    if (g.players[0].key === key) return ctx.reply('Это ваше собственное лобби — отправьте код другу 🙂');
    if (g.phase !== 'lobby') return ctx.reply('В этом лобби уже идёт игра 😕', { reply_markup: new InlineKeyboard().text('⚓ Меню', 'bs') });
    leaveOld(key);
    const p = who(ctx); joinGame(g, p);
    if (ctx.callbackQuery) p.tg = ctx.callbackQuery.message.message_id;
    pushOne(g, 1, !ctx.callbackQuery, InlineKeyboard); pushOne(g, 0, false, InlineKeyboard);
  };

  bot.command(['bs', 'battleship', 'seabattle'], menu);
  bot.command('join', ctx => { const code = normCode(ctx.match); return code ? join(ctx, code) : ctx.reply('Напишите так: /join КОД (6 символов)'); });
  bot.callbackQuery('bs', async ctx => { await ctx.answerCallbackQuery().catch(() => {}); return menu(ctx); });
  bot.callbackQuery('bs:n', ctx => ctx.answerCallbackQuery({ text: 'Сюда уже стреляли' }).catch(() => {}));
  bot.callbackQuery('bs:new', async ctx => { await ctx.answerCallbackQuery().catch(() => {}); return create(ctx); });
  bot.callbackQuery('bs:join', async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    awaiting.set('t:' + ctx.from.id, Date.now());
    return show(ctx, '🔑 Пришлите код лобби (6 символов, например K7M2QX).\n\nКод вам должен отправить друг, который создал лобби.', new InlineKeyboard().text('⬅️ Назад', 'bs'));
  });

  bot.callbackQuery(/^bs:(c|r|b|ok|rnd|x|go):([A-Z0-9]{6})(?::(\d+))?$/, async ctx => {
    const [, act, code, arg] = ctx.match, key = 't:' + ctx.from.id, g = games.get(code), i = g ? idxOf(g, key) : -1;
    if (i < 0) { await ctx.answerCallbackQuery({ text: 'Игра не найдена или уже закончилась' }).catch(() => {}); return menu(ctx); }
    const p = g.players[i]; p.tg = ctx.callbackQuery.message.message_id; p.chat = ctx.chat.id;
    let alert = '';
    if (act === 'c' && g.phase === 'play' && g.turn === i) { p.col = Math.min(+arg, N - 1); await pushOne(g, i, false, InlineKeyboard); }
    else if (act === 'b') { p.col = null; await pushOne(g, i, false, InlineKeyboard); }
    else if (act === 'r') {
      const col = p.col; p.col = null;
      if (col == null) alert = 'Сначала выберите столбец';
      else { const r = shoot(g, i, +arg, col); if (r.err) alert = r.err; pushAll(g); }
    } else if (act === 'rnd') {
      if (g.phase === 'place' && !p.ready) applyFleet(p, randomFleet());
      await pushOne(g, i, false, InlineKeyboard);
    } else if (act === 'ok') { setReady(g, i); pushAll(g); }
    else if (act === 'x') {
      const q = quit(key);
      if (q && q.deleted) { await ctx.answerCallbackQuery({ text: 'Лобби отменено' }).catch(() => {}); return menu(ctx); }
      if (q) pushAll(q.g); else await pushOne(g, i, false, InlineKeyboard);
    } else await pushOne(g, i, false, InlineKeyboard); // go
    await ctx.answerCallbackQuery(alert ? { text: alert } : undefined).catch(() => {});
  });

  // текст: код лобби (после «Войти по коду») и ходы вида B5. Остальное отдаём дальше
  bot.on('message:text', async (ctx, next) => {
    const t = (ctx.message.text || '').trim(), key = 't:' + ctx.from.id;
    if (t.startsWith('/')) return next();
    const aw = awaiting.get(key);
    if (aw && Date.now() - aw < 5 * 60000) {
      const code = normCode(t);
      if (!code) return ctx.reply('Код лобби — 6 символов (буквы и цифры), например K7M2QX. Пришлите ещё раз.');
      awaiting.delete(key); return join(ctx, code);
    }
    awaiting.delete(key);
    const g = gameOf(key), m = /^([A-Ja-j])\s*(10|[1-9])$/.exec(t);
    if (g && g.phase === 'play' && m) {
      const i = idxOf(g, key), p = g.players[i], r = shoot(g, i, +m[2] - 1, COLS.indexOf(m[1].toUpperCase()));
      p.col = null;
      if (r.err) return ctx.reply('⚠️ ' + r.err);
      g.players.forEach((q, j) => pushOne(g, j, j === i, InlineKeyboard)); // у стрелявшего поле присылается новым сообщением — оно внизу чата
      return;
    }
    return next();
  });

  return { start: (ctx, code) => join(ctx, code), menu };
}

// уборка: пустые лобби — через 30 минут, остальные — через 3 часа без действий, законченные — через 15 минут
setInterval(() => {
  const now = Date.now();
  for (const [code, g] of games) {
    const idle = now - g.updated, limit = g.phase === 'over' ? 15 * 60e3 : g.phase === 'lobby' ? 30 * 60e3 : 3 * 3600e3;
    if (idle > limit) { games.delete(code); g.players.forEach(p => { if (p && active.get(p.key) === code) active.delete(p.key); }); }
  }
}, 60e3).unref();

module.exports = { site, telegram };
