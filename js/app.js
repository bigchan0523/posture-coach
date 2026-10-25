// 앱 화면: 홈 / 운동 / 기록 + 설정
import yaml from "./vendor/js-yaml.mjs";
import { runSession } from "./session.js";
import { store, sessionsByDay, streak, sessionStats, totals, exerciseHistory, exercisesWithHistory, dayKey, dayStats, monthStats } from "./store.js";
import { AREAS, areaOf, PRESETS, LEVELS, VIEW_TEXT, scaled, estimateMinutes, totalSets } from "./routines.js";
import { weekdayBars, trendLine, monthCalendar, rings, dayFractions, RING_COLORS } from "./charts.js";
import { sfx } from "./sound.js";
import { PICTOS } from "./pictos.js";

const defs = {};
let names = [];
const now0 = new Date();
const ui = { tab: "home", wTab: "presets", rTab: "overview", stack: [], formEx: null, testEx: "squat", confirmReset: false,
  weekOffset: 0, weekAnim: "", calY: now0.getFullYear(), calM: now0.getMonth(), calSel: dayKey(now0) };
const $view = document.getElementById("view");
const $sheet = document.getElementById("sheet");
const $video = document.getElementById("videoInput");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const exName = (ex) => defs[ex]?.display_name ?? ex;
const isHold = (ex) => defs[ex]?.type === "duration";
const amount = (it) => (it.sec ? `${it.sec}초` : `${it.reps}회`);
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

const ICON = {
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5 8 12l7 7"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  flame: '<svg viewBox="0 0 24 24"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.4 1.3-3.8 2.3-4.8.3 1.6 1.2 2.6 2.2 2.8C11 8.5 11 5.5 12 3z"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  film: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M10 9.5v5l4-2.5z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>',
};

// 운동 표시: 동작 픽토그램 + 부위 색 (tools/make-pictos.mjs 로 생성)
const mark = (ex) => `<span class="mark a-${areaOf(ex)}" aria-hidden="true">${PICTOS[ex] || ""}</span>`;

// ---------- 데이터 ----------
async function loadDefs() {
  names = await (await fetch("exercises/manifest.json")).json();
  await Promise.all(names.map(async (n) => { defs[n] = yaml.load(await (await fetch(`exercises/${n}.yaml`)).text()); }));
}

function routineById(id) {
  return PRESETS.find((p) => p.id === id) || store.custom.find((c) => c.id === id) || null;
}
function todayRoutine() {
  const r = routineById(store.today.routine) || PRESETS[0];
  return scaled(r, r.custom ? "easy" : store.today.level);
}

// ---------- 화면 그리기 ----------
function render() {
  document.querySelectorAll(".tabbar button").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === ui.tab ? "page" : "false"));
  const top = ui.stack[ui.stack.length - 1];
  let html;
  if (top) html = { routine: routineScreen, exercise: exerciseScreen, editor: editorScreen, record: recordScreen }[top.type](top);
  else html = { home: homeScreen, workouts: workoutsScreen, records: recordsScreen }[ui.tab]();
  $view.innerHTML = html;
  $view.scrollTop = 0;
}

function push(screen) { ui.stack.push(screen); render(); window.scrollTo(0, 0); }
function pop() { ui.stack.pop(); render(); }

const backBar = (title, right = "") => `<header class="bar"><button class="icon-btn" data-act="back" aria-label="뒤로">${ICON.back}</button><h1>${esc(title)}</h1><div class="bar-right">${right}</div></header>`;
const segmented = (key, items, current) => `<div class="seg" role="tablist">${items.map(([id, label]) => `<button role="tab" aria-selected="${id === current}" data-act="seg" data-key="${key}" data-val="${id}">${label}</button>`).join("")}</div>`;

