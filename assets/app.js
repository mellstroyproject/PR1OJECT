var MOTION_OFF=false; // true — уважать системную настройку Windows/macOS «уменьшить движение» и отключать анимации
;
if('serviceWorker' in navigator)addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})});
;
document.body.appendChild(document.getElementById('nav'));try{document.documentElement.dataset.nav=localStorage.getItem('np_nav')||'side';document.documentElement.dataset.navc=localStorage.getItem('np_navc')||'full'}catch(e){document.documentElement.dataset.nav='side';document.documentElement.dataset.navc='full'}
;

const $=s=>document.querySelector(s);
const reduce=typeof matchMedia==='function'&&MOTION_OFF;
const prev={menu:false,promo:false,logged:false,coins:null,key:''};
function countTo(from,to){
  const t0=performance.now(),d=800;
  const step=t=>{const p=Math.min(1,(t-t0)/d),e=1-Math.pow(1-p,3),el=$('#bal');
    if(el)el.textContent=(from+(to-from)*e).toFixed(2);
    if(p<1)requestAnimationFrame(step)};
  requestAnimationFrame(step);
}
function setPeriod(k,i,btn){
  st.plan[k]=i;
  const plan=btn.closest('.plan');
  plan.querySelectorAll('.periods button').forEach((b,j)=>b.classList.toggle('on',j===i));
  const p=plan.querySelector('.price');
  p.textContent=price[k][i]+' ₽';
  p.classList.remove('tick');void p.offsetWidth;p.classList.add('tick');
}
const st={page:'home',lb:'exp',bt:'bans',plan:{prem:0,plus:0},rule:0,user:null,menu:false,promoOpen:false,promo:'',promoMsg:null};

// Промокоды: временный список для примера, лучше хранить и проверять на сервере,
// иначе любой посмотрит код прямо в исходнике страницы.
const PROMO_CODES={
  'START100':{coins:100,text:'+100 монет'},
  'WELCOME50':{coins:50,text:'+50 монет'},
  'NEXTPROJECT':{coins:200,text:'+200 монет'}
};
const usedPromoKey='usedPromoCodes';
function getUsedPromo(){try{return JSON.parse(localStorage.getItem(usedPromoKey)||'[]')}catch(e){return []}}
function togglePromo(){st.promoOpen=!st.promoOpen;st.menu=false;st.promoMsg=null;draw()}
function buyPlan(key,name){
  if(!st.user){uiAlert('Сначала войдите через Steam, чтобы купить');return}
  const cost=price[key][st.plan[key]];
  const bal=st.user.coins||0;
  if(bal<cost){uiAlert(`Недостаточно средств: не хватает ${(cost-bal).toFixed(2)} ₽. Пополните баланс или используйте промокод.`);return}
  st.user.coins=bal-cost;
  if(key==='plus'){
    const until=Math.max(Date.now(),getPlusUntil(st.user.id))+PERIOD_DAYS[st.plan[key]]*864e5;
    try{localStorage.setItem('plusUntil:'+st.user.id,String(until))}catch(e){}
    applyRole(st.user);
  }
  uiAlert(`Покупка успешна: ${name} ${key==='plus'?'навсегда':'на '+periods[st.plan[key]]}`+(key==='plus'?'. Рядом с промокодом появилась кнопка «Админ-панель».':''));
  draw();
}
function activatePromo(){
  if(!st.user){st.promoMsg={ok:false,text:'Сначала войдите через Steam'};draw();return}
  const code=st.promo.trim().toUpperCase();
  const fail=t=>{st.promoMsg={ok:false,text:t};draw()};
  if(!code)return fail('Введите код');
  const found=allPromos()[code];
  if(!found)return fail('Код не найден');
  const usedKey='usedPromoCodes:'+st.user.id,used=LS.get(usedKey,[]);
  if(used.includes(code))return fail('Этот код уже был использован');
  if(found.max>0&&(found.used||0)>=found.max)return fail('Лимит активаций этого кода исчерпан');
  st.user.coins=(st.user.coins||0)+found.coins;
  used.push(code);LS.set(usedKey,used);
  if(!found.builtin){const list=getCustomPromos(),p=list.find(x=>x.code===code);if(p){p.used=(p.used||0)+1;LS.set('customPromos',list)}}
  st.promo='';
  st.promoMsg={ok:true,text:'Код активирован: +'+found.coins+' монет'};
  draw();
}
// Владелец сервера: этот SteamID64 всегда получает права главного админа.
// https://steamcommunity.com/profiles/76561198659672678
const OWNER_STEAM_ID='76561198659672678';
const PERIOD_DAYS=[7,30,90,180];
const FOREVER=1e15; // «навсегда» для выданной админки
const LS={
  get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
};
function getGrants(){return LS.get('adminGrants',{})}
function getGrantUntil(id){const g=getGrants()[id];return g?+g.until||0:0}
function getDeputies(){return LS.get('deputies',{})}
function getCustomPromos(){return LS.get('customPromos',[])}
function allPromos(){ // встроенные + созданные в админ-панели
  const m={};
  for(const c in PROMO_CODES)m[c]={code:c,coins:PROMO_CODES[c].coins,max:0,used:0,builtin:true};
  for(const p of getCustomPromos())m[p.code]=p;
  return m;
}
const fmtDate=t=>t>=FOREVER?'навсегда':new Date(t).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'});
function getPlusUntil(id){try{return +localStorage.getItem('plusUntil:'+id)||0}catch(e){return 0}}
const DEFAULT_AVATAR_HASH='b5bd56c1aa4644a474a2e4972be27ef9e82e517e'; // стандартная «?» аватарка Steam
function safeAvatar(a){
  return typeof a==='string'&&!a.includes(DEFAULT_AVATAR_HASH)&&/^https:\/\/[\w.-]+\.(steamstatic\.com|akamaihd\.net)\/[\w\-./]+$/i.test(a)?a:null;
}
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function applyRole(u){
  u.avatar=safeAvatar(u.avatar);
  u.isOwner=u.id===OWNER_STEAM_ID;
  u.plusUntil=Math.max(getPlusUntil(u.id),getGrantUntil(u.id));
  u.hasPlus=u.plusUntil>Date.now();
  u.isDeputy=!u.isOwner&&!!getDeputies()[u.id];
  u.canManage=u.isOwner||u.isDeputy; // владелец и замы: полный набор модерации + выдача «Админ+»
  u.isAdmin=u.canManage||u.hasPlus;
  u.role=u.isOwner?'Владелец':(u.isDeputy?'Зам':(u.hasPlus?'Админ+':null));
  return u;
}

