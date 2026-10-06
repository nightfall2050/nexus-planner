(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "nexus-planner-v1";
  function fmtDate(d) { return [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-"); }
  const state = { events: [], selected: dateKey(new Date()), cursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1), view: "month", undo: null, reminderSeen: new Set(), toastTimer: null };
  function dateKey(d){return fmtDate(d);}
  function parseDate(s){const [y,m,d]=String(s).split("-").map(Number);return new Date(y,m-1,d,12);}
  function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function load(){try{const raw=localStorage.getItem(STORAGE_KEY);if(raw){const data=JSON.parse(raw);if(data&&Array.isArray(data.events))state.events=data.events.filter(validEvent);}}catch(e){console.warn("Could not read local planner data",e);toast("本地数据无法读取；请勿清除浏览器数据。");}}
  function validEvent(e){return e&&typeof e.id==="string"&&typeof e.title==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(e.date)&&["none","daily","weekly","weekdays","monthly"].includes(e.repeat||"none");}
  function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({version:1,events:state.events}));}catch(e){toast("保存失败：浏览器存储空间可能不足。");throw e;}}
  function snapshot(){state.undo=JSON.stringify(state.events);}
  function undo(){if(!state.undo){toast("暂无可撤销的操作");return;}const now=JSON.stringify(state.events);state.events=JSON.parse(state.undo);state.undo=now;save();render();toast("已撤销上一步；再次点击可恢复。");}
  function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>el.classList.remove("show"),3000);}
  function id(){return "evt-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);}
  function occurs(e,key){if(key<e.date)return false;if(Array.isArray(e.excludedDates)&&e.excludedDates.includes(key))return false;const d=parseDate(key),start=parseDate(e.date);switch(e.repeat||"none"){case"none":return key===e.date;case"daily":return true;case"weekly":return d.getDay()===start.getDay();case"weekdays":return d.getDay()!==0&&d.getDay()!==6;case"monthly":return d.getDate()===start.getDate();default:return key===e.date;}}
  function occurrenceEvents(key){return state.events.filter(e=>occurs(e,key)).map(e=>({...e,occurrenceDate:key,seriesId:e.id})).sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99"));}
  function monthEvents(y,m){const first=new Date(y,m,1),last=new Date(y,m+1,0),out=[];for(let d=1;d<=last.getDate();d++){const key=fmtDate(new Date(y,m,d));const ev=occurrenceEvents(key);out.push({key,day:d,ev,outside:false});}return {first,last,days:out};}
  function render(){renderCalendar();renderDay();renderProgress();checkReminders();}
  function renderCalendar(){const y=state.cursor.getFullYear(),m=state.cursor.getMonth();$("periodTitle").textContent=state.view==="day"?state.selected:state.cursor.toLocaleDateString("zh-CN",{year:"numeric",month:"long"});$("calendarHeading").textContent=state.view==="day"?"单日安排":"日历概览";$("calendarGrid").classList.toggle("day-view",state.view==="day");document.querySelectorAll(".view-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===state.view));const grid=$("calendarGrid");grid.innerHTML="";if(state.view==="day"){const selected=parseDate(state.selected);const start=new Date(selected);start.setDate(selected.getDate()-selected.getDay());for(let i=0;i<7;i++){const d=new Date(start);d.setDate(start.getDate()+i);grid.append(makeDayCell(fmtDate(d),d.getDate(),d.getMonth()!==selected.getMonth()));}return;}const first=new Date(y,m,1),offset=first.getDay(),days=new Date(y,m+1,0).getDate(),prevDays=new Date(y,m,0).getDate();for(let i=0;i<42;i++){let d,key,outside=false;if(i<offset){d=prevDays-offset+i+1;key=fmtDate(new Date(y,m-1,d));outside=true;}else if(i>=offset+days){d=i-offset-days+1;key=fmtDate(new Date(y,m+1,d));outside=true;}else{d=i-offset+1;key=fmtDate(new Date(y,m,d));}grid.append(makeDayCell(key,d,outside));}}
  function makeDayCell(key,day,outside){const btn=document.createElement("button");btn.type="button";btn.className="calendar-day"+(outside?" outside":"")+(key===state.selected?" selected":"")+(key===dateKey(new Date())?" today":"");btn.setAttribute("aria-label",key+" 日程");const number=document.createElement("span");number.className="day-number";number.textContent=day;btn.append(number);const evs=occurrenceEvents(key);if(evs.length){const wrap=document.createElement("span");wrap.className="day-events";evs.slice(0,2).forEach(e=>{const chip=document.createElement("span");chip.className="event-chip"+(e.done?" done":(!e.time?" todo":""));chip.textContent=(e.time?e.time+" ":"")+e.title;wrap.append(chip);});btn.append(wrap);if(evs.length>2){const more=document.createElement("span");more.className="more-chip";more.textContent="+"+(evs.length-2)+" 项";btn.append(more);}}btn.addEventListener("click",()=>{state.selected=key;state.cursor=new Date(parseDate(key).getFullYear(),parseDate(key).getMonth(),1);render();});return btn;}
  function renderDay(){const d=parseDate(state.selected),evs=occurrenceEvents(state.selected);$("selectedHeading").textContent=d.toLocaleDateString("zh-CN",{month:"long",day:"numeric",weekday:"long"});$("selectedBadge").textContent=state.selected.slice(5);const list=$("eventList");list.innerHTML="";if(!evs.length){list.innerHTML='<div class="empty-state"><div class="empty-icon">⌁</div>这一天还没有安排。<br>给自己留一点可能性。</div>';return;}evs.forEach(e=>{const card=document.createElement("article");card.className="event-card"+(e.done?" done":"")+(e.time?"":" todo");const time=e.time?(e.endTime?e.time+" – "+e.endTime:e.time):(e.repeat!=="none"?"重复日程":"待办事项");card.innerHTML='<span class="event-stripe"></span><div class="event-main"><div class="event-time">'+esc(time)+(e.repeat!=="none"?' · '+repeatLabel(e.repeat):"")+'</div><div class="event-title">'+esc(e.title)+'</div>'+(e.location?'<div class="event-meta">⌖ '+esc(e.location)+'</div>':"")+(e.notes?'<div class="event-meta">'+esc(e.notes)+'</div>':"")+'</div><div class="event-actions"><button class="check-btn '+(e.done?"checked":"")+'" title="'+(e.done?"标记未完成":"标记完成")+'" aria-label="'+(e.done?"标记未完成":"标记完成")+'">'+(e.done?"✓":"○")+'</button><button class="mini-btn" title="编辑" aria-label="编辑">✎</button><button class="mini-btn" title="删除" aria-label="删除">×</button></div>';const buttons=card.querySelectorAll("button");buttons[0].addEventListener("click",()=>toggleDone(e.seriesId,e.occurrenceDate));buttons[1].addEventListener("click",()=>editEvent(e.seriesId));buttons[2].addEventListener("click",()=>deleteEvent(e.seriesId));list.append(card);});}
  function repeatLabel(r){return ({daily:"每天重复",weekly:"每周重复",weekdays:"工作日重复",monthly:"每月重复"})[r]||"";}
  function renderProgress(){const evs=occurrenceEvents(state.selected),done=evs.filter(e=>e.done).length,total=evs.length,pct=total?Math.round(done/total*100):0;$("progressCount").textContent=done+" / "+total;$("progressPercent").textContent=pct+"%";$("progressBar").style.width=pct+"%";}
  function toggleDone(eventId,key){snapshot();const e=state.events.find(x=>x.id===eventId);if(!e)return;e.done=!e.done;save();render();toast(e.done?"已标记完成":"已恢复为未完成");}
  function openEditor(e){$("eventForm").reset();$("eventId").value=e?.id||"";$("dialogTitle").textContent=e?"编辑日程":"新建日程";$("eventTitle").value=e?.title||"";$("eventDate").value=e?.date||state.selected;$("eventTime").value=e?.time||"";$("eventEnd").value=e?.endTime||"";$("eventReminder").value=String(e?.reminder||0);$("eventLocation").value=e?.location||"";$("eventNotes").value=e?.notes||"";$("eventRepeat").value=e?.repeat||"none";$("eventDialog").showModal();setTimeout(()=>$("eventTitle").focus(),30);}
  function editEvent(eventId){const e=state.events.find(x=>x.id===eventId);if(!e)return;if(e.repeat!=="none"&&!confirm("这是重复日程。此版本编辑会修改整个重复系列（包括未来日期），而不是只修改当天。继续吗？"))return;openEditor(e);}
  function deleteEvent(eventId){const e=state.events.find(x=>x.id===eventId);if(!e)return;const message=e.repeat!=="none"?"这会删除整个重复系列，而不是只删除当天。建议先导出备份。确定删除？":"确定删除“"+e.title+"”？";if(!confirm(message))return;snapshot();state.events=state.events.filter(x=>x.id!==eventId);save();render();toast("日程已删除。可用撤销恢复。");}
  $("eventForm").addEventListener("submit",ev=>{ev.preventDefault();const title=$("eventTitle").value.trim(),date=$("eventDate").value,time=$("eventTime").value,endTime=$("eventEnd").value,reminder=Number($("eventReminder").value);if(!title||!date){toast("请填写事项名称和日期");return;}if(time&&endTime&&endTime<time){toast("结束时间不能早于开始时间");return;}const oldId=$("eventId").value;const item={id:oldId||id(),title,date,time,endTime,reminder,location:$("eventLocation").value.trim(),notes:$("eventNotes").value.trim(),repeat:$("eventRepeat").value,done:oldId?(state.events.find(e=>e.id===oldId)?.done||false):false};snapshot();if(oldId)state.events=state.events.map(e=>e.id===oldId?item:e);else state.events.push(item);save();state.selected=date;const parsed=parseDate(date);state.cursor=new Date(parsed.getFullYear(),parsed.getMonth(),1);$("eventDialog").close();render();toast(oldId?"日程已更新":"日程已保存到当前浏览器");});
  $("addBtn").addEventListener("click",()=>openEditor());$("addForDayBtn").addEventListener("click",()=>openEditor());$("closeDialog").addEventListener("click",()=>$("eventDialog").close());$("cancelDialog").addEventListener("click",()=>$("eventDialog").close());
  $("prevBtn").addEventListener("click",()=>{if(state.view==="day"){const d=parseDate(state.selected);d.setDate(d.getDate()-1);state.selected=fmtDate(d);state.cursor=new Date(d.getFullYear(),d.getMonth(),1);}else state.cursor=new Date(state.cursor.getFullYear(),state.cursor.getMonth()-1,1);render();});
  $("nextBtn").addEventListener("click",()=>{if(state.view==="day"){const d=parseDate(state.selected);d.setDate(d.getDate()+1);state.selected=fmtDate(d);state.cursor=new Date(d.getFullYear(),d.getMonth(),1);}else state.cursor=new Date(state.cursor.getFullYear(),state.cursor.getMonth()+1,1);render();});
  $("todayBtn").addEventListener("click",()=>{state.selected=dateKey(new Date());state.cursor=new Date(new Date().getFullYear(),new Date().getMonth(),1);render();});document.querySelectorAll(".view-btn").forEach(b=>b.addEventListener("click",()=>{state.view=b.dataset.view;renderCalendar();}));
  $("exportBtn").addEventListener("click",()=>{const blob=new Blob([JSON.stringify({app:"NEXUS Planner",version:1,exportedAt:new Date().toISOString(),events:state.events},null,2)],{type:"application/json"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="nexus-planner-backup-"+dateKey(new Date())+".json";a.click();URL.revokeObjectURL(url);toast("备份文件已生成");});
  $("importBtn").addEventListener("click",()=>$("importFile").click());$("importFile").addEventListener("change",async ev=>{const file=ev.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text()),events=Array.isArray(data)?data:data.events;if(!Array.isArray(events)||!events.every(validEvent))throw new Error("invalid");if(!confirm("将导入 "+events.length+" 条日程。选择“确定”会用备份内容替换当前全部日程；建议先导出现有备份。继续？"))return;snapshot();state.events=events;save();render();toast("备份导入完成");}catch(e){toast("文件格式不正确，未更改当前日程。");}finally{ev.target.value="";}});
  function checkReminders(){const now=new Date();for(const e of state.events){if(!e.reminder||!e.time||e.done)continue;const start=parseDate(e.date);const [h,m]=e.time.split(":").map(Number);start.setHours(h,m,0,0);const when=start.getTime()-e.reminder*60000,delta=now.getTime()-when;if(delta>=0&&delta<60000&&!state.reminderSeen.has(e.id+e.date)){state.reminderSeen.add(e.id+e.date);const msg=(e.time||"")+(e.location?" · "+e.location:"")+" · "+e.title;toast("日程提醒："+msg);if("Notification"in window&&Notification.permission==="granted"){try{new Notification("NEXUS 日程提醒",{body:msg,tag:e.id+e.date});}catch(_){}}}}}
  $("notifyBtn").addEventListener("click",async()=>{if(!("Notification"in window)){toast("当前浏览器不支持系统通知；页面内提醒仍可用。");return;}try{const p=await Notification.requestPermission();$("notifyStatus").textContent=p==="granted"?"已允许系统通知（页面需保持打开）":p==="denied"?"系统通知被浏览器拒绝":"页面打开时检查提醒";toast(p==="granted"?"系统通知已启用":"未获得通知权限");}catch(_){toast("无法请求通知权限");}});
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
    const md = raw.match(/(\d{1,2})月(\d{1,2})日?/);
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
  function parseNatural(text) {
    const raw=text.trim(); if(!raw)return null;
    const target=parseTargetDate(raw);
    const tm=raw.match(/(上午|早上|中午|下午|晚上|傍晚)?\s*(\d{1,2})(?:[:：点时](\d{1,2})分?)?/);
    let time="";
    if(tm) {
      let hour=+tm[2], minute=+(tm[3]||0);
      if(/下午|晚上|傍晚/.test(tm[1]||"")&&hour<12)hour+=12;
      if(/中午/.test(tm[1]||"")&&hour<11)hour+=12;
      if(hour<24&&minute<60&&(/点|时|:|：/.test(tm[0])||tm[1]))time=String(hour).padStart(2,"0")+":"+String(minute).padStart(2,"0");
    }
    const locMatch=raw.match(/(?:地点|位置)\s*(?:是|为|：|:)?\s*([^，,。；;]+)/) || raw.match(/在\s*([^，,。；;]+?)\s*(?=开|上|参加|进行|学习|吃饭|运动|健身|看医生|复诊|提前|$)/);
    let location=locMatch?locMatch[1].trim():"";
    if(location && /^(明天|今天|后天|大后天|下周|本周|这周|周[一二三四五六日天]|星期[一二三四五六日天]|上午|下午|晚上|早上|中午|傍晚)/.test(location)) location="";
    const rm=raw.match(/提前\s*(\d+)\s*分钟?提醒/);
    const deleteIntent=/(删除|删掉|取消|移除|不要了|不再安排|去掉)/.test(raw);
    const editIntent=/(修改|改成|改为|调整|更改|设置|设定|把.+换成|把.+改到|把.+移到|把.+日期改)/.test(raw);
    const repeat=/每周|每个星期/.test(raw)?"weekly":/每天|每日/.test(raw)?"daily":/每个工作日|工作日/.test(raw)?"weekdays":"none";
    let title=raw
      .replace(/请帮我|请|帮我|安排一下|安排|新增|添加|创建|新建|删除|删掉|取消|移除|不要了|不再安排|去掉|修改|调整|更改|把|下周|下星期|这周|本周|今天|今日|明天|明日|后天|大后天|20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}日?|\d{1,2}月\d{1,2}日?|(?:周|星期)[一二三四五六日天]/g," ")
      .replace(/(上午|早上|中午|下午|晚上|傍晚)?\s*\d{1,2}(?:[:：点时]\d{1,2}分?)?/g," ")
      .replace(/提前\s*\d+\s*分钟?提醒/g," ")
      .replace(/(?:地点|位置)\s*(?:是|为|：|:)?\s*[^，,。；;]+/g," ").replace(/在\s*[^，,。；;]+?\s*(?=开|上|参加|进行|学习|吃饭|运动|健身|看医生|复诊|提前|$)/g," ")
      .replace(/[，,。；;]/g," ").replace(/\s+/g," ").trim();
    title=title.replace(/^(的|一下|下|上|把)\s*/,"").replace(/(这个日程|这条日程|这个安排|的日程|的课)$/,"").trim();
    return {action:deleteIntent?"delete":editIntent?"edit":"create",title,date:target.date,time,reminder:rm?Math.min(1440,+rm[1]):0,location,repeat,raw};
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
    const terms = query.split(/\\s+/).filter(Boolean);
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
      const title = document.createElement("span"); title.className = "search-result-title"; title.textContent = e.title;
      const meta = document.createElement("span"); meta.className = "search-result-meta";
      meta.textContent = e.date + (e.time ? " · "+e.time : " · 未设时间") + (e.location ? " · "+e.location : "") + ((e.repeat||"none")!=="none" ? " · 重复日程" : "");
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
  $("parseBtn").addEventListener("click",()=>{
    const raw=$("quickText").value,parsed=parseNatural(raw);
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
      const compact = value => String(value || "").replace(/[\s的这条个]/g, "").toLowerCase();
      const rawCompact = compact(raw);
      const destinationMatch = raw.match(/(?:改到|移到|调整到|更改到|日期改为|日期改成)\s*(下周|下星期|这周|本周|周|星期)([一二三四五六日天1-7])/);
      let destinationDate = "";
      if (destinationMatch) {
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
      let candidates = occurrenceEvents(parsed.date).filter(e => rawCompact.includes(compact(e.title)));
      if (!candidates.length && destinationDate && /(?:明天|明日|今天|今日|后天|大后天)/.test(raw) && /把/.test(raw)) candidates = occurrenceEvents(parsed.date);
      if (!candidates.length) {
        showDraft('<h4>未找到明确匹配的日程</h4><p>原日程日期：'+esc(parsed.date)+'</p><p>请在指令中写出已有日程名称，例如“把项目会地点设置为食堂”。没有任何内容被修改，也不会新建待办。</p>');
        return;
      }
      showDraft('<h4>请选择要修改的日程</h4><p>原日程日期：'+esc(parsed.date)+'。选择后会打开编辑窗口，核对并保存才会生效。重复日程会修改整个系列。</p>'+candidates.map(e=>'<div class="draft-candidate"><p><strong>'+esc(e.title)+'</strong></p><p>'+esc(e.time||"无指定时间")+' · '+esc(e.repeat!=="none"?"重复系列":"单次日程")+(e.location?" · "+esc(e.location):"")+'</p><button type="button" class="secondary-btn" data-edit-id="'+esc(e.id)+'">选择并修改</button></div>').join(""));
      $("draftArea").querySelectorAll("[data-edit-id]").forEach(btn=>btn.addEventListener("click",()=>{
        const e=state.events.find(x=>x.id===btn.dataset.editId); if(!e)return;
        editEvent(e.id);
        if(!$("eventDialog").open)return;
        if(parsed.time)$("eventTime").value=parsed.time;
        if(locationChange)$("eventLocation").value=locationChange[1].trim().replace(/^(为|成|到)\s*/,"");
        if(destinationDate)$("eventDate").value=destinationDate;
        if(renameMatch)$("eventTitle").value=renameMatch[1].trim();
        toast("已填入修改建议；请检查日期、地点等内容后点击“保存日程”");
      }));
      return;
    }
    showDraft('<h4>待确认草稿</h4><p><strong>事项：</strong>'+esc(parsed.title||"请补充事项名称")+'</p><p><strong>日期：</strong>'+esc(parsed.date)+'</p><p><strong>时间：</strong>'+esc(parsed.time||"未识别，请保存前填写")+'</p><p><strong>地点：</strong>'+esc(parsed.location||"未指定")+'</p><p><strong>重复：</strong>'+esc(repeatLabel(parsed.repeat)||"不重复")+'</p><p><strong>提醒：</strong>'+esc(parsed.reminder?parsed.reminder+" 分钟前":"关闭")+'</p><p class="notice">请检查标题、日期、时间、地点与重复规则后再保存。</p><div class="draft-buttons"><button class="secondary-btn" id="discardDraft">放弃</button><button class="primary-btn" id="useDraft">检查并编辑</button></div>');
    $("discardDraft").addEventListener("click",()=>{$("draftArea").hidden=true;$("draftArea").innerHTML="";});
    $("useDraft").addEventListener("click",()=>{openEditor({...parsed,id:""});$("eventId").value="";$("eventTitle").value=parsed.title;$("eventDate").value=parsed.date;$("eventTime").value=parsed.time;$("eventReminder").value=String(parsed.reminder);$("eventLocation").value=parsed.location;$("eventRepeat").value=parsed.repeat;});
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
  load();render();setInterval(checkReminders,15000);
})();