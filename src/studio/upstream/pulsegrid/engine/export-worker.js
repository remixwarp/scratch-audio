import {renderProject} from './offline.js';
self.onmessage=({data:message})=>{
  if(message.type!=='render')return;
  try{const result=renderProject(message,value=>self.postMessage({type:'progress',value}));self.postMessage({type:'complete',...result},[result.wav]);}
  catch(error){self.postMessage({type:'error',message:error.message});}
};
