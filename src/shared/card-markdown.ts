import GithubSlugger from 'github-slugger';
import {toString} from 'mdast-util-to-string';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import type {Root,RootContent} from 'mdast';
import type {CardHeading} from './dataset-card';

function assignHeadings(tree:Root){
  const slugger=new GithubSlugger(),headings:CardHeading[]=[];
  function walk(node:Root|RootContent){
    if(node.type==='heading'){
      const text=toString(node),id='upstream-'+slugger.slug(text);
      node.data={...node.data,hProperties:{...node.data?.hProperties,id}};
      headings.push({id,text,depth:node.depth});
    }
    if('children'in node)for(const child of node.children)walk(child as RootContent);
  }
  walk(tree);return headings;
}
export const cardHeadings=(markdown:string)=>assignHeadings(unified().use(remarkParse).parse(markdown));
export const remarkCardHeadings=()=> (tree:Root)=>{assignHeadings(tree);};

/** README fragments belong to this document, not to the app's hash router. */
export function cardLink(href:string,card:Pick<import('./dataset-card').UpstreamDatasetCard,'readmeUrl'>){
  if(href.startsWith('#'))return href;
  try{
    const base=new URL(card.readmeUrl),marker=base.pathname.indexOf('/blob/');
    if(marker>=0&&!/^[a-z][a-z\d+.-]*:/i.test(href)&&!href.startsWith('/')){
      const end=base.pathname.indexOf('/',marker+6),prefix=base.pathname.slice(0,end+1),file=base.pathname.slice(end+1),relative=new URL(href,'https://archive.invalid/'+file);
      return base.origin+prefix+relative.pathname.slice(1)+relative.search+relative.hash;
    }
    const url=new URL(href,card.readmeUrl);return ['https:','http:','mailto:'].includes(url.protocol)?url.href:'';
  }catch{return '';}
}
export function cardImage(src:string,card:Pick<import('./dataset-card').UpstreamDatasetCard,'id'|'repository'|'revision'|'source'|'assets'|'readmeUrl'>){
  try{
    let path:string;
    if(/^[a-z][a-z\d+.-]*:/i.test(src)||src.startsWith('//')){
      const url=new URL(src,card.readmeUrl),prefix=card.source==='hf'?'/datasets/'+card.repository+'/':'/'+card.repository+'/';
      if(url.hostname===(card.source==='hf'?'huggingface.co':'github.com')&&url.pathname.startsWith(prefix))path=url.pathname.slice(prefix.length).replace(/^(resolve|blob)\/[^/]+\//,'');
      else if(card.source==='github'&&url.hostname==='raw.githubusercontent.com'&&url.pathname.startsWith('/'+card.repository+'/'))path=url.pathname.slice(card.repository.length+2).replace(/^[^/]+\//,'');
      else return null;
    }else path=new URL(src,'https://archive.invalid/README.md').pathname.slice(1);
    path=decodeURIComponent(path);
    return card.assets.includes(path)?'/api/datasets/'+encodeURIComponent(card.id)+'/card/asset?path='+encodeURIComponent(path):null;
  }catch{return null;}
}
