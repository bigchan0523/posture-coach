// 운동 픽토그램 만들기: 테스트용 가짜 사람(sim.mjs)의 대표 자세를 굵은 선 그림으로 바꿔 js/pictos.js 생성
// 사용: node tools/make-pictos.mjs
import { writeFileSync } from "node:fs";
import { sidePose, frontPose } from "../test/sim.mjs";

const SPECS = {
  squat: { pose: sidePose({ trunk: 38, L: { hip: 95, knee: 115 }, arm: { sh: 95 } }) },
  lunge: { pose: sidePose({ trunk: 3, L: { hip: 82, knee: 90 }, R: { hip: -28, knee: 100 }, arm: { sh: 10 } }) },
  side_lunge: { pose: frontPose({ drop: 0.3, caveL: -0.32, legL: { abd: 32 }, legR: { abd: 32 }, arm: { abd: 20 } }) },
  deadlift: { pose: sidePose({ trunk: 72, L: { hip: 12, knee: 20 }, arm: { sh: 0 } }), props: ["bar"] },
  glute_bridge: { pose: sidePose({ lying: -72, L: { hip: -12, knee: 112 }, arm: { sh: 160 } }), props: ["floor"] },
  calf_raise: { pose: sidePose({ heelRise: 0.13, arm: { sh: 25, el: 0 } }), props: ["floorStand", "arrowUp"] },
  wall_sit: { pose: sidePose({ L: { hip: 90, knee: 90 }, arm: { sh: 0 } }), props: ["wall"] },
  push_up: { pose: sidePose({ lying: 75, arm: { sh: 75, el: 0 } }), props: ["floor"] },
  plank: { pose: sidePose({ lying: 86, arm: { sh: 86, el: 90 } }), props: ["floor"] },
  leg_raise: { pose: sidePose({ lying: -90, L: { hip: 80 }, arm: { sh: 180 } }), props: ["floor"] },
  mountain_climber: { pose: sidePose({ lying: 70, L: { hip: 95, knee: 105 }, R: { hip: 0, knee: 0 }, arm: { sh: 70, el: 0 } }), props: ["floor"] },
  high_knees: { pose: sidePose({ L: { hip: 100, knee: 100 }, R: { hip: -5, knee: 10 }, armL: { sh: -40, el: -90 }, armR: { sh: 50, el: -90 } }) },
  tricep_dip: { pose: sidePose({ trunk: 0, L: { hip: 85, knee: 85 }, arm: { sh: -35, el: 95 } }), props: ["bench"] },
  bicep_curl: { pose: sidePose({ armL: { sh: 0, el: 95 }, armR: { sh: 0, el: 0 } }), props: ["dumbbellsSide"] },
  hammer_curl: { pose: sidePose({ armL: { sh: 0, el: 95 }, armR: { sh: 0, el: 0 } }), props: ["hammerSide"] },
  shoulder_press: { pose: frontPose({ arm: { abd: 165, el: 0 } }), props: ["dumbbells"] },
  lateral_raise: { pose: frontPose({ arm: { abd: 88, el: 0 } }), props: ["dumbbells"] },
  jumping_jack: { pose: frontPose({ arm: { abd: 155, el: 0 }, legL: { abd: 16 }, legR: { abd: 16 } }) },
};

const STROKE = 0.115;  // 팔다리 굵기 (몸 단위)
const HEAD_R = 0.1;

