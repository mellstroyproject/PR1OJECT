// Чат сайта в стиле Discord (структура как на скриншоте шаблона NextProject). Не связан с Discord.
// Лежит рядом с server.js. Голос: WebRTC (звук идёт напрямую между игроками), сервер только передаёт сигналы.
const path = require('path');

const EMOJI = ['👍', '❤️', '😂', '🔥', '😮', '😢'];
const okAvatar = a => typeof a === 'string' && /^https:\/\/[\w.-]+\.(steamstatic\.com|akamaihd\.net)\//i.test(a);
const dmRoom = (a, b) => 'dm:' + [a, b].sort().join(':');

// Каналы: [название, тип, доступ, описание]
// доступ: all — всем; readonly — читают все, пишут только сотрудники; staff — видят и пишут только сотрудники
const LAYOUT = [
  { cat: 'Важное', ch: [
    ['новости', 'text', 'readonly', 'Объявления сервера'],
    ['правила', 'text', 'readonly', 'Правила сервера'] ] },
  { cat: 'Общение', ch: [
    ['общение', 'text', 'all', 'Говорим обо всём'],
    ['помощь', 'text', 'all', 'Вопросы по серверу'],
    ['мемы', 'text', 'all', 'Мемы и картинки'],
    ['Войс-чат', 'voice', 'all', 'Общий голосовой чат'] ] },
  { cat: 'Тикеты', ch: [
    ['создать-тикет', 'text', 'all', 'Напишите, если нужна помощь администрации'] ] },
  { cat: 'Администрация', ch: [
    ['информация-для-админов', 'text', 'staff', 'Инструкции для администрации'],
    ['админ-новости', 'text', 'staff', 'Новости для администрации'],
    ['админ-чат', 'text', 'staff', 'Чат администрации'],
    ['Админ войс', 'voice', 'staff', 'Голос администрации'] ] },
  { cat: 'Проверка', ch: [
    ['для-поверки', 'text', 'staff', 'Проверки игроков'],
    ['Проверка на читы 1', 'voice', 'staff', 'Голосовая проверка'],
    ['Проверка на читы 2', 'voice', 'staff', 'Голосовая проверка'],
    ['Проверка на читы 3', 'voice', 'staff', 'Голосовая проверка'],
    ['Проверка на читы 4', 'voice', 'staff', 'Голосовая проверка'],
    ['Проверка на читы 5', 'voice', 'staff', 'Голосовая проверка'] ] },
];

