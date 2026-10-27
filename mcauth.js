// 🟩 Minecraft: аккаунты сайта для лаунчера и сервера.
//  • привязка ника Minecraft к аккаунту сайта (вход на сайте через Steam, как и раньше);
//  • скин: загрузка на сайте или из лаунчера, хранится в базе, отдаётся по /textures/<hash>.png;
//  • вход лаунчера через сайт (как привязка Telegram: лаунчер открывает страницу, игрок подтверждает);
//  • Yggdrasil-совместимый сервер сессий (/yggdrasil) для authlib-injector: именно он заменяет серверы Mojang,
//    поэтому Minecraft-сервер и клиент проверяют игроков через ваш сайт.
// Подключение в server.js: require('./mcauth').site(app, getUser, { db, isAdmin })
const crypto = require('crypto');

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const CODE_RE = /^NP-[A-HJ-NP-Z2-9]{8}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN_TTL = 90 * 864e5;         // токен лаунчера живёт 90 дней с последнего использования
const DEVICE_TTL = 10 * 60e3;         // код входа лаунчера действует 10 минут
const JOIN_TTL = 60e3;                // как долго действует «join» игрока до проверки сервером
const MAX_SKIN = 48 * 1024;           // максимум 48 КБ на PNG
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const undash = u => String(u || '').replace(/-/g, '').toLowerCase();

