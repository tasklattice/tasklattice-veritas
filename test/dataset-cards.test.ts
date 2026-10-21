import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDatasetCards,datasetIdForSelection} from '../src/server/dataset-cards.js';
import type {DatasetItem} from '../src/shared/types.js';
const source={id:'wildjailbreak',repo:'allenai/wildjailbreak',source:'hf',url:'https://huggingface.co/datasets/allenai/wildjailbreak',notes:'Evaluation dataset',license:'test-license',revision:'pinned',files:[{config:'eval',split:'train'}]};
const selection=(id:string,datasets=['wildjailbreak']):DatasetItem=>({id,name:id,path:'/private/'+id,cases:2,unlabeled:0,phases:['input'],datasets,configs:['eval'],splits:['train'],revision:null});
test('A Dataset card represents one source repository across repeated local imports',()=>{
 const cards=buildDatasetCards([source],[selection('copy-1'),selection('copy-2')]);
 assert.equal(cards.length,1);assert.equal(cards[0].id,'wildjailbreak');assert.equal(cards[0].repository,'allenai/wildjailbreak');assert.equal(cards[0].selections.length,2);
 assert.deepEqual(cards[0].splits,['train']);assert.deepEqual(cards[0].selections[0].configs,['eval']);assert.equal((cards[0].selections[0] as any).path,undefined);
});
test('Unprepared sources stay visible and mixed local collections do not masquerade as a source',()=>{
 const empty=buildDatasetCards([source],[]);assert.equal(empty.length,1);assert.deepEqual(empty[0].selections,[]);
 const mixed=selection('mixed',['wildjailbreak','aegis']);const cards=buildDatasetCards([source],[mixed]);
 assert.equal(cards[0].selections.length,0);assert.equal(cards[1].source,'local');assert.equal(cards[1].url,null);assert.equal(cards[1].id,datasetIdForSelection(mixed));
});
