// 폰 안에 저장 (설정, 내 루틴, 운동 기록). 서버로 보내지 않음.

const KEY = "posture-coach.v1";
const DEFAULT = {
  settings: { facing: "user", model: "lite", voice: true, sounds: true, restSec: 30, debug: false, goalMin: 20, goalReps: 100 },
  today: { routine: "fullbody", level: "easy" },
  custom: [],   // [{ id, name, items }]
  history: [],  // [{ id, ts, title, kind, durationSec, items:[{ ex, name, sets:[{ reps, target, sec, targetSec, scores, faults }] }] }]
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { ...DEFAULT, ...s, settings: { ...DEFAULT.settings, ...(s.settings || {}) } };
    }
  } catch { /* 저장소 사용 불가 → 메모리로만 */ }
  return structuredClone(DEFAULT);
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 무시 */ }
}

// 바뀔 때마다 알림 (계정 동기화용): fn(종류, 내용)
const listeners = new Set();
const emit = (type, data) => { for (const f of listeners) { try { f(type, data); } catch (e) { console.warn(e); } } };

export const store = {
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  get settings() { return state.settings; },
  setSetting(k, v) { state.settings[k] = v; save(); emit("profile"); },

  get today() { return state.today; },
  setToday(routine, level = "easy") { state.today = { routine, level }; save(); emit("profile"); },

  get custom() { return state.custom; },
  saveCustom(r) {
    const i = state.custom.findIndex((c) => c.id === r.id);
    if (i >= 0) state.custom[i] = r; else state.custom.push(r);
    save();
    emit("profile");
  },
  deleteCustom(id) {
    state.custom = state.custom.filter((c) => c.id !== id);
    if (state.today.routine === id) state.today = { ...DEFAULT.today };
    save();
    emit("profile");
  },

  get history() { return state.history; },
  addSession(s) { state.history.push(s); save(); emit("session-add", s); },
  deleteSession(id) { state.history = state.history.filter((h) => h.id !== id); save(); emit("session-delete", id); },
  /** 로그아웃: 이 폰에 남은 계정 기록·설정을 지움 (계정에는 그대로). 기기 전용 설정(트래커·카메라 방향 등)과 안내 표시 여부는 유지 */
  clearLocal(keep = []) {
    const settings = { ...DEFAULT.settings };
    for (const k of keep) if (state.settings[k] !== undefined) settings[k] = state.settings[k];
    state = { ...structuredClone(DEFAULT), settings, sync: { ...(state.sync || {}), uid: null, at: null } };
    save();
  },
  resetAll() { const ids = state.history.map((h) => h.id); state = structuredClone(DEFAULT); save(); emit("reset", ids); },

  /** 계정에서 받아온 기록 합치기 (같은 id는 그대로, 없는 것만 추가) */
  mergeRemote({ history = [], custom = [], settings = null, today = null } = {}) {
    const have = new Set(state.history.map((h) => h.id));
    const added = history.filter((h) => h && h.id && !have.has(h.id));
    state.history = [...state.history, ...added].sort((a, b) => a.ts - b.ts);
    const cids = new Set(state.custom.map((c) => c.id));
    state.custom = [...state.custom, ...custom.filter((c) => c && c.id && !cids.has(c.id))];
    if (settings) state.settings = { ...DEFAULT.settings, ...state.settings, ...settings };
    if (today) state.today = today;
    save();
    return added.length;
  },
  /** 계정 동기화 정보 (마지막 동기화 시각 등) — 기기에만 저장 */
  get sync() { return state.sync || {}; },
  setSync(v) { state.sync = { ...(state.sync || {}), ...v }; save(); },
};

// ---------- 통계 ----------
export const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

export function sessionsByDay() {
  const m = new Map();
  for (const h of state.history) m.set(dayKey(h.ts), (m.get(dayKey(h.ts)) || 0) + 1);
  return m;
}

/** 오늘(또는 어제)까지 이어진 연속 운동 일수 */
export function streak() {
  const days = sessionsByDay();
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export function sessionStats(s) {
  let reps = 0, scores = [], sets = 0;
  for (const it of s.items) for (const st of it.sets) {
    sets++;
    reps += st.reps || 0;
    scores.push(...(st.scores || []));
  }
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  return { reps, sets, avgScore: avg };
}

export function totals() {
  let reps = 0, scored = [];
  for (const s of state.history) {
    const st = sessionStats(s);
    reps += st.reps;
    if (st.avgScore != null) scored.push(st.avgScore);
  }
  return {
    sessions: state.history.length,
    reps,
    avgScore: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
  };
}

/** 운동별: 세션마다 평균 점수 (오래된 순) + 자주 나온 지적 */
export function exerciseHistory(ex) {
  const points = [];
  const faults = new Map();
  for (const s of state.history) {
    const items = s.items.filter((it) => it.ex === ex);
    if (!items.length) continue;
    const scores = items.flatMap((it) => it.sets.flatMap((st) => st.scores || []));
    if (scores.length) points.push({ ts: s.ts, score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) });
    for (const it of items) for (const st of it.sets) for (const [m, n] of Object.entries(st.faults || {})) faults.set(m, (faults.get(m) || 0) + n);
  }
  return { points, faults: [...faults.entries()].sort((a, b) => b[1] - a[1]) };
}

export function exercisesWithHistory() {
  const set = new Set();
  for (const s of state.history) for (const it of s.items) if (it.sets.some((st) => (st.scores || []).length)) set.add(it.ex);
  return [...set];
}

/** 하루 요약: 운동 시간(분), 반복 수, 평균 자세 점수, 그날 기록들 */
export function dayStats(key) {
  const list = state.history.filter((h) => dayKey(h.ts) === key);
  let sec = 0, reps = 0, scores = [];
  for (const h of list) {
    sec += h.durationSec || 0;
    for (const it of h.items) for (const st of it.sets) { reps += st.reps || 0; scores.push(...(st.scores || [])); }
  }
  return {
    list, sessions: list.length, minutes: Math.round(sec / 60), reps,
    avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
  };
}

/** 한 달 요약 */
export function monthStats(y, m) {
  const list = state.history.filter((h) => { const d = new Date(h.ts); return d.getFullYear() === y && d.getMonth() === m; });
  const days = new Set(list.map((h) => dayKey(h.ts)));
  let sec = 0, reps = 0;
  for (const h of list) { sec += h.durationSec || 0; reps += sessionStats(h).reps; }
  return { days: days.size, minutes: Math.round(sec / 60), reps };
}
