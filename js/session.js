// 운동 진행 화면: 준비 → 3·2·1 → 운동(목표 횟수/시간) → 휴식 → 다음 세트/운동 → 결과
import { Exercise } from "./engine.js";
import { PoseDetector, DemoDetector } from "./pose.js";
import { drawPose } from "./overlay.js";
import { store } from "./store.js";
import { sfx, say } from "./sound.js";
import { VIEW_TEXT } from "./routines.js";
import { rig, fuse } from "./trackers.js";
import { Skeleton3D } from "./skeleton3d.js";

const DEMO = new URLSearchParams(location.search).has("demo");
const $ = (id) => document.getElementById(id);
// 어깨·엉덩이·무릎·발목: 좌우 중 한쪽만 잘 보여도 됨 (옆모습은 반대쪽이 가려짐)
const BODY_PAIRS = [[11, 12], [23, 24], [25, 26], [27, 28]];
const RING_C = 2 * Math.PI * 52;
// 누워서·엎드려서 시작하는 운동 (트래커 모드에서 '똑바로 서기'를 기다리지 않음)
const LYING = ["glute_bridge", "leg_raise", "mountain_climber", "plank", "push_up"];

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
    // 측정 방법: camera | trackers | both (영상 분석은 항상 카메라 방식)
    this.source = opts.kind === "video" ? "camera" : store.settings.source || "camera";
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
  /** 이 운동을 무엇으로 측정할지: 트래커로 못 하는 운동(팔 동작 등)은 카메라로 */
  mode(ex = this.item.ex) {
    if (this.source === "camera") return "camera";
    this.pointsOf ??= {};
    this.pointsOf[ex] ??= new Exercise(this.defs[ex]).cfg.requiredPoints;
    return rig.supports(this.pointsOf[ex], ex) ? this.source : "camera";
  }
  get needCamera() { return this.items.some((it) => this.mode(it.ex) !== "trackers"); }
  get needTrackers() { return this.items.some((it) => this.mode(it.ex) !== "camera"); }
  get def() { return this.defs[this.item.ex]; }

  // ---------- 열기/닫기 ----------
  async open() {
    const { el } = this;
    el.root.hidden = false;
    document.body.classList.add("in-session");
    el.root.addEventListener("click", this.onClick);
    window.addEventListener("deviceorientation", this.onTilt);
    this.newExercise();
    try {
      this.wake = await navigator.wakeLock?.request?.("screen").catch(() => null);
    } catch { /* 지원 안 함 */ }
    await this.boot();
  }

  /** 측정 준비 (카메라·인식 모델·트래커). '카메라로 하기'를 누르면 다시 불림 */
  async boot() {
    const { el } = this;
    this.el.panel.hidden = true;
    this.el.controls.hidden = true;
    if (this.needTrackers) {
      this.showLoading("트래커 연결을 확인하고 있어요");
      await rig.start();
      if (this.closed) return;
      if (DEMO) { rig.setDemoScene("stand"); await new Promise((ok) => setTimeout(ok, 300)); }
      if (!rig.ready) {
        this.hideLoading(true);
        const why = rig.error ? rig.error
          : rig.assignedCount < rig.set.n ? "트래커 부위 지정이 아직 안 됐어요"
          : rig.liveCount < rig.assignedCount ? `트래커 ${rig.liveCount}/${rig.assignedCount}개만 연결돼 있어요. 전원과 와이파이를 확인해주세요`
          : "트래커 화면에서 보정을 먼저 해주세요";
        this.showPanel(`<h2 class="p-title">트래커 준비가 안 됐어요</h2><p class="p-lead">${esc(why)}</p>
          <div class="p-actions"><button class="btn" data-act="use-camera">카메라로 하기</button><button class="btn primary" data-act="tracker-setup">트래커 설정</button></div>`);
        this.el.controls.hidden = true;
        return;
      }
    }
    if (this.needCamera) {
      this.showLoading("인식 모델을 불러오고 있어요");
      try {
        this.detector = await getDetector();
        if (this.closed) return;
        if (DEMO) {
          this.srcW = 720; this.srcH = 1280; this.mirror = false;
          this.detector.setExercise(this.item.ex);
        } else if (this.kind === "video") {
          this.showLoading("영상을 여는 중이에요");
          el.video.srcObject = null;
          el.video.src = URL.createObjectURL(this.opts.file);
          el.video.loop = false;
          this.mirror = false;
          await el.video.play();
        } else if (!this.stream) {
          this.showLoading("카메라를 켜고 있어요");
          this.stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: store.settings.facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
          });
          if (this.closed) { this.stream.getTracks().forEach((t) => t.stop()); return; }
          el.video.srcObject = this.stream;
          await el.video.play();
          await firstFrame(el.video);
          this.mirror = store.settings.facing === "user";
        }
      } catch (e) {
        console.error(e);
        if (this.closed) return;
        this.hideLoading(true);
        this.showPanel(`<p class="p-lead">${esc(cameraError(e))}</p><div class="p-actions"><button class="btn primary" data-act="quit">닫기</button></div>`);
        return;
      }
    }
    if (this.closed) return;
    el.video.classList.toggle("mirror", !!this.mirror);
    if (this.kind === "video") this.startActive();
    else this.toPrepare();
    this.hideLoading();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
  }

  showLoading(step) {
    const box = $("sLoading");
    box.hidden = false;
    box.classList.remove("hide");
    $("lEx").textContent = this.kind === "routine" ? this.opts.title : this.def.display_name;
    $("lStep").textContent = step;
    const how = this.def.view === "side" ? "옆모습이 보이게" : this.def.view === "front" ? "정면이 보이게" : "";
    $("lHint").textContent = this.kind === "video" ? ""
      : !this.needCamera ? "트래커로 측정해요. 폰은 아무 데나 둬도 돼요"
      : `그동안 폰을 세워두고${how ? ` ${how}` : ""} 한두 걸음 물러서 주세요`;
  }

  hideLoading(now = false) {
    const box = $("sLoading");
    if (now) { box.hidden = true; return; }
    box.classList.add("hide");
    setTimeout(() => { if (box.classList.contains("hide")) box.hidden = true; }, 320);
  }

  close(save) {
    const { el } = this;
    this.closed = true;
    this.hideLoading(true);
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

  /** 데모: 가짜 트래커가 지금 단계에 맞는 동작을 하게 */
  demoScene(scene) { if (DEMO && rig.running) rig.setDemoScene(scene); }

  setHeader() {
    const it = this.item;
    const { el } = this;
    el.title.textContent = this.def.display_name;
    const parts = [];
    if (this.kind === "routine" || this.kind === "test") parts.push(`${this.setIdx + 1} / ${it.sets}세트`);
    const m = this.mode();
    parts.push(m === "trackers" ? "트래커로 측정" : m === "both" ? `${VIEW_TEXT[this.def.view] || ""} + 트래커` : VIEW_TEXT[this.def.view] || "");
    el.root.classList.toggle("trk", m === "trackers");
    el.sub.textContent = parts.filter(Boolean).join("  ");
  }

  toPrepare() {
    this.phase = "prepare";
    this.readySince = null;
    this.setHeader();
    const it = this.item;
    const trk = this.mode() === "trackers";
    this.demoScene("stand");
    const direction = trk ? (LYING.includes(it.ex) ? "운동 자세를 잡아주세요" : "똑바로 서주세요")
      : this.def.view === "side" ? "폰을 세워두고 옆으로 서주세요" : this.def.view === "front" ? "폰을 세워두고 정면을 봐주세요" : "폰을 세워두고 서주세요";
    const when = trk ? "잠깐 멈춰 있으면 자동으로 시작해요" : "머리부터 발까지 화면에 들어오면 자동으로 시작해요";
    this.showPanel(`
      <p class="p-kicker">${this.itemIdx + 1}번째 운동</p>
      <h2 class="p-title">${esc(this.def.display_name)}</h2>
      <p class="p-lead">${esc(direction)}</p>
      <p class="p-hint">${when}${fmtTarget(it) ? `. 목표는 ${fmtTarget(it)}` : ""}</p>
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
    this.demoScene(this.item.ex);
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
    this.demoScene("stand");
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
    const m = this.mode();
    let lms, W, H, tMs, opts = {};
    this.drawMirror = this.mirror;
    if (m !== "camera" && this.phase !== "active") this.maybeRecalibrate();
    if (m === "trackers") {
      if (this.phase === "summary") return;
      const t = rig.landmarks(this.def.view === "front" ? "front" : "side");
      lms = t?.lm ?? null; W = t?.W ?? 720; H = t?.H ?? 1280; tMs = performance.now();
      opts = { allViews: true, derived: t?.derived };
      this.drawMirror = false;
    } else if (DEMO) {
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
    if (m === "both") {
      // 카메라 관절에 트래커 뼈대를 맞춰 끼움. 카메라에서 사람이 안 보이면 트래커만으로 계속
      const f = fuse(lms, W, H);
      if (f) { lms = f.lm; opts = { derived: f.derived }; }
      else {
        const t = rig.landmarks(this.def.view === "front" ? "front" : "side");
        if (t) { lms = t.lm; W = t.W; H = t.H; opts = { allViews: true, derived: t.derived }; this.drawMirror = false; }
      }
    }

    let r = null;
    if (m === "trackers" && !lms) {
      this.setNotice("트래커 연결이 끊겼어요. 트래커 전원과 와이파이를 확인해주세요");
      if (this.phase === "prepare") this.readySince = null;
    } else if (this.phase === "active" && !this.paused) {
      r = this.exercise.update(lms, tMs, W, H, opts);
      this.onResult(r);
    } else if (this.phase === "prepare" && !this.paused) {
      this.checkReady(lms);
    }
    this.draw(lms, W, H, r);
  }

  /** 쉬는 시간·준비 중에 똑바로 서서 가만히 있으면 트래커 방향 틀어짐(드리프트)을 조용히 다시 맞춤 */
  maybeRecalibrate() {
    const now = performance.now();
    if (!rig.standingStill()) { this.stillSince = null; return; }
    this.stillSince ??= now;
    if (now - this.stillSince > 1000 && now - (this.lastRecal || 0) > 5000) {
      rig.calibrateStand({ only: rig.bodyParts });
      this.lastRecal = now;
    }
  }

  checkReady(lms) {
    const now = performance.now();
    if (this.mode() === "trackers") {
      // 트래커만: 2초 동안 가만히 있으면 시작 (선 자세 운동은 똑바로 서 있을 때)
      const ok = LYING.includes(this.item.ex) ? rig.allStill() : rig.standingStill();
      this.setNotice(ok ? "" : LYING.includes(this.item.ex) ? "자세를 잡고 잠깐 멈춰주세요" : "똑바로 서서 잠깐 멈춰주세요");
      if (!ok) { this.readySince = null; return; }
      this.readySince ??= now;
      if (now - this.readySince > 2000) this.toCountdown();
      return;
    }
    const visible = lms && BODY_PAIRS.every(([a, b]) => Math.max(lms[a].visibility ?? 1, lms[b].visibility ?? 1) > 0.6);
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
    if (this.mode() === "trackers") {
      // 트래커만 쓸 때는 3D 뼈대 (드래그로 돌려보기). 운동마다 보기 좋은 방향으로 시작
      this.v3d ??= new Skeleton3D(c, { dark: true });
      if (this.v3dEx !== this.item.ex) {
        this.v3dEx = this.item.ex;
        this.v3d.reset(this.def.view === "front" ? "free" : "free");
        if (this.def.view !== "front") { this.v3d.yaw = 70; this.v3d.pitch = 10; }
      }
      const a = rig.jointAngles();
      const f = (v) => `${Math.round(v)}°`;
      this.v3d.render(rig.skeleton(), {
        forward: rig.viewForward,
        alert: r?.feedback?.some((x) => x.severity === "warning" || x.severity === "error"),
        empty: "트래커 신호를 기다리는 중",
        labels: !a ? [] : a.leftElbow != null && this.pointsOf?.[this.item.ex]?.some((p) => /elbow|wrist/.test(p))
          ? [{ at: "left_elbow", text: f(a.leftElbow) }, { at: "right_elbow", text: f(a.rightElbow) }]
          : [{ at: "left_knee", text: f(a.leftKnee) }, { at: "right_knee", text: f(a.rightKnee) }],
      });
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(c.clientWidth * dpr)) { c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr); }
    const alert = r?.feedback?.some((f) => f.severity === "warning" || f.severity === "error");
    drawPose(c.getContext("2d"), lms, {
      srcW: W, srcH: H, mirror: this.drawMirror ?? this.mirror,
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
      this.paused = false; // 일시정지 중에 눌러도 바로 다음으로
      if (this.phase === "active") this.finishSet(true);
      else if (this.phase === "rest" || this.phase === "prepare") { clearInterval(this.timer); this.toCountdown(); }
    } else if (act === "close") {
      if (this.phase === "summary") return this.close(true);
      this.paused = true;
      // 쉬는 시간·카운트다운 타이머를 멈춰야 확인창을 덮어쓰지 않음 (계속하기 누르면 이어서 진행)
      clearInterval(this.timer);
      this.prevPanel = this.el.panel.hidden ? null : this.el.panel.innerHTML;
      if (this.kind === "video") this.el.video.pause();
      this.showPanel(`<h2 class="p-title">운동을 끝낼까요?</h2><p class="p-hint">지금까지 한 기록은 저장돼요</p>
        <div class="p-actions"><button class="btn" data-act="resume">계속하기</button><button class="btn primary" data-act="end">끝내기</button></div>`);
      this.el.controls.hidden = true;
    } else if (act === "resume") this.resume();
    else if (act === "end") {
      this.paused = false;
      if (this.phase === "active") this.recordSet(true);
      this.toSummary();
    } else if (act === "done") this.close(true);
    else if (act === "quit") this.close(false);
    else if (act === "use-camera") { this.source = "camera"; this.boot(); }
    else if (act === "tracker-setup") { this.close(false); this.opts.onTrackerSetup?.(); }
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

/** 카메라 첫 화면이 실제로 들어올 때까지 (최대 3초) */
function firstFrame(video) {
  if (video.videoWidth > 0 && video.readyState >= 2) return Promise.resolve();
  return new Promise((ok) => {
    const done = () => { clearTimeout(t); video.removeEventListener("loadeddata", done); ok(); };
    const t = setTimeout(done, 3000);
    video.addEventListener("loadeddata", done);
  });
}

function gradeOf(s) { return s >= 90 ? "A" : s >= 80 ? "B" : s >= 70 ? "C" : s >= 60 ? "D" : "F"; }

function cameraError(e) {
  if (/import|fetch|network|\.task|wasm/i.test(e?.message || "")) return "인식 모델을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시작해주세요";
  if (!window.isSecureContext) return "카메라는 https 주소에서만 켜져요";
  if (e?.name === "NotAllowedError") return "카메라 권한이 꺼져 있어요. 설정에서 카메라를 허용해주세요";
  if (e?.name === "NotFoundError") return "카메라를 찾을 수 없어요";
  return `시작하지 못했어요: ${e?.message || e}`;
}
