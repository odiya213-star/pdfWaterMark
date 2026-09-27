/* All document bytes stay in this browser. pdf-lib and JSZip are bundled locally. */
const $ = (id) => document.getElementById(id);
const fileInput = $('fileInput'), dropZone = $('dropZone'), nameInput = $('printerName'), ipInput = $('ipAddress');
let selectedFiles = [];
let watermarkFontBytes;
let previewScale = 1, previewTimer, previewJob = 0, previewUrl;

function nowText() { return new Intl.DateTimeFormat('ko-KR', { dateStyle:'medium', timeStyle:'medium', hour12:false }).format(new Date()); }
function safeFileName(name) { return name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_'); }
function base64ToBytes(value) { const raw=atob(value); const bytes=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i); return bytes; }
function updateTime() { $('timestamp').value = nowText(); }
function updatePreview() { schedulePreview(); }
function updateFiles() { const count=selectedFiles.length; $('readyCount').textContent=`${count}개`; $('fileSummary').textContent=count ? `${count}개 선택됨 · ${selectedFiles.map(f=>f.name).join(', ')}` : '아직 선택된 PDF가 없습니다.'; $('clearFiles').disabled=!count; $('downloadEach').disabled=!count; $('downloadZip').disabled=!count; }
function setFiles(files) { selectedFiles=[...files].filter(f => f.type==='application/pdf' || /\.pdf$/i.test(f.name)); updateFiles(); schedulePreview(); if(files.length && !selectedFiles.length) $('status').textContent='PDF 파일만 선택할 수 있습니다.'; }
fileInput.addEventListener('change', e => setFiles(e.target.files));
['dragenter','dragover'].forEach(type=>dropZone.addEventListener(type,e=>{e.preventDefault();dropZone.classList.add('dragging');}));
['dragleave','drop'].forEach(type=>dropZone.addEventListener(type,e=>{e.preventDefault();dropZone.classList.remove('dragging');}));
dropZone.addEventListener('drop',e=>setFiles(e.dataTransfer.files));
$('clearFiles').addEventListener('click',()=>{selectedFiles=[];fileInput.value='';updateFiles();});
[nameInput,ipInput].forEach(el=>el.addEventListener('input',updatePreview));

async function discoverPublicIp() {
  ipInput.placeholder='공개 IP 확인 중…';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch('https://api64.ipify.org?format=json', { signal: controller.signal, cache:'no-store' });
    clearTimeout(timeout);
    if (!response.ok) throw new Error('IP lookup failed');
    const { ip } = await response.json();
    if (!/^([0-9]{1,3}\.){3}[0-9]{1,3}$|^[0-9a-f:]+$/i.test(ip || '')) throw new Error('Invalid IP');
    ipInput.value = ip;
  } catch (_) {
    ipInput.value = '';
    ipInput.placeholder = 'IP 주소를 직접 입력하세요';
    $('status').textContent = '공개 IP를 확인하지 못했습니다. IP 주소를 직접 입력해 주세요.';
  }
  schedulePreview();
}
$('refreshIp').addEventListener('click',()=>{ipInput.value='';discoverPublicIp();});

