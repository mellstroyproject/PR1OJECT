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
