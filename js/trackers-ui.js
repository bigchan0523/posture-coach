// 모션 트래커 화면: 측정 방법 고르기 · 연결 상태 · 부위 지정(흔들어서 찾기) · 보정 · 뼈대 미리보기
import { rig, PARTS, SETS } from "./trackers.js";
import { Exercise } from "./engine.js";
import { store } from "./store.js";
import { say, sfx } from "./sound.js";
import { Skeleton3D } from "./skeleton3d.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SOURCES = [
  ["camera", "카메라", "폰 카메라로 관절을 인식해요. 18가지 운동 모두 가능"],
  ["trackers", "트래커", "몸에 붙인 트래커로만 측정해요. 폰은 아무 데나 둬도 돼요. 트래커가 없는 부위가 필요한 운동은 자동으로 카메라를 써요"],
  ["both", "둘 다", "카메라 화면에 트래커 뼈대를 맞춰 더 정확하게. 카메라에서 가려져도 트래커로 계속 측정"],
];
const shortId = (id) => (id || "").replace(/\/0$/, "").replace(/:/g, "").slice(-5);

const ui = { finding: null, findSince: 0, findCand: null, cal: null, msg: "", msgBad: false };
let mounted = null;
// 운동 이름·필요 관절 (app.js가 운동 정의를 불러온 뒤 넣어줌) → 지금 트래커로 할 수 있는 운동 표시
let exInfo = [];
export function setTrackerExercises(defs) {
  exInfo = Object.entries(defs).map(([id, d]) => ({ id, name: d.display_name, points: new Exercise(d).cfg.requiredPoints }));
}

