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
