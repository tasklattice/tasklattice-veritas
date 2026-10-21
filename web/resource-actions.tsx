import {useState} from 'react';
import {useMutation} from '@tanstack/react-query';
import {AlertDialog} from 'radix-ui';
import {Trash2,X} from 'lucide-react';
import {Button} from './ui';
import {queryClient,queryKeys} from './query';

export function DeleteResource({kind,id,name,onDelete,disabled=false,onSuccess}:{kind:'Report'|'Target';id:string;name:string;onDelete:()=>Promise<unknown>;disabled?:boolean;onSuccess:()=>void}){
  const[open,setOpen]=useState(false);
  const mutation=useMutation({mutationFn:onDelete,onSuccess:()=>{
    const queryKey=kind==='Target'?queryKeys.targets:queryKeys.runs;
    queryClient.setQueryData<{items:{id:string}[]}>(queryKey,previous=>previous?{items:previous.items.filter(item=>item.id!==id)}:previous);
    setOpen(false);onSuccess();
    queryClient.removeQueries({queryKey:[kind==='Target'?'target':'report',id]});
    void queryClient.invalidateQueries({queryKey});
  }}),busy=mutation.isPending;
  return <AlertDialog.Root open={open} onOpenChange={value=>{if(!busy){setOpen(value);mutation.reset();}}}><AlertDialog.Trigger asChild><Button variant="ghost" className="delete-resource" disabled={disabled} aria-label={'Delete '+kind+' '+name} title={disabled?'Wait for the active test to finish before deleting its Report':'Delete '+kind}><Trash2/></Button></AlertDialog.Trigger><AlertDialog.Portal><AlertDialog.Overlay className="sheet-overlay"/><AlertDialog.Content className="confirm-dialog" onEscapeKeyDown={e=>{if(busy)e.preventDefault();}}>
    <div className="confirm-heading"><AlertDialog.Title>Delete {kind} permanently?</AlertDialog.Title><AlertDialog.Cancel asChild><Button variant="ghost" disabled={busy} aria-label="Close confirmation"><X/></Button></AlertDialog.Cancel></div>
    <AlertDialog.Description><strong>{name}</strong> will be permanently deleted. This cannot be undone.{kind==='Target'?' Existing Reports and queued tests keep their saved Target configuration. This does not change the published Guard Endpoint.':' The Report and all saved request evidence and exports will be removed.'}</AlertDialog.Description>
    {mutation.error&&<p className="form-error" role="alert">{mutation.error.message}</p>}
    <footer><AlertDialog.Cancel asChild><Button variant="secondary" disabled={busy}>Cancel</Button></AlertDialog.Cancel><Button variant="danger" disabled={busy} onClick={()=>mutation.mutate()}>{busy?'Deleting…':'Delete '+kind}</Button></footer>
  </AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>;
}
