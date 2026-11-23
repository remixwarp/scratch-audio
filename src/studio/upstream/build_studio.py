#!/usr/bin/env python3
"""融合 Pulsegrid + Sonora 为一个统一 Studio。
- 两个工具全部源码内联为 iframe srcDoc（源码级整合，非链接）
- 提供并排大界面 / 单工具详编模式
- 主题 (dark/light) 通过 postMessage 从宿主同步
- 不改动工具原有文案与版权声明，仅追加主题脚本/样式
"""
import io, os

D = '/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d61-c65f7b386000/audio_work'
PG = io.open(os.path.join(D, 'pulsegrid-standalone.html'), encoding='utf-8').read()
SO = io.open(os.path.join(D, 'sonora_full', 'dist_sonora-studio.html'), encoding='utf-8').read()

# ---- light 主题覆盖（追加，不修改原有 :root / 文案）----
PG_LIGHT = """
<style id="rw-light-theme">
html[data-theme="light"]{color-scheme:light!important;--bg:#eef0f2;--panel:#ffffff;--panel-light:#e7eaed;--line:#c9cdd2;--line-dark:#bcc1c7;--text:#20242a;--muted:#575e66;--dim:#878e96;--accent:#c26a36;--mint:#3f8f63;}
html[data-theme="light"] input,html[data-theme="light"] select{background:#fff;color:#20242a;border-color:#c9cdd2}
html[data-theme="light"] button:not(:disabled):hover{background:rgba(0,0,0,.06);color:#20242a}
html[data-theme="light"] .status-led{filter:hue-rotate(0deg)}
</style>
"""
SO_LIGHT = """
<style id="rw-light-theme">
html[data-theme="light"]{color-scheme:light!important;--bg:#eef0f2;--panel:#ffffff;--panel-deep:#e7eaed;--panel-raised:#f7f8fa;--line:#c9cdd2;--line-soft:#dfe2e6;--text:#20242a;--muted:#575e66;--dim:#878e96;--accent:#1a8f6a;--accent-strong:#0f6b4f;--accent-bg:#dcefe6;--input:#ffffff;}
html[data-theme="light"] button:not(:disabled):hover{background:rgba(0,0,0,.06)}
</style>
"""

# 子工具主题监听脚本（放到 </body> 前，确保工具自身脚本后运行）
def inject(html, light_css, tool):
    if '<style id="rw-light-theme">' not in html:
        if '</head>' in html:
            html = html.replace('</head>', light_css + '</head>', 1)
        else:
            html = light_css + html
    listener = """
<script>
(function(){
  var t=new URLSearchParams(location.search).get('theme');
  if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;
  window.addEventListener('message',function(e){
    var d=e.data; if(!d||typeof d!=='object')return;
    if(d.type==='studio:theme'&&(d.theme==='light'||d.theme==='dark'))document.documentElement.dataset.theme=d.theme;
  });
  try{parent.postMessage({type:'studio:child-ready',tool:'TOOL_NAME'},'*');}catch(e){}
})();
</script>
""".replace('TOOL_NAME', tool)
    if 'studio:child-ready' not in html:
        idx = html.rfind('</body>')
        html = html[:idx] + listener + html[idx:] if idx != -1 else html + listener
    return html

PG = inject(PG, PG_LIGHT, 'pulsegrid')
SO = inject(SO, SO_LIGHT, 'sonora')

# 把内联 HTML 变成可安全嵌入 <script> 字符串的 JS 字面量
def jsstr(s):
    return s.replace('\\', '\\\\').replace('`', '\\`').replace('</script', '<\\/script').replace('${', '\\${')

PG_JS, SO_JS = jsstr(PG), jsstr(SO)

