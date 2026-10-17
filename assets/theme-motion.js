(function(){
  const R=document.documentElement;
  if(typeof MOTION_OFF!=='undefined'&&MOTION_OFF&&typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches)R.classList.add('nomo');
  const nomo=R.classList.contains('nomo');
  document.addEventListener('visibilitychange',()=>R.classList.toggle('hid',document.hidden));
  if(!('IntersectionObserver' in window))return;
  const artIO=new IntersectionObserver(es=>es.forEach(e=>e.target.classList.toggle('off',!e.isIntersecting)),{rootMargin:'80px'});
  const rvIO=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;const el=e.target;rvIO.unobserve(el);el.classList.add('rv-in');setTimeout(()=>el.classList.remove('rv','rv-in'),900)}),{rootMargin:'0px 0px -6% 0px'});
  function after(){
    document.querySelectorAll('.mode-art:not([data-io])').forEach(e=>{e.dataset.io=1;artIO.observe(e)});
    if(nomo)return;
    const vh=innerHeight;
    document.querySelectorAll('#app .mode,#app .plan,#app .set-card,#app .admin-card,#app .bar,#app .side').forEach(e=>{
      if(e.dataset.rv)return;e.dataset.rv=1;
      if(e.getBoundingClientRect().top>vh*.94){e.classList.add('rv');rvIO.observe(e)}});
  }
  try{const _d=draw;draw=function(){const r=_d.apply(this,arguments);requestAnimationFrame(after);return r}}catch(e){}
  requestAnimationFrame(after);
})();
