// Discord-бот: те же команды, что в Telegram-боте и на сайте (commands.js).
// Работает и в личных сообщениях, и в каналах сервера. В каналах отвечает только на команды с «/».
// Нужно: DISCORD_BOT_TOKEN (и DISCORD_OWNER_IDS — Discord ID владельцев через запятую).
// Без токена файл ничего не запускает, сайт работает как раньше.

let db = null, commands = null, ready = null, client = null;

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
  if (name === 'link') {
    if (!isDM) return { text: 'Напишите мне в личные сообщения: /link (код нельзя показывать в канале).' };
    const code = await makeCode(id, msg.author.username);
    return { text: `🔗 Код привязки: ${code}\n\nОткройте сайт → окно промокода → введите этот код. Код действует 15 минут.` };
  }
  const link = (await db.query('select steam_id from dc_links where discord_id=$1', [id])).rows[0];
  const out = await commands.run({ platform: 'dc', discordId: id, steam: link ? link.steam_id : null, text });
  return out || { text: 'Такой команды нет. Напишите /help — список команд.' };
}

async function reply(msg, out) {
  const body = out.url ? `${out.text}\n${out.url}` : out.text;
  const parts = chunks(body);
  await msg.reply({ content: parts[0], allowedMentions: { repliedUser: false } });
  for (const p of parts.slice(1)) await msg.channel.send({ content: p });
}

function start(opts) {
  db = opts.db;
  ready = (async () => {
    await db.query('create table if not exists dc_links(discord_id text primary key, steam_id text not null, at bigint)');
    await db.query('create table if not exists dc_link_codes(code text primary key, discord_id text not null, at bigint not null)');
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
  client.once('ready', c => console.log('Discord бот запущен:', c.user.tag));
  client.on('messageCreate', async msg => {
    try {
      if (msg.author.bot) return;
      const text = (msg.content || '').trim();
      if (!text) return;
      const isDM = !msg.guild;
      if (!text.startsWith('/')) {
        if (isDM) await msg.reply({ content: 'Команды начинаются с «/». Напишите /help — список команд.', allowedMentions: { repliedUser: false } });
        return; // в каналах на обычные сообщения не отвечаем
      }
      await ready;
      const out = await handle(msg, text, isDM);
      await reply(msg, out);
    } catch (e) {
      console.error('discord msg:', e.message);
      msg.reply({ content: '❌ Ошибка, попробуйте позже', allowedMentions: { repliedUser: false } }).catch(() => {});
    }
  });
  client.login(token).catch(e => console.error('discord login:', e.message));
}

module.exports = { start, consumeCode };
