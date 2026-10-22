'use strict';
(()=>{
  AcademicText.normalizeLetters=text=>text.replace(/[Ａ-Ｚａ-ｚ０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0));
  AcademicText.spaces=(text,options)=>{
    // Match original PDF spaces in one pass, before collapseSpaces can turn them into ASCII.
    // Zero-width separators are removed only between Han characters, never inside other scripts/code.
    if(options.removeChineseSpaces)text=text.replace(/(?<=[\p{Script=Han}\u3007])[\p{Zs}\t\u200B\uFEFF]+(?=[\p{Script=Han}\u3007])/gu,'');
    if(options.collapseSpaces)text=text.split('\n').map(line=>{
      const indent=options.keepParagraphs ? (line.match(/^(?: {2,}|\t+)/)?.[0]||'') : '';
      return indent+line.slice(indent.length).replace(/[^\S\n]+/g,' ');
    }).join('\n');
    if(options.mixedSpaces)text=text.replace(/([\p{Script=Han}\u3007])([A-Za-z0-9])/gu,'$1 $2')
      .replace(/([A-Za-z0-9])([\p{Script=Han}\u3007])/gu,'$1 $2');
    return text;
  };
  AcademicText.punctuationSpaces=text=>text
    .replace(/[\p{Zs}\t]+([,.;:!?，。；：！？、）”’」』])/gu,'$1')
    .replace(/([（“‘「『])[\p{Zs}\t]+/gu,'$1')
    .replace(/(?<=[\p{Script=Han}\u3007，。；：！？、”’）」』])[\p{Zs}\t]+(?=[（“‘「『])/gu,'')
    .replace(/([，。；：！？、”’）」』])[\p{Zs}\t]+(?=[\p{Script=Han}\u3007“‘（「『])/gu,'$1')
    .replace(/([,;:!?])[\p{Zs}\t]*(?=[^\s\n,;:!?）)\]}>。，；：！？])/gu,'$1 ')
    .replace(/(?<=[A-Za-z])\.(?=[A-Za-z0-9])/g,'. ')
    .replace(/\([ \t]+/g,'(').replace(/[ \t]+\)/g,')');
})();
