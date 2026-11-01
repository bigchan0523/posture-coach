// 와이파이 모션 트래커(SlimeVR / 나래트래커) → 뼈대 → 카메라와 같은 33개 관절 좌표
//
// 흐름
//  1) 폰 안의 수신기(native/android/SlimeServer.java)가 트래커 6개의 회전값(쿼터니언)을 받음
//  2) 부위 지정: 가슴·골반·양 허벅지·양 정강이 (흔들어서 찾기)
//  3) 보정 (SlimeVR의 '전체 초기화' + '부착 방향 초기화'와 같은 원리)
//     - 똑바로 서기: 지금 자세를 '모든 뼈가 수직'인 기준으로 저장 → 트래커를 어떤 방향으로 붙였든 상관없음
//     - 살짝 앉기: 허벅지가 나가는 방향으로 '몸의 앞쪽'을 알아냄
//  4) 매 순간: 기준 대비 회전 = 각 뼈의 방향 → 뼈 길이를 이어 붙여 3D 뼈대
//  5) 운동 판정은 카메라와 똑같은 YAML 규칙을 쓰도록, 3D 뼈대를 '옆(또는 정면)에서 찍은 사진'처럼 평면에 투영
//
// 좌표: 오른손 좌표계, y가 위 (SlimeVR 서버와 같음). 단위 m.

import { store } from "./store.js";

// ---------- 쿼터니언 [x, y, z, w] ----------
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qnorm = (q) => { const n = Math.hypot(...q) || 1; return q.map((v) => v / n); };
function qrot(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
const qaxis = (ax, deg) => { const h = (deg * Math.PI) / 360, s = Math.sin(h); return qnorm([ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(h)]); };
const qangle = (a, b) => { const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]); return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI; };
/** a 방향을 b 방향으로 돌리는 최소 회전 */
function qfromTo(a, b) {
  const c = cross(a, b), d = dot(a, b);
  if (d < -0.9999) { const ax = Math.abs(a[0]) < 0.9 ? norm(cross(a, [1, 0, 0])) : norm(cross(a, [0, 1, 0])); return [...ax, 0]; }
  return qnorm([c[0], c[1], c[2], 1 + d]);
}

// ---------- 벡터 ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const n = Math.hypot(...a) || 1; return mul(a, 1 / n); };
const flat = (a) => norm([a[0], 0, a[2]]);
const UP = [0, 1, 0], DOWN = [0, -1, 0];
const deg = (r) => (r * 180) / Math.PI;
const angle3 = (a, b) => deg(Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))));

// 펌웨어 쿼터니언(z가 위) → y가 위 (SlimeVR 서버의 AXES_OFFSET과 같음: x축으로 -90°)
const AXES = qaxis([1, 0, 0], -90);
export const toWorld = (raw) => qnorm(qmul(AXES, raw));
export const fromWorld = (q) => qnorm(qmul(qinv(AXES), q));

// ---------- 몸 부위 ----------
export const PARTS = [
  { id: "chest", name: "가슴", spine: true },
  { id: "hip", name: "골반", spine: true },
  { id: "l_thigh", name: "왼쪽 허벅지" },
  { id: "r_thigh", name: "오른쪽 허벅지" },
  { id: "l_shin", name: "왼쪽 정강이" },
  { id: "r_shin", name: "오른쪽 정강이" },
];
// 펌웨어가 알려주는 부착 위치 번호 (SlimeVR SensorPosition)
const FW_POSITION = { 3: "chest", 4: "chest", 5: "hip", 6: "hip", 7: "l_thigh", 8: "r_thigh", 9: "l_shin", 10: "r_shin" };

// 뼈 길이 (m) — SlimeVR 기본 체형과 비슷하게. 판정은 비율만 쓰므로 키 입력은 필요 없음
const BONE = { waist: 0.24, chest: 0.27, shoulderW: 0.36, hipW: 0.22, thigh: 0.43, shin: 0.43, ankleH: 0.07, neck: 0.2 };
export const TORSO = BONE.waist + BONE.chest;

