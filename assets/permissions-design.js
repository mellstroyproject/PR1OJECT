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
