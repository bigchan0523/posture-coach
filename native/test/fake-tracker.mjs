// 가짜 SlimeVR 트래커 (펌웨어 connection.cpp 동작을 흉내) — 수신기 테스트용
// node native/test/fake-tracker.mjs <이름> [host] [옵션: legacy | bundle] [초]
import dgram from "node:dgram";

const [name = "A", host = "127.0.0.1", mode = "normal", secStr = "6"] = process.argv.slice(2);
const sock = dgram.createSocket("udp4");
let server = null, lastFromServer = 0, pn = 1n, acked = false, heartbeats = 0;
const mac = Buffer.from([0x24, 0x0a, 0xc4, 0x00, 0x00, name.charCodeAt(0)]);

function hdr(type, body) {
  const h = Buffer.alloc(12);
  h.writeInt32BE(type, 0);
  h.writeBigInt64BE(pn++, 4);
  return Buffer.concat([h, body]);
}
function send(buf) { sock.send(buf, server ? server.port : 6969, server ? server.address : host); }

function handshake() {
  const fw = mode === "legacy" ? "0.1.0" : "0.6.3";
  const proto = mode === "legacy" ? 5 : 23;
  const parts = [];
  const int = (v) => { const b = Buffer.alloc(4); b.writeInt32BE(v); parts.push(b); };
  int(13); int(9); int(2); int(0); int(0); int(0); int(proto);
  parts.push(Buffer.from([fw.length]), Buffer.from(fw));
  if (mode !== "legacy") parts.push(mac, Buffer.from([0]));
  sock.send(hdr(3, Buffer.concat(parts)), 6969, host);
}
function rot(sid, t) {
  // 천천히 도는 쿼터니언 (z축 회전)
  const a = t * 0.5, s = Math.sin(a / 2), c = Math.cos(a / 2);
  if (mode === "legacy") {
    const b = Buffer.alloc(16); b.writeFloatBE(0, 0); b.writeFloatBE(0, 4); b.writeFloatBE(s, 8); b.writeFloatBE(c, 12);
    return hdr(1, b);
  }
  const b = Buffer.alloc(19);
  b[0] = sid; b[1] = 1; b.writeFloatBE(0, 2); b.writeFloatBE(0, 6); b.writeFloatBE(s, 10); b.writeFloatBE(c, 14); b[18] = 0;
  return hdr(17, b);
}

sock.on("message", (m, r) => {
  if (!server && m[0] === 3 && m.toString("ascii", 1, 13) === "Hey OVR =D 5") {
    server = { address: r.address, port: r.port };
    lastFromServer = Date.now();
    console.log(`[${name}] connected to ${r.address}:${r.port}`);
    return;
  }
  if (!server) return;
  lastFromServer = Date.now();
  const type = m[3];
  if (type === 1) { heartbeats++; send(hdr(0, Buffer.alloc(0))); }
  if (type === 15 && m.length >= 6) acked = true; // 센서 정보 확인 (int 15 + sid + status)
});

sock.bind(0, () => {
  sock.setBroadcast(true);
  const t0 = Date.now();
  let lastHs = 0, lastInfo = 0;
  const iv = setInterval(() => {
    const now = Date.now();
    if (!server) { if (now - lastHs > 1000) { lastHs = now; handshake(); } return; }
    if (now - lastFromServer > 3000) { console.log(`[${name}] TIMEOUT`); server = null; return; }
    if (mode !== "legacy" && !acked && now - lastInfo > 1000) {
      lastInfo = now;
      const b = Buffer.alloc(14); b[0] = 0; b[1] = 1; b[2] = 9; b.writeUInt16BE(0, 3); b[5] = 1; b[6] = name === "A" ? 4 : 0; b[7] = 0;
      send(hdr(15, b));
    }
    const t = (now - t0) / 1000;
    if (mode === "bundle") {
      // 묶음 패킷: [type 100][pn] + (short len + 내부패킷(type int + pn 없음? → 펌웨어는 내부에 type int + 내용, pn 없음))
      const inner = [rot(0, t), rot(1, t + 1)].map((p) => Buffer.concat([p.subarray(0, 4), p.subarray(12)]));
      const parts = inner.flatMap((p) => { const l = Buffer.alloc(2); l.writeUInt16BE(p.length); return [l, p]; });
      send(hdr(100, Buffer.concat(parts)));
    } else send(rot(0, t));
    if (Math.floor(t * 100) % 100 === 0) { const b = Buffer.alloc(8); b.writeFloatBE(3.9, 0); b.writeFloatBE(0.8, 4); send(hdr(12, b)); }
  }, 10);
  setTimeout(() => { clearInterval(iv); console.log(`[${name}] done heartbeats=${heartbeats} acked=${acked}`); sock.close(); }, Number(secStr) * 1000);
});
