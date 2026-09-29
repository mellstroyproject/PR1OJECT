const express = require('express'), { Pool } = require('pg'), crypto = require('crypto'), path = require('path');
const OWNER = '76561198659672678';
const PRICE = { prem: [65, 200, 470, 840], plus: [150, 450, 1000, 1800] }; // как на сайте
const DAYS = [7, 30, 90, 180], FOREVER = 1e15;

const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const mysql = require('mysql2/promise');
const game = process.env.GAME_DB_HOST ? mysql.createPool({ host: process.env.GAME_DB_HOST, port: +process.env.GAME_DB_PORT || 3306,
  user: process.env.GAME_DB_USER, password: process.env.GAME_DB_PASS, database: process.env.GAME_DB_NAME,
  connectionLimit: 3, connectTimeout: 8000, supportBigNumbers: true, bigNumberStrings: true }) : null;
const gq = async (sql, p = []) => { if (!game) throw new Error('База игрового сервера не подключена (нет GAME_DB_* в Environment)'); return (await game.query(sql, p))[0]; };
const nowS = () => Math.floor(Date.now() / 1000);
const gaCache = new Map();
async function gameAdmin(id) { // админ игрового сервера (iks_admins)
  if (!game) return null;
  const c = gaCache.get(id); if (c && Date.now() - c.t < 60000) return c.v;
  let v = null;
  try { v = (await gq('select id,name from iks_admins where steam_id=? and is_disabled=0 and deleted_at is null and (end_at is null or end_at=0 or end_at>?) limit 1', [id, nowS()]))[0] || null; }
  catch (e) { console.error('iks_admins:', e.message); }
  gaCache.set(id, { t: Date.now(), v }); return v;
}
const SECRET = process.env.SESSION_SECRET || 'change-me';
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

async function init() {
  await db.query(`
    create table if not exists users(
      steam_id text primary key, name text, avatar text, coins numeric not null default 0,
      plus_until bigint not null default 0, prem_until bigint not null default 0,
      grant_until bigint not null default 0, grant_by text, grant_at bigint,
      deputy boolean not null default false, dep_by text, dep_at bigint);
    create table if not exists promos(
      code text primary key, coins numeric not null, max int not null default 0,
      used int not null default 0, by text, at bigint);
    create table if not exists promo_used(steam_id text, code text, primary key(steam_id, code));
    create table if not exists bans(
      id serial primary key, kind text not null, steam_id text, player text, admin text, admin_id text,
      reason text, term text, until bigint not null default 0, active boolean not null default true, at bigint);
    insert into promos(code,coins) values('START100',100),('WELCOME50',50),('MELLSTROYPROJECT',200)
      on conflict do nothing;`);
}

// --- сессия ---
async function getUser(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)s=(\d{17})\.([\w-]+)/);
  if (!m || m[2] !== sign(m[1])) return null;
  const u = (await db.query('select * from users where steam_id=$1', [m[1]])).rows[0] || null;
  if (u && +u.plus_until <= Date.now() && await gameAdmin(u.steam_id)) u.deputy = true; // штатные админы; купившие Админ+ сюда не входят
  return u;
}
const level = need => async (req, res, next) => {
  const u = await getUser(req);
  if (!u) return res.status(401).json({ error: 'Войдите через Steam' });
  const owner = u.steam_id === OWNER, manage = owner || u.deputy;
  if ((need === 'manage' && !manage) || (need === 'owner' && !owner)) return res.status(403).json({ error: 'Нет прав' });
  req.u = u; next();
};
const bad = (res, error) => res.status(400).json({ error });
const pub = u => ({ id: u.steam_id, name: u.name || 'Игрок', avatar: u.avatar, coins: +u.coins,
  plus: +u.plus_until, grant: +u.grant_until, deputy: !!u.deputy });

