// Discord-бот: те же команды, что в Telegram-боте и на сайте (commands.js).
// Команды — слеш-команды (/help, /bonus …). Ответы видны только тому, кто их вызвал (ephemeral).
// Текстовые команды с «!» тоже работают: ответ уходит в личные сообщения вызвавшему.
// Нужно: DISCORD_BOT_TOKEN, DISCORD_OWNER_IDS. Бот приглашается с областями bot и applications.commands.

const a2s = require('./a2s');

let db = null, commands = null, ready = null, client = null, runTg = null, tgNames = null, D = null;
let live = null;              // закреплённый список серверов: { channel, message, timer, last }
const LIST_EVERY = 5000;      // обновление списка, мс
const CHUNK = 1900;           // лимит Discord — 2000 символов на сообщение
const chunks = t => { const out = []; for (let i = 0; i < t.length; i += CHUNK) out.push(t.slice(i, i + CHUNK)); return out.length ? out : ['…']; };

const DESC = {
  help: 'Список команд',
  servers: 'Серверы и онлайн',
  call: 'Позвонить игроку на сайте (ник)',
  glent: 'Взрывы на сайте на 24 часа (владельцы)',
  link: 'Код привязки Discord к аккаунту сайта',
  list: 'Закрепить список серверов в этом канале (владельцы)',
  unlist: 'Остановить закреплённый список (владельцы)'
};

// опции слеш-команд; остальным команды дают одну необязательную строку args
const OPTS = {};

// код привязки: /link → код DS-XXXXXXXX → вводится на сайте в окне промокода
async function makeCode(discordId) {
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
  if (!r.rowCount) return { ok: false, error: 'Код привязки неверный или просрочен — отправьте /link ещё раз' };
  await db.query('delete from dc_links where steam_id=$1', [steamId]);
  await db.query('insert into dc_links(discord_id, steam_id, at) values($1,$2,$3) on conflict (discord_id) do update set steam_id=excluded.steam_id, at=excluded.at', [r.rows[0].discord_id, steamId, Date.now()]);
  return { ok: true, msg: 'Discord привязан. Команды бота теперь работают с вашим аккаунтом.' };
}

// --- общая обработка команды: ctx = { id, displayName, isDM, channel, guild, send(text) } — send отвечает только вызвавшему ---
async function handleCore(ctx, text) {
  const name = text.split(/\s+/)[0].slice(1).split('@')[0].toLowerCase();

  if (name === 'list' || name === 'unlist') {
    if (!commands.isOwnerDc(ctx.id)) return { text: 'Нет доступа' };
    if (name === 'unlist') { await stopList(); return { text: 'Список серверов остановлен и откреплён.' }; }
    if (!ctx.channel || ctx.isDM) return { text: 'Эта команда работает в канале сервера.' };
    return startList(ctx.channel);
  }

  if (name === 'link') {
    const code = await makeCode(ctx.id);
    return { text: `🔗 Код привязки: ${code}\n\nОткройте сайт → окно промокода → введите этот код. Код действует 15 минут.` };
  }

  const link = (await db.query('select steam_id from dc_links where discord_id=$1', [ctx.id])).rows[0];
  const out = await commands.run({ platform: 'dc', discordId: ctx.id, steam: link ? link.steam_id : null, text });
  if (out) return out;
  // остальные команды — из Telegram-бота: он сам пишет ответы через send
  const args = text.replace(/^\/\S+\s*/, '');
  const sent = runTg && await runTg({ discordId: ctx.id, name, args, reply: t => ctx.send(t) });
  if (sent) return { sent: true };
  return { text: 'Такой команды нет. Напишите /help — список команд.' };
}

// --- ответы: слеш-команды — ephemeral (видно только вызвавшему); текстовые «!» — в личку ---
async function sendEphemeral(interaction, text) {
  for (const p of chunks(String(text))) await interaction.followUp({ content: p, ephemeral: true }).catch(e => console.error('discord followUp:', e.message));
}

async function sendDM(msg, text) {
  for (const p of chunks(String(text))) {
    try { await msg.author.send({ content: p }); }
    catch (e) {
      console.error('discord dm:', e.message);
      await msg.reply({ content: 'Не могу написать вам в личку. Включите личные сообщения от участников сервера или используйте команду через / — ответ будет виден только вам.', allowedMentions: { repliedUser: false } }).catch(() => {});
      return;
    }
  }
}

// --- живой список серверов: закреплённое сообщение, которое редактируется каждые 5 секунд ---
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
    if (e.code === 10008) await stopList(); // сообщение удалили вручную
  }
}

function runLive(channel, message) {
  if (live && live.timer) clearInterval(live.timer);
  live = { channel, message, last: '', timer: null };
  live.timer = setInterval(tick, LIST_EVERY);
  tick();
}

async function startList(channel) {
  const message = await channel.send({ content: 'Загружаю список серверов…' });
  await message.pin().catch(e => console.error('discord pin (нужно право «Управлять сообщениями»):', e.message));
  await db.query(`insert into dc_list(id, channel_id, message_id) values (1,$1,$2)
    on conflict (id) do update set channel_id=excluded.channel_id, message_id=excluded.message_id`, [channel.id, message.id]);
  runLive(channel, message);
  return { text: 'Список серверов закреплён в этом канале и обновляется каждые 5 секунд.' };
}

async function stopList() {
  if (live && live.timer) clearInterval(live.timer);
  live = null;
  await db.query('delete from dc_list where id=1').catch(() => {});
}

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

