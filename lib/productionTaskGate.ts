/** Prevent a delayed result from overwriting newer form/server state. */
export function createProductionTaskGate() {
 let revision=0, controller:AbortController|null=null;
 const invalidate=()=>{revision++;controller?.abort();controller=null;};
 return {
  invalidate,
  begin(){invalidate();const ticket=revision;const current=new AbortController();controller=current;
   return {signal:current.signal,isCurrent:()=>ticket===revision,finish:()=>{if(ticket===revision)controller=null;}};
  },
  cancel(){controller?.abort();},
 };
}
