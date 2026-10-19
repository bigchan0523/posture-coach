// 포즈 인식 — MediaPipe Tasks Vision (폰 브라우저 안에서 실행, 영상이 밖으로 나가지 않음)
// 원본 레포의 pose_estimation/estimation.py (Python mediapipe) 역할

const MP_VERSION = "0.10.14";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODELS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
};

// 앱(APK) 빌드 때는 js/vendor/mediapipe/ 에 파일과 모델이 같이 들어감 → 인터넷 없이 동작
// 웹 배포에는 없으므로 CDN에서 받아옴
const LOCAL = new URL("./vendor/mediapipe/", import.meta.url).href;
let mpCache = null;
async function loadMediaPipe() {
  if (mpCache) return mpCache;
  try {
    const mod = await import(`${LOCAL}vision_bundle.mjs`);
    mpCache = { mod, wasm: `${LOCAL}wasm`, model: (m) => `${LOCAL}pose_landmarker_${m}.task` };
  } catch {
    const mod = await import(`${MP_BASE}/vision_bundle.mjs`);
    mpCache = { mod, wasm: `${MP_BASE}/wasm`, model: (m) => MODELS[m] };
  }
  return mpCache;
}

export class PoseDetector {
  constructor() {
    this.landmarker = null;
    this.lastTs = -1;
    this.model = null;
  }

  async init(model = "lite", force = null) {
    if (this.landmarker && this.model === model && !force) return;
    const mp = await loadMediaPipe();
    const { PoseLandmarker, FilesetResolver } = mp.mod;
    const fileset = await FilesetResolver.forVisionTasks(mp.wasm);
    const make = (delegate) => PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: mp.model(model), delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    this.landmarker?.close?.();
    this.delegate = force || "GPU";
    try {
      this.landmarker = await make(this.delegate);
    } catch (e) {
      if (this.delegate === "CPU") throw e;
      console.warn("GPU 사용 불가, CPU로 실행", e);
      this.delegate = "CPU";
      this.landmarker = await make("CPU");
    }
    this.model = model;
  }

  /** video 엘리먼트의 현재 프레임에서 사람 1명의 랜드마크 33개 (없으면 null) */
  detect(video) {
    // MediaPipe는 타임스탬프가 계속 증가해야 함 — 영상 되감기 등에 대비해 내부 시계를 따로 둠
    const ts = Math.max(this.lastTs + 1, Math.round(performance.now()));
    this.lastTs = ts;
    if (this.switching) return null;
    try {
      const res = this.landmarker.detectForVideo(video, ts);
      return res?.landmarks?.[0] ?? null;
    } catch (e) {
      // 일부 기기(특히 iOS)에서 GPU가 실행 중에 실패하는 경우 → CPU로 다시 만든다
      if (this.delegate === "GPU") {
        console.warn("GPU 인식 실패, CPU로 전환", e);
        this.switching = true;
        this.init(this.model, "CPU").finally(() => { this.switching = false; });
        return null;
      }
      throw e;
    }
  }
}

// 카메라 없이 화면을 확인하기 위한 가짜 사람 (?demo 주소로 열면 사용)
export class DemoDetector {
  async init() {
    this.sim = await import("../test/sim.mjs");
    this.t0 = performance.now();
  }
  setExercise(name) { this.name = name; this.t0 = performance.now(); }
  detect() {
    const { sidePose, frontPose, toLandmarks, cycle } = this.sim;
    const t = (performance.now() - this.t0) / 1000;
    const k = t < 1 ? 0 : cycle(((t - 1) % 2.6) / 2.6);
    const deep = Math.floor((t - 1) / 2.6) % 3 !== 2; // 세 번에 한 번은 얕게
    const d = deep ? 1 : 0.45;
    const poses = {
      squat: () => sidePose({ trunk: 40 * k * d, L: { hip: 95 * k * d, knee: 120 * k * d } }),
      push_up: () => sidePose({ lying: 90, arm: { sh: 90, el: 115 * k * d } }),
      bicep_curl: () => frontPose({ arm: { abd: 5, el: 150 * k * d, elDir: -1 } }),
      jumping_jack: () => frontPose({ arm: { abd: 10 + 165 * k * d }, legL: { abd: 15 * k }, legR: { abd: 15 * k } }),
    };
    const pose = (poses[this.name] || poses.squat)();
    const { lm } = toLandmarks(pose, { W: 720, H: 1280 });
    return lm;
  }
}