const ICONS={
chat:'<path d="M4 5h16v11H9l-5 4V5z"/>',
 play:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
 shop:'<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L21 8H6"/>',
 leaders:'<path d="M6 20v-9M12 20V4M18 20v-6"/>',
 tg:'<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
 dc:'<path d="M7 6c3-1.2 7-1.2 10 0 2 2 3 6 3 10-1.5 1.2-3 1.8-4.5 2l-1-1.7M7 6C5 8 4 12 4 16c1.5 1.2 3 1.8 4.5 2l1-1.7"/><circle cx="9" cy="12.5" r="1.3"/><circle cx="15" cy="12.5" r="1.3"/>',
 bans:'<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
 rules:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
 promo:'<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
 coin:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/>',
 user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
 skin:'<path d="M4 20l6-6M14 4l6 6-8 8-6-6z"/>',
 box:'<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
 gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
 out:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
 shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
 steam:'<circle cx="15.5" cy="8.5" r="4.5"/><circle cx="8" cy="16" r="3" fill="currentColor"/><path d="M8.5 15.5l4.5-4"/>'
};
const I=n=>`<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
const PAGES=[['home','Играть','play'],['shop','Магазин','shop'],['leaders','Лидеры','leaders'],['bans','Баны','bans'],['rules','Правила','rules'],['chat','Чат','chat']];

// ===== Адреса страниц: /shop, /leaders, /bans, /rules, /profile/<SteamID64> … =====
const ROUTES={home:'/',shop:'/shop',leaders:'/leaders',bans:'/bans',rules:'/rules',settings:'/settings',admin:'/admin',skins:'/skins',battleship:'/battleship',chat:'/chat',public:'/public'};
const ROUTE_PAGE=Object.fromEntries(Object.entries(ROUTES).map(([k,v])=>[v,k]));
const PF={id:null,data:null,err:'',busy:false,tab:'info',blocks:null};
let AUTH_READY=false,NAV_PUSH=false,WANT_PAGE='home',WANT_PROFILE=null;
const curPath=()=>location.pathname.replace(/(.)\/+$/,'$1');
function pageFromPath(){const p=curPath(),m=p.match(/^\/profile\/(\d{17})$/);return m?{page:'profile',id:m[1]}:{page:ROUTE_PAGE[p]||'home',id:null}}
const SITE_NAME='NextProject'; // название сайта во вкладке браузера
function setTitle(){
  const t={shop:'Магазин',leaders:'Лидеры',bans:'Баны',rules:'Правила',settings:'Настройки',admin:'Админ-панель',skins:'Скины',battleship:'Морской бой',chat:'Чат'}[st.page];
  const n=st.page==='profile'?(PF.data&&PF.data.name?PF.data.name+' — профиль':'Профиль игрока'):t;
  document.title=n?n+' · '+SITE_NAME:SITE_NAME;
}
function urlSync(){ // держит адрес в строке браузера в соответствии с открытой страницей
  setTitle();
  if(!AUTH_READY)return;
  const want=st.page==='profile'&&PF.id?'/profile/'+PF.id:(ROUTES[st.page]||'/');
  if(want!==curPath()){try{history[NAV_PUSH?'pushState':'replaceState'](null,'',want)}catch(e){}}
  NAV_PUSH=false;
}
{const r=pageFromPath();WANT_PAGE=r.page;if(r.page==='profile'){WANT_PROFILE=r.id;st.page='home'}else st.page=r.page}
addEventListener('popstate',()=>{const r=pageFromPath();st.menu=false;if(r.page==='profile'){openProfile(r.id,true)}else{st.page=r.page;try{window.scrollTo(0,0)}catch(e){}draw()}});

// Steam: если Steam вернул пользователя с openid-параметрами, читаем SteamID.
// ВАЖНО: проверить подпись (openid.sig) нужно на сервере, иначе вход можно подделать.
try{const q=new URLSearchParams(location.search),c=q.get('openid.claimed_id');
 if(c&&/\/openid\/id\/(\d+)$/.test(c)){
   st.user=applyRole({id:RegExp.$1,name:'Игрок',coins:15,avatar:null});
   try{history.replaceState(null,'',location.pathname)}catch(e){} // убираем openid-параметры из адреса
   // OpenID отдаёт только SteamID64, но не имя и не аватарку.
   // Чтобы получить реальную аватарку, нужен запрос на backend, который
   // сам сходит в Steam Web API (ISteamUser/GetPlayerSummaries) со своим
   // ключом — из браузера так сделать нельзя (ключ светился бы всем, и Steam
   // не пускает такие запросы через CORS). Пример:
 }}catch(e){}

// Сохранённый аккаунт: после перезагрузки страницы пользователь остаётся в системе.
const ACC_KEY='account';
try{
  const saved=JSON.parse(localStorage.getItem(ACC_KEY)||'null');
  if(saved&&saved.id){
    if(!st.user) st.user=applyRole(saved);
    else if(st.user.id===saved.id){ // вернулись из Steam тем же аккаунтом — оставляем баланс и аватарку
      st.user.coins=saved.coins;
      if(saved.name&&saved.name!=='Игрок')st.user.name=saved.name;
      st.user.avatar=st.user.avatar||saved.avatar;
      applyRole(st.user);
    }
  }
}catch(e){}
function saveUser(){
  try{
    if(st.user)localStorage.setItem(ACC_KEY,JSON.stringify({id:st.user.id,name:st.user.name,coins:st.user.coins,avatar:st.user.avatar||null}));
    else localStorage.removeItem(ACC_KEY);
  }catch(e){}
}

// Аватарка и ник из Steam. OpenID отдаёт только SteamID, поэтому профиль берём отдельно:
// 1) со своего backend (/api/steam-profile) — лучший вариант, когда сайт лежит на хостинге;
// 2) иначе — публичная XML-страница профиля Steam через CORS-прокси (работает и из локального файла).
const avatarTried={};
async function getWithTimeout(url,ms){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
  try{const r=await fetch(url,{signal:c.signal});if(!r.ok)throw new Error(r.status);return r}finally{clearTimeout(t)}
}
function parseSteamXml(x){
  const g=tag=>{const m=x.match(new RegExp('<'+tag+'>\\s*(?:<!\\[CDATA\\[)?\\s*([\\s\\S]*?)\\s*(?:\\]\\]>)?\\s*</'+tag+'>'));return m?m[1]:null};
  return {avatar:g('avatarFull'),name:g('steamID')};
}
async function loadSteamAvatar(){
  const u=st.user;
  if(!u||u.avatar||!/^\d{17}$/.test(u.id)||avatarTried[u.id])return;
  avatarTried[u.id]=true;
  let info=null;
  try{
    if(location.protocol.startsWith('http')){info=await (await getWithTimeout('/api/steam-profile?steamid='+u.id,4000)).json()}
  }catch(e){}
  if(!info||!safeAvatar(info.avatar)){
    const xml='https://steamcommunity.com/profiles/'+u.id+'?xml=1';
    const proxies=[x=>'https://api.allorigins.win/raw?url='+encodeURIComponent(x),x=>'https://corsproxy.io/?'+encodeURIComponent(x)];
    for(const p of proxies){
      try{
        const r=parseSteamXml(await (await getWithTimeout(p(xml),8000)).text());
        if(safeAvatar(r.avatar&&r.avatar.replace(/^http:/,'https:'))){info={avatar:r.avatar.replace(/^http:/,'https:'),name:r.name};break}
      }catch(e){}
    }
  }
  const av=info&&safeAvatar(info.avatar);
  if(av&&st.user&&st.user.id===u.id){
    st.user.avatar=av;
    if(info.name&&typeof info.name==='string')st.user.name=info.name.slice(0,32);
    draw();
  }else avatarTried[u.id]=false; // не вышло — попробуем при следующем входе/загрузке
}
function demoLogin(){st.user=applyRole({id:OWNER_STEAM_ID,name:'Демо',coins:15,avatar:null});draw();loadSteamAvatar()}

function steamLogin(){
  if(!location.protocol.startsWith('http')){
    uiAlert('Вход через Steam работает, только когда сайт открыт по адресу http(s):// — из файла на компьютере Steam не сможет вернуть вас обратно.\n\nДля проверки запустите в папке с index.html команду:\npython -m http.server 8000\nи откройте http://localhost:8000\n\nПока можно нажать «демо».');
    return;
  }
  const p=new URLSearchParams({'openid.ns':'http://specs.openid.net/auth/2.0','openid.mode':'checkid_setup',
   'openid.return_to':location.origin+location.pathname,'openid.realm':location.origin,
   'openid.identity':'http://specs.openid.net/auth/2.0/identifier_select','openid.claimed_id':'http://specs.openid.net/auth/2.0/identifier_select'});
  location.href='https://steamcommunity.com/openid/login?'+p;
}
const THEMES={
  blue:['Синий','linear-gradient(135deg,#4a6cf7,#9b5cf6)'],
  red:['Красный','linear-gradient(135deg,#e5484d,#ff8a3d)'],
  yellow:['Жёлтый','linear-gradient(135deg,#f5c518,#ff9f1c)'],
  green:['Зелёный','linear-gradient(135deg,#22c55e,#14b8a6)'],
  rgb:['RGB','conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)']
};
const RGB_VARS=['--r','--g','--b','--ar','--ag','--ab','--on-acc'];
let rgbRaf=0;
function hsl2rgb(h,s,l){const a=s*Math.min(l,1-l),f=n=>{const k=(n+h/30)%12;return l-a*Math.max(-1,Math.min(k-3,9-k,1))};return[f(0),f(8),f(4)].map(v=>Math.round(v*255))}
function paintRgb(h){
  const [r,g,b]=hsl2rgb(h,.9,.58),[ar,ag,ab]=hsl2rgb((h+55)%360,.9,.6),st=document.documentElement.style;
  st.setProperty('--r',r);st.setProperty('--g',g);st.setProperty('--b',b);
  st.setProperty('--ar',ar);st.setProperty('--ag',ag);st.setProperty('--ab',ab);
}
function applyTheme(name,save){
  if(!THEMES[name])name='blue';
  const root=document.documentElement;
  cancelAnimationFrame(rgbRaf);rgbRaf=0;
  root.classList.remove('rgb-live');RGB_VARS.forEach(v=>root.style.removeProperty(v));
  root.dataset.theme=name;
  if(name==='rgb'){
    root.classList.add('rgb-live');
    if(reduce)paintRgb(210);
    else{let last=0;const loop=t=>{if(t-last>33){last=t;paintRgb((t/30)%360)}rgbRaf=requestAnimationFrame(loop)};rgbRaf=requestAnimationFrame(loop)}
  }
  if(save!==false){LS.set('theme',name);LS.set('themePick',1)}
  document.querySelectorAll('.theme-btn').forEach(b=>b.classList.toggle('on',b.dataset.t===name));
}
// уведомления бота владельцу в Telegram (промокоды и покупка Админ+) — видно только владельцу
function notifyCard(){
  const u=st.user;if(!u||!u.isOwner||!u.ntf)return '';
  const row=(k,t,d)=>`<div class="set-card"><div><div class="set-name">${t}</div><div class="stat">${d}</div></div><button class="${u.ntf[k]?'ok':'join'}" onclick="toggleNtf('${k}',${!u.ntf[k]})">${u.ntf[k]?'Включены — выключить':'Выключены — включить'}</button></div>`;
  return row('promo','Уведомления: новые промокоды','Бот пришлёт сообщение в Telegram, когда кто-то создаст промокод на сайте.')+row('buy','Уведомления: покупка админки','Бот пришлёт сообщение в Telegram, когда кто-то купит Админ+ на сайте.');
}
async function toggleNtf(k,on){
  try{const r=await api('admin/notify',{kind:k,on});st.user.ntf={promo:r.promo,buy:r.buy};draw()}
  catch(e){uiAlert(e.message,'Не получилось')}
}
function themeCard(){
  const cur=document.documentElement.dataset.theme||'blue';
  return `<div class="set-card col"><div class="set-name">Тема оформления</div><div class="themes">${Object.entries(THEMES).map(([k,[n,g]])=>`<button class="theme-btn${k===cur?' on':''}" data-t="${k}" onclick="applyTheme('${k}')"><i style="background:${g}"></i>${n}</button>`).join('')}</div></div>`;
}
function logout(){st.user=null;st.menu=false;st.promoOpen=false;st.adminMsg={};if(st.page==='settings'||st.page==='admin')st.page='home';draw()}
function toggleMenu(e){if(e)e.stopPropagation();st.menu=!st.menu;st.promoOpen=false;head()}
document.addEventListener('click',e=>{if(st.menu&&!(e.target.closest&&e.target.closest('.menu,.ava'))){st.menu=false;head()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&st.menu){st.menu=false;head()}});
function go(p){st.page=p;st.menu=false;st.adminMsg={};NAV_PUSH=true;try{window.scrollTo(0,0)}catch(e){}draw()}

const servers=[['Мираж (карта меняется)','45.95.31.64:27215']];
const leaders={exp:[['Игрок 1','483 039','51 462','1.65','493 ч.'],['Игрок 2','381 447','45 760','2.73','485 ч.'],['Игрок 3','366 928','49 153','1.30','1007 ч.'],['Игрок 4','348 826','33 100','2.53','436 ч.'],['Игрок 5','332 129','36 242','1.43','467 ч.']],
 drop:[['Игрок 6','128','—','—','310 ч.'],['Игрок 7','97','—','—','254 ч.'],['Игрок 8','85','—','—','402 ч.']]};
const bans=[['Игрок A','Админ 1','Использование читов',1,'2 месяца','19.09.2026, 00:05'],['Игрок B','Админ 2','Отказ от проверки',1,'1 месяц','19.09.2026, 00:05'],['Игрок C','Админ 1','Использование читов',0,'2 месяца','19.09.2026, 00:03']];
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
function srvCard(name,address){
  return `<div class="srv-card" data-srv="${esc(address)}" onclick="srvOpen('${esc(address)}')"><div class="srv-bg" data-bg></div><div class="srv-shade"></div><div class="srv-body"><div class="srv-top"><div class="srv-name">${esc(name)}</div><div class="srv-st" data-st="${esc(address)}">проверяем…</div></div><div class="srv-bot"><div class="srv-map" data-map>—</div><div class="srv-pl" data-pl>—</div></div><div class="srv-btns"><button class="join" onclick="event.stopPropagation();location.href='steam://connect/${esc(address)}'">Играть</button> <button class="join" onclick="event.stopPropagation();navigator.clipboard&&navigator.clipboard.writeText('connect ${esc(address)}');uiAlert('Скопировано: connect ${esc(address)}')">Копировать</button></div></div></div>`;
}
async function loadServerStatus(){
  if(!document.querySelectorAll('[data-srv]').length) return;
  try{
    const list=await api('servers/status');
    for(const x of list){
      document.querySelectorAll('[data-srv]').forEach(card=>{
        if(card.dataset.srv!==x.address) return;
        const map=x.online?String(x.map||'').replace(/[^\w-]/g,''):'';
        const bg=card.querySelector('[data-bg]');
        const want=map?`url("/maps/${map}.jpg")`:'';
        if(bg.dataset.cur!==map){ bg.dataset.cur=map; bg.style.backgroundImage=want; }
        const st=card.querySelector('[data-st]');
        st.innerHTML=x.online
          ? `<span style="color:#7dff9b">● онлайн</span>${x.mode?' · '+esc(x.mode):''}`
          : `<span style="color:#ff8a8a">● оффлайн</span>`;
        card.querySelector('[data-map]').textContent=x.online?(x.map||'—'):'—';
        card.querySelector('[data-pl]').textContent=x.online?`${x.players}/${x.maxPlayers}`:'—';
      });
    }
  }catch(e){ document.querySelectorAll('[data-st]').forEach(el=>el.textContent='статус недоступен'); }
}
let SRVM=null;
const fmtT=s=>{const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`:`${m}:${String(x).padStart(2,'0')}`};
async function srvOpen(address){
  SRVM=address;
  let ov=document.getElementById('srvm');
  if(!ov){
    ov=document.createElement('div');ov.id='srvm';ov.className='srvm-ov';
    ov.addEventListener('click',e=>{if(e.target===ov)srvClose()});
    document.body.appendChild(ov);
  }
  ov.style.display='flex';
  ov.innerHTML='<div class="srvm"><div class="srvm-empty">Загрузка…</div></div>';
  await srvRefresh();
}
function srvClose(){const ov=document.getElementById('srvm');if(ov)ov.style.display='none';SRVM=null}
document.addEventListener('keydown',e=>{if(e.key==='Escape')srvClose()});
async function srvRefresh(){
  const ov=document.getElementById('srvm');if(!ov||!SRVM)return;
  const address=SRVM;
  try{
    const d=await api('servers/players?address='+encodeURIComponent(address));
    if(SRVM===address)ov.innerHTML=srvModalHTML(d);
  }catch(e){
    if(SRVM===address)ov.innerHTML=`<div class="srvm"><div class="srvm-head"><div class="srvm-title">Ошибка</div><button class="srvm-x" onclick="srvClose()">✕</button></div><div class="srvm-body"><div class="srvm-empty">${esc(e.message)}</div></div></div>`;
  }
}
setInterval(()=>{if(SRVM)srvRefresh()},10000);
function srvModalHTML(d){
  const map=String(d.map||'').replace(/[^\w-]/g,'');
  const head=d.online&&map?`linear-gradient(rgba(10,10,18,.55),rgba(10,10,18,.9)),url("/maps/${map}.jpg")`:'linear-gradient(135deg,#1c1c2e,#12121e)';
  const list=(d.list||[]).slice().sort((a,b)=>b.score-a.score);
  const body=!d.online
    ?'<div class="srvm-empty">Сервер оффлайн</div>'
    :list.length
      ?`<table class="srvm-tb"><tr><th>Игрок</th><th>Очки</th><th>Время</th></tr>${list.map(p=>`<tr><td>${esc(p.name)}</td><td>${p.score}</td><td>${fmtT(p.time)}</td></tr>`).join('')}</table>`
      :'<div class="srvm-empty">Сервер пуст</div>';
  return `<div class="srvm"><div class="srvm-head" style="background-image:${head}">
    <div class="srvm-top"><div class="srvm-title">${esc(d.name)}</div><button class="srvm-x" onclick="srvClose()" aria-label="Закрыть">✕</button></div>
    <div class="srvm-info">
      <div>Игроки: <b>${d.online?`${d.players}/${d.maxPlayers}`:'—'}</b></div>
      <div>Режим: <b>${esc(d.mode||'не указан')}</b></div>
      <div>Карта: <b>${esc(d.online?(d.map||'—'):'—')}</b></div>
    </div></div>
    <div class="srvm-body">${body}</div>
    <div class="srvm-foot">
      <button class="join" onclick="navigator.clipboard&&navigator.clipboard.writeText('connect ${esc(d.address)}');uiAlert('Скопировано: connect ${esc(d.address)}')">Скопировать IP</button>
      <div><button class="join" onclick="srvRefresh()">Обновить</button> <button class="join" onclick="location.href='steam://connect/${esc(d.address)}'">Присоединиться</button></div>
    </div></div>`;
}
setInterval(loadServerStatus,15000);
setTimeout(loadServerStatus,1500);
async function setServerMode(id){
  const r=SRVDB.find(x=>x.id===id);if(!r)return;
  const v=prompt('Режим игры для «'+r.name+'» (например: Соревновательный, Дезматч, Аренада):',r.mode||'');
  if(v===null)return;
  try{await api('admin/server-mode',{id,mode:v});await loadServers();toast('Режим сохранён','ok')}catch(e){toast(e.message,'err')}
}
function adminMsgNow(id,text){const e=$(id);if(e){e.textContent=text;e.className='promo-msg err'}}
function adminOk(kind,text){st.adminMsg={[kind]:{ok:true,text}};draw()}
function grantAdmin(){
  if(!(st.user&&st.user.canManage))return;
  const id=($('#grantId').value||'').trim(),sel=$('#grantDays').value;
  if(!/^\d{17}$/.test(id))return adminMsgNow('#grantMsg','SteamID64 — это 17 цифр (например 76561198…)');
  if(id===OWNER_STEAM_ID)return adminMsgNow('#grantMsg','Этот игрок уже владелец');
  const g=getGrants(),cur=g[id]?+g[id].until:0,base=Math.max(Date.now(),cur<FOREVER?cur:0);
  g[id]={until:sel==='0'?FOREVER:base+(+sel)*864e5,by:st.user.id,at:Date.now()};
  LS.set('adminGrants',g);
  if(st.user.id===id)applyRole(st.user);
  adminOk('grant','Админка выдана: '+id+' — '+(sel==='0'?'навсегда':sel+' дн.'));
}
function revokeAdmin(id){
  if(!(st.user&&st.user.canManage)||!/^\d{17}$/.test(id))return;
  const g=getGrants();delete g[id];LS.set('adminGrants',g);
  if(st.user.id===id)applyRole(st.user);
  adminOk('grant','Админка снята: '+id);
}
function addDeputy(){
  if(!(st.user&&st.user.isOwner))return;
  const id=($('#depId').value||'').trim();
  if(!/^\d{17}$/.test(id))return adminMsgNow('#depMsg','SteamID64 — это 17 цифр (например 76561198…)');
  if(id===OWNER_STEAM_ID)return adminMsgNow('#depMsg','Это вы — владелец');
  const d=getDeputies();
  if(d[id])return adminMsgNow('#depMsg','Этот игрок уже зам');
  d[id]={at:Date.now(),by:st.user.id};LS.set('deputies',d);
  adminOk('deputy','Зам назначен: '+id);
}
function removeDeputy(id){
  if(!(st.user&&st.user.isOwner)||!/^\d{17}$/.test(id))return;
  const d=getDeputies();delete d[id];LS.set('deputies',d);
  adminOk('deputy','Зам снят: '+id);
}
function genPromo(){
  const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let c='';
  for(let i=0;i<8;i++)c+=a[Math.floor(Math.random()*a.length)];
  $('#pCode').value='PROMO-'+c;
}
function createPromo(){
  if(!(st.user&&st.user.isOwner))return;
  const code=($('#pCode').value||'').trim().toUpperCase(),coins=+$('#pCoins').value,max=Math.floor(+$('#pMax').value||0);
  if(!/^[A-Z0-9_-]{3,24}$/.test(code))return adminMsgNow('#promoMsgA','Код: 3–24 символа — латиница, цифры, _ или -');
  if(!(coins>0&&coins<=100000))return adminMsgNow('#promoMsgA','Награда: число от 1 до 100 000');
  if(max<0||max>1000000)return adminMsgNow('#promoMsgA','Лимит активаций: от 0 (без лимита) до 1 000 000');
  if(allPromos()[code])return adminMsgNow('#promoMsgA','Такой код уже существует');
  const list=getCustomPromos();
  list.push({code,coins,max,used:0,by:st.user.id,at:Date.now()});LS.set('customPromos',list);
  adminOk('promo','Промокод создан: '+code+' (+'+coins+' монет)');
}
function deletePromo(code){
  if(!(st.user&&st.user.isOwner)||!/^[A-Z0-9_-]{3,24}$/.test(code))return;
  LS.set('customPromos',getCustomPromos().filter(p=>p.code!==code));
  adminOk('promo','Промокод удалён: '+code);
}
function ppl(id,name,avatar){ // аватарка + ник + ссылка на профиль Steam
  const a=safeAvatar(avatar),n=name||'';
  return `<span class="ppl"><i class="pa" style="${a?`background-image:url('${a}')`:''}">${a?'':esc((n||'?').trim().charAt(0).toUpperCase())}</i><span>${n?esc(n)+'<br>':''}<a class="lnk" href="https://steamcommunity.com/profiles/${id}" target="_blank" rel="noopener">${id}</a></span></span>`;
}
function adminOwnerSections(){
  const m=st.adminMsg||{},now=Date.now();
  const msg=(k,id)=>`<div id="${id}" class="promo-msg ${m[k]?(m[k].ok?'ok':'err'):''}">${m[k]?esc(m[k].text):''}</div>`;
  const grants=Object.entries(getGrants()).sort((a,b)=>b[1].at-a[1].at);
  const promos=Object.values(allPromos());
  const deps=Object.entries(getDeputies()).sort((a,b)=>b[1].at-a[1].at);
  const deputyBlock=`<h2 class="sec">Заместители</h2>
   <div class="admin-tools"><input id="depId" placeholder="SteamID64 игрока (17 цифр)" inputmode="numeric" maxlength="17" aria-label="SteamID64 зама"><button class="ok" onclick="addDeputy()">Назначить замом</button>${msg('deputy','depMsg')}</div>
   <p class="stat" style="margin-bottom:10px">У зама те же права, что у владельца (баны, муты, «Админ+», промокоды, серверы, дизайн, список админов). Назначать замов и выдавать отдельные права может только владелец.</p>
   ${deps.length?`<table><tr><th>Заместитель</th><th>Назначен</th><th></th></tr>${deps.map(([id,d])=>`<tr><td>${ppl(id,d.name,d.avatar)}</td><td>${fmtDate(+d.at)}</td><td><button class="join del" onclick="removeDeputy('${id}')">Снять</button></td></tr>`).join('')}</table>`:'<div class="empty">Пока нет заместителей.</div>'}`;
  const gaList=SV.admins||[]; // loadMe кладёт m.adm в SV и удаляет его из st.user
  const gaBlock=`<h2 class="sec">Все админы сервера</h2>
    <div class="admin-tools"><input id="gaeId" placeholder="Нажмите «Изменить» у админа в таблице" readonly aria-label="SteamID64"><input id="gaeName" placeholder="Ник в игре" maxlength="64" aria-label="Ник"><input id="gaeFlags" placeholder="Флаги" maxlength="26" aria-label="Флаги"><input id="gaeImm" type="number" min="0" max="100" placeholder="Иммунитет 0–100" aria-label="Иммунитет">
      <select id="gaeDays" aria-label="Срок"><option value="keep" selected>Срок: не менять</option><option value="7">7 дней от сегодня</option><option value="30">30 дней от сегодня</option><option value="90">90 дней от сегодня</option><option value="180">180 дней от сегодня</option><option value="0">Навсегда</option></select>
      <label class="perm"><input type="checkbox" id="gaeOff">Отключён</label><button class="ok" onclick="saveAdminEdit()">Сохранить</button>${msg('gaedit','gaeMsg')}</div>
    ${gaList.length?`<table><tr><th>Игрок (ник в игре)</th><th>Флаги</th><th>Иммунитет</th><th>Действует до</th><th></th></tr>${gaList.map(a=>`<tr><td>${ppl(a.id,a.name||a.site,a.ava)}</td><td>${esc(a.flags||'')}</td><td>${a.imm}</td><td class="${a.off||(a.end&&a.end*1000<=now)?'ban':'ok'}">${a.off?'отключён':!a.end?'навсегда':(a.end*1000>now?fmtDate(a.end*1000):'истёк '+fmtDate(a.end*1000))}</td><td>${a.id===OWNER_STEAM_ID&&!st.user.isOwner?'':`<button class="join" onclick="editAdmin('${a.id}')">Изменить</button>`} ${a.id===OWNER_STEAM_ID?'':`<button class="join del" onclick="revokeAdmin('${a.id}')">Удалить</button>`}</td></tr>`).join('')}</table>`:'<div class="empty">В базе игрового сервера нет админов (или база не подключена).</div>'}`;
  const grantBlock=`<h2 class="sec">Выдать админку</h2>
   <div class="admin-tools"><input id="grantId" placeholder="SteamID64 игрока (17 цифр)" inputmode="numeric" maxlength="17" aria-label="SteamID64">
     ${st.user.full?`<input id="grantName" placeholder="Ник в игре (пусто = ник из Steam)" maxlength="64" aria-label="Ник"><input id="grantFlags" placeholder="Флаги (пусто = по умолчанию)" maxlength="26" aria-label="Флаги"><input id="grantImm" type="number" min="0" max="100" placeholder="Иммунитет 0–100 (пусто = по умолчанию)" aria-label="Иммунитет">`:''}
     <select id="grantDays" aria-label="Срок"><option value="7">7 дней</option><option value="30" selected>30 дней</option><option value="90">90 дней</option><option value="180">180 дней</option><option value="0">Навсегда</option></select>
     <button class="ok" onclick="grantAdmin()">Выдать</button>${msg('grant','grantMsg')}</div>
   ${grants.length?`<table><tr><th>Игрок</th><th>Роль</th><th>Действует до</th><th></th></tr>${grants.map(([id,g])=>`<tr><td>${ppl(id,g.name,g.avatar)}</td><td>Админ+</td><td class="${+g.until>now?'ok':'ban'}">${+g.until>now?fmtDate(+g.until):'истёк '+fmtDate(+g.until)}</td><td><button class="join del" onclick="revokeAdmin('${id}')">Снять</button></td></tr>`).join('')}</table>`:'<div class="empty">Пока никому не выдано.</div>'}`;
  const vips=Object.entries(SV.vips||{}).sort((a,b)=>b[1].until-a[1].until);
  const vipBlock=`<h2 class="sec">Выдать VIP (Premium)</h2>
   <div class="admin-tools"><input id="vipId" placeholder="SteamID64 игрока (17 цифр)" inputmode="numeric" maxlength="17" aria-label="SteamID64">
     <input id="vipDays" type="number" min="1" max="36500" placeholder="Срок, дней (любой)" aria-label="Срок в днях">
     <label class="perm"><input type="checkbox" id="vipForever">Навсегда</label>
     <button class="ok" onclick="grantVip()">Выдать</button>${msg('vipgrant','vipMsg')}</div>
   ${vips.length?`<table><tr><th>Игрок</th><th>Действует до</th><th></th></tr>${vips.map(([id,v])=>`<tr><td>${ppl(id,v.name,v.avatar)}</td><td class="${+v.until>now?'ok':'ban'}">${+v.until>=1e15?'навсегда':+v.until>now?fmtDate(+v.until):'истёк '+fmtDate(+v.until)}</td><td><button class="join del" onclick="revokeVip('${id}')">Снять</button></td></tr>`).join('')}</table>`:'<div class="empty">VIP пока никому не выдан.</div>'}`;
  const promoBlock=`<h2 class="sec">Промокоды</h2>
   <div class="admin-tools"><input id="pCode" placeholder="Код (например SUMMER100 или ЛЕТО2026)" maxlength="32" aria-label="Код">
     <button onclick="genPromo()">Случайный</button>
     <input id="pCoins" type="number" min="1" max="100000" placeholder="Награда, монет" aria-label="Награда">
     <input id="pMax" type="number" min="0" placeholder="Лимит активаций (0 = без лимита)" aria-label="Лимит">
     <button class="ok" onclick="createPromo()">Создать</button>${msg('promo','promoMsgA')}</div>
   <table><tr><th>Код</th><th>Награда</th><th>Активаций</th><th></th></tr>${promos.map(p=>`<tr><td>${p.code}</td><td>${+p.admin_days>=0?'Админ+ '+(+p.admin_days?p.admin_days+' дн.':'навсегда'):+p.vip_days?'VIP '+p.vip_days+' дн.':'+'+p.coins}</td><td>${p.used||0}${p.max?' / '+p.max:' / ∞'}</td><td>${p.builtin?'<span class="stat">встроенный</span>':`<button class="join" onclick="editPromo('${p.code}')">Изменить</button> <button class="join del" onclick="deletePromo('${p.code}')">Удалить</button>`}</td></tr>`).join('')}</table>`;
  return (can('grant')?admSec('grant',grantBlock):'')+(st.user.full?admSec('admins',gaBlock)+admSec('vip',vipBlock):'')+(st.user.isOwner?admSec('deputy',deputyBlock)+admSec('perms',permsAdmin()):'')+(can('promo')?admSec('promo',promoBlock):'')+(can('design')?admSec('design',designAdmin()):'');
}
function adminAction(verb){
  const t=($('#adminTarget')?.value||'').trim();
  if(!t){uiAlert('Укажите SteamID64 игрока (17 цифр)');return}
  uiAlert(`${t}: ${verb.toLowerCase()}`);
}
let scrollTick=false;
function updateReveal(){
  scrollTick=false;
  const z=document.querySelector('.reveal-zone');
  if(!z)return;
  const r=z.getBoundingClientRect(),vh=window.innerHeight||800;
  const e=reduce?1:Math.min(1,Math.max(0,(vh-r.top)/(vh*.9)));              // появление
  const q=reduce?.5:Math.min(1,Math.max(0,-r.top/Math.max(1,r.height-vh))); // прогресс, пока картинка закреплена
  z.style.setProperty('--e',e.toFixed(3));z.style.setProperty('--q',q.toFixed(3));
}
window.addEventListener('scroll',()=>{if(!scrollTick){scrollTick=true;requestAnimationFrame(updateReveal)}},{passive:true});
window.addEventListener('resize',updateReveal);
function draw(){
  saveUser();
  head();
  const app=$('#app'),html=view(),key=st.page+'|'+st.lb+'|'+st.bt+'|'+st.rule,changed=key!==prev.key;
  prev.key=key;
  app.classList.toggle('enter',changed);
  app.innerHTML=html;
  if(changed)app.querySelectorAll('tr,.plan,.mode,.admin-card,.admin-tools,.bar,.side,.empty,.stat,.set-card').forEach((e,i)=>e.style.setProperty('--i',Math.min(i,14)));
  urlSync();
  try{if(!['skins','profile','settings'].includes(st.page))SKN.k=null}catch(e){}
  if(typeof pfFx==='function')pfFx();
  if(typeof chatSync==='function')chatSync();
  updateReveal();
}
function personalTheme(){const t=LS.get('theme','blue');return LS.get('themePick',0)||t!=='blue'?t:null} // личный выбор игрока (иначе действует тема сайта)
applyTheme(personalTheme()||'blue',false);
draw();
loadSteamAvatar();

