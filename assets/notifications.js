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
