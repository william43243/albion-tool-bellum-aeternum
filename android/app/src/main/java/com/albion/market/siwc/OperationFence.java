package com.albion.market.siwc;
import java.io.IOException;
/** Serializes cancellation with credential commits. No commit may start after cancel. */
public final class OperationFence {
 public interface Action {void run()throws Exception;}
 private boolean cancelled;
 public synchronized void cancel(){cancelled=true;}
 public synchronized void commit(Action action)throws Exception{if(cancelled)throw new IOException("OPERATION_CANCELLED");action.run();}
}
