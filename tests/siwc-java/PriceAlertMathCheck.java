import com.albion.market.alerts.PriceAlertMath;
import java.util.TimeZone;
public class PriceAlertMathCheck {
 public static void main(String[] x) {
  TimeZone z=TimeZone.getTimeZone("UTC"); long n=java.time.Instant.parse("2026-11-06T12:00:00Z").toEpochMilli();
  check(PriceAlertMath.eligible(n,n-60000,999,1000,30,"le",z));
  check(PriceAlertMath.eligible(n,n-60000,1000,1000,30,"le",z));
  check(!PriceAlertMath.eligible(n,n-60000,1001,1000,30,"le",z));
  check(PriceAlertMath.eligible(n,n-60000,1001,1000,0,"ge",z));
  check(!PriceAlertMath.eligible(n,n-60000,999,1000,0,"eq",z));
  check(PriceAlertMath.eligible(n,n-60000,1000,1000,0,"eq",z));
  check(!PriceAlertMath.eligible(n,n-31*60000,999,1000,30,"le",z));
  check(!PriceAlertMath.eligible(n,n-13*3600000L,999,1000,0,"le",z));
  check(!PriceAlertMath.eligible(n,n+1,999,1000,0,"le",z));
  check(!PriceAlertMath.eligible(n,n-60000,999,1000,0,"invalid",z));
  System.out.println("10 price alert checks passed");
 }
 static void check(boolean b){if(!b)throw new AssertionError();}
}
