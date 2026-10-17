// Бот поддержки Next Project: панель тикетов, тикеты и репорты через личные сообщения.
// • /panel — владелец публикует панель «Тикеты» в канале (кнопки: Создать тикет, Репорт, ссылки).
// • Создать тикет → бот пишет в личку, пользователь описывает проблему → тикет уходит в канал тикетов.
// • Репорт (кнопка или «!репорт») → выбор сервера → выбор игрока из списка сервера → причина →
//   карточка в канал репортов и запись в таблицу сайта cs2_reports.
// • /setchannel reports|tickets — владелец выполняет в приватном канале, чтобы назначить его.
// Нужно: DISCORD_REPORT_BOT_TOKEN, DISCORD_OWNER_IDS. Для текста из личных сообщений включите Message Content Intent.
// Опционально: TICKET_BANNER_URL, RULES_URL, STATUS_URL, DEV_URL — картинка панели и ссылки кнопок.

const a2s = require('./a2s');

let db = null, client = null, D = null, ready = null;
let reportChannelId = null;  // dc_settings: report_channel — канал репортов (админы)
let ticketChannelId = null;  // dc_settings: ticket_channel — канал тикетов (старшая администрация)
const cooldown = new Map();  // 'r:'+id / 't:'+id -> время последнего действия
const flows = new Map();     // user id -> { step, srv, players, ts } — шаги репорта
const awaitingTicket = new Map(); // user id -> ts — ждём текст тикета в личке
const COOLDOWN_MS = 60000, FLOW_TTL = 10 * 60000;
const BRAND = 'Next Project';
const CHUNK = 1900;
const chunks = t => { const out = []; for (let i = 0; i < t.length; i += CHUNK) out.push(t.slice(i, i + CHUNK)); return out.length ? out : ['…']; };
const isOwner = id => (process.env.DISCORD_OWNER_IDS || '').split(',').map(x => x.trim()).includes(String(id));
const fresh = ts => Date.now() - ts < FLOW_TTL;
const cdLeft = key => { const left = COOLDOWN_MS - (Date.now() - (cooldown.get(key) || 0)); return left > 0 ? Math.ceil(left / 1000) : 0; };

const DEFS = [
  { name: 'report', description: 'Пожаловаться на игрока — выбор сервера и игрока', options: [] },
  { name: 'setchannel', description: 'Назначить этот приватный канал для репортов или тикетов (владельцы)', options: [
    { name: 'kind', description: 'Что сюда присылать', type: 3, required: true,
      choices: [{ name: 'Репорты (админы)', value: 'reports' }, { name: 'Тикеты (старшая администрация)', value: 'tickets' }, { name: 'Панель с кнопками (канал создания тикетов)', value: 'panel' }] }] }
];

// --- настройка канала: закрыт для всех, бот видит и пишет ---
async function checkPrivate(ch, guild) {
  const P = D.PermissionFlagsBits;
  if (ch.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)) {
    return '⚠️ Этот канал виден всем. Сделайте его приватным: Настройки канала → Права доступа → @everyone → «Просматривать канал» → Запретить, добавьте роли админов и повторите.';
  }
  if (!ch.permissionsFor(client.user)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) {
    return '⚠️ Боту не хватает прав в этом канале: Просматривать канал, Отправлять сообщения, Встраивать ссылки.';
  }
  return null;
}

async function setChannel(i, kind) {
  if (!isOwner(i.user.id)) return i.editReply({ content: 'Нет доступа.' });
  if (!i.guild || !i.channel) return i.editReply({ content: 'Выполните эту команду в канале сервера.' });
  if (kind !== 'panel') {
    const problem = await checkPrivate(i.channel, i.guild);
    if (problem) return i.editReply({ content: problem });
  }
  const key = { tickets: 'ticket_channel', reports: 'report_channel', panel: 'panel_channel' }[kind];
  await db.query(`insert into dc_settings(key, value) values ($1, $2) on conflict (key) do update set value=excluded.value`, [key, i.channel.id]);
  if (kind === 'tickets') ticketChannelId = i.channel.id;
  if (kind === 'reports') reportChannelId = i.channel.id;
  if (kind === 'panel') await ensurePanel();
  const names = { tickets: 'тикетов', reports: 'репортов', panel: 'панели с кнопками' };
  const cur = Object.fromEntries((await db.query("select key, value from dc_settings where key in ('report_channel','ticket_channel','panel_channel')")).rows.map(r => [r.key, r.value]));
  const line = (label, id) => `${label}: ${id ? `<#${id}>` : 'не назначен'}`;
  const sameWarn = cur.report_channel && cur.report_channel === cur.ticket_channel
    ? '\n⚠️ Репорты и тикеты настроены на один канал. Назначьте разные каналы, если нужно их разделить.' : '';
  return i.editReply({ content: `✅ Этот канал теперь канал ${names[kind]}.\n\n${line('Репорты', cur.report_channel)}\n${line('Тикеты', cur.ticket_channel)}\n${line('Панель', cur.panel_channel)}${sameWarn}` });
}

