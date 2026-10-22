'use strict';
var AcademicText = (()=>{
  const defaults=Object.freeze({enabled:true,preset:'paper',punctuation:'smart',repairLineBreaks:true,
    removeChineseSpaces:true,collapseSpaces:true,punctuationSpaces:true,keepParagraphs:true,
    dehyphenate:true,normalizeLetters:true,mixedSpaces:false,removeOcrArtifacts:false});
  const light=Object.freeze({...defaults,preset:'light',punctuation:'preserve',punctuationSpaces:false,
    dehyphenate:false,normalizeLetters:false});
  const booleans=Object.keys(defaults).filter(k=>typeof defaults[k]==='boolean');
  function resolve(options={}) {
    const preset=['paper','light','custom'].includes(options.preset) ? options.preset : 'paper';
    const base=preset==='light' ? light : defaults;
    const out={...base,preset};
    for(const key of booleans)if(typeof options[key]==='boolean')out[key]=options[key];
    if(['preserve','smart','chinese','english'].includes(options.punctuation))out.punctuation=options.punctuation;
    return out;
  }
  function preset(name){return resolve(name==='light' ? light : defaults);}
  return {defaults,booleans,resolve,preset};
})();
