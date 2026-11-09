package com.albion.market.siwc;
import java.io.IOException;
/** Platform-independent decisions used by the Android stream assembler. */
public final class ResponseAssemblyPolicy {
 private ResponseAssemblyPolicy(){}
 public static void requireOutputShape(Object value,boolean array)throws IOException {
  if(value!=null && !array)throw new IOException("STREAM_OUTPUT_INVALID");
 }
 public static void requireNoRefusal(boolean refusal)throws IOException {
  if(refusal)throw new IOException("MODEL_REFUSAL");
 }
 /** Returns only the final text missing from a stream that emitted no text. */
 public static String missingText(String streamed,boolean finalPresent,String finalized,boolean refusal)throws IOException {
  requireNoRefusal(refusal);
  if(!finalPresent)throw new IOException("STREAM_FINAL_MESSAGE_MISSING");
  if(!streamed.isEmpty() && !streamed.equals(finalized))throw new IOException("STREAM_TEXT_CONFLICT");
  if(finalized.trim().isEmpty())throw new IOException("EMPTY_MODEL_RESPONSE");
  return streamed.isEmpty()?finalized:"";
 }
}
