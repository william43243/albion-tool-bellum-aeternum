import com.albion.market.siwc.SseReader;
import java.io.*;
public class SseReaderTest {
 public static void main(String[] args)throws Exception{
  SseReader p=new SseReader(new StringReader(": ping\r\nevent: test\r\ndata: one\r\ndata:two\r\n\r\ndata: [DONE]\n\n"),1000);
  if(!"one\ntwo".equals(p.nextEvent())||!"[DONE]".equals(p.nextEvent())||p.nextEvent()!=null)throw new AssertionError("SSE multiline/CRLF");
  if(!"tail".equals(new SseReader(new StringReader("data: tail"),100).nextEvent()))throw new AssertionError("EOF");
  try{new SseReader(new StringReader("data: over limit\n\n"),4).nextEvent();throw new AssertionError("unbounded");}catch(IOException expected){}
  System.out.println("SSE parser tests passed");
 }
}
