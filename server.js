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
  const c = gaCache.get(id); if (c && Date.now() - c.t < 60000 && (!c.v || !+c.v.end_at || +c.v.end_at > nowS())) return c.v;
  let v = null;
  try { v = (await gq('select id,name,end_at from iks_admins where steam_id=? and is_disabled=0 and deleted_at is null and (end_at is null or end_at=0 or end_at>?) limit 1', [id, nowS()]))[0] || null; }
  catch (e) { console.error('iks_admins:', e.message); }
  gaCache.set(id, { t: Date.now(), v }); return v;
}
// --- профили Steam: ник и аватарка ---
const profTry = new Map(); // steam_id -> время последней попытки обновления
const okAvatar = a => typeof a === 'string' && /^https:\/\/[\w.-]+\.(steamstatic\.com|akamaihd\.net)\//i.test(a);
async function fetchProfiles(ids) { // -> { steam_id: { name, avatar } }
  const out = {};
  if (process.env.STEAM_KEY && ids.length) {
    try {
      const j = await (await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${process.env.STEAM_KEY}&steamids=${ids.join(',')}`, { signal: AbortSignal.timeout(6000) })).json();
      for (const p of j.response?.players || []) out[p.steamid] = { name: p.personaname, avatar: p.avatarfull };
    } catch (e) { console.error('steam api:', e.message); }
  }
  for (const id of ids.filter(i => !out[i])) { // запасной путь без ключа: публичная XML-страница профиля
    try {
      const x = await (await fetch(`https://steamcommunity.com/profiles/${id}?xml=1`, { signal: AbortSignal.timeout(6000) })).text();
      const g = t => (x.match(new RegExp(`<${t}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${t}>`)) || [])[1];
      if (g('steamID')) out[id] = { name: g('steamID').trim(), avatar: (g('avatarFull') || '').trim().replace(/^http:/, 'https:') };
    } catch (e) { console.error('steam xml:', e.message); }
  }
  return out;
}
async function refreshProfiles(rows) { // дописывает недостающие ник/аватарку в строки users и в базу (не чаще раза в 10 минут на игрока)
  const need = rows.filter(r => (!r.avatar || !r.name || r.name === 'Игрок') && /^\d{17}$/.test(r.steam_id) && Date.now() - (profTry.get(r.steam_id) || 0) > 6e5).slice(0, 20);
  if (!need.length) return;
  need.forEach(r => profTry.set(r.steam_id, Date.now()));
  const got = await fetchProfiles(need.map(r => r.steam_id));
  for (const r of need) {
    const p = got[r.steam_id]; if (!p) continue;
    if (p.name) r.name = String(p.name).slice(0, 64);
    if (okAvatar(p.avatar)) r.avatar = p.avatar;
    await db.query('update users set name=$2, avatar=$3 where steam_id=$1', [r.steam_id, r.name || null, r.avatar || null]).catch(() => {});
  }
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
    alter table users add column if not exists perms text not null default '';
    create table if not exists site(key text primary key, value text);
    create table if not exists promos(
      code text primary key, coins numeric not null, max int not null default 0,
      used int not null default 0, by text, at bigint);
    create table if not exists promo_used(steam_id text, code text, primary key(steam_id, code));
    create table if not exists servers(id serial primary key, name text not null, address text not null);
    insert into servers(name,address) select 'Мираж (карта меняется)','45.95.31.64:27215' where not exists (select 1 from servers);
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
  if (u && Math.max(+u.plus_until, +u.grant_until) <= Date.now() && await gameAdmin(u.steam_id)) { if (!u.deputy) u.staff = true; u.deputy = true; } // штатные админы; купившие и получившие Админ+ сюда не входят
  return u;
}
const level = need => async (req, res, next) => {
  const u = await getUser(req);
  if (!u) return res.status(401).json({ error: 'Войдите через Steam' });
  const owner = u.steam_id === OWNER, manage = owner || u.deputy;
  if ((need === 'manage' && !manage) || (need === 'owner' && !owner)) return res.status(403).json({ error: 'Нет прав' });
  req.u = u; next();
};
// --- права доступа: владелец выдаёт любому игроку отдельные права ---
const PERMS = { ban: 'Банить и мутить', unban: 'Разбанивать и снимать мут', grant: 'Выдавать и снимать Админ+', promo: 'Промокоды', server: 'Серверы', design: 'Дизайн сайта' };
const DEPUTY_PERMS = ['ban', 'unban', 'grant']; // что зам умеет «из коробки»
const isFull = u => u.steam_id === OWNER || (!!u.deputy && !u.staff); // владелец и назначенные замы — всё одинаково; штатные админы игры (u.staff) — только DEPUTY_PERMS
const permsOf = u => isFull(u) ? Object.keys(PERMS)
  : [...new Set([...(u.deputy ? DEPUTY_PERMS : []), ...String(u.perms || '').split(',').filter(p => PERMS[p])])];
const can = perm => async (req, res, next) => {
  const u = await getUser(req);
  if (!u) return res.status(401).json({ error: 'Войдите через Steam' });
  if (!permsOf(u).includes(perm)) return res.status(403).json({ error: 'Нет прав: ' + PERMS[perm] });
  req.u = u; next();
};
const bad = (res, error) => res.status(400).json({ error });
const pub = u => ({ id: u.steam_id, name: u.name || 'Игрок', avatar: u.avatar, coins: +u.coins,
  plus: +u.plus_until, grant: +u.grant_until, deputy: !!u.deputy, full: isFull(u), perms: permsOf(u) });

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
    let name = null, avatar = null;
    const pr = (await fetchProfiles([id]))[id];
    if (pr) { name = pr.name ? String(pr.name).slice(0, 64) : null; avatar = okAvatar(pr.avatar) ? pr.avatar : null; }
    await db.query(`insert into users(steam_id,name,avatar) values($1,$2,$3)
      on conflict(steam_id) do update set name=coalesce(excluded.name, users.name), avatar=coalesce(excluded.avatar, users.avatar)`, [id, name, avatar]);
    res.setHeader('Set-Cookie', `s=${id}.${sign(id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
    res.redirect('/');
  } catch (e) { res.status(403).send('Не удалось войти через Steam'); }
});
app.post('/auth/logout', (req, res) => { res.setHeader('Set-Cookie', 's=; Path=/; Max-Age=0'); res.json({ ok: true }); });

// --- данные игрока ---
app.get('/api/me', async (req, res) => {
  const u = await getUser(req);
  if (!u) return res.json(null);
  await refreshProfiles([u]); // если ника/аватарки нет — подтягиваем из Steam
  const out = pub(u);
  const P = out.perms;
  if (P.length) { // данные админ-панели отдаём только тем, кому они нужны по правам
    const g = {}, d = {}, owner = u.steam_id === OWNER;
    if (P.includes('grant')) { const rows = (await db.query('select * from users where grant_until>0')).rows; await refreshProfiles(rows);
      rows.forEach(r => g[r.steam_id] = { until: +r.grant_until, by: r.grant_by, at: +r.grant_at, name: r.name, avatar: r.avatar }); }
    if (owner) { const rows = (await db.query('select * from users where deputy')).rows; await refreshProfiles(rows);
      rows.forEach(r => d[r.steam_id] = { by: r.dep_by, at: +r.dep_at, name: r.name, avatar: r.avatar }); }
    out.adm = { grants: g, deputies: d, promos: P.includes('promo') ? (await db.query('select * from promos order by at desc nulls last')).rows.map(p => ({ ...p, coins: +p.coins, at: +p.at })) : [] };
    if (owner) {
      out.adm.perms = {};
      const rows = (await db.query("select steam_id,name,avatar,perms from users where perms<>''")).rows; await refreshProfiles(rows);
      rows.forEach(r => out.adm.perms[r.steam_id] = { name: r.name, avatar: r.avatar, perms: r.perms.split(',').filter(p => PERMS[p]) });
    }
    if (out.full) { // владельцу и замам — все админы из базы игры (iks_admins), а не только выданные через сайт
      try {
        out.adm.admins = (await gq('select steam_id,name,flags,immunity,end_at,is_disabled from iks_admins where deleted_at is null order by id'))
          .filter(a => /^\d{17}$/.test(String(a.steam_id)))
          .map(a => ({ id: String(a.steam_id), name: a.name, flags: a.flags, imm: +a.immunity || 0, end: +a.end_at || 0, off: !!+a.is_disabled }));
        const known = (await db.query('select steam_id,name,avatar from users where steam_id=any($1)', [out.adm.admins.map(a => a.id)])).rows; await refreshProfiles(known);
        const byId = Object.fromEntries(known.map(r => [r.steam_id, r]));
        out.adm.admins.forEach(a => { const k = byId[a.id]; if (k) { a.ava = k.avatar; a.site = k.name; } });
      } catch (e) { console.error('admins list:', e.message); out.adm.admins = []; }
    }
  }
  res.json(out);
});


// --- выдача админки в игре при покупке Админ+ (запись в iks_admins) ---
const ADMIN_FLAGS = process.env.ADMIN_FLAGS || 'z', ADMIN_IMMUNITY = +process.env.ADMIN_IMMUNITY || 0;
async function adminPurchaseCheck(id, self = true) {
  if (!game) return 'Выдача админки сейчас недоступна, попробуйте позже';
  try {
    const ex = (await gq('select end_at,is_disabled,deleted_at from iks_admins where steam_id=? limit 1', [id]))[0];
    if (ex && !ex.deleted_at && !ex.is_disabled && !(+ex.end_at)) return self ? 'Вы уже постоянный админ сервера — покупка не нужна' : 'Игрок уже постоянный админ сервера — выдавать не нужно';
  } catch (e) { console.error('adminCheck:', e.message); return 'Не удалось связаться с базой игрового сервера'; }
  return null;
}
// untilMs — до какого момента админка по данным сайта (>= FOREVER — навсегда, в игре end_at=0)
async function grantGameAdmin(u, untilMs, o = {}) { // o: { name, flags, immunity } — необязательно, иначе значения по умолчанию
  const conn = await game.getConnection();
  try {
    await conn.beginTransaction();
    const q = async (sql, p) => (await conn.query(sql, p))[0];
    const n = nowS(), end = untilMs >= FOREVER ? 0 : Math.floor(untilMs / 1000);
    const ex = (await q('select id,end_at from iks_admins where steam_id=? limit 1', [u.steam_id]))[0];
    let adminId;
    if (ex) { // включаем обратно; срок не уменьшаем, если в игре он уже длиннее
      adminId = ex.id;
      const set = ['end_at=?', 'is_disabled=0', 'deleted_at=NULL', 'updated_at=?'], p = [end === 0 ? 0 : Math.max(+ex.end_at || 0, end), n];
      if (o.name) { set.push('name=?'); p.push(o.name); }
      if (o.flags) { set.push('flags=?'); p.push(o.flags); }
      if (o.immunity !== undefined) { set.push('immunity=?'); p.push(o.immunity); }
      await q(`update iks_admins set ${set.join(',')} where id=?`, [...p, ex.id]);
    } else {
      adminId = (await q('insert into iks_admins(steam_id,name,flags,immunity,is_disabled,end_at,created_at,updated_at) values(?,?,?,?,0,?,?,?)',
        [u.steam_id, String(o.name || u.name || u.steam_id).slice(0, 64), o.flags || ADMIN_FLAGS, o.immunity ?? ADMIN_IMMUNITY, end, n, n])).insertId;
    }
    // привязка админа к серверу (iks_admin_to_server) — проверяем и у существующих, иначе в игре прав не будет
    if (!(await q('select 1 from iks_admin_to_server where admin_id=? limit 1', [adminId])).length) {
      const srv = (await q('select id from iks_servers order by id limit 1'))[0];
      const cols = (await q('show columns from iks_admin_to_server')).filter(c => !/auto_increment/i.test(c.Extra));
      const val = c => c.Field === 'admin_id' ? adminId : c.Field === 'server_id' ? (srv ? srv.id : null)
        : /created_at|updated_at/.test(c.Field) ? n : (c.Null === 'NO' && c.Default === null ? (/int|decimal/i.test(c.Type) ? 0 : '') : c.Default);
      await q(`insert into iks_admin_to_server(${cols.map(c => '`' + c.Field + '`').join(',')}) values(${cols.map(() => '?').join(',')})`, cols.map(val));
    }
    await conn.commit(); gaCache.delete(u.steam_id);
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
async function deleteGameAdmin(id) { // убираем строку админа из iks_admins (и его привязку к серверу)
  const conn = await game.getConnection();
  try {
    await conn.beginTransaction();
    const q = async (sql, p) => (await conn.query(sql, p))[0];
    const rows = await q('select id from iks_admins where steam_id=?', [id]);
    // внешние ключи на iks_admins (баны/муты ссылаются на админа): CASCADE снёс бы чужие записи, RESTRICT не дал бы удалить
    let fks = [];
    try {
      fks = await q(`select k.TABLE_NAME as t, k.COLUMN_NAME as c, r.DELETE_RULE as d from information_schema.KEY_COLUMN_USAGE k
        join information_schema.REFERENTIAL_CONSTRAINTS r on r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA and r.CONSTRAINT_NAME=k.CONSTRAINT_NAME and r.TABLE_NAME=k.TABLE_NAME
        where k.TABLE_SCHEMA=database() and k.REFERENCED_TABLE_NAME='iks_admins'`);
    } catch (e) { console.error('fk check:', e.message); }
    for (const f of fks) {
      if (f.t === 'iks_admin_to_server') continue;
      if (f.d === 'CASCADE') throw new Error(`в базе у таблицы ${f.t} стоит ON DELETE CASCADE на iks_admins — вместе с админом удалились бы и её записи. Смените правило на SET NULL`);
    }
    for (const r of rows) {
      for (const f of fks) if (f.t !== 'iks_admin_to_server' && /RESTRICT|NO ACTION/.test(f.d)) await q(`update \`${f.t}\` set \`${f.c}\`=NULL where \`${f.c}\`=?`, [r.id]);
      await q('delete from iks_admin_to_server where admin_id=?', [r.id]);
      await q('delete from iks_admins where id=?', [r.id]);
    }
    await conn.commit(); gaCache.delete(id);
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

