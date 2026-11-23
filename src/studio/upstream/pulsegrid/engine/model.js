/** Versioned, serializable musical model. Times are quarter-note beats; audio is referenced, never destructively edited. */
export const VERSION = 1;
export const COLORS = ['#efab85','#e3c777','#86b9db','#97c7ac','#b6a0d4','#76c4c2','#d997aa','#a7acb4'];
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const clamp = (x,a,b) => Math.min(b,Math.max(a,x));
export const clone = x => structuredClone(x);
export const noteName = n => ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((n%12)+12)%12]+(Math.floor(n/12)-1);
export function makeTrack(name, instrument='poly', color=COLORS[0]) {
  return {id:uid(),name,type:instrument==='audio'?'audio':'midi',color,instrument,volume:.72,pan:0,mute:false,solo:false,arm:false,
    oscillator:instrument==='bass'?'square':instrument==='pluck'?'triangle':'saw',attack:instrument==='poly'?.022:.004,decay:.22,sustain:instrument==='pluck'?.12:.62,release:instrument==='poly'?.38:.16,
    cutoff:instrument==='bass'?1400:8500,resonance:.7,drive:0,delayMix:instrument==='pluck'?.22:0,delayBeats:.75,delayFeedback:.32,
    compressor:0,lookahead:0,monitor:false,sampleId:null,rootNote:60,clips:Array(5).fill(null),arrangement:[],automation:[]};
}
export function makeClip(name, length=8, kind='midi') {
  return {id:uid(),name,kind,length,notes:[],sampleId:null,trimStart:0,trimEnd:1,reverse:false,warp:true,gain:1,fadeIn:.004,fadeOut:.015};
}
const n=(pitch,start,duration=.25,velocity=.8)=>({id:uid(),pitch,start,duration,velocity});
export function demoProject(){
  const tracks=[makeTrack('Drum machine','drums'),makeTrack('Sub circuit','bass',COLORS[1]),makeTrack('Glass keys','poly',COLORS[2]),makeTrack('Prism arp','pluck',COLORS[3]),makeTrack('Night texture','audio',COLORS[4]),makeTrack('Pulse lead','poly',COLORS[5]),makeTrack('Percussion','drums',COLORS[6]),makeTrack('Audio input','audio',COLORS[7])];
  tracks[0].volume=.82; tracks[1].volume=.66; tracks[2].volume=.43; tracks[2].cutoff=3300; tracks[2].delayMix=.12; tracks[3].volume=.47; tracks[3].cutoff=6000; tracks[4].volume=.42; tracks[4].pan=-.2; tracks[5].volume=.35; tracks[5].pan=.17; tracks[5].cutoff=2600; tracks[5].oscillator='sine'; tracks[5].delayMix=.24; tracks[6].volume=.45; tracks[6].pan=.2;
  const bass=[36,36,43,39,34,34,41,39],chords=[[60,63,67,70],[58,62,65,69]], arp=[72,79,75,82,74,77,81,79];
  const names=[['Soft entrance','Four on the floor','Full circuit','Half time','Last pulse'],['Sub / C minor','Moving roots','Low orbit','Held roots','Sub fade'],['Glass / Cm9','Open voicing','Suspended light','Quiet chords','Afterglow'],['Scattered light','Prism / 1.16','High reflections','Two notes','Fading prism'],['Vinyl atmosphere','Night air','Wide atmosphere','Only air','Night closes'],['First signal','Distant melody','Open sky','Quiet signal','Return home'],['Shuffled hats','Perc / swing','Loose machinery','Ghost hits','Final hats']];
  for(let t=0;t<7;t++)for(let s=0;s<5;s++){
    const c=makeClip(names[t][s],8,t===4?'audio':'midi');
    if(t===0){for(let b=0;b<8;b++){if(s!==3||b%2===0)c.notes.push(n(36,b,.2,.92));if(b%2===1&&s!==0)c.notes.push(n(38,b,.2,.7));if(s!==3)c.notes.push(n(42,b+.5,.1,.36+(b%2)*.1));} }
    if(t===1)bass.forEach((p,i)=>{if(s===3&&i%2)return;c.notes.push(n(p,i+(s===2?.25:0),s===3?1.6:.62,.78)); if(s===2)c.notes.push(n(p+12,i+.75,.18,.48));});
    if(t===2)chords.forEach((ch,i)=>ch.forEach(p=>c.notes.push(n(p+(s===2?12:0),i*4,s===3?3.6:2.9,.57))));
    if(t===3){for(let i=0;i<(s===3?4:32);i++)c.notes.push(n(arp[(i+s)%8],s===3?i*2:i*.25,.16,s===0?.35:.58));}
    if(t===4)c.sampleId='factory-atmosphere';
    if(t===5)[[72,0,1.4],[75,2,.6],[79,3.5,.4],[74,4,1.5],[70,6.5,1]].forEach(([p,b,d])=>{if(s===0&&b>2)return;c.notes.push(n(p+(s===2?12:0),b,d,.48));});
    if(t===6)for(let i=0;i<16;i++){if(s===3&&i%4)continue;c.notes.push(n(i%4===3?46:42,i*.5+(i%2?.065:0),.08,i%2?.32:.19));}
    tracks[t].clips[s]=c;
  }
  for(const t of tracks)for(let s=0;s<4;s++)if(t.clips[s])t.arrangement.push({id:uid(),clipId:t.clips[s].id,start:s*16,length:16,offset:0});
  return {version:VERSION,id:uid(),name:'After Hours',bpm:118,timeSignature:[4,4],quantum:4,master:.76,loop:true,loopStart:0,loopEnd:64,mode:'session',scenes:['Soft entrance','Find the motion','Open sky','The breakdown','After hours'],tracks};
}
/** Factory assets are synthesized locally; no network, copyrighted loops, or hidden dependencies. */
export function factorySamples(){
  const sampleRate=22050, len=Math.round(8*60/118*sampleRate),l=new Float32Array(len),r=new Float32Array(len);let seed=42817, z=0;
  for(let i=0;i<len;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;z=.985*z+.015*((seed>>>0)/2147483648-1);const t=i/sampleRate,fade=Math.min(1,i/1200,(len-i)/1200),tone=(Math.sin(2*Math.PI*130.8128*t)+.42*Math.sin(2*Math.PI*196*t)+.23*Math.sin(2*Math.PI*311.127*t))*.065;
    l[i]=(tone*(.75+.25*Math.sin(t*1.6))+z*.38)*fade;r[i]=(tone*(.75+.25*Math.cos(t*1.3))+z*.32)*fade;}
  return [{id:'factory-atmosphere',name:'Night air · synthesized.wav',sampleRate,channels:[l,r],frames:len}];
}
export function validateProject(p){
  if(!p||p.version!==VERSION||!Array.isArray(p.tracks))throw new Error('This is not a Pulsegrid v1 project.');
  if(!Array.isArray(p.scenes)||p.scenes.length<1||p.scenes.length>32||p.scenes.some(s=>typeof s!=='string'||s.length>120))throw new Error('Invalid scene list.');
  if(typeof p.name!=='string'||p.name.length>120||!['session','arrangement'].includes(p.mode))throw new Error('Invalid project metadata.');
  if(p.tracks.length<1||p.tracks.length>16)throw new Error('Projects support 1–16 tracks.');
  if(!Number.isFinite(p.bpm)||p.bpm<30||p.bpm>300)throw new Error('Tempo must be 30–300 BPM.');
  if(!Number.isFinite(p.loopStart)||!Number.isFinite(p.loopEnd)||p.loopStart<0||p.loopEnd<=p.loopStart||p.loopEnd>100000)throw new Error('Invalid loop region.');
  p.master=clamp(Number(p.master)||0,0,1.5); p.quantum=[0,.25,1,4,8].includes(p.quantum)?p.quantum:4;
  const ids=new Set();
  for(const t of p.tracks){
    if(typeof t.name!=='string'||t.name.length>120||!/^#[a-f0-9]{6}$/i.test(t.color))throw new Error('Invalid track metadata.');
    if(!t.id||ids.has(t.id))throw new Error('Track IDs must be unique.');ids.add(t.id);
    if(!Array.isArray(t.clips)||t.clips.length>128||!Array.isArray(t.arrangement)||t.arrangement.length>4096)throw new Error('Invalid track structure.');
    if(!['drums','bass','poly','pluck','sampler','audio'].includes(t.instrument))throw new Error('Unknown instrument.');
    t.volume=clamp(Number(t.volume)||0,0,1.5);t.pan=clamp(Number(t.pan)||0,-1,1);t.cutoff=clamp(Number(t.cutoff)||8000,30,20000);t.lookahead=clamp(Math.round(Number(t.lookahead)||0),0,2048);
    const ranges={resonance:[.3,8,.7],drive:[0,1,0],delayMix:[0,1,0],delayFeedback:[0,.88,.3],delayBeats:[.0625,4,.5],compressor:[0,1,0],attack:[.001,4,.004],decay:[.001,4,.2],sustain:[0,1,.6],release:[.001,10,.2],rootNote:[0,127,60],recordOffset:[-500,500,0]};
    for(const [key,[min,max,fallback]] of Object.entries(ranges))t[key]=clamp(Number.isFinite(t[key])?t[key]:fallback,min,max);
    if(!['sine','triangle','saw','square'].includes(t.oscillator))t.oscillator='saw';
    if(t.type!=='audio'&&t.type!=='midi')throw new Error('Invalid track type.');
    while(t.clips.length<p.scenes.length)t.clips.push(null);
    const clips=new Set();
    for(const c of t.clips.filter(Boolean)){
      if(typeof c.id!=='string'||typeof c.name!=='string'||!['midi','audio'].includes(c.kind))throw new Error('Invalid clip metadata.');
      if(clips.has(c.id))throw new Error('Duplicate clip ID.');clips.add(c.id);
      if(!Number.isFinite(c.length)||c.length<=0||c.length>1024||!Array.isArray(c.notes)||c.notes.length>8192)throw new Error('Invalid clip.');
      if(![c.trimStart,c.trimEnd,c.gain,c.fadeIn,c.fadeOut].every(Number.isFinite))throw new Error('Invalid sample edits.');
      c.gain=clamp(c.gain,0,4);c.fadeIn=clamp(c.fadeIn,0,10);c.fadeOut=clamp(c.fadeOut,0,10);
      if(c.trimStart<0||c.trimEnd>1||c.trimEnd<=c.trimStart)throw new Error('Invalid non-destructive sample range.');
      for(const n of c.notes)if(![n.pitch,n.start,n.duration,n.velocity].every(Number.isFinite)||n.pitch<0||n.pitch>127||n.start<0||n.start>=c.length||n.duration<=0||n.duration>1024||n.velocity<0||n.velocity>1)throw new Error('Invalid MIDI note.');
    }
    for(const a of t.arrangement)if(!clips.has(a.clipId)||!Number.isFinite(a.start)||a.start<0||!Number.isFinite(a.length)||a.length<=0)throw new Error('Invalid arrangement instance.');
    if(!Array.isArray(t.automation))t.automation=[];
    if(t.automation.length>8192)throw new Error('Too many automation points.');
    t.automation=t.automation.filter(a=>Number.isFinite(a.beat)&&a.beat>=0&&Number.isFinite(a.value)).map(a=>({...a,value:clamp(a.value,0,1)})).sort((a,b)=>a.beat-b.beat);
  }
  return p;
}
export class History {
  constructor(project,onChange){this.project=project;this.onChange=onChange;this.past=[];this.future=[];}
  commit(label,fn){const before=clone(this.project);fn(this.project);this.past.push({label,state:before});if(this.past.length>80)this.past.shift();this.future.length=0;this.onChange(this.project,label);}
  undo(){if(!this.past.length)return;const e=this.past.pop();this.future.push({label:e.label,state:clone(this.project)});this.project=e.state;this.onChange(this.project,`Undo ${e.label}`);}
  redo(){if(!this.future.length)return;const e=this.future.pop();this.past.push({label:e.label,state:clone(this.project)});this.project=e.state;this.onChange(this.project,`Redo ${e.label}`);}
  replace(p){validateProject(p);this.project=p;this.past=[];this.future=[];this.onChange(p,'Project loaded');}
}
