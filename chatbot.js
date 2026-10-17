// Бот чата: отдельный Discord-бот (DISCORD_CHATBOT_TOKEN) только для моста с сайтом.
// Читает сообщения из канала моста (DISCORD_CHAT_CHANNEL_ID) и пишет их в общий чат сайта
// с ником и аватаркой автора. Отправка с сайта в Discord идёт через вебхук (DISCORD_CHAT_WEBHOOK).
// Команды здесь не обрабатываются: их делает основной бот (DISCORD_BOT_TOKEN).

let db = null;

function start(opts) {
  db = opts.db;
  const token = process.env.DISCORD_CHATBOT_TOKEN;
  if (!token) { console.log('Бот чата: DISCORD_CHATBOT_TOKEN не задан — выключен'); return; }
  let discord;
  try { discord = require('discord.js'); }
  catch (e) { console.error('discord.js не установлен — выполните npm install'); return; }
  const { Client, GatewayIntentBits } = discord;

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
  });

  client.once('ready', c => console.log('Бот чата запущен:', c.user.tag));

  client.on('messageCreate', async msg => {
    try {
      if (msg.author.bot || !msg.guild) return;
      const chatCh = process.env.DISCORD_CHAT_CHANNEL_ID;
      if (!chatCh || msg.channel.id !== chatCh) return;
      console.log('chat bot: получено сообщение в канале моста');
      const text = (msg.content || '').trim();
      const files = [...msg.attachments.values()].map(a => a.url).join(' ');
      if (!text && !files) {
        console.log('chat bot: пустое сообщение (проверьте Message Content Intent)');
        return;
      }
      console.log('chat bot: сообщение из моста от', msg.author.username);
      const room = process.env.SITE_CHAT_CHANNEL_ID ? 'ch:' + process.env.SITE_CHAT_CHANNEL_ID : null;
      if (!room) return;
      const who = (msg.member?.displayName || msg.author.username || 'Discord').slice(0, 80);
      const ava = msg.author.displayAvatarURL({ extension: 'png', size: 64 });
      await db.query('insert into dc_messages(room, uid, text, reply_to, at, ext_name, ext_avatar) values ($1,$2,$3,$4,$5,$6,$7)',
        [room, 'dc', `${text}${files ? ' ' + files : ''}`.slice(0, 1500), null, Date.now(), who, ava]);
    } catch (e) {
      console.error('chat bot:', e.message);
    }
  });

  client.login(token).catch(e => console.error('chat bot login:', e.message));
}

module.exports = { start };
