// ===== Баны и муты через сайт =====
async function loadBans(){
  try{
    for(const k of ['bans','mutes']){
      const rows=await api('bans?type='+k),arr=k==='bans'?bans:mutes;
      arr.length=0;
      rows.forEach(r=>arr.push([r.player,r.admin,r.reason,r.active?1:0,r.term,new Date(r.at).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'})]));
    }
  }catch(e){}
  draw();
}
async function adminAction(verb){
  const t=($('#adminTarget')?.value||'').trim();
  if(!t){uiAlert('Укажите SteamID64 игрока (17 цифр)');return}
  if(verb==='Разбанен'||verb==='Размьючен'){
    if(!/^\d{17}$/.test(t)){uiAlert('Для разбана укажите SteamID64 игрока (17 цифр)');return}
    const fw=await uiForm(verb==='Разбанен'?'Разбанить игрока':'Снять мут',t,[{key:'why',label:'Причина',value:'Разбан с сайта'}],{ok:verb==='Разбанен'?'Разбанить':'Снять мут',danger:false});if(!fw)return;const why=fw.why;
    const isBan=verb==='Разбанен';
    try{
      const r=await api('admin/unban',{target:t,kind:isBan?'bans':'mutes',reason:why});
      await loadBans();
      uiAlert(r.count?((isBan?'Разбанен: ':'Мут снят: ')+t):('У этого игрока нет активных '+(isBan?'банов':'мутов')));
    }catch(e){uiAlert(e.message)}
    return;
  }
  if(verb!=='Забанен'&&verb!=='Замьючен'){uiAlert('Это действие выполняется прямо в игре — нужен плагин на игровом сервере.');return}
  const fp=await uiForm(verb==='Забанен'?'Забанить игрока':'Замьютить игрока',t,[{key:'reason',label:'Причина'},{key:'days',label:'На сколько дней? (0 = навсегда)',value:'7',type:'number'}],{ok:verb==='Забанен'?'Забанить':'Замьютить'});if(!fp)return;const reason=fp.reason,d=fp.days;
  try{
    await api('admin/punish',{target:t,kind:verb==='Забанен'?'bans':'mutes',reason,days:+d||0});
    await loadBans();
    uiAlert((verb==='Забанен'?'Бан':'Мут')+' записан: '+t);
  }catch(e){uiAlert(e.message)}
}
loadBans();
