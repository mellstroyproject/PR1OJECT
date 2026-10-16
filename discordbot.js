// Discord-бот: те же команды, что в Telegram-боте и на сайте (commands.js).
// Работает и в личных сообщениях, и в каналах сервера. В каналах отвечает только на команды с «/».
// Нужно: DISCORD_BOT_TOKEN (и DISCORD_OWNER_IDS — Discord ID владельцев через запятую).
// Без токена файл ничего не запускает, сайт работает как раньше.

const a2s = require('./a2s');

let db = null, commands = null, ready = null, client = null, runTg = null;
let live = null; // закреплённый список серверов: { channel, message, timer, last }
const LIST_EVERY = 5000; // обновление списка, мс

const CHUNK = 1900; // лимит Discord — 2000 символов на сообщение
const chunks = t => { const out = []; for (let i = 0; i < t.length; i += CHUNK) out.push(t.slice(i, i + CHUNK)); return out.length ? out : ['…']; };

// код привязки: /link в личке → код DS-XXXXXXXX → вводится на сайте в окне промокода (как и Telegram-код TG-)
async function makeCode(discordId, name) {
  const code = 'DS-' + require('crypto').randomBytes(4).toString('hex').toUpperCase();
  await db.query('delete from dc_link_codes where discord_id=$1 or at<$2', [discordId, Date.now() - 9e5]);
  await db.query('insert into dc_link_codes(code, discord_id, at) values($1,$2,$3)', [code, discordId, Date.now()]);
  return code;
}

// вызывается из server.js, когда на сайте введён код DS-…
async function consumeCode(code, steamId) {
  if (!ready) return { ok: false, error: 'Discord-бот не подключён' };
  await ready;
  const r = await db.query('delete from dc_link_codes where code=$1 and at>$2 returning discord_id', [code, Date.now() - 9e5]);
  if (!r.rowCount) return { ok: false, error: 'Код привязки неверный или просрочен — напишите боту /link ещё раз' };
  await db.query('delete from dc_links where steam_id=$1', [steamId]);
  await db.query('insert into dc_links(discord_id, steam_id, at) values($1,$2,$3) on conflict (discord_id) do update set steam_id=excluded.steam_id, at=excluded.at', [r.rows[0].discord_id, steamId, Date.now()]);
  return { ok: true, msg: 'Discord привязан. Команды бота теперь работают с вашим аккаунтом.' };
}

async function handle(msg, text, isDM) {
  const id = msg.author.id;
  const name = text.split(/\s+/)[0].slice(1).split('@')[0].toLowerCase();
  if (name === 'list' || name === 'unlist') {
    if (!commands.isOwnerDc(id)) return { text: 'Нет доступа' };
    if (isDM) return { text: 'Эта команда работает в канале сервера, где нужен список.' };
    if (name === 'unlist') { await stopList(); return { text: 'Список серверов остановлен и откреплён.' }; }
    return startList(msg);
  }
  if (name === 'link') {
    if (!isDM) return { text: 'Напишите мне в личные сообщения: /link (код нельзя показывать в канале).' };
    const code = await makeCode(id, msg.author.username);
    return { text: `🔗 Код привязки: ${code}\n\nОткройте сайт → окно промокода → введите этот код. Код действует 15 минут.` };
  }
  const link = (await db.query('select steam_id from dc_links where discord_id=$1', [id])).rows[0];
  const out = await commands.run({ platform: 'dc', discordId: id, steam: link ? link.steam_id : null, text });
  if (out) return out;
  // остальные команды — из Telegram-бота: ответы пишутся сами, поэтому возвращаем признак «уже отправлено»
  const args = text.replace(/^\/\S+\s*/, '');
  const sent = runTg && await runTg({ discordId: id, name, args, reply: t => sendText(msg, t) });
  if (sent) return { sent: true };
  return { text: 'Такой команды нет. Напишите !help — список команд.' };
}

async function sendText(msg, text) {
  for (const p of chunks(String(text))) await msg.channel.send({ content: p }).catch(e => console.error('discord send:', e.message));
}

async function reply(msg, out) {
  const body = out.url ? `${out.text}\n${out.url}` : out.text;
  const parts = chunks(body);
  try { await msg.reply({ content: parts[0], allowedMentions: { repliedUser: false } }); }
  catch (e) { console.error('discord reply:', e.message); await msg.channel.send({ content: parts[0] }).catch(err => console.error('discord send:', err.message)); }
  for (const p of parts.slice(1)) await msg.channel.send({ content: p }).catch(() => {});
}

// --- живой список серверов: один закреплённый message, который редактируется каждые 5 секунд ---
async function fetchServers() {
  const rows = (await db.query('select id, name, address from servers order by id')).rows;
  return Promise.all(rows.map(async s => {
    try {
      const [host, port] = String(s.address).split(':');
      const info = await a2s.query(host, +port || 27015, 2000);
      return { ...s, online: true, players: info.players, max: info.maxPlayers, map: info.map };
    } catch (e) { return { ...s, online: false }; }
  }));
}

