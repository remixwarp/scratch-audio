/** Portable deterministic DSP, shared unchanged by AudioWorklet, export Worker, and Node tests.
 * No dynamic voice creation, sorting, buffer growth, promises, or DOM in render().
 * Routing: voices/input -> SVF -> drive -> tempo delay -> lookahead compressor -> PDC -> pan/fader -> master safety.
 */
const TAU=2*Math.PI, VOICES=24, LATENCY_SIZE=8192;
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
function blep(t,dt){if(t<dt){t/=dt;return t+t-t*t-1;}if(t>1-dt){t=(t-1)/dt;return t*t+t+t+1;}return 0;}
function osc(p,dt,kind){if(kind==='sine')return Math.sin(TAU*p);if(kind==='triangle')return 1-4*Math.abs(p-.5);if(kind==='square')return (p<.5?1:-1)+blep(p,dt)-blep((p+.5)%1,dt);return 2*p-1-blep(p,dt);}
function newVoice(){return {on:false,pitch:60,freq:440,phase:0,phase2:0,age:0,duration:0,releaseAge:-1,releaseLevel:0,env:0,velocity:0,kind:'poly',sample:null,pos:0,rate:1,lo:0,hi:0,fadeIn:1,fadeOut:1,seed:1};}
class TrackDSP {
  constructor(model,sr){this.id=model.id;this.sr=sr;this.voices=Array.from({length:VOICES},newVoice);this.delayL=new Float32Array(Math.ceil(sr*8));this.delayR=new Float32Array(Math.ceil(sr*8));this.latL=new Float32Array(LATENCY_SIZE);this.latR=new Float32Array(LATENCY_SIZE);this.compL=new Float32Array(LATENCY_SIZE);this.compR=new Float32Array(LATENCY_SIZE);this.di=0;this.li=0;this.ci=0;this.ic1L=0;this.ic2L=0;this.ic1R=0;this.ic2R=0;this.compEnv=0;this.active=0;this.origin=0;this.pending=-2;this.pendingBeat=0;this.clipKey='';this.lastCycle=-1;this.cursor=0;this.lastPos=-1;this.arrKey='';this.peakL=0;this.peakR=0;this.rms=0;this.smoothVolume=model.volume;this.smoothPan=model.pan;this.apply(model);}
  apply(m){
    this.model=m;
    const signature=JSON.stringify([m.clips,m.arrangement]);
    if(signature!==this.clipSignature){
      this.clipSignature=signature;this.clips=m.clips.map(c=>c?{...c,notes:c.notes.slice().sort((a,b)=>a.start-b.start||a.pitch-b.pitch)}:null);
      this.byId=new Map(this.clips.filter(Boolean).map(c=>[c.id,c]));this.arr=m.arrangement.slice().sort((a,b)=>a.start-b.start);this.clipKey='';
    }
    const automationSignature=JSON.stringify(m.automation||[]);
    if(automationSignature!==this.automationSignature){this.automationSignature=automationSignature;this.automation=(m.automation||[]).slice().sort((a,b)=>a.beat-b.beat);}
    this.coefficients();
  }
  coefficients(){const m=this.model;
    this.g=Math.tan(Math.PI*clamp(m.cutoff,30,this.sr*.45)/this.sr);this.k=1/clamp(m.resonance||.7,.3,8);this.a1=1/(1+this.g*(this.g+this.k));this.a2=this.g*this.a1;this.a3=this.g*this.a2;
    this.lookahead=clamp(Math.round(m.lookahead||0),0,2048);this.releaseSamples=Math.max(1,Math.floor((m.release||.1)*this.sr));this.attackSamples=Math.max(1,Math.floor((m.attack||.002)*this.sr));this.decaySamples=Math.max(1,Math.floor((m.decay||.2)*this.sr));this.releaseCoef=Math.exp(-1/(.09*this.sr));
  }
  clear(){for(const v of this.voices){v.on=false;v.sample=null;}this.delayL.fill(0);this.delayR.fill(0);this.latL.fill(0);this.latR.fill(0);this.compL.fill(0);this.compR.fill(0);this.ic1L=this.ic2L=this.ic1R=this.ic2R=0;this.clipKey='';this.lastCycle=-1;this.cursor=0;this.lastPos=-1;this.compEnv=0;}
  releaseAll(){for(const v of this.voices)if(v.on&&v.releaseAge<0){v.releaseAge=0;v.releaseLevel=v.env;}}
  note(pitch,velocity,duration,sample,clip){
    if(this.model.instrument==='sampler'&&!sample)return null;
    let v=null;for(let i=0;i<VOICES;i++){if(!this.voices[i].on){v=this.voices[i];break;}}if(!v){v=this.voices[0];for(let i=1;i<VOICES;i++)if(this.voices[i].env<v.env)v=this.voices[i];}
    v.on=true;v.pitch=pitch;v.freq=440*2**((pitch-69)/12);v.velocity=velocity;v.phase=v.phase2=0;v.age=0;v.duration=duration;v.releaseAge=-1;v.env=0;v.kind=this.model.instrument;v.sample=sample;v.seed=((pitch*1831565813+this.serial++)>>>0)||1;
    if(sample){v.kind='sample';v.lo=Math.floor((clip?.trimStart||0)*sample.frames);v.hi=Math.max(v.lo+1,Math.floor((clip?.trimEnd??1)*sample.frames));v.pos=clip?.reverse?v.hi-1:v.lo;
      v.rate=sample.sampleRate/this.sr*2**((pitch-(this.model.rootNote??60))/12);
      if(clip?.kind==='audio'&&clip.warp)v.rate=(v.hi-v.lo)/Math.max(1,duration);
      if(clip?.reverse)v.rate=-v.rate;v.fadeIn=Math.max(1,(clip?.fadeIn??.003)*this.sr);v.fadeOut=Math.max(1,(clip?.fadeOut??.015)*this.sr);v.velocity*=clip?.gain??1;
    }
    return v;
  }
}
export class PulseEngine {
  constructor(sampleRate=48000){this.sr=sampleRate;this.samples=new Map();this.tracks=[];this.project=null;this.playing=false;this.beat=0;this.frame=0;this.step=120/(60*sampleRate);this.metronome=false;this.clickAge=1e9;this.clickAccent=false;this.lastClick=-1;this.masterPeakL=0;this.masterPeakR=0;this.maxLatency=0;this.liveEvents=Array.from({length:512},()=>({frame:0,track:0,pitch:0,velocity:0,on:false}));this.evRead=0;this.evWrite=0;this.droppedEvents=0;this.eventCount=0;}
  setSample(asset){const channels=asset.channels.map(c=>c instanceof Float32Array?c:new Float32Array(c));this.samples.set(asset.id,{...asset,channels,frames:channels[0].length});}
  setProject(project){this.project=project;this.step=project.bpm/(60*this.sr);this.anySolo=project.tracks.some(t=>t.solo);const previous=new Map(this.tracks.map(t=>[t.id,t]));this.tracks=project.tracks.map(m=>{const t=previous.get(m.id)||new TrackDSP(m,this.sr);t.apply(m);t.serial??=0;t.active=clamp(t.active,-1,t.clips.length-1);return t;});this.maxLatency=Math.max(0,...this.tracks.map(t=>t.lookahead));for(const t of this.tracks){t.compensate=this.maxLatency-t.lookahead;t.delayFrames=clamp(Math.round((t.model.delayBeats||.5)*60/project.bpm*this.sr),1,t.delayL.length-1);} }
  setParameter(index,key,value){
    const t=this.tracks[index];if(!t)return;
    // Compact parameter messages never rebuild clip/event tables.
    const allowed=['volume','pan','cutoff','resonance','drive','delayMix','delayBeats','delayFeedback','compressor','attack','decay','sustain','release','lookahead'];
    if(!allowed.includes(key)||!Number.isFinite(value))return;t.model[key]=value;t.coefficients();
    if(key==='lookahead'){this.maxLatency=Math.max(0,...this.tracks.map(t=>t.lookahead));for(const track of this.tracks)track.compensate=this.maxLatency-track.lookahead;}
    if(key==='delayBeats')t.delayFrames=clamp(Math.round(value*60/this.project.bpm*this.sr),1,t.delayL.length-1);
  }
  play(){if(!this.playing)for(const t of this.tracks)t.clipKey='';this.playing=true;}
  pause(){this.playing=false;for(const t of this.tracks)t.releaseAll();}
  stop(){this.playing=false;this.beat=this.project?.loopStart||0;this.lastClick=-1;this.evRead=this.evWrite;for(const t of this.tracks){t.clear();t.origin=this.beat;t.pending=-2;t.serial=0;}}
  seek(beat){this.beat=Math.max(0,beat);this.lastClick=-1;for(const t of this.tracks){t.clear();t.origin=0;}}
  launch(track,scene,quantum=this.project.quantum){const t=this.tracks[track];if(!t)return;if(!this.playing){t.active=scene;t.origin=this.beat;t.clipKey='';if(scene>=0)this.playing=true;return;}t.pending=scene;t.pendingBeat=quantum?Math.ceil((this.beat+this.step*.5)/quantum)*quantum:this.beat;}
  launchScene(scene){const running=this.playing;for(let i=0;i<this.tracks.length;i++){if(!running){this.tracks[i].active=this.tracks[i].clips[scene]?scene:-1;this.tracks[i].origin=this.beat;this.tracks[i].clipKey='';}else this.launch(i,this.tracks[i].clips[scene]?scene:-1);}this.playing=true;}
  noteAt(track,pitch,velocity,on,frame=this.frame){const next=(this.evWrite+1)%this.liveEvents.length;if(next===this.evRead){this.droppedEvents++;return;}const e=this.liveEvents[this.evWrite];e.track=track;e.pitch=pitch;e.velocity=velocity;e.on=on;e.frame=Math.max(this.frame,Math.round(frame));this.evWrite=next;}
  _events(){while(this.evRead!==this.evWrite){const e=this.liveEvents[this.evRead];if(e.frame>this.frame)break;const t=this.tracks[e.track];if(t){if(e.on)t.note(e.pitch,e.velocity,1e12,this.samples.get(t.model.sampleId),null);else for(const v of t.voices)if(v.on&&v.pitch===e.pitch&&v.releaseAge<0){v.releaseAge=0;v.releaseLevel=v.env;}}this.evRead=(this.evRead+1)%this.liveEvents.length;}}
  _sequence(t){
    if(t.pending!==-2&&this.beat+this.step*.5>=t.pendingBeat){t.active=t.pending;t.origin=t.pendingBeat;t.pending=-2;t.clipKey='';t.releaseAll();}
    let clip,origin=t.origin,offset=0,key='';
    if(this.project.mode==='arrangement'){
      let found=null;for(let a=0;a<t.arr.length;a++){const item=t.arr[a];if(item.start>this.beat+this.step*.5)break;if(this.beat+this.step*.5<item.start+item.length)found=item;}
      if(found){clip=t.byId.get(found.clipId);origin=found.start;offset=found.offset||0;key=found.id;}
    }else{clip=t.clips[t.active];key=clip?.id||'';}
    if(!clip){if(t.clipKey)t.releaseAll();t.clipKey='';t.currentClipId=null;return;}
    t.currentClipId=clip.id;
    const absolute=this.beat-origin+offset;if(absolute<-.5*this.step)return;
    const cycle=Math.floor((absolute+this.step*.5)/clip.length),pos=absolute-cycle*clip.length;
    const changed=t.clipKey!==key,looped=cycle!==t.lastCycle;
    if(changed||looped||pos<t.lastPos-this.step){
      if(changed)t.releaseAll();t.cursor=0;
      if(changed&&pos>this.step){
        while(t.cursor<clip.notes.length&&clip.notes[t.cursor].start<pos-this.step*.5)t.cursor++;
        // Note chase when seeking/resuming into a sustained note. Its remaining duration is exact;
        // oscillator phase and envelope restart rather than pretending to reconstruct past DSP state.
        for(let i=0;i<t.cursor;i++){const note=clip.notes[i];if(note.start+note.duration>pos)t.note(note.pitch,note.velocity,(note.start+note.duration-pos)/this.step,this.samples.get(t.model.sampleId),null);}
      }
      if(clip.kind==='audio'){
        const asset=this.samples.get(clip.sampleId);if(asset){const v=t.note(t.model.rootNote??60,1,clip.length/this.step,asset,clip);if(pos>this.step){v.pos+=Math.round(pos/this.step)*v.rate;v.age=Math.round(pos/this.step);}}
      }
    }
    t.clipKey=key;t.lastCycle=cycle;t.lastPos=pos;
    while(t.cursor<clip.notes.length&&clip.notes[t.cursor].start<=pos+this.step*.5){const note=clip.notes[t.cursor++];if(note.start>=pos-this.step*1.5){t.note(note.pitch,note.velocity,note.duration/this.step,this.samples.get(t.model.sampleId),null);this.eventCount++;}}
  }
  automation(t){const a=t.automation;if(!a.length||this.project.mode!=='arrangement')return 1;if(this.beat<=a[0].beat)return a[0].value;for(let i=1;i<a.length;i++){if(this.beat<a[i].beat){const u=(this.beat-a[i-1].beat)/(a[i].beat-a[i-1].beat);return a[i-1].value+(a[i].value-a[i-1].value)*u;}}return a[a.length-1].value;}
  render(left,right,inputL=null,inputR=null,frames=left.length){
    if(!this.project){left.fill(0);right.fill(0);return;}
    const sr=this.sr,step=this.step;
    for(let i=0;i<frames;i++){
      this._events();let mixL=0,mixR=0;
      if(this.playing&&this.metronome){const b=Math.floor(this.beat+step*.5);if(b!==this.lastClick){this.clickAge=0;this.clickAccent=b%4===0;this.lastClick=b;}}
      for(let ti=0;ti<this.tracks.length;ti++){
        const t=this.tracks[ti],m=t.model;if(this.playing)this._sequence(t);let l=0,r=0;
        for(let j=0;j<VOICES;j++){
          const v=t.voices[j];if(!v.on)continue;let x=0,y=0;const age=v.age++;
          if(v.kind==='drums'){
            v.seed^=v.seed<<13;v.seed^=v.seed>>>17;v.seed^=v.seed<<5;const noise=(v.seed>>>0)/2147483648-1,sec=age/sr;
            if(v.pitch<38){v.phase+=(48+115*Math.exp(-sec*42))/sr;v.phase%=1;x=Math.sin(TAU*v.phase)*Math.exp(-sec*10.5)+noise*.09*Math.exp(-sec*160);if(sec>.65)v.on=false;}
            else if(v.pitch<42){x=(noise*.72+Math.sin(TAU*185*sec)*.28)*Math.exp(-sec*19);if(sec>.4)v.on=false;}
            else {x=(noise*.7+Math.sin(TAU*7820*sec)*.3)*Math.exp(-sec*(v.pitch===46?15:58))*.4;if(sec>(v.pitch===46?.55:.16))v.on=false;}
            x*=v.velocity;v.env=Math.abs(x);y=x;
          }else if(v.kind==='sample'){
            if(v.pos<v.lo||v.pos>=v.hi||age>=v.duration){v.on=false;continue;}
            const p=Math.floor(v.pos),q=Math.min(p+1,v.hi-1),f=v.pos-p,a=v.sample.channels[0],b=v.sample.channels[1]||a;
            const remain=Math.min(v.duration-age,v.rate>0?(v.hi-v.pos)/v.rate:(v.pos-v.lo+1)/-v.rate);let env=Math.min(1,age/v.fadeIn,remain/v.fadeOut);
            if(v.releaseAge>=0){env*=Math.max(0,1-v.releaseAge++/t.releaseSamples);if(v.releaseAge>=t.releaseSamples)v.on=false;}
            v.env=env;x=(a[p]+(a[q]-a[p])*f)*v.velocity*env;y=(b[p]+(b[q]-b[p])*f)*v.velocity*env;v.pos+=v.rate;
          }else{
            if(age>=v.duration&&v.releaseAge<0){v.releaseAge=0;v.releaseLevel=v.env;}
            let env;if(v.releaseAge>=0){env=v.releaseLevel*Math.max(0,1-v.releaseAge++/t.releaseSamples);if(v.releaseAge>=t.releaseSamples)v.on=false;}
            else if(age<t.attackSamples)env=age/t.attackSamples;
            else if(age<t.attackSamples+t.decaySamples)env=1-(1-(m.sustain??.6))*(age-t.attackSamples)/t.decaySamples;
            else env=m.sustain??.6;
            v.env=env;const dt=Math.min(.45,v.freq/sr);v.phase=(v.phase+dt)%1;v.phase2=(v.phase2+dt*1.004)%1;
            x=osc(v.phase,dt,m.oscillator);if(v.kind==='poly')x=x*.7+osc(v.phase2,dt*1.004,m.oscillator)*.3;
            if(v.kind==='bass')x=x*.7+Math.sin(TAU*((v.phase+v.phase2)*.25))*.18;
            x*=env*v.velocity*.23;y=x;
          }
          l+=x;r+=y;
        }
        if(m.monitor&&inputL){l+=inputL[i]||0;r+=(inputR||inputL)[i]||0;}
        let v3=l-t.ic2L,v1=t.a1*t.ic1L+t.a2*v3,v2=t.ic2L+t.a2*t.ic1L+t.a3*v3;t.ic1L=2*v1-t.ic1L;t.ic2L=2*v2-t.ic2L;l=v2;
        v3=r-t.ic2R;v1=t.a1*t.ic1R+t.a2*v3;v2=t.ic2R+t.a2*t.ic1R+t.a3*v3;t.ic1R=2*v1-t.ic1R;t.ic2R=2*v2-t.ic2R;r=v2;
        if(m.drive>0){const d=1+m.drive*9;l=Math.tanh(l*d)/Math.sqrt(d);r=Math.tanh(r*d)/Math.sqrt(d);}
        let read=(t.di-t.delayFrames+t.delayL.length)%t.delayL.length;const dl=t.delayL[read],dr=t.delayR[read];t.delayL[t.di]=l+dr*clamp(m.delayFeedback||0,0,.88);t.delayR[t.di]=r+dl*clamp(m.delayFeedback||0,0,.88);t.di=(t.di+1)%t.delayL.length;l+=dl*(m.delayMix||0);r+=dr*(m.delayMix||0);
        t.compL[t.ci]=l;t.compR[t.ci]=r;const peak=Math.max(Math.abs(l),Math.abs(r));t.compEnv=Math.max(peak,t.compEnv*t.releaseCoef);const amount=m.compressor||0,threshold=.55-amount*.4,gain=t.compEnv>threshold?Math.pow(threshold/t.compEnv,amount*.8):1;
        read=(t.ci-t.lookahead+LATENCY_SIZE)%LATENCY_SIZE;l=t.compL[read]*gain;r=t.compR[read]*gain;t.ci=(t.ci+1)%LATENCY_SIZE;
        t.latL[t.li]=l;t.latR[t.li]=r;read=(t.li-t.compensate+LATENCY_SIZE)%LATENCY_SIZE;l=t.latL[read];r=t.latR[read];t.li=(t.li+1)%LATENCY_SIZE;
        t.smoothVolume+=(m.volume-t.smoothVolume)*.002;t.smoothPan+=(m.pan-t.smoothPan)*.002;
        const allowed=!m.mute&&(!this.anySolo||m.solo),volume=allowed?t.smoothVolume*this.automation(t):0,angle=(t.smoothPan+1)*Math.PI*.25;
        l*=volume*Math.cos(angle)*1.414213562;r*=volume*Math.sin(angle)*1.414213562;
        t.peakL=Math.max(Math.abs(l),t.peakL*.99988);t.peakR=Math.max(Math.abs(r),t.peakR*.99988);t.rms=.9995*t.rms+.0005*(l*l+r*r)*.5;mixL+=l;mixR+=r;
      }
      if(this.clickAge<sr*.04){const sec=this.clickAge++/sr,c=Math.sin(TAU*(this.clickAccent?1700:1100)*sec)*Math.exp(-sec*105)*.12;mixL+=c;mixR+=c;}
      mixL*=this.project.master;mixR*=this.project.master;
      // Bounded master protection, not a transparent brickwall mastering limiter.
      mixL=Math.abs(mixL)>.9?Math.sign(mixL)*(.9+.1*Math.tanh((Math.abs(mixL)-.9)*10)):mixL;
      mixR=Math.abs(mixR)>.9?Math.sign(mixR)*(.9+.1*Math.tanh((Math.abs(mixR)-.9)*10)):mixR;
      left[i]=Number.isFinite(mixL)?mixL:0;right[i]=Number.isFinite(mixR)?mixR:0;
      this.masterPeakL=Math.max(Math.abs(mixL),this.masterPeakL*.99988);this.masterPeakR=Math.max(Math.abs(mixR),this.masterPeakR*.99988);
      if(this.playing){this.beat+=step;if(this.project.mode==='arrangement'&&this.project.loop&&this.beat>=this.project.loopEnd-step*.5){this.beat=this.project.loopStart;for(const t of this.tracks){t.origin=this.beat;t.clipKey='';t.lastCycle=-1;}}}
      this.frame++;
    }
  }
}