// --- регистрация слеш-команд на всех серверах бота (видны сразу) ---
async function registerSlash() {
  const names = new Set([...Object.keys(DESC), ...(tgNames ? tgNames() : [])]);
  names.delete('start'); // меню Telegram с кнопками в Discord не нужно
  const defs = [...names].filter(n => /^[a-z0-9_-]{1,32}$/.test(n)).slice(0, 100).map(n => ({
    name: n,
    description: (DESC[n] || 'Команда Telegram-бота').slice(0, 100),
    options: OPTS[n] || [{ name: 'args', description: 'Аргументы (необязательно)', type: 3, required: false }]
  }));
  for (const g of client.guilds.cache.values()) {
    await g.commands.set(defs).catch(e => console.error('discord slash (нужна область applications.commands):', e.message));
  }
  console.log('Слеш-команд зарегистрировано:', defs.length);
}

function start(opts) {
  db = opts.db;
  runTg = opts.runTg || null;
  tgNames = opts.tgNames || null;
  ready = (async () => {
    await db.query('create table if not exists dc_links(discord_id text primary key, steam_id text not null, at bigint)');
    await db.query('create table if not exists dc_link_codes(code text primary key, discord_id text not null, at bigint not null)');
    await db.query('create table if not exists dc_list(id int primary key, channel_id text not null, message_id text not null)');
    await db.query('create table if not exists dc_settings(key text primary key, value text not null)');
    commands = require('./commands').create({ db, glentToggle: opts.glentToggle, callStart: opts.callStart });
  })().catch(e => console.error('discord init:', e.message));

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) { console.log('Discord: DISCORD_BOT_TOKEN не задан — бот выключен'); return; }
  let discord;
  try { discord = require('discord.js'); }
  catch (e) { console.error('discord.js не установлен — выполните npm install'); return; }
  const { Client, GatewayIntentBits, Partials } = discord;
  D = discord;

  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel]
  });

  client.once('ready', async c => {
    console.log('Discord бот запущен:', c.user.tag);
    await ready;
    await registerSlash().catch(e => console.error('discord register:', e.message));
    restoreList();
  });

  client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand()) return;
    try {
      await ready;
      await i.deferReply({ ephemeral: true });
      const ctx = { id: i.user.id, displayName: i.user.username, isDM: !i.guild, channel: i.channel, guild: i.guild, send: t => sendEphemeral(i, t) };
      const args = i.options.getString('args') || '';
      const text = '/' + i.commandName + (args ? ' ' + args : '');
      const out = await handleCore(ctx, text);
      if (!out.sent) await ctx.send(out.text);
    } catch (e) {
      console.error('discord slash:', e.message);
      const payload = { content: '❌ Ошибка, попробуйте позже', ephemeral: true };
      (i.deferred || i.replied ? i.followUp(payload) : i.reply(payload)).catch(() => {});
    }
  });

  // текстовые команды с «!»: ответ уходит в личку вызвавшему, в канале остаётся только закреплённый список
  client.on('messageCreate', async msg => {
    try {
      if (msg.author.bot) return;
      const raw = (msg.content || '').trim();
      if (!raw) return;
      const isDM = !msg.guild;
      // мост с сайтом: обычные сообщения из канала моста попадают в общий чат сайта
      const chatCh = process.env.DISCORD_CHAT_CHANNEL_ID;
      if (msg.guild && chatCh && msg.channel.id === chatCh && !raw.startsWith('!') && !raw.startsWith('/')) {
        await ready;
        const room = process.env.SITE_CHAT_CHANNEL_ID ? 'ch:' + process.env.SITE_CHAT_CHANNEL_ID : null;
        const files = [...msg.attachments.values()].map(a => a.url).join(' ');
        if (room) await db.query('insert into dc_messages(room, uid, text, reply_to, at) values ($1,$2,$3,$4,$5)', [room, 'dc', `${msg.author.username}: ${raw}${files ? ' ' + files : ''}`.slice(0, 1500), null, Date.now()]);
        return;
      }
      if (!raw.startsWith('!')) {
        if (isDM) await msg.reply({ content: 'Команды вводятся через /. Напишите /help — список команд.', allowedMentions: { repliedUser: false } });
        return; // в каналах на обычные сообщения не отвечаем
      }
      await ready;
      const text = '/' + raw.slice(1);
      // «!репорт» и «!тикет» обрабатывает бот поддержки — здесь молчим
      if (['репорт', 'тикет', 'report', 'ticket'].includes(text.split(/\s+/)[0].slice(1).toLowerCase())) return;
      console.log('discord cmd:', text.split(/\s+/)[0], 'от', msg.author.id, isDM ? '(личка)' : '(канал)');
      const ctx = { id: msg.author.id, displayName: msg.author.username, isDM, channel: msg.channel, guild: msg.guild, send: t => sendDM(msg, t) };
      const out = await handleCore(ctx, text);
      if (!out.sent) await ctx.send(out.text);
    } catch (e) {
      console.error('discord msg:', e.message);
    }
  });

  client.login(token).catch(e => console.error('discord login:', e.message));
}

// сообщения с сайта в Discord-канал моста (вызывается из messenger.js)
async function toDiscordChat({ author, text }) {
  const id = process.env.DISCORD_CHAT_CHANNEL_ID;
  if (!id || !client) return;
  const ch = await client.channels.fetch(id).catch(() => null);
  if (!ch) return;
  await ch.send({ content: `**${author}** (сайт): ${String(text)}`.slice(0, 1990), allowedMentions: { parse: [] } });
}

module.exports = { start, consumeCode, toDiscordChat };