function renderList(rows) {
  const lines = rows.map(r => r.online
    ? `🟢 **${r.name}** — ${r.players}/${r.max}${r.map ? ` · ${r.map}` : ''}\n\`${r.address}\``
    : `⚪ **${r.name}** — не отвечает\n\`${r.address}\``);
  const time = new Date(Date.now() + 3 * 36e5).toISOString().slice(11, 19); // МСК
  const body = `🖥 **Серверы** (обновляется каждые 5 сек.)\n\n` + (lines.join('\n\n') || 'Список серверов пуст.') + `\n\n🕒 обновлено ${time} МСК`;
  return body.length > 1990 ? body.slice(0, 1990) + '…' : body;
}

async function tick() {
  if (!live) return;
  try {
    const text = renderList(await fetchServers());
    await live.message.edit({ content: text });
    live.last = text;
  } catch (e) {
    console.error('discord list tick:', e.message);
    if (e.code === 10008) { // сообщение удалили вручную: останавливаемся, пока не запустят !list заново
      await stopList();
    }
  }
}

function runLive(channel, message) {
  if (live && live.timer) clearInterval(live.timer);
  live = { channel, message, last: '', timer: null };
  live.timer = setInterval(tick, LIST_EVERY);
  tick();
}

async function startList(msg) {
  const message = await msg.channel.send({ content: 'Загружаю список серверов…' });
  await message.pin().catch(e => console.error('discord pin (нужно право «Управлять сообщениями»):', e.message));
  await db.query(`insert into dc_list(id, channel_id, message_id) values (1,$1,$2)
    on conflict (id) do update set channel_id=excluded.channel_id, message_id=excluded.message_id`, [msg.channel.id, message.id]);
  runLive(msg.channel, message);
  return { text: 'Список серверов закреплён в этом канале и обновляется каждые 5 секунд.' };
}

async function stopList() {
  if (live && live.timer) clearInterval(live.timer);
  live = null;
  await db.query('delete from dc_list where id=1').catch(() => {});
}

// после перезапуска бота возвращаем список в тот же канал и на то же сообщение
async function restoreList() {
  const row = (await db.query('select channel_id, message_id from dc_list where id=1')).rows[0];
  if (!row) return;
  try {
    const channel = await client.channels.fetch(row.channel_id);
    const message = await channel.messages.fetch(row.message_id);
    runLive(channel, message);
    console.log('Список серверов восстановлен в канале', row.channel_id);
  } catch (e) { console.error('discord restore list:', e.message); }
}

function start(opts) {
  db = opts.db;
  runTg = opts.runTg || null;
  ready = (async () => {
    await db.query('create table if not exists dc_links(discord_id text primary key, steam_id text not null, at bigint)');
    await db.query('create table if not exists dc_link_codes(code text primary key, discord_id text not null, at bigint not null)');
    await db.query('create table if not exists dc_list(id int primary key, channel_id text not null, message_id text not null)');
    commands = require('./commands').create({ db, glentToggle: opts.glentToggle, callStart: opts.callStart });
  })().catch(e => console.error('discord init:', e.message));

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) { console.log('Discord: DISCORD_BOT_TOKEN не задан — бот выключен'); return; }
  let discord;
  try { discord = require('discord.js'); }
  catch (e) { console.error('discord.js не установлен — выполните npm install'); return; }
  const { Client, GatewayIntentBits, Partials } = discord;

  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel] // без этого личные сообщения не приходят
  });
  client.once('ready', async c => {
    console.log('Discord бот запущен:', c.user.tag);
    await ready;
    restoreList();
  });
  client.on('messageCreate', async msg => {
    try {
      if (msg.author.bot) return;
      const raw = (msg.content || '').trim();
      if (!raw) return;
      const isDM = !msg.guild;
      // в Discord команды пишутся с «!» (например !help): «/» Discord не отправляет без слеш-команд
      if (!raw.startsWith('!')) {
        if (isDM) await msg.reply({ content: 'Команды начинаются с «!». Напишите !help — список команд.', allowedMentions: { repliedUser: false } });
        return; // в каналах на обычные сообщения не отвечаем
      }
      const text = '/' + raw.slice(1); // внутри бота команды разбираются как в Telegram и на сайте
      await ready;
      console.log('discord cmd:', text.split(/\s+/)[0], 'от', msg.author.id, isDM ? '(личка)' : '(канал)');
      const out = await handle(msg, text, isDM);
      if (!out.sent) await reply(msg, out);
    } catch (e) {
      console.error('discord msg:', e.message);
      msg.reply({ content: '❌ Ошибка, попробуйте позже', allowedMentions: { repliedUser: false } }).catch(() => {});
    }
  });
  client.login(token).catch(e => console.error('discord login:', e.message));
}

module.exports = { start, consumeCode };