function figure(spec) {
  const f = spec.pose.flat;
  const lines = [];   // { pts:[[x,y]...], far, w }
  let head;
  if (spec.pose.view === "side") {
    const S = f.shoulder, H = f.hip;
    for (const side of ["right", "left"]) { // 먼 쪽(right) 먼저, 흐리게
      const far = side === "right";
      lines.push({ pts: [H, f[`${side}_knee`], f[`${side}_ankle`], f[`${side}_toe`]], far });
      lines.push({ pts: [S, f[`${side}_elbow`], f[`${side}_wrist`]], far });
    }
    lines.splice(2, 0, { pts: [S, H], far: false, w: 1.25 });
    const dx = f.ear.x - S.x, dy = f.ear.y - S.y, L = Math.hypot(dx, dy);
    head = { x: S.x + (dx / L) * 0.28, y: S.y + (dy / L) * 0.28 };
  } else {
    const SM = { x: (f.sh_l.x + f.sh_r.x) / 2, y: f.sh_l.y }, HM = { x: 0, y: f.hip_l.y };
    for (const s of ["l", "r"]) {
      lines.push({ pts: [{ x: f[`hip_${s}`].x * 0.5, y: HM.y }, f[`knee_${s}`], f[`ankle_${s}`]], far: false });
      lines.push({ pts: [{ x: f[`sh_${s}`].x * 0.8, y: SM.y }, f[`elbow_${s}`], f[`wrist_${s}`]], far: false });
    }
    lines.push({ pts: [SM, HM], far: false, w: 1.35 });
    head = { x: 0, y: SM.y + 0.24 };
  }
  // 소품
  const props = [];
  const all = lines.flatMap((l) => l.pts).concat([head]);
  const minY = Math.min(...all.map((p) => p.y)), minX = Math.min(...all.map((p) => p.x)), maxX = Math.max(...all.map((p) => p.x));
  for (const p of spec.props || []) {
    if (p === "floor" || p === "floorStand") props.push({ pts: [{ x: minX - 0.08, y: minY - 0.07 }, { x: maxX + 0.08, y: minY - 0.07 }], w: 0.5 });
    if (p === "arrowUp") { const k = f.left_knee; const x = Math.max(f.left_toe.x, k.x) + 0.32, y = (k.y + f.left_ankle.y) / 2 + 0.1; props.push({ pts: [{ x: x - 0.16, y: y - 0.13 }, { x, y: y + 0.03 }, { x: x + 0.16, y: y - 0.13 }], w: 0.8 }); props.push({ pts: [{ x, y: y + 0.03 }, { x, y: y - 0.36 }], w: 0.8 }); }
    if (p === "wall") { const x = f.hip.x - 0.13; props.push({ pts: [{ x, y: minY - 0.05 }, { x, y: f.shoulder.y + 0.35 }], w: 0.55 }); }
    if (p === "bench") { const w = f.left_wrist; props.push({ pts: [{ x: w.x - 0.3, y: w.y - 0.04 }, { x: w.x + 0.12, y: w.y - 0.04 }], w: 0.6 }); props.push({ pts: [{ x: w.x - 0.24, y: w.y - 0.04 }, { x: w.x - 0.24, y: minY - 0.02 }], w: 0.45 }); }
    if (p === "bar") { const w = f.left_wrist; props.push({ dot: w, r: 1.25 }); }
    if (p === "dumbbells") for (const s of ["l", "r"]) { const w = f[`wrist_${s}`]; props.push({ pts: [{ x: w.x - 0.07, y: w.y }, { x: w.x + 0.07, y: w.y }], w: 1.2 }); }
    if (p === "dumbbellsSide") for (const s of ["left", "right"]) { const w = f[`${s}_wrist`]; props.push({ pts: [{ x: w.x - 0.08, y: w.y }, { x: w.x + 0.08, y: w.y }], w: 1.25, far: s === "right" }); }
    if (p === "hammerSide") for (const s of ["left", "right"]) { const w = f[`${s}_wrist`]; props.push({ pts: [{ x: w.x, y: w.y - 0.08 }, { x: w.x, y: w.y + 0.08 }], w: 1.25, far: s === "right" }); }
  }
  return { lines, head, props };
}

function toSvg(fig) {
  const pts = [...fig.lines, ...fig.props].flatMap((l) => l.pts || [l.dot]);
  pts.push({ x: fig.head.x - HEAD_R, y: fig.head.y - HEAD_R }, { x: fig.head.x + HEAD_R, y: fig.head.y + HEAD_R });
  const pad = 0.16;
  const x0 = Math.min(...pts.map((p) => p.x)) - pad, x1 = Math.max(...pts.map((p) => p.x)) + pad;
  const y0 = Math.min(...pts.map((p) => p.y)) - pad, y1 = Math.max(...pts.map((p) => p.y)) + pad;
  const size = 48, inner = 40;
  const k = inner / Math.max(x1 - x0, y1 - y0);
  const ox = (size - (x1 - x0) * k) / 2, oy = (size - (y1 - y0) * k) / 2;
  const T = (p) => `${(ox + (p.x - x0) * k).toFixed(1)} ${(oy + (y1 - p.y) * k).toFixed(1)}`;
  // 선 굵기·머리 크기는 그림 크기와 상관없이 일정하게 (작은 아이콘에서도 또렷하게)
  const SW = 4.4, HR = 4.6;
  let out = "";
  for (const l of [...fig.props, ...fig.lines]) {
    if (l.dot) { const [cx, cy] = T(l.dot).split(" "); out += `<circle cx="${cx}" cy="${cy}" r="${(SW * l.r).toFixed(2)}" fill="currentColor" stroke="none"/>`; continue; }
    const d = "M" + l.pts.map(T).join("L");
    out += `<path d="${d}"${l.w ? ` stroke-width="${(SW * l.w).toFixed(2)}"` : ""}${l.far ? ' opacity=".45"' : ""}/>`;
  }
  const [hx, hy] = T(fig.head).split(" ");
  out += `<circle cx="${hx}" cy="${hy}" r="${HR}" fill="currentColor" stroke="none"/>`;
  const sw = SW;
  return `<svg viewBox="0 0 48 48" class="picto" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${out}</svg>`;
}

const entries = Object.entries(SPECS).map(([name, spec]) => `  ${name}: '${toSvg(figure(spec))}',`);
const file = `// 자동 생성 파일 — tools/make-pictos.mjs 로 다시 만들 수 있어요\nexport const PICTOS = {\n${entries.join("\n")}\n};\n`;
writeFileSync(new URL("../js/pictos.js", import.meta.url), file);
console.log(`${entries.length}개 픽토그램 생성`);
