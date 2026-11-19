const http = require("http"), fs = require("fs"), path = require("path");
const { WebSocketServer } = require("ws");
const PUB = path.join(__dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split("?")[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === "/") p = "/index.html";
  const f = path.join(PUB, path.normalize(p));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    res.end(d);
  });
});

const rooms = new Map();
let nid = 1;
const A = "ABCDEFGHJKLMNPQRSTUVWXYZ";
function newCode() {
  let c;
  do { c = ""; for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)]; } while (rooms.has(c));
  return c;
}
function bcast(r) {
  const players = [...r.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, done: p.done }));
  for (const p of r.players.values()) {
    if (p.ws.readyState !== 1) continue;
    // Người vào giữa ván không bị kéo vào ván đang chạy; họ chỉ bắt đầu ở lượt "Bắt đầu" kế tiếp.
    const go = p.joinGo === r.go ? 0 : r.go;
    p.ws.send(JSON.stringify({ t: "room", you: p.id, code: r.code, hostId: r.host, players, go, seed: r.seed, lv: r.lv }));
  }
}

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 2048 });
wss.on("connection", ws => {
  ws.alive = true;
  ws.on("pong", () => { ws.alive = true; });
  let me = null, room = null;
  const err = msg => ws.send(JSON.stringify({ t: "err", msg }));

  ws.on("message", raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if ((m.t === "create" || m.t === "join") && !me) {
      const name = String(m.name || "Bạn").slice(0, 14);
      let r;
      if (m.t === "create") {
        r = { code: newCode(), host: null, players: new Map(), go: 0, seed: 1, lv: [3, 4, 5, 6] };
        rooms.set(r.code, r);
      } else {
        r = rooms.get(String(m.code || "").toUpperCase());
        if (!r) return err("Không tìm thấy phòng này.");
        if (r.players.size >= 20) return err("Phòng đã đầy (tối đa 20 người).");
      }
      room = r;
      me = { id: nid++, name, score: 0, done: false, ws, joinGo: r.go };
      r.players.set(me.id, me);
      if (!r.host) r.host = me.id;
      return bcast(r);
    }
    if (!me || !room) return;
    if (m.t === "p") {
      if (typeof m.score === "number" && m.score >= 0 && m.score <= 100000) me.score = m.score;
      if (typeof m.done === "boolean") me.done = m.done;
      bcast(room);
    } else if (m.t === "start" && room.host === me.id) {
      const lv = Array.isArray(m.lv) ? m.lv.filter(n => [3, 4, 5, 6].includes(n)) : [];
      room.lv = lv.length ? lv : [3, 4, 5, 6];
      room.seed = Math.floor(Math.random() * 1e9) + 1;
      room.go = Date.now();
      for (const p of room.players.values()) { p.score = 0; p.done = false; p.joinGo = -1; }
      bcast(room);
    }
  });

  ws.on("close", () => {
    if (!me || !room) return;
    room.players.delete(me.id);
    if (!room.players.size) return void rooms.delete(room.code);
    if (room.host === me.id) room.host = room.players.keys().next().value;
    bcast(room);
  });
});

setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); });
}, 30000);

server.listen(process.env.PORT || 3000, () => console.log("Running on", process.env.PORT || 3000));
