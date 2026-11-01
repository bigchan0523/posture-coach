// run.sh 결과 확인: 3초쯤의 상태에서 센서 4개(A, B, C의 0·1번)가 회전값을 받고 있어야 함
import { readFileSync } from "node:fs";
const states = readFileSync(process.argv[2], "utf8").split("\n").filter((l) => l.startsWith("STATE ")).map((l) => JSON.parse(l.slice(6)));
const s = states[2];
const ok = (c, m) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) process.exitCode = 1; };
ok(s && s.running, "수신기 실행");
const t = s?.trackers || [];
ok(t.length === 4, `센서 4개 인식 (${t.length})`);
ok(t.every((x) => x.connected && x.hasRot && x.count > 50), "모두 연결·회전값 수신");
ok(t.some((x) => x.position === 4), "펌웨어가 알려준 부착 위치(가슴) 읽기");
ok(t.some((x) => x.id.startsWith("127.0.0.1")), "옛 펌웨어(MAC 없음) 지원");
ok(t.filter((x) => x.id.startsWith("24:0A:C4:00:00:43")).length === 2, "묶음 패킷(센서 2개) 해석");
ok(t.every((x) => Math.abs(Math.hypot(...x.q) - 1) < 0.01), "쿼터니언 정상");
