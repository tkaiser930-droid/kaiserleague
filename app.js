(() => {
"use strict";
const K={A:"kaiserFantasyAthletes",T:"kaiserFantasyTeams",S:"kaiserFantasyScores",TR:"kaiserFantasyTrades",D:"kaiserFantasyDraftState",DS:"kaiserFantasyDraftSettings",CAL:"kaiserFantasySchedule"};
const REQ={"250":3,"450":3,MXGP:3,MX2:3,"CAN 250":2,"CAN 450":2,F1:3,MotoGP:3},SERIES=Object.keys(REQ),MXON_SUB_SERIES=["MXON MXGP","MXON MX2","MXON Open"],SECONDARY_SERIES_OPTIONS=[...SERIES,...MXON_SUB_SERIES],MAX_ROSTER_SIZE=Object.values(REQ).reduce((sum,n)=>sum+n,0),SERIES_GROUPS={SMX:["250","450"],"Triple Crown Series":["CAN 250","CAN 450"],MXGP:["MXGP","MX2"],MotoGP:["MotoGP"],F1:["F1"]},SECONDARY_SERIES_GROUPS={...SERIES_GROUPS,MXON:MXON_SUB_SERIES},DRAFT_ROOMS=Object.keys(SERIES_GROUPS),SCHEDULE_SERIES=["SMX","Triple Crown Series","MXGP","MotoGP","F1","MXON"],SCORE_SERIES=["SMX","Triple Crown Series","MXGP","MotoGP","F1","MXON"],SERIES_REMAP={f2:"F1",f3:"F1",f1academy:"F1",moto2:"MotoGP",moto3:"MotoGP"},RETIRED_SERIES=new Set(["wmx","canwmx","usawmx","smxnext"]),$=id=>document.getElementById(id);
const SMX_POSITION_POINTS=[25,22,20,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1,0];
const SX_MX_POSITION_POINTS=[25,22,20,18,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1];
const MOTOCROSS_POSITION_POINTS=[...SX_MX_POSITION_POINTS,...Array(20).fill(0)];
const MXGP_QUALIFYING_RACE_POINTS=Array.from({length:40},(_,i)=>i<10?10-i:0);
const F1_SPRINT_POSITION_POINTS=Array.from({length:22},(_,i)=>i<8?8-i:0);
const MOTOGP_SPRINT_POSITION_POINTS=[12,9,7,6,5,4,3,2,1,...Array(13).fill(0)];
const GRAND_PRIX_BONUSES=[["fastestQualifier","Fastest qualifier",3],["fastestLap","Fastest lap",1]];
const SCORE_BONUSES={SMX:[["fastestQualifier","Fastest qualifier",2],["heatWinner","Heat winner",2],["moto1Winner","Moto 1 winner",5],["moto2Winner","Moto 2 winner",5],["fastestLap","Fastest lap",1]],TripleCrown:[["fastestQualifier","Fastest qualifier",2],["fastestLap","Fastest lap",1]],MXGP:[["fastestLap","Fastest lap",1]],MotoGP:GRAND_PRIX_BONUSES,F1:GRAND_PRIX_BONUSES};
let draftOrderEditorRoom="",draftOrderEditorKeys=[],commissionerDataTabInitialized=false;
let draftProjectionCache=new Map(),draftProjectionPending=new Map(),activeDraftTab="draft";
let selectedSeasonYear=Number(window.KFStorage?.seasonYear||2027),commissionerSeasonMeta={};
const activeSeasonYear=()=>String(window.KFStorage?.activeYear||2027);
const read=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},write=(k,v)=>{if(window.KFStorage&&typeof window.KFStorage.write==="function")window.KFStorage.write(k,v);else localStorage.setItem(k,JSON.stringify(v))};
const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random();
function raceNumberValue(a){const raw=clean(a?.number??a?.riderNumber??"").replace(/^#+/,"").trim(),match=raw.match(/\d+/);return match?Number(match[0]):Number.POSITIVE_INFINITY}
function compareRiderNumbers(a,b){const an=raceNumberValue(a),bn=raceNumberValue(b);if(an!==bn)return an<bn?-1:1;return clean(a?.number??a?.riderNumber??"").localeCompare(clean(b?.number??b?.riderNumber??""),undefined,{numeric:true,sensitivity:"base"})||cls(a).localeCompare(cls(b))||name(a).localeCompare(name(b))}
const sortRiders=list=>list.slice().sort(compareRiderNumbers);
function riderFromRecord(r){const found=athletes().find(a=>(r?.riderId&&id(a)===String(r.riderId))||(r?.riderName&&norm(name(a))===norm(r.riderName)&&(!r?.riderClass||norm(cls(a))===norm(r.riderClass))));return found||{name:r?.riderName||r?.athleteName||"Athlete",number:r?.riderNumber||"",class:r?.riderClass||r?.athleteClass||"",primarySeries:r?.riderClass||r?.athleteClass||"",secondarySeries:r?.riderSecondarySeries||[],manufacturer:r?.manufacturer||"",nationality:r?.nationality||"",nationalityRegion:r?.nationalityRegion||""}}
function compareScoreRiders(a,b){return compareRiderNumbers(riderFromRecord(a),riderFromRecord(b))||new Date(b.recordedAt||0)-new Date(a.recordedAt||0)}
function riderFromPick(p){
 const current=athletes(),byId=current.find(a=>p?.athleteId&&id(a)===String(p.athleteId));
 const byName=p?.athleteName?current.filter(a=>norm(name(a))===norm(p.athleteName)):[];
 const byNameAndClass=byName.find(a=>!p?.athleteClass||norm(cls(a))===norm(p.athleteClass));
 const matched=byId||byNameAndClass||(byName.length===1?byName[0]:null);
 return matched||{name:p?.athleteName||"Athlete",number:p?.riderNumber||"",class:p?.athleteClass||"",primarySeries:p?.athleteClass||"",secondarySeries:p?.athleteSecondarySeries||[],raceTeam:p?.raceTeam||p?.riderRaceTeam||"",manufacturer:p?.manufacturer||"",nationality:p?.nationality||"",nationalityRegion:p?.nationalityRegion||""};
}
function comparePicksByRiderNumber(a,b){return compareRiderNumbers(riderFromPick(a),riderFromPick(b))||Number(a.number||0)-Number(b.number||0)}
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clean=s=>String(s??"").trim(),norm=s=>clean(s).toLowerCase().replace(/[^a-z0-9]/g,"");
const name=a=>clean(a.name||a.riderName||"Unnamed athlete"),cls=a=>clean(a.primarySeries||a.class||a.riderClass||a.category||a.series||"450"),id=a=>String(a.id??a.riderId??norm(name(a))+"-"+norm(cls(a)));
function normalizeAthleteSeries(a){
 const oldPrimary=clean(a?.primarySeries||a?.class||a?.riderClass||a?.category||a?.series||"450");
 const stableId=String(a?.id??a?.riderId??norm(name(a))+"-"+norm(oldPrimary));
 const remap=value=>SERIES_REMAP[norm(value)]||clean(value);
 const raw=Array.isArray(a?.secondarySeries)?a.secondarySeries:(Array.isArray(a?.additionalSeries)?a.additionalSeries:[]);
 let primary=remap(oldPrimary);
 let secondary=[...new Set(raw.map(remap).filter(x=>SECONDARY_SERIES_OPTIONS.includes(x)&&x!==primary))];
 if(!SERIES.includes(primary)){
  const promoted=secondary.find(x=>SERIES.includes(x));
  if(promoted){primary=promoted;secondary=secondary.filter(x=>x!==primary);a={...a,legacyPrimarySeries:a?.legacyPrimarySeries||oldPrimary}}
  else return {...a,id:stableId,primarySeries:"Archived",class:"Archived",secondarySeries:[],seriesArchived:true,legacyPrimarySeries:a?.legacyPrimarySeries||oldPrimary};
 }
 return {...a,id:stableId,primarySeries:primary,class:primary,secondarySeries:secondary,seriesArchived:false};
}
function athleteSeries(a){return a?.seriesArchived||!SERIES.includes(cls(a))?[]:[cls(a),...(Array.isArray(a?.secondarySeries)?a.secondarySeries:[])].filter(x=>SECONDARY_SERIES_OPTIONS.includes(x))}
function athleteNumberForSeries(a,series=""){
 const requested=clean(series),primary=cls(a),main=clean(a?.number??a?.riderNumber??"");
 if(!requested||norm(requested)===norm(primary))return main;
 const map=a?.secondaryNumbers&&typeof a.secondaryNumbers==="object"&&!Array.isArray(a.secondaryNumbers)?a.secondaryNumbers:{};
 const key=Object.keys(map).find(value=>norm(value)===norm(requested));
 return key&&clean(map[key])?clean(map[key]):main;
}
function athleteSeriesForDraftRoom(a,room){const roomClasses=SERIES_GROUPS[room]||[];return roomClasses.includes(cls(a))?cls(a):roomClasses.find(series=>athleteSeries(a).includes(series))||cls(a)}
function athleteNumberForDraftRoom(a,room){return athleteNumberForSeries(a,athleteSeriesForDraftRoom(a,room))}
function hasAthleteSeries(a,series){return athleteSeries(a).includes(series)}
function seriesDisplayHTML(a){const primary=esc(cls(a)),secondary=(Array.isArray(a?.secondarySeries)?a.secondarySeries:[]).filter(x=>x&&x!==cls(a));return `<span class="series-primary">${primary}</span>${secondary.length?`<small class="series-secondary">Also: ${secondary.map(esc).join(", ")}</small>`:""}`}
function seriesDisplayText(a){const secondary=(Array.isArray(a?.secondarySeries)?a.secondarySeries:[]).filter(x=>x&&x!==cls(a));return [cls(a),...secondary.map(x=>`+ ${x}`)].join(" · ")}
function secondarySeriesChecked(containerId,primary){return [...($(containerId)?.querySelectorAll('[data-secondary-series]:checked')||[])].map(x=>x.value).filter(x=>x!==primary)}
function secondaryNumbersFromInputs(containerId){const result={};$(containerId)?.querySelectorAll("[data-secondary-number]").forEach(input=>{const series=clean(input.dataset.secondaryNumber),value=normalizeNumber(input.value,"");if(series&&value)result[series]=value});return result}
function renderSecondaryNumberInputs(containerId,selected=[],saved={}){
 const el=$(containerId);if(!el)return;const values=saved&&typeof saved==="object"?saved:{};
 el.innerHTML=(selected||[]).map(series=>`<label class="secondary-number-field">${esc(series)} number<input type="text" inputmode="numeric" autocomplete="off" data-secondary-number="${esc(series)}" value="${esc(values[series]??Object.entries(values).find(([key])=>norm(key)===norm(series))?.[1]??"")}" placeholder="Same as main number"></label>`).join("")||'<p class="muted">Select a secondary series above to enter a separate number.</p>';
}
function refreshSecondarySeriesEditor(checkId,numberId,primary){const saved=secondaryNumbersFromInputs(numberId),selected=secondarySeriesChecked(checkId,primary);renderSecondarySeriesChecks(checkId,selected,primary);renderSecondaryNumberInputs(numberId,secondarySeriesChecked(checkId,primary),saved)}
function renderSecondarySeriesChecks(containerId,selected=[],primary=""){
 const el=$(containerId);if(!el)return;const chosen=new Set(selected||[]);
 el.innerHTML=Object.entries(SECONDARY_SERIES_GROUPS).map(([parent,classes])=>{const choices=classes.filter(x=>x!==primary);if(!choices.length)return "";return `<div class="series-check-group"><strong class="series-check-group-title">${esc(parent)}</strong><div class="series-check-group-options">${choices.map(x=>`<label class="series-check"><input type="checkbox" data-secondary-series value="${esc(x)}" ${chosen.has(x)?"checked":""}><span>${esc(x)}</span></label>`).join("")}</div></div>`}).join("")||'<span class="muted">No additional series available.</span>';
}
function populatePrimarySeriesSelect(select,selected){
 if(!select)return;const prior=selected||select.value;select.replaceChildren(new Option("Choose primary series…",""));
 Object.entries(SERIES_GROUPS).forEach(([parent,classes])=>{const group=document.createElement("optgroup");group.label=parent;classes.forEach(x=>group.append(new Option(x,x)));select.append(group)});
 if(SERIES.includes(prior))select.value=prior;
}
const COUNTRIES=[["AF","Afghanistan"],["AL","Albania"],["DZ","Algeria"],["AS","American Samoa"],["AD","Andorra"],["AO","Angola"],["AI","Anguilla"],["AQ","Antarctica"],["AG","Antigua and Barbuda"],["AR","Argentina"],["AM","Armenia"],["AW","Aruba"],["AU","Australia"],["AT","Austria"],["AZ","Azerbaijan"],["BS","Bahamas"],["BH","Bahrain"],["BD","Bangladesh"],["BB","Barbados"],["BY","Belarus"],["BE","Belgium"],["BZ","Belize"],["BJ","Benin"],["BM","Bermuda"],["BT","Bhutan"],["BO","Bolivia, Plurinational State of"],["BQ","Bonaire, Sint Eustatius and Saba"],["BA","Bosnia and Herzegovina"],["BW","Botswana"],["BV","Bouvet Island"],["BR","Brazil"],["IO","British Indian Ocean Territory"],["BN","Brunei Darussalam"],["BG","Bulgaria"],["BF","Burkina Faso"],["BI","Burundi"],["CV","Cabo Verde"],["KH","Cambodia"],["CM","Cameroon"],["CA","Canada"],["KY","Cayman Islands"],["CF","Central African Republic"],["TD","Chad"],["CL","Chile"],["CN","China"],["CX","Christmas Island"],["CC","Cocos (Keeling) Islands"],["CO","Colombia"],["KM","Comoros"],["CG","Congo"],["CD","Congo, The Democratic Republic of the"],["CK","Cook Islands"],["CR","Costa Rica"],["HR","Croatia"],["CU","Cuba"],["CW","Curaçao"],["CY","Cyprus"],["CZ","Czechia"],["CI","Côte d'Ivoire"],["DK","Denmark"],["DJ","Djibouti"],["DM","Dominica"],["DO","Dominican Republic"],["EC","Ecuador"],["EG","Egypt"],["SV","El Salvador"],["GQ","Equatorial Guinea"],["ER","Eritrea"],["EE","Estonia"],["SZ","Eswatini"],["ET","Ethiopia"],["FK","Falkland Islands (Malvinas)"],["FO","Faroe Islands"],["FJ","Fiji"],["FI","Finland"],["FR","France"],["GF","French Guiana"],["PF","French Polynesia"],["TF","French Southern Territories"],["GA","Gabon"],["GM","Gambia"],["GE","Georgia"],["DE","Germany"],["GH","Ghana"],["GI","Gibraltar"],["GR","Greece"],["GL","Greenland"],["GD","Grenada"],["GP","Guadeloupe"],["GU","Guam"],["GT","Guatemala"],["GG","Guernsey"],["GN","Guinea"],["GW","Guinea-Bissau"],["GY","Guyana"],["HT","Haiti"],["HM","Heard Island and McDonald Islands"],["VA","Holy See (Vatican City State)"],["HN","Honduras"],["HK","Hong Kong"],["HU","Hungary"],["IS","Iceland"],["IN","India"],["ID","Indonesia"],["IR","Iran, Islamic Republic of"],["IQ","Iraq"],["IE","Ireland"],["IM","Isle of Man"],["IL","Israel"],["IT","Italy"],["JM","Jamaica"],["JP","Japan"],["JE","Jersey"],["JO","Jordan"],["KZ","Kazakhstan"],["KE","Kenya"],["KI","Kiribati"],["KP","Korea, Democratic People's Republic of"],["KR","Korea, Republic of"],["KW","Kuwait"],["KG","Kyrgyzstan"],["LA","Lao People's Democratic Republic"],["LV","Latvia"],["LB","Lebanon"],["LS","Lesotho"],["LR","Liberia"],["LY","Libya"],["LI","Liechtenstein"],["LT","Lithuania"],["LU","Luxembourg"],["MO","Macao"],["MG","Madagascar"],["MW","Malawi"],["MY","Malaysia"],["MV","Maldives"],["ML","Mali"],["MT","Malta"],["MH","Marshall Islands"],["MQ","Martinique"],["MR","Mauritania"],["MU","Mauritius"],["YT","Mayotte"],["MX","Mexico"],["FM","Micronesia, Federated States of"],["MD","Moldova, Republic of"],["MC","Monaco"],["MN","Mongolia"],["ME","Montenegro"],["MS","Montserrat"],["MA","Morocco"],["MZ","Mozambique"],["MM","Myanmar"],["NA","Namibia"],["NR","Nauru"],["NP","Nepal"],["NL","Netherlands"],["NC","New Caledonia"],["NZ","New Zealand"],["NI","Nicaragua"],["NE","Niger"],["NG","Nigeria"],["NU","Niue"],["NF","Norfolk Island"],["MK","North Macedonia"],["MP","Northern Mariana Islands"],["NO","Norway"],["OM","Oman"],["PK","Pakistan"],["PW","Palau"],["PS","Palestine, State of"],["PA","Panama"],["PG","Papua New Guinea"],["PY","Paraguay"],["PE","Peru"],["PH","Philippines"],["PN","Pitcairn"],["PL","Poland"],["PT","Portugal"],["PR","Puerto Rico"],["QA","Qatar"],["RO","Romania"],["RU","Russian Federation"],["RW","Rwanda"],["RE","Réunion"],["BL","Saint Barthélemy"],["SH","Saint Helena, Ascension and Tristan da Cunha"],["KN","Saint Kitts and Nevis"],["LC","Saint Lucia"],["MF","Saint Martin (French part)"],["PM","Saint Pierre and Miquelon"],["VC","Saint Vincent and the Grenadines"],["WS","Samoa"],["SM","San Marino"],["ST","Sao Tome and Principe"],["SA","Saudi Arabia"],["SN","Senegal"],["RS","Serbia"],["SC","Seychelles"],["SL","Sierra Leone"],["SG","Singapore"],["SX","Sint Maarten (Dutch part)"],["SK","Slovakia"],["SI","Slovenia"],["SB","Solomon Islands"],["SO","Somalia"],["ZA","South Africa"],["GS","South Georgia and the South Sandwich Islands"],["SS","South Sudan"],["ES","Spain"],["LK","Sri Lanka"],["SD","Sudan"],["SR","Suriname"],["SJ","Svalbard and Jan Mayen"],["SE","Sweden"],["CH","Switzerland"],["SY","Syrian Arab Republic"],["TW","Taiwan, Province of China"],["TJ","Tajikistan"],["TZ","Tanzania, United Republic of"],["TH","Thailand"],["TL","Timor-Leste"],["TG","Togo"],["TK","Tokelau"],["TO","Tonga"],["TT","Trinidad and Tobago"],["TN","Tunisia"],["TM","Turkmenistan"],["TC","Turks and Caicos Islands"],["TV","Tuvalu"],["TR","Türkiye"],["UG","Uganda"],["UA","Ukraine"],["AE","United Arab Emirates"],["GB","United Kingdom"],["US","United States"],["UM","United States Minor Outlying Islands"],["UY","Uruguay"],["UZ","Uzbekistan"],["VU","Vanuatu"],["VE","Venezuela, Bolivarian Republic of"],["VN","Viet Nam"],["VG","Virgin Islands, British"],["VI","Virgin Islands, U.S."],["WF","Wallis and Futuna"],["EH","Western Sahara"],["YE","Yemen"],["ZM","Zambia"],["ZW","Zimbabwe"],["AX","Åland Islands"]];
const COUNTRY_NAMES=Object.fromEntries(COUNTRIES.map(([code,country])=>[code,country]));
// Country subdivisions at the state / province / region level. Most use ISO 3166-2 codes.
// Region values are stored as country-prefixed codes (for example, US-CA and CA-BC).
const REGION_DATA={
 CN:"AH~Anhui;BJ~Beijing;CQ~Chongqing;FJ~Fujian;GS~Gansu;GD~Guangdong;GX~Guangxi Zhuang Autonomous Region;GZ~Guizhou;HI~Hainan;HE~Hebei;HL~Heilongjiang;HA~Henan;HB~Hubei;HN~Hunan;JS~Jiangsu;JX~Jiangxi;JL~Jilin;LN~Liaoning;NM~Inner Mongolia Autonomous Region;NX~Ningxia Hui Autonomous Region;QH~Qinghai;SN~Shaanxi;SD~Shandong;SH~Shanghai;SX~Shanxi;SC~Sichuan;TJ~Tianjin;XJ~Xinjiang Uyghur Autonomous Region;XZ~Xizang (Tibet) Autonomous Region;YN~Yunnan;ZJ~Zhejiang",
 EE:"37~Harju County;39~Hiiu County;45~Ida-Viru County;50~Jõgeva County;52~Järva County;56~Lääne County;60~Lääne-Viru County;64~Põlva County;68~Pärnu County;71~Rapla County;74~Saare County;79~Tartu County;81~Valga County;84~Viljandi County;87~Võru County",
 AZ:"ABS~Absheron;AGC~Aghjabadi;AGM~Aghdam;AGS~Aghdash;AGA~Aghstafa;AGU~Agsu;AST~Astara;BAB~Babek;BAL~Balakan;BAR~Barda;BEY~Beylagan;BIL~Bilasuvar;CAB~Jabrayil;CAL~Jalilabad;CUL~Julfa;DAS~Dashkasan;FUZ~Fuzuli;GAD~Gadabay;GOR~Goranboy;GOY~Goychay;GYG~Goygol;HAC~Hajigabul;IMI~Imishli;ISM~Ismayilli;KAL~Kalbajar;KAN~Kangarli;KUR~Kurdamir;LAC~Lachin;LAN~Lankaran;LER~Lerik;MAS~Masalli;NEF~Neftchala;OGU~Oguz;ORD~Ordubad;QAB~Gabala;QAX~Gakh;QAZ~Gazakh;QOB~Gobustan;QUB~Guba;QBD~Gubadli;QUS~Gusar;SAA~Saatli;SAB~Sabirabad;SHB~Shabran;SAD~Sadarak;SAH~Shahbuz;SAK~Shaki;SAL~Salyan;SHA~Shamakhi;SHM~Shamkir;SAM~Samukh;SAR~Sharur;SIY~Siyazan;SHU~Shusha;TAR~Tartar;TOV~Tovuz;UJA~Ujar;KHA~Khachmaz;KHI~Khizi;KHO~Khojaly;KHV~Khojavend;YAR~Yardimli;YEV~Yevlakh;ZAN~Zangilan;ZAQ~Zaqatala;ZAR~Zardab;AGD~Aghdara;NXA~Nakhchivan Autonomous Republic;BAK~Baku;GAN~Ganja;KHK~Khankendi;LNC~Lankaran City;MNG~Mingachevir;NTL~Naftalan;NXC~Nakhchivan City;SHK~Shaki City;SHR~Shirvan;SUM~Sumqayit;YLC~Yevlakh City",
 HU:"01~Budapest;03~Bács-Kiskun;02~Baranya;04~Békés;05~Borsod-Abaúj-Zemplén;06~Csongrád-Csanád;07~Fejér;08~Győr-Moson-Sopron;09~Hajdú-Bihar;10~Heves;16~Jász-Nagykun-Szolnok;11~Komárom-Esztergom;12~Nógrád;13~Pest;14~Somogy;15~Szabolcs-Szatmár-Bereg;17~Tolna;18~Vas;19~Veszprém;20~Zala",
 SE:"K~Blekinge County;W~Dalarna County;X~Gävleborg County;I~Gotland County;N~Halland County;Z~Jämtland County;F~Jönköping County;H~Kalmar County;G~Kronoberg County;BD~Norrbotten County;T~Örebro County;E~Östergötland County;M~Skåne County;D~Södermanland County;AB~Stockholm County;C~Uppsala County;S~Värmland County;AC~Västerbotten County;Y~Västernorrland County;U~Västmanland County;O~Västra Götaland County",
 US:"AL~Alabama;AK~Alaska;AZ~Arizona;AR~Arkansas;CA~California;CO~Colorado;CT~Connecticut;DE~Delaware;DC~District of Columbia;FL~Florida;GA~Georgia;HI~Hawaii;ID~Idaho;IL~Illinois;IN~Indiana;IA~Iowa;KS~Kansas;KY~Kentucky;LA~Louisiana;ME~Maine;MD~Maryland;MA~Massachusetts;MI~Michigan;MN~Minnesota;MS~Mississippi;MO~Missouri;MT~Montana;NE~Nebraska;NV~Nevada;NH~New Hampshire;NJ~New Jersey;NM~New Mexico;NY~New York;NC~North Carolina;ND~North Dakota;OH~Ohio;OK~Oklahoma;OR~Oregon;PA~Pennsylvania;RI~Rhode Island;SC~South Carolina;SD~South Dakota;TN~Tennessee;TX~Texas;UT~Utah;VT~Vermont;VA~Virginia;WA~Washington;WV~West Virginia;WI~Wisconsin;WY~Wyoming",
 CA:"AB~Alberta;BC~British Columbia;MB~Manitoba;NB~New Brunswick;NL~Newfoundland and Labrador;NS~Nova Scotia;NT~Northwest Territories;NU~Nunavut;ON~Ontario;PE~Prince Edward Island;QC~Quebec;SK~Saskatchewan;YT~Yukon",
 AU:"ACT~Australian Capital Territory;NSW~New South Wales;NT~Northern Territory;QLD~Queensland;SA~South Australia;TAS~Tasmania;VIC~Victoria;WA~Western Australia",
 GB:"ENG~England;NIR~Northern Ireland;SCT~Scotland;WLS~Wales",
 NZ:"AUK~Auckland;BOP~Bay of Plenty;CAN~Canterbury;GIS~Gisborne;HKB~Hawke's Bay;MWT~Manawatū-Whanganui;MBH~Marlborough;NSN~Nelson;NTL~Northland;OTA~Otago;STL~Southland;TKI~Taranaki;TAS~Tasman;WKO~Waikato;WGN~Wellington;WTC~West Coast",
 DE:"BW~Baden-Württemberg;BY~Bavaria;BE~Berlin;BB~Brandenburg;HB~Bremen;HH~Hamburg;HE~Hesse;MV~Mecklenburg-Vorpommern;NI~Lower Saxony;NW~North Rhine-Westphalia;RP~Rhineland-Palatinate;SL~Saarland;SN~Saxony;ST~Saxony-Anhalt;SH~Schleswig-Holstein;TH~Thuringia",
 BR:"AC~Acre;AL~Alagoas;AP~Amapá;AM~Amazonas;BA~Bahia;CE~Ceará;DF~Federal District;ES~Espírito Santo;GO~Goiás;MA~Maranhão;MT~Mato Grosso;MS~Mato Grosso do Sul;MG~Minas Gerais;PA~Pará;PB~Paraíba;PR~Paraná;PE~Pernambuco;PI~Piauí;RJ~Rio de Janeiro;RN~Rio Grande do Norte;RS~Rio Grande do Sul;RO~Rondônia;RR~Roraima;SC~Santa Catarina;SP~São Paulo;SE~Sergipe;TO~Tocantins",
 MX:"AGS~Aguascalientes;BCN~Baja California;BCS~Baja California Sur;CAM~Campeche;CHP~Chiapas;CHH~Chihuahua;COA~Coahuila;COL~Colima;DUR~Durango;GUA~Guanajuato;GRO~Guerrero;HID~Hidalgo;JAL~Jalisco;MEX~México;MIC~Michoacán;MOR~Morelos;NAY~Nayarit;NLE~Nuevo León;OAX~Oaxaca;PUE~Puebla;QUE~Querétaro;ROO~Quintana Roo;SLP~San Luis Potosí;SIN~Sinaloa;SON~Sonora;TAB~Tabasco;TAM~Tamaulipas;TLA~Tlaxcala;VER~Veracruz;YUC~Yucatán;ZAC~Zacatecas;CMX~Mexico City",
 JP:"01~Hokkaido;02~Aomori;03~Iwate;04~Miyagi;05~Akita;06~Yamagata;07~Fukushima;08~Ibaraki;09~Tochigi;10~Gunma;11~Saitama;12~Chiba;13~Tokyo;14~Kanagawa;15~Niigata;16~Toyama;17~Ishikawa;18~Fukui;19~Yamanashi;20~Nagano;21~Gifu;22~Shizuoka;23~Aichi;24~Mie;25~Shiga;26~Kyoto;27~Osaka;28~Hyogo;29~Nara;30~Wakayama;31~Tottori;32~Shimane;33~Okayama;34~Hiroshima;35~Yamaguchi;36~Tokushima;37~Kagawa;38~Ehime;39~Kochi;40~Fukuoka;41~Saga;42~Nagasaki;43~Kumamoto;44~Oita;45~Miyazaki;46~Kagoshima;47~Okinawa",
 IN:"AN~Andaman and Nicobar Islands;AP~Andhra Pradesh;AR~Arunachal Pradesh;AS~Assam;BR~Bihar;CH~Chandigarh;CT~Chhattisgarh;DN~Dadra and Nagar Haveli and Daman and Diu;DL~Delhi;GA~Goa;GJ~Gujarat;HR~Haryana;HP~Himachal Pradesh;JK~Jammu and Kashmir;JH~Jharkhand;KA~Karnataka;KL~Kerala;LA~Ladakh;LD~Lakshadweep;MP~Madhya Pradesh;MH~Maharashtra;MN~Manipur;ML~Meghalaya;MZ~Mizoram;NL~Nagaland;OD~Odisha;PY~Puducherry;PB~Punjab;RJ~Rajasthan;SK~Sikkim;TN~Tamil Nadu;TS~Telangana;TR~Tripura;UP~Uttar Pradesh;UT~Uttarakhand;WB~West Bengal",
 ZA:"EC~Eastern Cape;FS~Free State;GP~Gauteng;KZN~KwaZulu-Natal;LP~Limpopo;MP~Mpumalanga;NC~Northern Cape;NW~North West;WC~Western Cape",
 ES:"AN~Andalusia;AR~Aragon;AS~Asturias;IB~Balearic Islands;PV~Basque Country;CN~Canary Islands;CB~Cantabria;CL~Castile and León;CM~Castilla-La Mancha;CT~Catalonia;EX~Extremadura;GA~Galicia;MD~Community of Madrid;MC~Region of Murcia;NC~Navarre;RI~La Rioja;VC~Valencian Community",
 IT:"ABR~Abruzzo;BAS~Basilicata;CAL~Calabria;CAM~Campania;EMR~Emilia-Romagna;FVG~Friuli-Venezia Giulia;LAZ~Lazio;LIG~Liguria;LOM~Lombardy;MAR~Marche;MOL~Molise;PIE~Piedmont;PUG~Apulia;SAR~Sardinia;SIC~Sicily;TOS~Tuscany;TAA~Trentino-Alto Adige;UMB~Umbria;VAO~Aosta Valley;VEN~Veneto",
 AR:"BA~Buenos Aires;CABA~Buenos Aires City;CAT~Catamarca;CHA~Chaco;CHU~Chubut;COR~Córdoba;CRR~Corrientes;ER~Entre Ríos;FOR~Formosa;JUJ~Jujuy;LPA~La Pampa;LR~La Rioja;MZA~Mendoza;MIS~Misiones;NQN~Neuquén;RNE~Río Negro;SAL~Salta;SJ~San Juan;SL~San Luis;SC~Santa Cruz;SF~Santa Fe;SE~Santiago del Estero;TF~Tierra del Fuego;TUC~Tucumán",
 FR:"ARA~Auvergne-Rhône-Alpes;BFC~Bourgogne-Franche-Comté;BRE~Bretagne;CVL~Centre-Val de Loire;20R~Corse;GES~Grand Est;HDF~Hauts-de-France;IDF~Île-de-France;NOR~Normandie;NAQ~Nouvelle-Aquitaine;OCC~Occitanie;PDL~Pays de la Loire;PAC~Provence-Alpes-Côte d’Azur;971~Guadeloupe;972~Martinique;973~Guyane;974~La Réunion;976~Mayotte",
 LV:"002~Aizkraukles novads;007~Alūksnes novads;111~Augšdaugavas novads;015~Balvu novads;016~Bauskas novads;022~Cēsu novads;DGV~Daugavpils;112~Dienvidkurzemes Novads;026~Dobeles novads;033~Gulbenes novads;JEL~Jelgava;041~Jelgavas novads;042~Jēkabpils novads;JUR~Jūrmala;047~Krāslavas novads;050~Kuldīgas novads;LPX~Liepāja;054~Limbažu novads;058~Ludzas novads;056~Līvānu novads;059~Madonas novads;062~Mārupes novads;067~Ogres novads;068~Olaines novads;073~Preiļu novads;080~Ropažu novads;REZ~Rēzekne;077~Rēzeknes novads;RIX~Rīga;087~Salaspils novads;088~Saldus novads;089~Saulkrastu novads;091~Siguldas novads;094~Smiltenes novads;097~Talsu novads;099~Tukuma novads;101~Valkas novads;113~Valmieras Novads;102~Varakļānu novads;VEN~Ventspils;106~Ventspils novads;011~Ādažu novads;052~Ķekavas novads",
 MC:"FO~Fontvieille;JE~Jardin Exotique;CL~La Colle;CO~La Condamine;GA~La Gare;SO~La Source;LA~Larvotto;MA~Malbousquet;MO~Monaco-Ville;MG~Moneghetti;MC~Monte-Carlo;MU~Moulins;PH~Port-Hercule;SR~Saint-Roman;SD~Sainte-Dévote;SP~Spélugues;VR~Vallon de la Rousse",
 NL:"DR~Drenthe;FL~Flevoland;FR~Fryslân;GE~Gelderland;GR~Groningen;LI~Limburg;NB~Noord-Brabant;NH~Noord-Holland;OV~Overijssel;UT~Utrecht;ZE~Zeeland;ZH~Zuid-Holland",
 TR:"01~Adana;02~Adıyaman;03~Afyonkarahisar;68~Aksaray;05~Amasya;06~Ankara;07~Antalya;75~Ardahan;08~Artvin;09~Aydın;04~Ağrı;10~Balıkesir;74~Bartın;72~Batman;69~Bayburt;11~Bilecik;12~Bingöl;13~Bitlis;14~Bolu;15~Burdur;16~Bursa;20~Denizli;21~Diyarbakır;81~Düzce;22~Edirne;23~Elazığ;24~Erzincan;25~Erzurum;26~Eskişehir;27~Gaziantep;28~Giresun;29~Gümüşhane;30~Hakkâri;31~Hatay;32~Isparta;76~Iğdır;34~İstanbul;35~İzmir;46~Kahramanmaraş;78~Karabük;70~Karaman;36~Kars;37~Kastamonu;38~Kayseri;79~Kilis;41~Kocaeli;42~Konya;43~Kütahya;39~Kırklareli;71~Kırıkkale;40~Kırşehir;44~Malatya;45~Manisa;47~Mardin;33~Mersin;48~Muğla;49~Muş;50~Nevşehir;51~Niğde;52~Ordu;80~Osmaniye;53~Rize;54~Sakarya;55~Samsun;56~Siirt;57~Sinop;58~Sivas;59~Tekirdağ;60~Tokat;61~Trabzon;62~Tunceli;64~Uşak;65~Van;77~Yalova;66~Yozgat;67~Zonguldak;17~Çanakkale;18~Çankırı;19~Çorum;63~Şanlıurfa;73~Şırnak",
 DK:"84~Hovedstaden;82~Midtjylland;81~Nordjylland;85~Sjælland;83~Syddanmark",
 TH:"37~Amnat Charoen;15~Ang Thong;38~Bueng Kan;31~Buri Ram;24~Chachoengsao;18~Chai Nat;36~Chaiyaphum;22~Chanthaburi;50~Chiang Mai;57~Chiang Rai;20~Chon Buri;86~Chumphon;46~Kalasin;62~Kamphaeng Phet;71~Kanchanaburi;40~Khon Kaen;81~Krabi;10~Krung Thep Maha Nakhon;52~Lampang;51~Lamphun;42~Loei;16~Lop Buri;58~Mae Hong Son;44~Maha Sarakham;49~Mukdahan;26~Nakhon Nayok;73~Nakhon Pathom;48~Nakhon Phanom;30~Nakhon Ratchasima;60~Nakhon Sawan;80~Nakhon Si Thammarat;55~Nan;96~Narathiwat;39~Nong Bua Lam Phu;43~Nong Khai;12~Nonthaburi;13~Pathum Thani;94~Pattani;82~Phangnga;93~Phatthalung;S~Phatthaya;56~Phayao;67~Phetchabun;76~Phetchaburi;66~Phichit;65~Phitsanulok;14~Phra Nakhon Si Ayutthaya;54~Phrae;83~Phuket;25~Prachin Buri;77~Prachuap Khiri Khan;85~Ranong;70~Ratchaburi;21~Rayong;45~Roi Et;27~Sa Kaeo;47~Sakon Nakhon;11~Samut Prakan;74~Samut Sakhon;75~Samut Songkhram;19~Saraburi;91~Satun;33~Si Sa Ket;17~Sing Buri;90~Songkhla;64~Sukhothai;72~Suphan Buri;84~Surat Thani;32~Surin;63~Tak;92~Trang;23~Trat;34~Ubon Ratchathani;41~Udon Thani;61~Uthai Thani;53~Uttaradit;95~Yala;35~Yasothon",
 BE:"VAN~Antwerpen;WBR~Brabant wallon;BRU~Bruxelles-Capitale, Région de;WHT~Hainaut;VLI~Limburg;WLG~Liège;WLX~Luxembourg;WNA~Namur;VOV~Oost-Vlaanderen;VLG~Vlaams Gewest;VBR~Vlaams-Brabant;WAL~wallonne, Région;VWV~West-Vlaanderen",
 NO:"42~Agder;32~Akershus;33~Buskerud;56~Finnmark;34~Innlandet;15~Møre og Romsdal;18~Nordland;03~Oslo;31~Østfold;11~Rogaland;40~Telemark;55~Troms;50~Trøndelag;39~Vestfold;46~Vestland",
 FI:"02~Etelä-Karjala;03~Etelä-Pohjanmaa;04~Etelä-Savo;05~Kainuu;06~Kanta-Häme;07~Keski-Pohjanmaa;08~Keski-Suomi;09~Kymenlaakso;01~Landskapet Åland;10~Lappi;11~Pirkanmaa;12~Pohjanmaa;13~Pohjois-Karjala;14~Pohjois-Pohjanmaa;15~Pohjois-Savo;16~Päijät-Häme;17~Satakunta;18~Uusimaa;19~Varsinais-Suomi",
 CO:"AMA~Amazonas;ANT~Antioquia;ARA~Arauca;ATL~Atlántico;BOL~Bolívar;BOY~Boyacá;CAL~Caldas;CAQ~Caquetá;CAS~Casanare;CAU~Cauca;CES~Cesar;CHO~Chocó;CUN~Cundinamarca;COR~Córdoba;DC~Distrito Capital de Bogotá;GUA~Guainía;GUV~Guaviare;HUI~Huila;LAG~La Guajira;MAG~Magdalena;MET~Meta;NAR~Nariño;NSA~Norte de Santander;PUT~Putumayo;QUI~Quindío;RIS~Risaralda;SAP~San Andrés, Providencia y Santa Catalina;SAN~Santander;SUC~Sucre;TOL~Tolima;VAC~Valle del Cauca;VAU~Vaupés;VID~Vichada",
 SI:"01~Pomurska;02~Podravska;03~Koroška;04~Savinjska;05~Zasavska;06~Posavska;07~Jugovzhodna Slovenija;08~Osrednjeslovenska;09~Gorenjska;10~Primorsko-notranjska;11~Goriška;12~Obalno-kraška",
 QA:"DA~Ad Dawḩah;KH~Al Khawr wa adh Dhakhīrah;WA~Al Wakrah;RA~Ar Rayyān;MS~Ash Shamāl;SH~Ash Shīḩānīyah;ZA~Az̧ Z̧a‘āyin;US~Umm Şalāl",
 SA:"14~'Asīr;11~Al Bāḩah;12~Al Jawf;03~Al Madīnah al Munawwarah;05~Al Qaşīm;08~Al Ḩudūd ash Shamālīyah;01~Ar Riyāḑ;04~Ash Sharqīyah;09~Jāzān;02~Makkah al Mukarramah;10~Najrān;07~Tabūk;06~Ḩā'il",
 BH:"14~Al Janūbīyah;15~Al Muḩarraq;13~Al ‘Āşimah;17~Ash Shamālīyah",
 PT:"01~Aveiro;02~Beja;03~Braga;04~Bragança;05~Castelo Branco;06~Coimbra;08~Faro;09~Guarda;10~Leiria;11~Lisboa;12~Portalegre;13~Porto;30~Região Autónoma da Madeira;20~Região Autónoma dos Açores;14~Santarém;15~Setúbal;16~Viana do Castelo;17~Vila Real;18~Viseu;07~Évora",
 AT:"1~Burgenland;2~Kärnten;3~Niederösterreich;4~Oberösterreich;5~Salzburg;6~Steiermark;7~Tirol;8~Vorarlberg;9~Wien",
 CZ:"64~Jihomoravský kraj;31~Jihočeský kraj;41~Karlovarský kraj;63~Kraj Vysočina;52~Královéhradecký kraj;51~Liberecký kraj;80~Moravskoslezský kraj;71~Olomoucký kraj;53~Pardubický kraj;32~Plzeňský kraj;10~Praha, Hlavní město;20~Středočeský kraj;72~Zlínský kraj;42~Ústecký kraj",
 CH:"AG~Aargau;AR~Appenzell Ausserrhoden;AI~Appenzell Innerrhoden;BL~Basel-Landschaft;BS~Basel-Stadt;BE~Berne;FR~Fribourg;GE~Genève;GL~Glarus;GR~Graubünden;JU~Jura;LU~Luzern;NE~Neuchâtel;NW~Nidwalden;OW~Obwalden;SG~Sankt Gallen;SH~Schaffhausen;SZ~Schwyz;SO~Solothurn;TG~Thurgau;TI~Ticino;UR~Uri;VS~Valais;VD~Vaud;ZG~Zug;ZH~Zürich",
 SG:"01~Central Singapore;02~North East;03~North West;04~South East;05~South West",
 MY:"01~Johor;02~Kedah;03~Kelantan;04~Melaka;05~Negeri Sembilan;06~Pahang;08~Perak;09~Perlis;07~Pulau Pinang;12~Sabah;13~Sarawak;10~Selangor;11~Terengganu;14~Wilayah Persekutuan Kuala Lumpur;15~Wilayah Persekutuan Labuan;16~Wilayah Persekutuan Putrajaya",
 ID:"AC~Aceh;BA~Bali;BT~Banten;BE~Bengkulu;GO~Gorontalo;JK~Jakarta Raya;JA~Jambi;JB~Jawa Barat;JT~Jawa Tengah;JI~Jawa Timur;KB~Kalimantan Barat;KS~Kalimantan Selatan;KT~Kalimantan Tengah;KI~Kalimantan Timur;KU~Kalimantan Utara;BB~Kepulauan Bangka Belitung;KR~Kepulauan Riau;LA~Lampung;MA~Maluku;MU~Maluku Utara;NB~Nusa Tenggara Barat;NT~Nusa Tenggara Timur;PA~Papua;PB~Papua Barat;PD~Papua Barat Daya;PE~Papua Pegunungan;PS~Papua Selatan;PT~Papua Tengah;RI~Riau;SR~Sulawesi Barat;SN~Sulawesi Selatan;ST~Sulawesi Tengah;SG~Sulawesi Tenggara;SA~Sulawesi Utara;SB~Sumatera Barat;SS~Sumatera Selatan;SU~Sumatera Utara;YO~Yogyakarta",
 AE:"AZ~Abū Z̧aby;FU~Al Fujayrah;SH~Ash Shāriqah;DU~Dubayy;RK~Ra’s al Khaymah;UQ~Umm al Qaywayn;AJ~‘Ajmān",
};
const REGION_OPTIONS=Object.fromEntries(Object.entries(REGION_DATA).map(([country,raw])=>[country,raw.split(";").map(item=>{const [code,label]=item.split("~");return [code,label]})]));
const KNOWN_NATIONALITY={jettlawrence:"AU",hunterlawrence:"AU",chasesexton:"US",elitomac:"US",haidendeegan:"US",joshimoda:"JP",levikitchen:"US",timgajser:"SI",jorgeprado:"ES",kaydewolf:"NL",simonlngenfelder:"DE",marcmrquez:"ES",francescobagnaia:"IT",fabioquartararo:"FR",maxverstappen:"NL",landonorris:"GB",charlesleclerc:"MC",oscarpiastri:"AU",lewishamilton:"GB"};
function normalizeNationality(value){const raw=clean(value);if(!raw)return "";const up=raw.toUpperCase();if(COUNTRY_NAMES[up])return up;const found=COUNTRIES.find(([code,country])=>norm(country)===norm(raw));return found?found[0]:""}
function flagEmoji(value){const code=normalizeNationality(value);if(!code)return "";return String.fromCodePoint(...[...code].map(ch=>0x1F1E6+ch.charCodeAt(0)-65))}
function countryName(value){const code=normalizeNationality(value);return code?COUNTRY_NAMES[code]:""}
function normalizeRegion(country,value){const code=normalizeNationality(country),raw=clean(value);if(!code||!raw)return "";const items=REGION_OPTIONS[code]||[];const match=items.find(([regionCode,label])=>raw.toUpperCase()===`${code}-${regionCode}`||raw.toUpperCase()===regionCode||norm(raw)===norm(label));return match?`${code}-${match[0]}`:""}
function regionName(country,value){const code=normalizeNationality(country),region=normalizeRegion(code,value);if(!region)return "";const suffix=region.slice(code.length+1);return (REGION_OPTIONS[code]||[]).find(([regionCode])=>regionCode===suffix)?.[1]||""}
function countryRegionLabel(country,region){const c=countryName(country);if(!c)return "";const r=regionName(country,region);return r?`${c} · ${r}`:c}
// Region codes in saved data are normalized to the ISO 3166-2 flag asset codes.
// Some existing dropdown values use local short forms rather than ISO identifiers.
const SUBDIVISION_FLAG_ALIASES={"AR-BA":"AR-B","AR-CABA":"AR-C","AR-RNE":"AR-R","AZ-BAK":"AZ-BA","HU-01":"HU-BU"};
// Use direct image references for regions where generated CSS selectors were unreliable
// or where an official/de-facto regional emblem is the best documented visual.
// The saved country and sub-region codes remain unchanged.
const SUBDIVISION_FLAG_IMAGE_URLS={
 "US-FL":"https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Florida.svg",
 "ES-CT":"https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Catalonia.svg",
 "DE-TH":"https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Thuringia_%28state%29.svg",
 "AU-VIC":"https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Victoria_%28Australia%29.svg",
 "US-OR":"https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Oregon.svg",
 "US-MI":"https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Michigan.svg",
 "MX-JAL":"https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Jalisco.svg",
 "BE-VLI":"https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Limburg_%28Belgium%29.svg",
 "US-TN":"https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Tennessee.svg",
 // Emilia-Romagna's commonly used de-facto regional flag; the region has no flag regulation.
 "IT-EMR":"https://upload.wikimedia.org/wikipedia/commons/7/77/Flag_of_Emilia-Romagna_%28de_facto%29.svg",
 // Hawke's Bay: original, simplified heraldic flag interpretation based on the black-and-white provincial colours and gold hawk described by Hastings District Council.
 "NZ-HKB":"assets/flags/nz-hkb-gold-hawk.svg",
 // Earlier documented flag design for Mecca; newer province variations are reported but lack a stable direct flag file.
 "SA-02":"https://upload.wikimedia.org/wikipedia/commons/9/92/Flag_of_Mecca.svg",
 // Shanghai's officially recognized city emblem, shown on white (rather than mislabelled as an official flag).
 "CN-SH":"https://english.shanghai.gov.cn/cmsres/38/38634fda91364cdeaa9d6c1cc4e68442/01b2fa883e6f876c2f372fb261c5d86e.jpg",
 // FOTW documents the Antalya provincial flag as white with the Governorate emblem.
 "TR-03":"assets/flags/tr-03-afyonkarahisar-governorate.svg",
 "TR-07":"assets/flags/tr-07-antalya-governorate.svg",
 // FOTW documents the Istanbul provincial flag as white with the Governorate emblem.
 "TR-34":"https://images.seeklogo.com/logo-png/44/1/t-c-istanbul-valiligi-logo-png_seeklogo-449973.png"
};
const SUBDIVISION_FLAG_LABEL_OVERRIDES={
 "NZ-HKB":"Hawke's Bay black-and-white flag with gold hawk (stylized regional design)",
 "IT-EMR":"Emilia-Romagna de-facto regional flag",
 "SA-02":"Earlier documented flag of Mecca (city design)",
 "CN-SH":"Shanghai official city emblem (not a permanent city flag)",
 "TR-03":"Afyonkarahisar provincial flag with Governorate emblem",
 "TR-07":"Antalya provincial flag with Governorate emblem",
 "TR-34":"Istanbul Governorate emblem used on its provincial flag"
};
// These saved sub-regions do not have a sufficiently reliable standalone flag or emblem asset.
const SUBDIVISION_FLAGS_UNAVAILABLE=new Set(["MC-MC","QA-ZA","SG-01"]);
function subdivisionFlagCode(country,region=""){
 const parent=normalizeNationality(country),raw=clean(region).toUpperCase().replace(/\s+/g,"");
 if(!parent||!raw)return "";
 const full=raw.startsWith(`${parent}-`)?raw:`${parent}-${raw}`;
 if(!full.startsWith(`${parent}-`))return "";
 return SUBDIVISION_FLAG_ALIASES[full]||full;
}
function subdivisionFlagHTML(country,region=""){
 const flagCode=subdivisionFlagCode(country,region);if(!flagCode||SUBDIVISION_FLAGS_UNAVAILABLE.has(flagCode))return "";
 const label=regionName(country,region)||`Sub-region ${flagCode.slice(flagCode.indexOf("-")+1)}`;
 const flagLabel=SUBDIVISION_FLAG_LABEL_OVERRIDES[flagCode]||`${label} flag`;
 const imageUrl=SUBDIVISION_FLAG_IMAGE_URLS[flagCode];
 if(imageUrl){
  return `<span class="subdivision-flag fi subdivision-flag-custom" style="background-image:url('${esc(imageUrl)}')" role="img" aria-label="${esc(flagLabel)}" title="${esc(flagLabel)}" data-subdivision-code="${esc(flagCode)}"></span>`;
 }
 return `<span class="subdivision-flag fi fi-${esc(flagCode.toLowerCase())}" role="img" aria-label="${esc(flagLabel)}" title="${esc(flagLabel)}" data-subdivision-code="${esc(flagCode)}"></span>`;
}
function athleteFlagPairHTML(country,region="",detail=""){
 const flag=flagEmoji(country),subdivision=subdivisionFlagHTML(country,region);
 return `<span class="athlete-flag-pair" title="${esc(detail||countryRegionLabel(country,region)||"Nationality not set")}" aria-label="${esc(detail||countryRegionLabel(country,region)||"Nationality not set")}"><span class="country-flag-symbol">${flag||""}</span>${subdivision}</span>`;
}
function nationalityHTML(value,region=""){const code=normalizeNationality(value),country=countryName(code),flag=flagEmoji(code);if(!flag)return "";const detail=countryRegionLabel(code,region);return `<span class="nationality-flag" title="${esc(detail)}" aria-label="${esc(detail)}"><span class="country-flag-symbol">${flag}</span>${subdivisionFlagHTML(code,region)}<span class="nationality-location">${esc(detail)}</span></span>`}
function nationalityText(value,region=""){const detail=countryRegionLabel(value,region);return detail?`${flagEmoji(value)} ${detail}`:"Nationality not set"}
function populateNationalitySelect(select){if(!select)return;const current=normalizeNationality(select.value);select.replaceChildren(new Option("Select country…",""));COUNTRIES.forEach(([code,country])=>select.add(new Option(`${flagEmoji(code)} ${country}`,code)));select.value=current}
function populateRegionSelect(select,countrySelect,value=""){if(!select)return;const country=normalizeNationality(countrySelect?.value),items=REGION_OPTIONS[country]||[];select.replaceChildren(new Option(items.length?"Select state / province / region…":"No sub-region options",""));items.forEach(([code,label])=>select.add(new Option(label,`${country}-${code}`)));select.disabled=!items.length;const normalized=normalizeRegion(country,value);select.value=normalized}
function athleteNameHTML(a,withNumber=true,showNationalityDetail=true,displaySeries="",numberOverride){const detail=countryRegionLabel(a?.nationality,a?.nationalityRegion),flagSlot=athleteFlagPairHTML(a?.nationality,a?.nationalityRegion),numberAthlete=displaySeries?{...a,primarySeries:displaySeries,class:displaySeries}:a,numberValue=numberOverride!==undefined&&numberOverride!==null?clean(numberOverride):athleteNumberForSeries(a,displaySeries),number=withNumber?(numberHTML(numberValue,numberAthlete?.manufacturer,numberAthlete)||'<span class="race-number-slot" aria-hidden="true"></span>'):"";const layoutClass=showNationalityDetail?"":" flag-only";return `<div class="athlete-name${withNumber?" has-number":" no-number"}${layoutClass}">${flagSlot}${number}<b>${esc(name(a))}</b>${showNationalityDetail&&detail?`<span class="athlete-nationality-detail">${esc(detail)}</span>`:""}</div>`}
function athleteDetailButtonHTML(a,withNumber=true,showNationalityDetail=true,displaySeries="",numberOverride){return `<button type="button" class="athlete-detail-trigger" data-athlete-detail="${esc(id(a))}" aria-label="View scoring history for ${esc(name(a))}">${athleteNameHTML(a,withNumber,showNationalityDetail,displaySeries,numberOverride)}</button>`}
function scoreRoundKey(record){
 const series=norm(canonicalScoreSeries(record?.series||eventRoom(record?.riderClass||record?.division||"")));
 const recordedYear=record?.seasonYear|| (record?.recordedAt&&Number.isFinite(new Date(record.recordedAt).getTime())?vancouverParts(new Date(record.recordedAt)).year:(selectedSeasonYear||activeSeasonYear()));
 const scheduledId=clean(record?.scheduledEventId);
 if(scheduledId)return `${recordedYear}|${series}|scheduled:${scheduledId}`;
 const event=norm(record?.event||"");
 const round=clean(record?.round);
 if(event||round!=="")return `${recordedYear}|${series}|event:${event}|round:${round}`;
 return `${recordedYear}|${series}|group:${clean(record?.resultGroupId)||clean(record?.recordedAt)||`${record?.division||record?.riderClass||"unknown"}-${record?.place||"unknown"}`}`;
}
function athleteScoringSummary(a){
 const records=athleteScoreRecords(a);
 const total=records.reduce((sum,record)=>sum+Number(record.points||0),0);
 const rounds=new Set(records.map(scoreRoundKey)).size;
 return {records,total,rounds,average:rounds?total/rounds:0};
}
function ordinalPlace(value){const place=Number(value);if(!Number.isFinite(place)||place<1)return "—";const lastTwo=place%100,suffix=lastTwo>=11&&lastTwo<=13?"th":({1:"st",2:"nd",3:"rd"}[place%10]||"th");return `${place}${suffix}`}
function openAthleteDetail(athleteId){
 const a=athletes().find(item=>id(item)===String(athleteId));if(!a)return;
 let dialog=$("athleteDetailDialog");
 if(!dialog){dialog=document.createElement("dialog");dialog.id="athleteDetailDialog";dialog.className="athlete-detail-dialog";document.body.append(dialog);dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close()})}
 const currentOwner=owner(a);
 dialog.innerHTML=`<div class="athlete-detail-shell">${athleteBannerHTML(a)}<header class="athlete-detail-header"><div><p class="eyebrow">ATHLETE PROFILE</p><h2>${athleteNameHTML(a)}</h2><p class="athlete-detail-affiliations">${seriesDisplayHTML(a)}</p></div><button type="button" class="athlete-detail-close" data-close-athlete-detail aria-label="Close athlete profile">Close ✕</button></header><div class="athlete-detail-meta"><span>${esc(currentOwner?`Current fantasy team: ${tname(currentOwner)}`:"Currently a free agent")}</span></div><div class="athlete-detail-stats" id="athleteDetailCareerStats"><div><strong>—</strong><span>Current season points</span></div><div><strong>—</strong><span>Career average / round</span></div><div><strong>—</strong><span>Career rounds scored</span></div><div><strong>—</strong><span>Career scored segments</span></div></div><section class="athlete-detail-results" id="allAthleteResults"><div class="athlete-detail-results-heading"><h3>Most Recent Scored Results</h3><span>All public seasons</span></div><p class="muted">Loading the rider's scored results across seasons…</p></section></div>`;
 const close=dialog.querySelector("[data-close-athlete-detail]");if(close)close.onclick=()=>dialog.close();
 if(typeof dialog.showModal==="function"){if(!dialog.open)dialog.showModal()}else dialog.setAttribute("open","");
 loadPublicAthleteHistory(a,dialog);
}
function athleteResultDateValue(record){return Date.parse(record?.eventDate||"")||Date.parse(record?.recordedAt||"")||0}
function athleteResultDateLabel(record){
 const value=String(record?.eventDate||record?.recordedAt||"");if(!value)return "—";
 const dateOnly=value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
 if(dateOnly){const [,year,month,day]=dateOnly;return new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(Number(year),Number(month)-1,Number(day),12)))}
 const date=new Date(value);if(Number.isNaN(date.getTime()))return value;
 return new Intl.DateTimeFormat("en-US",{timeZone:"America/Vancouver",month:"short",day:"numeric",year:"numeric"}).format(date);
}
async function loadPublicAthleteHistory(athlete,dialog){
 const target=dialog.querySelector("#allAthleteResults"),stats=dialog.querySelector("#athleteDetailCareerStats");if(!target||!stats)return;
 try{
  const params=new URLSearchParams({riderId:id(athlete),name:name(athlete),class:cls(athlete)});
  const response=await fetch(`/api/public/athlete-history?${params.toString()}`,{cache:"no-store"});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||"Scored results could not be loaded.");
  if(!dialog.isConnected||!target.isConnected)return;
  const career=result.career||{},records=(Array.isArray(result.records)?result.records:[]).slice().sort((a,b)=>athleteResultDateValue(b)-athleteResultDateValue(a)||Number(b.seasonYear||0)-Number(a.seasonYear||0)||Number(a.place||999)-Number(b.place||999));
  stats.innerHTML=`<div><strong>${Number(career.currentSeasonPoints||0).toLocaleString()}</strong><span>${esc(result.activeYear||"Current")} season points</span></div><div><strong>${Number(career.average||0).toFixed(2)}</strong><span>Career average / round</span></div><div><strong>${Number(career.rounds||0).toLocaleString()}</strong><span>Career rounds scored</span></div><div><strong>${Number(career.segmentCount||records.length).toLocaleString()}</strong><span>Career scored segments</span></div>`;
  const averages=Array.isArray(career.averages)?career.averages:[];
  const averageTable=averages.length?`<h4>Career average by series and class</h4><div class="table">${table(["Series","Class","Career points","Rounds","Average / round"],averages.map(item=>`<tr><td>${esc(item.series)}</td><td>${esc(item.division)}</td><td class="points">${Number(item.total||0).toLocaleString()}</td><td>${Number(item.rounds||0).toLocaleString()}</td><td class="points">${Number(item.average||0).toFixed(2)}</td></tr>`))}</div>`:"";
  const row=record=>{
   const series=canonicalScoreSeries(record.series||eventRoom(record.riderClass||record.division||""));
   const resultClass=clean(record.division||record.riderClass||cls(athlete));
   const segment=[resultClass,record.scoringPhase].filter(Boolean).join(" · ")||"—";
   const number=clean(record.riderNumber)||athleteNumberForSeries(athlete,resultClass);
   const numberAthlete={...athlete,primarySeries:resultClass,class:resultClass,raceTeam:record.riderRaceTeam||athlete.raceTeam,manufacturer:record.manufacturer||athlete.manufacturer};
   const plate=numberHTML(number,numberAthlete.manufacturer,numberAthlete)||"—";
   return `<tr><td>${esc(record.seasonYear||"—")}</td><td>${esc(series||"—")}</td><td>${esc(segment)}</td><td>${plate}</td><td>${scoreEventLabel(record)}</td><td>${esc(ordinalPlace(record.place))}</td><td>${bonusText(record)}</td><td class="points">${Number(record.points||0).toLocaleString()}</td><td>${esc(record.teamName||"Unrostered / Free Agent")}</td><td>${esc(athleteResultDateLabel(record))}</td></tr>`;
  };
  const recent=records.slice(0,10),older=records.slice(10);
  const resultTable=records.length?`<div class="table">${table(["Season","Series","Class / Session","Number","Event / Round","Finish","Bonuses","Points","Team at Scoring","Race Date"],recent.map(row))}</div>${older.length?`<details class="historical-profile-season"><summary>Show ${older.length.toLocaleString()} older scored segment${older.length===1?"":"s"}</summary><div class="table">${table(["Season","Series","Class / Session","Number","Event / Round","Finish","Bonuses","Points","Team at Scoring","Race Date"],older.map(row))}</div></details>`:""}`:'<p class="muted">No scored race results have been recorded for this athlete yet.</p>';
  target.innerHTML=`<div class="athlete-detail-results-heading"><h3>Most Recent Scored Results</h3><span>${records.length.toLocaleString()} results · ${new Set(records.map(record=>record.seasonYear)).size} seasons</span></div>${averageTable}${resultTable}<p class="athlete-detail-footnote">Career average = points across all published seasons divided by unique event rounds scored across those seasons. Multiple motos and qualifying sessions at the same event count as one round. Fantasy-team season totals still reset each season.</p>`;
 }catch(error){
  if(dialog.isConnected&&target.isConnected)target.innerHTML=`<div class="athlete-detail-results-heading"><h3>Most Recent Scored Results</h3></div><p class="muted">${esc(error.message||"Scored results are unavailable right now.")}</p>`;
 }
}
function flagByRider(riderId,riderName,riderClass,fallbackCountry="",fallbackRegion=""){
 const a=athletes().find(x=>(riderId&&id(x)===String(riderId))||(riderName&&norm(name(x))===norm(riderName)&&(!riderClass||norm(cls(x))===norm(riderClass))));
 return nationalityHTML(fallbackCountry||a?.nationality||"",fallbackRegion||a?.nationalityRegion||"");
}
const teams=()=>{let t=read(K.T,[]);return Array.isArray(t)?t:Object.entries(t).map(([key,v])=>({...v,key:v.key||key}))},saveTeams=t=>write(K.T,t);
const athletes=()=>read(K.A,[]),saveAthletes=a=>write(K.A,a),scores=()=>read(K.S,[]),roster=t=>Array.isArray(t.roster)?t.roster:[],key=t=>String(t.key??t.id??norm(t.name)),tname=t=>t.name||t.teamName||key(t);
const BRAND={
Honda:{color:"#E60012",logo:"honda",image:"https://global.honda/en/wingmark/assets/img/2dlogo/7.webp",fit:"wide"},
Yamaha:{color:"#003399",logo:"yamaha",image:"https://3.bp.blogspot.com/-Y_Pw6SK7wM8/VtbvwDNlfwI/AAAAAAAAOhY/n99f-418EnE/s1600/logo-yamaha-tuning_forks.jpg",fit:"square"},
Kawasaki:{color:"#006B3F",logo:"kawasaki",image:"https://servicehomologation.com/cdn/shop/files/KAWASAKI_LOGO.png?v=1744300377&width=2000",fit:"square"},KTM:{color:"#FF6600",logo:"ktm"},
Kove:{color:"#22A7A7",logo:"kove",image:"https://static.wixstatic.com/media/2280eb_e897db89dbf44cb481126b5750fd8e18~mv2.png",fit:"square"},
Fantic:{color:"#FFFFFF",logo:"fantic",image:"https://fantic.com/Content/img/logo.svg",fit:"wide"},
ZXMoto:{color:"#477DBB",logo:"zxmoto",image:"https://pbs.twimg.com/profile_images/2038585392216113152/R3eIOSVy.jpg",fit:"square"},
JHL:{color:"#D71920",logo:"jhl",image:"assets/logos/jhl-wordmark.svg",fit:"wide"},
Husqvarna:{color:"#FFFFFF",logo:"husqvarna",image:"https://cdn.simpleicons.org/husqvarna/002550"},GasGas:{color:"#E4002B",logo:"gasgas",image:"https://upload.wikimedia.org/wikipedia/commons/0/03/GASGAS_Logo.svg",fit:"wide"},Suzuki:{color:"#FFD400",logo:"suzuki",image:"https://cdn.simpleicons.org/suzuki/111111"},
Triumph:{color:"#111111",logo:"triumph",image:"https://lirp.cdn-website.com/072a18a0/dms3rep/multi/opt/triumph-logo-640w.jpg",fit:"square"},
Beta:{color:"#D71920",logo:"beta",image:"https://media.cdnws.com/_i/46016/6385/1693/88/stickers-beta-ref8beta-autocollant-beta-moto-sticker-pour-moto-sport.jpeg",fit:"square"},Ducati:{color:"#800020",logo:"ducati"},
Aprilia:{color:"#5D3A9B",logo:"aprilia",image:"https://poptuning.fr/8726-large_default/aprilia-lion-sticker-autocollant.jpg",fit:"square"},
Ford:{color:"#00095B",logo:"ford",fit:"wide"},
"Honda Engines":{color:"#CC0000",logo:"honda",fit:"square"},
"Red Bull Racing":{color:"#001E62",logo:"redbull",image:"https://cdn.simpleicons.org/redbull/001E62"},
"Racing Bulls":{color:"#65C7F7",logo:"redbull",image:"https://cdn.simpleicons.org/redbull/001E62"},
McLaren:{color:"#D95B00",logo:"mclaren"},Ferrari:{color:"#DC0000",logo:"ferrari"},
Mercedes:{color:"#00A19B",logo:"mercedes",image:"https://upload.wikimedia.org/wikipedia/commons/9/98/Mercedes-Benz_Star_%281969-1986%2C_2025-%29.svg",fit:"square"},
Cadillac:{color:"#C7A96B",logo:"cadillac",image:"https://cdn.simpleicons.org/cadillac/C7A96B",fit:"square"},
"Aston Martin":{color:"#004225",logo:"astonmartin",image:"https://cdn.simpleicons.org/astonmartin/004225"},
Audi:{color:"#444444",logo:"audi",image:"https://cdn.simpleicons.org/audi/444444"},
Haas:{color:"#FFFFFF",logo:"haas",image:"https://f1store4.formula1.com/content/ws/all/686828d2-e6e4-4e2f-9056-412cd5fffbaf__1179X1179.jpg",fit:"square"},
Williams:{color:"#00AEEF",image:"assets/logos/williams-w.svg",fit:"square"},
Alpine:{color:"#F08ACB",logo:"alpine",image:"assets/logos/alpine-pink-a.png",fit:"wide"}
};
const MANUFACTURER_PURPLE="#8E67F2";
const RACE_TEAM_BRANDS={
 "Alpine":{"color":"#F08ACB","accent":"#F08ACB","number":"#F08ACB","image":"assets/logos/alpine-pink-a.png","fit":"wide"},
 "Aston Martin":{"color":"#004225","accent":"#004225","number":"#004225","image":"https://cdn.simpleicons.org/astonmartin/004225","fit":"square"},
 "Audi":{"color":"#444444","accent":"#444444","number":"#444444","image":"https://cdn.simpleicons.org/audi/444444","fit":"square"},
 "Cadillac":{"color":"#C7A96B","accent":"#C7A96B","number":"#C7A96B","image":"https://cdn.simpleicons.org/cadillac/C7A96B","fit":"square"},
 "Ferrari":{"color":"#DC0000","accent":"#DC0000","number":"#DC0000","image":"https://cdn.simpleicons.org/ferrari/DC0000","fit":"square"},
 "Haas":{"color":"#FFFFFF","accent":"#FFFFFF","number":"#FFFFFF","image":"https://f1store4.formula1.com/content/ws/all/686828d2-e6e4-4e2f-9056-412cd5fffbaf__1179X1179.jpg","fit":"square"},
 "McLaren":{"color":"#D95B00","accent":"#D95B00","number":"#D95B00","image":"https://cdn.simpleicons.org/mclaren/D95B00","fit":"square"},
 "Mercedes AMG Petronas":{"color":"#00A19B","accent":"#00A19B","number":"#00A19B","image":BRAND.Mercedes.image,"fit":BRAND.Mercedes.fit},
 "Racing Bulls":{"color":"#65C7F7","accent":"#65C7F7","number":"#65C7F7","image":"https://cdn.simpleicons.org/redbull/001E62","fit":"square"},
 "Red Bull Racing":{"color":"#001E62","accent":"#001E62","number":"#001E62","image":"https://cdn.simpleicons.org/redbull/001E62","fit":"square"},
 "Williams":{"color":"#00AEEF","accent":"#00AEEF","number":"#00AEEF","image":"assets/logos/williams-w.svg","fit":"square"},
 "Aprilia Racing":{"color":"#5D3A9B","accent":"#5D3A9B","number":"#5D3A9B","image":"https://poptuning.fr/8726-large_default/aprilia-lion-sticker-autocollant.jpg","fit":"square"},
 "BK8 Gresini Racing MotoGP":{"color":"#66BCE6","accent":"#173F78","number":"#77C9F1","image":"assets/logos/race-teams/bk8-gresini-racing-motogp-user.png","fit":"wide"},
 "Ducati Lenovo Team":{"color":"#800020","accent":"#800020","number":"#800020","image":"https://cdn.simpleicons.org/ducati/800020","fit":"square"},
 "Honda HRC Castrol":{"color":"#E60012","accent":"#00529B","number":"#FF424F","image":"https://global.honda/en/wingmark/assets/img/2dlogo/7.webp","fit":"wide"},
 "Castrol Honda LCR":{"color":"#006B45","accent":"#D71920","number":"#19B56A","image":"assets/logos/race-teams/castrol-honda-lcr-user.png","fit":"wide"},
 "Monster Energy Yamaha MotoGP":{"color":"#003399","accent":"#003399","number":"#003399","image":"https://3.bp.blogspot.com/-Y_Pw6SK7wM8/VtbvwDNlfwI/AAAAAAAAOhY/n99f-418EnE/s1600/logo-yamaha-tuning_forks.jpg","fit":"square"},
 "Pertamina Enduro VR46 Racing Team":{"color":"#111111","accent":"#EFFF00","number":"#EFFF00","image":"https://upload.wikimedia.org/wikipedia/commons/a/ab/Pertamina_Enduro_VR46_Racing_Team_-_logo_2024_updated.jpg","fallbackImage":"assets/logos/race-teams/pertamina-enduro-vr46-racing-team.svg","fit":"square"},
 "Prima Pramac Yamaha MotoGP":{"color":"#573B8A","accent":"#D7193F","number":"#B59AE7","image":"https://www.yamahamotogp.com/assets/img/team/ppym-logo.png","fallbackImage":"assets/logos/race-teams/prima-pramac-yamaha-motogp.svg","fit":"square"},
 "Red Bull KTM Factory Racing":{"color":"#F36C21","accent":"#111318","number":"#FF8A3D","image":"assets/logos/race-teams/red-bull-ktm-factory-racing.svg","fit":"wide"},
 "Red Bull KTM Tech3":{"color":"#F36C21","accent":"#142448","number":"#FF8747","image":"https://www.teamtech3.fr/Tech3-team-logo-2025.jpg","fallbackImage":"assets/logos/race-teams/red-bull-ktm-tech3.svg","fit":"square"},
 "Superfile Trackhouse MotoGP Team":{"color":"#0876B9","accent":"#D7EF00","number":"#43AEE4","image":"assets/logos/race-teams/superfile-trackhouse-motogp-user.png","fit":"wide"}
};
function raceTeamBrand(value){
 const lookup=norm(value);
 if(!lookup)return null;
 const aliases={
  lcrhondacastrol:"Castrol Honda LCR",hondalcrcastrol:"Castrol Honda LCR",hondalcr:"Castrol Honda LCR",gresiniracingmotogp:"BK8 Gresini Racing MotoGP",
  oracleRedBullRacing:"Red Bull Racing",visaCashAppRacingBulls:"Racing Bulls",visaCashAppRB:"Racing Bulls",
  mercedesAMGPetronasF1Team:"Mercedes AMG Petronas",kickSauber:"Audi",stakeF1TeamKickSauber:"Audi",
  ducatiLenovo:"Ducati Lenovo Team",gresiniRacing:"BK8 Gresini Racing MotoGP",vr46RacingTeam:"Pertamina Enduro VR46 Racing Team",
  pramacRacing:"Prima Pramac Yamaha MotoGP",trackhouseMotoGP:"Superfile Trackhouse MotoGP Team",lcrHonda:"Castrol Honda LCR",
  hondaHRC:"Honda HRC Castrol",ktmTech3:"Red Bull KTM Tech3",redBullKTMTech3:"Red Bull KTM Tech3"
 };
 const aliasKey=Object.keys(aliases).find(key=>norm(key)===lookup);
 const canonical=aliasKey?aliases[aliasKey]:"";
 if(canonical){const exact=Object.entries(RACE_TEAM_BRANDS).find(([label])=>norm(label)===norm(canonical));if(exact)return exact[1];}
 // Team names are often saved with sponsor prefixes or series suffixes.
 // Match the longest configured team label first to avoid confusing Racing Bulls
 // with Red Bull Racing or confusing factory and satellite MotoGP teams.
 const matches=Object.entries(RACE_TEAM_BRANDS)
  .map(([label,config])=>({label,config,key:norm(label)}))
  .filter(item=>item.key&&lookup.includes(item.key))
  .sort((a,b)=>b.key.length-a.key.length);
 return matches[0]?.config||null;
}
function isTeamColorSeries(athlete){return ["F1","MOTOGP"].includes(cls(athlete).toUpperCase());}
function athleteSidebarColor(athlete){if(isTeamColorSeries(athlete)&&clean(athlete?.raceTeam)){const team=raceTeamBrand(athlete.raceTeam);if(team?.color)return team.color;if(team?.accent)return team.accent;}return mcolor(athlete?.manufacturer);}
function raceTeamBannerHTML(value,displayValue=value,kicker="RACE TEAM",variant="profile"){
 const raw=clean(value)||"Unknown Race Team",config=raceTeamBrand(raw)||{color:"#344054",accent:"#CBD5E1",image:"",fit:"wide"};
 const color=config.color||"#344054",label=esc(clean(displayValue)||raw),bannerLabel=esc(kicker);
 const image=config.image||"",hex=color.replace("#",""),rgb=hex.length===6?[parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16)]:[52,64,84];
 const brightness=(rgb[0]*299+rgb[1]*587+rgb[2]*114)/1000,ink=config.ink||(brightness>160?"#111318":"#FFFFFF");
 const logoClass=config.fit==="square"?"square":"wide";
 return `<div class="athlete-manufacturer-banner${variant==="directory"?" directory-brand-banner":""}" style="--athlete-mfr-color:${color};--athlete-mfr-ink:${ink}" aria-label="${bannerLabel}: ${label}"><div class="athlete-manufacturer-banner-brand">${image?`<img class="athlete-manufacturer-logo ${logoClass}" src="${image}" data-fallback="${esc(config.fallbackImage||"")}" alt="${esc(raw)} race team logo" loading="lazy" referrerpolicy="no-referrer" onerror="if(this.dataset.fallback){this.src=this.dataset.fallback;this.dataset.fallback='';}else{this.hidden=true;}">`:""}<div class="athlete-manufacturer-banner-copy"><span>${bannerLabel}</span><strong>${label}</strong></div></div></div>`;
}
function athleteBannerHTML(athlete){return isTeamColorSeries(athlete)&&clean(athlete?.raceTeam)?raceTeamBannerHTML(athlete.raceTeam):manufacturerBannerHTML(athlete?.manufacturer||"Unknown Manufacturer");}

