// CS2: API для плагина VipReport (CounterStrikeSharp).
// Плагин на сервере CS2 спрашивает статус игрока (випка, бан) и присылает жалобы.
// Ключ сервера — в переменной окружения CS2_SERVER_KEY (тот же ключ в config.json плагина).
const crypto = require('crypto');

const REPORT_COOLDOWN_MS = 60 * 1000;
const reportCooldown = new Map(); // steam id игрока -> время последней жалобы

function keyOk(req) {
  const want = process.env.CS2_SERVER_KEY || '';
  const got = String(req.headers['x-server-key'] || '');
  if (!want || want.length !== got.length) return false;
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
}

function site(app, db, opts = {}) {
  const notify = opts.notify || (() => {});
  // проверка бана: подключите сюда свою таблицу банов; пока всегда «не забанен»
  const isBanned = opts.isBanned || (async () => false);

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

  // GET /api/cs2/check?steam=76561198...  → { banned, vip: { tier, until, model } | null }
  app.get('/api/cs2/check', wrap(async (req, res) => {
    if (!keyOk(req)) return res.status(401).json({ error: 'Неверный ключ сервера' });
    const steam = String(req.query.steam || '');
    if (!/^\d{17}$/.test(steam)) return res.status(400).json({ error: 'Нужен SteamID64' });
    const banned = !!(await isBanned(steam));
    const row = (await db.query('select tier, until, model from cs2_vip where steam_id=$1 and until > $2',
      [steam, Date.now()])).rows[0];
    res.json({
      banned,
      vip: row ? { tier: row.tier, until: +row.until, model: row.model || null } : null
    });
  }));

  // POST /api/cs2/report  { reporter, reporterName, target, reason, server }
  app.post('/api/cs2/report', wrap(async (req, res) => {
    if (!keyOk(req)) return res.status(401).json({ error: 'Неверный ключ сервера' });
    const b = req.body || {};
    const reporter = String(b.reporter || '');
    const target = String(b.target || '').slice(0, 64);
    const reason = String(b.reason || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const reporterName = String(b.reporterName || '').slice(0, 64);
    const server = String(b.server || '').slice(0, 64);
    if (!/^\d{17}$/.test(reporter)) return res.status(400).json({ error: 'Нужен SteamID64 отправителя' });
    if (!target || !reason) return res.status(400).json({ error: 'Укажите ник и причину' });
    if (target.toLowerCase() === reporterName.toLowerCase()) return res.status(400).json({ error: 'Нельзя жаловаться на себя' });
    const now = Date.now();
    const last = reportCooldown.get(reporter) || 0;
    if (now - last < REPORT_COOLDOWN_MS) {
      return res.status(429).json({ error: `Жалобу можно отправлять раз в ${REPORT_COOLDOWN_MS / 1000} сек.` });
    }
    reportCooldown.set(reporter, now);
    await db.query('insert into cs2_reports(reporter, reporter_name, target, reason, server, at) values ($1,$2,$3,$4,$5,$6)',
      [reporter, reporterName, target, reason, server, now]);
    try { await notify(`🚨 Жалоба на сервере ${server || 'CS2'}\nОт: ${reporterName || reporter}\nНа: ${target}\nПричина: ${reason}`); }
    catch (e) { console.error('cs2 report notify:', e.message); }
    res.json({ ok: true });
  }));

  // Выдача випки вручную (для админки на сайте): until — дата окончания в миллисекундах
  return {
    grantVip: (steam, tier, until, model) => db.query(
      `insert into cs2_vip(steam_id, tier, until, model) values ($1,$2,$3,$4)
       on conflict (steam_id) do update set tier=excluded.tier, until=excluded.until, model=excluded.model`,
      [steam, tier, until, model || null])
  };
}

module.exports = { site };