// 트래커로 판정할 수 있는 운동 (팔 트래커가 없으니 팔 동작은 카메라 필요, 카프 레이즈는 발 트래커 필요)
export const TRACKER_EXERCISES = ["squat", "lunge", "side_lunge", "deadlift", "glute_bridge", "wall_sit", "high_knees", "mountain_climber", "leg_raise"];

// ---------- 수신원 ----------
class NativeSource {
  constructor() { this.listeners = new Set(); this.plugin = null; this.handle = null; }
  async start() {
    const { registerPlugin } = await import("./vendor/capacitor-core.js");
    this.plugin ??= registerPlugin("SlimeVR");
    this.handle ??= await this.plugin.addListener("state", (s) => this.emit(s));
    const s = await this.plugin.start();
    this.emit(s);
  }
  async stop() {
    await this.handle?.remove?.();
    this.handle = null;
    await this.plugin?.stop();
  }
  emit(s) { for (const f of this.listeners) f(s); }
}

/** 테스트용 가짜 트래커 6개 (?demo). 일부러 아무렇게나 붙인 것처럼 부착 방향·몸 방향을 무작위로 */
export function demoRigConfig() {
  const rnd = (i) => qnorm([Math.sin(i * 1.7), Math.cos(i * 2.3), Math.sin(i * 0.9 + 1), Math.cos(i * 1.1)]);
  return {
    yaw: 137,
    drift: {},  // 부위별 방향 틀어짐(°) — 테스트용
    off: Object.fromEntries(PARTS.map((p, i) => [p.id, rnd(i + 1)])),
    ids: Object.fromEntries(PARTS.map((p, i) => [p.id, `DE:MO:00:00:00:0${i}/0`])),
  };
}

/** 가짜 트래커 상태 (수신기가 보내는 것과 같은 모양) */
export function demoTrackerState(sim, scene, t, cfg, dirsOverride = null) {
  const dirs = dirsOverride || demoDirections(sim, scene, t);
  const yawQ = qaxis(UP, cfg.yaw);
  const trackers = PARTS.map((p, i) => {
    // 몸 기준 방향 (앞, 위, 왼쪽) → 월드 (앞 = -z, 왼쪽 = -x) → 몸이 바라보는 방향만큼 회전
    const [f, u, l] = dirs[p.id];
    const w = qrot(yawQ, norm([-l, u, -f]));
    const rest = p.spine ? UP : DOWN;
    let seg = qmul(qfromTo(rest, w), yawQ);
    if (cfg.drift[p.id]) seg = qmul(qaxis(UP, cfg.drift[p.id]), seg);
    if (scene === `shake:${p.id}`) seg = qmul(qaxis([1, 0, 0], 40 * Math.sin(t * 14)), seg); // 흔들기
    const raw = fromWorld(qmul(seg, cfg.off[p.id]));
    return { id: cfg.ids[p.id], mac: cfg.ids[p.id].slice(0, 17), ip: `192.168.0.${20 + i}`, sensor: 0, connected: true, hasRot: true, age: 10, q: raw, battery: 0.9 - i * 0.07, rssi: -50 - i * 3, position: 0 };
  });
  return { running: true, trackers, ips: ["wlan0 192.168.0.5"] };
}

class DemoSource {
  constructor() { this.listeners = new Set(); this.scene = "stand"; this.cfg = demoRigConfig(); }
  setScene(s) { this.scene = s; this.t0 = performance.now(); }
  async start() {
    this.sim = await import("../test/sim.mjs");
    this.t0 = performance.now();
    clearInterval(this.iv);
    this.iv = setInterval(() => this.emit(demoTrackerState(this.sim, this.scene, (performance.now() - this.t0) / 1000, this.cfg)), 20);
  }
  async stop() { clearInterval(this.iv); }
  emit(s) { for (const f of this.listeners) f(s); }
}

