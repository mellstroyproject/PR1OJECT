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
