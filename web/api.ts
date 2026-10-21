export class ApiError extends Error {constructor(message:string,public status:number){super(message);this.name='ApiError';}}
export async function api<T>(path:string,body?:unknown,method=body===undefined?'GET':'POST',signal?:AbortSignal):Promise<T>{
  const response=await fetch('/api'+path,{method,signal,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
  const data=await response.json();if(!response.ok)throw new ApiError(data.error??'Request failed',response.status);return data;
}
export const adapterName=(a?:string)=>a==='f5-scan'?'F5 Scan':a==='litellm-generic-guardrail'?'LiteLLM':'Legacy';
