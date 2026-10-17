// Бот репортов — отдельный Discord-бот. Основной бот (discordbot.js) не меняется.
// /report ник причина → жалоба в приватный канал админов (кнопки «Рассмотрено» / «Отклонить») и в таблицу сайта cs2_reports.
// /reportchannel — владелец выполняет в приватном канале, чтобы назначить его каналом репортов.
// Привязка аккаунта общая: игрок делает /link в основном боте, код вводится на сайте.
// Нужно: DISCORD_REPORT_BOT_TOKEN. Владельцы — DISCORD_OWNER_IDS (как у основного бота).
// Без токена модуль ничего не запускает, а postReport пишет в лог.

const crypto = require('crypto');

let db = null, client = null, D = null, ready = null;
let channelId = null;                  // канал репортов (dc_settings: report_channel)
const cooldown = new Map();            // discord id -> время последней жалобы
const COOLDOWN_MS = 60000;
const CHUNK = 1900;
const chunks = t => { const out = []; for (let i = 0; i < t.length; i += CHUNK) out.push(t.slice(i, i + CHUNK)); return out.length ? out : ['…']; };
const isOwner = id => (process.env.DISCORD_OWNER_IDS || '').split(',').map(x => x.trim()).includes(String(id));

const DEFS = [
  { name: 'report', description: 'Пожаловаться на игрока — увидят только админы', options: [
    { name: 'target', description: 'На кого жалоба (ник или Steam ID)', type: 3, required: true },
    { name: 'reason', description: 'Причина', type: 3, required: true }] },
  { name: 'reportchannel', description: 'Сделать этот приватный канал чатом репортов (владельцы)', options: [] }
];

// --- общие функции ---
async function submitReport(ctx, target, reason) {
  if (!target || reason.length < 3) return 'Укажите ник и причину (причина — от 3 символов).';
  const link = (await db.query('select steam_id from dc_links where discord_id=$1', [ctx.id])).rows[0];
  if (!link) return 'Сначала привяжите аккаунт сайта: в основном боте напишите /link и введите код на сайте.';
  const now = Date.now();
  if (now - (cooldown.get(ctx.id) || 0) < COOLDOWN_MS) return 'Жалобу можно отправлять не чаще раза в минуту.';
  cooldown.set(ctx.id, now);

  const me = (await db.query('select name from users where steam_id=$1', [link.steam_id])).rows[0];
  const who = me ? me.name : ctx.displayName || ctx.id;
  // та же таблица, что у сайта: жалоба видна в админке сайта
  await db.query('insert into cs2_reports(reporter, reporter_name, target, reason, server, at) values ($1,$2,$3,$4,$5,$6)',
    [link.steam_id, who, target, reason, 'Discord', now]);

  const ch = channelId && await client.channels.fetch(channelId).catch(() => null);
  if (!ch) return '✅ Жалоба сохранена на сайте, но канал репортов ещё не настроен администратором.';

  const row = (await db.query(
    'insert into dc_reports(reporter_id, target, reason, status, channel_id, at) values($1,$2,$3,$4,$5,$6) returning id',
    [ctx.id, target, reason, 'open', ch.id, now])).rows[0];
  const embed = new D.EmbedBuilder().setTitle(`🚨 Репорт #${row.id}`).setColor(0xe74c3c)
    .addFields(
      { name: 'На кого', value: target.slice(0, 1024) },
      { name: 'Причина', value: reason.slice(0, 1024) },
      { name: 'От кого', value: `${who} (<@${ctx.id}>)`.slice(0, 1024) },
      { name: 'Статус', value: '🟡 Открыт' })
    .setTimestamp();
  const buttons = new D.ActionRowBuilder().addComponents(
    new D.ButtonBuilder().setCustomId(`rep:done:${row.id}`).setLabel('Рассмотрено').setStyle(D.ButtonStyle.Success),
    new D.ButtonBuilder().setCustomId(`rep:reject:${row.id}`).setLabel('Отклонить').setStyle(D.ButtonStyle.Danger));
  const msg = await ch.send({ embeds: [embed], components: [buttons], allowedMentions: { parse: [] } });
  await db.query('update dc_reports set message_id=$1 where id=$2', [msg.id, row.id]);
  return `✅ Жалоба #${row.id} отправлена администрации. Спасибо!`;
}