;

// ===== Данные в базе: вход, баланс, покупки, промокоды и админка идут через сервер =====
try{localStorage.removeItem('account')}catch(e){}
st.user=null;
async function api(p,b){
  const r=await fetch('/api/'+p,{method:b?'POST':'GET',headers:{'content-type':'application/json'},body:b?JSON.stringify(b):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||'Ошибка');
  return j;
}
let SV={grants:{},deputies:{},promos:[]};
function getGrants(){return SV.grants}
function getDeputies(){return SV.deputies}
function getCustomPromos(){return SV.promos}
function allPromos(){const m={};for(const p of SV.promos)m[p.code]=p;return m}
function applyRole(u){
  u.avatar=safeAvatar(u.avatar);
  u.isOwner=u.id===OWNER_STEAM_ID;
  u.plusUntil=Math.max(u.plus||0,u.grant||0);
  u.hasPlus=u.plusUntil>Date.now();
  u.isDeputy=!u.isOwner&&!!u.deputy;
  u.canManage=u.isOwner||u.isDeputy;
  u.full=u.isOwner||!!u.full; // владелец и назначенные замы
  u.perms=Array.isArray(u.perms)?u.perms:[];
  u.isAdmin=u.canManage||u.hasPlus||u.perms.length>0;
  u.role=u.isOwner?'Владелец':(u.isDeputy?'Зам':(u.hasPlus?'Админ+':(u.perms.length?'Модератор':null)));
  return u;
}
async function loadMe(){
  try{const m=await api('me');if(m){SV=m.adm||SV;delete m.adm;st.user=applyRole(m)}else st.user=null}catch(e){}
  if(!AUTH_READY){AUTH_READY=true;if(WANT_PAGE==='admin'&&st.page==='home')st.page='admin'}
  draw();
}
function steamLogin(){location.href='/auth/steam'}
function demoLogin(){uiAlert('Демо отключено — войдите через Steam')}
async function logout(){
  try{await fetch('/auth/logout',{method:'POST'})}catch(e){}
  st.user=null;st.menu=false;st.promoOpen=false;st.adminMsg={};
  if(st.page==='settings'||st.page==='admin')st.page='home';
  draw();
}
async function buyPlan(key,name){
  if(!st.user){uiAlert('Сначала войдите через Steam, чтобы купить');return}
  try{
    await api('buy',{key,idx:st.plan[key]});await loadMe();
    uiAlert(`Покупка успешна: ${name} ${key==='plus'?'навсегда':'на '+periods[st.plan[key]]}`+(key==='plus'?'. Рядом с промокодом появилась кнопка «Админ-панель».':''));
  }catch(e){uiAlert(e.message)}
}
async function activatePromo(){
  if(!st.user){st.promoMsg={ok:false,text:'Сначала войдите через Steam'};draw();return}
  const code=st.promo.trim().toUpperCase();
  if(!code){st.promoMsg={ok:false,text:'Введите код'};draw();return}
  try{const r=await api('promo',{code});st.promo='';st.promoMsg={ok:true,text:(r.msg||'Код активирован: +'+r.coins+' монет')}}
  catch(e){st.promoMsg={ok:false,text:e.message}}
  await loadMe();
}
const MID={vipgrant:'#vipMsg',grant:'#grantMsg',deputy:'#depMsg',promo:'#promoMsgA'};
async function adm(kind,path,body,ok){
  try{await api('admin/'+path,body);await loadMe();adminOk(kind,ok)}
  catch(e){adminMsgNow(MID[kind],e.message)}
}
function grantAdmin(){adm('grant','grant',{id:($('#grantId').value||'').trim(),name:($('#grantName')?.value||'').trim(),flags:($('#grantFlags')?.value||'').trim(),immunity:$('#grantImm')?.value||'',days:+$('#grantDays').value},'Админка выдана')}
function grantVip(){const f=$('#vipForever').checked,d=Math.floor(+$('#vipDays').value);if(!f&&!(d>=1))return adminMsgNow(MID.vipgrant,'Укажите срок в днях или отметьте «Навсегда»');adm('vipgrant','vip-grant',{id:($('#vipId').value||'').trim(),days:f?0:d},'VIP выдан')}
async function revokeVip(id){if(!await uiConfirm('Игрок '+id+' потеряет VIP. Запись будет удалена из базы игры.',{title:'Снять VIP?',ok:'Снять'}))return;adm('vipgrant','vip-revoke',{id},'VIP снят: '+id)}
async function revokeAdmin(id){if(!await uiConfirm('Админ '+id+' будет удалён. Строка исчезнет из базы игры, а срок Админ+ на сайте обнулится.',{title:'Удалить админа?',ok:'Удалить'}))return;adm('grant','revoke',{id},'Админка снята: '+id)}
function addDeputy(){adm('deputy','deputy',{id:($('#depId').value||'').trim(),on:true},'Зам назначен')}
function removeDeputy(id){adm('deputy','deputy',{id,on:false},'Зам снят: '+id)}
function createPromo(){adm('promo','promo',{code:($('#pCode').value||'').trim().toUpperCase(),coins:+$('#pCoins').value,max:Math.floor(+$('#pMax').value||0)},'Промокод создан')}
function deletePromo(code){adm('promo','promo-delete',{code},'Промокод удалён: '+code)}
loadMe();

;

// ===== Баны и муты через сайт =====
async function loadBans(){
  try{
    for(const k of ['bans','mutes']){
      const rows=await api('bans?type='+k),arr=k==='bans'?bans:mutes;
      arr.length=0;
      rows.forEach(r=>arr.push([r.player,r.admin,r.reason,r.active?1:0,r.term,new Date(r.at).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'})]));
    }
  }catch(e){}
  draw();
}
async function adminAction(verb){
  const t=($('#adminTarget')?.value||'').trim();
  if(!t){uiAlert('Укажите SteamID64 игрока (17 цифр)');return}
  if(verb==='Разбанен'||verb==='Размьючен'){
    if(!/^\d{17}$/.test(t)){uiAlert('Для разбана укажите SteamID64 игрока (17 цифр)');return}
    const fw=await uiForm(verb==='Разбанен'?'Разбанить игрока':'Снять мут',t,[{key:'why',label:'Причина',value:'Разбан с сайта'}],{ok:verb==='Разбанен'?'Разбанить':'Снять мут',danger:false});if(!fw)return;const why=fw.why;
    const isBan=verb==='Разбанен';
    try{
      const r=await api('admin/unban',{target:t,kind:isBan?'bans':'mutes',reason:why});
      await loadBans();
      uiAlert(r.count?((isBan?'Разбанен: ':'Мут снят: ')+t):('У этого игрока нет активных '+(isBan?'банов':'мутов')));
    }catch(e){uiAlert(e.message)}
    return;
  }
  if(verb!=='Забанен'&&verb!=='Замьючен'){uiAlert('Это действие выполняется прямо в игре — нужен плагин на игровом сервере.');return}
  const fp=await uiForm(verb==='Забанен'?'Забанить игрока':'Замьютить игрока',t,[{key:'reason',label:'Причина'},{key:'days',label:'На сколько дней? (0 = навсегда)',value:'7',type:'number'}],{ok:verb==='Забанен'?'Забанить':'Замьютить'});if(!fp)return;const reason=fp.reason,d=fp.days;
  try{
    await api('admin/punish',{target:t,kind:verb==='Забанен'?'bans':'mutes',reason,days:+d||0});
    await loadBans();
    uiAlert((verb==='Забанен'?'Бан':'Мут')+' записан: '+t);
  }catch(e){uiAlert(e.message)}
}
loadBans();

;

// ===== Лидеры из базы игрового сервера (LevelsRanks) =====
function lbWho(r){ // аватарка + ник (+ ссылка на профиль Steam, если известен SteamID)
  const a=safeAvatar(r[5]),n=String(r[0]||'');
  const av=`<i class="pa" style="${a?`background-image:url('${a}')`:''}">${a?'':esc((n||'?').trim().charAt(0).toUpperCase())}</i>`;
  const ok=/^\d{17}$/.test(r[6]||''),nm=ok?`<a class="lnk nm" href="/profile/${r[6]}" onclick="openProfile('${r[6]}');return false">${esc(n)}</a>`:esc(n);
  return `<span class="ppl">${av}<span>${nm}</span>${r[7]?'<span class="prem">ПРЕМИУМ</span>':''}</span>`;
}
async function loadLeaders(){
  try{
    const rows=await api('leaders');
    if(rows.length){
      leaders.exp=rows.map(r=>[r.name,r.exp.toLocaleString('ru-RU'),r.kills.toLocaleString('ru-RU'),(r.deaths?r.kills/r.deaths:r.kills).toFixed(2),r.hours+' ч.',r.avatar,r.id,r.prem]);
      draw();
    }
  }catch(e){}
}
loadLeaders();

// ===== Профиль игрока =====
async function openProfile(id,noPush){
  if(!/^\d{17}$/.test(id||''))return;
  PF.id=id;PF.data=null;PF.tab='info';PF.blocks=null;PF.err='';PF.busy=true;PF.fxFor=null;st.menu=false;st.promoOpen=false;st.page='profile';if(!noPush)NAV_PUSH=true;
  try{window.scrollTo(0,0)}catch(e){}
  draw();
  try{const d=await api('player/'+id);if(PF.id===id)PF.data=d}catch(e){PF.err=e.message}
  PF.busy=false;if(st.page==='profile')draw();
}
function pfAgo(ts){
  const m=Math.floor((Date.now()-ts)/6e4);
  if(m<5)return 'Был(-а) в игре только что';
  if(m<60)return 'Был(-а) в игре '+m+' мин. назад';
  const h=Math.floor(m/60);if(h<24)return 'Был(-а) в игре '+h+' ч. назад';
  const d=Math.floor(h/24);return 'Был(-а) в игре '+d+' дн. назад';
}
function pfCopy(t){try{navigator.clipboard.writeText(t)}catch(e){}}
async function pfTab(t){
  PF.tab=t;draw();
  if(t==='bans'&&!PF.blocks){const id=PF.id;
    try{const d=await api('player/'+id+'/blocks');if(PF.id===id)PF.blocks=d}
    catch(e){if(PF.id===id)PF.blocks={bans:[],mutes:[],err:e.message}}
    draw();}
}
function profileView(){
  const back=`<button class="pf-back" onclick="go('leaders')">← К лидерам</button>`;
  if(PF.err)return back+`<div class="empty">${esc(PF.err)}</div>`;
  const d=PF.data;if(!d)return back+`<div class="empty">Загружаем профиль…</div>`;
  const tab=PF.tab||'info';
  const a=safeAvatar(d.avatar),n=String(d.name||d.id),S=d.stats;
  const num=v=>v===null||v===undefined?'—':Number(v).toLocaleString('ru-RU');
  const kd=S&&S.kills!==null&&S.deaths!==null?(S.deaths?S.kills/S.deaths:S.kills).toFixed(2):'—';
  const acc=S&&S.shoots?(S.hits/S.shoots*100).toFixed(1)+'%':'—';
  const hs=S&&S.kills?(S.headshots/S.kills*100).toFixed(1)+'%':'—';
  const hours=S&&S.hours!==null&&S.hours!==undefined?S.hours.toLocaleString('ru-RU')+' ч.':'—';
  const place=S&&S.place!==null&&S.place!==undefined?'#'+S.place.toLocaleString('ru-RU'):'—';
  const topTxt=S&&S.place&&S.total?'Топ '+Math.max(0.1,S.place/S.total*100).toFixed(1)+'%':'';
  const expTxt=S&&S.exp!==null&&S.exp!==undefined?num(S.exp):'—';
  const rankTxt=S&&S.rank!==null&&S.rank!==undefined?String(S.rank):'—';
  let id32='—',id3='—';
  try{const x=BigInt(d.id)-76561197960265728n;id3='[U:1:'+x+']';id32='STEAM_1:'+(x%2n)+':'+(x/2n)}catch(e){}
  const ban=d.banned;
  const mine=st.user&&st.user.id===d.id,fx=PF.fxFor!==d.id;PF.fxFor=d.id;
  const kv=(l,v,s)=>`<div class="pf2-kv"><span>${l}</span><b>${v}</b>${s?`<small>${s}</small>`:''}</div>`;
  const panel=(t,body,i,wide)=>`<section class="pf2-panel" style="--i:${i}"><h3>${t}</h3><div class="pf2-row${wide?' wide':''}">${body}</div></section>`;
  const seen=d.lastSeen?pfAgo(d.lastSeen):(S?'':'Игрок ещё не заходил на сервер');
  const navBtn=(k,l)=>`<button class="${tab===k?'on':''}" onclick="pfTab('${k}')">${l}</button>`;
  const fmtDate=t=>t?new Date(t).toLocaleDateString('ru-RU'):'';
  const item=(x)=>`<div class="pf2-item"><b>${esc(x.reason||'Без причины')}</b><span>${esc(x.term)} · админ: ${esc(x.admin)}${x.at?' · '+fmtDate(x.at):''} · ${x.active?'активен':'снят'}</span></div>`;
  const list=(arr,empty)=>arr&&arr.length?arr.map(item).join(''):`<div class="pf2-empty">${empty}</div>`;

  let body='';
  if(tab==='info'){
    body=`<div class="pf2-grid">
        ${panel('Статистика',kv('Звание',rankTxt)+kv('Опыт',expTxt)+kv('Место',place,topTxt)+kv('Время игры',hours),0)}
        ${panel('Результативность',kv('Убийств',num(S&&S.kills))+kv('Смертей',num(S&&S.deaths))+kv('У/С',kd),1)}
        ${panel('Меткость',kv('Точность',acc)+kv('В голову',hs)+kv('Выстрелов',num(S&&S.shoots))+kv('Попаданий',num(S&&S.hits)),2)}
        ${panel('Steam ID',`<div class="pf2-kv pf2-copy"><span>SteamID32</span><b onclick="pfCopy('${id32}')">${id32}</b></div><div class="pf2-kv pf2-copy"><span>SteamID3</span><b onclick="pfCopy('${id3}')">${id3}</b></div>`,3,true)}
      </div>
      ${S?'':'<div class="pf2-note">Статистики пока нет — игрок не появлялся в таблице лидеров.</div>'}
      ${mine&&typeof skinsView==='function'?`<div class="pf-tabs"><button class="on">Скинченджер</button></div>${skinsView().replace('<h1>Скины</h1>','')}`:''}`;
  } else if(tab==='bans'){
    const b=PF.blocks;
    body=`<section class="pf2-panel pf2-wide"><h3>Блокировки</h3>
        ${!b?`<div class="pf2-empty">Загружаем…</div>`:`
        <div class="pf2-sec">Последние баны (${b.bans.length})</div>${list(b.bans,'Нет банов')}
        <div class="pf2-sec">Последние муты (${b.mutes.length})</div>${list(b.mutes,'Нет мутов')}`}
      </section>`;
  } else if(tab==='friends'){
    body=`<section class="pf2-panel pf2-wide"><h3>Друзья</h3><div class="pf2-empty">Друзей пока нет</div></section>`;
  } else {
    body=`<section class="pf2-panel pf2-wide"><h3>Транзакции</h3>
        <div class="pf2-sec">Донаты (0 ₽)</div><div class="pf2-empty">История пополнений пуста</div>
        <div class="pf2-sec">История покупок</div><div class="pf2-empty">Покупок пока нет</div>
      </section>`;
  }

  return `<div class="pf2-page ${fx?'pf-fx':''}">${back}
  <div class="pf2">
    <aside class="pf2-side">
      <div class="pf2-card"><div class="pf2-nav">
        ${navBtn('info','Информация')}${navBtn('bans','Блокировки')}${navBtn('friends','Друзья')}${navBtn('tx','Транзакции')}
      </div></div>
      <div class="pf2-card">
        <div class="pf2-label">Steam</div>
        <a class="pf2-steamlink" href="https://steamcommunity.com/profiles/${d.id}" target="_blank" rel="noopener">
          <span class="pf2-mini" style="${a?`background-image:url('${a}')`:''}"></span>
          <span><b>${esc(n)}</b><small>открыть профиль ↗</small></span></a>
      </div>
    </aside>
    <div class="pf2-main">
      <div class="pf2-hero">
        <div class="pf2-ava" style="${a?`background-image:url('${a}')`:''}">${a?'':esc(n.trim().charAt(0).toUpperCase())}</div>
        <div class="pf2-hinfo">
          <div class="pf2-name">${esc(n)}
            ${d.role?`<span class="pf-bdg role ${({'Владелец':'own','Зам':'dep','Админ+':'plus'})[d.role]||'mod'}">${esc(d.role)}</span>`:''}${d.banned?'<span class="pf-bdg ban">Заблокирован</span>':''}${d.vip?'<span class="pf-bdg vip">Премиум</span>':''}
          </div>
          <div class="pf2-seen">${seen}</div>
          <div class="pf2-xp"><i>//</i><b>${expTxt}</b></div>
        </div>
      </div>
      ${d.banned?`<div class="pf-banbox"><b>Игрок заблокирован</b> · срок: ${esc(d.banned.term)}${d.banned.reason?' · причина: '+esc(d.banned.reason):''}</div>`:''}
      ${mine?`<div class="pf-acts"><button class="join" onclick="go('settings')">Настройки</button><button class="join del" onclick="logout()">Выйти из аккаунта</button></div>`:''}
      ${body}
    </div>
  </div></div>`;
}
{const _v=view;view=function(){return st.page==='profile'?profileView():_v()}}
if(WANT_PROFILE){const id=WANT_PROFILE;WANT_PROFILE=null;openProfile(id,true)} // открыли ссылку вида /profile/<SteamID64>

;

(function(){
  const fx=document.createElement('div');fx.className='fx';fx.innerHTML='<i></i><i></i><i></i><i></i><i></i><i></i>';document.body.prepend(fx);
  const sp=document.createElement('div');sp.className='spot';document.body.prepend(sp);
  let px=0,py=0,pr=0;addEventListener('pointermove',e=>{px=e.clientX;py=e.clientY;if(!pr)pr=requestAnimationFrame(()=>{pr=0;sp.style.setProperty('--mx',px+'px');sp.style.setProperty('--my',py+'px');sp.style.opacity=1})},{passive:true});
  if(MOTION_OFF)return;
  const c=document.createElement('canvas');c.className='stars';document.body.prepend(c);
  const x=c.getContext('2d');let W,H,P=[],col='74,108,247';
  const size=()=>{W=c.width=innerWidth;H=c.height=innerHeight;P=Array.from({length:Math.min(70,Math.floor(W*H/22000))},()=>({x:Math.random()*W,y:Math.random()*H,r:Math.random()*1.8+.4,v:Math.random()*.25+.05,t:Math.random()*6.28}))};
  size();addEventListener('resize',size);
  let spr=null,sprCol='',lt=0;
  const mk=()=>{const k=document.createElement('canvas');k.width=k.height=32;const g=k.getContext('2d'),gr=g.createRadialGradient(16,16,0,16,16,16);gr.addColorStop(0,'rgba('+col+',1)');gr.addColorStop(.25,'rgba('+col+',.55)');gr.addColorStop(1,'rgba('+col+',0)');g.fillStyle=gr;g.fillRect(0,0,32,32);spr=k;sprCol=col};
  setInterval(()=>{if(!document.hidden)col=getComputedStyle(document.documentElement).getPropertyValue('--acc-rgb').trim()||col},1500);
  (function f(t){requestAnimationFrame(f);if(document.hidden||t-lt<33)return;lt=t;if(!spr||sprCol!==col)mk();
    x.clearRect(0,0,W,H);for(const p of P){p.y-=p.v*2;p.t+=.04;if(p.y<-5){p.y=H+5;p.x=Math.random()*W}
      x.globalAlpha=.35+.35*Math.sin(p.t);const d=p.r*5;x.drawImage(spr,p.x-d,p.y-d,d*2,d*2)}x.globalAlpha=1})(0);
})();

;

// ===== Скин-ченджер: страница «Скины» =====
const SKN={data:null,mine:{skins:{},knife:null},open:null,only:false,map:null,k:null,just:null,wear:0.01,seed:0,msg:'',busy:false,q:''};
const skEsc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
{const n=document.getElementById('nav');if(n){n.innerHTML='';head()}}
const _view=view;
view=function(){return st.page==='skins'?skinsView():_view()};
async function skLoad(){
  if(SKN.busy)return;SKN.busy=true;
  try{SKN.data=await api('skins')}catch(e){SKN.msg=e.message}
  if(SKN.data&&st.user){try{SKN.mine=await api('myskins')}catch(e){SKN.msg=e.message}}
  SKN.busy=false;draw();
}
const SK_ORDER=['Ножи','Автоматические винтовки','Снайперские винтовки','Пистолеты','Пистолеты-пулемёты','Дробовики','Пулемёты'];
const SK_HEX='<svg class="hex" viewBox="0 0 64 64" aria-hidden="true"><path class="h1" d="M32 6l22 13v26L32 58 10 45V19z" fill="none" stroke="currentColor" stroke-width="3"/><path class="h2" d="M32 20l11 6.5v13L32 46l-11-6.5v-13z" fill="none" stroke="currentColor" stroke-width="3"/></svg>';
const skMap=()=>SKN.map||(SKN.map=new Map(SKN.data.skins.map(s=>[s[0]+':'+s[2],s])));
function skCard(w,i){
  const m=SKN.mine.skins[w.def],s=m&&skMap().get(w.id+':'+m.paint),on=w.cat==='Ножи'&&SKN.mine.knife===w.id,hit=SKN.just&&SKN.just.w===w.id;
  return `<div class="sk-w${s?' has':''}${hit?' pulse':''}" style="--c:${s?skEsc(s[4]):'transparent'};--i:${Math.min(i,26)}" onclick="skOpen('${w.id}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter')skOpen('${w.id}')">${s&&/^https:/.test(s[3])?`<img loading="lazy" src="${skEsc(s[3])}" alt="">`:SK_HEX}<span class="wn">${skEsc(w.name)}${on?' · в игре':''}</span><b>${s?skEsc(s[1]):'Стандартный'}</b></div>`;
}
function skinsView(){
  if(!st.user)return '<h1>Скины</h1><div class="empty">Войдите через Steam, чтобы выбрать скины для оружия.</div>';
  if(!SKN.data){
    if(!SKN.busy&&!SKN.msg)skLoad();
    return '<h1>Скины</h1><div class="empty">'+(SKN.msg?skEsc(SKN.msg)+'<br><br><button class="join" onclick="SKN.msg=\'\';draw()">Повторить</button>':'Загружаем скины…')+'</div>';
  }
  const key=st.page+'|'+(PF.id||''),enter=SKN.k!==key;SKN.k=key; // анимация появления — только при открытии, а не при каждом выборе скина
  const D=SKN.data,cats=[...SK_ORDER,...new Set(D.weapons.map(w=>w.cat))].filter((c,i,a)=>a.indexOf(c)===i);
  let n=0;
  const body=cats.map(c=>{
    let ws=D.weapons.filter(w=>w.cat===c);if(SKN.only)ws=ws.filter(w=>SKN.mine.skins[w.def]);
    if(!ws.length)return '';
    const hd=`<h3 class="sk-cat" style="--i:${Math.min(n,26)}">${skEsc(c)}</h3>`;
    return hd+`<div class="sk-cards">${ws.map(w=>skCard(w,n++)).join('')}</div>`;
  }).join('');
  return `<h1>Скины</h1><div class="${enter?'sk-enter':''}">
  <div class="sk-top"><label class="sk-sw"><span>Только выбранные предметы</span><input type="checkbox" ${SKN.only?'checked':''} onchange="SKN.only=this.checked;SKN.k=null;draw()"><i></i></label><span class="sk-hint">Нажмите на оружие, чтобы выбрать скин. В игре напишите !wp, чтобы применить.</span></div>
  ${body||'<div class="empty">Пока ничего не выбрано — выключите «Только выбранные предметы».</div>'}</div>`;
}
function skOpen(id){SKN.open=id;SKN.q='';SKN.msg='';skModal()}
function skClose(){
  SKN.open=null;document.body.style.overflow='';
  const m=document.getElementById('skModal');if(!m)return;
  m.classList.add('out');setTimeout(()=>{if(!SKN.open&&m.parentNode)m.remove()},230);
}
function skModal(){
  if(!SKN.open||!SKN.data){skClose();return}
  const D=SKN.data,cur=D.weapons.find(w=>w.id===SKN.open);if(!cur){skClose();return}
  const my=SKN.mine.skins[cur.def],q=SKN.q.toLowerCase(),list=D.skins.filter(s=>s[0]===cur.id&&/^https:/.test(s[3]));
  let el=document.getElementById('skModal');
  const keep=el&&el.querySelector('.skm-body')?el.querySelector('.skm-body').scrollTop:0;
  if(!el){el=document.createElement('div');el.id='skModal';el.className='fresh';el.onclick=e=>{if(e.target===el)skClose()};document.body.appendChild(el);setTimeout(()=>el.classList.remove('fresh'),1000)}
  el.classList.remove('out');document.body.style.overflow='hidden';
  el.innerHTML=`<div class="skm" role="dialog" aria-modal="true"><div class="skm-head"><b>${skEsc(cur.name)}</b><button class="skm-x" onclick="skClose()" aria-label="Закрыть">✕</button></div>
  <div class="sk-ctl">
    <label>Износ <select onchange="SKN.wear=+this.value">${[['Factory New',0.01],['Minimal Wear',0.10],['Field-Tested',0.25],['Well-Worn',0.40],['Battle-Scarred',0.70]].map(([n,v])=>`<option value="${v}"${SKN.wear===v?' selected':''}>${n}</option>`).join('')}</select></label>
    <label>Seed <input type="number" min="0" max="1000" value="${SKN.seed}" onchange="SKN.seed=+this.value||0"></label>
    <input placeholder="Поиск скина" value="${skEsc(SKN.q)}" oninput="skQ(this.value)">
    ${my?'<button class="join del" onclick="skPick(0)">Сбросить скин</button>':''}
  </div>
  <p class="stat">${skEsc(SKN.msg)}</p>
  <div class="skm-body"><div class="sk-grid">${list.map((s,i)=>{const n=s[1].toLowerCase(),hit=SKN.just&&SKN.just.paint===s[2];return `<div class="sk-card${my&&my.paint===s[2]?' cur':''}${hit?' just':''}" data-n="${skEsc(n)}" style="--c:${skEsc(s[4])};--i:${Math.min(i,16)}${q&&!n.includes(q)?';display:none':''}" onclick="skPick(${s[2]})"><img loading="lazy" src="${skEsc(s[3])}" alt=""><b>${skEsc(s[1])}</b></div>`}).join('')||'<div class="empty">Для этого оружия скинов нет.</div>'}</div></div></div>`;
  const bd=el.querySelector('.skm-body');if(bd)bd.scrollTop=keep;
}
function skQ(v){SKN.q=v;const q=v.toLowerCase();document.querySelectorAll('#skModal .sk-card').forEach(c=>c.style.display=c.dataset.n.includes(q)?'':'none')}
async function skPick(paint){
  const cur=SKN.data.weapons.find(w=>w.id===SKN.open);if(!cur)return;
  try{
    await api('skin',{weapon:cur.id,paint,wear:SKN.wear,seed:SKN.seed});
    if(paint){SKN.mine.skins[cur.def]={paint,wear:SKN.wear,seed:SKN.seed};if(cur.cat==='Ножи')SKN.mine.knife=cur.id}else{delete SKN.mine.skins[cur.def];if(cur.cat==='Ножи'&&SKN.mine.knife===cur.id)SKN.mine.knife=null}
    SKN.msg=paint?'Скин сохранён. В игре напишите !wp, чтобы применить.':'Скин сброшен. В игре напишите !wp.';
    SKN.just={w:cur.id,paint};setTimeout(()=>{SKN.just=null},1000);
  }catch(e){SKN.msg=e.message}
  draw();skModal();
}
addEventListener('keydown',e=>{if(e.key==='Escape'&&SKN.open)skClose()});
// наклон и подсветка карточек за курсором (только на устройствах с мышью)
(function(){
  if(MOTION_OFF)return;
  let el=null,ev=null,raf=0;const rst=e=>{if(e){e.style.setProperty('--rx','0deg');e.style.setProperty('--ry','0deg')}};
  document.addEventListener('pointermove',e=>{
    const c=e.target.closest?e.target.closest('.sk-w,#skModal .sk-card,.pf-tile'):null;
    if(el&&el!==c)rst(el);el=c;if(!c)return;ev=e;
    if(raf)return;raf=requestAnimationFrame(()=>{raf=0;if(!el)return;
      const r=el.getBoundingClientRect(),x=(ev.clientX-r.left)/r.width,y=(ev.clientY-r.top)/r.height;
      el.style.setProperty('--ry',((x-.5)*14).toFixed(1)+'deg');el.style.setProperty('--rx',((.5-y)*14).toFixed(1)+'deg');
      el.style.setProperty('--mx',(x*100).toFixed(0)+'%');el.style.setProperty('--my',(y*100).toFixed(0)+'%')});
  },{passive:true});
  document.addEventListener('mouseleave',()=>{rst(el);el=null});
  const lift=e=>{if(e.pointerType&&e.pointerType!=='mouse'){rst(el);el=null}}; // на телефоне карточка выпрямляется, когда палец отпущен
  document.addEventListener('pointerup',lift);document.addEventListener('pointercancel',lift);
})();
// плавный подсчёт чисел в статистике профиля
function pfFx(){
  if(MOTION_OFF)return;
  document.querySelectorAll('.pf-fx .pf-tile b').forEach(b=>{
    if(b.dataset.done)return;b.dataset.done=1;
    const m=b.textContent.match(/^(#?)([\d\s\u00a0.,]+?)(\s*[^\d\s.,].*)?$/);if(!m)return;
    const raw=m[2].replace(/[\s\u00a0]/g,''),num=parseFloat(raw.replace(',','.'));if(!isFinite(num)||num<=0)return;
    const dec=(raw.split(/[.,]/)[1]||'').length,suf=m[3]||'',t0=performance.now(),D=1100;
    const f=t=>{const k=Math.min(1,(t-t0)/D),v=num*(1-Math.pow(1-k,4));b.textContent=m[1]+v.toLocaleString('ru-RU',{minimumFractionDigits:dec,maximumFractionDigits:dec})+suf;if(k<1)requestAnimationFrame(f)};
    requestAnimationFrame(f);
  });
}

// ===== Чат сайта =====
const CH={open:false,msgs:[],last:0,unread:0,k:null,timer:0,first:true,sound:false,hint:true,menu:false,canDel:false,seen:0};
try{CH.hasSeen=localStorage.chatSeen!==undefined;CH.sound=localStorage.chatSound==='1';CH.hint=localStorage.chatHint!=='0';CH.seen=+localStorage.chatSeen||0}catch(e){}
const CH_CROWN=c=>`<svg class="ch-crown" viewBox="0 0 24 24" fill="${c}" aria-hidden="true"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5z"/><rect x="5" y="19" width="14" height="2" rx="1"/></svg>`;
const CH_ICON='<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
function chatBuild(){
  if(document.getElementById('chatDock'))return;
  document.body.insertAdjacentHTML('beforeend',`
  <div id="chatDock"><button class="chat-pill" onclick="chatToggle(true)">Нужна помощь?</button><button class="chat-fab" onclick="chatToggle()" aria-label="Открыть чат">${CH_ICON}<i class="chat-badge" id="chatBadge"></i></button></div>
  <aside id="chatPanel" class="chat-panel" aria-label="Чат">
    <div class="chat-head"><span class="chat-title">${CH_ICON}Чат</span><span class="chat-btns"><button onclick="chatVoice()" title="Войс-чат" aria-label="Войс-чат">🎙</button><button onclick="chatMenu()" aria-label="Настройки чата">${I('gear')}</button><button onclick="chatToggle(false)" aria-label="Закрыть чат">✕</button></span>
      <div class="chat-menu" id="chatMenu"><label><span>Звук новых сообщений</span><input type="checkbox" id="chSound" onchange="chatSet('sound',this.checked)"><i></i></label><label><span>Подсказка «Нужна помощь?»</span><input type="checkbox" id="chHint" onchange="chatSet('hint',this.checked)"><i></i></label></div></div>
    <div class="chat-list" id="chatList"></div>
    <div class="chat-foot" id="chatFoot"></div>
  </aside>`);
  document.getElementById('chSound').checked=CH.sound;document.getElementById('chHint').checked=CH.hint;
  document.getElementById('chatDock').classList.toggle('nohint',!CH.hint);
  chatFoot();
}
function chatSet(k,v){CH[k]=v;try{localStorage['chat'+k[0].toUpperCase()+k.slice(1)]=v?'1':'0'}catch(e){}if(k==='hint')document.getElementById('chatDock').classList.toggle('nohint',!v)}
function chatMenu(){CH.menu=!CH.menu;document.getElementById('chatMenu').classList.toggle('on',CH.menu)}
function chatFoot(){
  const f=document.getElementById('chatFoot');if(!f)return;
  const keep=document.getElementById('chatIn')?document.getElementById('chatIn').value:'';
  f.innerHTML=st.user
    ?`<input id="chatIn" placeholder="Написать..." maxlength="300" autocomplete="off" onkeydown="if(event.key==='Enter')chatSend()"><button class="ch-send" onclick="chatSend()" aria-label="Отправить">${I('tg')}</button>`
    :`<button class="ch-login" onclick="steamLogin()">Войдите через Steam, чтобы писать</button>`;
  const i=document.getElementById('chatIn');if(i)i.value=keep;
}
function chatSync(){ // вошёл/вышел или изменились права — перерисовываем поле ввода и кнопки удаления
  const k=(st.user?st.user.id:'')+'|'+((st.user&&st.user.perms||[]).includes('ban')?1:0);
  if(k===CH.k)return;CH.k=k;CH.canDel=k.endsWith('|1');chatFoot();chatRender(true);
}
function chMsg(m){
  const a=safeAvatar(m.avatar),n=String(m.name||'Игрок'),cls=m.staff?'st':m.vip?'vp':'',d=new Date(m.at);
  const t=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  const text=esc(m.text).replace(/@[^\s,.!?:;]+/g,x=>`<span class="ch-men">${x}</span>`);
  return `<div class="ch-m ${cls}" data-id="${m.id}"><a class="ch-ava" href="/profile/${m.uid}" onclick="chatProfile('${m.uid}');return false" style="${a?`background-image:url('${a}')`:''}">${a?'':esc(n.trim().charAt(0).toUpperCase())}</a>
    <div class="ch-b"><div class="ch-t"><b class="ch-n">${esc(n)}</b>${m.staff?CH_CROWN('#f472b6'):m.vip?CH_CROWN('#6b8cff'):''}<time>${t}</time>${CH.canDel?`<button class="ch-del" onclick="chatDel(${m.id})" title="Удалить сообщение">✕</button>`:''}</div><div class="ch-x">${text}</div></div></div>`;
}
function chatProfile(id){if(innerWidth<700)chatToggle(false);openProfile(id)}
function chatRender(all){
  const list=document.getElementById('chatList');if(!list)return;
  const near=list.scrollHeight-list.scrollTop-list.clientHeight<90;
  if(all){list.innerHTML=CH.msgs.map(chMsg).join('')}
  else{
    const have=new Set([...list.children].map(e=>+e.dataset.id));
    [...list.children].forEach(e=>{if(!CH.msgs.some(m=>m.id===+e.dataset.id))e.remove()});
    CH.msgs.filter(m=>!have.has(m.id)).forEach(m=>{list.insertAdjacentHTML('beforeend',chMsg(m).replace('class="ch-m ','class="ch-m new '))});
  }
  if(near||all||CH.first)list.scrollTop=list.scrollHeight;
}
function chatBeep(){
  try{const C=window.AudioContext||window.webkitAudioContext,c=CH.ac||(CH.ac=new C()),o=c.createOscillator(),g=c.createGain();
    o.type='sine';o.frequency.value=880;g.gain.setValueAtTime(.0001,c.currentTime);g.gain.exponentialRampToValueAtTime(.08,c.currentTime+.02);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.25);
    o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.26)}catch(e){}
}
async function chatPoll(){
  clearTimeout(CH.timer);
  try{
    const r=await api('chat?after='+CH.last);
    const live=new Set(r.live),min=Math.min(...r.live,Infinity);
    const before=CH.msgs.length;
    CH.msgs=r.live.length?CH.msgs.filter(m=>m.id<min||live.has(m.id)):[]; // удалённые модератором исчезают
    const fresh=r.msgs.filter(m=>!CH.msgs.some(x=>x.id===m.id));
    CH.msgs=CH.msgs.concat(fresh).slice(-120);
    if(fresh.length){
      CH.last=Math.max(CH.last,...fresh.map(m=>m.id));
      if(CH.first&&!CH.hasSeen){CH.seen=CH.last;CH.hasSeen=true} // новый посетитель: старая история не считается непрочитанной
      const mine=st.user?st.user.id:null,theirs=fresh.filter(m=>m.uid!==mine);
      if(!CH.open){
        CH.unread+=theirs.filter(m=>m.id>CH.seen).length;
        if(!CH.first&&theirs.length&&CH.sound)chatBeep();
      }else if(theirs.length&&CH.sound&&!CH.first)chatBeep();
    }
    if(fresh.length||CH.msgs.length!==before)chatRender(false);
    CH.first=false;chatBadge();
  }catch(e){}
  CH.timer=setTimeout(chatPoll,document.hidden?30000:CH.open?3500:15000);
}
function chatBadge(){const b=document.getElementById('chatBadge');if(!b)return;b.textContent=CH.unread>9?'9+':CH.unread;b.classList.toggle('on',CH.unread>0)}
function chatToggle(v){
  const p=document.getElementById('chatPanel');if(!p)return;
  CH.open=v===undefined?!CH.open:v;
  p.classList.toggle('open',CH.open);document.getElementById('chatDock')?.classList.toggle('hide',CH.open&&innerWidth<700);
  if(CH.open){
    CH.unread=0;CH.seen=CH.last;try{localStorage.chatSeen=CH.last}catch(e){}chatBadge();
    const l=document.getElementById('chatList');l.scrollTop=l.scrollHeight;
    const i=document.getElementById('chatIn');if(i&&matchMedia('(hover:hover)').matches)setTimeout(()=>i.focus(),250);
    chatPoll();
  }else{CH.menu=false;document.getElementById('chatMenu').classList.remove('on')}
}
async function chatSend(){
  const i=document.getElementById('chatIn');if(!i)return;const text=i.value.trim();if(!text||CH.busy)return;
  CH.busy=true;
  try{await api('chat',{text});i.value='';CH.first=true;await chatPoll();CH.seen=CH.last;try{localStorage.chatSeen=CH.last}catch(e){}}
  catch(e){toast(e.message,'err')}
  CH.busy=false;if(i&&matchMedia('(hover:hover)').matches)i.focus();
}
async function chatDel(id){try{await api('chat/delete',{id});CH.msgs=CH.msgs.filter(m=>m.id!==id);chatRender(false)}catch(e){toast(e.message,'err')}}
addEventListener('keydown',e=>{if(e.key==='Escape'&&CH.open&&!document.getElementById('promoModal')&&!document.getElementById('skModal'))chatToggle(false)});
// Плавающая кнопка чата убрана: чат открывается только по ссылке /chat

// ===== Красивые окна подтверждения вместо браузерных confirm/alert/prompt =====
let UI_CLOSE=null;
function uiDialog({title='',text='',fields=[],ok='ОК',cancel='Отмена',danger=false}={}){
  return new Promise(res=>{
    if(UI_CLOSE)UI_CLOSE(null);
    const el=document.createElement('div');el.id='uiDlg';el.className='fresh';
    el.innerHTML=`<div class="dlg" role="dialog" aria-modal="true">${title?`<h3>${esc(title)}</h3>`:''}${text?`<p>${esc(text).replace(/\n/g,'<br>')}</p>`:''}
      ${fields.map(f=>`<label class="dlg-f">${esc(f.label||'')}<input data-k="${esc(f.key)}" type="${f.type||'text'}" value="${esc(f.value===undefined?'':f.value)}" autocomplete="off"></label>`).join('')}
      <div class="dlg-b">${cancel===false?'':`<button class="dlg-c" type="button">${esc(cancel)}</button>`}<button class="dlg-ok${danger?' danger':''}" type="button">${esc(ok)}</button></div></div>`;
    document.body.appendChild(el);setTimeout(()=>el.classList.remove('fresh'),700);
    let closed=false;
    const done=v=>{if(closed)return;closed=true;UI_CLOSE=null;removeEventListener('keydown',key,true);el.classList.add('out');setTimeout(()=>el.remove(),220);res(v)};
    const submit=()=>{const o={};el.querySelectorAll('input').forEach(i=>o[i.dataset.k]=i.value);done(fields.length?o:true)};
    const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();done(null)}else if(e.key==='Enter'){e.preventDefault();e.stopPropagation();submit()}};
    UI_CLOSE=done;addEventListener('keydown',key,true);
    el.onclick=e=>{if(e.target===el&&cancel!==false)done(null)};
    el.querySelector('.dlg-ok').onclick=submit;
    const c=el.querySelector('.dlg-c');if(c)c.onclick=()=>done(null);
    const first=el.querySelector('input');(first||el.querySelector('.dlg-ok')).focus();if(first)first.select();
  });
}
const uiConfirm=(text,o={})=>uiDialog({title:o.title||'Подтвердите действие',text,ok:o.ok||'Подтвердить',danger:o.danger!==false}).then(v=>!!v);
const uiForm=(title,text,fields,o={})=>uiDialog({title,text,fields,ok:o.ok||'Готово',danger:!!o.danger});
const uiAlert=(text,title)=>uiDialog({title:title||'',text:String(text),ok:'Понятно',cancel:false}).then(()=>{});

;

function settingsSkins(){return skinsView().replace('<h1>Скины</h1>','<h2 style="margin:28px 0 6px">Скины оружия</h2>')}

;

// ===== Уведомления (заменяют системные alert) =====
(function(){
  let box;
  const ICON={ok:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',err:'<path d="M6 6l12 12M18 6L6 18"/>',info:'<path d="M12 7.5h.01M11 11.5h1.2v5.5"/>'};
  const ERR=/^(не |нельзя|ошибк|недостаточно|неверн|нет |укажите|введите|сначала|такого|такой|лимит|этот код|войдите|вашего|для разбана)|не удалось|не найден|не настроен|исчерпан/i;
  const OK=/успешн|применён|сохранён|активирован|выдана|снята|записан|разбанен|создан|удалён|назначен|скопировано|мут снят/i;
  window.toast=function(msg,type){
    msg=String(msg==null?'':msg);type=type||(ERR.test(msg)?'err':OK.test(msg)?'ok':'info');
    if(!box){box=document.createElement('div');box.className='toasts';document.body.appendChild(box)}
    const t=document.createElement('div'),ms=Math.min(9000,3500+msg.length*45);
    t.className='toast '+type;t.style.setProperty('--td',ms+'ms');
    t.innerHTML='<div class="ti"><svg viewBox="0 0 24 24">'+ICON[type]+'</svg></div><div>'+esc(msg)+'</div><i class="tb"></i>';
    const close=()=>{if(t.classList.contains('out'))return;t.classList.add('out');setTimeout(()=>t.remove(),350)};
    let timer=setTimeout(close,ms);
    t.onclick=close;t.onmouseenter=()=>clearTimeout(timer);t.onmouseleave=()=>{timer=setTimeout(close,1500)};
    box.appendChild(t);while(box.children.length>4)box.firstChild.remove();
  };
  window.alert=m=>window.toast(m);
  window.ask=function(title,fields,okText){return new Promise(res=>{
    const o=document.createElement('div');o.className='ask-back';
    o.innerHTML='<div class="ask-box"><h3>'+esc(title)+'</h3>'+fields.map((f,i)=>'<label>'+esc(f.label)+(f.options
      ?'<select data-i="'+i+'">'+f.options.map(([v,t])=>'<option value="'+v+'"'+(v==f.value?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select>'
      :'<input data-i="'+i+'" type="text" value="'+esc(f.value||'')+'" placeholder="'+esc(f.ph||'')+'">')+'</label>').join('')
      +'<div class="ask-row"><button class="ask-no">Отмена</button><button class="ask-ok">'+esc(okText||'Подтвердить')+'</button></div></div>';
    document.body.appendChild(o);
    const els=[...o.querySelectorAll('[data-i]')],done=v=>{o.classList.add('out');setTimeout(()=>o.remove(),250);res(v)};
    o.querySelector('.ask-ok').onclick=()=>done(els.map(e=>e.value));
    o.querySelector('.ask-no').onclick=()=>done(null);
    o.onclick=e=>{if(e.target===o)done(null)};
    o.onkeydown=e=>{if(e.key==='Enter')o.querySelector('.ask-ok').click();if(e.key==='Escape')done(null)};
    if(els[0])els[0].focus();
  })};
})();
// ===== Промокоды: окно активации и создание своего промокода =====
const PM={view:'use',code:'',coins:'10',max:'3',msg:null,busy:false};
const PM_TICKET='<svg class="pm-ticket" viewBox="0 0 160 90" aria-hidden="true"><defs><linearGradient id="pmg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7aa8ff"/><stop offset="1" stop-color="#3b4fd8"/></linearGradient></defs><path d="M10 14h140v18a8 8 0 0 0 0 16v28H10V48a8 8 0 0 0 0-16z" fill="url(#pmg)"/><text x="80" y="62" text-anchor="middle" font-size="34" font-weight="900" fill="#1a2a78" letter-spacing="4">XXXX</text></svg>';
function togglePromo(){PM.view='use';PM.msg=null;PM.code=st.promo||'';st.menu=false;promoModal()}
function closePromo(){document.body.style.overflow='';const m=document.getElementById('promoModal');if(!m)return;m.classList.add('out');setTimeout(()=>{if(m.parentNode&&m.classList.contains('out'))m.remove()},230)}
function promoView(v){PM.view=v;PM.msg=null;promoModal()}
function pmCost(){const c=Math.floor(+PM.coins),m=Math.floor(+PM.max);return c>0&&m>0?c*m:0}
function pmProblem(){ // что мешает создать промокод прямо сейчас (null — ничего)
  const c=Math.floor(+PM.coins),m=Math.floor(+PM.max),bal=+(st.user&&st.user.coins)||0;
  if(!/^[\p{L}\p{N}_-]{3,20}$/u.test(PM.code.trim()))return 'Код: 3–20 символов — буквы, цифры, _ или -';
  if(!(c>=10&&c<=10000))return 'Сумма: от 10 до 10 000';
  if(!(m>=3&&m<=1000))return 'Активаций: от 3 до 1000';
  if(pmCost()>bal)return 'Не хватает монет';
  return null;
}
function pmCalc(){ // пересчитываем цену и кнопку без перерисовки окна, чтобы не терялся фокус
  const b=document.getElementById('pmCreate');if(!b)return;
  b.disabled=!!pmProblem();b.firstElementChild.textContent='Создать промокод за '+pmCost().toLocaleString('ru-RU');
}
function promoModal(){
  let el=document.getElementById('promoModal');
  if(!el){el=document.createElement('div');el.id='promoModal';el.className='fresh';el.onclick=e=>{if(e.target===el)closePromo()};document.body.appendChild(el);setTimeout(()=>el.classList.remove('fresh'),900)}
  el.classList.remove('out');document.body.style.overflow='hidden';
  const msg=PM.msg?`<p class="pm-msg ${PM.msg.ok?'ok':'err'}">${esc(PM.msg.text)}</p>`:'<p class="pm-msg"></p>';
  if(PM.view==='create'){
    el.innerHTML=`<div class="pm-wrap"><div class="pm-card" role="dialog" aria-modal="true">
      <div class="pm-head"><h2>СОЗДАТЬ ПРОМОКОД</h2><button class="pm-x" onclick="closePromo()" aria-label="Закрыть">✕</button></div>
      <label class="pm-l">Введите промокод</label><input class="pm-in" id="pmCode" placeholder="XXXXXXXX" maxlength="20" autocomplete="off" value="${esc(PM.code)}" oninput="PM.code=this.value;pmCalc()">
      <label class="pm-l">Сумма промокода (монет за одну активацию)</label><input class="pm-in" type="number" min="10" max="10000" value="${esc(PM.coins)}" oninput="PM.coins=this.value;pmCalc()"><small>От 10 до 10 000 монет</small>
      <label class="pm-l">Кол-во активаций</label><input class="pm-in" type="number" min="3" max="1000" value="${esc(PM.max)}" oninput="PM.max=this.value;pmCalc()"><small>От 3 до 1000 активаций</small>
      ${msg}
      <button class="pm-main" id="pmCreate" onclick="createUserPromo()" ${pmProblem()?'disabled':''}><span>Создать промокод за ${pmCost().toLocaleString('ru-RU')}</span></button>
      <button class="pm-alt in" onclick="promoView('use')">Назад</button></div></div>`;
  }else{
    el.innerHTML=`<div class="pm-wrap">${PM_TICKET}<div class="pm-card" role="dialog" aria-modal="true">
      <div class="pm-head"><h2>ПРОМОКОД</h2><button class="pm-x" onclick="closePromo()" aria-label="Закрыть">✕</button></div>
      <input class="pm-in" id="pmCode" placeholder="XXXXXXXX" maxlength="32" autocomplete="off" value="${esc(PM.code)}" oninput="PM.code=this.value;st.promo=this.value" onkeydown="if(event.key==='Enter')activatePromo()">
      ${msg}
      <button class="pm-main" onclick="activatePromo()">${I('promo')}<span>Активировать промокод</span></button></div>
      <button class="pm-alt" onclick="promoView('create')">+ Создать свой промокод</button></div>`;
  }
  const inp=el.querySelector('#pmCode');if(inp&&matchMedia('(hover:hover)').matches)inp.focus();
}
async function activatePromo(){
  if(!st.user){PM.msg={ok:false,text:'Сначала войдите через Steam'};promoModal();return}
  const code=(PM.code||st.promo||'').trim().toUpperCase();
  if(!code){PM.msg={ok:false,text:'Введите код'};promoModal();return}
  try{const r=await api('promo',{code});st.promo='';PM.code='';closePromo();await loadMe();toast((r.msg||'Код активирован: +'+r.coins+' монет'),'ok')}
  catch(e){PM.msg={ok:false,text:e.message};promoModal()}
}
async function createUserPromo(){
  if(!st.user){PM.msg={ok:false,text:'Сначала войдите через Steam'};promoModal();return}
  const bad=pmProblem();if(bad){PM.msg={ok:false,text:bad};promoModal();return}
  if(PM.busy)return;PM.busy=true;
  try{
    const r=await api('promo/create',{code:PM.code.trim().toUpperCase(),coins:Math.floor(+PM.coins),max:Math.floor(+PM.max)});
    PM.code='';PM.view='use';PM.msg=null;closePromo();await loadMe();toast('Промокод '+r.code+' создан, списано '+r.cost+' монет','ok');
  }catch(e){PM.msg={ok:false,text:e.message};promoModal()}
  PM.busy=false;
}
addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('promoModal'))closePromo()});
async function adminAction(verb){
  const t=($('#adminTarget')?.value||'').trim();
  if(!t){toast('Укажите SteamID64 игрока (17 цифр)');return}
  const unb=verb==='Разбанен'||verb==='Размьючен',pun=verb==='Забанен'||verb==='Замьючен',isBan=verb==='Забанен'||verb==='Разбанен';
  if(!unb&&!pun){toast('Это действие выполняется прямо в игре — нужен плагин на игровом сервере.','info');return}
  if(!/^\d{17}$/.test(t)){toast('Укажите SteamID64 игрока (17 цифр)');return}
  if(unb){
    const v=await ask((isBan?'Разбанить ':'Снять мут: ')+t,[{label:'Причина',value:'Разбан с сайта'}],'Подтвердить');if(!v)return;
    try{const r=await api('admin/unban',{target:t,kind:isBan?'bans':'mutes',reason:v[0]});await loadBans();
      toast(r.count?((isBan?'Разбанен: ':'Мут снят: ')+t):('У этого игрока нет активных '+(isBan?'банов':'мутов')),r.count?'ok':'info')}
    catch(e){toast(e.message,'err')}
    return;
  }
  const v=await ask((isBan?'Забанить ':'Замьютить ')+t,[{label:'Причина',ph:'Например: читы'},{label:'Срок',value:'7',options:[['1','1 день'],['7','7 дней'],['30','30 дней'],['90','90 дней'],['0','Навсегда']]}],isBan?'Забанить':'Замьютить');
  if(!v)return;
  try{await api('admin/punish',{target:t,kind:isBan?'bans':'mutes',reason:v[0],days:+v[1]});await loadBans();toast((isBan?'Бан':'Мут')+' записан: '+t,'ok')}
  catch(e){toast(e.message,'err')}
}

;

// ===== Серверы: владелец добавляет и удаляет =====
let SRVDB=[];
async function loadServers(){
  try{SRVDB=await api('servers');servers.length=0;SRVDB.forEach(r=>servers.push([r.name,r.address]))}catch(e){}
  draw();
}
const _aos=adminOwnerSections;
adminOwnerSections=function(){return _aos()+(can('server')?admSec('servers',serversAdmin()):'')};
function serversAdmin(){
  return `<h2 class="sec">Серверы</h2>
   <div class="admin-tools"><input id="srvName" placeholder="Название (например: Мираж)" maxlength="60" aria-label="Название сервера"><input id="srvAddr" placeholder="Адрес: 45.95.31.64:27215" maxlength="70" aria-label="Адрес сервера"><button class="ok" onclick="addServer()">Добавить</button></div>
   ${SRVDB.length?`<table><tr><th>Сервер</th><th>Адрес</th><th></th></tr>${SRVDB.map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.address)}</td><td><button class="join" onclick="loadPlayers(${+r.id})">Игроки</button> <button class="join" onclick="setServerMode(${+r.id})">Режим</button> <button class="join" onclick="restartServer(${+r.id})">Перезагрузить</button> <button class="join del" onclick="delServer(${+r.id})">Удалить</button></td></tr>`).join('')}</table>`:'<div class="empty">Серверов пока нет.</div>'}${playersPanel()}`;
}
let SRVPL=null;
function playersPanel(){
  if(!SRVPL)return '';
  const r=SRVDB.find(x=>x.id===SRVPL.id);
  const rows=SRVPL.players.map(p=>`<tr><td>${esc(p.name)}</td><td>#${esc(p.userid)}</td><td><button class="join del" onclick="kickPlayer(${+p.userid})">Кикнуть</button></td></tr>`).join('');
  return `<h3 class="sec">Игроки онлайн: ${esc(r?r.name:'')}</h3>${SRVPL.players.length?`<table><tr><th>Ник</th><th>Номер</th><th></th></tr>${rows}</table>`:`<div class="empty">Игроков не найдено.${SRVPL.raw?`<pre class="stat" style="white-space:pre-wrap;margin-top:8px;text-align:left">${esc(SRVPL.raw)}</pre>`:''}</div>`}<div class="admin-tools"><button class="ok" onclick="loadPlayers(${+SRVPL.id})">Обновить список</button> <button class="join" onclick="SRVPL=null;draw()">Закрыть</button></div>`;
}
async function loadPlayers(id){
  try{const j=await api('admin/server-players',{id});SRVPL={id,players:j.players,raw:j.raw};draw()}catch(e){toast(e.message,'err')}
}
async function kickPlayer(userid){
  if(!SRVPL)return;
  const p=SRVPL.players.find(x=>+x.userid===userid);if(!p)return;
  if(!await ask('Кикнуть игрока «'+p.name+'» с сервера?',[],'Кикнуть'))return;
  try{await api('admin/server-kick',{id:SRVPL.id,userid:String(userid)});toast('Игрок «'+p.name+'» кикнут','ok');await loadPlayers(SRVPL.id)}catch(e){toast(e.message,'err')}
}
async function addServer(){
  const name=($('#srvName')?.value||'').trim(),address=($('#srvAddr')?.value||'').trim();
  try{await api('admin/server',{name,address});await loadServers();toast('Сервер добавлен: '+name,'ok')}catch(e){toast(e.message,'err')}
}
async function restartServer(id){
  const r=SRVDB.find(x=>x.id===id);if(!r)return;
  if(!await ask('Перезагрузить сервер «'+r.name+'»? Все игроки будут отключены.',[],'Перезагрузить'))return;
  try{await api('admin/server-restart',{id});toast('Команда отправлена: «'+r.name+'» перезагружается','ok')}catch(e){toast(e.message,'err')}
}
async function delServer(id){
  const r=SRVDB.find(x=>x.id===id);if(!r)return;
  if(!await ask('Удалить сервер «'+r.name+'»?',[],'Удалить'))return;
  try{await api('admin/server-delete',{id});await loadServers();toast('Сервер удалён','ok')}catch(e){toast(e.message,'err')}
}
loadServers();

