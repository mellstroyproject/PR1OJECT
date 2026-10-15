// Запрос состояния сервера по протоколу Steam (A2S_INFO) — без внешних библиотек.
// Возвращает название, карту, количество игроков и максимум.
const dgram = require('dgram');

function readCStr(buf, off) {
  const end = buf.indexOf(0, off);
  if (end < 0) return { s: buf.slice(off).toString('utf8'), next: buf.length };
  return { s: buf.slice(off, end).toString('utf8'), next: end + 1 };
}

function query(host, port, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const base = Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]), Buffer.from('Source Engine Query\0')]);
    let done = false;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.close(); } catch (e) {}
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);

    sock.on('error', e => finish(e));
    sock.on('message', msg => {
      if (msg.length < 6 || msg.readUInt32LE(0) !== 0xffffffff) return;
      const type = msg[4];
      if (type === 0x41) {                       // сервер прислал challenge — повторяем запрос с ним
        sock.send(Buffer.concat([base, msg.slice(5, 9)]), port, host);
        return;
      }
      if (type !== 0x49) return;                  // 0x49 — ответ A2S_INFO
      try {
        let o = 6;                                // байт протокола пропускаем
        const name = readCStr(msg, o); o = name.next;
        const map = readCStr(msg, o); o = map.next;
        const folder = readCStr(msg, o); o = folder.next;
        const game = readCStr(msg, o); o = game.next;
        o += 2;                                   // appid
        const players = msg[o++];
        const maxPlayers = msg[o++];
        const bots = msg[o++];
        finish(null, { name: name.s, map: map.s, game: game.s, players, maxPlayers, bots });
      } catch (e) { finish(e); }
    });

    sock.send(base, port, host, err => { if (err) finish(err); });
  });
}

// Список игроков (A2S_PLAYER): ник, очки, время в секундах.
function players(host, port, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    let done = false;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.close(); } catch (e) {}
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);
    const req = ch => Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff, 0x55]), ch]);
    sock.on('error', e => finish(e));
    sock.on('message', msg => {
      if (msg.length < 6 || msg.readUInt32LE(0) !== 0xffffffff) return;
      const type = msg[4];
      if (type === 0x41) { sock.send(req(msg.slice(5, 9)), port, host); return; }
      if (type !== 0x44) return;
      try {
        const count = msg[5];
        let o = 6;
        const list = [];
        for (let i = 0; i < count && o < msg.length; i++) {
          o++;                                    // индекс игрока
          const nm = readCStr(msg, o); o = nm.next;
          const score = msg.readInt32LE(o); o += 4;
          const dur = msg.readFloatLE(o); o += 4;
          list.push({ name: nm.s || '(без ника)', score, time: Math.max(0, Math.floor(dur)) });
        }
        finish(null, list);
      } catch (e) { finish(e); }
    });
    sock.send(req(Buffer.from([0xff, 0xff, 0xff, 0xff])), port, host, err => { if (err) finish(err); });
  });
}

module.exports = { query, players };
