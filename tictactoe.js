'use strict';
// ❌⭕ Крестики-нолики: сайт ↔ сайт, сайт ↔ Telegram, Telegram ↔ Telegram. У каждого лобби свой случайный код.
// Партии хранятся в памяти сервера (после перезапуска Render активные игры сбрасываются).
const crypto = require('crypto');

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const games = new Map();  // код -> игра
const active = new Map(); // ключ игрока -> код игры
const rnd = n => crypto.randomInt(n);
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const normCode = t => { const c = String(t || '').trim().toUpperCase(); return /^[A-Z0-9]{6}$/.test(c) ? c : null; };

let botApi = null, botNameFn = () => '', siteUrl = '', pushIK = null;
const links = {
  tg: code => (botNameFn() ? `https://t.me/${botNameFn()}?start=tt_${code}` : ''),
  site: code => (siteUrl ? `${siteUrl}/settings?ttt=${code}` : ''),
};

const mkPlayer = (key, name, plat, chat) => ({ key, name: String(name || 'Игрок').slice(0, 32), plat, chat: chat || null, tg: null, q: Promise.resolve() });
const idxOf = (g, key) => g.players.findIndex(p => p && p.key === key);
const gameOf = key => { const c = active.get(key); const g = c && games.get(c); return g && idxOf(g, key) >= 0 ? g : null; };
const touch = g => { g.updated = Date.now(); };
const markOf = (g, i) => (g.first === i ? 'X' : 'O');

function newCode() { for (;;) { let c = ''; for (let i = 0; i < 6; i++) c += ALPHA[rnd(ALPHA.length)]; if (!games.has(c)) return c; } }

function createGame(p) {
  const g = { code: newCode(), players: [p, null], phase: 'lobby', board: Array(9).fill(''), first: 0, turn: 0, winner: null, line: null,
    reason: null, score: [0, 0, 0], left: [false, false], updated: Date.now() };
  games.set(g.code, g); active.set(p.key, g.code); return g;
}

function joinGame(g, p) { g.players[1] = p; active.set(p.key, g.code); g.phase = 'play'; g.first = rnd(2); g.turn = g.first; touch(g); }

function move(g, i, idx) {
  if (g.phase !== 'play') return { err: 'Игра сейчас не идёт' };
  if (g.turn !== i) return { err: 'Сейчас ход соперника' };
  if (!Number.isInteger(idx) || idx < 0 || idx > 8) return { err: 'Неверная клетка' };
  if (g.board[idx]) return { err: 'Клетка занята' };
  g.board[idx] = markOf(g, i); touch(g);
  const line = LINES.find(l => l.every(k => g.board[k] === g.board[idx]));
  if (line) { g.phase = 'over'; g.winner = i; g.line = line; g.reason = 'win'; g.score[i]++; return { res: 'win' }; }
  if (g.board.every(Boolean)) { g.phase = 'over'; g.winner = -1; g.reason = 'draw'; g.score[2]++; return { res: 'draw' }; }
  g.turn = 1 - i; return { res: 'ok' };
}

function rematch(g) {
  if (g.phase !== 'over' || g.left[0] || g.left[1] || !g.players[1]) return false;
  g.board = Array(9).fill(''); g.first = 1 - g.first; g.turn = g.first; g.phase = 'play'; g.winner = null; g.line = null; g.reason = null; touch(g);
  return true;
}

// выход. Возвращает { g, deleted } или null
function quit(key) {
  const code = active.get(key); if (!code) return null;
  active.delete(key);
  const g = games.get(code); if (!g) return null;
  const i = idxOf(g, key); if (i < 0) return null;
  if (g.phase === 'lobby') { games.delete(code); return { g, deleted: true }; }
  g.left[i] = true;
  if (g.phase === 'play') { g.phase = 'over'; g.winner = 1 - i; g.reason = 'surrender'; g.score[1 - i]++; }
  touch(g);
  if (g.left[0] && g.left[1]) { games.delete(code); return { g, deleted: true }; }
  return { g, deleted: false };
}

