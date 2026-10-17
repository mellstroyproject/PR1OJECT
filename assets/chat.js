// ===== 💬 Чат: один постоянный мессенджер на весь сайт =====
// iframe живёт всё время, поэтому голос не сбрасывается при переходах по сайту.
// Сбрасывается только перезагрузка страницы (F5).
(function(){
  let frame = null, ready = false, pendingCmd = null;
  const ensure = () => {
    if (frame) return frame;
    frame = document.createElement('iframe');
    frame.id = 'msgFrame'; frame.src = '/messenger'; frame.title = 'Чат';
    frame.setAttribute('allow', 'clipboard-write; microphone; autoplay');
    frame.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;border:0;border-radius:16px;background:#313338;z-index:60;display:none';
    document.body.appendChild(frame);
    return frame;
  };
  const send = cmd => {
    const f = ensure();
    if (ready && f.contentWindow) f.contentWindow.postMessage(cmd, location.origin);
    else pendingCmd = cmd;
  };
  // iframe ставим поверх места, где нарисован чат; на остальных страницах прячем (но не выгружаем)
  const place = () => {
    const f = ensure();
    const slot = document.getElementById('chatSlot');
    if (!slot || st.page !== 'chat') { f.style.display = 'none'; return; }
    const r = slot.getBoundingClientRect();
    f.style.display = 'block';
    f.style.left = r.left + 'px'; f.style.top = r.top + 'px';
    f.style.width = r.width + 'px'; f.style.height = r.height + 'px';
  };
  const _v2 = view;
  view = function(){
    document.body.classList.toggle('pg-chat', st.page === 'chat');
    const out = st.page === 'chat' ? '<div class="chatpg"><div id="chatSlot"></div></div>' : _v2();
    setTimeout(place, 0);
    return out;
  };
  addEventListener('resize', place);
  addEventListener('scroll', place, true);

  // плашки: личные сообщения, упоминания и входящие звонки
  const toasts = document.createElement('div');
  toasts.id = 'chatToasts';
  document.body.appendChild(toasts);
  // мелодия входящего звонка: играет на любой странице сайта, в том числе в чате
  const ringSnd = new Audio('/ring.mp3'); ringSnd.loop = true;
  let ringT = null;
  const ringStart = () => { ringSnd.currentTime = 0; ringSnd.play().catch(() => {}); };
  const ringStop = () => { ringSnd.pause(); clearTimeout(ringT); };

  const plaque = d => {
    if (d.kind === 'call') { ringStart(); clearTimeout(ringT); ringT = setTimeout(ringStop, d.ttl || 30000); }
    if (st.page === 'chat') return;   // на странице чата и так всё видно
    const el = document.createElement('div');
    el.className = 'chat-plaque' + (d.kind === 'call' ? ' call' : '');
    const b = document.createElement('b'); b.textContent = d.title;
    const t = document.createElement('span'); t.textContent = d.text || '';
    const row = document.createElement('div'); row.className = 'cp-btns';
    const open = document.createElement('button'); open.textContent = d.kind === 'call' ? 'Открыть звонок' : 'Открыть';
    const x = document.createElement('button'); x.textContent = '✕';
    el.append(b, t, row); row.append(open, x);
    const close = () => { el.remove(); if (d.kind === 'call') ringStop(); };
    open.onclick = () => { close(); go('chat'); setTimeout(() => send({ type: 'open-room', room: d.room }), 150); };
    x.onclick = close;
    toasts.appendChild(el);
    setTimeout(close, d.ttl || 8000);
  };

  addEventListener('message', e => {
    if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
    const d = e.data || {};
    if (d.type === 'msg-ready') {
      ready = true;
      if (pendingCmd) { frame.contentWindow.postMessage(pendingCmd, location.origin); pendingCmd = null; }
    }
    if (d.type === 'chat-notify') plaque(d);
    if (d.type === 'call-stop') ringStop();
  });

  // переход по push-уведомлению: открыть чат на нужной комнате
  const chatOpen = room => { go('chat'); if (room) setTimeout(() => send({ type: 'open-room', room }), 300); };
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'open-chat') chatOpen(e.data.room); });
  const q = new URLSearchParams(location.search);
  if (q.has('chat')) { history.replaceState(null, '', location.pathname); setTimeout(() => chatOpen(q.get('chat')), 400); }

  window.chatVoice = () => { go('chat'); setTimeout(() => send({ type: 'open-voice', name: 'Войс-чат' }), 150); };
  ensure();
})();
