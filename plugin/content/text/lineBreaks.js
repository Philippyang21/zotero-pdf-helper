'use strict';
(()=>{
  // A small conservative vocabulary: unknown printed hyphens remain visible for human review.
  const words=new Set(('literature literary information international important modernity research '+
    'historical history scholarship academic criticism critical collection contemporary development '+
    'representation interpretation investigation publication education introduction conclusion '+
    'communication traditional tradition theoretical theory analysis discussion methodology '+
    'understanding organization organisation').split(' '));
  AcademicText.fixHyphens=text=>text.replace(/([A-Za-z]+)([-\u00AD])[ \t]*\n[ \t]*([a-z]+)/g,
    (raw,left,hyphen,right)=>hyphen==='\u00AD'||words.has((left+right).toLowerCase()) ? left+right : raw);
  const han=/[\p{Script=Han}\u3007]/u;
  const structured=line=>/^[ \t]*(?:#{1,6}\s|[-*+•]\s|\d+[.)、]\s*|[一二三四五六七八九十]+[、.)]|第[一二三四五六七八九十百\d]+[章节]|[>|])/.test(line);
  AcademicText.fixLineBreaks=(text,options,guard)=>{
    const lines=text.split('\n');let result=lines[0]||'';
    for(let n=1;n<lines.length;n++){
      const previous=lines[n-1],next=lines[n],left=result.trimEnd(),right=next.trimStart();
      const blank=!previous.trim()||!right;
      const structural=structured(previous)||structured(next)||guard.isBlock(previous)||guard.isBlock(next);
      const indent=options.keepParagraphs&&/^(?: {2,}|\t)/.test(next);
      const sentence=options.keepParagraphs&&/[。！？.!?][”’"')）\]]?$/.test(previous.trim());
      const uncertainHyphen=/[A-Za-z]-$/.test(left)&&/^[a-z]/.test(right);
      if(structural||indent||sentence||uncertainHyphen||(blank&&options.keepParagraphs)){
        result+='\n'+next;continue;
      }
      if(blank){result=left+(right ? ' '+right : '');continue;}
      const a=Array.from(left).pop()||'',b=Array.from(right)[0]||'';
      const noSpace=(han.test(a)&&han.test(b))||(/[，、；：（“‘]/.test(a)&&han.test(b))||
        (han.test(a)&&/[，。！？、；：）”’]/.test(b));
      result=left+(noSpace ? '' : ' ')+right;
    }
    return result.replace(/\n(?:[ \t]*\n){2,}/g,'\n\n');
  };
})();