// ----- 홈 -----
function homeScreen() {
  const now = new Date();
  const days = sessionsByDay();
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + ui.weekOffset * 7);
  const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
  const st = streak();
  const r = todayRoutine();
  const lv = LEVELS.find((l) => l.id === r.level);
  const last = store.history[store.history.length - 1];
  const anim = ui.weekAnim;
  ui.weekAnim = "";

  return `
  <header class="home-head">
    <h1 class="brand">자세 코치</h1>
    <div class="bar-right">
      <button class="streak${st ? " on" : ""}" data-act="open-calendar" aria-label="연속 ${st}일, 달력 보기">${ICON.flame}${st}일</button>
      <button class="icon-btn" data-act="settings" aria-label="설정">${ICON.gear}</button>
    </div>
  </header>
  <div class="date-row">${ui.weekOffset === 0
    ? `<p class="date">${now.getMonth() + 1}월 ${now.getDate()}일 ${WEEK[now.getDay()]}요일</p>`
    : `<p class="date">${week[0].getMonth() + 1}월 ${week[0].getDate()}일 ~ ${week[6].getMonth() + 1}월 ${week[6].getDate()}일</p><button class="text-btn" data-act="week-today">이번 주</button>`}</div>
  <div class="week-wrap" id="weekSwipe" aria-label="좌우로 밀어서 다른 주 보기"><div class="week ${anim}">${week.map((d) => {
    const done = days.has(dayKey(d));
    const today = dayKey(d) === dayKey(now);
    const future = d > now;
    return `<button class="day${today ? " today" : ""}${done ? " done" : ""}${future ? " future" : ""}" data-act="open-day" data-day="${dayKey(d)}" ${future ? "disabled" : ""}><span>${WEEK[d.getDay()]}</span><b>${d.getDate()}</b><i></i></button>`;
  }).join("")}</div></div>

  <section class="hero">
    <p class="hero-k">오늘의 루틴</p>
    <h2>${esc(r.name)}${lv && !routineById(store.today.routine)?.custom ? ` <span class="lv">${lv.name}</span>` : ""}</h2>
    <p class="hero-meta">${r.items.length}가지 운동, ${totalSets(r)}세트, 약 ${estimateMinutes(r, store.settings.restSec)}분</p>
    <ol class="hero-list">${r.items.map((it) => `<li>${esc(exName(it.ex))} <span>${it.sets}×${amount(it)}</span></li>`).join("")}</ol>
    <div class="hero-actions">
      <button class="btn white" data-act="start-today">운동 시작</button>
      <button class="btn clear" data-act="change-today">루틴 바꾸기</button>
    </div>
  </section>

  <section class="block">
    <h3>자세 테스트</h3>
    <p class="muted">한 세트만 해보고 자세 점수를 받아요</p>
    <div class="row-inline">
      <button class="picker" data-act="pick-ex" data-for="test" aria-label="테스트할 운동 고르기">${mark(ui.testEx)}<span>${esc(exName(ui.testEx))}</span>${ICON.down}</button>
      <button class="btn primary" data-act="start-test">테스트</button>
    </div>
  </section>

  <section class="block">
    <h3>최근 운동</h3>
    ${last ? recordRow(last) : `<p class="empty">아직 기록이 없어요. 오늘의 루틴으로 첫 운동을 시작해보세요.</p>`}
  </section>`;
}

function recordRow(h) {
  const st = sessionStats(h);
  const d = new Date(h.ts);
  const when = `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours() < 12 ? "오전" : "오후"} ${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, "0")}`;
  const parts = [`${h.items.length}가지`];
  if (st.reps) parts.push(`${st.reps}회`);
  return `<button class="row" data-act="open-record" data-id="${h.id}">
    <div class="row-main"><b>${esc(h.title)}</b><span class="muted">${when}, ${parts.join(", ")}</span></div>
    ${st.avgScore != null ? `<span class="score g-${grade(st.avgScore)}">${st.avgScore}점</span>` : ""}${ICON.chev}</button>`;
}
const grade = (s) => (s >= 90 ? "A" : s >= 80 ? "B" : s >= 70 ? "C" : s >= 60 ? "D" : "F");

