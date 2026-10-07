(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "nexus-planner-v1";
  function compact(value){return String(value||"").toLocaleLowerCase().replace(/[\s的这条个]/g,"");}
  function fmtDate(d) { return [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-"); }
  const state = { events: [], selected: dateKey(new Date()), cursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1), view: "month", undo: null, reminderSeen: new Set(), reminderQueue: [], activeReminder: null, reminderSnoozed: new Map(), countdownActive: new Set(), countdownMinimized: false, startupSummaryQueue: [], startupSummaryActive: null, occurrenceEditContext: null, toastTimer: null };
  function dateKey(d){return fmtDate(d);}
  function parseDate(s){const [y,m,d]=String(s).split("-").map(Number);return new Date(y,m-1,d,12);}
  function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  const REMINDER_SEEN_KEY="nexus-planner-reminder-seen-v1";
  function loadReminderSeen(){try{const saved=JSON.parse(localStorage.getItem(REMINDER_SEEN_KEY)||"[]");if(Array.isArray(saved))saved.forEach(k=>{if(typeof k==="string")state.reminderSeen.add(k);});}catch(e){console.warn("Could not read reminder state",e);}}
  function persistReminderSeen(){try{const today=fmtDate(new Date());const keys=[...state.reminderSeen].filter(k=>k.includes("@"+today+":")||k.endsWith("@"+today));localStorage.setItem(REMINDER_SEEN_KEY,JSON.stringify(keys));}catch(e){console.warn("Could not persist reminder state",e);}}
  function load(){try{const raw=localStorage.getItem(STORAGE_KEY);if(raw){const data=JSON.parse(raw);if(data&&Array.isArray(data.events))state.events=data.events.filter(validEvent);}}catch(e){console.warn("Could not read local planner data",e);toast("本地数据无法读取；请勿清除浏览器数据。");}loadReminderSeen();}
  function validEvent(e){return e&&typeof e.id==="string"&&typeof e.title==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(e.date)&&(!e.endDate||(/^\d{4}-\d{2}-\d{2}$/.test(e.endDate)&&e.endDate>=e.date))&&["none","daily","weekly","weekdays","monthly"].includes(e.repeat||"none");}
  function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({version:1,events:state.events}));}catch(e){toast("保存失败：浏览器存储空间可能不足。");throw e;}}
  function snapshot(){state.undo=JSON.stringify(state.events);}
  function undo(){if(!state.undo){toast("暂无可撤销的操作");return;}const now=JSON.stringify(state.events);state.events=JSON.parse(state.undo);state.undo=now;save();render();toast("已撤销上一步；再次点击可恢复。");}
  function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>el.classList.remove("show"),3000);}
  function id(){return "evt-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);}
  function occurs(e,key){if(key<e.date)return false;if(e.repeatUntil&&key>e.repeatUntil)return false;if(Array.isArray(e.excludedDates)&&e.excludedDates.includes(key))return false;if(e.longTask)return key<=(e.endDate||e.date);const d=parseDate(key),start=parseDate(e.date);switch(e.repeat||"none"){case"none":return key===e.date;case"daily":return true;case"weekly":return d.getDay()===start.getDay();case"weekdays":return d.getDay()!==0&&d.getDay()!==6;case"monthly":return d.getDate()===start.getDate();default:return key===e.date;}}
  function occurrenceEvents(key){return state.events.filter(e=>occurs(e,key)).map(e=>({...e,...(e.overrides&&e.overrides[key]||{}),occurrenceDate:key,seriesId:e.id,repeat:e.repeat||"none"})).sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99"));}
  function monthEvents(y,m){const first=new Date(y,m,1),last=new Date(y,m+1,0),out=[];for(let d=1;d<=last.getDate();d++){const key=fmtDate(new Date(y,m,d));const ev=occurrenceEvents(key);out.push({key,day:d,ev,outside:false});}return {first,last,days:out};}
  const INTERFACE_MODE_KEY="nexus-planner-interface-mode-v1";
  // Preserve the existing calendar workflow for current users; Study Desk is opt-in.
  let interfaceMode="classic";
  function applyInterfaceMode(mode,persist=true){
    interfaceMode=mode==="classic"?"classic":"study";
    document.body.classList.toggle("study-mode",interfaceMode==="study");
    document.body.classList.toggle("classic-mode",interfaceMode==="classic");
    $("studyDesk").hidden=interfaceMode!=="study";
    $("studyModeBtn").classList.toggle("active",interfaceMode==="study");
    $("classicModeBtn").classList.toggle("active",interfaceMode==="classic");
    $("studyModeBtn").setAttribute("aria-pressed",String(interfaceMode==="study"));
    $("classicModeBtn").setAttribute("aria-pressed",String(interfaceMode==="classic"));
    if(persist){try{localStorage.setItem(INTERFACE_MODE_KEY,interfaceMode);}catch(e){}}
    if(interfaceMode==="study")renderStudyDesk();
  }
  function studyEvent(e){return !!(e&&e.study&&typeof e.study==="object");}
  function studyTaskCard(e,overdue=false){
    const subject=e.study.subject||"未分类",minutes=Number(e.study.estimatedMinutes)||30,priority=Math.max(1,Math.min(3,Number(e.study.priority)||1));
    const dateLabel=overdue?"逾期 · "+esc(e.date):(e.time?esc(e.time):"今日待办");
    const card=document.createElement("article");card.className="study-task-card"+(e.done?" is-done":"")+(overdue?" is-overdue":"");
    card.innerHTML='<button type="button" class="study-task-check" aria-label="'+(e.done?"标记未完成":"标记完成")+'" title="'+(e.done?"标记未完成":"标记完成")+'">'+(e.done?"✓":"○")+'</button><div class="study-task-copy"><strong>'+esc(e.title)+'</strong><div class="study-task-meta"><span>'+esc(subject)+'</span><span>默认专注 '+minutes+' 分钟</span><span>'+dateLabel+'</span></div><div class="study-task-execution"><span class="study-actual-label"></span><button type="button" class="study-start-btn">'+(e.done?"查看专注":"开始专注")+'</button></div></div><span class="study-priority priority-'+priority+'">'+(["","普通","较高","重要"][priority])+'</span><button type="button" class="mini-btn study-edit-btn" aria-label="编辑学习任务" title="编辑">✎</button>';
    const actual=readLocalList(FOCUS_HISTORY_KEY).filter(x=>x&&x.id===(e.seriesId||e.id)&&x.date===(e.occurrenceDate||e.date)).reduce((sum,x)=>sum+Math.max(0,Number(x.minutes)||0),0);
    card.querySelector(".study-actual-label").textContent=actual?("已专注 "+actual+" 分钟"):"还没有专注记录";
    card.querySelector(".study-task-check").addEventListener("click",()=>toggleDone(e.seriesId||e.id,e.occurrenceDate||e.date));
    card.querySelector(".study-start-btn").addEventListener("click",()=>{if(!e.done)openFocus(e);else toast("已完成任务的专注记录已保留在本地复盘中。");});
    card.querySelector(".study-edit-btn").addEventListener("click",()=>editEvent(e.seriesId||e.id,e.occurrenceDate||e.date));
    return card;
  }
  const TODAY_FOCUS_KEY="nexus-planner-today-focus-v1";
  function readTodayFocus(day){
    try{const data=JSON.parse(localStorage.getItem(TODAY_FOCUS_KEY)||"{}");return Array.isArray(data[day])?data[day].filter(x=>typeof x==="string").slice(0,3):[];}catch(e){return [];}
  }
  function writeTodayFocus(day,ids){
    try{const data=JSON.parse(localStorage.getItem(TODAY_FOCUS_KEY)||"{}");data[day]=ids.slice(0,3);const keys=Object.keys(data).sort().slice(-45);const compact={};keys.forEach(k=>compact[k]=data[k]);localStorage.setItem(TODAY_FOCUS_KEY,JSON.stringify(compact));}catch(e){toast("重点事项暂时无法保存，请检查浏览器存储空间。");}
  }
  function eventMinutes(e){
    if(e.time&&e.endTime){const a=e.time.split(":").map(Number),b=e.endTime.split(":").map(Number),n=b[0]*60+b[1]-a[0]*60-a[1];return n>0?n:0;}
    if(studyEvent(e))return Number(e.study.estimatedMinutes)||30;
    return 0;
  }
  function renderTodayOverview(today,todayEvents){
    const focusIds=readTodayFocus(today);
    const byId=new Map(todayEvents.map(e=>[e.id,e]));
    const focus=focusIds.map(id=>byId.get(id)).filter(Boolean).slice(0,3);
    const completed=todayEvents.filter(e=>e.done).length;
    const timed=todayEvents.filter(e=>e.time&&e.endTime);
    const busyMinutes=timed.reduce((sum,e)=>sum+eventMinutes(e),0);
    $("todayDateLabel").textContent=parseDate(today).toLocaleDateString("zh-CN",{month:"long",day:"numeric",weekday:"long"});
    $("todayEventCount").textContent=String(todayEvents.length);
    $("todayDoneCount").textContent=String(completed);
    $("todayFocusCount").textContent=focus.length+" / 3";
    $("todayBusyTime").textContent=timed.length?(Math.floor(busyMinutes/60)+"小时"+(busyMinutes%60?busyMinutes%60+"分":"")):"暂无固定时段";
    const focusList=$("todayFocusList");focusList.innerHTML="";
    if(!focus.length)focusList.innerHTML='<div class="today-empty">还没有选定今日重点。可以从下面的日程中添加，最多 3 项。</div>';
    focus.forEach((e,index)=>{
      const row=document.createElement("div");row.className="today-focus-item";
      row.innerHTML='<span class="today-focus-number">'+(index+1)+'</span><div class="today-focus-copy"><strong>'+esc(e.title)+'</strong><small>'+esc(e.time?(e.endTime?e.time+"–"+e.endTime:e.time):e.date===today?"今日待办":"长期任务")+(e.done?" · 已完成":"")+'</small></div><button type="button" class="mini-btn" aria-label="移除今日重点" title="移除重点">×</button>';
      row.querySelector("button").addEventListener("click",()=>{writeTodayFocus(today,focusIds.filter(id=>id!==e.id));renderStudyDesk();});
      row.querySelector(".today-focus-copy").addEventListener("click",()=>editEvent(e.seriesId||e.id,e.occurrenceDate||e.date));
      focusList.append(row);
    });
    const nextCandidates=todayEvents.filter(e=>!e.done).slice().sort((a,b)=>{
      const ap=Number(a.study?.priority)||0,bp=Number(b.study?.priority)||0;
      return bp-ap||(a.time||"99:99").localeCompare(b.time||"99:99");
    });
    const next=focus.find(e=>!e.done)||nextCandidates[0];
    $("todayNextTitle").textContent=next?next.title:"今天暂时没有待处理的日程";
    $("todayNextReason").textContent=next?(focus.includes(next)?"这是你选定的今日重点，先从它开始。":studyEvent(next)?"结合学习任务的优先级和时间安排，建议先处理这项。":next.time?"参考当前日程时间，先查看这项安排。":"这是当前未完成的事项；开始前可先确认它是否仍然重要。"):"你可以休息，或创建一项新的安排。";
    $("todayNextOpen").disabled=!next;
    $("todayNextOpen").onclick=()=>{if(next)editEvent(next.seriesId||next.id);};
    $("todayStartFocusBtn").disabled=!next;
    $("todayStartFocusBtn").onclick=()=>openFocus(next);
    const studyTasks=todayEvents.filter(e=>studyEvent(e)&&!e.done);
    const studyEstimate=studyTasks.filter(e=>!(e.time&&e.endTime)).reduce((sum,e)=>sum+(Number(e.study.estimatedMinutes)||30),0);
    const workload=busyMinutes+studyEstimate;
    const banner=$("todayRealityBanner");
    if(!todayEvents.length){banner.className="today-reality-banner reality-neutral";banner.innerHTML='<strong>今天还没有安排</strong><span>可以从一项小任务开始，也可以先查看传统日历。</span>';}
    else if(!timed.length&&!studyTasks.length){banner.className="today-reality-banner reality-neutral";banner.innerHTML='<strong>时间负荷暂时无法准确评估</strong><span>当前没有明确起止时间的日程，也没有未完成的学习任务时长数据。请根据实际情况判断。</span>';}
    else if(workload>13*60){banner.className="today-reality-banner reality-warning";banner.innerHTML='<strong>今天可能比较紧张</strong><span>明确时段的日程约 '+Math.round(busyMinutes/60*10)/10+' 小时，另有未安排具体时段的学习任务预计 '+Math.round(studyEstimate/60*10)/10+' 小时。这里只统计有时长依据的项目，建议检查冲突并留出休息时间。</span>';}
    else{banner.className="today-reality-banner reality-good";banner.innerHTML='<strong>已完成初步负荷检查</strong><span>明确时段的日程约 '+Math.round(busyMinutes/60*10)/10+' 小时，另有未安排具体时段的学习任务预计 '+Math.round(studyEstimate/60*10)/10+' 小时。普通待办若未填写耗时不会被估算；这不是对整天可用时间的保证。</span>';}
    $("todayRecheckBtn").onclick=()=>{renderStudyDesk();toast("已根据当前日程重新评估。");};
    const available=todayEvents.filter(e=>!e.done&&!focusIds.includes(e.id));
    const addTargets=available.slice().sort((a,b)=>(Number(b.study?.priority)||0)-(Number(a.study?.priority)||0)||(a.time||"99:99").localeCompare(b.time||"99:99"));
    addTargets.slice(0,8).forEach(e=>{
      const button=document.createElement("button");button.type="button";button.className="today-pick-btn";button.disabled=focusIds.length>=3;button.textContent=(studyEvent(e)?"＋ 学习 · ":"＋ ") + e.title;
      button.title=focusIds.length>=3?"请先移除一个重点，再添加新事项":"添加到今日重点";
      button.addEventListener("click",()=>{writeTodayFocus(today,[...readTodayFocus(today),e.id].slice(0,3));renderStudyDesk();});
      focusList.append(button);
    });
  }
  const FOCUS_SESSION_KEY="nexus-planner-focus-session-v1";
  let focusSession=null,focusTick=null,recoveryProposal=[];
  function saveFocusSession(){try{if(focusSession)localStorage.setItem(FOCUS_SESSION_KEY,JSON.stringify(focusSession));else localStorage.removeItem(FOCUS_SESSION_KEY);}catch(e){toast("专注状态无法保存到本地浏览器。");}}
  function focusElapsed(){return focusSession?Math.max(0,Number(focusSession.elapsedMs)||0)+(focusSession.startedAt?Math.max(0,Date.now()-focusSession.startedAt):0):0;}
  function focusDuration(e){return Math.max(5,Math.min(180,Math.round((Number(e&&e.study&&e.study.estimatedMinutes)||25)/5)*5))*60000;}
  function updateFocusDisplay(){const s=focusSession;if(!s)return;const elapsed=focusElapsed(),remain=Math.max(0,s.durationMs-elapsed),seconds=Math.ceil(remain/1000),finished=remain<=0;$("focusTimerDisplay").textContent=String(Math.floor(seconds/60)).padStart(2,"0")+":"+String(seconds%60).padStart(2,"0");$("focusProgressBar").style.width=Math.min(100,elapsed/s.durationMs*100)+"%";$("focusSessionStatus").textContent=s.startedAt?(finished?"本轮专注已到 · 可以延续下一段":"专注进行中 · 计时已保存"):(finished?"本轮专注已结束 · 可以延续或结束":"已暂停 · "+Math.floor(elapsed/60000)+" 分钟已记录");$("focusStartBtn").textContent=s.startedAt?"正在专注":"继续专注";$("focusStartBtn").disabled=!!s.startedAt||finished;$("focusPauseBtn").disabled=!s.startedAt||finished;$("focusExtensionPanel").hidden=!finished;}
  function openFocus(e){if(!e){toast("今天没有可开始的任务；请先创建或选择一项。");return;}const occurrenceDate=e.occurrenceDate||e.date;if(focusSession&&focusSession.id!==(e.seriesId||e.id)&&!confirm("当前专注会话尚未结束。结束当前会话并切换任务吗？"))return;if(!focusSession||focusSession.id!==(e.seriesId||e.id)){if(focusTick)clearInterval(focusTick);focusTick=null;focusSession={id:e.seriesId||e.id,occurrenceDate,title:e.title,repeat:e.repeat||"none",durationMs:focusDuration(e),startedAt:0,elapsedMs:0};saveFocusSession();}$("focusTaskTitle").textContent=focusSession.title;$("focusTaskMeta").textContent=(e.time?(e.time+(e.endTime?"–"+e.endTime:"")+" · 任务安排"): "无固定时间 · 任务安排")+" · "+(studyEvent(e)?(e.study.subject||"学习任务")+" · 默认专注 "+(Number(e.study.estimatedMinutes)||30)+" 分钟":"本次默认专注 25 分钟")+" · 专注可独立延续";$("focusDialog").showModal();updateFocusDisplay();}
  $("closeFocusDialog").addEventListener("click",()=>$("focusDialog").close());
  function beginFocusTimer(){if(!focusSession)return;focusSession.startedAt=Date.now();saveFocusSession();updateFocusDisplay();if(focusTick)clearInterval(focusTick);focusTick=setInterval(()=>{if(!focusSession)return;updateFocusDisplay();if(focusElapsed()>=focusSession.durationMs){focusSession.elapsedMs=focusElapsed();focusSession.startedAt=0;saveFocusSession();updateFocusDisplay();clearInterval(focusTick);focusTick=null;toast("本轮专注已到。可以选择延续专注，也可以结束会话。");}},1000);}
  $("focusStartBtn").addEventListener("click",beginFocusTimer);
  document.querySelectorAll("[data-focus-extension]").forEach(btn=>btn.addEventListener("click",()=>{if(!focusSession)return;const mins=Number(btn.dataset.focusExtension);if(!Number.isFinite(mins)||mins<=0)return;focusSession.elapsedMs=focusElapsed();focusSession.durationMs+=mins*60000;focusSession.startedAt=0;saveFocusSession();updateFocusDisplay();beginFocusTimer();toast("已增加 "+mins+" 分钟专注时间，不会修改任务时间。");}));
  $("focusPauseBtn").addEventListener("click",()=>{if(!focusSession||!focusSession.startedAt)return;focusSession.elapsedMs=focusElapsed();focusSession.startedAt=0;saveFocusSession();if(focusTick)clearInterval(focusTick);focusTick=null;updateFocusDisplay();});
  $("focusFinishBtn").addEventListener("click",()=>{if(!focusSession)return;const s=focusSession,mins=Math.floor(focusElapsed()/60000);const focusHistory=readLocalList(FOCUS_HISTORY_KEY);focusHistory.push({id:s.id,title:s.title,minutes:mins,at:Date.now(),date:dateKey(new Date())});writeLocalList(FOCUS_HISTORY_KEY,focusHistory.filter(x=>x.at>Date.now()-180*86400000).slice(-3000));const markDone=s.repeat==="none"?confirm("本次专注已记录约 "+mins+" 分钟。是否同时将“"+s.title+"”标记为完成？\n选择“确定”标记完成；选择“取消”仅结束计时。"):false;if(focusTick)clearInterval(focusTick);focusTick=null;focusSession=null;saveFocusSession();$("focusDialog").close();if(markDone)toggleDone(s.id,s.occurrenceDate);else{render();toast(s.repeat==="none"?"专注会话已结束，任务仍保持未完成。":"专注会话已结束；为避免误改整个重复系列，未自动修改日程完成状态。");}});
  function openRecovery(){const today=dateKey(new Date()),tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);const target=dateKey(tomorrow),candidates=occurrenceEvents(today).filter(e=>!e.done&&!e.time&&!e.longTask&&(e.repeat||"none")==="none"&&e.date===today);const list=$("recoveryTaskList");list.innerHTML="";recoveryProposal=[];if(!candidates.length)list.innerHTML='<div class="today-empty">今天没有符合安全改期条件的待办。固定时段、重复日程和长期任务不会在这里批量移动。</div>';candidates.forEach(e=>{const label=document.createElement("label");label.className="recovery-task-option";const cb=document.createElement("input");cb.type="checkbox";cb.value=e.id;cb.checked=true;const copy=document.createElement("span");copy.innerHTML="<strong>"+esc(e.title)+"</strong><small>"+esc(e.date)+" · 无固定时间 · 改到 "+esc(target)+"（不指定新时间）</small>";label.append(cb,copy);list.append(label);});$("recoveryPreview").hidden=true;$("recoveryPreview").innerHTML="";$("recoveryApplyBtn").disabled=true;$("recoveryPreviewBtn").disabled=!candidates.length;$("recoveryDialog").showModal();}
  $("todayRecoveryBtn").addEventListener("click",openRecovery);
  $("closeRecoveryDialog").addEventListener("click",()=>$("recoveryDialog").close());
  $("recoveryPreviewBtn").addEventListener("click",()=>{const ids=[...$("recoveryTaskList").querySelectorAll('input[type="checkbox"]:checked')].map(cb=>cb.value),tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);const target=dateKey(tomorrow);recoveryProposal=ids.map(id=>state.events.find(e=>e.id===id)).filter(e=>e&&(e.repeat||"none")==="none"&&!e.done&&!e.time&&!e.longTask&&e.date===dateKey(new Date())).map(e=>({id:e.id,title:e.title,from:e.date,to:target}));const preview=$("recoveryPreview");preview.hidden=false;preview.innerHTML="";if(!recoveryProposal.length){preview.textContent="没有可应用的改期项目。请重新选择任务。";$("recoveryApplyBtn").disabled=true;return;}const heading=document.createElement("strong");heading.textContent="改期预览 · "+recoveryProposal.length+" 项";preview.append(heading);recoveryProposal.forEach(p=>{const row=document.createElement("p");row.textContent=p.title+"： "+p.from+" → "+p.to+"（保持为无固定时间的待办）";preview.append(row);});$("recoveryApplyBtn").disabled=false;});
  $("recoveryApplyBtn").addEventListener("click",()=>{if(!recoveryProposal.length)return;if(!confirm("即将把预览中的 "+recoveryProposal.length+" 项任务移到明天，且不设置新时间。固定日程不会改变。确认应用？"))return;const valid=recoveryProposal.filter(p=>{const e=state.events.find(x=>x.id===p.id);return e&&(e.repeat||"none")==="none"&&!e.done&&!e.time&&!e.longTask&&e.date===p.from;});if(!valid.length){toast("任务状态已变化，没有应用改期。");$("recoveryDialog").close();return;}snapshot();valid.forEach(p=>{const e=state.events.find(x=>x.id===p.id);if(e)e.date=p.to;});try{save();$("recoveryDialog").close();recoveryProposal=[];render();toast("已按预览改期 "+valid.length+" 项任务。可使用撤销恢复。");}catch(e){toast("保存失败，请检查浏览器存储空间。");}});
  const COMPLETION_HISTORY_KEY="nexus-planner-completion-history-v1";
  const FOCUS_HISTORY_KEY="nexus-planner-focus-history-v1";
  const WEEKLY_REFLECTION_KEY="nexus-planner-weekly-reflection-v1";
  function readLocalList(key){try{const x=JSON.parse(localStorage.getItem(key)||"[]");return Array.isArray(x)?x:[];}catch(e){return [];}}
  function writeLocalList(key,items){try{localStorage.setItem(key,JSON.stringify(items));return true;}catch(e){toast("本地记录保存失败，请检查浏览器存储空间。");return false;}}
  function recordCompletion(e,done,key){if(!e)return;const list=readLocalList(COMPLETION_HISTORY_KEY);list.push({id:e.id,title:e.title,date:key||dateKey(new Date()),done:!!done,at:Date.now()});writeLocalList(COMPLETION_HISTORY_KEY,list.filter(x=>x.at>Date.now()-180*86400000).slice(-3000));}
  function mondayOf(date){const d=new Date(date.getFullYear(),date.getMonth(),date.getDate());d.setDate(d.getDate()-((d.getDay()+6)%7));return d;}
  function weekKey(date){return dateKey(mondayOf(date));}
  function renderWeeklyReview(){
    const now=new Date(),today=dateKey(now),start=mondayOf(now),startKey=dateKey(start),days=[];
    for(let i=6;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth(),now.getDate());d.setDate(d.getDate()-i);days.push(dateKey(d));}
    const completed=readLocalList(COMPLETION_HISTORY_KEY).filter(x=>x&&x.done&&typeof x.at==="number"&&x.date>=days[0]&&x.date<=today&&x.at<=now.getTime());
    const focus=readLocalList(FOCUS_HISTORY_KEY).filter(x=>x&&typeof x.at==="number"&&x.date>=days[0]&&x.date<=today&&x.at<=now.getTime());
    const counts=days.map(day=>completed.filter(x=>x.date===day).length),max=Math.max(1,...counts);
    $("weeklyReviewRange").textContent=days[0].slice(5)+" — "+days[6].slice(5);
    $("weeklyDoneCount").textContent=String(completed.length);
    const focusMinutes=focus.reduce((sum,x)=>sum+Math.max(0,Number(x.minutes)||0),0);
    $("weeklyFocusTime").textContent=focusMinutes>=60?Math.floor(focusMinutes/60)+"小时"+(focusMinutes%60?" "+focusMinutes%60+"分":""):focusMinutes+" 分钟";
    $("weeklyActiveDays").textContent=String(counts.filter(n=>n>0).length)+" / 7";
    const chart=$("weeklyReviewChart");chart.innerHTML="";
    days.forEach((day,i)=>{const col=document.createElement("div");col.className="weekly-bar-column";const value=document.createElement("span");value.className="weekly-bar-value";value.textContent=String(counts[i]);const track=document.createElement("div");track.className="weekly-bar-track";const bar=document.createElement("span");bar.style.height=(counts[i]/max*100)+"%";if(counts[i]===0)bar.style.height="3px";track.append(bar);const label=document.createElement("small");label.textContent=parseDate(day).toLocaleDateString("zh-CN",{weekday:"short"});col.append(value,track,label);chart.append(col);});
    const hasHistory=readLocalList(COMPLETION_HISTORY_KEY).length||readLocalList(FOCUS_HISTORY_KEY).length;
    $("weeklyReviewNote").textContent=hasHistory?"统计最近 7 天内记录的完成动作与已结束的专注会话；撤销完成状态不会删除历史记录。未记录的历史活动不会被推算。":"从现在开始记录你的完成动作和专注会话。功能启用前的历史不会被推测或补造。";
    const reflections=(()=>{try{return JSON.parse(localStorage.getItem(WEEKLY_REFLECTION_KEY)||"{}");}catch(e){return {};}})();
    if(document.activeElement!==$("weeklyReflectionInput"))$("weeklyReflectionInput").value=typeof reflections[startKey]==="string"?reflections[startKey]:"";
    $("weeklyReflectionSaved").textContent=typeof reflections[startKey]==="string"?"本周复盘已保存到本地":"仅保存在当前浏览器";
    $("saveWeeklyReflectionBtn").onclick=()=>{try{const all=JSON.parse(localStorage.getItem(WEEKLY_REFLECTION_KEY)||"{}");all[startKey]=$("weeklyReflectionInput").value.slice(0,1000);const keys=Object.keys(all).sort().slice(-26),small={};keys.forEach(k=>small[k]=all[k]);localStorage.setItem(WEEKLY_REFLECTION_KEY,JSON.stringify(small));$("weeklyReflectionSaved").textContent="已保存 · "+startKey;toast("本周复盘已保存。");}catch(e){toast("复盘保存失败，请检查浏览器存储空间。");}};
  }
  const GOALS_KEY="nexus-planner-goals-v1";
  const CHECKINS_KEY="nexus-planner-checkins-v1";
  function readGoals(){try{const data=JSON.parse(localStorage.getItem(GOALS_KEY)||"[]");return Array.isArray(data)?data.filter(g=>g&&typeof g.id==="string"&&typeof g.title==="string"&&Array.isArray(g.steps)):[];}catch(e){return [];}}
  function writeGoals(goals){try{localStorage.setItem(GOALS_KEY,JSON.stringify(goals));return true;}catch(e){toast("目标保存失败，请检查浏览器存储空间。");return false;}}
  function readCheckins(){try{const data=JSON.parse(localStorage.getItem(CHECKINS_KEY)||"[]");return Array.isArray(data)?data.filter(x=>x&&typeof x.id==="string"&&typeof x.title==="string"&&typeof x.startDate==="string"):[];}catch(e){return [];}}
  function writeCheckins(items){try{localStorage.setItem(CHECKINS_KEY,JSON.stringify(items));return true;}catch(e){toast("打卡数据保存失败，请检查浏览器存储空间。");return false;}}
  function todayKey(){return dateKey(new Date());}
  function isGoalEnded(goal,today=todayKey()){return !!goal.completedAt||!!(goal.targetDate&&today>goal.targetDate);}
  function checkinEnded(item,today=todayKey()){return !item.active||!!item.endedAt||(!item.longTerm&&!!item.endDate&&today>item.endDate);}
  function checkinCount(item,day=todayKey()){return Math.max(0,Number(item.counts?.[day])||0);}
  function incrementCheckin(checkinId){const items=readCheckins(),item=items.find(x=>x.id===checkinId);if(!item||checkinEnded(item))return false;const day=todayKey();if(day<item.startDate||(!item.longTerm&&item.endDate&&day>item.endDate))return false;item.counts=item.counts||{};item.counts[day]=(Number(item.counts[day])||0)+1;item.lastCheckinAt=Date.now();return writeCheckins(items);}
  function firstWeekdayOnOrAfter(start,weekday){const d=parseDate(start),delta=(weekday-d.getDay()+7)%7;d.setDate(d.getDate()+delta);return dateKey(d);}
  function extractGoalTimeRanges(raw){const source=String(raw||""),period="上午|早上|中午|下午|晚上|傍晚|晚|早",tokenRe=new RegExp("("+period+")?\\s*(\\d{1,2})(?:(?:[:：](\\d{1,2}))|(?:点|时)(?:(\\d{1,2})分?|半)?)?","g"),toMin=(p,h,m,half)=>{let hh=Number(h),mm=m!==undefined?Number(m):(half?30:0);if(hh>23||mm>59)return null;if(/下午|晚上|傍晚|晚/.test(p||"")&&hh<12)hh+=12;if(/上午|早上|早/.test(p||"")&&hh===12)hh=0;if(/中午/.test(p||"")&&hh<11)hh+=12;return hh*60+mm;},ranges=[];for(const seg of source.split(/[，,；;。\\n]+/).map(x=>x.trim()).filter(Boolean)){const ts=[];let m;tokenRe.lastIndex=0;while((m=tokenRe.exec(seg))!==null){if(!/[点时:：]/.test(m[0]))continue;ts.push({end:tokenRe.lastIndex,index:m.index,p:m[1]||"",h:m[2],m:m[3],half:/[点时]半/.test(m[0])});}for(let i=0;i<ts.length-1;i++){const l=ts[i],r=ts[i+1],between=seg.slice(l.end,r.index);if(!/(到|至|-|—|~|～)/.test(between))continue;const sm=toMin(l.p,l.h,l.m,l.half);let em=toMin(r.p||l.p,r.h,r.m,r.half);if(sm!==null&&em!==null&&em<=sm&&!r.p&&sm>=720&&Number(r.h)<12)em+=720;if(sm!==null&&em!==null&&em>sm)ranges.push({time:String(Math.floor(sm/60)).padStart(2,"0")+":"+String(sm%60).padStart(2,"0"),endTime:String(Math.floor(em/60)).padStart(2,"0")+":"+String(em%60).padStart(2,"0")});}}return ranges;}
  function stepSchedulePlan(step,goal){const raw=String(step.title||"").trim(),ranges=extractGoalTimeRanges(raw);if(!ranges.length){const p=parseNatural(raw);if(p?.time&&p?.endTime)ranges.push({time:p.time,endTime:p.endTime});}const d=parseTargetDate(raw),daily=/每天|每日/.test(raw),weekly=/每周|每个星期|每星期/.test(raw),days=[];if(/周日|星期日|星期天|周天/.test(raw))days.push(0);if(/周一|星期一/.test(raw))days.push(1);if(/周二|星期二/.test(raw))days.push(2);if(/周三|星期三/.test(raw))days.push(3);if(/周四|星期四/.test(raw))days.push(4);if(/周五|星期五/.test(raw))days.push(5);if(/周六|星期六/.test(raw))days.push(6);if(!ranges.length)return {error:"没有识别到完整的开始/结束时间。可以写成“每天晚上9点到10点半”。"};const start=d.matched?d.date:dateKey(new Date(goal.createdAt||Date.now()));if(goal.targetDate&&start>goal.targetDate)return {error:"目标开始日期晚于目标截止日期。"};const repeat=daily?"daily":weekly?"weekly":"none",targets=repeat==="weekly"&&days.length?days:[null],title=raw.replace(/20\\d{2}[年./-]\\d{1,2}[月./-]\\d{1,2}(?:日|号)?/g," ").replace(/\\d{1,2}月\\d{1,2}(?:日|号)?/g," ").replace(/(?:上午|早上|中午|下午|晚上|傍晚|晚|早)?\\s*\\d{1,2}(?:(?:[:：]\\d{1,2})|(?:点|时)(?:(?:\\d{1,2})分?|半)?)?\\s*(?:到|至|-|—|~|～)\\s*(?:上午|早上|中午|下午|晚上|傍晚|晚|早)?\\s*\\d{1,2}(?:(?:[:：]\\d{1,2})|(?:点|时)(?:(?:\\d{1,2})分?|半)?)?/g," ").replace(/每周(?:星期)?[一二三四五六日天]|每星期[一二三四五六日天]|(?:周|星期)[一二三四五六日天]/g," ").replace(/每天|每日|每周|每个星期|每星期|开始|从/g," ").replace(/[，,；;]/g," ").replace(/\\s+/g," ").trim()||raw,events=[];for(const t of ranges)for(const day of targets){const date=day===null?start:firstWeekdayOnOrAfter(start,day);if(goal.targetDate&&date>goal.targetDate)continue;const mins=(+t.endTime.slice(0,2)*60+ +t.endTime.slice(3))-(+t.time.slice(0,2)*60+ +t.time.slice(3));events.push({id:id(),title,date,time:t.time,endTime:t.endTime,reminder:0,reminderRevision:0,countdownEnabled:false,specialReminder:false,location:"",notes:"",repeat,repeatUntil:goal.targetDate||undefined,done:false,excludedDates:[],overrides:{},study:{subject:"学习",estimatedMinutes:Math.max(5,mins),priority:2}});}return {start,repeat,events};}  function scheduleGoalStep(goalId,stepId){
    const goals=readGoals(),goal=goals.find(g=>g.id===goalId),step=goal?.steps.find(s=>s.id===stepId);
    if(!goal||!step)return;
    if(isGoalEnded(goal)){toast("目标已经结束，不能再把步骤排入日程。");return;}
    const plan=stepSchedulePlan(step,goal);
    if(plan.error){toast(plan.error);return;}
    const existingIds=Array.isArray(step.scheduledEventIds)?step.scheduledEventIds.filter(id=>state.events.some(e=>e.id===id)):[];if(existingIds.length){toast("这一步已经安排过日程了，不会重复创建。");return;}
    const preview=plan.events.map(e=>e.title+" · "+e.date+" · "+e.time+"–"+e.endTime+" · "+(e.repeat==="daily"?"每天":e.repeat==="weekly"?"每周":"一次")).join("\n");
    if(!confirm("将把“"+step.title+"”识别为以下日程：\n\n"+preview+"\n\n确认安排吗？"))return;
    snapshot();
    state.events=state.events.concat(plan.events);
    step.scheduledEventIds=plan.events.map(e=>e.id);step.scheduledAt=Date.now();
    save();writeGoals(goals);render();toast("已按识别出的多个时间段安排到日历。");
  }
  function openGoalCheckinDialog(goal,step,existing=null){
    const dialog=$("goalCheckinDialog"),form=$("goalCheckinForm");if(!dialog||!form)return;
    $("goalCheckinId").value=existing?.id||"";
    $("goalCheckinGoalId").value=goal?.id||"";
    $("goalCheckinStepId").value=step?.id||"";
    $("goalCheckinTitle").value=existing?.title||step?.title||"";
    $("goalCheckinStart").value=existing?.startDate||dateKey(new Date(goal?.createdAt||Date.now()));
    $("goalCheckinEnd").value=existing?.endDate||goal?.targetDate||"";
    $("goalCheckinLongTerm").checked=!!existing?.longTerm;
    $("goalCheckinEnd").disabled=!!existing?.longTerm;
    $("goalCheckinDialogTitle").textContent=existing?"管理打卡":"设置目标打卡";
    dialog.showModal();
  }
  function goalCheckinForStep(step){return readCheckins().find(x=>x.id===step.checkinId);}
  function renderGoalCheckinRow(goal,step,ended){
    const checkin=goalCheckinForStep(step);
    const row=document.createElement("div");row.className="goal-checkin-row"+(ended?" is-ended":"");
    const info=document.createElement("div");info.className="goal-checkin-copy";
    const name=document.createElement("strong");name.textContent=step.title;info.append(name);
    const meta=document.createElement("small");
    if(checkin){
      const range=checkin.longTerm?("长期打卡 · 起始 "+checkin.startDate):(checkin.startDate+" 至 "+checkin.endDate);
      meta.textContent=range+" · 今日 "+checkinCount(checkin)+" 次";
    }else meta.textContent="仅在学习平台打卡，不进入日历";
    info.append(meta);row.append(info);
    const actions=document.createElement("div");actions.className="goal-checkin-actions";
    if(!checkin){
      const set=document.createElement("button");set.type="button";set.className="secondary-btn";set.textContent="设置打卡";set.disabled=ended;set.onclick=()=>openGoalCheckinDialog(goal,step);actions.append(set);
    }else{
      const finished=ended||checkinEnded(checkin);
      const hit=document.createElement("button");hit.type="button";hit.className="primary-btn";hit.textContent=finished?"已完成":"今日 +1";hit.disabled=finished;hit.onclick=()=>{if(incrementCheckin(checkin.id))renderStudyDesk();};actions.append(hit);
      const manage=document.createElement("button");manage.type="button";manage.className="secondary-btn";manage.textContent=finished&&!checkin.longTerm?"恢复为长期打卡":"管理";manage.onclick=()=>{
        if(finished&&!checkin.longTerm){
          const items=readCheckins(),item=items.find(x=>x.id===checkin.id);if(item){item.longTerm=true;item.endDate="";item.active=true;item.endedAt=0;item.goalId="";item.stepId="";const goals=readGoals(),g=goals.find(x=>x.id===goal.id),s=g?.steps.find(x=>x.id===step.id);if(s)s.checkinId="";writeGoals(goals);writeCheckins(items);renderStudyDesk();toast("已恢复为长期打卡活动，并从目标中独立出来。");}
        }else openGoalCheckinDialog(goal,step,checkin);
      };actions.append(manage);
      const cancel=document.createElement("button");cancel.type="button";cancel.className="secondary-btn";cancel.textContent="取消打卡";cancel.title="取消打卡模式，恢复为普通目标步骤";cancel.onclick=()=>{
        if(!confirm("取消“"+step.title+"”的打卡模式？\n\n步骤本身会保留，之后可以重新排进日程或再次设置打卡。当前打卡次数将随本次打卡模式一起移除。"))return;
        const items=readCheckins().filter(x=>x.id!==checkin.id);
        const goals=readGoals(),g=goals.find(x=>x.id===goal.id),s=g?.steps.find(x=>x.id===step.id);
        if(s)s.checkinId="";
        if(writeGoals(goals)&&writeCheckins(items)){renderStudyDesk();toast("已取消打卡模式；该步骤已恢复为普通步骤。");}
      };actions.append(cancel);
    }
    const deleteStep=document.createElement("button");deleteStep.type="button";deleteStep.className="mini-btn";deleteStep.textContent="删除步骤";deleteStep.title="删除这个目标步骤";deleteStep.disabled=ended;deleteStep.onclick=()=>deleteGoalStep(goal.id,step.id);actions.append(deleteStep);
    row.append(actions);return row;
  }
  function deleteGoalStep(goalId,stepId){
    const goals=readGoals(),goal=goals.find(g=>g.id===goalId),step=goal?.steps.find(s=>s.id===stepId);
    if(!goal||!step)return;
    const checkin=goalCheckinForStep(step);
    const eventIds=Array.isArray(step.scheduledEventIds)?step.scheduledEventIds.filter(id=>state.events.some(e=>e.id===id)):[];
    const msg=checkin?.longTerm
      ?"删除步骤“"+step.title+"”？该步骤会从目标中移除，但它已经独立为长期打卡，所以长期打卡会继续保留。"
      :eventIds.length
        ?"删除步骤“"+step.title+"”？与它关联的 "+eventIds.length+" 个日历安排也会一起删除。"
        :"删除步骤“"+step.title+"”？";
    if(!confirm(msg))return;
    snapshot();
    if(eventIds.length)state.events=state.events.filter(e=>!eventIds.includes(e.id));
    goal.steps=goal.steps.filter(s=>s.id!==stepId);
    const checkins=readCheckins();
    if(checkin?.longTerm){
      const item=checkins.find(x=>x.id===checkin.id);
      if(item){item.goalId="";item.stepId="";item.active=true;item.endedAt=0;}
    }else if(checkin){
      const index=checkins.findIndex(x=>x.id===checkin.id);if(index>=0)checkins.splice(index,1);
    }
    if(writeGoals(goals)&&writeCheckins(checkins)){save();renderStudyDesk();toast(checkin?.longTerm?"步骤已删除，独立长期打卡已保留。":eventIds.length?"步骤及其日程已删除。":"步骤已删除。");}
  }
  function parseGoalStepLines(value){
    return String(value||"").split(/\n+/).map(s=>s.trim()).filter(Boolean).slice(0,30).map(title=>({id:"step-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8),title:title.slice(0,180),done:false,doneAt:0}));
  }
  function openAddGoalSteps(goalId){
    const dialog=$("goalAddStepsDialog"),input=$("goalAddStepsInput");
    if(!dialog||!input)return;
    $("goalAddStepsGoalId").value=goalId;input.value="";dialog.showModal();input.focus();
  }
  function renderGoals(){
    const goals=readGoals(),list=$("goalRoadmapList");$("goalRoadmapCount").textContent=goals.length+" 个目标";list.innerHTML="";
    if(!goals.length){list.innerHTML='<div class="today-empty">还没有长期目标。可以从一个你真正关心的结果开始，步骤不必一次写完。</div>';return;}
    goals.forEach(goal=>{
      const ended=isGoalEnded(goal),doneCount=goal.steps.filter(s=>ended||s.done||((s.checkinId)&&checkinEnded(goalCheckinForStep(s)||{}))).length,total=goal.steps.length,pct=total?Math.round(doneCount/total*100):0;
      const card=document.createElement("article");card.className="goal-card"+(ended?" is-ended":"");
      const header=document.createElement("div");header.className="goal-card-header";
      const copy=document.createElement("div");copy.className="goal-card-copy";
      const title=document.createElement("h4");title.textContent=goal.title;copy.append(title);
      const date=document.createElement("small");date.textContent=goal.targetDate?("目标日期 · "+goal.targetDate):"无截止日期";copy.append(date);
      const status=document.createElement("span");status.className="goal-status";status.textContent=ended?"已完成":"进行中";copy.append(status);
      const actions=document.createElement("div");actions.className="goal-header-actions";
      const complete=document.createElement("button");complete.type="button";complete.className="mini-btn";complete.textContent=ended?"恢复目标":"目标完成";complete.onclick=()=>{
        const current=readGoals(),g=current.find(x=>x.id===goal.id);if(!g)return;
        if(ended){if(g.targetDate&&todayKey()>g.targetDate&&!g.completedAt){toast("已超过目标日期，不能恢复原目标期限。可以新建或将打卡恢复为长期活动。");return;}g.completedAt=0;}else{if(!confirm("确认完成“"+g.title+"”？完成后目标内所有步骤会显示为已完成，目标打卡也会停止。"))return;g.completedAt=Date.now();}writeGoals(current);renderStudyDesk();
      };
      const remove=document.createElement("button");remove.type="button";remove.className="mini-btn";remove.textContent="删除";remove.onclick=()=>{if(!confirm("删除目标“"+goal.title+"”及其步骤？不会删除已经排入日历的日程。"))return;writeGoals(readGoals().filter(g=>g.id!==goal.id));renderStudyDesk();};
      actions.append(complete,remove);header.append(copy,actions);card.append(header);
      const progress=document.createElement("div");progress.className="goal-progress-meta";progress.innerHTML="<span>"+doneCount+" / "+total+" 步完成</span><strong>"+pct+"%</strong>";card.append(progress);
      const track=document.createElement("div");track.className="goal-progress-track";const fill=document.createElement("span");fill.style.width=pct+"%";track.append(fill);card.append(track);
      const steps=document.createElement("div");steps.className="goal-step-list";
      goal.steps.forEach((step,index)=>{
        const checkin=goalCheckinForStep(step);
        if(checkin){
          steps.append(renderGoalCheckinRow(goal,step,ended));
          return;
        }
        const row=document.createElement("div");row.className="goal-step"+((ended||step.done)?" is-done":"");
        const check=document.createElement("input");check.type="checkbox";check.checked=ended||!!step.done;check.disabled=ended;check.setAttribute("aria-label","步骤完成状态："+step.title);
        check.onchange=()=>{const current=readGoals(),g=current.find(x=>x.id===goal.id);if(!g||!g.steps[index])return;g.steps[index].done=check.checked;g.steps[index].doneAt=check.checked?Date.now():0;writeGoals(current);renderStudyDesk();};
        const label=document.createElement("span");label.textContent=step.title;
        const schedule=document.createElement("button");schedule.type="button";schedule.className="goal-schedule-btn";schedule.textContent=step.scheduledEventIds?.length?"再次排入日程":"排进日程";schedule.disabled=ended||!!step.done;schedule.onclick=()=>scheduleGoalStep(goal.id,step.id);
        const checkinBtn=document.createElement("button");checkinBtn.type="button";checkinBtn.className="goal-checkin-set-btn";checkinBtn.textContent="设置打卡";checkinBtn.disabled=ended||!!step.done;checkinBtn.onclick=()=>openGoalCheckinDialog(goal,step);
        const deleteBtn=document.createElement("button");deleteBtn.type="button";deleteBtn.className="mini-btn";deleteBtn.textContent="删除步骤";deleteBtn.title="删除这个目标步骤";deleteBtn.disabled=ended;deleteBtn.onclick=()=>deleteGoalStep(goal.id,step.id);
        row.append(check,label,schedule,checkinBtn,deleteBtn);steps.append(row);
      });
      card.append(steps);
      const add=document.createElement("button");add.type="button";add.className="goal-add-step-btn";add.textContent="＋ 添加步骤";add.disabled=ended;add.onclick=()=>openAddGoalSteps(goal.id);
      card.append(add);list.append(card);
    });
  }
  function renderIndependentCheckins(){
    const list=$("independentCheckinList");if(!list)return;list.innerHTML="";
    if(!$("independentCheckinStart").value)$("independentCheckinStart").value=todayKey();
    const items=readCheckins().filter(x=>!x.goalId&&!x.stepId);
    if(!items.length){list.innerHTML='<div class="today-empty">还没有独立打卡活动。它们只存在于学习平台，不会进入日历。</div>';return;}
    items.forEach(item=>{
      const ended=checkinEnded(item),row=document.createElement("article");row.className="independent-checkin-card"+(ended?" is-ended":"");
      const title=document.createElement("h4");title.textContent=item.title;
      const meta=document.createElement("p");meta.textContent=item.longTerm?"长期打卡 · 起始 "+item.startDate:(item.startDate+" 至 "+item.endDate);
      const today=document.createElement("strong");today.textContent="今日 "+checkinCount(item)+" 次";
      const hit=document.createElement("button");hit.type="button";hit.className="primary-btn";hit.textContent=ended?"已结束":"今日 +1";hit.disabled=ended||todayKey()<item.startDate||(!item.longTerm&&item.endDate&&todayKey()>item.endDate);hit.onclick=()=>{if(incrementCheckin(item.id))renderStudyDesk();};
      const end=document.createElement("button");end.type="button";end.className="secondary-btn";end.textContent=item.longTerm?"结束该打卡活动":"恢复为长期打卡";end.onclick=()=>{
        const items=readCheckins(),current=items.find(x=>x.id===item.id);if(!current)return;
        if(item.longTerm){current.active=false;current.endedAt=Date.now();}else{current.longTerm=true;current.endDate="";current.active=true;current.endedAt=0;}writeCheckins(items);renderStudyDesk();toast(item.longTerm?"打卡活动已结束":"已恢复为长期打卡活动。");
      };
      const copy=document.createElement("div");copy.append(title,meta,today);const actions=document.createElement("div");actions.className="independent-checkin-actions";actions.append(hit,end);row.append(copy,actions);list.append(row);
    });
  }
  const checkinDashboardState={mode:"day",page:0};
  function checkinDashboardRecords(items){const rows=[];items.forEach(item=>Object.entries(item.counts||{}).forEach(([date,count])=>{const n=Math.max(0,Number(count)||0);if(n)rows.push({date,count:n});}));return rows;}
  function renderCheckinDashboard(){const wrap=$("checkinDashboard");if(!wrap)return;const items=readCheckins().filter(x=>x.active!==false||Object.keys(x.counts||{}).length),records=checkinDashboardRecords(items),today=todayKey(),mode=checkinDashboardState.mode,now=new Date(),year=now.getFullYear(),month=String(now.getMonth()+1).padStart(2,"0"),scope=mode==="day"?today:mode==="month"?year+"-"+month:String(year),scoped=records.filter(x=>mode==="day"?x.date===scope:mode==="month"?x.date.slice(0,7)===scope:x.date.slice(0,4)===scope),total=records.reduce((s,x)=>s+x.count,0),scopedTotal=scoped.reduce((s,x)=>s+x.count,0),todayTotal=records.filter(x=>x.date===today).reduce((s,x)=>s+x.count,0),activeDays=new Set(records.map(x=>x.date)).size,byDate={};scoped.forEach(x=>byDate[x.date]=(byDate[x.date]||0)+x.count);const chart=Object.entries(byDate).sort((a,b)=>a[0].localeCompare(b[0])).slice(-14),cards=items.slice().sort((a,b)=>checkinDashboardRecords([b]).reduce((s,x)=>s+x.count,0)-checkinDashboardRecords([a]).reduce((s,x)=>s+x.count,0)),size=4,pages=Math.max(1,Math.ceil(cards.length/size));checkinDashboardState.page=Math.min(checkinDashboardState.page,pages-1);const label=mode==="day"?"今日":mode==="month"?"本月":"今年";wrap.innerHTML='<div class="checkin-dashboard-head"><div><p class="eyebrow">CHECK-IN ANALYTICS</p><h4>打卡节奏与统计</h4><p class="muted small">数据直接来自本地打卡记录，不上传服务器。</p></div><div class="checkin-dashboard-tabs">'+["day","month","year"].map((m,i)=>'<button type="button" class="secondary-btn checkin-dashboard-tab '+(mode===m?"is-active":"")+'" data-checkin-mode="'+m+'">'+["日","月","年"][i]+"</button>").join("")+'</div></div><div class="checkin-dashboard-metrics"><article><span>今日</span><strong>'+todayTotal+'</strong><small>次打卡</small></article><article><span>'+label+'</span><strong>'+scopedTotal+'</strong><small>次累计</small></article><article><span>全部历史</span><strong>'+total+'</strong><small>次累计</small></article><article><span>活跃日期</span><strong>'+activeDays+'</strong><small>有记录的天数</small></article></div>';const chartBox=document.createElement("div");chartBox.className="checkin-chart";const max=Math.max(...chart.map(x=>x[1]),1);chartBox.innerHTML=chart.length?chart.map(([d,n])=>'<div class="checkin-chart-bar" title="'+d+" · "+n+' 次"><span style="height:'+Math.max(8,Math.round(n/max*100))+'%"></span><b>'+n+'</b><small>'+d.slice(5)+'</small></div>').join(""):'<div class="today-empty">当前统计周期还没有打卡记录。</div>';wrap.append(chartBox);const grid=document.createElement("div");grid.className="checkin-dashboard-cards";cards.slice(checkinDashboardState.page*size,(checkinDashboardState.page+1)*size).forEach(item=>{const period=checkinDashboardRecords([item]).filter(x=>mode==="day"?x.date===scope:mode==="month"?x.date.slice(0,7)===scope:x.date.slice(0,4)===scope).reduce((s,x)=>s+x.count,0),card=document.createElement("article");card.className="checkin-dashboard-card";card.innerHTML='<div><strong>'+String(item.title).replace(/</g,"&lt;")+'</strong><small>今日 '+checkinCount(item)+' 次 · '+label+' '+period+' 次</small></div>';const btn=document.createElement("button");btn.type="button";btn.className="primary-btn";btn.textContent="＋1";btn.disabled=checkinEnded(item)||today<item.startDate||(!item.longTerm&&item.endDate&&today>item.endDate);btn.onclick=()=>{if(incrementCheckin(item.id))renderStudyDesk();};card.append(btn);grid.append(card);});wrap.append(grid);if(cards.length>size){const pager=document.createElement("div");pager.className="checkin-dashboard-pager";pager.innerHTML='<button type="button" class="secondary-btn" data-checkin-page="-1">上一页</button><span>'+(checkinDashboardState.page+1)+" / "+pages+'</span><button type="button" class="secondary-btn" data-checkin-page="1">下一页</button>';wrap.append(pager);}wrap.querySelectorAll("[data-checkin-mode]").forEach(b=>b.onclick=()=>{checkinDashboardState.mode=b.dataset.checkinMode;checkinDashboardState.page=0;renderStudyDesk();});wrap.querySelectorAll("[data-checkin-page]").forEach(b=>b.onclick=()=>{checkinDashboardState.page=Math.max(0,Math.min(pages-1,checkinDashboardState.page+Number(b.dataset.checkin-page)));renderStudyDesk();});}
  function renderCheckinSection(){renderIndependentCheckins();renderCheckinDashboard();}
  $("goalCreateForm").addEventListener("submit",ev=>{ev.preventDefault();const title=$("goalTitleInput").value.trim(),targetDate=$("goalDateInput").value,steps=parseGoalStepLines($("goalStepsInput").value);if(!title){toast("请先填写目标名称。");return;}const goals=readGoals();goals.unshift({id:"goal-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,6),title:title.slice(0,120),targetDate,createdAt:Date.now(),completedAt:0,steps});if(writeGoals(goals)){ $("goalTitleInput").value="";$("goalDateInput").value="";$("goalStepsInput").value="";renderStudyDesk();toast("目标已保存。");}});
  $("goalAddStepsForm").addEventListener("submit",ev=>{
    ev.preventDefault();
    const goalId=$("goalAddStepsGoalId").value,steps=parseGoalStepLines($("goalAddStepsInput").value);
    if(!steps.length){toast("请至少填写一个步骤，每行一个。");return;}
    const goals=readGoals(),goal=goals.find(x=>x.id===goalId);if(!goal)return;
    goal.steps.push(...steps);
    if(writeGoals(goals)){$("goalAddStepsDialog").close();renderStudyDesk();toast("已添加 "+steps.length+" 个步骤。");}
  });
  $("goalCheckinLongTerm").addEventListener("change",()=>{$("goalCheckinEnd").disabled=$("goalCheckinLongTerm").checked;if($("goalCheckinLongTerm").checked)$("goalCheckinEnd").value="";});
  $("independentCheckinLongTerm").addEventListener("change",()=>{$("independentCheckinEnd").disabled=$("independentCheckinLongTerm").checked;if($("independentCheckinLongTerm").checked)$("independentCheckinEnd").value="";});
  $("goalCheckinForm").addEventListener("submit",ev=>{
    ev.preventDefault();
    const idValue=$("goalCheckinId").value,goalId=$("goalCheckinGoalId").value,stepId=$("goalCheckinStepId").value,title=$("goalCheckinTitle").value.trim(),startDate=$("goalCheckinStart").value,endDate=$("goalCheckinEnd").value,longTerm=$("goalCheckinLongTerm").checked;
    if(!title||!startDate||(!longTerm&&!endDate)||(!longTerm&&endDate<startDate)){toast("请填写有效的打卡名称和日期范围。");return;}
    const items=readCheckins();
    if(idValue){const item=items.find(x=>x.id===idValue);if(item){item.title=title;item.startDate=startDate;item.endDate=longTerm?"":endDate;item.longTerm=longTerm;item.active=true;item.endedAt=0;}}
    else{const item={id:"checkin-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7),title,startDate,endDate:longTerm?"":endDate,longTerm,active:true,createdAt:Date.now(),counts:{},goalId:goalId||"",stepId:stepId||""};items.unshift(item);if(goalId&&stepId){const goals=readGoals(),goal=goals.find(g=>g.id===goalId),step=goal?.steps.find(s=>s.id===stepId);if(step){step.checkinId=item.id;step.done=false;writeGoals(goals);}}}
    if(writeCheckins(items)){$("goalCheckinDialog").close();renderStudyDesk();toast(idValue?"打卡设置已更新":"打卡活动已创建");}
  });
  $("independentCheckinForm").addEventListener("submit",ev=>{
    ev.preventDefault();const title=$("independentCheckinTitle").value.trim(),startDate=$("independentCheckinStart").value,endDate=$("independentCheckinEnd").value,longTerm=$("independentCheckinLongTerm").checked;
    if(!title||!startDate||(!longTerm&&!endDate)||(!longTerm&&endDate<startDate)){toast("请填写有效的打卡名称和日期范围。");return;}
    const items=readCheckins();items.unshift({id:"checkin-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7),title,startDate,endDate:longTerm?"":endDate,longTerm,active:true,createdAt:Date.now(),counts:{},goalId:"",stepId:""});if(writeCheckins(items)){$("independentCheckinTitle").value="";$("independentCheckinStart").value=todayKey();$("independentCheckinEnd").value="";$("independentCheckinLongTerm").checked=true;$("independentCheckinEnd").disabled=true;renderStudyDesk();toast("长期打卡已创建");}
  });
  function renderStudyMomentum(tasks){
    const today=dateKey(new Date()),focus=readLocalList(FOCUS_HISTORY_KEY).filter(x=>x&&x.date===today),actual=focus.reduce((sum,x)=>sum+Math.max(0,Number(x.minutes)||0),0),done=tasks.filter(e=>e.done).length,plan=tasks.reduce((sum,e)=>sum+(Number(e.study.estimatedMinutes)||30),0),rate=tasks.length?Math.round(done/tasks.length*100):0;
    const completionDays=new Set(readLocalList(COMPLETION_HISTORY_KEY).filter(x=>x&&x.done&&x.date<=today).map(x=>x.date));let streak=0,d=new Date();
    while(streak<365){const key=dateKey(d);if(!completionDays.has(key))break;streak++;d.setDate(d.getDate()-1);}
    $("studyPlanMinutes").textContent=plan>=60?Math.floor(plan/60)+" 小时"+(plan%60?" "+plan%60+" 分钟":""):plan+" 分钟";
    $("studyActualMinutes").textContent=actual>=60?Math.floor(actual/60)+" 小时"+(actual%60?" "+actual%60+" 分钟":""):actual+" 分钟";
    $("studyDoneRate").textContent=rate+"%";$("studyStreak").querySelector("strong").textContent=streak+" 天";
    const next=tasks.filter(e=>!e.done).sort((a,b)=>(Number(b.study.priority)||1)-(Number(a.study.priority)||1)||(a.time||"99:99").localeCompare(b.time||"99:99"))[0];
    $("studyMomentumNext").textContent=next?next.title:"全部完成";
    const ratio=plan?Math.min(100,Math.round(actual/plan*100)):0;$("studyRhythmBar").style.width=Math.max(rate,ratio)+"%";
    $("studyMomentumMessage").textContent=!tasks.length?"今天没有学习任务，给自己留一点空间。":done===tasks.length?"今天的学习任务全部完成了。可以休息，也可以回顾专注记录。":actual?"已经进入节奏：今天实际专注 "+actual+" 分钟。下一步继续一轮小而明确的专注。":"先不要追求完整，点击任意任务的“开始专注”，完成第一轮就算启动节奏。";
  }
  function renderStudyDesk(){
    const today=dateKey(new Date());
    const todayEvents=occurrenceEvents(today);
    renderTodayOverview(today,todayEvents);
    renderWeeklyReview();
    renderGoals();
    renderCheckinSection();
    const tasks=todayEvents.filter(studyEvent);
    renderStudyMomentum(tasks);
    const done=tasks.filter(e=>e.done).length;
    const pending=tasks.filter(e=>!e.done);
    const minutes=tasks.reduce((sum,e)=>sum+(Number(e.study.estimatedMinutes)||30),0);
    const pct=tasks.length?Math.round(done/tasks.length*100):0;
    $("studyTaskCount").textContent=String(pending.length);
    $("studyMinutes").textContent=minutes>=60?Math.floor(minutes/60)+" 小时"+(minutes%60?" "+(minutes%60)+" 分钟":""):minutes+" 分钟";
    $("studyCompletion").textContent=done+" / "+tasks.length;
    $("studyProgressBar").style.width=pct+"%";
    $("studyListDate").textContent=parseDate(today).toLocaleDateString("zh-CN",{month:"short",day:"numeric",weekday:"short"});
    const recommendation=$("studyRecommendation");recommendation.innerHTML="";
    const overdue=state.events.filter(e=>studyEvent(e)&&(e.repeat||"none")==="none"&&e.date<today&&!e.done).sort((a,b)=>(Number(b.study.priority)||1)-(Number(a.study.priority)||1)||a.date.localeCompare(b.date));
    const candidates=overdue.map(e=>({...e,_overdue:true})).concat(pending).sort((a,b)=>{
      const oa=a._overdue?1:0,ob=b._overdue?1:0;
      return ob-oa||(Number(b.study.priority)||1)-(Number(a.study.priority)||1)||(a.date||today).localeCompare(b.date||today)||(a.time||"99:99").localeCompare(b.time||"99:99");
    });
    if(candidates.length){
      const e=candidates[0],mins=Number(e.study.estimatedMinutes)||30;
      const reason=e._overdue?"这项任务已经逾期，建议先决定是完成它还是重新安排。":(Number(e.study.priority)||1)>=3?"这是你标记的重要学习任务。":e.date===today&&e.time?"这项任务已安排在今天，适合按计划开始。":"这是目前优先级较高的未完成学习任务。";
      recommendation.innerHTML='<div class="recommendation-kicker">建议先做</div><h4>'+esc(e.title)+'</h4><p>'+esc(reason)+'</p><div class="recommendation-meta"><span>◷ '+mins+' 分钟</span><span>▦ '+esc(e.study.subject||"未分类")+'</span></div><button type="button" class="primary-btn" id="studyRecommendationEdit">查看 / 编辑任务</button>';
      $("studyRecommendationEdit").addEventListener("click",()=>editEvent(e.id));
    }else{
      recommendation.innerHTML='<div class="study-empty-icon">✦</div><h4>先把想学的内容放进计划</h4><p>创建一项学习任务后，NEXUS 会根据优先级、日期和预计时长给出下一步建议。</p><button type="button" class="primary-btn" id="studyRecommendationAdd">＋ 新建学习任务</button>';
      $("studyRecommendationAdd").addEventListener("click",()=>$("studyAddBtn").click());
    }
    const list=$("studyTaskList");list.innerHTML="";
    if(!tasks.length)list.innerHTML='<div class="study-empty-state">今天还没有学习任务。为自己安排一个小而明确的开始吧。</div>';
    else tasks.slice().sort((a,b)=>(Number(b.study.priority)||1)-(Number(a.study.priority)||1)||(a.time||"99:99").localeCompare(b.time||"99:99")).forEach(e=>list.append(studyTaskCard(e)));
    const reality=$("studyRealityCheck");
    const timed=tasks.filter(e=>e.time&&e.endTime);
    const scheduledMinutes=timed.reduce((sum,e)=>{const p=e.time.split(":").map(Number),q=e.endTime.split(":").map(Number);const n=q[0]*60+q[1]-p[0]*60-p[1];return sum+(n>0?n:0);},0);
    if(!tasks.length)reality.innerHTML='<strong>等待你的第一项学习任务</strong><p>把科目、预计时长和优先级写下来，就能开始规划。</p>';
    else if(done===tasks.length)reality.innerHTML='<strong>今日学习任务已全部完成</strong><p>完成了 '+tasks.length+' 项任务，预计时长合计 '+minutes+' 分钟。可以休息，或主动安排额外学习。</p>';
    else if(timed.length&&minutes-scheduledMinutes>30)reality.innerHTML='<strong>有些学习时间尚未安排到具体时段</strong><p>任务预计 '+minutes+' 分钟，已设置开始和结束时间的任务约 '+scheduledMinutes+' 分钟。请检查是否需要为其安排时间块。</p>';
    else reality.innerHTML='<strong>计划已整理，记得留出缓冲</strong><p>当前有 '+pending.length+' 项未完成学习任务。预计时长是参考值；若时间不足，可调整优先级或日期。</p>';
    const overdueWrap=$("studyOverdueWrap"),overdueList=$("studyOverdueList");overdueList.innerHTML="";
    overdueWrap.hidden=!overdue.length;
    overdue.slice(0,8).forEach(e=>overdueList.append(studyTaskCard(e,true)));
    if(overdue.length>8){const more=document.createElement("p");more.className="muted tiny";more.textContent="另有 "+(overdue.length-8)+" 项逾期学习任务。";overdueList.append(more);}
  }
  function render(){renderCalendar();renderDay();renderProgress();renderStudyDesk();checkReminders();updateCountdowns();updateSpecialSummaryLive();}
  function renderCalendar(){const y=state.cursor.getFullYear(),m=state.cursor.getMonth();$("periodTitle").textContent=state.view==="day"?state.selected:state.cursor.toLocaleDateString("zh-CN",{year:"numeric",month:"long"});$("calendarHeading").textContent=state.view==="day"?"单日安排":"日历概览";$("calendarGrid").classList.toggle("day-view",state.view==="day");document.querySelectorAll(".view-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===state.view));const grid=$("calendarGrid");grid.innerHTML="";if(state.view==="day"){const selected=parseDate(state.selected);const start=new Date(selected);start.setDate(selected.getDate()-selected.getDay());for(let i=0;i<7;i++){const d=new Date(start);d.setDate(start.getDate()+i);grid.append(makeDayCell(fmtDate(d),d.getDate(),d.getMonth()!==selected.getMonth()));}return;}const first=new Date(y,m,1),offset=first.getDay(),days=new Date(y,m+1,0).getDate(),prevDays=new Date(y,m,0).getDate();for(let i=0;i<42;i++){let d,key,outside=false;if(i<offset){d=prevDays-offset+i+1;key=fmtDate(new Date(y,m-1,d));outside=true;}else if(i>=offset+days){d=i-offset-days+1;key=fmtDate(new Date(y,m+1,d));outside=true;}else{d=i-offset+1;key=fmtDate(new Date(y,m,d));}grid.append(makeDayCell(key,d,outside));}}
  function makeDayCell(key,day,outside){const btn=document.createElement("button");btn.type="button";btn.className="calendar-day"+(outside?" outside":"")+(key===state.selected?" selected":"")+(key===dateKey(new Date())?" today":"");btn.setAttribute("aria-label",key+" 日程");const number=document.createElement("span");number.className="day-number";number.textContent=day;btn.append(number);const evs=occurrenceEvents(key);if(evs.length){const wrap=document.createElement("span");wrap.className="day-events";evs.slice(0,2).forEach(e=>{const chip=document.createElement("span");const info=getSummaryStatus(e,key,new Date());chip.className="event-chip"+(e.done?" done":(!e.time?" todo":""))+(!e.done&&info.code!=="upcoming"?" status-"+info.code:"");chip.textContent=(e.specialReminder?"★ ":"")+(e.time?e.time+" ":"")+(info.code==="complete"?"✓ ":info.code==="ongoing"?"进行中 · ":info.code==="missed"?"已错过 · ":"")+e.title;if(e.specialReminder)chip.classList.add("special-event-chip");wrap.append(chip);});btn.append(wrap);if(evs.length>2){const more=document.createElement("span");more.className="more-chip";more.textContent="+"+(evs.length-2)+" 项";btn.append(more);}}btn.addEventListener("click",()=>{state.selected=key;state.cursor=new Date(parseDate(key).getFullYear(),parseDate(key).getMonth(),1);render();});return btn;}
  function renderDay(){const d=parseDate(state.selected),evs=occurrenceEvents(state.selected);$("selectedHeading").textContent=d.toLocaleDateString("zh-CN",{month:"long",day:"numeric",weekday:"long"});$("selectedBadge").textContent=state.selected.slice(5);const list=$("eventList");list.innerHTML="";if(!evs.length){list.innerHTML='<div class="empty-state"><div class="empty-icon">⌁</div>这一天还没有安排。<br>给自己留一点可能性。</div>';return;}evs.forEach(e=>{const card=document.createElement("article");card.className="event-card"+(e.done?" done":"")+(e.time?"":" todo");const time=e.longTask?("长期任务 · "+(e.occurrenceDate===e.date?"开始":e.occurrenceDate===(e.endDate||e.date)?"结束":"进行中")+" · "+(e.time||"未定时")):(e.time?(e.endTime?e.time+" – "+e.endTime:e.time+" · 待办"):(e.repeat!=="none"?"重复日程":"待办事项"));card.innerHTML='<span class="event-stripe"></span><div class="event-main"><div class="event-time">'+esc(time)+(e.repeat!=="none"?' · '+repeatLabel(e.repeat):"")+'</div><div class="event-title">'+(e.specialReminder?'<span class="special-star" aria-label="特别提醒">★</span> ':"")+esc(e.title)+(function(){const st=getSummaryStatus(e,e.occurrenceDate,new Date());return st.code!=="upcoming"?' <span class="event-status-badge event-status-'+st.code+'">'+st.label+'</span>':"";})()+'</div>'+(e.location?'<div class="event-meta">⌖ '+esc(e.location)+'</div>':"")+(e.notes?'<div class="event-meta">'+esc(e.notes)+'</div>':"")+'</div><div class="event-actions"><button class="check-btn '+(e.done?"checked":"")+'" title="'+(e.done?"标记未完成":"标记完成")+'" aria-label="'+(e.done?"标记未完成":"标记完成")+'">'+(e.done?"✓":"○")+'</button><button class="mini-btn" title="编辑" aria-label="编辑">✎</button><button class="mini-btn" title="删除" aria-label="删除">×</button></div>';const buttons=card.querySelectorAll("button");buttons[0].addEventListener("click",()=>toggleDone(e.seriesId,e.occurrenceDate));buttons[1].addEventListener("click",()=>editEvent(e.seriesId,e.occurrenceDate));buttons[2].addEventListener("click",()=>deleteEvent(e.seriesId));const star=document.createElement("button");star.type="button";star.className="mini-btn event-star-btn"+(e.specialReminder?" is-special":"");star.title=e.specialReminder?"取消特别提醒":"设为特别提醒";star.setAttribute("aria-label",star.title);star.textContent="★";star.addEventListener("click",()=>toggleSpecialReminder(e.seriesId,e.occurrenceDate));card.querySelector(".event-actions").insertBefore(star,buttons[1]);list.append(card);});}
  function repeatLabel(r){return ({daily:"每天重复",weekly:"每周重复",weekdays:"工作日重复",monthly:"每月重复"})[r]||"";}
  function renderProgress(){const evs=occurrenceEvents(state.selected),done=evs.filter(e=>e.done).length,total=evs.length,pct=total?Math.round(done/total*100):0;$("progressCount").textContent=done+" / "+total;$("progressPercent").textContent=pct+"%";$("progressBar").style.width=pct+"%";}
  function toggleSpecialReminder(eventId,key){const e=state.events.find(x=>x.id===eventId);if(!e)return;snapshot();e.specialReminder=!e.specialReminder;save();render();toast(e.specialReminder?"已设为特别提醒":"已取消特别提醒");}
  function toggleDone(eventId,key){snapshot();const e=state.events.find(x=>x.id===eventId);if(!e)return;e.done=!e.done;recordCompletion(e,e.done,key||dateKey(new Date()));save();render();toast(e.done?"已标记完成":"已恢复为未完成");}
  function syncCountdownOption(){const label=$("countdownOption");const enabled=!!$("eventEnd").value;if(label)label.hidden=!enabled;if(!enabled)$("eventCountdownEnabled").checked=false;}
  function openEditor(e,longTask=false){$("eventForm").reset();$("eventId").value=e?.id||"";const isLongTask=!!(longTask||e?.longTask);$("longTaskMode").value=String(isLongTask);$("longTaskEndDateField").hidden=!isLongTask;$("eventEndDate").required=isLongTask;$("eventEndDate").value=e?.endDate||e?.date||state.selected;$("eventRepeat").disabled=isLongTask||state.occurrenceEditContext?.mode==="series";$("dialogTitle").textContent=isLongTask?(e?"编辑长期任务":"新建长期任务"):(e?"编辑日程":"新建日程");$("eventDate").disabled=state.occurrenceEditContext?.mode==="series";$("eventRepeat").disabled=isLongTask||state.occurrenceEditContext?.mode==="series";const scopeHint=$("editScopeHint");if(scopeHint){scopeHint.hidden=!state.occurrenceEditContext;scopeHint.textContent=state.occurrenceEditContext?.mode==="series"?"统一修改模式：会更新所有同名日程的标题、时间、地点、提醒和星标；各日程日期与重复规则保持不变。":state.occurrenceEditContext?.mode==="single"?"单日程修改模式：只影响选中的这一天；其他重复日期保持不变。":"";} $("eventTitle").value=e?.title||"";$("eventStudyToggle").hidden=interfaceMode==="classic"&&!e?.study;$("eventStudyEnabled").checked=!!e?.study;$("eventStudySubject").value=e?.study?.subject||"";$("eventStudyMinutes").value=String(e?.study?.estimatedMinutes||30);$("eventStudyPriority").value=String(e?.study?.priority||1);$("eventStudyFields").hidden=!$("eventStudyEnabled").checked;$("eventDate").value=state.occurrenceEditContext?.mode==="single"?state.occurrenceEditContext.occurrenceDate:e?.date||state.selected;$("eventRepeatUntil").value=e?.repeatUntil||"";$("eventTime").value=e?.time||"";$("eventEnd").value=e?.endTime||"";$("eventReminder").value=String(e?.reminder||0);$("eventLocation").value=e?.location||"";$("eventNotes").value=e?.notes||"";$("eventRepeat").value=e?.repeat||"none";$("eventCountdownEnabled").checked=!!e?.countdownEnabled;$("eventSpecialReminder").checked=!!e?.specialReminder;syncCountdownOption();$("eventDialog").showModal();setTimeout(()=>$("eventTitle").focus(),30);}
  $("eventEnd").addEventListener("input",syncCountdownOption);
  $("eventStudyEnabled").addEventListener("change",()=>{$("eventStudyFields").hidden=!$("eventStudyEnabled").checked;});
  $("studyModeBtn").addEventListener("click",()=>applyInterfaceMode("study"));
  $("classicModeBtn").addEventListener("click",()=>applyInterfaceMode("classic"));
  $("studyAddBtn").addEventListener("click",()=>{$("addBtn").click();$("eventDate").value=dateKey(new Date());$("eventStudyEnabled").checked=true;$("eventStudyFields").hidden=false;});
  function editEvent(eventId,occurrenceDate=state.selected){
    const e=state.events.find(x=>x.id===eventId);if(!e)return;
    const key=occurrenceDate||e.date;
    const normalizeTitle=x=>String(x||"").trim().replace(/\\s+/g," ").toLowerCase();const sameNameIds=state.events.filter(x=>normalizeTitle(x.title)===normalizeTitle(e.title)).map(x=>x.id);
    const hasRepeat=e.repeat!=="none";
    const hasSameNameRepeat=sameNameIds.some(id=>{const x=state.events.find(y=>y.id===id);return x&&x.repeat!=="none";});
    if(hasRepeat||hasSameNameRepeat){
      const series=confirm("发现同名重复日程。\n\n点击“确定”：统一修改所有同名日程；\n点击“取消”：只修改当前这一天。\n\n统一修改只更新标题、时间、地点、提醒、备注等细节，各自日期保持不变。");
      state.occurrenceEditContext={occurrenceDate:key,mode:series?"series":"single",matchingIds:series?sameNameIds:[]};
      openEditor(series?e:{...e,...(e.overrides&&e.overrides[key]||{}),date:key});
    }else{
      state.occurrenceEditContext=null;openEditor(e);
    }
  }
  function deleteEvent(eventId){const e=state.events.find(x=>x.id===eventId);if(!e)return;const message=e.repeat!=="none"?"这会删除整个重复系列，而不是只删除当天。建议先导出备份。确定删除？":"确定删除“"+e.title+"”？";if(!confirm(message))return;snapshot();state.events=state.events.filter(x=>x.id!==eventId);save();render();toast("日程已删除。可用撤销恢复。");}
  $("eventForm").addEventListener("submit",ev=>{
    ev.preventDefault();
    const title=$("eventTitle").value.trim(),date=$("eventDate").value,endDate=$("eventEndDate").value,time=$("eventTime").value,endTime=$("eventEnd").value,reminder=Number($("eventReminder").value),longTask=$("longTaskMode").value==="true",countdownEnabled=!!$("eventCountdownEnabled").checked&&!!endTime,specialReminder=!!$("eventSpecialReminder").checked;
    const studyData=$("eventStudyEnabled").checked?{subject:$("eventStudySubject").value.trim(),estimatedMinutes:Math.max(5,Math.min(1440,Number($("eventStudyMinutes").value)||30)),priority:Math.max(1,Math.min(3,Number($("eventStudyPriority").value)||1))}:undefined;
    if(!title||!date){toast("请填写事项名称和日期");return;}
    if(longTask&&(!endDate||endDate<date)){toast("长期任务的结束日期不能早于开始日期");return;}
    const repeatUntilInput=$("eventRepeatUntil").value;
    if(repeatUntilInput&&repeatUntilInput<date){toast("重复结束日期不能早于开始日期");return;}
    if(endTime&&!time){toast("设置结束时间前，请先填写开始时间");return;}
    if(!longTask&&time&&endTime&&endTime<=time){toast("结束时间必须晚于开始时间");return;}
    if(longTask&&date===endDate&&time&&endTime&&endTime<=time){toast("同一天的结束时间必须晚于开始时间");return;}
    if(countdownEnabled&&!time){toast("自动倒计时需要开始时间");return;}
    const oldId=$("eventId").value,previous=oldId?state.events.find(e=>e.id===oldId):null;
    const context=state.occurrenceEditContext;
    if(previous&&context&&context.mode==="single"&&(previous.repeat||"none")!=="none"){
      snapshot();
      const key=context.occurrenceDate, oldOverrides=previous.overrides||{}, base=oldOverrides[key]||{};
      const updated={title,time,endTime,reminder,countdownEnabled,specialReminder,location:$("eventLocation").value.trim(),notes:$("eventNotes").value.trim(),study:studyData};
      state.reminderQueue=state.reminderQueue.filter(entry=>!entry.key.startsWith(previous.id+"@"+key+":"));for(const queuedKey of state.reminderSnoozed.keys())if(queuedKey.startsWith(previous.id+"@"+key+":"))state.reminderSnoozed.delete(queuedKey);
      if(date!==key){
        previous.excludedDates=Array.isArray(previous.excludedDates)?previous.excludedDates:[];
        if(!previous.excludedDates.includes(key))previous.excludedDates.push(key);
        state.events.push({...previous,...base,...updated,id:id(),date,repeat:"none",done:false,excludedDates:[],overrides:undefined});
      }else previous.overrides={...oldOverrides,[key]:{...base,...updated}};
      state.occurrenceEditContext=null;save();state.selected=date;const d=parseDate(date);state.cursor=new Date(d.getFullYear(),d.getMonth(),1);$("eventDialog").close();render();checkReminders();updateCountdowns();toast(date!==key?"已将这一次日程移到新日期":"已仅修改这一天的日程，其他重复日期不变");return;
    }
    if(context&&context.mode==="series"&&previous){/* retain the original series start date */}
    state.occurrenceEditContext=null;
    const timingChanged=!!previous&&(["date","endDate","time","endTime","reminder"].some(k=>String(previous[k]||"")!==String(({date,time,endTime,reminder})[k]||""))||!!previous.countdownEnabled!==countdownEnabled);
    const reminderRevision=(previous?Number(previous.reminderRevision||0):0)+(timingChanged?1:0);
    const repeatUntil=longTask?"":$("eventRepeatUntil").value;const item={id:oldId||id(),title,date:context&&context.mode==="series"&&previous?previous.date:date,...(longTask?{longTask:true,endDate}:{}),time,endTime,reminder,reminderRevision,countdownEnabled,specialReminder,location:$("eventLocation").value.trim(),notes:$("eventNotes").value.trim(),repeat:longTask?"none":$("eventRepeat").value,repeatUntil:repeatUntil||undefined,done:previous?!!previous.done:false,excludedDates:Array.isArray(previous?.excludedDates)?previous.excludedDates:[],overrides:context&&context.mode==="series"?{}:(previous?.overrides||{}),study:studyData};
    if(timingChanged&&oldId){const affectedIds=context&&context.mode==="series"&&Array.isArray(context.matchingIds)&&context.matchingIds.length?context.matchingIds:[oldId];const affected=new Set(affectedIds);state.reminderQueue=state.reminderQueue.filter(entry=>!affected.has(entry.event.id));for(const key of state.reminderSnoozed.keys())if(affectedIds.some(id=>key.startsWith(id+"@")))state.reminderSnoozed.delete(key);}
    snapshot();
    if(context&&context.mode==="series"&&Array.isArray(context.matchingIds)&&context.matchingIds.length){
      const ids=new Set(context.matchingIds);
      state.events=state.events.map(existing=>ids.has(existing.id)?{...existing,title:item.title,time:item.time,endTime:item.endTime,reminder:item.reminder,reminderRevision:item.reminderRevision,countdownEnabled:item.countdownEnabled,specialReminder:item.specialReminder,location:item.location,notes:item.notes,study:item.study,overrides:{}}:existing);
    }else if(oldId)state.events=state.events.map(e=>e.id===oldId?item:e);else state.events.push(item);
    save();state.selected=date;const parsed=parseDate(date);state.cursor=new Date(parsed.getFullYear(),parsed.getMonth(),1);$("eventDialog").close();render();checkReminders();updateCountdowns();toast(oldId?"日程已更新":"日程已保存到当前浏览器");
  });
  $("addBtn").addEventListener("click",()=>openEditor());$("addLongTaskBtn").addEventListener("click",()=>openEditor(null,true));$("addForDayBtn").addEventListener("click",()=>openEditor());$("closeDialog").addEventListener("click",()=>$("eventDialog").close());$("cancelDialog").addEventListener("click",()=>$("eventDialog").close());
  $("prevBtn").addEventListener("click",()=>{if(state.view==="day"){const d=parseDate(state.selected);d.setDate(d.getDate()-1);state.selected=fmtDate(d);state.cursor=new Date(d.getFullYear(),d.getMonth(),1);}else state.cursor=new Date(state.cursor.getFullYear(),state.cursor.getMonth()-1,1);render();});
  $("nextBtn").addEventListener("click",()=>{if(state.view==="day"){const d=parseDate(state.selected);d.setDate(d.getDate()+1);state.selected=fmtDate(d);state.cursor=new Date(d.getFullYear(),d.getMonth(),1);}else state.cursor=new Date(state.cursor.getFullYear(),state.cursor.getMonth()+1,1);render();});
  $("todayBtn").addEventListener("click",()=>{state.selected=dateKey(new Date());state.cursor=new Date(new Date().getFullYear(),new Date().getMonth(),1);render();});document.querySelectorAll(".view-btn").forEach(b=>b.addEventListener("click",()=>{state.view=b.dataset.view;renderCalendar();}));
  const RECOVERY_BACKUP_KEY="nexus-planner-pre-import-backup-v1";
  const BACKUP_STATE_KEYS=[REMINDER_SEEN_KEY,INTERFACE_MODE_KEY,TODAY_FOCUS_KEY,FOCUS_SESSION_KEY,COMPLETION_HISTORY_KEY,FOCUS_HISTORY_KEY,WEEKLY_REFLECTION_KEY,GOALS_KEY,CHECKINS_KEY];
  function readBackupState(){const local={};for(const key of BACKUP_STATE_KEYS){try{const raw=localStorage.getItem(key);if(raw!==null)local[key]=raw;}catch(e){}}
    return local;
  }
  function restoreBackupState(local){if(!local||typeof local!=="object")return;for(const key of BACKUP_STATE_KEYS){try{if(Object.prototype.hasOwnProperty.call(local,key))localStorage.setItem(key,String(local[key]));else localStorage.removeItem(key);}catch(e){}}
  }
  function backupPayload(){return {app:"NEXUS Planner",version:3,exportedAt:new Date().toISOString(),events:state.events,reminderSeen:[...state.reminderSeen],localState:readBackupState()};}
  function downloadBackup(payload,filename){const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function updateRecoveryButton(){const button=$("restoreImportBackupBtn");if(button)button.hidden=!localStorage.getItem(RECOVERY_BACKUP_KEY);}
  $("exportBtn").addEventListener("click",()=>{downloadBackup(backupPayload(),"nexus-planner-backup-"+dateKey(new Date())+".json");toast("备份已导出，包含日程、重复规则、单次修改和提醒状态。");});
  $("importBtn").addEventListener("click",()=>$("importFile").click());
  $("importFile").addEventListener("change",async ev=>{
    const file=ev.target.files?.[0];if(!file)return;
    try{
      const data=JSON.parse(await file.text()),events=Array.isArray(data)?data:data?.events;
      if(!Array.isArray(events)||!events.every(validEvent)||events.some(e=>!e.title.trim()||!Number.isFinite(Date.parse(e.date+"T12:00:00"))))throw new Error("invalid");
      const seen=Array.isArray(data?.reminderSeen)?data.reminderSeen.filter(k=>typeof k==="string"): [];
      const hasExtendedState=!!(data?.localState&&typeof data.localState==="object");
      const exportedAt=typeof data?.exportedAt==="string"?new Date(data.exportedAt).toLocaleString():"旧版备份（未记录导出时间）";
      const extras=hasExtendedState?Object.keys(data.localState).filter(k=>BACKUP_STATE_KEYS.includes(k)).length:0;
      const ok=confirm("备份文件："+file.name+"\n导出时间："+exportedAt+"\n包含 "+events.length+" 条日程"+(hasExtendedState?"，以及 "+extras+" 组学习/目标/复盘数据":"")+"。\n\n导入会替换本设备当前的数据。继续后，系统会先自动保存一份完整的导入前备份，之后可恢复。\n\n确定导入吗？");
      if(!ok)return;
      const current=JSON.stringify(backupPayload());
      localStorage.setItem(RECOVERY_BACKUP_KEY,current);
      const previousEvents=state.events,previousSeen=[...state.reminderSeen],previousLocalState=readBackupState();
      try{
        state.events=events;save();
        if(hasExtendedState)restoreBackupState(data.localState);
        state.reminderSeen.clear();(hasExtendedState?JSON.parse(localStorage.getItem(REMINDER_SEEN_KEY)||"[]"):seen).filter(k=>typeof k==="string").forEach(k=>state.reminderSeen.add(k));persistReminderSeen();
      }catch(error){
        state.events=previousEvents;state.reminderSeen.clear();previousSeen.forEach(k=>state.reminderSeen.add(k));
        try{localStorage.setItem(STORAGE_KEY,JSON.stringify({version:1,events:previousEvents}));restoreBackupState(previousLocalState);persistReminderSeen();}catch(_){}
        throw error;
      }
      snapshot();updateRecoveryButton();render();toast("备份导入完成；如需撤回，可恢复导入前数据。");
    }catch(e){toast("备份无法读取或格式不受支持，当前日程未主动替换。");}
    finally{ev.target.value="";}
  });
  $("restoreImportBackupBtn").addEventListener("click",()=>{
    let backup;
    try{backup=JSON.parse(localStorage.getItem(RECOVERY_BACKUP_KEY)||"null");}catch(_){}
    if(!backup||!Array.isArray(backup.events)||!backup.events.every(validEvent)){toast("没有可用的导入前备份。");updateRecoveryButton();return;}
    if(!confirm("将恢复导入前保存的 "+backup.events.length+" 条日程，并替换当前全部日程。确定恢复吗？"))return;
    const current=JSON.stringify(backupPayload());
    try{
      state.events=backup.events;save();
      if(backup.localState&&typeof backup.localState==="object")restoreBackupState(backup.localState);
      state.reminderSeen.clear();(backup.localState&&backup.localState[REMINDER_SEEN_KEY]?JSON.parse(localStorage.getItem(REMINDER_SEEN_KEY)||"[]"):Array.isArray(backup.reminderSeen)?backup.reminderSeen:[]).filter(k=>typeof k==="string").forEach(k=>state.reminderSeen.add(k));persistReminderSeen();
      localStorage.setItem(RECOVERY_BACKUP_KEY,current);snapshot();render();toast("已恢复；目标、学习、复盘等数据也已回到导入前状态。");
    }catch(e){toast("恢复失败，存储空间可能不足。");}
  });
  updateRecoveryButton();
  function showNextReminder(){
    if(state.activeReminder||state.startupSummaryActive||state.startupSummaryQueue.length||!state.reminderQueue.length)return;
    const item=state.reminderQueue.shift();state.activeReminder=item;
    const overlay=$("reminderOverlay");
    $("reminderBadgeText").textContent=item.kind==="advance"?"即将开始":item.kind==="start"?"待办正式开始":item.kind==="finish"?"限时任务结束":"日程提醒";
    $("reminderTitle").textContent=item.event.title;
    $("reminderTime").textContent=(item.event.time||"未设置时间")+" · "+item.event.date+(item.event.endTime?" – "+item.event.endTime:"");
    $("reminderLocation").textContent=item.event.location||"未设置地点";
    $("reminderNotes").textContent=item.event.notes||"";
    overlay.hidden=false;document.body.classList.add("reminder-open");
    if("Notification"in window&&Notification.permission==="granted"){
      try{new Notification("NEXUS "+$("reminderBadgeText").textContent,{body:item.event.title+" · "+(item.event.time||"")+(item.event.location?" · "+item.event.location:""),tag:item.key});}catch(_){}
    }
  }
  function closeReminder(){state.activeReminder=null;$("reminderOverlay").hidden=true;document.body.classList.remove("reminder-open");showNextReminder();showNextStartupSummary();}
  $("dismissReminderBtn").addEventListener("click",closeReminder);
  $("snoozeReminderBtn").addEventListener("click",()=>{
    const item=state.activeReminder;if(!item)return;
    state.reminderSnoozed.set(item.key,{event:item.event,at:Date.now()+5*60000,kind:item.kind});
    toast("已延后 5 分钟提醒");closeReminder();
  });
  function enqueueReminder(key,event,kind){
    if(state.reminderSeen.has(key))return;
    state.reminderSeen.add(key);persistReminderSeen();
    state.reminderQueue.push({key,event:{...event},kind});
  }
  function checkReminders(){
    const now=new Date(),todayKey=fmtDate(now),nowMs=now.getTime(),catchUp=15*60000;
    for(const [key,item] of state.reminderSnoozed){
      if(nowMs>=item.at){
        state.reminderSnoozed.delete(key);
        state.reminderQueue.push({key:key+":snooze:"+nowMs,event:item.event,kind:item.kind});
      }
    }
    for(const e of occurrenceEvents(todayKey)){
      if(!e.time||e.done||(e.longTask&&todayKey!==e.date))continue;
      const start=parseDate(todayKey),parts=e.time.split(":").map(Number);
      if(parts.length<2||!Number.isFinite(parts[0])||!Number.isFinite(parts[1]))continue;
      start.setHours(parts[0],parts[1],0,0);
      const startMs=start.getTime(),reminder=Number(e.reminder||0),revision=Number(e.reminderRevision||0);
      const common=e.id+"@"+todayKey+":r"+revision+":"+e.time+":"+(e.endTime||"")+":"+reminder;
      if(reminder>0&&nowMs<startMs){
        const advanceAt=startMs-reminder*60000,delta=nowMs-advanceAt;
        if(delta>=0&&delta<catchUp)enqueueReminder(common+":advance",e,"advance");
      }
      const startDelta=nowMs-startMs,startKey=common+":start";
      if(startDelta>=0&&startDelta<catchUp&&!state.reminderSeen.has(startKey)){
        if(e.endTime&&e.countdownEnabled){
          state.reminderSeen.add(startKey);persistReminderSeen();
        }else enqueueReminder(startKey,e,"start");
      }
    }
    showNextReminder();
  }
  function completeCountdown(eventId){
    const e=state.events.find(item=>item.id===eventId);if(!e)return;
    snapshot();e.done=true;recordCompletion(e,true,dateKey(new Date()));save();state.countdownMinimized=false;render();
    toast("已确认完成："+e.title);
  }
  function minimizeCountdown(){state.countdownMinimized=true;updateCountdowns();}
  function restoreCountdown(){state.countdownMinimized=false;updateCountdowns();}
  function setupCountdownBubbleDrag(){
    const bubble=$("countdownBubble");let dragging=false,moved=false,startX=0,startY=0,left=0,top=0;
    bubble.addEventListener("pointerdown",ev=>{dragging=true;moved=false;startX=ev.clientX;startY=ev.clientY;const r=bubble.getBoundingClientRect();left=r.left;top=r.top;bubble.setPointerCapture(ev.pointerId);});
    bubble.addEventListener("pointermove",ev=>{if(!dragging)return;const dx=ev.clientX-startX,dy=ev.clientY-startY;if(Math.abs(dx)>4||Math.abs(dy)>4)moved=true;if(moved){bubble.style.left=Math.max(0,Math.min(window.innerWidth-bubble.offsetWidth,left+dx))+"px";bubble.style.top=Math.max(0,Math.min(window.innerHeight-bubble.offsetHeight,top+dy))+"px";bubble.style.right="auto";bubble.style.bottom="auto";}});
    bubble.addEventListener("pointerup",()=>{dragging=false;if(!moved)restoreCountdown();});
    bubble.addEventListener("pointercancel",()=>{dragging=false;});
    $("minimizeCountdownBtn").addEventListener("click",minimizeCountdown);
  }
  function updateCountdowns(){
    const now=new Date(),todayKey=fmtDate(now),nowMs=now.getTime(),dock=$("countdownDock"),list=$("countdownItems"),bubble=$("countdownBubble");
    const running=[],currentKeys=new Set();
    for(const e of occurrenceEvents(todayKey)){
      if(!e.countdownEnabled||!e.time||!e.endTime||e.done)continue;
      const start=parseDate(e.longTask?e.date:todayKey),end=parseDate(e.longTask?(e.endDate||e.date):todayKey),sp=e.time.split(":").map(Number),ep=e.endTime.split(":").map(Number);
      start.setHours(sp[0],sp[1],0,0);end.setHours(ep[0],ep[1],0,0);
      if(nowMs>=start.getTime()&&nowMs<end.getTime()){running.push({event:e,endMs:end.getTime()});currentKeys.add(e.id+"@"+todayKey);}
    }
    for(const key of state.countdownActive){
      if(currentKeys.has(key))continue;
      const baseEvent=state.events.find(item=>key.startsWith(item.id+"@"));const day=key.slice(baseEvent?.id.length+1);const e=baseEvent?{...baseEvent,...(baseEvent.overrides&&baseEvent.overrides[day]||{})}:null;
      if(!e||e.done||!e.endTime||!e.time||day!==todayKey)continue;
      const end=parseDate(e.longTask?(e.endDate||day):day),parts=e.endTime.split(":").map(Number);end.setHours(parts[0],parts[1],0,0);
      if(nowMs>=end.getTime())toast("限时任务时间已结束："+e.title);
    }
    list.innerHTML="";
    running.forEach(({event,endMs})=>{
      const item=document.createElement("div");item.className="countdown-item";
      const title=document.createElement("strong");title.className="countdown-title";title.textContent=event.title;
      const times=document.createElement("div");times.className="countdown-meta";times.textContent=(event.longTask?event.date+" "+event.time+" – "+(event.endDate||event.date)+" "+event.endTime:event.time+" – "+event.endTime)+(event.location?" · "+event.location:"");
      const seconds=Math.max(0,Math.ceil((endMs-nowMs)/1000)),remain=document.createElement("div");remain.className="countdown-clock";
      remain.textContent=String(Math.floor(seconds/3600)).padStart(2,"0")+":"+String(Math.floor((seconds%3600)/60)).padStart(2,"0")+":"+String(seconds%60).padStart(2,"0");
      const actions=document.createElement("div");actions.className="countdown-item-actions";
      const done=document.createElement("button");done.type="button";done.className="countdown-complete-btn";done.textContent="确认完成";done.addEventListener("click",()=>completeCountdown(event.id));
      const minimize=document.createElement("button");minimize.type="button";minimize.textContent="暂时关闭倒计时";minimize.addEventListener("click",minimizeCountdown);
      actions.append(done,minimize);item.append(title,times,remain,actions);list.append(item);
    });
    const hasRunning=running.length>0;
    dock.hidden=!hasRunning||state.countdownMinimized;bubble.hidden=!hasRunning||!state.countdownMinimized;
    $("countdownBubbleCount").textContent=String(running.length);
    state.countdownActive=currentKeys;updateSpecialSummaryLive();
  }

  function formatSummaryDuration(ms){
    let total=Math.max(0,Math.floor(ms/1000));
    const days=Math.floor(total/86400);total%=86400;
    const hours=Math.floor(total/3600);total%=3600;
    const minutes=Math.floor(total/60),seconds=total%60;
    const clock=String(hours).padStart(2,"0")+":"+String(minutes).padStart(2,"0")+":"+String(seconds).padStart(2,"0");
    return days?days+"天 "+clock:clock;
  }
  function localDateTime(key,time){
    const d=parseDate(key);
    if(!time){d.setHours(0,0,0,0);return d;}
    const parts=time.split(":").map(Number);
    d.setHours(parts[0]||0,parts[1]||0,0,0);return d;
  }
  function getSummaryStatus(event,key,now){
    const todayKey=fmtDate(now),nowMs=now.getTime();
    if(event.done)return {code:"complete",label:"已完成",detail:"已确认完成"};
    if(event.longTask){
      const start=localDateTime(event.date,event.time),end=localDateTime(event.endDate||event.date,event.endTime||event.time);
      if(nowMs<start.getTime())return {code:"upcoming",label:"",detail:"尚未开始"};
      if(nowMs<end.getTime())return {code:"ongoing",label:"进行中",targetMs:end.getTime(),detail:"距离结束还有 "+formatSummaryDuration(end.getTime()-nowMs)};
      return {code:"missed",label:"已错过",detail:"已超过结束时间，尚未确认完成"};
    }
    if(!event.time){
      if(key<todayKey)return {code:"missed",label:"已错过",detail:"日期已过，尚未确认完成"};
      if(key>todayKey)return {code:"upcoming",label:"",detail:"尚未开始"};
      return {code:"upcoming",label:"",detail:"未设置开始时间"};
    }
    const start=localDateTime(key,event.time),startMs=start.getTime();
    if(nowMs<startMs)return {code:"upcoming",label:"",targetMs:startMs,detail:"尚未开始"};
    if(event.endTime){
      const end=localDateTime(key,event.endTime),endMs=end.getTime();
      if(nowMs<endMs)return {code:"ongoing",label:"进行中",targetMs:endMs,detail:"距离结束还有 "+formatSummaryDuration(endMs-nowMs)};
      return {code:"missed",label:"已错过",detail:"已超过结束时间，尚未确认完成"};
    }
    return {code:"missed",label:"已错过",detail:"已超过开始时间，尚未确认完成"};
  }
  function summaryOccurrenceDate(event,todayKey){
    if((event.repeat||"none")==="none")return event.date;
    if(todayKey>=event.date&&occurs(event,todayKey))return todayKey;
    const base=event.date>todayKey?event.date:todayKey;
    const d=parseDate(base);
    for(let n=0;n<=370;n++){
      const candidate=new Date(d);candidate.setDate(d.getDate()+n);
      const key=fmtDate(candidate);
      if(key>=event.date&&occurs(event,key))return key;
    }
    return event.date;
  }
  function staticSummaryDetail(info,event){
    if(info.code==="upcoming")return event.time?"开始时间："+event.time:"尚未设置开始时间";
    if(info.code==="ongoing")return event.endTime?"结束时间："+event.endTime:"正在进行中";
    return info.detail;
  }
  function buildSummaryRow(event,key,live){
    const info=getSummaryStatus(event,key,new Date());
    const row=document.createElement("article");row.className="summary-event-row status-"+info.code;
    row.dataset.eventId=event.id;row.dataset.occurrenceDate=key;row.dataset.live=live?"true":"false";
    const top=document.createElement("div");top.className="summary-event-top";
    const title=document.createElement("strong");title.className="summary-event-title";title.textContent=(event.specialReminder?"★ ":"")+event.title;
    if(event.specialReminder)title.classList.add("special-star-text");
    const status=document.createElement("span");status.className="summary-status status-badge-"+info.code;status.dataset.summaryStatus="";status.textContent=info.label;
    top.append(title,status);
    const meta=document.createElement("div");meta.className="summary-event-meta";meta.textContent=key+(event.time?" · "+event.time:" · 未设置开始时间")+(event.endTime?" – "+event.endTime:"")+(event.location?" · "+event.location:"");
    const detail=document.createElement("div");detail.className="summary-event-detail";detail.dataset.summaryDetail="";detail.dataset.targetMs=info.targetMs?String(info.targetMs):"";detail.textContent=live?info.detail:staticSummaryDetail(info,event);
    row.append(top,meta,detail);
    return row;
  }
  function updateSpecialSummaryLive(){
    const overlay=$("specialSummaryOverlay");
    if(overlay.hidden)return;
    const now=new Date();
    overlay.querySelectorAll(".summary-event-row[data-live='true']").forEach(row=>{
      const baseEvent=state.events.find(e=>e.id===row.dataset.eventId);if(!baseEvent)return;const event={...baseEvent,...(baseEvent.overrides&&baseEvent.overrides[row.dataset.occurrenceDate]||{})};
      const info=getSummaryStatus(event,row.dataset.occurrenceDate,now);
      const status=row.querySelector("[data-summary-status]"),detail=row.querySelector("[data-summaryDetail], [data-summary-detail]");
      status.className="summary-status status-badge-"+info.code;status.textContent=info.label;
      row.className="summary-event-row status-"+info.code;
      detail.dataset.targetMs=info.targetMs?String(info.targetMs):"";
      detail.textContent=info.detail;
    });
  }
  function renderSpecialSummary(){
    const list=$("specialSummaryList");list.innerHTML="";
    const now=new Date(),todayKey=fmtDate(now);
    const items=[];
    for(const event of state.events){
      if(event.done)continue;
      if((event.repeat||"none")==="none"){
        const key=event.date,override=event.overrides&&event.overrides[key];
        const isSpecial=override&&Object.prototype.hasOwnProperty.call(override,"specialReminder")?override.specialReminder:!!event.specialReminder;
        if(isSpecial)items.push({event:{...event,...(override||{})},key});
        continue;
      }
      const base=event.date>todayKey?event.date:todayKey,d=parseDate(base);
      for(let n=0;n<=370;n++){
        const candidate=new Date(d);candidate.setDate(d.getDate()+n);const key=fmtDate(candidate);
        if(!occurs(event,key))continue;
        const override=event.overrides&&event.overrides[key],isSpecial=override&&Object.prototype.hasOwnProperty.call(override,"specialReminder")?override.specialReminder:!!event.specialReminder;
        if(isSpecial){items.push({event:{...event,...(override||{})},key});break;}
      }
    }
    items.sort((a,b)=>a.key.localeCompare(b.key)||(a.event.time||"").localeCompare(b.event.time||""));
    if(!items.length){const empty=document.createElement("div");empty.className="summary-empty";empty.textContent="还没有设置特别提醒。可以在任一日程的编辑窗口中勾选“设为特别提醒”。";list.append(empty);return;}
    items.forEach(({event,key})=>list.append(buildSummaryRow(event,key,true)));
  }
  function renderTodaySummary(){
    const list=$("todaySummaryList");list.innerHTML="";
    const todayKey=fmtDate(new Date()),items=occurrenceEvents(todayKey);
    if(!items.length){const empty=document.createElement("div");empty.className="summary-empty";empty.textContent="今天还没有安排日程。";list.append(empty);return;}
    items.forEach(event=>list.append(buildSummaryRow(event,todayKey,false)));
  }
  function showNextStartupSummary(){
    if(state.startupSummaryActive||state.activeReminder||!$("reminderOverlay").hidden||!state.startupSummaryQueue.length)return;
    const kind=state.startupSummaryQueue.shift();
    state.startupSummaryActive=kind;
    if(kind==="special"){renderSpecialSummary();$("specialSummaryOverlay").hidden=false;}
    else {renderTodaySummary();$("todaySummaryOverlay").hidden=false;}
    document.body.classList.add("summary-open");
  }
  function closeStartupSummary(kind){
    const overlay=$(kind==="special"?"specialSummaryOverlay":"todaySummaryOverlay");
    overlay.hidden=true;document.body.classList.remove("summary-open");state.startupSummaryActive=null;
    showNextStartupSummary();
    if(!state.startupSummaryActive&&!state.startupSummaryQueue.length)showNextReminder();
  }
  $("closeSpecialSummaryBtn").addEventListener("click",()=>closeStartupSummary("special"));
  $("closeTodaySummaryBtn").addEventListener("click",()=>closeStartupSummary("today"));
  document.querySelectorAll("[data-close-startup-summary]").forEach(el=>el.addEventListener("click",()=>closeStartupSummary(el.dataset.closeStartupSummary)));
  ["special","today"].forEach(kind=>{
    const overlay=$(kind==="special"?"specialSummaryOverlay":"todaySummaryOverlay");
    overlay.addEventListener("click",ev=>{if(ev.target===overlay)closeStartupSummary(kind);});
  });
  function startStartupSummaries(){
    state.startupSummaryQueue=["special","today"];
    showNextStartupSummary();
  }
  $("notifyBtn").addEventListener("click",async()=>{if(!("Notification"in window)){ $("notifyStatus").textContent="此浏览器不支持系统通知";toast("当前浏览器不支持系统通知；页面内提醒仍可用。");return;}try{const p=await Notification.requestPermission();$("notifyStatus").textContent=p==="granted"?"系统通知已启用（网页需保持打开）":p==="denied"?"系统通知被拒绝，请在浏览器网站设置中允许":"尚未允许系统通知";if(p==="granted"){try{new Notification("NEXUS 提醒测试",{body:"系统通知已正常启用。请在日程中设置提前提醒。",tag:"nexus-notification-test"});toast("已发送测试通知；请检查系统通知区域。");}catch(_){toast("权限已开启，但系统通知发送失败；请检查设备通知设置。");}}else{toast(p==="denied"?"请在浏览器网站设置中允许通知。":"未获得通知权限");}}catch(_){toast("无法请求通知权限");}});
  const infoText='<h3>日程存在哪里？</h3><p>日程默认保存在此浏览器的本地存储中。网站代码是公开的，但本版本不会把日程上传到服务器，也没有账号跨设备同步。请勿在公用设备上输入敏感信息。</p><h3>如何保护和备份数据？</h3><ul><li>定期使用“导出备份”保存 JSON 文件，并妥善保管。</li><li>清除浏览器网站数据、使用无痕窗口或更换设备可能导致数据无法访问。</li><li>导入备份会替换当前日程，请先导出当前数据。</li><li>重复日程的编辑和删除会作用于整个系列；单次例外功能尚未实现。</li></ul><h3>提醒有什么限制？</h3><p>提醒依赖页面运行。关闭网页、浏览器休眠或设备关机时，不能保证准时通知；它不是可靠的后台推送或紧急通知服务。</p><h3>自然语言助手</h3><p>此版本仅对部分中文日期和时间表达生成草稿。请核对日期、时间、地点后再保存。它不会自动修改或删除现有日程，也不调用外部 AI 服务。</p><h3>关于版本</h3><p>这是早期版本。自然语言解析、重复日程单次例外、撤销持久化、完整自动化测试和更完善的无障碍体验会逐步完善。</p>';
  function showInfo(title,content){$("infoTitle").textContent=title;$("infoContent").innerHTML=content;$("infoDialog").showModal();}
  $("privacyBtn").addEventListener("click",()=>showInfo("隐私与使用说明",infoText));$("settingsBtn").addEventListener("click",()=>showInfo("设置与操作",'<h3>撤销上一步</h3><p>可使用键盘快捷键 Ctrl/⌘ + Z 撤销最近一次日程增删改或完成状态变更。撤销记录仅在当前页面会话中保留。</p>'+infoText));$("closeInfo").addEventListener("click",()=>$("infoDialog").close());$("okInfo").addEventListener("click",()=>$("infoDialog").close());
  document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&!$("eventDialog").open&&!$("infoDialog").open){e.preventDefault();undo();}});
  function parseTargetDate(raw) {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    let matched = false;
    if (/大后天/.test(raw)) { d.setDate(d.getDate()+3); matched=true; }
    else if (/后天/.test(raw)) { d.setDate(d.getDate()+2); matched=true; }
    else if (/明天|明日/.test(raw)) { d.setDate(d.getDate()+1); matched=true; }
    else if (/今天|今日/.test(raw)) matched=true;
    const full = raw.match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?/);
    const md = raw.match(/(\d{1,2})月(\d{1,2})(?:日|号)?/);
    if (full) { d.setFullYear(+full[1], +full[2]-1, +full[3]); matched=true; }
    else if (md) { d.setFullYear(now.getFullYear(), +md[1]-1, +md[2]); matched=true; }
    const wd = raw.match(/(下周|下星期|这周|本周|周|星期)([一二三四五六日天1-7])/);
    if (wd && !full && !md && !/今天|今日|明天|明日|后天|大后天/.test(raw)) {
      const map={一:1,二:2,三:3,四:4,五:5,六:6,日:0,天:0,"1":1,"2":2,"3":3,"4":4,"5":5,"6":6,"7":0};
      let delta=(map[wd[2]]-now.getDay()+7)%7;
      if (delta===0) delta=7;
      d.setDate(d.getDate()+delta); matched=true;
    }
    return {date:fmtDate(d),matched};
  }
  function parseTimeRange(input) {
    const source=String(input||"");
    const re=/(上午|早上|中午|下午|晚上|傍晚|晚)?\s*(\d{1,2})(?:(?:[:：](\d{1,2}))|(?:[点时](?:(\d{1,2})分?|半)?))?/g;
    const tokens=[]; let m;
    while((m=re.exec(source))!==null) {
      if(!m[1]&&!/[:：点时]/.test(m[0])) continue;
      const rawHour=Number(m[2]), minute=Number(m[3]||m[4]||(/半$/.test(m[0])?30:0));
      if(rawHour>23||minute>59) continue;
      let hour=rawHour, period=m[1]||(tokens.length?tokens[0].period:"");
      if(/下午|晚上|傍晚|晚/.test(period)&&hour<12)hour+=12;
      if(/上午|早上/.test(period)&&hour===12)hour=0;
      if(/中午/.test(period)&&hour<11)hour+=12;
      tokens.push({index:m.index,end:re.lastIndex,hour,minute,rawHour,period:m[1]||""});
    }
    if(!tokens.length)return {time:"",endTime:""};
    const format=t=>String(t.hour).padStart(2,"0")+":"+String(t.minute).padStart(2,"0");
    let endTime="";
    if(tokens.length>1) {
      const first=tokens[0], second=tokens[1];
      const between=source.slice(first.end,second.index);
      const after=source.slice(second.end);
      const isRange=/(到|至|[-—~～])/.test(between)||/(结束|截止|完毕)/.test(after)||/(结束时间|截止时间)/.test(between);
      if(isRange) {
        let endHour=second.hour;
        if(!second.period&&first.period) {
          if(/下午|晚上|傍晚/.test(first.period)&&second.rawHour<12)endHour=second.rawHour+12;
          else if(/上午|早上/.test(first.period)&&second.rawHour===12)endHour=0;
        }
        if(!second.period&&first.hour>=12&&second.rawHour<12&&endHour<=first.hour)endHour=second.rawHour+12;
        if(endHour<24&&(endHour*60+second.minute)>(first.hour*60+first.minute)) {
          endTime=String(endHour).padStart(2,"0")+":"+String(second.minute).padStart(2,"0");
        }
      }
    }
    return {time:format(tokens[0]),endTime};
  }
  function getTargetDateRange(raw){const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12),m=raw.match(/(下周|下星期|这周|本周)([一二三四五六日天1-7])?/);if(!m)return null;const monday=new Date(today);monday.setDate(today.getDate()-((today.getDay()+6)%7)+(/下周|下星期/.test(m[1])?7:0));if(m[2]){const map={一:0,二:1,三:2,四:3,五:4,六:5,日:6,天:6,"1":0,"2":1,"3":2,"4":3,"5":4,"6":5,"7":6};const d=new Date(monday);d.setDate(monday.getDate()+map[m[2]]);return {start:fmtDate(d),end:fmtDate(d),label:fmtDate(d)};}const end=new Date(monday);end.setDate(monday.getDate()+6);return {start:fmtDate(monday),end:fmtDate(end),label:fmtDate(monday)+" 至 "+fmtDate(end)};}
  function parseNatural(text) {
    const raw=text.trim(); if(!raw)return null;
    const editMarker=raw.match(/(?:设为特别提醒|设置为特别提醒|标记为特别提醒|加上特别提醒|修改为|修改成|修改到|调整为|调整成|调整到|更改为|更改成|更改到|设置为|设置成|设定为|设定成|改为|改成|改到|换成)/);
    const isEdit=/(修改|改成|改为|调整|更改|设置|设定|设为特别提醒|标星|特别提醒|把.+换成|把.+改到|把.+移到|把.+日期改)/.test(raw);
    const sourceText=isEdit&&editMarker?raw.slice(0,editMarker.index):raw;
    const range=isEdit?getTargetDateRange(sourceText):null; const target=range?{date:range.start,matched:true}:parseTargetDate(sourceText);
    const timeText=isEdit&&editMarker&&!/特别提醒/.test(editMarker[0])?raw.slice(editMarker.index+editMarker[0].length):raw;
    const timeParts=parseTimeRange(timeText);
    const time=timeParts.time, endTime=timeParts.endTime;
    const locMatch=raw.match(/(?:地点|位置)\s*(?:(?:设置|设定|改|调整|更改)\s*(?:为|成|到)|(?:是|为|在|设为|：|:))?\s*([^，,。；;]+)/) || raw.match(/在\s*([^，,。；;]+?)\s*(?=开|上|参加|进行|学习|吃饭|运动|健身|看医生|复诊|提前|$)/);
    let location=locMatch?locMatch[1].trim():"";
    if(location && /^(明天|今天|后天|大后天|下周|本周|这周|周[一二三四五六日天]|星期[一二三四五六日天]|上午|下午|晚上|早上|中午|傍晚)/.test(location)) location="";
    const rm=raw.match(/提前\s*(\d+)\s*分钟?提醒/);
    const deleteIntent=/(删除|删掉|取消|移除|不要了|不再安排|去掉)/.test(raw);
    const editIntent=/(修改|改成|改为|调整|更改|设置|设定|设为特别提醒|标星|特别提醒|把.+换成|把.+改到|把.+移到|把.+日期改)/.test(raw);
    const repeat=/每周|每个星期/.test(raw)?"weekly":/每天|每日/.test(raw)?"daily":/每个工作日|工作日/.test(raw)?"weekdays":"none";
    let title=raw
      .replace(/请帮我|请|帮我|从|安排一下|安排|新增|添加|创建|新建|删除|删掉|取消|移除|不要了|不再安排|去掉|修改|调整|更改|把|下周|下星期|这周|本周|今天|今日|明天|明日|后天|大后天|20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}日?|\d{1,2}月\d{1,2}日?|(?:周|星期)[一二三四五六日天]/g," ")
      .replace(/提前\s*\d+\s*分钟?提醒/g," ")
      .replace(/(上午|早上|中午|下午|晚上|傍晚)?\s*\d{1,2}(?:(?:[:：]\d{1,2})|(?:[点时](?:\d{1,2}分?|半)?))?/g," ")
      .replace(/(?:地点|位置)\s*(?:(?:设置|设定|改|调整|更改)\s*(?:为|成|到)|(?:是|为|在|设为|：|:))?\s*[^，,。；;]+/g," ").replace(/在\s*[^，,。；;]+?\s*(?=开|上|参加|进行|学习|吃饭|运动|健身|看医生|复诊|提前|$)/g," ").replace(/(?:从|到|至|开始|结束(?:时间)?|截止(?:时间)?)/g," ")
      .replace(/[，,。；;]/g," ").replace(/\s+/g," ").trim();
    title=title.replace(/^(的|一下|下|上|开|做|把|参加|进行)\s*/,"").replace(/(这个日程|这条日程|这个安排|的日程|的课)$/,"").trim();
    return {action:deleteIntent?"delete":editIntent?"edit":"create",title,date:target.date,dateRange:range||{start:target.date,end:target.date,label:target.date},time,endTime,reminder:rm?Math.min(1440,+rm[1]):0,location,specialReminder:/(特别提醒|重点提醒|星标|标星)/.test(raw)&&!/(取消|关闭|不要).{0,4}(特别提醒|重点提醒|星标)/.test(raw),repeat,countdownEnabled:!!endTime&&/(自动倒计时|开始时.{0,5}倒计时|开始自动倒计时|启动.{0,8}倒计时|开启.{0,8}倒计时|打开.{0,8}倒计时|启用.{0,8}倒计时|倒计时.{0,8}(开启|打开|启用|开始|启动))/.test(raw),raw};
  }
  function showDraft(html) { const area=$("draftArea"); area.hidden=false; area.innerHTML=html; }
  function safeDeleteOccurrence(eventId,key) {
    const e=state.events.find(x=>x.id===eventId); if(!e)return;
    const recurring=(e.repeat||"none")!=="none";
    const message=recurring
      ? "只删除 "+key+" 这一次的“"+e.title+"”，保留其他每周/重复安排吗？"
      : "确定删除“"+e.title+"”（"+key+"）吗？";
    if(!confirm(message))return;
    snapshot();
    if(recurring) {
      e.excludedDates=Array.isArray(e.excludedDates)?e.excludedDates:[];
      if(!e.excludedDates.includes(key))e.excludedDates.push(key);
    } else state.events=state.events.filter(x=>x.id!==eventId);
    save(); state.selected=key; const d=parseDate(key); state.cursor=new Date(d.getFullYear(),d.getMonth(),1); render();
    $("draftArea").hidden=true; $("draftArea").innerHTML="";
    toast(recurring?"已取消这一天的重复日程，其他日期保留":"日程已删除");
  }
  function renderSearchResults() {
    const input = $("eventSearch"), area = $("searchResults"), hint = $("searchHint");
    const query = input.value.trim().toLocaleLowerCase();
    area.innerHTML = "";
    if (!query) { area.hidden = true; hint.textContent = "输入关键词即可搜索全部日程；多个关键词可用空格分隔。"; return; }
    const terms = query.split(/\s+/).filter(Boolean);
    const results = state.events.filter(e => {
      const d = parseDate(e.date);
      const dateText = e.date + " " + d.getFullYear()+"年"+(d.getMonth()+1)+"月"+d.getDate()+"日";
      const haystack = [e.title,e.location,e.notes,e.date,dateText,e.time,e.repeat].join(" ").toLocaleLowerCase();
      return terms.every(term => haystack.includes(term));
    }).sort((a,b) => a.date.localeCompare(b.date) || (a.time||"99:99").localeCompare(b.time||"99:99"));
    area.hidden = false;
    hint.textContent = results.length ? "找到 "+results.length+" 条日程。点击任一结果可打开编辑窗口。" : "没有找到匹配的日程。试试标题、地点、备注或日期关键词。";
    if (!results.length) { area.innerHTML = '<div class="search-empty">没有找到匹配项，请检查关键词后重试。</div>'; return; }
    results.slice(0,50).forEach(e => {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "search-result";
      const main = document.createElement("span"); main.className = "search-result-main";
      const title = document.createElement("span"); title.className = "search-result-title"; title.textContent = (e.specialReminder?"★ ":"")+e.title;if(e.specialReminder)title.classList.add("special-star-text");
      const meta = document.createElement("span"); meta.className = "search-result-meta";
      meta.textContent = e.date + (e.time ? " · "+e.time+(e.endTime?" – "+e.endTime:" · 待办") : " · 未设时间") + (e.location ? " · "+e.location : "") + ((e.repeat||"none")!=="none" ? " · 重复日程" : "");
      main.append(title,meta);
      const arrow=document.createElement("span");arrow.className="search-result-arrow";arrow.textContent="›";arrow.setAttribute("aria-hidden","true");
      btn.append(main,arrow);
      btn.addEventListener("click",()=>{
        state.selected=e.date;
        const d=parseDate(e.date);state.cursor=new Date(d.getFullYear(),d.getMonth(),1);
        render();editEvent(e.id);
      });
      area.append(btn);
    });
    if(results.length>50){const more=document.createElement("div");more.className="search-empty";more.textContent="仅显示前 50 条，请增加关键词缩小范围。";area.append(more);}
  }
  $("eventSearch").addEventListener("input",renderSearchResults);
  $("clearSearchBtn").addEventListener("click",()=>{$("eventSearch").value="";renderSearchResults();$("eventSearch").focus();});


  function openTitleChoice(date,suggestedTitle,onChoose,longTask=false){
    const defaultDate=String(date||"");
    const render=(dateFilter,keyword)=>{
      const key=String(dateFilter||defaultDate);
      const normalized=String(keyword||"").trim().toLocaleLowerCase();
      const matches=state.events.filter(e=>(e.longTask?e.date<=key&&(e.endDate||e.date)>=key:occurs(e,key))).filter(e=>!normalized||e.title.toLocaleLowerCase().includes(normalized)).filter(e=>!longTask||e.longTask);
      const listHtml=matches.length?matches.map(e=>'<div class="draft-candidate"><p><strong>'+esc(e.title)+'</strong></p><p>'+esc(e.date)+(e.longTask?' 至 '+esc(e.endDate||e.date):'')+' · '+esc(e.time||"无指定时间")+(e.endTime?' – '+esc(e.endTime):'')+(e.longTask?' · 长期任务':'')+'</p><button type="button" class="secondary-btn" data-title-choice="'+esc(e.id)+'">选择并修改此项目</button></div>').join(""):'<p class="notice">这一天没有符合条件的项目。你仍可直接新建。</p>';
      showDraft('<h4>选择已有项目或新建</h4><p>选择已有项目会在原记录上修改你明确提出的内容，其他设置保持不变；只有点击保存后才会生效。</p><label class="field-label" for="sameDayTitleDate">指定日期</label><input id="sameDayTitleDate" type="date" value="'+esc(key)+'"><label class="field-label" for="sameDayTitleSearch">项目名称关键词搜索</label><div class="search-input-row"><input id="sameDayTitleSearch" type="search" value="'+esc(keyword||"")+'" placeholder="输入项目名称关键词"><button type="button" class="secondary-btn" id="sameDayTitleSearchBtn">搜索</button></div><div class="title-choice-list"><h5>'+esc(key)+' 的已有项目</h5>'+listHtml+'</div><div class="draft-buttons"><button type="button" class="primary-btn" id="createDistinctTitleBtn">新建'+(longTask?'长期任务':'日程')+'：'+esc(suggestedTitle||"请填写名称")+'</button></div>');
      $("sameDayTitleSearchBtn").addEventListener("click",()=>render($("sameDayTitleDate").value,$("sameDayTitleSearch").value));
      $("sameDayTitleSearch").addEventListener("keydown",ev=>{if(ev.key==="Enter"){ev.preventDefault();render($("sameDayTitleDate").value,$("sameDayTitleSearch").value);}});
      $("sameDayTitleDate").addEventListener("change",()=>render($("sameDayTitleDate").value,$("sameDayTitleSearch").value));
      $("draftArea").querySelectorAll("[data-title-choice]").forEach(btn=>btn.addEventListener("click",()=>{const event=state.events.find(e=>e.id===btn.dataset.titleChoice);if(event)onChoose({existingEvent:event,date:key});}));
      $("createDistinctTitleBtn").addEventListener("click",()=>onChoose({existingEvent:null,title:suggestedTitle||"",date:key}));
    };
    render(defaultDate,"");
  }

  function handleCountdownCommand(raw,longOnly=false){
    if(!/(开启|打开|启用|开始|启动|取消|关闭|停用|禁用|不要).{0,5}倒计时|倒计时.{0,5}(开启|打开|启用|开始|启动|取消|关闭|停用|禁用)/.test(raw))return false;
    const disable=/(取消|关闭|停用|禁用|不要).{0,5}倒计时|倒计时.{0,5}(取消|关闭|停用|禁用)/.test(raw);
    const enabled=!disable;
    const parsed=parseNatural(raw);
    const dateMatch=parseTargetDate(raw);
    const keyword=raw.replace(/请帮我|请|帮我|把|给|项目|日程|长期任务|开启|打开|启用|开始|启动|取消|关闭|停用|禁用|不要|自动|倒计时|并且|以及|的|一下|改为|设为/g," ").replace(/今天|今日|明天|明日|后天|大后天|下周|下星期|这周|本周|(?:周|星期)[一二三四五六日天1-7]/g," ").replace(/(上午|早上|中午|下午|晚上|傍晚)?\s*\d{1,2}(?:(?:[:：]\d{1,2})|(?:[点时](?:\d{1,2}分?|半)?))?/g," ").replace(/\s+/g," ").trim();
    const hasExplicitDate=/(今天|今日|明天|明日|后天|大后天|下周|下星期|这周|本周|(?:周|星期)[一二三四五六日天1-7]|20\\d{2}[年./-]\\d{1,2}[月./-]\\d{1,2}|\\d{1,2}月\\d{1,2}日?)/.test(raw);
    const date=hasExplicitDate&&dateMatch.matched?dateMatch.date:"";
    const initialDate=date||"";
    const renderCountdownCandidates=(dateFilter,titleFilter)=>{
      let candidates=state.events.filter(e=>(!longOnly||e.longTask)&&(!dateFilter||(e.longTask?e.date<=dateFilter&&(e.endDate||e.date)>=dateFilter:e.date===dateFilter)));
      if(titleFilter.trim())candidates=candidates.filter(e=>e.title.toLocaleLowerCase().includes(titleFilter.trim().toLocaleLowerCase()));
      showDraft('<h4>'+(enabled?'开启':'取消')+'倒计时</h4><p>请选择要'+(enabled?'开启':'取消')+'倒计时的事项；可以按日期和项目名称进一步搜索。选择后会打开编辑器，保存后才生效。</p><div class="draft-search-fields"><label class="field-label" for="countdownTargetDate">指定日期</label><input id="countdownTargetDate" type="date" value="'+esc(dateFilter)+'"><label class="field-label" for="countdownTargetTitle">项目名称搜索</label><div class="search-input-row"><input id="countdownTargetTitle" type="search" value="'+esc(titleFilter)+'" placeholder="输入项目名称关键词"><button type="button" class="secondary-btn" id="searchCountdownTarget">搜索</button></div></div>'+(candidates.length?candidates.map(e=>'<div class="draft-candidate"><p><strong>'+esc(e.title)+'</strong></p><p>'+esc(e.date)+(e.longTask?' 至 '+esc(e.endDate||e.date):'')+' · '+esc(e.time||'无开始时间')+(e.endTime?' – '+esc(e.endTime):'')+' · '+(e.countdownEnabled?'当前已开启':'当前未开启')+'</p><button type="button" class="secondary-btn" data-countdown-id="'+esc(e.id)+'">选择并'+(enabled?'开启':'取消')+'</button></div>').join(''):'<p class="notice">没有找到符合条件的事项。可以更换日期或缩短项目名称关键词。</p>'));
      $("searchCountdownTarget").addEventListener("click",()=>renderCountdownCandidates($("countdownTargetDate").value,$("countdownTargetTitle").value));
      $("countdownTargetTitle").addEventListener("keydown",ev=>{if(ev.key==="Enter"){ev.preventDefault();renderCountdownCandidates($("countdownTargetDate").value,$("countdownTargetTitle").value);}});
      $("countdownTargetDate").addEventListener("change",()=>renderCountdownCandidates($("countdownTargetDate").value,$("countdownTargetTitle").value));
      $("draftArea").querySelectorAll("[data-countdown-id]").forEach(btn=>btn.addEventListener("click",()=>{
        const e=state.events.find(x=>x.id===btn.dataset.countdownId);if(!e)return;
        openEditor(e,!!e.longTask);$("eventCountdownEnabled").checked=enabled;syncCountdownOption();
        toast("已设置倒计时选项；请保存后生效");
      }));
    };
    renderCountdownCandidates(initialDate,keyword);
    return true;
  }

  $("parseLongTaskBtn").addEventListener("click",()=>{
    const raw=$("longTaskText").value.trim();
    if(!raw){toast("请描述长期任务的开始和结束日期");return;}
    if(handleCountdownCommand(raw,true))return;
    const boundary=raw.match(/(?:到|至|结束于|截止于|结束时间为|截止时间为)\s*(.+)$/);
    if(!boundary){showDraft('<h4>还需要明确结束时间</h4><p>请使用“从今天早上9点开始……到明天下午5点结束”的表达。</p>');return;}
    const startText=raw.slice(0,boundary.index);
    const endText=boundary[1];
    const startParsed=parseTargetDate(startText);
    const endParsed=parseTargetDate(endText);
    const normalizeChineseHour=s=>s.replace(/(上午|早上|中午|下午|晚上|傍晚)?\s*([一二三四五六七八九十两]{1,3})(点|时)/g,(all,period,num,unit)=>{
      const nums={一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10,十一:11,十二:12};
      const n=nums[num]; return n?((period||"") + n + unit):all;
    });
    const startTime=parseTimeRange(normalizeChineseHour(startText)).time;
    const endTime=parseTimeRange(normalizeChineseHour(endText)).time;
    const cleanTaskTitle = value => String(value||"")
      .replace(/(?:20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}日?|\d{1,2}月\d{1,2}日?|大后天|后天|明天|明日|今天|今日|下周|下星期|这周|本周|周[一二三四五六日天]|星期[一二三四五六日天])/g," ")
      .replace(/(?:上午|早上|中午|下午|晚上|傍晚)?\s*[0-9一二三四五六七八九十两]{1,3}(?:[:：][0-9]{1,2}|点(?:半|[0-9]{1,2}分?)?|时(?:半|[0-9]{1,2}分?)?)/g," ")
      .replace(/^(?:从|把|请帮我|请|帮我|给我|将|给)\s*/,"")
      .replace(/(?:的)?(?:时间|日期|开始时间|结束时间)?\s*(?:改为|改成|改到|调整为|调整成|调整到|更改为|更改成|更改到|修改为|修改成|修改到|设为|设置为|设置成|设定为|设定成)?/g," ")
      .replace(/\b(?:到|至|完成|做完|结束|截止|开始|开始做|去完成|要完成)\b/g," ")
      .replace(/[，,。；;：:]/g," ").replace(/\s+/g," ").trim();
    let title=cleanTaskTitle(raw);
    if(!title||/^(?:时间|日期|任务|长期任务)$/.test(title))title=cleanTaskTitle(endText);
    if(!title)title="长期任务";
    if(!startParsed.matched||!endParsed.matched||!startTime||!endTime){
      showDraft('<h4>还需要明确开始和结束日期/时间</h4><p>例如：“从今天早上9点到明天下午5点完成博约杯备考”。支持“下午五点”这样的中文数字时间。</p>');
      return;
    }
    if(endParsed.date<startParsed.date||(endParsed.date===startParsed.date&&endTime<=startTime)){
      showDraft('<h4>日期或时间顺序需要确认</h4><p>结束时间必须晚于开始时间，请修改描述后重新生成草稿。</p>');return;
    }
    if(!title)title="长期任务";
    const parsed=parseNatural(raw);
    const reminder=parsed?parsed.reminder:0;
    const countdownEnabled=/(自动倒计时|开始时.{0,5}倒计时|开始自动倒计时|启动.{0,8}倒计时|开启.{0,8}倒计时|打开.{0,8}倒计时|启用.{0,8}倒计时|倒计时.{0,8}(开启|打开|启用|开始|启动))/.test(raw);
    openTitleChoice(startParsed.date,title,choice=>{
      const existing=choice.existingEvent;
      if(existing){
        openEditor(existing,true);
        $("eventDate").value=startParsed.date;$("eventEndDate").value=endParsed.date;
        $("eventTime").value=startTime;$("eventEnd").value=endTime;
        $("eventCountdownEnabled").checked=countdownEnabled||!!existing.countdownEnabled;syncCountdownOption();
        $("eventReminder").value=String(reminder||existing.reminder||0);
      }else{
        const finalTitle=String(choice.title||title||"长期任务").trim();
        openEditor({id:"",title:finalTitle,date:startParsed.date,endDate:endParsed.date,longTask:true,time:startTime,endTime,reminder,countdownEnabled},true);
        $("eventTitle").value=finalTitle;$("eventDate").value=startParsed.date;$("eventEndDate").value=endParsed.date;
        $("eventTime").value=startTime;$("eventEnd").value=endTime;
        $("eventCountdownEnabled").checked=countdownEnabled;syncCountdownOption();
        $("eventReminder").value=String(reminder);$("eventRepeat").value="none";
      }
    },true);
  });
  $("parseBtn").addEventListener("click",()=>{
    const raw=$("quickText").value,parsed=parseNatural(raw);
    if(!raw.trim()){toast("先写下你想安排的事情");return;}
    if(handleCountdownCommand(raw,false))return;
    if(!parsed){toast("先写下你想安排的事情");return;}
    if(parsed.action==="delete") {
      const candidates=occurrenceEvents(parsed.date).filter(e=>{
        const needle=parsed.title.replace(/\s+/g,"").toLowerCase();
        const title=e.title.replace(/\s+/g,"").toLowerCase();
        return needle.length>=1 && (title.includes(needle)||needle.includes(title)||needle.split("").filter(ch=>title.includes(ch)).length>=Math.min(2,needle.length));
      });
      if(!candidates.length) {
        showDraft('<h4>未找到可删除的日程</h4><p>目标日期：'+esc(parsed.date)+'</p><p>系统没有找到明确匹配的日程，因此没有删除任何内容，也不会把这句话保存成待办。</p><p>请补充原日程的名称，例如“删除下周一的英语课”。</p>');
        return;
      }
      showDraft('<h4>确认要删除哪一项</h4><p>目标日期：'+esc(parsed.date)+'。请核对匹配结果；系统不会自动删除。</p>'+candidates.map(e=>'<div class="draft-candidate"><p><strong>'+esc(e.title)+'</strong></p><p>'+esc(e.time||"无指定时间")+' · '+esc(e.repeat!=="none"?repeatLabel(e.repeat):"单次日程")+(e.location?" · "+esc(e.location):"")+'</p><button type="button" class="secondary-btn" data-delete-id="'+esc(e.id)+'" data-delete-date="'+esc(parsed.date)+'">删除这一次</button></div>').join(""));
      $("draftArea").querySelectorAll("[data-delete-id]").forEach(btn=>btn.addEventListener("click",()=>safeDeleteOccurrence(btn.dataset.deleteId,btn.dataset.deleteDate)));
      return;
    }
    if(parsed.action==="edit") {
      const compact = value => String(value || "").toLocaleLowerCase().replace(/[\s的这条个]/g, "");
      const editMarker = raw.match(/(?:设为特别提醒|设置为特别提醒|标记为特别提醒|加上特别提醒|修改为|修改成|修改到|调整为|调整成|调整到|更改为|更改成|更改到|设置为|设置成|设定为|设定成|改为|改成|改到|换成)/);
      const destinationText = editMarker ? raw.slice(editMarker.index + editMarker[0].length) : "";
      const destinationParsed = destinationText ? parseTargetDate(destinationText) : null;
      let destinationDate = destinationParsed && destinationParsed.matched ? destinationParsed.date : "";
      const destinationMatch = destinationText.match(/(?:改到|移到|调整到|更改到|日期改为|日期改成)?\s*(下周|下星期|这周|本周|周|星期)([一二三四五六日天1-7])/);
      if (!destinationDate && destinationMatch) {
        const now = new Date(), map = {一:1,二:2,三:3,四:4,五:5,六:6,日:0,天:0,"1":1,"2":2,"3":3,"4":4,"5":5,"6":6,"7":0};
        const offset = map[destinationMatch[2]]===0 ? 6 : map[destinationMatch[2]]-1;
        let monday;
        if (/下周|下星期/.test(destinationMatch[1])) monday = new Date(now.getFullYear(),now.getMonth(),now.getDate()-((now.getDay()+6)%7)+7,12);
        else if (/这周|本周/.test(destinationMatch[1])) monday = new Date(now.getFullYear(),now.getMonth(),now.getDate()-((now.getDay()+6)%7),12);
        else {
          const d = new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);
          const delta = (map[destinationMatch[2]]-now.getDay()+7)%7 || 7;
          d.setDate(d.getDate()+delta); destinationDate=fmtDate(d);
        }
        if (monday) { monday.setDate(monday.getDate()+offset); destinationDate=fmtDate(monday); }
      }
      const locationChange = raw.match(/(?:地点|位置)\s*(?:设置\s*(?:为|成|到)|设定\s*(?:为|成|到)|改\s*(?:为|成|到)|调整\s*(?:为|成|到)|更改\s*(?:为|成|到)|改为|改成|调整为|更改为|设为|为|是)\s*([^，,。；;]+)/);
      const renameMatch = raw.match(/(?:改名为|名称改为|标题改为)([^，,。；;]+)/);
      const sourcePrefix = editMarker ? raw.slice(0,editMarker.index) : raw;
      const targetKeyword = sourcePrefix
        .replace(/请帮我|请|帮我|将|把|安排一下|安排|修改|调整|更改|设置|设定/g," ")
        .replace(/大后天|后天|明天|明日|今天|今日|(?:下周|下星期|这周|本周)[一二三四五六日天1-7]?|(?:周|星期)[一二三四五六日天1-7]|20\\d{2}[年./-]\\d{1,2}[月./-]\\d{1,2}日?|\\d{1,2}月\\d{1,2}日?/g," ")
        .replace(/(上午|早上|中午|下午|晚上|傍晚)?\s*\d{1,2}(?:(?:[:：]\d{1,2})|(?:[点时](?:\d{1,2}分?|半)?))?/g," ")
        .replace(/提前\s*\d+\s*分钟?提醒/g," ")
        .replace(/(?:时间|日期|地点|位置|标题|名称|提醒|特别提醒|重点提醒|星标|标星|设为)$/g,"")
        .replace(/[的这条个：:，,。；;\s]/g,"").trim();
      const searchRange=parsed.dateRange||{start:parsed.date,end:parsed.date,label:parsed.date};const candidateDates=[];for(let d=parseDate(searchRange.start),end=parseDate(searchRange.end);d<=end;d.setDate(d.getDate()+1))candidateDates.push(fmtDate(d));const eventCandidates=[...new Map(candidateDates.flatMap(key=>occurrenceEvents(key).map(e=>[e.seriesId+"@"+key,e]))).values()];
      const findMatches = keyword => {
        const terms = String(keyword||"").toLocaleLowerCase().split(/\s+/).map(term=>term.replace(/[的这条个，,。；;、]/g,"")).filter(Boolean);
        if(!terms.length)return [];
        return eventCandidates.filter(e=>{
          const title=compact(e.title);
          return terms.every(term=>title.includes(term));
        });
      };
      const applyEdit = (eventId,occurrenceDate,mode) => {
        const e=state.events.find(x=>x.id===eventId);if(!e)return;
        state.occurrenceEditContext={occurrenceDate,mode,matchingIds:mode==="series"?state.events.filter(x=>compact(x.title)===compact(e.title)).map(x=>x.id):[]};
        openEditor(mode==="single"?{...e,...(e.overrides&&e.overrides[occurrenceDate]||{}),date:occurrenceDate}:e);
        if(!$("eventDialog").open)return;
        if(parsed.time)$("eventTime").value=parsed.time;
        if(parsed.endTime){$("eventEnd").value=parsed.endTime;syncCountdownOption();}if(parsed.countdownEnabled&&parsed.endTime){$("eventCountdownEnabled").checked=true;}
        if(destinationDate)$("eventDate").value=destinationDate;
        if(locationChange)$("eventLocation").value=locationChange[1].trim().replace(/^(为|成|到)\s*/,"");
        if(renameMatch)$("eventTitle").value=renameMatch[1].trim();
        if(parsed.specialReminder)$("eventSpecialReminder").checked=true;
        toast(mode==="single"?"已打开单日程编辑；只影响选中的这一天":"已打开系列编辑；保存后会统一修改整个重复系列");
      };
      const openNewDraft = keyword => {
        const draftTitle=(keyword||targetKeyword||parsed.title||"").trim()||"新待办（请填写标题）";
        const draftDate=destinationDate||parsed.date;
        openEditor({...parsed,id:"",title:draftTitle,date:draftDate});
        $("eventId").value="";$("eventTitle").value=draftTitle;$("eventDate").value=draftDate;
        $("eventTime").value=parsed.time||"";$("eventEnd").value=parsed.endTime||"";
        $("eventCountdownEnabled").checked=!!parsed.countdownEnabled;syncCountdownOption();
        $("eventReminder").value=String(parsed.reminder);$("eventLocation").value=parsed.location;$("eventRepeat").value=parsed.repeat;$("eventSpecialReminder").checked=!!parsed.specialReminder;
        toast("已打开新待办草稿；请核对标题和日期后再保存");
      };
      const renderEditSearch = keyword => {
        const candidates=findMatches(keyword);
        const resultsHtml=candidates.length
          ? candidates.map(e=>{const sameNameCount=state.events.filter(x=>compact(x.title)===compact(e.title)).length;return '<div class="draft-candidate"><p><strong>'+esc(e.title)+'</strong></p><p>'+esc(e.occurrenceDate||e.date)+' · '+esc(e.time||"无指定时间")+(e.endTime?" – "+esc(e.endTime):"")+' · '+esc(e.repeat!=="none"?"重复系列":"单次日程")+(e.location?" · "+esc(e.location):"")+'</p><button type="button" class="secondary-btn" data-edit-id="'+esc(e.id)+'" data-edit-date="'+esc(e.occurrenceDate||e.date)+'" data-edit-mode="single">单日程修改</button>'+(e.repeat!=="none"||sameNameCount>1?'<button type="button" class="secondary-btn" data-edit-id="'+esc(e.id)+'" data-edit-date="'+esc(e.occurrenceDate||e.date)+'" data-edit-mode="series">统一修改所有同名日程</button>':"")+'</div>';}).join("")
          : '<p class="notice">在 '+esc(searchRange.label||parsed.date)+' 没有找到标题包含“'+esc(keyword||"（空关键词）")+'”的日程。你可以换个更短的关键词，或选择把这句话作为新待办草稿。</p>';
        showDraft('<h4>按日期范围和标题关键词查找</h4><p>查找范围：'+esc(searchRange.label||parsed.date)+'。标题支持部分匹配，例如“英语”可以匹配更长的课程名称。</p><label class="field-label" for="editKeywordInput">项目标题关键词</label><div class="search-input-row"><input id="editKeywordInput" type="search" value="'+esc(keyword)+'" placeholder="输入项目标题中的几个字"><button type="button" class="secondary-btn" id="searchEditKeywordBtn">搜索</button></div>'+resultsHtml+'<div class="draft-buttons"><button type="button" class="secondary-btn" id="createNewFromEditBtn">新建日程（不使用已有项目）</button></div>');
        $("searchEditKeywordBtn").addEventListener("click",()=>renderEditSearch($("editKeywordInput").value.trim()));
        $("editKeywordInput").addEventListener("keydown",ev=>{if(ev.key==="Enter"){ev.preventDefault();renderEditSearch($("editKeywordInput").value.trim());}});
        $("draftArea").querySelectorAll("[data-edit-id]").forEach(btn=>btn.addEventListener("click",()=>applyEdit(btn.dataset.editId,btn.dataset.editDate,btn.dataset.editMode||"single")));
        const createButton=$("createNewFromEditBtn");if(createButton)createButton.addEventListener("click",()=>openNewDraft($("editKeywordInput").value.trim()));
      };
      renderEditSearch(targetKeyword);
      return;
    }
    openTitleChoice(parsed.date,parsed.title,choice=>{
      const existing=choice.existingEvent;
      if(existing){
        openEditor(existing,!!existing.longTask);
        if(parsed.time)$("eventTime").value=parsed.time;
        if(parsed.endTime)$("eventEnd").value=parsed.endTime;
        if(parsed.location)$("eventLocation").value=parsed.location;
        if(parsed.countdownEnabled)$("eventCountdownEnabled").checked=true;
        syncCountdownOption();
      }else{
        const finalTitle=String(choice.title||parsed.title||"").trim()||"新日程";
        openEditor({...parsed,id:"",title:finalTitle,date:choice.date||parsed.date});
        $("eventId").value="";$("eventTitle").value=finalTitle;$("eventDate").value=choice.date||parsed.date;$("eventTime").value=parsed.time;$("eventEnd").value=parsed.endTime||"";$("eventCountdownEnabled").checked=!!parsed.countdownEnabled;syncCountdownOption();$("eventReminder").value=String(parsed.reminder);$("eventLocation").value=parsed.location;$("eventRepeat").value=parsed.repeat;$("eventSpecialReminder").checked=!!parsed.specialReminder;
      }
    });
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
  try{const savedFocus=JSON.parse(localStorage.getItem(FOCUS_SESSION_KEY)||"null");if(savedFocus&&typeof savedFocus.id==="string"&&typeof savedFocus.title==="string"&&Number(savedFocus.durationMs)>0){const priorElapsed=Math.max(0,Number(savedFocus.elapsedMs)||0),runningElapsed=savedFocus.startedAt?Math.max(0,Date.now()-Number(savedFocus.startedAt)):0;focusSession={...savedFocus,startedAt:0,elapsedMs:priorElapsed+runningElapsed};}}catch(e){}
  try{const savedMode=localStorage.getItem(INTERFACE_MODE_KEY);if(savedMode==="classic"||savedMode==="study")interfaceMode=savedMode;}catch(e){}
  applyInterfaceMode(interfaceMode,false);
  load();setupCountdownBubbleDrag();render();checkReminders();updateCountdowns();setTimeout(startStartupSummaries,250);setInterval(checkReminders,5000);setInterval(updateCountdowns,1000);window.addEventListener("focus",()=>{checkReminders();updateCountdowns();});window.addEventListener("pageshow",()=>{checkReminders();updateCountdowns();});document.addEventListener("visibilitychange",()=>{if(!document.hidden){checkReminders();updateCountdowns();}});
})();