/** 데모용: 운동별 가짜 자세 → 부위별 뼈 방향 [앞, 위, 왼쪽] */
export function demoDirections(sim, scene, t) {
  const { sidePose, frontPose, cycle } = sim;
  if (scene.startsWith("shake:")) scene = "stand";
  const k = scene === "stand" ? 0 : scene === "calib" ? Math.min(1, t / 0.6) * 0.45 : t < 1 ? 0 : cycle(((t - 1) % 2.6) / 2.6);
  const nth = Math.floor((t - 1) / 2.6), alt = nth % 2 === 0, d = nth % 3 === 2 ? 0.45 : 1, kd = k * d;
  const S = {
    stand: () => sidePose({}),
    calib: () => sidePose({ trunk: 20 * k, L: { hip: 60 * k, knee: 80 * k } }),
    squat: () => sidePose({ trunk: 40 * kd, L: { hip: 95 * kd, knee: 120 * kd } }),
    lunge: () => { const f = { hip: 80 * kd, knee: 90 * kd }, b = { hip: -25 * kd, knee: 100 * kd }; return sidePose({ trunk: 5 * kd, L: alt ? f : b, R: alt ? b : f }); },
    side_lunge: () => frontPose({ drop: 0.35 * kd, caveL: -0.35 * kd, legL: { abd: 30 }, legR: { abd: 30 } }),
    deadlift: () => sidePose({ trunk: 75 * kd, L: { hip: 10 * kd, knee: 15 * kd } }),
    glute_bridge: () => sidePose({ lying: -90, L: { hip: 70 * (1 - kd), knee: 110 } }),
    wall_sit: () => sidePose({ L: { hip: 90 * Math.min(1, t / 2), knee: 90 * Math.min(1, t / 2) } }),
    high_knees: () => { const l = alt ? kd : 0, r = alt ? 0 : kd; return sidePose({ L: { hip: 105 * l, knee: 90 * l }, R: { hip: 105 * r, knee: 90 * r } }); },
    mountain_climber: () => { const l = alt ? kd : 0, r = alt ? 0 : kd; return sidePose({ lying: 90, L: { hip: 100 * l, knee: 100 * l }, R: { hip: 100 * r, knee: 100 * r } }); },
    leg_raise: () => sidePose({ lying: -90, L: { hip: 85 * kd } }),
  };
  const pose = (S[scene] || S.squat)();
  const f = pose.flat;
  if (pose.view === "side") {
    const v = (a, b) => [b.x - a.x, b.y - a.y, 0];
    return {
      chest: v(f.hip, f.shoulder), hip: v(f.hip, f.shoulder),
      l_thigh: v(f.hip, f.left_knee), r_thigh: v(f.hip, f.right_knee),
      l_shin: v(f.left_knee, f.left_ankle), r_shin: v(f.right_knee, f.right_ankle),
    };
  }
  const v = (a, b) => [0, b.y - a.y, b.x - a.x]; // 정면 자세: x = 사람의 왼쪽
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const H = mid(f.hip_l, f.hip_r), Sh = mid(f.sh_l, f.sh_r);
  return {
    chest: v(H, Sh), hip: v(H, Sh),
    l_thigh: v(f.hip_l, f.knee_l), r_thigh: v(f.hip_r, f.knee_r),
    l_shin: v(f.knee_l, f.ankle_l), r_shin: v(f.knee_r, f.ankle_r),
  };
}

// ---------- 트래커 묶음 + 뼈대 ----------
class TrackerRig {
  constructor() {
    this.trackers = new Map();   // id → { ...상태, qw: 월드 쿼터니언, motion }
    this.running = false;
    this.error = null;
    this.ips = [];
    this.log = [];
    this.listeners = new Set();
    this.calib = null;           // { q0: {part: q}, fwd: {part: v}, done: bool }
    this.demo = typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");
  }

  get assign() { return store.settings.trackerAssign || {}; }
  setAssign(part, id) {
    const a = { ...this.assign };
    for (const k of Object.keys(a)) if (a[k] === id) delete a[k]; // 한 트래커는 한 부위만
    if (id) a[part] = id; else delete a[part];
    store.setSetting("trackerAssign", a);
    this.calib = null;
    this.changed();
  }

  /** 수신 시작 (이미 켜져 있으면 그대로) */
  async start() {
    if (this.running) return;
    this.source ??= this.demo ? new DemoSource() : new NativeSource();
    this.source.listeners.add((s) => this.onState(s));
    try {
      if (!this.demo && !(globalThis.Capacitor?.isNativePlatform?.() || globalThis.androidBridge)) throw new Error("앱에서만 쓸 수 있어요 (웹 브라우저는 와이파이 트래커를 받을 수 없음)");
      await this.source.start();
      this.running = true;
      this.error = null;
    } catch (e) {
      this.error = String(e?.message || e);
    }
    this.changed();
  }
  async stop() {
    await this.source?.stop?.();
    this.running = false;
    this.changed();
  }