// ----- 운동 탭 -----
function workoutsScreen() {
  let body = "";
  if (ui.wTab === "presets") {
    body = `<p class="muted pad">루틴을 골라 오늘의 루틴으로 정하거나 바로 시작하세요</p>` + PRESETS.map((p) => routineRow(p)).join("");
  } else if (ui.wTab === "all") {
    body = AREAS.map((a) => `<h3 class="group">${a.name}</h3>${a.exercises.map((ex) => `
      <button class="row" data-act="open-exercise" data-ex="${ex}">${mark(ex)}
        <div class="row-main"><b>${esc(exName(ex))}</b><span class="muted">${VIEW_TEXT[defs[ex].view]}${isHold(ex) ? ", 시간 유지" : ""}</span></div>${ICON.chev}</button>`).join("")}`).join("");
  } else {
    body = store.custom.map((c) => routineRow(c)).join("")
      + (store.custom.length ? "" : `<p class="empty">직접 만든 루틴이 없어요. 하고 싶은 운동을 골라 나만의 루틴을 만들어보세요.</p>`)
      + `<button class="btn outline wide" data-act="new-routine">${ICON.plus}새 루틴 만들기</button>`;
  }
  return `<header class="bar"><h1>운동</h1></header>
    ${segmented("wTab", [["presets", "추천 루틴"], ["all", "전체 운동"], ["mine", "내 루틴"]], ui.wTab)}
    <div class="list">${body}</div>`;
}

function routineRow(r) {
  const isToday = store.today.routine === r.id;
  return `<button class="row routine" data-act="open-routine" data-id="${r.id}">
    <span class="r-stack">${r.items.slice(0, 3).map((it) => mark(it.ex)).join("")}</span>
    <div class="row-main"><b>${esc(r.name)}${isToday ? ' <span class="tag">오늘</span>' : ""}</b>
    <span class="muted">${esc(r.note || `${r.items.length}가지 운동`)}, 약 ${estimateMinutes(r, store.settings.restSec)}분</span></div>${ICON.chev}</button>`;
}

function routineScreen({ id, level }) {
  const base = routineById(id);
  if (!base) { ui.stack.pop(); return workoutsScreen(); }
  const r = scaled(base, base.custom ? "easy" : level);
  const right = base.custom ? `<button class="text-btn" data-act="edit-routine" data-id="${id}">수정</button>` : "";
  return `${backBar(base.name, right)}
    ${base.custom ? "" : segmented("level", LEVELS.map((l) => [l.id, l.name]), r.level)}
    <p class="muted pad">${r.items.length}가지 운동, ${totalSets(r)}세트, 약 ${estimateMinutes(r, store.settings.restSec)}분</p>
    <div class="list">${r.items.map((it) => `
      <div class="row static">${mark(it.ex)}<div class="row-main"><b>${esc(exName(it.ex))}</b><span class="muted">${it.sets}세트 × ${amount(it)}, ${VIEW_TEXT[defs[it.ex].view]}</span></div></div>`).join("")}</div>
    <div class="actions-bottom">
      <button class="btn outline" data-act="set-today" data-id="${id}">${store.today.routine === id && (base.custom || store.today.level === r.level) ? "오늘의 루틴이에요" : "오늘의 루틴으로"}</button>
      <button class="btn primary" data-act="start-routine" data-id="${id}">바로 시작</button>
    </div>`;
}

function exerciseScreen({ ex }) {
  const d = defs[ex];
  const muscles = (d.target_muscles || []).join(", ");
  return `${backBar(d.display_name)}
    <div class="ex-head">${mark(ex)}<div><p class="ex-view">${VIEW_TEXT[d.view]}</p><p class="muted">${esc(d.description || "")}</p>${muscles ? `<p class="muted small">주로 쓰는 근육: ${esc(muscles)}</p>` : ""}</div></div>
    <div class="list">
      <button class="row" data-act="ex-test" data-ex="${ex}"><span class="mark plain">${ICON.flame}</span><div class="row-main"><b>자세 테스트</b><span class="muted">${isHold(ex) ? "30초" : "10회"} 한 세트 후 점수</span></div>${ICON.chev}</button>
      <button class="row" data-act="ex-free" data-ex="${ex}"><span class="mark plain">${ICON.camera}</span><div class="row-main"><b>자유롭게 하기</b><span class="muted">목표 없이 카메라로 세면서</span></div>${ICON.chev}</button>
      <button class="row" data-act="ex-video" data-ex="${ex}"><span class="mark plain">${ICON.film}</span><div class="row-main"><b>촬영한 영상 분석</b><span class="muted">갤러리 영상이나 새로 찍은 영상</span></div>${ICON.chev}</button>
    </div>`;
}