function viewFor(g, i) {
  const o = g.players[1 - i];
  return {
    code: g.code, phase: g.phase, mark: markOf(g, i),
    me: { name: g.players[i].name, plat: g.players[i].plat },
    opp: o ? { name: o.name, plat: o.plat, left: g.left[1 - i] } : null,
    board: g.board, turn: g.phase === 'play' ? (g.turn === i ? 'me' : 'opp') : null,
    winner: g.winner == null ? null : g.winner === -1 ? 'draw' : (g.winner === i ? 'me' : 'opp'),
    line: g.line, reason: g.reason, score: { me: g.score[i], opp: g.score[1 - i], draw: g.score[2] },
    canRematch: g.phase === 'over' && !g.left[0] && !g.left[1], tg: botNameFn() || '',
  };
}

// ---------- Telegram: тексты и кнопки ----------
const platName = p => (p.plat === 'tg' ? 'Telegram' : 'сайт');
const EM = { X: '❌', O: '⭕' };

function tgText(g, i) {
  const v = viewFor(g, i), L = [];
  if (g.phase === 'lobby') {
    L.push('❌⭕ <b>Крестики-нолики</b>', '', `🔑 Код лобби: <code>${g.code}</code> (нажмите на код, чтобы скопировать)`, '',
      'Отправьте код другу. Войти по нему можно в этом боте («🔑 Войти по коду») и на сайте — Настройки → «Крестики-нолики».');
    if (links.tg(g.code)) L.push('', 'Ссылка для Telegram:', links.tg(g.code));
    if (links.site(g.code)) L.push('', 'Ссылка для сайта:', links.site(g.code));
    L.push('', '⏳ Ждём соперника…');
    return L.join('\n');
  }
  L.push(`❌⭕ <b>Крестики-нолики</b> · <code>${g.code}</code>`, `👤 Соперник: <b>${esc(v.opp.name)}</b> (${platName(v.opp)})${v.opp.left ? ' — вышел' : ''}`,
    `Вы играете за ${EM[v.mark]}`, `Счёт: вы ${v.score.me} — ${v.score.opp} соперник · ничьих ${v.score.draw}`, '');
  if (g.phase === 'play') L.push(v.turn === 'me' ? '🎯 <b>Ваш ход</b>' : '⏳ <b>Ход соперника</b>…');
  else if (v.winner === 'draw') L.push('🤝 <b>Ничья!</b>');
  else if (v.winner === 'me') L.push('🏆 <b>Вы победили!</b>' + (v.reason === 'surrender' ? ' Соперник сдался.' : ''));
  else L.push('💀 <b>Вы проиграли</b>');
  return L.join('\n');
}

function tgKb(g, i, IK) {
  const k = new IK(), c = g.code;
  if (g.phase === 'lobby') return k.text('❌ Отменить лобби', `tt:x:${c}`);
  const mine = g.phase === 'play' && g.turn === i;
  for (let n = 0; n < 9; n++) {
    const mk = g.board[n], win = g.line && g.line.includes(n);
    const label = mk ? (win ? (mk === 'X' ? '❎' : '🅾️') : EM[mk]) : '▫️';
    k.text(label, mine && !mk ? `tt:m:${c}:${n}` : 'tt:n');
    if (n % 3 === 2) k.row();
  }
  if (g.phase === 'play') k.text('🏳 Сдаться', `tt:x:${c}`);
  else { if (!g.left[0] && !g.left[1]) k.text('🔁 Ещё раз', `tt:rm:${c}`); k.text('🚪 Выйти', `tt:x:${c}`); }
  return k;
}

