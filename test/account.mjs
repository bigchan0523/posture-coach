// 계정 동기화 테스트: 가짜 Firebase(로그인·Firestore)로 '기록 올리기 → 앱 다시 설치 → 로그인하면 복구' 확인
import { account } from "../js/account.js";
import { store } from "../js/store.js";

function fakeFirebase() {
  const docs = new Map(); // 경로 → 데이터
  let signedIn = false;
  const user = { uid: "u1", displayName: "테스트", email: "t@example.com" };
  return {
    docs,
    auth: {
      async getCurrentUser() { return { user: signedIn ? user : null }; },
      async signInWithGoogle() { signedIn = true; return { user }; },
      async signOut() { signedIn = false; },
    },
    db: {
      async getDocument({ reference }) { return { snapshot: { id: reference, data: docs.get(reference) ?? null } }; },
      async setDocument({ reference, data, merge }) { docs.set(reference, merge ? { ...(docs.get(reference) || {}), ...data } : data); },
      async deleteDocument({ reference }) { docs.delete(reference); },
      async getCollection({ reference }) {
        const pre = `${reference}/`;
        return { snapshots: [...docs].filter(([k]) => k.startsWith(pre) && !k.slice(pre.length).includes("/")).map(([k, v]) => ({ id: k, data: v })) };
      },
    },
  };
}

export async function runAccountTests(check) {
  console.log("계정 동기화 (가짜 Firebase)");
  const fb = fakeFirebase();
  const rec = (id, ts) => ({ id, ts, title: "전신 기초", kind: "routine", durationSec: 600, items: [{ ex: "squat", name: "스쿼트", sets: [{ reps: 10, target: 10, sec: 0, targetSec: null, scores: [90], faults: {}, skipped: false }] }] });
  store.resetAll();
  store.addSession(rec("s1", 1000));
  store.addSession(rec("s2", 2000));
  store.setSetting("restSec", 45);
  await account.init({ auth: fb.auth, db: fb.db });
  check("처음엔 로그인 안 됨", !account.user);
  await account.signIn();
  check("구글 로그인", account.user?.uid === "u1");
  check("기록 2개 올라감", fb.docs.has("users/u1/sessions/s1") && fb.docs.has("users/u1/sessions/s2"));
  check("설정 올라감 (기기 전용 설정 제외)", fb.docs.get("users/u1")?.settings?.restSec === 45 && !("trackerAssign" in fb.docs.get("users/u1").settings));

  store.addSession(rec("s3", 3000));
  await new Promise((r) => setTimeout(r, 20));
  check("로그인 중 새 기록은 바로 올라감", fb.docs.has("users/u1/sessions/s3"));
  store.deleteSession("s2");
  await new Promise((r) => setTimeout(r, 20));
  check("기록 삭제도 반영", !fb.docs.has("users/u1/sessions/s2"));

  // 로그아웃: 계정 기록은 이 폰에서 지우고, 기기 전용 설정(트래커 지정)은 남김
  store.setSetting("trackerAssign", { chest: "AA" });
  await account.signOut();
  check("로그아웃하면 이 폰 기록 지워짐 (계정엔 남음)", store.history.length === 0 && store.settings.restSec === 30 && fb.docs.has("users/u1/sessions/s3"));
  check("로그아웃해도 트래커 지정은 남음", store.settings.trackerAssign?.chest === "AA");
  check("로그아웃하면 다음엔 로그인 화면", store.sync.skipLogin === false && !store.sync.uid);
  store.resetAll();
  check("다시 설치 후 기록 없음", store.history.length === 0 && fb.docs.has("users/u1/sessions/s1"));
  await account.signIn();
  check("다시 로그인하면 기록 복구", store.history.map((h) => h.id).join(",") === "s1,s3", store.history.map((h) => h.id).join(","));
  check("설정도 복구", store.settings.restSec === 45);
  await account.signOut();
  store.resetAll();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let pass = 0, fail = 0;
  await runAccountTests((l, c, x = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } });
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
}
