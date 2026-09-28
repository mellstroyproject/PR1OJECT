// Подключает сайт к бэкенду. Впишите адрес API без слэша на конце.
const SRV = 'https://ВАШ-АДРЕС-ТУННЕЛЯ';

const srvTok = () => localStorage.getItem('token');
async function srv(path, method = 'GET', body) {
  const r = await fetch(SRV + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(srvTok() ? { Authorization: 'Bearer ' + srvTok() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401) localStorage.removeItem('token'); throw new Error(j.error || 'Ошибка ' + r.status); }
  return j;
}

// Токен приходит после входа через Steam в адресе #token=...
const srvHash = new URLSearchParams(location.hash.slice(1));
if (srvHash.get('token')) {
  localStorage.setItem('token', srvHash.get('token'));
  history.replaceState(null, '', location.pathname + location.search);
}
if (!srvTok()) st.user = null; // убираем старый «демо»-вход из браузера

steamLogin = () => { location.href = SRV + '/auth/steam'; };
demoLogin = () => alert('Демо отключено, войдите через Steam');
loadSteamAvatar = async () => {};
buyPlan = () => alert('Покупка пока отключена. Используйте промокод.');
applyRole = u => u;
const srvLogout = logout;
logout = () => { localStorage.removeItem('token'); srvLogout(); };

async function refreshMe() {
  if (!srvTok()) { st.user = null; return draw(); }
  try {
    const u = await srv('/api/me');
    u.avatar = safeAvatar(u.avatar);
    u.canManage = u.isOwner;
    u.role = u.isOwner ? 'Владелец' : u.isAdmin ? 'Админ' : null;
    st.user = u;
  } catch (e) { st.user = null; }
  draw();
}

activatePromo = async () => {
  if (!st.user) { st.promoMsg = { ok: false, text: 'Сначала войдите через Steam' }; return draw(); }
  try {
    const r = await srv('/api/promo/redeem', 'POST', { code: st.promo });
    st.promo = '';
    st.promoMsg = { ok: true, text: 'Код активирован: ' + r.text };
    await refreshMe();
  } catch (e) { st.promoMsg = { ok: false, text: e.message }; draw(); }
};

// ---- Админ-панель владельца ----
let srvPromos = [], srvLoaded = false;
async function loadPromos() { try { srvPromos = await srv('/api/admin/promos'); } catch (e) { srvPromos = []; } draw(); }

adminOwnerSections = () => {
  if (!st.user.isOwner) return '';
  if (!srvLoaded) { srvLoaded = true; loadPromos(); }
  const m = st.adminMsg || {};
  const msg = (k, id) => `<div id="${id}" class="promo-msg ${m[k] ? (m[k].ok ? 'ok' : 'err') : ''}">${m[k] ? esc(m[k].text) : ''}</div>`;
  return `<h2 class="sec">Выдать игроку</h2>
  <div class="admin-tools"><input id="gId" placeholder="SteamID64 (17 цифр)" maxlength="17">
    <select id="gKind"><option value="admin">Админка</option><option value="vip">VIP</option></select>
    <input id="gVal" placeholder="Флаги админки или группа VIP"><input id="gImm" type="number" placeholder="Иммунитет">
    <input id="gDays" type="number" placeholder="Дней (0 = навсегда)"><button class="ok" onclick="srvGrant()">Выдать</button>${msg('grant', 'gMsg')}</div>
  <h2 class="sec">Промокоды</h2>
  <div class="admin-tools"><input id="pCode" placeholder="Код" maxlength="24"><button onclick="genPromo()">Случайный</button>
    <select id="pKind"><option value="admin">Админка</option><option value="vip">VIP</option><option value="coins">Монеты</option></select>
    <input id="pVal" placeholder="Флаги / группа VIP"><input id="pImm" type="number" placeholder="Иммунитет">
    <input id="pAmt" type="number" placeholder="Дней или монет (0 = навсегда)"><input id="pMax" type="number" placeholder="Лимит (0 = без лимита)">
    <button class="ok" onclick="srvPromo()">Создать</button>${msg('promo', 'pMsg')}</div>
  <table><tr><th>Код</th><th>Тип</th><th>Награда</th><th>Активаций</th><th></th></tr>${srvPromos.map(p => `<tr><td>${esc(p.code)}</td><td>${p.kind}</td>
    <td>${p.kind === 'coins' ? '+' + p.amount : esc(p.value || '') + ' / ' + (p.amount ? p.amount + ' дн.' : 'навсегда') + (p.kind === 'admin' ? ' / имм. ' + p.immunity : '')}</td>
    <td>${p.used}${p.max_uses ? ' / ' + p.max_uses : ' / ∞'}</td><td><button class="join del" onclick="srvDel('${esc(p.code)}')">Удалить</button></td></tr>`).join('')}</table>`;
};

async function srvGrant() {
  try {
    await srv('/api/admin/grant', 'POST', { steamId: $('#gId').value, kind: $('#gKind').value, value: $('#gVal').value, immunity: $('#gImm').value, days: $('#gDays').value });
    adminOk('grant', 'Выдано');
  } catch (e) { adminMsgNow('#gMsg', e.message); }
}
async function srvPromo() {
  try {
    await srv('/api/admin/promos', 'POST', { code: $('#pCode').value, kind: $('#pKind').value, value: $('#pVal').value, immunity: $('#pImm').value, amount: $('#pAmt').value, max: $('#pMax').value });
    await loadPromos(); adminOk('promo', 'Промокод создан');
  } catch (e) { adminMsgNow('#pMsg', e.message); }
}
async function srvDel(c) {
  try { await srv('/api/admin/promos/' + c, 'DELETE'); await loadPromos(); adminOk('promo', 'Удалён: ' + c); }
  catch (e) { alert(e.message); }
}

refreshMe();