// ---------- сайт (HTTP API) ----------
function site(app, getUser, opts = {}) {
  siteUrl = (opts.siteUrl || '').replace(/\/+$/, ''); if (opts.botName) botNameFn = opts.botName;
  const auth = async (req, res, next) => {
    const u = await getUser(req).catch(() => null);
    if (!u) return res.status(401).json({ error: 'Войдите через Steam' });
    req.tt = { key: 's:' + u.steam_id, name: u.name || 'Игрок' }; next();
  };
  const bad = (res, error, code = 400) => res.status(code).json({ error });
  const find = req => { const code = normCode(req.body?.code || req.query?.code); const g = code && games.get(code); const i = g ? idxOf(g, req.tt.key) : -1; return g && i >= 0 ? { g, i } : null; };
  const leaveOld = key => { const q = quit(key); if (q) pushAll(q.g); };

  app.get('/api/ttt/mine', auth, (req, res) => { const g = gameOf(req.tt.key); res.json({ code: g ? g.code : null }); });
  app.post('/api/ttt/create', auth, (req, res) => { leaveOld(req.tt.key); res.json({ code: createGame(mkPlayer(req.tt.key, req.tt.name, 'site')).code }); });
  app.post('/api/ttt/join', auth, (req, res) => {
    const code = normCode(req.body?.code); if (!code) return bad(res, 'Код лобби — 6 символов, например K7M2QX');
    const g = games.get(code); if (!g) return bad(res, 'Лобби с таким кодом нет. Проверьте код — он каждый раз новый');
    if (g.players[0].key === req.tt.key) return res.json({ code });
    if (g.phase !== 'lobby') return bad(res, 'В этом лобби уже идёт игра');
    leaveOld(req.tt.key); joinGame(g, mkPlayer(req.tt.key, req.tt.name, 'site')); pushAll(g); res.json({ code });
  });
  app.get('/api/ttt/state', auth, (req, res) => { const f = find(req); if (!f) return bad(res, 'Игра не найдена', 404); res.json(viewFor(f.g, f.i)); });
  app.post('/api/ttt/move', auth, (req, res) => {
    const f = find(req); if (!f) return bad(res, 'Игра не найдена', 404);
    const r = move(f.g, f.i, req.body?.cell); if (r.err) return bad(res, r.err);
    pushAll(f.g); res.json({ res: r.res });
  });
  app.post('/api/ttt/rematch', auth, (req, res) => {
    const f = find(req); if (!f) return bad(res, 'Игра не найдена', 404);
    if (!rematch(f.g)) return bad(res, 'Реванш сейчас недоступен'); pushAll(f.g); res.json({ ok: true });
  });
  app.post('/api/ttt/leave', auth, (req, res) => { const f = find(req); if (!f) return res.json({ ok: true }); const q = quit(req.tt.key); if (q) pushAll(q.g); res.json({ ok: true }); });
}

// ---------- Telegram: бот ----------
async function pushOne(g, i, fresh) {
  const p = g.players[i]; if (!p || p.plat !== 'tg' || !botApi || g.left[i]) return;
  p.q = p.q.then(async () => {
    const text = tgText(g, i), extra = { parse_mode: 'HTML', reply_markup: tgKb(g, i, pushIK), link_preview_options: { is_disabled: true } };
    if (p.tg && !fresh) {
      try { await botApi.editMessageText(p.chat, p.tg, text, extra); return; }
      catch (e) { if (/not modified/i.test(e.message)) return; }
    }
    if (p.tg && fresh) botApi.deleteMessage(p.chat, p.tg).catch(() => {});
    try { p.tg = (await botApi.sendMessage(p.chat, text, extra)).message_id; } catch (e) { console.error('ttt push:', e.message); }
  }).catch(() => {});
}
function pushAll(g) { if (pushIK) g.players.forEach((p, i) => pushOne(g, i, false)); }

