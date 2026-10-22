'use strict';
AcademicText.cleanAcademicText = (text,options={})=>{
  if(typeof text!=='string')throw new TypeError('Text must be a string');
  const config=AcademicText.resolve(options);
  if(!config.enabled||!text)return text;
  // Protect first: URLs, code and citations must survive even Unicode/space normalization verbatim.
  const guard=AcademicText.protect(text);
  let result=guard.text.replace(/[^\p{Script=Han}]+/gu,s=>s.normalize('NFC'))
    .replace(/\r\n?|\u2028/g,'\n').replace(/\u2029/g,'\n\n')
    .replace(/[\u00A0\u202F\u3000]/g,' ');
  if(config.removeOcrArtifacts)result=result.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD\uFFFE\uFFFF]/g,'');
  // Repair a known split word before joining ordinary lines, otherwise the evidence is lost.
  if(config.dehyphenate)result=AcademicText.fixHyphens(result);
  if(config.repairLineBreaks)result=AcademicText.fixLineBreaks(result,config,guard);
  if(config.normalizeLetters)result=AcademicText.normalizeLetters(result);
  result=AcademicText.spaces(result,config);
  result=AcademicText.punctuation(result,config.punctuation);
  // Run spacing after conversion, so English p．23 becomes p. 23 in one stable pass.
  if(config.punctuationSpaces)result=AcademicText.punctuationSpaces(result);
  return guard.restore(result.trim());
};
