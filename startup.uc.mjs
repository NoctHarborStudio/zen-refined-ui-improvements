/* Zen Refined — startup placeholders. Only these two native prefs are
 * changed, and only while the corresponding Sine option is enabled.
 * Persist ownership across normal exits because the skeleton is created
 * before Sine loads. Restore the exact previous user/default state on off.
 */
const OPTION="zen.refined.startup.disable-placeholders";
const BACKUP="zen.refined.startup.previous-placeholders";
const TARGETS=["browser.startup.blankWindow","browser.startup.preXulSkeletonUI"];
const prefs=Services.prefs;
const KEY="__zenRefinedStartupPlaceholders";
function readBackup(){
  try{const b=JSON.parse(prefs.getStringPref(BACKUP,"{}"));return b&&typeof b==="object"&&!Array.isArray(b)?b:{};}catch{return {};}
}
function persist(){try{prefs.savePrefFile(null);}catch(error){console.warn("[Zen Refined] Could not save startup preferences",error);}}
function apply(){
  const backup=readBackup();let changed=false;
  for(const name of TARGETS){
    try{
      if(prefs.prefIsLocked(name)||prefs.getPrefType(name)!==prefs.PREF_BOOL)continue;
      if(prefs.getBoolPref(name)===false)continue;
      if(!Object.hasOwn(backup,name)){
        backup[name]={user:prefs.prefHasUserValue(name),value:prefs.getBoolPref(name)};
        prefs.setStringPref(BACKUP,JSON.stringify(backup));
      }
      prefs.setBoolPref(name,false);changed=true;
    }catch(error){console.warn("[Zen Refined] Startup preference",name,error);}
  }
  if(changed)persist();
}
function restore(){
  const backup=readBackup();let changed=false;
  for(const name of TARGETS){
    const old=backup[name];if(!old||typeof old.user!=="boolean"||typeof old.value!=="boolean")continue;
    try{
      if(prefs.prefIsLocked(name))continue;
      // Respect a later explicit change made by another tool or the user.
      if(prefs.getPrefType(name)===prefs.PREF_BOOL&&prefs.getBoolPref(name)===false){
        if(old.user)prefs.setBoolPref(name,old.value);else prefs.clearUserPref(name);
      }
      delete backup[name];changed=true;
    }catch(error){console.warn("[Zen Refined] Startup restore",name,error);}
  }
  if(changed){
    if(Object.keys(backup).length)prefs.setStringPref(BACKUP,JSON.stringify(backup));else prefs.clearUserPref(BACKUP);
    persist();
  }
}
function sync(){if(prefs.getBoolPref(OPTION,true))apply();else restore();}
let closing=false,disposed=false,closeTimer=0;
function beforeClose(event){
  if(event.target!==window&&event.target!==document)return;
  closing=true;
  if(closeTimer)window.clearTimeout(closeTimer);
  closeTimer=window.setTimeout(()=>{closing=false;closeTimer=0;},1000);
}
function cleanup(modUnload=false){
  if(disposed)return;disposed=true;
  if(closeTimer)window.clearTimeout(closeTimer);
  try{prefs.removeObserver(OPTION,sync);}catch{}
  window.removeEventListener("beforeunload",beforeClose,true);
  window.removeEventListener("unload",nativeUnload);
  if(modUnload&&!closing&&!window.closed&&!Services.startup.shuttingDown)restore();
  if(window[KEY]===cleanup)delete window[KEY];
}
function nativeUnload(){cleanup(false);}
if(typeof window.addUnloadListener==="function"&&!document.documentElement.hasAttribute("popup-window")){
  window[KEY]?.(true);window[KEY]=cleanup;
  window.addEventListener("beforeunload",beforeClose,true);
  window.addEventListener("unload",nativeUnload,{once:true});
  window.addUnloadListener(()=>cleanup(true));
  prefs.addObserver(OPTION,sync);
  sync();
}
