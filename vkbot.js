// VK-бот (сообщество): команды те же, что в Telegram и Discord (commands.js). Работает через Long Poll, вебхук не нужен.
// Нужно: VK_GROUP_TOKEN (ключ доступа сообщества), VK_GROUP_ID (ID сообщества без минуса),
// VK_OWNER_IDS (ID или ник владельцев ВК через запятую, для /glent). Команды пишутся с «/», например /help, /servers.

const API = 'https://api.vk.com/method/';
const V = '5.199';
let token = '', groupId = '', commands = null;

async function call(method, params) {
  const body = new URLSearchParams({ ...params, access_token: token, v: V });
  const r = await fetch(API + method, { method: 'POST', body });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.error_msg}`);
  return j.response;
}

async function send(peerId, text) {
  await call('messages.send', {
    peer_id: peerId,
    message: String(text).slice(0, 4000),
    random_id: Math.floor(Math.random() * 2 ** 31)
  });
}

async function handle(msg) {
  const text = (msg.text || '').trim();
  if (!text.startsWith('/')) return;
  const out = await commands.run({ platform: 'vk', vkId: msg.from_id, steam: null, text });
  await send(msg.peer_id, out ? out.text : 'Такой команды нет. Напишите /help — список команд.');
}

async function poll() {
  let lp = await call('groups.getLongPollServer', { group_id: groupId });
  let { server, key, ts } = lp;
  for (;;) {
    try {
      const r = await fetch(`${server}?act=a_check&key=${key}&ts=${ts}&wait=25`);
      const j = await r.json();
      if (j.failed) {
        if (j.failed === 1) { ts = j.ts; continue; }
        lp = await call('groups.getLongPollServer', { group_id: groupId });
        ({ server, key, ts } = lp);
        continue;
      }
      ts = j.ts;
      for (const u of j.updates || []) {
        if (u.type === 'message_new') handle(u.object.message).catch(e => console.error('vk msg:', e.message));
      }
    } catch (e) {
      console.error('vk poll:', e.message);
      await new Promise(res => setTimeout(res, 3000));
    }
  }
}

// В VK_OWNER_IDS можно писать и ID (число), и ник (например ss_plik): ник превращаем в число при запуске
async function resolveOwners() {
  const items = (process.env.VK_OWNER_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
  const ids = [];
  const names = [];
  for (const it of items) (/^\d+$/.test(it) ? ids : names).push(it);
  if (names.length) {
    try {
      const users = await call('users.get', { user_ids: names.join(',') });
      for (const u of users) ids.push(String(u.id));
    } catch (e) { console.error('vk owners:', e.message); }
  }
  process.env.VK_OWNER_IDS = ids.join(',');
  console.log('VK владельцы:', ids.length ? ids.join(', ') : 'не определены');
}

function start(opts) {
  token = process.env.VK_GROUP_TOKEN || '';
  groupId = process.env.VK_GROUP_ID || '';
  if (!token || !groupId) { console.log('VK-бот: VK_GROUP_TOKEN или VK_GROUP_ID не заданы — выключен'); return; }
  commands = require('./commands').create({ db: opts.db, glentToggle: opts.glentToggle, callStart: opts.callStart });
  console.log('VK-бот запущен (Long Poll), сообщество', groupId);
  resolveOwners().then(() => poll()).catch(e => console.error('vk start:', e.message));
}

module.exports = { start };