app.post('/api/buy', level('user'), async (req, res) => {
  const { key, idx } = req.body, cost = PRICE[key]?.[idx];
  if (cost === undefined) return bad(res, 'Неверный тариф');
  const col = key === 'plus' ? 'plus_until' : 'prem_until', days = DAYS[idx], prev = req.u[col];
  let nick = '';
  if (key === 'plus') {
    await refreshProfiles([req.u]); // ник берём автоматически из Steam (если в базе его ещё нет — подтягиваем)
    nick = String(req.u.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
    if (nick.length < 2 || nick === 'Игрок') nick = req.u.steam_id; // запасной вариант, если Steam не отдал ник
    const err = await adminPurchaseCheck(req.u.steam_id); if (err) return bad(res, err);
  }
  const r = await db.query(`update users set coins=coins-$1, ${col}=greatest(${col},$2)+$3 where steam_id=$4 and coins>=$1 returning plus_until, grant_until`,
    [cost, Date.now(), days * 864e5, req.u.steam_id]);
  if (!r.rowCount) return bad(res, 'Недостаточно монет');
  if (key === 'plus') {
    try { await grantGameAdmin(req.u, Math.max(+r.rows[0].plus_until, +r.rows[0].grant_until), { name: nick }); }
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
  const c = await db.connect();
  try {
    await c.query('begin');
    const p = (await c.query('select * from promos where code=$1 for update', [code])).rows[0]; // блокируем строку: лимит не обойти двумя запросами сразу
    if (!p) { await c.query('rollback'); return res.status(404).json({ error: 'Код не найден' }); }
    if (p.max > 0 && p.used >= p.max) { await c.query('rollback'); return bad(res, 'Лимит активаций этого кода исчерпан'); }
    const ins = await c.query('insert into promo_used values($1,$2) on conflict do nothing', [req.u.steam_id, code]);
    if (!ins.rowCount) { await c.query('rollback'); return bad(res, 'Этот код уже был использован'); }
    await c.query('update promos set used=used+1 where code=$1', [code]);
    await c.query('update users set coins=coins+$1 where steam_id=$2', [p.coins, req.u.steam_id]);
    await c.query('commit');
    res.json({ ok: true, coins: +p.coins });
  } catch (e) { await c.query('rollback').catch(() => {}); console.error('promo:', e.message); res.status(500).json({ error: 'Не удалось активировать код, попробуйте позже' }); }
  finally { c.release(); }
});

// --- список серверов на странице Public ---
app.get('/api/servers', async (req, res) => {
  try { res.json((await db.query('select id,name,address from servers order by id')).rows); }
  catch (e) { console.error('servers:', e.message); res.json([]); }
});
app.post('/api/admin/server', can('server'), async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60), addr = String(req.body.address || '').trim();
  if (!name) return bad(res, 'Укажите название сервера');
  if (!/^[\w.-]{3,64}:\d{2,5}$/.test(addr)) return bad(res, 'Адрес должен быть вида 45.95.31.64:27215');
  if (+(await db.query('select count(*) c from servers')).rows[0].c >= 20) return bad(res, 'Достигнут лимит: 20 серверов');
  await db.query('insert into servers(name,address) values($1,$2)', [name, addr]);
  res.json({ ok: true });
});
app.post('/api/admin/server-delete', can('server'), async (req, res) => {
  await db.query('delete from servers where id=$1', [+req.body.id || 0]); res.json({ ok: true });
});

