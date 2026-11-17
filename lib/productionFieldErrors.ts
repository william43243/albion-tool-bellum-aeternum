import {parseUserNumber,type NumberLocale} from './numberParsing';

type DraftFields={label:string;quantity:string;output:string;outputPrice:string;returnPercent:string;stationFee:string;focus:string;taxPercent:string;orderPercent:string;budget:string;availableFocus:string;volume:string;days:string;materials:{itemId:string;amount:string;price:string;returnable:boolean|null}[];metadata:{recipe?:{silverCost:number|null}}};

/** Classify field-level input errors for navigation; the engine remains authoritative. */
export function invalidProductionSections(d:DraftFields,locale:NumberLocale):{basics:boolean;materials:boolean;params:boolean} {
 const valid=(text:string,integer=false,min=0,max=Number.MAX_SAFE_INTEGER,exclusiveMax=false)=>{const p=parseUserNumber(text,integer,locale);return p.valid&&p.value>=min&&(exclusiveMax?p.value<max:p.value<=max);};
 const optional=(text:string,min=0)=>!text.trim()||valid(text,false,min);
 const basics=!d.label.trim()||d.label.trim().length>120||!valid(d.quantity,true,1,1_000_000)||!valid(d.output,true,1,1_000_000)||!valid(d.outputPrice,false,Number.MIN_VALUE);
 const ids=new Set<string>();
 const materials=d.materials.length<1||d.materials.length>64||d.materials.some(m=>{const id=m.itemId.trim();const bad=!id||id.length>128||ids.has(id)||!valid(m.amount,false,Number.MIN_VALUE)||!valid(m.price,false,Number.MIN_VALUE)||m.returnable===null;ids.add(id);return bad;});
 const fixedCost=d.metadata.recipe?.silverCost;
 const station=parseUserNumber(d.stationFee,false,locale);
 const params=!valid(d.returnPercent,false,0,100,true)||!valid(d.stationFee)||!valid(d.focus)||!valid(d.taxPercent,false,0,100)||!valid(d.orderPercent,false,0,100)||!optional(d.budget)||!optional(d.availableFocus)||!optional(d.volume)||!optional(d.days,Number.MIN_VALUE)||Boolean(d.volume.trim())!==Boolean(d.days.trim())||(fixedCost!==null&&fixedCost!==undefined&&station.valid&&station.value<fixedCost);
 return {basics,materials,params};
}
