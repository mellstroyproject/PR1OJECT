(function(){
  const KEY='np_skin';
  const LIST=[
    ['neon','Неон','Свечение и градиенты, как было','linear-gradient(135deg,#1a1d4a,#6b3fd4 55%,#ff5a7a)'],
    ['flat','Графит','Плоский тёмный, спокойный','linear-gradient(135deg,#15151c,#272735)'],
    ['light','Светлая','Белые карточки, дневной режим','linear-gradient(135deg,#ffffff,#dfe3f1)'],
    ['terminal','Терминал','Моно-шрифт, острые углы','linear-gradient(135deg,#050705,#16301a)'],
    ['aurora','Аврора','Мягкие градиенты и стекло','linear-gradient(135deg,#5b3df5,#d946ef 60%,#22d3ee)']
  ];
  const IDS={light:'sk-light',terminal:'sk-term',aurora:'sk-aurora'};
  let cur='flat';
  function apply(n){
    if(!LIST.some(x=>x[0]===n))n='flat';cur=n;
    const f=document.getElementById('sk-flat');if(f)f.media=n==='neon'?'not all':'all';
    for(const k in IDS){const e=document.getElementById(IDS[k]);if(e)e.media=k===n?'all':'not all'}
    document.documentElement.dataset.skin=n;
    try{localStorage.setItem(KEY,n)}catch(e){}
    document.querySelectorAll('.skopt[data-k]').forEach(b=>b.classList.toggle('on',b.dataset.k===n));
  }
  function setNav(m){
    if(m!=='bottom')m='side';
    document.documentElement.dataset.nav=m;
    try{localStorage.setItem('np_nav',m)}catch(e){}
    document.querySelectorAll('.nvopt').forEach(b=>b.classList.toggle('on',b.dataset.n===m));
    requestAnimationFrame(()=>requestAnimationFrame(()=>window.dispatchEvent(new Event('resize'))));
  }
  window.setNav=setNav;
  window.setSkin=apply;
  let saved='flat';try{saved=localStorage.getItem(KEY)||'flat'}catch(e){}
  const btn=document.createElement('button');btn.id='skinBtn';btn.type='button';btn.title='Стиль сайта';btn.setAttribute('aria-label','Стиль сайта');btn.textContent='🎨';
  const pop=document.createElement('div');pop.id='skinPop';pop.hidden=true;
  pop.innerHTML='<h4>Стиль сайта</h4>'+LIST.map(([k,t,d,bg])=>`<button type="button" class="skopt" data-k="${k}"><i style="background:${bg}"></i><span><b>${t}</b><small>${d}</small></span></button>`).join('')+'<h4>Меню</h4><div class="nvrow"><button type="button" class="nvopt" data-n="side">◧ Слева</button><button type="button" class="nvopt" data-n="bottom">▭ Снизу</button></div>';
  document.body.append(btn,pop);
  btn.addEventListener('click',e=>{e.stopPropagation();pop.hidden=!pop.hidden});
  pop.addEventListener('click',e=>{e.stopPropagation();const v=e.target.closest('.nvopt');if(v){setNav(v.dataset.n);return}const b=e.target.closest('.skopt');if(b)apply(b.dataset.k)});
  document.addEventListener('click',()=>{pop.hidden=true});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')pop.hidden=true});
  apply(saved);setNav(document.documentElement.dataset.nav);
})();
