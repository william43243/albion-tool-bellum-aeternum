import com.albion.market.siwc.AuthAttemptGate;
public class AuthAttemptGateTest {
 public static void main(String[] args){AuthAttemptGate g=new AuthAttemptGate();long a=g.reserve();
 try{g.reserve();throw new AssertionError("duplicate start");}catch(IllegalStateException expected){}
 g.cancel();if(g.isCurrent(a)||g.active())throw new AssertionError("cancel before service");
 long b=g.reserve();g.complete(a);if(!g.isCurrent(b))throw new AssertionError("stale completion");g.complete(b);if(g.active())throw new AssertionError("completed");System.out.println("Auth generation fence tests passed");}
}