export function trackerSummary() {
  const src = SOURCES.find(([v]) => v === (store.settings.source || "camera"));
  if (!rig.running) return { src: src[1], line: rig.assignedCount ? `트래커 ${rig.assignedCount}개 지정됨 · 눌러서 연결` : "와이파이 트래커 연결하기" };
  const st = rig.ready ? "보정 완료" : rig.calib ? "보정 중" : "보정 필요";
  return { src: src[1], line: `트래커 ${rig.liveCount}/${rig.set.n} 연결 · ${st}` };
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
        <li>폰 핫스팟을 쓸 때는 <b>핫스팟 화면의 ‘연결된 기기’에 트래커가 보이는지</b> 먼저 확인하세요. 안 보이면 이름·비밀번호·2.4GHz·보안(WPA2) 문제예요.</li>
        <li>‘받은 신호’가 0이면 트래커 신호가 폰까지 안 오는 거고, 늘어나는데 연결이 0개면 앱 문제예요. 캡처해서 알려주세요.</li>
        <li>트래커 전원을 껐다 켜면 몇 초 안에 다시 붙어요.</li>
      </ul>
    </details>
  </section>

  <section class="block">
    <h3>트래커 개수</h3>
    <p class="muted">가지고 있는 트래커 수에 맞게 골라주세요</p>
    <div class="trk-sets">${SETS.map((x) => `<button class="trk-set${x.id === rig.set.id ? " on" : ""}" data-act="trk-set" data-val="${x.id}">
      <b>x${x.n}</b><span><strong>${x.name}</strong><small>${x.note}</small></span></button>`).join("")}</div>
  </section>

  <section class="block">
    <h3>부위 지정</h3>
    <p class="muted">몸 그림의 점이나 ‘찾기’를 누르고, 그 부위에 붙인 트래커를 흔들면 자동으로 지정돼요. 지정한 트래커를 흔들면 점이 반짝여요</p>
    <div class="trk-body-wrap"><svg id="trkBody" class="trk-body" viewBox="0 0 200 384" role="img" aria-label="몸 그림, 트래커 위치"></svg></div>
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
    <h3>3D 뼈대</h3>
    <div class="trk-3d">
      <canvas id="trk3d" aria-label="3D 뼈대. 드래그해서 돌려볼 수 있어요"></canvas>
      <div class="trk-views">${[["free", "자유"], ["front", "정면"], ["side", "옆"], ["top", "위"]].map(([v, l]) => `<button data-act="trk-view" data-val="${v}">${l}</button>`).join("")}</div>
      <p class="trk-3d-hint">드래그로 돌리기 · 두 손가락으로 확대 · 두 번 탭하면 처음으로</p>
    </div>
    <div id="trkAngles" class="trk-angles"></div>
    <p id="trkExList" class="muted small"></p>
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
  const ip = (rig.ips || []).join(", ");
  const n = rig.net || {};
  const diag = rig.running ? `<p class="muted small trk-diag">받은 신호 ${n.packets || 0}개 · 연결 요청 ${n.handshakes || 0}번${n.lastFrom ? ` · 마지막 ${esc(n.lastFrom)}` : ""}<br>폰 네트워크: ${esc(ip || "-")}${rig.log?.length ? `<br>${rig.log.slice(-3).map(esc).join("<br>")}` : ""}</p>` : "";
  conn.innerHTML = (rig.running
    ? `<div class="trk-status on"><i></i><div><b>트래커 기다리는 중 · ${rig.list().filter((t) => t.connected).length}개 연결</b><span class="muted small">포트 6969에서 기다리는 중</span></div>
        <button class="text-btn" data-act="trk-stop">끄기</button></div>`
    : `<div class="trk-status"><i></i><div><b>꺼져 있음</b>${rig.error ? `<span class="error">${esc(rig.error)}</span>` : `<span class="muted small">켜면 같은 와이파이의 트래커가 자동으로 연결돼요</span>`}</div>
        <button class="btn primary" data-act="trk-start">켜기</button></div>`) + diag;

  $("trkBody").innerHTML = bodySvg();
  const can = exInfo.filter((e) => rig.supports(e.points, e.id));
  $("trkExList").innerHTML = exInfo.length ? `지금 지정한 트래커로 할 수 있는 운동 (${can.length}/${exInfo.length}): ${can.map((e) => esc(e.name)).join(", ") || "없음"}` : "";
  $("trkParts").innerHTML = rig.parts.map((p) => {
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

/** 몸 그림 + 부위 점 (정면에서 본 사람: 사람의 왼쪽이 화면 오른쪽) */
function bodySvg() {
  const line = (pts, w = 20) => `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="#d7ecfb" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  let out = `<circle cx="100" cy="34" r="21" fill="#d7ecfb"/>`
    + line([[100, 50], [100, 74]], 14)
    + `<rect x="72" y="76" width="56" height="118" rx="22" fill="#d7ecfb"/>`
    + line([[132, 86], [148, 140], [156, 196]], 16) + line([[68, 86], [52, 140], [44, 196]], 16)
    + line([[112, 188], [118, 268], [120, 350], [128, 366]], 22) + line([[88, 188], [82, 268], [80, 350], [72, 366]], 22);
  for (const p of rig.parts) {
    const t = rig.tracker(p.id), live = rig.live(p.id);
    const moving = live && live.motion > 60;
    const cls = ui.finding === p.id ? "find" : live ? "on" : t ? "off" : "";
    out += `<g class="trk-pt ${cls}${moving ? " moving" : ""}" data-act="trk-find" data-part="${p.id}" role="button" aria-label="${p.name} ${t ? "지정됨" : "지정 안 됨"}">
      <circle cx="${p.x}" cy="${p.y}" r="16" class="hit"/><circle cx="${p.x}" cy="${p.y}" r="8.5" class="dot"/></g>`;
  }
  return out;
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
    case "trk-view": viewer?.setView(b.dataset.val); return true;
    case "trk-set": rig.setSet(b.dataset.val); rerender(); return true;
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

// ---------- 3D 미리보기 ----------
let viewer = null;
function preview() {
  const c = document.getElementById("trk3d");
  if (!c) return;
  if (!viewer || viewer.c !== c) viewer = new Skeleton3D(c, { dark: true });
  const a = rig.jointAngles();
  const f = (v) => (v == null ? "-" : `${Math.round(v)}°`);
  viewer.render(rig.skeleton(), {
    forward: rig.viewForward,
    empty: rig.calib?.done ? "골반 트래커가 연결 안 됐어요" : "보정하면 여기에 뼈대가 보여요",
    labels: a ? [{ at: "left_knee", text: f(a.leftKnee) }, { at: "right_knee", text: f(a.rightKnee) }] : [],
  });
  const el = document.getElementById("trkAngles");
  if (el) {
    const html = a ? `<span>무릎 왼 <b>${f(a.leftKnee)}</b> 오 <b>${f(a.rightKnee)}</b></span><span>엉덩이 왼 <b>${f(a.leftHip)}</b> 오 <b>${f(a.rightHip)}</b></span><span>상체 숙임 <b>${f(a.trunk)}</b></span>` : "";
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
