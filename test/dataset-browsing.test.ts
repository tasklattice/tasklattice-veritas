import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildRowIndex,readRowPage} from '../src/server/dataset-viewer.js';
import {filterDatasets,type DatasetFilters} from '../web/dataset-filters.js';
import {DatasetViewer} from '../src/server/dataset-viewer.js';
import {catalog} from '../src/core/datasets.js';
import type {DatasetCard} from '../src/shared/types.js';

test('Dataset browser sorting and label filters operate on the full source; statistics remain full-scope',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'veritas-browse-')),file=join(dir,'rows.jsonl'),db=join(dir,'index.sqlite');
 const records=[{id:10,label:'safe',text:'A'},{id:2,label:'unsafe',text:'BBB'},{id:3,label:'safe',text:'CC'},{id:4,label:null,text:null},{id:5,label:'safe',text:'DDDD'}, {id:6,label:'unsafe'}];
 try{
  writeFileSync(file,records.map(r=>JSON.stringify(r)).join('\n'));await buildRowIndex(db,[file]);
  const first=readRowPage(db,{limit:'2'}),label=first.columns.find(c=>c.name==='label')!;
  assert.equal(label.stats!.count,5);assert.equal(label.stats!.missing,1);assert.deepEqual(label.stats!.values,[{value:'"safe"',count:3},{value:'"unsafe"',count:2}]);
  assert.equal(first.columns.find(c=>c.name==='text')!.stats!.missing,2);
  assert.deepEqual(readRowPage(db,{sort:'id',order:'asc',limit:'2',offset:'1'}).items.map(r=>r.index),[2,3]);
  assert.deepEqual(readRowPage(db,{sort:'id',order:'desc',limit:'2'}).items.map(r=>r.index),[0,5]);
  const filtered=readRowPage(db,{column:'label',value:'"safe"',sort:'id',order:'asc'});assert.equal(filtered.total,3);assert.equal(filtered.allTotal,6);assert.deepEqual(filtered.items.map(r=>r.index),[2,4,0]);assert.deepEqual(filtered.columns,first.columns);
  assert.deepEqual(readRowPage(db,{column:'label',value:'null'}).items.map(r=>r.index),[3]);
  assert.equal(readRowPage(db,{column:'label',value:'"unsafe"',search:'BBB'}).total,1);
  assert.equal(readRowPage(db,{column:'label',value:'"\' OR 1=1 --"'}).total,0);
  for(const q of [{sort:'not_a_column'},{order:'DROP TABLE records'},{column:'label'},{column:'label',value:'not json'},{column:'not_a_column',value:'null'}])assert.throws(()=>readRowPage(db,q));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('Catalog facets use OR within a group, AND across groups and clear to all original sources',()=>{
 const card=(id:string,source:string,rawAvailable:boolean)=>({id,name:id,repository:'publisher/'+id,publisher:'publisher',description:'original benchmark',source,rawAvailable}) as DatasetCard;
 const cards=[card('aegis','hf',true),card('moderation','github',true),card('wildjailbreak','hf',false)],empty:DatasetFilters={search:'',category:[],source:[],availability:[]};
 assert.equal(filterDatasets(cards,empty).length,3);assert.equal(filterDatasets(cards,{...empty,category:['content','jailbreak']}).length,3);
 assert.deepEqual(filterDatasets(cards,{...empty,category:['content'],source:['github'],availability:['local']}).map(c=>c.id),['moderation']);
 assert.equal(filterDatasets(cards,{...empty,search:'PUBLISHER benchmark'}).length,3);assert.equal(filterDatasets(cards,{...empty,search:'missing'}).length,0);
 assert.equal(filterDatasets(cards,{...empty,availability:['missing']})[0].id,'wildjailbreak');
});
test('Aegis browsing includes archived train and validation while Testing remains test-only',async()=>{
 const viewer=new DatasetViewer();try{const metadata=viewer.metadata('aegis');assert.deepEqual(metadata.scopes.map(s=>s.split).sort(),['test','train','validation']);assert.deepEqual(metadata.scopes.find(s=>s.split==='train')!.files,['train.json','refusals_train.json']);assert.deepEqual(metadata.scopes.find(s=>s.split==='validation')!.files,['validation.json','refusals_validation.json']);assert.deepEqual(metadata.scopes.filter(s=>s.recommended).map(s=>s.split),['test']);assert.deepEqual(catalog().find(c=>c.id==='aegis')!.files.map((f:any)=>f.split),['test']);}finally{await viewer.close();}
});
