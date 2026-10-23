import type {Attempt,Case} from './types.js';

export const PII_METRIC_VERSION='annotated-pii-v3';
export const piiLabels={blocked:'Blocked',allowed:'Allowed without redaction',partial:'Incomplete redaction',complete:'Complete redaction',unverified:'Redaction unverified',empty:'Empty transformed output',error:'Execution error',skipped:'Skipped'} as const;
export type PiiStatus=keyof typeof piiLabels;
const word=(s:string)=>/[\p{L}\p{N}_]/u.test(s);
/** Match annotations at their source token boundaries; CA must not match medical. */
function occurrences(text:string,value:string){
 if(!value)return [];
 const chars=Array.from(value),escaped=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const before=word(chars[0])?'(?<![\\p{L}\\p{N}_])':'',after=word(chars.at(-1)!)?'(?![\\p{L}\\p{N}_])':'';
 return Array.from(text.matchAll(new RegExp(before+escaped+after,'giu')),m=>({start:m.index,end:m.index+m[0].length}));
}
/** Verify placeholder redaction against the original source, including partially masked values.
 * Each literal output segment must appear unchanged and in order. Only spans removed in every valid alignment are verified.
 * Never interpret arbitrary replacement prose or an empty response as complete sanitization.
 */
function removedSpans(source:string,output:string){
 const segments=output.split(/\[(?:[A-Za-z0-9_:-]*REDACTED[A-Za-z0-9_:-]*|EMAIL|PHONE|PERSON|NAME|ADDRESS|PII|MASKED)\]/i);
 if(segments.length===1||segments.length>257||source.length>1_000_000)return null;
 if(!source.startsWith(segments[0])||!source.endsWith(segments.at(-1)!))return null;
 type Span={start:number;end:number};
 const layers:Span[][]=[[{start:0,end:segments[0].length}]];
 let positions=0;
 // Keep every possible ordered alignment. Repeated HTML tags/list separators
 // are not inherently ambiguous once the later literals and suffix are known.
 for(let i=1;i<segments.length;i++){
  const literal=segments[i],previous=layers[i-1],minEnd=previous[0].end;
  const candidates:Span[]=[];
  if(i===segments.length-1){
   const start=source.length-literal.length;
   if(start>minEnd)candidates.push({start,end:source.length});
  }else{
   if(!literal)return null; // Adjacent placeholders cannot be verified independently.
   for(let pos=source.indexOf(literal,minEnd+1);pos>=0;pos=source.indexOf(literal,pos+1)){
    if(++positions>4096)return null; // Fail conservatively on pathological repetition.
    candidates.push({start:pos,end:pos+literal.length});
   }
  }
  if(!candidates.length)return null;
  layers.push(candidates);
 }
 // Backward reachability removes positions that cannot reach the anchored end.
 for(let i=layers.length-2;i>=0;i--){
  const nextStart=layers[i+1].at(-1)!.start;
  layers[i]=layers[i].filter(s=>s.end<nextStart);
  if(!layers[i].length)return null;
 }
 // A character is certainly removed only if no valid alignment keeps it in a
 // literal. Thus ambiguous partial masking can never become a successful pass.
 const visible=layers.flat().sort((a,b)=>a.start-b.start||a.end-b.end);
 const removed:Span[]=[];let pos=0;
 for(const s of visible){if(s.start>pos)removed.push({start:pos,end:s.start});pos=Math.max(pos,s.end);}
 if(pos<source.length)removed.push({start:pos,end:source.length});
 return removed;
}
export function redactionCheck(c:Pick<Case,'pii'|'text'>,texts:string[]=[]){
 const values=[...new Set((c.pii??[]).filter(v=>v.trim()))],output=texts.join('\n');
 const remaining=values.filter(v=>occurrences(output,v).length).length;
 if(!output.trim())return {status:'empty' as const,annotated:values.length,remaining};
 const spans=removedSpans(c.text,output);
 if(!spans||!values.length)return {status:remaining?'partial' as const:'unverified' as const,annotated:values.length,remaining};
 let partial=0,unknown=false;
 for(const value of values){const matches=occurrences(c.text,value);
  if(!matches.length)unknown=true;
  if(occurrences(output,value).length||matches.some(m=>!spans.some(s=>s.start<=m.start&&s.end>=m.end)))partial++;
 }
 return {status:partial?'partial' as const:unknown?'unverified' as const:'complete' as const,annotated:values.length,remaining:partial};
}
export function piiEvidence(r:Attempt,c?:Case){
 if(c?.expected!=='transform'||!c.pii?.length)return null;
 const checked=redactionCheck(c,r.texts);
 return {version:PII_METRIC_VERSION,status:(r.status!=='completed'?r.status:r.action==='block'?'blocked':r.action==='allow'?'allowed':checked.status) as PiiStatus,
  annotated:checked.annotated,remaining:r.action==='transform'?checked.remaining:null};
}
export function piiSummary(records:Attempt[],cases:Case[],repeat?:number){
 const positives=cases.filter(c=>c.expected==='transform'&&c.pii?.length);if(!positives.length)return null;
 const byId=new Map(positives.map(c=>[c.id,c]));const counts=Object.fromEntries(Object.keys(piiLabels).map(k=>[k,0])) as Record<PiiStatus,number>;
 for(const r of records){const c=byId.get(r.caseId);if(c)counts[piiEvidence(r,c)!.status]++;}
 const completed=counts.blocked+counts.allowed+counts.partial+counts.complete+counts.empty+counts.unverified;
 const transformed=counts.partial+counts.complete+counts.empty+counts.unverified;
 const eligible=new Set(positives.map(c=>c.dataset+'\0'+c.phase));
 const controls=new Set(cases.filter(c=>c.expected==='allow'&&eligible.has(c.dataset+'\0'+c.phase)).map(c=>c.id));
 const negatives=records.filter(r=>controls.has(r.caseId)&&r.status==='completed'),fp=negatives.filter(r=>r.action!=='allow').length;
 const ratio=(n:number,d:number)=>d?n/d:null;
 return {version:PII_METRIC_VERSION,counts,positiveCases:positives.length,completed,transformed,
  planned:repeat==null?null:positives.length*repeat,missing:repeat==null?null:Math.max(0,positives.length*repeat-Object.values(counts).reduce((a,b)=>a+b,0)),
  interventionRecall:ratio(counts.blocked+transformed,completed),completeRedactionRate:ratio(counts.complete,completed),
  transformedCompleteRate:ratio(counts.complete,transformed),controlCompleted:negatives.length,controlInterventions:fp,controlFalsePositiveRate:ratio(fp,negatives.length)};
}
