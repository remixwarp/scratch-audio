/** RIFF/WAVE interleaved PCM, little-endian, no external encoder. */
export function encodeWav(channels,sampleRate,bitDepth=24){
  if(![16,24].includes(bitDepth))throw new Error('PCM bit depth must be 16 or 24.');
  const frames=channels[0].length,n=channels.length,bytes=bitDepth/8,dataSize=frames*n*bytes;
  if(dataSize>0xffffffff-36)throw new Error('RIFF size limit exceeded.');
  const out=new ArrayBuffer(44+dataSize),v=new DataView(out);const ascii=(offset,s)=>{for(let i=0;i<s.length;i++)v.setUint8(offset+i,s.charCodeAt(i));};
  ascii(0,'RIFF');v.setUint32(4,36+dataSize,true);ascii(8,'WAVE');ascii(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,n,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*n*bytes,true);v.setUint16(32,n*bytes,true);v.setUint16(34,bitDepth,true);ascii(36,'data');v.setUint32(40,dataSize,true);
  let offset=44;for(let i=0;i<frames;i++)for(let c=0;c<n;c++){const x=Math.max(-1,Math.min(1,channels[c][i]||0));if(bitDepth===16){v.setInt16(offset,Math.round(x*(x<0?32768:32767)),true);offset+=2;}else{const k=Math.round(x*(x<0?8388608:8388607));v.setUint8(offset,k&255);v.setUint8(offset+1,(k>>8)&255);v.setUint8(offset+2,(k>>16)&255);offset+=3;}}
  return out;
}
