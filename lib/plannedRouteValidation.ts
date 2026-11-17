/** A planner route is drawable only when every directed edge exists locally. */
export function isDrawablePlannedRoute(ids: readonly string[], graph: ReadonlyMap<string, {exits: readonly string[]}>): boolean {
 return ids.length>0 && ids.every((id,index)=>graph.has(id) && (index===0 || !!graph.get(ids[index-1])?.exits.includes(id)));
}