// --- панель публикуется сама: в канале создания тикетов, без команд ---
// Канал: из настройки panel_channel, иначе ищем текстовый канал с «тикет» в названии (например «создать-тикет»).
// Сообщение с кнопками закрепляется; при перезапуске или удалении бот восстанавливает его сам.
async function findPanelChannel() {
  const saved = (await db.query("select value from dc_settings where key='panel_channel'")).rows[0]?.value;
  if (saved) return client.channels.fetch(saved).catch(() => null);
  for (const g of client.guilds.cache.values()) {
    const ch = g.channels.cache.find(c => c.type === D.ChannelType.GuildText && /тикет|ticket/i.test(c.name));
    if (ch) return ch;
  }
  return null;
}

async function ensurePanel() {
  try {
    const ch = await findPanelChannel();
    if (!ch) return;
    const payload = panelPayload();
    const stored = (await db.query("select value from dc_settings where key='panel_message'")).rows[0]?.value; // формат channelId:messageId
    const [sChan, sMsg] = stored ? stored.split(':') : [];
    if (sChan === ch.id && sMsg) {
      const old = await ch.messages.fetch(sMsg).catch(() => null);
      if (old) { await old.edit(payload); return; }
    }
    const msg = await ch.send(payload);
    await msg.pin().catch(() => {});
    await db.query(`insert into dc_settings(key, value) values ('panel_message', $1)
      on conflict (key) do update set value=excluded.value`, [`${ch.id}:${msg.id}`]);
    console.log('Панель тикетов опубликована в канале', ch.name);
  } catch (e) { console.error('panel:', e.message); }
}

// --- панель «Тикеты» ---
function panelPayload() {
  const embed = new D.EmbedBuilder().setTitle('Тикеты').setColor(0x5865f2)
    .setDescription('📌 Чтобы создать обращение, нажмите на кнопку ниже. Вы перейдёте в личные сообщения с ботом — опишите проблему, и тикет будет создан автоматически после отправки сообщения.\n\n📌 Чтобы пожаловаться на игрока, нажмите «Репорт» или напишите боту в личку `!репорт`.')
    .setFooter({ text: BRAND });
  if (process.env.TICKET_BANNER_URL) embed.setImage(process.env.TICKET_BANNER_URL);
  const row = new D.ActionRowBuilder().addComponents(
    new D.ButtonBuilder().setCustomId('tk:create').setLabel('Создать тикет').setStyle(D.ButtonStyle.Primary),
    new D.ButtonBuilder().setCustomId('rp:start').setLabel('Репорт').setStyle(D.ButtonStyle.Secondary));
  const links = [['Правила', process.env.RULES_URL], ['Статус', process.env.STATUS_URL], ['Телеграм', process.env.DEV_URL]]
    .filter(([, url]) => url).map(([label, url]) => new D.ButtonBuilder().setLabel(label).setURL(url).setStyle(D.ButtonStyle.Link));
  const rows = [row];
  if (links.length) rows[0].addComponents(...links.slice(0, 3));
  return { embeds: [embed], components: rows };
}

// --- выбор сервера и игрока ---
async function serverMenu() {
  const rows = (await db.query('select id, name from servers order by id limit 25')).rows;
  if (!rows.length) return null;
  return { content: 'Выберите сервер, на котором был игрок:', components: [new D.ActionRowBuilder().addComponents(
    new D.StringSelectMenuBuilder().setCustomId('rp:srv').setPlaceholder('Сервер')
      .addOptions(rows.map(r => ({ label: r.name.slice(0, 100), value: String(r.id) }))))] };
}

