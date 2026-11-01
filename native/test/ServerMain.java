// PC 테스트용: java ServerMain <초>  → 1초마다 상태 JSON 출력
import com.posturecoach.app.SlimeServer;

public class ServerMain {
    public static void main(String[] a) throws Exception {
        SlimeServer s = new SlimeServer();
        s.start();
        int sec = a.length > 0 ? Integer.parseInt(a[0]) : 10;
        for (int i = 0; i < sec; i++) {
            Thread.sleep(1000);
            for (String l : s.takeLog()) System.out.println("LOG " + l);
            System.out.println("STATE " + s.toJson());
        }
        s.stop();
    }
}
