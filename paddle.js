// 轻量 PaddleOCR（det + rec，onnxruntime-web），不需要 opencv。浏览器和 node 共用。
(function(G){
const P={det:null,rec:null,dict:null,recH:48};
async function init(ort,base,fetchBuf){
 const opt={executionProviders:['wasm']};
 const [d,r,t]=await Promise.all([fetchBuf(base+'det.onnx'),fetchBuf(base+'rec.onnx'),fetchBuf(base+'dict.txt')]);
 P.det=await ort.InferenceSession.create(new Uint8Array(d),opt);P.rec=await ort.InferenceSession.create(new Uint8Array(r),opt);
 P.dict=['',...new TextDecoder().decode(t).split(/\r?\n/).filter((x,i,a)=>!(i==a.length-1&&x==='')),' '];P.ort=ort;}
// 双线性缩放一块区域 → Float32 CHW (BGR)，带归一化
function crop(img,x0,y0,cw,ch,W,H,mean,std){const {data,width}=img,out=new Float32Array(3*W*H),sx=cw/W,sy=ch/H;
 for(let y=0;y<H;y++){let fy=y0+(y+0.5)*sy-0.5;fy=Math.max(0,Math.min(img.height-1,fy));const y1=Math.floor(fy),y2=Math.min(img.height-1,y1+1),wy=fy-y1;
  for(let x=0;x<W;x++){let fx=x0+(x+0.5)*sx-0.5;fx=Math.max(0,Math.min(width-1,fx));const x1=Math.floor(fx),x2=Math.min(width-1,x1+1),wx=fx-x1;
   for(let c=0;c<3;c++){const a=data[(y1*width+x1)*4+c],b=data[(y1*width+x2)*4+c],e=data[(y2*width+x1)*4+c],f=data[(y2*width+x2)*4+c];
    const v=((a*(1-wx)+b*wx)*(1-wy)+(e*(1-wx)+f*wx)*wy)/255;const ch2=2-c; // RGB→BGR
    out[ch2*W*H+y*W+x]=(v-mean[ch2])/std[ch2];}}}
 return out;}
async function detect(img,limit){const s=Math.min(2,limit/Math.max(img.width,img.height));
 const W=Math.max(32,Math.round(img.width*s/32)*32),H=Math.max(32,Math.round(img.height*s/32)*32);
 const inp=crop(img,0,0,img.width,img.height,W,H,[0.406,0.456,0.485],[0.225,0.224,0.229]);
 const o=await P.det.run({[P.det.inputNames[0]]:new P.ort.Tensor('float32',inp,[1,3,H,W])});const prob=o[P.det.outputNames[0]].data;
 const seen=new Uint8Array(W*H),boxes=[],q=new Int32Array(W*H);
 for(let i=0;i<W*H;i++){if(seen[i]||prob[i]<0.3)continue;let qh=0,qt=0,x0=W,y0=H,x1=0,y1=0,sum=0,n=0;q[qt++]=i;seen[i]=1;
  while(qh<qt){const j=q[qh++],x=j%W,y=(j/W)|0;sum+=prob[j];n++;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
   for(const k of [j-1,j+1,j-W,j+W]){if(k<0||k>=W*H||seen[k]||prob[k]<0.3)continue;if((k==j-1&&x==0)||(k==j+1&&x==W-1))continue;seen[k]=1;q[qt++]=k;}}
  if(n<6||sum/n<0.6)continue;const bw=x1-x0+1,bh=y1-y0+1;if(Math.min(bw,bh)<3)continue;
  const d=bw*bh*1.5/(2*(bw+bh)); // unclip
  boxes.push({x0:Math.max(0,(x0-d)/W*img.width),y0:Math.max(0,(y0-d)/H*img.height),x1:Math.min(img.width,(x1+1+d)/W*img.width),y1:Math.min(img.height,(y1+1+d)/H*img.height)});}
 return boxes;}
async function rec(img,b){const cw=b.x1-b.x0,ch=b.y1-b.y0,H=P.recH;let W=Math.round(cw/ch*H);W=Math.max(16,Math.min(W,1600));
 const inp=crop(img,b.x0,b.y0,cw,ch,W,H,[0.5,0.5,0.5],[0.5,0.5,0.5]);
 const o=await P.rec.run({[P.rec.inputNames[0]]:new P.ort.Tensor('float32',inp,[1,3,H,W])});const t=o[P.rec.outputNames[0]];const [_,T,C]=t.dims,d=t.data;
 let s='',last=0,cs=0,cn=0;for(let i=0;i<T;i++){let m=0,mv=-1;for(let c=0;c<C;c++)if(d[i*C+c]>mv){mv=d[i*C+c];m=c;}
  if(m&&m!=last){s+=P.dict[m]||'';cs+=mv;cn++;}last=m;}
 return {text:s,conf:cn?cs/cn:0};}
// 一张图 → 按行排好的文字
async function ocr(img,limit=960){const boxes=await detect(img,limit),items=[];
 for(const b of boxes){const r=await rec(img,b);if(r.text.trim())items.push({...b,...r});}
 items.sort((a,b)=>(a.y0+a.y1)-(b.y0+b.y1));const lines=[];
 for(const it of items){const cy=(it.y0+it.y1)/2,h=it.y1-it.y0;const L=lines.find(l=>Math.abs(l.cy-cy)<Math.min(l.h,h)*0.5);
  if(L){L.items.push(it);}else lines.push({cy,h,items:[it]});}
 lines.sort((a,b)=>a.cy-b.cy);
 return {text:lines.map(l=>l.items.sort((a,b)=>a.x0-b.x0).map(i=>i.text).join('  ')).join('\n'),items};}
G.PaddleLite={P,init,ocr};
})(typeof window!='undefined'?window:globalThis);