async function playerMenu(userId, srv) {
  let list = [];
  try { list = (await a2s.players(srv.host, srv.port, 2500)).filter(p => p.name && p.name !== '(без ника)'); }
  catch (e) { return { content: `❌ Сервер «${srv.name}» сейчас не отвечает. Попробуйте позже.`, components: [] }; }
  if (!list.length) return { content: `На сервере «${srv.name}» сейчас никого нет.`, components: [] };
  flows.set(userId, { step: 'player', srv, players: list.slice(0, 25), ts: Date.now() });
  return { content: `Сервер: **${srv.name}**. Выберите игрока:`, components: [new D.ActionRowBuilder().addComponents(
    new D.StringSelectMenuBuilder().setCustomId('rp:pl').setPlaceholder('Игрок')
      .addOptions(list.slice(0, 25).map((p, idx) => ({ label: p.name.slice(0, 100), description: `${p.time ? Math.floor(p.time / 60) + ' мин. на сервере' : ''}`.slice(0, 100) || undefined, value: String(idx) }))))] };
}

async function startReport(i) {
  const link = (await db.query('select steam_id from dc_links where discord_id=$1', [i.user.id])).rows[0];
  if (!link) return { content: 'Сначала привяжите аккаунт сайта: в основном боте напишите /link и введите код на сайте.' };
  const menu = await serverMenu();
  if (!menu) return { content: 'Список серверов пуст.' };
  flows.set(i.user.id, { step: 'server', ts: Date.now() });
  return menu;
}

// --- сохранение жалобы: админ-канал, сайт ---
async function submitReport(user, srv, target, reason) {
  const link = (await db.query('select steam_id from dc_links where discord_id=$1', [user.id])).rows[0];
  if (!link) return 'Сначала привяжите аккаунт сайта: /link.';
  if (cdLeft('r:' + user.id)) return `Жалобу можно отправить через ${cdLeft('r:' + user.id)} сек.`;
  cooldown.set('r:' + user.id, Date.now());
  const now = Date.now();
  const me = (await db.query('select name from users where steam_id=$1', [link.steam_id])).rows[0];
  const who = me ? me.name : user.username || user.id;
  await db.query('insert into cs2_reports(reporter, reporter_name, target, reason, server, at) values ($1,$2,$3,$4,$5,$6)',
    [link.steam_id, who, target, reason, srv.name, now]);
  const ch = reportChannelId && await client.channels.fetch(reportChannelId).catch(() => null);
  if (!ch) return '✅ Жалоба сохранена на сайте, но канал репортов ещё не настроен.';
  const row = (await db.query(
    "insert into dc_reports(kind, reporter_id, target, reason, status, channel_id, at) values('report',$1,$2,$3,'open',$4,$5) returning id",
    [user.id, target, reason, ch.id, now])).rows[0];
  const embed = new D.EmbedBuilder().setTitle(`🚨 Репорт #${row.id}`).setColor(0xe74c3c)
    .addFields(
      { name: 'Сервер', value: srv.name.slice(0, 1024) },
      { name: 'На кого', value: target.slice(0, 1024) },
      { name: 'Причина', value: reason.slice(0, 1024) },
      { name: 'От кого', value: `${who} (<@${user.id}>)`.slice(0, 1024) },
      { name: 'Статус', value: '🟡 Открыт' })
    .setFooter({ text: BRAND }).setTimestamp();
  const buttons = new D.ActionRowBuilder().addComponents(
    new D.ButtonBuilder().setCustomId(`rep:done:${row.id}`).setLabel('Рассмотрено').setStyle(D.ButtonStyle.Success),
    new D.ButtonBuilder().setCustomId(`rep:reject:${row.id}`).setLabel('Отклонить').setStyle(D.ButtonStyle.Danger));
  const msg = await ch.send({ embeds: [embed], components: [buttons], allowedMentions: { parse: [] } });
  await db.query('update dc_reports set message_id=$1 where id=$2', [msg.id, row.id]);
  return `✅ Жалоба #${row.id} на **${target}** отправлена администрации. Спасибо!`;
}

