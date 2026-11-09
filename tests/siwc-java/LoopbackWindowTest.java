import com.albion.market.siwc.LoopbackWindow;
public final class LoopbackWindowTest {
 static int count; static void ok(boolean value,String label){if(!value)throw new AssertionError(label);count++;System.out.println("PASS "+label);}
 static void invalid(long a,long b,long c){try{new LoopbackWindow(a,b,c);throw new AssertionError("accepted invalid window");}catch(IllegalArgumentException expected){count++;}}
 public static void main(String[] args){
  LoopbackWindow w=new LoopbackWindow(1000,20000,10000);
  ok(w.phase(1000)==0,"waiting at start");
  ok(w.phase(20999)==0,"waiting before exact deadline");
  ok(w.phase(21000)==1,"expired exactly at deadline");
  ok(w.phase(30999)==1,"late-return grace retained");
  ok(w.phase(31000)==2,"closed exactly at grace end");
  ok(w.remaining(1000)==20000,"full countdown");
  ok(w.remaining(21000)==0,"zero countdown at deadline");
  ok(w.remaining(40000)==0,"no negative countdown");
  ok(w.label(22000).equals("EXPIRED"),"explicit expired health phase");
  ok(new LoopbackWindow(0,1,0).phase(1)==2,"zero grace closes");
  invalid(-1,1,1);invalid(0,0,1);invalid(0,1,-1);invalid(Long.MAX_VALUE-1,2,0);invalid(0,Long.MAX_VALUE,1);
  ok(LoopbackWindow.WORK_MS>LoopbackWindow.AUTHORIZATION_MS+LoopbackWindow.GRACE_MS,"service cap covers expiry grace");
  System.out.println("ALL "+count+" LOOPBACK WINDOW TESTS PASSED; synthetic monotonic time only");
 }
}
