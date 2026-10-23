import type {Case} from '../shared/types.js';
import {validateSampling, type SamplingConfig} from '../shared/testing.js';
import {hash} from './files.js';

/** Hash ranking makes a seeded sample independent of file iteration order. */
export function sampleCases(cases: Case[], limit: number | undefined, value?: SamplingConfig, skipUnlabeled = false) {
  const config = validateSampling(value);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('Sample size must be a positive integer');
  const rank = (c: Case) => hash({version:'case-sampling-v1',seed:config.seed,dataset:c.dataset,id:c.id});
  const sorted = (rows: Case[]) => rows.map(c => ({c,rank:rank(c)})).sort((a,b)=>a.rank.localeCompare(b.rank)||a.c.id.localeCompare(b.c.id)).map(x=>x.c);
  const pool = config.method === 'source-order' ? cases : skipUnlabeled ? cases.filter(c=>c.expected!==null) : cases;
  if (config.method !== 'source-order' && pool.some(c=>c.expected===null)) throw new Error('Sampling requires reviewed expectations; explicitly exclude unreviewed cases or supply reviewed labels');
  const count = Math.min(limit ?? pool.length,pool.length);
  let selected: Case[];
  const quotas: Record<string,number> = {};
  if (config.method === 'source-order') selected = pool.slice(0,count);
  else if (config.method === 'random') selected = sorted(pool).slice(0,count);
  else {
    const groups = [...new Set(pool.map(c=>c.expected!))].sort().map(label=>({label,rows:pool.filter(c=>c.expected===label),quota:0,ideal:0}));
    if (count < groups.length) throw new Error(`Stratified sampling needs at least ${groups.length} cases to cover all expected-action labels`);
    for (const g of groups) {g.ideal=count*g.rows.length/pool.length;g.quota=Math.max(1,Math.floor(g.ideal));}
    let allocated=groups.reduce((sum,g)=>sum+g.quota,0);
    while(allocated>count){const g=groups.filter(g=>g.quota>1).sort((a,b)=>(b.quota-b.ideal)-(a.quota-a.ideal)||a.label.localeCompare(b.label))[0];g.quota--;allocated--;}
    while(allocated<count){const g=groups.filter(g=>g.quota<g.rows.length).sort((a,b)=>(b.ideal-b.quota)-(a.ideal-a.quota)||a.label.localeCompare(b.label))[0];g.quota++;allocated++;}
    selected=sorted(groups.flatMap(g=>{quotas[g.label]=g.quota;return sorted(g.rows).slice(0,g.quota);}));
  }
  return {cases:selected,selection:{algorithm:'case-sampling-v1',...config,limit:limit??null,
    population:pool.length,excludedUnlabeled:cases.length-pool.length,selected:selected.length,
    populationLabels:labelCounts(pool),selectedLabels:labelCounts(selected),...(config.method==='stratified'?{quotas}:{}),caseIds:selected.map(c=>c.id)}};
}
function labelCounts(cases: Case[]) {return Object.fromEntries(['allow','block','transform','unlabeled'].map(label=>[label,cases.filter(c=>(c.expected??'unlabeled')===label).length]));}
