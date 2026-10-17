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
