package com.posturecoach.app;

// SlimeVR 트래커 수신기 — PC의 SlimeVR Server가 하던 "트래커 받기" 부분만 폰에서 한다.
// 안드로이드 의존성 없는 순수 자바라서 PC에서도 테스트할 수 있다 (native/test 참고).
//
// 프로토콜 (SlimeVR-Tracker-ESP src/network/connection.cpp, SlimeVR-Server TrackersUDPServer.kt 기준, MIT/Apache-2.0):
//  - 트래커는 서버를 못 찾으면 1초마다 255.255.255.255:6969 로 핸드셰이크(종류 3)를 뿌린다
//  - 서버는 64바이트 [3, "Hey OVR =D 5", 0...] 로 답하면 연결 완료, 이후 트래커는 그 주소로 데이터를 보냄
//  - 모든 패킷: int 종류(빅엔디언) + long 패킷번호 + 내용
//  - 서버가 3초 동안 아무것도 안 보내면 트래커가 연결을 끊고 다시 찾음 → 0.5초마다 하트비트(종류 1)
//  - 회전값: 종류 17 (센서번호, 데이터종류, x,y,z,w float, 정확도), 옛 펌웨어는 1/16/23

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketAddress;
import java.net.SocketTimeoutException;
import java.nio.BufferUnderflowException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class SlimeServer {
    public static final int PORT = 6969;
    static final long DEVICE_TIMEOUT_MS = 3000;

    /** 센서 하나 (트래커 하나에 IMU가 여러 개일 수 있음) */
    public static class Sensor {
        public final String id;        // "맥주소/센서번호"
        public final int sensorId;
        public float x, y, z, w = 1;   // 펌웨어 원본 쿼터니언 (z가 위쪽인 좌표계)
        public boolean hasRotation;
        public int status = 1;
        public int imuType;
        public int position;           // 펌웨어가 알려주는 부착 위치 (0 = 모름)
        public long lastRotationMs;
        public int rotationCount;      // 초당 수신 횟수 계산용
        Sensor(String id, int sensorId) { this.id = id; this.sensorId = sensorId; }
    }

    /** 트래커 기기 하나 (와이파이 연결 하나) */
    public static class Device {
        public SocketAddress address;
        public String ip;
        public String mac;
        public String firmware = "";
        public int boardType, mcuType, protocolVersion;
        public float battery = -1, batteryVoltage = -1;
        public int rssi;
        public long lastPacketMs;
        public long lastPacketNumber = -1;
        public final Map<Integer, Sensor> sensors = new LinkedHashMap<>();
        Sensor sensor(int sid) {
            Sensor s = sensors.get(sid);
            if (s == null) { s = new Sensor(mac + "/" + sid, sid); sensors.put(sid, s); }
            return s;
        }
        public boolean connected(long now) { return now - lastPacketMs < DEVICE_TIMEOUT_MS; }
    }

    private final int port;
    private final List<Device> devices = new ArrayList<>();
    private final Map<SocketAddress, Device> byAddress = new LinkedHashMap<>();
    private final Map<String, Device> byMac = new LinkedHashMap<>();
    private DatagramSocket socket;
    private Thread thread;
    private volatile boolean running;
    private volatile String error;
    private final List<String> log = new ArrayList<>();

    public SlimeServer() { this(PORT); }
    public SlimeServer(int port) { this.port = port; }

    public synchronized void start() throws Exception {
        if (running) return;
        socket = new DatagramSocket(null);
        socket.setReuseAddress(true);
        socket.setBroadcast(true);
        socket.bind(new InetSocketAddress(port));
        socket.setSoTimeout(100);
        running = true;
        error = null;
        thread = new Thread(this::loop, "slimevr-udp");
        thread.setDaemon(true);
        thread.start();
        note("수신 시작 (포트 " + port + ")");
    }

    public void stop() {
        running = false;
        DatagramSocket s = socket;
        if (s != null) s.close();
        Thread t = thread;
        if (t != null) try { t.join(500); } catch (InterruptedException ignored) {}
        synchronized (this) { socket = null; thread = null; }
    }

    public boolean isRunning() { return running; }
    public String getError() { return error; }

    public synchronized List<Device> snapshot() { return new ArrayList<>(devices); }

    public synchronized List<String> takeLog() {
        List<String> out = new ArrayList<>(log);
        log.clear();
        return out;
    }

    private synchronized void note(String s) {
        if (log.size() > 50) log.remove(0);
        log.add(s);
    }

    // ---------- 수신 루프 ----------
    private void loop() {
        byte[] buf = new byte[1500];
        long lastKeepup = 0, lastDiscovery = 0;
        while (running) {
            try {
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                try {
                    socket.receive(p);
                    handle(p);
                } catch (SocketTimeoutException ignored) { }
                long now = System.currentTimeMillis();
                if (now - lastKeepup >= 500) { lastKeepup = now; keepup(now); }
                if (now - lastDiscovery >= 2000 && !hasLiveDevice(now)) { lastDiscovery = now; discovery(); }
            } catch (Exception e) {
                if (running) { error = String.valueOf(e); note("오류: " + e); }
            }
        }
    }

    private synchronized boolean hasLiveDevice(long now) {
        for (Device d : devices) if (d.connected(now)) return true;
        return false;
    }

    /** 0.5초마다 하트비트 (안 보내면 트래커가 3초 뒤 연결을 끊음) */
    private void keepup(long now) throws Exception {
        List<Device> list;
        synchronized (this) { list = new ArrayList<>(devices); }
        for (Device d : list) {
            if (now - d.lastPacketMs > 60_000) continue; // 오래 안 보이면 그만 부름
            send(header(1, 0).array(), d.address);
        }
    }

    /** 연결된 트래커가 없을 때: 옛 펌웨어 호환용으로 서버 쪽에서도 알림 */
    private void discovery() {
        try {
            byte[] hb = header(0, 0).array();
            for (InetAddress a : broadcastAddresses()) send(hb, new InetSocketAddress(a, port));
        } catch (Exception ignored) { }
    }

    static List<InetAddress> broadcastAddresses() {
        List<InetAddress> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback() || ni.isPointToPoint()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress b = ia.getBroadcast();
                    if (b != null) out.add(b);
                }
            }
        } catch (Exception ignored) { }
        return out;
    }

    private void send(byte[] data, SocketAddress to) throws Exception {
        DatagramSocket s = socket;
        if (s == null || to == null) return;
        s.send(new DatagramPacket(data, data.length, to));
    }

    private static ByteBuffer header(int type, int extra) {
        ByteBuffer b = ByteBuffer.allocate(12 + extra).order(ByteOrder.BIG_ENDIAN);
        b.putInt(type);
        b.putLong(0); // 서버→트래커 패킷번호는 항상 0
        return b;
    }

    // ---------- 패킷 처리 ----------
    void handle(DatagramPacket p) throws Exception {
        if (p.getLength() < 4) return;
        ByteBuffer bb = ByteBuffer.wrap(p.getData(), p.getOffset(), p.getLength()).order(ByteOrder.BIG_ENDIAN);
        int type = bb.getInt();
        long number = bb.remaining() >= 8 ? bb.getLong() : 0;
        long now = System.currentTimeMillis();

        if (type == 3) { handshake(p, bb, now); return; }

        Device d;
        synchronized (this) { d = byAddress.get(p.getSocketAddress()); }
        if (d == null) return; // 핸드셰이크 전 데이터는 무시 (트래커가 곧 다시 핸드셰이크함)
        synchronized (this) {
            d.lastPacketMs = now;
            // 순서가 뒤바뀐(늦게 도착한) 패킷은 버림. 0은 번호 없는 패킷
            if (number != 0 && number <= d.lastPacketNumber) return;
            if (number != 0) d.lastPacketNumber = number;
        }
        if (type == 100) { // 묶음: [short 길이 + 패킷]...
            while (bb.remaining() >= 2) {
                int len = Math.min(bb.getShort() & 0xFFFF, bb.remaining());
                if (len == 0) continue;
                ByteBuffer inner = bb.slice().order(ByteOrder.BIG_ENDIAN);
                inner.limit(len);
                bb.position(bb.position() + len);
                if (len >= 4) packet(d, inner.getInt(), inner, p, now);
            }
            return;
        }
        if (type == 101) { // 압축 묶음: [byte 길이 + byte 종류 + 내용]...
            while (bb.remaining() >= 1) {
                int len = Math.min(bb.get() & 0xFF, bb.remaining());
                if (len == 0) continue;
                ByteBuffer inner = bb.slice().order(ByteOrder.BIG_ENDIAN);
                inner.limit(len);
                bb.position(bb.position() + len);
                packet(d, inner.get() & 0xFF, inner, p, now);
            }
            return;
        }
        packet(d, type, bb, p, now);
    }

    private void handshake(DatagramPacket p, ByteBuffer bb, long now) throws Exception {
        int board = 0, imu = 0, mcu = 0, proto = 0;
        String fw = "", mac = null;
        try {
            if (bb.remaining() > 3) board = bb.getInt();
            if (bb.remaining() > 3) imu = bb.getInt();
            if (bb.remaining() > 3) mcu = bb.getInt();
            if (bb.remaining() > 11) { bb.getInt(); bb.getInt(); bb.getInt(); }
            if (bb.remaining() > 3) proto = bb.getInt();
            if (bb.remaining() > 0) {
                int len = bb.get() & 0xFF;
                if (bb.remaining() >= len) {
                    byte[] s = new byte[len];
                    bb.get(s);
                    fw = new String(s, StandardCharsets.US_ASCII);
                }
            }
            if (bb.remaining() >= 6) {
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < 6; i++) {
                    if (i > 0) sb.append(':');
                    sb.append(String.format("%02X", bb.get() & 0xFF));
                }
                mac = sb.toString();
            }
        } catch (BufferUnderflowException ignored) { }
        SocketAddress addr = p.getSocketAddress();
        String ip = p.getAddress().getHostAddress();
        if (mac == null || mac.equals("00:00:00:00:00:00")) mac = ip;

        Device d;
        boolean isNew = false;
        synchronized (this) {
            d = byMac.get(mac);
            if (d == null) d = byAddress.get(addr);
            if (d == null) {
                d = new Device();
                d.mac = mac;
                devices.add(d);
                byMac.put(mac, d);
                isNew = true;
            }
            byAddress.values().remove(d);
            d.address = addr;
            d.ip = ip;
            byAddress.put(addr, d);
            d.boardType = board; d.mcuType = mcu; d.protocolVersion = proto; d.firmware = fw;
            d.lastPacketMs = now;
            d.lastPacketNumber = 0;
            // 프로토콜 9 미만 옛 펌웨어는 센서 정보 패킷을 안 보내므로 0번 센서를 바로 만든다
            if (proto < 9) d.sensor(0).imuType = imu;
        }
        byte[] reply = new byte[64];
        reply[0] = 3;
        byte[] hey = "Hey OVR =D 5".getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(hey, 0, reply, 1, hey.length);
        send(reply, addr);
        note((isNew ? "새 트래커 연결: " : "다시 연결: ") + mac + " (" + ip + ", 펌웨어 " + fw + ")");
    }

    private void packet(Device d, int type, ByteBuffer b, DatagramPacket p, long now) throws Exception {
        try {
            switch (type) {
                case 1: rotation(d, 0, b.getFloat(), b.getFloat(), b.getFloat(), b.getFloat(), now); break;
                case 16: rotation(d, 1, b.getFloat(), b.getFloat(), b.getFloat(), b.getFloat(), now); break;
                case 17: {
                    int sid = b.get() & 0xFF;
                    int dataType = b.get() & 0xFF;
                    float x = b.getFloat(), y = b.getFloat(), z = b.getFloat(), w = b.getFloat();
                    if (dataType == 1) rotation(d, sid, x, y, z, w, now); // 2 = 지자기 보정용, 안 씀
                    break;
                }
                case 23: { // Q15 정수 쿼터니언 + 가속도
                    int sid = b.get() & 0xFF;
                    float k = 1f / (1 << 15);
                    float x = b.getShort() * k, y = b.getShort() * k, z = b.getShort() * k, w = b.getShort() * k;
                    rotation(d, sid, x, y, z, w, now);
                    break;
                }
                case 12: {
                    synchronized (this) {
                        if (b.remaining() >= 8) { d.batteryVoltage = b.getFloat(); d.battery = b.getFloat(); }
                        else if (b.remaining() >= 4) d.battery = b.getFloat();
                    }
                    break;
                }
                case 15: { // 센서 정보 → 받았다고 답해줘야 1초마다 다시 안 보냄
                    int sid = b.get() & 0xFF;
                    int status = b.get() & 0xFF;
                    int imu = b.remaining() > 0 ? b.get() & 0xFF : 0;
                    if (b.remaining() > 1) b.getShort();          // 센서 설정
                    if (b.remaining() > 0) b.get();               // 정지 보정 완료 여부
                    int pos = b.remaining() > 0 ? b.get() & 0xFF : 0;
                    int dataType = b.remaining() > 0 ? b.get() & 0xFF : 0;
                    synchronized (this) {
                        if (dataType == 0) { // 회전 센서만 (손가락 굽힘 센서 등은 무시)
                            Sensor s = d.sensor(sid);
                            s.status = status; s.imuType = imu; s.position = pos;
                        }
                    }
                    ByteBuffer ack = ByteBuffer.allocate(6).order(ByteOrder.BIG_ENDIAN);
                    ack.putInt(15); ack.put((byte) sid); ack.put((byte) status);
                    send(ack.array(), d.address);
                    break;
                }
                case 19: { b.get(); synchronized (this) { d.rssi = b.get(); } break; }
                case 10: { // 핑 → 그대로 돌려줄 필요 없음 (서버가 보낸 것의 답)
                    break;
                }
                default: break; // 0 하트비트, 4 가속도, 22 기능 플래그 등
            }
        } catch (BufferUnderflowException ignored) { }
    }

    private synchronized void rotation(Device d, int sid, float x, float y, float z, float w, long now) {
        if (Float.isNaN(x) || Float.isNaN(y) || Float.isNaN(z) || Float.isNaN(w)) return;
        if (x == 0 && y == 0 && z == 0 && w == 0) return;
        Sensor s = d.sensor(sid);
        s.x = x; s.y = y; s.z = z; s.w = w;
        s.hasRotation = true;
        s.lastRotationMs = now;
        s.rotationCount++;
    }

    // ---------- JSON (플러그인 없이도 쓰도록 직접 만듦) ----------
    public String toJson() {
        long now = System.currentTimeMillis();
        StringBuilder sb = new StringBuilder("{\"running\":").append(running);
        if (error != null) sb.append(",\"error\":").append(q(error));
        sb.append(",\"trackers\":[");
        boolean first = true;
        synchronized (this) {
            for (Device d : devices) {
                for (Sensor s : d.sensors.values()) {
                    if (!first) sb.append(',');
                    first = false;
                    sb.append("{\"id\":").append(q(s.id))
                      .append(",\"mac\":").append(q(d.mac))
                      .append(",\"ip\":").append(q(d.ip))
                      .append(",\"sensor\":").append(s.sensorId)
                      .append(",\"fw\":").append(q(d.firmware))
                      .append(",\"connected\":").append(d.connected(now))
                      .append(",\"hasRot\":").append(s.hasRotation)
                      .append(",\"age\":").append(s.lastRotationMs == 0 ? -1 : now - s.lastRotationMs)
                      .append(",\"q\":[").append(s.x).append(',').append(s.y).append(',').append(s.z).append(',').append(s.w).append(']')
                      .append(",\"count\":").append(s.rotationCount)
                      .append(",\"battery\":").append(d.battery)
                      .append(",\"rssi\":").append(d.rssi)
                      .append(",\"position\":").append(s.position)
                      .append(",\"status\":").append(s.status)
                      .append('}');
                }
            }
        }
        sb.append("]}");
        return sb.toString();
    }

    private static String q(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') sb.append('\\').append(c);
            else if (c < 0x20) sb.append(' ');
            else sb.append(c);
        }
        return sb.append('"').toString();
    }
}