STUDIO = """<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Audio Studio</title>
<style>
:root{color-scheme:dark;--s-bg:#181a1d;--s-panel:#23262a;--s-line:#3a3e44;--s-text:#e0e2e6;--s-muted:#9aa0a8;--s-accent:#ec956e;--s-accent2:#8ad8b5}
html[data-theme="light"]{color-scheme:light;--s-bg:#e8eaed;--s-panel:#ffffff;--s-line:#c9cdd2;--s-text:#20242a;--s-muted:#575e66;--s-accent:#c26a36;--s-accent2:#1a8f6a}
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:var(--s-bg);color:var(--s-text);font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
#bar{height:38px;display:flex;align-items:center;gap:6px;padding:0 10px;background:var(--s-panel);border-bottom:1px solid var(--s-line);user-select:none}
#bar .brand{font-weight:600;font-size:12px;margin-right:8px;letter-spacing:.3px}
#bar .brand i{font-style:normal;color:var(--s-accent)}
#bar .sp{flex:1}
#bar button{border:1px solid var(--s-line);background:transparent;color:var(--s-muted);border-radius:5px;padding:5px 11px;cursor:pointer;font-size:11px}
#bar button:hover{border-color:var(--s-accent)}
#bar button.active{background:var(--s-accent);border-color:var(--s-accent);color:#1b1c1e;font-weight:600}
#bar .theme{border-radius:50%;width:26px;height:26px;padding:0;display:flex;align-items:center;justify-content:center}
#stage{height:calc(100% - 38px)}
.frame{width:100%;height:100%;border:0;background:var(--s-bg)}
.split{display:flex}
.split .frame{width:50%;height:100%}
.split .sep{width:1px;background:var(--s-line)}
.hide{display:none}
.credit{position:fixed;bottom:2px;right:6px;font-size:9px;color:var(--s-muted);opacity:.55;pointer-events:none}
</style>
</head>
<body>
<div id="bar">
  <span class="brand">Audio <i>Studio</i></span>
  <button data-mode="split" class="active" title="Show both studios side by side">▦ Big View</button>
  <button data-mode="pulsegrid" title="Edit in Pulsegrid Studio">Pulsegrid</button>
  <button data-mode="sonora" title="Edit in Sonora Studio">Sonora</button>
  <span class="sp"></span>
  <button class="theme" id="themeBtn" title="Toggle dark / light theme">◐</button>
</div>
<div id="stage" class="split">
  <iframe id="pg" class="frame" title="Pulsegrid Studio"></iframe>
  <div class="sep"></div>
  <iframe id="so" class="frame" title="Sonora Studio"></iframe>
</div>
<div class="credit">Pulsegrid Studio & Sonora Studio — independent open-source works, bundled intact.</div>
<script>
(function(){
  var PG_HTML = `__PG_HTML__`;
  var SO_HTML = `__SO_HTML__`;
  var pg=document.getElementById('pg'), so=document.getElementById('so'), stage=document.getElementById('stage');
  var mode='split', theme='dark';

  function loadFrames(){
    if(!pg.dataset.loaded){ pg.dataset.loaded='1'; pg.srcdoc=PG_HTML; }
    if(!so.dataset.loaded){ so.dataset.loaded='1'; so.srcdoc=SO_HTML; }
  }
  function applyMode(){
    loadFrames();
    if(mode==='split'){ stage.className='split'; pg.classList.remove('hide'); so.classList.remove('hide'); stage.querySelector('.sep').classList.remove('hide'); }
    else if(mode==='pulsegrid'){ stage.className=''; pg.classList.remove('hide'); so.classList.add('hide'); stage.querySelector('.sep').classList.add('hide'); }
    else { stage.className=''; so.classList.remove('hide'); pg.classList.add('hide'); stage.querySelector('.sep').classList.add('hide'); }
    document.querySelectorAll('#bar button[data-mode]').forEach(function(b){ b.classList.toggle('active', b.dataset.mode===mode); });
    pushTheme();
  }
  function setTheme(t){
    if(t!=='light'&&t!=='dark')return;
    theme=t; document.documentElement.dataset.theme=t; pushTheme();
  }
  function pushTheme(){
    var msg={type:'studio:theme',theme:theme};
    try{ if(pg.contentWindow)pg.contentWindow.postMessage(msg,'*'); }catch(e){}
    try{ if(so.contentWindow)so.contentWindow.postMessage(msg,'*'); }catch(e){}
    try{ parent.postMessage({type:'studio:theme-ack',theme:theme},'*'); }catch(e){}
  }
  document.querySelectorAll('#bar button[data-mode]').forEach(function(b){
    b.addEventListener('click',function(){ mode=b.dataset.mode; applyMode(); });
  });
  document.getElementById('themeBtn').addEventListener('click',function(){
    setTheme(theme==='dark'?'light':'dark');
  });
  window.addEventListener('message',function(e){
    var d=e.data; if(!d||typeof d!=='object')return;
    if(d.type==='studio:theme')setTheme(d.theme);
    else if(d.type==='studio:mode'&&['split','pulsegrid','sonora'].indexOf(d.mode)>=0){ mode=d.mode; applyMode(); }
  });
  // Follow host editor theme automatically: host sets data-gui-theme on <html>.
  function hostThemeIsLight(){
    try{
      var hd=window.parent.document.documentElement;
      var g=(hd.getAttribute('data-gui-theme')||'').toLowerCase();
      if(g.indexOf('light')>=0||g.indexOf('neumorphism')>=0)return true;
      if(g.indexOf('dark')>=0)return false;
      var cs=window.getComputedStyle(hd).getPropertyValue('--page-background').trim();
      if(cs){var m=cs.match(/\\d+/g);if(m&&m.length>=3&&(parseInt(m[0])+parseInt(m[1])+parseInt(m[2]))/3>128)return true;}
    }catch(e){}
    return false;
  }
  function syncHostTheme(){ setTheme(hostThemeIsLight()?'light':'dark'); }
  syncHostTheme();
  try{
    var hd=window.parent.document.documentElement;
    new MutationObserver(syncHostTheme).observe(hd,{attributes:true,attributeFilter:['data-gui-theme','style']});
  }catch(e){}
  // ready to host
  try{ parent.postMessage({type:'studio:ready'},'*'); }catch(e){}
  applyMode();
})();
</script>
</body>
</html>
""".replace('__PG_HTML__', PG_JS).replace('__SO_HTML__', SO_JS)

OUT = os.path.join(D, 'studio-merged.html')
io.open(OUT, 'w', encoding='utf-8').write(STUDIO)
print('built studio-merged.html', len(STUDIO.encode('utf-8')), 'bytes')
print('copyright markers PG/SO:', PG.count('independent implementation'), SO.count('independent implementation'))
