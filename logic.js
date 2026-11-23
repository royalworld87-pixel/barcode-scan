// 拍照出条码：从 OCR 文字里找 SKU / Batch / Expiry（浏览器和 node 共用）
const MON={JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};
const CODE='(?<v>(?=[A-Z0-9\\-\\/.]*\\d)[A-Z0-9][A-Z0-9\\-\\/.]{2,}(?:\\s(?:[A-Z]{2,3}|(?=[A-Z0-9]*\\d)[A-Z0-9]{1,6})(?![\\w\\-\\/.]))*)';
// 关键词：容忍 OCR 错字和方框符号 [REF] [LOT]
const KEY={
 sku:new RegExp('(?:\\b(?:SKU|ITEM(?:\\s*(?:CODE|NO))?|ARTICLE(?:\\s*NO)?|PRODUCT\\s*CODE|CAT(?:ALOG)?\\.?\\s*NO|CODE|P\\/?N|MATERIAL)\\b|[\\[({|]?\\s*(?:REF|RER|BEF|BER|EEF|FEF|REE)\\s*[\\])}|]?)[\\s.:#]*(?:NO\\.?)?[\\s.:#]*'+CODE,'i'),
 batch:new RegExp('(?:\\b(?:BATCH|B\\/N|BN|CH\\.?-?B)\\b|[\\[({|]?\\s*(?:L[O0o]T|[1lI|][O0]T|LDT|L[O0]I)\\s*[\\])}|]?)[\\s.:#]*(?:NO\\.?)?[\\s.:#]*'+CODE.replace('{2,}','{1,}'),'i'),
 exp:/\b(?:EXP(?:IRY|IRATION|\.)?(?:[\s.]*DATE)?|EXD|USE\s*BY|BEST\s*BEFORE|BB|VAL(?:IDADE)?|SCAD(?:ENZA)?|MHD)\b[\s.:]*(?<v>\d{1,4}[\-\/. ][0-9A-Z]{1,4}(?:[\-\/. ]\d{2,4})?)/i};
function clean(v){v=(v||'').trim().toUpperCase();
 {const p=v.split(/\s+/);let o=p[0];
  for(let i=1;i<p.length;i++){if(/\d/.test(p[i])&&o.length+p[i].length<=20)o+=p[i];else if(i==1&&p.length==2&&/^\d{5,}$/.test(o)&&/^[A-Z]{2,3}$/.test(p[i]))o+=p[i];else break;}v=o;}
 v=v.replace(/[.,;:\-\/]+$/,'');
 // 码里夹在数字中间的 O/D/Q 多半是 0
 if((v.match(/\d/g)||[]).length>=v.length*0.6)v=v[0]+v.slice(1,-1).replace(/[ODQ]/g,'0')+v.slice(-1);
 return v;}
function ed(a,b){const m=a.length,n=b.length,d=[...Array(m+1)].map((_,i)=>[i,...Array(n).fill(0)]);for(let j=1;j<=n;j++)d[0][j]=j;
 for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]!=b[j-1]));return d[m][n];}
// 几次读到的差一两个字的码归成一组，逐个字投票
function merge(t){const keys=Object.keys(t).sort((a,b)=>t[b]-t[a]),groups=[];
 for(const k of keys){const g=groups.find(g=>g.items.some(x=>ed(x,k)<=Math.max(1,Math.floor(Math.min(x.length,k.length)/4))));if(g){g.items.push(k);g.s+=t[k];}else groups.push({items:[k],s:t[k]});}
 groups.sort((a,b)=>b.s-a.s);if(!groups.length)return '';const g=groups[0];
 // 短的是长的开头（G2F200X10 / G2F200X100）：算长的，读漏尾巴比多读常见
 const lenS={};g.items.forEach(x=>{const longer=g.items.filter(y=>y.length>x.length&&y.startsWith(x)).sort((a,b)=>b.length-a.length)[0];const L=longer?longer.length:x.length;lenS[L]=(lenS[L]||0)+t[x];});const L=+Object.entries(lenS).sort((a,b)=>b[1]-a[1]||b[0]-a[0])[0][0];
 const same=g.items.filter(x=>x.length==L);let out='';
 for(let i=0;i<L;i++){const c={};same.forEach(x=>c[x[i]]=(c[x[i]]||0)+t[x]);out+=Object.entries(c).sort((a,b)=>b[1]-a[1])[0][0];}
 return out;}
