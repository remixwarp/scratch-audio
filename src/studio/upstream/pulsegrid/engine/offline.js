import {PulseEngine} from './dsp.js';
import {encodeWav} from './wav.js';
/** Offline bounce; intentionally shares every synthesis, sequencing and insert path with realtime.
 * No dependency on OfflineAudioContext / worklet support in an offline context.
 */
export function renderProject({project,assets=[],sampleRate=48000,bars=16,tail=2,bitDepth=24,active},onProgress=()=>{}){
  if(![44100,48000,96000,8000].includes(sampleRate))throw new Error('Unsupported export sample rate.');
  if(!Number.isFinite(bars)||bars<=0||!Number.isFinite(tail)||tail<0||tail>30)throw new Error('Invalid render duration.');
  const musicalFrames=Math.round(bars*4*60/project.bpm*sampleRate),tailFrames=Math.round(tail*sampleRate);
  if(musicalFrames+tailFrames>sampleRate*600)throw new Error('Offline export is capped at ten minutes.');
  const p=structuredClone(project);p.loop=false;p.loopStart=0;
  const engine=new PulseEngine(sampleRate);for(const asset of assets)engine.setSample(asset);engine.setProject(p);
  if(active)for(let i=0;i<engine.tracks.length;i++)engine.tracks[i].active=active[i]??0;
  engine.play();const frames=musicalFrames+tailFrames,outL=new Float32Array(frames),outR=new Float32Array(frames),blockL=new Float32Array(128),blockR=new Float32Array(128);
  const total=frames+engine.maxLatency;let at=0,nextProgress=0;
  // Split exactly at the musical endpoint; continue releases and delay through the requested tail.
  // Discard only the known internal latency prefix, not any part of the musical signal.
  while(at<total){if(at===musicalFrames)engine.pause();let count=Math.min(128,total-at);if(at<musicalFrames)count=Math.min(count,musicalFrames-at);engine.render(blockL,blockR,null,null,count);
    for(let i=0;i<count;i++){const dest=at+i-engine.maxLatency;if(dest>=0&&dest<frames){outL[dest]=blockL[i];outR[dest]=blockR[i];}}at+=count;
    if(at>=nextProgress){onProgress(at/total);nextProgress=at+sampleRate;}
  }
  const wav=encodeWav([outL,outR],sampleRate,bitDepth);onProgress(1);return {wav,frames,sampleRate};
}
