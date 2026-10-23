const fs=require("fs"),path=require("path"),tf=require("@tensorflow/tfjs-node"),sharp=require("sharp");
const ROOT="/home/claude/scanner-app", P=ROOT+"/training-photos";
(async()=>{
 const base=await tf.loadGraphModel("file://"+ROOT+"/app/vendor/mobilenet/model.json");
 const heads={wide:await tf.loadLayersModel("file:///home/claude/runs/wide/head/model.json"),tight:await tf.loadLayersModel("file:///home/claude/runs/tight/head/model.json")};
 const labels=JSON.parse(fs.readFileSync("/home/claude/runs/wide/labels.json")).labels;
 const seqs=[];
 for(const l of labels){const cam=fs.readdirSync(P+"/"+l).filter(f=>/^cam_/.test(f)).sort(); seqs.push({l,files:cam.slice(Math.floor(cam.length*0.75)).map(f=>P+"/"+l+"/"+f)});}
 async function crop(f,fr){const m=await sharp(f).metadata();const s=m.width,c=Math.round(s*fr),o=Math.round((s-c)/2);return sharp(f).extract({left:o,top:o,width:c,height:c}).resize(224,224).removeAlpha().raw().toBuffer();}
 async function probs(files,fr,head){const bufs=await Promise.all(files.map(f=>crop(f,fr)));return tf.tidy(()=>{const x=tf.stack(bufs.map(b=>tf.tensor3d(new Uint8Array(b),[224,224,3]))).toFloat().div(255);const e=base.predict(x);return head.predict(e.div(e.norm("euclidean",1,true))).arraySync();});}
 const res={wide:[],tight:[],both:[]};
 for(const s of seqs){const w=await probs(s.files,0.82,heads.wide),t=await probs(s.files,0.5,heads.tight);
  res.wide.push({l:s.l,p:w});res.tight.push({l:s.l,p:t});res.both.push({l:s.l,p:w.map((r,i)=>r.map((v,j)=>(v+t[i][j])/2))});}
 for(const [name,arr] of Object.entries(res)){
  let fr=0,frn=0; for(const s of arr) for(const r of s.p){frn++; if(labels[r.indexOf(Math.max(...r))]===s.l) fr++;}
  for(const [SURE,STEADY] of [[0.6,3],[0.75,4],[0.6,4],[0.5,3]]){
   let dec=0,ok=0,wrong=[]; for(const s of arr){ if(s.l==="none") continue; let k=null,n=0,d=null;
     for(const r of s.p){const m=Math.max(...r),i=r.indexOf(m),key=labels[i]; if(key!=="none"&&m>=SURE){n=key===k?n+1:1;k=key; if(n>=STEADY){d=key;break}} else {k=null;n=0}}
     if(d){dec++; if(d===s.l) ok++; else wrong.push(s.l+"→"+d);} }
   console.log(`${name.padEnd(5)} frame-acc ${(fr/frn*100).toFixed(0)}% | rule ${SURE}/${STEADY}: answered ${dec}/28, right ${ok}, wrong ${wrong.join(" ")}`);
  }}
 let none=res.both.find(s=>s.l==="none"); console.log("none frames judged 'none' (both):",none.p.filter(r=>labels[r.indexOf(Math.max(...r))]==="none").length+"/"+none.p.length);
})();
