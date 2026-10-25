// 운동 진행 화면: 준비 → 3·2·1 → 운동(목표 횟수/시간) → 휴식 → 다음 세트/운동 → 결과
import { Exercise } from "./engine.js";
import { PoseDetector, DemoDetector } from "./pose.js";
import { drawPose } from "./overlay.js";
import { store } from "./store.js";
import { sfx, say } from "./sound.js";
import { VIEW_TEXT } from "./routines.js";

const DEMO = new URLSearchParams(location.search).has("demo");
const $ = (id) => document.getElementById(id);
// 어깨·엉덩이·무릎·발목: 좌우 중 한쪽만 잘 보여도 됨 (옆모습은 반대쪽이 가려짐)
const BODY_PAIRS = [[11, 12], [23, 24], [25, 26], [27, 28]];
const RING_C = 2 * Math.PI * 52;

let detector = null;

async function getDetector() {
  if (DEMO) {
    if (!detector) { detector = new DemoDetector(); await detector.init(); }
    return detector;
  }
  if (!detector) detector = new PoseDetector();
  await detector.init(store.settings.model);
  return detector;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTarget = (it) => (it.sec ? `${it.sec}초` : it.reps ? `${it.reps}회` : "");

/**
 * @param defs 운동 정의 (YAML 객체) 모음
 * @param opts { kind: 'routine'|'test'|'free'|'video', title, items:[{ex, sets, reps|sec}], file?, onClose(saved) }
 */
export async function runSession(defs, opts) {
  const s = new Session(defs, opts);
  await s.open();
  return s;
}

class Session {
  constructor(defs, opts) {
    this.defs = defs;
    this.opts = opts;
    this.kind = opts.kind;
    this.items = opts.items;
    this.itemIdx = 0;
    this.setIdx = 0;
    this.phase = "loading";
    this.paused = false;
    this.results = this.items.map((it) => ({ ex: it.ex, name: defs[it.ex].display_name, sets: [] }));
    this.t0 = Date.now();
    this.el = {
      root: $("session"), video: $("sVideo"), canvas: $("sCanvas"), title: $("sTitle"), sub: $("sSub"),
      notice: $("sNotice"), ring: $("sRing"), ringBar: $("sRingBar"), count: $("sCount"), target: $("sTarget"),
      grade: $("sGrade"), messages: $("sMessages"), panel: $("sPanel"), controls: $("sControls"),
      pause: $("sPause"), skip: $("sSkip"), close: $("sClose"), debug: $("sDebug"),
    };
    this.onClick = this.onClick.bind(this);
    this.loop = this.loop.bind(this);
    this.onTilt = (e) => { this.tilt = e.beta; };
  }

  get item() { return this.items[this.itemIdx]; }
  get def() { return this.defs[this.item.ex]; }

  // ---------- 열기/닫기 ----------
  async open() {
    const { el } = this;
    el.root.hidden = false;
    document.body.classList.add("in-session");
    el.root.addEventListener("click", this.onClick);
    window.addEventListener("deviceorientation", this.onTilt);
    this.newExercise();
    this.showPanel(`<p class="p-lead">카메라와 인식 모델을 준비하고 있어요</p><p class="p-hint">처음 한 번은 몇 초 걸릴 수 있어요</p>`);
    try {
      this.wake = await navigator.wakeLock?.request?.("screen").catch(() => null);
    } catch { /* 지원 안 함 */ }
    try {
      this.detector = await getDetector();
      if (DEMO) {
        this.srcW = 720; this.srcH = 1280; this.mirror = false;
        this.detector.setExercise(this.item.ex);
      } else if (this.kind === "video") {
        el.video.srcObject = null;
        el.video.src = URL.createObjectURL(this.opts.file);
        el.video.loop = false;
        this.mirror = false;
        await el.video.play();
      } else {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: store.settings.facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
        });
        el.video.srcObject = this.stream;
        await el.video.play();
        this.mirror = store.settings.facing === "user";
      }
    } catch (e) {
      console.error(e);
      this.showPanel(`<p class="p-lead">${esc(cameraError(e))}</p><div class="p-actions"><button class="btn primary" data-act="quit">닫기</button></div>`);
      return;
    }
    el.video.classList.toggle("mirror", !!this.mirror);
    if (this.kind === "video") this.startActive();
    else this.toPrepare();
    this.raf = requestAnimationFrame(this.loop);
  }

  close(save) {
    const { el } = this;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    if (!el.video.paused) el.video.pause();
    el.video.srcObject = null;
    el.video.removeAttribute("src");
    el.root.removeEventListener("click", this.onClick);
    window.removeEventListener("deviceorientation", this.onTilt);
    this.wake?.release?.().catch(() => {});
    clearInterval(this.timer);
    el.root.hidden = true;
    document.body.classList.remove("in-session");
    let saved = null;
    if (save) saved = this.saveHistory();
    this.opts.onClose?.(saved);
  }

  saveHistory() {
    const items = this.results.filter((r) => r.sets.some((s) => s.reps > 0 || s.sec > 0));
    if (!items.length) return null;
    const rec = {
      id: `s${Date.now()}`, ts: this.t0, title: this.opts.title, kind: this.kind,
      durationSec: Math.round((Date.now() - this.t0) / 1000), items,
    };
    store.addSession(rec);
    return rec;
  }

  // ---------- 단계 ----------
  newExercise() {
    this.exercise = new Exercise(this.def);
    this.detector?.setExercise?.(this.item.ex);
  }

  setHeader() {
    const it = this.item;
    const { el } = this;
    el.title.textContent = this.def.display_name;
    const parts = [];
    if (this.kind === "routine" || this.kind === "test") parts.push(`${this.setIdx + 1} / ${it.sets}세트`);
    parts.push(VIEW_TEXT[this.def.view] || "");
    el.sub.textContent = parts.filter(Boolean).join("  ");
  }

  toPrepare() {
    this.phase = "prepare";
    this.readySince = null;
    this.setHeader();
    const it = this.item;
    const direction = this.def.view === "side" ? "폰을 세워두고 옆으로 서주세요" : this.def.view === "front" ? "폰을 세워두고 정면을 봐주세요" : "폰을 세워두고 서주세요";
    this.showPanel(`
      <p class="p-kicker">${this.itemIdx + 1}번째 운동</p>
      <h2 class="p-title">${esc(this.def.display_name)}</h2>
      <p class="p-lead">${esc(direction)}</p>
      <p class="p-hint">머리부터 발까지 화면에 들어오면 자동으로 시작해요${fmtTarget(it) ? `. 목표는 ${fmtTarget(it)}` : ""}</p>
      <p class="p-tilt" id="pTilt" hidden></p>
      <div class="p-actions"><button class="btn primary" data-act="start">바로 시작</button></div>`);
    this.updateRing(0);
  }

  toCountdown() {
    this.phase = "countdown";
    this.setHeader();
    let n = 3;
    const show = () => this.showPanel(`<p class="p-count">${n}</p><p class="p-lead">${esc(this.def.display_name)} ${fmtTarget(this.item)}</p>`, "countdown");
    show();
    sfx.count();
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      n -= 1;
      if (n > 0) { show(); sfx.count(); return; }
      clearInterval(this.timer);
      sfx.go();
      say("시작", { interrupt: true });
      this.startActive();
    }, 1000);
  }

  startActive() {
    this.phase = "active";
    this.exercise.reset();
    this.lastReps = 0;
    this.finishAt = null;
    this.setT0 = performance.now();
    this.hidePanel();
    this.setHeader();
    this.updateRing(0);
    this.el.grade.hidden = true;
  }

  /** 진행 중인 세트를 기록 */
  recordSet(skipped) {
    const ex = this.exercise;
    const it = this.item;
    const log = ex.repLog;
    const isHold = ex.cfg.type === "duration";
    const reps = isHold ? 0 : this.repCount();
    const sec = isHold ? Math.round(Math.max(ex.bestHoldSec, ex.holdSec) * 10) / 10 : 0;
    if (skipped && !reps && !sec && !log.length) return;
    const faults = {};
    for (const r of log) for (const f of r.faults || []) faults[f.message] = (faults[f.message] || 0) + 1;
    this.results[this.itemIdx].sets.push({
      reps, target: it.reps ?? null, sec, targetSec: it.sec ?? null,
      scores: log.filter((r) => r.score != null).map((r) => r.score), faults, skipped,
    });
  }

  /** 세트 끝: 기록하고 다음 단계로 */
  finishSet(skipped = false) {
    this.recordSet(skipped);
    const it = this.item;
    if (this.kind === "free" || this.kind === "video") return this.toSummary();
    if (!skipped) sfx.setDone();
    if (this.setIdx + 1 < it.sets) {
      this.setIdx += 1;
      return this.toRest(false);
    }
    if (this.itemIdx + 1 < this.items.length) {
      this.itemIdx += 1;
      this.setIdx = 0;
      this.newExercise();
      return this.toRest(true);
    }
    this.toSummary();
  }

  toRest(newExercise) {
    this.phase = "rest";
    this.restLeft = store.settings.restSec;
    const next = this.item;
    this.restText = newExercise
      ? `다음 운동: ${this.def.display_name} ${fmtTarget(next)}`
      : `다음: ${this.setIdx + 1}세트 ${fmtTarget(next)}`;
    this.restView = newExercise ? `${VIEW_TEXT[this.def.view] || ""} 자세로 바꿔주세요` : "";
    say(newExercise ? `세트 완료. 다음은 ${this.def.display_name}` : "세트 완료. 쉬세요", { interrupt: true });
    this.updateRing(0);
    this.setHeader();
    this.runRestTimer();
  }

  showRest() {
    this.showPanel(`
      <p class="p-kicker">쉬는 시간</p>
      <p class="p-count">${this.restLeft}</p>
      <p class="p-lead">${esc(this.restText)}</p>${this.restView ? `<p class="p-hint">${esc(this.restView)}</p>` : ""}
      <div class="p-actions"><button class="btn" data-act="more">+15초</button><button class="btn primary" data-act="next">바로 시작</button></div>`, "rest");
  }

  runRestTimer() {
    this.showRest();
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.restLeft -= 1;
      if (this.restLeft <= 3 && this.restLeft > 0) sfx.count();
      if (this.restLeft <= 0) { clearInterval(this.timer); this.toCountdown(); return; }
      this.showRest();
    }, 1000);
  }

  toSummary() {
    this.phase = "summary";
    clearInterval(this.timer);
    if (!this.el.video.paused) this.el.video.pause();
    this.el.grade.hidden = true;
    const rows = this.results.filter((r) => r.sets.some((x) => x.reps > 0 || x.sec > 0)).map((r) => {
      const isHold = this.defs[r.ex].type === "duration";
      const amounts = r.sets.map((s) => (isHold ? `${Math.floor(s.sec)}초` : `${s.reps}회`)).join(", ");
      const scores = r.sets.flatMap((s) => s.scores);
      const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
      const fm = new Map();
      for (const s of r.sets) for (const [m, n] of Object.entries(s.faults)) fm.set(m, (fm.get(m) || 0) + n);
      const top = [...fm.entries()].sort((a, b) => b[1] - a[1])[0];
      return `<li>
        <div class="sum-row"><b>${esc(r.name)}</b><span class="score ${avg == null ? "" : `g-${gradeOf(avg)}`}">${avg == null ? "" : `${avg}점`}</span></div>
        <div class="sum-sub">${esc(amounts)}</div>
        ${top ? `<div class="sum-fault">자주 나온 지적: ${esc(top[0])} (${top[1]}번)</div>` : ""}
      </li>`;
    }).join("");
    const all = this.results.flatMap((r) => r.sets.flatMap((s) => s.scores));
    const avg = all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null;
    const min = Math.max(1, Math.round((Date.now() - this.t0) / 60000));
    say(avg != null ? `수고했어요. 평균 ${avg}점` : "수고했어요", { interrupt: true });
    this.showPanel(`
      <p class="p-kicker">${esc(this.opts.title)}</p>
      <h2 class="p-title">${avg != null ? `평균 ${avg}점` : "운동 완료"}</h2>
      <p class="p-lead">${min}분 운동했어요</p>
      ${rows ? `<ul class="sum-list">${rows}</ul>` : `<p class="p-hint">기록된 동작이 없어요</p>`}
      <div class="p-actions"><button class="btn primary" data-act="done">${rows ? "기록 저장하고 닫기" : "닫기"}</button></div>`, "summary");
  }

  // ---------- 프레임 ----------
  loop() {
    this.raf = requestAnimationFrame(this.loop);
    const v = this.el.video;
    let lms, W, H, tMs;
    if (DEMO) {
      if (this.phase === "summary") return;
      lms = this.detector.detect(); W = this.srcW; H = this.srcH; tMs = performance.now();
    } else {
      if (this.kind === "video" && v.ended && this.phase === "active") { this.finishSet(); return; }
      if (v.readyState < 2 || v.currentTime === this.lastTime) return;
      this.lastTime = v.currentTime;
      lms = this.detector.detect(v);
      W = v.videoWidth; H = v.videoHeight;
      tMs = this.kind === "video" ? v.currentTime * 1000 : performance.now();
    }

    let r = null;
    if (this.phase === "active" && !this.paused) {
      r = this.exercise.update(lms, tMs, W, H);
      this.onResult(r);
    } else if (this.phase === "prepare" && !this.paused) {
      this.checkReady(lms);
    }
    this.draw(lms, W, H, r);
  }

  checkReady(lms) {
    const visible = lms && BODY_PAIRS.every(([a, b]) => Math.max(lms[a].visibility ?? 1, lms[b].visibility ?? 1) > 0.6);
    const now = performance.now();
    const tiltEl = document.getElementById("pTilt");
    if (tiltEl) {
      const off = this.tilt == null ? 0 : Math.abs(Math.abs(this.tilt) - 90);
      tiltEl.hidden = off < 20;
      tiltEl.textContent = "폰이 기울어져 있어요. 똑바로 세워주세요";
    }
    this.setNotice(visible ? "" : "몸 전체가 화면에 들어오게 해주세요");
    if (!visible) { this.readySince = null; return; }
    this.readySince ??= now;
    if (now - this.readySince > 1500) this.toCountdown();
  }

  repCount() {
    const ex = this.exercise;
    return ex.cfg.bilateral ? Math.max(ex.channels[0].counter, ex.channels[1].counter) : ex.counter;
  }

  onResult(r) {
    const ex = this.exercise;
    const it = this.item;
    const isHold = ex.cfg.type === "duration";
    this.setNotice(r.message || r.viewWarning || "");

    if (isHold) {
      const sec = r.holdSec || 0;
      this.el.count.textContent = Math.floor(sec);
      this.el.target.textContent = it.sec ? `/ ${it.sec}초` : "초";
      this.updateRing(it.sec ? sec / it.sec : 0);
      if (it.sec && sec >= it.sec && this.kind !== "video") return this.finishSet();
    } else {
      const n = this.repCount();
      this.el.count.textContent = n;
      this.el.target.textContent = it.reps ? `/ ${it.reps}회` : "회";
      this.updateRing(it.reps ? n / it.reps : 0);
      if (n > this.lastReps) {
        this.lastReps = n;
        sfx.rep();
        say(String(n), { interrupt: true });
      }
      // 목표 도달: 마지막 회의 점수가 나올 때까지(일어설 때까지) 최대 2.5초 기다렸다가 세트 종료
      if (it.reps && n >= it.reps && this.kind !== "video" && this.kind !== "free") {
        this.finishAt ??= performance.now() + 2500;
        if (r.repDone || performance.now() > this.finishAt) { this.finishAt = null; this.showRepGrade(r); return this.finishSet(); }
      }
    }

    this.showRepGrade(r);
    for (const f of r.repDone?.faults || []) if (f.severity !== "success") say(f.message, { onceKey: f.name });
    const uniq = new Map(r.feedback.map((f) => [f.name, f]));
    for (const f of uniq.values()) if (f.severity === "warning" || f.severity === "error") say(f.message, { onceKey: f.name });
    const side = { L: "왼쪽 ", R: "오른쪽 " };
    this.el.messages.innerHTML = [...uniq.values()]
      .map((f) => `<li class="${f.severity}">${f.side && ex.cfg.bilateral ? side[f.side] : ""}${esc(f.message)}</li>`).join("");

    if (store.settings.debug) {
      this.el.debug.hidden = false;
      const a = Object.entries(r.angles || {}).map(([k, v]) => `${k} ${v.toFixed(0)}°`).join("\n");
      this.el.debug.textContent = `시점 ${r.view ?? "-"}  상태 ${r.state ?? [r.stateLeft, r.stateRight].join("/")}\n${a}`;
    } else this.el.debug.hidden = true;
  }

  showRepGrade(r) {
    if (r.repDone?.score == null) return;
    this.el.grade.hidden = false;
    this.el.grade.textContent = r.repDone.grade;
    this.el.grade.className = `s-grade g-${r.repDone.grade}`;
  }

  draw(lms, W, H, r) {
    const c = this.el.canvas;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(c.clientWidth * dpr)) { c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr); }
    const alert = r?.feedback?.some((f) => f.severity === "warning" || f.severity === "error");
    drawPose(c.getContext("2d"), lms, {
      srcW: W, srcH: H, mirror: this.mirror,
      visualization: r ? this.exercise.cfg.visualization : null,
      pointIndex: r?.pointIndex, angles: r?.angles, alert,
    });
  }

  // ---------- 화면 조각 ----------
  updateRing(p) {
    const k = Math.max(0, Math.min(1, p));
    this.el.ringBar.style.strokeDashoffset = String(RING_C * (1 - k));
    this.el.ringBar.classList.toggle("empty", k === 0);
    if (p === 0) {
      this.el.count.textContent = "0";
      const it = this.item;
      this.el.target.textContent = it.sec ? `/ ${it.sec}초` : it.reps ? `/ ${it.reps}회` : "회";
      this.el.messages.innerHTML = "";
    }
  }
  setNotice(t) {
    this.el.notice.hidden = !t;
    if (t) this.el.notice.textContent = t;
  }
  showPanel(html, mod = "") {
    this.el.panel.hidden = false;
    this.el.panel.className = `s-panel ${mod}`;
    this.el.panel.innerHTML = html;
    this.el.controls.hidden = this.phase === "summary" || this.phase === "loading";
    this.el.skip.hidden = this.kind === "video";
  }
  hidePanel() {
    this.el.panel.hidden = true;
    this.el.controls.hidden = false;
    this.el.pause.textContent = "일시정지";
  }

  // ---------- 버튼 ----------
  onClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    sfx.unlock();
    const act = b.dataset.act;
    if (act === "start" || act === "next") { clearInterval(this.timer); this.toCountdown(); }
    else if (act === "more") { this.restLeft += 15; this.showRest(); }
    else if (act === "pause") this.togglePause();
    else if (act === "skip") {
      if (this.phase === "active") this.finishSet(true);
      else if (this.phase === "rest" || this.phase === "prepare") { clearInterval(this.timer); this.toCountdown(); }
    } else if (act === "close") {
      if (this.phase === "summary") return this.close(true);
      this.paused = true;
      this.prevPanel = this.el.panel.hidden ? null : this.el.panel.innerHTML;
      this.el.video.pause?.();
      this.showPanel(`<h2 class="p-title">운동을 끝낼까요?</h2><p class="p-hint">지금까지 한 기록은 저장돼요</p>
        <div class="p-actions"><button class="btn" data-act="resume">계속하기</button><button class="btn primary" data-act="end">끝내기</button></div>`);
    } else if (act === "resume") this.resume();
    else if (act === "end") {
      this.paused = false;
      if (this.phase === "active") this.recordSet(true);
      this.toSummary();
    } else if (act === "done") this.close(true);
    else if (act === "quit") this.close(false);
  }

  togglePause() {
    if (this.paused) return this.resume();
    this.paused = true;
    if (this.kind === "video") this.el.video.pause();
    clearInterval(this.timer);
    this.prevPhase = this.phase;
    this.showPanel(`<h2 class="p-title">일시정지</h2><div class="p-actions"><button class="btn primary" data-act="resume">계속하기</button></div>`);
  }

  resume() {
    this.paused = false;
    if (this.kind === "video") this.el.video.play();
    if (this.phase === "active") this.hidePanel();
    else if (this.phase === "rest") this.runRestTimer();
    else if (this.phase === "countdown") this.toCountdown();
    else if (this.phase === "prepare") this.toPrepare();
  }
}

function gradeOf(s) { return s >= 90 ? "A" : s >= 80 ? "B" : s >= 70 ? "C" : s >= 60 ? "D" : "F"; }

function cameraError(e) {
  if (/import|fetch|network|\.task|wasm/i.test(e?.message || "")) return "인식 모델을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시작해주세요";
  if (!window.isSecureContext) return "카메라는 https 주소에서만 켜져요";
  if (e?.name === "NotAllowedError") return "카메라 권한이 꺼져 있어요. 설정에서 카메라를 허용해주세요";
  if (e?.name === "NotFoundError") return "카메라를 찾을 수 없어요";
  return `시작하지 못했어요: ${e?.message || e}`;
}
