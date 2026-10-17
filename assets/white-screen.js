function whiteScreen(){
  if(document.getElementById('nx-white'))return;
  const d=document.createElement('div');d.id='nx-white';
  d.style.cssText='position:fixed;inset:0;background:#fff;z-index:2147483647;opacity:0;transition:opacity .6s ease;cursor:pointer';
  const close=()=>{d.style.opacity='0';setTimeout(()=>d.remove(),600);document.removeEventListener('keydown',esc)};
  const esc=e=>{if(e.key==='Escape')close()};
  d.onclick=close;document.addEventListener('keydown',esc);
  document.body.appendChild(d);requestAnimationFrame(()=>requestAnimationFrame(()=>{d.style.opacity='1'}));
}
