const express = require('express'), { Pool } = require('pg'), crypto = require('crypto'), path = require('path');
const OWNER = '76561198659672678';
const PRICE = { prem: [65, 200, 470, 840], plus: [550] }; // как на сайте; Админ+ продаётся только «Навсегда»
const DAYS = { prem: [7, 30, 90, 180], plus: [0] }, FOREVER = 1e15; // 0 дней = навсегда

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
    alter table users add column if not exists last_seen bigint not null default 0;
    create table if not exists site(key text primary key, value text);
    create table if not exists promos(
      code text primary key, coins numeric not null, max int not null default 0,
      used int not null default 0, by text, at bigint);
    create table if not exists promo_used(steam_id text, code text, primary key(steam_id, code));
    alter table promos add column if not exists vip_days int not null default 0;
    alter table promos add column if not exists admin_days int not null default -1;
    create table if not exists chat(id serial primary key, steam_id text not null, text text not null, staff boolean not null default false, at bigint not null);
    create table if not exists servers(id serial primary key, name text not null, address text not null);
    insert into servers(name,address) select 'Мираж (карта меняется)','45.95.31.64:27215' where not exists (select 1 from servers);
    create table if not exists bans(
      id serial primary key, kind text not null, steam_id text, player text, admin text, admin_id text,
      reason text, term text, until bigint not null default 0, active boolean not null default true, at bigint);
    create table if not exists tg_links(tg_id text primary key, steam_id text not null, at bigint);
    create table if not exists tg_link_codes(code text primary key, tg_id text not null, at bigint not null);
    alter table tg_link_codes add column if not exists tg_name text;
    insert into promos(code,coins) values('START100',100),('WELCOME50',50),('NEXTPROJECT',200)
      on conflict do nothing;`);
}

// --- присутствие на сайте: сайт каждые 15–30 секунд опрашивает чат, по этому запросу отмечаем «был онлайн» ---
const seenAt = new Map(); // steam_id -> когда последний раз писали в базу
function touchSeen(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)s=(\d{17})\.([\w-]+)/);
  if (!m || m[2] !== sign(m[1])) return;
  if (Date.now() - (seenAt.get(m[1]) || 0) < 60000) return;
  seenAt.set(m[1], Date.now());
  db.query('update users set last_seen=$2 where steam_id=$1', [m[1], Date.now()]).catch(() => {});
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
    const tgl = (req.headers.cookie || '').match(/(?:^|;\s*)tgl=(LK-[0-9A-F]{24})/)?.[1];
    res.setHeader('Set-Cookie', [`s=${id}.${sign(id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`].concat(tgl ? ['tgl=; Path=/; Max-Age=0'] : []));
    res.redirect(tgl ? '/tg/link/' + tgl : '/');
  } catch (e) { res.status(403).send('Не удалось войти через Steam'); }
});

// --- связка с Telegram-ботом: человек жмёт в боте «Войти через сайт» → открывается эта страница → вход через Steam → подтверждение → аккаунт привязан ---
let tgNotify = () => {}, tgBotName = ''; // заполняются при запуске бота
let ttStart = null; // вход в лобби крестиков-ноликов по ссылке ?start=tt_КОД
let bsStart = null; // вход в лобби морского боя по ссылке t.me/бот?start=bs_КОД (заполняется при запуске бота)
// --- уведомления владельцу в Telegram: кто-то создал промокод / купил Админ+ на сайте. Выключаются в боте (🔔 Уведомления) и в «Настройках» сайта ---
let tgOwnerNotify = async () => {};
let tgCallSend = null;   // отправка ссылки на звонок в Telegram (задаётся при запуске бота)
let msgCallStart = null; // /call из Telegram (задаётся после подключения мессенджера) // заполняется при запуске бота: шлёт сообщение всем владельцам (TG_ADMINS)
const NTF = { promo: 'ntf_promo', buy: 'ntf_buy' }; // в таблице site значение '0' = выключено, нет записи = включено
const ntfOn = async kind => { try { const r = (await db.query('select value from site where key=$1', [NTF[kind]])).rows[0]; return !r || r.value !== '0'; } catch (e) { return true; } };
const ntfGet = async () => ({ promo: await ntfOn('promo'), buy: await ntfOn('buy') });
const ntfSet = (kind, on) => on ? db.query('delete from site where key=$1', [NTF[kind]])
  : db.query("insert into site(key,value) values($1,'0') on conflict (key) do update set value='0'", [NTF[kind]]);
const ownerNotify = (kind, text) => { ntfOn(kind).then(on => on && tgOwnerNotify(text)).catch(e => console.error('ownerNotify:', e.message)); }; // не ждём и не ломаем запрос, если Telegram недоступен
const escH = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkPage = (title, text, btns = '') => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escH(title)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0e0f14;color:#e8e9ef;font:16px/1.5 system-ui,sans-serif}
.c{max-width:440px;margin:20px;padding:28px;background:#171922;border:1px solid #2a2d3a;border-radius:16px;text-align:center}h1{font-size:21px;margin:0 0 12px}p{color:#aeb2c2;margin:8px 0}
.b{display:inline-block;margin:12px 6px 0;padding:11px 20px;border-radius:10px;background:#5b6cff;color:#fff;text-decoration:none;border:0;font:inherit;cursor:pointer}.b.g{background:#2a2d3a}</style></head>
<body><div class="c"><h1>${escH(title)}</h1>${text}${btns}</div></body></html>`;
const backBtns = () => (tgBotName ? `<a class="b" href="https://t.me/${escH(tgBotName)}">Вернуться в бота</a>` : '') + '<a class="b g" href="/">На сайт</a>';
async function tgConsumeLink(token, steamId) { // одноразовый токен -> привязка; возвращает tg_id или null
  const r = await db.query('delete from tg_link_codes where code=$1 and at>$2 returning tg_id', [token, Date.now() - 9e5]);
  if (!r.rowCount) return null;
  const tg = r.rows[0].tg_id;
  await db.query('delete from tg_links where steam_id=$1', [steamId]);
  await db.query('insert into tg_links(tg_id,steam_id,at) values($1,$2,$3) on conflict (tg_id) do update set steam_id=excluded.steam_id, at=excluded.at', [tg, steamId, Date.now()]);
  return tg;
}
const LINK_RE = /^LK-[0-9A-F]{24}$/;
app.get('/tg/link/:token', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const t = String(req.params.token || '').toUpperCase();
  if (!LINK_RE.test(t)) return res.status(400).send(linkPage('Ссылка недействительна', '<p>Откройте бота и нажмите «Войти через сайт» ещё раз.</p>', backBtns()));
  try {
    const u = await getUser(req);
    if (!u) { // сначала вход через Steam, потом вернёмся сюда
      res.setHeader('Set-Cookie', `tgl=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900`);
      return res.redirect('/auth/steam');
    }
    const row = (await db.query('select tg_id, tg_name from tg_link_codes where code=$1 and at>$2', [t, Date.now() - 9e5])).rows[0];
    if (!row) return res.status(400).send(linkPage('Ссылка устарела', '<p>Она действует 15 минут и работает один раз. Откройте бота и нажмите «Войти через сайт» ещё раз.</p>', backBtns()));
    res.send(linkPage('Привязать Telegram?',
      `<p>Telegram: <b>${escH(row.tg_name || row.tg_id)}</b> (ID ${escH(row.tg_id)})</p><p>Аккаунт на сайте: <b>${escH(u.name || u.steam_id)}</b></p>
<p>После подтверждения этот Telegram сможет тратить монеты, покупать VIP и активировать промокоды на этом аккаунте. Подтверждайте, только если это ваш Telegram.</p>`,
      `<form method="post" action="/tg/link/${t}" style="display:inline"><button class="b" type="submit">✅ Подтвердить</button></form><a class="b g" href="/">Отмена</a>`));
  } catch (e) { console.error('tg link page:', e.message); res.status(500).send(linkPage('Ошибка', '<p>Попробуйте позже.</p>', backBtns())); }
});
app.post('/tg/link/:token', express.urlencoded({ extended: false }), async (req, res) => { // подтверждение; cookie SameSite=Lax, так что чужой сайт отправить этот POST не может
  res.setHeader('Cache-Control', 'no-store');
  const t = String(req.params.token || '').toUpperCase();
  try {
    const u = await getUser(req);
    if (!u || !LINK_RE.test(t)) return res.redirect('/tg/link/' + encodeURIComponent(t));
    const tg = await tgConsumeLink(t, u.steam_id);
    if (!tg) return res.status(400).send(linkPage('Ссылка устарела', '<p>Откройте бота и нажмите «Войти через сайт» ещё раз.</p>', backBtns()));
    tgNotify(tg, `✅ Аккаунт «${u.name || u.steam_id}» привязан к этому Telegram. Теперь им можно управлять отсюда.`);
    res.send(linkPage('Готово ✅', `<p>Аккаунт <b>${escH(u.name || u.steam_id)}</b> привязан к Telegram.</p><p>Вернитесь в бота — раздел «👤 Мой аккаунт».</p>`, backBtns()));
  } catch (e) { console.error('tg link confirm:', e.message); res.status(500).send(linkPage('Ошибка', '<p>Попробуйте позже.</p>', backBtns())); }
});
app.post('/auth/logout', (req, res) => { res.setHeader('Set-Cookie', 's=; Path=/; Max-Age=0'); res.json({ ok: true }); });

// --- данные игрока ---
app.get('/api/me', async (req, res) => {
  const u = await getUser(req);
  if (!u) return res.json(null);
  await refreshProfiles([u]); // если ника/аватарки нет — подтягиваем из Steam
  const out = pub(u);
  const P = out.perms;
  if (u.steam_id === OWNER) out.ntf = await ntfGet();
  if (P.length) { // данные админ-панели отдаём только тем, кому они нужны по правам
    const g = {}, d = {}, owner = u.steam_id === OWNER;
    if (P.includes('grant')) { const rows = (await db.query('select * from users where grant_until>0')).rows; await refreshProfiles(rows);
      rows.forEach(r => g[r.steam_id] = { until: +r.grant_until, by: r.grant_by, at: +r.grant_at, name: r.name, avatar: r.avatar }); }
    if (owner) { const rows = (await db.query('select * from users where deputy')).rows; await refreshProfiles(rows);
      rows.forEach(r => d[r.steam_id] = { by: r.dep_by, at: +r.dep_at, name: r.name, avatar: r.avatar }); }
    const vips = {};
    if (isFull(u)) { const rows = (await db.query('select * from users where prem_until>0')).rows; await refreshProfiles(rows);
      rows.forEach(r => vips[r.steam_id] = { until: +r.prem_until, name: r.name, avatar: r.avatar }); }
    out.adm = { vips, grants: g, deputies: d, promos: P.includes('promo') ? (await db.query('select * from promos order by at desc nulls last')).rows.map(p => ({ ...p, coins: +p.coins, at: +p.at })) : [] };
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

// --- выдача VIP в игре при покупке Премиума (таблица vip_users плагина VIP) ---
const VIP_GROUP = process.env.VIP_GROUP || 'Premium'; // название группы из groups.ini плагина VIP
const STEAM64_BASE = 76561197960265728n;
const accountId = id => Number(BigInt(id) - STEAM64_BASE); // SteamID64 -> account_id (SteamID3)
async function vipSid(q) { // id сервера из vip_servers (если в таблице нет такой колонки — берём VIP_SID или 0)
  if (process.env.VIP_SID !== undefined) return +process.env.VIP_SID || 0;
  try {
    const cols = (await q('show columns from vip_servers')).map(c => c.Field);
    const col = ['serverId', 'sid', 'id', 'server_id'].map(n => cols.find(c => c.toLowerCase() === n.toLowerCase())).find(Boolean);
    if (col) { const r = (await q(`select \`${col}\` as v from vip_servers order by \`${col}\` limit 1`))[0]; if (r) return +r.v; }
  } catch (e) { console.error('vip_servers:', e.message); }
  return 0;
}
async function vipPurchaseCheck(id) {
  if (!game) return 'Выдача VIP сейчас недоступна, попробуйте позже';
  try {
    const sid = await vipSid(gq);
    const ex = (await gq('select `expires` from vip_users where account_id=? and sid=? limit 1', [accountId(id), sid]))[0];
    if (ex && +ex.expires === 0) return 'У вас уже постоянный VIP на сервере — покупка не нужна';
  } catch (e) { console.error('vipCheck:', e.message); return 'Не удалось связаться с базой игрового сервера'; }
  return null;
}
async function grantGameVip(u, untilMs, exact = false) { // untilMs — до какого момента VIP (в игре expires в секундах, 0 = навсегда)
  const conn = await game.getConnection();
  try {
    await conn.beginTransaction();
    const q = async (sql, p) => (await conn.query(sql, p))[0];
    const n = nowS(), acc = accountId(u.steam_id), sid = await vipSid(q), end = untilMs >= FOREVER ? 0 : Math.floor(untilMs / 1000);
    const name = String(u.name || u.steam_id).slice(0, 64);
    const ex = (await q('select `expires` from vip_users where account_id=? and sid=? limit 1', [acc, sid]))[0];
    if (ex) { // продлеваем; срок не уменьшаем, если в игре он уже длиннее
      const exp = exact ? end : end === 0 || +ex.expires === 0 ? 0 : Math.max(+ex.expires, end); // exact — выдача владельцем/замом: срок ставится ровно как задан
      await q('update vip_users set `group`=?, `expires`=?, `name`=?, `lastvisit`=? where account_id=? and sid=?', [VIP_GROUP, exp, name, n, acc, sid]);
    } else {
      const cols = (await q('show columns from vip_users')).filter(c => !/auto_increment/i.test(c.Extra));
      const val = c => ({ account_id: acc, sid, name, group: VIP_GROUP, expires: end, lastvisit: n })[c.Field]
        ?? (c.Null === 'NO' && c.Default === null ? (/int|decimal/i.test(c.Type) ? 0 : '') : c.Default);
      await q(`insert into vip_users(${cols.map(c => '`' + c.Field + '`').join(',')}) values(${cols.map(() => '?').join(',')})`, cols.map(val));
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

app.post('/api/buy', level('user'), async (req, res) => {
  const { key, idx } = req.body, cost = PRICE[key]?.[idx];
  if (cost === undefined) return bad(res, 'Неверный тариф');
  const col = key === 'plus' ? 'plus_until' : 'prem_until', days = DAYS[key][idx], prev = req.u[col];
  await refreshProfiles([req.u]); // ник берём автоматически из Steam (если в базе его ещё нет — подтягиваем)
  let nick = String(req.u.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
  if (nick.length < 2 || nick === 'Игрок') nick = req.u.steam_id; // запасной вариант, если Steam не отдал ник
  const err = await (key === 'plus' ? adminPurchaseCheck(req.u.steam_id) : vipPurchaseCheck(req.u.steam_id)); if (err) return bad(res, err);
  const forever = days === 0; // «Навсегда»: срок = FOREVER, в игре end_at=0
  const r = forever
    ? await db.query(`update users set coins=coins-$1, ${col}=$2 where steam_id=$3 and coins>=$1 returning plus_until, grant_until, prem_until`, [cost, FOREVER, req.u.steam_id])
    : await db.query(`update users set coins=coins-$1, ${col}=greatest(${col},$2)+$3 where steam_id=$4 and coins>=$1 returning plus_until, grant_until, prem_until`,
        [cost, Date.now(), days * 864e5, req.u.steam_id]);
  if (!r.rowCount) return bad(res, 'Недостаточно монет');
  {
    try {
      if (key === 'plus') await grantGameAdmin(req.u, Math.max(+r.rows[0].plus_until, +r.rows[0].grant_until), { name: nick });
      else await grantGameVip({ steam_id: req.u.steam_id, name: nick }, +r.rows[0].prem_until);
    }
    catch (e) { // не получилось выдать в игре — возвращаем монеты
      console.error('grantGame:', e.message);
      await db.query(`update users set coins=coins+$1, ${col}=$2 where steam_id=$3`, [cost, prev, req.u.steam_id]);
      return res.status(500).json({ error: `Не удалось выдать ${key === 'plus' ? 'админку' : 'VIP'} в игре, монеты возвращены. Попробуйте позже.` });
    }
  }
  if (key === 'plus' && req.u.steam_id !== OWNER) ownerNotify('buy', `🛡 Куплена админка на сайте\nИгрок: ${nick} (${req.u.steam_id})\nТариф: ${forever ? 'навсегда' : days + ' дн.'}\nЦена: ${cost} монет`);
  res.json({ ok: true });
});
// любой игрок может создать свой промокод: награда за активацию × число активаций списывается с его баланса сразу
app.post('/api/promo/create', level('user'), async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase(), coins = Math.floor(+req.body.coins), max = Math.floor(+req.body.max);
  if (!/^[\p{L}\p{N}_-]{3,20}$/u.test(code)) return bad(res, 'Код: 3–20 символов — буквы, цифры, _ или -, без пробелов');
  if (!(coins >= 10 && coins <= 10000)) return bad(res, 'Сумма промокода: от 10 до 10 000 монет');
  if (!(max >= 3 && max <= 1000)) return bad(res, 'Количество активаций: от 3 до 1000');
  const cost = coins * max, c = await db.connect();
  try {
    await c.query('begin');
    const u = (await c.query('select coins from users where steam_id=$1 for update', [req.u.steam_id])).rows[0]; // блокируем баланс: нельзя потратить одни и те же монеты дважды
    if (!u || +u.coins < cost) { await c.query('rollback'); return bad(res, `Не хватает монет: нужно ${cost}`); }
    const ins = await c.query('insert into promos(code,coins,max,by,at) values($1,$2,$3,$4,$5) on conflict do nothing', [code, coins, max, req.u.steam_id, Date.now()]);
    if (!ins.rowCount) { await c.query('rollback'); return bad(res, 'Такой промокод уже существует, придумайте другой'); }
    await c.query('update users set coins=coins-$1 where steam_id=$2', [cost, req.u.steam_id]);
    await c.query('commit');
    if (req.u.steam_id !== OWNER) ownerNotify('promo', `🎟 Новый промокод на сайте\nКод: ${code}\nСоздал: ${req.u.name || 'Игрок'} (${req.u.steam_id})\nНаграда: ${coins} монет × ${max} активаций\nСписано с его баланса: ${cost}`);
    res.json({ ok: true, code, cost });
  } catch (e) { await c.query('rollback').catch(() => {}); console.error('promo-create:', e.message); res.status(500).json({ error: 'Не удалось создать промокод, попробуйте позже' }); }
  finally { c.release(); }
});
app.post('/api/promo', level('user'), async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  if (/^TG-[0-9A-F]{8}$/.test(code)) { // код привязки Telegram из команды /link бота (вводится в то же окно промокода)
    try {
      const r = await db.query('delete from tg_link_codes where code=$1 and at>$2 returning tg_id', [code, Date.now() - 9e5]);
      if (!r.rowCount) return bad(res, 'Код привязки неверный или просрочен — отправьте боту /link ещё раз');
      await db.query('delete from tg_links where steam_id=$1', [req.u.steam_id]);
      await db.query('insert into tg_links(tg_id,steam_id,at) values($1,$2,$3) on conflict (tg_id) do update set steam_id=excluded.steam_id, at=excluded.at', [r.rows[0].tg_id, req.u.steam_id, Date.now()]);
      return res.json({ ok: true, msg: 'Telegram привязан. Если у вас есть Админ+, в боте откроется «Админ панель»' });
    } catch (e) { console.error('tg link:', e.message); return res.status(500).json({ error: 'Не удалось привязать Telegram, попробуйте позже' }); }
  }
  const c = await db.connect();
  try {
    await c.query('begin');
    const p = (await c.query('select * from promos where code=$1 for update', [code])).rows[0]; // блокируем строку: лимит не обойти двумя запросами сразу
    if (!p) { await c.query('rollback'); return res.status(404).json({ error: 'Код не найден' }); }
    if (p.max > 0 && p.used >= p.max) { await c.query('rollback'); return bad(res, 'Лимит активаций этого кода исчерпан'); }
    let vipUntil = 0;
    if (+p.vip_days > 0) { // промокод на VIP: сначала проверяем, что VIP можно выдать, — при отказе код не тратится
      const cur = (await c.query('select prem_until from users where steam_id=$1', [req.u.steam_id])).rows[0];
      const curUntil = cur ? +cur.prem_until : 0;
      const err = curUntil >= FOREVER ? 'У вас уже постоянный VIP — этот код не нужен' : await vipPurchaseCheck(req.u.steam_id);
      if (err) { await c.query('rollback'); return bad(res, err); }
      vipUntil = Math.max(Date.now(), curUntil) + p.vip_days * 864e5;
    }
    let admUntil = 0;
    if (+p.admin_days >= 0) { // ключ на Админ+ (0 дней = навсегда): проверяем заранее — при отказе ключ не тратится
      const curG = +req.u.grant_until || 0;
      const err = curG >= FOREVER ? 'У вас уже постоянная админка — этот ключ не нужен' : await adminPurchaseCheck(req.u.steam_id);
      if (err) { await c.query('rollback'); return bad(res, err); }
      admUntil = +p.admin_days === 0 ? FOREVER : Math.max(Date.now(), curG) + p.admin_days * 864e5;
    }
    const ins = await c.query('insert into promo_used values($1,$2) on conflict do nothing', [req.u.steam_id, code]);
    if (!ins.rowCount) { await c.query('rollback'); return bad(res, 'Этот код уже был использован'); }
    await c.query('update promos set used=used+1 where code=$1', [code]);
    await c.query('update users set coins=coins+$1 where steam_id=$2', [p.coins, req.u.steam_id]);
    if (vipUntil) {
      let nick = String(req.u.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
      if (nick.length < 2 || nick === 'Игрок') nick = req.u.steam_id;
      try { await grantGameVip({ steam_id: req.u.steam_id, name: nick }, vipUntil); }
      catch (e) { await c.query('rollback'); console.error('promo vip:', e.message); return res.status(500).json({ error: 'Не удалось выдать VIP в игре, код не потрачен. Попробуйте позже.' }); }
      await c.query('update users set prem_until=$1 where steam_id=$2', [vipUntil, req.u.steam_id]);
    }
    if (admUntil) {
      let nick = String(req.u.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
      if (nick.length < 2 || nick === 'Игрок') nick = req.u.steam_id;
      try { await grantGameAdmin({ steam_id: req.u.steam_id, name: nick }, admUntil, { name: nick }); }
      catch (e) { await c.query('rollback'); console.error('promo admin:', e.message); return res.status(500).json({ error: 'Не удалось выдать админку в игре, ключ не потрачен. Попробуйте позже.' }); }
      await c.query('update users set grant_until=$1, grant_by=$2, grant_at=$3 where steam_id=$4', [admUntil, 'key:' + code, Date.now(), req.u.steam_id]);
    }
    await c.query('commit');
    res.json({ ok: true, coins: +p.coins, vip: +p.vip_days, msg: vipUntil ? `Код активирован: VIP на ${p.vip_days} дн.` : admUntil ? `Ключ активирован: Админ+ ${+p.admin_days ? 'на ' + p.admin_days + ' дн.' : 'навсегда'}` : undefined });
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

// --- перезагрузка игрового сервера через RCON (только владелец и назначенные замы) ---
// Пароль RCON задан ниже в строке const pass = ... (он должен совпадать с rcon_password в server.cfg игрового сервера). Команда по умолчанию — quit, меняется через RESTART_CMD
const RCON_PASS = process.env.RCON_PASSWORD || '3465ergsdfgasdfs23wwsaw%urt'; // лучше задать RCON_PASSWORD в Render и убрать значение по умолчанию отсюда
function rconExec(host, port, password, command) {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0), authed = false, done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => finish(new Error('Сервер не отвечает по RCON')), 8000);
    const pack = (id, type, body) => { const b = Buffer.from(body, 'utf8'), out = Buffer.alloc(14 + b.length); out.writeInt32LE(10 + b.length, 0); out.writeInt32LE(id, 4); out.writeInt32LE(type, 8); b.copy(out, 12); return out; };
    sock.on('connect', () => sock.write(pack(1, 3, password)));
    sock.on('error', e => finish(new Error('Нет связи с сервером: ' + e.message)));
    sock.on('close', () => finish(authed ? null : new Error('Соединение закрыто'), 'ok'));
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 12) {
        const size = buf.readInt32LE(0); if (buf.length < size + 4) break;
        const id = buf.readInt32LE(4), type = buf.readInt32LE(8); buf = buf.subarray(size + 4);
        if (type === 2 && !authed) { // ответ на авторизацию
          if (id === -1) return finish(new Error('Неверный RCON-пароль'));
          authed = true; sock.write(pack(2, 2, command));
          setTimeout(() => finish(null, 'ok'), 700); // команда quit обрывает соединение — это нормально
        }
      }
    });
  });
}
// RCON-запрос с получением ответа (нужен для списка игроков)
function rconQuery(host, port, password, command) {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0), authed = false, done = false, out = '';
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => finish(authed ? null : new Error('Сервер не отвечает по RCON'), out), 8000);
    const pack = (id, type, body) => { const b = Buffer.from(body, 'utf8'), o = Buffer.alloc(14 + b.length); o.writeInt32LE(10 + b.length, 0); o.writeInt32LE(id, 4); o.writeInt32LE(type, 8); b.copy(o, 12); return o; };
    sock.on('connect', () => sock.write(pack(1, 3, password)));
    sock.on('error', e => finish(new Error('Нет связи с сервером: ' + e.message)));
    sock.on('close', () => finish(authed ? null : new Error('Соединение закрыто'), out));
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 12) {
        const size = buf.readInt32LE(0); if (buf.length < size + 4) break;
        const id = buf.readInt32LE(4), type = buf.readInt32LE(8), body = buf.subarray(12, size + 2).toString('utf8'); buf = buf.subarray(size + 4);
        if (type === 2 && !authed) {
          if (id === -1) return finish(new Error('Неверный RCON-пароль'));
          authed = true; sock.write(pack(2, 2, command)); sock.write(pack(3, 0, '')); // второй пакет — «метка конца» ответа
        } else if (authed && id === 2) out += body;
        else if (authed && id === 3) return finish(null, out);
      }
    });
  });
}
// общая проверка для RCON-действий: только владелец и назначенные замы
async function rconGate(req, res) {
  const u = await getUser(req);
  if (!u) { res.status(401).json({ error: 'Войдите через Steam' }); return null; }
  if (!isFull(u)) { res.status(403).json({ error: 'Доступно только владельцу и замам' }); return null; }
  const r = (await db.query('select name,address from servers where id=$1', [+req.body.id || 0])).rows[0];
  if (!r) { bad(res, 'Сервер не найден'); return null; }
  const [host, port] = r.address.split(':');
  return { u, r, host, port: +port, pass: RCON_PASS };
}
// список игроков онлайн: команда status, разбираем строки игроков
app.post('/api/admin/server-players', async (req, res) => {
  const g = await rconGate(req, res); if (!g) return;
  try {
    const raw = await rconQuery(g.host, g.port, g.pass, 'status');
    const players = [];
    for (const line of raw.split('\n')) {
      let m = line.match(/^\s*(\d+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+'(.*)'\s*$/); // формат CS2
      if (m && m[7] !== '[NoChan]') { players.push({ userid: m[1], name: m[8] || '(без ника)', bot: m[2] === 'BOT', time: m[2], ping: +m[3] }); continue; }
      m = line.match(/^#\s*(\d+)\s+\d+\s+"(.*)"\s+(\S+)/); // запасной формат (как в CS:GO)
      if (m) players.push({ userid: m[1], name: m[2], bot: m[3] === 'BOT' });
    }
    res.json({ players: players.filter(p => !p.bot), raw: raw.slice(0, 3000) });
  } catch (e) { console.error('players:', e.message); bad(res, e.message); }
});
// кик игрока по userid (kickid)
app.post('/api/admin/server-kick', async (req, res) => {
  const g = await rconGate(req, res); if (!g) return;
  const userid = String(req.body.userid || '');
  if (!/^\d{1,6}$/.test(userid)) return bad(res, 'Неверный номер игрока');
  const reason = String(req.body.reason || 'Кик администратором').replace(/["';\\\r\n]/g, ' ').slice(0, 60).trim() || 'Кик администратором';
  try {
    await rconQuery(g.host, g.port, g.pass, `kickid ${userid} "${reason}"`);
    console.log('kick:', g.r.name, 'userid', userid, 'by', g.u.steam_id);
    res.json({ ok: true });
  } catch (e) { console.error('kick:', e.message); bad(res, e.message); }
});
app.post('/api/admin/server-restart', async (req, res) => {
  const u = await getUser(req);
  if (!u) return res.status(401).json({ error: 'Войдите через Steam' });
  if (!isFull(u)) return res.status(403).json({ error: 'Перезагружать сервер могут только владелец и замы' });
  const pass = RCON_PASS;
  if (!pass) return bad(res, 'На сайте не задан RCON-пароль');
  const r = (await db.query('select name,address from servers where id=$1', [+req.body.id || 0])).rows[0];
  if (!r) return bad(res, 'Сервер не найден');
  const [host, port] = r.address.split(':');
  try {
    await rconExec(host, +port, pass, process.env.RESTART_CMD || 'quit');
    console.log('restart:', r.name, 'by', u.steam_id);
    res.json({ ok: true });
  } catch (e) { console.error('restart:', e.message); bad(res, e.message); }
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
// --- выдача/снятие VIP (Premium) владельцем и замами: на любой срок ---
async function deleteGameVip(id) {
  if (!game) throw new Error('база игры не подключена');
  const sid = await vipSid(gq);
  await gq('delete from vip_users where account_id=? and sid=?', [accountId(id), sid]);
}
app.post('/api/admin/vip-grant', fullOnly, async (req, res) => {
  const id = String(req.body.id || '').trim(), days = Math.floor(+req.body.days);
  if (!/^\d{17}$/.test(id)) return bad(res, 'Неверный SteamID64 (17 цифр)');
  if (!game) return bad(res, 'База игры не подключена');
  if (!Number.isFinite(days) || days < 0 || days > 36500) return bad(res, 'Срок — число дней от 1 до 36500, 0 = навсегда');
  try {
    await db.query('insert into users(steam_id) values($1) on conflict do nothing', [id]);
    const row = (await db.query('select name, prem_until from users where steam_id=$1', [id])).rows[0] || {};
    const cur = +row.prem_until || 0;
    const until = days === 0 ? FOREVER : Math.max(Date.now(), cur < FOREVER ? cur : 0) + days * 864e5;
    await grantGameVip({ steam_id: id, name: row.name }, until, true); // сначала игра: если не вышло — на сайте ничего не меняем
    await db.query('update users set prem_until=$2 where steam_id=$1', [id, until]);
    res.json({ ok: true });
  } catch (e) { console.error('vip-grant:', e.message); res.status(500).json({ error: 'Не удалось выдать VIP в игре: ' + e.message }); }
});
app.post('/api/admin/vip-revoke', fullOnly, async (req, res) => {
  const id = String(req.body.id || '').trim();
  if (!/^\d{17}$/.test(id)) return bad(res, 'Неверный SteamID64');
  try {
    await deleteGameVip(id);
    await db.query('update users set prem_until=0 where steam_id=$1', [id]);
    res.json({ ok: true });
  } catch (e) { console.error('vip-revoke:', e.message); res.status(500).json({ error: 'Не удалось снять VIP в игре: ' + e.message }); }
});
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
app.get('/api/site', async (req, res) => { // тема сайта по умолчанию и ссылка на чекер — для всех посетителей
  try {
    const rows = (await db.query("select key, value from site where key in ('theme','checker_url')")).rows, m = {};
    rows.forEach(r => { m[r.key] = r.value; });
    res.json({ theme: THEME_KEYS.includes(m.theme) ? m.theme : 'red', checkerUrl: m.checker_url || '' });
  }
  catch (e) { console.error('site:', e.message); res.json({ theme: 'red', checkerUrl: '' }); }
});
// --- взрывы на сайте: включаются/выключаются командой /глент (/glent) в Telegram-боте, сами гаснут через 24 часа ---
const GLENT_MS = 24 * 36e5;
let glentCache = { until: 0, at: 0 }; // until — время окончания в мс (0 = выключено); кэш на 5 секунд, чтобы опрос с сайта не грузил базу
const glentUntil = async () => {
  if (Date.now() - glentCache.at < 5000) return glentCache.until;
  try {
    const r = (await db.query("select value from site where key='glent'")).rows[0];
    glentCache = { until: r ? +r.value || 0 : 0, at: Date.now() };
  } catch (e) { console.error('glent:', e.message); }
  return glentCache.until;
};
const glentSet = async until => {
  if (until) await db.query("insert into site(key,value) values('glent',$1) on conflict (key) do update set value=excluded.value", [String(until)]);
  else await db.query("delete from site where key='glent'");
  glentCache = { until, at: Date.now() };
};
app.post('/api/admin/notify', async (req, res) => { // владелец включает/выключает уведомления бота о промокодах и покупках
  const u = await getUser(req);
  if (!u) return res.status(401).json({ error: 'Войдите через Steam' });
  if (u.steam_id !== OWNER) return res.status(403).json({ error: 'Только владелец' });
  const kind = String(req.body.kind || '');
  if (!NTF[kind]) return bad(res, 'Неизвестный тип уведомлений');
  try { await ntfSet(kind, !!req.body.on); res.json({ ok: true, ...(await ntfGet()) }); }
  catch (e) { console.error('notify:', e.message); res.status(500).json({ error: 'Ошибка базы, попробуйте позже' }); }
});
const glentToggle = async want => { // want: true/false — явно, undefined — переключить
  const cur = (await glentUntil()) > Date.now(), on = typeof want === 'boolean' ? want : !cur;
  if (!on) { await glentSet(0); return { on: false, left: 0, until: 0 }; }
  if (cur && want === true) { const u = await glentUntil(); return { on: true, left: u - Date.now(), until: u }; }
  const until = Date.now() + GLENT_MS; await glentSet(until);
  return { on: true, left: GLENT_MS, until };
};
// кнопка «Запустить админ абуз» для замов на сайте = та же команда /глент (вкл/выкл взрывы на 24 часа); владелец и замы
app.post('/api/admin/abuse', fullOnly, async (req, res) => {
  try { res.json({ ok: true, ...(await glentToggle(typeof req.body.on === 'boolean' ? req.body.on : undefined)) }); }
  catch (e) { console.error('abuse:', e.message); res.status(500).json({ error: 'Ошибка базы, попробуйте позже' }); }
});
// --- музыка режима /глент: встроенная песня (glent.mp3) + песни, которые владелец добавляет в боте (лежат в базе, чтобы не пропадать при перезапуске Render) ---
db.query('create table if not exists glent_tracks(id serial primary key, title text, mime text, data bytea, size int, at bigint)').catch(e => console.error('glent_tracks:', e.message));
let glentListCache = { list: ['/glent.mp3'], at: 0 };
const glentListBust = () => { glentListCache.at = 0; };
const glentBaseOn = async () => !(await db.query("select value from site where key='glent_base_off'")).rows[0];
const glentList = async () => { // адреса песен по порядку; кэш 10 секунд, чтобы опрос с сайта не грузил базу
  if (Date.now() - glentListCache.at < 10000) return glentListCache.list;
  try {
    const ids = (await db.query('select id from glent_tracks order by id')).rows.map(r => '/api/glent/track/' + r.id);
    glentListCache = { list: ((await glentBaseOn()) ? ['/glent.mp3'] : []).concat(ids), at: Date.now() };
  } catch (e) { console.error('glentList:', e.message); }
  return glentListCache.list;
};
app.get('/api/glent/track/:id', async (req, res) => {
  const id = +req.params.id;
  if (!(id > 0)) return res.sendStatus(404);
  try {
    const r = (await db.query('select mime, data from glent_tracks where id=$1', [id])).rows[0];
    if (!r) return res.sendStatus(404);
    const buf = r.data, total = buf.length;
    res.set({ 'Content-Type': r.mime || 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' });
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (!m || (m[1] === '' && m[2] === '')) return res.set('Content-Length', total).end(buf);
    const a = m[1] === '' ? Math.max(0, total - +m[2]) : +m[1], b = m[1] === '' || m[2] === '' ? total - 1 : Math.min(+m[2], total - 1);
    if (a > b || a >= total) return res.status(416).set('Content-Range', `bytes */${total}`).end();
    res.status(206).set({ 'Content-Range': `bytes ${a}-${b}/${total}`, 'Content-Length': b - a + 1 }).end(buf.subarray(a, b + 1));
  } catch (e) { console.error('glent track:', e.message); res.sendStatus(500); }
});
app.get('/api/glent', async (req, res) => {
  const left = Math.max(0, (await glentUntil()) - Date.now());
  res.set('Cache-Control', 'no-store').json({ on: left > 0, left, list: left > 0 ? await glentList() : [] });
});
app.post('/api/admin/design', can('design'), async (req, res) => {
  if (req.body.checkerUrl !== undefined) { // ссылка на чекер: пусто = убрать блок из настроек
    const u = String(req.body.checkerUrl || '').trim();
    if (u && (u.length > 500 || !/^https?:\/\/[^\s<>"']+$/i.test(u))) return bad(res, 'Ссылка должна начинаться с http:// или https:// и не содержать пробелов');
    await db.query("insert into site(key,value) values('checker_url',$1) on conflict (key) do update set value=excluded.value", [u]);
    return res.json({ ok: true });
  }
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
  if (r.rowCount && req.u.steam_id !== OWNER) ownerNotify('promo', `🎟 Промокод создан в админ-панели сайта\nКод: ${code}\nСоздал: ${req.u.name || 'Админ'} (${req.u.steam_id})\nНаграда: ${coins} монет, лимит активаций: ${max || 'без лимита'}`);
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
// аватарки лидеров: steam_id -> { avatar, t }; Steam запрашиваем пачкой в фоне, чтобы страница не ждала
const lbAv = new Map(); let lbFetching = false;
const toSteam64 = v => { // STEAM_X:Y:Z, [U:1:N] или уже SteamID64 -> SteamID64
  v = String(v || '').trim(); let m;
  if (/^\d{17}$/.test(v)) return v;
  if ((m = v.match(/^STEAM_\d:([01]):(\d+)$/i))) return String(STEAM64_BASE + BigInt(m[2]) * 2n + BigInt(m[1]));
  if ((m = v.match(/^\[U:1:(\d+)\]$/i))) return String(STEAM64_BASE + BigInt(m[1]));
  return null;
};
async function fillLeaderAvatars(ids) {
  if (lbFetching) return; lbFetching = true;
  try {
    const have = (await db.query('select steam_id, avatar from users where steam_id = any($1) and avatar is not null', [ids])).rows;
    have.forEach(r => okAvatar(r.avatar) && lbAv.set(r.steam_id, { avatar: r.avatar, t: Date.now() }));
    const need = ids.filter(i => !lbAv.has(i) || Date.now() - lbAv.get(i).t > 864e5).slice(0, 100);
    for (let i = 0; i < need.length; i += 100) {
      const got = await fetchProfiles(need.slice(i, i + 100));
      need.slice(i, i + 100).forEach(id => lbAv.set(id, { avatar: okAvatar(got[id]?.avatar) ? got[id].avatar : null, t: Date.now() }));
    }
  } catch (e) { console.error('leader avatars:', e.message); } finally { lbFetching = false; }
}
// --- профиль игрока: статистика (lvl_base), бан (iks_bans), VIP (vip_users) ---
const steamForms = id => { const acc = BigInt(id) - STEAM64_BASE, y = acc % 2n, z = acc / 2n; return [id, `STEAM_1:${y}:${z}`, `STEAM_0:${y}:${z}`, `[U:1:${acc}]`]; };
app.get('/api/player/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^\d{17}$/.test(id)) return bad(res, 'Неверный SteamID64');
  const out = { id, name: null, avatar: null, banned: null, vip: null, stats: null, lastSeen: null, role: null };
  const forms = steamForms(id);
  try {
    const u = (await db.query('select name, avatar, deputy, plus_until, grant_until, perms from users where steam_id=$1', [id])).rows[0];
    if (u) {
      out.name = u.name; out.avatar = okAvatar(u.avatar) ? u.avatar : null;
      if (id === OWNER) out.role = 'Владелец';
      else if (u.deputy) out.role = 'Зам';
      else if (Math.max(+u.plus_until, +u.grant_until) > Date.now()) out.role = 'Админ+';
      else if (String(u.perms || '').split(',').some(p => PERMS[p])) out.role = 'Модератор';
    }
    if (!out.role && id === OWNER) out.role = 'Владелец';
  } catch (e) {}
  if (!out.avatar && lbAv.get(id)?.avatar) out.avatar = lbAv.get(id).avatar;
  if (!out.avatar || !out.name || out.name === 'Игрок') {
    const got = (await fetchProfiles([id]).catch(() => ({})))[id];
    if (got) { if (got.name && (!out.name || out.name === 'Игрок')) out.name = String(got.name).slice(0, 64); if (okAvatar(got.avatar)) out.avatar = got.avatar; }
  }
  if (game) {
    try {
      const r = (await gq(`select * from lvl_base where steam in (${forms.map(() => '?').join(',')}) limit 1`, forms))[0];
      if (r) {
        const n = k => (r[k] === undefined || r[k] === null ? null : +r[k]);
        const val = n('value') || 0;
        const place = +(await gq('select count(*) c from lvl_base where value>?', [val]))[0].c + 1, total = +(await gq('select count(*) c from lvl_base'))[0].c;
        out.stats = { exp: val, rank: n('rank'), kills: n('kills'), deaths: n('deaths'), headshots: n('headshots'), shoots: n('shoots'), hits: n('hits'),
          hours: n('playtime') === null ? null : Math.round(n('playtime') / 360) / 10, place, total };
        if (n('lastconnect')) out.lastSeen = n('lastconnect') * 1000;
        if (!out.name && r.name) out.name = r.name;
      }
    } catch (e) { console.error('player stats:', e.message); }
    try {
      const b = (await gq(`select reason, duration, end_at, created_at from iks_bans where steam_id in (${forms.map(() => '?').join(',')}) and deleted_at is null and unbanned_by is null and (end_at is null or end_at=0 or end_at>?) order by id desc limit 1`, [...forms, nowS()]))[0];
      if (b) out.banned = { reason: b.reason || '', term: +b.duration ? fmtDur(+b.duration) : 'Навсегда', at: b.created_at ? b.created_at * 1000 : null };
    } catch (e) { console.error('player ban:', e.message); }
    if (!out.role) { try { if (await gameAdmin(id)) out.role = 'Админ'; } catch (e) {} } // штатный админ игрового сервера
    try {
      const sid = await vipSid(gq);
      const v = (await gq('select `expires` from vip_users where account_id=? and sid=? and (`expires`=0 or `expires`>?) limit 1', [accountId(id), sid, nowS()]))[0];
      if (v) out.vip = { until: +v.expires ? v.expires * 1000 : 0 };
    } catch (e) { console.error('player vip:', e.message); }
  }
  res.json(out);
});
// --- чат сайта: читать могут все, писать — вошедшие через Steam; удалять сообщения — те, у кого есть право банить ---
const chatLast = new Map();
app.get('/api/chat', async (req, res) => {
  touchSeen(req);
  const after = Math.max(0, parseInt(req.query.after) || 0);
  try {
    const rows = (await db.query(`select c.id, c.steam_id, c.text, c.at, c.staff, u.name, u.avatar, u.prem_until
      from chat c left join users u on u.steam_id=c.steam_id where c.id>$1 order by c.id desc limit 60`, [after])).rows.reverse();
    const live = (await db.query('select id from chat order by id desc limit 60')).rows.map(r => +r.id); // по этому списку браузер убирает удалённые сообщения
    res.json({ live, msgs: rows.map(r => ({ id: +r.id, uid: r.steam_id, text: r.text, at: +r.at, staff: !!r.staff, vip: +r.prem_until > Date.now(),
      name: r.name || 'Игрок', avatar: okAvatar(r.avatar) ? r.avatar : null })) });
  } catch (e) { console.error('chat get:', e.message); res.status(500).json({ error: 'Чат временно недоступен' }); }
});
app.post('/api/chat', level('user'), async (req, res) => {
  const text = String(req.body.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return bad(res, 'Введите сообщение');
  if (text.length > 300) return bad(res, 'Сообщение слишком длинное (до 300 символов)');
  const now = Date.now(), id = req.u.steam_id, recent = (chatLast.get(id) || []).filter(t => now - t < 10000);
  if (recent.length && now - recent[recent.length - 1] < 1500) return bad(res, 'Не так быстро');
  if (recent.length >= 5) return bad(res, 'Слишком много сообщений подряд, подождите немного');
  chatLast.set(id, [...recent, now]);
  const staff = id === OWNER || !!req.u.deputy || Math.max(+req.u.plus_until, +req.u.grant_until) > now;
  try {
    await db.query('insert into chat(steam_id,text,staff,at) values($1,$2,$3,$4)', [id, text, staff, now]);
    if (Math.random() < 0.02) db.query('delete from chat where id < (select coalesce(max(id),0) - 1000 from chat)').catch(() => {}); // храним последние ~1000
    res.json({ ok: true });
  } catch (e) { console.error('chat post:', e.message); res.status(500).json({ error: 'Не удалось отправить, попробуйте позже' }); }
});
app.post('/api/chat/delete', can('ban'), async (req, res) => {
  await db.query('delete from chat where id=$1', [parseInt(req.body.id) || 0]); res.json({ ok: true });
});
app.get('/api/leaders', async (req, res) => {
  try {
    const rows = (await gq('select steam, name, value, kills, deaths, playtime from lvl_base order by value desc limit 100'))
      .map(r => ({ id: toSteam64(r.steam), name: r.name, exp: +r.value, kills: +r.kills, deaths: +r.deaths, hours: Math.round(+r.playtime / 3600) }));
    const ids = rows.map(r => r.id).filter(Boolean);
    const missing = ids.filter(i => !lbAv.has(i));
    if (missing.length) await Promise.race([fillLeaderAvatars(ids), new Promise(r => setTimeout(r, 3500))]); // ждём недолго, остальное дозагрузится в фоне
    else if (ids.some(i => Date.now() - lbAv.get(i).t > 864e5)) fillLeaderAvatars(ids);
    const vip = new Set(); // игроки с активным VIP в игре (vip_users)
    try { const sid = await vipSid(gq); (await gq('select account_id from vip_users where sid=? and (expires=0 or expires>?)', [sid, nowS()])).forEach(v => vip.add(String(v.account_id))); }
    catch (e) { console.error('leaders vip:', e.message); }
    res.json(rows.map(r => ({ ...r, avatar: lbAv.get(r.id)?.avatar || null, prem: !!r.id && vip.has(String(accountId(r.id))) })));
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
  weapon_mac10: [17, 'MAC-10', 'Пистолеты-пулемёты'], weapon_mp5sd: [23, 'MP5-SD', 'Пистолеты-пулемёты'], weapon_mp7: [33, 'MP7', 'Пистолеты-пулемёты'], weapon_mp9: [34, 'MP9', 'Пистолеты-пулемёты'],
  weapon_p90: [19, 'P90', 'Пистолеты-пулемёты'], weapon_bizon: [26, 'PP-Bizon', 'Пистолеты-пулемёты'], weapon_ump45: [24, 'UMP-45', 'Пистолеты-пулемёты'],
  weapon_ak47: [7, 'AK-47', 'Автоматические винтовки'], weapon_aug: [8, 'AUG', 'Автоматические винтовки'], weapon_famas: [10, 'FAMAS', 'Автоматические винтовки'], weapon_galilar: [13, 'Galil AR', 'Автоматические винтовки'],
  weapon_m4a1: [16, 'M4A4', 'Автоматические винтовки'], weapon_m4a1_silencer: [60, 'M4A1-S', 'Автоматические винтовки'], weapon_sg556: [39, 'SG 553', 'Автоматические винтовки'],
  weapon_awp: [9, 'AWP', 'Снайперские винтовки'], weapon_g3sg1: [11, 'G3SG1', 'Снайперские винтовки'], weapon_scar20: [38, 'SCAR-20', 'Снайперские винтовки'], weapon_ssg08: [40, 'SSG 08', 'Снайперские винтовки'],
  weapon_m249: [14, 'M249', 'Пулемёты'], weapon_negev: [28, 'Negev', 'Пулемёты'], weapon_mag7: [27, 'MAG-7', 'Дробовики'],
  weapon_nova: [35, 'Nova', 'Дробовики'], weapon_sawedoff: [29, 'Sawed-Off', 'Дробовики'], weapon_xm1014: [25, 'XM1014', 'Дробовики'],
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

// --- ⚓ Морской бой (сайт + Telegram): файл battleship.js лежит рядом с server.js ---
let bs = null;
try { bs = require('./battleship'); bs.site(app, getUser, { siteUrl: process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || '', botName: () => tgBotName }); }
catch (e) { console.error('battleship.js не подключён:', e.message); }
// --- 💬 Чат (Discord-подобный; messenger.js и messenger.html лежат рядом с server.js; не связан с Discord) ---
try {
  const msgApi = require('./messenger').site(app, getUser, {
    db, canModerate: u => permsOf(u).includes('ban'),
    siteUrl: () => SITE,
    tgSend: (id, text, url) => (tgCallSend ? tgCallSend(id, text, url) : Promise.resolve())
  });
  msgCallStart = msgApi.tgCallStart;
}
catch (e) { console.error('messenger.js не подключён:', e.message); }
// --- 📱 Установка на домашний экран iPhone (PWA): манифест, иконки, service worker ---
for (const [url, file, type] of [
  ['/manifest.webmanifest', 'manifest.webmanifest', 'application/manifest+json'],
  ['/sw.js', 'sw.js', 'application/javascript'],
  ['/icon-180.png', 'icon-180.png', 'image/png'],
  ['/icon-192.png', 'icon-192.png', 'image/png'],
  ['/icon-512.png', 'icon-512.png', 'image/png']
]) app.get(url, (req, res) => { res.type(type); res.sendFile(path.join(__dirname, file)); });
app.get('/ring.mp3', (req, res) => { res.type('audio/mpeg'); res.sendFile(path.join(__dirname, 'ring.mp3')); });
// --- ✅ Подтверждение прав в Яндекс Вебмастере (HTML-файл из раздела «HTML-файл») ---
app.get('/yandex_e579aaaa9eb23608.html', (req, res) => {
  res.type('text/html');
  res.send('<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body>Verification: e579aaaa9eb23608</body></html>');
});
// --- 🔎 Поисковики: robots.txt и sitemap.xml (адрес берётся из SITE_URL / RENDER_EXTERNAL_URL) ---
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /auth/\nDisallow: /tg/\nDisallow: /messenger\n\nSitemap: ${SITE}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + ['/', '/shop', '/leaders', '/bans', '/rules'].map(u => `  <url><loc>${SITE}${u}</loc><changefreq>weekly</changefreq></url>`).join('\n')
    + `\n</urlset>\n`);
});
let tt = null;
try { tt = require('./tictactoe'); tt.site(app, getUser, { siteUrl: process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || '', botName: () => tgBotName }); }
catch (e) { console.error('tictactoe.js не подключён:', e.message); }

// --- Telegram-бот: промокоды (webhook, работает в этом же сервере) ---
// админ: /promo — создать код вручную; все остальные: кнопка «Получить промокод» (нужна подписка на канал)
if (process.env.TG_BOT_TOKEN) {
  const { Bot, webhookCallback, InlineKeyboard } = require('grammy');
  const bot = new Bot(process.env.TG_BOT_TOKEN);
  // Нажатие кнопки = старое сообщение удаляется, приходит новое (вместо редактирования на месте).
  // Работает для всех экранов бота, потому что все они меняют сообщение через ctx.editMessageText.
  bot.use(async (ctx, next) => {
    if (ctx.callbackQuery?.message) {
      const old = ctx.callbackQuery.message;
      ctx.editMessageText = async (text, other) => {
        const sent = await ctx.api.sendMessage(old.chat.id, text, other); // сначала новое, чтобы при ошибке отправки старый экран не пропал
        await ctx.api.deleteMessage(old.chat.id, old.message_id).catch(() => {}); // не вышло удалить (старше 48 ч) — не страшно
        return sent;
      };
    }
    return next();
  });
  const H = {}; // обработчики команд: их же вызывают кнопки меню (команды тоже продолжают работать)
  const cmd = (name, fn) => { H[name] = fn; bot.command(name, fn); };
  const sub = (ctx, match) => Object.create(ctx, { match: { value: match } }); // тот же ctx, но с «аргументами», которые человек прислал текстом
  const pending = new Map(); // tg_id -> { act, at }: какое действие админ-панели ждёт ввода
  const SITE = (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  tgNotify = (id, text) => bot.api.sendMessage(id, text, { reply_markup: new InlineKeyboard().text('👤 Мой аккаунт', 'me') }).catch(e => console.error('tg notify:', e.message));
  bot.api.getMe().then(m => { tgBotName = m.username || ''; }).catch(() => {});
  const TG_ADMINS = (process.env.TG_ADMINS || '').split(',').map(s => s.trim()).filter(Boolean);
  tgOwnerNotify = text => Promise.all(TG_ADMINS.map(id => bot.api.sendMessage(id, text, { reply_markup: new InlineKeyboard().text('🔔 Уведомления', 'ntf') }).catch(e => console.error('tg owner notify:', e.message))));
  const isOwner = ctx => TG_ADMINS.includes(String(ctx.from?.id)); // владельцы: из переменной TG_ADMINS в Render — могут всё
  const isTgAdmin = async ctx => isOwner(ctx) || !!(await db.query('select 1 from tg_admins where tg_id=$1', [String(ctx.from?.id)])).rowCount; // + помощники, получившие доступ по ключу
  const HELPER = { coins: 1000, vipDays: 30, max: 100 }; // лимиты для помощников (у владельцев лимитов нет)
  const CHANNEL = process.env.TG_CHANNEL || '@Next1Project'; // канал, на который надо быть подписанным
  const CHANNEL_URL = 'https://t.me/' + CHANNEL.replace('@', '');
  const BONUS_HOURS = +process.env.TG_BONUS_HOURS || 0; // 0 = промокод можно получить только один раз; 24 = раз в сутки
  // призы и пределы шанса (в %): каждый день шансы внутри этих пределов выбираются заново случайно
  const PRIZES = [
    { lo: 10, hi: 100, min: 40, max: 60, name: '10–100 монет' },
    { lo: 110, hi: 400, min: 25, max: 40, name: '110–400 монет' },
    { lo: 410, hi: 600, min: 5, max: 12, name: '410–600 монет' },
    { lo: 610, hi: 900, min: 2, max: 5, name: '610–900 монет' },
    { lo: 910, hi: 1000, min: 0.2, max: 1, name: '910–1000 монет' },
    { vip: 7, min: 1, max: 4, name: 'VIP на 7 дней' },
    { vip: 30, min: 0.2, max: 1, name: 'VIP на 30 дней' }];
  const TZ_H = +process.env.TG_TZ_OFFSET || 3; // сутки считаем по Москве (UTC+3): новые шансы в 00:00 МСК
  const dayKey = () => new Date(Date.now() + TZ_H * 36e5).toISOString().slice(0, 10);
  let oddsCache = { day: '', list: [] };
  const todayOdds = () => { // шансы считаются из даты и секрета: весь день одни и те же, в полночь меняются сами, заранее не угадать
    const day = dayKey();
    if (oddsCache.day === day) return oddsCache.list;
    const h = crypto.createHmac('sha256', SECRET).update('odds:' + day).digest();
    const raw = PRIZES.map((p, i) => p.min + h.readUInt32BE(i * 4) / 2 ** 32 * (p.max - p.min));
    const total = raw.reduce((x, y) => x + y, 0);
    const w = raw.map(x => Math.round(x / total * 1000)); // тысячные доли процента, сумма ровно 1000 (100%)
    w[0] += 1000 - w.reduce((x, y) => x + y, 0);
    oddsCache = { day, list: PRIZES.map((p, i) => ({ ...p, w: w[i] })) };
    return oddsCache.list;
  };
  const oddsText = () => '🎲 Шансы на сегодня (каждый день новые, обновляются в 00:00 МСК):\n' +
    todayOdds().map(p => `${p.vip ? '👑' : '•'} ${p.name} — ${(p.w / 10).toFixed(1)}%`).join('\n');
  const rollPrize = () => {
    let r = crypto.randomInt(1000);
    for (const p of todayOdds()) {
      if (r < p.w) return p.vip ? { coins: 0, vip: p.vip } : { coins: (p.lo / 10 + crypto.randomInt((p.hi - p.lo) / 10 + 1)) * 10, vip: 0 };
      r -= p.w;
    }
    return { coins: 10, vip: 0 };
  };
  db.query(`create table if not exists tg_admins(tg_id text primary key, name text, added_by text, at bigint);
    create table if not exists tg_keys(key text primary key, by text, at bigint, used_by text)`).catch(e => console.error('tg_admins:', e.message));
  db.query('create table if not exists tg_claims(tg_id text primary key, code text, coins numeric, at bigint)')
    .catch(e => console.error('tg_claims:', e.message));

  const subscribed = async id => {
    const m = await bot.api.getChatMember(CHANNEL, id); // бот должен быть админом канала
    return ['creator', 'administrator', 'member'].includes(m.status) || (m.status === 'restricted' && m.is_member);
  };
  const kb = (panel = true) => { // главное меню: канал, промокод, аккаунт, админ-панель
    const k = new InlineKeyboard().url('📢 Подписаться на канал', CHANNEL_URL).row().text('🎁 Получить промокод', 'claim').row().text('⚓ Морской бой', 'bs').row().text('❌⭕ Крестики-нолики', 'tt');
    return panel ? k.row().text('👤 Мой аккаунт', 'me').row().text('🛠 Админ панель', 'ap') : k;
  };

  async function claim(ctx) {
    if (ctx.chat?.type !== 'private') return ctx.reply('Напишите мне в личные сообщения');
    const id = String(ctx.from.id);
    try {
      if (!(await subscribed(ctx.from.id)))
        return ctx.reply(`❌ Сначала подпишитесь на канал ${CHANNEL_URL} и нажмите «Получить промокод» ещё раз.`, { reply_markup: kb(false) });
    } catch (e) { console.error('tg subscribe check:', e.message); return ctx.reply('Не получилось проверить подписку, попробуйте чуть позже'); }
    let out;
    const c = await db.connect();
    try {
      await c.query('begin');
      await c.query('select pg_advisory_xact_lock(hashtext($1))', ['tgclaim' + id]); // два нажатия подряд не выдадут два кода
      const prev = (await c.query('select at from tg_claims where tg_id=$1', [id])).rows[0];
      const left = prev ? +prev.at + BONUS_HOURS * 36e5 - Date.now() : 0;
      if (prev && (!BONUS_HOURS || left > 0)) {
        await c.query('rollback');
        out = [BONUS_HOURS ? `⏳ Следующий промокод можно получить через ${Math.ceil(left / 36e5)} ч.` : 'Вы уже получали свой промокод 🙂'];
      } else {
        const prize = rollPrize(), coins = prize.coins; let code = null;
        for (let i = 0; i < 5 && !code; i++) {
          const cand = 'NP-' + crypto.randomBytes(4).toString('hex').toUpperCase();
          const ins = await c.query('insert into promos(code,coins,max,by,at,vip_days) values($1,$2,1,$3,$4,$5) on conflict do nothing', [cand, coins, 'tg:' + id, Date.now(), prize.vip]);
          if (ins.rowCount) code = cand;
        }
        if (!code) { await c.query('rollback'); out = ['Не получилось создать код, попробуйте ещё раз']; }
        else {
          await c.query('insert into tg_claims(tg_id,code,coins,at) values($1,$2,$3,$4) on conflict (tg_id) do update set code=excluded.code, coins=excluded.coins, at=excluded.at', [id, code, coins, Date.now()]);
          await c.query('commit');
          const win = prize.vip ? `🎉 Вам выпал VIP на ${prize.vip} дн.!` : `🎁 Награда: ${coins} монет`;
          const linked = await tgLinked(ctx).catch(() => null);
          out = [`${win}\nПромокод: <code>${code}</code>\n\n` + (linked ? 'Нажмите кнопку — награда сразу попадёт на ваш аккаунт. Или введите код на сайте. Код одноразовый.' : 'Введите его на сайте в окне промокода (нужен вход через Steam). Код одноразовый. Чтобы активировать прямо в боте, привяжите аккаунт: «👤 Мой аккаунт».'),
            { parse_mode: 'HTML', ...(linked ? { reply_markup: new InlineKeyboard().text('✅ Активировать на мой аккаунт', 'ac:' + code) } : {}) }];
        }
      }
    } catch (e) { await c.query('rollback').catch(() => {}); console.error('tg claim:', e.message); out = ['❌ Ошибка, попробуйте позже']; }
    finally { c.release(); }
    return ctx.reply(...out);
  }

  const MENU_TEXT = () => '👋 Привет! Подпишитесь на канал и нажмите «Получить промокод» — получите случайный промокод: от 10 до 1000 монет, а с небольшим шансом — VIP.\n\n' + oddsText();
  bot.command('start', ctx => { const m = /^bs_([A-Za-z0-9]{6})$/.exec(ctx.match || ''); if (m && bsStart) return bsStart(ctx, m[1].toUpperCase()); const t = /^tt_([A-Za-z0-9]{6})$/.exec(ctx.match || ''); if (t && ttStart) return ttStart(ctx, t[1].toUpperCase()); return ctx.reply(MENU_TEXT(), { reply_markup: kb() }); });
  bot.callbackQuery('claim', async ctx => { await ctx.answerCallbackQuery().catch(() => {}); return claim(ctx); });
  bot.command(['bonus', 'getpromo'], claim);

  cmd('promo', async ctx => { // только для админов из TG_ADMINS
    if (!(await isTgAdmin(ctx))) return ctx.reply('Нет доступа');
    const a = ctx.match.trim().split(/\s+/).filter(Boolean);
    if (a.length < 2 || a.length > 3) return ctx.reply('Формат: /promo КОД МОНЕТЫ АКТИВАЦИИ');
    const code = (a.length === 3 ? a[0] : crypto.randomBytes(4).toString('hex')).toUpperCase();
    const coins = +a[a.length - 2], max = Math.floor(+a[a.length - 1]);
    if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(code)) return ctx.reply('Код: 2–32 символа — буквы, цифры, _ или -');
    if (!(coins > 0 && coins <= 100000)) return ctx.reply('Награда: от 1 до 100 000');
    if (!(max >= 0 && max <= 100000)) return ctx.reply('Активаций: от 0 (без лимита) до 100 000');
    if (!isOwner(ctx) && (coins > HELPER.coins || !max || max > HELPER.max)) return ctx.reply(`Лимит для помощников: до ${HELPER.coins} монет и до ${HELPER.max} активаций (без безлимита)`);
    try {
      const r = await db.query('insert into promos(code,coins,max,by,at) values($1,$2,$3,$4,$5) on conflict do nothing',
        [code, coins, max, 'tg:' + ctx.from.id, Date.now()]);
      ctx.reply(r.rowCount ? `✅ Промокод создан\nКод: ${code}\nНаграда: ${coins} монет\nАктиваций: ${max || '∞'}` : '❌ Такой код уже существует');
    } catch (e) { console.error('tg promo:', e.message); ctx.reply('❌ Ошибка базы, попробуйте позже'); }
  });
  cmd('vip', async ctx => { // /vip КОД ДНИ АКТИВАЦИИ (только админ): промокод, который выдаёт VIP
    if (!(await isTgAdmin(ctx))) return ctx.reply('Нет доступа');
    const a = ctx.match.trim().split(/\s+/).filter(Boolean);
    if (a.length < 2 || a.length > 3) return ctx.reply('Формат: /vip КОД ДНИ АКТИВАЦИИ (без кода: /vip ДНИ АКТИВАЦИИ)');
    const code = (a.length === 3 ? a[0] : 'VIP-' + crypto.randomBytes(3).toString('hex')).toUpperCase();
    const days = Math.floor(+a[a.length - 2]), max = Math.floor(+a[a.length - 1]);
    if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(code)) return ctx.reply('Код: 2–32 символа — буквы, цифры, _ или -');
    if (!(days >= 1 && days <= 3650)) return ctx.reply('Дней VIP: от 1 до 3650');
    if (!(max >= 0 && max <= 100000)) return ctx.reply('Активаций: от 0 (без лимита) до 100 000');
    if (!isOwner(ctx) && (days > HELPER.vipDays || !max || max > HELPER.max)) return ctx.reply(`Лимит для помощников: VIP до ${HELPER.vipDays} дн. и до ${HELPER.max} активаций (без безлимита)`);
    try {
      const r = await db.query('insert into promos(code,coins,max,by,at,vip_days) values($1,0,$2,$3,$4,$5) on conflict do nothing', [code, max, 'tg:' + ctx.from.id, Date.now(), days]);
      ctx.reply(r.rowCount ? `✅ VIP-промокод создан\nКод: ${code}\nVIP: ${days} дн.\nАктиваций: ${max || '∞'}` : '❌ Такой код уже существует');
    } catch (e) { console.error('tg vip:', e.message); ctx.reply('❌ Ошибка базы, попробуйте позже'); }
  });
  cmd('a', async ctx => { // список админов и кто из них сейчас на сайте (для владельцев и помощников бота)
    if (!(await isTgAdmin(ctx))) return ctx.reply('Нет доступа');
    try {
      const now = Date.now(), list = new Map(); // steam_id -> { role, name }
      const add = (id, role, name) => { const o = list.get(id); if (!o) list.set(id, { role, name }); else if (!o.name && name) o.name = name; };
      add(OWNER, '👑 владелец', null);
      for (const r of (await db.query('select steam_id, name from users where deputy')).rows) add(r.steam_id, 'зам', r.name);
      for (const r of (await db.query('select steam_id, name from users where greatest(plus_until, grant_until) > $1', [now])).rows) add(r.steam_id, 'Админ+', r.name);
      if (game) {
        try { for (const r of await gq('select steam_id, name from iks_admins where is_disabled=0 and deleted_at is null and (end_at is null or end_at=0 or end_at>?)', [nowS()])) add(String(r.steam_id), 'админ игры', r.name); }
        catch (e) { console.error('tg a (iks_admins):', e.message); }
      }
      const ids = [...list.keys()];
      const seen = {};
      for (const r of (await db.query('select steam_id, name, last_seen from users where steam_id = any($1)', [ids])).rows) {
        seen[r.steam_id] = +r.last_seen || 0;
        const o = list.get(r.steam_id); if (r.name && r.name !== 'Игрок') o.name = r.name;
      }
      const ago = t => { const m = Math.round((now - t) / 6e4); return m < 60 ? `${Math.max(m, 1)} мин назад` : m < 1440 ? `${Math.floor(m / 60)} ч назад` : `${Math.floor(m / 1440)} дн. назад`; };
      const rows = ids.map(id => ({ id, ...list.get(id), t: seen[id] || 0 })).sort((x, y) => y.t - x.t);
      const online = rows.filter(r => now - r.t < 180000).length; // онлайн = был активен на сайте последние 3 минуты
      ctx.reply(`👥 Админы — онлайн на сайте: ${online} из ${rows.length}\n\n` + rows.map(r => {
        const on = now - r.t < 180000;
        return `${on ? '🟢' : '⚪'} ${r.name || r.id} — ${r.role}${on ? '' : r.t ? ` (был ${ago(r.t)})` : ' (на сайте не был)'}`;
      }).join('\n'));
    } catch (e) { console.error('tg a:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  // /restart — перезагрузка игрового сервера через RCON (та же команда, что и кнопка на сайте); только владельцы бота, с подтверждением
  const askRestart = (ctx, s) => ctx.reply(`⚠️ Перезагрузить сервер «${s.name}» (${s.address})?\nВсе игроки будут отключены.`,
    { reply_markup: new InlineKeyboard().text('✅ Да, перезагрузить', 'rsy:' + s.id).text('Отмена', 'rsn') });
  const srvById = async id => (await db.query('select id, name, address from servers where id=$1', [id])).rows[0];
  cmd('restart', async ctx => {
    if (!isOwner(ctx)) return ctx.reply('Нет доступа');
    try {
      const list = (await db.query('select id, name, address from servers order by id')).rows;
      if (!list.length) return ctx.reply('В списке серверов на сайте пусто — добавьте сервер в админ-панели');
      if (list.length === 1) return askRestart(ctx, list[0]);
      const k = new InlineKeyboard(); list.forEach(x => k.text('🔄 ' + x.name, 'rs:' + x.id).row()); k.text('Отмена', 'rsn');
      return ctx.reply('Какой сервер перезагрузить?', { reply_markup: k });
    } catch (e) { console.error('tg restart list:', e.message); ctx.reply('❌ Ошибка базы, попробуйте позже'); }
  });
  bot.callbackQuery(/^rs:(\d+)$/, async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isOwner(ctx)) return;
    const x = await srvById(+ctx.match[1]);
    return x ? askRestart(ctx, x) : ctx.reply('Сервер не найден');
  });
  bot.callbackQuery('rsn', async ctx => { await ctx.answerCallbackQuery().catch(() => {}); await ctx.editMessageText('Отменено').catch(() => {}); });
  bot.callbackQuery(/^rsy:(\d+)$/, async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isOwner(ctx)) return;
    try {
      const x = await srvById(+ctx.match[1]);
      if (!x) return ctx.editMessageText('Сервер не найден').catch(() => {});
      await ctx.editMessageText(`⏳ Перезагружаю «${x.name}»…`).catch(() => {});
      const [host, port] = x.address.split(':');
      try {
        await rconExec(host, +port, RCON_PASS, process.env.RESTART_CMD || 'quit');
        console.log('restart (tg):', x.name, 'by', ctx.from.id);
        await ctx.reply(`✅ Команда перезагрузки отправлена: «${x.name}». Сервер поднимется через минуту-две, если у него включён автозапуск.`);
      } catch (e) { console.error('tg restart:', e.message); await ctx.reply('❌ Не получилось перезагрузить: ' + e.message); }
    } catch (e) { console.error('tg restart:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  cmd('adminkey', async ctx => { // только владелец: /adminkey ДНИ [АКТИВАЦИЙ] — ключ, который на сайте выдаёт Админ+ (ДНИ 0 = навсегда)
    if (!isOwner(ctx)) return ctx.reply('Нет доступа');
    const a = ctx.match.trim().split(/\s+/).filter(Boolean);
    const days = Math.floor(+a[0]), max = a[1] === undefined ? 1 : Math.floor(+a[1]);
    if (!a.length || a.length > 2 || !(days >= 0 && days <= 3650)) return ctx.reply('Формат: /adminkey ДНИ [АКТИВАЦИЙ]\nДНИ: 0 = навсегда, иначе 1–3650. Активаций по умолчанию 1.');
    if (!(max >= 1 && max <= 50)) return ctx.reply('Активаций: от 1 до 50');
    const code = 'ADM-' + crypto.randomBytes(8).toString('hex').toUpperCase(); // длинный случайный код: подобрать нельзя
    try {
      await db.query('insert into promos(code,coins,max,by,at,admin_days) values($1,0,$2,$3,$4,$5)', [code, max, 'tg:' + ctx.from.id, Date.now(), days]);
      ctx.reply(`🔑 Ключ на Админ+\n<code>${code}</code>\nСрок: ${days ? days + ' дн.' : 'навсегда'}\nАктиваций: ${max}\n\nИгрок вводит его на сайте в окне промокода (нужен вход через Steam). Не показывайте ключ посторонним.`, { parse_mode: 'HTML' });
    } catch (e) { console.error('tg adminkey:', e.message); ctx.reply('❌ Ошибка базы, попробуйте позже'); }
  });
  cmd('botkey', async ctx => { // только владелец: одноразовый ключ на 24 часа — по нему человек сам получает доступ к командам бота
    if (!isOwner(ctx)) return ctx.reply('Нет доступа');
    const key = 'BOT-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    try {
      await db.query('insert into tg_keys(key,by,at) values($1,$2,$3)', [key, String(ctx.from.id), Date.now()]);
      ctx.reply(`🔑 Ключ доступа к боту: <code>${key}</code>\nДействует 24 часа, один раз.\n\nПусть человек откроет бота → «🛠 Админ панель» → «🔐 У меня ключ» и отправит этот ключ.\n\nЕму откроется админ-панель: промокоды на монеты и VIP, баны и муты, с лимитами (до ${HELPER.coins} монет, до ${HELPER.vipDays} дн. VIP, до ${HELPER.max} активаций).`, { parse_mode: 'HTML' });
    } catch (e) { console.error('tg botkey:', e.message); ctx.reply('❌ Ошибка базы, попробуйте позже'); }
  });
  cmd('access', async ctx => { // любой человек с ключом от владельца
    const key = ctx.match.trim().toUpperCase();
    if (!/^BOT-[0-9A-F]{12}$/.test(key)) return ctx.reply('Формат: /access КЛЮЧ');
    try {
      if (await isTgAdmin(ctx)) return ctx.reply('У вас уже есть доступ 🙂');
      const r = await db.query('update tg_keys set used_by=$2 where key=$1 and used_by is null and at>$3 returning key', [key, String(ctx.from.id), Date.now() - 864e5]);
      if (!r.rowCount) return ctx.reply('❌ Ключ неверный, уже использован или просрочен');
      const name = [ctx.from.first_name, ctx.from.username && '@' + ctx.from.username].filter(Boolean).join(' ').slice(0, 64);
      await db.query('insert into tg_admins(tg_id,name,added_by,at) values($1,$2,$3,$4) on conflict do nothing', [String(ctx.from.id), name, key, Date.now()]);
      ctx.reply('✅ Доступ к боту выдан. Откройте «🛠 Админ панель» — кнопка в меню /start.');
    } catch (e) { console.error('tg access:', e.message); ctx.reply('❌ Ошибка базы, попробуйте позже'); }
  });
  bot.command('admins', async ctx => {
    if (!isOwner(ctx)) return ctx.reply('Нет доступа');
    try {
      const rows = (await db.query('select tg_id, name from tg_admins order by at')).rows;
      ctx.reply(rows.length ? 'Доступ к боту у:\n' + rows.map(r => `${r.tg_id} — ${r.name || ''}`).join('\n') + '\n\nУбрать: /deladmin ID' : 'Помощников пока нет. Создать ключ доступа: /botkey');
    } catch (e) { console.error('tg admins:', e.message); ctx.reply('❌ Ошибка базы, попробуйте позже'); }
  });
  bot.command('deladmin', async ctx => {
    if (!isOwner(ctx)) return ctx.reply('Нет доступа');
    const id = ctx.match.trim();
    if (!/^\d{3,15}$/.test(id)) return ctx.reply('Формат: /deladmin ID (ID смотрите в /admins)');
    try { ctx.reply((await db.query('delete from tg_admins where tg_id=$1', [id])).rowCount ? '✅ Доступ убран' : 'Такого ID нет в списке'); }
    catch (e) { console.error('tg deladmin:', e.message); ctx.reply('❌ Ошибка базы, попробуйте позже'); }
  });

  // --- баны и муты из Telegram (админы бота: владельцы и помощники): пишет в те же таблицы игры (iks_bans / iks_comms), что и админ-панель сайта ---
  const tgLinked = async ctx => (await db.query('select steam_id from tg_links where tg_id=$1', [String(ctx.from?.id)])).rows[0]?.steam_id || null;
  const tgStaff = async ctx => { // -> null (нет доступа) | { steam, limited }; доступ: админ бота, зам/владелец сайта или активный Админ+ (куплен/выдан) по привязанному Steam
    const steam = await tgLinked(ctx);
    if (await isTgAdmin(ctx)) return { steam, limited: false };
    if (!steam) return null;
    const u = (await db.query('select deputy, greatest(plus_until, grant_until) as adm from users where steam_id=$1', [steam])).rows[0];
    if (!u) return null;
    if (steam === OWNER || u.deputy) return { steam, limited: false };
    return +u.adm > Date.now() ? { steam, limited: true } : null; // срок Админ+ закончился или админку сняли — доступ пропадает сам
  };
  const tgTarget = s => { s = String(s || '').trim(); const m = s.match(/steamcommunity\.com\/profiles\/(\d{17})/i); return toSteam64(m ? m[1] : s); }; // SteamID64, STEAM_X:Y:Z, [U:1:N] или ссылка на профиль
  const tgDur = s => { // 30m, 2h, 7d, просто число = дни; 0 = навсегда -> секунды (или null, если не разобрали)
    const m = String(s || '').toLowerCase().match(/^(\d+)([mhd]?)$/); if (!m) return null;
    const sec = +m[1] * { m: 60, h: 3600, d: 86400, '': 86400 }[m[2]];
    return sec <= 3650 * 86400 ? sec : null;
  };
  const tgPunish = kind => async ctx => {
    const isMute = kind === 'mutes', word = isMute ? 'мут' : 'бан', T = isMute ? 'iks_comms' : 'iks_bans', TY = isMute ? 'mute_type' : 'ban_type';
    const st = await tgStaff(ctx).catch(() => null);
    if (!st) return ctx.reply('Нет доступа к команде');
    const a = ctx.match.trim().split(/\s+/).filter(Boolean);
    const t = tgTarget(a[0]), dur = tgDur(a[1]);
    if (!a.length || !t || dur === null)
      return ctx.reply(`Формат: /${isMute ? 'mute' : 'ban'} ID СРОК [причина]\nID — SteamID64, STEAM_1:0:123 или ссылка на профиль Steam\nСРОК: 30m, 2h, 7d или просто число дней (0 = навсегда)\nПример: /${isMute ? 'mute' : 'ban'} 76561198000000000 7d читы`);
    if (t === OWNER) return ctx.reply('Нельзя наказать владельца');
    if (!game) return ctx.reply('❌ База игрового сервера не подключена');
    if (st.limited) { // админка из магазина/выдачи не может наказывать других админов
      const other = (await gameAdmin(t)) || (await db.query('select 1 from users where steam_id=$1 and (deputy or greatest(plus_until, grant_until) > $2)', [t, Date.now()])).rowCount;
      if (other) return ctx.reply('Нельзя наказать другого админа');
    }
    const reason = a.slice(2).join(' ').slice(0, 120) || 'Без причины';
    try {
      const n = nowS();
      const ex = await gq(`select id from ${T} where steam_id=? and unbanned_by is null and deleted_at is null and (end_at=0 or end_at>?) limit 1`, [t, n]);
      if (ex.length) return ctx.reply(`Этому игроку ${word} уже выдан. Снять: /${isMute ? 'unmute' : 'unban'} ${t}`);
      const adm = (st.steam && await gameAdmin(st.steam)) || await gameAdmin(OWNER); // если админа нет в iks_admins — берём владельца, а если и его нет — нет в iks_admins — запись будет «от консоли»
      const srv = (await gq('select id from iks_servers order by id limit 1'))[0];
      const u = (await db.query('select name from users where steam_id=$1', [t])).rows[0];
      const name = String((u && u.name && u.name !== 'Игрок' && u.name) || (await fetchProfiles([t]).catch(() => ({})))[t]?.name || t).slice(0, 64);
      await gq(`insert into ${T}(steam_id,name,duration,reason,${TY},server_id,admin_id,created_at,end_at,updated_at) values(?,?,?,?,?,?,?,?,?,?)`,
        [t, name, dur, reason, isMute ? 2 : 0, srv ? srv.id : null, adm ? adm.id : null, n, dur ? n + dur : 0, n]);
      console.log('tg', word, ':', t, dur, 'by', ctx.from.id);
      ctx.reply(`✅ ${isMute ? '🔇 Мут' : '🔨 Бан'} выдан\nИгрок: ${name}\nSteamID: ${t}\nСрок: ${dur ? fmtDur(dur) : 'навсегда'}\nПричина: ${reason}`);
    } catch (e) { console.error('tg ' + word + ':', e.message); ctx.reply('❌ Не удалось записать в базу игрового сервера: ' + e.message); }
  };
  const tgRemove = kind => async ctx => {
    const isMute = kind === 'mutes', T = isMute ? 'iks_comms' : 'iks_bans';
    if (!(await tgStaff(ctx).catch(() => null))) return ctx.reply('Нет доступа к команде');
    const t = tgTarget(ctx.match.trim().split(/\s+/)[0]);
    if (!t) return ctx.reply(`Формат: /${isMute ? 'unmute' : 'unban'} ID\nID — SteamID64, STEAM_1:0:123 или ссылка на профиль Steam`);
    if (!game) return ctx.reply('❌ База игрового сервера не подключена');
    try {
      const r = await gq(`delete from ${T} where steam_id=? and unbanned_by is null and deleted_at is null and (end_at=0 or end_at>?)`, [t, nowS()]);
      console.log('tg un' + (isMute ? 'mute' : 'ban') + ':', t, 'by', ctx.from.id);
      ctx.reply(r.affectedRows ? `✅ ${isMute ? 'Мут снят' : 'Разбанен'}: ${t}` : `Активного ${isMute ? 'мута' : 'бана'} у ${t} не найдено`);
    } catch (e) { console.error('tg un' + (isMute ? 'mute' : 'ban') + ':', e.message); ctx.reply('❌ Не удалось изменить базу игрового сервера: ' + e.message); }
  };
  cmd('ban', tgPunish('bans'));
  cmd('mute', tgPunish('mutes'));
  cmd('unban', tgRemove('bans'));
  cmd('unmute', tgRemove('mutes'));
  bot.command('admin', ctx => openPanel(ctx, true));
  // звонки через Telegram: /call ник — звонок игроку на сайте; ссылка открывает звонок
  tgCallSend = (id, text, url) => bot.api.sendMessage(id, text, { reply_markup: new InlineKeyboard().url('📞 Открыть звонок на сайте', url) })
    .catch(e => console.error('tg call:', e.message));
  bot.command('call', async ctx => {
    const steam = await tgLinked(ctx);
    if (!steam) return ctx.reply('Сначала привяжите аккаунт сайта: «👤 Мой аккаунт» → «Войти через сайт».');
    const r = msgCallStart
      ? await msgCallStart(steam, String(ctx.match || '').trim()).catch(() => ({ text: '❌ Ошибка, попробуйте позже' }))
      : { text: '❌ Звонки пока не включены' };
    return ctx.reply(r.text, r.url ? { reply_markup: new InlineKeyboard().url('📞 Открыть звонок на сайте', r.url) } : undefined);
  });
  cmd('link', async ctx => { if (ctx.chat?.type !== 'private') return ctx.reply('Напишите мне в личные сообщения'); return openMe(ctx, true); });
  // --- кнопочное меню: /start → «Получить промокод» и «Админ панель». Действия с вводом (промокод, бан…) спрашивают данные следующим сообщением ---
  const show = async (ctx, text, k) => {
    try { if (ctx.callbackQuery) return await ctx.editMessageText(text, { reply_markup: k }); } catch (e) { if (/not modified/i.test(e.message)) return; }
    return ctx.reply(text, { reply_markup: k });
  };
  const PROMPTS = {
    promo: ['💰 Промокод на монеты', 'КОД МОНЕТЫ АКТИВАЦИИ\nнапример: MELL500 500 10\nили без кода: 500 10 (код придумаю сам)\nАктиваций 0 = без лимита'],
    vip: ['👑 Промокод на VIP', 'КОД ДНИ АКТИВАЦИИ\nнапример: GIFT30 30 10\nили без кода: 30 10'],
    adminkey: ['🔑 Ключ на Админ+', 'ДНИ [АКТИВАЦИЙ]\nнапример: 30 или 30 5\nДНИ 0 = навсегда'],
    ban: ['🔨 Бан', 'ID СРОК [причина]\nID — SteamID64, STEAM_1:0:123 или ссылка на профиль Steam\nСРОК: 30m, 2h, 7d или число дней (0 = навсегда)\nнапример: 76561198000000000 7d читы'],
    unban: ['♻️ Разбан', 'ID — SteamID64, STEAM_1:0:123 или ссылка на профиль Steam'],
    mute: ['🔇 Мут', 'ID СРОК [причина]\nID — SteamID64, STEAM_1:0:123 или ссылка на профиль Steam\nСРОК: 30m, 2h, 7d или число дней (0 = навсегда)\nнапример: 76561198000000000 1d мат'],
    unmute: ['🔊 Размут', 'ID — SteamID64, STEAM_1:0:123 или ссылка на профиль Steam'],
    access: ['🔐 Ключ доступа к боту', 'ключ вида BOT-XXXXXXXXXXXX (его даёт владелец)'],
    redeem: ['🎟 Ввести промокод', 'пришлите промокод, например NP-A3F9C21B'],
    topup: ['✏️ Своя сумма пополнения', 'сумму в рублях числом, например 250'],
  };
  const CAN = { // кто может начать действие (сами команды всё равно проверяют права ещё раз)
    promo: ctx => isTgAdmin(ctx), vip: ctx => isTgAdmin(ctx), adminkey: async ctx => isOwner(ctx),
    ban: ctx => tgStaff(ctx), unban: ctx => tgStaff(ctx), mute: ctx => tgStaff(ctx), unmute: ctx => tgStaff(ctx),
    access: async () => true, redeem: async ctx => !!(await tgLinked(ctx)), topup: async ctx => !!(await tgLinked(ctx)) };

  async function openPanel(ctx, fresh) {
    const st = await tgStaff(ctx).catch(() => null);
    const send = (t, k) => fresh ? ctx.reply(t, { reply_markup: k }) : show(ctx, t, k);
    if (!st) return send('🛡 Админ панель — для админов.\n\nЕсть Админ+ (куплен или выдан)? Нажмите «Привязать Telegram» и введите код на сайте.\nВладелец дал ключ доступа к боту? Нажмите «У меня ключ».',
      new InlineKeyboard().text('🔗 Привязать Telegram', 'do:link').row().text('🔐 У меня ключ', 'in:access').row().text('⬅️ Назад', 'home'));
    const adm = await isTgAdmin(ctx), own = isOwner(ctx), k = new InlineKeyboard();
    if (adm) k.text('💰 Промокод на монеты', 'in:promo').text('👑 VIP-промокод', 'in:vip').row();
    if (own) k.text('🔑 Ключ Админ+', 'in:adminkey').text('🔐 Ключ для помощника', 'do:botkey').row();
    k.text('🔨 Бан', 'in:ban').text('♻️ Разбан', 'in:unban').row().text('🔇 Мут', 'in:mute').text('🔊 Размут', 'in:unmute').row();
    if (adm) k.text('👥 Админы онлайн', 'do:a');
    if (own) k.text('📋 Помощники', 'admlist');
    if (adm) k.row();
    if (own) k.text('🔄 Перезагрузить сервер', 'do:restart').row();
    if (own) k.text('🎭 Дополнительные команды', 'fun').row();
    if (own) k.text('🔔 Уведомления', 'ntf').row();
    k.text('⬅️ Назад', 'home');
    return send('🛠 Админ панель' + (st.limited ? '\n\nДругих админов наказывать нельзя.' : ''), k);
  }
  const showHelpers = async ctx => {
    const rows = (await db.query('select tg_id, name from tg_admins order by at')).rows;
    const k = new InlineKeyboard(); rows.forEach(r => k.text('❌ ' + String(r.name || r.tg_id).slice(0, 40), 'da:' + r.tg_id).row()); k.text('⬅️ Назад', 'ap');
    return show(ctx, rows.length ? 'Помощники бота. Нажмите на имя, чтобы убрать доступ:' : 'Помощников пока нет. Создать ключ: «🔐 Ключ для помощника» в админ-панели.', k);
  };
  bot.callbackQuery('home', async ctx => { await ctx.answerCallbackQuery().catch(() => {}); pending.delete(String(ctx.from.id)); return show(ctx, MENU_TEXT(), kb()); });
  bot.callbackQuery('ap', async ctx => {
    await ctx.answerCallbackQuery().catch(() => {}); pending.delete(String(ctx.from.id));
    try { await openPanel(ctx, false); } catch (e) { console.error('tg panel:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  // --- 🔔 Уведомления владельцу: промокоды и покупки Админ+ на сайте (те же переключатели есть в «Настройках» сайта) ---
  const NTF_TXT = { promo: '🎟 Новые промокоды на сайте', buy: '🛡 Покупка админки на сайте' };
  const ntfScreen = async ctx => {
    const back = new InlineKeyboard().text('⬅️ Назад', 'home');
    if (!isOwner(ctx)) return show(ctx, 'Нет доступа', back);
    const st = await ntfGet(), k = new InlineKeyboard();
    Object.keys(NTF_TXT).forEach(n => k.text(`${st[n] ? '🔕 Выключить' : '🔔 Включить'}: ${NTF_TXT[n].slice(3)}`, 'ntf:' + n).row());
    return show(ctx, '🔔 Уведомления\n\nБот пишет вам, когда кто-то на сайте создаёт промокод или покупает админку.\n\n' + Object.keys(NTF_TXT).map(n => `${NTF_TXT[n]}: ${st[n] ? 'включены' : 'выключены'}`).join('\n'), k.text('⬅️ Назад', 'home'));
  };
  bot.callbackQuery('ntf', async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    try { await ntfScreen(ctx); } catch (e) { console.error('tg ntf:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  bot.callbackQuery(/^ntf:(promo|buy)$/, async ctx => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true }).catch(() => {});
    await ctx.answerCallbackQuery().catch(() => {});
    try { await ntfSet(ctx.match[1], !(await ntfOn(ctx.match[1]))); await ntfScreen(ctx); } catch (e) { console.error('tg ntf set:', e.message); ctx.reply('❌ Ошибка базы, попробуйте позже'); }
  });
  // --- 🎵 Музыка режима /глент: владелец присылает аудиофайл (mp3, m4a, ogg, wav до 15 МБ) — песня добавляется в список и играет на сайте по очереди по кругу ---
  const MUS_MAX = 15 * 1024 * 1024, MUS_COUNT = 15, musWait = new Map(); // tg id -> когда нажали «Добавить песню» (принимаем файл 10 минут)
  const mbs = n => (n / 1048576).toFixed(1).replace(/\.0$/, '') + ' МБ';
  const musScreen = async ctx => {
    const back = new InlineKeyboard().text('⬅️ Назад', 'fun');
    if (!isOwner(ctx)) return show(ctx, 'Нет доступа', back);
    musWait.delete(String(ctx.from.id));
    const tr = (await db.query('select id, title, size from glent_tracks order by id')).rows, base = await glentBaseOn(), k = new InlineKeyboard();
    const lines = [`${base ? '▶️' : '⏸'} ГЛЕНТ — гимн роблокс (встроенная${base ? '' : ', выключена'})`, ...tr.map(t => `▶️ ${t.title} (${mbs(t.size)})`)];
    tr.forEach(t => k.text('🗑 ' + t.title.slice(0, 28), 'mus:del:' + t.id).row());
    k.text('➕ Добавить песню', 'mus:add').row().text(base ? '🔇 Выключить встроенную' : '▶️ Включить встроенную', 'mus:base').row();
    return show(ctx, '🎵 Музыка режима /глент\n\nПесни играют на сайте по очереди по кругу, пока режим включён.\n\n' + lines.join('\n') + (!base && !tr.length ? '\n\nСейчас музыки нет — режим идёт без звука.' : '') + `\n\nДобавлено своих: ${tr.length} из ${MUS_COUNT}`, k.text('⬅️ Назад', 'fun'));
  };
  bot.callbackQuery('mus', async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    try { await musScreen(ctx); } catch (e) { console.error('tg mus:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  bot.callbackQuery('mus:add', async ctx => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true }).catch(() => {});
    await ctx.answerCallbackQuery().catch(() => {});
    musWait.set(String(ctx.from.id), Date.now());
    return show(ctx, `➕ Отправьте мне одним сообщением аудиофайл: mp3, m4a, ogg или wav, не больше ${mbs(MUS_MAX)}.\n\nМожно прислать как музыку или как файл.`, new InlineKeyboard().text('✖️ Отмена', 'mus'));
  });
  bot.callbackQuery(/^mus:del:(\d+)$/, async ctx => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true }).catch(() => {});
    await ctx.answerCallbackQuery().catch(() => {});
    try { await db.query('delete from glent_tracks where id=$1', [+ctx.match[1]]); glentListBust(); await musScreen(ctx); } catch (e) { console.error('tg mus del:', e.message); ctx.reply('❌ Ошибка базы, попробуйте позже'); }
  });
  bot.callbackQuery('mus:base', async ctx => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true }).catch(() => {});
    await ctx.answerCallbackQuery().catch(() => {});
    try {
      if (await glentBaseOn()) await db.query("insert into site(key,value) values('glent_base_off','1') on conflict (key) do update set value='1'");
      else await db.query("delete from site where key='glent_base_off'");
      glentListBust(); await musScreen(ctx);
    } catch (e) { console.error('tg mus base:', e.message); ctx.reply('❌ Ошибка базы, попробуйте позже'); }
  });
  bot.on(['message:audio', 'message:document'], async (ctx, next) => { // принимаем файл только от владельца и только после «➕ Добавить песню»
    const id = String(ctx.from?.id), t0 = musWait.get(id);
    if (!isOwner(ctx) || !t0 || Date.now() - t0 > 6e5) return next();
    const m = ctx.msg, a = m.audio || m.document, name = a.file_name || '', mime = a.mime_type || '';
    if (!(m.audio || mime.startsWith('audio/') || /\.(mp3|m4a|ogg|oga|wav|aac|opus)$/i.test(name))) return ctx.reply('Это не похоже на аудио. Пришлите mp3, m4a, ogg или wav.');
    if ((a.file_size || 0) > MUS_MAX) return ctx.reply(`Файл больше ${mbs(MUS_MAX)}. Пришлите поменьше.`);
    try {
      if ((await db.query('select count(*)::int as n from glent_tracks')).rows[0].n >= MUS_COUNT) return ctx.reply(`Уже ${MUS_COUNT} песен. Удалите ненужные в «🎵 Музыка режима».`);
      const f = await ctx.api.getFile(a.file_id);
      const r = await fetch(`https://api.telegram.org/file/bot${process.env.TG_BOT_TOKEN}/${f.file_path}`, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error('скачивание: ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MUS_MAX) return ctx.reply(`Файл больше ${mbs(MUS_MAX)}. Пришлите поменьше.`);
      const ta = m.audio ? [m.audio.performer, m.audio.title].filter(Boolean).join(' — ') : '';
      const title = (ta || name.replace(/\.[^.]+$/, '') || 'Песня').trim().slice(0, 60) || 'Песня';
      await db.query('insert into glent_tracks(title,mime,data,size,at) values($1,$2,$3,$4,$5)', [title, mime.startsWith('audio/') ? mime : 'audio/mpeg', buf, buf.length, Date.now()]);
      glentListBust(); musWait.delete(id);
      ctx.reply('✅ Песня добавлена: ' + title + '\n\nНа сайте она подхватится в течение 20 секунд.', { reply_markup: new InlineKeyboard().text('🎵 Музыка режима', 'mus') });
    } catch (e) { console.error('tg music:', e.message); ctx.reply('❌ Не получилось сохранить песню, попробуйте позже'); }
  });
  // --- «Дополнительные команды» (только владельцы): смешные команды. Новая команда = строка в FUN + состояние в FUN_LEFT + действие в FUN_DO ---
  const FUN = [{ id: 'glent', cmd: '/глент', title: '💥 Взрывы на сайте', desc: 'взрывы на весь экран, летающие фигурки, переливающийся фон и пляшущие кнопки у всех посетителей сайта. Включается на 24 часа, потом гаснет сама.' }];
  const FUN_LEFT = { glent: async () => Math.max(0, (await glentUntil()) - Date.now()) }; // сколько ещё действует (мс), 0 = выключена
  const FUN_DO = { glent: () => glentToggle() };
  const funScreen = async ctx => {
    const back = new InlineKeyboard().text('⬅️ Назад', 'ap');
    if (!isOwner(ctx)) return show(ctx, 'Нет доступа', back);
    const k = new InlineKeyboard(), lines = [];
    for (const c of FUN) {
      const left = await FUN_LEFT[c.id](), on = left > 0, h = Math.floor(left / 36e5), m = Math.floor(left % 36e5 / 6e4);
      lines.push(`${c.title}  ${c.cmd}\n${c.desc}\nСейчас: ${on ? `включена, осталось ${h ? h + ' ч ' : ''}${m} мин` : 'выключена'}`);
      k.text(`${on ? '🔇 Выключить' : '▶️ Включить'} ${c.cmd}`, 'fun:' + c.id).row();
    }
    return show(ctx, '🎭 Дополнительные команды\n\n' + lines.join('\n\n') + '\n\nТе же команды можно писать в чат: /глент', k.text('🎵 Музыка режима', 'mus').row().text('⬅️ Назад', 'ap'));
  };
  bot.command('fun', async ctx => { try { await funScreen(ctx); } catch (e) { console.error('tg fun:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); } });
  bot.callbackQuery('fun', async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    try { await funScreen(ctx); } catch (e) { console.error('tg fun:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  bot.callbackQuery(/^fun:(glent)$/, async ctx => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true }).catch(() => {});
    await ctx.answerCallbackQuery().catch(() => {});
    try { await FUN_DO[ctx.match[1]](); await funScreen(ctx); } catch (e) { console.error('tg fun do:', e.message); ctx.reply('❌ Ошибка базы, попробуйте позже'); }
  });
  bot.callbackQuery('cx', async ctx => { await ctx.answerCallbackQuery().catch(() => {}); pending.delete(String(ctx.from.id)); await ctx.editMessageText('Отменено').catch(() => {}); });
  bot.callbackQuery(/^in:(promo|vip|adminkey|ban|unban|mute|unmute|access|redeem|topup)$/, async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    const act = ctx.match[1];
    try {
      if ((act === 'redeem' || act === 'topup') && !(await tgLinked(ctx))) return openMe(ctx, false);
      if (!(await CAN[act](ctx))) return ctx.reply('Нет доступа');
      pending.set(String(ctx.from.id), { act, at: Date.now() });
      const [title, hint] = PROMPTS[act];
      return ctx.reply(`${title}\n\nОтправьте одним сообщением:\n${hint}`, { reply_markup: new InlineKeyboard().text('✖️ Отмена', 'cx') });
    } catch (e) { console.error('tg input:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  bot.callbackQuery(/^do:(a|botkey|link|restart)$/, async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    const act = ctx.match[1];
    try { await H[act](sub(ctx, '')); if (act === 'a' || act === 'botkey') await openPanel(ctx, true); }
    catch (e) { console.error('tg do ' + act + ':', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  bot.callbackQuery('admlist', async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isOwner(ctx)) return;
    try { await showHelpers(ctx); } catch (e) { console.error('tg admlist:', e.message); ctx.reply('❌ Ошибка базы, попробуйте позже'); }
  });
  bot.callbackQuery(/^da:(\d{3,15})$/, async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isOwner(ctx)) return;
    try { await db.query('delete from tg_admins where tg_id=$1', [ctx.match[1]]); await showHelpers(ctx); } catch (e) { console.error('tg deladmin:', e.message); ctx.reply('❌ Ошибка базы, попробуйте позже'); }
  });
  // --- «Мой аккаунт»: привязка к сайту (вход через Steam), профиль, промокоды и покупки прямо в боте. Покупки и промокоды идут через те же запросы сайта (/api/buy, /api/promo): правила, цены и проверки те же ---
  const siteCall = async (steam, p, body) => {
    const r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}${p}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: `s=${steam}.${sign(steam)}` }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    return { ...j, ok: r.ok && !j.error, error: j.error || (r.ok ? '' : 'Ошибка сайта (' + r.status + ')') };
  };
  const fmtUntil = t => !(+t > Date.now()) ? 'нет' : +t >= FOREVER ? 'навсегда' : 'до ' + new Date(+t + TZ_H * 36e5).toISOString().slice(0, 10).split('-').reverse().join('.');
  const offers = [...DAYS.prem.map((d, i) => ['prem', i, `VIP на ${d} дн.`]), ['plus', 0, 'Админ+ навсегда']];
  const linkKb = async ctx => { // кнопка-ссылка «Войти через сайт» с одноразовым токеном на 15 минут
    const k = new InlineKeyboard();
    if (!SITE) return k;
    const id = String(ctx.from.id), t = 'LK-' + crypto.randomBytes(12).toString('hex').toUpperCase();
    const name = [ctx.from.first_name, ctx.from.username && '@' + ctx.from.username].filter(Boolean).join(' ').slice(0, 64);
    await db.query('delete from tg_link_codes where tg_id=$1 or at<$2', [id, Date.now() - 9e5]);
    await db.query('insert into tg_link_codes(code,tg_id,at,tg_name) values($1,$2,$3,$4)', [t, id, Date.now(), name]);
    return k.url('🌐 Войти через сайт', `${SITE}/tg/link/${t}`).row();
  };
  async function openMe(ctx, fresh) {
    const send = (t, k) => fresh ? ctx.reply(t, { reply_markup: k }) : show(ctx, t, k);
    const steam = await tgLinked(ctx);
    if (!steam) return send('👤 Мой аккаунт\n\nАккаунт сайта не привязан. Нажмите «Войти через сайт», войдите через Steam и подтвердите — аккаунт свяжется с этим Telegram (если вы на сайте впервые, он создастся сам).\n\nПосле этого прямо в боте можно смотреть баланс, вводить промокоды и покупать VIP.',
      (await linkKb(ctx)).text('⬅️ Назад', 'home'));
    const u = (await db.query('select name, coins, prem_until, plus_until, grant_until from users where steam_id=$1', [steam])).rows[0];
    if (!u) { await db.query('delete from tg_links where tg_id=$1', [String(ctx.from.id)]); return openMe(ctx, fresh); }
    const k = new InlineKeyboard().text('🎟 Ввести промокод', 'in:redeem').text('🛒 Магазин', 'shop').row().text('💳 Пополнить баланс', 'tp').row();
    if (SITE) k.url('🌐 Открыть сайт', SITE).row();
    if (isOwner(ctx)) k.text('🔔 Уведомления', 'ntf').row();
    k.text('🔓 Отвязать', 'ul').text('⬅️ Назад', 'home');
    return send(`👤 ${u.name || 'Игрок'}\nSteam ID: ${steam}\n\n💰 Монет: ${Math.round(+u.coins * 100) / 100}\n👑 VIP: ${fmtUntil(u.prem_until)}\n🛡 Админ+: ${fmtUntil(Math.max(+u.plus_until, +u.grant_until))}`, k);
  }
  H.redeem = async ctx => { // вызывается после «🎟 Ввести промокод» и ввода кода сообщением
    const steam = await tgLinked(ctx);
    if (!steam) return ctx.reply('Сначала привяжите аккаунт сайта: «👤 Мой аккаунт»');
    const code = String(ctx.match || '').trim().toUpperCase().slice(0, 40);
    if (!code) return ctx.reply('Пришлите промокод текстом');
    const r = await siteCall(steam, '/api/promo', { code });
    return ctx.reply(r.ok ? '✅ ' + (r.msg || `Промокод активирован: +${r.coins} монет`) : '❌ ' + r.error);
  };
  bot.callbackQuery('me', async ctx => {
    await ctx.answerCallbackQuery().catch(() => {}); pending.delete(String(ctx.from.id));
    try { await openMe(ctx, false); } catch (e) { console.error('tg me:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  bot.callbackQuery('shop', async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    try {
      const steam = await tgLinked(ctx); if (!steam) return openMe(ctx, false);
      const u = (await db.query('select coins from users where steam_id=$1', [steam])).rows[0];
      const k = new InlineKeyboard(); offers.forEach(([key, i, label]) => k.text(`${label} — ${PRICE[key][i]} 💰`, `bk:${key}:${i}`).row()); k.text('⬅️ Назад', 'me');
      return show(ctx, `🛒 Магазин\nУ вас: ${Math.round(+(u?.coins || 0) * 100) / 100} монет`, k);
    } catch (e) { console.error('tg shop:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  bot.callbackQuery(/^bk:(prem|plus):(\d)$/, async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    const key = ctx.match[1], i = +ctx.match[2], o = offers.find(x => x[0] === key && x[1] === i);
    if (!o) return;
    return show(ctx, `Купить «${o[2]}» за ${PRICE[key][i]} монет?`, new InlineKeyboard().text('✅ Купить', `by:${key}:${i}`).text('Отмена', 'shop'));
  });
  bot.callbackQuery(/^by:(prem|plus):(\d)$/, async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    try {
      const key = ctx.match[1], i = +ctx.match[2], o = offers.find(x => x[0] === key && x[1] === i), steam = await tgLinked(ctx);
      if (!o || !steam) return openMe(ctx, false);
      const r = await siteCall(steam, '/api/buy', { key, idx: i });
      await ctx.editMessageText(r.ok ? `✅ Куплено: ${o[2]}` : '❌ ' + r.error).catch(() => {});
      return openMe(ctx, true);
    } catch (e) { console.error('tg buy:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  bot.callbackQuery(/^ac:([A-Z0-9-]{3,40})$/, async ctx => { // «Активировать на мой аккаунт» под выпавшим промокодом
    await ctx.answerCallbackQuery().catch(() => {});
    try {
      const steam = await tgLinked(ctx); if (!steam) return openMe(ctx, true);
      const r = await siteCall(steam, '/api/promo', { code: ctx.match[1] });
      await ctx.editMessageReplyMarkup().catch(() => {});
      return ctx.reply(r.ok ? '✅ ' + (r.msg || `Промокод активирован: +${r.coins} монет`) : '❌ ' + r.error);
    } catch (e) { console.error('tg activate:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  bot.callbackQuery('ul', async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    try { await db.query('delete from tg_links where tg_id=$1', [String(ctx.from.id)]); return openMe(ctx, false); } catch (e) { console.error('tg unlink:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  // /глент (и /glent): включить взрывы на сайте на 24 часа; та же команда — выключить. Только владельцы (TG_ADMINS).
  // Telegram не подсвечивает кириллические команды как команды, поэтому ловим текст сообщения регуляркой.
  bot.hears(/^\/(глент|glent)(@\w+)?\s*$/i, async ctx => {
    if (!isOwner(ctx)) return ctx.reply('Нет доступа');
    try {
      const r = await glentToggle();
      if (!r.on) return ctx.reply('🔇 Взрывы на сайте ВЫКЛЮЧЕНЫ.\n\nВключить снова: /глент');
      const d = new Date(r.until + TZ_H * 36e5).toISOString();
      ctx.reply(`💥 Взрывы на сайте ВКЛЮЧЕНЫ на 24 часа (до ${d.slice(8, 10)}.${d.slice(5, 7)} ${d.slice(11, 16)} МСК).\n\nВыключить раньше: /глент ещё раз.`);
    } catch (e) { console.error('tg glent:', e.message); ctx.reply('❌ Ошибка базы, попробуйте позже'); }
  });
  if (bs) { try { bsStart = bs.telegram({ bot, InlineKeyboard, show, botName: () => tgBotName, siteUrl: SITE }).start; } catch (e) { console.error('battleship telegram:', e.message); } }
  if (tt) { try { ttStart = tt.telegram({ bot, InlineKeyboard, show, botName: () => tgBotName, siteUrl: SITE }).start; } catch (e) { console.error('tictactoe telegram:', e.message); } }
  // --- 💳 Пополнение баланса переводом: игрок переводит деньги по реквизитам, присылает чек, владелец сверяет поступление и зачисляет монеты ---
  const TOPUP_REQ = (process.env.TOPUP_REQUISITES || '').replace(/\\n/g, '\n').trim(); // реквизиты (карта, банк, получатель) — задаются в Render, \n = перенос строки
  const TOPUP_RATE = +process.env.TOPUP_RATE || 1; // монет за 1 ₽ (цены в магазине в ₽ равны монетам, поэтому 1)
  const TOPUP_MIN = +process.env.TOPUP_MIN || 10, TOPUP_MAX = +process.env.TOPUP_MAX || 50000;
  const tpWait = new Map(); // tg_id -> { id, at }: от кого ждём чек
  db.query(`create table if not exists topups(id serial primary key, tg_id text not null, steam_id text not null, amount numeric not null, coins numeric not null,
    status text not null default 'new', file_id text, file_type text, at bigint not null, done_by text, done_at bigint)`).then(() => db.query('alter table topups add column if not exists file_uid text')).catch(e => console.error('topups:', e.message));
  const rub = n => Math.round(+n * 100) / 100;
  async function tpScreen(ctx) {
    const steam = await tgLinked(ctx); if (!steam) return openMe(ctx, false);
    if (!TOPUP_REQ) return show(ctx, '💳 Пополнение баланса временно недоступно: реквизиты ещё не настроены.', new InlineKeyboard().text('⬅️ Назад', 'me'));
    const k = new InlineKeyboard();
    [50, 100, 200, 500, 1000].forEach((a, i) => { k.text(`${a} ₽`, 'tps:' + a); if (i % 3 === 2) k.row(); });
    k.row().text('✏️ Другая сумма', 'in:topup').row().text('⬅️ Назад', 'me');
    return show(ctx, `💳 Пополнение баланса переводом\nКурс: 1 ₽ = ${TOPUP_RATE} монет\n\nВыберите сумму (от ${TOPUP_MIN} до ${TOPUP_MAX} ₽).`, k);
  }
  async function tpCreate(ctx, amount) {
    const steam = await tgLinked(ctx); if (!steam) return openMe(ctx, ctx.callbackQuery ? false : true);
    if (!TOPUP_REQ) return ctx.reply('💳 Пополнение временно недоступно: реквизиты ещё не настроены.');
    if (!(amount >= TOPUP_MIN && amount <= TOPUP_MAX)) return ctx.reply(`Сумма: от ${TOPUP_MIN} до ${TOPUP_MAX} ₽`);
    const tg = String(ctx.from.id), coins = rub(amount * TOPUP_RATE);
    await db.query("update topups set status='cancel' where tg_id=$1 and status='new'", [tg]); // старая неоплаченная заявка закрывается
    const id = (await db.query('insert into topups(tg_id,steam_id,amount,coins,at) values($1,$2,$3,$4,$5) returning id', [tg, steam, amount, coins, Date.now()])).rows[0].id;
    return show(ctx, `💳 Заявка #${id}: ${amount} ₽ → ${coins} монет\n\nПереведите ровно ${amount} ₽ по реквизитам:\n\n${TOPUP_REQ}\n\nЕсли банк позволяет, в комментарии к переводу укажите: NP${id}\n\nПосле перевода нажмите «Я оплатил(а)» и пришлите скриншот или чек. Монеты придут после проверки владельцем.`,
      new InlineKeyboard().text('✅ Я оплатил(а), отправить чек', 'tpp:' + id).row().text('✖️ Отмена', 'tpx:' + id));
  }
  H.topup = async ctx => { // «Другая сумма»: сумму прислали текстом
    const a = Math.floor(+String(ctx.match || '').trim().replace(',', '.'));
    if (!(a > 0)) return ctx.reply('Пришлите сумму числом, например 250');
    return tpCreate(ctx, a);
  };
  bot.callbackQuery('tp', async ctx => {
    await ctx.answerCallbackQuery().catch(() => {}); pending.delete(String(ctx.from.id));
    try { await tpScreen(ctx); } catch (e) { console.error('tg topup:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  bot.callbackQuery(/^tps:(\d{2,5})$/, async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    try { await tpCreate(ctx, +ctx.match[1]); } catch (e) { console.error('tg topup create:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  bot.callbackQuery(/^tpp:(\d+)$/, async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    try {
      const r = (await db.query("select id from topups where id=$1 and tg_id=$2 and status='new'", [+ctx.match[1], String(ctx.from.id)])).rows[0];
      if (!r) return ctx.reply('Эта заявка уже не активна — создайте новую: «💳 Пополнить баланс»');
      tpWait.set(String(ctx.from.id), { id: r.id, at: Date.now() });
      return ctx.reply(`📎 Пришлите одним сообщением скриншот или чек перевода (фото или PDF) по заявке #${r.id}.`, { reply_markup: new InlineKeyboard().text('✖️ Отмена', 'tpx:' + r.id) });
    } catch (e) { console.error('tg topup proof:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  bot.callbackQuery(/^tpx:(\d+)$/, async ctx => {
    await ctx.answerCallbackQuery().catch(() => {});
    try {
      tpWait.delete(String(ctx.from.id));
      await db.query("update topups set status='cancel' where id=$1 and tg_id=$2 and status='new'", [+ctx.match[1], String(ctx.from.id)]);
      return openMe(ctx, false);
    } catch (e) { console.error('tg topup cancel:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  bot.on(['message:photo', 'message:document'], async (ctx, next) => { // чек от игрока (только если он нажал «Я оплатил(а)»)
    const id = String(ctx.from?.id), w = tpWait.get(id);
    if (!w || Date.now() - w.at > 30 * 60000) return next();
    const m = ctx.msg;
    if (m.document && !/^(image\/|application\/pdf)/.test(m.document.mime_type || '')) return ctx.reply('Пришлите фото, скриншот или PDF чека.');
    const fo = m.photo ? m.photo[m.photo.length - 1] : m.document, fileId = fo.file_id, uid = fo.file_unique_id, type = m.photo ? 'photo' : 'document';
    try {
      // защита: один и тот же чек второй раз не принимаем; лимит на чеки в очереди и на отказы за сутки
      if ((await db.query("select 1 from topups where file_uid=$1 limit 1", [uid])).rowCount) return ctx.reply('⚠️ Этот чек уже был отправлен ранее. Пришлите чек именно по этой заявке.');
      const lim = (await db.query("select count(*) filter (where status='review') rv, count(*) filter (where status='no' and done_at>$2) bad from topups where tg_id=$1", [id, Date.now() - 864e5])).rows[0];
      if (+lim.rv >= 3) return ctx.reply('⏳ У вас уже есть несколько чеков на проверке. Дождитесь ответа владельца.');
      if (+lim.bad >= 3) return ctx.reply('🚫 Слишком много отклонённых заявок за сутки. Напишите администратору.');
      const r = await db.query("update topups set status='review', file_id=$2, file_type=$3, file_uid=$5 where id=$1 and tg_id=$4 and status='new' returning *", [w.id, fileId, type, id, uid]);
      tpWait.delete(id);
      if (!r.rowCount) return ctx.reply('Эта заявка уже не активна — создайте новую: «💳 Пополнить баланс»');
      const t = r.rows[0], u = (await db.query('select name from users where steam_id=$1', [t.steam_id])).rows[0];
      const who = [ctx.from.first_name, ctx.from.username && '@' + ctx.from.username].filter(Boolean).join(' ');
      const cap = `💳 Заявка на пополнение #${t.id}\nСумма: ${rub(t.amount)} ₽ → ${rub(t.coins)} монет\nTelegram: ${who} (${id})\nСайт: ${(u && u.name) || 'Игрок'} (${t.steam_id})\n\nСверьте поступление на вашем счёте (комментарий NP${t.id}) и подтвердите.\n⚠️ Чек можно подделать — ориентируйтесь только на реальное поступление в банке на сумму ${rub(t.amount)} ₽.`;
      const k = new InlineKeyboard().text('✅ Зачислить', 'tpa:' + t.id).text('❌ Отклонить', 'tpr:' + t.id);
      let sent = 0;
      for (const o of TG_ADMINS) {
        try { await (type === 'photo' ? ctx.api.sendPhoto(o, fileId, { caption: cap, reply_markup: k }) : ctx.api.sendDocument(o, fileId, { caption: cap, reply_markup: k })); sent++; }
        catch (e) { console.error('tg topup notify:', e.message); }
      }
      return ctx.reply(sent ? `✅ Чек по заявке #${t.id} отправлен на проверку. Как только владелец подтвердит перевод, монеты придут на ваш аккаунт, и я напишу сюда.` : `⚠️ Не удалось уведомить владельца. Заявка #${t.id} сохранена — напишите администратору и назовите её номер.`);
    } catch (e) { console.error('tg topup receipt:', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  bot.callbackQuery(/^tp([arybB]):(\d+)$/, async ctx => { // владелец: «Зачислить» → второе подтверждение «Деньги пришли» → зачисление
    if (!isOwner(ctx)) return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true }).catch(() => {});
    const op = ctx.match[1], tid = +ctx.match[2];
    if (op === 'a' || op === 'b') { // шаг 1/назад: меняем только кнопки
      const t = (await db.query("select amount from topups where id=$1 and status='review'", [tid])).rows[0];
      if (!t) return ctx.answerCallbackQuery({ text: 'Заявка уже обработана', show_alert: true }).catch(() => {});
      await ctx.answerCallbackQuery(op === 'a' ? { text: `Проверьте банк: на карту должно прийти ровно ${rub(t.amount)} ₽ с комментарием NP${tid}. Только тогда жмите «Деньги пришли».`, show_alert: true } : {}).catch(() => {});
      const kb = op === 'a' ? new InlineKeyboard().text(`💰 Деньги пришли: ${rub(t.amount)} ₽`, 'tpy:' + tid).row().text('◀ Назад', 'tpb:' + tid) : new InlineKeyboard().text('✅ Зачислить', 'tpa:' + tid).text('❌ Отклонить', 'tpr:' + tid);
      return ctx.editMessageReplyMarkup({ reply_markup: kb }).catch(() => {});
    }
    const ok = op === 'y', c = await db.connect();
    try {
      await c.query('begin');
      const r = await c.query("update topups set status=$2, done_by=$3, done_at=$4 where id=$1 and status='review' returning *", [tid, ok ? 'ok' : 'no', String(ctx.from.id), Date.now()]);
      if (!r.rowCount) { await c.query('rollback'); return ctx.answerCallbackQuery({ text: 'Заявка уже обработана', show_alert: true }).catch(() => {}); }
      const t = r.rows[0];
      if (ok && !(await c.query('update users set coins=coins+$1 where steam_id=$2', [t.coins, t.steam_id])).rowCount) {
        await c.query('rollback'); return ctx.answerCallbackQuery({ text: 'Аккаунт игрока на сайте не найден', show_alert: true }).catch(() => {});
      }
      await c.query('commit');
      await ctx.answerCallbackQuery({ text: ok ? 'Зачислено' : 'Отклонено' }).catch(() => {});
      const msg = ctx.callbackQuery.message;
      await ctx.api.editMessageCaption(msg.chat.id, msg.message_id, { caption: (msg.caption || `Заявка #${t.id}`) + `\n\n${ok ? '✅ Зачислено' : '❌ Отклонено'} (${ctx.from.first_name || ctx.from.id})`, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      tgNotify(t.tg_id, ok ? `✅ Пополнение #${t.id} подтверждено: +${rub(t.coins)} монет на ваш аккаунт.` : `❌ Пополнение #${t.id} отклонено: перевод не найден. Если вы платили, напишите администратору и назовите номер заявки.`);
    } catch (e) { await c.query('rollback').catch(() => {}); console.error('tg topup decide:', e.message); ctx.reply('❌ Ошибка базы, попробуйте позже'); }
    finally { c.release(); }
  });
  bot.on('message:text', async ctx => { // ответ на вопрос админ-панели («Отправьте КОД МОНЕТЫ АКТИВАЦИИ…»); команды сюда не попадают
    const id = String(ctx.from.id), p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;
    if (Date.now() - p.at > 10 * 60000) return ctx.reply('Время ввода вышло — выберите действие в админ-панели ещё раз', { reply_markup: new InlineKeyboard().text('🛠 Админ панель', 'ap') });
    try { await H[p.act](sub(ctx, text)); if (p.act !== 'topup') await (p.act === 'redeem' ? openMe(ctx, true) : openPanel(ctx, true)); }
    catch (e) { console.error('tg input ' + p.act + ':', e.message); ctx.reply('❌ Ошибка, попробуйте позже'); }
  });
  bot.catch(e => console.error('tg bot error:', e.message));

  const hook = '/tg/' + process.env.TG_WEBHOOK_SECRET;
  app.post(hook, webhookCallback(bot, 'express', { secretToken: process.env.TG_WEBHOOK_SECRET }));
  const site = process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL;
  if (site) bot.api.setWebhook(site + hook, { secret_token: process.env.TG_WEBHOOK_SECRET })
    .then(() => console.log('tg webhook set')).catch(e => console.error('tg webhook:', e.message));
}

// страницы сайта имеют свои адреса (/shop, /leaders, /profile/<SteamID64> …) — все отдают тот же index.html, дальше работает маршрутизация в браузере
app.get('/glent.mp3', (req, res) => res.sendFile(path.join(__dirname, 'glent.mp3'), { maxAge: '7d' })); // песня режима /глент (файл glent.mp3 лежит рядом с server.js)
app.get(['/', '/shop', '/leaders', '/bans', '/rules', '/settings', '/admin', '/skins', '/public', '/battleship', '/chat', '/profile/:id'], (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
init().then(() => app.listen(process.env.PORT || 3000, () => console.log('ok')))
  .catch(e => { console.error('DB error:', e.message); process.exit(1); });
