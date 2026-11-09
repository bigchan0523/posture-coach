# 디버그(테스트)용 서명 키 — 빌드마다 같은 키를 써야 폰에서 덮어 설치가 돼요.
# 플레이스토어 배포용 키가 아니에요. 별칭 androiddebugkey, 비밀번호 android
# SHA-1  2C:8F:76:BC:FE:75:F1:39:0C:32:D5:7F:AB:F1:DF:34:95:00:B7:92   ← Firebase 프로젝트 설정 > 안드로이드 앱 > SHA 인증서 지문에 등록
# SHA-256 B0:75:00:0D:8E:63:BB:9C:05:22:E0:3E:B3:6A:74:4B:29:C7:8C:53:51:FB:C9:27:BB:20:F5:59:5C:FA:D0:69

# 플레이스토어 업로드용 키 (릴리스 AAB 서명) — 저장소에는 없음
# 키 파일은 GitHub Secrets의 UPLOAD_KEYSTORE_B64, 비밀번호는 UPLOAD_KEYSTORE_PASSWORD 에만 둠. 별칭 jakojako-upload
# 원본 키 파일(jakojako-upload.jks)과 비밀번호는 팀장이 따로 백업
# SHA-1  31:07:20:73:D0:00:52:76:E1:0F:26:6E:33:70:E2:7C:68:54:93:CB   ← Firebase SHA 인증서 지문에도 등록
# SHA-256 92:E7:4B:48:4F:DE:57:E8:A9:76:80:77:4E:D9:0D:74:59:58:8A:31:D8:D1:35:64:30:05:C7:22:2D:E5:D9:2B
# 플레이 스토어에서 받은 앱은 구글이 '앱 서명 키'로 다시 서명함 → 플레이 콘솔 > 앱 서명의 SHA-1도 Firebase에 등록해야 구글 로그인이 됨
