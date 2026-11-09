import com.albion.market.siwc.*;
import com.albion.market.litert.MarketNumeric;
public class ProductionGuardsTest {
 interface Checked {void run()throws Exception;}
 static void rejects(Checked action)throws Exception{try{action.run();throw new AssertionError("accepted invalid state");}catch(java.io.IOException|IllegalArgumentException expected){}}
 public static void main(String[] args)throws Exception{
  InferenceGuard g=new InferenceGuard();g.beginRound();rejects(()->g.requireCompleted());g.markCompleted();g.requireCompleted();g.claimTool("one");rejects(()->g.claimTool("one"));g.beginRound();rejects(()->g.requireCompleted());
  rejects(()->g.requireVisibleAnswer(""));rejects(()->g.requireVisibleAnswer("  "));g.requireVisibleAnswer("actual answer");
  g.validateOutputType("message");g.validateOutputType("reasoning");g.validateOutputType("function_call");rejects(()->g.validateOutputType("namespace"));rejects(()->g.validateOutputType("custom_tool_call"));
  if(!"unknown".equals(InferenceGuard.safeOutputType("token_like_arbitrary_content"))||!"function_call".equals(InferenceGuard.safeOutputType("function_call")))throw new AssertionError("unsafe output type diagnostic");
  if(!"MODEL_REFUSAL".equals(InferenceGuard.emptyAnswerCode(1))||!"EMPTY_MODEL_RESPONSE".equals(InferenceGuard.emptyAnswerCode(0)))throw new AssertionError("refusal classification");
  OperationFence f=new OperationFence();final int[] saves={0};f.commit(()->saves[0]++);f.cancel();rejects(()->f.commit(()->saves[0]++));if(saves[0]!=1)throw new AssertionError("save after cancel");
  if(!RefreshPolicy.discardAfterFailure(true,"HTTP_503")||RefreshPolicy.discardAfterFailure(false,"HTTP_503")||!RefreshPolicy.discardAfterFailure(false,"invalid_grant"))throw new AssertionError("refresh recovery");
  if(MarketNumeric.weightedAverage(100,0)!=null||MarketNumeric.weightedAverage(100,3)!=33)throw new AssertionError("invented average");
  rejects(()->MarketNumeric.exactLong(1.5));rejects(()->MarketNumeric.exactLong("123"));if(MarketNumeric.exactLong(123L)!=123)throw new AssertionError("exact integer");
  System.out.println("Production terminal, call deduplication, cancel/save, refresh recovery and market numeric tests passed");
 }
}