  onState(s) {
    const now = performance.now();
    this.ips = s.ips || this.ips;
    this.net = { packets: s.packets ?? 0, handshakes: s.handshakes ?? 0, lastFrom: s.lastFrom || null };
    if (s.log?.length) this.log = [...this.log, ...s.log].slice(-30);
    if (s.error) this.error = s.error;
    for (const t of s.trackers || []) {
      const prev = this.trackers.get(t.id);
      const qw = toWorld(t.q);
      let motion = prev?.motion ?? 0;
      if (prev?.qw && t.hasRot) {
        const dt = Math.max(10, now - prev.at) / 1000;
        motion = 0.85 * motion + 0.15 * Math.min(720, qangle(prev.qw, qw) / dt); // 초당 회전 각도 (평활)
      }
      this.trackers.set(t.id, { ...t, qw, motion, at: now });
      // 펌웨어가 부착 위치를 알려주면 자동 지정 (비어 있는 부위만)
      const part = FW_POSITION[t.position];
      if (part && !this.assign[part] && !Object.values(this.assign).includes(t.id)) this.setAssign(part, t.id);
    }
    for (const f of this.listeners) f();
  }
  changed() { for (const f of this.listeners) f(); }

  list() { return [...this.trackers.values()]; }
  tracker(part) { const id = this.assign[part]; return id ? this.trackers.get(id) : null; }
  live(part) { const t = this.tracker(part); return t && t.connected && t.hasRot && t.age >= 0 && t.age < 1500 ? t : null; }
  partOf(id) { return Object.keys(this.assign).find((p) => this.assign[p] === id) || null; }
  get assignedCount() { return PARTS.filter((p) => this.assign[p.id]).length; }
  get liveCount() { return PARTS.filter((p) => this.live(p.id)).length; }
  /** 판정에 꼭 필요한 부위: 골반 + 양 허벅지 + 양 정강이 (가슴은 없으면 골반 방향으로 대신) */
  get ready() { return ["hip", "l_thigh", "r_thigh", "l_shin", "r_shin"].every((p) => this.live(p)) && !!this.calib?.done; }
  /** 지금 가장 많이 움직이는 트래커 (흔들어서 찾기) */
  mostMoving(exclude = []) {
    let best = null;
    for (const t of this.trackers.values()) if (!exclude.includes(t.id) && t.connected && (!best || t.motion > best.motion)) best = t;
    return best && best.motion > 60 ? best : null;
  }

  // ---------- 보정 ----------
  /** 1단계: 똑바로 선 자세를 기준으로 저장 */
  calibrateStand() {
    const q0 = {}, missing = [];
    for (const p of PARTS) {
      const t = this.live(p.id);
      if (t) q0[p.id] = t.qw; else if (this.assign[p.id]) missing.push(p.name);
    }
    if (!q0.hip) return { ok: false, msg: "골반 트래커가 연결돼 있어야 해요" };
    // 이미 앞쪽을 알고 있으면 유지 (다시 서기만 해도 방향 틀어짐(드리프트)이 고쳐짐)
    let fwd = null;
    if (this.calib?.fwd?.hip && this.calib.q0.hip) {
      fwd = flat(qrot(this.rel("hip"), this.calib.fwd.hip));
    }
    this.calib = { q0, fwd: fwd ? Object.fromEntries(Object.keys(q0).map((k) => [k, fwd])) : null, done: !!fwd, at: Date.now() };
    this.changed();
    return { ok: true, missing };
  }

