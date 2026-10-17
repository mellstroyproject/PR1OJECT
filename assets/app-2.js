const mutes=[['Игрок D','Админ 3','Оскорбления в чате',1,'1 день','19.09.2026, 00:10'],['Игрок E','Админ 2','Спам в голосовом чате',1,'3 дня','18.09.2026, 23:40']];
const prem=['Больше денег в начале раунда','Выделение в чате и серверов','Прокачка опыта x2','Резервный слот для подключения','Улучшенный дроп скинов'];
const plus=['Все возможности премиума','Заглушить игрока','Заморозить игрока','Ослепить игрока','Убить игрока','Изменить урон игроку','Изменить здоровье игроку','Отключить прыжок игроку'];
const periods=['7 дней','30 дней','90 дней','180 дней'];
const periodsOf=k=>k==='plus'?['Навсегда']:periods; // Админ+ продаётся только навсегда
const price={prem:[65,200,470,840],plus:[550]}; // временные цены, замени на свои
const rcats=['Основные','Общение','Игровой процесс','Никнеймы и аватарки','Прочее','Для администрации','Условия проверки'];

function head(){
  const nav=$('#nav');
  if(!nav.children.length) nav.innerHTML=PAGES.map(([k,t,ic])=>`<button data-k="${k}" onclick="go('${k}')">${I(ic)}${t}</button>`).join('');
  [...nav.children].forEach(b=>{const k=b.dataset.k;b.classList.toggle('on',st.page===k||(k==='home'&&st.page==='public'))});
  const logged=!!st.user,coins=logged?(st.user.coins||0):0,from=prev.coins;
  const menuFresh=st.menu&&!prev.menu,promoFresh=st.promoOpen&&!prev.promo;
  const coinsChanged=logged&&prev.logged&&from!==null&&coins!==from,loginChanged=logged!==prev.logged;
  prev.menu=st.menu;prev.promo=st.promoOpen;prev.logged=logged;prev.coins=logged?coins:null;
  $('#right').classList.toggle('swap',loginChanged);
  const menuItems=[['Профиль','user',"openProfile(st.user.id)"],['Скинченджер','skin',"go('skins')"]].concat(st.user&&st.user.isAdmin?[['Админ-панель','shield',"go('admin')"]]:[],[['Настройки','gear',"go('settings')"]]);
  $('#right').innerHTML=st.user?
   `<div class="promo-wrap"><button class="promo-btn" onclick="togglePromo()">${I('promo')}Промокод</button>`+
   
   `</div>`+
   `<div class="chip bal${coinsChanged?' bump':''}">${I('coin')}<span id="bal">${coins.toFixed(2)}</span><button class="plus" aria-label="Пополнить баланс" onclick="uiAlert('Баланс пополняется в Telegram-боте: «👤 Мой аккаунт» → «💳 Пополнить баланс». Переведите деньги по реквизитам и пришлите чек — после проверки монеты придут на аккаунт.')">+</button></div>`+
   `<button class="ava" aria-label="Меню профиля" aria-haspopup="true" style="${st.user.avatar?`background-image:url('${st.user.avatar}')`:''}" onclick="toggleMenu(event)">${st.user.avatar?'':esc((st.user.name||'?').trim().charAt(0).toUpperCase())}</button>`+
   `<button class="gear${st.page==='settings'?' on':''}" aria-label="Настройки" title="Настройки" onclick="go('settings')">${I('gear')}</button>`+
   (st.menu?`<div class="menu">${st.user.role?`<div class="menu-role">${st.user.role}</div>`:''}${menuItems.map(([t,ic,act])=>`<button onclick="${act||'st.menu=false;head()'}">${I(ic)}${t}</button>`).join('')}<hr><button onclick="logout()">${I('out')}Выйти</button></div>`:'')
   :`<button class="steam" onclick="steamLogin()">${I('steam')}Войти через Steam</button><a class="demo" href="#" onclick="demoLogin();return false">демо</a>`;
  if(coinsChanged&&!reduce)countTo(from,coins);
}
function view(){
  if(st.page==='admin'&&!(st.user&&st.user.isAdmin)){st.page='home'}
  if(st.page==='home') return `<div class="cards"><div class="mode" onclick="go('public')" role="button" tabindex="0"><svg class="mode-art" viewBox="0 0 320 460" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="mg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="s1"/><stop offset="1" class="s2"/></linearGradient><radialGradient id="mg2"><stop offset="0" class="g1"/><stop offset="1" class="g2"/></radialGradient></defs><rect width="320" height="460" fill="url(#mg1)"/><circle cx="160" cy="190" r="175" fill="url(#mg2)"/><g class="st"><circle cx="30" cy="40" r="1.4"/><circle cx="92" cy="22" r="1"/><circle cx="270" cy="34" r="1.4"/><circle cx="292" cy="120" r="1"/><circle cx="24" cy="150" r="1"/><circle cx="60" cy="260" r="1.2"/><circle cx="300" cy="250" r="1.2"/><circle cx="200" cy="18" r="1"/></g><path class="sp" d="M52 84l2-6 6-2-6-2-2-6-2 6-6 2 6 2z"/><path class="sp" d="M262 300l2-6 6-2-6-2-2-6-2 6-6 2 6 2z"/><path class="ln" d="M-10 350L330 40"/><path class="ln l2" d="M-10 420L330 110"/><g fill="none"><circle class="ring" cx="160" cy="190" r="112"/><circle class="ring2" cx="160" cy="190" r="94"/><path class="cross" d="M160 62V162M160 218V318M32 190H132M188 190H288"/><path class="tick" d="M160 88v12M160 280v12M58 190h12M250 190h12"/></g><defs><linearGradient id="nxtg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><g class="nx-en"><path d="M138 292v-52q0-30 22-30t22 30v52z"/><path class="v" d="M146 244q14 8 28 0v34h-28z"/><path class="v" d="M149 252h22M149 262h22M149 272h22" fill="none"/><circle cx="160" cy="190" r="13"/><path d="M146 188a14 14 0 0 1 28 0z"/><path class="v" d="M147 191h26" fill="none"/><path class="g" d="M120 246h96v6h-30l-6 16h-6l3-10h-57z"/><path class="g" d="M120 242h30v10h-30z"/></g><line class="nx-tr" x1="30" y1="372" x2="160" y2="190" pathLength="100"/><path class="nx-mz" d="M30 372l5-14 4 11 11-3-8 9 8 9-11-3-4 11-5-14-14-3z"/><g class="nx-sp"><path d="M160 190l-44-26M160 190l46-30M160 190l-36 40M160 190l40 34M160 190v-58"/></g><circle class="nx-hit" cx="160" cy="190" r="26"/><circle class="nx-fl" cx="160" cy="190" r="14"/><g class="nx-hm"><path d="M150 180l-8-8M170 180l8-8M150 200l-8 8M170 200l8 8"/></g><circle class="dot" cx="160" cy="190" r="3.5"/><g transform="translate(232 92) rotate(35)"><rect class="bl" width="40" height="9" rx="4.5"/><rect class="bl2" width="12" height="9" rx="3"/></g><path class="sk1" transform="translate(0 -30)" d="M0 460V392h20v-16q10-16 20 0v16h16v-34h5v-12h5v12h5v34h22v-24q16-30 32 0v24h24v-40l9-14 9 14v40h24v-20h22v-12h14v12h20v-30q14-24 28 0v30h24v-18h21V460Z"/><path class="sk2" d="M0 460V392h20v-16q10-16 20 0v16h16v-34h5v-12h5v12h5v34h22v-24q16-30 32 0v24h24v-40l9-14 9 14v40h24v-20h22v-12h14v12h20v-30q14-24 28 0v30h24v-18h21V460Z"/><g class="win"><rect x="60" y="384" width="3" height="4"/><rect x="146" y="374" width="3" height="4"/><rect x="238" y="380" width="3" height="4"/><rect x="284" y="382" width="3" height="4"/></g><g class="nx-kf"><rect x="104" y="14" width="204" height="26" rx="4"/><text x="114" y="31">YOU</text><path class="ic" d="M152 26h30v3h-30zM164 29h5v7h-5z"/><circle class="hs" cx="196" cy="27" r="6"/><path class="hs" d="M196 18v4M196 32v4M187 27h4M201 27h4"/><text x="214" y="31">ENEMY</text></g></svg><b>PUBLIC</b><span class="mode-go">Играть →</span></div></div>
   <div class="scroll-hint">Листай вниз<span>↓</span></div>
   <section class="reveal-zone"><div class="reveal-stage"><div class="burst" aria-hidden="true"></div><div class="reveal-bob"><div class="soc"><h2>Присоединяйся к нам</h2><div class="soc-row"><a class="soc-card tg" href="https://t.me/Next1Project" target="_blank" rel="noopener">${I('tg')}<b>Telegram</b><span>Наш канал</span></a><a class="soc-card dc" href="https://discord.gg/3RStaDa98Z" target="_blank" rel="noopener">${I('dc')}<b>Discord</b><span>Наш сервер</span></a></div></div></div></div></section>`;
  if(st.page==='public') return `<h1>Public: серверы</h1><div class="srv-grid">${servers.map(s=>srvCard(s[0],s[1])).join('')}</div><div style="margin-top:20px"><button class="join" onclick="whiteScreen()">Ты крутой?</button></div>`;
  if(st.page==='shop') return `<h1 style="text-align:center">Магазин</h1><div class="plans">${[['prem','Премиум',prem,'p'],['plus','Админ+',plus,'g']].map(([k,n,l,c])=>`<div class="plan ${c}"><h2>${n}</h2><ul>${l.map(x=>`<li>${x}</li>`).join('')}</ul><div class="periods">${periodsOf(k).map((p,i)=>`<button class="${st.plan[k]===i?'on':''}" onclick="setPeriod('${k}',${i},this)">${p}</button>`).join('')}</div><div class="price">${price[k][st.plan[k]]} ₽</div><button class="buy" onclick="buyPlan('${k}','${n}')">Купить</button></div>`).join('')}</div>`;
  if(st.page==='leaders'){const rows=leaders[st.lb];return `<h1>Лидеры</h1><div class="bar"><div class="tabs"><button class="${st.lb==='exp'?'on':''}" onclick="st.lb='exp';draw()">По опыту</button><button class="${st.lb==='drop'?'on':''}" onclick="st.lb='drop';draw()">По дропу</button></div><input placeholder="Поиск по нику / SteamID..." aria-label="Поиск"></div><table><tr><th>Место</th><th>Игрок</th><th>Очков</th><th>Убийств</th><th>У/С</th><th>Время игры</th></tr>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${lbWho(r)}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join('')}</table>`}
  if(st.page==='bans'){const rows=st.bt==='bans'?bans:mutes;return `<h1>Баны</h1><div class="bar"><div class="tabs"><button class="${st.bt==='bans'?'on':''}" onclick="st.bt='bans';draw()">Баны</button><button class="${st.bt==='mutes'?'on':''}" onclick="st.bt='mutes';draw()">Муты</button></div><input placeholder="Поиск по нику / SteamID..." aria-label="Поиск"></div><table><tr><th>Игрок</th><th>Админ</th><th>Причина</th><th>Статус</th><th>Срок</th><th>Дата</th></tr>${rows.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td class="${r[3]?'ban':'ok'}">${r[3]?(st.bt==='bans'?'Забанен':'Замучен'):'Разбанен'}</td><td>${r[4]}</td><td>${r[5]}</td></tr>`).join('')}</table>`}
  if(st.page==='rules') return `<h1>Правила</h1><div class="rules"><div class="side">${rcats.map((c,i)=>`<button class="${st.rule===i?'on':''}" onclick="st.rule=${i};draw()">${c}</button>`).join('')}</div><div class="empty">Раздел «${rcats[st.rule]}»: текст правил добавим позже.</div></div>`;
  if(st.page==='settings'){
    const u=st.user;
    if(!u) return `<h1>Настройки</h1><div class="empty">Вы не вошли в аккаунт. Войдите через Steam, чтобы увидеть настройки.<br><br><button class="steam" onclick="steamLogin()">${I('steam')}Войти через Steam</button></div>${themeCard()}`;
    return `<h1>Настройки</h1>
     <div class="set-card"><div class="set-ava" style="${u.avatar?`background-image:url('${u.avatar}')`:''}">${u.avatar?'':esc((u.name||'?').trim().charAt(0).toUpperCase())}</div>
       <div><div class="set-name">${esc(u.name||'Игрок')}${u.role?`<span class="admin-badge">${u.role}</span>`:''}</div><div class="stat">SteamID: ${esc(u.id)}</div><div class="stat">Баланс: ${(u.coins||0).toFixed(2)}</div></div></div>
     ${themeCard()}
     ${notifyCard()}
     ${checkerCard()}
     ${settingsSkins()}
     <div class="set-card"><div><div class="set-name">Аккаунт</div><div class="stat">Выйти из аккаунта на этом устройстве. Вернуться можно в любой момент через Steam.</div></div>
       <button class="out-btn" onclick="logout()">${I('out')}Выйти из аккаунта</button></div>`;
  }
  if(st.page==='admin'){
    const tabs=admTabs(),cur=admCur();
    const acts=(can('ban')?[['Кикнут','Кикнуть'],['Замьючен','Замьютить'],['Заглушен','Заглушить'],['Заморожен','Заморозить'],['Ослеплён','Ослепить'],['Убит','Убить']]:[['Заглушен','Заглушить'],['Заморожен','Заморозить'],['Ослеплён','Ослепить'],['Убит','Убить']]).map(([v,t])=>`<button onclick="adminAction('${v}')">${t}</button>`).join('');
    const player=`<h2 class="sec">Действия над игроком</h2>
      <div class="admin-tools"><input id="adminTarget" placeholder="Ник или SteamID игрока" aria-label="Игрок">
        <div class="ap-acts">${acts}${can('ban')?`<button class="danger" onclick="adminAction('Забанен')">Забанить</button>`:''}${can('unban')?`<button class="ok" onclick="adminAction('Разбанен')">Разбанить</button><button class="ok" onclick="adminAction('Размьючен')">Снять мут</button>`:''}</div></div>`;
    return `<h1>Админ-панель<span class="admin-badge">${st.user.role}</span></h1>
    <div class="admin-grid">
      <div class="admin-card"><div class="n">${bans.filter(b=>b[3]).length}</div><div class="l">Активных банов</div></div>
      <div class="admin-card"><div class="n">${mutes.filter(m=>m[3]).length}</div><div class="l">Активных мутов</div></div>
      ${st.user.full?`<div class="admin-card"><div class="n">${(SV.admins||[]).length}</div><div class="l">Админов на сервере</div></div>`:''}
    </div>
    <div class="ap">
      <nav class="ap-nav" aria-label="Разделы админ-панели">${tabs.map(([k,t,d,ic])=>`<button class="ap-tab${k===cur?' on':''}" data-t="${k}" onclick="admTab('${k}')"><span class="ap-ic">${I(ic)}</span><span><b>${t}</b><small>${d}</small></span></button>`).join('')}</nav>
      <div class="ap-body">${admSec('player',player)}${can('ban')?admSec('reports',reportsBlock()):''}${st.user.full?admSec('abuse',abuseBlock()):''}${adminOwnerSections()}</div>
    </div>
    <p class="stat">Баны и муты сохраняются в базе и видны на странице «Баны». Кик, заморозка и другие действия прямо в игре требуют плагина на игровом сервере.</p>`;
  }
}
// кнопка для замов (и владельца): «Запустить админ абуз» = команда /глент (взрывы на сайте на 24 часа, повторное нажатие — выключает)
function abuseBlock(){
  const g=window.NX_GLENT,left=g&&g.on?Math.max(0,g.until-Date.now()):0,on=left>0,hh=Math.floor(left/36e5),mm=Math.floor(left%36e5/6e4);
  return `<div class="admin-tools"><button class="${on?'join del':'danger'}" onclick="abuseToggle(${!on})">${on?'⏹ Остановить админ абуз':'💥 Запустить админ абуз'}</button>
    <span class="stat">${on?'Идёт у всех посетителей, сама выключится через '+(hh?hh+' ч ':'')+mm+' мин':'Взрывы, летающие фигурки, переливающийся фон и пляшущие кнопки у всех на сайте на 24 часа'}</span></div>`;
}
async function abuseToggle(on){
  try{const r=await api('admin/abuse',{on});window.NX_GLENT={on:r.on,until:Date.now()+r.left};if(window.nxGlentPoll)window.nxGlentPoll();draw()}
  catch(e){uiAlert(e.message,'Не получилось')}
}
function admTabs(){ // [ключ, название, подпись, иконка] — только то, что доступно этому админу
  const u=st.user||{};
  return [
    ['player','Игрок','Бан, мут, кик и др.','bans',true],
    ['reports','Жалобы','Жалобы игроков из игры','bans',can('ban')],
    ['grant','Выдать админку','Админ+ на срок','shield',can('grant')],
    ['admins','Админы сервера','Список и правка','user',!!u.full],
    ['vip','Выдать VIP','Premium на срок','coin',!!u.full],
    ['promo','Промокоды','Создать и изменить','promo',can('promo')],
    ['deputy','Заместители','Назначить и снять','leaders',!!u.isOwner],
    ['perms','Права доступа','Что можно замам','gear',!!u.isOwner],
    ['design','Дизайн и чекер','Тема сайта','skin',can('design')],
    ['servers','Серверы','Список серверов','play',can('server')],
    ['abuse','Админ абуз','Взрывы на сайте','box',!!u.full]
  ].filter(t=>t[4]).map(t=>t.slice(0,4));
}
function admCur(){const t=admTabs();return t.some(x=>x[0]===st.adminTab)?st.adminTab:t[0][0]}
function admSec(k,h){return `<section data-adm="${k}"${k===admCur()?'':' hidden'}>${h}</section>`}
function admTab(k){ // переключение без перерисовки — мгновенно, введённые данные не теряются
  st.adminTab=k;st.adminMsg={};
  if(k==='reports')loadReports();
  document.querySelectorAll('.ap-tab').forEach(b=>b.classList.toggle('on',b.dataset.t===k));
  document.querySelectorAll('.ap-body>section').forEach(e=>{e.hidden=e.dataset.adm!==k});
}
function reportsBlock(){
  return `<div><h2 style="margin:0 0 10px">Жалобы игроков</h2>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px"><button onclick="loadReports()">Обновить</button> <span id="repCount" style="opacity:.7"></span></div>
    <div id="repList"><p style="opacity:.7">Загрузка…</p></div></div>`;
}
async function loadReports(){
  const box=document.getElementById('repList'); if(!box) return;
  try{
    const j=await api('reports');
    const list=j.reports||[];
    const c=document.getElementById('repCount'); if(c) c.textContent='Всего: '+list.length;
    if(!list.length){box.innerHTML='<p style="opacity:.7">Жалоб нет</p>';return}
    box.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr>'
      +'<th style="text-align:left">Когда</th><th style="text-align:left">Кто</th><th style="text-align:left">На кого</th>'
      +'<th style="text-align:left">Причина</th><th style="text-align:left">Сервер</th><th></th></tr></thead><tbody>'
      +list.map(r=>`<tr style="border-top:1px solid #333">`
        +`<td>${esc(new Date(r.created_ms).toLocaleString('ru'))}</td>`
        +`<td>${esc(r.reporter_name||'Игрок')}<br><small>${esc(r.reporter||'')}</small></td>`
        +`<td><b>${esc(r.target||'')}</b></td>`
        +`<td style="color:#ffb4b4"><b>${esc(r.reason||'')}</b></td>`
        +`<td>${esc(r.server||'—')}</td>`
        +`<td><button onclick="delReport(${+r.id})">Удалить</button></td></tr>`).join('')
      +'</tbody></table>';
  }catch(e){ box.innerHTML='<p style="color:#ff8a8a">'+esc(e.message)+'</p>'; }
}
async function delReport(id){
  if(!confirm('Удалить жалобу?')) return;
  try{ await api('reports/delete',{id}); loadReports(); }catch(e){ alert(e.message); }
}
// карточки серверов: фон = текущая карта сервера (картинка /maps/<карта>.jpg)
