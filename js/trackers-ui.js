// 모션 트래커 화면: 측정 방법 고르기 · 연결 상태 · 부위 지정(흔들어서 찾기) · 보정 · 뼈대 미리보기
import { rig, PARTS, TRACKER_EXERCISES } from "./trackers.js";
import { store } from "./store.js";
import { say, sfx } from "./sound.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SOURCES = [
  ["camera", "카메라", "폰 카메라로 관절을 인식해요. 18가지 운동 모두 가능"],
  ["trackers", "트래커", "몸에 붙인 트래커 6개로만 측정해요. 폰은 아무 데나 둬도 되고, 하체 운동 9가지 가능 (나머지는 자동으로 카메라)"],
  ["both", "둘 다", "카메라 화면에 트래커 뼈대를 맞춰 하체 각도를 더 정확하게. 카메라에서 가려져도 트래커로 계속 측정"],
];
const shortId = (id) => (id || "").replace(/\/0$/, "").replace(/:/g, "").slice(-5);

const ui = { finding: null, findSince: 0, findCand: null, cal: null, msg: "", msgBad: false };
let mounted = null;

export function trackerSummary() {
  const src = SOURCES.find(([v]) => v === (store.settings.source || "camera"));
  if (!rig.running) return { src: src[1], line: rig.assignedCount ? `트래커 ${rig.assignedCount}개 지정됨 · 눌러서 연결` : "와이파이 트래커 연결하기" };
  const st = rig.ready ? "보정 완료" : rig.calib ? "보정 중" : "보정 필요";
  return { src: src[1], line: `트래커 ${rig.liveCount}/6 연결 · ${st}` };
}

export function trackersScreen(backBar) {
  const src = store.settings.source || "camera";
  return `${backBar("모션 트래커")}
  <section class="block">
    <h3>측정 방법</h3>
    <div class="seg" role="tablist">${SOURCES.map(([v, l]) => `<button role="tab" aria-selected="${v === src}" data-act="trk-src" data-val="${v}">${l}</button>`).join("")}</div>
    <p class="muted">${SOURCES.find(([v]) => v === src)[2]}</p>
  </section>

  <section class="block">
    <h3>연결</h3>
    <div id="trkConn" class="trk-conn"></div>
    <details class="trk-help"><summary>연결이 안 될 때</summary>
      <ul>
        <li>폰과 트래커가 <b>같은 와이파이</b>에 있어야 해요. 트래커에 저장된 와이파이를 그대로 쓰거나, 폰 핫스팟 이름·비밀번호를 그 와이파이와 똑같이 맞추면 밖에서도 돼요.</li>
        <li><b>PC의 SlimeVR 서버는 꺼주세요.</b> 켜져 있으면 트래커가 PC 쪽에 붙어요. 공식 SlimeVR 안드로이드 앱도 같이 켜두면 안 돼요 (같은 6969 포트 사용).</li>
        <li>트래커 전원을 껐다 켜면 몇 초 안에 다시 붙어요.</li>
      </ul>
    </details>
  </section>

  <section class="block">
    <h3>부위 지정</h3>
    <p class="muted">‘찾기’를 누르고 그 부위에 붙인 트래커를 흔들면 자동으로 지정돼요</p>
    <div id="trkParts" class="list"></div>
    <div id="trkOthers"></div>
  </section>

  <section class="block">
    <h3>보정</h3>
    <p class="muted">트래커를 몸에 붙인 뒤, 운동 전에 한 번. 붙이는 방향은 아무렇게나 해도 돼요</p>
    <div class="trk-cal">
      <button class="btn outline" data-act="trk-cal1"><b>1</b> 똑바로 서기</button>
      <button class="btn outline" data-act="trk-cal2"><b>2</b> 살짝 앉기</button>
    </div>
    <p id="trkCalMsg" class="trk-msg" aria-live="polite"></p>
  </section>

  <section class="block">
    <h3>뼈대 미리보기</h3>
    <div class="trk-preview">
      <figure><canvas id="trkSide" width="300" height="360"></canvas><figcaption>옆에서</figcaption></figure>
      <figure><canvas id="trkFront" width="300" height="360"></canvas><figcaption>정면에서</figcaption></figure>
    </div>
    <div id="trkAngles" class="trk-angles"></div>
    <p class="muted small">트래커로 할 수 있는 운동: 스쿼트, 런지, 사이드 런지, 데드리프트, 글루트 브릿지, 월싯, 하이니즈, 마운틴 클라이머, 레그 레이즈 (${TRACKER_EXERCISES.length}가지)</p>
  </section>`;
}

/** 화면이 그려진 뒤: 실시간 갱신 시작 */
export function mountTrackers() {
  unmountTrackers();
  const upd = throttle(() => update(), 150);
  rig.listeners.add(upd);
  let raf = 0;
  const frame = () => { raf = requestAnimationFrame(frame); preview(); findStep(); };
  raf = requestAnimationFrame(frame);
  mounted = { upd, stop: () => cancelAnimationFrame(raf) };
  update();
  if (!rig.running && rig.assignedCount) rig.start();
}
export function unmountTrackers() {
  if (!mounted) return;
  rig.listeners.delete(mounted.upd);
  mounted.stop();
  mounted = null;
  ui.finding = null;
}

