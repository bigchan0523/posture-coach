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
  { id: "easy", name: "초급", sets: 0, mult: 1 },
  { id: "mid", name: "중급", sets: 0, mult: 1.35 },
  { id: "hard", name: "고급", sets: 1, mult: 1.6 },
];

export const PRESETS = [
  {
    id: "fullbody", name: "전신 기초", note: "기구 없이 집에서",
    items: [
      { ex: "squat", sets: 3, reps: 12 },
      { ex: "push_up", sets: 3, reps: 10 },
      { ex: "glute_bridge", sets: 3, reps: 12 },
      { ex: "plank", sets: 3, sec: 30 },
    ],
  },
  {
    id: "legs", name: "하체 집중", note: "허벅지와 엉덩이",
    items: [
      { ex: "squat", sets: 3, reps: 15 },
      { ex: "lunge", sets: 3, reps: 10 },
      { ex: "calf_raise", sets: 3, reps: 15 },
      { ex: "wall_sit", sets: 2, sec: 30 },
    ],
  },
  {
    id: "core", name: "코어 강화", note: "복부와 허리 안정",
    items: [
      { ex: "plank", sets: 3, sec: 30 },
      { ex: "leg_raise", sets: 3, reps: 12 },
      { ex: "mountain_climber", sets: 3, reps: 15 },
      { ex: "glute_bridge", sets: 3, reps: 15 },
    ],
  },
  {
    id: "cardio", name: "유산소 서킷", note: "짧고 숨차게",
    items: [
      { ex: "jumping_jack", sets: 3, reps: 20 },
      { ex: "high_knees", sets: 3, reps: 15 },
      { ex: "mountain_climber", sets: 3, reps: 15 },
      { ex: "squat", sets: 2, reps: 15 },
    ],
  },
  {
    id: "dumbbell", name: "덤벨 상체", note: "덤벨 한 쌍 필요",
    items: [
      { ex: "shoulder_press", sets: 3, reps: 10 },
      { ex: "lateral_raise", sets: 3, reps: 12 },
      { ex: "bicep_curl", sets: 3, reps: 12 },
      { ex: "hammer_curl", sets: 3, reps: 12 },
      { ex: "tricep_dip", sets: 3, reps: 10 },
    ],
  },
];

/** 난이도 반영 */
export function scaled(routine, levelId = "easy") {
  const lv = LEVELS.find((l) => l.id === levelId) || LEVELS[0];
  return {
    ...routine,
    level: lv.id,
    items: routine.items.map((it) => ({
      ...it,
      sets: it.sets + lv.sets,
      ...(it.sec ? { sec: Math.round((it.sec * lv.mult) / 5) * 5 } : { reps: Math.round(it.reps * lv.mult) }),
    })),
  };
}

/** 예상 시간(분): 1회 약 2.5초 + 세트 사이 휴식 */
export function estimateMinutes(routine, restSec = 30) {
  let s = 0;
  for (const it of routine.items) s += it.sets * ((it.sec ?? it.reps * 2.5) + restSec);
  return Math.max(1, Math.round(s / 60));
}

export const totalSets = (routine) => routine.items.reduce((s, it) => s + it.sets, 0);
