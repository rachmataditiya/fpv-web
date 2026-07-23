/* TW Streamer — RC-controller (gamepad) module: pairing, per-pad hardware stick calibration,
 * axis/button mapping with learn mode, response curves (deadzone/expo/rate), and the control
 * loop that flies the gimbal tilt through the TW.gimbal arbiter (ANGLE mode via rate
 * integration — see gimbal.js for the hardware facts).
 *
 * Extracted from the old index.html inline IIFE — the localStorage schema
 * (`tw_gamepad_profiles`, keyed by gamepad.id) is UNCHANGED, so existing calibrations and
 * mappings carry over. The legacy `duml` key inside stored profiles is kept for round-trip but
 * the DUML-addressing card was removed from the UI (dead: the loop always streams angle mode).
 */
  // ---- EXPERIMENTAL gimbal control via a game controller (Gamepad API) — simulator-style config ----
  // Detect + pick a pad, calibrate axes/buttons, map stick axes → gimbal tilt/pan/roll and buttons →
  // actions (arm, recenter, presets, record, OSD-menu, sensitivity). Per-pad profiles persist in
  // localStorage keyed by gamepad.id. Gimbal/actions stream over the existing /ws/telemetry socket; the
  // bridge only acts on them when GIMBAL_CONTROL=1, so this is inert on a normal viewer.
  (function(){
    const LS='tw_gamepad_profiles';
    const AXES=[['tilt','Tilt (pitch)'],['pan','Pan (yaw)'],['roll','Roll']];
    const BTNS=[['arm','Arm / disarm'],['recenter','Recenter'],['preset_level','Preset: level (0°)'],
      ['preset_nadir','Preset: nadir (−90°)'],['record','Record start/stop'],['menu_up','Menu up'],
      ['menu_down','Menu down'],['menu_select','Menu select'],['menu_back','Menu back'],
      ['sens_up','Sensitivity +'],['sens_down','Sensitivity −']];
    const AXDEF={tilt:{axis:3,invert:true,deadzone:0.10,expo:0.3,mode:'rate',rate:80,min:-90,max:25},
                 pan:{axis:2,invert:false,deadzone:0.10,expo:0.3,mode:'rate',rate:120,min:-160,max:160},
                 roll:{axis:null,invert:false,deadzone:0.10,expo:0.3,mode:'rate',rate:60,min:-45,max:45}};
    const BTDEF={arm:0,recenter:1,preset_level:null,preset_nadir:null,record:null,menu_up:12,menu_down:13,
                 menu_select:9,menu_back:8,sens_up:5,sens_down:4};
    const clone=o=>JSON.parse(JSON.stringify(o));
    function loadAll(){ try{ return JSON.parse(localStorage.getItem(LS))||{}; }catch(_){ return {}; } }
    function saveAll(m){ try{ localStorage.setItem(LS,JSON.stringify(m)); }catch(_){ } }
    function profFor(id){ const m=loadAll(); if(!m[id]){ m[id]={enabled:true,axes:clone(AXDEF),buttons:clone(BTDEF),
      sens:1,axcal:{},duml:{cmd:0x14,recv:4,ridx:0,flags:0x07}}; saveAll(m); }
      // migrate: ensure every axis/button key exists
      for(const[k]of AXES) m[id].axes[k]=Object.assign(clone(AXDEF[k]),m[id].axes[k]||{});
      for(const[k]of BTNS) if(!(k in m[id].buttons)) m[id].buttons[k]=BTDEF[k]??null;
      if(m[id].sens==null)m[id].sens=1; if(!m[id].axcal)m[id].axcal={}; if(!m[id].duml)m[id].duml={cmd:0x14,recv:4,ridx:0,flags:0x07};
      return m[id]; }
    function put(id,p){ const m=loadAll(); m[id]=p; saveAll(m); }

    // ---------- WebHID source (DJI FPV RC / "DJI Virtual Joystick", VID 0x2CA3) ----------
    // The DJI RC enumerates as a VENDOR-defined HID device (usage page 0xFF00), so the browser
    // Gamepad API never sees it (that only exposes Generic-Desktop joysticks). WebHID can open it
    // and read the raw input report. Report layout captured on a DJI FPV RC 3 (2026-07-22) and
    // cross-checked against the community DJI-RC reverse-engineering (5 analog axes X/Y/Z/Rx/Ry
    // incl. the gimbal wheel, all ±660, 16-bit little-endian two's-complement): report id 0,
    // 13 bytes = 3-byte header/buttons + FIVE signed-16 axes at bytes 3..12. We normalize to
    // −1..1 (÷660) and present a synthetic gamepad `{id, axes:[5], buttons:[]}` — the WHOLE
    // existing pipeline (calibration wizard, mapping, curves, arbiter) then works unchanged. Which
    // physical control is which axis index is resolved by the user via learn-mode + the wizard, so
    // a firmware/mode variant that reorders axes still calibrates fine. Buttons aren't decoded (few
    // in this mode), so arming uses the on-screen "Arm (hold)" button.
    // DJI FPV Remote Controller 3 HID report (VID 0x2CA3 PID 0x1021) — authoritative layout from
    // the v3rm0n/dji-fpv3 DriverKit descriptor, matched to our on-device capture (2026-07-22):
    //   bytes 0-2  : 24 buttons, 1 bit each
    //   bytes 3-4  : right stick L/R = roll   (axis 0)
    //   bytes 5-6  : right stick U/D = pitch  (axis 1)
    //   bytes 7-8  : left  stick U/D = throttle (axis 2)
    //   bytes 9-10 : left  stick L/R = yaw    (axis 3)
    //   bytes 11-12: dial / gimbal wheel      (axis 4)  — int16 LE, all axes logical range ±660.
    const HID_VID=0x2ca3, HID_FULL=660;
    // The vertical sticks report up=POSITIVE, opposite the gamepad up=negative convention the
    // crosshair boxes + downstream assume, so negate axis 1 (pitch) + axis 2 (throttle).
    const HID_SIGN=[1,-1,-1,1,1];
    const hid={dev:null,id:null,axes:[0,0,0,0,0],btns:new Array(24).fill(false)};
    function hidAxes(b){ const s16=(lo,hi)=>{ const v=b[lo]|(b[hi]<<8); return v>=32768?v-65536:v; };
      return [s16(3,4),s16(5,6),s16(7,8),s16(9,10),s16(11,12)]
        .map((v,i)=>Math.max(-1,Math.min(1,HID_SIGN[i]*v/HID_FULL))); }
    // 24 buttons = bits of bytes 0,1,2 (this RC only populates byte 0; the rest are future-proof).
    // No masking — one bit rests high (a latched switch position); learn-mode edge-detects so that
    // an already-high button is never mislatched.
    function hidBtns(b){ const out=[]; for(let byte=0;byte<3;byte++) for(let i=0;i<8;i++) out.push(!!((b[byte]>>i)&1)); return out; }
    function hidPad(){ return hid.dev?{id:hid.id,axes:hid.axes,buttons:hid.btns.map(p=>({pressed:p})),_hid:true}:null; }
    async function hidAttach(d){ try{ if(!d.opened) await d.open(); }catch(_){ return; }
      hid.dev=d; hid.id='DJI RC (USB · '+(d.productName||'HID')+')';
      d.oninputreport=e=>{ try{ const b=new Uint8Array(e.data.buffer); hid.axes=hidAxes(b); hid.btns=hidBtns(b); }catch(_){} };
      curId=hid.id;
      const fresh=!loadAll()[curId];
      prof=profFor(curId);
      if(fresh){ // sensible DJI defaults (RC axis order roll,pitch,thr,yaw,wheel): tilt=right-stick
        // vertical (pitch, axis 1), pan=yaw (axis 3). Overridable via learn/select + calibration.
        prof.axes.tilt.axis=1; prof.axes.tilt.invert=false;
        prof.axes.pan.axis=3; put(curId,prof); }
      if(open) renderModal(); }
    async function hidConnect(){ if(!('hid' in navigator)) return;
      try{ const [d]=await navigator.hid.requestDevice({filters:[{vendorId:HID_VID}]}); if(d) await hidAttach(d); }catch(_){ } }
    async function hidReconnect(){ if(!('hid' in navigator)) return;
      try{ const ds=await navigator.hid.getDevices(); const d=ds.find(x=>x.vendorId===HID_VID); if(d) await hidAttach(d); }catch(_){ } }
    if('hid' in navigator){ hidReconnect();
      navigator.hid.addEventListener('connect',e=>{ if(!hid.dev&&e.device.vendorId===HID_VID) hidAttach(e.device); });
      navigator.hid.addEventListener('disconnect',e=>{ if(hid.dev===e.device){ hid.dev=null; armed=false; if(open) renderModal(); } }); }

    let curId=null, prof=null, armed=false, pitch=0,yaw=0,roll=0, last=0;
    const prevB={}; let learn=null, calWiz=null;
    // Per-controller HARDWARE calibration, keyed by AXIS INDEX (like a sim: calibrate the stick once,
    // then map functions to axes). norm() rescales a raw axis to [-1,1] using its captured lo/hi/center.
    function axcalFor(i){ return (prof&&prof.axcal&&prof.axcal[i])||{lo:-1,hi:1,center:0}; }
    function norm(raw,i){ const c=axcalFor(i); const r=raw-c.center;
      const span=r>=0?(c.hi-c.center||1):(c.center-c.lo||1); return Math.max(-1,Math.min(1,r/Math.abs(span))); }
    const dz=(v,d)=> Math.abs(v)<d?0:(v-Math.sign(v)*d)/(1-d);
    const expo=(v,e)=> (1-e)*v + e*v*v*v;
    const clampR=(v,a,b)=>Math.max(a,Math.min(b,v));
    function activeGp(){ const gs=navigator.getGamepads?navigator.getGamepads():[];
      // A connected WebHID RC takes priority when it's the selected device (or nothing else matches).
      if(curId){ if(hid.dev&&curId===hid.id) return hidPad(); for(const g of gs) if(g&&g.id===curId) return g; }
      if(hid.dev) return hidPad();
      for(const g of gs) if(g) return g; return null; }

    // ---------- UI: injected styles + modal ----------
    const st=document.createElement('style'); st.textContent=`
      #gpchip{position:fixed;left:12px;bottom:12px;z-index:50;font:600 11px system-ui;cursor:pointer;
        padding:7px 11px;border-radius:8px;background:#141a24;color:#8b95a7;border:1px solid var(--line2);display:none}
      #gpchip:hover{border-color:var(--purple)}
      #gpback{position:fixed;inset:0;z-index:60;background:rgba(3,5,10,.6);backdrop-filter:blur(3px);display:none}
      /* full-page, compact, two-column — no vertical scroll on a normal screen */
      #gpmodal{position:fixed;inset:2.5vh 2.5vw;z-index:61;background:var(--panel);border:1px solid var(--line2);
        border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.6);padding:0;display:none;flex-direction:column;overflow:hidden}
      #gpmodal h3{margin:0;font:800 14px system-ui;white-space:nowrap}
      #gpmodal .sub{color:var(--mut);font-size:12px}
      /* header bar: title + device + connect + arm + export/import/reset + close */
      #gpmodal .gphd{display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}
      #gpmodal .gphd .sp{flex:1}
      #gpmodal .gpbody{flex:1;overflow:auto;padding:14px 16px;min-height:0}
      #gpmodal .gpcols{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
      @media(max-width:860px){ #gpmodal .gpcols{grid-template-columns:1fr} }
      #gpmodal .card{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:11px 13px;margin:0 0 12px}
      #gpmodal .card:last-child{margin-bottom:0}
      #gpmodal .card h4{margin:0 0 8px;font:700 11px system-ui;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
      #gpmodal .btngrid{display:grid;grid-template-columns:1fr 1fr;gap:5px 14px}
      #gpmodal .btngrid .row{margin:0}
      #gpmodal .btngrid .nm{min-width:0;flex:1}
      #gpmodal select,#gpmodal input[type=number]{background:#0c1017;color:var(--fg);border:1px solid var(--line2);
        border-radius:7px;padding:6px 8px;font:600 12px var(--mono)}
      #gpmodal .row{display:flex;align-items:center;gap:9px;margin:6px 0;flex-wrap:wrap}
      #gpmodal .row .nm{min-width:120px;font-size:12px}
      #gpmodal .gbtn{background:#161c28;color:var(--fg);border:1px solid var(--line2);border-radius:7px;
        padding:5px 10px;font:600 11px system-ui;cursor:pointer}
      #gpmodal .gbtn:hover{border-color:var(--purple)} #gpmodal .gbtn.on{background:var(--purple);border-color:var(--purple);color:#fff}
      #gpmodal .bar{height:8px;border-radius:4px;background:#0c1017;position:relative;flex:1;min-width:80px;overflow:hidden}
      #gpmodal .bar i{position:absolute;top:0;bottom:0;left:50%;width:2px;background:var(--purple)}
      #gpmodal .dot{width:13px;height:13px;border-radius:50%;background:#1c2130;border:1px solid var(--line2)}
      #gpmodal .dot.on{background:var(--green);border-color:var(--green)}
      #gpmodal label.f{display:flex;justify-content:space-between;font-size:11px;color:var(--mut);margin:5px 0 1px}
      #gpmodal input[type=range]{width:100%;accent-color:var(--purple);margin:0}
      #gpmodal .axcfg{margin-top:6px;padding-top:6px;border-top:1px solid var(--line)}
      #gpmodal .arow{margin:4px 0}
      #gpmodal .axdet{margin:0 0 8px;border-bottom:1px solid var(--line);padding-bottom:8px}
      #gpmodal .axdet>summary{cursor:pointer;font:600 10px system-ui;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);list-style:none;padding:2px 0}
      #gpmodal .axdet>summary::-webkit-details-marker{display:none}
      #gpmodal .axdet>summary::before{content:'▸ '}#gpmodal .axdet[open]>summary::before{content:'▾ '}
      #gpmodal .close{position:absolute;top:12px;right:14px;cursor:pointer;color:var(--mut);font-size:20px;line-height:1}
      #gpmodal .mono{font:600 12px var(--mono)}
      #gpmodal .x{cursor:pointer;color:var(--mut);font-weight:700;padding:0 4px} #gpmodal .x:hover{color:var(--warn)}
      #gpmodal .arow{display:flex;align-items:center;gap:8px;margin:5px 0} #gpmodal .arow .abar{flex:1;min-width:70px}
      .stickwrap{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
      .stickbox{position:relative;width:150px;height:150px;background:#0a0e15;border:1px solid var(--line2);border-radius:10px;overflow:hidden}
      .stickbox .lbl{position:absolute;top:5px;left:0;right:0;text-align:center;font:700 9px system-ui;letter-spacing:.14em;color:var(--mut);text-transform:uppercase}
      .stickbox .gx,.stickbox .gy{position:absolute;background:var(--line2)} .stickbox .gx{left:0;right:0;top:50%;height:1px} .stickbox .gy{top:0;bottom:0;left:50%;width:1px}
      .stickbox .cross{position:absolute;width:16px;height:16px;margin:-8px 0 0 -8px;border:2px solid var(--green);border-radius:50%;box-shadow:0 0 8px var(--green);transition:none}
      .stickbox .ext{position:absolute;border:1px dashed var(--purple);background:rgba(77,184,255,.08);pointer-events:none;display:none}
      #gpcalwiz{position:fixed;z-index:70;top:50%;left:50%;transform:translate(-50%,-50%);width:min(560px,94vw);
        background:var(--panel);border:1px solid var(--line2);border-radius:14px;padding:20px 22px;display:none;box-shadow:0 24px 90px rgba(0,0,0,.7);text-align:center}
      #gpcalwiz h3{margin:0 0 4px;font:800 16px system-ui} #gpcalwiz .step{color:var(--amber);font-size:13px;margin-bottom:16px;min-height:34px}
      #gpcalwiz .stickbox{width:200px;height:200px} #gpcalwiz .ext{display:block}
      #gpcalwiz .gbtn{background:#161c28;color:var(--fg);border:1px solid var(--line2);border-radius:8px;padding:8px 16px;font:700 12px system-ui;cursor:pointer;margin:14px 4px 0}
      #gpcalwiz .gbtn.primary{background:var(--purple);border-color:var(--purple);color:#fff}
      #gplearn{position:fixed;z-index:71;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--panel);border:1px solid var(--purple);
        border-radius:12px;padding:22px 30px;display:none;box-shadow:0 20px 70px rgba(0,0,0,.7);text-align:center;font:700 15px system-ui}
      #gplearn small{display:block;margin-top:6px;font:600 12px system-ui;color:var(--mut)}
      #gpmodal .curve{display:block;width:100%;height:40px;margin-top:4px;background:#0a0e15;
        border:1px solid var(--line);border-radius:8px}
      #gpmodal .row{margin:5px 0}`;
    document.head.appendChild(st);

    const chip=document.createElement('div'); chip.id='gpchip'; document.body.appendChild(chip);
    const back=document.createElement('div'); back.id='gpback'; document.body.appendChild(back);
    const modal=document.createElement('div'); modal.id='gpmodal'; document.body.appendChild(modal);
    const wiz=document.createElement('div'); wiz.id='gpcalwiz'; document.body.appendChild(wiz);
    const learnEl=document.createElement('div'); learnEl.id='gplearn'; document.body.appendChild(learnEl);
    chip.onclick=openModal; back.onclick=closeModal;
    addEventListener('keydown',e=>{ if(e.key==='Escape'){ if(calWiz) stopCalib(); else if(learn){ learn=null; learnEl.style.display='none'; renderModal(); } else closeModal(); } });
    let open=false;
    function openModal(){ open=true; back.style.display='block'; modal.style.display='flex'; renderModal(); }
    function closeModal(){ open=false; back.style.display=modal.style.display='none'; learn=null; learnEl.style.display='none'; }
    // build the two live stick crosshair boxes (Mode-2 layout: L=axes 0/1, R=axes 2/3)
    // The two crosshair boxes' axis assignment. Standard gamepads are Mode-2 (L=ax0/1, R=ax2/3).
    // The DJI FPV RC's HID report uses a DIFFERENT order (X,Y,Z,Rx,Ry = roll,pitch,throttle,yaw,
    // wheel → right=ax0/1, LEFT=ax3(H,yaw)/ax2(V,throttle)) — confirmed on-device 2026-07-22. Using
    // the Mode-2 layout for it swaps the sticks (throttle showed up as right-stick roll). `_hid`
    // marks our WebHID DJI pad; a real DJI RC variant that reorders axes still calibrates fine
    // (the boxes are only a visual aid — mapping is by learn/axis-select).
    function stickLayout(gp){ return (gp&&gp._hid)
      ? {L:[3,2], R:[0,1], lL:'Left · yaw/thr', lR:'Right · roll/pitch'}
      : {L:[0,1], R:[2,3], lL:'Left · ax0/1', lR:'Right · ax2/3'}; }
    function stickBoxes(big){ return `<div class="stickwrap">
      <div class="stickbox"${big?' id="wbL"':' id="sbL"'}><span class="lbl" id="${big?'wblL':'sblL'}">Left</span><span class="gx"></span><span class="gy"></span><div class="ext"></div><i class="cross"></i></div>
      <div class="stickbox"${big?' id="wbR"':' id="sbR"'}><span class="lbl" id="${big?'wblR':'sblR'}">Right</span><span class="gx"></span><span class="gy"></span><div class="ext"></div><i class="cross"></i></div></div>`; }
    function drawStick(box,gp,xi,yi){ if(!box||!gp)return; const cr=box.querySelector('.cross');
      const x=gp.axes[xi]||0, y=gp.axes[yi]||0; cr.style.left=(x/2+0.5)*100+'%'; cr.style.top=(y/2+0.5)*100+'%'; }

    function opts(n,sel,none){ let s=none?`<option value="">${none}</option>`:'';
      for(let i=0;i<n;i++) s+=`<option value="${i}"${i===sel?' selected':''}>${i}</option>`; return s; }
    function renderModal(){
      const gp=activeGp(); const gs=navigator.getGamepads?[...navigator.getGamepads()].filter(g=>g):[];
      if(!prof&&gp){ curId=gp.id; prof=profFor(curId); }
      const nA=gp?gp.axes.length:0, nB=gp?gp.buttons.length:0;
      // Device list = the connected WebHID RC (if any) + every Gamepad-API pad.
      const devs=[]; if(hid.dev) devs.push({id:hid.id,axes:hid.axes.length,buttons:0,hid:true});
      for(const g of gs) devs.push({id:g.id,axes:g.axes.length,buttons:g.buttons.length,hid:false});
      // ── header bar: title · device · connect · enable · arm · export/import/reset · close ──
      let hd=`<h3>🎮 Controller</h3>
        <select id="gpdev">${devs.length?devs.map(d=>`<option value="${d.id}"${d.id===curId?' selected':''}>${(d.hid?'🎚 ':'🎮 ')+d.id.slice(0,34)} · ${d.axes}ax ${d.buttons}btn</option>`).join(''):'<option>— no controller detected —</option>'}</select>`;
      if('hid' in navigator) hd+=`<button class="gbtn" id="gphid">🎚 Connect DJI RC (USB)</button>`;
      if(gp&&prof){
        hd+=`<label class="row" style="margin:0"><input type="checkbox" id="gpen" ${prof.enabled?'checked':''}> Enable</label>
          <button class="gbtn ${armed?'on':''}" id="gparm" style="${armed?'background:var(--ok);border-color:var(--ok);color:#04120a':''}">${armed?'◉ ARMED — release':'▶ Arm control'}</button>`;
      }
      hd+=`<span class="sp"></span>
        <button class="gbtn" id="gpexp" title="Export profiles">⭳</button>
        <button class="gbtn" id="gpimp" title="Import profiles">⭱</button>
        <button class="gbtn" id="gpreset">Reset pad</button>
        <span class="close" id="gpx" style="position:static;font-size:18px">✕</span>`;

      // ── body: two columns ──
      let colL='', colR='';
      if(gp&&prof){
        // LEFT: live sticks + per-axis bars, then button mapping (compact 2-col grid)
        colL=`<div class="card"><h4>Sticks (live)</h4>${stickBoxes(false)}
          <div class="row" id="gpbtns" style="margin-top:10px"></div>
          <div id="gpaxall" style="margin-top:10px"></div></div>
          <div class="card"><h4>Buttons → actions</h4><div class="btngrid">`;
        for(const[k,lbl]of BTNS){ const b=prof.buttons[k];
          colL+=`<div class="row"><span class="nm">${lbl}</span>
            <button class="gbtn" data-learn="bt:${k}">Learn</button>
            <select data-bt="${k}">${opts(nB,b,'—')}</select></div>`;
        }
        colL+=`</div></div>`;
        // RIGHT: axis → gimbal mapping + curves + calibration
        colR=`<div class="card"><div class="row" style="justify-content:space-between;margin:0 0 6px">
          <h4 style="margin:0">Axes → gimbal</h4><button class="gbtn" id="gpcalbtn">🎯 Stick calibration</button></div>`;
        for(const[k,lbl]of AXES){ const a=prof.axes[k];
          colR+=`<div class="arow"><span class="nm">${lbl}</span>
            <button class="gbtn" data-learn="ax:${k}">Auto</button>
            <select data-ax="${k}">${opts(nA,a.axis,'—')}</select>
            <span class="x" data-clr="${k}" title="clear">✕</span>
            <div class="bar abar"><i id="axb-${k}" style="left:50%"></i></div>
            <label style="font-size:11px;white-space:nowrap"><input type="checkbox" data-inv="${k}" ${a.invert?'checked':''}> Invert</label>
            <span class="mono" id="axv-${k}" style="width:40px;text-align:right;color:var(--mut)">—</span></div>
            <details class="axdet" ${k==='tilt'?'open':''}><summary>tuning · curve</summary>
            <div class="axcfg" data-axcfg="${k}">
              <div class="row"><span class="nm">Mode</span>
                <select data-mode="${k}"><option value="rate"${a.mode==='rate'?' selected':''}>Rate (hold to move)</option><option value="abs"${a.mode==='abs'?' selected':''}>Absolute</option></select></div>
              <label class="f">Deadzone <span>${a.deadzone.toFixed(2)}</span></label><input type="range" min="0" max="0.5" step="0.01" value="${a.deadzone}" data-dz="${k}">
              <label class="f">Expo <span>${a.expo.toFixed(2)}</span></label><input type="range" min="0" max="1" step="0.05" value="${a.expo}" data-expo="${k}">
              <svg class="curve" data-curve="${k}" viewBox="0 0 100 60" preserveAspectRatio="none">
                <line x1="0" y1="30" x2="100" y2="30" stroke="var(--line-strong)" stroke-width=".6"/>
                <line x1="50" y1="0" x2="50" y2="60" stroke="var(--line-strong)" stroke-width=".6"/>
                <polyline class="cv" fill="none" stroke="var(--accent)" stroke-width="1.6"/>
                <circle class="dot" r="2.4" fill="var(--bug)" cx="50" cy="30" style="display:none"/>
              </svg>
              <div class="row"><span class="nm">Rate °/s</span><input type="number" style="width:70px" value="${a.rate}" data-rate="${k}">
                <span class="nm">Min°</span><input type="number" style="width:66px" value="${a.min}" data-min="${k}">
                <span class="nm">Max°</span><input type="number" style="width:66px" value="${a.max}" data-max="${k}"></div></div></details>`;
        }
        colR+=`</div>`;
      } else {
        colL=`<div class="card"><div class="sub">Connect your DJI RC over USB (button above), or plug in a gamepad and press any button so the browser detects it. Then calibrate + map, and arm to fly the gimbal — needs “Gimbal control” enabled on the bridge.</div></div>`;
      }
      modal.innerHTML=`<div class="gphd">${hd}</div><div class="gpbody"><div class="gpcols"><div class="gpcol">${colL}</div><div class="gpcol">${colR}</div></div></div>`;
      wire(gp,nA,nB);
    }
    function wire(gp,nA,nB){
      const $$=q=>modal.querySelectorAll(q), $1=q=>modal.querySelector(q);
      $1('#gpx').onclick=closeModal;
      const dev=$1('#gpdev'); if(dev) dev.onchange=()=>{ curId=dev.value; prof=profFor(curId); renderModal(); };
      const en=$1('#gpen'); if(en) en.onchange=()=>{ prof.enabled=en.checked; put(curId,prof); };
      $$('[data-learn]').forEach(b=>b.onclick=()=>{ startLearn(b.dataset.learn); });
      $$('[data-clr]').forEach(x=>x.onclick=()=>{ prof.axes[x.dataset.clr].axis=null; put(curId,prof); renderModal(); });
      $$('[data-ax]').forEach(s=>s.onchange=()=>{ prof.axes[s.dataset.ax].axis=s.value===''?null:+s.value; put(curId,prof); });
      $$('[data-bt]').forEach(s=>s.onchange=()=>{ prof.buttons[s.dataset.bt]=s.value===''?null:+s.value; put(curId,prof); });
      $$('[data-inv]').forEach(c=>c.onchange=()=>{ prof.axes[c.dataset.inv].invert=c.checked; put(curId,prof); });
      $$('[data-mode]').forEach(s=>s.onchange=()=>{ prof.axes[s.dataset.mode].mode=s.value; put(curId,prof); });
      const bind=(attr,fn,rerenderVal)=>$$(`[data-${attr}]`).forEach(el=>el.oninput=()=>{ const k=el.dataset[attr];
        fn(k,el.value); put(curId,prof); if(rerenderVal){ const s=el.previousElementSibling?.querySelector('span'); if(s) s.textContent=(+el.value).toFixed(2); } });
      bind('dz',(k,v)=>{prof.axes[k].deadzone=+v; drawCurve(k);},true);
      bind('expo',(k,v)=>{prof.axes[k].expo=+v; drawCurve(k);},true);
      for(const[k]of AXES) drawCurve(k);
      bind('rate',(k,v)=>prof.axes[k].rate=+v); bind('min',(k,v)=>prof.axes[k].min=+v); bind('max',(k,v)=>prof.axes[k].max=+v);
      const cb=$1('#gpcalbtn'); if(cb) cb.onclick=startCalib;
      const hb=$1('#gphid'); if(hb) hb.onclick=hidConnect;
      // On-screen arm/disarm (via act('arm') so it goes through the arbiter + release-on-disarm).
      const ab=$1('#gparm'); if(ab) ab.onclick=()=>{ act('arm'); renderModal(); };
      const rs=$1('#gpreset'); if(rs) rs.onclick=()=>{ const m=loadAll(); delete m[curId]; saveAll(m); prof=profFor(curId); renderModal(); };
      // Profile export/import: a plain JSON file — offline-capable, no server involved. Import
      // MERGES by pad id (imported pads win) so a shared profile doesn't wipe local ones.
      const ex=$1('#gpexp'); if(ex) ex.onclick=()=>{
        const blob=new Blob([JSON.stringify(loadAll(),null,2)],{type:'application/json'});
        const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
        a.download='tws-gamepad-profiles.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),5000); };
      const im=$1('#gpimp'); if(im) im.onclick=()=>{
        const inp=document.createElement('input'); inp.type='file'; inp.accept='application/json,.json';
        inp.onchange=()=>{ const f=inp.files&&inp.files[0]; if(!f) return;
          f.text().then(t=>{ const data=JSON.parse(t);
            if(typeof data!=='object'||!data) throw 0;
            const m=Object.assign(loadAll(),data); saveAll(m);
            if(curId) prof=profFor(curId); renderModal();
            if(window.TW&&TW.toast) TW.toast('Profiles imported','ok');
          }).catch(()=>{ if(window.TW&&TW.toast) TW.toast('Not a valid profile file','warn'); }); };
        inp.click(); };
    }

    addEventListener('gamepadconnected',()=>{ if(open) renderModal(); });
    addEventListener('gamepaddisconnected',()=>{ armed=false; if(open) renderModal(); });

    function act(name){ // fire a mapped button action (edge)
      if(name==='arm'){ armed=!armed;
        if(armed) TW.gimbal.arm('gamepad'); else TW.gimbal.release('gamepad'); }
      else if(name==='recenter'){ pitch=yaw=roll=0; }
      else if(name==='preset_level'){ pitch=0; }
      else if(name==='preset_nadir'){ pitch=-90; }
      else if(name==='sens_up') prof.sens=clampR(prof.sens*1.25,0.25,4);
      else if(name==='sens_down') prof.sens=clampR(prof.sens*0.8,0.25,4);
      else if(name==='record'){ TW.telemetry.send({action:'record'}); }
      else if(name.startsWith('menu_')){ TW.telemetry.send({action:'menu',k:name.slice(5)}); }
    }
    function readAxis(gp,cfg){ if(cfg.axis==null||cfg.axis>=gp.axes.length) return 0;
      let v=norm(gp.axes[cfg.axis],cfg.axis); v=dz(v,cfg.deadzone); v=expo(v,cfg.expo); return cfg.invert?-v:v; }

    // Response-curve preview: input (x, −1..1) → output through deadzone+expo (y). Recomputed only
    // when a slider moves; the magenta dot (live stick position through the curve) updates in loop().
    function drawCurve(k){ const svg=modal.querySelector(`[data-curve="${k}"]`); if(!svg) return;
      const a=prof.axes[k], pts=[];
      for(let i=0;i<=40;i++){ const x=-1+i/20; const y=expo(dz(x,a.deadzone),a.expo);
        pts.push((x*50+50).toFixed(1)+','+(30-y*28).toFixed(1)); }
      svg.querySelector('.cv').setAttribute('points',pts.join(' ')); }

    // ---- Auto-detect (guided "move the axis") ----
    function startLearn(tgt){ learn={tgt,base:null,btnBase:null};
      const gp=activeGp(); if(gp){ learn.base=[...gp.axes];
        // Snapshot which buttons are ALREADY held so a rest-high bit (the DJI RC has one) isn't
        // learned — only a button that transitions unpressed→pressed after this counts.
        learn.btnBase=gp.buttons.map(b=>b.pressed); }
      const nm=tgt.startsWith('ax:')?AXES.find(a=>a[0]===tgt.slice(3))[1]:BTNS.find(b=>b[0]===tgt.slice(3))[1];
      learnEl.innerHTML=`Move <b>${nm}</b>${tgt.startsWith('ax:')?' toward its <b>POSITIVE</b> direction (up / right), fully':' — press the button'}<small>Esc to cancel</small>`;
      learnEl.style.display='block'; }
    function endLearn(){ learn=null; learnEl.style.display='none'; if(open) renderModal(); }

    // ---- Guided stick calibration (sim-style: sweep both sticks fully, then centre) ----
    function startCalib(){ if(!prof) return; const gp=activeGp(); if(!gp) return;
      const cap={}; for(let i=0;i<gp.axes.length;i++) cap[i]={lo:gp.axes[i],hi:gp.axes[i]};
      calWiz={step:1,cap}; renderWiz(); wiz.style.display='block'; }
    function stopCalib(){ calWiz=null; wiz.style.display='none'; }
    function renderWiz(){
      wiz.innerHTML=`<h3>🎯 Stick calibration</h3>
        <div class="step">${calWiz.step===1
          ? 'Putar <b>kedua stik penuh ke segala arah</b> (buat lingkaran penuh, mentok di semua sisi).'
          : 'Lepas kedua stik ke <b>tengah</b>, lalu tekan Selesai.'}</div>
        ${stickBoxes(true)}
        <div><button class="gbtn primary" id="wnext">${calWiz.step===1?'Lanjut →':'✓ Selesai'}</button>
          <button class="gbtn" id="wcancel">Batal</button></div>`;
      wiz.querySelector('#wnext').onclick=()=>{ if(calWiz.step===1){ calWiz.step=2; renderWiz(); }
        else { const gp=activeGp(); if(gp){ prof.axcal={}; for(const i in calWiz.cap)
            prof.axcal[i]={lo:calWiz.cap[i].lo,hi:calWiz.cap[i].hi,center:gp.axes[i]||0}; put(curId,prof); }
          stopCalib(); if(open) renderModal(); } };
      wiz.querySelector('#wcancel').onclick=stopCalib;
    }

    function loop(ts){
      const gp=activeGp();
      if(gp){
        if(!prof||curId!==gp.id){ curId=gp.id; prof=profFor(curId); }
        const dt=last?Math.min(0.1,(ts-last)/1000):0; last=ts;
        // learn/auto-detect: pick the axis that moved most from its baseline (>0.5), or first button
        if(learn){ const tgt=learn.tgt;
          if(tgt.startsWith('ax:')){ let bi=-1,bd=0.5,bsign=0; for(let i=0;i<gp.axes.length;i++){ const dd=gp.axes[i]-((learn.base&&learn.base[i])||0); if(Math.abs(dd)>bd){bd=Math.abs(dd);bi=i;bsign=Math.sign(dd);} }
            if(bi>=0){ const ax=prof.axes[tgt.slice(3)]; ax.axis=bi;
              // AUTO-INVERT: the prompt asked for the POSITIVE direction — gamepad sticks read
              // NEGATIVE for up, so a negative excursion means invert to make the motion positive.
              ax.invert=bsign<0; put(curId,prof); endLearn(); } }
          else { for(let i=0;i<gp.buttons.length;i++){ const was=learn.btnBase&&learn.btnBase[i];
              if(gp.buttons[i].pressed&&!was){ prof.buttons[tgt.slice(3)]=i; put(curId,prof); endLearn(); break; } } } }
        // stick-calibration wizard: capture per-axis min/max while sweeping; draw the two big boxes
        if(calWiz){ if(calWiz.step===1) for(let i=0;i<gp.axes.length;i++){ const r=gp.axes[i];
            if(calWiz.cap[i]){ calWiz.cap[i].lo=Math.min(calWiz.cap[i].lo,r); calWiz.cap[i].hi=Math.max(calWiz.cap[i].hi,r); } }
          const bL=document.getElementById('wbL'), bR=document.getElementById('wbR');
          const wlay=stickLayout(gp);
          drawStick(bL,gp,wlay.L[0],wlay.L[1]); drawStick(bR,gp,wlay.R[0],wlay.R[1]);
          const wblL=document.getElementById('wblL'),wblR=document.getElementById('wblR');
          if(wblL)wblL.textContent=wlay.lL; if(wblR)wblR.textContent=wlay.lR;
          const pct=v=>(v/2+0.5)*100; const setExt=(box,xi,yi)=>{ if(!box)return; const e=box.querySelector('.ext'),cx=calWiz.cap[xi],cy=calWiz.cap[yi];
            if(cx&&cy){ e.style.left=pct(cx.lo)+'%'; e.style.top=pct(cy.lo)+'%'; e.style.width=(pct(cx.hi)-pct(cx.lo))+'%'; e.style.height=(pct(cy.hi)-pct(cy.lo))+'%'; } };
          setExt(bL,wlay.L[0],wlay.L[1]); setExt(bR,wlay.R[0],wlay.R[1]); }
        if(prof.enabled&&!learn&&!calWiz){
          // buttons (edge-triggered)
          for(const[k]of BTNS){ const idx=prof.buttons[k]; if(idx==null) continue;
            const p=!!(gp.buttons[idx]&&gp.buttons[idx].pressed); if(p&&!prevB[k]) act(k); prevB[k]=p; }
          // tilt axis → gimbal TILT ANGLE via rate integration (0x0A ANGLE is the command that moves the
          // O4 gimbal; speed 0x0C did NOT). Stick deflection changes the target tilt; streamed continuously
          // (angle holds where set). Disarming sends one release (Suspend → RC).
          pitch=clampR(pitch + readAxis(gp,prof.axes.tilt)*(prof.axes.tilt.rate||80)*prof.sens*dt, -90, 50);
          // stream via the arbiter (gimbal.js owns the single ≤10 Hz sender; release is
          // handled by TW.gimbal.release in act('arm'))
          if(armed) TW.gimbal.command('gamepad', pitch);
        }
        chip.style.display='';
        chip.innerHTML=(armed?'🎮 <b style="color:var(--green)">ARMED</b>':'🎮 tap to setup')+
          ` · tilt <b style="color:#fff">${Math.round(pitch)}°</b>`+
          (prof&&prof.sens!==1?` · ${prof.sens.toFixed(2)}×`:'');
        // live rendering when the modal is open: the two stick boxes, button dots, per-row axis bars
        if(open){
          const lay=stickLayout(gp);
          drawStick(document.getElementById('sbL'),gp,lay.L[0],lay.L[1]); drawStick(document.getElementById('sbR'),gp,lay.R[0],lay.R[1]);
          const lblL=document.getElementById('sblL'),lblR=document.getElementById('sblR');
          if(lblL&&lblL.textContent!==lay.lL)lblL.textContent=lay.lL; if(lblR&&lblR.textContent!==lay.lR)lblR.textContent=lay.lR;
          const bt=document.getElementById('gpbtns');
          if(bt){ let m=''; for(let i=0;i<gp.buttons.length;i++) m+=`<span class="dot ${gp.buttons[i].pressed?'on':''}" title="btn ${i}"></span>`;
            if(!gp.buttons.length) m='<span class="mono" style="color:var(--mut);font-size:11px">no buttons in this mode — use “Arm stick control” below</span>'; bt.innerHTML=m; }
          // per-axis live bars (all physical axes) — rebuilt once, values updated each frame
          const axall=document.getElementById('gpaxall');
          if(axall){ if(axall.children.length!==gp.axes.length){ let m='';
              for(let i=0;i<gp.axes.length;i++) m+=`<div class="arow" style="margin:3px 0"><span class="nm" style="min-width:52px">axis ${i}</span>`+
                `<div class="bar abar"><i id="gpax-${i}" style="left:50%"></i></div>`+
                `<span class="mono" id="gpaxv-${i}" style="width:44px;text-align:right;color:var(--mut)">0.00</span></div>`;
              axall.innerHTML=m; }
            for(let i=0;i<gp.axes.length;i++){ const raw=gp.axes[i]; const bar=document.getElementById('gpax-'+i), lab=document.getElementById('gpaxv-'+i);
              if(bar) bar.style.left=(raw/2+0.5)*100+'%'; if(lab) lab.textContent=raw.toFixed(2); } }
          for(const[k]of AXES){ const a=prof.axes[k]; const b=document.getElementById('axb-'+k), el=document.getElementById('axv-'+k);
            const cv=modal.querySelector(`[data-curve="${k}"] .dot`);
            if(a.axis!=null){ const v=readAxis(gp,a); if(b) b.style.left=(v/2+0.5)*100+'%'; if(el) el.textContent=v.toFixed(2);
              if(cv){ const raw=norm(gp.axes[a.axis],a.axis)*(a.invert?-1:1); cv.style.display='';
                cv.setAttribute('cx',raw*50+50); cv.setAttribute('cy',30-v*28); } }
            else { if(b) b.style.left='50%'; if(el) el.textContent='—'; if(cv) cv.style.display='none'; } }
        }
      } else { chip.style.display= (loadAll()&&Object.keys(loadAll()).length)?'':'none'; if(chip.style.display==='') chip.textContent='🎮 controller idle'; }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  })();