// --- агенты (плагин WeaponPaints: wp_player_agents) ---
let AGC = null, AGT = 0;
async function agentCatalog() {
  if (AGC && Date.now() - AGT < 864e5) return AGC;
  const r = await fetch('https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/agents.json');
  if (!r.ok) throw new Error('agents.json ' + r.status);
  AGC = (await r.json()).map(a => ({ id: a.id, name: a.name, image: a.image, model: a.model_player || a.model || '',
    team: /counter/i.test((a.team && (a.team.id || a.team.name)) || '') ? 'ct' : 't', col: (a.rarity && a.rarity.color) || '#888' })).filter(a => a.model && a.image);
  AGT = Date.now(); console.log('agents loaded:', AGC.length); return AGC;
}
app.get('/api/agents', async (req, res) => {
  try { res.json({ agents: await agentCatalog() }); }
  catch (e) { console.error('agents:', e.message); res.status(502).json({ error: 'Не удалось загрузить список агентов' }); }
});
app.get('/api/myagents', level('user'), async (req, res) => {
  try { const r = (await gq('select agent_ct, agent_t from wp_player_agents where steamid=? limit 1', [req.u.steam_id]))[0]; res.json({ ct: r ? r.agent_ct : null, t: r ? r.agent_t : null }); }
  catch (e) { console.error('myagents:', e.message); res.json({ ct: null, t: null }); }
});
app.post('/api/agent', level('user'), async (req, res) => {
  try {
    const a = (await agentCatalog()).find(x => x.team === req.body.team && x.model === req.body.model);
    if (!a) return bad(res, 'Такого агента нет в списке');
    const col = a.team === 'ct' ? 'agent_ct' : 'agent_t', id = req.u.steam_id;
    const u = await gq(`update wp_player_agents set ${col}=? where steamid=?`, [a.model, id]);
    if (!u.affectedRows) await gq(`insert into wp_player_agents(steamid,${col}) values(?,?)`, [id, a.model]);
    res.json({ ok: true });
  } catch (e) { console.error('agent:', e.message); res.status(500).json({ error: 'Не удалось записать агента в базу игрового сервера' }); }
});
app.post('/api/agent-reset', level('user'), async (req, res) => {
  try { await gq(`update wp_player_agents set ${req.body.team === 'ct' ? 'agent_ct' : 'agent_t'}=NULL where steamid=?`, [req.u.steam_id]); res.json({ ok: true }); }
  catch (e) { console.error('agent-reset:', e.message); res.status(500).json({ error: 'Не удалось сбросить агента' }); }
});

