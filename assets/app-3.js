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
