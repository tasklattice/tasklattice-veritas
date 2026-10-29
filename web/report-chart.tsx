import {lazy,Suspense,useEffect,useState} from 'react';
import type {EChartsCoreOption} from 'echarts/core';
export type ReportChartOption=EChartsCoreOption;
const EChart=lazy(()=>import('./report-echart').then(module=>({default:module.ReportChart})));
export function ReportChart(props:{option:ReportChartOption;label:string;onSelect?:(index:number,series:number)=>void;className?:string}){
  return <Suspense fallback={<div className={'report-chart chart-loading '+(props.className??'')} role="status">Loading chart…</div>}><EChart {...props}/></Suspense>;
}
// ECharts SVG labels do not inherit CSS variables; resolve the existing semantic tokens.
export function chartTheme(){const style=getComputedStyle(document.documentElement),get=(name:string)=>style.getPropertyValue(name).trim();return {text:get('--muted-foreground'),foreground:get('--foreground'),border:get('--border'),card:get('--card'),primary:get('--chart-primary'),success:get('--chart-success'),danger:get('--chart-danger'),warning:get('--chart-warning'),muted:get('--chart-muted')};}
export function useChartTheme(){const [theme,setTheme]=useState(chartTheme);useEffect(()=>{const observer=new MutationObserver(()=>setTheme(chartTheme()));observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});return()=>observer.disconnect();},[]);return theme;}
/** Choose the higher-contrast surface token over the heatmap's interpolated fill. */
export function heatmapLabelColor(value:number,from:string,to:string,foreground:string,surface:string){
  const rgb=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  const luminance=(channels:number[])=>channels.map(c=>{const v=c/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const a=rgb(from),b=rgb(to),fill=luminance(a.map((v,i)=>v+(b[i]-v)*Math.max(0,Math.min(1,value/100))));
  const contrast=(hex:string)=>{const l=luminance(rgb(hex));return (Math.max(fill,l)+.05)/(Math.min(fill,l)+.05);};
  return contrast(foreground)>=contrast(surface)?foreground:surface;
}
