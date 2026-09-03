const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const text=readFileSync(path.join(__dirname,'../src/app/app.component.ts'),'utf8');
const ast=ts.createSourceFile('app.component.ts',text,ts.ScriptTarget.Latest,true);
const component=ast.statements.find(node=>ts.isClassDeclaration(node)&&node.name.text==='AppComponent');
const names=['login','limitsAccessMessage','focusSensorEditor','ensureEditorFocus','canManageLimits','onSensorBackdropMouseDown','onRefreshBackdropMouseDown'];
const members=component.members.filter(node=>(ts.isMethodDeclaration(node)||ts.isGetAccessorDeclaration(node))&&names.includes(node.name.getText(ast)));
assert.equal(members.length,names.length);
const compiled=ts.transpileModule(`class Harness {${members.map(node=>node.getText(ast)).join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function setup() {
  const scheduled=[];
  const document={activeElement:{matches:()=>false}};
  const Harness=new Function('window','document',`${compiled};return Harness;`)({setTimeout:fn=>scheduled.push(fn)},document);
  let focused=0;
  const subject=Object.assign(new Harness(),{session:{username:'admin',token:'test',permissions:['settings.manage']},selectedSensor:{id:'001'},db:{available:true,desktopExpected:true,focusEditor:async()=>true},sensorLowInput:{nativeElement:{focus(){focused++;}}}});
  return {subject,scheduled,document,focused:()=>focused};
}
test('Electron with a missing bridge cannot silently authenticate as browser demo admin',async()=>{
  const {subject}=setup();subject.db.available=false;subject.session=null;
  await subject.login();
  assert.equal(subject.session,null);assert.match(subject.loginError,/連線模組未載入/);
});
test('editor describes bridge, permissions, saving and ready states separately',()=>{
  const {subject}=setup();assert.match(subject.limitsAccessMessage,/可編輯.*admin/);
  subject.limitsSaving=true;assert.match(subject.limitsAccessMessage,/等待.*儲存/);
  subject.limitsSaving=false;subject.session.permissions=[];assert.match(subject.limitsAccessMessage,/權限/);
  subject.db.available=false;assert.match(subject.limitsAccessMessage,/模組未載入/);
  subject.db.desktopExpected=false;assert.match(subject.limitsAccessMessage,/瀏覽器預覽/);
});
test('opening the editor focuses its input after rendering, without changing values',async()=>{
  const {subject,scheduled,focused}=setup();subject.editLow=2;
  subject.focusSensorEditor();assert.equal(focused(),0);
  await scheduled.shift()();assert.equal(focused(),1);assert.equal(subject.editLow,2);
});
test('closed editor, readonly account and pending saves do not receive delayed focus',async()=>{
  for(const change of [s=>s.selectedSensor=null,s=>s.session.permissions=[],s=>s.limitsSaving=true]) {
    const {subject,scheduled,focused}=setup();subject.focusSensorEditor();change(subject);
    await scheduled.shift()();assert.equal(focused(),0);
  }
});
test('older optional focus bridge failure does not block the editor',async()=>{
  const {subject,scheduled,focused}=setup();subject.db.focusEditor=async()=>{throw new Error('old version');};
  subject.focusSensorEditor();await scheduled.shift()();assert.equal(focused(),1);
});
test('choosing the upper input before or during IPC prevents lower-input focus stealing',async()=>{
  for(const duringIpc of [false,true]) {
    const {subject,scheduled,document,focused}=setup();
    if(duringIpc)subject.db.focusEditor=async()=>{document.activeElement.matches=()=>true;};
    else document.activeElement.matches=()=>true;
    subject.focusSensorEditor();await scheduled.shift()();assert.equal(focused(),0);
  }
});
test('clicking numeric inputs does not refocus Electron during native spinner handling',()=>{
  const html=readFileSync(path.join(__dirname,'../src/app/app.component.html'),'utf8');
  assert.doesNotMatch(html,/\(pointerdown\)="ensureEditorFocus\(\)"/);
});
test('dialog child clicks return undefined so Angular does not cancel native input behavior',()=>{
  const {subject}=setup();const backdrop={},input={};
  const event={target:input,currentTarget:backdrop};
  assert.equal(subject.onSensorBackdropMouseDown(event),undefined);
  assert.equal(subject.selectedSensor.id,'001');
  subject.refreshDialogOpen=true;
  assert.equal(subject.onRefreshBackdropMouseDown(event),undefined);
  assert.equal(subject.refreshDialogOpen,true);
  assert.equal(subject.onSensorBackdropMouseDown({target:backdrop,currentTarget:backdrop}),undefined);
  assert.equal(subject.selectedSensor,null);
  subject.onRefreshBackdropMouseDown({target:backdrop,currentTarget:backdrop});
  assert.equal(subject.refreshDialogOpen,false);
});
test('sensor backdrop cannot dismiss a pending save and templates do not return false for child clicks',()=>{
  const {subject}=setup();const backdrop={};subject.limitsSaving=true;
  subject.onSensorBackdropMouseDown({target:backdrop,currentTarget:backdrop});
  assert.equal(subject.selectedSensor.id,'001');
  const html=readFileSync(path.join(__dirname,'../src/app/app.component.html'),'utf8');
  assert.doesNotMatch(html,/\(mousedown\)="[^"]*&&/);
});