;

// ===== Плавающая плашка под активным пунктом меню =====
function movePill(){
  const nav=document.getElementById('nav');if(!nav)return;
  const on=nav.querySelector('button.on');let pill=nav.querySelector('.navpill');
  if(!pill){if(!nav.children.length)return;pill=document.createElement('div');pill.className='navpill';nav.appendChild(pill)}
  if(!on){pill.style.opacity=0;return}
  pill.style.width=on.offsetWidth+'px';pill.style.height=on.offsetHeight+'px';
  pill.style.transform='translate('+on.offsetLeft+'px,'+on.offsetTop+'px)';pill.style.opacity=1;
}
{const _d=draw;draw=function(){_d.apply(this,arguments);requestAnimationFrame(movePill)}}
addEventListener('resize',movePill);
setTimeout(()=>{movePill();draw()},60);
// ===== Агенты (в настройках, под скинами) =====
const AG={data:null,loading:false,err:'',team:'ct',mine:{ct:null,t:null}};
async function agLoad(){
  if(AG.loading||AG.data)return;AG.loading=true;AG.err='';
  try{AG.data=(await api('agents')).agents}catch(e){AG.err=e.message}
  try{const m=await api('myagents');AG.mine={ct:m.ct||null,t:m.t||null}}catch(e){}
  AG.loading=false;draw();
}
function agentsBlock(){
  if(!st.user)return '';
  const head='<h2 style="margin:28px 0 6px">Агенты</h2>';
  if(!AG.data){if(!AG.err)agLoad();return head+'<p class="stat">'+esc(AG.err||'Загружаем агентов…')+'</p>'+(AG.err?'<button class="join" onclick="AG.err=\'\';draw()">Повторить</button>':'')}
  if(!AG.data.length)return head+'<p class="stat">Список агентов пока пуст.</p>';
  const cur=AG.mine[AG.team];
  return head+`<p class="stat">Выберите агента для каждой команды, затем в игре введите <b>!wp</b>.</p>
   <div class="ag-tabs"><button class="${AG.team==='ct'?'on':''}" onclick="AG.team='ct';draw()">Спецназ (CT)</button><button class="${AG.team==='t'?'on':''}" onclick="AG.team='t';draw()">Террористы (T)</button>${cur?'<button class="join del" onclick="agReset()">Сбросить агента</button>':''}</div>
   <div class="ag-grid">${AG.data.map((a,i)=>a.team!==AG.team?'':`<div class="ag-card${a.model===cur?' on':''}" style="--rc:${esc(a.col)}" onclick="agPick(${i})"><img loading="lazy" src="${esc(a.image)}" alt=""><b>${esc(a.name)}</b></div>`).join('')}</div>`;
}
async function agPick(i){
  const a=AG.data[i];if(!a)return;
  try{await api('agent',{team:a.team,model:a.model});AG.mine[a.team]=a.model;draw();toast('Агент выбран: '+a.name+'. В игре введите !wp, чтобы обновить.','ok')}
  catch(e){toast(e.message,'err')}
}
async function agReset(){
  try{await api('agent-reset',{team:AG.team});AG.mine[AG.team]=null;draw();toast('Агент сброшен','ok')}catch(e){toast(e.message,'err')}
}
{const _ss=settingsSkins;settingsSkins=function(){return _ss()+agentsBlock()}}