// --- переписка по тикету ---
const mskTime = () => { const d = new Date(Date.now() + 3 * 36e5); const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const roleOf = msg => { const r = msg.member?.roles?.highest; return r && r.name !== '@everyone' ? r.name : 'Администрация'; };
const attachText = msg => msg.attachments?.size ? '\n' + [...msg.attachments.values()].map(a => a.url).join('\n') : '';

// открытый тикет пользователя (только один одновременно)
async function openTicketOf(userId) {
  return (await db.query("select id, thread_id from dc_reports where reporter_id=$1 and kind='ticket' and status='open' order by id desc limit 1", [userId])).rows[0] || null;
}

// ответ администратора в треде → личное сообщение игроку
async function relayToPlayer(msg, ticket) {
  const owner = await client.users.fetch(ticket.reporter_id).catch(() => null);
  if (!owner) return msg.react('⚠️').catch(() => {});
  const embed = new D.EmbedBuilder().setColor(0x5865f2)
    .setAuthor({ name: msg.member?.displayName || msg.author.username, iconURL: msg.author.displayAvatarURL() })
    .setDescription((msg.content || '').slice(0, 3500) + attachText(msg))
    .setFooter({ text: `${roleOf(msg)} • ${mskTime()}` });
  try { await owner.send({ embeds: [embed] }); msg.react('✅').catch(() => {}); }
  catch (e) { msg.react('⚠️').catch(() => {}); }
}

// сообщение игрока → тред тикета (или карточка тикета, если тред ещё не создан)
async function relayToStaff(msg, ticket) {
  const target = ticket.thread_id ? await client.channels.fetch(ticket.thread_id).catch(() => null)
    : await client.channels.fetch(ticketChannelId).catch(() => null);
  if (!target) return msg.reply({ content: 'Не удалось передать сообщение администрации, попробуйте позже.' }).catch(() => {});
  const embed = new D.EmbedBuilder().setColor(0x2b2d31)
    .setAuthor({ name: msg.author.username, iconURL: msg.author.displayAvatarURL() })
    .setDescription((msg.content || '').slice(0, 3500) + attachText(msg))
    .setFooter({ text: `Игрок • тикет #${ticket.id} • ${mskTime()}` });
  await target.send({ embeds: [embed], allowedMentions: { parse: [] } });
  msg.react('✅').catch(() => {});
}

// --- тикет: текст из личных сообщений → канал тикетов ---
async function submitTicket(user, text) {
  const existing = await openTicketOf(user.id);
  if (existing) return `У вас уже есть открытый тикет #${existing.id}. Пишите сюда, ответ придёт в этот же чат.`;
  if (cdLeft('t:' + user.id)) return `Новый тикет можно создать через ${cdLeft('t:' + user.id)} сек.`;
  const ch = ticketChannelId && await client.channels.fetch(ticketChannelId).catch(() => null);
  if (!ch) return 'Раздел тикетов ещё не настроен. Попробуйте позже.';
  cooldown.set('t:' + user.id, Date.now());
  const row = (await db.query(
    "insert into dc_reports(kind, reporter_id, target, reason, status, channel_id, at) values('ticket',$1,'—',$2,'open',$3,$4) returning id",
    [user.id, text, ch.id, Date.now()])).rows[0];
  const embed = new D.EmbedBuilder().setTitle(`🎫 Тикет #${row.id}`).setColor(0x5865f2)
    .addFields(
      { name: 'От кого', value: `${user.username} (<@${user.id}>)`.slice(0, 1024) },
      { name: 'Сообщение', value: text.slice(0, 1024) },
      { name: 'Статус', value: '🟡 Открыт' })
    .setFooter({ text: BRAND }).setTimestamp();
  const buttons = new D.ActionRowBuilder().addComponents(
    new D.ButtonBuilder().setCustomId(`tk:take:${row.id}`).setLabel('Принять').setStyle(D.ButtonStyle.Success),
    new D.ButtonBuilder().setCustomId(`tk:close:${row.id}`).setLabel('Закрыть').setStyle(D.ButtonStyle.Danger));
  const msg = await ch.send({ embeds: [embed], components: [buttons], allowedMentions: { parse: [] } });
  await db.query('update dc_reports set message_id=$1 where id=$2', [msg.id, row.id]);
  return `🎫 Тикет #${row.id} создан. Администрация ответит вам здесь, в личных сообщениях.`;
}

// --- кнопки админов ---
async function isAdminClick(i) {
  return i.memberPermissions?.has(D.PermissionFlagsBits.ManageMessages) || isOwner(i.user.id);
}

// ответ только нажавшему (после defer — через followUp)
const say = (i, content) => i.followUp({ content, ephemeral: true }).catch(() => {});

async function handleReportButton(i) {
  const [, action, id] = i.customId.split(':');
  if (!await isAdminClick(i)) return say(i, 'Менять статус могут только администраторы.');
  const status = action === 'done' ? 'closed' : 'rejected';
  const label = action === 'done' ? '✅ Рассмотрено' : '❌ Отклонено';
  const r = await db.query("update dc_reports set status=$1, handled_by=$2 where id=$3 and status='open' and kind='report' returning id", [status, i.user.id, id]);
  if (!r.rowCount) return say(i, 'Эта жалоба уже обработана.');
  const old = i.message.embeds[0];
  const embed = D.EmbedBuilder.from(old).setColor(action === 'done' ? 0x2ecc71 : 0x95a5a6)
    .setFields(old.fields.map(f => f.name === 'Статус' ? { name: 'Статус', value: `${label} (<@${i.user.id}>)` } : f));
  await i.editReply({ embeds: [embed], components: [] });
}

async function handleTicketButton(i) {
  const [, action, id] = i.customId.split(':');
  if (!await isAdminClick(i)) return say(i, 'Работать с тикетами могут только администраторы.');
  const row = (await db.query("select reporter_id, thread_id from dc_reports where id=$1 and kind='ticket' and status='open'", [id])).rows[0];
  if (!row) return say(i, 'Тикет не найден или уже закрыт.');
  const owner = await client.users.fetch(row.reporter_id).catch(() => null);
  const old = i.message.embeds[0];

  if (action === 'take') {
    if (row.thread_id) return say(i, 'Тикет уже принят.');
    const thread = await i.message.startThread({ name: `тикет-${id}`, autoArchiveDuration: 1440 });
    await db.query("update dc_reports set thread_id=$1, handled_by=$2 where id=$3", [thread.id, i.user.id, id]);
    const embed = D.EmbedBuilder.from(old).setColor(0x3ba55d)
      .setFields(old.fields.map(f => f.name === 'Статус' ? { name: 'Статус', value: `🟢 В работе (<@${i.user.id}>)` } : f));
    const buttons = new D.ActionRowBuilder().addComponents(
      new D.ButtonBuilder().setCustomId(`tk:close:${id}`).setLabel('Закрыть').setStyle(D.ButtonStyle.Danger));
    await i.editReply({ embeds: [embed], components: [buttons] });
    thread.send({ content: `✅ Тикет принят: <@${i.user.id}>. Пишите сюда, сообщения уйдут игроку в личные сообщения.` }).catch(() => {});
    if (owner) owner.send({ content: `✅ Ваш тикет #${id} принят администрацией. Ответы будут приходить сюда, в личные сообщения.` }).catch(() => {});
    return;
  }

  // закрытие: статус, тред в архив, уведомление игроку
  await db.query("update dc_reports set status='closed', handled_by=$1 where id=$2", [i.user.id, id]);
  const embed = D.EmbedBuilder.from(old).setColor(0x95a5a6)
    .setFields(old.fields.map(f => f.name === 'Статус' ? { name: 'Статус', value: `🔒 Закрыт (<@${i.user.id}>)` } : f));
  await i.editReply({ embeds: [embed], components: [] });
  if (row.thread_id) {
    const thread = await client.channels.fetch(row.thread_id).catch(() => null);
    if (thread) { await thread.send('🔒 Тикет закрыт.').catch(() => {}); await thread.setArchived(true).catch(() => {}); }
  }
  if (owner) owner.send({ content: `🔒 Ваш тикет #${id} закрыт администрацией. Если вопрос остался, создайте новый тикет.` }).catch(() => {});
}

// --- жалобы с сайта: текст уходит в канал репортов (вызывается из server.js) ---
async function postReport(text) {
  if (!client || !reportChannelId) return;
  try {
    const channel = await client.channels.fetch(reportChannelId);
    for (const p of chunks(String(text))) await channel.send({ content: p });
  } catch (e) { console.error('report bot post:', e.message); }
}

async function registerSlash() {
  for (const g of client.guilds.cache.values()) {
    await g.commands.set(DEFS).catch(e => console.error('report bot slash (нужна область applications.commands):', e.message));
  }
  console.log('Команды бота поддержки зарегистрированы');
}

// --- обработка «!репорт» и «!тикет» (личка или канал) ---
async function handleText(msg) {
  const cmd = msg.content.trim().toLowerCase();
  const isDM = !msg.guild;
  if (cmd === '!репорт' || cmd === '!report') {
    const r = await startReport({ user: msg.author });
    return sendOrDM(msg, isDM, r);
  }
  if (cmd === '!тикет' || cmd === '!ticket') {
    if (!isDM) return sendOrDM(msg, false, { content: 'Тикет создаётся в личных сообщениях с ботом.' });
    awaitingTicket.set(msg.author.id, Date.now());
    return msg.reply({ embeds: [ticketPrompt()], allowedMentions: { repliedUser: false } });
  }
}

function ticketPrompt() {
  return new D.EmbedBuilder().setTitle('🎫 Создание тикета')
    .setDescription('📌 Опишите вашу проблему в этом чате, и тикет будет создан автоматически.\n\nПожалуйста, предоставьте максимально подробную информацию о вашей проблеме.')
    .setFooter({ text: BRAND });
}

// в личке отвечаем сюда; в канале — в личку вызвавшему, без публичного ответа
async function sendOrDM(msg, isDM, payload) {
  if (!payload) return;
  if (isDM) return msg.reply({ ...payload, allowedMentions: { repliedUser: false } });
  try { await msg.author.send(payload); }
  catch (e) { await msg.reply({ content: 'Не могу написать вам в личку. Включите личные сообщения от участников сервера и повторите.', allowedMentions: { repliedUser: false } }).catch(() => {}); }
}

function start(opts) {
  db = opts.db;
  ready = (async () => {
    await db.query(`create table if not exists dc_reports(id bigserial primary key, reporter_id text not null, target text not null,
      reason text not null, status text not null, channel_id text, message_id text, handled_by text, at bigint not null)`);
    await db.query("alter table dc_reports add column if not exists kind text not null default 'report'");
    await db.query('alter table dc_reports add column if not exists thread_id text');
    await db.query('create table if not exists dc_settings(key text primary key, value text not null)');
    const rows = (await db.query("select key, value from dc_settings where key in ('report_channel','ticket_channel')")).rows;
    reportChannelId = rows.find(r => r.key === 'report_channel')?.value || null;
    ticketChannelId = rows.find(r => r.key === 'ticket_channel')?.value || null;
  })().catch(e => console.error('report bot init:', e.message));

  const token = process.env.DISCORD_REPORT_BOT_TOKEN;
  if (!token) { console.log('Бот поддержки: DISCORD_REPORT_BOT_TOKEN не задан — выключен'); return; }
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
    console.log('Бот поддержки запущен:', c.user.tag);
    await ready;
    await registerSlash().catch(e => console.error('report bot register:', e.message));
    await ensurePanel();
    setInterval(ensurePanel, 10 * 60000);
  });

  client.on('interactionCreate', async i => {
    try {
      await ready;
      // --- слеш-команды ---
      if (i.isChatInputCommand()) {
        if (i.commandName === 'setchannel') {
          await i.deferReply({ ephemeral: true });
          return setChannel(i, i.options.getString('kind'));
        }
        if (i.commandName === 'report') {
          const r = await startReport(i);
          return i.reply({ ...r, ephemeral: true });
        }
        return;
      }
      // --- кнопки ---
      if (i.isButton()) {
        // Discord ждёт ответ не дольше 3 секунд: сначала подтверждаем нажатие, потом работаем
        if (i.customId === 'tk:create') {
          await i.deferReply({ ephemeral: true });
          const open = await openTicketOf(i.user.id);
          if (open) return i.editReply({ content: `У вас уже есть открытый тикет #${open.id}. Пишите в личку, ответ придёт в этот же чат.` });
          awaitingTicket.set(i.user.id, Date.now());
          try { await i.user.send({ embeds: [ticketPrompt()] }); }
          catch (e) { return i.editReply({ content: 'Не могу написать вам в личку. Включите личные сообщения от участников сервера и нажмите ещё раз.' }); }
          return i.editReply({ content: '📬 Проверьте личные сообщения с ботом и опишите проблему.' });
        }
        if (i.customId === 'rp:start') {
          await i.deferReply({ ephemeral: true });
          return i.editReply(await startReport(i));
        }
        if (i.customId.startsWith('rep:') || i.customId.startsWith('tk:take:') || i.customId.startsWith('tk:close:')) {
          await i.deferUpdate();
          if (i.customId.startsWith('rep:')) return handleReportButton(i);
          return handleTicketButton(i);
        }
        return;
      }
      // --- выбор сервера → выбор игрока ---
      if (i.isStringSelectMenu()) {
        const flow = flows.get(i.user.id);
        if (i.customId === 'rp:srv') {
          await i.deferUpdate();
          const row = (await db.query('select id, name, address from servers where id=$1', [i.values[0]])).rows[0];
          if (!row) return i.editReply({ content: 'Сервер не найден.', components: [] });
          const [host, port] = String(row.address).split(':');
          return i.editReply(await playerMenu(i.user.id, { id: row.id, name: row.name, host, port: +port || 27015 }));
        }
        if (i.customId === 'rp:pl') {
          if (!flow || flow.step !== 'player' || !fresh(flow.ts)) return i.reply({ content: 'Время выбора истекло. Начните репорт заново.', ephemeral: true });
          const target = flow.players[+i.values[0]];
          if (!target) return i.reply({ content: 'Игрок не найден, начните заново.', ephemeral: true });
          flows.set(i.user.id, { ...flow, step: 'reason', target: target.name, ts: Date.now() });
          const modal = new D.ModalBuilder().setCustomId('rp:mdl').setTitle('Причина репорта')
            .addComponents(new D.ActionRowBuilder().addComponents(
              new D.TextInputBuilder().setCustomId('reason').setLabel(`Что сделал ${target.name.slice(0, 30)}?`)
                .setStyle(D.TextInputStyle.Paragraph).setMinLength(5).setMaxLength(500).setRequired(true)));
          return i.showModal(modal);
        }
        return;
      }
      // --- текст причины (модальное окно) ---
      if (i.isModalSubmit() && i.customId === 'rp:mdl') {
        const flow = flows.get(i.user.id);
        if (!flow || flow.step !== 'reason' || !fresh(flow.ts)) return i.reply({ content: 'Время истекло. Начните репорт заново.', ephemeral: true });
        await i.deferReply({ ephemeral: true });
        const reason = i.fields.getTextInputValue('reason').trim();
        const text = await submitReport(i.user, flow.srv, flow.target, reason);
        flows.delete(i.user.id);
        return i.editReply({ content: text });
      }
    } catch (e) {
      console.error('report bot interaction:', e.message);
      const payload = { content: '❌ Ошибка, попробуйте позже', ephemeral: true };
      (i.deferred || i.replied ? i.followUp(payload) : i.reply(payload)).catch(() => {});
    }
  });

  client.on('messageCreate', async msg => {
    try {
      if (msg.author.bot) return;
      await ready;
      // администрация пишет в треде тикета — сообщение уходит игроку
      if (msg.guild && msg.channel.isThread() && msg.channel.parentId === ticketChannelId) {
        if (!msg.member?.permissions.has(D.PermissionFlagsBits.ManageMessages) && !isOwner(msg.author.id)) return;
        const ticket = (await db.query("select id, reporter_id from dc_reports where thread_id=$1 and kind='ticket' and status='open'", [msg.channel.id])).rows[0];
        if (ticket) return relayToPlayer(msg, ticket);
        return;
      }
      const raw = msg.content.trim();
      if (raw.startsWith('!')) return await handleText(msg);
      // личка: открытый тикет — сообщения игрока идут администрации
      // личка: текст после «Создать тикет» становится тикетом
      if (!msg.guild && awaitingTicket.has(msg.author.id)) {
        const started = awaitingTicket.get(msg.author.id);
        if (Date.now() - started > FLOW_TTL) { awaitingTicket.delete(msg.author.id); return; }
        if (raw.length < 5) return msg.reply('Опишите проблему подробнее (от 5 символов).');
        awaitingTicket.delete(msg.author.id);
        const open = await openTicketOf(msg.author.id);
        if (open) return relayToStaff(msg, open); // уже есть открытый тикет — это сообщение в него
        const text = await submitTicket(msg.author, raw.slice(0, 1500));
        return msg.reply({ content: text });
      }
      if (!msg.guild) {
        const ticket = await openTicketOf(msg.author.id);
        if (ticket) return relayToStaff(msg, ticket);
        return msg.reply({ content: 'Напишите `!тикет` — создать тикет, или `!репорт` — пожаловаться на игрока.' });
      }
    } catch (e) { console.error('report bot message:', e.message); }
  });

  client.login(token).catch(e => console.error('report bot login:', e.message));
}

module.exports = { start, postReport };
