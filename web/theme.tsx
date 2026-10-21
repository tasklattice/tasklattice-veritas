import {useEffect,useState} from 'react';
import {Monitor,Moon,Sun} from 'lucide-react';
import {NativeSelect} from './ui';
type Theme='light'|'dark'|'system';
function preference():Theme{try{const value=localStorage.getItem('veritas-theme');return value==='light'||value==='dark'?value:'system';}catch{return 'system';}}
export function ThemeControl(){
  const[theme,setTheme]=useState<Theme>(preference);
  useEffect(()=>{
    const media=matchMedia('(prefers-color-scheme: dark)');
    const apply=()=>{document.documentElement.classList.toggle('dark',theme==='dark'||theme==='system'&&media.matches);document.documentElement.dataset.theme=theme;};
    apply();try{localStorage.setItem('veritas-theme',theme);}catch{/* View preferences can stay in memory when storage is unavailable. */}
    media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);
  },[theme]);
  const Icon=theme==='light'?Sun:theme==='dark'?Moon:Monitor;
  return <div className="theme-control"><Icon aria-hidden="true"/><NativeSelect aria-label="Theme" value={theme} onChange={e=>setTheme(e.target.value as Theme)}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></NativeSelect></div>;
}
