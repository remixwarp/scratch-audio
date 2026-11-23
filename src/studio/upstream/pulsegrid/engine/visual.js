/** One instanced draw per surface. GPU path has no canvas-2D rendering dependency. */
const shader=`struct View { size: vec2f, padding: vec2f }; @group(0) @binding(0) var<uniform> view: View;
struct Out { @builtin(position) position: vec4f, @location(0) color: vec4f };
@vertex fn vs(@builtin(vertex_index) vertex: u32, @location(0) rect: vec4f, @location(1) color: vec4f) -> Out {
  var corners=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
  let p=(rect.xy+corners[vertex]*rect.zw)/view.size;var out:Out;out.position=vec4f(p.x*2-1,1-p.y*2,0,1);out.color=color;return out;
}
@fragment fn fs(input:Out)->@location(0) vec4f { return vec4f(input.color.rgb*input.color.a,input.color.a); }`;
let devicePromise;
async function gpuDevice(){if(!devicePromise)devicePromise=(async()=>{if(!navigator.gpu)return null;const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});return adapter?await adapter.requestDevice():null;})();return devicePromise;}
const colors=new Map();
function rgba(color){if(Array.isArray(color))return color;if(colors.has(color))return colors.get(color);const value=color.replace('#','');const c=[parseInt(value.slice(0,2),16)/255,parseInt(value.slice(2,4),16)/255,parseInt(value.slice(4,6),16)/255,1];colors.set(color,c);return c;}
export class Surface {
  constructor(canvas){this.canvas=canvas;this.data=new Float32Array(32768*8);this.count=0;this.width=1;this.height=1;this.backend='Canvas 2D';this.capacity=0;this.background='#202326';}
  async init(){try{
    this.device=await gpuDevice();if(!this.device)throw new Error('WebGPU adapter unavailable');const d=this.device;
    const module=d.createShaderModule({label:'Pulsegrid instanced timeline / waveform renderer',code:shader});
    const compilation=await module.getCompilationInfo();const errors=compilation.messages.filter(m=>m.type==='error');if(errors.length)throw new Error(errors.map(e=>e.message).join('\n'));
    this.format=navigator.gpu.getPreferredCanvasFormat();this.pipeline=await d.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs',buffers:[{arrayStride:32,stepMode:'instance',attributes:[{shaderLocation:0,offset:0,format:'float32x4'},{shaderLocation:1,offset:16,format:'float32x4'}]}]},fragment:{module,entryPoint:'fs',targets:[{format:this.format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});
    this.uniform=d.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.bind=d.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}}]});
    this.context=this.canvas.getContext('webgpu');if(!this.context)throw new Error('WebGPU canvas unavailable');this.context.configure({device:d,format:this.format,alphaMode:'premultiplied'});this.backend='WebGPU';
    d.lost.then(info=>{this.fallback();console.warn('Pulsegrid GPU device lost; switched to Canvas 2D.',info.message);});
  }catch(error){this.fallback();console.info('Pulsegrid visual fallback:',error.message);}return this;}
  fallback(){if(this.context){const old=this.canvas;this.canvas=old.cloneNode();old.replaceWith(this.canvas);}this.context=null;this.device=null;this.ctx=this.canvas.getContext('2d',{alpha:false});this.backend='Canvas 2D';}
  begin(){const rect=this.canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);this.width=Math.max(1,rect.width);this.height=Math.max(1,rect.height);const w=Math.round(this.width*dpr),h=Math.round(this.height*dpr);if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}this.dpr=dpr;this.count=0;}
  rect(x,y,w,h,color,alpha=1){if(w<=0||h<=0||x>this.width||y>this.height||x+w<0||y+h<0)return;if((this.count+1)*8>this.data.length){const b=new Float32Array(this.data.length*2);b.set(this.data);this.data=b;}
    const c=rgba(color),i=this.count++*8,d=this.data;d[i]=x;d[i+1]=y;d[i+2]=w;d[i+3]=h;d[i+4]=c[0];d[i+5]=c[1];d[i+6]=c[2];d[i+7]=(c[3]??1)*alpha;}
  line(x1,y1,x2,y2,color,thickness=1){const dx=x2-x1,dy=y2-y1,steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/2));for(let i=0;i<=steps;i++)this.rect(x1+dx*i/steps,y1+dy*i/steps,thickness,thickness,color);}
  end(){if(!this.width||!this.height)return;
    if(this.device){const d=this.device,bytes=this.count*32;if(bytes>this.capacity){this.buffer?.destroy();this.capacity=Math.max(65536,2**Math.ceil(Math.log2(bytes)));this.buffer=d.createBuffer({size:this.capacity,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});}
      d.queue.writeBuffer(this.uniform,0,new Float32Array([this.width,this.height,0,0]));if(bytes)d.queue.writeBuffer(this.buffer,0,this.data.buffer,0,bytes);
      const encoder=d.createCommandEncoder(),bg=rgba(this.background),pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:bg[0],g:bg[1],b:bg[2],a:1},loadOp:'clear',storeOp:'store'}]});
      if(this.count){pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bind);pass.setVertexBuffer(0,this.buffer);pass.draw(6,this.count);}pass.end();d.queue.submit([encoder.finish()]);
    }else if(this.ctx){const c=this.ctx;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.fillStyle=this.background;c.fillRect(0,0,this.width,this.height);for(let j=0;j<this.count;j++){const i=j*8,a=this.data;c.fillStyle=`rgba(${a[i+4]*255},${a[i+5]*255},${a[i+6]*255},${a[i+7]})`;c.fillRect(a[i],a[i+1],a[i+2],a[i+3]);}}
  }
}
/** Immutable multiresolution extrema cache: waveform cost scales with visible pixels, not file duration. */
export class WaveCache {
  constructor(){this.cache=new Map();}
  get(asset){let pyramid=this.cache.get(asset.id);if(pyramid)return pyramid;const source=asset.channels[0],n=Math.ceil(source.length/64),mins=new Float32Array(n),maxs=new Float32Array(n);
    for(let i=0;i<n;i++){let lo=1,hi=-1;for(let j=i*64;j<Math.min(source.length,(i+1)*64);j++){lo=Math.min(lo,source[j]);hi=Math.max(hi,source[j]);}mins[i]=lo;maxs[i]=hi;}
    pyramid=[{stride:64,mins,maxs}];while(pyramid.at(-1).mins.length>2){const prev=pyramid.at(-1),size=Math.ceil(prev.mins.length/2),lo=new Float32Array(size),hi=new Float32Array(size);for(let i=0;i<size;i++){lo[i]=Math.min(prev.mins[i*2],prev.mins[Math.min(prev.mins.length-1,i*2+1)]);hi[i]=Math.max(prev.maxs[i*2],prev.maxs[Math.min(prev.maxs.length-1,i*2+1)]);}pyramid.push({stride:prev.stride*2,mins:lo,maxs:hi});}this.cache.set(asset.id,pyramid);return pyramid;
  }
  draw(surface,asset,x,y,w,h,color,start=0,end=1,reverse=false,opacity=.85){if(!asset||w<1)return;const levels=this.get(asset),samples=(end-start)*asset.frames,scale=samples/w;let level=levels[0];for(const l of levels)if(l.stride<=scale*2)level=l;const center=y+h/2;
    for(let px=0;px<w;px+=2){const u=reverse?1-px/w:px/w,at=Math.min(asset.frames-1,Math.max(0,Math.floor(start*asset.frames+samples*u)));let lo,hi;
      if(scale<32){lo=1;hi=-1;for(let j=at;j<Math.min(asset.frames,at+Math.max(1,Math.ceil(scale*2)));j++){lo=Math.min(lo,asset.channels[0][j]);hi=Math.max(hi,asset.channels[0][j]);}}
      else{const i=Math.min(level.mins.length-1,Math.floor(at/level.stride));lo=level.mins[i];hi=level.maxs[i];}
      surface.rect(x+px,center-hi*h*.46,1.5,Math.max(1,(hi-lo)*h*.46),color,opacity);
    }
  }
}