exports.site = function (app, getUser, { db, isAdmin = () => false } = {}) {
  const base = req => (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
  const urlenc = require('express').urlencoded({ extended: false });
  const hits = new Map(); // простая защита от перебора: ключ -> [счётчик, начало окна]
  const limited = (key, max, win = 60e3) => {
    const n = Date.now(), h = hits.get(key);
    if (!h || n - h[1] > win) { hits.set(key, [1, n]); return false; }
    return ++h[0] > max;
  };
  setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (n - v[1] > 120e3) hits.delete(k); }, 60e3).unref();

  // ---------- база ----------
  let keys = null; // RSA-ключ для подписи свойств профиля (скин): создаётся один раз и хранится в таблице site
  const ready = (async () => {
    await db.query(`
      create table if not exists mc_accounts(steam_id text primary key, uuid text not null unique, name text not null,
        skin_hash text, skin_model text not null default 'classic', name_at bigint not null default 0, created bigint not null);
      create unique index if not exists mc_accounts_name_ci on mc_accounts(lower(name));
      create table if not exists mc_skins(hash text primary key, png bytea not null);
      create table if not exists mc_tokens(hash text primary key, steam_id text not null, at bigint not null, seen bigint not null);
      create table if not exists mc_device(device text primary key, code text not null unique, steam_id text, at bigint not null);`);
    const r = (await db.query("select value from site where key='mc_rsa'")).rows[0];
    if (r) keys = JSON.parse(r.value);
    else {
      keys = await new Promise((ok, no) => crypto.generateKeyPair('rsa', { modulusLength: 4096,
        publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } },
      (e, pub, priv) => e ? no(e) : ok({ pub, priv })));
      await db.query("insert into site(key,value) values('mc_rsa',$1) on conflict (key) do nothing", [JSON.stringify(keys)]);
      keys = JSON.parse((await db.query("select value from site where key='mc_rsa'")).rows[0].value);
    }
  })().catch(e => console.error('mcauth init:', e.message));
  const R = async (req, res, next) => { await ready; next(); };

  // ---------- аккаунты ----------
  const accOf = async steamId => (await db.query('select * from mc_accounts where steam_id=$1', [steamId])).rows[0] || null;
  const accByUuid = async uuid => (await db.query('select * from mc_accounts where uuid=$1', [undash(uuid)])).rows[0] || null;
  async function createAccount(steamId, name) {
    name = String(name || '').trim();
    if (!NAME_RE.test(name)) throw new Error('Ник: 3–16 символов, латиница, цифры и _');
    if (await accOf(steamId)) throw new Error('Ник уже привязан к этому аккаунту');
    try {
      await db.query('insert into mc_accounts(steam_id,uuid,name,created) values($1,$2,$3,$4)', [steamId, crypto.randomUUID().replace(/-/g, ''), name, Date.now()]);
    } catch (e) { if (e.code === '23505') throw new Error('Этот ник уже занят'); throw e; }
    return accOf(steamId);
  }
  async function renameAccount(steamId, name) {
    name = String(name || '').trim();
    if (!NAME_RE.test(name)) throw new Error('Ник: 3–16 символов, латиница, цифры и _');
    const a = await accOf(steamId); if (!a) throw new Error('Сначала привяжите ник');
    if (a.name === name) return a;
    const wait = +a.name_at + 864e5 - Date.now();
    if (wait > 0) throw new Error(`Ник можно менять раз в сутки. Подождите ещё ${Math.ceil(wait / 36e5)} ч.`);
    try { await db.query('update mc_accounts set name=$2, name_at=$3 where steam_id=$1', [steamId, name, Date.now()]); }
    catch (e) { if (e.code === '23505') throw new Error('Этот ник уже занят'); throw e; }
    return accOf(steamId);
  }
  function checkPng(buf) { // PNG 64×64 или 64×32, до 48 КБ
    if (!buf.length || buf.length > MAX_SKIN) throw new Error('Файл слишком большой (максимум 48 КБ)');
    if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a || buf.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Нужен PNG-файл');
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    if (w !== 64 || (h !== 64 && h !== 32)) throw new Error('Размер скина должен быть 64×64 или 64×32 пикселя');
  }
  async function setSkin(steamId, b64, model) {
    const a = await accOf(steamId); if (!a) throw new Error('Сначала привяжите ник');
    const png = Buffer.from(String(b64 || '').replace(/^data:image\/png;base64,/, ''), 'base64');
    checkPng(png);
    const hash = sha(png);
    await db.query('insert into mc_skins(hash,png) values($1,$2) on conflict (hash) do nothing', [hash, png]);
    await db.query('update mc_accounts set skin_hash=$2, skin_model=$3 where steam_id=$1', [steamId, hash, model === 'slim' ? 'slim' : 'classic']);
    if (a.skin_hash && a.skin_hash !== hash) await dropSkin(a.skin_hash);
  }
  async function resetSkin(steamId) {
    const a = await accOf(steamId); if (!a) return;
    await db.query('update mc_accounts set skin_hash=null where steam_id=$1', [steamId]);
    if (a.skin_hash) await dropSkin(a.skin_hash);
  }
  const dropSkin = hash => db.query('delete from mc_skins where hash=$1 and not exists (select 1 from mc_accounts where skin_hash=$1)', [hash]).catch(() => {});

  // ---------- профиль в формате Mojang ----------
  const skinUrl = (b, a) => a.skin_hash ? `${b}/textures/${a.skin_hash}.png` : null;
  function profile(b, a, signed) {
    const tex = {};
    if (a.skin_hash) tex.SKIN = { url: skinUrl(b, a), ...(a.skin_model === 'slim' ? { metadata: { model: 'slim' } } : {}) };
    const value = Buffer.from(JSON.stringify({ timestamp: Date.now(), profileId: a.uuid, profileName: a.name, textures: tex })).toString('base64');
    const prop = { name: 'textures', value };
    if (signed && keys) prop.signature = crypto.sign('sha1', Buffer.from(value), keys.priv).toString('base64');
    return { id: a.uuid, name: a.name, properties: [prop] };
  }

  // ---------- токены лаунчера (они же accessToken игры) ----------
  async function newToken(steamId) {
    const t = crypto.randomBytes(24).toString('hex'), n = Date.now();
    await db.query('insert into mc_tokens(hash,steam_id,at,seen) values($1,$2,$3,$3)', [sha(t), steamId, n]);
    return t;
  }
  async function tokenInfo(token) { // -> { steam_id, acc } или null
    if (typeof token !== 'string' || !/^[\w-]{20,128}$/.test(token)) return null;
    const t = (await db.query('select * from mc_tokens where hash=$1', [sha(token)])).rows[0];
    if (!t || Date.now() - +t.seen > TOKEN_TTL) return null;
    if (Date.now() - +t.seen > 36e5) db.query('update mc_tokens set seen=$2 where hash=$1', [t.hash, Date.now()]).catch(() => {});
    const acc = await accOf(t.steam_id);
    return acc ? { steam_id: t.steam_id, acc } : null;
  }
  const bearer = async req => tokenInfo(((req.headers.authorization || '').match(/^Bearer (\S+)$/) || [])[1]);
  const authed = async (req, res, next) => {
    const t = await bearer(req);
    if (!t) return res.status(401).json({ error: 'Сессия лаунчера истекла — войдите через сайт заново' });
    req.mc = t; next();
  };
  const siteName = async steamId => ((await db.query('select name from users where steam_id=$1', [steamId])).rows[0] || {}).name || null;
  const launcherProfile = async (b, a) => ({ name: a.name, uuid: a.uuid, skin: skinUrl(b, a), model: a.skin_model, siteName: await siteName(a.steam_id), siteUrl: b });
  const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };

  // ---------- вход лаунчера через сайт ----------
  app.post('/api/launcher/start', R, wrap(async (req, res) => {
    if (limited('start:' + req.ip, 10)) return res.status(429).json({ error: 'Слишком много попыток, подождите минуту' });
    await db.query('delete from mc_device where at<$1', [Date.now() - DEVICE_TTL]);
    const device = crypto.randomBytes(24).toString('hex');
    const code = 'NP-' + Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
    await db.query('insert into mc_device(device,code,at) values($1,$2,$3)', [sha(device), code, Date.now()]);
    res.json({ device, code, url: `${base(req)}/minecraft/link?code=${code}`, interval: 3, expires_in: DEVICE_TTL / 1000 });
  }));
  app.post('/api/launcher/poll', R, wrap(async (req, res) => {
    if (limited('poll:' + req.ip, 120)) return res.status(429).json({ error: 'Слишком часто' });
    const row = (await db.query('select * from mc_device where device=$1', [sha(req.body && req.body.device)])).rows[0];
    if (!row || Date.now() - +row.at > DEVICE_TTL) return res.status(410).json({ error: 'Код устарел — начните вход заново' });
    if (!row.steam_id) return res.json({ status: 'pending' });
    const a = await accOf(row.steam_id);
    if (!a) return res.json({ status: 'pending' });
    await db.query('delete from mc_device where device=$1', [row.device]);
    res.json({ status: 'ok', token: await newToken(row.steam_id), profile: await launcherProfile(base(req), a) });
  }));
  app.get('/api/launcher/me', R, authed, wrap(async (req, res) => res.json(await launcherProfile(base(req), req.mc.acc))));
  app.post('/api/launcher/skin', R, authed, wrap(async (req, res) => {
    await setSkin(req.mc.steam_id, req.body && req.body.png, req.body && req.body.model);
    res.json(await launcherProfile(base(req), await accOf(req.mc.steam_id)));
  }));
  app.post('/api/launcher/skin-reset', R, authed, wrap(async (req, res) => { await resetSkin(req.mc.steam_id); res.json({ ok: true }); }));
  app.post('/api/launcher/logout', R, wrap(async (req, res) => {
    const t = ((req.headers.authorization || '').match(/^Bearer (\S+)$/) || [])[1];
    if (t) await db.query('delete from mc_tokens where hash=$1', [sha(t)]);
    res.json({ ok: true });
  }));

  // ---------- API для страницы сайта (вход по cookie сайта) ----------
  const needUser = async (req, res, next) => {
    const u = await getUser(req);
    if (!u) return res.status(401).json({ error: 'Войдите через Steam' });
    req.u = u; next();
  };
  const meOut = async (req, u) => {
    const a = await accOf(u.steam_id), b = base(req);
    return { siteName: u.name || 'Игрок', avatar: u.avatar || null, linked: !!a, name: a && a.name, uuid: a && a.uuid, model: a && a.skin_model,
      skin: a ? skinUrl(b, a) : null, nameWaitH: a ? Math.max(0, Math.ceil((+a.name_at + 864e5 - Date.now()) / 36e5)) : 0,
      base: b, admin: !!isAdmin(u), suggest: String(u.name || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16) };
  };
  app.get('/api/mc/me', R, needUser, wrap(async (req, res) => res.json(await meOut(req, req.u))));
  app.post('/api/mc/create', R, needUser, wrap(async (req, res) => { await createAccount(req.u.steam_id, req.body && req.body.name); res.json(await meOut(req, req.u)); }));
  app.post('/api/mc/name', R, needUser, wrap(async (req, res) => { await renameAccount(req.u.steam_id, req.body && req.body.name); res.json(await meOut(req, req.u)); }));
  app.post('/api/mc/skin', R, needUser, wrap(async (req, res) => { await setSkin(req.u.steam_id, req.body && req.body.png, req.body && req.body.model); res.json(await meOut(req, req.u)); }));
  app.post('/api/mc/skin-reset', R, needUser, wrap(async (req, res) => { await resetSkin(req.u.steam_id); res.json(await meOut(req, req.u)); }));
  app.post('/api/mc/logout-all', R, needUser, wrap(async (req, res) => { await db.query('delete from mc_tokens where steam_id=$1', [req.u.steam_id]); res.json({ ok: true }); }));

  app.get('/textures/:file', R, async (req, res) => {
    const m = /^([a-f0-9]{64})\.png$/.exec(req.params.file);
    const r = m && (await db.query('select png from mc_skins where hash=$1', [m[1]])).rows[0];
    if (!r) return res.status(404).end();
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }).send(r.png);
  });

  // ---------- страницы сайта ----------
  const CSS = `*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0e0f14;color:#e8e9ef;font:16px/1.5 system-ui,sans-serif}
.w{max-width:640px;margin:0 auto;padding:24px 16px 60px}h1{font-size:24px;margin:8px 0 4px}h2{font-size:17px;margin:0 0 10px}.m{color:#aeb2c2;margin:4px 0}
.c{background:#171922;border:1px solid #2a2d3a;border-radius:16px;padding:20px;margin:16px 0}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:10px 0}
input[type=text]{flex:1;min-width:160px;padding:10px 12px;border-radius:10px;border:1px solid #2a2d3a;background:#0e0f14;color:#e8e9ef;font:inherit}
.b{display:inline-block;padding:10px 18px;border-radius:10px;background:#5b6cff;color:#fff;text-decoration:none;border:0;font:inherit;cursor:pointer}.b.g{background:#2a2d3a}.b.r{background:#b3262f}.b:disabled{opacity:.5;cursor:default}
code,pre{background:#0e0f14;border:1px solid #2a2d3a;border-radius:8px;padding:2px 6px;font-size:13px;word-break:break-all}pre{padding:10px;white-space:pre-wrap}
#msg{min-height:22px;margin:6px 0;color:#ffb4b4}#msg.ok{color:#9be5a8}canvas{image-rendering:pixelated;background:#0e0f14;border:1px solid #2a2d3a;border-radius:12px}
.code{font:700 30px/1.2 ui-monospace,monospace;letter-spacing:3px;text-align:center;background:#0e0f14;border:1px dashed #5b6cff;border-radius:12px;padding:14px;margin:14px 0}.t{text-align:center}label{margin-right:12px}`;
  const shell = (title, inner, script = '') => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="w">${inner}</div>${script ? `<script>${script}</script>` : ''}</body></html>`;
  const home = '<p><a class="b g" href="/">На сайт</a></p>';

  app.get('/minecraft/link', R, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const code = String(req.query.code || '').toUpperCase();
    if (!CODE_RE.test(code)) return res.status(400).send(shell('Ссылка недействительна', '<div class="c t"><h1>Ссылка недействительна</h1><p class="m">Нажмите «Войти через сайт» в лаунчере ещё раз.</p></div>' + home));
    const u = await getUser(req);
    if (!u) { res.setHeader('Set-Cookie', `mcl=${code}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900`); return res.redirect('/auth/steam'); }
    const row = (await db.query('select * from mc_device where code=$1 and at>$2 and steam_id is null', [code, Date.now() - DEVICE_TTL])).rows[0];
    if (!row) return res.status(400).send(shell('Код устарел', '<div class="c t"><h1>Код устарел</h1><p class="m">Он действует 10 минут и работает один раз. Начните вход в лаунчере заново.</p></div>' + home));
    const a = await accOf(u.steam_id);
    const nick = a ? `<p class="m">Ник Minecraft: <b>${esc(a.name)}</b></p>`
      : `<p class="m">Придумайте ник для игры. Он будет виден на сервере.</p><div class="row"><input type="text" name="name" maxlength="16" pattern="[A-Za-z0-9_]{3,16}" required placeholder="Ник (латиница, цифры, _)" value="${esc(String(u.name || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16))}"></div>`;
    res.send(shell('Вход в лаунчер', `<div class="c t"><h1>Войти в лаунчер?</h1><p class="m">Аккаунт на сайте: <b>${esc(u.name || u.steam_id)}</b></p>
