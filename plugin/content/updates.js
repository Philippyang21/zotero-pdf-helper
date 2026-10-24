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
  function releaseURL(value,config,version) {
    const url=httpsURL(value);
    // Pin both the repository and the advertised version, never /latest or an asset.
    const expected=config.repositoryUrl+'/releases/tag/v'+version;
    if (value !== expected || url.href !== expected) fail('release-url');
    return url.href;
  }
  function validateConfig(config) {
    if (!record(config) || config.schemaVersion !== 4) fail('config');
    if (!config.repositoryUrl || !config.latestReleaseUrl) fail('not-configured');
    const repo=httpsURL(config.repositoryUrl),source=httpsURL(config.latestReleaseUrl);
    if (repo.hostname !== 'github.com' || !/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repo.pathname)) fail('config');
    if (config.latestReleaseUrl !== config.repositoryUrl+'/releases/latest' ||
        source.href !== config.latestReleaseUrl) fail('source-url');
    if (typeof config.assetNamePrefix!=='string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(config.assetNamePrefix)) fail('config');
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 30000 ||
        !Number.isInteger(config.maxResponseBytes) || config.maxResponseBytes < 1024 || config.maxResponseBytes > 65536) fail('config');
    if (repo.href !== config.repositoryUrl) fail('config');
    return Object.freeze({...config,latestReleaseUrl:source.href});
  }
  function validateManifest(data,config,addonId,compareZotero,{allowUnpublished=false}={}) {
    if (!record(data) || data.schemaVersion !== 2 ||
        (data.published !== true && !(allowUnpublished && data.published === false)) ||
        !addonId || data.addonId !== addonId) fail('manifest');
    const version=semver(data.latestVersion);
    // The single feed is a stable channel. A prerelease must never be advertised here.
    if (version.pre.length) fail('prerelease');
    if (typeof data.minZoteroVersion !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(data.minZoteroVersion) ||
        data.minZoteroVersion.length > 32) fail('compatibility');
    if (data.maxZoteroVersion !== null && (typeof data.maxZoteroVersion !== 'string' ||
        !/^\d+(?:\.\d+){0,3}(?:\.\*)?$/.test(data.maxZoteroVersion) || data.maxZoteroVersion.length > 32)) fail('compatibility');
    if (data.maxZoteroVersion !== null && compareZotero(data.minZoteroVersion,data.maxZoteroVersion) > 0) fail('compatibility');
    if (typeof data.releaseNotes !== 'string' || data.releaseNotes.length > 12000) fail('manifest');
    const releaseUrl=releaseURL(data.releaseUrl,config,data.latestVersion);
    return Object.freeze({latestVersion:data.latestVersion,minZoteroVersion:data.minZoteroVersion,
      maxZoteroVersion:data.maxZoteroVersion,releaseNotes:data.releaseNotes,releaseUrl});
  }
  function httpError(error) {
    const status=error?.status || error?.xmlhttp?.status;
    if(status===403 || status===429)fail('rate-limit');
    if(status===404)fail('release-missing');
    throw error;
  }
  async function requestJSON(http,config,receiveCancel,url) {
    let tooLarge=false;
    const response=await http.request('GET',url,{
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
    }).catch(httpError);
    if (tooLarge) fail('response-size');
    if (response.status !== 200 || response.responseURL !== url) fail('response');
    const text=response.responseText;
    const Encoder=typeof TextEncoder==='function' ? TextEncoder : webWindow().TextEncoder;
    if (typeof text !== 'string' || new Encoder().encode(text).byteLength > config.maxResponseBytes) fail('response-size');
    try { return JSON.parse(text); } catch (_) { fail('json'); }
  }
  async function requestHead(http,config,receiveCancel,url,successCodes) {
    const response=await http.request('HEAD',url,{
      anon:true,noCache:true,followRedirects:false,timeout:config.timeoutMs,
      responseType:'text',successCodes,errorDelayMax:0,cancellerReceiver:receiveCancel
    }).catch(httpError);
    // Zotero's no-follow redirect response only exposes status and header access.
    if (!successCodes.includes(response.status) || (response.responseURL && response.responseURL!==url)) fail('response');
    return response;
  }
  async function requestManifest(http,config,receiveCancel) {
    // Official /releases/latest HEAD avoids the anonymous REST API quota.
    // Never follow redirects or fetch HTML/XPI bodies; cancellation covers all stages.
    let stopped=false,activeCancel=null;
    receiveCancel(()=>{stopped=true;activeCancel?.();});
    const receive=fn=>{activeCancel=fn;if(stopped)fn();};
    const latest=await requestHead(http,config,receive,config.latestReleaseUrl,[301,302,307,308]);
    if(stopped)fail('closed');
    const location=latest.getResponseHeader('Location'),prefix=config.repositoryUrl+'/releases/tag/v';
    if(typeof location!=='string' || !location.startsWith(prefix))fail('release-url');
    const version=location.slice(prefix.length);
    if(semver(version).pre.length)fail('prerelease');
    const target=releaseURL(location,config,version),tag='v'+version;
    if(stopped)fail('closed');
    const metadataUrl=config.repositoryUrl.replace('https://github.com/','https://raw.githubusercontent.com/')+'/'+tag+'/plugin/manifest.json';
    const metadata=await requestJSON(http,config,receive,metadataUrl);
    if(stopped)fail('closed');
    if (!record(metadata) || metadata.manifest_version!==2 || metadata.version!==version ||
        !record(metadata.applications?.zotero)) fail('release-metadata');
    const zotero=metadata.applications.zotero;
    const assetUrl=config.repositoryUrl+'/releases/download/'+tag+'/'+config.assetNamePrefix+'-'+version+'.xpi';
    await requestHead(http,config,receive,assetUrl,[200,302]);
    if(stopped)fail('closed');
    return {schemaVersion:2,published:true,addonId:zotero.id,latestVersion:version,
      minZoteroVersion:zotero.strict_min_version,maxZoteroVersion:zotero.strict_max_version,
      releaseNotes:'GitHub 已发布 v'+version+'。完整更新说明请查看对应版本发布页；在 Assets 中下载 .xpi 后手动安装。',releaseUrl:target};
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
          const comparison=compareVersions(manifest.latestVersion,current),newer=comparison>0;
          const compatible=deps.compareZotero(zotero,manifest.minZoteroVersion)>=0 &&
            (manifest.maxZoteroVersion===null || deps.compareZotero(zotero,manifest.maxZoteroVersion)<=0);
          last=Object.freeze({state:!newer?'current':compatible?'available':'incompatible',isAhead:comparison<0,currentVersion:current,zoteroVersion:zotero,...manifest});
          return last;
        })().finally(()=>{flight=null;cancel=null;});
        return flight;
      },
      async openRelease(result) {
        if (closed || result !== last || result?.state !== 'available') fail('stale-result');
        const config=validateConfig(await deps.loadConfig());
        releaseURL(result.releaseUrl,config,result.latestVersion);
        if (closed || result !== last) fail('stale-result');
        if (!await deps.confirm(result)) return false;
        if (closed || result !== last) fail('stale-result');
        await deps.openURL(result.releaseUrl);
        return true;
      },
      dispose() { closed=true;last=null;cancel?.(); }
    };
  }
  function forZotero(app,host={Zotero,Services}) {
    return createClient({
      addonId:app.id,currentVersion:()=>app.version,zoteroVersion:()=>host.Zotero.version,
      // The async File helper uses HTTP, whose URI parser rejects jar: usernames.
      // This is a small packaged local file; use the host's jar-capable file reader.
      loadConfig:async()=>JSON.parse(host.Zotero.File.getContentsFromURL(app.rootURI+'update-config.json')),
      compareZotero:(a,b)=>host.Services.vc.compare(a,b),
      request:(config,receiveCancel)=>requestManifest(host.Zotero.HTTP,config,receiveCancel),
      confirm:result=>host.Services.prompt.confirm(host.Zotero.getMainWindow(),'检查更新',
        '前往 GitHub 版本发布页下载 v'+result.latestVersion+'？\n\n'+result.releaseUrl+'\n\n请在 Assets 中下载 .xpi，然后在 Zotero 的插件管理器中手动安装。'),
      openURL:url=>host.Zotero.launchURL(url)
    });
  }
  return {UpdateError,compareVersions,validateConfig,validateManifest,requestJSON,requestHead,requestManifest,createClient,forZotero};
})();
if (typeof module !== 'undefined' && module.exports) module.exports=POCRUpdates;