// --- админка ---
app.post('/api/admin/grant', can('grant'), async (req, res) => {
  const { id, days } = req.body;
  if (!/^\d{17}$/.test(id) || id === OWNER) return bad(res, 'Неверный SteamID64 (17 цифр)');
  const opts = {}; // ник, флаги и иммунитет могут задавать владелец и замы; штатный админ игры выдаёт со значениями по умолчанию
  if (isFull(req.u)) {
    const nick = String(req.body.name || '').trim().slice(0, 64), flags = String(req.body.flags || '').trim(), imm = req.body.immunity;
    if (flags && !/^[a-z]{1,26}$/i.test(flags)) return bad(res, 'Флаги — только латинские буквы, например z или abcdefj');
    if (imm !== undefined && imm !== null && imm !== '') {
      const v = +imm; if (!Number.isInteger(v) || v < 0 || v > 100) return bad(res, 'Иммунитет — целое число от 0 до 100');
      opts.immunity = v;
    }
    if (nick) opts.name = nick;
    if (flags) opts.flags = flags;
  }
  try {
    const err = await adminPurchaseCheck(id, false); if (err) return bad(res, err);
    const row = (await db.query('select name, grant_until from users where steam_id=$1', [id])).rows[0] || {};
    const cur = +row.grant_until || 0, d = +days === 0 ? 0 : Math.min(+days || 30, 3650);
    const until = d === 0 ? FOREVER : Math.max(Date.now(), cur < FOREVER ? cur : 0) + d * 864e5;
    await grantGameAdmin({ steam_id: id, name: row.name }, until, opts); // сначала игра: если не вышло — на сайте ничего не меняем
    await db.query('insert into users(steam_id) values($1) on conflict do nothing', [id]);
    await db.query('update users set grant_until=$2, grant_by=$3, grant_at=$4 where steam_id=$1', [id, until, req.u.steam_id, Date.now()]);
    res.json({ ok: true });
  } catch (e) { console.error('grant:', e.message); res.status(500).json({ error: 'Не удалось выдать админку в игре: ' + e.message }); }
});
app.post('/api/admin/revoke', can('grant'), async (req, res) => {
  const id = req.body.id;
  if (!/^\d{17}$/.test(id)) return bad(res, 'Неверный SteamID64');
  if (id === OWNER) return bad(res, 'Нельзя снять админку с владельца');
  try {
    const row = (await db.query('select plus_until, grant_until, deputy from users where steam_id=$1', [id])).rows[0];
    if (!isFull(req.u) && (!row || row.deputy || !(+row.grant_until > 0 || +row.plus_until > 0)))
      return bad(res, 'Вы можете снимать только админку, выданную через сайт или купленную. Остальных удаляет владелец или зам');
    await deleteGameAdmin(id); // сначала игра: если не вышло — на сайте ничего не меняем
    if (row) await db.query('update users set grant_until=0, plus_until=0 where steam_id=$1', [id]);
    res.json({ ok: true });
  } catch (e) { console.error('revoke:', e.message); res.status(500).json({ error: 'Не удалось удалить админа в игре: ' + e.message }); }
});
// --- редактирование админа в базе игры (iks_admins): ник, флаги, иммунитет, срок, вкл/выкл — владелец и замы ---
const fullOnly = async (req, res, next) => {
  const u = await getUser(req);
  if (!u) return res.status(401).json({ error: 'Войдите через Steam' });
  if (!isFull(u)) return res.status(403).json({ error: 'Нет прав' });
  req.u = u; next();
};
app.post('/api/admin/admin-edit', fullOnly, async (req, res) => {
  try {
    if (!game) return bad(res, 'База игрового сервера не подключена');
    const b = req.body, id = String(b.id || '');
    if (!/^\d{17}$/.test(id)) return bad(res, 'Неверный SteamID64');
    if (id === OWNER && req.u.steam_id !== OWNER) return bad(res, 'Владельца может менять только он сам');
    const ex = (await gq('select id from iks_admins where steam_id=? and deleted_at is null limit 1', [id]))[0];
    if (!ex) return bad(res, 'Такого админа нет в базе игры');
    const set = ['updated_at=?'], p = [nowS()];
    const nick = String(b.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64);
    if (nick) { if (nick.length < 2) return bad(res, 'Ник — минимум 2 символа'); set.push('name=?'); p.push(nick); }
    const flags = String(b.flags || '').trim();
    if (flags) { if (!/^[a-z]{1,26}$/i.test(flags)) return bad(res, 'Флаги — только латинские буквы, например z или abcdefj'); set.push('flags=?'); p.push(flags); }
    if (b.immunity !== undefined && b.immunity !== null && b.immunity !== '') {
      const v = +b.immunity; if (!Number.isInteger(v) || v < 0 || v > 100) return bad(res, 'Иммунитет — целое число от 0 до 100');
      set.push('immunity=?'); p.push(v);
    }
    if (typeof b.off === 'boolean') { set.push('is_disabled=?'); p.push(b.off ? 1 : 0); }
    let end;
    if (b.days !== undefined && b.days !== null && b.days !== '' && b.days !== 'keep') {
      const d = +b.days; if (!Number.isFinite(d) || d < 0) return bad(res, 'Неверный срок');
      end = d === 0 ? 0 : nowS() + Math.min(Math.floor(d), 3650) * 86400; // 0 = навсегда
      set.push('end_at=?'); p.push(end);
    }
    await gq(`update iks_admins set ${set.join(',')} where id=?`, [...p, ex.id]);
    gaCache.delete(id);
    if (end !== undefined) await db.query('update users set grant_until=$2 where steam_id=$1 and grant_until>0', [id, end === 0 ? FOREVER : end * 1000]);
    res.json({ ok: true });
  } catch (e) { console.error('admin-edit:', e.message); res.status(500).json({ error: 'Не удалось изменить админа в игре: ' + e.message }); }
});
app.post('/api/admin/promo-edit', can('promo'), async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase(), coins = +req.body.coins, max = Math.floor(+req.body.max || 0);
  if (!(coins > 0 && coins <= 100000)) return bad(res, 'Награда: число от 1 до 100 000');
  if (max < 0) return bad(res, 'Лимит не может быть отрицательным');
  const r = await db.query('update promos set coins=$2, max=$3 where code=$1', [code, coins, max]);
  r.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Код не найден' });
});
app.post('/api/admin/deputy', level('owner'), async (req, res) => {
  const { id, on } = req.body;
  if (!/^\d{17}$/.test(id) || id === OWNER) return bad(res, 'Неверный SteamID64 (17 цифр)');
  await db.query('insert into users(steam_id) values($1) on conflict do nothing', [id]);
  await db.query('update users set deputy=$2, dep_by=$3, dep_at=$4 where steam_id=$1', [id, !!on, req.u.steam_id, Date.now()]);
  res.json({ ok: true });
});
app.post('/api/admin/perms', level('owner'), async (req, res) => {
  const id = req.body.id, list = [...new Set((Array.isArray(req.body.perms) ? req.body.perms : []).map(String))];
  if (!/^\d{17}$/.test(id) || id === OWNER) return bad(res, 'Неверный SteamID64 (17 цифр)');
  if (list.some(p => !PERMS[p])) return bad(res, 'Неизвестное право');
  await db.query('insert into users(steam_id) values($1) on conflict do nothing', [id]);
  await db.query('update users set perms=$2 where steam_id=$1', [id, list.join(',')]);
  res.json({ ok: true });
});
const THEME_KEYS = ['blue', 'red', 'yellow', 'green', 'rgb'];
app.get('/api/site', async (req, res) => { // тема сайта по умолчанию — для всех посетителей
  try { const r = (await db.query("select value from site where key='theme'")).rows[0]; res.json({ theme: r && THEME_KEYS.includes(r.value) ? r.value : 'blue' }); }
  catch (e) { console.error('site:', e.message); res.json({ theme: 'blue' }); }
});
app.post('/api/admin/design', can('design'), async (req, res) => {
  const theme = String(req.body.theme || '');
  if (!THEME_KEYS.includes(theme)) return bad(res, 'Неизвестная тема');
  await db.query("insert into site(key,value) values('theme',$1) on conflict (key) do update set value=excluded.value", [theme]);
  res.json({ ok: true });
});
app.post('/api/admin/promo', can('promo'), async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase(), coins = +req.body.coins, max = Math.floor(+req.body.max || 0);
  if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(code)) return bad(res, 'Код: 2–32 символа — буквы (в т.ч. русские), цифры, _ или -, без пробелов');
  if (!(coins > 0 && coins <= 100000)) return bad(res, 'Награда: число от 1 до 100 000');
  const r = await db.query('insert into promos(code,coins,max,by,at) values($1,$2,$3,$4,$5) on conflict do nothing', [code, coins, max, req.u.steam_id, Date.now()]);
  r.rowCount ? res.json({ ok: true }) : bad(res, 'Такой код уже существует');
});
app.post('/api/admin/promo-delete', can('promo'), async (req, res) => {
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
app.post('/api/admin/punish', can('ban'), async (req, res) => {
  try {
    const t = String(req.body.target || '').trim(), kind = req.body.kind === 'mutes' ? 'mutes' : 'bans';
    const reason = String(req.body.reason || '').trim().slice(0, 120) || 'Без причины', days = Math.max(0, Math.min(+req.body.days || 0, 3650));
    if (!/^\d{17}$/.test(t)) return bad(res, 'Укажите SteamID64 игрока (17 цифр)');
    if (t === OWNER) return bad(res, 'Нельзя наказать владельца');
    const adm = await gameAdmin(req.u.steam_id);
    if (!adm) return bad(res, 'Чтобы банить с сайта, ваш SteamID должен быть в списке админов игры (iks_admins) — попросите выдать вам админку');
    const srv = (await gq('select id from iks_servers order by id limit 1'))[0];
    const u = (await db.query('select name from users where steam_id=$1', [t])).rows[0];
    const n = nowS(), dur = days * 86400, T = kind === 'mutes' ? 'iks_comms' : 'iks_bans', TY = kind === 'mutes' ? 'mute_type' : 'ban_type';
    await gq(`insert into ${T}(steam_id,name,duration,reason,${TY},server_id,admin_id,created_at,end_at,updated_at) values(?,?,?,?,?,?,?,?,?,?)`,
      [t, (u && u.name) || t, dur, reason, kind === 'mutes' ? 2 : 0, srv ? srv.id : null, adm.id, n, dur ? n + dur : 0, n]);
    res.json({ ok: true });
  } catch (e) { console.error('punish:', e.message); res.status(500).json({ error: 'Не удалось записать в базу игрового сервера: ' + e.message }); }
});

app.post('/api/admin/unban', can('unban'), async (req, res) => {
  try {
    const t = String(req.body.target || '').trim(), T = req.body.kind === 'mutes' ? 'iks_comms' : 'iks_bans';
    if (!/^\d{17}$/.test(t)) return bad(res, 'Укажите SteamID64 игрока (17 цифр)');
    const r = await gq(`delete from ${T} where steam_id=? and unbanned_by is null and deleted_at is null and (end_at=0 or end_at>?)`, [t, nowS()]);
    res.json({ ok: true, count: r.affectedRows });
  } catch (e) { console.error('unban:', e.message); res.status(500).json({ error: 'Не удалось изменить базу игрового сервера: ' + e.message }); }
});

// --- Скин-ченджер (плагин WeaponPaints: таблицы wp_player_skins и wp_player_knife) ---
const WEAPONS = { // defindex, название, категория
  weapon_deagle: [1, 'Desert Eagle', 'Пистолеты'], weapon_elite: [2, 'Dual Berettas', 'Пистолеты'], weapon_fiveseven: [3, 'Five-SeveN', 'Пистолеты'],
  weapon_glock: [4, 'Glock-18', 'Пистолеты'], weapon_hkp2000: [32, 'P2000', 'Пистолеты'], weapon_p250: [36, 'P250', 'Пистолеты'],
  weapon_tec9: [30, 'Tec-9', 'Пистолеты'], weapon_cz75a: [63, 'CZ75-Auto', 'Пистолеты'], weapon_usp_silencer: [61, 'USP-S', 'Пистолеты'], weapon_revolver: [64, 'R8 Revolver', 'Пистолеты'],
  weapon_mac10: [17, 'MAC-10', 'ПП'], weapon_mp5sd: [23, 'MP5-SD', 'ПП'], weapon_mp7: [33, 'MP7', 'ПП'], weapon_mp9: [34, 'MP9', 'ПП'],
  weapon_p90: [19, 'P90', 'ПП'], weapon_bizon: [26, 'PP-Bizon', 'ПП'], weapon_ump45: [24, 'UMP-45', 'ПП'],
  weapon_ak47: [7, 'AK-47', 'Винтовки'], weapon_aug: [8, 'AUG', 'Винтовки'], weapon_famas: [10, 'FAMAS', 'Винтовки'], weapon_galilar: [13, 'Galil AR', 'Винтовки'],
  weapon_m4a1: [16, 'M4A4', 'Винтовки'], weapon_m4a1_silencer: [60, 'M4A1-S', 'Винтовки'], weapon_sg556: [39, 'SG 553', 'Винтовки'],
  weapon_awp: [9, 'AWP', 'Снайперские'], weapon_g3sg1: [11, 'G3SG1', 'Снайперские'], weapon_scar20: [38, 'SCAR-20', 'Снайперские'], weapon_ssg08: [40, 'SSG 08', 'Снайперские'],
  weapon_m249: [14, 'M249', 'Тяжёлое'], weapon_negev: [28, 'Negev', 'Тяжёлое'], weapon_mag7: [27, 'MAG-7', 'Тяжёлое'],
  weapon_nova: [35, 'Nova', 'Тяжёлое'], weapon_sawedoff: [29, 'Sawed-Off', 'Тяжёлое'], weapon_xm1014: [25, 'XM1014', 'Тяжёлое'],
  weapon_bayonet: [500, 'Bayonet', 'Ножи'], weapon_knife_css: [503, 'Classic Knife', 'Ножи'], weapon_knife_flip: [505, 'Flip Knife', 'Ножи'],
  weapon_knife_gut: [506, 'Gut Knife', 'Ножи'], weapon_knife_karambit: [507, 'Karambit', 'Ножи'], weapon_knife_m9_bayonet: [508, 'M9 Bayonet', 'Ножи'],
  weapon_knife_tactical: [509, 'Huntsman Knife', 'Ножи'], weapon_knife_falchion: [512, 'Falchion Knife', 'Ножи'], weapon_knife_survival_bowie: [514, 'Bowie Knife', 'Ножи'],
  weapon_knife_butterfly: [515, 'Butterfly Knife', 'Ножи'], weapon_knife_push: [516, 'Shadow Daggers', 'Ножи'], weapon_knife_cord: [517, 'Paracord Knife', 'Ножи'],
  weapon_knife_canis: [518, 'Survival Knife', 'Ножи'], weapon_knife_ursus: [519, 'Ursus Knife', 'Ножи'], weapon_knife_gypsy_jackknife: [520, 'Navaja Knife', 'Ножи'],
  weapon_knife_outdoor: [521, 'Nomad Knife', 'Ножи'], weapon_knife_stiletto: [522, 'Stiletto Knife', 'Ножи'], weapon_knife_widowmaker: [523, 'Talon Knife', 'Ножи'],
  weapon_knife_skeleton: [525, 'Skeleton Knife', 'Ножи'], weapon_knife_kukri: [526, 'Kukri Knife', 'Ножи'] };
let SKINS = { t: 0, list: [] };
async function loadSkins() { // список скинов с картинками из открытой базы CS2, кэш на сутки
  if (SKINS.list.length && Date.now() - SKINS.t < 864e5) return SKINS.list;
  const r = await fetch('https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json');
  if (!r.ok) throw new Error('Не удалось загрузить список скинов');
  const byDef = {}, byName = {};
  for (const [id, [def, name]] of Object.entries(WEAPONS)) { byDef[def] = id; byName[name.toLowerCase()] = id; }
  const list = []; let skipped = 0;
  for (const s of await r.json()) {
    const p = +s.paint_index; if (!p) continue;
    let w = s.weapon && s.weapon.id;
    if (!WEAPONS[w]) w = byDef[+(s.weapon && s.weapon.weapon_id)] || byDef[+s.def_index]; // по номеру оружия
    if (!WEAPONS[w]) w = byName[String(s.name).split(' | ')[0].replace(/^★\s*/, '').replace(/^StatTrak™\s*/, '').toLowerCase()]; // по названию
    if (!WEAPONS[w] || !s.image) { skipped++; continue; }
    const pat = String((s.pattern && s.pattern.name) || String(s.name).split(' | ')[1] || s.name);
    list.push([w, pat + (s.phase ? ' (' + s.phase + ')' : ''), p, s.image, (s.rarity && s.rarity.color) || '#888']);
  }
  console.log('skins loaded:', list.length, 'knife skins:', list.filter(x => WEAPONS[x[0]][2] === 'Ножи').length, 'skipped:', skipped);
  SKINS = { t: Date.now(), list }; return list;
}
app.get('/api/skins', async (req, res) => {
  try { res.json({ weapons: Object.entries(WEAPONS).map(([id, [def, name, cat]]) => ({ id, def, name, cat })), skins: await loadSkins() }); }
  catch (e) { console.error('skins:', e.message); res.status(502).json({ error: e.message }); }
});
app.get('/api/myskins', level('user'), async (req, res) => {
  try {
    const rows = await gq('select weapon_defindex d, weapon_paint_id p, weapon_wear w, weapon_seed s from wp_player_skins where steamid=? and weapon_team=2', [req.u.steam_id]);
    const k = (await gq('select knife from wp_player_knife where steamid=? and weapon_team=2', [req.u.steam_id]))[0];
    const skins = {}; rows.forEach(r => skins[r.d] = { paint: r.p, wear: r.w, seed: r.s });
    res.json({ skins, knife: k ? k.knife : null });
  } catch (e) { console.error('myskins:', e.message); res.status(500).json({ error: 'Не удалось прочитать скины: ' + e.message }); }
});
app.post('/api/skin', level('user'), async (req, res) => {
  try {
    const weapon = req.body.weapon, W = WEAPONS[weapon]; if (!W) return bad(res, 'Неизвестное оружие');
    const id = req.u.steam_id, isKnife = W[2] === 'Ножи', paint = Math.floor(+req.body.paint || 0);
    if (paint === 0) { // сброс
      await gq('delete from wp_player_skins where steamid=? and weapon_defindex=?', [id, W[0]]);
      if (isKnife) await gq('delete from wp_player_knife where steamid=? and knife=?', [id, weapon]);
      return res.json({ ok: true });
    }
    if (!(await loadSkins()).some(s => s[0] === weapon && s[2] === paint)) return bad(res, 'Такого скина нет');
    const wear = Math.min(1, Math.max(0.000001, +req.body.wear || 0.000001)), seed = Math.min(1000, Math.max(0, Math.floor(+req.body.seed || 0)));
    for (const team of [2, 3]) { // T и CT
      await gq(`insert into wp_player_skins(steamid,weapon_team,weapon_defindex,weapon_paint_id,weapon_wear,weapon_seed) values(?,?,?,?,?,?)
        on duplicate key update weapon_paint_id=values(weapon_paint_id), weapon_wear=values(weapon_wear), weapon_seed=values(weapon_seed)`, [id, team, W[0], paint, wear, seed]);
      if (isKnife) await gq('insert into wp_player_knife(steamid,weapon_team,knife) values(?,?,?) on duplicate key update knife=values(knife)', [id, team, weapon]);
    }
    res.json({ ok: true });
  } catch (e) { console.error('skin:', e.message); res.status(500).json({ error: 'Не удалось сохранить скин: ' + e.message }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
init().then(() => app.listen(process.env.PORT || 3000, () => console.log('ok')))
  .catch(e => { console.error('DB error:', e.message); process.exit(1); });