  /** 2단계: 살짝 앉은 자세에서 허벅지가 나간 방향 = 몸의 앞쪽 */
  calibrateForward() {
    if (!this.calib) return { ok: false, msg: "먼저 똑바로 서서 1단계를 해주세요" };
    const ds = ["l_thigh", "r_thigh"].map((p) => this.dir(p)).filter(Boolean);
    if (!ds.length) return { ok: false, msg: "허벅지 트래커가 필요해요" };
    let h = [0, 0, 0];
    for (const d of ds) h = add(h, [d[0], 0, d[2]]);
    h = mul(h, 1 / ds.length);
    if (Math.hypot(h[0], h[2]) < 0.25) return { ok: false, msg: "조금 더 앉아주세요 (무릎을 앞으로)" };
    const fwdWorld = flat(h);
    // 부위별 '기준 자세에서의 앞쪽' = 지금 회전을 되돌린 방향
    const fwd = {};
    for (const p of Object.keys(this.calib.q0)) {
      const local = qrot(qinv(this.rel(p)), fwdWorld);
      fwd[p] = flat(local); // 기준 자세는 똑바로 선 자세라 수평으로 맞춤
    }
    this.calib.fwd = fwd;
    this.calib.done = true;
    this.changed();
    return { ok: true };
  }

  /** 기준 자세 대비 회전 (월드 좌표) — 부착 방향과 상관없음 */
  rel(part) {
    const t = this.live(part), q0 = this.calib?.q0?.[part];
    return t && q0 ? qnorm(qmul(t.qw, qinv(q0))) : null;
  }
  /** 뼈 방향: 다리는 엉덩이→무릎→발목(아래로), 몸통은 위로 */
  dir(part) {
    const r = this.rel(part);
    if (!r) return null;
    return qrot(r, PARTS.find((p) => p.id === part).spine ? UP : DOWN);
  }

  /** 연결된 트래커가 모두 가만히 있는지 */
  allStill() {
    const live = PARTS.map((p) => this.live(p.id)).filter(Boolean);
    return this.ready && live.every((t) => t.motion < 25);
  }

  /** 똑바로 선 채 가만히 있는지 (세트 시작 전 자동 재보정용) */
  standingStill() {
    if (!this.calib) return false;
    for (const p of ["hip", "l_thigh", "r_thigh", "l_shin", "r_shin", "chest"]) {
      const t = this.live(p);
      if (!t) { if (p === "chest") continue; return false; }
      const d = this.dir(p);
      if (!d || angle3(d, PARTS.find((x) => x.id === p).spine ? UP : DOWN) > 15) return false;
      if (t.motion > 25) return false;
    }
    return true;
  }

  // ---------- 3D 뼈대 ----------
  skeleton() {
    if (!this.calib?.done || !this.live("hip")) return null;
    const R = (p) => this.rel(p);
    const Rh = R("hip"), Rc = R("chest") || Rh;
    const fwdOf = (p, r) => qrot(r, this.calib.fwd[p] || this.calib.fwd.hip);
    const fH = fwdOf("hip", Rh);
    const uH = qrot(Rh, UP);
    const lH = norm(cross(uH, fH));                       // 골반의 왼쪽
    const uC = qrot(Rc, UP), fC = fwdOf(this.live("chest") ? "chest" : "hip", Rc), lC = norm(cross(uC, fC));
    const P = [0, 0, 0];
    const hipL = add(P, mul(lH, BONE.hipW / 2)), hipR = add(P, mul(lH, -BONE.hipW / 2));
    const waist = add(P, mul(uH, BONE.waist));
    const S = add(waist, mul(uC, BONE.chest));
    const leg = (side, hip) => {
      const th = this.dir(`${side}_thigh`) || DOWN;
      const sh = this.dir(`${side}_shin`) || th;
      const knee = add(hip, mul(th, BONE.thigh));
      const ankle = add(knee, mul(sh, BONE.shin));
      // 발 트래커가 없으니 발은 정강이에 수직, 몸 앞쪽을 향한다고 가정
      const fS = this.rel(`${side}_shin`) ? fwdOf(`${side}_shin`, this.rel(`${side}_shin`)) : fH;
      const footF = norm(sub(fS, mul(sh, dot(fS, sh))));
      return { hip, knee, ankle, heel: add(ankle, add(mul(footF, -0.05), mul(sh, 0.06))), toe: add(ankle, add(mul(footF, 0.15), mul(sh, 0.07))) };
    };
    const L = leg("l", hipL), Rr = leg("r", hipR);
    const shL = add(S, mul(lC, BONE.shoulderW / 2)), shR = add(S, mul(lC, -BONE.shoulderW / 2));
    const ear = add(S, mul(uC, BONE.neck));
    const nose = add(ear, add(mul(fC, 0.09), mul(uC, 0.02)));
    const arm = (sh) => { const el = add(sh, mul(uC, -0.28)); return { el, wr: add(el, mul(uC, -0.26)) }; };
    const aL = arm(shL), aR = arm(shR);
    const pts = {
      nose, left_ear: add(ear, mul(lC, 0.07)), right_ear: add(ear, mul(lC, -0.07)),
      left_shoulder: shL, right_shoulder: shR, left_elbow: aL.el, right_elbow: aR.el, left_wrist: aL.wr, right_wrist: aR.wr,
      left_hip: hipL, right_hip: hipR, left_knee: L.knee, right_knee: Rr.knee, left_ankle: L.ankle, right_ankle: Rr.ankle,
      left_heel: L.heel, right_heel: Rr.heel, left_foot_index: L.toe, right_foot_index: Rr.toe,
    };
    // 바닥 맞추기: 가장 낮은 점이 y=0 (트래커만으로는 높이를 알 수 없어서 SlimeVR처럼 '발은 바닥에' 가정)
    const floor = Math.min(...Object.values(pts).map((p) => p[1]));
    for (const k in pts) pts[k] = [pts[k][0], pts[k][1] - floor, pts[k][2]];
    // 몸 기준 방향 (화면 투영용): 골반 앞쪽을 수평으로. 누워 있을 땐 몸통 방향을 앞쪽으로
    let fwdH = [fH[0], 0, fH[2]];
    if (Math.hypot(fwdH[0], fwdH[2]) < 0.3) fwdH = [uH[0], 0, uH[2]];
    fwdH = norm(fwdH);
    const leftH = norm(cross(UP, fwdH));
    return { pts, fwdH, leftH, lH, uH };
  }