function watermarkLines() { updateTime(); return [`출력자: ${nameInput.value.trim() || '미입력'}`, `IP: ${ipInput.value.trim() || '미확인'}`, `시간: ${$('timestamp').value}`]; }
async function makeWatermarkedPdf(file, lines, previewOnly = false) {
  const bytes = await file.arrayBuffer(); const pdf = await PDFLib.PDFDocument.load(bytes, {ignoreEncryption:true, throwOnInvalidObject:false, updateMetadata:false});
  // Standard PDF fonts only support Western encodings. Embed a Korean Unicode font instead.
  if (!watermarkFontBytes) {
    if (globalThis.WATERMARK_FONT_BASE64) watermarkFontBytes = base64ToBytes(globalThis.WATERMARK_FONT_BASE64);
    else {
      const response = await fetch('assets/malgun.ttf');
      if (!response.ok) throw new Error('워터마크 글꼴을 불러올 수 없습니다.');
      watermarkFontBytes = await response.arrayBuffer();
    }
  }
  const fontkitEngine = globalThis.fontkit?.default || globalThis.fontkit;
  if (!fontkitEngine) throw new Error('워터마크 글꼴 모듈을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
  pdf.registerFontkit(fontkitEngine);
  const font = await pdf.embedFont(watermarkFontBytes, {subset:true}); const color = PDFLib.rgb(0.10,0.31,0.50);
  if (previewOnly) while (pdf.getPageCount() > 1) pdf.removePage(pdf.getPageCount() - 1);
  const pages = pdf.getPages();
  for(const page of pages) { const {width,height}=page.getSize(); const size=Math.max(6,Math.min(width,height)/72); const gapX=Math.max(108,width/4), gapY=Math.max(72,height/5); for(let x=-width;x<width*1.5;x+=gapX){ for(let y=-height;y<height*1.6;y+=gapY){ page.drawText(lines.join('\n'),{x,y,size,font,color,opacity:.31,lineHeight:size*1.28,rotate:PDFLib.degrees(28)}); } } }
  return pdf.save();
}
function schedulePreview() { clearTimeout(previewTimer); previewTimer=setTimeout(renderPreview, 450); }
async function renderPreview() {
  const job=++previewJob, frame=$('previewFrame'), empty=$('previewEmpty'), mark=$('previewWatermark');
  if(!selectedFiles.length){frame.hidden=true;mark.hidden=true;empty.hidden=false;$('previewPage').textContent='PDF를 선택하세요';return;}
  $('previewPage').textContent='미리보기 생성 중…'; empty.hidden=false;empty.textContent='PDF를 여는 중…';
  try { const lines=watermarkLines(); if(job!==previewJob)return; if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(selectedFiles[0]);frame.src=`${previewUrl}#page=1&zoom=${Math.round(previewScale*100)}`;mark.textContent=lines.join('\n');frame.hidden=false;mark.hidden=false;empty.hidden=true;$('previewPage').textContent='첫 페이지 미리보기';
  } catch(err) { if(job!==previewJob)return;console.error(err);frame.hidden=true;mark.hidden=true;empty.hidden=false;empty.textContent='미리보기를 만들 수 없습니다.';$('previewPage').textContent='미리보기 오류'; }
}
$('zoomIn').addEventListener('click',()=>{previewScale=Math.min(2.5,previewScale+.25);$('zoomLevel').textContent=`${Math.round(previewScale*100)}%`;renderPreview();});
$('zoomOut').addEventListener('click',()=>{previewScale=Math.max(.5,previewScale-.25);$('zoomLevel').textContent=`${Math.round(previewScale*100)}%`;renderPreview();});
function download(blob,name) { const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000); }
async function processAll(asZip) {
  if(!selectedFiles.length) return; const button=asZip?$('downloadZip'):$('downloadEach'); const other=asZip?$('downloadEach'):$('downloadZip'); button.disabled=other.disabled=true; const lines=watermarkLines();
  try { $('status').textContent=`${selectedFiles.length}개 PDF에 워터마크를 삽입하는 중…`; const results=[]; for(let i=0;i<selectedFiles.length;i++){ $('status').textContent=`${i+1}/${selectedFiles.length} 처리 중: ${selectedFiles[i].name}`; const data=await makeWatermarkedPdf(selectedFiles[i],lines); results.push({name:`${safeFileName(selectedFiles[i].name)}_출력정보.pdf`,data}); }
    if(asZip){const zip=new JSZip();results.forEach(r=>zip.file(r.name,r.data));download(await zip.generateAsync({type:'blob'}),'출력정보_워터마크_PDF.zip');$('status').textContent='ZIP 파일을 다운로드했습니다.';} else {results.forEach(r=>download(new Blob([r.data],{type:'application/pdf'}),r.name));$('status').textContent='워터마크가 적용된 PDF 다운로드를 시작했습니다.';}
  } catch(err) { console.error(err); const detail=(err?.message || '').replace(/\s+/g,' ').slice(0,160); $('status').textContent=detail ? `PDF 처리 오류: ${detail}` : 'PDF 처리 중 알 수 없는 오류가 발생했습니다.'; } finally {button.disabled=other.disabled=false;}
}
$('downloadEach').addEventListener('click',()=>processAll(false)); $('downloadZip').addEventListener('click',()=>processAll(true)); updateTime();updatePreview();discoverPublicIp();
