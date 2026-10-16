// Общие команды для Telegram-бота и чата на сайте.
// Один и тот же набор и одни и те же ответы: команда, написанная в боте или в чате, делает одно и то же.
// Файл лежит рядом с server.js. Подключается из messenger.js (чат) и server.js (бот).

const a2s = require('./a2s');

const TG_ADMINS = () => (process.env.TG_ADMINS || '').split(',').map(s => s.trim()).filter(Boolean);
const SITE_URL = () => (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');

// список команд: единый для всех платформ (владельцу дополнительно показываются его команды)
const COMMANDS = [
  { name: 'help', desc: 'список команд' },
  { name: 'servers', desc: 'список серверов и онлайн' },
  { name: 'call', args: 'ник', desc: 'позвонить игроку на сайте' },
  { name: 'glent', desc: 'взрывы на сайте на 24 часа (только владельцы)', owner: true },
  { name: 'link', desc: 'привязать Discord к аккаунту сайта (в личке)', dcOnly: true },
  { name: 'list', desc: 'закрепить в этом канале список серверов с онлайном (владельцы)', owner: true, dcOnly: true },
  { name: 'unlist', desc: 'остановить закреплённый список серверов (владельцы)', owner: true, dcOnly: true }
];

function helpText(isOwner, platform) {
  const prefix = platform === 'dc' ? '!' : '/'; // в каналах Discord команды пишутся с «!», в личке и в других местах — с «/»
  const lines = COMMANDS.filter(c => (!c.owner || isOwner) && (!c.dcOnly || platform === 'dc'))
    .map(c => `${prefix}${c.name}${c.args ? ' ' + c.args : ''} — ${c.desc}`);
  const extra = platform === 'dc' ? '\n\nТакже работают команды Telegram-бота, например !bonus, !balance, !promo, !ban. Меню с кнопками — только в Telegram.' : '';
  return '📋 Команды:\n' + lines.join('\n') + extra;
}

// строка онлайна для одного сервера (запрос по протоколу A2S, с коротким таймаутом)
async function serverLine(s) {
  try {
    const [host, port] = String(s.address).split(':');
    const info = await a2s.query(host, +port || 27015, 2000);
    return `🟢 ${s.name} — ${info.players}/${info.maxPlayers}` + (info.map ? ` · ${info.map}` : '') + `\n${s.address}`;
  } catch (e) {
    return `⚪ ${s.name} — не отвечает\n${s.address}`;
  }
}

function create({ db, glentToggle, callStart }) {
  // владелец: по Telegram ID из TG_ADMINS (для сайта — через привязку tg_links)
  const isOwnerTg = tgId => !!tgId && TG_ADMINS().includes(String(tgId));
  const DC_OWNERS = () => (process.env.DISCORD_OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const isOwnerDc = dcId => !!dcId && DC_OWNERS().includes(String(dcId));
  // владелец аккаунта сайта: привязан владельческий Telegram или Discord
  const isOwnerSteam = async steam => {
    if (!steam) return false;
    const tgId = (await db.query('select tg_id from tg_links where steam_id=$1 limit 1', [steam])).rows[0]?.tg_id;
    if (isOwnerTg(tgId)) return true;
    const dcId = (await db.query('select discord_id from dc_links where steam_id=$1 limit 1', [steam]).catch(() => ({ rows: [] }))).rows[0]?.discord_id;
    return isOwnerDc(dcId);
  };

  const handlers = {
    help: async ({ isOwner, platform }) => ({ text: helpText(isOwner, platform) }),

    servers: async () => {
      const rows = (await db.query('select id, name, address from servers order by id')).rows;
      if (!rows.length) return { text: 'Список серверов пуст.' };
      const lines = await Promise.all(rows.map(serverLine));
      return { text: '🖥 Серверы:\n\n' + lines.join('\n\n') };
    },

    call: async ({ steam, arg, platform }) => {
      if (!steam) return { text: platform === 'dc' ? 'Сначала привяжите аккаунт сайта: напишите мне в личку /link' : 'Сначала войдите через Steam на сайте или привяжите аккаунт в боте.' };
      if (!callStart) return { text: '❌ Звонки пока не включены' };
      const r = await callStart(steam, arg);
      return { text: r.text, url: r.url };
    },

    glent: async ({ isOwner }) => {
      if (!isOwner) return { text: 'Нет доступа' };
      const r = await glentToggle();
      if (!r.on) return { text: '🔇 Взрывы на сайте ВЫКЛЮЧЕНЫ.\n\nВключить снова: /glent' };
      const d = new Date(r.until + 3 * 36e5).toISOString(); // МСК
      return { text: `💥 Взрывы на сайте ВКЛЮЧЕНЫ на 24 часа (до ${d.slice(8, 10)}.${d.slice(5, 7)} ${d.slice(11, 16)} МСК).` };
    }
  };

  // разбор текста: «/servers», «/call ник», «/servers@BotName» — возвращает { name, arg } или null
  const parse = text => {
    const m = /^\/([a-zA-Zа-яА-ЯёЁ_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(String(text || '').trim());
    if (!m) return null;
    const name = m[1].toLowerCase();
    const aliases = { глент: 'glent', помощь: 'help', сервера: 'servers', серверы: 'servers', звонок: 'call' };
    return { name: aliases[name] || name, arg: (m[2] || '').trim().slice(0, 64) };
  };

  // run({ platform, steam, tgId, text }) -> { text, url? } | null (если это не команда из списка)
  async function run({ platform, steam, tgId, discordId, text }) {
    const p = parse(text);
    if (!p || !handlers[p.name]) return null;
    const cmd = COMMANDS.find(c => c.name === p.name);
    const isOwner = platform === 'tg' ? isOwnerTg(tgId) : platform === 'dc' ? (isOwnerDc(discordId) || await isOwnerSteam(steam)) : await isOwnerSteam(steam);
    if (cmd.owner && !isOwner) return { text: 'Нет доступа' };
    try {
      return await handlers[p.name]({ steam, tgId, isOwner, arg: p.arg, platform });
    } catch (e) {
      console.error('command', p.name, e.message);
      return { text: '❌ Ошибка, попробуйте позже' };
    }
  }

  return { run, isOwnerTg, isOwnerDc, helpText, serverLine };
}

module.exports = { create, COMMANDS, helpText };
