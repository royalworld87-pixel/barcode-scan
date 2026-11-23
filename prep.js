// shared: operates on RGBA Uint8ClampedArray
function prep(img,mode){const d=img.data,n=img.width*img.height,g=new Uint8Array(n),h=new Array(256).fill(0);
 for(let i=0;i<n;i++){const v=(d[i*4]*299+d[i*4+1]*587+d[i*4+2]*114)/1000|0;g[i]=v;h[v]++;}
 let lo=0,hi=255,c=0;while(c+h[lo]<n*0.01)c+=h[lo++];c=0;while(c+h[hi]<n*0.01)c+=h[hi--];if(hi<=lo)hi=lo+1;
 for(let i=0;i<n;i++){let v=(g[i]-lo)*255/(hi-lo);v=v<0?0:v>255?255:v;g[i]=v;}
 if(mode=='bin'){ // adaptive mean threshold via integral image
  const W=img.width,H=img.height,I=new Float64Array((W+1)*(H+1)),r=Math.max(8,Math.round(Math.max(W,H)/60));
  for(let y=0;y<H;y++){let s=0;for(let x=0;x<W;x++){s+=g[y*W+x];I[(y+1)*(W+1)+x+1]=I[y*(W+1)+x+1]+s;}}
  const o=new Uint8Array(n);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const x0=Math.max(0,x-r),x1=Math.min(W,x+r+1),y0=Math.max(0,y-r),y1=Math.min(H,y+r+1);
   const m=(I[y1*(W+1)+x1]-I[y0*(W+1)+x1]-I[y1*(W+1)+x0]+I[y0*(W+1)+x0])/((x1-x0)*(y1-y0));o[y*W+x]=g[y*W+x]<m-12?0:255;}
  for(let i=0;i<n;i++)g[i]=o[i];}
 for(let i=0;i<n;i++){d[i*4]=d[i*4+1]=d[i*4+2]=g[i];d[i*4+3]=255;}return img;}
if(typeof module!='undefined')module.exports=prep;
