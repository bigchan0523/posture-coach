// 운동 분류와 추천 루틴
// 루틴 항목: { ex: 운동 이름, sets, reps } 또는 시간 유지 운동은 { ex, sets, sec }

export const AREAS = [
  { id: "lower", name: "하체", exercises: ["squat", "lunge", "side_lunge", "deadlift", "glute_bridge", "calf_raise", "wall_sit"] },
  { id: "upper", name: "상체", exercises: ["push_up", "shoulder_press", "lateral_raise", "bicep_curl", "hammer_curl", "tricep_dip"] },
  { id: "core", name: "코어", exercises: ["plank", "leg_raise", "mountain_climber"] },
  { id: "cardio", name: "유산소", exercises: ["jumping_jack", "high_knees"] },
];

export const areaOf = (ex) => AREAS.find((a) => a.exercises.includes(ex))?.id ?? "lower";

export const VIEW_TEXT = { side: "옆에서 찍기", front: "정면에서 찍기", any: "아무 방향" };

export const LEVELS = [
  { id: "easy", name: "초급" },
  { id: "mid", name: "중급" },
  { id: "hard", name: "고급" },
];

// 난이도마다 운동 가짓수가 늘어나고, 그만큼 동작당 횟수는 조금씩만 올려 전체 양을 맞춤
// (좌우 번갈아 하는 운동은 한쪽 기준 횟수)
const R = (ex, sets, reps) => ({ ex, sets, reps });
const S = (ex, sets, sec) => ({ ex, sets, sec });

export const PRESETS = [
  {
    id: "fullbody", name: "전신 기초", note: "기구 없이 집에서",
    levels: {
      easy: [R("squat", 2, 10), R("push_up", 2, 8), R("glute_bridge", 2, 12), S("plank", 2, 20)],
      mid: [R("squat", 3, 12), R("push_up", 3, 10), R("lunge", 3, 8), R("glute_bridge", 3, 12), S("plank", 3, 30)],
      hard: [R("squat", 3, 15), R("push_up", 3, 12), R("lunge", 3, 10), R("glute_bridge", 3, 15), R("mountain_climber", 3, 15), S("plank", 3, 45)],
    },
  },
  {
    id: "legs", name: "하체 집중", note: "허벅지와 엉덩이",
    levels: {
      easy: [R("squat", 2, 12), R("calf_raise", 2, 15), S("wall_sit", 2, 20)],
      mid: [R("squat", 3, 12), R("lunge", 3, 8), R("glute_bridge", 3, 12), R("calf_raise", 3, 15), S("wall_sit", 2, 30)],
      hard: [R("squat", 3, 15), R("lunge", 3, 10), R("side_lunge", 3, 8), R("deadlift", 3, 10), R("calf_raise", 3, 15), S("wall_sit", 3, 40)],
    },
  },
  {
    id: "core", name: "코어 강화", note: "복부와 허리 안정",
    levels: {
      easy: [S("plank", 2, 20), R("glute_bridge", 2, 12), R("leg_raise", 2, 8)],
      mid: [S("plank", 3, 30), R("leg_raise", 3, 10), R("glute_bridge", 3, 12), R("mountain_climber", 3, 12)],
      hard: [S("plank", 3, 45), R("leg_raise", 3, 12), R("mountain_climber", 3, 15), R("glute_bridge", 3, 15), R("push_up", 3, 10)],
    },
  },
  {
    id: "cardio", name: "유산소 서킷", note: "짧고 숨차게",
    levels: {
      easy: [R("jumping_jack", 2, 20), R("high_knees", 2, 12), R("squat", 2, 10)],
      mid: [R("jumping_jack", 3, 25), R("high_knees", 3, 15), R("mountain_climber", 3, 12), R("squat", 3, 12)],
      hard: [R("jumping_jack", 3, 30), R("high_knees", 3, 20), R("mountain_climber", 3, 15), R("lunge", 3, 10), R("squat", 3, 15)],
    },
  },
  {
    id: "dumbbell", name: "덤벨 상체", note: "덤벨 한 쌍 필요",
    levels: {
      easy: [R("shoulder_press", 2, 8), R("bicep_curl", 2, 10), R("tricep_dip", 2, 8)],
      mid: [R("shoulder_press", 3, 10), R("lateral_raise", 3, 10), R("bicep_curl", 3, 10), R("tricep_dip", 3, 10)],
      hard: [R("shoulder_press", 3, 12), R("lateral_raise", 3, 12), R("bicep_curl", 3, 12), R("hammer_curl", 3, 10), R("tricep_dip", 3, 12), R("push_up", 3, 10)],
    },
  },
];

/** 난이도 반영: 추천 루틴은 난이도별 구성, 내 루틴은 그대로 */
export function scaled(routine, levelId = "easy") {
  if (!routine.levels) return { ...routine, level: null };
  const level = routine.levels[levelId] ? levelId : "easy";
  return { ...routine, level, items: routine.levels[level].map((it) => ({ ...it })) };
}

/** 예상 시간(분): 1회 약 2.5초 + 세트 사이 휴식 */
export function estimateMinutes(routine, restSec = 30) {
  let s = 0;
  for (const it of routine.items) s += it.sets * ((it.sec ?? it.reps * 2.5) + restSec);
  return Math.max(1, Math.round(s / 60));
}

export const totalSets = (routine) => routine.items.reduce((s, it) => s + it.sets, 0);