;

(function(){
  const reduce=MOTION_OFF;
  // плавный уход страницы перед показом новой
  const _go=go;
  window.go=function(p){
    const a=document.getElementById('app');
    if(reduce||!a||p===st.page){_go(p);return}
    a.classList.add('leave');
    setTimeout(()=>{a.classList.remove('leave');_go(p)},150);
  };
  // волна при нажатии на кнопки
  document.addEventListener('pointerdown',e=>{
    if(reduce||!e.target.closest)return;
    const b=e.target.closest('.join,.steam,.promo-btn,nav button,.plan .buy,.ask-row button,.sk-ws button,.tabs button,.ag-tabs button,.promo-pop>button,.admin-tools button');
    if(!b)return;b.classList.add('rip');
    const r=b.getBoundingClientRect(),s=Math.max(r.width,r.height)*2,x=document.createElement('span');
    x.className='ripple';x.style.cssText='width:'+s+'px;height:'+s+'px;left:'+(e.clientX-r.left-s/2)+'px;top:'+(e.clientY-r.top-s/2)+'px';
    b.appendChild(x);setTimeout(()=>x.remove(),650);
  });
})();

;

// ===== Права доступа и дизайн сайта =====
function can(p){return !!(st.user&&(st.user.isOwner||(st.user.perms||[]).includes(p)))}
const PERM_LABELS={ban:'Банить и мутить',unban:'Разбанивать и снимать мут',grant:'Выдавать и снимать Админ+',promo:'Промокоды',server:'Серверы',design:'Дизайн сайта'};
MID.perms='#permMsg';MID.design='#designMsg';MID.gaedit='#gaeMsg';
function editAdmin(id){
  const a=(SV.admins||[]).find(x=>x.id===id);if(!a)return;
  $('#gaeId').value=a.id;$('#gaeName').value=a.name||'';$('#gaeFlags').value=a.flags||'';$('#gaeImm').value=a.imm;
  $('#gaeDays').value='keep';$('#gaeOff').checked=!!a.off;
  $('#gaeId').scrollIntoView({block:'center',behavior:'smooth'});$('#gaeName').focus();
}
function saveAdminEdit(){
  const id=($('#gaeId').value||'').trim();
  if(!/^\d{17}$/.test(id))return adminMsgNow('#gaeMsg','Сначала нажмите «Изменить» у админа в таблице');
  adm('gaedit','admin-edit',{id,name:($('#gaeName').value||'').trim(),flags:($('#gaeFlags').value||'').trim(),immunity:$('#gaeImm').value,days:$('#gaeDays').value,off:$('#gaeOff').checked},'Админ изменён в базе: '+id);
}
async function editPromo(code){
  const p=allPromos()[code];if(!p)return;
  const fe=await uiForm('Промокод '+code,'',[{key:'c',label:'Награда в монетах',value:p.coins,type:'number'},{key:'m',label:'Лимит активаций (0 = без лимита)',value:p.max||0,type:'number'}],{ok:'Сохранить',danger:false});if(!fe)return;const c=fe.c,m=fe.m;
  adm('promo','promo-edit',{code,coins:+c,max:Math.floor(+m||0)},'Промокод изменён: '+code);
}
function permsAdmin(){
  const m=(st.adminMsg||{}).perms,list=Object.entries(SV.perms||{});
  return `<h2 class="sec">Права доступа</h2>
   <div class="admin-tools"><input id="permId" placeholder="SteamID64 игрока (17 цифр)" inputmode="numeric" maxlength="17" aria-label="SteamID64">
     <div class="perm-grid">${Object.entries(PERM_LABELS).map(([k,t])=>`<label class="perm"><input type="checkbox" data-perm="${k}">${t}</label>`).join('')}</div>
     <button class="ok" onclick="savePerms()">Сохранить права</button><div id="permMsg" class="promo-msg ${m?(m.ok?'ok':'err'):''}">${m?esc(m.text):''}</div></div>
   <p class="stat" style="margin-bottom:10px">Права выдаются поверх роли: заместитель уже умеет банить, разбанивать и выдавать «Админ+». Чтобы банить с сайта, игрок должен быть в списке админов игры. Назначение замов и выдача прав — только у владельца.</p>
   ${list.length?`<table><tr><th>Игрок</th><th>Права</th><th></th></tr>${list.map(([id,p])=>`<tr><td>${ppl(id,p.name,p.avatar)}</td><td>${esc(p.perms.map(k=>PERM_LABELS[k]||k).join(', '))}</td><td><button class="join" onclick="editPerms('${id}')">Изменить</button> <button class="join del" onclick="clearPerms('${id}')">Снять все</button></td></tr>`).join('')}</table>`:'<div class="empty">Отдельные права пока никому не выданы.</div>'}`;
}
function editPerms(id){
  const p=(SV.perms||{})[id],el=$('#permId');
  if(el){el.value=id;el.scrollIntoView({block:'center',behavior:'smooth'})}
  document.querySelectorAll('[data-perm]').forEach(c=>c.checked=!!(p&&p.perms.includes(c.dataset.perm)));
}
function savePerms(){
  const id=($('#permId').value||'').trim(),perms=[...document.querySelectorAll('[data-perm]')].filter(c=>c.checked).map(c=>c.dataset.perm);
  adm('perms','perms',{id,perms},perms.length?'Права сохранены: '+id:'Права сняты: '+id);
}
async function clearPerms(id){if(!await uiConfirm('У игрока '+id+' будут сняты все отдельные права.',{title:'Снять права?',ok:'Снять'}))return;adm('perms','perms',{id,perms:[]},'Права сняты: '+id)}

