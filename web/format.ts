export const percent=(value:unknown)=>typeof value==='number'?`${(value*100).toFixed(1)}%`:'—';
export const time=(value?:string)=>value?new Date(value).toLocaleString('en-GB',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
