(function(){
  const hdr=document.querySelector('header'),logo=hdr&&hdr.querySelector('.logo');if(!logo)return;
  const brand=document.createElement('div');brand.className='hbrand';brand.innerHTML='<b>NextProject</b><small id="hpage"></small>';logo.after(brand);
  const conn=document.createElement('div');conn.className='hconn';conn.id='hconn';brand.after(conn);
  let sel=0,last='';
  const list=()=>{try{return Array.isArray(servers)?servers:[]}catch(e){return[]}};
  const title=()=>{try{const p=PAGES.find(x=>x[0]===st.page);if(p)return p[1]}catch(e){}const h=document.querySelector('#app h1');return h&&h.childNodes[0]?h.childNodes[0].textContent.trim():''};
  function render(){
    const hp=document.getElementById('hpage');if(hp)hp.textContent=title();
    document.querySelectorAll('#nav button:not([data-label])').forEach(b=>{b.dataset.label=b.textContent.trim()});
    const L=list(),key=JSON.stringify(L)+'|'+sel;if(key===last)return;last=key;
    if(!L.length){conn.style.display='none';return}conn.style.display='';
    if(sel>=L.length)sel=0;const [name,addr]=L[sel];
    conn.innerHTML='<svg class="hc-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/></svg>'+
      (L.length>1?'<select id="hcSel" aria-label="Сервер">'+L.map((x,i)=>'<option value="'+i+'"'+(i===sel?' selected':'')+'>'+esc(x[0])+'</option>').join('')+'</select>':'<span class="hc-name">'+esc(name)+'</span>')+
      '<span class="hc-addr">'+esc(addr)+'</span><button type="button" class="hc-copy" id="hcCopy">Копировать</button><button type="button" class="hc-go" id="hcGo">Играть</button>';
  }
  async function copy(a){
    try{await navigator.clipboard.writeText(a)}catch(e){const t=document.createElement('textarea');t.value=a;document.body.appendChild(t);t.select();try{document.execCommand('copy')}catch(_){}t.remove()}
    const b=document.getElementById('hcCopy');if(b){b.textContent='Скопировано ✓';setTimeout(()=>{const x=document.getElementById('hcCopy');if(x)x.textContent='Копировать'},1500)}
  }
  conn.addEventListener('click',e=>{const a=(list()[sel]||[])[1];if(!a)return;if(e.target.closest('#hcGo'))location.href='steam://connect/'+a;else if(e.target.closest('#hcCopy'))copy(a)});
  conn.addEventListener('change',e=>{if(e.target.id==='hcSel'){sel=+e.target.value||0;render()}});
  try{const _d=draw;draw=function(){const r=_d.apply(this,arguments);render();return r}}catch(e){}
  render();
})();
