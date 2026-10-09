// Чат сайта в стиле Discord (структура как на скриншоте шаблона NextProject). Не связан с Discord.
// Лежит рядом с server.js. Голос: WebRTC (звук идёт напрямую между игроками), сервер передаёт только сигналы.
const path = require('path');
// Push-уведомления: нужен пакет web-push и ключи VAPID в Environment (см. инструкцию)
let webpush = null;
try { webpush = require('web-push'); } catch (e) { console.error('web-push не установлен — push-уведомления выключены'); }
const PUSH_PUBLIC = process.env.VAPID_PUBLIC || '';
const pushOn = !!(webpush && PUSH_PUBLIC && process.env.VAPID_PRIVATE);
if (pushOn) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', PUSH_PUBLIC, process.env.VAPID_PRIVATE);

const EMOJI = ['👍', '❤️', '😂', '🔥', '😮', '😢'];
const okAvatar = a => typeof a === 'string' && /^https:\/\/[\w.-]+\.(steamstatic\.com|akamaihd\.net)\//i.test(a);
const dmRoom = (a, b) => 'dm:' + [a, b].sort().join(':');
const RING_MS = 30000; // входящий звонок показываем 30 секунд

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
  const rolePing = new Map(); // uid -> время последнего @админы (для обычных игроков — раз в минуту)

  // ---------- голос (в памяти сервера) ----------
  // комнаты: 'ch:<id>' — голосовой канал; 'dm:<id1>:<id2>' — звонок в личке
  const voice = new Map();  // room -> Map(uid -> {name, avatar, muted, seen})
  const inbox = new Map();  // uid -> [{from, kind, data}] — сигналы WebRTC, ждут опроса
  const rings = new Map();  // uid -> {from, fromId, room, at} — входящие звонки в личке
  const sharers = new Map(); // room -> uid того, кто показывает экран (один на комнату)
  const TTL = 12000;        // игрок пропал из звонка, если не опрашивал сервер 12 секунд

  const vWhere = uid => { for (const [room, peers] of voice) if (peers.has(uid)) return room; return null; };
  function vLeave(uid) {
    const room = vWhere(uid);
    if (room !== null) {
      voice.get(room).delete(uid);
      if (sharers.get(room) === uid) sharers.delete(room);
      if (!voice.get(room).size) voice.delete(room);
    }
    inbox.delete(uid);
  }
  function vTidy() {
    const now = Date.now();
    for (const [room, peers] of voice) {
      for (const [uid, p] of peers) if (now - p.seen > TTL) { peers.delete(uid); inbox.delete(uid); }
      if (!peers.size) { voice.delete(room); sharers.delete(room); }
      else if (sharers.has(room) && !peers.has(sharers.get(room))) sharers.delete(room);
    }
    for (const uid of [...inbox.keys()]) if (vWhere(uid) === null) inbox.delete(uid);
  }
  // push: не шлём тем, кто сейчас открыл сайт (опрашивает уведомления последние 10 секунд)
  const seenNotify = new Map();
  const isOpen = uid => Date.now() - (seenNotify.get(uid) || 0) < 10000;

  async function pushTo(uids, payload) {
    if (!pushOn || !uids.length) return;
    const rows = (await db.query('select endpoint, p256dh, auth from dc_push where uid = any($1)', [uids])).rows;
    const body = JSON.stringify(payload);
    await Promise.all(rows.map(r => webpush.sendNotification(
      { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, body)
      .catch(err => {
        if (err.statusCode === 404 || err.statusCode === 410) db.query('delete from dc_push where endpoint=$1', [r.endpoint]).catch(() => {});
      })));
  }

  // кому отправить push о новом сообщении: собеседнику в личке, упомянутым и по ролям
  async function pushForMessage(room, sender, text) {
    if (!pushOn) return;
    const send = new Map();
    const add = (uid, title) => { if (uid && uid !== sender.id && !isOpen(uid) && !send.has(uid)) send.set(uid, title); };
    if (room.startsWith('dm:')) {
      const other = room.split(':').slice(1).find(x => x !== sender.id);
      add(other, `Личное сообщение от ${sender.name}`);
    } else {
      const ch = await chanRow(room);
      if (!ch || ch.kind !== 'text') return;
      const subs = (await db.query('select distinct p.uid, u.name, p.mod from dc_push p left join users u on u.steam_id = p.uid')).rows;
      for (const s of subs) {
        if (!s.name) continue;
        if (ch.access === 'staff' && !s.mod) continue;
        if (text.includes('@' + s.name)) add(s.uid, `${sender.name} упомянул вас в #${ch.name}`);
        else if (text.includes('@все')) add(s.uid, `${sender.name} написал @все в #${ch.name}`);
        else if (text.includes('@админы') && s.mod) add(s.uid, `${sender.name} написал @админы в #${ch.name}`);
      }
    }
    for (const [uid, title] of send) await pushTo([uid], { title, body: text.slice(0, 120), room }).catch(() => {});
  }

  const voiceList = room => [...(voice.get(room) || new Map()).values()].map(p => ({ name: p.name, avatar: p.avatar, muted: p.muted }));

  const ready = (async () => {
    await db.query(`create table if not exists dc_channels(
      id serial primary key, name text unique not null, topic text not null default '', at bigint not null)`);
    await db.query(`create table if not exists dc_messages(
      id serial primary key, room text not null, uid text not null, text text not null,
      reply_to bigint, reactions jsonb not null default '{}', edited boolean not null default false, at bigint not null)`);
    await db.query('create index if not exists dc_messages_room on dc_messages(room, id)');
    await db.query(`create table if not exists dc_push(
      endpoint text primary key, uid text not null, p256dh text not null, auth text not null,
      mod boolean not null default false, at bigint not null)`);
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

  // доступ к голосовой комнате: канал или личный звонок; other — собеседник в личке
  async function voiceAccess(room, m) {
    if (room.startsWith('ch:')) {
      const ch = await chanRow(room);
      return ch && ch.kind === 'voice' && canSee(ch, m) ? { label: ch.name } : null;
    }
    const d = /^dm:(\d{17}):(\d{17})$/.exec(room);
    if (!d || (d[1] !== m.id && d[2] !== m.id)) return null;
    const other = d[1] === m.id ? d[2] : d[1];
    const row = (await db.query('select name from users where steam_id=$1', [other])).rows[0] || {};
    return { label: row.name || 'Игрок', other };
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
      users: c.kind === 'voice' ? voiceList('ch:' + c.id) : []
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

  // уведомления: новые личные сообщения, упоминания (@ник) и входящие звонки
  app.get('/api/msg/notify', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    seenNotify.set(m.id, Date.now());
    const overall = +(await db.query('select coalesce(max(id),0) as id from dc_messages')).rows[0].id;
    const r = rings.get(m.id);
    const ring = r && Date.now() - r.at < RING_MS ? { from: r.from, room: r.room, at: r.at } : null;
    if (req.query.after === undefined) return res.json({ last: overall, items: [], ring });
    const after = parseInt(req.query.after) || 0;
    const chans = (await db.query("select id, name, access from dc_channels where kind='text'")).rows.filter(c => canSee(c, m));
    const chanName = Object.fromEntries(chans.map(c => ['ch:' + c.id, c.name]));
    const rows = (await db.query(`
      select x.id, x.room, x.text, u.name from dc_messages x
      left join users u on u.steam_id = x.uid
      where x.id > $1 and x.uid <> $2 and (
        x.room like $3 or x.room like $4 or
        (x.room = any($5) and (strpos(x.text, $6) > 0 or strpos(x.text, '@все') > 0 or ($7 and strpos(x.text, '@админы') > 0))))
      order by x.id limit 20`,
      [after, m.id, `dm:${m.id}:%`, `dm:%:${m.id}`, Object.keys(chanName), '@' + m.name, m.mod])).rows;
    const items = rows.map(x => {
      const isDm = x.room.startsWith('dm:');
      const base = { id: +x.id, room: x.room, from: x.name || 'Игрок',
        where: isDm ? '' : '#' + (chanName[x.room] || ''), text: x.text.slice(0, 120) };
      if (isDm) return { ...base, kind: 'dm' };
      if (x.text.includes('@' + m.name)) return { ...base, kind: 'mention' };
      if (x.text.includes('@все')) return { ...base, kind: 'role', tag: '@все' };
      return { ...base, kind: 'role', tag: '@админы' };
    });
    const last = items.length ? items[items.length - 1].id : overall;
    res.json({ last, items, ring });
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
    if (text.includes('@все') && !m.mod) return fail(res, 403, '@все может использовать только администрация');
    if (text.includes('@админы') && !m.mod) {
      if (now - (rolePing.get(m.id) || 0) < 60000) return fail(res, 429, '@админы можно звать раз в минуту');
      rolePing.set(m.id, now);
    }
    lastSend.set(m.id, now);
    const reply = parseInt(req.body.reply_to) || null;
    await db.query('insert into dc_messages(room, uid, text, reply_to, at) values ($1,$2,$3,$4,$5)', [room, m.id, text, reply, now]);
    pushForMessage(room, m, text).catch(() => {});
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
    voice.delete('ch:' + id);
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

  app.get('/api/msg/online', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    const now = Date.now();
    res.json({ online: [...seenNotify].filter(([, t]) => now - t < 30000).map(([uid]) => uid) });
  }));

  // ---------- push ----------
  app.get('/api/msg/push/key', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    res.json({ key: pushOn ? PUSH_PUBLIC : '' });
  }));

  app.post('/api/msg/push/subscribe', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    if (!pushOn) return fail(res, 503, 'Уведомления не настроены на сервере');
    const s = req.body.subscription || {};
    if (!s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) return fail(res, 400, 'Неверная подписка');
    await db.query(`insert into dc_push(endpoint, uid, p256dh, auth, mod, at) values ($1,$2,$3,$4,$5,$6)
      on conflict (endpoint) do update set uid=excluded.uid, p256dh=excluded.p256dh, auth=excluded.auth, mod=excluded.mod, at=excluded.at`,
      [s.endpoint, m.id, s.keys.p256dh, s.keys.auth, m.mod, Date.now()]);
    res.json({ ok: true });
  }));

  // ---------- голос ----------
  // STUN всегда; TURN — если задан в Environment: TURN_URL (через запятую), TURN_USER, TURN_PASS.
  const iceServers = () => {
    const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    if (process.env.TURN_URL) list.push({
      urls: process.env.TURN_URL.split(',').map(s => s.trim()).filter(Boolean),
      username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || ''
    });
    return list;
  };
  app.get('/api/voice/ice', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    res.json({ iceServers: iceServers() });
  }));

  app.post('/api/voice/join', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    const room = String(req.body.room || '');
    const acc = await voiceAccess(room, m);
    if (!acc) return fail(res, 403, 'Нет доступа к этому звонку');
    vTidy();
    vLeave(m.id);
    if (!voice.has(room)) voice.set(room, new Map());
    voice.get(room).set(m.id, { name: m.name, avatar: m.avatar, muted: false, seen: Date.now() });
    inbox.set(m.id, []);
    rings.delete(m.id);
    // звонок в личке: зовём собеседника, если его ещё нет в этом звонке
    if (acc.other && !voice.get(room).has(acc.other)) {
      rings.set(acc.other, { from: m.name, fromId: m.id, room, at: Date.now() });
      if (!isOpen(acc.other)) pushTo([acc.other], { title: `Звонок от ${m.name}`, body: 'Нажмите, чтобы ответить', room, call: true }).catch(() => {});
    }
    res.json({ ok: true });
  }));

  app.post('/api/voice/decline', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    rings.delete(m.id);
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
    const room = vWhere(m.id);
    if (room !== null) voice.get(room).get(m.id).muted = !!req.body.muted;
    res.json({ ok: true });
  }));

  app.get('/api/voice/poll', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    vTidy();
    const room = String(req.query.room || '');
    const acc = await voiceAccess(room, m);
    if (!acc || vWhere(m.id) !== room) return res.json({ inRoom: false, peers: [], signals: [] });
    const peers = voice.get(room);
    peers.get(m.id).seen = Date.now();
    const list = [...peers].filter(([uid]) => uid !== m.id)
      .map(([uid, p]) => ({ uid, name: p.name, avatar: p.avatar, muted: p.muted }));
    const signals = inbox.get(m.id) || [];
    inbox.set(m.id, []);
    const sh = sharers.get(room) || null;
    const sp = sh ? peers.get(sh) : null;
    res.json({ inRoom: true, peers: list, signals, sharer: sp ? sh : null, sharerName: sp ? sp.name : '' });
  }));

  // демонстрация экрана: один игрок на комнату
  app.post('/api/voice/share', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    const room = vWhere(m.id);
    if (room === null) return fail(res, 403, 'Сначала подключитесь к звонку');
    if (req.body.on) {
      const cur = sharers.get(room);
      if (cur && cur !== m.id) {
        const p = voice.get(room).get(cur);
        return fail(res, 409, `Экран уже показывает ${p ? p.name : 'другой игрок'}`);
      }
      sharers.set(room, m.id);
    } else if (sharers.get(room) === m.id) sharers.delete(room);
    res.json({ ok: true });
  }));

  app.post('/api/voice/signal', wrap(async (req, res) => {
    const m = await me(req);
    if (!m) return fail(res, 401, 'Войдите через Steam');
    const to = String(req.body.to || '');
    const kind = String(req.body.kind || '');
    if (!['offer', 'answer', 'ice'].includes(kind)) return fail(res, 400, 'Неверный сигнал');
    const room = vWhere(m.id);
    if (room === null || !voice.get(room).has(to)) return fail(res, 403, 'Собеседник не в звонке');
    if (JSON.stringify(req.body.data || {}).length > 20000) return fail(res, 413, 'Слишком большой сигнал');
    const q = inbox.get(to) || [];
    if (q.length < 300) q.push({ from: m.id, kind, data: req.body.data });
    inbox.set(to, q);
    res.json({ ok: true });
  }));
}

module.exports = { site, dmRoom };
