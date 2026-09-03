// Run explicitly with Electron, not node --test. Uses a disposable profile only.
const { app } = require('electron');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'e62-bridge-smoke-')));
let done = false;
const timeout = setTimeout(() => { console.error('Electron bridge smoke timed out'); app.exit(1); }, 25000);
app.on('browser-window-created', (_event, window) => {
  // Keep the test isolated from the user's desktop and real database.
  // Native mouse routing requires a visible focused BrowserWindow on Windows.
  // Opt in explicitly; default bridge-only runs stay hidden.
  const nativeMouse = process.argv.includes('--native-mouse');
  if (!nativeMouse) window.show = () => {};
  window.webContents.on('preload-error', (_event, preload, error) => console.error('Preload error:', preload, error.message));
  window.webContents.once('did-finish-load', async () => {
    if (done) return;
    done = true;
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        if (!window.e62Db) throw new Error('Electron preload did not expose e62Db');
        const bootstrap = await window.e62Db.bootstrap();
        const result = await window.e62Db.login('admin', 'SGS@1234');
        if (!result.session.permissions.includes('settings.manage')) throw new Error('Admin permission missing');
        await window.e62Db.ingestSnapshot(result.session.token, {channels:[{id:'001',name:'Smoke test',pv:5,st:0}]}, 'mock');
        await window.e62Db.saveSetting(result.session.token,'alarms.default_limits',{low:1,high:9});
        await window.e62Db.saveChannelLimits(result.session.token,'001',{low:3,high:7});
        const channels = await window.e62Db.latestChannels(result.session.token);
        if (channels[0].web_lo !== 3 || channels[0].web_hi !== 7) throw new Error('Saved limits not returned');
        await window.e62Db.logout(result.session.token);
        // Exercise the real compiled Angular login and modal bindings in this fixture.
        const waitFor = async (read) => {
          for (let n=0;n<100;n++) { const value=read(); if(value)return value; await new Promise(resolve=>setTimeout(resolve,50)); }
          throw new Error('Angular UI did not become ready');
        };
        const username=await waitFor(()=>document.querySelector('input[placeholder="請輸入帳號"]'));
        const password=document.querySelector('input[placeholder="請輸入密碼"]');
        const fill=(input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
        fill(username,'admin');fill(password,'SGS@1234');
        document.querySelector('.login-submit').click();
        (await waitFor(()=>document.querySelector('.sensor-name-button'))).click();
        const low=await waitFor(()=>document.querySelector('.sensor-settings-form input'));
        const high=document.querySelectorAll('.sensor-settings-form input')[1];
        if(low.disabled||high.disabled)throw new Error('Actual Angular inputs are disabled: '+document.querySelector('.sensor-settings-form').textContent);
        fill(low,'3');fill(high,'7');
        await new Promise(resolve=>setTimeout(resolve,1100));
        if(low.value!=='3'||high.value!=='7')throw new Error('Input overwritten on change detection');
        document.querySelector('.sensor-settings-form .primary-button').click();
        await waitFor(()=>document.querySelector('.modal-message')?.textContent.includes('個別上下限已儲存'));
        return {bridge:true,adminPermission:true,uiEditable:true,uiSave:true,savedLimits:[3,7],temporaryDatabase:bootstrap.databasePath};
      })()`);
      if (nativeMouse) { window.show(); window.focus(); }
      await window.webContents.executeJavaScript("document.querySelector('.sensor-settings-form input').focus(); document.querySelector('.sensor-settings-form input').select();");
      window.webContents.focus();
      for (const type of ['keyDown','char','keyUp']) window.webContents.sendInputEvent({type,keyCode:'4'});
      const typed = await window.webContents.executeJavaScript("document.querySelector('.sensor-settings-form input').value");
      if (typed !== '4') throw new Error(`Electron keyboard input failed: ${typed}`);
      for (const type of ['keyDown','keyUp']) window.webContents.sendInputEvent({type,keyCode:'Up'});
      const stepped = await window.webContents.executeJavaScript("document.querySelector('.sensor-settings-form input').value");
      if (stepped !== '4.1') throw new Error(`Electron arrow increment failed: ${stepped}`);
      for (const type of ['keyDown','keyUp']) window.webContents.sendInputEvent({type,keyCode:'Down'});
      const lowered = await window.webContents.executeJavaScript("document.querySelector('.sensor-settings-form input').value");
      if (lowered !== '4') throw new Error(`Electron arrow decrement failed: ${lowered}`);
      // Mouse navigation is distinct from programmatically focusing just the low input.
      const pause = () => new Promise(resolve => setTimeout(resolve,100));
      await window.webContents.executeJavaScript(`window.__testFocusTrace=[]; for(const type of ['pointerdown','mousedown','mouseup','click','focusin','focusout']) document.addEventListener(type,event=>{window.__testFocusTrace.push({type,target:event.target.tagName,index:Array.from(document.querySelectorAll('.sensor-settings-form input')).indexOf(event.target),x:event.clientX,y:event.clientY});},true);`);
      const clickInput = async (index, part='text', count=1) => {
        const point = await window.webContents.executeJavaScript(`(() => {
          const input=document.querySelectorAll('.sensor-settings-form input')[${index}];
          const r=input.getBoundingClientRect();
          return {x:Math.round(${part==='text' ? 'r.left+50' : 'r.right-parseFloat(getComputedStyle(input).paddingRight)-8'}),y:Math.round(r.top+r.height/2+${part==='up' ? -5 : part==='down' ? 5 : 0})};
        })()`);
        const hit = await window.webContents.executeJavaScript(`(() => {
          const elements=document.elementsFromPoint(${point.x},${point.y});
          return {point:${JSON.stringify(point)},hit:elements.slice(0,5).map(e=>({tag:e.tagName,cls:e.className,html:e.outerHTML.slice(0,160)})),viewport:[innerWidth,innerHeight,devicePixelRatio]};
        })()`);
        window.webContents.sendInputEvent({type:'mouseMove',...point});
        await pause();
        for(let n=0;n<count;n++) {
          window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:n+1,...point});
          window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:n+1,...point});
        }
        await pause();
        const focused=await window.webContents.executeJavaScript(`document.activeElement===document.querySelectorAll('.sensor-settings-form input')[${index}]`);
        if(!focused) {
          const active=await window.webContents.executeJavaScript('document.activeElement.outerHTML.slice(0,250)');
          const trace=await window.webContents.executeJavaScript('window.__testFocusTrace');
          throw new Error(`Mouse focus did not reach input ${index}: ${JSON.stringify(hit)} active=${active} trace=${JSON.stringify(trace)}`);
        }
      };
      for(const index of nativeMouse ? [1,0,1] : []) {
        await clickInput(index,'text',2);
        for(const type of ['keyDown','keyUp'])window.webContents.sendInputEvent({type,keyCode:'A',modifiers:['control']});
        for(const type of ['keyDown','char','keyUp'])window.webContents.sendInputEvent({type,keyCode:index===1?'8':'4'});
        await pause();
        const value=await window.webContents.executeJavaScript(`document.querySelectorAll('.sensor-settings-form input')[${index}].value`);
        if(value!==(index===1?'8':'4'))throw new Error(`Mouse-selected input ${index} rejected keyboard text: ${value}`);
      }
      for(const index of nativeMouse ? [0,1] : []) {
        const base=index===0?4:8;
        await clickInput(index,'text');
        for(const type of ['keyDown','keyUp'])window.webContents.sendInputEvent({type,keyCode:'Up'});
        await pause();
        let value=await window.webContents.executeJavaScript(`document.querySelectorAll('.sensor-settings-form input')[${index}].value`);
        if(Number(value)!==base+.1)throw new Error(`Input ${index} Up failed: ${value}`);
        for(const type of ['keyDown','keyUp'])window.webContents.sendInputEvent({type,keyCode:'Down'});
        await pause();
        await clickInput(index,'up');
        value=await window.webContents.executeJavaScript(`document.querySelectorAll('.sensor-settings-form input')[${index}].value`);
        if(Number(value)!==base+.1)throw new Error(`Input ${index} spinner up failed: ${value}`);
        await clickInput(index,'down');
        value=await window.webContents.executeJavaScript(`document.querySelectorAll('.sensor-settings-form input')[${index}].value`);
        if(Number(value)!==base)throw new Error(`Input ${index} spinner down failed: ${value}`);
      }
      await window.webContents.executeJavaScript(`(async()=>{
        document.querySelector('.sensor-settings-form .primary-button').click();
        for(let n=0;n<100;n++) {
          await new Promise(resolve=>setTimeout(resolve,50));
          if(document.querySelector('.modal-message')?.textContent.includes('個別上下限已儲存'))return;
        }
        throw new Error('Keyboard-edited limits did not save');
      })()`);
      const db = require('../electron/database.cjs');
      const inspection = db.login('admin','SGS@1234');
      const savedChannel=db.latestSnapshot(inspection.session.token)[0];
      if(savedChannel.web_lo !== 4 || savedChannel.web_hi !== (nativeMouse ? 8 : 7))throw new Error('Keyboard values missing from database');
      db.logout(inspection.session.token);
      result.keyboard = true; result.arrowKeys = true; result.mouseSwitchAndDoubleClick = nativeMouse; result.bothSpinners = nativeMouse; result.savedLimits = [4,nativeMouse?8:7];
      console.log(JSON.stringify(result));
      clearTimeout(timeout);
      app.exit(0);
    } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
  });
});
require('../electron/main.cjs');
