// 기록 화면 차트 (SVG/HTML). 터치하면 값이 아래 안내줄에 표시된다 (data-tip).
import { dayKey } from "./store.js";

const WEEK = ["월", "화", "수", "목", "금", "토", "일"];
const md = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일`;

/** 운동한 날 달력: 13주, 세로 = 요일, 가로 = 주. 진할수록 그날 운동을 많이 함 */
export function heatmap(byDay, weeks = 13) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const mondayIdx = (today.getDay() + 6) % 7;
  const start = new Date(today); start.setDate(today.getDate() - mondayIdx - (weeks - 1) * 7);
  let cells = "";
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(start); day.setDate(start.getDate() + w * 7 + d);
      const future = day > today;
      const n = future ? 0 : byDay.get(dayKey(day)) || 0;
      const lvl = n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : 3;
      const tip = future ? "" : `${md(day)} ${n ? `운동 ${n}번` : "운동 안 함"}`;
      cells += `<button class="hm-cell h${lvl}${future ? " future" : ""}${+day === +today ? " today" : ""}" style="grid-column:${w + 2};grid-row:${d + 1}" ${tip ? `data-tip="${tip}"` : "disabled"} aria-label="${tip}"></button>`;
    }
  }
  const labels = [0, 2, 4, 6].map((d) => `<span class="hm-label" style="grid-row:${d + 1}">${WEEK[d]}</span>`).join("");
  return `<div class="heatmap" style="--weeks:${weeks}">${labels}${cells}</div>
    <div class="hm-legend"><span>적음</span><i class="hm-cell h0"></i><i class="hm-cell h1"></i><i class="hm-cell h2"></i><i class="hm-cell h3"></i><span>많음</span></div>`;
}

/** 요일별 운동 횟수 막대 */
export function weekdayBars(history) {
  const counts = Array(7).fill(0);
  for (const h of history) counts[(new Date(h.ts).getDay() + 6) % 7]++;
  const max = Math.max(...counts);
  const top = counts.indexOf(max);
  return `<div class="bars">${counts.map((c, i) => {
    const pct = max ? Math.round((c / max) * 100) : 0;
    return `<button class="bar-col" data-tip="${WEEK[i]}요일 ${c}번">
      <span class="bar-val">${max && i === top ? c : ""}</span>
      <span class="wbar" style="height:${Math.max(pct, c ? 6 : 2)}%"></span>
      <span class="bar-label">${WEEK[i]}</span></button>`;
  }).join("")}</div>`;
}

/** 자세 점수 추이 (세션별 평균, 최근 20번) */
export function trendLine(points) {
  const pts = points.slice(-20);
  if (!pts.length) return "";
  const W = 320, H = 150, L = 30, R = 12, T = 12, B = 22;
  const x = (i) => (pts.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1));
  const y = (v) => T + ((100 - Math.max(0, Math.min(100, v))) * (H - T - B)) / 100;
  const grid = [0, 60, 80, 100].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}</text>`).join("");
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join("");
  const dots = pts.map((p, i) => {
    const d = new Date(p.ts);
    return `<g class="pt" data-tip="${md(d)} ${p.score}점"><circle cx="${x(i)}" cy="${y(p.score)}" r="14" class="hit"/><circle cx="${x(i)}" cy="${y(p.score)}" r="4.5" class="dot"/></g>`;
  }).join("");
  const last = pts[pts.length - 1];
  const lx = x(pts.length - 1), ly = y(last.score);
  const first = new Date(pts[0].ts), lastD = new Date(last.ts);
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="자세 점수 추이, 최근 ${last.score}점">
    ${grid}<path d="${path}" class="line"/>${dots}
    <text x="${Math.min(lx, W - R - 2)}" y="${ly < T + 16 ? ly + 20 : ly - 12}" class="last" text-anchor="end">${last.score}점</text>
    <text x="${L}" y="${H - 4}" class="axis">${md(first)}</text>
    ${pts.length > 1 ? `<text x="${W - R}" y="${H - 4}" class="axis" text-anchor="end">${md(lastD)}</text>` : ""}
  </svg>`;
}

// ---------- 삼성헬스 느낌 링 달력 ----------
// 링 세 겹: 바깥 운동 시간, 가운데 반복 횟수, 안쪽 자세 점수 (색은 dataviz 검사 통과)
export const RING_COLORS = ["#1e9be8", "#5b5ce6", "#14b8a6"];

/** fr: [시간, 반복, 점수] 각각 0~1 */
export function rings(fr, size = 40, { empty = false } = {}) {
  const sw = size >= 80 ? size * 0.09 : size * 0.11;
  const gap = sw * 0.35;
  const c = size / 2;
  let out = `<svg class="rings" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">`;
  fr.forEach((f, i) => {
    const r = c - sw / 2 - i * (sw + gap);
    const len = 2 * Math.PI * r;
    const k = Math.max(0, Math.min(1, f || 0));
    out += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${RING_COLORS[i]}" stroke-opacity="${empty ? 0.12 : 0.18}" stroke-width="${sw}"/>`;
    if (k > 0) out += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${RING_COLORS[i]}" stroke-width="${sw}" stroke-linecap="round"
      stroke-dasharray="${(len * k).toFixed(2)} ${len.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`;
  });
  return out + "</svg>";
}

export const dayFractions = (st, goals) => [
  st.minutes / goals.goalMin,
  st.reps / goals.goalReps,
  st.avgScore == null ? 0 : st.avgScore / 100,
];

/**
 * 월 달력 (일요일 시작)
 * @param stats (key) => dayStats
 */
export function monthCalendar(y, m, selKey, stats, goals) {
  const first = new Date(y, m, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weeks = Math.ceil((first.getDay() + new Date(y, m + 1, 0).getDate()) / 7);
  let cells = "";
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = dayKey(d);
    const out = d.getMonth() !== m;
    const future = d > today;
    const st = future ? null : stats(key);
    const ring = future ? `<span class="ring-ph"></span>` : rings(dayFractions(st, goals), 38, { empty: !st.sessions });
    cells += `<button class="cal-day${out ? " out" : ""}${future ? " future" : ""}${key === selKey ? " sel" : ""}${+d === +today ? " today" : ""}${d.getDay() === 0 ? " sun" : ""}"
      data-act="cal-day" data-day="${key}" ${future ? "disabled" : ""} aria-label="${d.getMonth() + 1}월 ${d.getDate()}일${st?.sessions ? `, 운동 ${st.sessions}번` : ""}">
      ${ring}<span class="cal-num">${d.getDate()}</span></button>`;
  }
  const head = ["일", "월", "화", "수", "목", "금", "토"].map((w, i) => `<span class="${i === 0 ? "sun" : ""}">${w}</span>`).join("");
  return `<div class="cal-head">${head}</div><div class="cal-grid">${cells}</div>`;
}