<p class="m">Убедитесь, что этот код совпадает с кодом в окне лаунчера:</p><div class="code">${esc(code)}</div>
<form method="post" action="/minecraft/link"><input type="hidden" name="code" value="${esc(code)}">${nick}
<p class="m">Если вы не запускали вход сами — нажмите «Отмена». Иначе чужой лаунчер получит доступ к вашему аккаунту.</p>
<button class="b" type="submit">✅ Подтвердить</button> <a class="b g" href="/">Отмена</a></form></div>`));
  });
  app.post('/minecraft/link', R, urlenc, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const code = String((req.body || {}).code || '').toUpperCase();
    const fail = (t, p) => res.status(400).send(shell(t, `<div class="c t"><h1>${esc(t)}</h1><p class="m">${esc(p)}</p><p><a class="b" href="/minecraft/link?code=${esc(code)}">Назад</a></p></div>`));
    try {
      const u = await getUser(req);
      if (!u || !CODE_RE.test(code)) return res.redirect('/minecraft/link?code=' + encodeURIComponent(code));
      if (limited('link:' + u.steam_id, 15)) return fail('Слишком много попыток', 'Подождите минуту.');
      if (!(await accOf(u.steam_id))) await createAccount(u.steam_id, (req.body || {}).name);
      const r = await db.query('update mc_device set steam_id=$2 where code=$1 and at>$3 and steam_id is null', [code, u.steam_id, Date.now() - DEVICE_TTL]);
      if (!r.rowCount) return fail('Код устарел', 'Начните вход в лаунчере заново.');
      res.send(shell('Готово', '<div class="c t"><h1>Готово ✅</h1><p class="m">Вернитесь в лаунчер — вход выполнится автоматически.</p><p><a class="b g" href="/minecraft">Профиль Minecraft</a></p></div>'));
    } catch (e) { fail('Не получилось', e.message); }
  });

  app.get('/minecraft', R, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const u = await getUser(req);
    if (!u) { res.setHeader('Set-Cookie', 'mcl=home; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900'); return res.redirect('/auth/steam'); }
    res.send(shell('Minecraft — NextProject', `<h1>Minecraft-профиль</h1><p class="m">Аккаунт на сайте: <b id="site"></b></p><div id="app" class="m">Загрузка…</div><div id="msg"></div>${home}`, PAGE_JS));
  });

  const PAGE_JS = `
