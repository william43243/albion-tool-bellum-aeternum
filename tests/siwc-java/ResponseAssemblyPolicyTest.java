import com.albion.market.siwc.ResponseAssemblyPolicy;
import java.io.IOException;
import java.util.*;
public class ResponseAssemblyPolicyTest {
 interface Check{void run()throws Exception;}
 static void fails(String code,Check c)throws Exception{try{c.run();throw new AssertionError(code);}catch(IOException e){if(!code.equals(e.getMessage()))throw e;}}
 public static void main(String[]args)throws Exception{
  ResponseAssemblyPolicy.requireOutputShape(null,false);
  ResponseAssemblyPolicy.requireOutputShape(List.of(),true);
  fails("STREAM_OUTPUT_INVALID",()->ResponseAssemblyPolicy.requireOutputShape(Map.of(),false));
  fails("STREAM_OUTPUT_INVALID",()->ResponseAssemblyPolicy.requireOutputShape("[]",false));
  fails("STREAM_TEXT_CONFLICT",()->ResponseAssemblyPolicy.missingText("partial",true,"",false));
  fails("MODEL_REFUSAL",()->ResponseAssemblyPolicy.missingText("partial",true,"",true));
  fails("MODEL_REFUSAL",()->ResponseAssemblyPolicy.missingText("",true,"",true));
  fails("STREAM_FINAL_MESSAGE_MISSING",()->ResponseAssemblyPolicy.missingText("partial",false,"",false));
  fails("EMPTY_MODEL_RESPONSE",()->ResponseAssemblyPolicy.missingText("",true,"",false));
  if(!"complete".equals(ResponseAssemblyPolicy.missingText("",true,"complete",false)))throw new AssertionError("lost final text");
  if(!"".equals(ResponseAssemblyPolicy.missingText("complete",true,"complete",false)))throw new AssertionError("duplicated text");
  System.out.println("Production response shape, final/absent/empty text, refusal priority and no-duplication tests passed");
 }
}
