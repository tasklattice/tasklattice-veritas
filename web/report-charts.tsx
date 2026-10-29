import type {DatasetCard,JsonObject} from '../src/shared/types';
import {ReportChart,useChartTheme} from './report-chart';
import {Button} from './ui';
import {datasetName} from './brand';
import {count} from './report-model';
import {finiteMetric} from './report-workspace-model';

export function DatasetOutcomeChart({groups,cards,openChecks}:{groups:[string,JsonObject][];cards:DatasetCard[];openChecks:(filter:string,dataset?:string)=>void}){
  const theme=useChartTheme(),visible=groups.slice(0,12),names=visible.map(([id])=>datasetName(cards.find(c=>c.id===id)??{id,name:id}));
  const parts=[{name:'Matched',key:'passed',color:theme.success,filter:'all'},{name:'Unexpected',key:'failed',color:theme.danger,filter:'unexpected'},{name:'Errors',key:'errors',color:theme.warning,filter:'error'},{name:'Skipped / missing',key:'other',color:theme.muted,filter:'all'}];
  return <section className="analytics-panel dataset-outcome-chart" aria-label="Dataset outcome distribution"><div className="analytics-heading"><h2>Check outcomes</h2><Button variant="ghost" onClick={()=>openChecks('unexpected')}>Review unexpected</Button></div>
    <ReportChart className={visible.length>6?'chart-tall':''} label={visible.map(([id,s])=>(datasetName(cards.find(c=>c.id===id)??{id,name:id}))+': '+count(s.passed)+' matched, '+count(s.failed)+' unexpected, '+count(s.errors)+' errors').join('; ')} onSelect={(index,series)=>openChecks(parts[series].filter,visible[index][0])} option={{grid:{top:36,left:150,right:24,bottom:48},legend:{top:0,left:0,itemWidth:8,itemHeight:8,textStyle:{color:theme.text,fontSize:11}},tooltip:{trigger:'axis',axisPointer:{type:'shadow'},backgroundColor:theme.card,borderColor:theme.border,textStyle:{color:theme.foreground}},xAxis:{type:'value',name:'Checks',nameLocation:'middle',nameGap:28,nameTextStyle:{color:theme.text,fontSize:11},minInterval:1,axisLabel:{color:theme.text,fontSize:11},splitLine:{lineStyle:{color:theme.border,type:'dashed'}}},yAxis:{type:'category',inverse:true,data:names,axisLine:{show:false},axisTick:{show:false},axisLabel:{color:theme.text,fontSize:11,width:130,overflow:'truncate'}},series:parts.map(p=>({name:p.name,type:'bar',stack:'outcomes',barMaxWidth:22,itemStyle:{color:p.color},emphasis:{focus:'series'},data:visible.map(([,s])=>p.key==='other'?Math.max(0,(s.skipped??0)+(s.missing??0)):finiteMetric(s[p.key]))}))}}/>
  </section>;
}
