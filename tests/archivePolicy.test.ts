import test from 'node:test';
import assert from 'node:assert/strict';
import {ARCHIVE_INDEX,ARCHIVE_RETENTION_MS,archiveIsExpired,archiveSourceKind,selectDailyArchives} from '../lib/archivePolicy';
test('archive source follows selected game server',()=>{
 assert.equal(ARCHIVE_INDEX.americas,'https://www.albion-online-data.com/database/');
 assert.equal(ARCHIVE_INDEX.europe,'https://www.albion-online-data.com/database-europe/');
 assert.equal(ARCHIVE_INDEX.asia,'https://www.albion-online-data.com/database-east/');
});
test('retention boundary and weekly source stay explicit',()=>{
 const t=1000000;
 assert.equal(archiveIsExpired(t,t+ARCHIVE_RETENTION_MS-1),false);
 assert.equal(archiveIsExpired(t,t+ARCHIVE_RETENTION_MS),true);
 assert.equal(archiveIsExpired(t,t-1),false);
 assert.equal(archiveSourceKind('weekly'),'daily_backup');
 assert.equal(archiveSourceKind('monthly'),'monthly_history');
});

test('today and yesterday select only existing region-specific names, across month boundaries',()=>{
 const html='db_backup_2026-11-01T03_01_31.tgz db_backup_2026-10-31T03_01_38.tgz';
 const r=selectDailyArchives('europe',html,new Date(2026,10,1,12));
 assert.deepEqual(r.available.map(a=>a.date),['2026-11-01','2026-10-31']);
 assert.ok(r.available.every(a=>a.url.startsWith(ARCHIVE_INDEX.europe)));
 const missing=selectDailyArchives('asia','db_backup_2026-10-31T03_01_38.tgz',new Date(2026,10,1,12));
 assert.deepEqual(missing.missing,['2026-11-01']);
});
