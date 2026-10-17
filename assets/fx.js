(function(){
  const fx=document.createElement('div');fx.className='fx';fx.innerHTML='<i></i><i></i><i></i><i></i><i></i><i></i>';document.body.prepend(fx);
  const sp=document.createElement('div');sp.className='spot';document.body.prepend(sp);
  let px=0,py=0,pr=0;addEventListener('pointermove',e=>{px=e.clientX;py=e.clientY;if(!pr)pr=requestAnimationFrame(()=>{pr=0;sp.style.setProperty('--mx',px+'px');sp.style.setProperty('--my',py+'px');sp.style.opacity=1})},{passive:true});
  if(MOTION_OFF)return;
  const c=document.createElement('canvas');c.className='stars';document.body.prepend(c);
  const x=c.getContext('2d');let W,H,P=[],col='74,108,247';
  const S=.5; // звёзды рисуем в половину разрешения: в 4 раза меньше пикселей на кадр
  const size=()=>{W=innerWidth;H=innerHeight;c.width=Math.ceil(W*S);c.height=Math.ceil(H*S);x.setTransform(S,0,0,S,0,0);P=Array.from({length:Math.min(70,Math.floor(W*H/22000))},()=>({x:Math.random()*W,y:Math.random()*H,r:Math.random()*1.8+.4,v:Math.random()*.25+.05,t:Math.random()*6.28}))};
  size();addEventListener('resize',size);
  let spr=null,sprCol='',lt=0;
  const mk=()=>{const k=document.createElement('canvas');k.width=k.height=32;const g=k.getContext('2d'),gr=g.createRadialGradient(16,16,0,16,16,16);gr.addColorStop(0,'rgba('+col+',1)');gr.addColorStop(.25,'rgba('+col+',.55)');gr.addColorStop(1,'rgba('+col+',0)');g.fillStyle=gr;g.fillRect(0,0,32,32);spr=k;sprCol=col};
  setInterval(()=>{if(!document.hidden)col=getComputedStyle(document.documentElement).getPropertyValue('--acc-rgb').trim()||col},1500);
  (function f(t){requestAnimationFrame(f);if(document.hidden||t-lt<33)return;lt=t;if(!spr||sprCol!==col)mk();
    x.clearRect(0,0,W,H);for(const p of P){p.y-=p.v*2;p.t+=.04;if(p.y<-5){p.y=H+5;p.x=Math.random()*W}
      x.globalAlpha=.35+.35*Math.sin(p.t);const d=p.r*5;x.drawImage(spr,p.x-d,p.y-d,d*2,d*2)}x.globalAlpha=1})(0);
})();
