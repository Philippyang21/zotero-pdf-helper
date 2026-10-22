/* global Zotero, Services */
'use strict';
// Independent of the OCR helper, preferences and library. Loading does no I/O.
var POCRUpdates = (() => {
  class UpdateError extends Error {
    constructor(code) { super(code); this.code = code; }
  }
  const fail = code => { throw new UpdateError(code); };
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  // Bootstrap subscript scopes need not expose DOM constructors as globals.
  const webWindow = () => Zotero.getMainWindow() || Services.appShell.hiddenDOMWindow;
  function semver(value) {
    if (typeof value !== 'string' || value.length > 128) fail('version');
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
    if (!match) fail('version');
    const pre = match[4] ? match[4].split('.') : [];
    if (pre.some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) fail('version');
    return {parts:match.slice(1,4), pre};
  }
  function numberCompare(a,b) {
    return a.length === b.length ? (a === b ? 0 : a < b ? -1 : 1) : a.length < b.length ? -1 : 1;
  }
  function compareVersions(a,b) {
    a = semver(a); b = semver(b);
    for (let i=0;i<3;i++) { const diff=numberCompare(a.parts[i],b.parts[i]); if(diff) return diff; }
    if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
    for (let i=0;i<Math.max(a.pre.length,b.pre.length);i++) {
      if (a.pre[i] === undefined || b.pre[i] === undefined) return a.pre[i] === undefined ? -1 : 1;
      const x=a.pre[i],y=b.pre[i]; if(x===y) continue;
      const xn=/^\d+$/.test(x),yn=/^\d+$/.test(y);
      return xn && yn ? numberCompare(x,y) : xn !== yn ? (xn ? -1 : 1) : x < y ? -1 : 1;
    }
    return 0;
  }
  function httpsURL(value) {
    if (typeof value !== 'string' || value.length > 2048 || value.trim() !== value || /[\s\\]/.test(value)) fail('url');
    let url; try { const URLClass=typeof URL==='function' ? URL : webWindow().URL; url=new URLClass(value); } catch (_) { fail('url'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) fail('url');
    return url;
  }
  function communityURL(value,config) {
    const url=httpsURL(value);
    if (!config.allowedCommunityHosts.includes(url.hostname) ||
        !/^\/(?:plugins|user-guide\/plugins)\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(url.pathname)) fail('community-url');
    return url.href;
  }
  function validateConfig(config) {
    if (!record(config) || config.schemaVersion !== 1) fail('config');
    if (!config.repositoryUrl || !config.manifestUrl || !config.communityUrl) fail('not-configured');
    if (!Array.isArray(config.allowedManifestHosts) || !Array.isArray(config.allowedCommunityHosts) ||
        config.allowedManifestHosts.length !== 1 || config.allowedManifestHosts[0] !== 'raw.githubusercontent.com' ||
        config.allowedCommunityHosts.length !== 1 || config.allowedCommunityHosts[0] !== 'zotero-chinese.com') fail('config');
    const repo=httpsURL(config.repositoryUrl),source=httpsURL(config.manifestUrl);
    if (repo.hostname !== 'github.com' || !/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repo.pathname)) fail('config');
    if (!config.allowedManifestHosts.includes(source.hostname) ||
        !source.pathname.startsWith(repo.pathname+'/') || !source.pathname.endsWith('.json') ||
        source.pathname.slice(repo.pathname.length+1).split('/').length < 2) fail('source-url');
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 30000 ||
        !Number.isInteger(config.maxResponseBytes) || config.maxResponseBytes < 1024 || config.maxResponseBytes > 65536) fail('config');
    return Object.freeze({...config,manifestUrl:source.href,communityUrl:communityURL(config.communityUrl,config)});
  }
  function validateManifest(data,config,addonId,compareZotero) {
    if (!record(data) || data.schemaVersion !== 1 || data.published !== true || !addonId || data.addonId !== addonId) fail('manifest');
    const version=semver(data.latestVersion);
    // The single feed is a stable channel. A prerelease must never be advertised here.
    if (version.pre.length) fail('prerelease');
    if (typeof data.minZoteroVersion !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(data.minZoteroVersion) ||
        data.minZoteroVersion.length > 32) fail('compatibility');
    if (data.maxZoteroVersion !== null && (typeof data.maxZoteroVersion !== 'string' ||
        !/^\d+(?:\.\d+){0,3}(?:\.\*)?$/.test(data.maxZoteroVersion) || data.maxZoteroVersion.length > 32)) fail('compatibility');
    if (data.maxZoteroVersion !== null && compareZotero(data.minZoteroVersion,data.maxZoteroVersion) > 0) fail('compatibility');
    if (typeof data.releaseNotes !== 'string' || data.releaseNotes.length > 12000) fail('manifest');
    if (communityURL(data.communityUrl,config) !== config.communityUrl) fail('community-url');
    return Object.freeze({latestVersion:data.latestVersion,minZoteroVersion:data.minZoteroVersion,
      maxZoteroVersion:data.maxZoteroVersion,releaseNotes:data.releaseNotes,communityUrl:config.communityUrl});
  }
  async function requestManifest(http,config,receiveCancel) {
    let tooLarge=false;
    const response=await http.request('GET',config.manifestUrl,{
      headers:{Accept:'application/json'},responseType:'text',timeout:config.timeoutMs,
      anon:true,noCache:true,followRedirects:false,successCodes:[200],errorDelayMax:0,
      cancellerReceiver:receiveCancel,
      requestObserver(xhr) {
        const stop=()=>{tooLarge=true;xhr.abort();};
        xhr.addEventListener('readystatechange',()=>{
          if (xhr.readyState === 2 && Number(xhr.getResponseHeader('Content-Length')) > config.maxResponseBytes) stop();
        });
        xhr.addEventListener('progress',event=>{if(event.loaded > config.maxResponseBytes) stop();});
      }
    });
    if (tooLarge) fail('response-size');
    if (response.status !== 200 || response.responseURL !== config.manifestUrl) fail('response');
    const text=response.responseText;
    const Encoder=typeof TextEncoder==='function' ? TextEncoder : webWindow().TextEncoder;
    if (typeof text !== 'string' || new Encoder().encode(text).byteLength > config.maxResponseBytes) fail('response-size');
    try { return JSON.parse(text); } catch (_) { fail('json'); }
  }
  function createClient(deps) {
    let flight=null,cancel=null,last=null,closed=false;
    return {
      check() {
        if (closed) return Promise.reject(new UpdateError('closed'));
        if (flight) return flight;
        last=null;
        flight=(async()=>{
          const current=deps.currentVersion(); semver(current);
          const config=validateConfig(await deps.loadConfig());
          const zotero=deps.zoteroVersion();
          if (typeof zotero !== 'string' || !/^\d+(?:\.\d+){1,3}(?:(?:a|b|pre|rc)\d*)?$/.test(zotero)) fail('compatibility');
          if(closed) fail('closed');
          const data=await deps.request(config,fn=>{cancel=fn;if(closed)fn();});
          if(closed) fail('closed');
          const manifest=validateManifest(data,config,deps.addonId,deps.compareZotero);
          const newer=compareVersions(manifest.latestVersion,current)>0;
          const compatible=deps.compareZotero(zotero,manifest.minZoteroVersion)>=0 &&
            (manifest.maxZoteroVersion===null || deps.compareZotero(zotero,manifest.maxZoteroVersion)<=0);
          last=Object.freeze({state:!newer?'current':compatible?'available':'incompatible',currentVersion:current,zoteroVersion:zotero,...manifest});
          return last;
        })().finally(()=>{flight=null;cancel=null;});
        return flight;
      },
      async openCommunity(result) {
        if (closed || result !== last || result?.state !== 'available') fail('stale-result');
        const config=validateConfig(await deps.loadConfig());
        if (result.communityUrl !== config.communityUrl) fail('community-url');
        if (closed || result !== last) fail('stale-result');
        if (!await deps.confirm(result)) return false;
        if (closed || result !== last) fail('stale-result');
        await deps.openURL(config.communityUrl);
        return true;
      },
      dispose() { closed=true;last=null;cancel?.(); }
    };
  }
  function forZotero(app,host={Zotero,Services}) {
    return createClient({
      addonId:app.id,currentVersion:()=>app.version,zoteroVersion:()=>host.Zotero.version,
      loadConfig:async()=>JSON.parse(await host.Zotero.File.getContentsFromURLAsync(app.rootURI+'update-config.json')),
      compareZotero:(a,b)=>host.Services.vc.compare(a,b),
      request:(config,receiveCancel)=>requestManifest(host.Zotero.HTTP,config,receiveCancel),
      confirm:result=>host.Services.prompt.confirm(host.Zotero.getMainWindow(),'检查更新',
        '前往 Zotero 中文社区下载 v'+result.latestVersion+'？\n\n'+result.communityUrl+'\n\n下载 .xpi 后，请在 Zotero 的插件管理器中手动安装。'),
      openURL:url=>host.Zotero.launchURL(url)
    });
  }
  return {UpdateError,compareVersions,validateConfig,validateManifest,requestManifest,createClient,forZotero};
})();
if (typeof module !== 'undefined' && module.exports) module.exports=POCRUpdates;