function brandKey(value){
 const m=clean(value).toLowerCase();
 // Check Racing Bulls before Red Bull Racing so the teams keep separate colors.
 if(m.includes("racing bulls")||m.includes("visa cash app rb")||m==="rb") return "Racing Bulls";
 if(m.includes("honda engines")) return "Honda Engines";
 if(m.replace(/[^a-z]/g,"").includes("gasgas")) return "GasGas";
 if(m.includes("aston martin")) return "Aston Martin";
 if(m.includes("williams")) return "Williams";
 if(m.replace(/[^a-z]/g,"").includes("zxmoto")) return "ZXMoto";
 if(m.includes("haas")) return "Haas";
 if(m.includes("alpine")) return "Alpine";
 if(m.includes("audi")) return "Audi";
 return Object.keys(BRAND).find(k=>m.includes(k.toLowerCase()))||""
}
// Use each manufacturer's brand color for badges and sidebars. Aprilia is purple.
const mcolor=m=>BRAND[brandKey(m)]?.color||"#6B7280";
function brandBadge(value){
 const k=brandKey(value),b=BRAND[k],label=esc(value||k||"Unknown");
 const image=b?.image|| (b?.logo?`https://cdn.simpleicons.org/${b.logo}/${(b.color||MANUFACTURER_PURPLE).slice(1)}`:"");
 const isJHL=k==="JHL";
 return `<span class="brand-badge${isJHL?" brand-badge-jhl":""}" style="--brand-color:${mcolor(value)}" title="${label}">${image?`<img class="${b?.fit==="wide"?"brand-logo-wide":b?.fit==="square"?"brand-logo-square":"brand-logo"}${isJHL?" brand-logo-wordmark":""}${k==="GasGas"?" brand-logo-gasgas":""}" src="${image}" alt="${isJHL?"JHL wordmark":`${label} logo`}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.hidden=true">`:""}<span class="brand-label">${label}</span></span>`
}
function manufacturerBannerHTML(value,displayValue=value,kicker="MANUFACTURER",variant="profile"){
 const raw=clean(value)||"Unknown Manufacturer",k=brandKey(raw),b=BRAND[k];
 const color=mcolor(raw),label=esc(clean(displayValue)||raw),bannerLabel=esc(kicker);
 const image=b?.image||(b?.logo?`https://cdn.simpleicons.org/${b.logo}/${(b.color||MANUFACTURER_PURPLE).slice(1)}`:"");
 const hex=color.replace("#","");
 const rgb=hex.length===6?[parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16)]:[107,114,128];
 const brightness=(rgb[0]*299+rgb[1]*587+rgb[2]*114)/1000;
 const ink=brightness>160?"#111318":"#FFFFFF";
 const logoClass=b?.fit==="wide"?"wide":b?.fit==="square"?"square":"standard";
 return `<div class="athlete-manufacturer-banner${variant==="directory"?" directory-brand-banner":""}" style="--athlete-mfr-color:${color};--athlete-mfr-ink:${ink}" aria-label="${bannerLabel}: ${label}"><div class="athlete-manufacturer-banner-brand">${image?`<img class="athlete-manufacturer-logo ${logoClass}" src="${image}" alt="${esc(raw)} logo" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.hidden=true">`:""}<div class="athlete-manufacturer-banner-copy"><span>${bannerLabel}</span><strong>${label}</strong></div></div></div>`;
}
function numberHTML(value,manufacturer,athlete={}){
 const n=clean(value).replace(/^#+/,"").trim();if(!n)return "";
 const series=cls(athlete).toUpperCase();
 let colors;
 if(["250","MX2","CAN 250"].includes(series)) colors=["#000000","#FFFFFF"];
 else if(["450","MXGP","CAN 450"].includes(series)) colors=["#FFFFFF","#000000"];
 else if(["MOTOGP","F1"].includes(series)){
  const teamColors=raceTeamBrand(athlete.raceTeam||athlete.riderRaceTeam);
  // F1 and MotoGP number plates are team-branded, never manufacturer-branded.
  // Unknown team labels use a neutral plate ink instead of silently falling
  // back to the bike/engine manufacturer color.
  colors=["#000000",teamColors?.number||teamColors?.accent||teamColors?.color||"#D1D5DB"];
 }
 else colors=[mcolor(manufacturer),"#FFFFFF"];
 if(athlete.pointsLeader) colors=["#E60012","#FFFFFF"];
 else if(athlete.reigningTripleCrownChampion) colors=["#6B2FB9","#F2D16B"];
 else if(athlete.reigningSMXChampion) colors=["#6B2FB9","#F2D16B"];
 else if(athlete.reigningWorldChampion) colors=["#000000","#F2D16B"];
 return `<span class="race-number" style="--number-color:${colors[0]};--number-ink:${colors[1]}" aria-label="Racing number ${esc(n)}">${esc(n)}</span>`
}
function normalizeNumber(value,athleteName){let n=clean(value).replace(/^#+/,"").trim();if(norm(athleteName)==="jorgeprado"&&!/^\d+$/.test(n))n="61";return n}
const hash=async p=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(p)))].map(x=>x.toString(16).padStart(2,"0")).join("");
function migrateLegacyCanadianDraftRoom(){
 const draft=read(K.D,{picks:[]}),settings=read(K.DS,{});let draftChanged=false,settingsChanged=false;
 if(Array.isArray(draft.picks))draft.picks=draft.picks.map(p=>{if(p?.room==="CAN"){draftChanged=true;return {...p,room:"Triple Crown Series"}}return p});
 if(settings&&settings.CAN){if(!settings["Triple Crown Series"])settings["Triple Crown Series"]={...settings.CAN};delete settings.CAN;settingsChanged=true}
 if(draftChanged)write(K.D,draft);if(settingsChanged)write(K.DS,settings);
}
function migrateRemovedSeriesHistory(){
 const settings=read(K.DS,{});
 if(settings&&settings.seriesTrimVersion===4)return;
 const remap=value=>SERIES_REMAP[norm(value)]||clean(value);
 const isRetired=value=>RETIRED_SERIES.has(norm(value));
 let scoreChanged=false,picksChanged=false,calendarChanged=false;
 const oldScores=read(K.S,[]);
 const nextScores=oldScores.map(record=>{
  const oldClass=clean(record.riderClass||record.athleteClass||record.division||"");
  const mapped=remap(oldClass);
  let next={...record};
  if(Object.prototype.hasOwnProperty.call(next,"eventSubSeries"))delete next.eventSubSeries;
  if(SERIES_REMAP[norm(oldClass)]){
   if(next.riderClass)next.riderClass=mapped;
   if(next.athleteClass)next.athleteClass=mapped;
   if(next.division)next.division=mapped;
  }else if(isRetired(oldClass)){
   next.legacyDivision=next.legacyDivision||oldClass;
   next.division="Archived";
  }
  const sec=Array.isArray(next.riderSecondarySeries)?next.riderSecondarySeries:[];
  const cleanedSec=[...new Set(sec.map(remap).filter(x=>SECONDARY_SERIES_OPTIONS.includes(x)&&x!==mapped))];
  if(JSON.stringify(cleanedSec)!==JSON.stringify(sec))next.riderSecondarySeries=cleanedSec;
  if(JSON.stringify(next)!==JSON.stringify(record))scoreChanged=true;
  return next;
 });
 if(scoreChanged)write(K.S,nextScores);
 const draft=read(K.D,{picks:[]});
 if(Array.isArray(draft.picks)){
  const nextPicks=draft.picks.map(p=>{
   const oldClass=clean(p.athleteClass||"");let athleteClass=remap(oldClass);
   if(isRetired(oldClass))athleteClass="Archived";
   const oldSecondary=Array.isArray(p.athleteSecondarySeries)?p.athleteSecondarySeries:[];
   const athleteSecondarySeries=[...new Set(oldSecondary.map(remap).filter(x=>SECONDARY_SERIES_OPTIONS.includes(x)&&x!==athleteClass))];
   const next={...p,athleteClass,athleteSecondarySeries};
   if(JSON.stringify(next)!==JSON.stringify(p))picksChanged=true;
   return next;
  });
  if(picksChanged)write(K.D,{...draft,picks:nextPicks});
 }
 const calendar=read(K.CAL,[]);
 const nextCalendar=calendar.map(event=>{
  const original=clean(event.series);
  const series=(["CAN","CAN 250","CAN 450","CAN WMX"].includes(original))?"Triple Crown Series":original;
  const next={...event,series};
  // Event-level sub-series selection was removed in this rollback. Event type
  // determines scoring eligibility; keep the event itself and its dates intact.
  if(Object.prototype.hasOwnProperty.call(next,"subSeries")){delete next.subSeries;calendarChanged=true}
  if(JSON.stringify(next)!==JSON.stringify(event))calendarChanged=true;
  return next;
 });
 if(calendarChanged)write(K.CAL,nextCalendar);
 write(K.DS,{...(settings||{}),seriesTrimVersion:4});
}
function canonicalScoreSeries(value){const s=clean(value);return s==="CAN"?"Triple Crown Series":s}
function seed(){if(!Array.isArray(read(K.T,null)))saveTeams(["Team One","Team Two","Team Three","Team Four","Team Five"].map((name,i)=>({key:"team-"+(i+1),name,owner:"",passwordHash:"",roster:[]})));
if(!Array.isArray(read(K.A,null))){const data=[["Jett Lawrence","18","450","Team Honda HRC","Honda"],["Hunter Lawrence","96","450","Team Honda HRC","Honda"],["Chase Sexton","4","450","Red Bull KTM Factory Racing","KTM"],["Eli Tomac","3","450","Yamaha Star Racing","Yamaha"],["Haiden Deegan","38","250","Yamaha Star Racing","Yamaha"],["Jo Shimoda","30","250","Honda HRC","Honda"],["Levi Kitchen","47","250","Pro Circuit Kawasaki","Kawasaki"],["Tim Gajser","243","MXGP","Team HRC","Honda"],["Jorge Prado","61","MXGP","Red Bull KTM","KTM"],["Kay de Wolf","74","MX2","Husqvarna Factory Racing","Husqvarna"],["Simon Längenfelder","516","MX2","Red Bull KTM","KTM"],["Marc Márquez","93","MotoGP","Ducati Lenovo","Ducati"],["Francesco Bagnaia","63","MotoGP","Ducati Lenovo","Ducati"],["Fabio Quartararo","20","MotoGP","Yamaha MotoGP","Yamaha"],["Max Verstappen","1","F1","Red Bull Racing","Red Bull Racing"],["Lando Norris","4","F1","McLaren","McLaren"],["Charles Leclerc","16","F1","Ferrari","Ferrari"],["Oscar Piastri","81","F1","McLaren","McLaren"],["Lewis Hamilton","44","F1","Ferrari","Ferrari"]];saveAthletes(data.map(([name,number,c,raceTeam,manufacturer])=>({id:uid(),name,number:String(number).trim(),class:c,raceTeam,manufacturer,pointsLeader:false,reigningSMXChampion:false,reigningTripleCrownChampion:false,reigningWorldChampion:false})))}
// Normalize racing numbers as strings (never parseInt, so numbers such as 01 stay intact).
const storedAthletes=athletes().map(a=>{const n=normalizeAthleteSeries(a),nationality=normalizeNationality(a.nationality)||KNOWN_NATIONALITY[norm(name(a))]||"";return {...n,number:normalizeNumber(a.number,name(a)),nationality,nationalityRegion:normalizeRegion(nationality,a.nationalityRegion),reigningTripleCrownChampion:!!a.reigningTripleCrownChampion}});
if(JSON.stringify(storedAthletes)!==JSON.stringify(athletes()))saveAthletes(storedAthletes);
const normalizedTeams=teams().map(t=>({...t,roster:roster(t).map(a=>{const master=storedAthletes.find(m=>id(m)===id(a)||(norm(name(m))===norm(name(a))&&norm(cls(m))===norm(cls(a))));const merged=normalizeAthleteSeries(master?{...a,...master}:a),nationality=normalizeNationality(merged.nationality)||master?.nationality||KNOWN_NATIONALITY[norm(name(a))]||"";return {...merged,number:normalizeNumber(merged.number,name(merged)),nationality,nationalityRegion:normalizeRegion(nationality,merged.nationalityRegion||master?.nationalityRegion)}}).filter(a=>!a.seriesArchived)}));
if(JSON.stringify(normalizedTeams)!==JSON.stringify(teams()))saveTeams(normalizedTeams);
for(const k of [K.S,K.TR,K.CAL])if(!Array.isArray(read(k,null)))write(k,[]);if(!read(K.D,null))write(K.D,{picks:[]});if(!read(K.DS,null))write(K.DS,{});
migrateLegacyCanadianDraftRoom();
migrateRemovedSeriesHistory();
}
function owner(a){return teams().find(t=>roster(t).some((r,i)=>id(r)===id(a)||(norm(name(r))===norm(name(a))&&norm(cls(r))===norm(cls(a)))))}
function total(t){return scores().filter(s=>String(s.teamKey)===key(t)).reduce((n,s)=>n+Number(s.points||0),0)}
function scoreSeriesBucket(record){
 const value=clean(record?.series||record?.division||record?.riderClass||""),key=norm(value),primary=norm(record?.riderClass||record?.athleteClass||record?.division||"");
 if(key==="mxon"){
  if(["can250","can450","canwmx"].includes(primary))return "TCS";
  if(["mxgp","mx2","wmx"].includes(primary))return "MXGP";
  if(["250","450","smxnext","usawmx"].includes(primary))return "SMX";
  return "SMX";
 }
 if(key==="triplecrownseries"||key==="can"||key==="can250"||key==="can450")return "TCS";
 // smxnext remains here only so previously recorded points stay in the historical SMX total.
 if(["smx","250","450","smxnext","usawmx"].includes(key))return "SMX";
 if(["mxgp","mx2","wmx"].includes(key))return "MXGP";
 if(["motogp","moto2","moto3"].includes(key))return "MotoGP";
 if(["f1","f2","f3","f1academy"].includes(key))return "F1";
 return value;
}
function teamSeriesTotal(t,series){return scores().filter(s=>String(s.teamKey)===key(t)&&scoreSeriesBucket(s)===series).reduce((n,s)=>n+Number(s.points||0),0)}
function athleteScoreRecords(a){return scores().filter(s=>{const byId=s.riderId&&String(s.riderId)===id(a);const byName=norm(s.riderName||s.athleteName)===norm(name(a))&&(!s.riderClass||norm(s.riderClass)===norm(cls(a)));return !!byId||byName})}
function athleteSeasonPoints(a){return athleteScoreRecords(a).reduce((n,s)=>n+Number(s.points||0),0)}
function counts(t){let c={};SERIES.forEach(s=>c[s]=0);roster(t).forEach(a=>{if(c[cls(a)]!==undefined)c[cls(a)]++});return c}
function quota(t){const c=counts(t);return Object.entries(REQ).map(([s,n])=>`<div><strong>${c[s]}/${n}</strong>${s}</div>`).join("")}
function table(h,rows){return rows.length?`<table><thead><tr>${h.map(x=>`<th>${x}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`:'<p class="muted">Nothing to display yet.</p>'}
function options(sel,items,placeholder){if(!sel)return;sel.replaceChildren(new Option(placeholder,""));items.forEach(x=>sel.add(new Option(x.label,x.value)))}
function renderTopUndraftedAthletes(){
 const el=$("topUndraftedAthletes");if(!el)return;
 const divisions=SERIES;
 const rows=divisions.map(division=>{
  const candidates=athletes().filter(a=>!a.seriesArchived&&SERIES.includes(cls(a))&&norm(cls(a))===norm(division)&&!owner(a)).map(a=>({athlete:a,records:athleteScoreRecords(a),points:athleteSeasonPoints(a)})).filter(x=>x.records.length).sort((a,b)=>b.points-a.points||compareRiderNumbers(a.athlete,b.athlete));
  const top=candidates[0];
  if(!top)return `<tr><td><b>${esc(division)}</b></td><td colspan="3" class="muted">No scored undrafted athletes yet</td></tr>`;
  const a=top.athlete;
  return `<tr><td><b>${esc(division)}</b></td><td><div class="manufacturer" style="--mfr:${athleteSidebarColor(a)}">${athleteDetailButtonHTML(a)}</div></td><td>${brandBadge(a.manufacturer||"—")}</td><td class="points">${top.points.toLocaleString()}</td></tr>`;
 });
 el.innerHTML=table(["Division","Top Undrafted Athlete","Manufacturer","Season Points"],rows)
}
function standings(){
 const el=$("homeStandings");
 if(el){const ranked=teams().slice().sort((a,b)=>total(b)-total(a));el.innerHTML=table(["Rank","Team","Owner","Roster","F1 Points","MotoGP Points","SMX Points","MXGP Points","TCS Points","Total Points"],ranked.map((t,i)=>`<tr><td>${i+1}</td><td><b>${esc(tname(t))}</b></td><td>${esc(t.owner||"Unclaimed")}</td><td>${roster(t).length}/${MAX_ROSTER_SIZE}</td><td class="points">${teamSeriesTotal(t,"F1").toLocaleString()}</td><td class="points">${teamSeriesTotal(t,"MotoGP").toLocaleString()}</td><td class="points">${teamSeriesTotal(t,"SMX").toLocaleString()}</td><td class="points">${teamSeriesTotal(t,"MXGP").toLocaleString()}</td><td class="points">${teamSeriesTotal(t,"TCS").toLocaleString()}</td><td class="points">${total(t).toLocaleString()}</td></tr>`))}
 renderTopUndraftedAthletes()
}
async function claim(k){const t=teams().find(t=>key(t)===k),msg=$("teamMessage");if(!t||t.owner){msg.textContent="That team is already claimed or unavailable.";return}const o=prompt("Enter the team owner's name:");if(o===null)return;if(!clean(o)){msg.textContent="Owner name is required.";return}const p=prompt("Create a team password (at least 6 characters):");if(p===null)return;if(p.length<6){msg.textContent="Password must be at least 6 characters.";return}t.owner=clean(o);t.passwordHash=await hash(p);saveTeams(teams().map(x=>key(x)===k?t:x));msg.textContent=`${tname(t)} claimed. Save the password somewhere safe.`;renderTeams()}
function renderTeams(){const el=$("teamsGrid");if(!el)return;el.innerHTML=teams().map(t=>{const riders=sortRiders(roster(t));const rosterPreview=`<details class="team-roster-preview"><summary>View Roster (${riders.length})</summary><div class="team-roster-preview-list">${riders.length?riders.map(a=>`<div class="team-roster-preview-row">${athleteDetailButtonHTML(a,true,false)}</div>`).join(""):'<p class="muted">No riders on this roster yet.</p>'}</div></details>`;return `<article class="team-card"><h2>${esc(tname(t))}</h2><p class="team-owner">${t.owner?"Owned by "+esc(t.owner):"Available to claim"}</p><div class="team-points">${total(t).toLocaleString()}</div><span class="muted">Season points</span><p class="team-meta">${riders.length}/${MAX_ROSTER_SIZE} athletes</p>${rosterPreview}${t.owner?`<button type="button" class="btn alt" data-open-manage="${esc(key(t))}">Manage / Sign In</button>`:`<button class="btn" data-claim="${esc(key(t))}">Claim Team</button>`}</article>`}).join("");el.querySelectorAll("[data-claim]").forEach(b=>b.onclick=()=>claim(b.dataset.claim));el.querySelectorAll("[data-open-manage]").forEach(b=>b.addEventListener("click",()=>openTeamManagePanel(b.dataset.openManage||"")));if($("requirements"))$("requirements").innerHTML=Object.entries(REQ).map(([s,n])=>`<div><strong>${n}</strong>${s} athletes</div>`).join("")}
function renderAthletes(){const target=$("athleteTable");if(!target)return;const page=document.body.dataset.page,search=clean($("search")?.value).toLowerCase(),c=$("classFilter")?.value||"",of=$("ownerFilter")?.value||"",availability=$("availabilityFilter")?.value||(new URLSearchParams(location.search).get("availability")==="available"?"available":"all");const list=athletes().filter(a=>!a.seriesArchived&&SERIES.includes(cls(a))).filter(a=>{const o=owner(a),free=!o;return [name(a),a.number,a.raceTeam,a.manufacturer,cls(a),...(a.secondarySeries||[]),countryRegionLabel(a.nationality,a.nationalityRegion),o?tname(o):"free agent"].join(" ").toLowerCase().includes(search)&&(!c||athleteSeries(a).includes(c))&&(availability!=="available"||free)&&(!of||(of==="free"?free:!free))}).sort(compareRiderNumbers);target.innerHTML=table(["Athlete","Series","Race Team","Manufacturer","Season Points","Fantasy Team"],list.map(a=>{const o=owner(a),pts=athleteSeasonPoints(a),badges=[a.pointsLeader?"Points Leader":"",a.reigningTripleCrownChampion?"Triple Crown Champion":"",a.reigningSMXChampion?"SMX Champion":"",a.reigningWorldChampion?"World Champion":""].filter(Boolean).map(x=>`<span class="badge">${x}</span>`).join(" ");return `<tr><td><div class="manufacturer" style="--mfr:${athleteSidebarColor(a)}">${athleteDetailButtonHTML(a)}<div>${badges}</div></div></td><td class="series">${seriesDisplayHTML(a)}</td><td>${esc(a.raceTeam||"—")}</td><td>${brandBadge(a.manufacturer||"—")}</td><td class="points">${pts.toLocaleString()}</td><td>${esc(o?tname(o):"Free Agent")}</td></tr>`}))}
let activeDirectoryPage="",activeDirectoryKey="";
function directoryGroups(page){
 const field=page==="race-teams"?"raceTeam":"manufacturer",groups=new Map();
 athletes().filter(a=>!a.seriesArchived).forEach(a=>{
  const raw=clean(a[field]);if(!raw)return;
  const canonical=field==="manufacturer"?(brandKey(raw)||raw):raw;
  const groupKey=norm(canonical);if(!groupKey)return;
  if(!groups.has(groupKey))groups.set(groupKey,{key:groupKey,label:canonical,athletes:[],brands:new Map()});
  const group=groups.get(groupKey);group.athletes.push(a);
  if(field==="raceTeam"&&clean(a.manufacturer)){const brand=brandKey(a.manufacturer)||clean(a.manufacturer),brandKeyValue=norm(brand);const entry=group.brands.get(brandKeyValue)||{label:brand,count:0};entry.count++;group.brands.set(brandKeyValue,entry)}
 });
 return [...groups.values()].map(group=>{
  const groupAthletes=sortRiders(group.athletes);
  const useRaceTeamBrand=field==="raceTeam"&&groupAthletes.length>0&&groupAthletes.every(isTeamColorSeries)&&!!raceTeamBrand(group.label);
  let bannerBrand=group.label;
  if(field==="raceTeam"&&!useRaceTeamBrand)bannerBrand=[...group.brands.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label))[0]?.label||group.label;
  return {...group,bannerBrand,useRaceTeamBrand,athletes:groupAthletes};
 }).sort((a,b)=>a.label.localeCompare(b.label,undefined,{sensitivity:"base"}));
}
function renderDirectoryMenu(){
 const menu=$("directoryMenu");if(!menu)return;
 const groups=directoryGroups(activeDirectoryPage),search=clean($("directorySearch")?.value).toLowerCase();
 const filtered=groups.filter(group=>group.label.toLowerCase().includes(search)||group.athletes.some(a=>name(a).toLowerCase().includes(search)));
 const kicker=activeDirectoryPage==="race-teams"?"RACE TEAM":"MANUFACTURER";
 menu.innerHTML=filtered.map(group=>{const banner=group.useRaceTeamBrand?raceTeamBannerHTML(group.label,group.label,kicker,"directory"):manufacturerBannerHTML(group.bannerBrand,group.label,kicker,"directory");return `<button type="button" class="directory-choice" data-directory-key="${esc(group.key)}" aria-label="View ${esc(group.label)} athletes">${banner}<span class="directory-choice-count">${group.athletes.length} athlete${group.athletes.length===1?"":"s"}</span></button>`}).join("")||'<p class="muted">No matching entries found.</p>';
}
function renderDirectorySelection(){
 const group=directoryGroups(activeDirectoryPage).find(item=>item.key===activeDirectoryKey),detail=$("directoryDetail"),menu=$("directoryMenu");
 if(!detail||!menu)return;
 if(!group){activeDirectoryKey="";detail.hidden=true;menu.hidden=false;return}
 const kicker=activeDirectoryPage==="race-teams"?"RACE TEAM":"MANUFACTURER";
 const bannerBrand=group.bannerBrand||group.label;
 $("directoryBanner").innerHTML=group.useRaceTeamBrand?raceTeamBannerHTML(group.label,group.label,kicker):manufacturerBannerHTML(bannerBrand,group.label,kicker);
 $("directoryCount").textContent=`${group.athletes.length} athlete${group.athletes.length===1?"":"s"} associated with ${group.label}.`;
 $("directoryRiders").innerHTML=table(["Athlete","Series","Race Team","Manufacturer","Fantasy Team","Season Points"],group.athletes.map(a=>{const o=owner(a);return `<tr><td><div class="manufacturer" style="--mfr:${athleteSidebarColor(a)}">${athleteDetailButtonHTML(a)}</div></td><td>${seriesDisplayHTML(a)}</td><td>${esc(a.raceTeam||"—")}</td><td>${brandBadge(a.manufacturer||"—")}</td><td>${esc(o?tname(o):"Free Agent")}</td><td class="points">${athleteSeasonPoints(a).toLocaleString()}</td></tr>`}));
 menu.hidden=true;detail.hidden=false;
}
function directoryInit(page){
 activeDirectoryPage=page;activeDirectoryKey="";
 $("directorySearch")?.addEventListener("input",renderDirectoryMenu);
 $("directoryMenu")?.addEventListener("click",event=>{const button=event.target.closest("[data-directory-key]");if(!button)return;activeDirectoryKey=button.dataset.directoryKey;renderDirectorySelection()});
 $("directoryBack")?.addEventListener("click",()=>{activeDirectoryKey="";$("directorySearch").value="";$("directoryDetail").hidden=true;$("directoryMenu").hidden=false;renderDirectoryMenu()});
 renderDirectoryMenu();
}
function populateDirectoryEntityFilter(){
 const kind=$("directoryKind")?.value||"race-teams",page=kind==="manufacturers"?"manufacturers":"race-teams",select=$("directoryEntity");if(!select)return;
 const prior=select.value,groups=directoryGroups(page);select.replaceChildren(new Option(kind==="manufacturers"?"All Manufacturers":"All Race Teams",""),...groups.map(group=>new Option(group.label,group.key)));
 if(groups.some(group=>group.key===prior))select.value=prior;
}
function combinedDirectoryMatches(group,series,search){
 const matching=group.athletes.filter(a=>(!series||athleteSeries(a).includes(series))&&(!search||[name(a),a.number,a.raceTeam,a.manufacturer,group.label,cls(a),...(a.secondarySeries||[])].join(" ").toLowerCase().includes(search)));
 return matching;
}
function renderCombinedDirectory(){
 const kind=$("directoryKind")?.value||"race-teams",page=kind==="manufacturers"?"manufacturers":"race-teams",groups=directoryGroups(page),selectedKey=$("directoryEntity")?.value||"",series=$("directorySeries")?.value||"",search=clean($("directorySearch")?.value).toLowerCase();
 const menu=$("directoryMenu"),detail=$("directoryDetail"),back=$("directoryBack"),banner=$("directoryBanner"),count=$("directoryCount"),riders=$("directoryRiders");
 if(!menu||!detail||!riders)return;
 const selected=selectedKey?groups.find(group=>group.key===selectedKey):null;
 if(back)back.textContent=kind==="manufacturers"?"← All Manufacturers":"← All Race Teams";
 if(selected){
  menu.hidden=true;detail.hidden=false;
  const kicker=kind==="manufacturers"?"MANUFACTURER":"RACE TEAM";
  banner.hidden=false;
  banner.innerHTML=selected.useRaceTeamBrand?raceTeamBannerHTML(selected.label,selected.label,kicker):manufacturerBannerHTML(selected.bannerBrand||selected.label,selected.label,kicker);
  const rows=combinedDirectoryMatches(selected,series,search);
  count.textContent=`${rows.length} athlete${rows.length===1?"":"s"} associated with ${selected.label}${series?` · ${series}`:""}.`;
  riders.innerHTML=table(["Athlete","Series","Race Team","Manufacturer","Fantasy Team","Season Points"],rows.map(a=>{const o=owner(a);return `<tr><td><div class="manufacturer" style="--mfr:${athleteSidebarColor(a)}">${athleteDetailButtonHTML(a)}</div></td><td>${seriesDisplayHTML(a)}</td><td>${esc(a.raceTeam||"—")}</td><td>${brandBadge(a.manufacturer||"—")}</td><td>${esc(o?tname(o):"Free Agent")}</td><td class="points">${athleteSeasonPoints(a).toLocaleString()}</td></tr>`}));
  return;
 }
 detail.hidden=true;menu.hidden=false;banner.hidden=true;banner.innerHTML="";riders.innerHTML="";
 const kicker=kind==="manufacturers"?"MANUFACTURER":"RACE TEAM";
 const visible=groups.map(group=>({group,athletes:combinedDirectoryMatches(group,series,search)})).filter(item=>item.athletes.length>0||(!series&&!search));
 menu.innerHTML=visible.map(({group,athletes:matching})=>{
  const brand=group.useRaceTeamBrand?raceTeamBannerHTML(group.label,group.label,kicker,"directory"):manufacturerBannerHTML(group.bannerBrand||group.label,group.label,kicker,"directory");
  const totalMatching=matching.length;
  return `<button type="button" class="directory-choice" data-directory-key="${esc(group.key)}" aria-label="View ${esc(group.label)} athletes">${brand}<span class="directory-choice-count">${totalMatching} athlete${totalMatching===1?"":"s"}</span></button>`;
 }).join("")||'<p class="muted">No matching entries found.</p>';
 count.textContent=`${visible.length} ${kind==="manufacturers"?"manufacturer":"race team"}${visible.length===1?"":"s"} shown${series?` · ${series}`:""}. Select a banner to view its athletes.`;
}
function combinedDirectoryInit(){
 const query=new URLSearchParams(location.search),kind=$("directoryKind");if(kind)kind.value=query.get("type")==="manufacturers"?"manufacturers":"race-teams";
 const series=$("directorySeries");if(series)series.replaceChildren(new Option("All series",""),...SECONDARY_SERIES_OPTIONS.map(value=>new Option(value,value)));
 populateDirectoryEntityFilter();
 ["directoryKind","directoryEntity","directorySeries"].forEach(id=>$(id)?.addEventListener("change",()=>{
  if(id==="directoryKind"){
   const nextKind=$("directoryKind").value;
   const entitySelect=$("directoryEntity");if(entitySelect)entitySelect.value="";
   const params=new URLSearchParams(location.search);if(nextKind==="manufacturers")params.set("type","manufacturers");else params.delete("type");history.replaceState(null,"",location.pathname+(params.toString()?`?${params}`:""));
   populateDirectoryEntityFilter();
  }
  renderCombinedDirectory();
 }));
 $("directorySearch")?.addEventListener("input",renderCombinedDirectory);
 $("directoryMenu")?.addEventListener("click",event=>{
  const button=event.target.closest("[data-directory-key]");if(!button)return;
  const select=$("directoryEntity");if(select){select.value=button.dataset.directoryKey;}
  renderCombinedDirectory();
 });
 $("directoryBack")?.addEventListener("click",()=>{const select=$("directoryEntity");if(select)select.value="";renderCombinedDirectory()});
 renderCombinedDirectory();
}
const SITE_TIME_ZONE="America/Vancouver";
function vancouverParts(date=new Date()){
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:SITE_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date);
 return Object.fromEntries(parts.filter(part=>part.type!=="literal").map(part=>[part.type,Number(part.value)]));
}
function localDateISO(){const p=vancouverParts();return `${p.year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`}
function parseVancouverDateTime(value){
 const raw=clean(value);if(!raw)return new Date(NaN);
 const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
 if(!m||/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw))return new Date(raw);
 const desired=Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]),Number(m[6]||0));
 let guess=desired;
 for(let i=0;i<5;i++){
  const p=vancouverParts(new Date(guess));
  const represented=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
  const delta=desired-represented;if(!delta)break;guess+=delta;
 }
 return new Date(guess);
}
function formatVancouverDateTime(value){const date=parseVancouverDateTime(value);if(Number.isNaN(date.getTime()))return clean(value)||"—";const day=new Intl.DateTimeFormat("en-US",{timeZone:SITE_TIME_ZONE,month:"long",day:"numeric",year:"numeric"}).format(date);const time=new Intl.DateTimeFormat("en-US",{timeZone:SITE_TIME_ZONE,hour:"numeric",minute:"2-digit",hour12:true}).format(date);return `${day}, ${time}`}
function vancouverDateTimeInputValue(value){const date=parseVancouverDateTime(value);if(Number.isNaN(date.getTime()))return "";const p=vancouverParts(date);return `${p.year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}T${String(p.hour).padStart(2,"0")}:${String(p.minute).padStart(2,"0")}`}
function formatVancouverDate(value){const date=value instanceof Date?value:parseVancouverDateTime(value);if(Number.isNaN(date.getTime()))return "—";return new Intl.DateTimeFormat("en-US",{timeZone:SITE_TIME_ZONE,month:"long",day:"numeric",year:"numeric"}).format(date)}
function formatScheduleDate(value){const raw=clean(value);if(!raw)return "—";const match=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);const date=match?new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]),12)):parseVancouverDateTime(raw);if(Number.isNaN(date.getTime()))return raw;return new Intl.DateTimeFormat("en-US",{timeZone:SITE_TIME_ZONE,month:"long",day:"numeric",year:"numeric"}).format(date)}
function eventDateLabel(e){const start=clean(e?.date),end=clean(e?.endDate)||start;if(!start)return "—";const first=formatScheduleDate(start),last=formatScheduleDate(end);return end&&end!==start?`${first} – ${last}`:first}
function eventCountryHTML(e){return e?.country?nationalityHTML(e.country,e.region):'<span class="muted">Not set</span>'}
const EVENT_TYPE_OPTIONS={SMX:["Supercross","Motocross","SMX"],"Triple Crown Series":["Stage 1","Stage 2","Stage 3"],MXGP:["Grand Prix"],MotoGP:["Grand Prix"],F1:["Sprint","Grand Prix"]};
function eventTypeLabel(event){let type=clean(event?.eventType),detail=clean(event?.eventTypeDetail);if(type==="East/West"){type="Supercross";detail="East/West"}if(!type)return "—";return type==="Supercross"&&detail?`Supercross ${detail}`:type}
function updateEventTypeFields(series,selectedType="",selectedDetail=""){
 const typeField=$("eventSubTypeField"),typeSelect=$("eventSubType"),detailField=$("eventSubTypeDetailField"),detailSelect=$("eventSubTypeDetail");
 if(!typeField||!typeSelect||!detailField||!detailSelect)return;
 if(series==="SMX"&&selectedType==="East/West"){selectedType="Supercross";selectedDetail="East/West"}
 const choices=EVENT_TYPE_OPTIONS[series]||[];
 typeSelect.replaceChildren(new Option("No secondary event type",""),...choices.map(value=>new Option(value,value)));
 typeField.hidden=!choices.length;typeSelect.value=choices.includes(selectedType)?selectedType:"";
 const needsEastWest=series==="SMX"&&typeSelect.value==="Supercross";
 detailField.hidden=!needsEastWest;detailSelect.required=needsEastWest;
 const detailLabel=$("eventSubTypeDetailLabel");if(detailLabel)detailLabel.textContent="Supercross Division";
 if(needsEastWest){
  detailSelect.replaceChildren(new Option("Choose East, West, or East/West…",""),new Option("East","East"),new Option("West","West"),new Option("East/West","East/West"));
  detailSelect.value=["East","West","East/West"].includes(selectedDetail)?selectedDetail:"";
 }else{detailSelect.replaceChildren(new Option("Choose…",""));detailSelect.value=""}
}
function resetScheduleEditor(){
 const form=$("scheduleForm");if(!form)return;
 form.reset();$("editEventId").value="";$("eventEndDate").min="";populateRegionSelect($("eventRegion"),$("eventCountry"));updateEventTypeFields($("eventSeries")?.value||"SMX");if($("scheduledEventToEdit"))$("scheduledEventToEdit").value="";if($("loadScheduledEventEdit"))$("loadScheduledEventEdit").disabled=true;
 $("scheduleFormTitle").textContent="Add Schedule Event";$("scheduleSubmitButton").textContent="Add Event";$("cancelEditEvent").hidden=true;
}
function beginEditEvent(eventId){
 activateCommissionerTab("schedule");
 const event=read(K.CAL,[]).find(item=>String(item.id)===String(eventId));if(!event)return;
 $("editEventId").value=String(event.id);if($("scheduledEventToEdit"))$("scheduledEventToEdit").value=String(event.id);if($("loadScheduledEventEdit"))$("loadScheduledEventEdit").disabled=false;$("eventName").value=clean(event.name);$("eventSeries").value=eventRoom(event.series);updateEventTypeFields($("eventSeries").value,clean(event.eventType),clean(event.eventTypeDetail));$("eventDate").value=clean(event.date);$("eventEndDate").value=clean(event.endDate)&&event.endDate!==event.date?clean(event.endDate):"";$("eventEndDate").min=clean(event.date);$("eventRound").value=clean(event.round);$("eventLocation").value=clean(event.location);$("eventCountry").value=normalizeNationality(event.country);populateRegionSelect($("eventRegion"),$("eventCountry"),event.region);
 $("scheduleFormTitle").textContent="Edit Schedule Event";$("scheduleSubmitButton").textContent="Save Event Changes";$("cancelEditEvent").hidden=false;$("scheduleMessage").textContent=`Editing ${clean(event.name)||"event"}. Saving updates this event rather than creating a duplicate.`;$("scheduleEditorPanel").scrollIntoView({behavior:"smooth",block:"start"});
}
function saveScheduleEvent(e){
 e.preventDefault();const start=clean($("eventDate").value),end=clean($("eventEndDate").value)||start,msg=$("scheduleMessage"),country=normalizeNationality($("eventCountry").value),region=normalizeRegion(country,$("eventRegion").value),eventId=clean($("editEventId").value);
 if(!country){msg.textContent="Select the event country.";return}
 if(!start){msg.textContent="Choose an event start date.";return}
 if(end<start){msg.textContent="End date must be on or after the event start date.";return}
 const round=clean($("eventRound").value);if(!/^\d+$/.test(round)||Number(round)<1){msg.textContent="Round number must be a positive whole number.";return}
 const eventSeries=$("eventSeries").value,eventType=clean($("eventSubType")?.value),eventTypeDetail=clean($("eventSubTypeDetail")?.value);
 if(eventSeries==="SMX"&&eventType==="Supercross"&&!eventTypeDetail){msg.textContent="Choose East, West, or East/West for a Supercross event.";return}
 const list=read(K.CAL,[]),eventData={name:clean($("eventName").value),series:eventSeries,eventType,eventTypeDetail:eventType==="Supercross"?eventTypeDetail:"",round:Number(round),date:start,endDate:end,location:clean($("eventLocation").value),country,region};
 if(!eventData.name){msg.textContent="Event name is required.";return}
 if(eventId){const index=list.findIndex(item=>String(item.id)===eventId);if(index<0){msg.textContent="That event could not be found. Refresh and try again.";return}list[index]={...list[index],...eventData};write(K.CAL,list);msg.textContent=`Updated ${eventData.name}.`;}
 else{list.push({id:uid(),...eventData});write(K.CAL,list);msg.textContent=`Added ${eventData.name}.`;}
 resetScheduleEditor();renderCommSchedule();renderSchedule();renderScoreScheduleOptions();renderRosterLockNotice(document.body.dataset.page);
}

function scheduleSeriesBadge(series){const value=eventRoom(series),tone=({SMX:"smx",F1:"f1",MXGP:"mxgp",MotoGP:"motogp",MXON:"mxon","Triple Crown Series":"triple-crown"})[value]||"other";return `<span class="schedule-series-badge schedule-series-${tone}">${esc(value)}</span>`}
function activeRosterLockEvents(){const today=localDateISO();return read(K.CAL,[]).filter(e=>{const start=clean(e.date),end=clean(e.endDate)||start;return !!start&&!!end&&start<=today&&today<=end}).sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")))}
function renderRosterLockNotice(page){const events=activeRosterLockEvents(),panel=$("rosterLockNotice");if(!events.length){if(panel){panel.hidden=true;panel.innerHTML=""}return false}if(panel){panel.hidden=false;panel.innerHTML=`<h2>Roster Lock Active</h2><p>Team management and the Trade Center are locked for today because an event is scheduled. Roster moves, trade proposals, and trade responses reopen after the event day ends.</p><p><strong>Today’s event${events.length===1?"":"s"}:</strong></p><ul>${events.map(e=>`<li>${esc(clean(e.name)||"Unnamed event")} · ${esc(eventRoom(e.series))}${clean(e.round)?` · Round ${esc(e.round)}`:""} · ${esc(eventDateLabel(e))} · ${eventCountryHTML(e)}</li>`).join("")}</ul>`}if(page==="manage"){$("manageLogin").hidden=true;$("manageBody").hidden=true}if(page==="trades"){$("tradeLogin").hidden=true;$("tradeBody").hidden=true}return true}
function openTeamManagePanel(teamKey=""){const panel=$("teamManagePanel"),currentKey=sessionStorage.getItem("managedTeam"),teamSelect=$("manageTeam");if(teamKey){if(currentKey!==teamKey){sessionStorage.removeItem("managedTeam");$("manageBody").hidden=true;$("manageLogin").hidden=false}if(teamSelect)teamSelect.value=teamKey;if($("managePassword"))$("managePassword").value="";if($("manageMessage"))$("manageMessage").textContent=""}if(panel)panel.hidden=false;const params=new URLSearchParams(location.search);params.delete("team");params.set("manage","1");history.replaceState(null,"",location.pathname+`?${params}`);panel?.scrollIntoView({behavior:"smooth",block:"start"})}
function setupManage(){const panel=$("teamManagePanel");options($("manageTeam"),teams().map(t=>({value:key(t),label:tname(t)})),"Choose a team");const query=new URLSearchParams(location.search),q=query.get("team");if(q){$("manageTeam").value=q;const existing=sessionStorage.getItem("managedTeam");if(existing&&existing!==q)sessionStorage.removeItem("managedTeam")}const saved=sessionStorage.getItem("managedTeam"),requested=!!q||!!saved||query.get("manage")==="1";if(panel)panel.hidden=!requested;$("manageLoginForm").onsubmit=async e=>{e.preventDefault();if(panel)panel.hidden=false;if(renderRosterLockNotice("manage"))return;const t=teams().find(t=>key(t)===$("manageTeam").value);if(!t||!t.passwordHash||await hash($("managePassword").value)!==t.passwordHash){$("manageMessage").textContent="Incorrect password, or this team has not been claimed.";return}sessionStorage.setItem("managedTeam",key(t));showManage(key(t))};$("addRosterForm").onsubmit=e=>{e.preventDefault();if(renderRosterLockNotice("manage"))return;const k=sessionStorage.getItem("managedTeam"),t=teams().find(t=>key(t)===k),a=athletes().find(a=>id(a)===$("freeAgent").value);if(!t||!a||owner(a)){$("rosterMessage").textContent="Choose a current free agent.";return}if(roster(t).length>=MAX_ROSTER_SIZE||counts(t)[cls(a)]>=REQ[cls(a)]){$("rosterMessage").textContent="That team has no open roster spot for this series.";return}t.roster.push({...a});saveTeams(teams().map(x=>key(x)===k?t:x));$("rosterMessage").textContent="Athlete added.";showManage(k);refresh()};$("manageLogout").onclick=()=>{sessionStorage.removeItem("managedTeam");$("manageBody").hidden=true;$("manageLogin").hidden=false;if(panel)panel.hidden=true;history.replaceState(null,"",location.pathname)};if(renderRosterLockNotice("manage"))return;const k=sessionStorage.getItem("managedTeam");if(k&&teams().some(t=>key(t)===k))showManage(k);else{$("manageLogin").hidden=false;$("manageBody").hidden=true}}

function renderTeamTradeAlerts(k){
 const panel=$("teamTradeAlerts");if(!panel)return;
 const relevant=read(K.TR,[]).filter(tr=>tr.fromKey===k||tr.toKey===k);
 const pendingSent=relevant.filter(tr=>tr.fromKey===k&&tr.status==="Pending");
 const pendingReceived=relevant.filter(tr=>tr.toKey===k&&tr.status==="Pending");
 // An accepted/rejected result is a one-time notification for the team that sent it.
 // It stays visible on Team Management until that team opens its Trade Center.
 const answered=relevant.filter(tr=>tr.fromKey===k&&["Accepted","Rejected"].includes(tr.status)&&!tr.responseViewedAt).sort((a,b)=>String(b.respondedAt||b.createdAt||"").localeCompare(String(a.respondedAt||a.createdAt||"")));
 const link=`<a href="trades.html?team=${encodeURIComponent(k)}">View Trade Center</a>`;
 const alerts=[];
 if(pendingReceived.length){
  const senders=[...new Set(pendingReceived.map(tr=>clean(tr.fromName)||"another team"))];
  const summary=pendingReceived.length===1?`A trade proposal from ${esc(senders[0])} needs your response.`:`You have ${pendingReceived.length} trade proposals waiting for your response (${senders.map(esc).join(", ")}).`;
  alerts.push(`<div class="team-trade-alert needs-response"><div><strong>Trade response needed</strong><span>${summary}</span></div>${link}</div>`);
 }
 if(pendingSent.length){
  const recipients=[...new Set(pendingSent.map(tr=>clean(tr.toName)||"another team"))];
  const summary=pendingSent.length===1?`Your trade request to ${esc(recipients[0])} has been sent and is awaiting an answer.`:`You have sent ${pendingSent.length} trade requests that are awaiting answers (${recipients.map(esc).join(", ")}).`;
  alerts.push(`<div class="team-trade-alert sent"><div><strong>Trade request sent</strong><span>${summary}</span></div>${link}</div>`);
 }
 answered.forEach(tr=>{
  const status=tr.status==="Accepted"?"accepted":"rejected";
  alerts.push(`<div class="team-trade-alert answered"><div><strong>Trade request ${status}</strong><span>Your trade request to ${esc(clean(tr.toName)||"another team")} was ${status}.</span></div>${link}</div>`);
 });
 panel.innerHTML=alerts.join("");panel.hidden=alerts.length===0;
}
function showManage(k){if($("teamManagePanel"))$("teamManagePanel").hidden=false;if(renderRosterLockNotice("manage"))return;const t=teams().find(t=>key(t)===k);if(!t)return;$("manageLogin").hidden=true;$("manageBody").hidden=false;$("manageTitle").textContent=tname(t);renderTeamTradeAlerts(k);$("managedSummary").innerHTML=`<div><strong>${roster(t).length}/${MAX_ROSTER_SIZE}</strong><span>Roster spots</span></div><div><strong>${total(t).toLocaleString()}</strong><span>Season points</span></div><div><strong>${esc(t.owner||"Owner")}</strong><span>Team owner</span></div>`;$("teamQuota").innerHTML=quota(t);options($("freeAgent"),sortRiders(athletes().filter(a=>!a.seriesArchived&&SERIES.includes(cls(a))&&!owner(a))).map(a=>({value:id(a),label:`${nationalityText(a.nationality,a.nationalityRegion)} #${clean(athleteNumberForSeries(a,cls(a))||"—")} ${name(a)} — ${seriesDisplayText(a)}`})),"Choose a free agent");$("managedRoster").innerHTML=table(["Athlete","Series","Manufacturer","Action"],sortRiders(roster(t)).map(a=>`<tr><td>${athleteDetailButtonHTML(a)}</td><td>${seriesDisplayHTML(a)}</td><td>${brandBadge(a.manufacturer||"—")}</td><td><button class="inline" data-drop="${esc(id(a))}">Drop</button></td></tr>`));$("managedRoster").querySelectorAll("[data-drop]").forEach(b=>b.onclick=()=>{if(renderRosterLockNotice("manage"))return;if(confirm("Drop this athlete?")){if(renderRosterLockNotice("manage"))return;t.roster=t.roster.filter(a=>id(a)!==b.dataset.drop);saveTeams(teams().map(x=>key(x)===k?t:x));showManage(k);refresh()}});$("managedScores").innerHTML=table(["Place","Athlete","Event / Round","Bonuses","Points","Recorded"],scores().filter(s=>String(s.teamKey)===k).slice().sort(compareScoreRiders).map(s=>`<tr><td>${s.place?esc(s.place):"—"}</td><td>${athleteNameHTML(riderFromRecord(s),true,true,s.division||s.riderClass,s.riderNumber)}</td><td>${scoreEventLabel(s)}</td><td>${bonusText(s)}</td><td class="points">${Number(s.points||0)}</td><td>${formatVancouverDateTime(s.recordedAt).split(", ").slice(0,2).join(", ")}</td></tr>`))}
function selectedScoreScheduleEvent(){const eventId=$("scoreScheduleEvent")?.value;return eventId?read(K.CAL,[]).find(event=>String(event.id)===String(eventId))||null:null}
function scoreClasses(series){return series==="MXON"?["MXON"]:[...(SERIES_GROUPS[series]||[series])]}
function scoreBonusConfig(series,division=""){
 if(series==="MXGP")return [["fastestLap","Fastest lap",1]];
 if(series==="Triple Crown Series")return scoringPhase==="Moto 1"?[["fastestQualifier","Fastest qualifier",2],["fastestLap","Fastest lap",1]]:[["fastestLap","Fastest lap",1]];
 if(series==="MotoGP"||series==="F1")return GRAND_PRIX_BONUSES;
 return SCORE_BONUSES.SMX;
}
function athleteEligibleForScoring(a,series,division){
 if(!a)return false;
 if(series==="MXON"){
  const affiliations=new Set(Array.isArray(a.secondarySeries)?a.secondarySeries:[]);
  const allowedByPhase={
   "MX2 Qualifying Race":["MXON MX2"],
   "MXGP Qualifying Race":["MXON MXGP"],
   "Open Qualifying Race":["MXON Open"],
   "Moto 1":["MXON MXGP","MXON MX2"],
   "Moto 2":["MXON MX2","MXON Open"],
   "Moto 3":["MXON MXGP","MXON Open"]
  }[scoringPhase]||[];
  return allowedByPhase.some(item=>affiliations.has(item));
 }
 return hasAthleteSeries(a,division)
}
function scoreEventLabel(s){let base=esc(clean(s?.event)||"—");if(s?.round!==undefined&&s?.round!==null&&clean(s.round)!=="")base+=` · Round ${esc(s.round)}`;if(clean(s?.scoringPhase))base+=` · ${esc(s.scoringPhase)}`;return base}
function bonusText(s){return Array.isArray(s?.bonuses)&&s.bonuses.length?s.bonuses.map(esc).join(", "):"—"}
function currentSmxEventType(){const selected=clean($("scoreSmxEventType")?.value||"SMX");return selected==="East/West"?"Supercross":selected}
function smxEventFormatFromSchedule(event){const type=clean(event?.eventType);return type==="East/West"?"Supercross":(["Supercross","Motocross","SMX"].includes(type)?type:"SMX")}
function scorePhaseOptions(){
 const series=$("scoreSeries")?.value||"SMX",scheduled=selectedScoreScheduleEvent();
 if(series==="SMX"&&currentSmxEventType()==="Motocross")return ["Moto 1","Moto 2"];
 if(series==="Triple Crown Series")return ["Moto 1","Moto 2"];
 if(series==="MXGP")return ["Qualifying Race","Moto 1","Moto 2"];
 if(series==="MXON")return ["MX2 Qualifying Race","MXGP Qualifying Race","Open Qualifying Race","Moto 1","Moto 2","Moto 3"];
 if(series==="MotoGP")return ["Grand Prix","Sprint"];
 if(series==="F1"&&clean(scheduled?.eventType)==="Sprint")return ["Grand Prix","Sprint"];
 return [];
}
function normalizeScoringPhase(){
 const series=$("scoreSeries")?.value||"SMX",phases=scorePhaseOptions();
 if(phases.length){if(!phases.includes(scoringPhase))scoringPhase=phases[0]}
 else scoringPhase=series==="F1"?"Grand Prix":"";
}
function scoreFormatConfig(){
 const series=$("scoreSeries")?.value||"SMX",scheduled=selectedScoreScheduleEvent();
 if(series==="SMX"){
  const eventType=currentSmxEventType();
  if(eventType==="Supercross"){
   const tripleCrown=$("scoreSmxSupercrossFormat")?.value==="Triple Crown";
   const bonuses=tripleCrown
    ?[["fastestQualifier","Fastest qualifier",2],["race1Winner","Race 1 winner",3],["race2Winner","Race 2 winner",3],["race3Winner","Race 3 winner",3],["race1FastestLap","Race 1 fastest lap",1],["race2FastestLap","Race 2 fastest lap",1],["race3FastestLap","Race 3 fastest lap",1]]
    :[["fastestQualifier","Fastest qualifier",2],["heatWinner","Heat winner",3],["fastestLap","Fastest lap",1]];
   return {eventType,phase:"",rowCount:20,positionPoints:SX_MX_POSITION_POINTS,multiplier:1,supercrossScoringFormat:tripleCrown?"Triple Crown":"Standard",bonuses};
  }
  if(eventType==="Motocross")return {eventType,phase:scoringPhase,rowCount:40,positionPoints:MOTOCROSS_POSITION_POINTS,multiplier:1,bonuses:scoringPhase==="Moto 1"?[["fastestQualifier","Fastest qualifier",2],["fastestLap","Fastest lap",1]]:[["fastestLap","Fastest lap",1]]};
  const round=Number(clean($("scoreRound")?.value)||scheduled?.round||0),multiplier=round===2?2:round===3?3:1;
  return {eventType:"SMX",phase:"",rowCount:20,positionPoints:SX_MX_POSITION_POINTS,multiplier,bonuses:[["fastestQualifier","Fastest qualifier",2],["moto1FastestLap","Moto 1 fastest lap",1],["moto2FastestLap","Moto 2 fastest lap",1],["moto1Winner","Moto 1 winner",3],["moto2Winner","Moto 2 winner",3]]};
 }
 if(series==="MXON"){
  const phase=scorePhaseOptions().includes(scoringPhase)?scoringPhase:scorePhaseOptions()[0];
  const qualifying=phase.includes("Qualifying Race");
  const bonuses=qualifying
   ?[["fastestLap","Fastest lap",1],["nationFirstQualifying","Nation 1st Qualifying",3],["nationSecondQualifying","Nation 2nd Qualifying",2],["nationThirdQualifying","Nation 3rd Qualifying",1]]
   :[["fastestLap","Fastest lap",1],["nationFirst","Nation 1st",10],["nationSecond","Nation 2nd",5],["nationThird","Nation 3rd",3]];
  return {eventType:clean(scheduled?.eventType)||"MXON",phase,rowCount:40,positionPoints:qualifying?MXGP_QUALIFYING_RACE_POINTS:MOTOCROSS_POSITION_POINTS,multiplier:1,bonuses};
 }
 if(series==="Triple Crown Series"||series==="MXGP"){
  const phase=scorePhaseOptions().includes(scoringPhase)?scoringPhase:"Moto 1";
  if(series==="MXGP"&&phase==="Qualifying Race")return {eventType:clean(scheduled?.eventType)||"MXGP",phase,rowCount:40,positionPoints:MXGP_QUALIFYING_RACE_POINTS,multiplier:1,bonuses:[]};
  const bonuses=series==="MXGP"?[["fastestLap","Fastest lap",1]]:phase==="Moto 1"?[["fastestQualifier","Fastest qualifier",2],["fastestLap","Fastest lap",1]]:[["fastestLap","Fastest lap",1]];
  return {eventType:clean(scheduled?.eventType)||(series==="Triple Crown Series"?"Triple Crown Series":"MXGP"),phase,rowCount:40,positionPoints:MOTOCROSS_POSITION_POINTS,multiplier:1,bonuses};
 }
 if(series==="F1"||series==="MotoGP"){
  const phase=series==="F1"?(clean(scheduled?.eventType)==="Sprint"?(scorePhaseOptions().includes(scoringPhase)?scoringPhase:"Grand Prix"):"Grand Prix"):(scorePhaseOptions().includes(scoringPhase)?scoringPhase:"Grand Prix");
  const sprint=phase==="Sprint";
  const positionPoints=sprint?(series==="F1"?F1_SPRINT_POSITION_POINTS:MOTOGP_SPRINT_POSITION_POINTS):SMX_POSITION_POINTS;
  return {eventType:clean(scheduled?.eventType)||(series==="F1"?"Grand Prix":"Grand Prix"),phase,rowCount:22,positionPoints,multiplier:1,bonuses:GRAND_PRIX_BONUSES};
 }
 return {eventType:clean(scheduled?.eventType)||series,phase:"",rowCount:22,positionPoints:SMX_POSITION_POINTS,multiplier:1,bonuses:scoreBonusConfig(series,$("scoreClass")?.value||"")};
}
function updateScoreModeControls(){
 const smx=$("scoreSeries")?.value==="SMX",wrap=$("scoreSmxEventTypeWrap"),supercrossFormatWrap=$("scoreSmxSupercrossFormatWrap"),supercrossFormat=$("scoreSmxSupercrossFormat"),tabs=$("scoreMotoTabs"),note=$("scoreFormatInfo");
 if(wrap)wrap.hidden=!smx;
 const isSupercross=smx&&currentSmxEventType()==="Supercross";
 if(supercrossFormatWrap)supercrossFormatWrap.hidden=!isSupercross;
 if(!isSupercross&&supercrossFormat)supercrossFormat.value="Standard";
 normalizeScoringPhase();
 const phases=scorePhaseOptions();
 if(tabs){tabs.hidden=phases.length<2;tabs.innerHTML=phases.map(phase=>`<button aria-selected="${phase===scoringPhase?"true":"false"}" class="score-moto-tab ${phase===scoringPhase?"active":""}" data-score-phase="${esc(phase)}" role="tab" type="button">${esc(phase)}</button>`).join("");tabs.querySelectorAll("[data-score-phase]").forEach(button=>button.onclick=()=>{if(editingScoreGroupKey){$("scoreMessage").textContent="Finish or cancel the current scoring edit before switching scoring tabs.";return}scoringPhase=button.dataset.scorePhase;updateScoreModeControls();renderScoreEntryTable()})}
 const config=scoreFormatConfig();
 if(note){
  if(smx&&config.eventType==="Motocross")note.textContent=`${scoringPhase} scoring: 40 rider slots. Positions 21–40 receive 0 finish points but can still receive available bonuses.`;
  else if(smx&&config.eventType==="SMX"&&config.multiplier>1)note.textContent=`SMX Round ${clean($("scoreRound")?.value)||selectedScoreScheduleEvent()?.round}: finish and bonus points are multiplied by ${config.multiplier}.`;
  else if(smx&&config.eventType==="Supercross"&&config.supercrossScoringFormat==="Triple Crown")note.textContent="Triple Crown Supercross scoring: 20 rider slots. Bonuses: fastest qualifier +2; Race 1, Race 2, and Race 3 winner +3 each; Race 1, Race 2, and Race 3 fastest lap +1 each.";
  else if(smx&&config.eventType==="Supercross")note.textContent="Supercross scoring: 20 rider slots; fastest qualifier +2, heat winner +3, fastest lap +1.";
  else if(smx&&config.eventType==="SMX")note.textContent="SMX scoring: 20 rider slots. Round 2 points are doubled and Round 3 points are tripled.";
  else if($("scoreSeries")?.value==="MXGP"&&scoringPhase==="Qualifying Race")note.textContent="MXGP Qualifying Race: 10 points for 1st, decreasing by 1 point per position through 10th; 0 points for 11th–40th. No bonus points are applied.";
  else if($("scoreSeries")?.value==="MXON")note.textContent=scoringPhase.includes("Qualifying Race")?"MXON qualifying race: 10 points for 1st, decreasing by 1 point per place through 10th; 0 points for 11th–40th. Bonuses remain: fastest lap +1, Nation 1st Qualifying +3, Nation 2nd Qualifying +2, Nation 3rd Qualifying +1. Only athletes affiliated with the selected MXON class are available.":"MXON moto: 40 rider slots using MXGP moto finish points. Bonuses: fastest lap +1, Nation 1st +10, Nation 2nd +5, Nation 3rd +3. Only athletes affiliated with either selected MXON class are available.";
  else if(["Triple Crown Series","MXGP"].includes($("scoreSeries")?.value))note.textContent=$("scoreSeries")?.value==="MXGP"?`${scoringPhase} scoring: 40 rider slots. Positions 21–40 receive 0 finish points. Fastest lap +1.`:`${scoringPhase} scoring: 40 rider slots. Positions 21–40 receive 0 finish points. Moto 1 bonuses: fastest qualifier +2 and fastest lap +1; Moto 2 bonus: fastest lap +1.`;
  else if($("scoreSeries")?.value==="F1")note.textContent=config.phase==="Sprint"?"F1 Sprint: 8 points for 1st through 1 point for 8th; 0 points for 9th–22nd. Fastest qualifier +3 and fastest lap +1.":"F1 Grand Prix: standard 22-position points. Fastest qualifier +3 and fastest lap +1.";
  else if($("scoreSeries")?.value==="MotoGP")note.textContent=config.phase==="Sprint"?"MotoGP Sprint: 12, 9, 7 points for the top three, then 1 point less per place through 9th; 0 points for 10th–22nd. Fastest qualifier +3 and fastest lap +1.":"MotoGP Grand Prix: standard 22-position points. Fastest qualifier +3 and fastest lap +1.";
  else note.textContent="Select riders by finish position. Bonus checkboxes are independent for each rider, so bonuses can be assigned to multiple riders or left unused.";
 }
}
function updateScoreClass(){const series=$("scoreSeries")?.value||"SMX",sel=$("scoreClass");if(!sel)return;const prior=sel.value,classes=scoreClasses(series);options(sel,classes.map(c=>({value:c,label:c})),"Choose class / group");sel.value=classes.includes(prior)?prior:classes[0];renderScoreScheduleOptions();updateScoreModeControls();renderScoreEntryTable()}
function renderScoreScheduleOptions(){const sel=$("scoreScheduleEvent");if(!sel)return;const chosen=sel.value,series=$("scoreSeries")?.value||"SMX",list=read(K.CAL,[]).filter(e=>eventRoom(e.series)===series).slice().sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")));options(sel,list.map(e=>({value:String(e.id),label:`${clean(e.round)?`Round ${e.round} · `:""}${eventTypeLabel(e)!=="—"?`${eventTypeLabel(e)} · `:""}${clean(e.name)||"Unnamed event"}${e.date?` — ${eventDateLabel(e)}`:""}${e.country?` · ${countryRegionLabel(e.country,e.region)}`:""}`})),"Choose a scheduled event (optional)");if(list.some(e=>String(e.id)===chosen))sel.value=chosen}
function currentScoringScope(config=scoreFormatConfig()){
 const series=canonicalScoreSeries($("scoreSeries")?.value||"SMX"),scheduled=selectedScoreScheduleEvent();
 return {series,division:$("scoreClass")?.value||"",event:clean($("scoreEvent")?.value),round:clean($("scoreRound")?.value),eventType:config.eventType||"",scoringPhase:config.phase||"",scheduledEventId:scheduled?String(scheduled.id):""};
}
function scoreScopeMatchesRecord(record,scope){
 const recordSeries=canonicalScoreSeries(record?.series||eventRoom(record?.riderClass||record?.division||""));
 if(norm(recordSeries)!==norm(scope.series))return false;
 const recordDivision=norm(record?.division||record?.riderClass||"");
 if(recordDivision&&recordDivision!==norm(scope.division))return false;
 const recordType=norm(record?.eventType||"");
 if(recordType&&recordType!==norm(scope.eventType||""))return false;
 if(norm(record?.scoringPhase||"")!==norm(scope.scoringPhase||""))return false;
 const recordScheduledId=clean(record?.scheduledEventId),currentScheduledId=clean(scope.scheduledEventId);
 if(recordScheduledId&&currentScheduledId)return recordScheduledId===currentScheduledId;
 return norm(record?.event||"")===norm(scope.event||"")&&clean(record?.round)===clean(scope.round);
}
function scoredRecordAthleteId(record){
 const storedId=clean(record?.riderId);if(storedId)return storedId;
 const recordName=norm(record?.riderName||record?.athleteName),recordClass=norm(record?.riderClass||record?.division||"");
 const match=athletes().find(a=>norm(name(a))===recordName&&(!recordClass||norm(cls(a))===recordClass));
 return match?id(match):"";
}
function alreadyScoredAthleteIds(scope,excludeGroupKey=""){
 return new Set(scores().filter(record=>scoreScopeMatchesRecord(record,scope)&&(!excludeGroupKey||scoreGroupKey(record)!==excludeGroupKey)).map(scoredRecordAthleteId).filter(Boolean));
}
function scoringAthletesForSelectedClass(){
 const series=$("scoreSeries")?.value||"SMX",division=$("scoreClass")?.value||"",scope=currentScoringScope(),blockedIds=alreadyScoredAthleteIds(scope,editingScoreGroupKey||"");
 const eligible=athletes().filter(a=>athleteEligibleForScoring(a,series,division)&&!blockedIds.has(id(a)));
 if(editingScoreGroupKey){
  const priorIds=new Set(scores().filter(s=>scoreGroupKey(s)===editingScoreGroupKey).map(scoredRecordAthleteId));
  athletes().filter(a=>priorIds.has(id(a))&&!blockedIds.has(id(a))).forEach(a=>{if(!eligible.some(x=>id(x)===id(a)))eligible.push(a)});
 }
 return sortRiders(eligible);
}
function syncScoreRiderOptions(){
 const selects=[...document.querySelectorAll("#scoreEntryTable .score-rider-select")],chosen=new Set(selects.map(select=>select.value).filter(Boolean));
 selects.forEach(select=>[...select.options].forEach(option=>{if(option.value)option.disabled=chosen.has(option.value)&&select.value!==option.value}));
}
function renderScoreEntryTable(){
 const el=$("scoreEntryTable");if(!el)return;
 const series=$("scoreSeries")?.value||"SMX",division=$("scoreClass")?.value||"",config=scoreFormatConfig(),bonuses=config.bonuses,list=scoringAthletesForSelectedClass();
 const athleteOptions='<option value="">Select athlete…</option>'+list.map(a=>{const t=owner(a),label=`${nationalityText(a.nationality,a.nationalityRegion)} #${clean(athleteNumberForSeries(a,division))||"—"} ${name(a)} — ${t?tname(t):"Free agent"} · ${seriesDisplayText(a)}`;return `<option value="${esc(id(a))}">${esc(label)}</option>`}).join("");
 const rows=Array.from({length:config.rowCount},(_,i)=>{const place=i+1,base=(config.positionPoints[i]||0)*config.multiplier,checks=bonuses.map(([key,label,points=2])=>`<td class="score-bonus-cell"><label class="score-bonus"><input type="checkbox" data-bonus="${key}" data-points="${points}" aria-label="${esc(label)} (${points} points) bonus for position ${place}"><span>${esc(label)} (+${points})</span></label></td>`).join("");return `<tr data-score-row="${place}" data-base-points="${base}" data-multiplier="${config.multiplier}"><td class="score-place">${place}</td><td><select class="score-rider-select" data-place="${place}" aria-label="Athlete in position ${place}">${athleteOptions}</select></td><td class="points score-base">${base}</td>${checks}<td class="score-bonus-points">0</td><td class="points score-total">${base}</td></tr>`});
 const headers=['Place','Athlete','Finish pts',...bonuses.map(([,label,points=2])=>`${label} (+${points})`),'Bonus pts','Total'];
 el.innerHTML=table(headers,rows);el.querySelectorAll('[data-bonus],.score-rider-select').forEach(input=>input.addEventListener('change',()=>{updateScoreRow(input.closest('tr'));if(input.matches('.score-rider-select'))syncScoreRiderOptions()}));el.querySelectorAll('tr[data-score-row]').forEach(updateScoreRow);syncScoreRiderOptions();
 const title=$("scoreEntryHeading");if(title)title.textContent=config.phase?`${config.phase} Results`:`${config.eventType||series} Results`;
}
function updateScoreRow(row){if(!row)return;const bonus=[...row.querySelectorAll('[data-bonus]:checked')].reduce((sum,input)=>sum+Number(input.dataset.points||2),0)*Number(row.dataset.multiplier||1),base=Number(row.dataset.basePoints||0);const bp=row.querySelector('.score-bonus-points'),total=row.querySelector('.score-total');if(bp)bp.textContent=String(bonus);if(total)total.textContent=String(base+bonus);row.classList.toggle('score-row-selected',!!row.querySelector('.score-rider-select')?.value)}
const OFFICIAL_RESULT_SOURCES={
 SMX:{url:"https://www.supermotocross.com/results",help:"Use the official SuperMotocross results archive. Select the scheduled event and 250 or 450 class, then select its Main Event link. For Standard Supercross, the importer also fetches that class's Heat 1, Heat 2 and Combined Qualifying pages: heat winners are matched to the Main Event grid, Combined Qualifying P1 supplies Fastest Qualifier, and the Main Event Best Lap (Lap #) column supplies Fastest Lap. Triple Crown events keep their separate Race 1/2/3 bonuses and do not use the standard heat lookups. The importer checks the official page heading and table class before loading riders. CSV uploads require Position and Rider columns; Number, Team and Best Lap are optional."},
 "Triple Crown Series":{url:"https://triplecrownseries.ca/results",help:"Use the official Triple Crown Series results archive. The importer matches the selected scheduled event, year, round and venue, then reads its Full Event Results table. Choose CAN 250 or CAN 450 and Moto 1 or Moto 2; the importer ranks riders from the matching Moto column, not the overall-round position or championship standings."},
 MXGP:{url:"https://results.mxgp.com/mxgp/standings.aspx",help:"Use the official Infront Moto Racing Standings page. The importer automatically selects Championship = FIM Motocross World Championship, then Class = MXGP or MX2, then the matching Grand Prix of … round, then Qualifying Race, Grand Prix Race 1 (Moto 1), or Grand Prix Race 2 (Moto 2). It ignores old filter parameters in any pasted reslists.aspx URL and always makes fresh selections from the current Commissioner event, class, and scoring segment. Results and Bestlaptime values are read from that exact classification; the rider with the quickest valid Bestlaptime is preselected for the +1 Fastest Lap bonus. Make sure the Commissioner event name or venue matches the official Grand Prix round."},
 MXON:{url:"https://results.mxgp.com/reslists.aspx",help:"Use the official Infront Moto Racing results portal. Select the Motocross of Nations event and exact classification (MX2 / MXGP / Open Qualifying Race or Moto 1 / 2 / 3). Copy the resulting reslists.aspx URL, including its query string, into this field before fetching. The importer checks the official classification heading against the selected class/session where the source provides it."},
 F1:{url:"https://www.formula1.com/en/results",help:"Use the official Formula 1 season results archive. Select the scheduled Grand Prix and the Grand Prix or Sprint scoring tab first. Pasting this archive link follows the selected event to its Race Result or Sprint page, then fetches the matching Qualifying or Sprint Qualifying page to identify the fastest qualifier. Grand Prix imports also fetch the official Fastest Laps page. Drivers marked NC are retained in the official displayed order after classified drivers."},
 MotoGP:{url:"https://www.motogp.com/en/gp-results/",help:"Use the official MotoGP results archive. The importer matches the scheduled Grand Prix by season, round, event name and date, then reads the official MotoGP Race (RAC) or Sprint (SPR) classification according to the selected scoring tab. Classified riders are followed by all Non-classified / DNF riders in the official order shown by MotoGP. The separate Q2 session classification supplies the fastest-qualifier bonus, and the selected RAC / SPR session's Fast Lap Rider PDF supplies the fastest-lap bonus."}
};
let officialImportRows=[],officialImportMeta=null,officialImportScopeSnapshot=null;
function officialImportScope(){return JSON.stringify(currentScoringScope())}
function officialSourceInfo(){return OFFICIAL_RESULT_SOURCES[$("scoreSeries")?.value||"SMX"]||OFFICIAL_RESULT_SOURCES.SMX}
function renderOfficialSourceHelp(){
 const series=$("scoreSeries")?.value||"SMX",source=officialSourceInfo(),link=$("officialResultsSourceLink"),help=$("officialResultsSourceHelp"),urlInput=$("officialResultsUrl");
 if(link){link.href=source.url;link.textContent="Open official results source ↗"}
 if(help)help.textContent=source.help+" CSV columns required: Position and Rider (or Driver); Number, Team and Best Lap are optional.";
 if(urlInput)urlInput.placeholder=series==="F1"?"https://www.formula1.com/en/results or a direct F1 session result link":series==="SMX"?"https://www.supermotocross.com/results or a direct class/session result link":series==="Triple Crown Series"?"https://triplecrownseries.ca/results or a direct year/event page":series==="MXGP"?"https://results.mxgp.com/mxgp/standings.aspx (filters selected automatically)":series==="MXON"?"https://results.mxgp.com/reslists.aspx?… (direct selected classification URL)":"https://www.motogp.com/en/gp-results/";
 // Prefill each series with its official source, without overwriting a URL typed by the commissioner.
 if(urlInput){
  const previousAuto=clean(urlInput.dataset.autoSourceUrl),current=clean(urlInput.value);
  if(!current||current===previousAuto){
   const next=source.url;
   urlInput.value=next;
   urlInput.dataset.autoSourceUrl=next;
  }
 }
}
function normalizeImportedRiderName(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"")}
function importedAthleteNumber(value){return String(value??"").replace(/[^0-9]/g,"").replace(/^0+(?=\d)/,"")}
function matchOfficialResultAthlete(row){
 const series=$("scoreSeries")?.value||"SMX",division=$("scoreClass")?.value||"",eligible=athletes().filter(a=>athleteEligibleForScoring(a,series,division));
 const seriesNumber=a=>athleteNumberForSeries(a,division||cls(a));
 const sourceName=normalizeImportedRiderName(row.name),sourceNumber=importedAthleteNumber(row.number);
 const byName=sourceName?eligible.filter(a=>normalizeImportedRiderName(name(a))===sourceName):[];
 const byNumber=sourceNumber?eligible.filter(a=>importedAthleteNumber(seriesNumber(a))===sourceNumber):[];
 let match=null,conflict=false,smxPlateDiffers=false;
 if(byName.length===1){match=byName[0];if(sourceNumber&&importedAthleteNumber(seriesNumber(match))!==sourceNumber){if(series!=="SMX"){match=null;conflict=true}else smxPlateDiffers=true}}
 else if(byName.length>1&&sourceNumber){const exact=byName.filter(a=>importedAthleteNumber(seriesNumber(a))===sourceNumber);if(exact.length===1)match=exact[0]}
 else if(!byName.length&&byNumber.length===1)match=byNumber[0];
 const blocked=alreadyScoredAthleteIds(currentScoringScope(),editingScoreGroupKey||"");
 if(match&&blocked.has(id(match)))return {athlete:match,status:"Already scored in this segment",state:"blocked"};
 if(match)return {athlete:match,status:smxPlateDiffers?`Matched by name: official plate #${clean(row.number)}; roster #${clean(seriesNumber(match))||"—"}`:`Matched: #${clean(seriesNumber(match))||"—"} ${name(match)}`,state:"matched"};
 return {athlete:null,status:conflict?"Name / number conflict":byNumber.length>1?"Number is ambiguous":"No matching league athlete",state:"unmatched"};
}
function renderOfficialResultsPreview(){
 const preview=$("officialResultsImportPreview"),summary=$("officialResultsImportSummary"),el=$("officialResultsImportTable");if(!preview||!el)return;
 if(!officialImportRows.length){preview.hidden=true;summary.innerHTML="";el.innerHTML="";return}
 const matched=officialImportRows.filter(row=>row.match.state==="matched").length,blocked=officialImportRows.filter(row=>row.match.state==="blocked").length,unmatched=officialImportRows.length-matched-blocked;
 preview.hidden=false;
 const sourceLabel=officialImportMeta?.source==="Official CSV upload"?"Official CSV upload":(()=>{try{return new URL(officialImportMeta?.source||"").hostname||"Official results page"}catch{return "Official results page"}})();
 const divisionLabel=officialImportMeta?.division?`${officialImportMeta.division} class`:"";
 const sessionLabel=officialImportMeta?.sessionTitle||"";
 const fastestQualifierLabel=officialImportMeta?.fastestQualifier?`<span class="official-import-match">Official ${esc(officialImportMeta.fastestQualifierSessionTitle||"qualifying")} fastest qualifier: ${esc(officialImportMeta.fastestQualifier.name)}${officialImportMeta.fastestQualifier.number?` (#${esc(officialImportMeta.fastestQualifier.number)})`:""}</span>`:"";
 const fastestQualifierWarning=officialImportMeta?.fastestQualifierError?`<span class="official-import-unmatched">Fastest qualifier not fetched: ${esc(officialImportMeta.fastestQualifierError)}</span>`:"";
 const fastestLapLabel=officialImportMeta?.fastestLap?`<span class="official-import-match">Official ${officialImportMeta?.fastestLapSourceUrl?`<a href="${esc(officialImportMeta.fastestLapSourceUrl)}" target="_blank" rel="noopener">Fast Lap Rider</a>`:"fastest lap"}: ${esc(officialImportMeta.fastestLap.name)}${officialImportMeta.fastestLap.number?` (#${esc(officialImportMeta.fastestLap.number)})`:""}</span>`:"";
 const fastestLapWarning=officialImportMeta?.fastestLapError?`<span class="official-import-unmatched">Fast Lap Rider PDF not parsed: ${esc(officialImportMeta.fastestLapError)}</span>`:"";
 const heatWinnerLabel=Array.isArray(officialImportMeta?.heatWinners)&&officialImportMeta.heatWinners.length?`<span class="official-import-match">Official heat winners: ${officialImportMeta.heatWinners.map(winner=>`Heat ${Number(winner.heatNumber)||"?"}: ${esc(winner.name)}${winner.number?` (#${esc(winner.number)})`:""}`).join("; ")}</span>`:"";
 const heatWinnerWarning=Array.isArray(officialImportMeta?.heatWinnerErrors)&&officialImportMeta.heatWinnerErrors.length?`<span class="official-import-unmatched">Heat winner data incomplete: ${officialImportMeta.heatWinnerErrors.map(esc).join("; ")}</span>`:"";
 const ncCount=officialImportRows.filter(row=>row.status==="NC"||String(row.displayPosition||"").toUpperCase()==="NC").length;
 summary.innerHTML=`<span>Source: ${esc(sourceLabel)}</span>${divisionLabel?`<span class="official-import-match">Class: ${esc(divisionLabel)}</span>`:""}${sessionLabel?`<span>Session: ${esc(sessionLabel)}</span>`:""}${fastestQualifierLabel}${fastestQualifierWarning}${fastestLapLabel}${fastestLapWarning}${heatWinnerLabel}${heatWinnerWarning}<span>${officialImportRows.length} official rows</span>${ncCount?`<span class="official-import-match">${ncCount} NC driver${ncCount===1?"":"s"} retained in official order</span>`:""}<span class="official-import-match">${matched} matched</span><span class="official-import-blocked">${blocked} already scored</span><span class="official-import-unmatched">${unmatched} need attention</span>`;
 el.innerHTML=table(["Pos","No.","Official rider / driver","Official team","Best lap","League match"],officialImportRows.map(row=>`<tr><td>${esc(row.displayPosition||row.position)}</td><td>${esc(row.number||"—")}</td><td>${esc(row.name)}</td><td>${esc(row.team||"—")}</td><td>${esc(row.bestLap||"—")}</td><td class="official-import-${row.match.state}">${esc(row.match.status)}</td></tr>`));
}
function rematchOfficialResults(){if(!officialImportRows.length)return;officialImportRows=officialImportRows.map(row=>({...row,match:matchOfficialResultAthlete(row)}));officialImportScopeSnapshot=officialImportScope();renderOfficialResultsPreview()}
async function previewOfficialResults(){
 const button=$("previewOfficialResults"),message=$("officialResultsImportMessage"),file=$("officialResultsCsv")?.files?.[0],url=clean($("officialResultsUrl")?.value),series=$("scoreSeries")?.value||"SMX";
 if(!file&&!url){message.textContent="Paste an official results URL or choose an official CSV file.";return}
 button.disabled=true;message.textContent="Fetching the official results and matching riders…";officialImportRows=[];officialImportMeta=null;renderOfficialResultsPreview();
 try{
  const scheduled=selectedScoreScheduleEvent();
  const body={
   series,
   division:$("scoreClass")?.value||"",
   event:clean($("scoreEvent")?.value||scheduled?.name),
   round:clean($("scoreRound")?.value||scheduled?.round),
   eventDate:scheduled?.date||"",
   eventLocation:clean(scheduled?.location||scheduled?.venue||""),
   eventType:series==="SMX"?currentSmxEventType():series==="F1"?clean(scheduled?.eventType):"",
   phase:scoringPhase,
   supercrossFormat:series==="SMX"?$("scoreSmxSupercrossFormat")?.value||"Standard":""
  };
  if(file){if(file.size>5*1024*1024)throw new Error("CSV files must be 5 MB or smaller.");body.csv=await file.text();body.csvName=file.name||"Official CSV results"}else body.url=url;
  const response=await fetch("/api/results/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  let payload={};try{payload=await response.json()}catch{}
  if(!response.ok)throw new Error(payload.error||`Import request failed (${response.status}).`);
  officialImportMeta=payload;officialImportRows=(payload.rows||[]).map(row=>({...row,match:matchOfficialResultAthlete(row)}));officialImportScopeSnapshot=officialImportScope();
  if(!officialImportRows.length)throw new Error("No driver rows were returned by that source.");
  renderOfficialResultsPreview();
  const importedClass=payload.division?` for the ${payload.division} class`:"";
  const importedSession=payload.sessionTitle?` (${payload.sessionTitle})`:"";
  message.textContent=`Preview loaded${importedClass}${importedSession} from ${payload.title||"the official source"}. Only this class/session was imported. Review the matches below, then load positions into the scoring grid.`;
 }catch(error){message.textContent=error.message||"Could not import the official results.";if(String(error.message||"").includes("Failed to fetch"))message.textContent="Could not reach the results-import endpoint. Run the site with npm start (not VS Code Live Server) and try again."}
 finally{button.disabled=false}
}
function applyOfficialResults(){
 const message=$("officialResultsImportMessage");if(!officialImportRows.length){message.textContent="Preview official results before loading them.";return}
 if(officialImportScopeSnapshot!==officialImportScope()){message.textContent="The selected series, class, event, round or scoring segment changed after preview. Fetch the results again to avoid loading them into the wrong scoring group.";return}
 const config=scoreFormatConfig(),gridRows=new Map([...document.querySelectorAll("#scoreEntryTable tr[data-score-row]")].map(row=>[Number(row.dataset.scoreRow),row])),used=new Set([...document.querySelectorAll("#scoreEntryTable .score-rider-select")].map(select=>select.value).filter(Boolean));
 let loaded=0,skipped=0,duplicate=0,outOfRange=0;
 const importedRows=officialImportRows.slice().sort((a,b)=>($("scoreSeries")?.value==="F1"?(a.sourceOrder??a.position)-(b.sourceOrder??b.position):a.position-b.position));
 for(const row of importedRows){
  if(!row.match?.athlete||row.match.state!=="matched"){skipped++;continue}
  if(row.position<1||row.position>config.rowCount||!gridRows.has(row.position)){outOfRange++;continue}
  const athleteId=id(row.match.athlete);if(used.has(athleteId)){duplicate++;continue}
  const select=gridRows.get(row.position).querySelector(".score-rider-select");if(!select||![...select.options].some(option=>option.value===athleteId)){skipped++;continue}
  select.value=athleteId;used.add(athleteId);updateScoreRow(gridRows.get(row.position));loaded++;
 }
 // When the official session table explicitly supplies best-lap times, award the existing fastest-lap checkbox to the quickest classified rider.
 const fastestLapBonus=config.bonuses.find(([key])=>key==="fastestLap");
 const parseLapTime=value=>{const token=String(value||"").trim().replace(/[’]/g,"'").replace(/\s*\(\s*\d+\s*\)\s*$/,"");const match=token.match(/^(?:(\d{1,2})[:'](\d{1,2}(?:\.\d+)?)|(\d{1,3}(?:\.\d+)?))$/);if(!match)return Infinity;if(match[1]!==undefined)return Number(match[1])*60000+Number(match[2])*1000;return Number(match[3])*1000};
 let fastestLapPreselected=false;
 const hasSessionFastLapPdf=$("scoreSeries")?.value==="MotoGP"&&!!officialImportMeta?.fastestLap;
 if(fastestLapBonus&&!hasSessionFastLapPdf){const lapRows=importedRows.filter(row=>row.match?.athlete&&row.match.state==="matched"&&row.bestLap&&Number.isFinite(parseLapTime(row.bestLap))).sort((a,b)=>parseLapTime(a.bestLap)-parseLapTime(b.bestLap));const fastest=lapRows[0];if(fastest&&gridRows.has(fastest.position)){const check=gridRows.get(fastest.position).querySelector(`[data-bonus="${fastestLapBonus[0]}"]`);if(check){check.checked=true;updateScoreRow(gridRows.get(fastest.position));fastestLapPreselected=true}}}
 // F1/MotoGP publish separate qualifying classifications; standard SMX Supercross uses the event's class-specific Combined Qualifying page.
 const selectedScoringSeries=$("scoreSeries")?.value;
 const standardSmxSupercross=selectedScoringSeries==="SMX"&&currentSmxEventType()==="Supercross"&&$("scoreSmxSupercrossFormat")?.value!=="Triple Crown";
 const fastestQualifierBonus=config.bonuses.find(([key])=>key==="fastestQualifier");
 let fastestQualifierPreselected=false;
 if(( ["F1","MotoGP"].includes(selectedScoringSeries)||standardSmxSupercross)&&officialImportMeta?.fastestQualifier&&fastestQualifierBonus){
  const qualifierMatch=matchOfficialResultAthlete(officialImportMeta.fastestQualifier);
  if(qualifierMatch.athlete&&qualifierMatch.state==="matched"){
   const qualifierId=id(qualifierMatch.athlete);
   const qualifierRow=[...gridRows.values()].find(row=>row.querySelector(".score-rider-select")?.value===qualifierId);
   const check=qualifierRow?.querySelector(`[data-bonus="${fastestQualifierBonus[0]}"]`);
   if(check){check.checked=true;updateScoreRow(qualifierRow);fastestQualifierPreselected=true}
  }
 }
 let heatWinnersPreselected=[];
 let heatWinnersNotOnGrid=[];
 if(standardSmxSupercross&&Array.isArray(officialImportMeta?.heatWinners)){
  const heatWinnerBonus=config.bonuses.find(([key])=>key==="heatWinner");
  const handled=new Set();
  for(const winner of officialImportMeta.heatWinners){
   const matched=matchOfficialResultAthlete(winner);
   if(!heatWinnerBonus||!matched.athlete||matched.state!=="matched"){heatWinnersNotOnGrid.push(winner.name||`Heat ${winner.heatNumber}`);continue}
   const athleteId=id(matched.athlete);if(handled.has(athleteId))continue;handled.add(athleteId);
   const targetRow=[...gridRows.values()].find(row=>row.querySelector(".score-rider-select")?.value===athleteId);
   const check=targetRow?.querySelector(`[data-bonus="${heatWinnerBonus[0]}"]`);
   if(check){check.checked=true;updateScoreRow(targetRow);heatWinnersPreselected.push(`Heat ${winner.heatNumber}: ${winner.name}`)}
   else heatWinnersNotOnGrid.push(winner.name||`Heat ${winner.heatNumber}`);
  }
 }
 // F1's Grand Prix importer and MotoGP's selected RAC/SPR session each
 // return a dedicated official fastest-lap classification. For MotoGP this is
 // the Fast Lap Rider PDF linked at the bottom of the exact selected session.
 const shouldUseOfficialFastLap=selectedScoringSeries==="MotoGP"||(selectedScoringSeries==="F1"&&config.phase==="Grand Prix");
 if(shouldUseOfficialFastLap&&officialImportMeta?.fastestLap&&fastestLapBonus){
  const fastestMatch=matchOfficialResultAthlete(officialImportMeta.fastestLap);
  if(fastestMatch.athlete&&fastestMatch.state==="matched"){
   const fastestId=id(fastestMatch.athlete);
   let targetRow=[...gridRows.values()].find(row=>row.querySelector(".score-rider-select")?.value===fastestId);
   if(!targetRow){
    const freeEntry=[...gridRows.entries()].sort((a,b)=>b[0]-a[0]).find(([place,row])=>{const select=row.querySelector(".score-rider-select");return select&&!select.value&&[...select.options].some(option=>option.value===fastestId)});
    if(freeEntry){const select=freeEntry[1].querySelector(".score-rider-select");select.value=fastestId;updateScoreRow(freeEntry[1]);targetRow=freeEntry[1]}
   }
   const check=targetRow?.querySelector(`[data-bonus="${fastestLapBonus[0]}"]`);
   if(check){check.checked=true;updateScoreRow(targetRow);fastestLapPreselected=true}
  }
 }
 syncScoreRiderOptions();
 const qualifierMessage=officialImportMeta?.fastestQualifier
  ?(fastestQualifierPreselected?`The official ${officialImportMeta.fastestQualifierSessionTitle||"qualifying"} fastest-qualifier bonus was preselected. `:`The official fastest qualifier was ${officialImportMeta.fastestQualifier.name}, but could not be preselected on an imported scoring row; check it manually. `)
  :(officialImportMeta?.fastestQualifierError?`The official ${officialImportMeta.fastestQualifierSessionTitle||"qualifying"} page was unavailable: ${officialImportMeta.fastestQualifierError} `:"The fastest-qualifier bonus may need manual selection. ");
 const fastestLapMessage=officialImportMeta?.fastestLap
  ?(fastestLapPreselected?`The official ${selectedScoringSeries==="MotoGP"?"session Fast Lap Rider PDF":"fastest-lap result"} bonus was preselected for ${officialImportMeta.fastestLap.name}. `:`The official fastest-lap rider was ${officialImportMeta.fastestLap.name}, but could not be matched to an imported scoring row; check the bonus manually. `)
  :(officialImportMeta?.fastestLapError?(fastestLapPreselected?`The Fast Lap Rider PDF was unavailable (${officialImportMeta.fastestLapError}); the fastest lap was preselected using the session classification's best-lap times as a fallback. `:`The official session Fast Lap Rider data could not be read: ${officialImportMeta.fastestLapError} `):"Fastest-lap bonus may need manual selection if the official source did not provide it. ");
 const heatWinnerMessage=standardSmxSupercross?`${heatWinnersPreselected.length} heat-winner bonus${heatWinnersPreselected.length===1?" was":"es were"} preselected${heatWinnersPreselected.length?`: ${heatWinnersPreselected.join("; ")}`:""}. ${heatWinnersNotOnGrid.length?`Could not match to the loaded main-event grid: ${heatWinnersNotOnGrid.join(", ")}. `:""}${(officialImportMeta?.heatWinnerErrors||[]).length?`Heat lookup warnings: ${officialImportMeta.heatWinnerErrors.join("; ")}. `:""}`:"";
 message.textContent=`Loaded ${loaded} driver position${loaded===1?"":"s"} into the scoring table. ${skipped} unmatched/already-scored rows, ${duplicate} duplicate driver rows and ${outOfRange} positions outside this scoring table were skipped. ${qualifierMessage}${fastestLapMessage}${heatWinnerMessage}Verify all bonuses and positions before recording results.`;
 $("scoreEntryTable")?.scrollIntoView({behavior:"smooth",block:"start"});
}
function clearOfficialResults(){officialImportRows=[];officialImportMeta=null;officialImportScopeSnapshot=null;if($("officialResultsUrl"))$("officialResultsUrl").value="";if($("officialResultsCsv"))$("officialResultsCsv").value="";if($("officialResultsImportMessage"))$("officialResultsImportMessage").textContent="Import preview cleared.";renderOfficialSourceHelp();renderOfficialResultsPreview()}
function setupOfficialResultsImport(){
 renderOfficialSourceHelp();
 $("previewOfficialResults")?.addEventListener("click",previewOfficialResults);
 $("applyOfficialResults")?.addEventListener("click",applyOfficialResults);
 $("clearOfficialResults")?.addEventListener("click",clearOfficialResults);
 $("scoreSeries")?.addEventListener("change",()=>{officialImportRows=[];officialImportMeta=null;officialImportScopeSnapshot=null;renderOfficialResultsPreview();renderOfficialSourceHelp()});
 $("scoreClass")?.addEventListener("change",rematchOfficialResults);
}
function setupScoreGrid(){
 const series=$("scoreSeries");if(!series)return;
 series.addEventListener('change',()=>{scoringPhase="";updateScoreClass()});
 $("scoreClass")?.addEventListener('change',renderScoreEntryTable);
 $("scoreSmxEventType")?.addEventListener('change',()=>{scoringPhase="Moto 1";if($("scoreSmxSupercrossFormat"))$("scoreSmxSupercrossFormat").value="Standard";updateScoreModeControls();renderScoreEntryTable()});
 $("scoreSmxSupercrossFormat")?.addEventListener('change',()=>{updateScoreModeControls();renderScoreEntryTable()});
 $("scoreRound")?.addEventListener('input',()=>{updateScoreModeControls();renderScoreEntryTable()});
 $("scoreEvent")?.addEventListener('change',renderScoreEntryTable);
 $("scoreScheduleEvent")?.addEventListener('change',()=>{const selected=read(K.CAL,[]).find(e=>String(e.id)===$("scoreScheduleEvent").value);if(selected){$("scoreEvent").value=clean(selected.name);$("scoreRound").value=clean(selected.round);if(eventRoom(selected.series)==="SMX")$("scoreSmxEventType").value=smxEventFormatFromSchedule(selected);}updateScoreClass()});
 updateScoreClass();
}
let editingScoreGroupKey=null,scoringPhase="";
function scoreGroupKey(s){return s?.resultGroupId?`id:${s.resultGroupId}`:`legacy:${norm(canonicalScoreSeries(s?.series))}|${norm(s?.division||s?.riderClass)}|${norm(s?.eventType||"")}|${norm(s?.scoringPhase||"")}|${norm(s?.event)}|${clean(s?.round)}`}
function scoredGroups(){const map=new Map();scores().forEach(s=>{const gkey=scoreGroupKey(s);if(!map.has(gkey))map.set(gkey,{key:gkey,records:[],series:canonicalScoreSeries(s.series||eventRoom(s.riderClass||s.division||"")),division:s.division||s.riderClass||"",event:s.event||"",round:s.round??"",eventType:s.eventType||"",supercrossScoringFormat:s.supercrossScoringFormat||"Standard",scoringPhase:s.scoringPhase||"",recordedAt:s.recordedAt||""});const g=map.get(gkey);g.records.push(s);if(String(s.recordedAt||"")>String(g.recordedAt||""))g.recordedAt=s.recordedAt||""});return [...map.values()]}
function renderScoredEventHistory(){const el=$("scoredEventHistory");if(!el)return;const groups=scoredGroups().sort((a,b)=>String(b.recordedAt).localeCompare(String(a.recordedAt))||String(a.event).localeCompare(String(b.event)));el.innerHTML=table(["Series","Division","Event Type / Segment","Event / Round","Riders scored","Last updated","Action"],groups.map(g=>{const archived=g.division==="Archived",segment=[g.eventType,g.supercrossScoringFormat==="Triple Crown"?"Triple Crown":"",g.scoringPhase].filter(Boolean).join(" · ")||"—";return `<tr><td>${esc(g.series||"—")}</td><td>${archived?`Archived (${esc(g.records[0]?.legacyDivision||"retired division")})`:esc(g.division||"—")}</td><td>${esc(segment)}</td><td>${scoreEventLabel({event:g.event,round:g.round})}</td><td>${g.records.length}</td><td>${g.recordedAt?formatVancouverDateTime(g.recordedAt):"—"}</td><td>${archived?`<span class="muted">Historical only</span>`:`<button type="button" class="inline" data-edit-scoring="${esc(g.key)}">Edit Scoring</button>`}</td></tr>`}));el.querySelectorAll("[data-edit-scoring]").forEach(b=>b.onclick=()=>beginEditScoring(b.dataset.editScoring))}
function beginEditScoring(groupKey){const group=scoredGroups().find(g=>g.key===groupKey);if(!group)return;editingScoreGroupKey=groupKey;const first=group.records[0];$("scoreSeries").value=group.series||"SMX";updateScoreClass();const division=group.division||first.riderClass||"";if([...$("scoreClass").options].some(o=>o.value===division))$("scoreClass").value=division;$("scoreEvent").value=group.event;$("scoreRound").value=clean(group.round);renderScoreScheduleOptions();const matchingEvent=read(K.CAL,[]).find(e=>eventRoom(e.series)===(group.series||"")&&String(e.round??"")===String(group.round??"")&&norm(e.name)===norm(group.event));$("scoreScheduleEvent").value=matchingEvent?String(matchingEvent.id):"";if(group.series==="SMX"){$("scoreSmxEventType").value=["Supercross","Motocross","SMX"].includes(group.eventType)?group.eventType:smxEventFormatFromSchedule(matchingEvent);if($("scoreSmxSupercrossFormat"))$("scoreSmxSupercrossFormat").value=group.supercrossScoringFormat||first.supercrossScoringFormat||"Standard";}scoringPhase=group.scoringPhase||"Moto 1";document.querySelectorAll('[data-score-phase]').forEach(b=>{b.classList.toggle('active',b.dataset.scorePhase===scoringPhase);b.setAttribute('aria-selected',b.dataset.scorePhase===scoringPhase?'true':'false')});updateScoreClass();if([...$("scoreClass").options].some(o=>o.value===division))$("scoreClass").value=division;updateScoreModeControls();renderScoreEntryTable();for(const record of group.records){const place=Number(record.place),row=document.querySelector(`#scoreEntryTable tr[data-score-row="${place}"]`);if(!row)continue;const select=row.querySelector(".score-rider-select"),rid=String(record.riderId||"");if(select&&[...select.options].some(o=>o.value===rid))select.value=rid;const savedBonuses=Array.isArray(record.bonuses)?record.bonuses:[];row.querySelectorAll("[data-bonus]").forEach(check=>{const bonus=scoreFormatConfig().bonuses.find(([k])=>k===check.dataset.bonus);check.checked=!!bonus&&savedBonuses.includes(bonus[1])});updateScoreRow(row)}syncScoreRiderOptions();$("scoreSubmitButton").textContent="Save Scoring Changes";$("cancelScoreEdit").hidden=false;$("scoreMessage").textContent=`Editing ${group.event}${clean(group.round)?` · Round ${group.round}`:""} (${group.series} / ${division}${group.scoringPhase?` / ${group.scoringPhase}`:""}). Saving replaces these previously recorded results.`;$("scoreForm").scrollIntoView({behavior:"smooth",block:"start"})}
function cancelScoreEdit(){editingScoreGroupKey=null;scoringPhase="";$("scoreForm").reset();$("scoreSeries").value="SMX";$("scoreSmxEventType").value="SMX";if($("scoreSmxSupercrossFormat"))$("scoreSmxSupercrossFormat").value="Standard";document.querySelectorAll('[data-score-phase]').forEach(b=>{b.classList.toggle('active',b.dataset.scorePhase==="Moto 1");b.setAttribute('aria-selected',b.dataset.scorePhase==="Moto 1"?'true':'false')});updateScoreClass();$("scoreSubmitButton").textContent="Record Race Results";$("cancelScoreEdit").hidden=true;$("scoreMessage").textContent="Scoring edit cancelled."}
function submitRaceResults(e){
 e.preventDefault();const msg=$("scoreMessage"),series=$("scoreSeries").value,division=$("scoreClass").value,event=clean($("scoreEvent").value),round=clean($("scoreRound").value),scheduledEvent=selectedScoreScheduleEvent(),config=scoreFormatConfig(),rows=[...document.querySelectorAll('#scoreEntryTable tr[data-score-row]')],selected=[],currentScores=scores();
 if(!event){msg.textContent="Enter or choose an event name.";return}
 if(round!==""&&(!/^\d+$/.test(round)||Number(round)<1)){msg.textContent="Round number must be a positive whole number.";return}
 for(const row of rows){const select=row.querySelector('.score-rider-select'),athleteId=select?.value;if(!athleteId)continue;const a=athletes().find(a=>id(a)===athleteId);if(!a||!athleteEligibleForScoring(a,series,division)){msg.textContent="One of the selected athletes is not eligible for this series or division. Refresh the scoring table and try again.";return}const checkedBonuses=[...row.querySelectorAll('[data-bonus]:checked')].map(input=>{const item=config.bonuses.find(([key])=>key===input.dataset.bonus);return item?{label:item[1],points:Number(item[2]??2)}:null}).filter(Boolean);const bonuses=checkedBonuses.map(b=>b.label),bonusPoints=checkedBonuses.reduce((sum,b)=>sum+b.points,0)*config.multiplier;selected.push({place:Number(row.dataset.scoreRow),a,base:Number(row.dataset.basePoints||0),bonuses,bonusPoints})}
 if(!selected.length){msg.textContent=`Select at least one athlete in the 1–${config.rowCount} finishing table.`;return}
 const seen=new Set(),scope={series:canonicalScoreSeries(series),division,event,round,eventType:config.eventType||"",scoringPhase:config.phase||"",scheduledEventId:scheduledEvent?String(scheduledEvent.id):""},blockedIds=alreadyScoredAthleteIds(scope,editingScoreGroupKey||"");
 for(const x of selected){if(seen.has(id(x.a))){msg.textContent=`${name(x.a)} is selected in more than one finishing position. Each athlete can only occupy one position per result.`;return}if(blockedIds.has(id(x.a))){msg.textContent=`${name(x.a)} has already been scored for this event, round, and scoring segment. Choose another athlete.`;return}seen.add(id(x.a))}
 const editingRecords=editingScoreGroupKey?currentScores.filter(s=>scoreGroupKey(s)===editingScoreGroupKey):[],groupId=editingScoreGroupKey?(editingRecords.find(s=>s.resultGroupId)?.resultGroupId||uid()):uid(),now=new Date().toISOString();
 const records=selected.map(x=>{const old=editingRecords.find(s=>(s.riderId&&String(s.riderId)===id(x.a))||(!s.riderId&&norm(s.riderName)===norm(name(x.a))&&norm(s.riderClass)===norm(cls(x.a)))),t=owner(x.a),bonusPoints=x.bonusPoints,points=x.base+bonusPoints;return {id:old?.id||uid(),resultGroupId:groupId,teamKey:old?String(old.teamKey||""):(t?key(t):""),teamName:old?String(old.teamName||"Unrostered / Free Agent"):(t?tname(t):"Unrostered / Free Agent"),riderId:id(x.a),riderName:name(x.a),riderClass:cls(x.a),riderNumber:clean(athleteNumberForSeries(x.a,division)),manufacturer:clean(x.a.manufacturer),riderRaceTeam:clean(x.a.raceTeam),nationality:normalizeNationality(x.a.nationality),nationalityRegion:normalizeRegion(x.a.nationality,x.a.nationalityRegion),riderSecondarySeries:[...(x.a.secondarySeries||[])],series,division,seasonYear:Number(selectedSeasonYear||activeSeasonYear()),place:x.place,basePoints:x.base,bonuses:x.bonuses,bonusPoints,event,eventType:config.eventType||"",supercrossScoringFormat:config.supercrossScoringFormat||"",scoringPhase:config.phase||"",pointMultiplier:config.multiplier||1,scheduledEventId:scheduledEvent?String(scheduledEvent.id):"",eventDate:clean(scheduledEvent?.date||""),round:round===""?"":Number(round),points,recordedAt:now}});
 const retained=editingScoreGroupKey?currentScores.filter(s=>scoreGroupKey(s)!==editingScoreGroupKey):currentScores;write(K.S,[...retained,...records]);const wasEditing=!!editingScoreGroupKey;editingScoreGroupKey=null;$("scoreSubmitButton").textContent="Record Race Results";$("cancelScoreEdit").hidden=true;msg.textContent=wasEditing?`Updated ${event}${round?` · Round ${round}`:""}${config.phase?` · ${config.phase}`:""}. Replaced previous results for ${records.length} rider${records.length===1?"":"s"}. Team attribution for previously scored riders was preserved.`:`Recorded ${records.length} rider result${records.length===1?"":"s"} for ${config.eventType||series}${config.phase?` · ${config.phase}`:""}. Selected rostered riders earned fantasy-team points based on ownership at submission; free-agent results are saved but are not assigned to a fantasy team's total.`;renderScoreEntryTable();renderComm();refresh();
}
function setCommissionerFilterOptions(select,items,placeholder){
 if(!select)return;const previous=select.value;select.replaceChildren(new Option(placeholder,""));
 for(const item of items){const value=String(item.value);if(![...select.options].some(option=>option.value===value))select.add(new Option(String(item.label),value))}
 if([...select.options].some(option=>option.value===previous))select.value=previous;
}
function populateCommissionerAthleteFilters(){
 setCommissionerFilterOptions($("commAthleteSeriesFilter"),SECONDARY_SERIES_OPTIONS.map(value=>({value,label:value})),"All series");
 setCommissionerFilterOptions($("commAthleteOwnerFilter"),[{value:"__free_agent__",label:"Free Agent"},...teams().map(team=>({value:key(team),label:tname(team)}))],"All owners");
}
function renderCommissionerAthletes(){
 const target=$("commAthletes");if(!target)return;populateCommissionerAthleteFilters();
 const query=clean($("commAthleteSearch")?.value).toLowerCase(),seriesFilter=$("commAthleteSeriesFilter")?.value||"",ownerFilter=$("commAthleteOwnerFilter")?.value||"";
 const all=sortRiders(athletes().filter(a=>!a.seriesArchived&&SERIES.includes(cls(a))));
 const filtered=all.filter(a=>{
  const team=owner(a),teamName=team?tname(team):"Free Agent";
  const searchable=[name(a),a.number,a.raceTeam,a.manufacturer,cls(a),...(athleteSeries(a)||[]),countryRegionLabel(a.nationality,a.nationalityRegion),teamName].join(" ").toLowerCase();
  return (!query||searchable.includes(query))&&(!seriesFilter||athleteSeries(a).includes(seriesFilter))&&(!ownerFilter||(ownerFilter==="__free_agent__"?!team:!!team&&key(team)===ownerFilter));
 });
 target.innerHTML=table(["Athlete","Series","Number","Manufacturer","Owner","Action"],filtered.map(a=>{const team=owner(a),status=[a.pointsLeader?"Points Leader":"",a.reigningTripleCrownChampion?"Triple Crown Champion":"",a.reigningSMXChampion?"SMX Champion":"",a.reigningWorldChampion?"World Champion":""].filter(Boolean).map(x=>`<span class="badge">${x}</span>`).join(" ");return `<tr><td>${athleteNameHTML(a)}<div>${status}</div></td><td>${seriesDisplayHTML(a)}</td><td>${numberHTML(a.number,a.manufacturer,a)||"—"}</td><td>${brandBadge(a.manufacturer||"—")}</td><td>${esc(team? tname(team):"Free Agent")}</td><td class="action-cell"><button class="inline" type="button" data-edit="${esc(id(a))}">Edit Rider</button> <button class="inline" type="button" data-delete="${esc(id(a))}">Delete</button></td></tr>`}));
 const summary=$("commAthleteFilterSummary");if(summary)summary.textContent=`Showing ${filtered.length.toLocaleString()} of ${all.length.toLocaleString()} athletes.`;
 target.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>beginEditAthlete(b.dataset.edit));
 target.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>{if(confirm("Delete athlete from database? Historic scores remain.")){const delId=b.dataset.delete;saveAthletes(athletes().filter(a=>id(a)!==delId));saveTeams(teams().map(t=>({...t,roster:roster(t).filter(a=>id(a)!==delId)})));renderComm();refresh()}});
}
function renderComm(){
 if(!$("commAthletes"))return;
 options($("assignTeam"),teams().map(t=>({value:key(t),label:tname(t)})),"Free agent");
 renderCommissionerAthletes();
 renderScoreScheduleOptions();renderScoreEntryTable();
 $("scoreHistory").innerHTML=table(["Place","Athlete","Team at scoring","Event / Round","Bonuses","Points","Recorded"],scores().slice().sort((a,b)=>{const eventCmp=String(a.event||"").localeCompare(String(b.event||""));return eventCmp||Number(a.place||999)-Number(b.place||999)||compareScoreRiders(a,b)}).map(s=>`<tr><td>${s.place?esc(s.place):"—"}</td><td>${athleteNameHTML(riderFromRecord(s),true,true,s.division||s.riderClass,s.riderNumber)}</td><td>${esc(s.teamName||"Unrostered / Free Agent")}</td><td>${scoreEventLabel(s)}</td><td>${bonusText(s)}</td><td class="points">${Number(s.points||0)}</td><td>${formatVancouverDateTime(s.recordedAt)}</td></tr>`));
 renderScoredEventHistory();
 renderCommSchedule();
 if(!$("commTabPanel-history")?.hidden)renderHistoricalSeasonPanel();
}
function beginEditAthlete(athleteId){
 activateCommissionerTab("athletes");
 const a=athletes().find(x=>id(x)===String(athleteId));
 if(!a)return;
 $("editAthleteId").value=id(a);
 $("editAthName").value=name(a);
 $("editAthNumber").value=clean(a.number);
 $("editAthClass").value=cls(a);renderSecondarySeriesChecks("editAthSecondarySeries",a.secondarySeries||[],cls(a));renderSecondaryNumberInputs("editAthSecondaryNumberFields",a.secondarySeries||[],a.secondaryNumbers||{});
 $("editRaceTeam").value=clean(a.raceTeam);
 $("editManufacturer").value=clean(a.manufacturer);
 $("editAthNationality").value=normalizeNationality(a.nationality);
 populateRegionSelect($("editAthNationalityRegion"),$("editAthNationality"),a.nationalityRegion);
 $("editPointsLeader").checked=!!a.pointsLeader;
 $("editSmxChampion").checked=!!a.reigningSMXChampion;
 $("editTripleCrownChampion").checked=!!a.reigningTripleCrownChampion;
 $("editWorldChampion").checked=!!a.reigningWorldChampion;
 $("editAthleteMessage").textContent="";
 $("editAthletePanel").hidden=false;
 $("editAthletePanel").scrollIntoView({behavior:"smooth",block:"start"});
}
function saveEditedAthlete(e){
 e.preventDefault();
 const msg=$("editAthleteMessage"), oldId=clean($("editAthleteId").value), all=athletes(), current=all.find(a=>id(a)===oldId);
 if(!current){msg.textContent="Could not find that rider. Refresh the page and try again.";return}
 const primary=$("editAthClass").value,updated={...current,name:clean($("editAthName").value),number:normalizeNumber($("editAthNumber").value,clean($("editAthName").value)),class:primary,primarySeries:primary,secondarySeries:secondarySeriesChecked("editAthSecondarySeries",primary),secondaryNumbers:secondaryNumbersFromInputs("editAthSecondaryNumberFields"),raceTeam:clean($("editRaceTeam").value),manufacturer:clean($("editManufacturer").value),nationality:normalizeNationality($("editAthNationality").value),nationalityRegion:normalizeRegion($("editAthNationality").value,$("editAthNationalityRegion").value),pointsLeader:$("editPointsLeader").checked,reigningSMXChampion:$("editSmxChampion").checked,reigningTripleCrownChampion:$("editTripleCrownChampion").checked,reigningWorldChampion:$("editWorldChampion").checked};
 if(!updated.name){msg.textContent="Athlete name is required.";return}
 // Keep the athlete's permanent ID, even if the name or class changes.
 updated.id=current.id??oldId;
 const matchesCurrent=r=>id(r)===oldId||(norm(name(r))===norm(name(current))&&norm(cls(r))===norm(cls(current)));
 const currentTeams=teams();
 for(const t of currentTeams){
  const hasRider=roster(t).some(matchesCurrent); if(!hasRider)continue;
  const nextRoster=roster(t).map(r=>matchesCurrent(r)?{...r,...updated}:r);
  if(nextRoster.length>MAX_ROSTER_SIZE){msg.textContent=`Cannot save: ${tname(t)} would exceed ${MAX_ROSTER_SIZE} roster spots.`;return}
  for(const series of SERIES){const count=nextRoster.filter(r=>cls(r)===series).length;if(count>REQ[series]){msg.textContent=`Cannot save: ${tname(t)} would have ${count} ${series} athletes, above its limit of ${REQ[series]}. Change the series or free a roster spot first.`;return}}
 }
 saveAthletes(all.map(a=>id(a)===oldId?updated:a));
 saveTeams(currentTeams.map(t=>({...t,roster:roster(t).map(r=>matchesCurrent(r)?{...r,...updated}:r)})));
 renderComm();refresh();
 msg.textContent="Rider changes saved. The athlete list and any current roster copies are updated; historical scores are unchanged.";
}
function draftOrderKeysValid(order,list=teams()){const keys=list.map(key),candidate=Array.isArray(order)?order.map(String):[];return candidate.length===keys.length&&new Set(candidate).size===keys.length&&keys.every(k=>candidate.includes(k))}
function draftOrderEditorLocked(room,settings){const current=settings||read(K.DS,{})[room]||{status:"Not started"};return (current.status||"Not started")!=="Not started"||draftRoomPicks(room).length>0}
function renderDraftOrderEditor(){const el=$("draftOrderEditor");if(!el)return;const room=$("draftSeries")?.value||draftOrderEditorRoom,list=teams(),settings=read(K.DS,{})[room]||{status:"Not started"},locked=draftOrderEditorLocked(room,settings);if(draftOrderEditorRoom!==room||!draftOrderKeysValid(draftOrderEditorKeys,list)){draftOrderEditorRoom=room;const saved=settings.orderTeamKeys;draftOrderEditorKeys=draftOrderKeysValid(saved,list)?saved.map(String):list.map(key)}const draftKeys=draftOrderEditorKeys.filter(k=>list.some(t=>key(t)===k));el.innerHTML=draftKeys.length?draftKeys.map((teamKey,index)=>{const team=list.find(t=>key(t)===teamKey);return `<div class="draft-order-row"><span class="draft-order-rank">${index+1}</span><strong>${esc(team?tname(team):"Unknown team")}</strong><div class="draft-order-controls"><button type="button" class="inline" data-order-move="${index}" data-order-dir="-1" aria-label="Move ${esc(team?tname(team):"team")} up" ${locked||index===0?"disabled":""}>↑</button><button type="button" class="inline" data-order-move="${index}" data-order-dir="1" aria-label="Move ${esc(team?tname(team):"team")} down" ${locked||index===draftKeys.length-1?"disabled":""}>↓</button></div></div>`}).join(""):`<p class="muted">No teams are configured yet.</p>`;const message=$("draftOrderMessage");if(message){message.textContent=locked?"Draft order is locked because this draft has started. The saved order will be used for every round.":draftOrderKeysValid(settings.orderTeamKeys,list)&&JSON.stringify(draftOrderEditorKeys)===JSON.stringify(settings.orderTeamKeys.map(String))?"Saved order loaded. Move teams as needed, then save your changes.":"Unsaved order changes. Save the Round 1 order before starting the draft."}el.querySelectorAll("[data-order-move]").forEach(button=>button.onclick=()=>{if(locked)return;const index=Number(button.dataset.orderMove),next=index+Number(button.dataset.orderDir);if(next<0||next>=draftOrderEditorKeys.length)return;[draftOrderEditorKeys[index],draftOrderEditorKeys[next]]=[draftOrderEditorKeys[next],draftOrderEditorKeys[index]];renderDraftOrderEditor()});const saveButton=$("saveDraftOrder");if(saveButton)saveButton.disabled=locked||!draftOrderKeysValid(draftOrderEditorKeys,list)}
function loadDraftAdminSettings(){const room=$("draftSeries")?.value;if(!room)return;const settings=read(K.DS,{})[room]||{status:"Not started"};$("draftStart").value=vancouverDateTimeInputValue(settings.scheduledStart||(settings.status==="Not started"?settings.start||"":""));const status=$("draftAdminStatus");if(status)status.textContent=settings.status||"Not started";draftOrderEditorRoom=room;draftOrderEditorKeys=draftOrderKeysValid(settings.orderTeamKeys,teams())?settings.orderTeamKeys.map(String):teams().map(key);renderDraftOrderEditor()}
function setDraftAdminStatus(status){const room=$("draftSeries").value,d=read(K.DS,{}),current=d[room]||{status:"Not started"};current.status=status;d[room]=current;write(K.DS,d);$("draftSettingsMessage").textContent=`${room} draft ${status.toLowerCase()}.`;loadDraftAdminSettings()}
function fillOptions(select,values,selected){if(!select)return;const prior=selected??select.value;select.replaceChildren(...values.map(value=>new Option(value,value)));if(values.includes(prior))select.value=prior;}
function populateScheduleSeriesSelect(){fillOptions($("eventSeries"),SCHEDULE_SERIES,$("eventSeries")?.value||"SMX")}
function populateScoreSeriesSelect(){fillOptions($("scoreSeries"),SCORE_SERIES,$("scoreSeries")?.value||"SMX")}
function populateDraftRoomSelects(){["draftSeries","draftRoom"].forEach(id=>fillOptions($(id),DRAFT_ROOMS,$(id)?.value||"SMX"))}
function populateClassFilter(){const filter=$("classFilter");if(!filter)return;const prior=filter.value;filter.replaceChildren(new Option("All series",""),...SECONDARY_SERIES_OPTIONS.map(series=>new Option(series,series)));filter.value=prior}
function commissionerSeasonYears(){
 const active=Number(activeSeasonYear()),years=[];
 for(let year=active;year>=2010;year--)years.push(String(year));
 return years;
}
async function renderCommissionerSeasonControls(){
 const select=$("commissionerSeasonYear"),source=$("copySeasonSource");if(!select)return;
 try{commissionerSeasonMeta=await window.KFStorage.getSeasonMeta()}catch(error){commissionerSeasonMeta={activeYear:Number(activeSeasonYear()),seasons:{}}}
 const active=Number(commissionerSeasonMeta.activeYear||activeSeasonYear()),years=[];
 for(let year=active;year>=2010;year--)years.push(String(year));
 const label=year=>Number(year)===active?`${year} · Current Season`:`${year} · Archived`;
 const fill=(node,placeholder)=>{if(!node)return;const prior=node.value;node.replaceChildren(new Option(placeholder,""));years.forEach(year=>node.add(new Option(label(year),year)));if(years.includes(prior))node.value=prior};
 fill(select,"Choose season…");select.value=years.includes(String(selectedSeasonYear))?String(selectedSeasonYear):String(active);
 fill(source,"Copy from season…");if(source&&!source.value)source.value=String(active);
 const status=$("commissionerSeasonStatus");
 if(status)status.textContent=String(selectedSeasonYear)===String(active)?`You are editing the current ${active} season. Public standings use this season only.`:`You are editing archived season ${selectedSeasonYear}. It has the same editing and scoring tools as every archived year, and changes are saved only to its separate GitHub season file.`;
 const archiveButton=$("archiveCurrentSeason");if(archiveButton)archiveButton.disabled=String(selectedSeasonYear)!==String(active);
}
function historicalScoringBreakdown(records){
 const groups=new Map();
 records.forEach(record=>{
  const riderId=String(record.riderId||norm(record.riderName||record.athleteName));
  const series=canonicalScoreSeries(record.series||eventRoom(record.riderClass||record.division||""));
  const division=clean(record.division||record.riderClass||"—");
  const groupKey=`${riderId}|${norm(series)}|${norm(division)}`;
  if(!groups.has(groupKey))groups.set(groupKey,{riderId,series,division,records:[],rounds:new Set(),total:0});
  const group=groups.get(groupKey);group.records.push(record);group.rounds.add(scoreRoundKey(record));group.total+=Number(record.points||0);
 });
 return [...groups.values()].map(group=>{
  const athlete=athletes().find(item=>id(item)===group.riderId)||riderFromRecord(group.records[0]);
  return {...group,athlete,roundCount:group.rounds.size,average:group.rounds.size?group.total/group.rounds.size:0};
 }).sort((a,b)=>compareRiderNumbers(a.athlete,b.athlete)||a.series.localeCompare(b.series)||a.division.localeCompare(b.division));
}
function renderHistoricalSeasonPanel(){
 const summary=$("historicalSeasonSummary"),breakdownEl=$("historicalAverageTable"),eventsEl=$("historicalEventTable");if(!summary||!breakdownEl||!eventsEl)return;
 const year=String(selectedSeasonYear),active=activeSeasonYear(),records=scores(),groups=scoredGroups();
 const riders=new Set(records.map(item=>String(item.riderId||norm(item.riderName||item.athleteName))).filter(Boolean));
 const rounds=new Set(records.map(scoreRoundKey));
 const status=year===active?"Current season":"Archived season";
 summary.innerHTML=`<div class="summary"><div><strong>${esc(year)}</strong><span>Season</span></div><div><strong>${esc(status)}</strong><span>Status</span></div><div><strong>${records.length.toLocaleString()}</strong><span>Scored rider segments</span></div><div><strong>${riders.size.toLocaleString()}</strong><span>Riders scored</span></div><div><strong>${rounds.size.toLocaleString()}</strong><span>Unique rounds</span></div></div><p class="muted">Each year is stored in its own GitHub file. Season totals never carry forward. Averages are calculated per rider, series and class using unique event rounds; multiple motos and qualifying sessions at the same event count as one round.</p>`;
 const averageRows=historicalScoringBreakdown(records).map(item=>`<tr><td>${athleteDetailButtonHTML(item.athlete)}</td><td>${esc(item.series)}</td><td>${esc(item.division)}</td><td class="points">${item.total.toLocaleString()}</td><td>${item.roundCount}</td><td class="points">${item.average.toFixed(2)}</td></tr>`);
 breakdownEl.innerHTML=averageRows.length?table(["Rider","Series","Class","Total Points","Rounds","Average / Round"],averageRows):'<p class="muted">No scored results are saved for this season yet.</p>';
 const eventRows=groups.slice().sort((a,b)=>String(b.recordedAt).localeCompare(String(a.recordedAt))).map(group=>`<tr><td>${esc(group.series||"—")}</td><td>${esc(group.division||"—")}</td><td>${esc([group.eventType,group.scoringPhase].filter(Boolean).join(" · ")||"—")}</td><td>${scoreEventLabel(group)}</td><td>${group.records.length}</td><td>${group.recordedAt?formatVancouverDateTime(group.recordedAt):"—"}</td><td><button type="button" class="inline" data-history-edit="${esc(group.key)}">Edit Scoring</button></td></tr>`);
 eventsEl.innerHTML=groups.length?table(["Series","Class","Segment","Event / Round","Riders","Last Updated","Action"],eventRows):'<p class="muted">No events have been scored in this season yet.</p>';
 eventsEl.querySelectorAll("[data-history-edit]").forEach(button=>button.onclick=()=>{activateCommissionerTab("scoring");beginEditScoring(button.dataset.historyEdit)});
 renderCommissionerSeasonControls();
}
async function switchCommissionerSeason(year){
 const target=Number(year),message=$("commissionerSeasonStatus");
 if(!Number.isInteger(target)||target<2010||target>Number(activeSeasonYear()))return;
 if(target===Number(selectedSeasonYear))return;
 try{
  await window.KFStorage.setSeasonYear(target);
  selectedSeasonYear=target;sessionStorage.setItem("commSeasonYear",String(target));
  editingScoreGroupKey=null;scoringPhase="";
  if($("scoreSubmitButton")){$("scoreSubmitButton").textContent="Record Race Results";$("cancelScoreEdit").hidden=true;}
  seed();await renderCommissionerSeasonControls();renderComm();renderCommSchedule();renderHistoricalSeasonPanel();refresh();
 }catch(error){if(message)message.textContent=`Could not open ${target}: ${error.message}. The previous season remains selected.`;$("commissionerSeasonYear").value=String(selectedSeasonYear);}
}
async function copyRidersFromSeason(){
 const source=String($("copySeasonSource")?.value||activeSeasonYear()),target=String(selectedSeasonYear),message=$("historicalActionMessage"),series=$("copyRiderSeries")?.value||"all";
 if(source===target){message.textContent="Choose a different source season.";return;}
 const label=series==="all"?"all series":series;
 const behavior=series==="all"?"This replaces the destination athlete directory and updates matching roster copies.":"This adds or updates athletes with this primary or secondary series affiliation, preserves destination athletes in other series, and updates matching roster copies.";
 if(!confirm(`Copy ${label} athletes from ${source} into ${target}? ${behavior} Rider numbers, race teams and manufacturers remain independent in each year's file.`))return;
 try{const result=await window.KFStorage.copySeason(source,target,["riders"],{riderSeries:series});await window.KFStorage.setSeasonYear(target);selectedSeasonYear=Number(target);sessionStorage.setItem("commSeasonYear",target);message.textContent=`Copied/updated ${result.copiedRiderCount??result.riderCount} ${label} athletes from ${source} to ${target}. Destination athletes outside the selected series were preserved.`;await renderCommissionerSeasonControls();renderComm();renderHistoricalSeasonPanel();refresh();}
 catch(error){message.textContent=`Athlete copy failed: ${error.message}`;}
}
async function copyScheduleFromSeason(){
 const source=String($("copySeasonSource")?.value||activeSeasonYear()),target=String(selectedSeasonYear),message=$("historicalActionMessage"),series=$("copyScheduleSeries")?.value||"all";
 if(source===target){message.textContent="Choose a different source season.";return;}
 const label=series==="all"?"all series":series;
 const behavior=series==="all"?"This replaces the entire destination schedule.":`This replaces only the destination ${series} events and preserves all other destination series events.`;
 if(!confirm(`Copy the ${label} schedule from ${source} into ${target}? ${behavior} Dates are shifted to ${target}; the source schedule remains unchanged.`))return;
 try{const result=await window.KFStorage.copySeason(source,target,["schedule"],{scheduleSeries:series});await window.KFStorage.setSeasonYear(target);selectedSeasonYear=Number(target);sessionStorage.setItem("commSeasonYear",target);message.textContent=`Copied ${result.copiedScheduleCount??result.scheduleCount} ${label} schedule events from ${source} to ${target}. Other destination series calendars were preserved.`;await renderCommissionerSeasonControls();renderCommSchedule();renderSchedule();renderHistoricalSeasonPanel();}
 catch(error){message.textContent=`Schedule copy failed: ${error.message}`;}
}
async function archiveCurrentSeason(){
 const year=String(activeSeasonYear()),message=$("historicalActionMessage");
 if(String(selectedSeasonYear)!==year){message.textContent=`Select the current season (${year}) before archiving it.`;return;}
 const nextYear=String(Number(year)+1);
 const records=scores(),roundCount=new Set(records.map(scoreRoundKey)).size;
 if(!confirm(`ARCHIVE ${year} SEASON\n\nThis saves a complete separate GitHub file containing ${athletes().length} riders, ${teams().length} teams, ${records.length} scoring records, ${roundCount} scored rounds and ${read(K.CAL,[]).length} schedule events.\n\n${nextYear} becomes the new current season. The rider directory and team identities carry forward as independent copies. Rosters, points, trades, draft and schedule start fresh. Previous-year rider numbers and race teams remain unchanged.\n\nContinue?`))return;
 try{
  const result=await window.KFStorage.archiveSeason(Number(year));
  selectedSeasonYear=Number(result.currentYear);sessionStorage.setItem("commSeasonYear",String(selectedSeasonYear));editingScoreGroupKey=null;
  message.textContent=`${year} is archived. ${nextYear} is now the current season. Historical data remains in ${year}'s separate GitHub file; ${nextYear} starts without carried-over points, rosters, trades, draft or schedule.`;
  seed();await renderCommissionerSeasonControls();renderComm();renderCommSchedule();renderHistoricalSeasonPanel();refresh();
 }catch(error){message.textContent=`Archive could not be confirmed: ${error.message}. Check the year selector and GitHub repository before retrying.`;}
}
function activateCommissionerTab(tabKey){
 const allowed=["athletes","scoring","draft","schedule","history","data"];
 if(!allowed.includes(tabKey))return;
 document.querySelectorAll("[data-comm-tab]").forEach(button=>{
  const active=button.dataset.commTab===tabKey;
  button.classList.toggle("active",active);
  button.setAttribute("aria-selected",active?"true":"false");
  button.tabIndex=active?0:-1;
 });
 allowed.forEach(key=>{const panel=$("commTabPanel-"+key);if(panel)panel.hidden=key!==tabKey});if(tabKey==="data"&&!commissionerDataTabInitialized&&sessionStorage.getItem("commAuthV2")==="yes") { commissionerDataTabInitialized=true; dataInit(); }if(tabKey==="history")renderHistoricalSeasonPanel();
}
function setupCommissionerTabs(){
 const buttons=[...document.querySelectorAll("[data-comm-tab]")];
 buttons.forEach((button,index)=>{
  button.addEventListener("click",()=>activateCommissionerTab(button.dataset.commTab));
  button.addEventListener("keydown",event=>{
   if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
   event.preventDefault();let next=index;
   if(event.key==="ArrowRight")next=(index+1)%buttons.length;
   else if(event.key==="ArrowLeft")next=(index-1+buttons.length)%buttons.length;
   else if(event.key==="Home")next=0;else next=buttons.length-1;
   buttons[next].focus();activateCommissionerTab(buttons[next].dataset.commTab);
  });
 });
 activateCommissionerTab("athletes");
}
async function runYearlyRosterReset(){
 const message=$("yearlyResetMessage");
 if(sessionStorage.getItem("commAuthV2")!=="yes"){
  if(message)message.textContent="Sign in as commissioner to use the yearly reset.";
  return;
 }
 const currentTeams=teams();
 const currentScores=scores();
 const currentTrades=read(K.TR,[]);
 const tradeProposalCount=Array.isArray(currentTrades)?currentTrades.length:0;
 const assignmentCount=currentTeams.reduce((sum,team)=>sum+roster(team).length,0);
 const teamPoints=currentTeams.reduce((sum,team)=>sum+currentScores.filter(record=>String(record.teamKey)===key(team)).reduce((points,record)=>points+Number(record.points||0),0),0);
 const riderPoints=currentScores.reduce((sum,record)=>sum+Number(record.points||0),0);
 const riderCount=new Set(currentScores.map(record=>String(record.riderId||norm(record.riderName||record.athleteName))).filter(Boolean)).size;
 if(!assignmentCount&&!currentScores.length&&!tradeProposalCount){
  if(message)message.textContent="The yearly reset is already complete. All team rosters are empty, no rider or team scoring points remain, and no trade proposals are saved.";
  return;
 }
 const confirmed=confirm(`YEARLY RESET\n\nThis will permanently:\n• Remove ${assignmentCount} athlete assignment${assignmentCount===1?"":"s"} from ${currentTeams.length} team${currentTeams.length===1?"":"s"}.\n• Reset ${teamPoints.toLocaleString()} accumulated team points.\n• Reset ${riderPoints.toLocaleString()} accumulated rider points across ${riderCount} scored athlete${riderCount===1?"":"s"} and ${currentScores.length} result record${currentScores.length===1?"":"s"}.\n• Delete ${tradeProposalCount} trade proposal${tradeProposalCount===1?"":"s"}, including pending proposals, accepted/rejected history, and their notification/viewed status.\n\nAll scoring records will be deleted. This also clears athlete profile results, averages, scoring history, and top-undrafted scoring totals.\n\nAthlete records, team names, owners and passwords, draft settings, and the event schedule will be preserved.\n\nContinue?`);
 if(!confirmed)return;
 const phrase=prompt('To confirm the yearly reset, type RESET SEASON:');
 if(phrase===null)return;
 if(clean(phrase).toUpperCase()!=="RESET SEASON"){
  if(message)message.textContent='Reset cancelled. The confirmation phrase did not match "RESET SEASON".';
  return;
 }
 saveTeams(currentTeams.map(team=>({...team,roster:[]})));
 write(K.S,[]);
 write(K.TR,[]);
 refresh();
 try{
  if(window.KFStorage&&typeof window.KFStorage.flush==="function")await window.KFStorage.flush();
  if(message)message.textContent=`Yearly reset complete. Removed ${assignmentCount} athlete assignment${assignmentCount===1?"":"s"}; reset ${teamPoints.toLocaleString()} team points and ${riderPoints.toLocaleString()} rider points; cleared ${currentScores.length} scoring result record${currentScores.length===1?"":"s"} and ${tradeProposalCount} trade proposal${tradeProposalCount===1?"":"s"}, including all trade notifications and response history. Athlete records, team ownership and passwords, draft settings, and the event schedule remain intact.`;
 }catch(error){
  if(message)message.textContent=`The rosters, scoring points, and trade proposals were cleared in this browser, but the project database did not confirm the save: ${error.message||"Unknown storage error"}. Check the storage status and retry using Data & Backup if needed.`;
 }
}
function commInit(){
 setupCommissionerTabs();
 populatePrimarySeriesSelect($("athClass"),"250");populatePrimarySeriesSelect($("editAthClass"),"250");populateNationalitySelect($("athNationality"));populateNationalitySelect($("editAthNationality"));populateNationalitySelect($("eventCountry"));populateRegionSelect($("athNationalityRegion"),$("athNationality"));populateRegionSelect($("editAthNationalityRegion"),$("editAthNationality"));populateRegionSelect($("eventRegion"),$("eventCountry"));$("athNationality").onchange=()=>populateRegionSelect($("athNationalityRegion"),$("athNationality"));$("editAthNationality").onchange=()=>populateRegionSelect($("editAthNationalityRegion"),$("editAthNationality"));$("eventCountry").onchange=()=>populateRegionSelect($("eventRegion"),$("eventCountry"));$("commAthleteSearch").addEventListener("input",renderCommissionerAthletes);$("commAthleteSeriesFilter").addEventListener("change",renderCommissionerAthletes);$("commAthleteOwnerFilter").addEventListener("change",renderCommissionerAthletes);$("clearCommAthleteFilters").onclick=()=>{$("commAthleteSearch").value="";$("commAthleteSeriesFilter").value="";$("commAthleteOwnerFilter").value="";renderCommissionerAthletes()};$("commScheduleSearch").addEventListener("input",renderCommSchedule);["commScheduleSeriesFilter","commScheduleTypeFilter","commScheduleYearFilter"].forEach(id=>$(id).addEventListener("change",renderCommSchedule));$("clearCommScheduleFilters").onclick=()=>{$("commScheduleSearch").value="";$("commScheduleSeriesFilter").value="";$("commScheduleTypeFilter").value="";$("commScheduleYearFilter").value="";renderCommSchedule()};renderSecondarySeriesChecks("athSecondarySeries",[], $("athClass").value);renderSecondaryNumberInputs("athSecondaryNumberFields",[],{});renderSecondarySeriesChecks("editAthSecondarySeries",[], $("editAthClass").value);renderSecondaryNumberInputs("editAthSecondaryNumberFields",[],{});$("athSecondarySeries").addEventListener("change",()=>renderSecondaryNumberInputs("athSecondaryNumberFields",secondarySeriesChecked("athSecondarySeries",$("athClass").value),secondaryNumbersFromInputs("athSecondaryNumberFields")));$("editAthSecondarySeries").addEventListener("change",()=>renderSecondaryNumberInputs("editAthSecondaryNumberFields",secondarySeriesChecked("editAthSecondarySeries",$("editAthClass").value),secondaryNumbersFromInputs("editAthSecondaryNumberFields")));$("athClass").onchange=()=>refreshSecondarySeriesEditor("athSecondarySeries","athSecondaryNumberFields",$("athClass").value);$("editAthClass").onchange=()=>refreshSecondarySeriesEditor("editAthSecondarySeries","editAthSecondaryNumberFields",$("editAthClass").value);populateScheduleSeriesSelect();populateScoreSeriesSelect();populateDraftRoomSelects();setupScoreGrid();setupOfficialResultsImport();$("scoreForm").onsubmit=submitRaceResults;$("cancelScoreEdit").onclick=cancelScoreEdit;
 $("editAthleteForm").onsubmit=saveEditedAthlete;
 const cancelEdit=()=>{$("editAthletePanel").hidden=true;$("editAthleteForm").reset();$("editAthleteMessage").textContent=""};
 $("cancelEditAthlete").onclick=cancelEdit;$("cancelEditAthleteBottom").onclick=cancelEdit;
 const requestedCommissionerTab=new URLSearchParams(location.search).get("tab");
 const enterCommissionerBody=async()=>{
  const authenticated=await window.KFStorage?.commissionerSession?.();
  if(!authenticated){sessionStorage.removeItem("commAuthV2");$("commLogin").hidden=false;$("commBody").hidden=true;return false;}
  const meta=await window.KFStorage.getSeasonMeta();
  selectedSeasonYear=Number(sessionStorage.getItem("commSeasonYear")||meta.activeYear);
  if(selectedSeasonYear<2010||selectedSeasonYear>Number(meta.activeYear))selectedSeasonYear=Number(meta.activeYear);
  if(selectedSeasonYear!==Number(window.KFStorage.seasonYear))await window.KFStorage.setSeasonYear(selectedSeasonYear);
  sessionStorage.setItem("commAuthV2","yes");
  $("commLogin").hidden=true;$("commBody").hidden=false;
  await renderCommissionerSeasonControls();seed();renderComm();renderCommSchedule();renderHistoricalSeasonPanel();
  const requested=["athletes","scoring","draft","schedule","history","data"].includes(requestedCommissionerTab)?requestedCommissionerTab:"athletes";
  activateCommissionerTab(requested);return true;
 };
 if(sessionStorage.getItem("commAuthV2")==="yes")enterCommissionerBody().catch(error=>{$("commLogin").hidden=false;$("commLoginMessage").textContent=error.message||"Commissioner session could not be restored."});
 $("commLoginForm").onsubmit=async e=>{e.preventDefault();const button=e.submitter;if(button)button.disabled=true;try{await window.KFStorage.commissionerLogin($("commPassword").value);$("commPassword").value="";sessionStorage.setItem("commAuthV2","yes");await enterCommissionerBody();}catch(error){sessionStorage.removeItem("commAuthV2");$("commLoginMessage").textContent=error.message||"Incorrect password.";}finally{if(button)button.disabled=false;}};
 $("commLogout").onclick=async()=>{try{await window.KFStorage?.flush?.();}catch(error){alert(`Your latest changes could not be confirmed as saved. Please retry before signing out. ${error.message||""}`);return;}await window.KFStorage?.commissionerLogout?.();sessionStorage.removeItem("commAuthV2");sessionStorage.removeItem("commSeasonYear");selectedSeasonYear=Number(activeSeasonYear());$("commLogin").hidden=false;$("commBody").hidden=true;history.replaceState(null,"",location.pathname)};
 $("commissionerSeasonYear").onchange=()=>switchCommissionerSeason($("commissionerSeasonYear").value);
 $("copySeasonRiders").onclick=copyRidersFromSeason;$("copySeasonSchedule").onclick=copyScheduleFromSeason;$("archiveCurrentSeason").onclick=archiveCurrentSeason;$("addAthleteForm").onsubmit=e=>{e.preventDefault();const primary=$("athClass").value,a={id:uid(),name:clean($("athName").value),number:normalizeNumber($("athNumber").value,clean($("athName").value)),class:primary,primarySeries:primary,secondarySeries:secondarySeriesChecked("athSecondarySeries",primary),secondaryNumbers:secondaryNumbersFromInputs("athSecondaryNumberFields"),raceTeam:clean($("raceTeam").value),manufacturer:clean($("manufacturer").value),nationality:normalizeNationality($("athNationality").value),nationalityRegion:normalizeRegion($("athNationality").value,$("athNationalityRegion").value),pointsLeader:$("pointsLeader").checked,reigningSMXChampion:$("smxChampion").checked,reigningTripleCrownChampion:$("tripleCrownChampion").checked,reigningWorldChampion:$("worldChampion").checked};saveAthletes([...athletes(),a]);const k=$("assignTeam").value,t=teams().find(t=>key(t)===k);if(t&&!owner(a)&&roster(t).length<MAX_ROSTER_SIZE&&counts(t)[cls(a)]<REQ[cls(a)]){t.roster.push({...a});saveTeams(teams().map(x=>key(x)===k?t:x))}e.target.reset();populateRegionSelect($("athNationalityRegion"),$("athNationality"));renderSecondarySeriesChecks("athSecondarySeries",[],$("athClass").value);renderSecondaryNumberInputs("athSecondaryNumberFields",[],{});$("addMessage").textContent="Athlete added.";renderComm();refresh()};$("scoreForm").onsubmit=submitRaceResults;
 $("draftSeries").onchange=loadDraftAdminSettings;loadDraftAdminSettings();
 $("saveDraftOrder").onclick=()=>{const s=$("draftSeries").value,d=read(K.DS,{}),current=d[s]||{status:"Not started"},list=teams();if(draftOrderEditorLocked(s,current)){$("draftOrderMessage").textContent="Draft order cannot be changed after the draft has started.";return}if(!draftOrderKeysValid(draftOrderEditorKeys,list)){$("draftOrderMessage").textContent="The order must include every team exactly once.";return}current.orderTeamKeys=draftOrderEditorKeys.slice();d[s]=current;write(K.DS,d);$("draftOrderMessage").textContent=`Saved Round 1 order: ${draftOrderEditorKeys.map(k=>tname(list.find(t=>key(t)===k))).join(" → ")}. Round 2 will reverse this order.`;renderDraftOrderEditor()};
 $("saveDraftSettings").onclick=()=>{const d=read(K.DS,{}),s=$("draftSeries").value,current=d[s]||{status:"Not started"};current.scheduledStart=$("draftStart").value;if(current.status==="Not started"&&!current.scheduledStart&&current.start)current.start="";d[s]=current;write(K.DS,d);$("draftSettingsMessage").textContent=`${s} draft settings saved.`};
 $("startDraftNow").onclick=()=>{const d=read(K.DS,{}),s=$("draftSeries").value,current=d[s]||{},list=teams();if(list.length!==5||list.some(t=>!t.passwordHash)){$("draftSettingsMessage").textContent="All five teams must be claimed and have a team password before starting. Each team signs in to make its own pick.";return}const savedOrder=Array.isArray(current.orderTeamKeys)?current.orderTeamKeys.map(String):[];if(!draftOrderKeysValid(savedOrder,list)){$("draftSettingsMessage").textContent="Set and save the draft order above before starting this draft.";return}if(current.status==="Open"){$("draftSettingsMessage").textContent=`${s} draft is already open. Existing picks and the saved snake order are unchanged.`;return}current.status="Open";current.start=current.start||new Date().toISOString();current.orderTeamKeys=savedOrder;current.scheduledStart=$("draftStart").value||current.scheduledStart||"";d[s]=current;write(K.DS,d);$("draftSettingsMessage").textContent=`${s} draft started. Round 1: ${savedOrder.map(k=>tname(list.find(t=>key(t)===k))).join(" → ")}. Round 2 will reverse the order. Teams can now sign in on the Draft page.`;loadDraftAdminSettings()};
 $("pauseDraft").onclick=()=>setDraftAdminStatus("Paused");$("completeDraft").onclick=()=>setDraftAdminStatus("Complete");
 $("eventDate").addEventListener("change",()=>{$("eventEndDate").min=$("eventDate").value});$("eventSeries").addEventListener("change",()=>updateEventTypeFields($("eventSeries").value));$("eventSubType").addEventListener("change",()=>updateEventTypeFields($("eventSeries").value,$("eventSubType").value));updateEventTypeFields($("eventSeries").value||"SMX");$("scheduleForm").onsubmit=saveScheduleEvent;$("scheduledEventToEdit").onchange=()=>{$("loadScheduledEventEdit").disabled=!$("scheduledEventToEdit").value};$("loadScheduledEventEdit").onclick=()=>{const eventId=$("scheduledEventToEdit").value;if(eventId)beginEditEvent(eventId)};$("cancelEditEvent").onclick=()=>{resetScheduleEditor();$("scheduleMessage").textContent="Event edit cancelled."};
 $("yearlyReset").onclick=runYearlyRosterReset;
 $("resetData").onclick=()=>{if(confirm("Delete all league data from the local project database and this browser? This cannot be undone.")){const finish=()=>{sessionStorage.clear();location.reload()};if(window.KFStorage&&typeof window.KFStorage.clearAll==="function")window.KFStorage.clearAll().then(finish).catch(err=>alert("Could not clear saved data: "+err.message));else{Object.values(K).forEach(k=>localStorage.removeItem(k));sessionStorage.clear();location.reload()}}}
}
function renderCommSchedule(){
 const el=$("commSchedule");if(!el)return;
 const allEvents=read(K.CAL,[]).slice().sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")));
 const seriesValues=[...new Set(allEvents.map(event=>eventRoom(event.series)).filter(Boolean))].sort((a,b)=>SCHEDULE_SERIES.indexOf(a)-SCHEDULE_SERIES.indexOf(b)||a.localeCompare(b));
 const typeValues=[...new Set(allEvents.map(eventTypeLabel).filter(value=>value&&value!=="—"))].sort((a,b)=>a.localeCompare(b));
 const yearValues=[...new Set(allEvents.map(event=>String(event.date||"").slice(0,4)).filter(value=>/^\d{4}$/.test(value)))].sort((a,b)=>b.localeCompare(a));
 setCommissionerFilterOptions($("commScheduleSeriesFilter"),seriesValues.map(value=>({value,label:value})),"All series");
 setCommissionerFilterOptions($("commScheduleTypeFilter"),typeValues.map(value=>({value,label:value})),"All event types");
 setCommissionerFilterOptions($("commScheduleYearFilter"),yearValues.map(value=>({value,label:value})),"All years");
 const query=clean($("commScheduleSearch")?.value).toLowerCase(),seriesFilter=$("commScheduleSeriesFilter")?.value||"",typeFilter=$("commScheduleTypeFilter")?.value||"",yearFilter=$("commScheduleYearFilter")?.value||"";
 const events=allEvents.filter(event=>{
  const room=eventRoom(event.series),type=eventTypeLabel(event),year=String(event.date||"").slice(0,4);
  const searchable=[event.name,event.series,room,event.round,type,event.location,countryRegionLabel(event.country,event.region),event.date,event.endDate].join(" ").toLowerCase();
  return (!query||searchable.includes(query))&&(!seriesFilter||room===seriesFilter)&&(!typeFilter||type===typeFilter)&&(!yearFilter||year===yearFilter);
 });
 const summary=$("commScheduleFilterSummary");if(summary)summary.textContent=`Showing ${events.length.toLocaleString()} of ${allEvents.length.toLocaleString()} scheduled events.`;
 const picker=$("scheduledEventToEdit"),previousSelection=picker?.value||"";
 if(picker){picker.replaceChildren(new Option("Choose a scheduled event…",""));events.forEach(event=>picker.add(new Option(`${eventDateLabel(event)} · ${eventRoom(event.series)} · ${clean(event.name)||"Unnamed event"}`,String(event.id))));if(events.some(event=>String(event.id)===previousSelection))picker.value=previousSelection;$("loadScheduledEventEdit").disabled=!picker.value}
 el.innerHTML=table(["Date(s)","Round","Series","Event Type","Event","Country / Region","Location","Action"],events.map(e=>`<tr><td>${esc(eventDateLabel(e))}</td><td>${clean(e.round)?esc(e.round):"—"}</td><td>${scheduleSeriesBadge(e.series)}</td><td>${esc(eventTypeLabel(e))}</td><td>${esc(e.name)}</td><td>${eventCountryHTML(e)}</td><td>${esc(e.location||"—")}</td><td class="action-cell"><button type="button" class="btn alt schedule-edit-button" data-edit-event="${esc(e.id)}" aria-label="Edit scheduled event ${esc(e.name)}">Edit Scheduled Event</button> <button type="button" class="inline" data-delete-event="${esc(e.id)}">Delete</button></td></tr>`));
 el.querySelectorAll("[data-edit-event]").forEach(button=>button.onclick=()=>beginEditEvent(button.dataset.editEvent));
 el.querySelectorAll("[data-delete-event]").forEach(button=>button.onclick=()=>{const eventId=button.dataset.deleteEvent;if(!confirm("Delete this schedule event?"))return;write(K.CAL,read(K.CAL,[]).filter(e=>String(e.id)!==eventId));if(clean($("editEventId").value)===eventId)resetScheduleEditor();$("scheduleMessage").textContent="Event deleted.";renderCommSchedule();renderSchedule();renderScoreScheduleOptions();renderRosterLockNotice(document.body.dataset.page)});
}
function tradeInit(){options($("tradeTeam"),teams().map(t=>({value:key(t),label:tname(t)})),"Choose your team");const requestedTeam=new URLSearchParams(location.search).get("team"),managedTeam=sessionStorage.getItem("managedTeam");if(requestedTeam&&teams().some(t=>key(t)===requestedTeam)){$("tradeTeam").value=requestedTeam;if(managedTeam===requestedTeam)sessionStorage.setItem("tradeTeam",requestedTeam);else if(sessionStorage.getItem("tradeTeam")!==requestedTeam)sessionStorage.removeItem("tradeTeam")}$("tradeLoginForm").onsubmit=async e=>{e.preventDefault();if(renderRosterLockNotice("trades"))return;const t=teams().find(t=>key(t)===$("tradeTeam").value);if(!t||!t.passwordHash||await hash($("tradePassword").value)!==t.passwordHash){$("tradeLoginMessage").textContent="Team not claimed or password incorrect.";return}sessionStorage.setItem("tradeTeam",key(t));showTrades(key(t))};$("tradePartner").onchange=()=>{if(!renderRosterLockNotice("trades"))tradeChoices(sessionStorage.getItem("tradeTeam"))};$("tradeForm").onsubmit=submitTrade;$("tradeLogout").onclick=()=>{sessionStorage.removeItem("tradeTeam");$("tradeBody").hidden=true;$("tradeLogin").hidden=false};if(renderRosterLockNotice("trades"))return;const k=sessionStorage.getItem("tradeTeam");if(k)showTrades(k);else{$("tradeLogin").hidden=false;$("tradeBody").hidden=true}}

function markTradeResponsesViewed(k){
 const all=read(K.TR,[]),viewedAt=new Date().toISOString();let changed=false;
 all.forEach(tr=>{
  if(tr.fromKey===k&&["Accepted","Rejected"].includes(tr.status)&&!tr.responseViewedAt){tr.responseViewedAt=viewedAt;changed=true}
 });
 if(changed)write(K.TR,all);
}
function showTrades(k){if(renderRosterLockNotice("trades"))return;const t=teams().find(t=>key(t)===k);if(!t)return;$("tradeLogin").hidden=true;$("tradeBody").hidden=false;$("tradeSummary").innerHTML=`<div><strong>${esc(tname(t))}</strong><span>Your team</span></div><div><strong>${roster(t).length}/${MAX_ROSTER_SIZE}</strong><span>Roster</span></div><div><strong>${total(t)}</strong><span>Season points</span></div>`;options($("tradePartner"),teams().filter(x=>key(x)!==k&&x.owner).map(x=>({value:key(x),label:tname(x)})),"Choose partner");tradeChoices(k);renderTrades(k);markTradeResponsesViewed(k)}
function tradeChoices(k){const t=teams().find(t=>key(t)===k),p=teams().find(t=>key(t)===$("tradePartner").value);const render=(list,n)=>list.length?sortRiders(list).map(a=>`<label><input type="checkbox" name="${n}" value="${esc(id(a))}"> ${nationalityHTML(a.nationality,a.nationalityRegion)} ${numberHTML(a.number,a.manufacturer,a)} ${esc(name(a))} <small>(${esc(seriesDisplayText(a))})</small></label>`).join(""):"<p class=muted>No athletes.</p>";$("offerRoster").innerHTML=render(t?roster(t):[],"offer");$("requestRoster").innerHTML=render(p?roster(p):[],"request")}
function submitTrade(e){e.preventDefault();if(renderRosterLockNotice("trades"))return;const k=sessionStorage.getItem("tradeTeam"),t=teams().find(t=>key(t)===k),p=teams().find(t=>key(t)===$("tradePartner").value),offers=[...document.querySelectorAll('[name="offer"]:checked')].map(x=>x.value),requests=[...document.querySelectorAll('[name="request"]:checked')].map(x=>x.value);if(!t||!p||!offers.length||!requests.length){$("tradeMessage").textContent="Choose a partner and at least one athlete on each side.";return}const names=(team,ids)=>ids.map(i=>roster(team).find(a=>id(a)===i)).filter(Boolean).map(name);const all=read(K.TR,[]);all.push({id:uid(),fromKey:k,fromName:tname(t),toKey:key(p),toName:tname(p),offerIds:offers,requestIds:requests,offerNames:names(t,offers),requestNames:names(p,requests),note:clean($("tradeNote").value),status:"Pending",createdAt:new Date().toISOString()});write(K.TR,all);$("tradeMessage").textContent="Proposal submitted.";renderTrades(k)}
function tradeNamesHTML(tr,which){const ids=tr[`${which}Ids`]||[],saved=tr[`${which}Names`]||[];const entries=ids.length?ids.map((rid,i)=>{const a=athletes().find(x=>id(x)===String(rid));return {a,nm:a?name(a):(saved[i]||"Athlete")}}):saved.map(n=>({a:athletes().find(x=>norm(name(x))===norm(n)),nm:n}));return entries.sort((x,y)=>compareRiderNumbers(x.a||{name:x.nm,number:""},y.a||{name:y.nm,number:""})).map(({a,nm})=>athleteNameHTML(a||{name:nm})).join(" ")}
function renderTrades(k){const list=read(K.TR,[]).filter(t=>t.fromKey===k||t.toKey===k).slice().reverse();$("tradeList").innerHTML=table(["Status","From","To","Offer","Request","Message","Action"],list.map(t=>`<tr><td>${esc(t.status)}</td><td>${esc(t.fromName)}</td><td>${esc(t.toName)}</td><td>${tradeNamesHTML(t,"offer")}</td><td>${tradeNamesHTML(t,"request")}</td><td>${esc(t.note)}</td><td>${t.toKey===k&&t.status==="Pending"?`<button class="inline" data-accept="${t.id}">Accept</button> <button class="inline" data-reject="${t.id}">Reject</button>`:"—"}</td></tr>`));$("tradeList").querySelectorAll("[data-accept]").forEach(b=>b.onclick=()=>respondTrade(b.dataset.accept,"Accepted",k));$("tradeList").querySelectorAll("[data-reject]").forEach(b=>b.onclick=()=>respondTrade(b.dataset.reject,"Rejected",k))}
function respondTrade(tid,status,k){if(renderRosterLockNotice("trades"))return;const all=read(K.TR,[]),tr=all.find(t=>t.id===tid);if(!tr||tr.toKey!==k||tr.status!=="Pending")return;if(status==="Accepted"){const a=teams().find(t=>key(t)===tr.fromKey),b=teams().find(t=>key(t)===tr.toKey);const offered=tr.offerIds.map(i=>roster(a).find(r=>id(r)===i)),requested=tr.requestIds.map(i=>roster(b).find(r=>id(r)===i));if(offered.some(x=>!x)||requested.some(x=>!x)){alert("Trade could not be completed: a roster changed.");return}const ar=roster(a).filter(r=>!tr.offerIds.includes(id(r))).concat(requested),br=roster(b).filter(r=>!tr.requestIds.includes(id(r))).concat(offered);const valid=r=>r.length<=MAX_ROSTER_SIZE&&Object.entries(REQ).every(([c,n])=>r.filter(x=>cls(x)===c).length<=n);if(!valid(ar)||!valid(br)){alert("Trade exceeds a roster quota.");return}a.roster=ar;b.roster=br;saveTeams(teams().map(t=>key(t)===key(a)?a:key(t)===key(b)?b:t))}tr.status=status;tr.respondedAt=new Date().toISOString();tr.respondedBy=k;write(K.TR,all);showTrades(k);refresh()}
function draftData(){const value=read(K.D,{picks:[]});return value&&typeof value==="object"&&!Array.isArray(value)?{...value,picks:Array.isArray(value.picks)?value.picks:[]}:{picks:[]}}
function draftRoomPicks(room,data=draftData()){return data.picks.filter(p=>p.room===room)}
function draftOrder(settings){const current=teams(),stored=Array.isArray(settings.orderTeamKeys)?settings.orderTeamKeys.map(String):[];return draftOrderKeysValid(stored,current)?stored.map(k=>current.find(t=>key(t)===k)):current}
function draftTeamAtSequence(order,sequenceIndex){if(!order.length)return null;const round=Math.floor(sequenceIndex/order.length),position=sequenceIndex%order.length,index=round%2===0?position:order.length-1-position;return order[index]||null}
function currentDraftTeam(room,settings,data=draftData()){const order=draftOrder(settings),picks=draftRoomPicks(room,data);return draftTeamAtSequence(order,picks.length)}
function draftEligibleForRoom(a,room){const roomClasses=SERIES_GROUPS[room]||[];return athleteSeries(a).some(series=>roomClasses.includes(series))}
function draftEligibleForTeam(a,room,t,data){if(!a||owner(a)||!draftEligibleForRoom(a,room)||!t)return false;if(roster(t).length>=MAX_ROSTER_SIZE||counts(t)[cls(a)]>=REQ[cls(a)])return false;return !draftRoomPicks(room,data).some(p=>p.athleteId&&String(p.athleteId)===id(a))}
function draftTeamSession(){const k=sessionStorage.getItem("draftTeam");return teams().find(t=>key(t)===k)||null}
function setDraftMessage(message){const el=$("draftMessage");if(el)el.textContent=message}
function submitTeamDraftPick(pass=false){const room=$("draftRoom").value,settings=read(K.DS,{})[room]||{status:"Not started"},data=draftData(),picks=draftRoomPicks(room,data),expected=currentDraftTeam(room,settings,data),team=draftTeamSession();if(settings.status!=="Open"){setDraftMessage(settings.status==="Paused"?"This draft is paused by the commissioner.":settings.status==="Complete"?"This draft is complete.":"The commissioner has not started this draft yet.");return}if(!team){setDraftMessage("Sign in with your team password before making a pick.");return}if(!expected||key(expected)!==key(team)){setDraftMessage(`It is not your turn. The next pick belongs to ${expected?tname(expected):"the next team"}.`);return}let athlete=null;if(!pass){athlete=athletes().find(a=>id(a)===$("draftAthlete").value);if(!athlete||!draftEligibleForTeam(athlete,room,team,data)){setDraftMessage("Choose an available athlete who fits your team's remaining roster spots.");return}}
 const pickNumber=picks.length+1,order=draftOrder(settings),entry={id:uid(),room,number:pickNumber,round:Math.floor((pickNumber-1)/Math.max(1,order.length))+1,teamKey:key(team),teamName:tname(team),passed:!!pass,athleteId:athlete?id(athlete):"",athleteName:athlete?name(athlete):"Passed",athleteClass:athlete?cls(athlete):"",athleteSecondarySeries:athlete?[...(athlete.secondarySeries||[])]:[],athleteDraftSeries:athlete?athleteSeriesForDraftRoom(athlete,room):"",athleteSecondaryNumbers:athlete?{...(athlete.secondaryNumbers||{})}:{},riderNumber:athlete?clean(athleteNumberForDraftRoom(athlete,room)):"",raceTeam:athlete?clean(athlete.raceTeam):"",manufacturer:athlete?clean(athlete.manufacturer):"",nationality:athlete?normalizeNationality(athlete.nationality):"",nationalityRegion:athlete?normalizeRegion(athlete.nationality,athlete.nationalityRegion):"",time:new Date().toISOString()};
 // Save the turn advancement first so every connected draft room sees the next team immediately.
 data.picks.push(entry);write(K.D,data);
 if(athlete){team.roster=[...roster(team),{...athlete}];saveTeams(teams().map(t=>key(t)===key(team)?team:t))}
 setDraftMessage(pass?`${tname(team)} passed pick ${pickNumber}.`:`${tname(team)} selected ${name(athlete)}.`);renderDraft();refresh();
}
function renderProjectedDraftTable(room){
 const target=$("draftProjectionTable"),status=$("draftProjectionStatus");if(!target)return;
 const cached=draftProjectionCache.get(room);
 if(!cached){target.innerHTML='<p class="muted">Loading projected picks…</p>';if(status)status.textContent="Loading career averages from active and archived seasons…";return}
 const entries=Array.isArray(cached.athletes)?cached.athletes:[];
 const sorted=entries.slice().sort((a,b)=>Number(b.average||0)-Number(a.average||0)||Number(b.rounds||0)-Number(a.rounds||0)||Number(b.totalPoints||0)-Number(a.totalPoints||0)||String(a.name||"").localeCompare(String(b.name||""),undefined,{sensitivity:"base"}));
 target.innerHTML=table(["Projected Pick Number","Athlete","Average Points / Round"],sorted.map((athlete,index)=>{const displaySeries=athleteSeriesForDraftRoom(athlete,room),number=athleteNumberForDraftRoom(athlete,room);return `<tr><td class="points">${index+1}</td><td>${athleteDetailButtonHTML(athlete,true,true,displaySeries,number)}</td><td class="points">${Number(athlete.average||0).toFixed(2)}</td></tr>`}));
 if(status)status.textContent=`${sorted.length.toLocaleString()} athletes ranked for ${room}. Averages include published active and archived season results for each athlete’s draft-eligible class.`;
}
async function loadDraftProjections(room,force=false){
 const target=$("draftProjectionTable");if(!target)return;
 const cached=draftProjectionCache.get(room);
 if(!force&&cached&&Date.now()-cached.loadedAt<60000){renderProjectedDraftTable(room);return}
 if(draftProjectionPending.has(room)){renderProjectedDraftTable(room);return}
 if(force)draftProjectionCache.delete(room);
 const request=(async()=>{
  try{
   const response=await fetch(`/api/public/draft-projections?room=${encodeURIComponent(room)}`,{cache:"no-store",credentials:"same-origin"});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(result.error||`Projected picks could not be loaded (HTTP ${response.status}).`);
   if(!Array.isArray(result.athletes))throw new Error("The projection service returned an invalid athlete list.");
   draftProjectionCache.set(room,{...result,loadedAt:Date.now()});
   if($("draftRoom")?.value===room)renderProjectedDraftTable(room);
  }catch(error){
   if($("draftRoom")?.value===room){
    target.innerHTML=`<p class="muted">${esc(error.message||"Projected picks could not be loaded.")}</p>`;
    const status=$("draftProjectionStatus");if(status)status.textContent="Projection data is unavailable. Draft picks and season scoring are unaffected.";
   }
  }finally{draftProjectionPending.delete(room)}
 })();
 draftProjectionPending.set(room,request);
 await request;
}
function setDraftTab(tab){
 activeDraftTab=tab==="projected"?"projected":"draft";
 document.querySelectorAll("[data-draft-tab]").forEach(button=>{const active=button.dataset.draftTab===activeDraftTab;button.classList.toggle("active",active);button.setAttribute("aria-selected",active?"true":"false")});
 $("draftTabPanel-draft").hidden=activeDraftTab!=="draft";
 $("draftTabPanel-projected").hidden=activeDraftTab!=="projected";
 if(activeDraftTab==="projected")loadDraftProjections($("draftRoom")?.value||"SMX");
}
function draftInit(){const room=$("draftRoom");room.onchange=()=>{setDraftMessage("");renderDraft();loadDraftProjections(room.value,true)};document.querySelectorAll("[data-draft-tab]").forEach(button=>button.addEventListener("click",()=>setDraftTab(button.dataset.draftTab)));options($("draftLoginTeam"),teams().filter(t=>t.passwordHash).map(t=>({value:key(t),label:tname(t)})),"Choose your team");$("draftLoginForm").onsubmit=async e=>{e.preventDefault();const team=teams().find(t=>key(t)===$("draftLoginTeam").value);if(!team||!team.passwordHash||await hash($("draftLoginPassword").value)!==team.passwordHash){$("draftLoginMessage").textContent="Team password is incorrect, or the team has not been claimed.";return}sessionStorage.setItem("draftTeam",key(team));$("draftLoginPassword").value="";$("draftLoginMessage").textContent="";renderDraft()};$("draftLogout").onclick=()=>{sessionStorage.removeItem("draftTeam");setDraftMessage("");renderDraft()};$("draftPickForm").onsubmit=e=>{e.preventDefault();submitTeamDraftPick(false)};$("draftPassButton").onclick=()=>{if(confirm("Pass this draft pick? The next team will be able to select an athlete."))submitTeamDraftPick(true)};renderDraft();loadDraftProjections(room.value);setDraftTab("draft");startDraftSync()}
function renderDraft(){if(!$("draftStatusCard"))return;const room=$("draftRoom").value,settings=read(K.DS,{})[room]||{status:"Not started"},data=draftData(),picks=draftRoomPicks(room,data),order=draftOrder(settings),expected=currentDraftTeam(room,settings,data),team=draftTeamSession(),pickNumber=picks.length+1,round=order.length?Math.floor((pickNumber-1)/order.length)+1:1;const status=settings.status||"Not started",scheduled=clean(settings.scheduledStart||(status==="Not started"?settings.start:"")),scheduledLabel=scheduled?formatVancouverDateTime(scheduled):"Not scheduled",syncNotice=window.KFStorage?.mode==="server"&&!window.KFStorage?.lastError&&!window.KFStorage?.pendingWrites?"Connected to shared GitHub-backed league storage. This room checks for new picks every 2.5 seconds.":"GitHub storage is unavailable or a save is pending. The browser copy is retained until the connection is restored.";
 const firstRoundOrder=order.map(t=>esc(tname(t))).join(" → "),secondRoundOrder=order.slice().reverse().map(t=>esc(tname(t))).join(" → ");$("draftStatusCard").innerHTML=`<div class="summary draft-status-summary"><div><strong>${esc(room)}</strong><span>Draft room</span></div><div><strong>${esc(scheduledLabel)}</strong><span>Scheduled Start · Vancouver Time</span></div><div><strong>${esc(status)}</strong><span>Draft Room Status</span></div><div><strong>${expected?esc(tname(expected)):"—"}</strong><span>${status==="Open"?`Pick ${pickNumber} · Round ${round} · On the clock`:"Next team"}</span></div></div><p class="muted">${status==="Open"?`Round 1: ${firstRoundOrder}. Round 2: ${secondRoundOrder}. The order reverses every round. Pick ${pickNumber} is next.`:status==="Paused"?"The commissioner has paused this draft.":status==="Complete"?"The commissioner has marked this draft complete.":""} ${esc(syncNotice)}</p>`;
 options($("draftLoginTeam"),teams().filter(t=>t.passwordHash).map(t=>({value:key(t),label:tname(t)})),"Choose your team");const logged=!!team;$("draftLogin").hidden=logged;$("draftTeamPanel").hidden=!logged;if(logged){$("draftLoggedInTeam").textContent=tname(team);$("draftTurnNotice").textContent=status!=="Open"?(status==="Paused"?"Draft paused. Wait for the commissioner to resume it.":status==="Complete"?"This draft is complete.":`Draft not open yet. Scheduled for ${scheduledLabel}.`):expected&&key(expected)===key(team)?`It is your turn — Pick ${pickNumber}, Round ${round}.`:`You are signed in as ${tname(team)}. Waiting for ${expected?tname(expected):"the next team"} to pick.`;const canPick=status==="Open"&&expected&&key(expected)===key(team);$("draftPickForm").hidden=!canPick;$("draftPassButton").hidden=!canPick;const free=sortRiders(athletes().filter(a=>!a.seriesArchived&&draftEligibleForTeam(a,room,team,data)));options($("draftAthlete"),free.map(a=>({value:id(a),label:`${nationalityText(a.nationality,a.nationalityRegion)} #${clean(athleteNumberForDraftRoom(a,room))||"—"} ${name(a)} — ${seriesDisplayText(a)}`})),free.length?"Choose available athlete":"No eligible riders available");$("draftPickForm").querySelector("button[type=submit]").disabled=!free.length;$("draftPassButton").disabled=false}else{$("draftPickForm").hidden=true;$("draftPassButton").hidden=true}
 $("draftPicks").innerHTML=table(["Pick","Round","Team","Athlete","Class","Time"],picks.map(p=>{const a=p.athleteId?riderFromPick(p):null;return `<tr><td>${esc(p.number)}</td><td>${esc(p.round||Math.floor((Number(p.number)-1)/Math.max(1,order.length))+1)}</td><td>${esc(p.teamName||teams().find(t=>key(t)===p.teamKey)?.name||"Team")}</td><td>${p.passed||!p.athleteId?"Passed":athleteNameHTML(a||{name:p.athleteName,number:p.riderNumber,class:p.athleteClass,nationality:p.nationality,nationalityRegion:p.nationalityRegion},true,true,p.athleteDraftSeries||p.athleteClass,p.riderNumber)}</td><td>${p.athleteId?seriesDisplayHTML(a||{class:p.athleteClass,secondarySeries:p.athleteSecondarySeries||[]}):esc(p.athleteClass||"—")}</td><td>${formatVancouverDateTime(p.time)}</td></tr>`}))}
let draftSyncTimer=null;function startDraftSync(){if(draftSyncTimer)clearInterval(draftSyncTimer);if(!window.KFStorage||window.KFStorage.mode!=="server")return;const sync=async()=>{try{const changed=await window.KFStorage.refreshFromServer();if(changed){renderDraft();draftProjectionCache.delete($("draftRoom")?.value||"SMX");if(activeDraftTab==="projected")loadDraftProjections($("draftRoom")?.value||"SMX",true)}}catch(err){console.warn("Draft room sync failed:",err)}};draftSyncTimer=setInterval(sync,2500);window.addEventListener("focus",sync)}
function eventRoom(series){const value=clean(series);if(["CAN","CAN 250","CAN 450"].includes(value))return "Triple Crown Series";for(const [room,classes] of Object.entries(SERIES_GROUPS)){if(classes.includes(value))return room}return value} 
function renderSchedule(){if(!$("scheduleTable"))return;const selected=[...document.querySelectorAll("#seriesFilters input:checked")].map(x=>x.value),list=read(K.CAL,[]).filter(e=>selected.includes(eventRoom(e.series))).sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")));$("scheduleTable").innerHTML=table(["Date(s)","Round","Series","Event Type","Event","Country / Region","Location"],list.map(e=>`<tr><td>${esc(eventDateLabel(e))}</td><td>${clean(e.round)?esc(e.round):"—"}</td><td>${scheduleSeriesBadge(e.series)}</td><td>${esc(eventTypeLabel(e))}</td><td>${esc(e.name)}</td><td>${eventCountryHTML(e)}</td><td>${esc(e.location||"—")}</td></tr>`))}
function refresh(){standings();renderTeams();renderAthletes();if(document.body.dataset.page==="teams-manufacturers")renderCombinedDirectory();else if(activeDirectoryPage){if(activeDirectoryKey)renderDirectorySelection();else renderDirectoryMenu();}if($("commBody")&&!$("commBody").hidden)renderComm();if($("manageLogin")){const panel=$("teamManagePanel"),k=sessionStorage.getItem("managedTeam"),params=new URLSearchParams(location.search),requested=!!params.get("team")||!!k||params.get("manage")==="1";if(panel)panel.hidden=!requested;if(!renderRosterLockNotice("manage")){if(k&&teams().some(t=>key(t)===k))showManage(k);else{$("manageLogin").hidden=false;$("manageBody").hidden=true}}}if($("tradeLogin")){if(!renderRosterLockNotice("trades")){const k=sessionStorage.getItem("tradeTeam");if(k)showTrades(k);else{$("tradeLogin").hidden=false;$("tradeBody").hidden=true}}}if($("draftStatusCard"))renderDraft();renderSchedule()}
function startTeamTradeAlertSync(){if(document.body.dataset.page!=="teams")return;let syncing=false;const sync=async()=>{const k=sessionStorage.getItem("managedTeam");if(!k||syncing)return;syncing=true;try{if(window.KFStorage&&window.KFStorage.mode==="server"){const changed=await window.KFStorage.refreshFromServer();if(changed&&sessionStorage.getItem("managedTeam")===k)renderTeamTradeAlerts(k)}else{renderTeamTradeAlerts(k)}}catch(error){console.warn("Trade alert sync failed:",error)}finally{syncing=false}};window.addEventListener("storage",event=>{if(event.key===K.TR){const k=sessionStorage.getItem("managedTeam");if(k)renderTeamTradeAlerts(k)}});window.addEventListener("focus",sync);window.addEventListener("pageshow",sync);setInterval(sync,15000)}
function scheduleDailyRosterLockRefresh(){const page=document.body.dataset.page;if(page!=="teams"&&page!=="manage"&&page!=="trades")return;setTimeout(()=>{refresh();scheduleDailyRosterLockRefresh()},60000)}
function dataInit(){
 const status=$("dataModeDetail"),message=$("dataMessage");
 const mode=window.KFStorage?.mode||"browser",storageError=window.KFStorage?.lastError?.message||"",pendingWrites=Number(window.KFStorage?.pendingWrites||0);
 if(status){const available=mode==="server"&&!storageError&&pendingWrites===0;status.textContent=available?"Connected":pendingWrites>0?"Saving changes to GitHub…":`Unavailable: ${storageError||"browser copy retained; reconnecting automatically."}`;status.className=available?"storage-detail good":"storage-detail warn";}
 const showCount=()=>{const target=$("dataCategoryCount");if(!target)return;const keys=["kaiserFantasyAthletes","kaiserFantasyTeams","kaiserFantasyScores","kaiserFantasyTrades","kaiserFantasyDraftState","kaiserFantasyDraftSettings","kaiserFantasySchedule"];const count=keys.filter(k=>localStorage.getItem(k)!==null).length;target.textContent=`${count} of ${keys.length} data categories currently have saved records.`};showCount();
 $("saveDataNow")?.addEventListener("click",async()=>{if(!window.KFStorage){message.textContent="Storage helper is unavailable. Refresh this page.";return}try{await window.KFStorage.flush();message.textContent=window.KFStorage.mode==="server"?`All pending changes have been committed to ${window.KFStorage.location||"the GitHub repository"}.`:"Browser data is saved in this browser, but GitHub is not connected. Download a JSON backup or reconnect to the GitHub-backed site.";showCount()}catch(err){message.textContent="Save failed: "+err.message}});
 $("exportData")?.addEventListener("click",async()=>{try{const state=await window.KFStorage.exportState();const backup={format:"kaiser-family-fantasy-smx-backup-v1",exportedAt:new Date().toISOString(),state};const blob=new Blob([JSON.stringify(backup,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`kaiser-fantasy-backup-${window.KFStorage?.seasonYear||activeSeasonYear()}-${localDateISO()}.json`;a.click();URL.revokeObjectURL(url);message.textContent=window.KFStorage?.lastExportUsedBrowserCopy?"Backup downloaded from this browser's retained copy because the latest GitHub save could not be read."+ (window.KFStorage?.lastError?" GitHub error: "+window.KFStorage.lastError.message:" "):"Backup downloaded from the latest available league data."}catch(err){message.textContent="Could not create backup: "+err.message}});
 $("importData")?.addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;try{const parsed=JSON.parse(await file.text()),state=parsed.state||parsed;if(!state||typeof state!=="object"||Array.isArray(state))throw new Error("This file is not a valid league backup.");if(!confirm("Replace the current league data with this backup? The current data will be overwritten.")){e.target.value="";return}await window.KFStorage.replaceState(state);message.textContent=`Season ${window.KFStorage?.seasonYear||activeSeasonYear()} backup restored. Reloading the website…`;setTimeout(()=>location.reload(),250)}catch(err){message.textContent="Import failed: "+err.message}finally{e.target.value=""}});

 const githubStatus=$("githubBackupStatus"),githubLatest=$("githubBackupLatest"),githubMessage=$("githubBackupMessage");
 const githubPassword=()=>$("githubBackupPassword")?.value||"";
 const saveGithubButton=$("saveLeagueToGithub"),syncButton=$("syncNewestLeagueSave"),refreshButton=$("refreshGithubStatus");
 async function refreshGithubStatus(){
  if(!githubStatus)return;
  const statusTicket=window.KFStorage?.beginStatusCheck?.();
  githubStatus.textContent="Checking the GitHub league save…";githubStatus.className="storage-detail warn";
  const publishStatus=(text,state)=>{
   if(typeof window.KFStorage?.reportStatus==="function"){
    const applied=window.KFStorage.reportStatus(text,state,statusTicket);
    if(!applied)return false;
   }else{
    const banner=$("kfStorageBanner");if(banner){banner.textContent=text;banner.className="storage-banner "+(state==="good"?"good":"warn");}
    const dataMode=$("dataModeDetail");if(dataMode){dataMode.textContent=text;dataMode.className="storage-detail "+(state==="good"?"good":"warn");}
   }
   githubStatus.textContent=text;githubStatus.className="storage-detail "+(state==="good"?"good":"warn");
   return true;
  };
  try{
   const statusYear=window.KFStorage?.seasonYear||activeSeasonYear();
   const response=await fetch(`/api/github/status?year=${encodeURIComponent(statusYear)}`,{cache:"no-store",credentials:"same-origin"});
   const info=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(info.error||`The Node.js API returned HTTP ${response.status} while checking GitHub connectivity. Open /healthz to verify the deployed server build.`);
   if(info.build!=="kf-draft-team-number-colors-20261123b")throw new Error("The deployed server is running an older storage-status build. Deploy the latest GitHub status consistency project ZIP and reopen the site.");
   if(!info.configured){
    const message=`Unavailable: GitHub-only saving is waiting for GITHUB_TOKEN. Repository is set to ${info.repository||"tkaiser930-droid/LeagueSave"}; add a fine-grained token with Contents: Read and write and Metadata: Read.`;
    if(!publishStatus(message,"warn"))return;
    githubLatest.textContent="GitHub is the only shared server-side league store. Configure the server token to enable cross-device saving.";saveGithubButton.disabled=true;syncButton.disabled=true;return;
   }
   const storageMode=window.KFStorage?.mode||"browser";
   const pendingWrites=Number(window.KFStorage?.pendingWrites||0);
   if(storageMode!=="server" || info.error || info.verified!==true || info.autoSaveLastError){
    const reason=info.error||info.autoSaveLastError||"The browser has not connected to the GitHub-backed season API.";
    const message=`Unavailable: ${reason}`;
    if(!publishStatus(message,"warn"))return;
   }else if(pendingWrites>0){
    if(!publishStatus("Saving changes to GitHub…","saving"))return;
   }else{
    if(!publishStatus("Connected","good"))return;
   }
   const gh=info.latestGitHubSave;const githubWhen=gh?.savedAt?formatVancouverDateTime(gh.savedAt):"no GitHub JSON save yet";
   const activeWhen=info.activeSavedAt?formatVancouverDateTime(info.activeSavedAt):"not yet loaded";
   githubLatest.textContent=`GitHub save: ${githubWhen}. Active in-memory copy: ${activeWhen}. Season file: ${info.dataPath||`league-data/seasons/${info.statusYear||info.activeYear||2027}.json`}. Verified at: ${info.verifiedAt?formatVancouverDateTime(info.verifiedAt):"not verified"}.`;
   const storageVerified=!info.error&&info.verified===true;
   saveGithubButton.disabled=!info.writeReady||!storageVerified;syncButton.disabled=!info.writeReady||!storageVerified;
   if(info.autoSaveLastError)githubMessage.textContent="Last automatic GitHub JSON save failed: "+info.autoSaveLastError;
   else if(info.autoSaveLastAt)githubMessage.textContent="Last automatic GitHub save check: "+formatVancouverDateTime(info.autoSaveLastAt);
   else if(!info.writeReady)githubMessage.textContent="Set GITHUB_BACKUP_PASSWORD on the server to enable manual GitHub save and sync actions.";
   else if(info.lastSync?.message)githubMessage.textContent=info.lastSync.message;
  }catch(err){
   const message="Unavailable: "+err.message;
   if(!publishStatus(message,"warn"))return;
   githubLatest.textContent="The browser copy remains available for download. Shared saves require a successful live GitHub verification.";saveGithubButton.disabled=true;syncButton.disabled=true;
  }
 }
 async function githubAction(path,body){
  const password=githubPassword();if(!password)throw new Error("Enter the GitHub backup action password first.");
  const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json","X-KF-GitHub-Backup-Password":password},body:JSON.stringify({...body,year:body?.year||window.KFStorage?.seasonYear||activeSeasonYear()}),cache:"no-store"});
  const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||`GitHub request failed (HTTP ${response.status}).`);return result;
 }
 saveGithubButton?.addEventListener("click",async()=>{try{await window.KFStorage?.flush();saveGithubButton.disabled=true;githubMessage.textContent=`Confirming the ${window.KFStorage?.seasonYear||activeSeasonYear()} season file in GitHub…`;const result=await githubAction("/api/github/save",{year:window.KFStorage?.seasonYear||activeSeasonYear()});githubMessage.textContent=result.changed?`Saved season ${result.seasonYear||window.KFStorage?.seasonYear} to GitHub (${result.commit?.shortSha||result.commit?.sha?.slice(0,7)||"commit confirmed"}).`:`GitHub already has this exact season save.`;await refreshGithubStatus();}catch(err){githubMessage.textContent="GitHub league save failed: "+err.message;saveGithubButton.disabled=false;}});
 syncButton?.addEventListener("click",async()=>{if(prompt("Replace this site's current in-memory copy with the latest league-data JSON saved in GitHub? Type LOAD GITHUB to continue.")!=="LOAD GITHUB")return;try{await window.KFStorage?.flush();syncButton.disabled=true;githubMessage.textContent="Loading the latest GitHub league save…";const result=await githubAction("/api/github/reload",{year:window.KFStorage?.seasonYear||activeSeasonYear()});await window.KFStorage?.loadServerState();githubMessage.textContent=result.message+" Reloading the league data…";setTimeout(()=>location.reload(),300);}catch(err){githubMessage.textContent="GitHub reload failed: "+err.message;syncButton.disabled=false;}});
 refreshButton?.addEventListener("click",async()=>{
  if((window.KFStorage?.mode!=="server"||window.KFStorage?.lastError)&&typeof window.KFStorage?.reconnect==="function"){
   refreshButton.disabled=true;githubMessage.textContent="Reconnecting to GitHub-backed league storage…";
   const connected=await window.KFStorage.reconnect();
   githubMessage.textContent=connected?"GitHub connection restored. Any retained unsynced browser changes were synchronized where safe.":"GitHub is still unavailable. The browser copy remains available; automatic reconnection will continue.";
   refreshButton.disabled=false;
  }
  await refreshGithubStatus();
 });
 refreshGithubStatus();
}
function init(){seed();document.addEventListener("click",event=>{const trigger=event.target.closest("[data-athlete-detail]");if(trigger){event.preventDefault();openAthleteDetail(trigger.dataset.athleteDetail)}});const p=document.body.dataset.page;if(p==="home")standings();if(p==="teams"){renderTeams();setupManage();startTeamTradeAlertSync();}if(p==="athletes"||p==="available"||p==="all"){populateClassFilter();if($("availabilityFilter"))$("availabilityFilter").value=new URLSearchParams(location.search).get("availability")==="available"?"available":"all";["search","classFilter","ownerFilter","availabilityFilter"].forEach(i=>$(i)?.addEventListener("input",renderAthletes));renderAthletes()}if(p==="race-teams"||p==="manufacturers")directoryInit(p);if(p==="teams-manufacturers")combinedDirectoryInit();if(p==="manage")setupManage();if(p==="commissioner")commInit();if(p==="trades")tradeInit();if(p==="draft")draftInit();if(p==="schedule"){const f=$("seriesFilters");f.innerHTML=SCHEDULE_SERIES.map(s=>`<label><input type="checkbox" value="${s}" checked> ${s}</label>`).join("");f.querySelectorAll("input").forEach(x=>x.onchange=renderSchedule);renderSchedule()}if(p==="teams"||p==="manage"||p==="trades")scheduleDailyRosterLockRefresh()}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();window.addEventListener("storage",refresh);
})();
