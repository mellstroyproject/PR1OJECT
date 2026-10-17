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
