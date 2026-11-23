import { PulseEngine } from './dsp.js';
const CAPTURE_SIZE=8192;
class PulsegridProcessor extends AudioWorkletProcessor {
  constructor(){super();this.engine=new PulseEngine(sampleRate);this.elapsed=0;this.recording=false;this.capture=null;this.captureOffset=0;this.pool=[];this.recordDropped=0;
    for(let i=0;i<8;i++)this.pool.push(this.makeCapture(new Float32Array(CAPTURE_SIZE),new Float32Array(CAPTURE_SIZE)));
    this.telemetry={type:'meter',beat:0,frame:0,playing:false,masterL:0,masterR:0,latency:0,peaks:new Float32Array(32),rms:new Float32Array(16),positions:new Float32Array(16),active:new Int16Array(16),pending:new Int16Array(16),droppedEvents:0};
    this.port.onmessage=e=>this.command(e.data);
  }
  makeCapture(l,r){return {type:'record-data',left:l,right:r,length:0,frame:0};}
  flushCapture(){if(this.capture&&this.captureOffset){this.capture.length=this.captureOffset;this.port.postMessage(this.capture,[this.capture.left.buffer,this.capture.right.buffer]);this.capture=null;this.captureOffset=0;}}
  command(m){try{switch(m.type){
    case 'project':this.engine.setProject(m.project);break;
    case 'param':this.engine.setParameter(m.track,m.key,m.value);break;
    case 'master':if(this.engine.project)this.engine.project.master=m.value;break;
    case 'sample':this.engine.setSample(m.asset);break;
    case 'clear-samples':this.engine.samples.clear();break;
    case 'play':this.engine.play();break;
    case 'pause':this.engine.pause();break;
    case 'stop':this.engine.stop();break;
    case 'seek':this.engine.seek(m.beat);break;
    case 'launch':this.engine.launch(m.track,m.scene);break;
    case 'scene':this.engine.launchScene(m.scene);break;
    case 'metronome':this.engine.metronome=m.value;break;
    case 'note':this.engine.noteAt(m.track,m.pitch,m.velocity,m.on,this.engine.frame+Math.max(0,m.contextFrame-currentFrame));break;
    case 'capture-start':this.recordDropped=0;this.recording=true;this.port.postMessage({type:'record-started',beat:this.engine.beat,contextFrame:currentFrame});break;
    case 'capture-stop':this.recording=false;this.flushCapture();this.port.postMessage({type:'record-complete',dropped:this.recordDropped});break;
    case 'capture-return':this.pool.push(this.makeCapture(m.left,m.right));break;
  }}catch(error){this.port.postMessage({type:'error',message:error.message});}}
  process(inputs,outputs){const out=outputs[0];if(!out?.length)return true;const l=out[0],r=out[1]||l,input=inputs[0]||[];
    this.engine.render(l,r,input[0],input[1],l.length);
    if(this.recording){for(let i=0;i<l.length;i++){
      if(!this.capture){this.capture=this.pool.pop()||null;if(this.capture){this.captureOffset=0;this.capture.frame=currentFrame+i;}}
      if(!this.capture){this.recordDropped++;continue;}
      this.capture.left[this.captureOffset]=input[0]?.[i]??0;this.capture.right[this.captureOffset]=(input[1]||input[0])?.[i]??0;
      if(++this.captureOffset===CAPTURE_SIZE)this.flushCapture();
    }}
    this.elapsed+=l.length;if(this.elapsed>=sampleRate/24){this.elapsed=0;const s=this.telemetry,e=this.engine;s.beat=e.beat;s.frame=currentFrame+l.length;s.playing=e.playing;s.masterL=e.masterPeakL;s.masterR=e.masterPeakR;s.latency=e.maxLatency;s.droppedEvents=e.droppedEvents;
      s.peaks.fill(0);s.rms.fill(0);s.active.fill(-1);s.pending.fill(-2);
      for(let i=0;i<e.tracks.length;i++){const t=e.tracks[i];s.peaks[i*2]=t.peakL;s.peaks[i*2+1]=t.peakR;s.rms[i]=Math.sqrt(t.rms);s.positions[i]=t.lastPos;s.active[i]=t.active;if(e.project.mode==='arrangement'){s.active[i]=-1;for(let j=0;j<t.clips.length;j++)if(t.clips[j]?.id===t.currentClipId)s.active[i]=j;}s.pending[i]=t.pending;}
      this.port.postMessage(s);
    }return true;
  }
}
registerProcessor('pulsegrid-engine',PulsegridProcessor);
