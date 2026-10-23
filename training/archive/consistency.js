// How often are the reader's three opinions consistent, and how accurate is it when they are?
const fs=require("fs"),path=require("path"),tf=require("@tensorflow/tfjs-node"),sharp=require("sharp");
const ROOT=path.join(__dirname,".."),P=ROOT+"/training-photos",M=JSON.parse(fs.readFileSync(ROOT+"/app/model2/meta.json"));
const boxes=JSON.parse(fs.readFileSync(P+"/boxes.json"));
(async()=>{
 const reader=await tf.loadLayersModel("file://"+ROOT+"/app/model2/reader/model.json");
 const items=[];
 for(const k of M.ids){const cam=fs.readdirSync(P+"/"+k).filter(f=>/^cam_/.test(f)).sort();for(const f of cam.slice(Math.floor(cam.length*.75))){const b=boxes[k+"/"+f];if(Array.isArray(b))items.push({k,f:P+"/"+k+"/"+f,b});}}
 const rows=[];
 for(let i=0;i<items.length;i+=32){const batch=items.slice(i,i+32);
  const bufs=await Promise.all(batch.map(async a=>{const m=await sharp(a.f).metadata(),W=m.width;const [x0,y0,x1,y1]=a.b,cx=(x0+x1)/2*W,cy=(y0+y1)/2*W,s=Math.max(x1-x0,y1-y0)*W*1.35;
   const pad=200;const big=await sharp(a.f).extend({top:pad,bottom:pad,left:pad,right:pad,extendWith:"mirror"}).raw().toBuffer({resolveWithObject:true});
   return sharp(big.data,{raw:big.info}).extract({left:Math.round(cx-s/2+pad),top:Math.round(cy-s/2+pad),width:Math.round(s),height:Math.round(s)}).resize(224,224).raw().toBuffer();}));
  const out=tf.tidy(()=>reader.predict(tf.stack(bufs.map(b=>tf.tensor3d(new Uint8Array(b),[224,224,3]))).toFloat().div(127.5).sub(1)));
  const [I,S,K]=out.map(t=>t.arraySync());tf.dispose(out);
  batch.forEach((a,j)=>rows.push({k:a.k,id:I[j],sh:S[j],mk:K[j]}));}
 const am=a=>a.indexOf(Math.max(...a));
 const comb=r=>{const v=M.ids.map((k,i)=>r.id[i]*r.sh[M.shells.indexOf(M.shellOf[k])]*r.mk[M.marks.indexOf(M.markOf[k])]);const s=v.reduce((x,y)=>x+y);return v.map(x=>x/s)};
 for(const T of [0.6,0.75,0.9]){let ans=0,ok=0,ans2=0,ok2=0;
  for(const r of rows){const c=comb(r),g=am(c),key=M.ids[g],p=c[g];
   const consistent=M.shells[am(r.sh)]===M.shellOf[key]&&M.marks[am(r.mk)]===M.markOf[key];
   if(p>=T){ans++;if(key===r.k)ok++; if(consistent){ans2++;if(key===r.k)ok2++;}}}
  console.log(`threshold ${T}: answers ${ans}/${rows.length} right ${(100*ok/ans).toFixed(1)}% | with all-three-agree rule: answers ${ans2} right ${(100*ok2/ans2).toFixed(1)}%`);}
 let shOk=0,mkOk=0;rows.forEach(r=>{if(M.shells[am(r.sh)]===M.shellOf[r.k])shOk++;if(M.marks[am(r.mk)]===M.markOf[r.k])mkOk++;});
 console.log(`shell colour right ${(100*shOk/rows.length).toFixed(1)}%, digit count right ${(100*mkOk/rows.length).toFixed(1)}%`);
})();