function editorScreen(s) {
  const r = s.draft;
  return `${backBar(s.isNew ? "새 루틴" : "루틴 수정", s.isNew ? "" : `<button class="icon-btn danger" data-act="delete-routine" aria-label="루틴 삭제">${ICON.trash}</button>`)}
    <label class="field pad"><span>루틴 이름</span><input id="rName" value="${esc(r.name)}" placeholder="예: 아침 하체" maxlength="20"></label>
    <div class="list">${r.items.map((it, i) => `
      <div class="edit-row" data-i="${i}">
        <button class="picker" data-act="pick-ex" data-for="editor" data-i="${i}" data-ex="${it.ex}" aria-label="운동 고르기">${mark(it.ex)}<span>${esc(exName(it.ex))}</span>${ICON.down}</button>
        <label class="num"><input type="number" inputmode="numeric" min="1" max="10" value="${it.sets}" data-act="ed-sets" data-i="${i}" aria-label="세트">세트</label>
        <label class="num"><input type="number" inputmode="numeric" min="1" max="300" value="${it.sec ?? it.reps}" data-act="ed-amt" data-i="${i}" aria-label="${isHold(it.ex) ? "초" : "횟수"}">${isHold(it.ex) ? "초" : "회"}</label>
        <button class="icon-btn" data-act="ed-del" data-i="${i}" aria-label="빼기">${ICON.trash}</button>
      </div>`).join("")}</div>
    <button class="btn outline wide" data-act="ed-add">${ICON.plus}운동 추가</button>
    ${s.error ? `<p class="error pad">${esc(s.error)}</p>` : ""}
    <div class="actions-bottom"><button class="btn primary wide" data-act="ed-save">저장</button></div>`;
}

// ----- 기록 탭 -----
function recordsScreen() {
  const hist = store.history;
  let body = "";
  if (!hist.length && ui.rTab !== "overview") {
    body = `<p class="empty">운동을 하면 여기에 기록이 쌓여요. 운동한 날, 자주 운동하는 요일, 자세 점수 변화를 볼 수 있어요.</p>`;
  } else if (ui.rTab === "overview") {
    const t = totals();
    body = `<div class="stats">
        <div><b>${t.sessions}</b><span>운동 횟수</span></div>
        <div><b>${t.reps}</b><span>총 반복</span></div>
        <div><b>${t.avgScore ?? "-"}</b><span>평균 점수</span></div>
        <div><b>${streak()}일</b><span>연속</span></div>
      </div>
      ${calendarBlock()}
      ${hist.length ? `<section class="block chart"><h3>자주 운동하는 요일</h3>${weekdayBars(hist)}<p class="tip" aria-live="polite"></p></section>` : ""}`;
  } else if (ui.rTab === "form") {
    const exs = exercisesWithHistory();
    if (!exs.length) body = `<p class="empty">아직 점수가 매겨진 동작이 없어요.</p>`;
    else {
      if (!exs.includes(ui.formEx)) ui.formEx = exs[0];
      const { points, faults } = exerciseHistory(ui.formEx);
      const maxF = faults[0]?.[1] || 1;
      body = `<div class="chips">${exs.map((e) => `<button class="chip" aria-pressed="${e === ui.formEx}" data-act="form-ex" data-ex="${e}">${esc(exName(e))}</button>`).join("")}</div>
        <section class="block chart"><h3>${esc(exName(ui.formEx))} 자세 점수</h3><p class="muted">운동한 날마다 평균</p>${trendLine(points)}<p class="tip" aria-live="polite"></p></section>
        <section class="block"><h3>자주 나온 지적</h3>${faults.length ? `<ul class="faults">${faults.slice(0, 6).map(([m, n]) => `<li><span>${esc(m)}</span><i style="width:${Math.round((n / maxF) * 100)}%"></i><b>${n}번</b></li>`).join("")}</ul>` : `<p class="muted">지적받은 적이 없어요</p>`}</section>`;
    }
  } else {
    const groups = new Map();
    for (const h of [...hist].reverse()) {
      const k = dayKey(h.ts);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(h);
    }
    body = [...groups.entries()].map(([k, hs]) => {
      const d = new Date(hs[0].ts);
      return `<h3 class="group">${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}요일</h3>${hs.map(recordRow).join("")}`;
    }).join("");
  }
  return `<header class="bar"><h1>기록</h1></header>
    ${segmented("rTab", [["overview", "한눈에"], ["form", "자세"], ["list", "전체 기록"]], ui.rTab)}
    <div class="list">${body}</div>`;
}