  /** 카메라 대신 쓸 '옆(또는 정면)에서 찍은 것 같은' 33개 관절 + 3D로만 알 수 있는 값 */
  landmarks(view = "side", { W = 720, H = 1280, facing = 1 } = {}) {
    const sk = this.skeleton();
    if (!sk) return null;
    const axis = view === "front" ? sk.leftH : mul(sk.fwdH, facing);
    const P = Object.fromEntries(Object.entries(sk.pts).map(([k, p]) => [k, { x: dot(p, axis), y: p[1] }]));
    const xs = Object.values(P).map((p) => p.x);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const s = (0.55 * H) / 1.75, base = H * 0.9;
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
    for (const [name, p] of Object.entries(P)) {
      const i = LM[name];
      const arm = /elbow|wrist/.test(name);
      lm[i] = { x: (W / 2 + (p.x - cx) * s) / W, y: (base - p.y * s) / H, z: 0, visibility: arm ? 0.05 : 0.99 };
    }
    for (const [i, src] of [[1, "nose"], [2, "nose"], [3, "nose"], [4, "nose"], [5, "nose"], [6, "nose"], [9, "nose"], [10, "nose"]]) lm[i] = { ...lm[LM[src]] };
    for (const [i, src] of [[17, "left_wrist"], [19, "left_wrist"], [21, "left_wrist"], [18, "right_wrist"], [20, "right_wrist"], [22, "right_wrist"]]) lm[i] = { ...lm[LM[src]] };
    return { lm, W, H, derived: this.derived(sk) };
  }

