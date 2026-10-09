// Мессенджер сайта в стиле Discord. Работает только внутри сайта, не связан с Discord.
// Лежит рядом с server.js. Подключение — см. блок «Мессенджер» в server.js.
const path = require('path');

const EMOJI = ['👍', '❤️', '😂', '🔥', '😮', '😢'];
const okAvatar = a => typeof a === 'string' && /^https:\/\/[\w.-]+\.(steamstatic\.com|akamaihd\.net)\//i.test(a);
const dmRoom = (a, b) => 'dm:' + [a, b].sort().join(':');

function site(app, getUser, opts) {
  const db = opts.db;
  const canMod = opts.canModerate || (() => false);
  const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const lastSend = new Map();

  const ready = (async () => {
    await db.query(`create table if not exists dc_channels(
      id serial primary key, name text unique not null, topic text not null default '', at bigint not null)`);
    await db.query(`create table if not exists dc_messages(
      id serial primary key, room text not null, uid text not null, text text not null,
      reply_to bigint, reactions jsonb not null default '{}', edited boolean not null default false, at bigint not null)`);
    await db.query('create index if not exists dc_messages_room on dc_messages(room, id)');
    await db.query(`insert into dc_channels(name, topic, at) values
      ('general', 'Общий чат', $1), ('помощь', 'Вопросы по серверу', $1), ('флуд', 'Всё подряд', $1)
      on conflict do nothing`, [Date.now()]);
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

  // комната: 'ch:<id>' — канал; 'dm:<id1>:<id2>' — личка (писать могут только двое участников)
  async function roomOk(room, uid) {
    if (/^ch:\d+$/.test(room)) return (await db.query('select 1 from dc_channels where id=$1', [+room.slice(3)])).rows.length > 0;
    const m = /^dm:(\d{17}):(\d{17})$/.exec(room);
    return !!m && (m[1] === uid || m[2] === uid);
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
    const channels = (await db.query('select id, name, topic from dc_channels order by id')).rows
      .map(c => ({ room: 'ch:' + c.id, name: c.name, topic: c.topic }));
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
    if (!await roomOk(room, m.id)) return fail(res, 403, 'Нет доступа к этой комнате');
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
    if (!await roomOk(room, m.id)) return fail(res, 403, 'Нет доступа к этой комнате');
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
    if (!await roomOk(row.room, m.id)) return fail(res, 403, 'Нет доступа');
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
    if (!name) return fail(res, 400, 'Укажите название');
    try { await db.query('insert into dc_channels(name, topic, at) values ($1,$2,$3)', [name, topic, Date.now()]); }
    catch (e) { return fail(res, 400, 'Такой канал уже есть'); }
    res.json({ ok: true });
  }));

  app.post('/api/msg/channel-delete', wrap(async (req, res) => {
    const m = await me(req);
    if (!m || !m.mod) return fail(res, 403, 'Нет прав');
    const id = parseInt(req.body.id) || 0;
    await db.query('delete from dc_messages where room=$1', ['ch:' + id]);
    await db.query('delete from dc_channels where id=$1', [id]);
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
}

module.exports = { site, dmRoom };
