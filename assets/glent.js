// Взрывы на сайте: включаются командой /глент в Telegram-боте (24 часа). Сайт раз в 20 секунд спрашивает /api/glent.
(function(){
  let on=false,cv,cx,bv,bx,W,H,dpr=1,fx=[],fl=[],raf=0,last=0,nextAt=0,flash=0,pollT=0;
  const IMG=new Image();IMG.src='data:image/png;base64,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';
  const rnd=(a,b)=>a+Math.random()*(b-a);
  const reduce=MOTION_OFF&&typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  function size(){dpr=Math.min(2,devicePixelRatio||1);W=innerWidth;H=innerHeight;for(const c of[cv,bv])c.width=W*dpr,c.height=H*dpr;cx.setTransform(dpr,0,0,dpr,0,0);bx.setTransform(dpr,0,0,dpr,0,0);bx.imageSmoothingEnabled=false}
  function boom(x,y,s){
    s=s||rnd(.7,1.6);if(fx.length>16)fx.shift();
    const p=[],n=Math.floor(48*s);
    for(let i=0;i<n;i++){const a=rnd(0,6.283),v=rnd(1,9)*s;p.push({x:x,y:y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-rnd(0,2),life:rnd(32,75),max:0,r:rnd(1.2,3.6),h:rnd(12,52)});p[i].max=p[i].life}
    fx.push({x:x,y:y,s:s,t:0,p:p});
    if(s>1.1)flash=Math.max(flash,.2);
    if(Math.random()<.6&&fl.length<14){ // фигурка вылетает из места взрыва на заднем фоне
      const a=rnd(0,6.283),v=rnd(1.5,5);
      fl.push({x:x,y:y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-1,r:rnd(0,6.283),vr:rnd(-.09,.09),w:rnd(46,96),t:0});
    }
  }
  function frame(now){
    raf=requestAnimationFrame(frame);
    const k=Math.min(2.5,(now-(last||now))/16.7||1);last=now;
    if(now>nextAt){
      boom(rnd(.05,.95)*W,rnd(.08,.9)*H);
      if(Math.random()<.25)setTimeout(()=>on&&boom(rnd(.05,.95)*W,rnd(.08,.9)*H,rnd(.6,1.2)),rnd(80,250));
      nextAt=now+rnd(350,1100);
    }
    bx.clearRect(0,0,W,H);
    if(IMG.complete)for(let i=fl.length-1;i>=0;i--){
      const q=fl[i];q.t+=k;q.x+=q.vx*k;q.y+=q.vy*k;q.r+=q.vr*k;q.vy+=.015*k;
      const hh=q.w*IMG.height/IMG.width;
      if(q.t>420||q.x<-q.w||q.x>W+q.w||q.y<-q.w||q.y>H+q.w){fl.splice(i,1);continue}
      bx.save();bx.globalAlpha=Math.min(1,q.t/12)*Math.min(1,(420-q.t)/60)*.9;
      bx.translate(q.x,q.y);bx.rotate(q.r);bx.drawImage(IMG,-q.w/2,-hh/2,q.w,hh);bx.restore();
    }
    cx.clearRect(0,0,W,H);
    if(flash>.005){cx.fillStyle='rgba(255,226,170,'+flash+')';cx.fillRect(0,0,W,H);flash*=Math.pow(.86,k)}
    cx.globalCompositeOperation='lighter';
    for(let i=fx.length-1;i>=0;i--){
      const e=fx[i];e.t+=k;
      const R=95*e.s,u=Math.min(1,e.t/30),ease=1-Math.pow(1-u,3);
      if(e.t<42){ // огненный шар
        const r=R*(.35+.65*ease),a=1-e.t/42,g=cx.createRadialGradient(e.x,e.y,0,e.x,e.y,r);
        g.addColorStop(0,'rgba(255,255,230,'+a+')');g.addColorStop(.35,'rgba(255,170,40,'+a*.8+')');g.addColorStop(1,'rgba(220,40,0,0)');
        cx.fillStyle=g;cx.beginPath();cx.arc(e.x,e.y,r,0,6.283);cx.fill();
      }
      if(e.t<38){ // ударная волна
        cx.strokeStyle='rgba(255,210,140,'+(1-e.t/38)*.6+')';cx.lineWidth=Math.max(.5,5*(1-e.t/38));
        cx.beginPath();cx.arc(e.x,e.y,R*1.9*(1-Math.pow(1-Math.min(1,e.t/38),2)),0,6.283);cx.stroke();
      }
      let alive=e.t<42;
      for(const q of e.p){ // искры
        if(q.life<=0)continue;alive=true;
        const px=q.x,py=q.y;q.x+=q.vx*k;q.y+=q.vy*k;q.vy+=.12*k;q.vx*=Math.pow(.97,k);q.vy*=Math.pow(.99,k);q.life-=k;
        const a=Math.max(0,q.life/q.max);
        cx.strokeStyle='hsla('+q.h+',100%,'+(55+a*30)+'%,'+a+')';cx.lineWidth=q.r*a+.4;
        cx.beginPath();cx.moveTo(px,py);cx.lineTo(q.x,q.y);cx.stroke();
      }
      if(!alive)fx.splice(i,1);
    }
    cx.globalCompositeOperation='source-over';
  }
  const tap=e=>boom(e.clientX,e.clientY,rnd(1,1.5));
  let keep=0,au=null,mb=null,muted=false,list=[],idx=0,fails=0;
  try{muted=localStorage.getItem('nxMute')==='1'}catch(e){}
  // песня режима /глент: играет по кругу, пока режим включён. Браузеры не разрешают звук без действия посетителя — тогда она запустится при первом клике/тапе/клавише
  function unlock(){removeEventListener('pointerup',unlock,true);removeEventListener('keydown',unlock,true);tryPlay()}
  function tryPlay(){
    if(!au||document.hidden)return;
    const p=au.play();
    if(p&&p.catch)p.catch(()=>{addEventListener('pointerup',unlock,true);addEventListener('keydown',unlock,true)});
  }
  function playAt(i){if(!au||!list.length)return;idx=((i%list.length)+list.length)%list.length;au.src=list[idx];tryPlay()}
  function syncAudio(){ // список песен мог поменяться (владелец добавил или удалил): подхватываем без перезагрузки
    if(!on)return;
    if(!au){if(list.length)audioStart();return}
    if(!list.length)return audioStop();
    au.loop=list.length===1;
  }
  function audioStart(){
    if(au||!list.length)return;
    au=new Audio();au.volume=.6;au.muted=muted;au.loop=list.length===1;
    au.onended=()=>playAt(idx+1);au.onerror=()=>{if(++fails<=list.length+1)playAt(idx+1)};au.onplaying=()=>{fails=0};
    mb=document.createElement('button');mb.id='nx-mute';mb.type='button';
    mb.style.cssText='position:fixed;left:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:2147483001;width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.55);color:#fff;font-size:20px;line-height:1;cursor:pointer;animation:none;padding:0';
    const lab=()=>{mb.textContent=muted?'🔇':'🔊';mb.title=mb.ariaLabel=muted?'Включить звук':'Выключить звук'};lab();
    mb.onclick=()=>{muted=!muted;au.muted=muted;lab();try{localStorage.setItem('nxMute',muted?'1':'0')}catch(e){}if(!muted)tryPlay()};
    document.body.appendChild(mb);playAt(0);
  }
  function audioStop(){
    removeEventListener('pointerup',unlock,true);removeEventListener('keydown',unlock,true);
    if(au){au.onended=au.onerror=au.onplaying=null;au.pause();au=null}if(mb){mb.remove();mb=null}
  }
  document.addEventListener('visibilitychange',()=>{if(!au)return;document.hidden?au.pause():tryPlay()});
  function party(){ // переливающийся фон: включаем живую RGB-тему сайта, кнопки пляшут по CSS-классу
    const r=document.documentElement;r.classList.add('nx-party');
    if(r.dataset.theme!=='rgb'&&typeof applyTheme==='function')applyTheme('rgb',false);
  }
  function unparty(){
    document.documentElement.classList.remove('nx-party');
    if(typeof applyTheme==='function'){
      const t=(typeof personalTheme==='function'&&personalTheme())||(typeof SITE!=='undefined'&&SITE.theme)||'red';
      applyTheme(t,false);
    }
  }
  function start(){
    if(on||reduce)return;on=true;party();audioStart();keep=setInterval(party,1500); // повторно, если другой код сайта сменил тему
    cv=document.createElement('canvas');cv.id='nx-boom';
    cv.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000';
    bv=document.createElement('canvas');bv.id='nx-fly';
    bv.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:-1';
    document.body.prepend(bv);bx=bv.getContext('2d');
    document.body.appendChild(cv);cx=cv.getContext('2d');size();
    addEventListener('resize',size);addEventListener('pointerdown',tap,{passive:true});
    last=0;nextAt=0;raf=requestAnimationFrame(frame);
  }
  function stop(){
    if(!on)return;on=false;clearInterval(keep);unparty();audioStop();cancelAnimationFrame(raf);
    removeEventListener('resize',size);removeEventListener('pointerdown',tap);
    cv.remove();bv.remove();fx=[];fl=[];flash=0;
  }
  async function poll(){
    clearTimeout(pollT);
    try{
      const r=await (await fetch('/api/glent',{cache:'no-store'})).json();
      const was=!!(window.NX_GLENT&&window.NX_GLENT.on);
      window.NX_GLENT={on:r.on,until:Date.now()+r.left}; // состояние для кнопки «админ абуз» в админ-панели
      if(was!==r.on&&typeof st!=='undefined'&&st.page==='admin'&&typeof draw==='function')draw();
      if(r.on){list=Array.isArray(r.list)?r.list:['/glent.mp3'];start();syncAudio();pollT=setTimeout(poll,Math.min(r.left+300,20000))}else stop();
    }catch(e){}
  }
  window.nxGlentPoll=poll;
  setInterval(()=>{if(!document.hidden)poll()},20000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll()});
  poll();
})();