// 所有看起来像日期的（年份要合理）
function dates(text){const out=[],now=new Date().getFullYear();
 const re=/\b(20\d{2})[\-\/.](\d{1,2})(?:[\-\/.](\d{1,2}))?\b|\b(?:(\d{1,2})[\-\/. ])?(\d{1,2}|[A-Z]{3})[\-\/. ](20\d{2})\b|\b(20[2-4]\d)(0[1-9]|1[0-2])\b/gi;
 for(const m of text.matchAll(re)){const y=+(m[1]||m[6]||m[7]);let mo=m[2]||m[5]||m[8];mo=MON[String(mo).toUpperCase()]||+mo;const d=+(m[3]||m[4]||0);
  if(y>=now-5&&y<=now+15&&mo>=1&&mo<=12&&d<=31)out.push({t:m[0],k:y*10000+mo*100+d});}
 return out;}
// 没写关键词时的后备：批号 = 字母开头+数字的短码；SKU = 很长的数字码（可带字母尾）
const FB={batch:/\b[A-Z]{1,2}\d{4,8}[A-Z0-9]{0,2}\b/g,sku:/\b\d{6,13}(?:\s?[A-Z]{1,3})?\b/g};
// 一段文字 → 每格的候选
// GS1 括号码：(10)=批号 (17)=有效期 YYMMDD；(01)/(21)/S/N/GTIN 不能当 SKU 或批号
const GS1={lot:/[(\[{]\s*10\s*[)\]}]\s*(?<v>[A-Z0-9\-]{1,20})/gi,exp:/[(\[{]\s*17\s*[)\]}]\s*(?<v>\d{6})(?!\d)/gi,
 drop:/[(\[{]\s*\d{2,4}\s*[)\]}]\s*[A-Z0-9]+|\b(?:S\/?N|GTIN|UDI|SERIAL(?:\s*NO)?)\b\s*[:#.]?\s*[0-9A-Z]+(?:\s\d+)*/gi};
function gs1Date(v){const y=2000+ +v.slice(0,2),m=+v.slice(2,4);let d=+v.slice(4,6);if(m<1||m>12)return null;if(!d)d=new Date(y,m,0).getDate();
 const t=y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');return {t,k:y*10000+m*100+d};}
function candidates(text){const c={sku:[],batch:[],exp:[]};const T0=text.replace(/[“”"'‘’«»]/g,' ');
 for(const m of T0.matchAll(GS1.lot))c.batch.push({v:clean(m.groups.v),w:5});
 for(const m of T0.matchAll(GS1.exp)){const d=gs1Date(m.groups.v);if(d)c.exp.push({v:d.t,k:d.k,w:5,kw:1});}
 const sns=[...T0.matchAll(/\bS\/?N\b\s*[:#.]?\s*([0-9][0-9 ]{6,})/gi)].map(m=>m[1].replace(/\s/g,''));
 const T=T0.replace(GS1.drop,' ');
 // 单独的一串数字（可被空格隔开）正好是序号 S/N 的开头 → 很可能是批号
 if(sns.length)for(const m of T.matchAll(/\b\d{3,}(?: \d{2,})*\b/g)){const v=m[0].replace(/\s/g,'');if(v.length>=5&&sns.some(n=>n.startsWith(v)&&n.length>v.length))c.batch.push({v,w:4});}
 // 字母数字混合的长码（可被空格隔开：G2F 200 X100）当 SKU 后备
 for(const m of T.toUpperCase().matchAll(/\b[A-Z][A-Z0-9]*\d[A-Z0-9]*(?: (?=[A-Z0-9]*\d)[A-Z0-9]{1,6}){0,3}\b/g)){const v=m[0].replace(/\s/g,'');
  if(v.length>=7&&v.length<=16&&(v.match(/[A-Z]/g)||[]).length>=2&&(v.match(/\d/g)||[]).length>=3)c.sku.push({v,w:0.5});}
 for(const k of ['sku','batch','exp']){for(const line of T.split('\n')){const m=line.match(KEY[k]);if(m)c[k].push({v:clean(m.groups.v),w:3,kw:1});}}
 // 有效期：关键词后面那个；否则取最晚的日期
 const ds=dates(T);ds.forEach(d=>c.exp.push({v:d.t,k:d.k,w:1}));
 for(const m of T.toUpperCase().matchAll(FB.batch))if(!/^20\d{4}$/.test(m[0]))c.batch.push({v:m[0],w:1});
 for(const m of T.toUpperCase().matchAll(FB.sku)){const v=clean(m[0]);if(!/^20[2-4]\d(0[1-9]|1[0-2])$/.test(v))c.sku.push({v,w:1});}
 // SKU 和批号不要互相抢
 return c;}
function dateKey(t){const d=dates(t);return d.length?d[0].k:0;}
// 多次读字的结果投票
function vote(texts,opt={}){const tally={sku:{},batch:{},exp:{}};
 for(const t of texts){const c=candidates(t);
  for(const k of ['sku','batch']){const seen={};for(const x of c[k]){if(x.v.length<3)continue;seen[x.v]=Math.max(seen[x.v]||0,x.w);}for(const v in seen)tally[k][v]=(tally[k][v]||0)+seen[v];}
  const seen={};for(const x of c.exp){const key=x.k||dateKey(x.v);if(!key)continue;seen[key]=Math.max(seen[key]||0,x.w);seen['t'+key]=x.v;if(x.kw)seen['k'+key]=Math.max(seen['k'+key]||0,x.w);}
  for(const key in seen)if(/^\d/.test(key)){tally.exp[key]=(tally.exp[key]||0)+seen[key];if(!tally.exp['t'+key]||seen['k'+key])tally.exp['t'+key]=seen['t'+key];if(seen['k'+key])tally.exp['k'+key]=(tally.exp['k'+key]||0)+seen['k'+key];}}
 const best=o=>Object.entries(o).sort((a,b)=>b[1]-a[1]||b[0].length-a[0].length)[0];
 const r={};
 for(const k of ['sku','batch'])r[k]=merge(tally[k]);
 if(r.sku&&r.batch&&r.sku==r.batch)r.batch='';
 // 有效期：关键词命中的优先；不然在“读到不止一次”的日期里取最晚的；都只一次就取最晚
 const E=Object.entries(tally.exp).filter(e=>/^\d/.test(e[0])).map(([k,s])=>({k:+k,s,t:tally.exp['t'+k],kw:tally.exp['k'+k]||0}));
 const kw=E.filter(e=>e.kw).sort((a,b)=>b.kw-a.kw||b.s-a.s);
 // 过期日一般不会早于今天：早于今天的多半是生产日期
 const t=opt.today||new Date(),today=t.getFullYear()*10000+(t.getMonth()+1)*100;
 const fut=E.filter(e=>e.k>=today).sort((a,b)=>b.s-a.s||a.k-b.k);
 const multi=E.filter(e=>e.s>=2).sort((a,b)=>b.k-a.k);
 const pick=kw.length?kw[0]:fut.length?fut[0]:multi.length?multi[0]:E.sort((a,b)=>b.k-a.k)[0];
 r.exp=pick?pick.t:'';r.expPast=!!pick&&pick.k<today;
 r.tally=tally;return r;}
function toDMY(t){t=(t||'').trim().toUpperCase();if(!t||/^\d{8}$/.test(t))return t;
 let p;if(/^20\d{2}(0[1-9]|1[0-2])$/.test(t))p=[t.slice(0,4),t.slice(4)];else p=t.split(/[\s\-\/.]+/).filter(Boolean).map(x=>MON[x.slice(0,3)]||x);let d,m,y;
 if(p.length==2){if(String(p[0]).length==4){y=p[0];m=p[1]}else{m=p[0];y=p[1]}}
 else if(p.length==3){if(String(p[0]).length==4){y=p[0];m=p[1];d=p[2]}else{d=p[0];m=p[1];y=p[2]}}else return t;
 y=+y;m=+m;if(y<100)y+=2000;if(!(m>=1&&m<=12)||!(y>1990&&y<2100))return t;
 if(!d)d=new Date(y,m,0).getDate();d=+d;
 return String(d).padStart(2,'0')+String(m).padStart(2,'0')+y;}
if(typeof module!='undefined')module.exports={KEY,candidates,vote,toDMY,dates};
