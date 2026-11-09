package com.albion.market.siwc;
import java.io.IOException;
import java.util.HashSet;
/** Production terminal and tool-call execution guard. */
public final class InferenceGuard {
 private boolean completed; private int rounds; private final HashSet<String> calls=new HashSet<>();
 public void beginRound()throws IOException{completed=false;if(++rounds>8)throw new IOException("TOOL_ROUND_LIMIT");}
 public void markCompleted(){completed=true;}
 public void requireCompleted()throws IOException{if(!completed)throw new IOException("STREAM_NOT_COMPLETED");}
 public static String safeOutputType(String type){
  if(type==null)return "unknown";
  switch(type){case "message":case "reasoning":case "function_call":case "custom_tool_call":case "web_search_call":case "file_search_call":case "computer_call":case "code_interpreter_call":case "tool_search_call":case "namespace":return type;default:return "unknown";}
 }
 public static String emptyAnswerCode(int refusalCount){return refusalCount>0?"MODEL_REFUSAL":"EMPTY_MODEL_RESPONSE";}
 public void requireVisibleAnswer(String text)throws IOException{if(text==null||text.trim().isEmpty())throw new IOException("EMPTY_MODEL_RESPONSE");}
 public void validateOutputType(String type)throws IOException{if(!"message".equals(type)&&!"reasoning".equals(type)&&!"function_call".equals(type))throw new IOException("UNSUPPORTED_OUTPUT_TYPE");}
 public void claimTool(String id)throws IOException{if(id==null||id.isEmpty())throw new IOException("INVALID_TOOL_CALL_ID");if(!calls.add(id))throw new IOException("DUPLICATE_TOOL_CALL");if(calls.size()>16)throw new IOException("TOOL_CALL_LIMIT");}
}
