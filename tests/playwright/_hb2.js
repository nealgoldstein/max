const { chromium } = require('playwright');
const USER_LIST=[{place:'Reykjavik',country:'Iceland',isStay:true,nights:2},{place:'Vik',country:'Iceland',isStay:true,nights:1},{place:'Hofn',country:'Iceland',isStay:true,nights:1},{place:'Blue Lagoon',country:'Iceland',isStay:false},{place:'Gullfoss',country:'Iceland',isStay:false},{place:'Skogafoss',country:'Iceland',isStay:false},{place:'Jokulsarlon',country:'Iceland',isStay:false},{place:'Harpa Concert Hall',country:'Iceland',isStay:false},{place:'Kirkjufell',country:'Iceland',isStay:false},{place:'Hverir',country:'Iceland',isStay:false}];
const CANNED=[{name:'Chase waterfalls',type:'activity',category:'scenery-nature',section:'Chase waterfalls',description:'x',iconic:true,durationHours:4,requiredPlaces:[{place:'Seljalandsfoss',country:'Iceland',nights:0,lat:63.6156,lng:-19.9886,overnight:false},{place:'Skogafoss',country:'Iceland',nights:0,lat:63.5321,lng:-19.5114,overnight:false}]},{name:'Soak',type:'activity',category:'scenery-nature',section:'Relax in hot springs',description:'y',iconic:true,durationHours:3,requiredPlaces:[{place:'Blue Lagoon',country:'Iceland',nights:0,lat:63.8804,lng:-22.4495,overnight:false},{place:'Sky Lagoon',country:'Iceland',nights:0,lat:64.1265,lng:-21.9442,overnight:false}]},{name:'Walk the capital',type:'activity',category:'culture-history',section:'Explore Reykjavik',description:'z',iconic:false,durationHours:5,requiredPlaces:[{place:'Reykjavik',country:'Iceland',nights:2,lat:64.1466,lng:-21.9426,overnight:true}]},{name:'Explore volcanic terrain',type:'activity',category:'scenery-nature',section:'Explore volcanic terrain',description:'w',iconic:false,durationHours:2,requiredPlaces:[{place:'Hverir',country:'Iceland',nights:1,lat:65.64,lng:-16.81,overnight:true}]}];
(async()=>{
  const b=await chromium.launch();
  const page=await (await b.newContext({serviceWorkers:'block'})).newPage();
  await page.addInitScript(()=>{try{localStorage.clear();}catch(e){}});
  await page.goto('http://localhost:8765/index.html',{waitUntil:'load',timeout:20000});
  await page.waitForFunction(()=>typeof window._buildPickerFromPastedList==='function',{timeout:15000});
  const t0=Date.now();
  await page.evaluate(({userList,canned})=>{
    window.MaxEnginePicker.resetState({tripMode:'place',placeName:'Iceland',region:'Iceland',candidates:[],chips:[],activityChips:[],requiredPlaces:[],interests:['waterfalls'],drivers:[],avoid:{}});
    window._buildDone=false;
    if(window.MaxBuild&&window.MaxBuild.on){window.MaxBuild.on('build:done',()=>{window._buildDone=true;});window.MaxBuild.on('build:error',()=>{window._buildDone=true;});}
    window.callMax=async function(messages){const p=(messages&&messages[0]&&messages[0].content)||'';
      if(p.indexOf('Classify each entry')!==-1){const par={'Blue Lagoon':'Reykjavik','Gullfoss':'Reykjavik','Skogafoss':'Vik','Jokulsarlon':'Hofn','Harpa Concert Hall':'Reykjavik','Kirkjufell':'Grundarfjordur','Hverir':'Reykjavik'};return JSON.stringify(userList.map((u,i)=>({i:i+1,classification:u.isStay?'city':'poi',parentCity:u.isStay?null:(par[u.place]||'Reykjavik'),parentRelation:u.isStay?null:(u.place==='Harpa Concert Hall'?'within':'from')})));}
      if(p.indexOf('OVERNIGHT FLAG')!==-1){return JSON.stringify(canned);}
      if(p.indexOf('A traveler is planning a trip')!==-1){return '[]';}
      throw new Error('harness: no canned response');};
    window._buildPickerFromPastedList({destinations:userList,tripName:'Harness Iceland',region:'Iceland'},userList.map(p=>p.place).join('\n'),{});
  },{userList:USER_LIST,canned:CANNED});
  let done=false; try{ await page.waitForFunction(()=>window._buildDone===true,{timeout:20000}); done=true; }catch(_){}
  console.log('run2 buildDone:',done,'| elapsed ms:',Date.now()-t0);
  await b.close();
})().catch(e=>console.error('FAIL:',e.message));
