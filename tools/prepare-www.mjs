// 앱 빌드용 www/ 폴더 만들기: 웹 파일 + MediaPipe + 인식 모델 + Capacitor 코어
// 사용: npm install 후 node tools/prepare-www.mjs
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const www = join(root, "www");
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
for (const f of ["index.html", "css", "js", "exercises", "test", "img", "fonts"]) cpSync(join(root, f), join(www, f), { recursive: true });

const mp = join(www, "js/vendor/mediapipe");
mkdirSync(mp, { recursive: true });
const pkg = join(root, "node_modules/@mediapipe/tasks-vision");
cpSync(join(pkg, "vision_bundle.mjs"), join(mp, "vision_bundle.mjs"));
cpSync(join(pkg, "wasm"), join(mp, "wasm"), { recursive: true });
cpSync(join(root, "node_modules/@capacitor/core/dist/index.js"), join(www, "js/vendor/capacitor-core.js"));

const MODELS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
};
for (const [name, url] of Object.entries(MODELS)) {
  const out = join(mp, `pose_landmarker_${name}.task`);
  if (existsSync(out)) continue;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`모델 다운로드 실패 ${url}: ${res.status}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log(`모델 ${name}: ${(res.headers.get("content-length") / 1e6).toFixed(1)}MB`);
}
console.log("www 준비 완료");
