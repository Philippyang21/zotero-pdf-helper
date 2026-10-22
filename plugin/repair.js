/* global Zotero, Services, IOUtils, PathUtils, Cc, Ci, ChromeUtils */
'use strict';
var PDFRepair = class {
  constructor(options) {
    Object.assign(this,options);
    this.windows = new Map();
    this.connection = null;
    this.starting = null;
    this.polling = false;
    this.pending = false;
    this.finalizing = new Set();
    this.finalizeErrors = new Map();
    this.finalizePhase = new Map();
    this.storageLocks = new Map();
    this.busyMessage = '';
    this.state = {jobs:[],usage:{}};
    this.credentialHost = 'chrome://paddleocrrepair';
    this.credentialRealm = 'PaddleOCR API';
    this.data = PathUtils.join(Zotero.Profile.dir,'paddleocr-pdf-repair');
    this.descriptor = PathUtils.join(this.data,'connection.json');
  }
  pref(key) { return Zotero.Prefs.get('extensions.paddleocrrepair.'+key,true); }
  setPref(key,value) { Zotero.Prefs.set('extensions.paddleocrrepair.'+key,value,true); }
  async init() {
    try {
      if(typeof AcademicTextUI!=='undefined'){this.textTools=new AcademicTextUI(this);this.textTools.init();}
    } catch (_) { Zotero.logError(new Error('引用文本整理界面未能初始化。')); }
    await IOUtils.makeDirectory(this.data,{ignoreExisting:true});
    this.receiptsPath = PathUtils.join(this.data,'attachments.json');
    this.receipts = await IOUtils.exists(this.receiptsPath) ? await IOUtils.readJSON(this.receiptsPath) : {};
    await Zotero.PreferencePanes.register({pluginID:this.id,id:'paddleocrrepair-preferences',
      label:'PDF Helper',src:this.rootURI+'content/preferences.xhtml',
      scripts:[this.rootURI+'content/preferences.js',this.rootURI+'content/textPreferences.js',this.rootURI+'content/updatePreferences.js']});
    for (const win of Zotero.getMainWindows()) this.addWindow(win);
    this.timer = setInterval(()=>this.tick().catch(()=>{}),2000);
    // Restore journaled work after a Zotero restart, even if the helper was stopped.
    const journal = PathUtils.join(this.data,'jobs');
    if (await IOUtils.exists(journal)) {
      const dirs = await IOUtils.getChildren(journal);
      for (const dir of dirs) {
        try {
          const job = await IOUtils.readJSON(PathUtils.join(dir,'job.json'));
          if (job.recoverable || !['done','cancelled','failed','retained','paused'].includes(job.state)) {
            this.pending = true;
            await this.ensure();
            break;
          }
        } catch (_) {}
      }
    }
  }
  async shutdown() {
    try { this.updates?.dispose(); } catch (_) {}
    try { await this.textTools?.shutdown(); } catch (_) { Zotero.logError(new Error('引用文本整理关闭时遇到问题。')); }
    clearInterval(this.timer);
    for (const win of [...this.windows.keys()]) this.removeWindow(win);
    if (this.statusWindow && !this.statusWindow.closed) this.statusWindow.close();
    if (this.connection) {
      try { await this.request('POST','/shutdown',{},1000); } catch (_) {}
    }
  }
  alert(message,win=Zotero.getMainWindow()) { Services.prompt.alert(win,'PDF Helper',String(message)); }
  confirm(message,win=Zotero.getMainWindow()) { return Services.prompt.confirm(win,'整理高亮文字',String(message)); }
  notify(message,delay=5000) {
    const progress = new Zotero.ProgressWindow();
    progress.changeHeadline('PDF Helper');
    progress.addDescription(message);
    progress.show();
    progress.startCloseTimer(delay);
  }
  renderState() { if (this.statusWindow && !this.statusWindow.closed) this.statusWindow.render?.(this.state); }
  showBusy(message) { this.busyMessage=message; this.renderState(); }
  selected(win) {
    return win.ZoteroPane.getSelectedItems().filter(i=>i.isAttachment() &&
      (i.attachmentContentType==='application/pdf' || /\.pdf$/i.test(i.attachmentFilename||'')));
  }
  addWindow(win) {
    try { this.textTools?.addWindow(win); } catch (_) { Zotero.logError(new Error('引用文本整理菜单未能载入。')); }
    if (this.windows.has(win)) return;
    const doc = win.document;
    const popup = doc.getElementById('zotero-itemmenu');
    if (!popup) return;
    const nodes = [];
    const menu = (label,fn)=>{
      const node = doc.createXULElement('menuitem');
      node.setAttribute('label',label);
      node.classList.add('paddleocr-repair-menu');
      node.addEventListener('command',()=>Promise.resolve(fn()).catch(e=>this.alert(e.message,win)));
      popup.appendChild(node); nodes.push(node); return node;
    };
    const sep = doc.createXULElement('menuseparator'); popup.appendChild(sep); nodes.push(sep);
    menu('PaddleOCR 识别并替换为可检索 PDF',()=>this.submitSelected(win,'ocr'));
    menu('合并已有 MD/JSON，生成可检索 PDF',()=>this.submitSelected(win,'merge'));
    menu('识别版权页并补全文献条目',()=>this.copyrightSelected(win));
    menu('查看 PDF Helper 任务状态',()=>this.openStatus(win));
    menu('恢复原始 PDF',()=>this.restoreSelected(win));
    const showing = ()=>{ for (const node of nodes) node.hidden=this.selected(win).length===0; };
    popup.addEventListener('popupshowing',showing);
    const tools = doc.getElementById('menu_ToolsPopup');
    let tool;
    if (tools) {
      tool=doc.createXULElement('menuitem'); tool.setAttribute('label','PDF Helper：任务与设置');
      tool.addEventListener('command',()=>this.openStatus(win)); tools.appendChild(tool);
    }
    this.windows.set(win,{popup,showing,nodes,tool});
  }
  removeWindow(win) {
    try { this.textTools?.removeWindow(win); } catch (_) { Zotero.logError(new Error('引用文本整理菜单清理未完成。')); }
    const entry=this.windows.get(win); if (!entry) return;
    entry.popup.removeEventListener('popupshowing',entry.showing);
    for (const node of entry.nodes) node.remove();
    entry.tool?.remove(); this.windows.delete(win);
  }
  async token() {
    const logins=Services.logins.findLogins(this.credentialHost,null,this.credentialRealm);
    return logins[0]?.password || '';
  }
  async saveToken(value) {
    const old=Services.logins.findLogins(this.credentialHost,null,this.credentialRealm);
    for (const login of old) Services.logins.removeLogin(login);
    if (value) {
      const login=Cc['@mozilla.org/login-manager/loginInfo;1'].createInstance(Ci.nsILoginInfo);
      login.init(this.credentialHost,null,this.credentialRealm,'paddleocr',value,'','');
      await Services.logins.addLoginAsync(login);
    }
  }
  async request(method,path,body,timeout=30000) {
    if (!this.connection) throw new Error('本地辅助程序尚未连接');
    const response=await Zotero.HTTP.request(method,'http://127.0.0.1:'+this.connection.port+path,{
      headers:{Authorization:'Bearer '+this.connection.token,'Content-Type':'application/json'},
      body:body===undefined ? undefined : JSON.stringify(body),responseType:'json',timeout,
      successCodes:false,debug:false,logBodyLength:0
    });
    if (response.status!==200) throw new Error(response.response?.error || '本地服务请求失败');
    return response.response;
  }
  async ensure() {
    if (this.starting) return this.starting;
    this.starting=this._ensure();
    try { return await this.starting; } finally { this.starting=null; }
  }
  async _ensure() {
    if (await IOUtils.exists(this.descriptor)) {
      try {
        this.connection=await IOUtils.readJSON(this.descriptor);
        const health=await this.request('GET','/health',undefined,1500);
        if (health.version!==this.version) throw new Error('辅助程序版本不同，请退出 Zotero 并稍后重启');
        await this.configure(); return;
      } catch (error) {
        this.connection=null;
        if (error.message.includes('版本不同')) throw error;
      }
    }
    const executable=await this.findPython();
    const launcher=await this.extractHelper();
    if (await IOUtils.exists(this.descriptor)) await IOUtils.remove(this.descriptor);
    const setup=PathUtils.join(this.data,'setup.json');
    if (await IOUtils.exists(setup)) await IOUtils.remove(setup);
    const file=Zotero.File.pathToFile(executable);
    const process=Cc['@mozilla.org/process/util;1'].createInstance(Ci.nsIProcess);
    process.init(file);
    const args=[launcher,'--data',this.data,'--connection',this.descriptor];
    process.runwAsync(args,args.length,null,false);
    for (let attempt=0;attempt<2400;attempt++) {
      await Zotero.Promise.delay(250);
      if (attempt%8===0 && await IOUtils.exists(setup)) {
        const progress=await IOUtils.readJSON(setup);
        if (progress.stage==='error') throw new Error(progress.message);
        this.setupMessage=progress.message;
        if (this.statusWindow && !this.statusWindow.closed) this.statusWindow.showSetup?.(progress.message);
      }
      if (await IOUtils.exists(this.descriptor)) {
        try {
          this.connection=await IOUtils.readJSON(this.descriptor);
          await this.request('GET','/health',undefined,1000);
          await this.configure(); return;
        } catch (_) { this.connection=null; }
      }
    }
    throw new Error('Python 环境准备超时。请检查网络或任务目录中的 setup.log；不会调用 OCR');
  }
  userHome() {
    try { return Services.dirsvc.get('Home',Ci.nsIFile).path; }
    catch (_) { return ''; }
  }
  expandUserPath(value) {
    let result=String(value||'').trim();
    if ((result.startsWith('"') && result.endsWith('"')) ||
        (result.startsWith("'") && result.endsWith("'"))) result=result.slice(1,-1).trim();
    if (Zotero.isMac && (result==='~' || result.startsWith('~/'))) {
      const home=this.userHome();
      if (home) result=result==='~' ? home : PathUtils.join(home,...result.slice(2).split('/').filter(Boolean));
    }
    return result;
  }
  async versionedPythonCandidates(root) {
    try {
      if (!await IOUtils.exists(root)) return [];
      const versions=(await IOUtils.getChildren(root)).filter(path=>/^\d+(?:\.\d+)*$/.test(PathUtils.filename(path)));
      versions.sort((a,b)=>PathUtils.filename(b).localeCompare(PathUtils.filename(a),undefined,{numeric:true}));
      return versions.map(path=>PathUtils.join(path,'bin','python3'));
    } catch (_) { return []; }
  }
  async homebrewPythonCandidates(root) {
    try {
      if (!await IOUtils.exists(root)) return [];
      const formulas=(await IOUtils.getChildren(root)).filter(path=>/^python(?:@\d+(?:\.\d+)*)?$/.test(PathUtils.filename(path)));
      formulas.sort((a,b)=>PathUtils.filename(b).localeCompare(PathUtils.filename(a),undefined,{numeric:true}));
      const result=[];
      for (const path of formulas) {
        result.push(PathUtils.join(path,'libexec','bin','python3'),PathUtils.join(path,'bin','python3'));
        const match=PathUtils.filename(path).match(/^python@(\d+(?:\.\d+)*)$/);
        if (match) result.push(PathUtils.join(path,'bin','python'+match[1]));
      }
      return result;
    } catch (_) { return []; }
  }
  async findPython() {
    const configured=this.expandUserPath(this.pref('pythonPath'));
    if (configured) {
      if (!await IOUtils.exists(configured)) throw new Error('设置中的 Python 路径不存在');
      if (Zotero.isWin && /python\.exe$/i.test(configured)) {
        const silent=configured.replace(/python\.exe$/i,'pythonw.exe');
        if (await IOUtils.exists(silent)) return silent;
      }
      return configured;
    }
    const candidates=[];
    if (Zotero.isWin) {
      const roots=[Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER,Ci.nsIWindowsRegKey.ROOT_KEY_LOCAL_MACHINE];
      for (const root of roots) {
        const registry=Cc['@mozilla.org/windows-registry-key;1'].createInstance(Ci.nsIWindowsRegKey);
        try {
          registry.open(root,'SOFTWARE\\Python\\PythonCore',registry.ACCESS_READ);
          const versions=[];
          for(let i=0;i<registry.childCount;i++) versions.push(registry.getChildName(i));
          versions.sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
          for(const version of versions) {
            const install=Cc['@mozilla.org/windows-registry-key;1'].createInstance(Ci.nsIWindowsRegKey);
            try {
              install.open(root,'SOFTWARE\\Python\\PythonCore\\'+version+'\\InstallPath',install.ACCESS_READ);
              candidates.push(PathUtils.join(install.readStringValue(''),'pythonw.exe'));
            } catch (_) {} finally { install.close(); }
          }
        } catch (_) {} finally { registry.close(); }
      }
    } else if (Zotero.isMac) {
      // Finder-launched applications usually receive a minimal PATH. Probe the
      // standard native package-manager and framework locations explicitly.
      candidates.push('/opt/homebrew/bin/python3','/usr/local/bin/python3',
        '/Library/Frameworks/Python.framework/Versions/Current/bin/python3','/opt/local/bin/python3');
      candidates.push(...await this.homebrewPythonCandidates('/opt/homebrew/opt'));
      candidates.push(...await this.homebrewPythonCandidates('/usr/local/opt'));
      candidates.push(...await this.versionedPythonCandidates('/Library/Frameworks/Python.framework/Versions'));
      const home=this.userHome();
      if (home) {
        for (const relative of ['miniforge3/bin/python3','miniconda3/bin/python3','anaconda3/bin/python3',
          '.local/bin/python3','.pyenv/shims/python3','.asdf/shims/python3'])
          candidates.push(PathUtils.join(home,...relative.split('/')));
        candidates.push(...await this.versionedPythonCandidates(PathUtils.join(home,'.pyenv','versions')));
      }
    }
    const paths=(Services.env.get('PATH')||'').split(Zotero.isWin ? ';' : ':').filter(Boolean);
    if (Zotero.isMac) paths.sort((a,b)=>Number(/^\/(usr\/(s?bin)|s?bin)$/.test(a))-Number(/^\/(usr\/(s?bin)|s?bin)$/.test(b)));
    for(const dir of paths) {
      if (/WindowsApps/i.test(dir)) continue;
      try { candidates.push(PathUtils.join(dir,Zotero.isWin ? 'pythonw.exe' : 'python3')); } catch (_) {}
    }
    for(const path of new Set(candidates)) if(await IOUtils.exists(path)) return path;
    const hint=Zotero.isMac ? '（macOS 常见路径：/opt/homebrew/bin/python3 或 /usr/local/bin/python3）' : '';
    throw new Error('未找到已安装的 Python。请在插件设置中填写 Python 3.10+（64 位）解释器完整路径'+hint);
  }
  async extractHelper() {
    const folder=PathUtils.join(this.data,'helper-source-'+this.version);
    const launcher=PathUtils.join(folder,'launcher.py');
    if (await IOUtils.exists(PathUtils.join(folder,'.complete'))) return launcher;
    await IOUtils.makeDirectory(folder,{ignoreExisting:true});
    const archive=PathUtils.join(folder,'helper.zip');
    await Zotero.File.download(Services.io.newURI(this.rootURI+'helper-source.zip'),archive);
    const zip=Cc['@mozilla.org/libjar/zip-reader;1'].createInstance(Ci.nsIZipReader);
    zip.open(Zotero.File.pathToFile(archive));
    try {
      const entries=zip.findEntries(null);
      let count=0;
      while (entries.hasMore()) {
        const name=entries.getNext();
        if (name.includes('..') || name.startsWith('/') || name.includes(':') || name.includes('\\'))
          throw new Error('辅助程序压缩包路径无效');
        const destination=PathUtils.join(folder,...name.split('/').filter(Boolean));
        if (zip.getEntry(name).isDirectory) {
          await IOUtils.makeDirectory(destination,{ignoreExisting:true,createAncestors:true});
        } else {
          await IOUtils.makeDirectory(PathUtils.parent(destination),{ignoreExisting:true,createAncestors:true});
          zip.extract(name,Zotero.File.pathToFile(destination));
        }
        if (++count%20===0) await Zotero.Promise.delay(0);
      }
    } finally { zip.close(); }
    await IOUtils.remove(archive);
    await IOUtils.writeUTF8(PathUtils.join(folder,'.complete'),'ready');
    return launcher;
  }
  async configure() {
    const settings={};
    for (const key of ['baseURL','concurrency','partConcurrency','dailyThreshold','autoReplace','sidecars','legacyPDFScale']) settings[key]=this.pref(key);
    settings.backupDir=this.pref('backupDir') || PathUtils.join(this.data,'backups');
    settings.token=await this.token();
    await this.request('POST','/configure',settings);
  }
  async chooseFile(win,label,extension) {
    const {FilePicker}=ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
    const picker=new FilePicker(); picker.init(win,label,picker.modeOpen);
    picker.appendFilter(label,'*.'+extension);
    return await picker.show()===picker.returnOK ? picker.file : null;
  }
  basename(path) { return PathUtils.filename(path).replace(/\.(pdf|json|md|markdown)$/i,'').toLowerCase(); }
  async matching(item,pdf,win,required,sha256) {
    if (!item.parentID) {
      if (!required) return null;
      throw new Error('请先把 PDF 放入文献条目，再合并同条目下的 MD/JSON');
    }
    const parent=Zotero.Items.get(item.parentID);
    const saved=[...this.state.jobs].reverse().find(job=>job.attachment?.id===item.id &&
      job.attachment.key===item.key && job.attachment.libraryID===item.libraryID &&
      [job.sha256,job.sourceHash,job.outputHash].includes(sha256) && job.md && job.json);
    if (saved && await IOUtils.exists(saved.md) && await IOUtils.exists(saved.json))
      return {md:saved.md,json:saved.json};
    const candidates={md:[],json:[]};
    let unavailable=false;
    const archive=await this.findArchive(item);
    const archived={md:[],json:[]};
    let archiveUnavailable=false;
    const ids=[...parent.getAttachments(),...(archive ? archive.getAttachments() : [])];
    for (const id of new Set(ids)) {
      const child=Zotero.Items.get(id); if (child.id===item.id) continue;
      if (child.deleted) continue;
      const name=child.attachmentFilename || '';
      const type=/\.(md|markdown)$/i.test(name) ? 'md' : /\.json$/i.test(name) ? 'json' : null;
      if (!type) continue;
      const path=await child.getFilePathAsync();
      if (path && await IOUtils.exists(path)) {
        candidates[type].push(path);
        if(child.parentID===archive?.id)archived[type].push(path);
      } else {
        unavailable=true;if(child.parentID===archive?.id)archiveUnavailable=true;
      }
    }
    if(archiveUnavailable)throw new Error('存档 MD/JSON 尚未下载或已丢失，请先在 Zotero 中下载附件；不会重新 OCR');
    if(archived.md.length===1 && archived.json.length===1)return {md:archived.md[0],json:archived.json[0]};
    const stem=this.basename(pdf);
    const exact=type=>candidates[type].filter(p=>this.basename(p)===stem || this.basename(p)===stem+'.ocr');
    let md=exact('md'), json=exact('json');
    if (md.length===1 && json.length===1) return {md:md[0],json:json[0]};
    if (unavailable)throw new Error('已找到 MD/JSON 附件记录，但文件尚未下载或已丢失。请先在 Zotero 中下载附件；不会改为重新 OCR');
    if (candidates.md.length===1 && candidates.json.length===1)
      return {md:candidates.md[0],json:candidates.json[0]};
    // Never guess across multiple candidate pairs. The user picks each file once.
    if (!required && !candidates.md.length && !candidates.json.length) return null;
    md=await this.chooseFile(win,'选择此 PDF 对应的 Markdown','md'); if (!md) return false;
    json=await this.chooseFile(win,'选择此 PDF 对应的定位 JSON','json'); if (!json) return false;
    return {md,json};
  }
  async copyrightJSON(item,pdf,win,sha256) {
    const saved=[...this.state.jobs].reverse().find(job=>job.attachment?.id===item.id &&
      job.attachment.key===item.key && job.attachment.libraryID===item.libraryID &&
      [job.sha256,job.sourceHash,job.outputHash].includes(sha256) && job.json);
    if (saved && await IOUtils.exists(saved.json)) return saved.json;
    const parent=Zotero.Items.get(item.parentID);
    const archive=await this.findArchive(item);
    const candidates=[]; let unavailable=false;
    for (const id of new Set([...parent.getAttachments(),...(archive ? archive.getAttachments() : [])])) {
      const child=Zotero.Items.get(id); if (child.id===item.id || child.deleted) continue;
      if (!/\.json$/i.test(child.attachmentFilename||'')) continue;
      const path=await child.getFilePathAsync();
      if (path && await IOUtils.exists(path)) candidates.push(path); else unavailable=true;
    }
    const stem=this.basename(pdf);
    const exact=candidates.filter(path=>this.basename(path)===stem || this.basename(path)===stem+'.ocr');
    if (exact.length===1) return exact[0];
    if (candidates.length===1) return candidates[0];
    if (!candidates.length) {
      if (unavailable) throw new Error('已找到 OCR JSON 附件记录，但文件尚未下载或已丢失');
      return null;
    }
    return await this.chooseFile(win,'选择此 PDF 对应的定位 JSON','json') || false;
  }
  validField(item,name) {
    try {
      const id=Zotero.ItemFields.getID(name);
      return !!id && Zotero.ItemFields.isValidForType(id,item.itemTypeID);
    } catch (_) { return false; }
  }
  applyCopyrightMetadata(parent,fields) {
    const applied=[],skipped=[];
    const values=[
      ['title','标题'],['volume','卷次'],['numberOfVolumes','总卷数'],
      ['edition','版次'],['date','出版年'],['publisher','出版社'],['place','地点']
    ];
    for (const [name,label] of values) {
      const value=String(fields[name]||'').trim(); if (!value) continue;
      if (!this.validField(parent,name)) { skipped.push(label+'（条目类型不支持）'); continue; }
      if (String(parent.getField(name)||'').trim()) { skipped.push(label+'（已有内容）'); continue; }
      parent.setField(name,value); applied.push(label);
    }
    const names=Array.isArray(fields.authors) ? fields.authors.map(v=>String(v||'').trim()).filter(Boolean) : [];
    if (names.length) {
      const authorTypeID=Zotero.CreatorTypes.getID('author');
      const creators=parent.getCreators();
      if (!authorTypeID) skipped.push('作者（条目类型不支持）');
      else if (creators.some(creator=>creator.creatorTypeID===authorTypeID)) skipped.push('作者（已有内容）');
      else {
        parent.setCreators([...creators,...names.map(lastName=>({firstName:'',lastName,fieldMode:1,creatorTypeID:authorTypeID}))]);
        applied.push('作者');
      }
    }
    return {applied,skipped};
  }
  copyrightPreview(result,parent) {
    const fields=result.fields||{};
    const rows=[['标题',fields.title],['作者',(fields.authors||[]).join('、')],
      ['卷次',fields.volume],['总卷数',fields.numberOfVolumes],['版次',fields.edition],
      ['出版年',fields.date],['出版社',fields.publisher],['地点',fields.place]]
      .filter(([,value])=>String(value||'').trim()).map(([label,value])=>label+'：'+value);
    const existing=[];
    for (const [name,label] of [['title','标题'],['volume','卷次'],['numberOfVolumes','总卷数'],
      ['edition','版次'],['date','出版年'],['publisher','出版社'],['place','地点']])
      if (String(parent.getField(name)||'').trim()) existing.push(label);
    const authorTypeID=Zotero.CreatorTypes.getID('author');
    if (parent.getCreators().some(creator=>creator.creatorTypeID===authorTypeID)) existing.push('作者');
    return '疑似版权页：PDF 第 '+result.pageNumber+' 页（来源：'+result.source+'）\n\n'+rows.join('\n')+
      '\n\n确认后只填写空字段，不覆盖已有内容。'+
      (existing.length ? '\n当前已有并将保留：'+existing.join('、') : '')+'\n\n是否写入父文献条目？';
  }
  async copyrightSelected(win) {
    const selected=this.selected(win);
    if (selected.length!==1) throw new Error('请只选择一个 PDF 附件后再识别版权页');
    const item=selected[0];
    if (!item.parentID) throw new Error('请先把 PDF 放入一个文献条目，再补全书目信息');
    const parent=Zotero.Items.get(item.parentID);
    if (!parent || parent.deleted) throw new Error('没有找到 PDF 对应的父文献条目');
    if (!Zotero.Libraries.get(item.libraryID).editable) throw new Error('此文献库不允许修改文献条目');
    const pdf=await item.getFilePathAsync();
    if (!pdf) throw new Error('PDF 尚未下载或文件已丢失');
    this.notify('正在本地读取版权页；不会提交新的 OCR 任务');
    await this.ensure();
    this.state=await this.request('GET','/jobs');
    const info=await this.request('POST','/inspect',{pdf});
    const json=await this.copyrightJSON(item,pdf,win,info.sha256);
    if (json===false) return;
    const result=await this.request('POST','/metadata/copyright',{pdf,json},120000);
    if (!Services.prompt.confirm(win,'PDF Helper',this.copyrightPreview(result,parent))) return;
    const changed=this.applyCopyrightMetadata(parent,result.fields||{});
    if (!changed.applied.length) {
      this.alert('识别结果中的字段已有内容或不适用于当前条目，因此没有修改。',win); return;
    }
    await parent.saveTx();
    this.notify('已补充：'+changed.applied.join('、')+(changed.skipped.length ? '；保留/跳过：'+changed.skipped.join('、') : ''),10000);
  }
  async submitSelected(win,mode) {
    const selected=this.selected(win);
    if (!selected.length) return;
    this.openStatus(win);
    this.showBusy('正在准备 Python 环境并读取 PDF…');
    try {
    await this.ensure();
    this.state=await this.request('GET','/jobs');
    for (const item of selected) {
      if (!item.parentID) throw new Error('请将 PDF 归入文献条目，以保存对应的 MD 和 JSON 附件');
      const library=Zotero.Libraries.get(item.libraryID);
      if (!library.editable || !library.filesEditable) throw new Error('此文献库不允许修改附件文件');
      const pdf=await item.getFilePathAsync(); if (!pdf) throw new Error('PDF 尚未下载或文件已丢失');
      this.showBusy('正在读取与核对：'+PathUtils.filename(pdf));
      const info=await this.request('POST','/inspect',{pdf});
      const pair=await this.matching(item,pdf,win,mode==='merge',info.sha256);
      if (pair===false) continue;
      let selectedMode=pair ? 'merge' : mode;
      if (selectedMode==='ocr' && !await this.token()) throw new Error('请先在 Zotero 设置 → PDF Helper 中保存 AI Studio Access Token');
      this.notify((selectedMode==='ocr' ? '预计提交 OCR：' : '复用 MD/JSON，本次 OCR 页数为 0；PDF 共 ')+info.pages+' 页');
      // Yield before the submission request so the estimate is visible first.
      await Zotero.Promise.delay(150);
      const job=await this.request('POST','/jobs',{mode:selectedMode,pdf,...(pair||{}),
        model:this.pref('model'),attachment:{id:item.id,key:item.key,libraryID:item.libraryID},parent:item.parentID},120000);
      this.pending=true;
      this.focusJobID=job.id;
      this.finalizeErrors.delete(job.id);
      if (['failed','paused','cancelled'].includes(job.state))
        this.notify('已有任务记录，请在任务窗口选择“恢复/重试”，不会另建 OCR 请求');
    }
    await this.tick();
    } finally { this.showBusy(''); }
  }
  async tick() {
    if (this.polling || !this.connection || (!this.pending && (!this.statusWindow || this.statusWindow.closed))) return;
    this.polling=true;
    try {
      this.state=await this.request('GET','/jobs');
      this.renderState();
      this.pending=this.state.jobs.some(j=>['queued','preparing','recognizing','generating','ready','committed','committing'].includes(j.state));
      let finalized=false;
      for (const job of this.state.jobs) {
        if (['ready','committed'].includes(job.state) && !this.finalizeErrors.has(job.id)) {
          try { await this.finalize(job); finalized=true; }
          catch (e) { this.finalizeErrors.set(job.id,e.message); this.notify('任务需处理：'+e.message); }
        }
      }
      if (finalized) this.state=await this.request('GET','/jobs');
      this.renderState();
    } finally { this.polling=false; }
  }
  async persistReceipts() {
    await IOUtils.writeJSON(this.receiptsPath,this.receipts,{tmpPath:this.receiptsPath+'.tmp'});
  }
  async findArchive(item,create=false) {
    const marker='PDFRepair-Source: '+item.key;
    const find=async()=>{
      const search=new Zotero.Search(); search.libraryID=item.libraryID;
      search.addCondition('itemType','is','document');
      search.addCondition('extra','contains',marker);
      for (const id of await search.search()) {
        const archive=await Zotero.Items.getAsync(id);
        if (archive && !archive.deleted && archive.getField('extra').split(/\r?\n/).includes(marker)) return archive;
      }
      return null;
    };
    if (!create) return find();
    return Zotero.DB.executeTransaction(async()=>{
      let archive=await find(); if (archive) return archive;
      const parent=Zotero.Items.get(item.parentID);
      if (!parent || parent.deleted) throw new Error('原文献条目已删除，无法建立存档');
      let collection=Zotero.Collections.getByLibrary(item.libraryID).find(c=>c.name==='PDF Repair 识别存档' && !c.deleted);
      if (!collection) {
        collection=new Zotero.Collection(); collection.libraryID=item.libraryID;
        collection.name='PDF Repair 识别存档'; await collection.save();
      }
      archive=new Zotero.Item('document'); archive.libraryID=item.libraryID;
      archive.setField('title','PDF Repair 识别资料 · '+item.attachmentFilename.replace(/\.pdf$/i,''));
      archive.setField('extra',marker+'\n原 PDF：'+item.attachmentFilename);
      archive.setCollections([collection.id]); await archive.save();
      archive.addRelatedItem(parent); await archive.save();
      parent.addRelatedItem(archive); await parent.save();
      return archive;
    });
  }
  async ensureSidecars(job,item,mode=job.sidecars) {
    const key=item.libraryID+':'+item.key;
    const previous=this.storageLocks.get(key) || Promise.resolve();
    const action=previous.catch(()=>{}).then(()=>this._ensureSidecars(job,item,mode));
    this.storageLocks.set(key,action);
    try { return await action; } finally { if(this.storageLocks.get(key)===action)this.storageLocks.delete(key); }
  }
  async _ensureSidecars(job,item,mode) {
    if (!['archive','hidden','import','link'].includes(mode)) throw new Error('识别结果保存方式无效');
    const receipt=this.receipts[job.id] ||= {};
    if (!await IOUtils.exists(job.md) || !await IOUtils.exists(job.json)) throw new Error('任务结果尚未就绪或已被移除');
    if (mode==='hidden') {
      receipt.storage='hidden'; await this.persistReceipts(); return;
    }
    const original=Zotero.Items.get(item.parentID);
    if (!original || original.deleted) throw new Error('原 PDF 所属文献条目已被删除；未替换');
    const parent=mode==='archive' ? await this.findArchive(item,true) : original;
    const otherArchive=mode==='archive' ? parent : await this.findArchive(item);
    for (const type of ['md','json']) {
      const title=PathUtils.filename(job.target).replace(/\.pdf$/i,'')+'.ocr.'+type;
      const hash=await Zotero.Utilities.Internal.md5Async(job[type]);
      let found;
      const ids=[receipt[type],...parent.getAttachments(),...original.getAttachments(),...(otherArchive ? otherArchive.getAttachments() : [])].filter(Boolean);
      for (const id of new Set(ids)) {
        const existing=Zotero.Items.get(id);
        if (!existing || existing.deleted || existing.libraryID!==item.libraryID ||
            ![parent.id,original.id,otherArchive?.id].includes(existing.parentID)) continue;
        const path=await existing.getFilePathAsync();
        if (!path || !await IOUtils.exists(path) || !new RegExp('\\.'+type+'$','i').test(path)) continue;
        if (await Zotero.Utilities.Internal.md5Async(path)===hash) { found=existing; break; }
      }
      if (found && mode!=='link' && found.isLinkedFileAttachment())
        throw new Error('现有 MD/JSON 是链接附件；请先在 Zotero 中转为存储附件，才能收纳并同步文件。原文件未删除');
      if (found && found.parentID!==parent.id) {
        // Reparent only the exact hash-matched MD/JSON; identity and file stay intact.
        found.parentID=parent.id; await found.saveTx();
      }
      if (!found) {
        // A deterministic title/filename also recovers a crash between attachment save and receipt.
        const staging=PathUtils.join(this.data,'sidecars',job.id);
        await IOUtils.makeDirectory(staging,{ignoreExisting:true,createAncestors:true});
        const file=PathUtils.join(staging,title);
        await IOUtils.copy(job[type],file);
        found=await Zotero.Attachments[mode==='link' ? 'linkFromFile' : 'importFromFile']({
          file,parentItemID:parent.id,libraryID:item.libraryID,title,
          contentType:type==='md' ? 'text/markdown' : 'application/json'});
      }
      receipt[type]=found.id; await this.persistReceipts();
    }
    receipt.storage=mode; receipt.archiveID=mode==='archive' ? parent.id : null;
    await this.persistReceipts();
  }
  async organizeSidecars(job) {
    if (!['done','retained'].includes(job.state)) throw new Error('请等任务完成后再收纳，避免与正在保存的任务冲突');
    const item=Zotero.Items.get(job.attachment?.id);
    if (!item || item.deleted || item.key!==job.attachment.key || item.libraryID!==job.attachment.libraryID || item.parentID!==job.parent)
      throw new Error('原附件或文献身份已变化，未收纳');
    const library=Zotero.Libraries.get(item.libraryID);
    if (!library.editable || !library.filesEditable) throw new Error('当前文献库不允许修改附件');
    const mode=this.pref('sidecars');
    if (mode==='hidden') throw new Error('本地隐藏模式仅控制后续保存，已有附件保持原样；要移走现有 MD/JSON，请选“独立存档条目”');
    await this.ensureSidecars(job,item,mode);
    this.notify('MD/JSON 已按当前设置收纳；PDF 未重新转换',10000); this.renderState();
  }
  resultFolder(job) { return PathUtils.parent(job.json); }
  async showArchive(job) {
    const item=Zotero.Items.get(job.attachment?.id);
    if (!item || item.key!==job.attachment.key || item.libraryID!==job.attachment.libraryID) throw new Error('原 PDF 附件不存在或身份已变化');
    const archive=await this.findArchive(item);
    if (!archive) throw new Error('尚未建立独立存档；请在设置中选择独立存档方式后收纳');
    const win=Zotero.getMainWindow();win.focus();await win.ZoteroPane.selectItem(archive.id);
  }
  openQuota() { Zotero.launchURL('https://aistudio.baidu.com/paddleocr/task'); }
  openQuotaRules() { Zotero.launchURL('https://ai.baidu.com/ai-doc/AISTUDIO/Xmjclapam'); }
  async closeReaders(item) {
    const readers=(Zotero.Reader._readers || []).filter(r=>r.itemID===item.id);
    let reopen=readers.length>0;
    for (const reader of readers) {
      if (reader._flushState) await reader._flushState();
      reader.close();
    }
    if (reopen) await Zotero.Promise.delay(400);
    return reopen;
  }
  async updateAttachment(item) {
    if (item.attachmentLinkMode===Zotero.Attachments.LINK_MODE_IMPORTED_FILE ||
        item.attachmentLinkMode===Zotero.Attachments.LINK_MODE_IMPORTED_URL) {
      item.attachmentSyncState=Zotero.Sync.Storage.Local.SYNC_STATE_TO_UPLOAD;
    }
    await item.saveTx();
    await Zotero.Notifier.trigger('refresh','item',[item.id]);
    try { await Zotero.FullText.indexItems([item.id],{ignoreErrors:false}); return true; }
    catch (_) { this.notify('PDF 已保存；Zotero 全文索引稍后可重建'); return false; }
  }
  async finalize(job) {
    if (this.finalizing.has(job.id)) return;
    this.finalizing.add(job.id);
    let reopen=false, item;
    try {
      item=Zotero.Items.get(job.attachment?.id);
      if (!item || item.key!==job.attachment.key || item.libraryID!==job.attachment.libraryID || item.deleted)
        throw new Error('原附件身份已变化；结果保留在任务目录');
      if (await item.getFilePathAsync()!==job.target || item.parentID!==job.parent)
        throw new Error('原附件路径或文献关联已变化；未自动替换');
      const library=Zotero.Libraries.get(item.libraryID);
      if (!library.editable || !library.filesEditable) throw new Error('文献库当前不允许修改文件，已保留结果');
      if (job.state==='ready') {
        this.finalizePhase.set(job.id,'sidecars'); this.renderState();
        await this.ensureSidecars(job,item);
        if (!job.autoReplace) {
          await this.request('POST','/jobs/'+job.id+'/commit',{retain:true});
          this.notify('可检索 PDF 已生成，自动替换已关闭，可在任务窗口打开结果'); return;
        }
        reopen=await this.closeReaders(item);
        this.finalizePhase.set(job.id,'applying'); this.renderState();
        await this.request('POST','/jobs/'+job.id+'/commit',{});
      }
      this.finalizePhase.set(job.id,'indexing'); this.renderState();
      const indexed=await this.updateAttachment(item);
      await this.request('POST','/jobs/'+job.id+'/ack',{indexed});
      this.notify('已完成：'+PathUtils.filename(job.target)+'；原 PDF 已备份',12000);
    } finally {
      this.finalizing.delete(job.id);
      this.finalizePhase.delete(job.id);
      if (reopen && item) await Zotero.Reader.open(item.id);
    }
  }
  async restoreSelected(win) {
    this.openStatus(win); this.showBusy('正在校验备份并恢复原始 PDF…');
    try {
    await this.ensure();
    for (const item of this.selected(win)) {
      const reopen=await this.closeReaders(item);
      try {
        await this.request('POST','/restore',{pdf:await item.getFilePathAsync()});
        await this.updateAttachment(item); this.notify('原始 PDF 已恢复，识别结果仍保留');
      } finally { if (reopen) await Zotero.Reader.open(item.id); }
    }
    this.state=await this.request('GET','/jobs'); this.renderState();
    } finally { this.showBusy(''); }
  }
  openStatus(win=Zotero.getMainWindow()) {
    if (this.statusWindow && !this.statusWindow.closed) { this.statusWindow.focus(); return; }
    this.statusWindow=win.openDialog('chrome://paddleocrrepair/content/status.xhtml','paddleocrrepair-status',
      'chrome,dialog=no,resizable,centerscreen,width=1050,height=680',{repair:this});
  }
  async jobAction(id,action,body={}) {
    await this.ensure();
    this.finalizeErrors.delete(id);
    await this.request('POST','/jobs/'+id+'/'+action,body);
    this.pending=true; await this.tick();
  }
  async showPreferences() { Zotero.Utilities.Internal.openPreferences('paddleocrrepair-preferences'); }
  openPath(path) { Zotero.launchFile(Zotero.File.pathToFile(path)); }
};