function site(app, getUser, opts) {
  const db = opts.db;
  const canMod = opts.canModerate || (() => false);
  const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const lastSend = new Map();

  // ---------- голосовые комнаты (в памяти сервера) ----------
  const voice = new Map();  // channelId -> Map(uid -> {name, avatar, muted, seen})
  const inbox = new Map();  // uid -> [{from, kind, data}] — сигналы WebRTC ждут, пока игрок их заберёт
  const TTL = 12000;        // игрок пропал из канала, если не опрашивал сервер 12 секунд

  const vWhere = uid => { for (const [cid, peers] of voice) if (peers.has(uid)) return cid; return null; };
  function vLeave(uid) {
    const cid = vWhere(uid);
    if (cid !== null) { voice.get(cid).delete(uid); if (!voice.get(cid).size) voice.delete(cid); }
    inbox.delete(uid);
  }
  function vTidy() {
    const now = Date.now();
    for (const [cid, peers] of voice) {
      for (const [uid, p] of peers) if (now - p.seen > TTL) { peers.delete(uid); inbox.delete(uid); }
      if (!peers.size) voice.delete(cid);
    }
    for (const uid of [...inbox.keys()]) if (vWhere(uid) === null) inbox.delete(uid);
  }
  const voiceList = cid => [...(voice.get(cid) || new Map()).values()].map(p => ({ name: p.name, avatar: p.avatar, muted: p.muted }));

  const ready = (async () => {
    await db.query(`create table if not exists dc_channels(
      id serial primary key, name text unique not null, topic text not null default '', at bigint not null)`);
    await db.query(`create table if not exists dc_messages(
      id serial primary key, room text not null, uid text not null, text text not null,
      reply_to bigint, reactions jsonb not null default '{}', edited boolean not null default false, at bigint not null)`);
    await db.query('create index if not exists dc_messages_room on dc_messages(room, id)');
    await db.query("alter table dc_channels add column if not exists kind text not null default 'text'");
    await db.query("alter table dc_channels add column if not exists access text not null default 'all'");
    await db.query('alter table dc_channels add column if not exists category text');
    await db.query('alter table dc_channels add column if not exists pos int not null default 0');
    let pos = 0;
    for (const g of LAYOUT) for (const [name, kind, access, topic] of g.ch) {
      pos += 1;
      await db.query(`insert into dc_channels(name, topic, at, kind, access, category, pos) values ($1,$2,$3,$4,$5,$6,$7)
        on conflict (name) do update set kind=excluded.kind, access=excluded.access, category=excluded.category, pos=excluded.pos`,
        [name, topic, Date.now(), kind, access, g.cat, pos]);
    }
  })().catch(e => console.error('messenger init:', e.message));

  const wrap = fn => async (req, res) => {
    try { await ready; await fn(req, res); }
    catch (e) {
      console.error('messenger:', e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Ошибка сервера, попробуйте позже' });
    }
  };
  const fail = (res, code, msg) => res.status(code).json({ error: msg });

  async function me(req) {
    const u = await getUser(req);
    if (!u) return null;
    const row = (await db.query('select name, avatar from users where steam_id=$1', [u.steam_id])).rows[0] || {};
    return { id: u.steam_id, name: row.name || 'Игрок', avatar: okAvatar(row.avatar) ? row.avatar : null, mod: !!canMod(u) };
  }

  const chanRow = async room => {
    if (!/^ch:\d+$/.test(room)) return null;
    return (await db.query('select id, name, topic, kind, access, category from dc_channels where id=$1', [+room.slice(3)])).rows[0] || null;
  };
  const canSee = (ch, m) => ch.access !== 'staff' || m.mod;
  const canWrite = (ch, m) => (ch.access === 'staff' || ch.access === 'readonly') ? m.mod : true;

  // можно ли читать комнату (текстовый канал или личка)
  async function roomOk(room, m) {
    if (room.startsWith('ch:')) { const ch = await chanRow(room); return !!ch && ch.kind === 'text' && canSee(ch, m); }
    const d = /^dm:(\d{17}):(\d{17})$/.exec(room);
    return !!d && (d[1] === m.id || d[2] === m.id);
  }
  async function writeOk(room, m) {
    if (!await roomOk(room, m)) return false;
    if (!room.startsWith('ch:')) return true;
    return canWrite(await chanRow(room), m);
  }

  app.get('/messenger', (req, res) => res.sendFile(path.join(__dirname, 'messenger.html')));

  app.get('/api/msg/me', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    res.json(m);
  }));

  app.get('/api/msg/rooms', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    vTidy();
    const rows = (await db.query('select id, name, topic, kind, access, category from dc_channels order by pos, id')).rows;
    const channels = rows.filter(c => canSee(c, m)).map(c => ({
      room: 'ch:' + c.id, name: c.name, topic: c.topic, kind: c.kind,
      category: c.category || 'Прочее',
      write: c.kind === 'text' && canWrite(c, m),
      users: c.kind === 'voice' ? voiceList(c.id) : []
    }));
    const rooms = (await db.query(
      "select distinct room from dc_messages where room like 'dm:%' and (room like $1 or room like $2)",
      [`dm:${m.id}:%`, `dm:%:${m.id}`])).rows.map(r => r.room);
    const others = rooms.map(r => { const [, a, b] = r.split(':'); return a === m.id ? b : a; });
    const names = others.length ? (await db.query('select steam_id, name, avatar from users where steam_id = any($1)', [others])).rows : [];
    const dms = others.map(id => {
      const n = names.find(x => x.steam_id === id) || {};
      return { room: dmRoom(m.id, id), uid: id, name: n.name || 'Игрок', avatar: okAvatar(n.avatar) ? n.avatar : null };
    });
    res.json({ me: m, channels, dms });
  }));

  app.get('/api/msg/messages', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    const room = String(req.query.room || '');
    if (!await roomOk(room, m)) return fail(res, 403, 'Нет доступа к этой комнате');
    const rows = (await db.query(`
      select x.id, x.uid, x.text, x.at, x.edited, x.reactions, x.reply_to,
             r.text as reply_text, ru.name as reply_name, u.name, u.avatar
      from dc_messages x
      left join dc_messages r on r.id = x.reply_to
      left join users ru on ru.steam_id = r.uid
      left join users u on u.steam_id = x.uid
      where x.room = $1 order by x.id desc limit 100`, [room])).rows.reverse();
    res.json({
      msgs: rows.map(r => ({
        id: +r.id, uid: r.uid, name: r.name || 'Игрок', avatar: okAvatar(r.avatar) ? r.avatar : null,
        text: r.text, at: +r.at, edited: r.edited, reactions: r.reactions || {},
        reply: r.reply_to ? { id: +r.reply_to, name: r.reply_name || 'Игрок', text: (r.reply_text || 'Сообщение удалено').slice(0, 120) } : null
      }))
    });
  }));

  app.post('/api/msg/send', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    const room = String(req.body.room || '');
    const text = clean(req.body.text, 500);
    if (!text) return fail(res, 400, 'Введите сообщение');
    if (!await writeOk(room, m)) return fail(res, 403, 'Писать в этот канал нельзя');
    const now = Date.now();
    if (now - (lastSend.get(m.id) || 0) < 800) return fail(res, 429, 'Не так быстро');
    lastSend.set(m.id, now);
    const reply = parseInt(req.body.reply_to) || null;
    await db.query('insert into dc_messages(room, uid, text, reply_to, at) values ($1,$2,$3,$4,$5)', [room, m.id, text, reply, now]);
    res.json({ ok: true });
  }));

  app.post('/api/msg/edit', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    const id = parseInt(req.body.id) || 0;
    const text = clean(req.body.text, 500);
    if (!text) return fail(res, 400, 'Пустое сообщение');
    const r = await db.query('update dc_messages set text=$1, edited=true where id=$2 and uid=$3', [text, id, m.id]);
    if (!r.rowCount) return fail(res, 403, 'Нельзя редактировать это сообщение');
    res.json({ ok: true });
  }));

  app.post('/api/msg/delete', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    const id = parseInt(req.body.id) || 0;
    const r = m.mod
      ? await db.query('delete from dc_messages where id=$1', [id])
      : await db.query('delete from dc_messages where id=$1 and uid=$2', [id, m.id]);
    if (!r.rowCount) return fail(res, 403, 'Нельзя удалить это сообщение');
    res.json({ ok: true });
  }));

  app.post('/api/msg/react', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    const id = parseInt(req.body.id) || 0;
    const emoji = String(req.body.emoji || '');
    if (!EMOJI.includes(emoji)) return fail(res, 400, 'Нет такой реакции');
    const row = (await db.query('select room, reactions from dc_messages where id=$1', [id])).rows[0];
    if (!row) return fail(res, 404, 'Сообщение не найдено');
    if (!await roomOk(row.room, m)) return fail(res, 403, 'Нет доступа');
    const rx = row.reactions || {};
    const list = rx[emoji] || [];
    rx[emoji] = list.includes(m.id) ? list.filter(x => x !== m.id) : [...list, m.id];
    if (!rx[emoji].length) delete rx[emoji];
    await db.query('update dc_messages set reactions=$1 where id=$2', [JSON.stringify(rx), id]);
    res.json({ ok: true });
  }));

  app.post('/api/msg/channel', wrap(async (req, res) => {
    const m = await me(req);
    if (!m || !m.mod) return fail(res, 403, 'Нет прав');
    const name = clean(req.body.name, 32).toLowerCase().replace(/\s+/g, '-');
    const topic = clean(req.body.topic, 120);
    const kind = req.body.kind === 'voice' ? 'voice' : 'text';
    if (!name) return fail(res, 400, 'Укажите название');
    try {
      await db.query('insert into dc_channels(name, topic, at, kind, access, category, pos) values ($1,$2,$3,$4,$5,$6,$7)',
        [name, topic, Date.now(), kind, 'all', null, 999]);
    } catch (e) { return fail(res, 400, 'Такой канал уже есть'); }
    res.json({ ok: true });
  }));

  app.post('/api/msg/channel-delete', wrap(async (req, res) => {
    const m = await me(req);
    if (!m || !m.mod) return fail(res, 403, 'Нет прав');
    const id = parseInt(req.body.id) || 0;
    await db.query('delete from dc_messages where room=$1', ['ch:' + id]);
    await db.query('delete from dc_channels where id=$1', [id]);
    voice.delete(id);
    res.json({ ok: true });
  }));

  app.get('/api/msg/users', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    const q = clean(req.query.q, 40).replace(/[%_]/g, '');
    if (!q) return res.json({ users: [] });
    const rows = (await db.query(
      'select steam_id, name, avatar from users where name ilike $1 and steam_id <> $2 limit 15',
      ['%' + q + '%', m.id])).rows;
    res.json({ users: rows.map(r => ({ uid: r.steam_id, name: r.name, avatar: okAvatar(r.avatar) ? r.avatar : null })) });
  }));

  // ---------- голос ----------
  app.post('/api/voice/join', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    const ch = await chanRow(String(req.body.room || ''));
    if (!ch || ch.kind !== 'voice' || !canSee(ch, m)) return fail(res, 403, 'Нет доступа к этому голосовому каналу');
    vTidy();
    vLeave(m.id);
    if (!voice.has(ch.id)) voice.set(ch.id, new Map());
    voice.get(ch.id).set(m.id, { name: m.name, avatar: m.avatar, muted: false, seen: Date.now() });
    inbox.set(m.id, []);
    res.json({ ok: true });
  }));

  app.post('/api/voice/leave', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    vLeave(m.id);
    res.json({ ok: true });
  }));

  app.post('/api/voice/mute', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    const cid = vWhere(m.id);
    if (cid !== null) voice.get(cid).get(m.id).muted = !!req.body.muted;
    res.json({ ok: true });
  }));

  app.get('/api/voice/poll', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    vTidy();
    const ch = await chanRow(String(req.query.room || ''));
    const cid = vWhere(m.id);
    if (!ch || cid !== ch.id) return res.json({ inRoom: false, peers: [], signals: [] });
    const peers = voice.get(cid);
    peers.get(m.id).seen = Date.now();
    const list = [...peers].filter(([uid]) => uid !== m.id)
      .map(([uid, p]) => ({ uid, name: p.name, avatar: p.avatar, muted: p.muted }));
    const signals = inbox.get(m.id) || [];
    inbox.set(m.id, []);
    res.json({ inRoom: true, peers: list, signals });
  }));

  app.post('/api/voice/signal', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    const to = String(req.body.to || '');
    const kind = String(req.body.kind || '');
    if (!['offer', 'answer', 'ice'].includes(kind)) return fail(res, 400, 'Неверный сигнал');
    const cid = vWhere(m.id);
    if (cid === null || !voice.get(cid).has(to)) return fail(res, 403, 'Собеседник не в канале');
    if (JSON.stringify(req.body.data || {}).length > 20000) return fail(res, 413, 'Слишком большой сигнал');
    const q = inbox.get(to) || [];
    if (q.length < 300) q.push({ from: m.id, kind, data: req.body.data });
    inbox.set(to, q);
    res.json({ ok: true });
  }));
}

module.exports = { site, dmRoom };