let SITE={theme:'red',checkerUrl:''};
async function loadSite(){
  try{SITE=await api('site')}catch(e){}
  if(!personalTheme())applyTheme(SITE.theme||'red',false);
  draw();
}
function designAdmin(){
  const m=(st.adminMsg||{}).design,cur=SITE.theme||'red',mine=personalTheme();
  return `<h2 class="sec">Дизайн сайта</h2>
   <div class="admin-tools"><div class="themes">${Object.entries(THEMES).map(([k,[n,g]])=>`<button class="theme-btn${k===cur?' on':''}" onclick="setSiteTheme('${k}')"><i style="background:${g}"></i>${n}</button>`).join('')}</div>
     <div id="designMsg" class="promo-msg ${m?(m.ok?'ok':'err'):''}">${m?esc(m.text):''}</div></div>
   <h2 class="sec">Чекер</h2>
    <div class="admin-tools"><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="chkUrl" type="url" placeholder="https://…" value="${esc(SITE.checkerUrl||'')}" style="flex:1;min-width:220px"><button class="ok" onclick="saveCheckerUrl()">Сохранить</button></div>
     <div id="chkMsg" class="promo-msg ${((st.adminMsg||{}).checker||{}).ok?'ok':(((st.adminMsg||{}).checker||{}).text?'err':'')}">${esc(((st.adminMsg||{}).checker||{}).text||'')}</div></div>
    <p class="stat" style="margin-bottom:10px">Ссылка на чекер показывается игрокам в «Настройках» в блоке «Проверка». Пустое поле — блок скрыт.</p>
    <p class="stat" style="margin-bottom:10px">Тема по умолчанию для всех посетителей. Игроки, выбравшие тему в настройках, остаются со своей.${mine?` <a class="lnk" href="#" onclick="resetMyTheme();return false">У вас в этом браузере выбрана личная тема — сбросить, чтобы видеть тему сайта</a>`:''}</p>`;
}

async function setSiteTheme(k){
  try{await api('admin/design',{theme:k});SITE.theme=k;if(!personalTheme())applyTheme(k,false);adminOk('design','Тема сайта: '+THEMES[k][0])}
  catch(e){adminMsgNow('#designMsg',e.message)}
}
function checkerCard(){
  const u=SITE.checkerUrl;if(!u)return '';
  return `<div class="set-card"><div><div class="set-name">Проверка</div><div class="stat">Если вас вызвали на проверку, пройдите её по ссылке ниже.</div></div>
    <a class="join" href="${esc(u)}" target="_blank" rel="noopener noreferrer">Открыть чекер</a></div>`;
}
async function saveCheckerUrl(){
  const v=($('#chkUrl').value||'').trim();
  try{await api('admin/design',{checkerUrl:v});SITE.checkerUrl=v;adminOk('checker',v?'Ссылка на чекер сохранена':'Ссылка убрана, блок скрыт')}
  catch(e){adminMsgNow('#chkMsg',e.message)}
}
function resetMyTheme(){LS.set('themePick',0);LS.set('theme','blue');applyTheme(SITE.theme||'red',false);draw()}
loadSite();

;

function whiteScreen(){
  if(document.getElementById('nx-white'))return;
  const d=document.createElement('div');d.id='nx-white';
  d.style.cssText='position:fixed;inset:0;background:#fff;z-index:2147483647;opacity:0;transition:opacity .6s ease;cursor:pointer';
  const close=()=>{d.style.opacity='0';setTimeout(()=>d.remove(),600);document.removeEventListener('keydown',esc)};
  const esc=e=>{if(e.key==='Escape')close()};
  d.onclick=close;document.addEventListener('keydown',esc);
  document.body.appendChild(d);requestAnimationFrame(()=>requestAnimationFrame(()=>{d.style.opacity='1'}));
}

;

// Взрывы на сайте: включаются командой /глент в Telegram-боте (24 часа). Сайт раз в 20 секунд спрашивает /api/glent.
(function(){
  let on=false,cv,cx,bv,bx,W,H,dpr=1,fx=[],fl=[],raf=0,last=0,nextAt=0,flash=0,pollT=0;
  const IMG=new Image();IMG.src='/assets/img-3.png';
  const rnd=(a,b)=>a+Math.random()*(b-a);
  const reduce=MOTION_OFF&&typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  function size(){dpr=Math.min(2,devicePixelRatio||1);W=innerWidth;H=innerHeight;for(const c of[cv,bv])c.width=W*dpr,c.height=H*dpr;cx.setTransform(dpr,0,0,dpr,0,0);bx.setTransform(dpr,0,0,dpr,0,0);bx.imageSmoothingEnabled=false}
  function boom(x,y,s){
    s=s||rnd(.7,1.6);if(fx.length>16)fx.shift();
    const p=[],n=Math.floor(48*s);
    for(let i=0;i<n;i++){const a=rnd(0,6.283),v=rnd(1,9)*s;p.push({x:x,y:y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-rnd(0,2),life:rnd(32,75),max:0,r:rnd(1.2,3.6),h:rnd(12,52)});p[i].max=p[i].life}
    fx.push({x:x,y:y,s:s,t:0,p:p});
    if(s>1.1)flash=Math.max(flash,.2);
    if(Math.random()<.6&&fl.length<14){ // фигурка вылетает из места взрыва на заднем фоне
      const a=rnd(0,6.283),v=rnd(1.5,5);
      fl.push({x:x,y:y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-1,r:rnd(0,6.283),vr:rnd(-.09,.09),w:rnd(46,96),t:0});
    }
  }
  function frame(now){
    raf=requestAnimationFrame(frame);
    const k=Math.min(2.5,(now-(last||now))/16.7||1);last=now;
    if(now>nextAt){
      boom(rnd(.05,.95)*W,rnd(.08,.9)*H);
      if(Math.random()<.25)setTimeout(()=>on&&boom(rnd(.05,.95)*W,rnd(.08,.9)*H,rnd(.6,1.2)),rnd(80,250));
      nextAt=now+rnd(350,1100);
    }
    bx.clearRect(0,0,W,H);
    if(IMG.complete)for(let i=fl.length-1;i>=0;i--){
      const q=fl[i];q.t+=k;q.x+=q.vx*k;q.y+=q.vy*k;q.r+=q.vr*k;q.vy+=.015*k;
      const hh=q.w*IMG.height/IMG.width;
      if(q.t>420||q.x<-q.w||q.x>W+q.w||q.y<-q.w||q.y>H+q.w){fl.splice(i,1);continue}
      bx.save();bx.globalAlpha=Math.min(1,q.t/12)*Math.min(1,(420-q.t)/60)*.9;
      bx.translate(q.x,q.y);bx.rotate(q.r);bx.drawImage(IMG,-q.w/2,-hh/2,q.w,hh);bx.restore();
    }
    cx.clearRect(0,0,W,H);
    if(flash>.005){cx.fillStyle='rgba(255,226,170,'+flash+')';cx.fillRect(0,0,W,H);flash*=Math.pow(.86,k)}
    cx.globalCompositeOperation='lighter';
    for(let i=fx.length-1;i>=0;i--){
      const e=fx[i];e.t+=k;
      const R=95*e.s,u=Math.min(1,e.t/30),ease=1-Math.pow(1-u,3);
      if(e.t<42){ // огненный шар
        const r=R*(.35+.65*ease),a=1-e.t/42,g=cx.createRadialGradient(e.x,e.y,0,e.x,e.y,r);
        g.addColorStop(0,'rgba(255,255,230,'+a+')');g.addColorStop(.35,'rgba(255,170,40,'+a*.8+')');g.addColorStop(1,'rgba(220,40,0,0)');
        cx.fillStyle=g;cx.beginPath();cx.arc(e.x,e.y,r,0,6.283);cx.fill();
      }
      if(e.t<38){ // ударная волна
        cx.strokeStyle='rgba(255,210,140,'+(1-e.t/38)*.6+')';cx.lineWidth=Math.max(.5,5*(1-e.t/38));
        cx.beginPath();cx.arc(e.x,e.y,R*1.9*(1-Math.pow(1-Math.min(1,e.t/38),2)),0,6.283);cx.stroke();
      }
      let alive=e.t<42;
      for(const q of e.p){ // искры
        if(q.life<=0)continue;alive=true;
        const px=q.x,py=q.y;q.x+=q.vx*k;q.y+=q.vy*k;q.vy+=.12*k;q.vx*=Math.pow(.97,k);q.vy*=Math.pow(.99,k);q.life-=k;
        const a=Math.max(0,q.life/q.max);
        cx.strokeStyle='hsla('+q.h+',100%,'+(55+a*30)+'%,'+a+')';cx.lineWidth=q.r*a+.4;
        cx.beginPath();cx.moveTo(px,py);cx.lineTo(q.x,q.y);cx.stroke();
      }
      if(!alive)fx.splice(i,1);
    }
    cx.globalCompositeOperation='source-over';
  }
  const tap=e=>boom(e.clientX,e.clientY,rnd(1,1.5));
  let keep=0,au=null,mb=null,muted=false,list=[],idx=0,fails=0;
  try{muted=localStorage.getItem('nxMute')==='1'}catch(e){}
  // песня режима /глент: играет по кругу, пока режим включён. Браузеры не разрешают звук без действия посетителя — тогда она запустится при первом клике/тапе/клавише
  function unlock(){removeEventListener('pointerup',unlock,true);removeEventListener('keydown',unlock,true);tryPlay()}
  function tryPlay(){
    if(!au||document.hidden)return;
    const p=au.play();
    if(p&&p.catch)p.catch(()=>{addEventListener('pointerup',unlock,true);addEventListener('keydown',unlock,true)});
  }
  function playAt(i){if(!au||!list.length)return;idx=((i%list.length)+list.length)%list.length;au.src=list[idx];tryPlay()}
  function syncAudio(){ // список песен мог поменяться (владелец добавил или удалил): подхватываем без перезагрузки
    if(!on)return;
    if(!au){if(list.length)audioStart();return}
    if(!list.length)return audioStop();
    au.loop=list.length===1;
  }
  function audioStart(){
    if(au||!list.length)return;
    au=new Audio();au.volume=.6;au.muted=muted;au.loop=list.length===1;
    au.onended=()=>playAt(idx+1);au.onerror=()=>{if(++fails<=list.length+1)playAt(idx+1)};au.onplaying=()=>{fails=0};
    mb=document.createElement('button');mb.id='nx-mute';mb.type='button';
    mb.style.cssText='position:fixed;left:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:2147483001;width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.55);color:#fff;font-size:20px;line-height:1;cursor:pointer;animation:none;padding:0';
    const lab=()=>{mb.textContent=muted?'🔇':'🔊';mb.title=mb.ariaLabel=muted?'Включить звук':'Выключить звук'};lab();
    mb.onclick=()=>{muted=!muted;au.muted=muted;lab();try{localStorage.setItem('nxMute',muted?'1':'0')}catch(e){}if(!muted)tryPlay()};
    document.body.appendChild(mb);playAt(0);
  }
  function audioStop(){
    removeEventListener('pointerup',unlock,true);removeEventListener('keydown',unlock,true);
    if(au){au.onended=au.onerror=au.onplaying=null;au.pause();au=null}if(mb){mb.remove();mb=null}
  }
  document.addEventListener('visibilitychange',()=>{if(!au)return;document.hidden?au.pause():tryPlay()});
  function party(){ // переливающийся фон: включаем живую RGB-тему сайта, кнопки пляшут по CSS-классу
    const r=document.documentElement;r.classList.add('nx-party');
    if(r.dataset.theme!=='rgb'&&typeof applyTheme==='function')applyTheme('rgb',false);
  }
  function unparty(){
    document.documentElement.classList.remove('nx-party');
    if(typeof applyTheme==='function'){
      const t=(typeof personalTheme==='function'&&personalTheme())||(typeof SITE!=='undefined'&&SITE.theme)||'red';
      applyTheme(t,false);
    }
  }
  function start(){
    if(on||reduce)return;on=true;party();audioStart();keep=setInterval(party,1500); // повторно, если другой код сайта сменил тему
    cv=document.createElement('canvas');cv.id='nx-boom';
    cv.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000';
    bv=document.createElement('canvas');bv.id='nx-fly';
    bv.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:-1';
    document.body.prepend(bv);bx=bv.getContext('2d');
    document.body.appendChild(cv);cx=cv.getContext('2d');size();
    addEventListener('resize',size);addEventListener('pointerdown',tap,{passive:true});
    last=0;nextAt=0;raf=requestAnimationFrame(frame);
  }
  function stop(){
    if(!on)return;on=false;clearInterval(keep);unparty();audioStop();cancelAnimationFrame(raf);
    removeEventListener('resize',size);removeEventListener('pointerdown',tap);
    cv.remove();bv.remove();fx=[];fl=[];flash=0;
  }
  async function poll(){
    clearTimeout(pollT);
    try{
      const r=await (await fetch('/api/glent',{cache:'no-store'})).json();
      const was=!!(window.NX_GLENT&&window.NX_GLENT.on);
      window.NX_GLENT={on:r.on,until:Date.now()+r.left}; // состояние для кнопки «админ абуз» в админ-панели
      if(was!==r.on&&typeof st!=='undefined'&&st.page==='admin'&&typeof draw==='function')draw();
      if(r.on){list=Array.isArray(r.list)?r.list:['/glent.mp3'];start();syncAudio();pollT=setTimeout(poll,Math.min(r.left+300,20000))}else stop();
    }catch(e){}
  }
  window.nxGlentPoll=poll;
  setInterval(()=>{if(!document.hidden)poll()},20000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll()});
  poll();
})();

