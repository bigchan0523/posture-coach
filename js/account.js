// 구글 계정 로그인 + 운동 기록 클라우드 저장 (Firebase Authentication + Cloud Firestore)
//
// 저장 구조 (Firestore)
//   users/{uid}                    { settings, today, custom, updatedAt }   설정·내 루틴
//   users/{uid}/sessions/{기록id}  운동 기록 하나 (기록이 많아져도 문서 하나 크기 제한(1MB)에 안 걸리게 따로)
//
// 앱 빌드에 firebase/google-services.json 이 들어가 있을 때만 켜짐 (.github/workflows/android.yml 참고)
import { store } from "./store.js";

// 기기마다 다른 설정은 올리지 않음 (트래커 지정, 카메라 방향, 확인용 표시)
const LOCAL_ONLY = ["trackerAssign", "trackerSet", "facing", "debug"];
const listeners = new Set();

class Account {
  constructor() {
    this.user = null;          // { uid, displayName, email, photoUrl }
    this.status = "idle";      // idle | signing | syncing | error
    this.error = null;
    this.ready = false;
    this.auth = null;
    this.db = null;
  }

  /** 앱 시작 시 한 번: 플러그인 확인, 이미 로그인돼 있으면 동기화 */
  async init(plugins = null) {
    if (plugins) { this.auth = plugins.auth; this.db = plugins.db; }
    else {
      const native = globalThis.Capacitor?.isNativePlatform?.();
      if (!native || !globalThis.Capacitor?.isPluginAvailable?.("FirebaseAuthentication")) { this.ready = true; this.changed(); return; }
      const { registerPlugin } = await import("./vendor/capacitor-core.js");
      this.auth = registerPlugin("FirebaseAuthentication");
      this.db = registerPlugin("FirebaseFirestore");
    }
    try {
      const { user } = await this.auth.getCurrentUser();
      this.user = user ? pick(user) : null;
    } catch (e) { this.fail(e); }
    this.ready = true;
    this.changed();
    store.onChange((type, data) => this.onLocalChange(type, data));
    if (this.user) this.sync();
  }

  /** Firebase가 앱에 들어 있는지 (설정 파일을 넣고 빌드했는지) */
  get available() { return !!this.auth; }

  async signIn() {
    if (!this.available) return;
    this.status = "signing"; this.error = null; this.changed();
    try {
      const { user } = await this.auth.signInWithGoogle();
      this.user = user ? pick(user) : null;
      this.status = "idle";
      this.changed();
      if (this.user) await this.sync();
    } catch (e) { this.fail(e); }
  }

  async signOut() {
    try { await this.auth?.signOut(); } catch (e) { console.warn(e); }
    this.user = null;
    store.setSync({ uid: null, at: null, skipLogin: false }); // 로그아웃하면 다음 실행 때 다시 로그인 화면
    this.status = "idle";
    this.changed();
  }

  /** 받아서 합치고, 이 폰에만 있는 건 올림 */
  async sync() {
    if (!this.user || !this.db) return;
    const uid = this.user.uid;
    this.status = "syncing"; this.error = null; this.changed();
    try {
      const firstOnThisPhone = store.sync.uid !== uid;
      const [{ snapshot }, { snapshots }] = await Promise.all([
        this.db.getDocument({ reference: `users/${uid}` }),
        this.db.getCollection({ reference: `users/${uid}/sessions` }),
      ]);
      const profile = snapshot?.data || null;
      const remote = (snapshots || []).map((s) => s.data).filter(Boolean);
      const remoteIds = new Set(remote.map((h) => h.id));
      const localOnly = store.history.filter((h) => !remoteIds.has(h.id));
      // 이 폰에서 처음 로그인하면 계정에 있던 설정을 가져옴 (기기 전용 설정은 그대로)
      let settings = null;
      if (firstOnThisPhone && profile?.settings) {
        settings = { ...profile.settings };
        for (const k of LOCAL_ONLY) delete settings[k];
      }
      const added = store.mergeRemote({ history: remote, custom: profile?.custom || [], settings, today: firstOnThisPhone ? profile?.today || null : null });
      for (const h of localOnly) await this.db.setDocument({ reference: `users/${uid}/sessions/${h.id}`, data: clean(h) });
      await this.pushProfile();
      store.setSync({ uid, at: Date.now() });
      this.lastResult = { added, uploaded: localOnly.length };
      this.status = "idle";
      this.changed();
      return this.lastResult;
    } catch (e) { this.fail(e); }
  }

  async pushProfile() {
    if (!this.user || !this.db) return;
    const settings = { ...store.settings };
    for (const k of LOCAL_ONLY) delete settings[k];
    await this.db.setDocument({
      reference: `users/${this.user.uid}`,
      data: clean({ settings, today: store.today, custom: store.custom, updatedAt: Date.now(), name: this.user.displayName || "" }),
      merge: true,
    });
  }

  /** 로그인 중이면 바뀐 것을 바로 올림 (설정은 1초 모아서) */
  onLocalChange(type, data) {
    if (!this.user || !this.db) return;
    const uid = this.user.uid;
    const run = (p) => p.then(() => store.setSync({ at: Date.now() })).catch((e) => this.fail(e));
    if (type === "session-add") run(this.db.setDocument({ reference: `users/${uid}/sessions/${data.id}`, data: clean(data) }));
    else if (type === "session-delete") run(this.db.deleteDocument({ reference: `users/${uid}/sessions/${data}` }));
    else if (type === "reset") run(Promise.all(data.map((id) => this.db.deleteDocument({ reference: `users/${uid}/sessions/${id}` }))));
    else if (type === "profile") {
      clearTimeout(this.profileTimer);
      this.profileTimer = setTimeout(() => run(this.pushProfile()), 1000);
    }
  }

  fail(e) {
    console.warn("계정 오류", e);
    this.status = "error";
    const msg = String(e?.message || e);
    this.error = /cancel/i.test(msg) ? "로그인을 취소했어요"
      : /network|unavailable|offline/i.test(msg) ? "인터넷 연결을 확인해주세요"
      : /DEVELOPER_ERROR|10:|12500|configuration/i.test(msg) ? "Firebase 설정(SHA-1 지문 등록)을 확인해주세요"
      : /PERMISSION_DENIED|permission/i.test(msg) ? "Firestore 보안 규칙을 확인해주세요"
      : msg;
    this.changed();
  }

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  changed() { for (const f of listeners) { try { f(); } catch (e) { console.warn(e); } } }
}

const pick = (u) => ({ uid: u.uid, displayName: u.displayName || "", email: u.email || "", photoUrl: u.photoUrl || "" });
// Firestore는 undefined를 못 받아서 JSON으로 한 번 걸러서 보냄
const clean = (o) => JSON.parse(JSON.stringify(o));

export const account = new Account();
