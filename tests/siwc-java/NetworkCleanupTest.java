import com.albion.market.siwc.NetworkCleanup;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

public class NetworkCleanupTest {
 public static void main(String[] args)throws Exception{
  CountDownLatch returned=new CountDownLatch(1),started=new CountDownLatch(1),release=new CountDownLatch(1),finished=new CountDownLatch(1);
  AtomicReference<Thread> actual=new AtomicReference<>();
  Thread caller=new Thread(()->{
   NetworkCleanup.execute(()->{actual.set(Thread.currentThread());started.countDown();try{release.await();}catch(InterruptedException e){Thread.currentThread().interrupt();}finally{finished.countDown();}});
   returned.countDown();
  },"simulated-ui-caller");
  caller.start();
  try{
   if(!returned.await(3,TimeUnit.SECONDS))throw new AssertionError("teardown blocked caller thread");
   if(!started.await(3,TimeUnit.SECONDS))throw new AssertionError("cleanup did not start");
   if(actual.get()==caller||!actual.get().getName().startsWith("albion-network-cleanup-"))throw new AssertionError("network teardown on caller thread");
   if(finished.getCount()!=1)throw new AssertionError("blocking close was not deferred");
  }finally{release.countDown();caller.join(3000);}
  if(!finished.await(3,TimeUnit.SECONDS))throw new AssertionError("cleanup did not finish");
  CountDownLatch recovered=new CountDownLatch(1);NetworkCleanup.execute(()->{throw new IllegalStateException("synthetic close failure");});NetworkCleanup.execute(recovered::countDown);
  if(!recovered.await(3,TimeUnit.SECONDS))throw new AssertionError("cleanup worker unavailable after close failure");
  System.out.println("Network cleanup thread isolation, nonblocking dispatch and failure recovery passed");
 }
}
