// CS2: API для плагина VipReport (VIP, репорты, админка).
// Плагин на сервере CS2 спрашивает статус игрока (бан, права админа, VIP), присылает жалобы
// и админские действия (кик, бан, разбан). Все проверки прав и банов — здесь, на сайте.
// Ключ сервера — в CS2_SERVER_KEY (тот же ключ в config.json плагина).
const crypto = require('crypto');

const REPORT_COOLDOWN_MS = 60 * 1000;
const reportCooldown = new Map(); // steam id игрока -> время последней жалобы
const CAP_UNTIL = 253402300799000; // 31.12.9999: дальше плагин не читает даты

function keyOk(req) {
  const want = process.env.CS2_SERVER_KEY || '';
  const got = String(req.headers['x-server-key'] || '');
  if (!want || want.length !== got.length) return false;
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
}

const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function site(app, db, opts = {}) {
  const notify = opts.notify || (async () => {});
  const owner = opts.owner || '';

  const ready = (async () => {
    await db.query(`create table if not exists cs2_vip(
      steam_id text primary key, tier text not null default 'vip', until bigint not null, model text)`);
    await db.query(`create table if not exists cs2_reports(
      id serial primary key, reporter text not null, reporter_name text, target text not null,
      reason text not null, server text, at bigint not null)`);
  })().catch(e => console.error('cs2api init:', e.message));

  const wrap = fn => async (req, res) => {
    try { await ready; await fn(req, res); }
    catch (e) {
      console.error('cs2api:', e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Ошибка сервера' });
    }
  };

  // администратор: владелец или есть активная админка на сайте
  async function isAdmin(steam) {
    if (!steam) return false;
    if (steam === owner) return true;
    const r = (await db.query('select plus_until, grant_until from users where steam_id=$1', [steam])).rows[0];
    if (!r) return false;
    return Math.max(+r.plus_until || 0, +r.grant_until || 0) > Date.now();
  }

  // мут: отдельная запись kind='mute' (until = 0 — навсегда)
  async function isMuted(steam) {
    const r = await db.query("select 1 from bans where steam_id=$1 and kind='mute' and active and (until=0 or until>$2) limit 1", [steam, Date.now()]);
    return r.rowCount > 0;
  }

  // бан: активная запись в общей таблице банов сайта (until = 0 — навсегда)
  async function isBanned(steam) {
    const r = await db.query("select 1 from bans where steam_id=$1 and active and kind is distinct from 'mute' and (until=0 or until>$2) limit 1", [steam, Date.now()]);
    return r.rowCount > 0;
  }

  // цель админского действия: SteamID (если известен) или ник из базы сайта
  async function resolveTarget(b) {
    const steam = String(b.targetSteam || '');
    if (/^\d{17}$/.test(steam)) return { steam, name: clean(b.target, 64) || steam };
    const nick = clean(b.target, 64);
    if (!nick) return null;
    const r = (await db.query('select steam_id, name from users where lower(name)=lower($1) limit 1', [nick])).rows[0];
    return r ? { steam: r.steam_id, name: r.name || nick } : null;
  }

  // GET /api/cs2/check?steam=76561198...  → { banned, admin, vip: { tier, until, model } | null }
  app.get('/api/cs2/check', wrap(async (req, res) => {
    if (!keyOk(req)) return res.status(401).json({ error: 'Неверный ключ сервера' });
    const steam = String(req.query.steam || '');
    if (!/^\d{17}$/.test(steam)) return res.status(400).json({ error: 'Нужен SteamID64' });
    const banned = await isBanned(steam);
    const muted = await isMuted(steam);
    const admin = await isAdmin(steam);
    const row = (await db.query('select tier, until, model from cs2_vip where steam_id=$1 and until > $2',
      [steam, Date.now()])).rows[0];
    res.json({
      banned, muted, admin,
      vip: row ? { tier: row.tier, until: +row.until, model: row.model || null } : null
    });
  }));

  // POST /api/cs2/report  { reporter, reporterName, target, reason, server }
  app.post('/api/cs2/report', wrap(async (req, res) => {
    if (!keyOk(req)) return res.status(401).json({ error: 'Неверный ключ сервера' });
    const b = req.body || {};
    const reporter = String(b.reporter || '');
    const target = clean(b.target, 64);
    const reason = clean(b.reason, 300);
    const reporterName = clean(b.reporterName, 64);
    const server = clean(b.server, 64);
    if (!/^\d{17}$/.test(reporter)) return res.status(400).json({ error: 'Нужен SteamID64 отправителя' });
    if (!target || !reason) return res.status(400).json({ error: 'Укажите ник и причину' });
    if (target.toLowerCase() === reporterName.toLowerCase()) return res.status(400).json({ error: 'Нельзя жаловаться на себя' });
    const now = Date.now();
    if (now - (reportCooldown.get(reporter) || 0) < REPORT_COOLDOWN_MS) {
      return res.status(429).json({ error: `Жалобу можно отправлять раз в ${REPORT_COOLDOWN_MS / 1000} сек.` });
    }
    reportCooldown.set(reporter, now);
    await db.query('insert into cs2_reports(reporter, reporter_name, target, reason, server, at) values ($1,$2,$3,$4,$5,$6)',
      [reporter, reporterName, target, reason, server, now]);
    notify(`🚨 Жалоба на сервере ${server || 'CS2'}\nОт: ${reporterName || reporter}\nНа: ${target}\nПричина: ${reason}`)
      .catch(e => console.error('cs2 report notify:', e.message));
    res.json({ ok: true });
  }));

  // POST /api/cs2/admin  { admin, adminName, action: kick|ban|unban, target, targetSteam, minutes, reason }
  // Права админа проверяются здесь, даже если плагин уже показал команду
  app.post('/api/cs2/admin', wrap(async (req, res) => {
    if (!keyOk(req)) return res.status(401).json({ error: 'Неверный ключ сервера' });
    const b = req.body || {};
    const adminSteam = String(b.admin || '');
    if (!/^\d{17}$/.test(adminSteam) || !(await isAdmin(adminSteam))) {
      return res.status(403).json({ error: 'Нет прав администратора' });
    }
    const adminName = clean(b.adminName, 64) || adminSteam;
    const action = String(b.action || '');

    if (action === 'kick') return res.json({ ok: true });

    const t = await resolveTarget(b);
    if (!t) return res.status(404).json({ error: 'Игрок не найден среди зарегистрированных на сайте' });

    if (action === 'ban') {
      const minutes = Math.floor(+b.minutes || 0);
      if (minutes < 0 || minutes > 525600) return res.status(400).json({ error: 'Срок: от 0 до 525600 минут (0 — навсегда)' });
      const reason = clean(b.reason, 200) || 'Без причины';
      const now = Date.now();
      const until = minutes > 0 ? now + minutes * 60000 : 0;
      await db.query(`insert into bans(kind, steam_id, player, admin, admin_id, reason, term, until, active, at)
        values ('cs2',$1,$2,$3,$4,$5,$6,$7,true,$8)`,
        [t.steam, t.name, adminName, adminSteam, reason, minutes ? `${minutes} мин` : 'навсегда', until, now]);
      notify(`🔨 Бан в игре\nИгрок: ${t.name} (${t.steam})\nАдмин: ${adminName}\nСрок: ${minutes ? minutes + ' мин' : 'навсегда'}\nПричина: ${reason}`)
        .catch(e => console.error('cs2 ban notify:', e.message));
      return res.json({ ok: true, steam: t.steam, name: t.name });
    }

    if (action === 'mute') {
      const minutes = Math.floor(+b.minutes || 0);
      if (minutes < 0 || minutes > 525600) return res.status(400).json({ error: 'Срок: от 0 до 525600 минут (0 — навсегда)' });
      const now = Date.now();
      const until = minutes > 0 ? now + minutes * 60000 : 0;
      await db.query(`insert into bans(kind, steam_id, player, admin, admin_id, reason, term, until, active, at)
        values ('mute',$1,$2,$3,$4,$5,$6,$7,true,$8)`,
        [t.steam, t.name, adminName, adminSteam, 'Мут', minutes ? `${minutes} мин` : 'навсегда', until, now]);
      return res.json({ ok: true, steam: t.steam, name: t.name });
    }

    if (action === 'unmute') {
      const r = await db.query("update bans set active=false where steam_id=$1 and kind='mute' and active", [t.steam]);
      return res.json({ ok: true, steam: t.steam, count: r.rowCount });
    }

    if (action === 'unban') {
      const r = await db.query('update bans set active=false where steam_id=$1 and active', [t.steam]);
      return res.json({ ok: true, steam: t.steam, count: r.rowCount });
    }

    res.status(400).json({ error: 'Неизвестное действие' });
  }));

  return {
    // синхронизация срока VIP с плагином: вызывается при каждой выдаче VIP на сайте (за монеты)
    setUntil: (steam, untilMs) => db.query(
      `insert into cs2_vip(steam_id, tier, until, model) values ($1,'vip',$2,$3)
       on conflict (steam_id) do update set until=excluded.until, model=excluded.model`,
      [steam, Math.min(+untilMs || 0, CAP_UNTIL), opts.vipModel || null])
  };
}

module.exports = { site };
