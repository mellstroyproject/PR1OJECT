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
