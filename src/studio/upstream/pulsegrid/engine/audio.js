/** Main-thread adapter. All musical sequencing is in the processor, not setTimeout/requestAnimationFrame. */
export class AudioHost extends EventTarget {
  constructor(){super();this.context=null;this.node=null;this.assets=new Map();this.project=null;this.meter=null;this.recordChunks=[];this.stream=null;this.source=null;this.midi=null;this.initializing=null;}
  emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
  async enable(){
    if(this.initializing)return this.initializing;
    if(this.context){await this.context.resume();return;}
    this.initializing=(async()=>{
      if(!globalThis.isSecureContext)throw new Error('AudioWorklet needs HTTPS or localhost. Run the included local server.');
      const context=new AudioContext({latencyHint:'interactive'});this.context=context;
      try{if(!context.audioWorklet)throw new Error('AudioWorklet is unavailable in this browser.');
        await context.audioWorklet.addModule(new URL('./worklet.js',import.meta.url));
        this.node=new AudioWorkletNode(context,'pulsegrid-engine',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'});
        this.node.port.onmessage=e=>this.message(e.data);this.node.onprocessorerror=()=>this.emit('error','The audio processor stopped. Reload to restart the engine.');
        for(const asset of this.assets.values())this.send({type:'sample',asset});
        if(this.project)this.send({type:'project',project:this.project});this.node.connect(context.destination);await context.resume();this.emit('ready',{sampleRate:context.sampleRate,latency:context.baseLatency+(context.outputLatency||0)});
        context.onstatechange=()=>this.emit('state',context.state);
      }catch(e){await context.close();this.context=null;this.node=null;throw e;}
    })();
    try{await this.initializing;}finally{this.initializing=null;}
  }
  message(m){
    if(m.type==='meter'){this.meter=m;this.emit('meter',m);}
    else if(m.type==='record-data'){
      // Copy into main-thread-owned storage, then immediately recycle the transferred capture blocks.
      this.recordChunks.push({left:m.left.slice(0,m.length),right:m.right.slice(0,m.length),frame:m.frame});
      this.node.port.postMessage({type:'capture-return',left:m.left,right:m.right},[m.left.buffer,m.right.buffer]);
    }else if(m.type==='record-started'){this.recordStart=m;}
    else if(m.type==='record-complete'){
      this.disconnectMicrophone();let frames=0;
      const start=this.recordChunks[0]?.frame??0;for(const c of this.recordChunks)frames=Math.max(frames,c.frame-start+c.left.length);
      const channels=[new Float32Array(frames),new Float32Array(frames)];for(const c of this.recordChunks){channels[0].set(c.left,c.frame-start);channels[1].set(c.right,c.frame-start);}
      this.recordChunks=[];this.emit('recorded',{channels,sampleRate:this.context.sampleRate,frames,beat:this.recordStart?.beat||0,dropped:m.dropped});
    }else if(m.type==='error')this.emit('error',m.message);
  }
  send(m){this.node?.port.postMessage(m);}
  setProject(project){this.project=project;this.send({type:'project',project});}
  clearSamples(){this.assets.clear();this.send({type:'clear-samples'});}
  addSample(asset){this.assets.set(asset.id,asset);this.send({type:'sample',asset});}
  async decode(file){await this.enable();if(file.size>160*1024*1024)throw new Error('Audio imports are limited to 160 MB.');const buffer=await this.context.decodeAudioData(await file.arrayBuffer());return {id:crypto.randomUUID(),name:file.name,sampleRate:buffer.sampleRate,frames:buffer.length,channels:Array.from({length:Math.min(2,buffer.numberOfChannels)},(_,i)=>buffer.getChannelData(i).slice())};}
  async play(){await this.enable();this.send({type:'play'});}
  async launch(track,scene){await this.enable();this.send({type:'launch',track,scene});}
  async scene(scene){await this.enable();this.send({type:'scene',scene});}
  note(track,pitch,velocity,on){if(!this.context)return;this.send({type:'note',track,pitch,velocity,on,contextFrame:Math.round((this.context.currentTime+.005)*this.context.sampleRate)});}
  async startRecording(){await this.enable();if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone recording requires a secure context and microphone support.');this.recordChunks=[];
    this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:2}});
    this.source=this.context.createMediaStreamSource(this.stream);this.source.connect(this.node);this.send({type:'capture-start'});
  }
  stopRecording(){this.send({type:'capture-stop'});}
  disconnectMicrophone(){this.source?.disconnect();this.stream?.getTracks().forEach(t=>t.stop());this.source=null;this.stream=null;}
  async connectMIDI(handler){if(!navigator.requestMIDIAccess)throw new Error('Web MIDI is not available in this browser. Use the computer keyboard instead.');this.midi=await navigator.requestMIDIAccess({sysex:false});const attach=()=>{for(const input of this.midi.inputs.values())input.onmidimessage=ev=>{const [status,pitch,velocity]=ev.data;const cmd=status&0xf0;if(cmd===0x90||cmd===0x80)handler(pitch,velocity/127,cmd===0x90&&velocity>0);};};attach();this.midi.onstatechange=attach;return this.midi.inputs.size;}
}