function update() {
  const $ = (id) => document.getElementById(id);
  const conn = $("trkConn");
  if (!conn) return;
  const ip = (rig.ips || []).map((s) => s.split(" ").pop()).join(", ");
  conn.innerHTML = rig.running
    ? `<div class="trk-status on"><i></i><div><b>트래커 기다리는 중 · ${rig.list().filter((t) => t.connected).length}개 연결</b><span class="muted small">폰 주소 ${esc(ip || "-")} · 포트 6969</span></div>
        <button class="text-btn" data-act="trk-stop">끄기</button></div>`
    : `<div class="trk-status"><i></i><div><b>꺼져 있음</b>${rig.error ? `<span class="error">${esc(rig.error)}</span>` : `<span class="muted small">켜면 같은 와이파이의 트래커가 자동으로 연결돼요</span>`}</div>
        <button class="btn primary" data-act="trk-start">켜기</button></div>`;

  $("trkParts").innerHTML = PARTS.map((p) => {
    const t = rig.tracker(p.id);
    const live = rig.live(p.id);
    const finding = ui.finding === p.id;
    const cand = finding && ui.findCand ? rig.trackers.get(ui.findCand) : null;
    const status = finding ? (cand ? `${shortId(cand.id)} 흔들림 감지…` : "이 부위 트래커를 흔들어주세요")
      : t ? `${shortId(t.id)}${live ? ` · 배터리 ${batt(t)}` : " · 연결 안 됨"}` : "지정 안 됨";
    return `<div class="row static trk-part${finding ? " finding" : ""}">
      <span class="trk-dot ${live ? "on" : t ? "off" : ""}"></span>
      <div class="row-main"><b>${p.name}</b><span class="muted small">${esc(status)}</span></div>
      ${t && !finding ? `<button class="text-btn muted-btn" data-act="trk-unassign" data-part="${p.id}">해제</button>` : ""}
      <button class="btn ${finding ? "primary" : "outline"} sm" data-act="trk-find" data-part="${p.id}">${finding ? "취소" : t ? "다시 찾기" : "찾기"}</button>
    </div>`;
  }).join("");

  const others = rig.list().filter((t) => !rig.partOf(t.id));
  $("trkOthers").innerHTML = others.length
    ? `<p class="muted small trk-others">지정 안 된 트래커: ${others.map((t) => `<span class="trk-chip${t.motion > 60 ? " moving" : ""}">${shortId(t.id)}${t.connected ? "" : " (끊김)"}</span>`).join(" ")}</p>` : "";

  const msg = $("trkCalMsg");
  const calText = ui.cal ? ui.cal : ui.msg ? ui.msg : rig.ready ? "보정 완료. 운동을 시작해도 돼요 (쉬는 시간에 똑바로 서 있으면 자동으로 다시 맞춰요)"
    : rig.calib ? "1단계 완료. 이제 2단계를 해주세요" : "";
  msg.textContent = calText;
  msg.className = `trk-msg${ui.msgBad ? " bad" : rig.ready && !ui.cal ? " good" : ""}`;
  document.querySelectorAll("[data-act=trk-cal1],[data-act=trk-cal2]").forEach((b) => { b.disabled = !!ui.cal || !rig.running; });
}

const batt = (t) => (t.battery < 0 ? "-" : `${Math.round(t.battery * 100)}%`);

// 흔들어서 찾기: 같은 트래커가 0.6초 넘게 가장 많이 움직이면 지정
function findStep() {
  if (!ui.finding) return;
  const others = Object.entries(rig.assign).filter(([p]) => p !== ui.finding).map(([, id]) => id);
  const m = rig.mostMoving(others);
  const now = performance.now();
  if (!m) { if (ui.findCand) { ui.findCand = null; update(); } return; }
  if (m.id !== ui.findCand) { ui.findCand = m.id; ui.findSince = now; update(); return; }
  if (now - ui.findSince > 600) {
    const part = ui.finding;
    rig.setAssign(part, m.id);
    ui.finding = null; ui.findCand = null;
    sfx.rep?.();
    ui.msg = `${PARTS.find((p) => p.id === part).name}: ${shortId(m.id)} 지정. 부위가 바뀌었으니 보정을 다시 해주세요`;
    ui.msgBad = false;
    update();
  }
}

/** 3초 세고 보정 */
function countdown(label, scene, fn) {
  if (ui.cal) return;
  let n = 3;
  rig.setDemoScene(scene);
  const tick = () => {
    if (!mounted) { ui.cal = null; return; }
    if (n > 0) { ui.cal = `${label} ${n}`; say(String(n), { interrupt: true }); sfx.count?.(); n--; update(); setTimeout(tick, 1000); return; }
    ui.cal = null;
    const r = fn();
    ui.msgBad = !r.ok;
    ui.msg = r.ok ? (r.text || "") : r.msg;
    if (r.ok) sfx.go?.();
    say(r.ok ? (r.say || "완료") : r.msg, { interrupt: true });
    update();
  };
  tick();
}

