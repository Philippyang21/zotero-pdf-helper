'use strict';
(()=>{
  const han=/[\p{Script=Han}\u3007]/u;
  const toChinese={',':'，','.':'。','．':'。',':':'：',';':'；','!':'！','?':'？','(':'（',')':'）'};
  const toEnglish={'，':',','。':'.','．':'.','：':':','；':';','！':'!','？':'?','（':'(', '）':')'};
  function chineseContext(text,index,mode){
    let start=text.lastIndexOf('\n',index-1)+1,end=text.indexOf('\n',index);
    if(end<0)end=text.length;
    if(mode==='chinese')return han.test(text.slice(start,end));
    const near=text.slice(Math.max(start,index-18),Math.min(end,index+19));
    return han.test(near);
  }
  function quotes(text,mode){
    const chars=Array.from(text),stack=[],offsets=[];
    let offset=0;for(const char of chars){offsets.push(offset);offset+=char.length;}
    const closers={'“':'”','‘':'’','「':'」','『':'』'};
    for(let i=0;i<chars.length;i++){
      const c=chars[i],top=stack[stack.length-1];
      if(c==="'"&&(/[A-Za-z0-9]/.test(chars[i-1]||'')||/^\d/.test(chars[i+1]||''))&&(!top||top.close!==c))continue;
      if(top&&top.close===c){
        stack.pop();const inside=chars.slice(top.index+1,i).join('');
        if(mode==='english'){
          if(['“','「','"'].includes(top.open)){chars[top.index]='"';chars[i]='"';}
          else {chars[top.index]="'";chars[i]="'";}
        }
        else if(han.test(inside)||chineseContext(text,offsets[top.index],mode)){
          if(top.open==='"'){chars[top.index]='“';chars[i]='”';}
          else if(top.open==="'"){chars[top.index]='‘';chars[i]='’';}
        }
      }
      else if(closers[c]||c==='"'||c==="'")stack.push({index:i,open:c,close:closers[c]||c});
    }
    return chars.join('');
  }
  AcademicText.punctuation=(text,mode)=>{
    if(mode==='preserve')return text;
    text=quotes(text,mode);
    if(mode==='english')return text.replace(/[，。．：；！？（）]/g,c=>toEnglish[c]);
    return text.replace(/[,.．:;!?()]/g,(c,index)=>chineseContext(text,index,mode) ? toChinese[c] : c);
  };
})();