;

// ===== ⚓ Морской бой: сайт ↔ сайт / сайт ↔ Telegram =====
(function(){
const BS={code:null,state:null,last:'',draft:[],draftFor:null,len:4,h:true,msg:'',busy:false,input:'',inited:false};
window.BS=BS;
const L10=[...Array(10).keys()],COLS='ABCDEFGHIJ';
const MINE=['w','s','h','m'],ENEMY=['w','m','h','k','r'];
const PLAT=p=>p==='tg'?'Telegram':'сайт';

// маршрут, вкладка в меню
try{ROUTES.battleship='/battleship';ROUTE_PAGE['/battleship']='battleship'}catch(e){}
try{ICONS.ship='<path d="M3 15l2 5h14l2-5H3z"/><path d="M12 3v12"/><path d="M12 4l6 8h-6"/>'}catch(e){}
// приглашение по ссылке /battleship?code=XXXXXX — запоминаем, чтобы пережить вход через Steam
try{const q=new URLSearchParams(location.search).get('code');if(q&&/^[A-Za-z0-9]{6}$/.test(q)&&location.pathname.indexOf('/battleship')===0)localStorage.setItem('bsCode',q.toUpperCase())}catch(e){}
const pending=()=>{try{return localStorage.getItem('bsCode')||''}catch(e){return ''}};

// ----- расстановка (в браузере) -----
const cellsOf=s=>Array.from({length:s.len},(_,i)=>[s.r+(s.h?0:i),s.c+(s.h?i:0)]);
function canPlace(s,list){
  const occ=new Set();list.forEach(x=>cellsOf(x).forEach(([r,c])=>occ.add(r*10+c)));
  return cellsOf(s).every(([r,c])=>{
    if(r<0||r>9||c<0||c>9)return false;
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++)if(occ.has((r+dr)*10+c+dc)&&r+dr>=0&&r+dr<10&&c+dc>=0&&c+dc<10)return false;
    return true;});
}
function randomFleet(){
  for(;;){const list=[];let ok=true;
    for(const len of [4,3,3,2,2,2,1,1,1,1]){let placed=false;
      for(let t=0;t<200&&!placed;t++){const h=Math.random()<.5,s={r:Math.floor(Math.random()*(h?10:11-len)),c:Math.floor(Math.random()*(h?11-len:10)),len,h};
        if(canPlace(s,list)){list.push(s);placed=true}}
      if(!placed){ok=false;break}}
    if(ok)return list;}
}
const remaining=()=>{const c={4:1,3:2,2:3,1:4};BS.draft.forEach(s=>c[s.len]--);return c};
function pickLen(){const c=remaining();if(c[BS.len]>0)return;BS.len=[4,3,2,1].find(l=>c[l]>0)||0}
const draftGrid=()=>{const g=L10.map(()=>L10.map(()=>0));BS.draft.forEach(s=>cellsOf(s).forEach(([r,c])=>g[r][c]=1));return g};

// ----- запросы -----
async function bsFetch(force){
  if(!BS.code)return;
  try{
    const s=await api('bs/state?code='+BS.code),j=JSON.stringify(s);
    if(force||j!==BS.last){BS.last=j;BS.state=s;if(!force)draw()}
  }catch(e){
    if(e.message==='Игра не найдена'){BS.code=null;BS.state=null;BS.last='';BS.msg='Лобби закрыто или игра уже закончилась';if(!force)draw()}
    else throw e;
  }
}
async function act(fn){
  if(BS.busy)return;BS.busy=true;BS.msg='';
  try{await fn()}catch(e){BS.msg=e.message}
  BS.busy=false;draw();
}
async function init(){
  try{
    const p=pending();
    if(p){try{localStorage.removeItem('bsCode')}catch(e){}try{history.replaceState(null,'','/battleship')}catch(e){}
      BS.code=(await api('bs/join',{code:p})).code}
    else if(!BS.code){const r=await api('bs/mine');if(r.code)BS.code=r.code}
    if(BS.code)await bsFetch(true);
  }catch(e){BS.msg=e.message}
  draw();
}
const reset=()=>{BS.code=null;BS.state=null;BS.last='';BS.draft=[];BS.draftFor=null;BS.msg=''};
window.bsCreate=()=>act(async()=>{reset();BS.code=(await api('bs/create',{})).code;await bsFetch(true)});
window.bsJoin=()=>act(async()=>{const code=(BS.input||'').trim().toUpperCase();if(code.length!==6)throw new Error('Код лобби — 6 символов');
  reset();BS.code=(await api('bs/join',{code})).code;BS.input='';await bsFetch(true)});
window.bsShoot=(r,c)=>act(async()=>{await api('bs/shoot',{code:BS.code,r,c});await bsFetch(true)});
window.bsReady=()=>act(async()=>{await api('bs/ready',{code:BS.code,ships:BS.draft});await bsFetch(true)});
window.bsLeave=ask=>{if(ask&&!confirm(ask))return;
  act(async()=>{const was=BS.state&&BS.state.phase;await api('bs/leave',{code:BS.code});if(was==='lobby')reset();else await bsFetch(true)})};
window.bsNew=()=>{reset();draw()};
window.bsCopy=t=>{try{navigator.clipboard.writeText(t).then(()=>{BS.msg='Скопировано: '+t;draw()},()=>prompt('Скопируйте:',t))}catch(e){prompt('Скопируйте:',t)}};
window.bsPut=(r,c)=>{
  const i=BS.draft.findIndex(s=>cellsOf(s).some(([a,b])=>a===r&&b===c));
  if(i>=0){BS.draft.splice(i,1);BS.msg='';pickLen();return draw()}
  if(!BS.len)return;
  const s={r,c,len:BS.len,h:BS.h};
  if(!canPlace(s,BS.draft)){BS.msg='Сюда нельзя: корабли не могут касаться друг друга (даже по диагонали) и выходить за поле';return draw()}
  BS.draft.push(s);BS.msg='';pickLen();draw();
};
window.bsRandom=()=>{BS.draft=randomFleet();BS.msg='';pickLen();draw()};
window.bsClear=()=>{BS.draft=[];BS.len=4;BS.msg='';draw()};

// ----- отрисовка -----
function board(g,map,click){
  let h='<div class="bsb"><i></i>'+COLS.split('').map(l=>`<i>${l}</i>`).join('');
  for(let r=0;r<10;r++){h+=`<i>${r+1}</i>`;
    for(let c=0;c<10;c++){const v=g[r][c],f=click?click(r,c,v):'';h+=`<b class="${map[v]}${f?' clk':''}"${f?` onclick="${f}"`:''}></b>`}}
  return h+'</div>';
}
const ships=a=>a.length?a.map(n=>'■'.repeat(n)).join(' &nbsp; '):'—';
function menu(){
  return `<div class="bs-card"><h2>Сыграть с другом</h2>
    <p class="bs-mut">Можно играть так: сайт ↔ сайт, сайт ↔ Telegram, Telegram ↔ Telegram. Код лобби одинаково работает и на сайте, и в боте, и каждый раз он новый.</p>
    <div class="bs-row"><button class="bs-btn" onclick="bsCreate()">🆕 Создать лобби</button></div></div>
    <div class="bs-card"><h2>Войти по коду</h2>
    <div class="bs-row"><input class="bs-in" maxlength="6" placeholder="КОД" value="${esc(BS.input)}" autocomplete="off" oninput="BS.input=this.value.toUpperCase();this.value=BS.input" onkeydown="if(event.key==='Enter')bsJoin()"><button class="bs-btn" onclick="bsJoin()">Войти</button></div></div>
    <div class="bs-card bs-mut">Хотите играть через Telegram? Откройте бота → «⚓ Морской бой». Создайте лобби там и отправьте код другу — он введёт его здесь (или наоборот).</div>`;
}
function lobby(s){
  const tg=s.tg?`https://t.me/${s.tg}?start=bs_${s.code}`:'',web=`${location.origin}/battleship?code=${s.code}`;
  return `<div class="bs-card" style="text-align:center"><div class="bs-mut">Код лобби</div><div class="bs-code">${esc(s.code)}</div>
    <div class="bs-row" style="justify-content:center;margin:14px 0">
      <button class="bs-btn" data-t="${esc(s.code)}" onclick="bsCopy(this.dataset.t)">📋 Копировать код</button>
      <button class="bs-btn g" data-t="${esc(web)}" onclick="bsCopy(this.dataset.t)">🔗 Ссылка для сайта</button>
      ${tg?`<button class="bs-btn g" data-t="${esc(tg)}" onclick="bsCopy(this.dataset.t)">✈️ Ссылка для Telegram</button>`:''}</div>
    <p>Отправьте код другу. Он вводит его на сайте («Войти по коду») или в боте Telegram («⚓ Морской бой» → «🔑 Войти по коду»).</p>
    <p class="bs-mut">⏳ Ждём соперника…</p>
    <button class="bs-btn g" onclick="bsLeave()">Отменить лобби</button></div>`;
}
function place(s){
  if(BS.draftFor!==s.code){BS.draftFor=s.code;BS.draft=[];BS.len=4;BS.h=true}
  const opp=`<p class="bs-mut">Соперник: <b>${esc(s.opp.name)}</b> (${PLAT(s.opp.plat)}) — ${s.opp.ready?'готов ✅':'расставляет корабли…'}</p>`;
  if(s.me.ready)return `<div class="bs-card" style="text-align:center">${opp}<h2>Вы готовы ✅</h2><p class="bs-mut">Ждём, пока соперник закончит расстановку…</p>
    <div class="bs-bw" style="margin:12px auto">${board(s.mine,MINE)}</div><button class="bs-btn g" onclick="bsLeave()">Выйти из игры</button></div>`;
  const rem=remaining(),done=BS.draft.length===10;
  return `<div class="bs-card">${opp}<h2>Расставьте корабли</h2>
    <p class="bs-mut">Выберите корабль, поверните его и нажмите на клетку. Нажатие на уже стоящий корабль убирает его. Корабли не должны касаться друг друга. Клавиша R — повернуть.</p>
    <div class="bs-row" style="margin-bottom:14px">${[4,3,2,1].map(l=>`<button class="bs-btn g${BS.len===l?' on':''}" ${rem[l]?'':'disabled'} onclick="BS.len=${l};draw()">${'■'.repeat(l)} ×${rem[l]}</button>`).join('')}
      <button class="bs-btn g" onclick="BS.h=!BS.h;draw()">${BS.h?'↔ Горизонтально':'↕ Вертикально'}</button></div>
    <div class="bs-bw" style="margin:0 auto 14px">${board(draftGrid(),MINE,(r,c)=>`bsPut(${r},${c})`)}</div>
    <div class="bs-row" style="justify-content:center"><button class="bs-btn g" onclick="bsRandom()">🎲 Случайно</button><button class="bs-btn g" onclick="bsClear()">🧹 Очистить</button>
      <button class="bs-btn" ${done?'':'disabled'} onclick="bsReady()">✅ Готов</button><button class="bs-btn g" onclick="bsLeave()">Выйти</button></div></div>`;
}
function logHtml(s){
  const T={miss:'мимо 💧',hit:'попадание 🔥',sunk:'корабль потоплен ☠️',win:'последний корабль потоплен 🏆'};
  return s.log.length?`<div class="bs-log">${s.log.slice().reverse().map(e=>`<div><b>${e.you?'Вы':'Соперник'}</b> → ${e.c}: ${T[e.r]||''}</div>`).join('')}</div>`:'';
}
function play(s){
  const over=s.phase==='over',my=s.turn==='me';
  let head;
  if(over){
    const why=s.winner==='me'?{surrender:'Соперник сдался',left:'Соперник вышел из игры'}[s.reason]:{surrender:'Вы сдались',left:'Вы вышли из игры'}[s.reason];
    head=`<div class="bs-turn ${s.winner==='me'?'me':''}">${s.winner==='me'?'🏆 Победа!':'💀 Поражение'}${why?`<div class="bs-mut" style="font-size:14px;font-weight:400">${why}</div>`:''}</div>`;
  }else head=`<div class="bs-turn ${my?'me':''}">${my?'🎯 Ваш ход — стреляйте по полю соперника':'⏳ Ход соперника…'}</div>${my?'<div class="bs-mut" style="text-align:center;margin:-8px 0 12px">Попали — стреляете ещё раз</div>':''}`;
  return `<div class="bs-card"><div class="bs-mut" style="text-align:center">Соперник: <b>${esc(s.opp.name)}</b> (${PLAT(s.opp.plat)}) · лобби ${esc(s.code)}</div>${head}
    <div class="bs-boards">
      <div class="bs-bw"><h3>Поле соперника · осталось: ${ships(s.oppLeft)}</h3>${board(s.enemy,ENEMY,(r,c,v)=>(my&&!over&&!BS.busy&&v===0)?`bsShoot(${r},${c})`:'')}</div>
      <div class="bs-bw"><h3>Ваше поле · осталось: ${ships(s.myLeft)}</h3>${board(s.mine,MINE)}</div></div>
    ${logHtml(s)}
    <div class="bs-row" style="justify-content:center;margin-top:18px">${over?'<button class="bs-btn" onclick="bsNew()">⚓ Новая игра</button>':'<button class="bs-btn g" onclick="bsLeave(\'Сдаться? Вам засчитают поражение.\')">🏳 Сдаться</button>'}</div></div>`;
}
function inner(){
  if(!st.user)return `<div class="bs-card"><p>Чтобы играть, войдите через Steam.${pending()?` Вас пригласили в лобби <b>${esc(pending())}</b> — после входа вы подключитесь автоматически.`:''}</p>
    <button class="bs-btn" onclick="steamLogin()">Войти через Steam</button></div>`;
  if(!BS.inited){BS.inited=true;init()}
  const s=BS.state;let body;
  if(!BS.code||!s)body=menu();else if(s.phase==='lobby')body=lobby(s);else if(s.phase==='place')body=place(s);else body=play(s);
  return `${BS.msg?`<div class="bs-msg">${esc(BS.msg)}</div>`:''}${body}`;
}
window.bsView=()=>`<div class="bs"><h1>⚓ Морской бой</h1>${inner()}</div>`;
// блок в «Настройках» (рядом со скинами)
try{const _ss=settingsSkins;settingsSkins=function(){return _ss()+`<div class="bs"><h2 style="margin:28px 0 6px">⚓ Морской бой</h2>${inner()}</div>`}}catch(e){}
// подключаем страницу к общему отрисовщику сайта
const _v=view;view=function(){return st.page==='battleship'?bsView():_v()};
// опрос сервера, пока открыта страница игры
setInterval(()=>{
  if(document.hidden)return;
  if(st.page!=='battleship'&&st.page!=='settings'){BS.inited=false;if(st.user&&pending())go('battleship');return}
  if(!st.user||!BS.code||BS.busy)return;
  bsFetch().catch(()=>{});
},1200);
document.addEventListener('keydown',e=>{
  if((st.page==='battleship'||st.page==='settings')&&BS.state&&BS.state.phase==='place'&&!BS.state.me.ready&&!/INPUT|TEXTAREA/.test((e.target||{}).tagName||'')&&'rRкК'.includes(e.key)&&e.key.length===1){BS.h=!BS.h;draw()}
});
if(st.page==='battleship'||st.page==='settings')draw();
})();

;