export function onTrackerAct(act, b, rerender) {
  switch (act) {
    case "trk-src": store.setSetting("source", b.dataset.val); if (b.dataset.val !== "camera") rig.start(); rerender(); return true;
    case "trk-start": rig.start(); return true;
    case "trk-stop": rig.stop(); return true;
    case "trk-find": {
      const part = b.dataset.part;
      if (!rig.running) rig.start();
      ui.finding = ui.finding === part ? null : part;
      ui.findCand = null;
      ui.msg = ""; ui.msgBad = false;
      if (ui.finding) rig.setDemoScene(`shake:${part}`);
      update();
      return true;
    }
    case "trk-unassign": rig.setAssign(b.dataset.part, null); update(); return true;
    case "trk-cal1":
      ui.msg = "";
      countdown("똑바로 서서 앞을 보세요…", "stand", () => {
        const r = rig.calibrateStand();
        if (!r.ok) return r;
        return { ok: true, text: rig.ready ? "다시 맞췄어요" : `1단계 완료${r.missing.length ? ` (연결 안 된 부위: ${r.missing.join(", ")})` : ""}. 이제 2단계: 무릎을 앞으로 내밀며 살짝 앉아요`, say: rig.ready ? "다시 맞췄어요" : "이제 살짝 앉아주세요" };
      });
      return true;
    case "trk-cal2":
      ui.msg = "";
      countdown("무릎을 앞으로, 살짝 앉으세요…", "calib", () => {
        const r = rig.calibrateForward();
        rig.setDemoScene("squat");
        return r.ok ? { ok: true, text: "보정 완료! 아래 미리보기에서 움직임을 확인해보세요", say: "보정 완료" } : r;
      });
      return true;
  }
  return false;
}

// ---------- 미리보기 ----------
const BONES = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 29], [27, 31], [24, 26], [26, 28], [28, 30], [28, 32], [7, 8], [0, 7], [0, 8]];
function preview() {
  for (const [id, view] of [["trkSide", "side"], ["trkFront", "front"]]) {
    const c = document.getElementById(id);
    if (!c) continue;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    const t = rig.landmarks(view, { W: 720, H: 1280 });
    if (!t) {
      ctx.fillStyle = "#8aa0b4";
      ctx.font = "600 22px Pretendard, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(rig.calib?.done ? "골반 트래커 연결 안 됨" : "보정하면 보여요", c.width / 2, c.height / 2);
      continue;
    }
    // 화면에 꽉 차게
    const pts = t.lm.map((l) => [l.x * 720, l.y * 1280]);
    const used = [0, 7, 8, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
    const xs = used.map((i) => pts[i][0]), ys = used.map((i) => pts[i][1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const k = Math.min((c.width - 50) / Math.max(w, 1), (c.height - 80) / Math.max(h, 1), 0.6); // 머리 그릴 자리 남김
    const ox = c.width / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * k, oy = c.height - 20 - Math.max(...ys) * k;
    const P = (i) => [ox + pts[i][0] * k, oy + pts[i][1] * k];
    ctx.strokeStyle = "#dbe7f1"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(10, oy + Math.max(...ys) * k + 2); ctx.lineTo(c.width - 10, oy + Math.max(...ys) * k + 2); ctx.stroke();
    ctx.lineCap = "round";
    ctx.lineWidth = 9;
    ctx.strokeStyle = "#1e9be8";
    for (const [a, b] of BONES) { ctx.beginPath(); ctx.moveTo(...P(a)); ctx.lineTo(...P(b)); ctx.stroke(); }
    ctx.fillStyle = "#0f2740";
    const [hx, hy] = P(0), [ex, ey] = P(7);
    ctx.beginPath(); ctx.arc((hx + ex) / 2, (hy + ey) / 2 - 6, 15, 0, Math.PI * 2); ctx.fill();
    for (const i of [11, 12, 23, 24, 25, 26, 27, 28]) { const [x, y] = P(i); ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = "#0f2740"; ctx.stroke(); }
    ctx.lineWidth = 9; ctx.strokeStyle = "#1e9be8";
  }
  const a = rig.jointAngles();
  const el = document.getElementById("trkAngles");
  if (el) {
    const f = (v) => (v == null ? "-" : `${Math.round(v)}°`);
    const html = a ? `<span>무릎 <b>${f(a.leftKnee)}</b> / <b>${f(a.rightKnee)}</b></span><span>엉덩이 <b>${f(a.leftHip)}</b> / <b>${f(a.rightHip)}</b></span><span>상체 숙임 <b>${f(a.trunk)}</b></span>` : "";
    if (el.innerHTML !== html) el.innerHTML = html;
  }
}

function throttle(fn, ms) {
  let last = 0, timer = 0;
  return () => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(); return; }
    clearTimeout(timer);
    timer = setTimeout(() => { last = Date.now(); fn(); }, ms - (now - last));
  };
}
