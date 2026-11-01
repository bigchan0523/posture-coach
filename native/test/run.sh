#!/usr/bin/env bash
# 트래커 수신기(SlimeServer.java)를 PC에서 컴파일하고 가짜 트래커 3개(최신/옛 펌웨어/묶음 패킷)로 확인
set -e
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d)
javac -d "$OUT" native/android/SlimeServer.java native/test/ServerMain.java
java -cp "$OUT" ServerMain 6 > "$OUT/server.log" 2>&1 &
SRV=$!
sleep 0.8
node native/test/fake-tracker.mjs A 127.0.0.1 normal 4 &
node native/test/fake-tracker.mjs B 127.0.0.1 legacy 4 &
node native/test/fake-tracker.mjs C 127.0.0.1 bundle 4 &
wait %2 %3 %4
wait $SRV || true
node native/test/check.mjs "$OUT/server.log"
