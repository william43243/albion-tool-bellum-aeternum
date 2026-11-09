package com.albion.market.litert;
import java.util.*;

/** Directed static exits. No distance, travel time, kill activity or safety claims. */
public final class WorldRouteGraph {
 public static final class Zone {
  public final String id,name,risk; public final List<String> exits;
  public Zone(String id,String name,String risk,List<String> exits){this.id=id;this.name=name;this.risk=risk;this.exits=new ArrayList<>(exits);}
 }
 public final Map<String,Zone> zones=new TreeMap<>();
 public WorldRouteGraph(List<Zone> values){for(Zone z:values){if(zones.put(z.id,z)!=null)throw new IllegalArgumentException("Duplicate zone");}}
 public List<String> route(String from,String to,String policy){
  if(!policy.equals("fewest_transitions")&&!policy.equals("fewest_lethal"))throw new IllegalArgumentException("Unknown route policy");
  if(!zones.containsKey(from)||!zones.containsKey(to))throw new IllegalArgumentException("Unknown zone");
  Map<String,int[]> costs=new HashMap<>(); Map<String,String> previous=new HashMap<>();Set<String> pending=new HashSet<>();
  costs.put(from,new int[]{0,0});pending.add(from);
  while(!pending.isEmpty()){
   String current=Collections.min(pending,(a,b)->{int[]x=costs.get(a),y=costs.get(b);int c=Integer.compare(x[0],y[0]);if(c==0)c=Integer.compare(x[1],y[1]);return c==0?a.compareTo(b):c;});
   pending.remove(current);if(current.equals(to))break;
   List<String> exits=new ArrayList<>(zones.get(current).exits);Collections.sort(exits);
   for(String id:exits){Zone z=zones.get(id);if(z==null)continue;int hazard=z.risk.equals("red")||z.risk.equals("black")||z.risk.equals("unknown")?1:0;
    int[] old=costs.get(id),prior=costs.get(current),next=policy.equals("fewest_lethal")?new int[]{prior[0]+hazard,prior[1]+1}:new int[]{prior[0]+1,prior[1]+hazard};
    if(old==null||next[0]<old[0]||(next[0]==old[0]&&next[1]<old[1])){costs.put(id,next);previous.put(id,current);pending.add(id);}
   }
  }
  if(!costs.containsKey(to))return Collections.emptyList();
  LinkedList<String> result=new LinkedList<>();result.add(to);while(!result.getFirst().equals(from))result.addFirst(previous.get(result.getFirst()));return result;
 }
}
