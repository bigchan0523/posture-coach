// 트래커 3D 뼈대 보기 — SlimeVR 서버 화면처럼 드래그로 돌리고, 두 손가락(또는 휠)으로 확대
// 외부 라이브러리 없이 캔버스 2D에 원근 투영으로 그림
//
// const v = new Skeleton3D(canvas, { dark: true });
// v.render(rig.skeleton(), { forward: rig.calib.fwd.hip, alert: false, labels: [...] })

const UP = [0, 1, 0];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const n = Math.hypot(...a) || 1; return mul(a, 1 / n); };
const rad = (d) => (d * Math.PI) / 180;

// 뼈 색: SlimeVR 서버 GUI(utils/skeletonHelper.ts, MIT/Apache-2.0)의 boneColor 그대로
const C = {
  hipSeg: "red", chest: "purple", upperChest: "chartreuse", neck: "chartreuse", shoulder: "#00ffff", hip: "pink",
  thigh: "chartreuse", shin: "teal", foot: "gold", upperArm: "indianred", lowerArm: "red", hand: "fuchsia",
};
// [시작, 끝, 색, 트래커가 있어야 그리는 관절(없으면 안 그림)]
const BONES = [
  ["mid_hip", "waist", C.hipSeg], ["waist", "chest", C.chest], ["chest", "mid_sh", C.upperChest], ["mid_sh", "neck_top", C.neck],
  ["neck_top", "left_shoulder", C.shoulder], ["neck_top", "right_shoulder", C.shoulder],
  ["left_shoulder", "left_elbow", C.upperArm, "left_elbow"], ["right_shoulder", "right_elbow", C.upperArm, "right_elbow"],
  ["left_elbow", "left_wrist", C.lowerArm, "left_wrist"], ["right_elbow", "right_wrist", C.lowerArm, "right_wrist"],
  ["left_wrist", "left_hand", C.hand, "left_hand"], ["right_wrist", "right_hand", C.hand, "right_hand"],
  ["left_hip", "right_hip", C.hip],
  ["left_hip", "left_knee", C.thigh], ["right_hip", "right_knee", C.thigh],
  ["left_knee", "left_ankle", C.shin], ["right_knee", "right_ankle", C.shin],
  ["left_heel", "left_foot_index", C.foot], ["right_heel", "right_foot_index", C.foot],
];
const JOINTS = ["left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle", "left_shoulder", "right_shoulder", "waist", "left_elbow", "right_elbow", "left_wrist", "right_wrist"];

export const VIEWS = {
  free: { yaw: 35, pitch: 14 },
  front: { yaw: 0, pitch: 6 },
  side: { yaw: 90, pitch: 6 },
  top: { yaw: 0, pitch: 80 },
};

