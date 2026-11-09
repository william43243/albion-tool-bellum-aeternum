import type { Server } from './api';

/** Public AODP archive indexes; never select a region independently of app settings. */
export const ARCHIVE_INDEX: Record<Server,string> = {
  americas:'https://www.albion-online-data.com/database/',
  europe:'https://www.albion-online-data.com/database-europe/',
  asia:'https://www.albion-online-data.com/database-east/',
};
export const ARCHIVE_RETENTION_MS=7*24*60*60*1000;
export type ArchivePeriod='daily'|'weekly'|'monthly';
/** Weekly is a query period of available observations, not a claimed weekly archive. */
export function archiveSourceKind(period:ArchivePeriod):'daily_backup'|'monthly_history' {
 return period==='monthly'?'monthly_history':'daily_backup';
}
export function archiveIsExpired(downloadedAt:number,now:number):boolean {
 if(!Number.isFinite(downloadedAt)||!Number.isFinite(now)||downloadedAt<0||now<downloadedAt)return false;
 return now-downloadedAt>=ARCHIVE_RETENTION_MS;
}

export interface DailyArchive { date: string; name: string; url: string }
/** Select only real matching archive names, never infer a download URL from missing dates. */
export function selectDailyArchives(server:Server,indexHtml:string,now:Date):{available:DailyArchive[];missing:string[]} {
 if(!Number.isFinite(now.getTime()))throw new Error('Invalid date');
 const stamp=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 const yesterday=new Date(now.getFullYear(),now.getMonth(),now.getDate()-1);
 const requested=[stamp(now),stamp(yesterday)];
 const names=[...new Set(indexHtml.match(/db_backup_\d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}\.tgz/g)||[])];
 const available:DailyArchive[]=[],missing:string[]=[];
 for(const date of requested){
  const name=names.filter(n=>n.startsWith(`db_backup_${date}T`)).sort().at(-1);
  if(name)available.push({date,name,url:ARCHIVE_INDEX[server]+name});else missing.push(date);
 }
 return {available,missing};
}