function calendarBlock() {
  const goals = store.settings;
  const ms = monthStats(ui.calY, ui.calM);
  const now = new Date();
  const isNow = ui.calY === now.getFullYear() && ui.calM === now.getMonth();
  const sel = dayStats(ui.calSel);
  const sd = new Date(ui.calSel + "T00:00:00");
  const legend = [
    ["운동 시간", sel.minutes, `/ ${goals.goalMin}분`],
    ["반복 횟수", sel.reps, `/ ${goals.goalReps}회`],
    ["자세 점수", sel.avgScore ?? "-", "/ 100점"],
  ];
  return `<section class="block cal">
    <div class="cal-top">
      <button class="icon-btn" data-act="cal-prev" aria-label="이전 달">${ICON.back}</button>
      <h3>${ui.calY !== now.getFullYear() ? `${ui.calY}년 ` : ""}${ui.calM + 1}월</h3>
      <button class="icon-btn" data-act="cal-next" aria-label="다음 달" ${isNow ? "disabled" : ""}>${ICON.chev}</button>
    </div>
    <p class="cal-sum">운동한 날 <b>${ms.days}일</b><span class="sep"></span><b>${ms.reps}</b>회<span class="sep"></span><b>${ms.minutes}</b>분</p>
    ${monthCalendar(ui.calY, ui.calM, ui.calSel, dayStats, goals)}
    <div class="cal-detail">
      <h4>${sd.getMonth() + 1}월 ${sd.getDate()}일 ${WEEK[sd.getDay()]}요일</h4>
      <div class="cal-detail-body">
        ${rings(dayFractions(sel, goals), 112)}
        <ul class="ring-legend">${legend.map(([label, v, goal], i) => `<li><i style="background:${RING_COLORS[i]}"></i><div><span>${label}</span><b>${v}</b><small>${goal}</small></div></li>`).join("")}</ul>
      </div>
      ${sel.list.length ? `<div class="list">${sel.list.map(recordRow).join("")}</div>` : `<p class="muted">이날은 운동 기록이 없어요</p>`}
    </div>
  </section>`;
}

/** 운동 고르기 창 (흰 바탕, 파란 글자, 스크롤) */
function pickExercise(current, onPick) {
  pickCb = onPick;
  $sheet.querySelector(".sheet").innerHTML = `
    <div class="sheet-head"><h2>운동 고르기</h2><button class="text-btn" data-act="close-sheet">닫기</button></div>
    <div class="pick-list">${AREAS.map((a) => `<h3 class="group">${a.name}</h3>${a.exercises.map((ex) => `
      <button class="pick${ex === current ? " on" : ""}" data-pick="${ex}">${mark(ex)}<span>${esc(exName(ex))}</span><small>${VIEW_TEXT[defs[ex].view]}</small>${ex === current ? ICON.check : ""}</button>`).join("")}`).join("")}</div>`;
  $sheet.hidden = false;
  $sheet.querySelector(".sheet").classList.add("tall");
  $sheet.querySelector(".pick.on")?.scrollIntoView({ block: "center" });
}
let pickCb = null;

