// ===== Лидеры из базы игрового сервера (LevelsRanks) =====
function lbWho(r){ // аватарка + ник (+ ссылка на профиль Steam, если известен SteamID)
  const a=safeAvatar(r[5]),n=String(r[0]||'');
  const av=`<i class="pa" style="${a?`background-image:url('${a}')`:''}">${a?'':esc((n||'?').trim().charAt(0).toUpperCase())}</i>`;
  const ok=/^\d{17}$/.test(r[6]||''),nm=ok?`<a class="lnk nm" href="/profile/${r[6]}" onclick="openProfile('${r[6]}');return false">${esc(n)}</a>`:esc(n);
  return `<span class="ppl">${av}<span>${nm}</span>${r[7]?'<span class="prem">ПРЕМИУМ</span>':''}</span>`;
}
async function loadLeaders(){
  try{
    const rows=await api('leaders');
    if(rows.length){
      leaders.exp=rows.map(r=>[r.name,r.exp.toLocaleString('ru-RU'),r.kills.toLocaleString('ru-RU'),(r.deaths?r.kills/r.deaths:r.kills).toFixed(2),r.hours+' ч.',r.avatar,r.id,r.prem]);
      draw();
    }
  }catch(e){}
}
loadLeaders();

// ===== Профиль игрока =====
async function openProfile(id,noPush){
  if(!/^\d{17}$/.test(id||''))return;
  PF.id=id;PF.data=null;PF.tab='info';PF.blocks=null;PF.err='';PF.busy=true;PF.fxFor=null;st.menu=false;st.promoOpen=false;st.page='profile';if(!noPush)NAV_PUSH=true;
  try{window.scrollTo(0,0)}catch(e){}
  draw();
  try{const d=await api('player/'+id);if(PF.id===id)PF.data=d}catch(e){PF.err=e.message}
  PF.busy=false;if(st.page==='profile')draw();
}
function pfAgo(ts){
  const m=Math.floor((Date.now()-ts)/6e4);
  if(m<5)return 'Был(-а) в игре только что';
  if(m<60)return 'Был(-а) в игре '+m+' мин. назад';
  const h=Math.floor(m/60);if(h<24)return 'Был(-а) в игре '+h+' ч. назад';
  const d=Math.floor(h/24);return 'Был(-а) в игре '+d+' дн. назад';
}
function pfCopy(t){try{navigator.clipboard.writeText(t)}catch(e){}}
async function pfTab(t){
  PF.tab=t;draw();
  if(t==='bans'&&!PF.blocks){const id=PF.id;
    try{const d=await api('player/'+id+'/blocks');if(PF.id===id)PF.blocks=d}
    catch(e){if(PF.id===id)PF.blocks={bans:[],mutes:[],err:e.message}}
    draw();}
}
function profileView(){
  const back=`<button class="pf-back" onclick="go('leaders')">← К лидерам</button>`;
  if(PF.err)return back+`<div class="empty">${esc(PF.err)}</div>`;
  const d=PF.data;if(!d)return back+`<div class="empty">Загружаем профиль…</div>`;
  const tab=PF.tab||'info';
  const a=safeAvatar(d.avatar),n=String(d.name||d.id),S=d.stats;
  const num=v=>v===null||v===undefined?'—':Number(v).toLocaleString('ru-RU');
  const kd=S&&S.kills!==null&&S.deaths!==null?(S.deaths?S.kills/S.deaths:S.kills).toFixed(2):'—';
  const acc=S&&S.shoots?(S.hits/S.shoots*100).toFixed(1)+'%':'—';
  const hs=S&&S.kills?(S.headshots/S.kills*100).toFixed(1)+'%':'—';
  const hours=S&&S.hours!==null&&S.hours!==undefined?S.hours.toLocaleString('ru-RU')+' ч.':'—';
  const place=S&&S.place!==null&&S.place!==undefined?'#'+S.place.toLocaleString('ru-RU'):'—';
  const topTxt=S&&S.place&&S.total?'Топ '+Math.max(0.1,S.place/S.total*100).toFixed(1)+'%':'';
  const expTxt=S&&S.exp!==null&&S.exp!==undefined?num(S.exp):'—';
  const rankTxt=S&&S.rank!==null&&S.rank!==undefined?String(S.rank):'—';
  let id32='—',id3='—';
  try{const x=BigInt(d.id)-76561197960265728n;id3='[U:1:'+x+']';id32='STEAM_1:'+(x%2n)+':'+(x/2n)}catch(e){}
  const ban=d.banned;
  const mine=st.user&&st.user.id===d.id,fx=PF.fxFor!==d.id;PF.fxFor=d.id;
  const kv=(l,v,s)=>`<div class="pf2-kv"><span>${l}</span><b>${v}</b>${s?`<small>${s}</small>`:''}</div>`;
  const panel=(t,body,i,wide)=>`<section class="pf2-panel" style="--i:${i}"><h3>${t}</h3><div class="pf2-row${wide?' wide':''}">${body}</div></section>`;
  const seen=d.lastSeen?pfAgo(d.lastSeen):(S?'':'Игрок ещё не заходил на сервер');
  const navBtn=(k,l)=>`<button class="${tab===k?'on':''}" onclick="pfTab('${k}')">${l}</button>`;
  const fmtDate=t=>t?new Date(t).toLocaleDateString('ru-RU'):'';
  const item=(x)=>`<div class="pf2-item"><b>${esc(x.reason||'Без причины')}</b><span>${esc(x.term)} · админ: ${esc(x.admin)}${x.at?' · '+fmtDate(x.at):''} · ${x.active?'активен':'снят'}</span></div>`;
  const list=(arr,empty)=>arr&&arr.length?arr.map(item).join(''):`<div class="pf2-empty">${empty}</div>`;

  let body='';
  if(tab==='info'){
    body=`<div class="pf2-grid">
        ${panel('Статистика',kv('Звание',rankTxt)+kv('Опыт',expTxt)+kv('Место',place,topTxt)+kv('Время игры',hours),0)}
        ${panel('Результативность',kv('Убийств',num(S&&S.kills))+kv('Смертей',num(S&&S.deaths))+kv('У/С',kd),1)}
        ${panel('Меткость',kv('Точность',acc)+kv('В голову',hs)+kv('Выстрелов',num(S&&S.shoots))+kv('Попаданий',num(S&&S.hits)),2)}
        ${panel('Steam ID',`<div class="pf2-kv pf2-copy"><span>SteamID32</span><b onclick="pfCopy('${id32}')">${id32}</b></div><div class="pf2-kv pf2-copy"><span>SteamID3</span><b onclick="pfCopy('${id3}')">${id3}</b></div>`,3,true)}
      </div>
      ${S?'':'<div class="pf2-note">Статистики пока нет — игрок не появлялся в таблице лидеров.</div>'}
      ${mine&&typeof skinsView==='function'?`<div class="pf-tabs"><button class="on">Скинченджер</button></div>${skinsView().replace('<h1>Скины</h1>','')}`:''}`;
  } else if(tab==='bans'){
    const b=PF.blocks;
    body=`<section class="pf2-panel pf2-wide"><h3>Блокировки</h3>
        ${!b?`<div class="pf2-empty">Загружаем…</div>`:`
        <div class="pf2-sec">Последние баны (${b.bans.length})</div>${list(b.bans,'Нет банов')}
        <div class="pf2-sec">Последние муты (${b.mutes.length})</div>${list(b.mutes,'Нет мутов')}`}
      </section>`;
  } else if(tab==='friends'){
    body=`<section class="pf2-panel pf2-wide"><h3>Друзья</h3><div class="pf2-empty">Друзей пока нет</div></section>`;
  } else {
    body=`<section class="pf2-panel pf2-wide"><h3>Транзакции</h3>
        <div class="pf2-sec">Донаты (0 ₽)</div><div class="pf2-empty">История пополнений пуста</div>
        <div class="pf2-sec">История покупок</div><div class="pf2-empty">Покупок пока нет</div>
      </section>`;
  }

  return `<div class="pf2-page ${fx?'pf-fx':''}">${back}
  <div class="pf2">
    <aside class="pf2-side">
      <div class="pf2-card"><div class="pf2-nav">
        ${navBtn('info','Информация')}${navBtn('bans','Блокировки')}${navBtn('friends','Друзья')}${navBtn('tx','Транзакции')}
      </div></div>
      <div class="pf2-card">
        <div class="pf2-label">Steam</div>
        <a class="pf2-steamlink" href="https://steamcommunity.com/profiles/${d.id}" target="_blank" rel="noopener">
          <span class="pf2-mini" style="${a?`background-image:url('${a}')`:''}"></span>
          <span><b>${esc(n)}</b><small>открыть профиль ↗</small></span></a>
      </div>
    </aside>
    <div class="pf2-main">
      <div class="pf2-hero">
        <div class="pf2-ava" style="${a?`background-image:url('${a}')`:''}">${a?'':esc(n.trim().charAt(0).toUpperCase())}</div>
        <div class="pf2-hinfo">
          <div class="pf2-name">${esc(n)}
            ${d.role?`<span class="pf-bdg role ${({'Владелец':'own','Зам':'dep','Админ+':'plus'})[d.role]||'mod'}">${esc(d.role)}</span>`:''}${d.banned?'<span class="pf-bdg ban">Заблокирован</span>':''}${d.vip?'<span class="pf-bdg vip">Премиум</span>':''}
          </div>
          <div class="pf2-seen">${seen}</div>
          <div class="pf2-xp"><i>//</i><b>${expTxt}</b></div>
        </div>
      </div>
      ${d.banned?`<div class="pf-banbox"><b>Игрок заблокирован</b> · срок: ${esc(d.banned.term)}${d.banned.reason?' · причина: '+esc(d.banned.reason):''}</div>`:''}
      ${mine?`<div class="pf-acts"><button class="join" onclick="go('settings')">Настройки</button><button class="join del" onclick="logout()">Выйти из аккаунта</button></div>`:''}
      ${body}
    </div>
  </div></div>`;
}
{const _v=view;view=function(){return st.page==='profile'?profileView():_v()}}
if(WANT_PROFILE){const id=WANT_PROFILE;WANT_PROFILE=null;openProfile(id,true)} // открыли ссылку вида /profile/<SteamID64>
