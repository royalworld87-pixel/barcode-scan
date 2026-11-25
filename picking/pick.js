// 拣货核对：picking list 表格按行解析 + 拣货比对（浏览器和 node 共用）
(function(G){
const nrm=s=>{s=String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 if(s.length>2&&(s.match(/\d/g)||[]).length>=s.length*0.6)s=s[0]+s.slice(1,-1).replace(/[ODQ]/g,'0').replace(/[IL]/g,'1')+s.slice(-1);return s;};
function ed(a,b){const m=a.length,n=b.length,d=[...Array(m+1)].map((_,i)=>[i,...Array(n).fill(0)]);for(let j=1;j<=n;j++)d[0][j]=j;
 for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]!=b[j-1]));return d[m][n];}
// 两个码是否相同：0=不同 2=完全相同 1=差一个字（长码才放宽）
function same(a,b){a=nrm(a);b=nrm(b);if(!a||!b)return 0;if(a==b)return 2;if(Math.min(a.length,b.length)>=6&&ed(a,b)<=1)return 1;return 0;}
const HDR={sku:/^(SKU|PPN|ITEM|ITEMCODE|ITEMNO|CODE|PRODUCT|PRODUCTCODE|MATERIAL|PART|PARTNO|ARTICLE|REF|CAT|CATNO|物料|编码|货号|品号)/,
 batch:/^(BATCH|LOT|BATCHNO|LOTNO|BATCHLOT|LOTBATCH|BN|批号|批次)/,qty:/^(QTY|QUANTITY|PCS|QTY\w*|PICKQTY|数量|件数)/,
 desc:/^(DESC|DESCRIPTION|NAME|PRODUCTNAME|ITEMNAME|品名|名称|描述)/,no:/^(NO|LINE|#|序号|S\/N)$/,loc:/^(LOC|LOCATION|BIN|库位|储位)/,
 exp:/^(EXP|EXPIRY|EXPIRYDATE|有效期)/,uom:/^(UOM|UNIT|单位)/};
function hdrKind(t){const s=String(t).toUpperCase().replace(/[\s.:_\-]/g,'');
 if(/BATCH|LOT|批号|批次/.test(s))return 'batch';if(/QTY|QUANTITY|数量/.test(s))return 'qty';for(const k of ['sku','qty','desc','loc','exp','uom','no'])if(HDR[k].test(s))return k;
 if(/ITEM|SKU|物料|编码/.test(s))return 'sku';return null;}
// 把 OCR 框分成行
function rows(items){let its=items.filter(i=>String(i.text).trim()).map(i=>({...i,cx:(i.x0+i.x1)/2,cy:(i.y0+i.y1)/2,h:i.y1-i.y0}));
 const hs=its.map(i=>i.h).sort((a,b)=>a-b),mh=hs[hs.length>>1]||10;
 // 照片有点歪：试 -8°..8°，挑让最多框排成一行的角度
 let bestA=0,bestS=-1;for(let a=-8;a<=8.01;a+=0.25){const t=Math.tan(a*Math.PI/180),ys=its.map(i=>i.cy-t*i.cx);let sc=0;
  for(let i=0;i<ys.length;i++)for(let j=i+1;j<ys.length;j++){const d=Math.abs(ys[i]-ys[j]);if(d<mh*0.3&&Math.abs(its[i].cx-its[j].cx)>mh)sc+=1-d/(mh*0.3);}
  if(sc>bestS+1e-9||(Math.abs(sc-bestS)<1e-9&&Math.abs(a)<Math.abs(bestA))){bestS=sc;bestA=a;}}
 const t=Math.tan(bestA*Math.PI/180);its.forEach(i=>i.yy=i.cy-t*i.cx);its.sort((a,b)=>a.yy-b.yy);const out=[];
 for(const it of its){const L=out.find(l=>Math.abs(l.yy-it.yy)<Math.max(mh*0.5,Math.min(l.h,it.h)*0.5));
  if(L){L.items.push(it);L.yy=L.items.reduce((s,i)=>s+i.yy,0)/L.items.length;}else out.push({yy:it.yy,h:it.h,items:[it]});}
 out.sort((a,b)=>a.yy-b.yy);out.forEach(l=>{l.items.sort((a,b)=>a.x0-b.x0);l.h=Math.max(...l.items.map(i=>i.h));});out.angle=bestA;return out;}
// 一个框横跨几栏时，按字的位置把字词拆开
function tokens(it){const t=String(it.text).trim(),parts=t.split(/\s+/);if(parts.length<2)return [{text:t,cx:(it.x0+it.x1)/2,x0:it.x0,x1:it.x1}];
 const w=(it.x1-it.x0)/Math.max(1,t.length);let pos=0,out=[];for(const p of parts){const i=t.indexOf(p,pos);out.push({text:p,x0:it.x0+i*w,x1:it.x0+(i+p.length)*w,cx:it.x0+(i+p.length/2)*w});pos=i+p.length;}return out;}
const isCode=s=>{const v=nrm(s);return v.length>=4&&/\d/.test(v);};
// 页脚、单据号、地址这类行
const FOOT=/RPT_|DOCUMENT\s*NO|\bPAGE\s*\d|PRINTED\s*(BY|ON)|\b(SO|PL|DN|PO|DO)\s?\d{6,}\b|CUSTOMER|ORDER\s*NOTES?|ADDRESS|SIGNATURE/i;
const isPPN=s=>/^V\d{6,}$/i.test(s);
const isSku=s=>isCode(s)&&!/_/.test(s)&&!/^RPT/i.test(s)&&!/^(SO|PL|DN|PO|DO)\d{6,}$/i.test(nrm(s))&&nrm(s).length<=20;
const isQty=s=>/^\d{1,4}([.,]\d+)?$/.test(String(s).replace(/(PCS|EA|BOX|CTN|PC|UNITS?)$/i,'').trim());
function parseList(items){const R=rows(items);let hi=-1,cols=[];
 // 表头被读成上下两行（备用引擎常见）：相邻两行一个有 SKU、一个有批号，就合成一行
 const kindsOf=l=>new Set(l.items.flatMap(tokens).map(t=>hdrKind(t.text)).filter(Boolean));
 for(let i=0;i+1<R.length;i++){const a=kindsOf(R[i]),b=kindsOf(R[i+1]);
  if(!(a.has('sku')&&a.has('batch'))&&((a.has('sku')&&b.has('batch'))||(a.has('batch')&&b.has('sku')))&&Math.abs(R[i+1].yy-R[i].yy)<Math.max(R[i].h,R[i+1].h)*1.6){
   R[i].items=R[i].items.concat(R[i+1].items).sort((x,y)=>x.x0-y.x0);R.splice(i+1,1);break;}}
 const mhOf=l=>{const v=l.items.map(i=>i.y1-i.y0).sort((a,b)=>a-b);return v[v.length>>1]||10;};
 const htoks=l=>{const t=l.items.flatMap(tokens).sort((a,b)=>a.x0-b.x0),o=[],hh=mhOf(l);for(const x of t){const p=o[o.length-1];if(p&&x.x0-p.x1<hh*0.35&&/^[A-Za-z]+$/.test(p.text+x.text)&&!hdrKind(p.text)&&!hdrKind(x.text)&&(Math.min(p.text.length,x.text.length)<=2||hdrKind(p.text+x.text))){p.text+=x.text;p.x1=x.x1;p.cx=(p.x0+p.x1)/2;}else o.push({...x});}return o;};
 for(let i=0;i<R.length&&hi<0;i++){const ks=[];for(const tk of htoks(R[i])){const k=hdrKind(tk.text);if(k)ks.push({k,cx:tk.cx,x0:tk.x0,x1:tk.x1,text:tk.text});}
  // 表头 “Batch / Lot No” 会读成几个字：合并同类相邻的
  // “Sku Description” 是描述栏，不是 SKU 栏
  for(let j=0;j+1<ks.length;j++)if(ks[j].k=='sku'&&ks[j+1].k=='desc'&&ks[j+1].x0-ks[j].x1<mhOf(R[i])*1.5&&/^SKU$/i.test(ks[j].text))ks[j].k='desc';
  const kinds=new Set(ks.map(x=>x.k));if(kinds.has('sku')&&kinds.has('batch')){hi=i;
   for(const x of ks){const p=cols.find(c=>c.k==x.k&&x.x0-c.x1<(mhOf(R[i])*3));if(p){p.x1=Math.max(p.x1,x.x1);p.cx=(p.x0+p.x1)/2;}else cols.push({...x});}
   // 表头里其他栏（不认识的字）也当一栏，免得别栏的字被硬塞进 SKU/批号
   for(const tk of htoks(R[i]))if(!hdrKind(tk.text)&&/[A-Za-z\u4e00-\u9fff]{2,}/.test(tk.text)&&(tk.x1-tk.x0)<=mhOf(R[i])*0.9*tk.text.length+mhOf(R[i])&&!cols.some(c=>tk.x1>=c.x0&&tk.x0<=c.x1))cols.push({k:'other',cx:tk.cx,x0:tk.x0,x1:tk.x1,text:tk.text});}}
 const out=[];
 if(hi>=0){cols.sort((a,b)=>a.cx-b.cx);
  // 栏的边界 = 相邻两栏中间
  for(let i=0;i<cols.length;i++){cols[i].L=i?(cols[i-1].x1+cols[i].x0)/2:-1e9;cols[i].R=i<cols.length-1?(cols[i].x1+cols[i+1].x0)/2:1e9;}
  // 码通常左对齐、比表头宽：用这一栏实际数据的位置再校一次（简单：按中心落在哪个区间）
  const recs=[];
  for(let i=hi+1;i<R.length;i++){const cell={};
   // 表格下面隔了一大片空白的是页脚
   if(recs.length&&R[i].yy-recs[recs.length-1].yy>Math.max(8*recs[recs.length-1].h,3*Math.max(1,recs[recs.length-1].pitch||0)))break;
   const rowText=R[i].items.map(x=>x.text).join(' ').trim();
   if(/^(TOTAL|合计|总计|SUBTOTAL)/i.test(rowText)||/RPT_|DOCUMENT\s*NO/i.test(rowText))break;
   if(FOOT.test(rowText))continue;
   for(const it of R[i].items)for(const tk of tokens(it)){const c=cols.find(c=>tk.cx>=c.L&&tk.cx<c.R)||cols[0];(cell[c.k]=cell[c.k]||[]).push({...tk,h:it.y1-it.y0,cy:(it.y0+it.y1)/2});}
   // 一格里只取第一串（字和字隔得很开的，是隔壁栏没认出来的内容）
   const g=k=>{const a=(cell[k]||[]).sort((x,y)=>x.x0-y.x0);if(!a.length)return '';let o=[a[0].text];
    for(let j=1;j<a.length;j++){if(a[j].x0-a[j-1].x1>Math.min(a[j].h,a[j-1].h)*0.9)break;o.push(a[j].text);}return o.join(' ').trim();};
   // 码里常有空格被拆开：SKU/批号栏去掉空格
   // SKU 栏上下叠两行（PPN 在上、货物编号在下）被分进同一行时，按高度拆开
   let stack=[];{const a=(cell.sku||[]).filter(x=>isSku(x.text)).sort((x,y)=>x.cy-y.cy);for(const x of a){const p=stack[stack.length-1];if(p&&x.cy-p.cy>x.h*0.6&&Math.min(x.x1,p.x1)-Math.max(x.x0,p.x0)>0)stack.push(x);else if(!p)stack.push(x);}}
   let sku=g('sku').replace(/\s+/g,'').toUpperCase(),batch=g('batch').replace(/\s+/g,'').toUpperCase(),qty=((cell.qty||[]).map(x=>x.text).find(x=>/^\d{1,5}([.,]\d+)?$/.test(x))||''),loc=g('loc').replace(/\s+/g,'').toUpperCase();
   let ppn='';
   if(stack.length>1){const P=stack.find(x=>isPPN(x.text)),N=stack.find(x=>!isPPN(x.text));if(P&&N){sku=N.text.toUpperCase();ppn=P.text.toUpperCase();}}
   if(!isSku(sku))sku='';if(!isCode(batch)||/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/.test(batch))batch='';
   const q=(qty.match(/\d+(?:[.,]\d+)?/)||[''])[0];
   if(!sku&&!batch)continue;
   const pv=recs[recs.length-1];recs.push({sku,ppn,batch,qty:q,loc,yy:R[i].yy,h:mhOf(R[i]),pitch:pv?R[i].yy-pv.yy:0});}
  // SKU/PPN 栏上下叠两行：V+数字 是 PPN，另一行是货物编号 → 合成一行，用货物编号做 SKU
  for(let i=0;i+1<recs.length;i++){const a=recs[i],b=recs[i+1];if(!a.sku||!b.sku||a.ppn||b.ppn)continue;const pa=isPPN(a.sku),pb=isPPN(b.sku);
   if(pa!=pb&&Math.abs(b.yy-a.yy)<Math.max(a.h,b.h)*2.6){const m={sku:pa?b.sku:a.sku,ppn:pa?a.sku:b.sku,batch:a.batch||b.batch,qty:a.qty||b.qty,loc:a.loc||b.loc,yy:a.yy,h:a.h};recs.splice(i,2,m);}}
  let last=null;
  for(const r of recs){
   if(!r.sku&&r.batch&&last){out.push({sku:last.sku,ppn:last.ppn,batch:r.batch,qty:r.qty,loc:r.loc||last.loc});continue;} // 同一 SKU 多个批号
   if(!r.sku)continue;
   if(isPPN(r.sku)){r.ppn=r.sku;} // 只有 PPN 的行也留着，用 PPN 当 SKU
   last=r;out.push({sku:r.sku,ppn:r.ppn||'',batch:r.batch,qty:r.qty,loc:r.loc});}
  return {rows:out.map(r=>({sku:r.sku,ppn:r.ppn||'',batch:r.batch||'',qty:r.qty?Math.max(1,Math.round(parseFloat(String(r.qty).replace(',','.')))):1,loc:r.loc||''})),header:true};}
 // 没找到表头：每一行里第一个像码的当 SKU，第二个当批号，小整数当数量
 for(const r of R){const tk=r.items.flatMap(tokens).map(t=>t.text);if(FOOT.test(tk.join(' ')))continue;const codes=tk.filter(t=>isSku(t)&&!/^\d{1,4}$/.test(t)&&!/^20\d\d[-\/.]\d/.test(t));
  if(codes.length<2)continue;const q=tk.filter(t=>/^\d{1,3}$/.test(t)).pop();out.push({sku:codes[0].toUpperCase(),batch:codes[1].toUpperCase(),qty:q?+q:1});}
 return {rows:out,header:false};}
// 用清单反查标签原文：清单里的码在原文里出现，就最可信
function guessFromList(list,texts,fallback){
 // 只认“完全一样”的码（允许被空格拆成 2–3 段），差一个字的不算，免得把读错的批号硬改成清单上的
 const W=new Set();for(const t of texts)for(const line of t.split('\n')){const w=line.split(/[\s:#()\[\]|]+/).map(nrm).filter(Boolean);
  for(let i=0;i<w.length;i++){let c='';for(let j=i;j<Math.min(w.length,i+3);j++){c+=w[j];W.add(c);}}}
 const hit=c=>{const v=nrm(c);return v.length>=3&&W.has(v)?1:0;};
 let best=null;for(const r of list){const s=Math.max(hit(r.sku),r.ppn?hit(r.ppn):0),b=r.batch?hit(r.batch):0,sc=s*3+b*2;if(sc>0&&(!best||sc>best.sc))best={sc,s,b,r};}
 const out={sku:fallback.sku||'',batch:fallback.batch||'',from:'ocr'};
 if(best&&best.s){out.sku=best.r.sku;out.from='list';
  if(best.b)out.batch=best.r.batch;else{const alt=list.find(r=>nrm(r.sku)==nrm(best.r.sku)&&r.batch&&hit(r.batch));if(alt)out.batch=alt.batch;}}
 else if(best&&best.b&&!fallback.batch)out.batch=best.r.batch;
 return out;}
// 核对：picks=[{sku,batch,qty}] → 每行状态 + 每件拣货状态
function check(list,picks){const got=list.map(()=>0),res=[];
 for(const p of picks){const sk=r=>Math.max(same(r.sku,p.sku),r.ppn?same(r.ppn,p.sku):0);const ex=list.map((r,i)=>({r,i})).filter(x=>sk(x.r)==2),fz=list.map((r,i)=>({r,i})).filter(x=>sk(x.r)==1);
  if(!ex.length){res.push(fz.length?{st:'maybe',msg:'SKU 差一个字：清单是 '+fz.map(x=>x.r.sku).join(' / ')+'。如果是读错，按 ✕ 删掉，改好再加'}:{st:'notinlist',msg:'清单里没有这个 SKU'});continue;}
  const ok=ex.filter(x=>!x.r.batch||same(x.r.batch,p.batch)==2);
  if(!ok.length){const near=ex.filter(x=>x.r.batch&&same(x.r.batch,p.batch)==1);
   res.push(near.length?{st:'maybe',msg:'批号差一个字：清单是 '+near.map(x=>x.r.batch).join(' / ')+'，可能是别的批，请看清楚标签。如果是读错，按 ✕ 删掉，改好再加'}
    :{st:'badbatch',msg:'SKU 对，批号不对。清单要：'+ex.map(x=>x.r.batch).join(' / ')});continue;}
  const t=ok.find(x=>got[x.i]<(x.r.qty||1))||ok[0];got[t.i]+=(p.qty||1);const need=t.r.qty||1;
  res.push({st:got[t.i]>need?'over':'ok',row:t.i,msg:got[t.i]>need?'这一行拿多了（第 '+(t.i+1)+' 行要 '+need+'，现在 '+got[t.i]+'）':'对上第 '+(t.i+1)+' 行（'+got[t.i]+'/'+need+'）'});}
 const rowsSt=list.map((r,i)=>({got:got[i],need:r.qty||1,st:got[i]==0?'todo':got[i]<(r.qty||1)?'part':got[i]==(r.qty||1)?'done':'over'}));
 return {picks:res,rows:rowsSt};}
G.Pick={nrm,same,rows,parseList,guessFromList,check,hdrKind};
if(typeof module!='undefined')module.exports=G.Pick;
})(typeof window!='undefined'?window:globalThis);