async function handleButton(i) {
  const [, action, id] = i.customId.split(':');
  const isAdmin = i.memberPermissions?.has(D.PermissionFlagsBits.ManageMessages) || isOwner(i.user.id);
  if (!isAdmin) return i.reply({ content: 'Менять статус жалобы могут только администраторы.', ephemeral: true });
  const status = action === 'done' ? 'closed' : 'rejected';
  const label = action === 'done' ? '✅ Рассмотрено' : '❌ Отклонено';
  const r = await db.query("update dc_reports set status=$1, handled_by=$2 where id=$3 and status='open' returning id", [status, i.user.id, id]);
  if (!r.rowCount) return i.reply({ content: 'Эта жалоба уже обработана.', ephemeral: true });
  const old = i.message.embeds[0];
  const embed = D.EmbedBuilder.from(old).setColor(action === 'done' ? 0x2ecc71 : 0x95a5a6)
    .setFields(old.fields.map(f => f.name === 'Статус' ? { name: 'Статус', value: `${label} (<@${i.user.id}>)` } : f));
  await i.update({ embeds: [embed], components: [] });
}

async function setChannel(i) {
  if (!isOwner(i.user.id)) return i.editReply({ content: 'Нет доступа.' });
  const ch = i.channel;
  if (!i.guild || !ch) return i.editReply({ content: 'Выполните эту команду в канале сервера.' });
  const P = D.PermissionFlagsBits;
  if (ch.permissionsFor(i.guild.roles.everyone)?.has(P.ViewChannel)) {
    return i.editReply({ content: '⚠️ Этот канал виден всем. Сделайте его приватным: Настройки канала → Права доступа → @everyone → «Просматривать канал» → Запретить, добавьте роли админов и повторите.' });
  }
  if (!ch.permissionsFor(client.user)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) {
    return i.editReply({ content: '⚠️ Боту репортов не хватает прав в этом канале: Просматривать канал, Отправлять сообщения, Встраивать ссылки.' });
  }
  await db.query(`insert into dc_settings(key, value) values ('report_channel', $1)
    on conflict (key) do update set value=excluded.value`, [ch.id]);
  channelId = ch.id;
  return i.editReply({ content: '✅ Этот канал теперь канал репортов.' });
}

// жалобы с сайта: текст уходит в канал репортов (вызывается из server.js)
async function postReport(text) {
  if (!client || !channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    for (const p of chunks(String(text))) await channel.send({ content: p });
  } catch (e) { console.error('report bot post:', e.message); }
}

async function registerSlash() {
  for (const g of client.guilds.cache.values()) {
    await g.commands.set(DEFS).catch(e => console.error('report bot slash (нужна область applications.commands):', e.message));
  }
  console.log('Команды бота репортов зарегистрированы');
}

function start(opts) {
  db = opts.db;
  ready = (async () => {
    await db.query(`create table if not exists dc_reports(id bigserial primary key, reporter_id text not null, target text not null,
      reason text not null, status text not null, channel_id text, message_id text, handled_by text, at bigint not null)`);
    await db.query('create table if not exists dc_settings(key text primary key, value text not null)');
    channelId = (await db.query("select value from dc_settings where key='report_channel'")).rows[0]?.value || null;
  })().catch(e => console.error('report bot init:', e.message));

  const token = process.env.DISCORD_REPORT_BOT_TOKEN;
  if (!token) { console.log('Бот репортов: DISCORD_REPORT_BOT_TOKEN не задан — выключен'); return; }
  let discord;
  try { discord = require('discord.js'); }
  catch (e) { console.error('discord.js не установлен — выполните npm install'); return; }
  const { Client, GatewayIntentBits } = discord;
  D = discord;
  client = new Client({ intents: [GatewayIntentBits.Guilds] }); // слеш-командам и кнопкам текст сообщений не нужен

  client.once('ready', async c => {
    console.log('Бот репортов запущен:', c.user.tag);
    await ready;
    await registerSlash().catch(e => console.error('report bot register:', e.message));
  });

  client.on('interactionCreate', async i => {
    try {
      await ready;
      if (i.isButton() && i.customId.startsWith('rep:')) return await handleButton(i);
      if (!i.isChatInputCommand()) return;
      await i.deferReply({ ephemeral: true });
      if (i.commandName === 'report') {
        const target = (i.options.getString('target') || '').trim().slice(0, 100);
        const reason = (i.options.getString('reason') || '').trim().slice(0, 500);
        return i.editReply({ content: await submitReport({ id: i.user.id, displayName: i.user.username }, target, reason) });
      }
      if (i.commandName === 'reportchannel') return await setChannel(i);
    } catch (e) {
      console.error('report bot:', e.message);
      const payload = { content: '❌ Ошибка, попробуйте позже', ephemeral: true };
      (i.deferred || i.replied ? i.followUp(payload) : i.reply(payload)).catch(() => {});
    }
  });

  client.login(token).catch(e => console.error('report bot login:', e.message));
}

module.exports = { start, postReport };