function recordScreen({ id }) {
  const h = store.history.find((x) => x.id === id);
  if (!h) { ui.stack.pop(); return recordsScreen(); }
  const st = sessionStats(h);
  const d = new Date(h.ts);
  return `${backBar(h.title, `<button class="icon-btn danger" data-act="delete-record" data-id="${id}" aria-label="기록 삭제">${ICON.trash}</button>`)}
    <p class="muted pad">${d.getMonth() + 1}월 ${d.getDate()}일, ${Math.max(1, Math.round(h.durationSec / 60))}분${st.avgScore != null ? `, 평균 ${st.avgScore}점` : ""}</p>
    <div class="list">${h.items.map((it) => `
      <section class="block">
        <h3>${esc(it.name)}</h3>
        <ol class="sets">${it.sets.map((s) => {
          const avg = s.scores?.length ? Math.round(s.scores.reduce((a, b) => a + b, 0) / s.scores.length) : null;
          const amt = s.sec ? `${Math.floor(s.sec)}초${s.targetSec ? ` / ${s.targetSec}초` : ""}` : `${s.reps}회${s.target ? ` / ${s.target}회` : ""}`;
          const f = Object.entries(s.faults || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${n}번`).join(", ");
          return `<li><span>${amt}${s.skipped ? " (중간에 넘김)" : ""}</span>${avg != null ? `<b class="g-${grade(avg)}">${avg}점</b>` : ""}${f ? `<small>${esc(f)}</small>` : ""}</li>`;
        }).join("")}</ol>
      </section>`).join("")}</div>`;
}

// ----- 설정 -----
function openSettings() {
  const s = store.settings;
  const seg = (key, items) => `<div class="seg small">${items.map(([v, l]) => `<button aria-selected="${s[key] === v}" data-set="${key}" data-val="${v}">${l}</button>`).join("")}</div>`;
  const toggle = (key, label) => `<label class="switch"><span>${label}</span><input type="checkbox" data-set="${key}" ${s[key] ? "checked" : ""}></label>`;
  $sheet.querySelector(".sheet").classList.remove("tall");
  $sheet.querySelector(".sheet").innerHTML = `
    <div class="sheet-head"><h2>설정</h2><button class="text-btn" data-act="close-sheet">닫기</button></div>
    <div class="field"><span>카메라</span>${seg("facing", [["user", "앞쪽 (화면 보며)"], ["environment", "뒤쪽 (남이 찍기)"]])}</div>
    <div class="field"><span>인식 정확도</span>${seg("model", [["lite", "빠르게"], ["full", "정확하게"]])}</div>
    <div class="field"><span>세트 사이 휴식</span>${seg("restSec", [[15, "15초"], [30, "30초"], [45, "45초"], [60, "60초"], [90, "90초"]])}</div>
    <div class="field"><span>하루 목표 운동 시간 (달력 바깥 링)</span>${seg("goalMin", [[10, "10분"], [20, "20분"], [30, "30분"], [45, "45분"], [60, "60분"]])}</div>
    <div class="field"><span>하루 목표 반복 횟수 (달력 가운데 링)</span>${seg("goalReps", [[50, "50회"], [100, "100회"], [150, "150회"], [200, "200회"]])}</div>
    ${toggle("voice", "음성 안내")}
    ${toggle("sounds", "효과음")}
    ${toggle("debug", "운동 중 각도 표시 (확인용)")}
    <button class="btn outline danger wide" data-act="reset-data">${ui.confirmReset ? "한 번 더 누르면 모든 기록이 지워져요" : "기록 모두 지우기"}</button>
    <p class="muted small">기록은 이 폰에만 저장돼요.</p>`;
  $sheet.hidden = false;
}

function toast(text) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------- 운동 시작 ----------
function start(kind, title, items, file) {
  sfx.unlock();
  runSession(defs, {
    kind, title, items, file,
    onClose: (saved) => { render(); if (saved) toast("기록을 저장했어요"); },
  });
}
const testItem = (ex) => (isHold(ex) ? { ex, sets: 1, sec: 30 } : { ex, sets: 1, reps: 10 });

// ---------- 이벤트 ----------
document.querySelector(".tabbar").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  ui.tab = b.dataset.tab;
  ui.stack = [];
  render();
});

$view.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || b.tagName === "SELECT" || b.tagName === "INPUT") return;
  const { act, id, ex } = b.dataset;
  const top = ui.stack[ui.stack.length - 1];
  switch (act) {
    case "back": return pop();
    case "seg":
      if (b.dataset.key === "level") { top.level = b.dataset.val; return render(); }
      ui[b.dataset.key] = b.dataset.val; return render();
    case "settings": ui.confirmReset = false; return openSettings();
    case "start-today": { const r = todayRoutine(); return start("routine", r.name, r.items); }
    case "change-today": ui.tab = "workouts"; ui.wTab = "presets"; ui.stack = []; return render();
    case "start-test": return start("test", `자세 테스트: ${exName(ui.testEx)}`, [testItem(ui.testEx)]);
    case "open-record": return push({ type: "record", id });
    case "open-routine": {
      const lv = store.today.routine === id ? store.today.level : "easy";
      return push({ type: "routine", id, level: lv });
    }
    case "open-exercise": return push({ type: "exercise", ex });
    case "set-today": store.setToday(id, top.level); toast("오늘의 루틴으로 정했어요"); return render();
    case "start-routine": { const base = routineById(id); const r = scaled(base, base.custom ? "easy" : top.level); return start("routine", base.name, r.items); }
    case "ex-test": return start("test", `자세 테스트: ${exName(ex)}`, [testItem(ex)]);
    case "ex-free": return start("free", exName(ex), [{ ex, sets: 1 }]);
    case "ex-video": $video.dataset.ex = ex; return $video.click();
    case "new-routine": return push({ type: "editor", isNew: true, draft: { id: `c${Date.now()}`, name: "", custom: true, items: [{ ex: "squat", sets: 3, reps: 12 }] } });
    case "edit-routine": { const r = routineById(id); return push({ type: "editor", isNew: false, draft: structuredClone(r) }); }
    case "ed-add": syncEditor(); top.draft.items.push({ ex: "squat", sets: 3, reps: 12 }); return render();
    case "ed-del": syncEditor(); top.draft.items.splice(+b.dataset.i, 1); return render();
    case "ed-save": {
      syncEditor();
      const d = top.draft;
      if (!d.name.trim()) { top.error = "루틴 이름을 적어주세요"; return render(); }
      if (!d.items.length) { top.error = "운동을 하나 이상 넣어주세요"; return render(); }
      store.saveCustom({ ...d, name: d.name.trim(), custom: true });
      ui.stack.pop();
      if (top.isNew) ui.stack.push({ type: "routine", id: d.id, level: "easy" });
      toast("루틴을 저장했어요");
      return render();
    }
    case "delete-routine":
      if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.classList.add("armed"); toast("한 번 더 누르면 삭제돼요"); return; }
      store.deleteCustom(top.draft.id); ui.stack = []; toast("루틴을 삭제했어요"); return render();
    case "delete-record":
      if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.classList.add("armed"); toast("한 번 더 누르면 삭제돼요"); return; }
      store.deleteSession(id); ui.stack.pop(); toast("기록을 삭제했어요"); return render();
    case "form-ex": ui.formEx = ex; return render();
    case "open-calendar": return openCalendar(dayKey(new Date()));
    case "open-day": return openCalendar(b.dataset.day);
    case "week-today": ui.weekOffset = 0; ui.weekAnim = ""; return render();
    case "cal-prev": case "cal-next": {
      const d = new Date(ui.calY, ui.calM + (act === "cal-next" ? 1 : -1), 1);
      ui.calY = d.getFullYear(); ui.calM = d.getMonth();
      const last = new Date(ui.calY, ui.calM + 1, 0);
      const today = new Date();
      ui.calSel = dayKey(last > today ? today : last);
      return render();
    }
    case "cal-day": ui.calSel = b.dataset.day; return render();
    case "pick-ex": {
      const target = b.dataset.for;
      if (target === "test") return pickExercise(ui.testEx, (v) => { ui.testEx = v; render(); });
      const i = +b.dataset.i;
      syncEditor();
      const items = ui.stack[ui.stack.length - 1].draft.items;
      return pickExercise(items[i].ex, (v) => {
        const it = items[i];
        it.ex = v;
        if (isHold(v)) { it.sec = it.sec ?? 30; delete it.reps; } else { it.reps = it.reps ?? 12; delete it.sec; }
        render();
      });
    }
  }
});

// 차트 터치 → 값 표시
$view.addEventListener("click", (e) => {
  const t = e.target.closest("[data-tip]");
  if (t) showTip(t);
});
function openCalendar(key) {
  const d = new Date(key + "T00:00:00");
  ui.tab = "records"; ui.rTab = "overview"; ui.stack = [];
  ui.calY = d.getFullYear(); ui.calM = d.getMonth(); ui.calSel = key;
  render();
}

// 홈 요일 줄: 좌우로 밀어 지난주/다음 주
let swipe = null;
$view.addEventListener("pointerdown", (e) => {
  if (e.target.closest("#weekSwipe")) swipe = { x: e.clientX, y: e.clientY };
});
$view.addEventListener("pointerup", (e) => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
  ui.weekOffset += dx < 0 ? 1 : -1;
  ui.weekAnim = dx < 0 ? "from-right" : "from-left";
  suppressClick = true;
  render();
});
let suppressClick = false;
$view.addEventListener("click", (e) => { if (suppressClick) { suppressClick = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);

function showTip(el) {
  const box = el.closest(".chart")?.querySelector(".tip");
  if (!box) return;
  box.textContent = el.dataset.tip;
  el.closest(".chart").querySelectorAll(".sel").forEach((x) => x.classList.remove("sel"));
  el.classList.add("sel");
}

$view.addEventListener("change", (e) => {
  const t = e.target;

});

function syncEditor() {
  const top = ui.stack[ui.stack.length - 1];
  if (top?.type !== "editor") return;
  const d = top.draft;
  d.name = document.getElementById("rName")?.value ?? d.name;
  top.error = null;
  document.querySelectorAll(".edit-row").forEach((row) => {
    const it = d.items[+row.dataset.i];
    if (!it) return;
    it.ex = row.querySelector(".picker").dataset.ex;
    const [sets, amt] = row.querySelectorAll("input");
    it.sets = Math.max(1, Math.min(10, parseInt(sets.value, 10) || 1));
    const a = Math.max(1, Math.min(300, parseInt(amt.value, 10) || 1));
    if (isHold(it.ex)) { it.sec = a; delete it.reps; } else { it.reps = a; delete it.sec; }
  });
}

$sheet.addEventListener("click", (e) => {
  if (e.target === $sheet) { $sheet.hidden = true; return render(); }
  const pk = e.target.closest("[data-pick]");
  if (pk) { $sheet.hidden = true; const cb = pickCb; pickCb = null; cb?.(pk.dataset.pick); return; }
  const b = e.target.closest("[data-act],[data-set]");
  if (!b) return;
  if (b.dataset.act === "close-sheet") { $sheet.hidden = true; return render(); }
  if (b.dataset.act === "reset-data") {
    if (!ui.confirmReset) { ui.confirmReset = true; return openSettings(); }
    store.resetAll(); ui.confirmReset = false; $sheet.hidden = true; toast("기록을 모두 지웠어요"); return render();
  }
  if (b.dataset.set && b.tagName === "BUTTON") {
    const k = b.dataset.set;
    const v = typeof store.settings[k] === "number" ? Number(b.dataset.val) : b.dataset.val;
    store.setSetting(k, v);
    openSettings();
  }
});
$sheet.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.set) store.setSetting(t.dataset.set, t.checked);
});

$video.addEventListener("change", () => {
  const file = $video.files[0];
  const ex = $video.dataset.ex;
  $video.value = "";
  if (file) start("video", `영상 분석: ${exName(ex)}`, [{ ex, sets: 1 }], file);
});

// ---------- 시작 ----------
loadDefs().then(render).catch((e) => {
  console.error(e);
  $view.innerHTML = `<p class="error pad">운동 정보를 불러오지 못했어요: ${esc(e.message)}</p>`;
});
