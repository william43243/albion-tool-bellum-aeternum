import com.albion.market.litert.WorldRouteGraph;
import com.nimbusds.jose.util.JSONObjectUtils;
import java.nio.file.*;
import java.util.*;
public class WorldRouteGraphTest {
 static WorldRouteGraph.Zone z(String id,String risk,String...exits){return new WorldRouteGraph.Zone(id,id,risk,Arrays.asList(exits));}
 public static void main(String[]args)throws Exception{
  WorldRouteGraph g=new WorldRouteGraph(Arrays.asList(z("A","city","R","B"),z("R","red","Z"),z("B","blue","C","A"),z("C","yellow","Z"),z("Z","city")));
  if(!g.route("A","Z","fewest_transitions").equals(Arrays.asList("A","R","Z")))throw new AssertionError("short route");
  if(!g.route("A","Z","fewest_lethal").equals(Arrays.asList("A","B","C","Z")))throw new AssertionError("lethal avoidance");
  if(!g.route("Z","A","fewest_transitions").isEmpty())throw new AssertionError("reverse edge invented");
  if(g.route("A","A","fewest_transitions").size()!=1)throw new AssertionError("same-zone");
  try{g.route("A","X","fewest_transitions");throw new AssertionError("unknown accepted");}catch(IllegalArgumentException expected){}
  WorldRouteGraph unknown=new WorldRouteGraph(Arrays.asList(z("A","city","U","B"),z("U","unknown","Z"),z("B","blue","C"),z("C","yellow","Z"),z("Z","city")));
  if(unknown.route("A","Z","fewest_lethal").contains("U"))throw new AssertionError("unknown considered safe");
  Map<String,Object> data=JSONObjectUtils.parse(Files.readString(Path.of("android/app/src/main/assets/world-map.local.json")));
  List<WorldRouteGraph.Zone> list=new ArrayList<>();
  for(Object obj:(List<?>)data.get("zones")){Map<?,?> row=(Map<?,?>)obj;List<String> exits=new ArrayList<>();for(Object e:(List<?>)row.get("exits"))exits.add((String)e);list.add(new WorldRouteGraph.Zone((String)row.get("id"),(String)row.get("name"),(String)row.get("risk"),exits));}
  WorldRouteGraph real=new WorldRouteGraph(list);List<String> path=real.route("3003","3004","fewest_transitions");
  if(!path.equals(Arrays.asList("3003","2203","3202","3245","3205","3204","3004")))throw new AssertionError("native/UI deterministic parity");
  if(path.stream().filter(id->real.zones.get(id).risk.equals("red")).count()!=3)throw new AssertionError("red count");
  for(int i=1;i<path.size();i++)if(!real.zones.get(path.get(i-1)).exits.contains(path.get(i)))throw new AssertionError("invented edge");
  System.out.println("World route policies, unknown risk, directed edges, cycles and real dataset parity passed");
 }
}
