// Simulates "hold for 1 second": averages windows of consecutive held-back frames, applies the app's rule.
const fs=require("fs"),path=require("path"),tf=require("@tensorflow/tfjs-node"),sharp=require("sharp");
const ROOT=path.join(__dirname,".."),P=ROOT+"/training-photos",M=JSON.parse(fs.readFileSync(ROOT+"/app/model2/meta.json"));
const boxes=JSON.parse(fs.readFileSync(P+"/boxes.json"));
const comb=(id,sh,mk)=>{const v=M.ids.map((k,i)=>id[i]*sh[M.shells.indexOf(M.shellOf[k])]*mk[M.marks.indexOf(M.markOf[k])]);const s=v.reduce((a,b)=>a+b);return v.map(x=>x/s)};
(async()=>{
 const reader=await tf.loadLayersModel("file://"+ROOT+"/app/model2/reader/model.json");
 const seq={};
 for(const k of M.ids){const cam=fs.readdirSync(P+"/"+k).filter(f=>/^cam_/.test(f)).sort();seq[k]=[];
  const items=cam.slice(Math.floor(cam.length*.75)).filter(f=>Array.isArray(boxes[k+"/"+f]));
  const bufs=await Promise.all(items.map(async f=>{const file=P+"/"+k+"/"+f,m=await sharp(file).metadata(),W=m.width;const [x0,y0,x1,y1]=boxes[k+"/"+f],cx=(x0+x1)/2*W,cy=(y0+y1)/2*W,s=Math.max(x1-x0,y1-y0)*W*1.35,pad=200;
   const big=await sharp(file).extend({top:pad,bottom:pad,left:pad,right:pad,extendWith:"mirror"}).raw().toBuffer({resolveWithObject:true});
   return sharp(big.data,{raw:big.info}).extract({left:Math.round(cx-s/2+pad),top:Math.round(cy-s/2+pad),width:Math.round(s),height:Math.round(s)}).resize(224,224).raw().toBuffer();}));
  const out=tf.tidy(()=>reader.predict(tf.stack(bufs.map(b=>tf.tensor3d(new Uint8Array(b),[224,224,3]))).toFloat().div(127.5).sub(1)));
  const [I,S,K]=out.map(t=>t.arraySync());tf.dispose(out);
  I.forEach((_,j)=>seq[k].push({p:comb(I[j],S[j],K[j]),shell:M.shells[S[j].indexOf(Math.max(...S[j]))]}));}
 for(const W of [1,3,5]){let ans=0,ok=0,tot=0;const wrong={};
  for(const k of M.ids){const s=seq[k];for(let i=0;i+W<=s.length;i++){const w=s.slice(i,i+W);tot++;
   const avg=M.ids.map((_,j)=>w.reduce((a,f)=>a+f.p[j],0)/W);const g=avg.indexOf(Math.max(...avg)),key=M.ids[g];
   const vote=["dark","milk","white","milkwhite"].map(v=>[v,w.filter(f=>f.shell===v).length]).sort((a,b)=>b[1]-a[1])[0][0];
   if(avg[g]>=0.5&&M.shellOf[key]===vote){ans++;if(key===k)ok++;else wrong[k+"→"+key]=(wrong[k+"→"+key]||0)+1;}}}
  console.log(`averaging ${W} distinct views: answers ${(100*ans/tot).toFixed(0)}% of holds, right ${(100*ok/ans).toFixed(1)}% | wrong: ${Object.entries(wrong).map(([a,b])=>a+"×"+b).join(" ")}`);}
})();
