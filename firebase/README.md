# Firebase 설정 파일 자리
Firebase 콘솔에서 받은 `google-services.json` 을 이 폴더에 넣고 올리면, 다음 빌드부터 구글 로그인·기록 저장이 켜져요.
(파일이 없으면 계정 기능 없이 빌드돼요.)

Firestore 보안 규칙 (Firestore Database > 규칙 탭에 붙여넣기):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```