  /** 3D에서 바로 계산한 값 (카메라로는 정면/옆 한쪽에서만 보이는 것) — 몸통 길이 = 200 단위 */
  derived(sk = this.skeleton()) {
    if (!sk) return {};
    const u = 200 / TORSO, p = sk.pts;
    // 무릎이 엉덩이-발목 선보다 몸 안쪽으로 들어간 정도 (+ = 안쪽)
    const kneeIn = (side, inward) => {
      const h = p[`${side}_hip`], k = p[`${side}_knee`], a = p[`${side}_ankle`];
      const ha = sub(a, h), t = Math.max(0, Math.min(1, dot(sub(k, h), ha) / (dot(ha, ha) || 1)));
      const dev = sub(k, add(h, mul(ha, t)));
      return dot(dev, mul(sk.lH, inward)) * u;
    };
    // 옆에서 본 엉덩이 각도 (정면 촬영 스쿼트에서 카메라 대신 사용)
    const sideAngle = (side) => {
      const f = sk.fwdH, P2 = (v) => [dot(v, f), v[1]];
      const a = P2(p[`${side}_shoulder`]), b = P2(p[`${side}_hip`]), c = P2(p[`${side}_knee`]);
      const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
      return deg(Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1)))));
    };
    const fl = sideAngle("left"), fr = sideAngle("right");
    return {
      left_knee_in: kneeIn("left", -1), right_knee_in: kneeIn("right", 1),
      front_hip_angle: (fl + fr) / 2, front_hip_angle_left: fl, front_hip_angle_right: fr,
      trunk_lean_3d: angle3(qrot(this.rel("chest") || this.rel("hip"), UP), UP),
    };
  }

  /** 화면에 그리기용 관절 각도 */
  jointAngles() {
    const sk = this.skeleton();
    if (!sk) return null;
    const p = sk.pts;
    const A = (a, b, c) => angle3(sub(p[a], p[b]), sub(p[c], p[b]));
    return {
      leftKnee: A("left_hip", "left_knee", "left_ankle"), rightKnee: A("right_hip", "right_knee", "right_ankle"),
      leftHip: A("left_shoulder", "left_hip", "left_knee"), rightHip: A("right_shoulder", "right_hip", "right_knee"),
      trunk: this.derived(sk).trunk_lean_3d,
    };
  }

  setDemoScene(s) { this.source?.setScene?.(s); }
}

const LM = {
  nose: 0, left_ear: 7, right_ear: 8, left_shoulder: 11, right_shoulder: 12, left_elbow: 13, right_elbow: 14,
  left_wrist: 15, right_wrist: 16, left_hip: 23, right_hip: 24, left_knee: 25, right_knee: 26,
  left_ankle: 27, right_ankle: 28, left_heel: 29, right_heel: 30, left_foot_index: 31, right_foot_index: 32,
};

export const rig = new TrackerRig();

/** 카메라 관절 + 트래커 뼈대 합치기 ('둘 다' 모드)
 *  카메라 화면 속 엉덩이 위치·몸통 크기에 트래커 뼈대를 맞춰 하체·몸통 관절을 바꿔 끼움 → 가려지거나 정면이라 안 보이는 각도도 정확 */
export function fuse(camLm, W, H) {
  const vis = (i) => camLm?.[i]?.visibility ?? 0;
  const ok = camLm && [11, 12, 23, 24].some((i) => vis(i) > 0.5);
  if (!ok) return null;
  const px = (i) => ({ x: camLm[i].x * W, y: camLm[i].y * H });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const S = mid(px(11), px(12)), Hm = mid(px(23), px(24));
  const torsoPx = Math.hypot(S.x - Hm.x, S.y - Hm.y);
  const width = Math.max(Math.abs(px(11).x - px(12).x), Math.abs(px(23).x - px(24).x));
  const view = width / Math.max(torsoPx, 1) > 0.4 ? "front" : "side";
  const facing = px(0).x >= mid(px(7), px(8)).x ? 1 : -1;
  const t = rig.landmarks(view, { W, H, facing });
  if (!t) return null;
  // 트래커 뼈대의 몸통 길이·엉덩이 위치를 카메라에 맞춤
  const tp = (i) => ({ x: t.lm[i].x * W, y: t.lm[i].y * H });
  const tS = mid(tp(11), tp(12)), tH = mid(tp(23), tp(24));
  const tTorso = Math.hypot(tS.x - tH.x, tS.y - tH.y) || 1;
  const sideTorso = view === "side" ? Math.max(torsoPx, 1) : torsoPx;
  const k = sideTorso / tTorso;
  const out = camLm.map((l) => ({ ...l }));
  for (const i of [11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]) {
    const p = tp(i);
    out[i] = { x: (Hm.x + (p.x - tH.x) * k) / W, y: (Hm.y + (p.y - tH.y) * k) / H, z: 0, visibility: 0.98 };
  }
  return { lm: out, derived: t.derived, view };
}