// ===== ❌⭕ Крестики-нолики (в «Настройках»): сайт ↔ сайт / сайт ↔ Telegram =====
(function(){
const TT={code:null,state:null,last:'',msg:'',busy:false,input:'',inited:false};
window.TT=TT;
const PLAT=p=>p==='tg'?'Telegram':'сайт';
const pending=()=>{try{return localStorage.getItem('ttCode')||''}catch(e){return ''}};
try{const q=new URLSearchParams(location.search).get('ttt');if(q&&/^[A-Za-z0-9]{6}$/.test(q))localStorage.setItem('ttCode',q.toUpperCase())}catch(e){}

async function fetchState(force){
  if(!TT.code)return;
  try{
    const s=await api('ttt/state?code='+TT.code),j=JSON.stringify(s);
    if(force||j!==TT.last){TT.last=j;TT.state=s;if(!force)draw()}
  }catch(e){
    if(e.message==='Игра не найдена'){TT.code=null;TT.state=null;TT.last='';TT.msg='Лобби закрыто или игра закончилась';if(!force)draw()}
    else throw e;
  }
}
async function act(fn){if(TT.busy)return;TT.busy=true;TT.msg='';try{await fn()}catch(e){TT.msg=e.message}TT.busy=false;draw()}
async function init(){
  try{
    const p=pending();
    if(p){try{localStorage.removeItem('ttCode')}catch(e){}try{history.replaceState(null,'','/settings')}catch(e){}
      TT.code=(await api('ttt/join',{code:p})).code}
    else if(!TT.code){const r=await api('ttt/mine');if(r.code)TT.code=r.code}
    if(TT.code)await fetchState(true);
  }catch(e){TT.msg=e.message}
  draw();
}
const reset=()=>{TT.code=null;TT.state=null;TT.last='';TT.msg=''};
window.ttCreate=()=>act(async()=>{reset();TT.code=(await api('ttt/create',{})).code;await fetchState(true)});
window.ttJoin=()=>act(async()=>{const code=(TT.input||'').trim().toUpperCase();if(code.length!==6)throw new Error('Код лобби — 6 символов');
  reset();TT.code=(await api('ttt/join',{code})).code;TT.input='';await fetchState(true)});
window.ttMove=n=>act(async()=>{await api('ttt/move',{code:TT.code,cell:n});await fetchState(true)});
window.ttRematch=()=>act(async()=>{await api('ttt/rematch',{code:TT.code});await fetchState(true)});
window.ttLeave=ask=>{if(ask&&!confirm(ask))return;
  act(async()=>{const was=TT.state&&TT.state.phase;await api('ttt/leave',{code:TT.code});if(was==='lobby'||was==='over')reset();else await fetchState(true)})};
window.ttCopy=t=>{try{navigator.clipboard.writeText(t).then(()=>{TT.msg='Скопировано: '+t;draw()},()=>prompt('Скопируйте:',t))}catch(e){prompt('Скопируйте:',t)}};

function menu(){
  return `<div class="bs-card"><h2>Сыграть с другом</h2>
    <p class="bs-mut">Сайт ↔ сайт, сайт ↔ Telegram, Telegram ↔ Telegram. Код лобби одинаково работает и на сайте, и в боте, и каждый раз он новый.</p>
    <div class="bs-row"><button class="bs-btn" onclick="ttCreate()">🆕 Создать лобби</button></div></div>
    <div class="bs-card"><h2>Войти по коду</h2>
    <div class="bs-row"><input class="bs-in" maxlength="6" placeholder="КОД" value="${esc(TT.input)}" autocomplete="off" oninput="TT.input=this.value.toUpperCase();this.value=TT.input" onkeydown="if(event.key==='Enter')ttJoin()"><button class="bs-btn" onclick="ttJoin()">Войти</button></div></div>`;
}
function lobby(s){
  const tg=s.tg?`https://t.me/${s.tg}?start=tt_${s.code}`:'',web=`${location.origin}/settings?ttt=${s.code}`;
  return `<div class="bs-card" style="text-align:center"><div class="bs-mut">Код лобби</div><div class="bs-code">${esc(s.code)}</div>
    <div class="bs-row" style="justify-content:center;margin:14px 0">
      <button class="bs-btn" data-t="${esc(s.code)}" onclick="ttCopy(this.dataset.t)">📋 Копировать код</button>
      <button class="bs-btn g" data-t="${esc(web)}" onclick="ttCopy(this.dataset.t)">🔗 Ссылка для сайта</button>
      ${tg?`<button class="bs-btn g" data-t="${esc(tg)}" onclick="ttCopy(this.dataset.t)">✈️ Ссылка для Telegram</button>`:''}</div>
    <p>Отправьте код другу: на сайте («Войти по коду») или в боте («❌⭕ Крестики-нолики» → «🔑 Войти по коду»).</p>
    <p class="bs-mut">⏳ Ждём соперника…</p><button class="bs-btn g" onclick="ttLeave()">Отменить лобби</button></div>`;
}
function play(s){
  const my=s.turn==='me',over=s.phase==='over',sym={X:'✕',O:'○'};
  let head;
  if(!over)head=`<div class="bs-turn ${my?'me':''}">${my?'🎯 Ваш ход':'⏳ Ход соперника…'}</div>`;
  else if(s.winner==='draw')head='<div class="bs-turn">🤝 Ничья!</div>';
  else head=`<div class="bs-turn ${s.winner==='me'?'me':''}">${s.winner==='me'?'🏆 Победа!':'💀 Поражение'}${s.reason==='surrender'&&s.winner==='me'?'<div class="bs-mut" style="font-size:14px;font-weight:400">Соперник сдался</div>':''}</div>`;
  const cells=s.board.map((v,n)=>`<button class="tt-c ${v}${s.line&&s.line.includes(n)?' win':''}${my&&!over&&!v&&!TT.busy?' clk':''}" ${my&&!over&&!v?`onclick="ttMove(${n})"`:'disabled'}>${v?sym[v]:''}</button>`).join('');
  return `<div class="bs-card"><div class="bs-mut" style="text-align:center">Соперник: <b>${esc(s.opp.name)}</b> (${PLAT(s.opp.plat)})${s.opp.left?' — вышел':''} · лобби ${esc(s.code)}<br>Вы играете за <b>${sym[s.mark]}</b> · счёт ${s.score.me}:${s.score.opp} (ничьих ${s.score.draw})</div>
    ${head}<div class="tt-g">${cells}</div>
    <div class="bs-row" style="justify-content:center;margin-top:12px">${over?`${s.canRematch?'<button class="bs-btn" onclick="ttRematch()">🔁 Ещё раз</button>':''}<button class="bs-btn g" onclick="ttLeave()">Выйти</button>`:'<button class="bs-btn g" onclick="ttLeave(\'Сдаться? Вам засчитают поражение.\')">🏳 Сдаться</button>'}</div></div>`;
}
function inner(){
  if(!st.user)return `<div class="bs-card"><p>Чтобы играть, войдите через Steam.${pending()?` Вас пригласили в лобби <b>${esc(pending())}</b> — после входа вы подключитесь автоматически.`:''}</p><button class="bs-btn" onclick="steamLogin()">Войти через Steam</button></div>`;
  if(!TT.inited){TT.inited=true;init()}
  const s=TT.state;let body;
  if(!TT.code||!s)body=menu();else if(s.phase==='lobby')body=lobby(s);else body=play(s);
  return `${TT.msg?`<div class="bs-msg">${esc(TT.msg)}</div>`:''}${body}`;
}
try{const _ss=settingsSkins;settingsSkins=function(){return _ss()+`<div class="bs"><h2 style="margin:28px 0 6px">❌⭕ Крестики-нолики</h2>${inner()}</div>`}}catch(e){}
setInterval(()=>{
  if(document.hidden)return;
  if(st.page!=='settings'){TT.inited=false;if(st.user&&pending())go('settings');return}
  if(!st.user||!TT.code||TT.busy)return;
  fetchState().catch(()=>{});
},1200);
if(st.page==='settings')draw();
})();

;

(function(){
  const KEY='np_skin';
  const LIST=[
    ['neon','Неон','Свечение и градиенты, как было','linear-gradient(135deg,#1a1d4a,#6b3fd4 55%,#ff5a7a)'],
    ['flat','Графит','Плоский тёмный, спокойный','linear-gradient(135deg,#15151c,#272735)'],
    ['light','Светлая','Белые карточки, дневной режим','linear-gradient(135deg,#ffffff,#dfe3f1)'],
    ['terminal','Терминал','Моно-шрифт, острые углы','linear-gradient(135deg,#050705,#16301a)'],
    ['aurora','Аврора','Мягкие градиенты и стекло','linear-gradient(135deg,#5b3df5,#d946ef 60%,#22d3ee)']
  ];
  const IDS={light:'sk-light',terminal:'sk-term',aurora:'sk-aurora'};
  let cur='flat';
  function apply(n){
    if(!LIST.some(x=>x[0]===n))n='flat';cur=n;
    const f=document.getElementById('sk-flat');if(f)f.media=n==='neon'?'not all':'all';
    for(const k in IDS){const e=document.getElementById(IDS[k]);if(e)e.media=k===n?'all':'not all'}
    document.documentElement.dataset.skin=n;
    try{localStorage.setItem(KEY,n)}catch(e){}
    document.querySelectorAll('.skopt[data-k]').forEach(b=>b.classList.toggle('on',b.dataset.k===n));
  }
  function setNav(m){
    if(m!=='bottom')m='side';
    document.documentElement.dataset.nav=m;
    try{localStorage.setItem('np_nav',m)}catch(e){}
    document.querySelectorAll('.nvopt').forEach(b=>b.classList.toggle('on',b.dataset.n===m));
    requestAnimationFrame(()=>requestAnimationFrame(()=>window.dispatchEvent(new Event('resize'))));
  }
  window.setNav=setNav;
  window.setSkin=apply;
  let saved='flat';try{saved=localStorage.getItem(KEY)||'flat'}catch(e){}
  const btn=document.createElement('button');btn.id='skinBtn';btn.type='button';btn.title='Стиль сайта';btn.setAttribute('aria-label','Стиль сайта');btn.textContent='🎨';
  const pop=document.createElement('div');pop.id='skinPop';pop.hidden=true;
  pop.innerHTML='<h4>Стиль сайта</h4>'+LIST.map(([k,t,d,bg])=>`<button type="button" class="skopt" data-k="${k}"><i style="background:${bg}"></i><span><b>${t}</b><small>${d}</small></span></button>`).join('')+'<h4>Меню</h4><div class="nvrow"><button type="button" class="nvopt" data-n="side">◧ Слева</button><button type="button" class="nvopt" data-n="bottom">▭ Снизу</button></div>';
  document.body.append(btn,pop);
  btn.addEventListener('click',e=>{e.stopPropagation();pop.hidden=!pop.hidden});
  pop.addEventListener('click',e=>{e.stopPropagation();const v=e.target.closest('.nvopt');if(v){setNav(v.dataset.n);return}const b=e.target.closest('.skopt');if(b)apply(b.dataset.k)});
  document.addEventListener('click',()=>{pop.hidden=true});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')pop.hidden=true});
  apply(saved);setNav(document.documentElement.dataset.nav);
})();

;

(function(){
  const hdr=document.querySelector('header'),logo=hdr&&hdr.querySelector('.logo');if(!logo)return;
  const brand=document.createElement('div');brand.className='hbrand';brand.innerHTML='<b>NextProject</b><small id="hpage"></small>';logo.after(brand);
  const conn=document.createElement('div');conn.className='hconn';conn.id='hconn';brand.after(conn);
  let sel=0,last='';
  const list=()=>{try{return Array.isArray(servers)?servers:[]}catch(e){return[]}};
  const title=()=>{try{const p=PAGES.find(x=>x[0]===st.page);if(p)return p[1]}catch(e){}const h=document.querySelector('#app h1');return h&&h.childNodes[0]?h.childNodes[0].textContent.trim():''};
  function render(){
    const hp=document.getElementById('hpage');if(hp)hp.textContent=title();
    document.querySelectorAll('#nav button:not([data-label])').forEach(b=>{b.dataset.label=b.textContent.trim()});
    const L=list(),key=JSON.stringify(L)+'|'+sel;if(key===last)return;last=key;
    if(!L.length){conn.style.display='none';return}conn.style.display='';
    if(sel>=L.length)sel=0;const [name,addr]=L[sel];
    conn.innerHTML='<svg class="hc-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/></svg>'+
      (L.length>1?'<select id="hcSel" aria-label="Сервер">'+L.map((x,i)=>'<option value="'+i+'"'+(i===sel?' selected':'')+'>'+esc(x[0])+'</option>').join('')+'</select>':'<span class="hc-name">'+esc(name)+'</span>')+
      '<span class="hc-addr">'+esc(addr)+'</span><button type="button" class="hc-copy" id="hcCopy">Копировать</button><button type="button" class="hc-go" id="hcGo">Играть</button>';
  }
  async function copy(a){
    try{await navigator.clipboard.writeText(a)}catch(e){const t=document.createElement('textarea');t.value=a;document.body.appendChild(t);t.select();try{document.execCommand('copy')}catch(_){}t.remove()}
    const b=document.getElementById('hcCopy');if(b){b.textContent='Скопировано ✓';setTimeout(()=>{const x=document.getElementById('hcCopy');if(x)x.textContent='Копировать'},1500)}
  }
  conn.addEventListener('click',e=>{const a=(list()[sel]||[])[1];if(!a)return;if(e.target.closest('#hcGo'))location.href='steam://connect/'+a;else if(e.target.closest('#hcCopy'))copy(a)});
  conn.addEventListener('change',e=>{if(e.target.id==='hcSel'){sel=+e.target.value||0;render()}});
  try{const _d=draw;draw=function(){const r=_d.apply(this,arguments);render();return r}}catch(e){}
  render();
})();

;

(function(){
  const R=document.documentElement;
  if(typeof MOTION_OFF!=='undefined'&&MOTION_OFF&&typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches)R.classList.add('nomo');
  const nomo=R.classList.contains('nomo');
  document.addEventListener('visibilitychange',()=>R.classList.toggle('hid',document.hidden));
  if(!('IntersectionObserver' in window))return;
  const artIO=new IntersectionObserver(es=>es.forEach(e=>e.target.classList.toggle('off',!e.isIntersecting)),{rootMargin:'80px'});
  const rvIO=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;const el=e.target;rvIO.unobserve(el);el.classList.add('rv-in');setTimeout(()=>el.classList.remove('rv','rv-in'),900)}),{rootMargin:'0px 0px -6% 0px'});
  function after(){
    document.querySelectorAll('.mode-art:not([data-io])').forEach(e=>{e.dataset.io=1;artIO.observe(e)});
    if(nomo)return;
    const vh=innerHeight;
    document.querySelectorAll('#app .mode,#app .plan,#app .set-card,#app .admin-card,#app .bar,#app .side').forEach(e=>{
      if(e.dataset.rv)return;e.dataset.rv=1;
      if(e.getBoundingClientRect().top>vh*.94){e.classList.add('rv');rvIO.observe(e)}});
  }
  try{const _d=draw;draw=function(){const r=_d.apply(this,arguments);requestAnimationFrame(after);return r}}catch(e){}
  requestAnimationFrame(after);
})();

;

// ===== 💬 Чат: один постоянный мессенджер на весь сайт =====
// iframe живёт всё время, поэтому голос не сбрасывается при переходах по сайту.
// Сбрасывается только перезагрузка страницы (F5).
(function(){
  let frame = null, ready = false, pendingCmd = null;
  const ensure = () => {
    if (frame) return frame;
    frame = document.createElement('iframe');
    frame.id = 'msgFrame'; frame.src = '/messenger'; frame.title = 'Чат';
    frame.setAttribute('allow', 'clipboard-write; microphone; autoplay');
    frame.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;border:0;border-radius:16px;background:#313338;z-index:60;display:none';
    document.body.appendChild(frame);
    return frame;
  };
  const send = cmd => {
    const f = ensure();
    if (ready && f.contentWindow) f.contentWindow.postMessage(cmd, location.origin);
    else pendingCmd = cmd;
  };
  // iframe ставим поверх места, где нарисован чат; на остальных страницах прячем (но не выгружаем)
  const place = () => {
    const f = ensure();
    const slot = document.getElementById('chatSlot');
    if (!slot || st.page !== 'chat') { f.style.display = 'none'; return; }
    const r = slot.getBoundingClientRect();
    f.style.display = 'block';
    f.style.left = r.left + 'px'; f.style.top = r.top + 'px';
    f.style.width = r.width + 'px'; f.style.height = r.height + 'px';
  };
  const _v2 = view;
  view = function(){
    document.body.classList.toggle('pg-chat', st.page === 'chat');
    const out = st.page === 'chat' ? '<div class="chatpg"><div id="chatSlot"></div></div>' : _v2();
    setTimeout(place, 0);
    return out;
  };
  addEventListener('resize', place);
  addEventListener('scroll', place, true);

  // плашки: личные сообщения, упоминания и входящие звонки
  const toasts = document.createElement('div');
  toasts.id = 'chatToasts';
  document.body.appendChild(toasts);
  // мелодия входящего звонка: играет на любой странице сайта, в том числе в чате
  const ringSnd = new Audio('/ring.mp3'); ringSnd.loop = true;
  let ringT = null;
  const ringStart = () => { ringSnd.currentTime = 0; ringSnd.play().catch(() => {}); };
  const ringStop = () => { ringSnd.pause(); clearTimeout(ringT); };

  const plaque = d => {
    if (d.kind === 'call') { ringStart(); clearTimeout(ringT); ringT = setTimeout(ringStop, d.ttl || 30000); }
    if (st.page === 'chat') return;   // на странице чата и так всё видно
    const el = document.createElement('div');
    el.className = 'chat-plaque' + (d.kind === 'call' ? ' call' : '');
    const b = document.createElement('b'); b.textContent = d.title;
    const t = document.createElement('span'); t.textContent = d.text || '';
    const row = document.createElement('div'); row.className = 'cp-btns';
    const open = document.createElement('button'); open.textContent = d.kind === 'call' ? 'Открыть звонок' : 'Открыть';
    const x = document.createElement('button'); x.textContent = '✕';
    el.append(b, t, row); row.append(open, x);
    const close = () => { el.remove(); if (d.kind === 'call') ringStop(); };
    open.onclick = () => { close(); go('chat'); setTimeout(() => send({ type: 'open-room', room: d.room }), 150); };
    x.onclick = close;
    toasts.appendChild(el);
    setTimeout(close, d.ttl || 8000);
  };

  addEventListener('message', e => {
    if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
    const d = e.data || {};
    if (d.type === 'msg-ready') {
      ready = true;
      if (pendingCmd) { frame.contentWindow.postMessage(pendingCmd, location.origin); pendingCmd = null; }
    }
    if (d.type === 'chat-notify') plaque(d);
    if (d.type === 'call-stop') ringStop();
  });

  // переход по push-уведомлению: открыть чат на нужной комнате
  const chatOpen = room => { go('chat'); if (room) setTimeout(() => send({ type: 'open-room', room }), 300); };
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'open-chat') chatOpen(e.data.room); });
  const q = new URLSearchParams(location.search);
  if (q.has('chat')) { history.replaceState(null, '', location.pathname); setTimeout(() => chatOpen(q.get('chat')), 400); }

  window.chatVoice = () => { go('chat'); setTimeout(() => send({ type: 'open-voice', name: 'Войс-чат' }), 150); };
  ensure();
})();
