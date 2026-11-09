package com.albion.market.siwc;
import java.io.IOException;
import java.util.*;
/** Retains final output_item.done items, never argument deltas. Completion is required. */
public final class OutputItemCollector<T> {
 private final java.util.function.BiPredicate<T,T> same, identical;
 private final java.util.function.BiFunction<T,T,T> merge;
 public OutputItemCollector(){this(Objects::equals,Objects::equals,(a,b)->b);}
 public OutputItemCollector(java.util.function.BiPredicate<T,T> identical,java.util.function.BiPredicate<T,T> same,java.util.function.BiFunction<T,T,T> merge){this.identical=identical;this.same=same;this.merge=merge;}
 private final TreeMap<Integer,T> items=new TreeMap<>();
 private final Map<Integer,String> identities=new HashMap<>();
 private final Set<String> ids=new HashSet<>();
 public void add(int index,String id,T item) throws IOException {
  if(index<0 || index>=128 || id==null || id.isEmpty() || id.length()>200 || item==null)throw new IOException("STREAM_ITEM_INVALID");
  if(items.containsKey(index)){if(id.equals(identities.get(index)) && identical.test(items.get(index),item))return;throw new IOException("STREAM_ITEM_DUPLICATE");}
  if(ids.contains(id))throw new IOException("STREAM_ITEM_DUPLICATE");
  items.put(index,item);identities.put(index,id);ids.add(id);
 }
 public List<T> resolve(boolean completed,List<T> terminal,List<String> terminalIds) throws IOException {
  if(!completed)throw new IOException("STREAM_NOT_COMPLETED");
  if(terminal.size()!=terminalIds.size() || terminal.size()>128)throw new IOException("STREAM_ITEM_INVALID");
  if(!terminal.isEmpty()){
   if(new HashSet<>(terminalIds).size()!=terminalIds.size())throw new IOException("STREAM_ITEM_DUPLICATE");
   for(Map.Entry<Integer,String> e:identities.entrySet())
    if(e.getKey()>=terminalIds.size() || !e.getValue().equals(terminalIds.get(e.getKey())) || !same.test(items.get(e.getKey()),terminal.get(e.getKey())))throw new IOException("STREAM_OUTPUT_CONFLICT");
   List<T> result=new ArrayList<>(terminal);
   for(Map.Entry<Integer,T> e:items.entrySet())result.set(e.getKey(),merge.apply(e.getValue(),result.get(e.getKey())));
   return result;
  }
  int expected=0;for(int index:items.keySet())if(index!=expected++)throw new IOException("STREAM_ITEM_GAP");
  return new ArrayList<>(items.values());
 }
}
