(function(){
  const reduce=MOTION_OFF;
  // плавный уход страницы перед показом новой
  const _go=go;
  window.go=function(p){
    const a=document.getElementById('app');
    if(reduce||!a||p===st.page){_go(p);return}
    a.classList.add('leave');
    setTimeout(()=>{a.classList.remove('leave');_go(p)},150);
  };
  // волна при нажатии на кнопки
  document.addEventListener('pointerdown',e=>{
    if(reduce||!e.target.closest)return;
    const b=e.target.closest('.join,.steam,.promo-btn,nav button,.plan .buy,.ask-row button,.sk-ws button,.tabs button,.ag-tabs button,.promo-pop>button,.admin-tools button');
    if(!b)return;b.classList.add('rip');
    const r=b.getBoundingClientRect(),s=Math.max(r.width,r.height)*2,x=document.createElement('span');
    x.className='ripple';x.style.cssText='width:'+s+'px;height:'+s+'px;left:'+(e.clientX-r.left-s/2)+'px;top:'+(e.clientY-r.top-s/2)+'px';
    b.appendChild(x);setTimeout(()=>x.remove(),650);
  });
})();
