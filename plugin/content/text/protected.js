'use strict';
// Original rules, not copied from external formatters. Tokens never contain punctuation or spaces.
AcademicText.protect = text=>{
  let prefix='\uE000\uE001';
  while(text.includes(prefix))prefix+='\uE002';
  const values=[],blocks=[];
  const token=(value,block=false)=>{
    const key=prefix+values.length.toString(36)+'\uE003';
    values.push([key,value]);if(block)blocks.push(key);return key;
  };
  const cover=(pattern,block=false)=>{text=text.replace(pattern,value=>token(value,block));};
  // Code and explicit markup are protected before Unicode/whitespace transformations.
  cover(/(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?\1/g,true);
  cover(/^[ \t]*(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*$/gm,true);
  cover(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,true);
  cover(/(`+)[^`\r\n]+?\1/g);
  cover(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g,true);
  cover(/\$[^$\r\n]+\$|\\\([^\r\n]*?\\\)/g);
  cover(/!?\[[^\]\r\n]*\]\((?:[^()\r\n]|\([^()\r\n]*\))*\)/g);
  cover(/^ {0,3}\[[^\]\r\n]+\]:[^\r\n]+$/gm,true);
  cover(/^[ \t]*(?:\d+[.)、]|[一二三四五六七八九十]+[、.)])(?=[ \t])/gm,true);
  cover(/<\/?[A-Za-z][^<>]*>/g);
  function trimEnd(value){
    let end=value.length;
    while(end&&/[.,;，。；：！？、…]/.test(value[end-1]))end--;
    for(const [open,close] of [['(',')'],['[',']'],['{','}']]){
      const s=value.slice(0,end);
      if(s.endsWith(close)&&s.split(close).length>s.split(open).length)end--;
    }
    return [value.slice(0,end),value.slice(end)];
  }
  text=text.replace(/\b(?:https?|ftp):\/\/[^\s<>"“”‘’]+/gi,value=>{
    const [main,tail]=trimEnd(value);return token(main)+tail;
  });
  text=text.replace(/\b(?:DOI\s*[:：]\s*)?10\.\d{4,9}\/[A-Za-z0-9._;()/:+\-]+/gi,value=>{
    const [main,tail]=trimEnd(value);return token(main)+tail;
  });
  cover(/\b[A-Za-z0-9.!#$%&'*+\/?^_`{|}~\-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g);
  // Paths may be quoted to include spaces; ordinary prose is not treated as a path.
  cover(/"(?:[A-Za-z]:[\\/]|\\\\|\.?\.?\/|~\/)[^"\r\n]*"/g);
  cover(/\b[A-Za-z]:[\\/][^\s<>"“”]+|\\\\[^\s<>"“”]+/g);
  cover(/(?<![\p{L}\p{N}])(?:~?\/|\.{1,2}\/)[\w.\-]+(?:[\\/][^\s<>"“”]*)*/gu);
  cover(/\b[\w-]+\.(?:pdf|json|md|txt|docx?|tex|csv|xlsx?|png|jpe?g|py|js|ts)\b/gi);
  cover(/\b(?:ISBN(?:-1[03])?|ISSN)[ \t]*[:：]?[ \t]*[0-9Xx][0-9Xx -]{6,25}[0-9Xx]\b/gi);
  cover(/\b(?:97[89][- ]?)?\d[-\d ]{7,15}[\dXx]\b/g);
  // Protect the whole English reference before its page-number subranges.
  cover(/\b[A-Z][A-Za-z'’-]+(?:[ \t]+et[ \t]+al\.)?,[ \t]*\d{4}[a-z]?(?:,[ \t]*(?:pp?|vol|no)\.[ \t]*\d+(?:[-–]\d+)?)*\.?/g);
  cover(/\b(?:pp?\.[ \t]*)?\d+(?:[ \t]*[-–—][ \t]*\d+)+\b\.?/gi);
  cover(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g);
  cover(/\b(?:pp?|vol|no)\.[ \t]*\d+(?:[-–]\d+)?\.?/gi);
  cover(/\b[A-Z]\.(?=[ \t]+[A-Z])/g);
  cover(/\.{2,}/g);
  cover(/\b(?:v(?:ersion)?[ \t]*)?\d+(?:\.\d+)+(?:[A-Za-z0-9+\-]*)?\b/gi);
  cover(/\b(?:[A-Za-z]\.){2,}|\b(?:Mr|Mrs|Ms|Dr|Prof|etc|vol|ed|eds)\.(?=\s|$)/g);
  const pattern=new RegExp(prefix+'[0-9a-z]+\uE003','g');
  const map=new Map(values);
  const restore=value=>{
    // A path or Markdown link may contain an already protected code span.
    for(let n=0;n<=values.length&&value.includes(prefix);n++){
      const previous=value;value=value.replace(pattern,key=>map.get(key)??key);
      if(value===previous)break;
    }
    return value;
  };
  return {text,restore,
    isBlock:line=>blocks.some(key=>line.includes(key))};
};
