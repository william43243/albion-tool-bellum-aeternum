import com.albion.market.network.BoundedRead;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Arrays;

public class BoundedReadTest {
    public static void main(String[] args) throws Exception {
        byte[] data = new byte[8193];
        Arrays.fill(data, (byte) 7);
        if (!Arrays.equals(data, BoundedRead.read(new ByteArrayInputStream(data), data.length))) throw new AssertionError("exact limit");
        try { BoundedRead.read(new ByteArrayInputStream(data), data.length - 1); throw new AssertionError("oversize accepted"); }
        catch (IOException expected) { if (!"MARKET_RESPONSE_TOO_LARGE".equals(expected.getMessage())) throw expected; }
        if (BoundedRead.read(new ByteArrayInputStream(new byte[0]), 0).length != 0) throw new AssertionError("empty response");
        System.out.println("Bounded market response exact limit and oversize tests passed");
    }
}
