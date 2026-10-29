import {useEffect,useRef,useState} from 'react';
import {init,use,type EChartsCoreOption,type EChartsType} from 'echarts/core';
import {BarChart,HeatmapChart,ScatterChart} from 'echarts/charts';
import {GridComponent,TooltipComponent,LegendComponent,VisualMapComponent,AriaComponent} from 'echarts/components';
import {SVGRenderer} from 'echarts/renderers';
import {LabelLayout} from 'echarts/features';
use([BarChart,HeatmapChart,ScatterChart,GridComponent,TooltipComponent,LegendComponent,VisualMapComponent,AriaComponent,LabelLayout,SVGRenderer]);

export type ReportChartOption=EChartsCoreOption;
export function ReportChart({option,label,onSelect,className=''}:{option:ReportChartOption;label:string;onSelect?:(index:number,series:number)=>void;className?:string}){
  const root=useRef<HTMLDivElement>(null),chart=useRef<EChartsType|null>(null),select=useRef(onSelect),[error,setError]=useState(false);
  select.current=onSelect;
  useEffect(()=>{
    if(!root.current)return;
    const node=root.current;
    try{chart.current=init(node,undefined,{renderer:'svg'});}catch{setError(true);return;}
    chart.current.on('click',event=>{if(typeof event.dataIndex==='number')select.current?.(event.dataIndex,event.seriesIndex??0);});
    const resize=new ResizeObserver(()=>chart.current?.resize());resize.observe(node);
    const observer=new MutationObserver(()=>chart.current?.resize());observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
    return()=>{resize.disconnect();observer.disconnect();chart.current?.dispose();chart.current=null;};
  },[]);
  useEffect(()=>{
    if(!root.current||!chart.current)return;
    const style=getComputedStyle(root.current),color=(name:string)=>style.getPropertyValue(name).trim();
    const update=()=>{try{chart.current?.setOption({animation:false,aria:{enabled:true,label:{description:label}},textStyle:{fontFamily:style.fontFamily,color:color('--foreground')},...option},true);setError(false);}catch{setError(true);}};
    update();const observer=new MutationObserver(update);observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});return()=>observer.disconnect();
  },[option,label]);
  return <div className="report-chart-container"><div className={'report-chart '+className} ref={root} role="img" aria-label={label}/>{error&&<p className="help" role="status">Chart unavailable. The saved values are available in the table below.</p>}</div>;
}