// --- вход через Steam ---
app.get('/auth/steam', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const p = new URLSearchParams({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'checkid_setup',
    'openid.return_to': base + '/auth/steam/callback', 'openid.realm': base,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select' });
  res.redirect('https://steamcommunity.com/openid/login?' + p);
});
app.get('/auth/steam/callback', async (req, res) => {
  try {
    const p = new URLSearchParams(req.originalUrl.split('?')[1] || '');
    if (p.get('openid.return_to') !== `${req.protocol}://${req.get('host')}/auth/steam/callback`) throw 0;
    p.set('openid.mode', 'check_authentication');
    const t = await (await fetch('https://steamcommunity.com/openid/login', { method: 'POST', body: p })).text();
    const id = (p.get('openid.claimed_id') || '').match(/\/openid\/id\/(\d{17})$/)?.[1];
    if (!t.includes('is_valid:true') || !id) throw 0;
    let name = 'Игрок', avatar = null;
    if (process.env.STEAM_KEY) {
      const j = await (await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${process.env.STEAM_KEY}&steamids=${id}`)).json();
      const pl = j.response?.players?.[0]; if (pl) { name = pl.personaname; avatar = pl.avatarfull; }
    }
    await db.query(`insert into users(steam_id,name,avatar) values($1,$2,$3)
      on conflict(steam_id) do update set name=excluded.name, avatar=excluded.avatar`, [id, name, avatar]);
    res.setHeader('Set-Cookie', `s=${id}.${sign(id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
    res.redirect('/');
  } catch (e) { res.status(403).send('Не удалось войти через Steam'); }
});
app.post('/auth/logout', (req, res) => { res.setHeader('Set-Cookie', 's=; Path=/; Max-Age=0'); res.json({ ok: true }); });

// --- данные игрока ---
app.get('/api/me', async (req, res) => {
  const u = await getUser(req);
  if (!u) return res.json(null);
  const out = pub(u);
  if (u.steam_id === OWNER || u.deputy) {
    const g = {}, d = {};
    (await db.query('select * from users where grant_until>0')).rows.forEach(r => g[r.steam_id] = { until: +r.grant_until, by: r.grant_by, at: +r.grant_at });
    (await db.query('select * from users where deputy')).rows.forEach(r => d[r.steam_id] = { by: r.dep_by, at: +r.dep_at });
    out.adm = { grants: g, deputies: d, promos: (await db.query('select * from promos order by at desc nulls last')).rows.map(p => ({ ...p, coins: +p.coins, at: +p.at })) };
  }
  res.json(out);
});


// --- выдача админки в игре при покупке Админ+ (запись в iks_admins) ---
const ADMIN_FLAGS = process.env.ADMIN_FLAGS || 'z', ADMIN_IMMUNITY = +process.env.ADMIN_IMMUNITY || 0;
async function adminPurchaseCheck(id) {
  if (!game) return 'Выдача админки сейчас недоступна, попробуйте позже';
  try {
    const ex = (await gq('select end_at,is_disabled,deleted_at from iks_admins where steam_id=? limit 1', [id]))[0];
    if (ex && !ex.deleted_at && !ex.is_disabled && !(+ex.end_at)) return 'Вы уже постоянный админ сервера — покупка не нужна';
  } catch (e) { console.error('adminCheck:', e.message); return 'Не удалось связаться с базой игрового сервера'; }
  return null;
}
async function grantGameAdmin(u, days) {
  const conn = await game.getConnection();
  try {
    await conn.beginTransaction();
    const n = nowS(), ex = (await conn.query('select id,end_at from iks_admins where steam_id=? limit 1', [u.steam_id]))[0][0];
    if (ex) { // продлеваем срок и включаем обратно
      await conn.query('update iks_admins set end_at=?, is_disabled=0, deleted_at=NULL, updated_at=? where id=?', [Math.max(n, +ex.end_at || 0) + days * 86400, n, ex.id]);
    } else {
      const [ins] = await conn.query('insert into iks_admins(steam_id,name,flags,immunity,is_disabled,end_at,created_at,updated_at) values(?,?,?,?,0,?,?,?)',
        [u.steam_id, String(u.name || u.steam_id).slice(0, 64), ADMIN_FLAGS, ADMIN_IMMUNITY, n + days * 86400, n, n]);
      // привязка админа к серверу (iks_admin_to_server)
      const srv = (await conn.query('select id from iks_servers order by id limit 1'))[0][0];
      const cols = (await conn.query('show columns from iks_admin_to_server'))[0].filter(c => !/auto_increment/i.test(c.Extra));
      const val = c => c.Field === 'admin_id' ? ins.insertId : c.Field === 'server_id' ? (srv ? srv.id : null)
        : /created_at|updated_at/.test(c.Field) ? n : (c.Null === 'NO' && c.Default === null ? (/int|decimal/i.test(c.Type) ? 0 : '') : c.Default);
      await conn.query(`insert into iks_admin_to_server(${cols.map(c => '`' + c.Field + '`').join(',')}) values(${cols.map(() => '?').join(',')})`, cols.map(val));
    }
    await conn.commit(); gaCache.delete(u.steam_id);
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

app.post('/api/buy', level('user'), async (req, res) => {
  const { key, idx } = req.body, cost = PRICE[key]?.[idx];
  if (cost === undefined) return bad(res, 'Неверный тариф');
  const col = key === 'plus' ? 'plus_until' : 'prem_until', days = DAYS[idx], prev = req.u[col];
  if (key === 'plus') { const err = await adminPurchaseCheck(req.u.steam_id); if (err) return bad(res, err); }
  const r = await db.query(`update users set coins=coins-$1, ${col}=greatest(${col},$2)+$3 where steam_id=$4 and coins>=$1`,
    [cost, Date.now(), days * 864e5, req.u.steam_id]);
  if (!r.rowCount) return bad(res, 'Недостаточно монет');
  if (key === 'plus') {
    try { await grantGameAdmin(req.u, days); }
    catch (e) { // не получилось выдать в игре — возвращаем монеты
      console.error('grantAdmin:', e.message);
      await db.query(`update users set coins=coins+$1, ${col}=$2 where steam_id=$3`, [cost, prev, req.u.steam_id]);
      return res.status(500).json({ error: 'Не удалось выдать админку в игре, монеты возвращены. Попробуйте позже.' });
    }
  }
  res.json({ ok: true });
});
app.post('/api/promo', level('user'), async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const p = (await db.query('select * from promos where code=$1', [code])).rows[0];
  if (!p) return res.status(404).json({ error: 'Код не найден' });
  if (p.max > 0 && p.used >= p.max) return bad(res, 'Лимит активаций этого кода исчерпан');
  const ins = await db.query('insert into promo_used values($1,$2) on conflict do nothing', [req.u.steam_id, code]);
  if (!ins.rowCount) return bad(res, 'Этот код уже был использован');
  await db.query('update promos set used=used+1 where code=$1', [code]);
  await db.query('update users set coins=coins+$1 where steam_id=$2', [p.coins, req.u.steam_id]);
  res.json({ ok: true, coins: +p.coins });
});

// --- админка ---
app.post('/api/admin/grant', level('manage'), async (req, res) => {
  const { id, days } = req.body;
  if (!/^\d{17}$/.test(id) || id === OWNER) return bad(res, 'Неверный SteamID64 (17 цифр)');
  await db.query('insert into users(steam_id) values($1) on conflict do nothing', [id]);
  const cur = +(await db.query('select grant_until from users where steam_id=$1', [id])).rows[0].grant_until;
  const until = +days === 0 ? FOREVER : Math.max(Date.now(), cur < FOREVER ? cur : 0) + Math.min(+days || 30, 3650) * 864e5;
  await db.query('update users set grant_until=$2, grant_by=$3, grant_at=$4 where steam_id=$1', [id, until, req.u.steam_id, Date.now()]);
  res.json({ ok: true });
});
app.post('/api/admin/revoke', level('manage'), async (req, res) => {
  if (!/^\d{17}$/.test(req.body.id)) return bad(res, 'Неверный SteamID64');
  await db.query('update users set grant_until=0 where steam_id=$1', [req.body.id]); res.json({ ok: true });
});
app.post('/api/admin/deputy', level('owner'), async (req, res) => {
  const { id, on } = req.body;
  if (!/^\d{17}$/.test(id) || id === OWNER) return bad(res, 'Неверный SteamID64 (17 цифр)');
  await db.query('insert into users(steam_id) values($1) on conflict do nothing', [id]);
  await db.query('update users set deputy=$2, dep_by=$3, dep_at=$4 where steam_id=$1', [id, !!on, req.u.steam_id, Date.now()]);
  res.json({ ok: true });
});
app.post('/api/admin/promo', level('owner'), async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase(), coins = +req.body.coins, max = Math.floor(+req.body.max || 0);
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return bad(res, 'Код: 3–24 символа — латиница, цифры, _ или -');
  if (!(coins > 0 && coins <= 100000)) return bad(res, 'Награда: число от 1 до 100 000');
  const r = await db.query('insert into promos(code,coins,max,by,at) values($1,$2,$3,$4,$5) on conflict do nothing', [code, coins, max, req.u.steam_id, Date.now()]);
  r.rowCount ? res.json({ ok: true }) : bad(res, 'Такой код уже существует');
});
app.post('/api/admin/promo-delete', level('owner'), async (req, res) => {
  await db.query('delete from promos where code=$1', [String(req.body.code)]); res.json({ ok: true });
});


// --- баны, муты и лидеры из базы игрового сервера (IksAdmin, LevelsRanks) ---
const fmtDur = sec => sec >= 86400 ? Math.round(sec / 86400) + ' дн.' : Math.max(1, Math.round(sec / 60)) + ' мин.';
app.get('/api/bans', async (req, res) => {
  try {
    const T = req.query.type === 'mutes' ? 'iks_comms' : 'iks_bans', n = nowS();
    const rows = await gq(`select b.name, b.steam_id, b.reason, b.duration, b.created_at, b.end_at, b.unbanned_by, a.name as admin_name
      from ${T} b left join iks_admins a on a.id=b.admin_id where b.deleted_at is null and b.unbanned_by is null order by b.id desc limit 200`);
    res.json(rows.map(r => ({ player: r.name || r.steam_id, admin: r.admin_name || 'Консоль', reason: r.reason,
      term: +r.duration ? fmtDur(+r.duration) : 'Навсегда', at: r.created_at * 1000,
      active: !r.unbanned_by && (+r.end_at === 0 || +r.end_at > n) })));
  } catch (e) { console.error('bans:', e.message); res.json([]); }
});
app.get('/api/leaders', async (req, res) => {
  try {
    res.json((await gq('select name, value, kills, deaths, playtime from lvl_base order by value desc limit 100'))
      .map(r => ({ name: r.name, exp: +r.value, kills: +r.kills, deaths: +r.deaths, hours: Math.round(+r.playtime / 3600) })));
  } catch (e) { console.error('leaders:', e.message); res.json([]); }
});
app.post('/api/admin/punish', level('manage'), async (req, res) => {
  try {
    const t = String(req.body.target || '').trim(), kind = req.body.kind === 'mutes' ? 'mutes' : 'bans';
    const reason = String(req.body.reason || '').trim().slice(0, 120) || 'Без причины', days = Math.max(0, Math.min(+req.body.days || 0, 3650));
    if (!/^\d{17}$/.test(t)) return bad(res, 'Укажите SteamID64 игрока (17 цифр)');
    if (t === OWNER) return bad(res, 'Нельзя наказать владельца');
    const adm = await gameAdmin(req.u.steam_id);
    if (!adm) return bad(res, 'Вашего SteamID нет в списке админов игрового сервера (iks_admins)');
    const srv = (await gq('select id from iks_servers order by id limit 1'))[0];
    const u = (await db.query('select name from users where steam_id=$1', [t])).rows[0];
    const n = nowS(), dur = days * 86400, T = kind === 'mutes' ? 'iks_comms' : 'iks_bans', TY = kind === 'mutes' ? 'mute_type' : 'ban_type';
    await gq(`insert into ${T}(steam_id,name,duration,reason,${TY},server_id,admin_id,created_at,end_at,updated_at) values(?,?,?,?,?,?,?,?,?,?)`,
      [t, (u && u.name) || t, dur, reason, kind === 'mutes' ? 2 : 0, srv ? srv.id : null, adm.id, n, dur ? n + dur : 0, n]);
    res.json({ ok: true });
  } catch (e) { console.error('punish:', e.message); res.status(500).json({ error: 'Не удалось записать в базу игрового сервера: ' + e.message }); }
});

app.post('/api/admin/unban', level('manage'), async (req, res) => {
  try {
    const t = String(req.body.target || '').trim(), T = req.body.kind === 'mutes' ? 'iks_comms' : 'iks_bans';
    if (!/^\d{17}$/.test(t)) return bad(res, 'Укажите SteamID64 игрока (17 цифр)');
    const adm = await gameAdmin(req.u.steam_id);
    if (!adm) return bad(res, 'Вашего SteamID нет в списке админов игрового сервера (iks_admins)');
    const n = nowS();
    const r = await gq(`update ${T} set unbanned_by=?, unban_reason=?, updated_at=?, deleted_at=? where steam_id=? and unbanned_by is null and deleted_at is null and (end_at=0 or end_at>?)`,
      [adm.id, String(req.body.reason || 'Разбан с сайта').slice(0, 120), n, n, t, n]);
    res.json({ ok: true, count: r.affectedRows });
  } catch (e) { console.error('unban:', e.message); res.status(500).json({ error: 'Не удалось изменить базу игрового сервера: ' + e.message }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
init().then(() => app.listen(process.env.PORT || 3000, () => console.log('ok')))
  .catch(e => { console.error('DB error:', e.message); process.exit(1); });