var $=function(i){return document.getElementById(i)},me=null;
function h(t,a){var e=document.createElement(t);a=a||{};for(var k in a){if(k==='text')e.textContent=a[k];else if(k.indexOf('on')===0)e[k]=a[k];else e.setAttribute(k,a[k])}
 for(var i=2;i<arguments.length;i++){var c=arguments[i];if(c)e.appendChild(typeof c==='string'?document.createTextNode(c):c)}return e}
function say(t,ok){var m=$('msg');m.textContent=t||'';m.className=ok?'ok':''}
function api(url,body){return fetch(url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
 .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Ошибка');return j})})}
function act(fn,okText){return function(){say('');fn().then(function(j){if(j&&j.base)me=j;render();if(okText)say(okText,1)}).catch(function(e){say(e.message)})}}
function draw(cv,img,slim){var s=8,x=cv.getContext('2d');cv.width=16*s;cv.height=32*s;x.imageSmoothingEnabled=false;x.scale(s,s);
 var new64=img.height>=64,aw=slim?3:4;
 function p(sx,sy,w,hh,dx,dy,flip){x.save();if(flip){x.translate(dx+w,dy);x.scale(-1,1);x.drawImage(img,sx,sy,w,hh,0,0,w,hh)}else x.drawImage(img,sx,sy,w,hh,dx,dy,w,hh);x.restore()}
 p(4,20,4,12,4,20);new64?p(20,52,4,12,8,20):p(4,20,4,12,8,20,1);
 p(20,20,8,12,4,8);p(44,20,aw,12,4-aw,8);new64?p(36,52,aw,12,12,8):p(44,20,aw,12,12,8,1);
 p(8,8,8,8,4,0);
 if(new64){p(4,36,4,12,4,20);p(4,52,4,12,8,20);p(20,36,8,12,4,8);p(44,36,aw,12,4-aw,8);p(52,52,aw,12,12,8)}
 p(40,8,8,8,4,0)}
function skinCard(){
 var cv=h('canvas',{width:128,height:256,style:'width:128px;height:256px'}),f=h('input',{type:'file',accept:'image/png'}),slim=me.model==='slim';
 var img=new Image();img.onload=function(){draw(cv,img,slim)};
 if(me.skin)img.src=me.skin;else img.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#3b3a8f" opacity=".0"/></svg>');
 var r1=h('input',{type:'radio',name:'mdl',value:'classic'}),r2=h('input',{type:'radio',name:'mdl',value:'slim'});(slim?r2:r1).checked=true;
 var up=h('button',{class:'b',text:'Загрузить скин',onclick:function(){
  var file=f.files[0];if(!file)return say('Выберите PNG-файл');if(file.size>49152)return say('Файл слишком большой (максимум 48 КБ)');
  var rd=new FileReader();rd.onload=function(){act(function(){return api('/api/mc/skin',{png:rd.result,model:r2.checked?'slim':'classic'})},'Скин обновлён')()};rd.readAsDataURL(file)}});
 return h('div',{class:'c'},h('h2',{text:'Скин'}),h('div',{class:'row'},cv,h('div',{},
  h('p',{class:'m',text:me.skin?'Это ваш текущий скин.':'Скина пока нет — в игре будет стандартный.'}),
  h('p',{class:'m',text:'PNG 64×64 или 64×32, до 48 КБ.'}),f,
  h('div',{class:'row'},h('label',{},r1,' Классический (Steve)'),h('label',{},r2,' Тонкие руки (Alex)')),
  h('div',{class:'row'},up,me.skin?h('button',{class:'b g',text:'Сбросить',onclick:act(function(){return api('/api/mc/skin-reset',{})},'Скин сброшен')}):null))))}
function render(){var a=$('app');a.textContent='';$('site').textContent=me.siteName;
 if(!me.linked){var n=h('input',{type:'text',maxlength:16,placeholder:'Ник (латиница, цифры, _)',value:me.suggest});
  a.appendChild(h('div',{class:'c'},h('h2',{text:'Привяжите ник Minecraft'}),h('p',{class:'m',text:'Он будет вашим именем на сервере и в лаунчере.'}),
   h('div',{class:'row'},n,h('button',{class:'b',text:'Привязать',onclick:act(function(){return api('/api/mc/create',{name:n.value})},'Ник привязан')}))));return}
 var n2=h('input',{type:'text',maxlength:16,value:me.name});
 a.appendChild(h('div',{class:'c'},h('h2',{text:'Ник и UUID'}),h('p',{class:'m'},'Ник: ',h('b',{text:me.name})),h('p',{class:'m'},'UUID: ',h('code',{text:me.uuid})),
  h('div',{class:'row'},n2,h('button',{class:'b g',text:'Сменить ник',onclick:act(function(){return api('/api/mc/name',{name:n2.value})},'Ник изменён')})),
  h('p',{class:'m',text:me.nameWaitH>0?'Следующая смена ника — через '+me.nameWaitH+' ч.':'Ник можно менять раз в сутки.'})));
 a.appendChild(skinCard());
 a.appendChild(h('div',{class:'c'},h('h2',{text:'Лаунчер'}),h('p',{class:'m',text:'В лаунчере нажмите «Войти через сайт» — войдёте под этим ником, а смена скина в лаунчере обновит его и здесь.'}),
  h('button',{class:'b r',text:'Выйти из лаунчера на всех устройствах',onclick:act(function(){return api('/api/mc/logout-all',{})},'Все лаунчеры отключены')})));
 if(me.admin)a.appendChild(h('div',{class:'c'},h('h2',{text:'Подключение Minecraft-сервера'}),
  h('p',{class:'m',text:'Скачайте authlib-injector.jar, положите рядом с ядром сервера и запускайте так:'}),
  h('pre',{text:'java -javaagent:authlib-injector.jar='+me.base+'/yggdrasil -jar server.jar nogui'}),
  h('p',{class:'m',text:'В server.properties: online-mode=true, для 1.19+ ещё enforce-secure-profile=false.'})))}
api('/api/mc/me').then(function(j){me=j;render()}).catch(function(e){$('app').textContent='';say(e.message)});`;

  // ---------- Yggdrasil API (authlib-injector) ----------
  const forbid = (res, text) => res.status(403).json({ error: 'ForbiddenOperationException', errorMessage: text });
  const sessions = new Map(); // serverId -> { uuid, name, t }
  setInterval(() => { const n = Date.now(); for (const [k, v] of sessions) if (n - v.t > JOIN_TTL) sessions.delete(k); }, 30e3).unref();
  const Y = '/yggdrasil';

  app.get(Y, R, (req, res) => {
    const b = base(req);
    res.json({ meta: { serverName: 'NextProject', implementationName: 'nextproject-site', implementationVersion: '1.0', 'feature.non_email_login': true },
      skinDomains: [new URL(b).hostname], signaturePublickey: keys ? keys.pub : undefined });
  });
  app.post(Y + '/sessionserver/session/minecraft/join', R, async (req, res) => {
    try {
      const { accessToken, selectedProfile, serverId } = req.body || {};
      const t = await tokenInfo(accessToken);
      if (!t || undash(selectedProfile) !== t.acc.uuid || typeof serverId !== 'string' || serverId.length > 64) return forbid(res, 'Недействительный токен. Перезапустите лаунчер и войдите заново.');
      sessions.set(serverId, { uuid: t.acc.uuid, name: t.acc.name, t: Date.now() });
      res.status(204).end();
    } catch (e) { console.error('ygg join:', e.message); res.status(500).json({ error: 'InternalError', errorMessage: 'Ошибка сервера' }); }
  });
  app.get(Y + '/sessionserver/session/minecraft/hasJoined', R, async (req, res) => {
    try {
      const s = sessions.get(String(req.query.serverId || ''));
      if (!s || Date.now() - s.t > JOIN_TTL || String(req.query.username || '').toLowerCase() !== s.name.toLowerCase()) return res.status(204).end();
      sessions.delete(String(req.query.serverId));
      const a = await accByUuid(s.uuid);
      if (!a) return res.status(204).end();
      res.json(profile(base(req), a, true));
    } catch (e) { console.error('ygg hasJoined:', e.message); res.status(500).json({ error: 'InternalError', errorMessage: 'Ошибка сервера' }); }
  });
  app.get(Y + '/sessionserver/session/minecraft/profile/:uuid', R, async (req, res) => {
    const a = await accByUuid(req.params.uuid);
    if (!a) return res.status(204).end();
    res.json(profile(base(req), a, req.query.unsigned === 'false'));
  });
  app.post(Y + '/api/profiles/minecraft', R, async (req, res) => {
    const names = (Array.isArray(req.body) ? req.body : []).map(String).filter(n => NAME_RE.test(n)).slice(0, 100);
    if (!names.length) return res.json([]);
    const rows = (await db.query('select uuid,name from mc_accounts where lower(name)=any($1)', [names.map(n => n.toLowerCase())])).rows;
    res.json(rows.map(r => ({ id: r.uuid, name: r.name })));
  });
  // authserver: пароли не используются, вход только через лаунчер; остальное нужно для совместимости модов и лаунчеров
  app.post(Y + '/authserver/authenticate', (req, res) => forbid(res, 'Вход только через лаунчер NextProject (кнопка «Войти через сайт»).'));
  app.post(Y + '/authserver/signout', (req, res) => res.status(204).end());
  app.post(Y + '/authserver/validate', R, async (req, res) => (await tokenInfo((req.body || {}).accessToken)) ? res.status(204).end() : forbid(res, 'Недействительный токен.'));
  app.post(Y + '/authserver/refresh', R, async (req, res) => {
    const t = await tokenInfo((req.body || {}).accessToken);
    if (!t) return forbid(res, 'Недействительный токен.');
    const p = { id: t.acc.uuid, name: t.acc.name };
    res.json({ accessToken: req.body.accessToken, clientToken: req.body.clientToken || '', selectedProfile: p, availableProfiles: [p], user: { id: t.acc.uuid, properties: [] } });
  });
  app.post(Y + '/authserver/invalidate', R, async (req, res) => {
    const t = (req.body || {}).accessToken;
    if (typeof t === 'string') await db.query('delete from mc_tokens where hash=$1', [sha(t)]);
    res.status(204).end();
  });
};