function telegram({ bot, InlineKeyboard, show, botName, siteUrl: su }) {
  botApi = bot.api; pushIK = InlineKeyboard; if (botName) botNameFn = botName; if (su) siteUrl = String(su).replace(/\/+$/, '');
  const awaiting = new Map();
  const who = ctx => mkPlayer('t:' + ctx.from.id, ctx.from.first_name || ctx.from.username || 'Игрок', 'tg', ctx.chat.id);
  const leaveOld = key => { const q = quit(key); if (q) pushAll(q.g); };

  const menu = async ctx => {
    awaiting.delete('t:' + ctx.from.id);
    const g = gameOf('t:' + ctx.from.id);
    const k = new InlineKeyboard().text('🆕 Создать лобби', 'tt:new').text('🔑 Войти по коду', 'tt:join').row();
    if (g) k.text(`▶️ Продолжить игру (${g.code})`, `tt:go:${g.code}`).row();
    k.text('⬅️ Назад', 'home');
    return show(ctx, '❌⭕ Крестики-нолики\n\nИграйте с другом: оба в Telegram или один здесь, а второй на сайте. Создайте лобби — получите код и отправьте его другу. Код каждый раз новый.', k);
  };
  const create = async ctx => {
    const p = who(ctx); leaveOld(p.key); const g = createGame(p);
    if (ctx.callbackQuery) p.tg = ctx.callbackQuery.message.message_id;
    await pushOne(g, 0, !ctx.callbackQuery);
  };
  const join = async (ctx, code) => {
    const g = games.get(code), key = 't:' + ctx.from.id;
    if (!g) return ctx.reply('🤷 Лобби с таким кодом нет. Проверьте код — он каждый раз новый.', { reply_markup: new InlineKeyboard().text('🔑 Ввести код ещё раз', 'tt:join').row().text('❌⭕ Меню', 'tt') });
    if (g.players[0].key === key) return ctx.reply('Это ваше собственное лобби — отправьте код другу 🙂');
    if (g.phase !== 'lobby') return ctx.reply('В этом лобби уже идёт игра 😕', { reply_markup: new InlineKeyboard().text('❌⭕ Меню', 'tt') });
    leaveOld(key); const p = who(ctx); joinGame(g, p);
    if (ctx.callbackQuery) p.tg = ctx.callbackQuery.message.message_id;
    pushOne(g, 1, !ctx.callbackQuery); pushOne(g, 0, false);
  };

  bot.command(['ttt', 'tictactoe', 'krestiki'], menu);
  bot.callbackQuery('tt', async ctx => { await ctx.answerCallbackQuery().catch(() => {}); return menu(ctx); });
  bot.callbackQuery('tt:n', ctx => ctx.answerCallbackQuery().catch(() => {}));
  bot.callbackQuery('tt:new', async ctx => { await ctx.answerCallbackQuery().catch(() => {}); return create(ctx); });
  bot.callbackQuery('tt:join', async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    awaiting.set('t:' + ctx.from.id, Date.now());
    return show(ctx, '🔑 Пришлите код лобби (6 символов, например K7M2QX).\n\nКод вам должен отправить друг, который создал лобби.', new InlineKeyboard().text('⬅️ Назад', 'tt'));
  });
  bot.callbackQuery(/^tt:(m|rm|x|go):([A-Z0-9]{6})(?::(\d))?$/, async ctx => {
    const [, act, code, arg] = ctx.match, key = 't:' + ctx.from.id, g = games.get(code), i = g ? idxOf(g, key) : -1;
    if (i < 0) { await ctx.answerCallbackQuery({ text: 'Игра не найдена или уже закончилась' }).catch(() => {}); return menu(ctx); }
    const p = g.players[i]; p.tg = ctx.callbackQuery.message.message_id; p.chat = ctx.chat.id;
    let alert = '';
    if (act === 'm') { const r = move(g, i, +arg); if (r.err) alert = r.err; pushAll(g); }
    else if (act === 'rm') { if (!rematch(g)) alert = 'Реванш сейчас недоступен'; pushAll(g); }
    else if (act === 'x') {
      const q = quit(key);
      if (q && q.deleted) { await ctx.answerCallbackQuery({ text: 'Лобби закрыто' }).catch(() => {}); return menu(ctx); }
      if (q) pushAll(q.g);
      return menu(ctx).then(() => ctx.answerCallbackQuery().catch(() => {}));
    } else await pushOne(g, i, false);
    await ctx.answerCallbackQuery(alert ? { text: alert } : undefined).catch(() => {});
  });
  bot.on('message:text', async (ctx, next) => {
    const t = (ctx.message.text || '').trim(), key = 't:' + ctx.from.id;
    if (t.startsWith('/')) return next();
    const aw = awaiting.get(key);
    if (!aw) return next();
    if (Date.now() - aw > 5 * 60000) { awaiting.delete(key); return next(); }
    const code = normCode(t);
    if (!code) return ctx.reply('Код лобби — 6 символов (буквы и цифры), например K7M2QX. Пришлите ещё раз.');
    awaiting.delete(key); return join(ctx, code);
  });
  return { start: (ctx, code) => join(ctx, code), menu };
}

setInterval(() => {
  const now = Date.now();
  for (const [code, g] of games) {
    const limit = g.phase === 'lobby' ? 30 * 60e3 : 2 * 3600e3;
    if (now - g.updated > limit) { games.delete(code); g.players.forEach(p => { if (p && active.get(p.key) === code) active.delete(p.key); }); }
  }
}, 60e3).unref();

module.exports = { site, telegram };