export class Skeleton3D {
  constructor(canvas, { dark = true, grid = true } = {}) {
    this.c = canvas;
    this.dark = dark;
    this.grid = grid;
    this.reset();
    this.pointers = new Map();
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) canvas.addEventListener(ev, (e) => this.up(e));
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); this.dist = clamp(this.dist * (1 + e.deltaY * 0.001), 1.4, 7); }, { passive: false });
    canvas.addEventListener("dblclick", () => this.reset());
  }

  reset(view = "free") { const v = VIEWS[view]; this.yaw = v.yaw; this.pitch = v.pitch; this.dist = 3.0; }
  setView(view) { this.reset(view); }

  down(e) {
    this.c.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.lastTap = this.pointers.size === 1 && performance.now() - (this.tapAt || 0) < 300;
    if (this.lastTap) this.reset();
    this.tapAt = performance.now();
  }
  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    if (this.pointers.size === 1) {
      this.yaw -= (e.clientX - p.x) * 0.45;
      this.pitch = clamp(this.pitch + (e.clientY - p.y) * 0.35, -15, 85);
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      p.x = e.clientX; p.y = e.clientY;
      const [a2, b2] = [...this.pointers.values()];
      const after = Math.hypot(a2.x - b2.x, a2.y - b2.y);
      if (before > 0 && after > 0) this.dist = clamp(this.dist * (before / after), 1.4, 7);
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
  }
  up(e) { this.pointers.delete(e.pointerId); }

  /**
   * @param sk rig.skeleton() 결과 { pts, ... } (y가 위, m 단위). 없으면 안내 문구
   * @param opts { forward: 보정 때 몸 앞쪽(월드), alert, labels: [{ at: 관절이름, text }], empty: 문구 }
   */
  render(sk, opts = {}) {
    const c = this.c;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(c.clientWidth * dpr), ch = Math.round(c.clientHeight * dpr);
    if (cw && (c.width !== cw || c.height !== ch)) { c.width = cw; c.height = ch; }
    const W = c.width, H = c.height;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    if (this.dark) { ctx.fillStyle = "#0b1d30"; ctx.fillRect(0, 0, W, H); }

    // 카메라: 보정 때의 몸 앞쪽을 기준으로 궤도 회전
    let F = opts.forward ? norm([opts.forward[0], 0, opts.forward[2]]) : [0, 0, 1];
    if (!isFinite(F[0])) F = [0, 0, 1];
    const L = norm(cross(UP, F));
    const target = [0, 0.75, 0];
    const yw = rad(this.yaw), pt = rad(this.pitch);
    const dir = add(mul(add(mul(F, Math.cos(yw)), mul(L, Math.sin(yw))), Math.cos(pt)), mul(UP, Math.sin(pt)));
    const cam = add(target, mul(dir, this.dist));
    const f = norm(sub(target, cam));
    let r = cross(f, UP);
    r = Math.hypot(...r) < 1e-4 ? norm(cross(f, F)) : norm(r);
    const u = cross(r, f);
    const focal = Math.min(W * 1.5, H * 1.2);
    const proj = (p) => {
      const v = sub(p, cam);
      const z = dot(v, f);
      if (z < 0.05) return null;
      return { x: W / 2 + (dot(v, r) * focal) / z, y: H * 0.52 - (dot(v, u) * focal) / z, z };
    };

    // 바닥 격자
    if (this.grid) {
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = this.dark ? "rgba(120,140,255,.28)" : "rgba(30,155,232,.18)";
      const N = 8, S = 0.25;
      for (let i = -N; i <= N; i++) {
        for (const [a, b] of [[add(mul(F, i * S), mul(L, -N * S)), add(mul(F, i * S), mul(L, N * S))], [add(mul(L, i * S), mul(F, -N * S)), add(mul(L, i * S), mul(F, N * S))]]) {
          const pa = proj(a), pb = proj(b);
          if (!pa || !pb) continue;
          ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
        }
      }
      // 앞쪽 표시 (작은 화살표)
      const a0 = proj(mul(F, 0.55)), a1 = proj(mul(F, 0.85)), al = proj(add(mul(F, 0.72), mul(L, 0.08))), ar = proj(add(mul(F, 0.72), mul(L, -0.08)));
      if (a0 && a1 && al && ar) {
        ctx.strokeStyle = this.dark ? "rgba(255,255,255,.45)" : "rgba(15,39,64,.35)";
        ctx.lineWidth = 2.5 * dpr;
        ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.moveTo(al.x, al.y); ctx.lineTo(a1.x, a1.y); ctx.lineTo(ar.x, ar.y); ctx.stroke();
      }
    }

    if (!sk) {
      ctx.fillStyle = this.dark ? "rgba(255,255,255,.75)" : "#5c7186";
      ctx.font = `600 ${15 * dpr}px Pretendard, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(opts.empty || "보정하면 보여요", W / 2, H / 2);
      return;
    }

    const P = { ...sk.pts };
    const mid = (a, b) => mul(add(P[a], P[b]), 0.5);
    P.mid_hip = mid("left_hip", "right_hip");
    P.mid_sh = mid("left_shoulder", "right_shoulder");
    P.waist = sk.waist || add(P.mid_hip, mul(sub(P.mid_sh, P.mid_hip), 0.35));
    P.chest = sk.chest || add(P.mid_hip, mul(sub(P.mid_sh, P.mid_hip), 0.67));
    const ear = mid("left_ear", "right_ear");
    P.neck_top = sk.neck_top || add(P.mid_sh, mul(sub(ear, P.mid_sh), 0.55));
    const tracked = sk.tracked || {};
    const pp = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, proj(v)]));

    // 바닥 그림자
    ctx.fillStyle = this.dark ? "rgba(0,0,0,.35)" : "rgba(15,39,64,.08)";
    for (const k of ["left_ankle", "right_ankle"]) {
      const g = proj([P[k][0], 0, P[k][2]]);
      if (g) { ctx.beginPath(); ctx.ellipse(g.x, g.y, (0.09 * focal) / g.z, (0.035 * focal) / g.z, 0, 0, Math.PI * 2); ctx.fill(); }
    }

    // 먼 것부터 (화가 알고리즘)
    const items = [];
    for (const [a, b, col, need] of BONES) {
      const A = pp[a], B = pp[b];
      if (!A || !B) continue;
      const faint = need && !tracked[need];
      if (faint && !opts.showUntracked) continue; // 트래커 없는 팔·손은 안 그림
      items.push({ z: (A.z + B.z) / 2, draw: () => {
        ctx.globalAlpha = faint ? 0.25 : 1;
        ctx.strokeStyle = opts.alert && !need ? "#ff5a5f" : col;
        ctx.lineWidth = 3.5 * dpr; // SlimeVR처럼 굵기 일정한 얇은 선
        ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        ctx.globalAlpha = 1;
      } });
    }
    if (opts.joints) for (const j of JOINTS) {
      const A = pp[j];
      if (!A || (/elbow|wrist/.test(j) && !tracked[j])) continue;
      items.push({ z: A.z - 0.01, draw: () => {
        const rr = Math.max(2.5, (0.028 * focal) / A.z);
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(A.x, A.y, rr, 0, Math.PI * 2); ctx.fill();
      } });
    }
    // 머리는 판정에 안 쓰여서 그리지 않음 (몸이 화면을 더 크게 쓰도록)
    items.sort((a, b) => b.z - a.z).forEach((it) => it.draw());

    // 각도 숫자
    ctx.font = `700 ${13 * dpr}px Pretendard, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const placed = [];
    for (const lb of opts.labels || []) {
      const A = pp[lb.at];
      if (!A) continue;
      const tw = ctx.measureText(lb.text).width;
      let x = A.x + 10 * dpr, y = A.y;
      const hit = () => placed.some((q) => Math.abs(q.y - y) < 24 * dpr && Math.abs(q.x - x) < tw + 16 * dpr);
      if (hit()) x = A.x - tw - 22 * dpr;          // 겹치면 관절 왼쪽에
      while (hit()) y += 24 * dpr;                 // 그래도 겹치면 아래로
      placed.push({ x, y });
      ctx.fillStyle = "rgba(0,0,0,.6)";
      roundRect(ctx, x, y - 11 * dpr, tw + 12 * dpr, 22 * dpr, 6 * dpr); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillText(lb.text, x + 6 * dpr, y);
    }
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
