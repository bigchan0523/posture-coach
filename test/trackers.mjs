// 트래커 뼈대 테스트: 가짜 트래커 6개(부착 방향·몸 방향 무작위) → 보정 → 뼈대 → 운동 판정
// node test/trackers.mjs  (test/run.mjs 에서도 불러씀)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import yaml from "../js/vendor/js-yaml.mjs";
import { Exercise } from "../js/engine.js";
import * as sim from "./sim.mjs";
import { rig, PARTS, demoRigConfig, demoTrackerState, demoDirections } from "../js/trackers.js";
import { store } from "../js/store.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (name) => new Exercise(yaml.load(readFileSync(join(root, "exercises", `${name}.yaml`), "utf8")));

export function runTrackerTests(check) {
  const cfg = demoRigConfig();
  const feed = (scene, t) => rig.onState(demoTrackerState(sim, scene, t, cfg));
  rig.setSet("all");
  for (const p of PARTS) rig.setAssign(p.id, cfg.ids[p.id]);

  console.log("트래커 보정");
  feed("stand", 0); feed("stand", 0.02);
  check("부위 20개 지정·연결", rig.liveCount === 20, rig.liveCount);
  check("서기 보정", rig.calibrateStand().ok);
  feed("calib", 0.1);
  check("앉는 정도가 부족하면 다시 요청", !rig.calibrateForward().ok);
  feed("calib", 1);
  check("앞쪽 방향 보정", rig.calibrateForward().ok && rig.ready);

  console.log("트래커 관절 각도 (실제 값과 비교)");
  // 스쿼트 바닥: 엉덩이 굽힘 95°, 무릎 굽힘 120° → 무릎 사이 각도 60°, 몸통 40° 숙임
  feed("squat", 1 + 1.3);
  const a = rig.jointAngles();
  check("무릎 각도 ≈ 60°", Math.abs(a.leftKnee - 60) < 3 && Math.abs(a.rightKnee - 60) < 3, `${a.leftKnee.toFixed(1)} ${a.rightKnee.toFixed(1)}`);
  check("상체 숙임 ≈ 40°", Math.abs(a.trunk - 40) < 3, a.trunk.toFixed(1));
  const lm = rig.landmarks("side");
  check("옆모습 투영", lm && lm.lm.length === 33);

  console.log("트래커 방향 틀어짐(드리프트) 보정");
  cfg.drift.l_thigh = 25;
  feed("squat", 1 + 1.3);
  const bad = rig.jointAngles().leftKnee;
  for (let i = 0; i < 40; i++) feed("stand", 0);
  check("서 있을 때 자동 재보정 조건 감지", rig.standingStill());
  rig.calibrateStand();
  feed("squat", 1 + 1.3);
  const fixed = rig.jointAngles().leftKnee;
  check("다시 서기만 해도 틀어짐 해결", Math.abs(fixed - 60) < 3, `틀어짐 ${bad.toFixed(1)} → ${fixed.toFixed(1)}`);
  delete cfg.drift.l_thigh;
  feed("stand", 0); feed("stand", 0.02); rig.calibrateStand();

  console.log("트래커로 운동 판정 (카메라 없이, 트래커 20개)");
  // 6번 중 3번째마다 일부러 덜 움직임 → 4회. 좌우 번갈아 하는 운동은 한쪽 기준 2회
  const expect = { high_knees: 2, mountain_climber: 2 };
  const manifest = JSON.parse(readFileSync(join(root, "exercises", "manifest.json"), "utf8"));
  for (const name of manifest) {
    const ex = load(name);
    check(`${name}: 트래커로 가능`, rig.supports(ex.cfg.requiredPoints, name));
    const view = ex.cfg.view === "front" ? "front" : "side";
    let last;
    for (let t = 0; t < 1 + 2.6 * 6; t += 1 / 30) {
      feed(name, t);
      const r = rig.landmarks(view);
      last = ex.update(r.lm, t * 1000, r.W, r.H, { allViews: true, derived: r.derived });
    }
    if (ex.cfg.type === "duration") { check(`${name}: 버틴 시간 측정 (${last.holdSec?.toFixed(1)}초)`, (last.holdSec || 0) > 5); continue; }
    const n = ex.cfg.bilateral ? Math.max(ex.channels[0].counter, ex.channels[1].counter) : ex.counter;
    const want = expect[name] ?? 4;
    check(`${name}: ${n}회 (기대 ${want})`, n === want);
  }

  console.log("트래커 개수 세트별로 할 수 있는 운동");
  {
    const assignOnly = (ids) => { store.setSetting("trackerAssign", Object.fromEntries(ids.map((p) => [p, cfg.ids[p]]))); };
    const can = () => manifest.filter((n) => rig.supports(load(n).cfg.requiredPoints, n));
    assignOnly(["chest", "l_thigh", "r_thigh", "l_shin", "r_shin"]);
    const five = can();
    check(`x5: 하체 운동만 (${five.length}개)`, five.includes("squat") && !five.includes("bicep_curl") && !five.includes("calf_raise"), five.join(","));
    assignOnly(["chest", "hip", "l_thigh", "r_thigh", "l_shin", "r_shin", "l_foot", "r_foot"]);
    check("x8: 발 트래커로 카프 레이즈 가능", can().includes("calf_raise"));
    assignOnly(["chest", "hip", "l_thigh", "r_thigh", "l_shin", "r_shin", "l_foot", "r_foot", "l_upper_arm", "r_upper_arm"]);
    check("x10: 위팔만으론 팔꿈치 각도 운동 불가", !can().includes("bicep_curl"));
    assignOnly(["chest", "hip", "l_thigh", "r_thigh", "l_shin", "r_shin", "l_foot", "r_foot", "l_upper_arm", "r_upper_arm", "l_lower_arm", "r_lower_arm"]);
    check(`x12: 18가지 전부 가능 (${can().length})`, can().length === manifest.length);
    for (const p of PARTS) rig.setAssign(p.id, cfg.ids[p.id]);
    feed("stand", 0); rig.calibrateStand(); feed("calib", 1); rig.calibrateForward();
  }

  console.log("팔 트래커 각도");
  {
    feed("bicep_curl", 1 + 1.3); // 팔꿈치 150° 굽힘 → 사이 각도 30°
    const a = rig.jointAngles();
    check("팔꿈치 각도 ≈ 30°", Math.abs(a.leftElbow - 30) < 4, a.leftElbow?.toFixed(1));
  }

  console.log("트래커 무릎 모임 감지 (3D)");
  {
    const ex = load("squat");
    const seen = new Set();
    // 무릎이 안으로 모이는 스쿼트: 옆모습 스쿼트 방향에 '안쪽' 성분을 더함 (방향 = [앞, 위, 왼쪽])
    for (let t = 0; t < 4; t += 1 / 30) {
      const k = sim.cycle((t % 2.6) / 2.6);
      const d = (() => {
        const base = { ...Object.fromEntries(Object.entries(demoDirections(sim, "squat", 1 + (t % 2.6)))) };
        const inward = 0.35 * k; // 허벅지는 안쪽으로, 정강이는 다시 바깥으로
        const tilt = (v, l) => [v[0], v[1], v[2] + l * Math.hypot(v[0], v[1])];
        return { ...base, l_thigh: tilt(base.l_thigh, -inward), r_thigh: tilt(base.r_thigh, inward), l_shin: tilt(base.l_shin, inward), r_shin: tilt(base.r_shin, -inward) };
      })();
      rig.onState(demoTrackerState(sim, "squat", t, cfg, d));
      const r = rig.landmarks("side");
      const res = ex.update(r.lm, t * 1000, r.W, r.H, { allViews: true, derived: r.derived });
      for (const f of res.feedback) seen.add(f.name);
    }
    check("옆모습으로 판정해도 양쪽 무릎 모임 경고", seen.has("knees_caving") && seen.has("knees_caving_right"), [...seen].join(","));
  }
  {
    // 무릎 모임 없는 보통 스쿼트에선 경고가 없어야 함
    const ex = load("squat");
    const seen = new Set();
    for (let t = 0; t < 4; t += 1 / 30) {
      feed("squat", t);
      const r = rig.landmarks("side");
      for (const f of ex.update(r.lm, t * 1000, r.W, r.H, { allViews: true, derived: r.derived }).feedback) seen.add(f.name);
    }
    check("보통 스쿼트에선 무릎 모임 경고 없음", !seen.has("knees_caving") && !seen.has("knees_caving_right"), [...seen].join(","));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let pass = 0, fail = 0;
  runTrackerTests((label, cond, extra = "") => {
    if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${extra}`); }
  });
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
}
