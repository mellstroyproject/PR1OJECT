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
