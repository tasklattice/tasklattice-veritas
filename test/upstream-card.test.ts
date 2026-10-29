import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {upstreamCard,parseCardDocument,readPinnedCardFile} from '../src/server/upstream-card.js';
import {buildServer} from '../src/server/main.js';
import {sourcePath} from '../src/core/raw.js';
import {json,root} from '../src/core/files.js';
import {cardHeadings,cardLink,cardImage} from '../src/shared/card-markdown.js';
import {UpstreamDatasetCard} from '../web/upstream-card.js';
import {cardOptions} from '../web/query.js';
import type {DatasetCard} from '../src/shared/types.js';
const available=existsSync(sourcePath('aegis','README.md'));

test('Archived upstream card retains original Aegis wording, metadata, authors and citation with verifiable provenance',{skip:!available},()=>{
 const card=upstreamCard('aegis'),original=readFileSync(sourcePath('aegis','README.md'));
 assert.equal(card.raw,original.toString('utf8'));assert.equal(card.bytes,original.length);assert.equal(card.sha256,createHash('sha256').update(original).digest('hex'));
 assert.equal(card.metadata.pretty_name,'Nemotron Content Safety Dataset V2');assert.deepEqual(card.metadata.language,['en']);assert.ok(Array.isArray(card.metadata.configs));
 for(const title of ['Dataset Details','Annotation process','Content Safety Taxonomy','Bias, Risks, and Limitations','Citation'])assert.ok(card.headings.some(h=>h.text===title));
 assert.match(card.markdown,/@inproceedings\{ghosh-etal-2025-aegis2/);assert.match(card.markdown,/Dataset Card Authors and Contacts/);assert.match(card.markdown,/33,416/);
 assert.ok(card.readmeUrl.includes('/blob/'+card.revision+'/README.md'));assert.equal(card.license,'cc-by-4.0');
 const entry=json<any>(join(root,'catalog/raw-datasets.lock.json')).datasets.find((e:any)=>e.id==='aegis');
 assert.throws(()=>readPinnedCardFile('aegis',{...entry,files:entry.files.map((f:any)=>f.path==='README.md'?{...f,gitBlob:'bad'}:f)},'README.md',2e6),/does not match/);
 assert.throws(()=>readPinnedCardFile('aegis',entry,'README.md',10),/display limit/);
});
test('Card parser preserves body text, handles CRLF/frontmatter and gives duplicate headings stable IDs',()=>{
 const body='# Title\r\n\r\n## Repeated\r\nText\r\n## Repeated\r\n',parsed=parseCardDocument('\uFEFF---\r\nlanguage: [en]\r\nlicense: cc-by-4.0\r\n---\r\n'+body);
 assert.equal(parsed.markdown,body);assert.deepEqual(parsed.metadata.language,['en']);assert.equal(parsed.metadataError,undefined);
 assert.deepEqual(cardHeadings(body).map(h=>h.id),['upstream-title','upstream-repeated','upstream-repeated-1']);
 const malformed=parseCardDocument('---\nlanguage: [unterminated\n---\n# Kept\n');assert.ok(malformed.metadataError);assert.equal(malformed.markdown,'# Kept\n');
 const plain='## Original without YAML\n';assert.equal(parseCardDocument(plain).markdown,plain);
});
test('Dataset card links keep source revision and untrusted content cannot execute or fetch arbitrary images',{skip:!available},()=>{
 const card=upstreamCard('aegis');assert.equal(cardLink('data/file.json',card),card.readmeUrl.replace('README.md','data/file.json'));assert.equal(cardLink('#dataset-structure',card),'#dataset-structure');assert.equal(cardLink('../data/file.json',card),card.readmeUrl.replace('README.md','data/file.json'));
 for(const href of ['javascript:alert(1)','data:text/html,bad','file:///etc/passwd'])assert.equal(cardLink(href,card),'');
 const imageCard={...card,assets:['images/example.png']};assert.equal(cardImage('images/example.png',imageCard),'/api/datasets/aegis/card/asset?path=images%2Fexample.png');assert.equal(cardImage('https://huggingface.co/datasets/'+card.repository+'/resolve/main/images/example.png',imageCard),'/api/datasets/aegis/card/asset?path=images%2Fexample.png');assert.equal(cardImage('https://outside.example/tracker.png',imageCard),null);assert.equal(cardImage('../../etc/passwd',imageCard),null);
 const client=new QueryClient(),options=cardOptions('aegis',card.revision);client.setQueryData(options.queryKey,{...card,markdown:'# Upstream title\n[broken](#%zz)\n[bad](javascript:alert(1))\n<script>window.x=1</script>\n<img src="https://outside.example/tracker.png" onerror="alert(1)">\n\n![remote](https://outside.example/remote.png)'});
 try{const html=renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(UpstreamDatasetCard,{card:{id:'aegis',revision:card.revision,configs:['default'],splits:['test'],rawAvailable:true} as DatasetCard})));assert.ok(html.includes('Upstream title'));assert.ok(!/<script|<img[^>]+outside\.example|href="javascript:|onerror=/i.test(html));assert.ok(html.includes('external image'));}finally{client.clear();}
});
test('Dataset card API serves exact Markdown and locked assets while rejecting unknown files and sources',{skip:!available},async()=>{
 const {app}=await buildServer({ui:false}),headers={host:'localhost:38100'};
 try{
  const card=await app.inject({url:'/api/datasets/aegis/card',headers});assert.equal(card.statusCode,200,card.body);assert.ok(!card.body.includes('/Users/'));assert.equal(card.json().repository,'nvidia/Aegis-AI-Content-Safety-Dataset-2.0');
  const raw=await app.inject({url:'/api/datasets/aegis/card/raw',headers});assert.equal(raw.statusCode,200);assert.deepEqual(raw.rawPayload,readFileSync(sourcePath('aegis','README.md')));assert.match(String(raw.headers['content-disposition']),/attachment/);
  for(const url of ['/api/datasets/unknown/card','/api/datasets/aegis/card/asset?path=README.md','/api/datasets/aegis/card/asset?path=../../etc/passwd','/api/datasets/aegis/card/asset?path=missing.png'])assert.equal((await app.inject({url,headers})).statusCode,404);
  const image=sourcePath('beavertails','images/dataset-distribution.png');if(existsSync(image)){const response=await app.inject({url:'/api/datasets/beavertails/card/asset?path=images%2Fdataset-distribution.png',headers});assert.equal(response.statusCode,200);assert.match(String(response.headers['content-type']),/image\/png/);assert.deepEqual(response.rawPayload,readFileSync(image));}
 }finally{await app.close();}
});
