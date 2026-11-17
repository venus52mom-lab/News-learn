/* =========================================================
   共用引擎：語言地區、抓新聞、免費翻譯、音標、名詞解釋、背景播放
   所有資料只放在記憶體或這支手機的瀏覽器，不會存到 GitHub
   ========================================================= */

/* ---------- 小工具 ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const today = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Taipei'}).format(new Date());
const timeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
const any = ps => new Promise((res, rej) => { let n = ps.length; if(!n) rej(new Error('none')); ps.forEach(p => p.then(res, () => { if(--n === 0) rej(new Error('all failed')); })); });
async function pool(tasks, n){ let i = 0; const run = async () => { while(i < tasks.length){ const k = i++; try{ await tasks[k](); }catch(e){} } }; await Promise.all(Array.from({length:n}, run)); }
const flagOf = cc => cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '🌐';
function fmtTime(d){
  const t = new Date(d); if(isNaN(t)) return '';
  return t.toLocaleString('zh-TW', {timeZone:'Asia/Taipei', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false});
}

/* ---------- 深淺色 ---------- */
const THEMES = {auto:'🌗 自動', light:'☀️ 淺色', dark:'🌙 深色'};
function applyTheme(){
  const th = store.get('nl_theme', 'auto');
  document.documentElement.dataset.theme = th;
  const b = $('#themeBtn'); if(b) b.textContent = THEMES[th] || THEMES.auto;
  const dark = th === 'dark' || (th === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  const m = document.querySelector('meta[name=theme-color]'); if(m) m.content = dark ? '#1b1c1e' : '#f4f1ea';
}
function cycleTheme(){ const ks = Object.keys(THEMES); store.set('nl_theme', ks[(ks.indexOf(store.get('nl_theme', 'auto')) + 1) % ks.length]); applyTheme(); }
try{ matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); }catch(e){}

/* ---------- 頁首導覽 ---------- */
function pageNav(active){
  const p = [['index.html','📰 新聞'],['radio.html','📻 新聞廣播'],['reader.html','📖 電子書']];
  return `<nav class="pages">${p.map(([h, n]) => `<a href="${h}" class="${h === active ? 'on' : ''}">${n}</a>`).join('')}</nav>`;
}

/* =========================================================
   語言與地區
   ========================================================= */
const BBC = s => `https://feeds.bbci.co.uk/news/${s}rss.xml`;
const NPR = id => `https://feeds.npr.org/${id}/rss.xml`;
const NHK = n => `https://www3.nhk.or.jp/rss/news/cat${n}.xml`;
const TW_EXTRA = {
  local: ['https://news.ltn.com.tw/rss/all.xml', 'https://tw.news.yahoo.com/rss/'],
  world: ['https://news.ltn.com.tw/rss/world.xml', 'https://tw.news.yahoo.com/rss/world'],
  fin:   ['https://news.ltn.com.tw/rss/business.xml', 'https://tw.stock.yahoo.com/rss?category=news'],
  tech:  ['https://tw.news.yahoo.com/rss/technology'],
  health:['https://tw.news.yahoo.com/rss/health'],
  pol:   ['https://news.ltn.com.tw/rss/politics.xml'],
  life:  ['https://news.ltn.com.tw/rss/life.xml', 'https://tw.news.yahoo.com/rss/lifestyle']
};
const BUILTIN = {
  zh:{hidden:true, name:'中文', short:'中', pol:'政治 OR 立法院 OR 行政院 OR 總統府', life:'生活 OR 民生 OR 消費', regions:{
    tw:{cc:'TW', place:'台灣', accent:'台灣華語', tts:'zh-TW', hl:'zh-TW', ceid:'TW:zh-Hant', extra:TW_EXTRA, localFirst:['pol','life']}}},
  en:{name:'English', short:'EN', words:true, pol:'politics', life:'lifestyle OR food OR travel OR consumer', regions:{
    us:{cc:'US', place:'美國', accent:'美式英語', tts:'en-US', hl:'en-US', extra:{pol:[NPR(1014)], local:[NPR(1001)], world:[NPR(1004)], fin:[NPR(1006)], tech:[NPR(1019)], health:[NPR(1128)]}},
    uk:{cc:'GB', place:'英國', accent:'英式英語', tts:'en-GB', hl:'en-GB', extra:{pol:[BBC('politics/')], local:[BBC('uk/')], world:[BBC('world/')], fin:[BBC('business/')], tech:[BBC('technology/')], health:[BBC('health/')]}},
    au:{cc:'AU', place:'澳洲', accent:'澳洲英語', tts:'en-AU', hl:'en-AU', extra:{local:['https://www.abc.net.au/news/feed/51120/rss.xml']}},
    nz:{cc:'NZ', place:'紐西蘭', accent:'紐西蘭英語', tts:'en-NZ', hl:'en-NZ', extra:{local:['https://www.rnz.co.nz/rss/national.xml'], world:['https://www.rnz.co.nz/rss/world.xml'], fin:['https://www.rnz.co.nz/rss/business.xml']}},
    ca:{cc:'CA', place:'加拿大', accent:'加拿大英語', tts:'en-CA', hl:'en-CA'},
    sg:{cc:'SG', place:'新加坡', accent:'新加坡英語', tts:'en-SG', hl:'en-SG'},
    ie:{cc:'IE', place:'愛爾蘭', accent:'愛爾蘭英語', tts:'en-IE', hl:'en-IE'},
    mt:{cc:'MT', place:'馬爾他', accent:'馬爾他英語', tts:'en-GB', hl:'en'},
    in:{cc:'IN', place:'印度', accent:'印度英語', tts:'en-IN', hl:'en-IN'},
    pk:{cc:'PK', place:'巴基斯坦', accent:'巴基斯坦英語', tts:'en-IN', hl:'en'},
    ae:{cc:'AE', place:'阿聯', accent:'阿聯英語', tts:'en-GB', hl:'en'},
    jm:{cc:'JM', place:'牙買加', accent:'牙買加英語', tts:'en-GB', hl:'en'},
    tt:{cc:'TT', place:'千里達及托巴哥', accent:'千里達英語', tts:'en-GB', hl:'en'},
    bz:{cc:'BZ', place:'貝里斯', accent:'貝里斯英語', tts:'en-US', hl:'en'} }},
  ja:{name:'日本語', short:'JA', pol:'政治', life:'暮らし OR 生活', regions:{
    jp:{cc:'JP', place:'日本', accent:'日語（標準語）', tts:'ja-JP', hl:'ja', extra:{pol:[NHK(4)], local:[NHK(1)], world:[NHK(6)], fin:[NHK(5)], tech:[NHK(3)], health:[NHK(3)]}} }},
  ko:{name:'한국어', short:'KO', words:true, pol:'정치', life:'생활 OR 라이프', regions:{
    kr:{cc:'KR', place:'韓國', accent:'韓語（首爾）', tts:'ko-KR', hl:'ko'} }},
  fr:{name:'Français', short:'FR', words:true, pol:'politique', life:'vie quotidienne OR consommation OR logement', regions:{
    fr:{cc:'FR', place:'法國', accent:'法國法語', tts:'fr-FR', hl:'fr'},
    ch:{cc:'CH', place:'瑞士', accent:'瑞士法語', tts:'fr-CH', hl:'fr'},
    ca:{cc:'CA', place:'加拿大', accent:'加拿大法語（魁北克）', tts:'fr-CA', hl:'fr-CA'},
    be:{cc:'BE', place:'比利時', accent:'比利時法語', tts:'fr-BE', hl:'fr'},
    lu:{cc:'LU', place:'盧森堡', accent:'盧森堡法語', tts:'fr-LU', hl:'fr'},
    mc:{cc:'MC', place:'摩納哥', accent:'摩納哥法語', tts:'fr-FR', hl:'fr'},
    ma:{cc:'MA', place:'摩洛哥（法語）', accent:'摩洛哥法語', tts:'fr-FR', hl:'fr'},
    ht:{cc:'HT', place:'海地', accent:'海地法語', tts:'fr-FR', hl:'fr'} }},
  de:{name:'Deutsch', short:'DE', words:true, pol:'Politik', life:'Leben OR Verbraucher OR Wohnen', regions:{
    de:{cc:'DE', place:'德國', accent:'德國德語', tts:'de-DE', hl:'de'},
    ch:{cc:'CH', place:'瑞士', accent:'瑞士德語', tts:'de-CH', hl:'de'},
    at:{cc:'AT', place:'奧地利', accent:'奧地利德語', tts:'de-AT', hl:'de'},
    lu:{cc:'LU', place:'盧森堡', accent:'盧森堡德語', tts:'de-LU', hl:'de'},
    li:{cc:'LI', place:'列支敦斯登', accent:'列支敦斯登德語', tts:'de-CH', hl:'de'} }},
  es:{name:'Español', short:'ES', words:true, pol:'política', life:'estilo de vida OR consumo OR vivienda', regions:{
    es:{cc:'ES', place:'西班牙', accent:'西班牙西語', tts:'es-ES', hl:'es'},
    mx:{cc:'MX', place:'墨西哥', accent:'墨西哥西語', tts:'es-MX', hl:'es-419'},
    ar:{cc:'AR', place:'阿根廷', accent:'阿根廷西語', tts:'es-AR', hl:'es-419'},
    co:{cc:'CO', place:'哥倫比亞', accent:'哥倫比亞西語', tts:'es-CO', hl:'es-419'},
    cl:{cc:'CL', place:'智利', accent:'智利西語', tts:'es-CL', hl:'es-419'},
    pe:{cc:'PE', place:'秘魯', accent:'秘魯西語', tts:'es-PE', hl:'es-419'},
    ve:{cc:'VE', place:'委內瑞拉', accent:'委內瑞拉西語', tts:'es-VE', hl:'es-419'},
    cu:{cc:'CU', place:'古巴', accent:'古巴西語', tts:'es-US', hl:'es-419'},
    ec:{cc:'EC', place:'厄瓜多', accent:'厄瓜多西語', tts:'es-EC', hl:'es-419'},
    bo:{cc:'BO', place:'玻利維亞', accent:'玻利維亞西語', tts:'es-BO', hl:'es-419'},
    py:{cc:'PY', place:'巴拉圭', accent:'巴拉圭西語', tts:'es-PY', hl:'es-419'},
    uy:{cc:'UY', place:'烏拉圭', accent:'烏拉圭西語', tts:'es-UY', hl:'es-419'},
    cr:{cc:'CR', place:'哥斯大黎加', accent:'哥斯大黎加西語', tts:'es-CR', hl:'es-419'},
    pa:{cc:'PA', place:'巴拿馬', accent:'巴拿馬西語', tts:'es-PA', hl:'es-419'},
    gt:{cc:'GT', place:'瓜地馬拉', accent:'瓜地馬拉西語', tts:'es-GT', hl:'es-419'},
    hn:{cc:'HN', place:'宏都拉斯', accent:'宏都拉斯西語', tts:'es-HN', hl:'es-419'},
    sv:{cc:'SV', place:'薩爾瓦多', accent:'薩爾瓦多西語', tts:'es-SV', hl:'es-419'},
    ni:{cc:'NI', place:'尼加拉瓜', accent:'尼加拉瓜西語', tts:'es-NI', hl:'es-419'},
    do:{cc:'DO', place:'多明尼加', accent:'多明尼加西語', tts:'es-US', hl:'es-419'},
    pr:{cc:'PR', place:'波多黎各', accent:'波多黎各西語', tts:'es-US', hl:'es-419'} }},
  it:{name:'Italiano', short:'IT', words:true, pol:'politica', life:'stile di vita OR consumi OR casa', regions:{
    it:{cc:'IT', place:'義大利', accent:'義大利語', tts:'it-IT', hl:'it'},
    ch:{cc:'CH', place:'瑞士', accent:'瑞士義大利語', tts:'it-CH', hl:'it'},
    sm:{cc:'SM', place:'聖馬利諾', accent:'義大利語', tts:'it-IT', hl:'it'} }},
  id:{name:'Bahasa Indonesia', short:'ID', words:true, pol:'politik', life:'gaya hidup OR kuliner OR wisata', regions:{
    id:{cc:'ID', place:'印尼', accent:'印尼語', tts:'id-ID', hl:'id'} }},
  th:{name:'ไทย', short:'TH', pol:'การเมือง', life:'ไลฟ์สไตล์ OR ชีวิต', regions:{
    th:{cc:'TH', place:'泰國', accent:'泰語', tts:'th-TH', hl:'th'} }},
  vi:{name:'Tiếng Việt', short:'VI', words:true, pol:'chính trị', life:'đời sống', regions:{
    vn:{cc:'VN', place:'越南', accent:'越南語（北部）', tts:'vi-VN', hl:'vi'} }},
  pt:{name:'Português', short:'PT', words:true, pol:'política', life:'estilo de vida OR consumo', regions:{
    pt:{cc:'PT', place:'葡萄牙', accent:'葡萄牙葡語', tts:'pt-PT', hl:'pt-PT'},
    br:{cc:'BR', place:'巴西', accent:'巴西葡語', tts:'pt-BR', hl:'pt-BR', ceid:'BR:pt-419'} }},
  nl:{name:'Nederlands', short:'NL', words:true, pol:'politiek', life:'leven OR consument', regions:{
    nl:{cc:'NL', place:'荷蘭', accent:'荷蘭語', tts:'nl-NL', hl:'nl'},
    be:{cc:'BE', place:'比利時（法蘭德斯）', accent:'比利時荷語', tts:'nl-BE', hl:'nl'},
    sr:{cc:'SR', place:'蘇利南', accent:'蘇利南荷語', tts:'nl-NL', hl:'nl'} }},
  sv:{name:'Svenska', short:'SV', words:true, pol:'politik', life:'livsstil OR konsument', regions:{
    se:{cc:'SE', place:'瑞典', accent:'瑞典語', tts:'sv-SE', hl:'sv'} }},
  no:{name:'Norsk', short:'NO', words:true, pol:'politikk', life:'livsstil OR forbruker', regions:{
    no:{cc:'NO', place:'挪威', accent:'挪威語', tts:'nb-NO', hl:'no'} }},
  da:{name:'Dansk', short:'DA', words:true, pol:'politik', life:'livsstil OR forbruger', regions:{
    dk:{cc:'DK', place:'丹麥', accent:'丹麥語', tts:'da-DK', hl:'da', extra:{local:['https://www.dr.dk/nyheder/service/feeds/allenyheder']}} }},
  fi:{name:'Suomi', short:'FI', words:true, pol:'politiikka', life:'elämäntapa OR kuluttaja', regions:{
    fi:{cc:'FI', place:'芬蘭', accent:'芬蘭語', tts:'fi-FI', hl:'fi', extra:{local:['https://yle.fi/rss/uutiset/tuoreimmat']}} }},
  is:{name:'Íslenska', short:'IS', words:true, pol:'stjórnmál', life:'lífsstíll', regions:{
    is:{cc:'IS', place:'冰島', accent:'冰島語', tts:'is-IS', hl:'is', extra:{local:['https://www.ruv.is/rss/frettir']}} }},
  cs:{name:'Čeština', short:'CS', words:true, pol:'politika', life:'životní styl OR spotřebitel', regions:{
    cz:{cc:'CZ', place:'捷克', accent:'捷克語', tts:'cs-CZ', hl:'cs'} }},
  sk:{name:'Slovenčina', short:'SK', words:true, pol:'politika', life:'životný štýl', regions:{
    sk:{cc:'SK', place:'斯洛伐克', accent:'斯洛伐克語', tts:'sk-SK', hl:'sk'} }},
  pl:{name:'Polski', short:'PL', words:true, pol:'polityka', life:'styl życia OR konsument', regions:{
    pl:{cc:'PL', place:'波蘭', accent:'波蘭語', tts:'pl-PL', hl:'pl'} }},
  hu:{name:'Magyar', short:'HU', words:true, pol:'politika', life:'életmód OR fogyasztó', regions:{
    hu:{cc:'HU', place:'匈牙利', accent:'匈牙利語', tts:'hu-HU', hl:'hu'} }},
  sl:{name:'Slovenščina', short:'SL', words:true, pol:'politika', life:'življenjski slog', regions:{
    si:{cc:'SI', place:'斯洛維尼亞', accent:'斯洛維尼亞語', tts:'sl-SI', hl:'sl'} }},
  et:{name:'Eesti', short:'ET', words:true, pol:'poliitika', life:'elustiil', regions:{
    ee:{cc:'EE', place:'愛沙尼亞', accent:'愛沙尼亞語', tts:'et-EE', hl:'et', extra:{local:['https://www.err.ee/rss']}} }},
  lv:{name:'Latviešu', short:'LV', words:true, pol:'politika', life:'dzīvesstils', regions:{
    lv:{cc:'LV', place:'拉脫維亞', accent:'拉脫維亞語', tts:'lv-LV', hl:'lv'} }},
  lt:{name:'Lietuvių', short:'LT', words:true, pol:'politika', life:'gyvenimo būdas', regions:{
    lt:{cc:'LT', place:'立陶宛', accent:'立陶宛語', tts:'lt-LT', hl:'lt'} }},
  uk:{name:'Українська', short:'UK', words:true, pol:'політика', life:'стиль життя', regions:{
    ua:{cc:'UA', place:'烏克蘭', accent:'烏克蘭語', tts:'uk-UA', hl:'uk'} }},
  ro:{name:'Română', short:'RO', words:true, pol:'politică', life:'stil de viață', regions:{
    ro:{cc:'RO', place:'羅馬尼亞', accent:'羅馬尼亞語', tts:'ro-RO', hl:'ro'},
    md:{cc:'MD', place:'摩爾多瓦', accent:'摩爾多瓦羅語', tts:'ro-MD', hl:'ro'} }},
  bg:{name:'Български', short:'BG', words:true, pol:'политика', life:'начин на живот', regions:{
    bg:{cc:'BG', place:'保加利亞', accent:'保加利亞語', tts:'bg-BG', hl:'bg'} }},
  ru:{name:'Русский', short:'RU', words:true, pol:'политика', life:'образ жизни', regions:{
    ru:{cc:'RU', place:'俄羅斯', accent:'俄語', tts:'ru-RU', hl:'ru'},
    kz:{cc:'KZ', place:'哈薩克（俄語）', accent:'哈薩克俄語', tts:'ru-RU', hl:'ru'},
    kg:{cc:'KG', place:'吉爾吉斯（俄語）', accent:'吉爾吉斯俄語', tts:'ru-RU', hl:'ru'} }},
  el:{name:'Ελληνικά', short:'EL', words:true, pol:'πολιτική', life:'τρόπος ζωής', regions:{
    gr:{cc:'GR', place:'希臘', accent:'希臘語', tts:'el-GR', hl:'el'},
    cy:{cc:'CY', place:'賽普勒斯', accent:'賽普勒斯希臘語', tts:'el-CY', hl:'el'} }},
  hr:{name:'Hrvatski', short:'HR', words:true, pol:'politika', life:'životni stil', regions:{
    hr:{cc:'HR', place:'克羅埃西亞', accent:'克羅埃西亞語', tts:'hr-HR', hl:'hr'} }},
  sr:{name:'Српски', short:'SR', words:true, pol:'политика', life:'начин живота', regions:{
    rs:{cc:'RS', place:'塞爾維亞', accent:'塞爾維亞語', tts:'sr-RS', hl:'sr'},
    me:{cc:'ME', place:'蒙特內哥羅', accent:'蒙特內哥羅語', tts:'sr-ME', hl:'sr'} }},
  bs:{name:'Bosanski', short:'BS', words:true, pol:'politika', life:'životni stil', regions:{
    ba:{cc:'BA', place:'波士尼亞與赫塞哥維納', accent:'波士尼亞語', tts:'bs-BA', hl:'bs'} }},
  sq:{name:'Shqip', short:'SQ', words:true, pol:'politika', life:'stili i jetesës', regions:{
    al:{cc:'AL', place:'阿爾巴尼亞', accent:'阿爾巴尼亞語', tts:'sq-AL', hl:'sq'},
    xk:{cc:'XK', place:'科索沃', accent:'科索沃阿語', tts:'sq-XK', hl:'sq'} }},
  mk:{name:'Македонски', short:'MK', words:true, pol:'политика', life:'животен стил', regions:{
    mk:{cc:'MK', place:'北馬其頓', accent:'馬其頓語', tts:'mk-MK', hl:'mk'} }},
  mt:{name:'Malti', short:'MT', words:true, pol:'politika', life:'stil ta’ ħajja', regions:{
    mt:{cc:'MT', place:'馬爾他', accent:'馬爾他語', tts:'mt-MT', hl:'mt'} }},
  ca:{name:'Català', short:'CA', words:true, pol:'política', life:'estil de vida', regions:{
    ad:{cc:'AD', place:'安道爾', accent:'安道爾加泰隆尼亞語', tts:'ca-AD', hl:'ca'},
    es:{cc:'ES', place:'西班牙（加泰隆尼亞）', accent:'加泰隆尼亞語', tts:'ca-ES', hl:'ca'} }},
  hi:{name:'हिन्दी', short:'HI', words:true, pol:'राजनीति', life:'जीवनशैली', regions:{
    in:{cc:'IN', place:'印度', accent:'印地語', tts:'hi-IN', hl:'hi'} }},
  ur:{name:'اردو', short:'UR', words:true, pol:'سیاست', life:'طرز زندگی', regions:{
    pk:{cc:'PK', place:'巴基斯坦', accent:'烏爾都語', tts:'ur-PK', hl:'ur'} }},
  ar:{name:'العربية', short:'AR', words:true, pol:'سياسة', life:'أسلوب حياة', regions:{
    ae:{cc:'AE', place:'阿聯', accent:'阿拉伯語（海灣）', tts:'ar-AE', hl:'ar'},
    sa:{cc:'SA', place:'沙烏地阿拉伯', accent:'阿拉伯語（沙烏地）', tts:'ar-SA', hl:'ar'},
    qa:{cc:'QA', place:'卡達', accent:'阿拉伯語（卡達）', tts:'ar-QA', hl:'ar'},
    kw:{cc:'KW', place:'科威特', accent:'阿拉伯語（科威特）', tts:'ar-KW', hl:'ar'},
    bh:{cc:'BH', place:'巴林', accent:'阿拉伯語（巴林）', tts:'ar-BH', hl:'ar'},
    om:{cc:'OM', place:'阿曼', accent:'阿拉伯語（阿曼）', tts:'ar-OM', hl:'ar'},
    jo:{cc:'JO', place:'約旦', accent:'阿拉伯語（約旦）', tts:'ar-JO', hl:'ar'},
    lb:{cc:'LB', place:'黎巴嫩', accent:'阿拉伯語（黎巴嫩）', tts:'ar-LB', hl:'ar'},
    iq:{cc:'IQ', place:'伊拉克', accent:'阿拉伯語（伊拉克）', tts:'ar-IQ', hl:'ar'},
    eg:{cc:'EG', place:'埃及', accent:'阿拉伯語（埃及）', tts:'ar-EG', hl:'ar'},
    ma:{cc:'MA', place:'摩洛哥', accent:'阿拉伯語（摩洛哥）', tts:'ar-MA', hl:'ar'} }},
  fa:{name:'فارسی', short:'FA', words:true, pol:'سیاست', life:'سبک زندگی', regions:{
    ir:{cc:'IR', place:'伊朗', accent:'波斯語', tts:'fa-IR', hl:'fa'} }},
  he:{name:'עברית', short:'HE', words:true, pol:'פוליטיקה', life:'לייף סטייל', regions:{
    il:{cc:'IL', place:'以色列', accent:'希伯來語', tts:'he-IL', hl:'he'} }},
  kk:{name:'Қазақ', short:'KK', words:true, pol:'саясат', life:'өмір салты', regions:{
    kz:{cc:'KZ', place:'哈薩克', accent:'哈薩克語', tts:'kk-KZ', hl:'kk'} }},
  uz:{name:'Oʻzbek', short:'UZ', words:true, pol:'siyosat', life:'turmush tarzi', regions:{
    uz:{cc:'UZ', place:'烏茲別克', accent:'烏茲別克語', tts:'uz-UZ', hl:'uz'} }},
  ky:{name:'Кыргызча', short:'KY', words:true, pol:'саясат', life:'жашоо образы', regions:{
    kg:{cc:'KG', place:'吉爾吉斯', accent:'吉爾吉斯語', tts:'ky-KG', hl:'ky'} }},
  tg:{name:'Тоҷикӣ', short:'TG', words:true, pol:'сиёсат', life:'тарзи зиндагӣ', regions:{
    tj:{cc:'TJ', place:'塔吉克', accent:'塔吉克語', tts:'tg-TJ', hl:'tg'} }},
  tk:{name:'Türkmençe', short:'TK', words:true, pol:'syýasat', life:'durmuş', regions:{
    tm:{cc:'TM', place:'土庫曼', accent:'土庫曼語', tts:'tk-TM', hl:'tk'} }},
  tr:{name:'Türkçe', short:'TR', words:true, pol:'siyaset', life:'yaşam', regions:{
    tr:{cc:'TR', place:'土耳其', accent:'土耳其語', tts:'tr-TR', hl:'tr'} }}
};
const LANG_COLORS = {hi:'#a3866f', ur:'#7f9a87', ar:'#9a8a6c', fa:'#8a9aa0', he:'#7f8ea6', kk:'#8a9fa3', uz:'#9e8c7a', ky:'#a0857f', tg:'#8c8fa3', tk:'#90a080', vi:'#8d9a7a', pt:'#9c8070', nl:'#8a8f9c', sv:'#7d8fa0', no:'#8e8797', da:'#a08588', fi:'#7f9b9b', is:'#8a98a6', cs:'#9a8a7c', sk:'#8f8f7d', pl:'#a3878a', hu:'#89977f', sl:'#82949a', et:'#7f8aa0', lv:'#9b8279', lt:'#8f9a72', uk:'#7d8fa6', ro:'#a08c74', bg:'#8a9a88', ru:'#93868f', el:'#7a8fa8', hr:'#9a8580', sr:'#8b7f8f', bs:'#88937f', sq:'#a0817d', mk:'#a38f72', mt:'#8f8a7f', ca:'#a08478', tr:'#a07d80', en:'#5f7a8c', ja:'#a47b7b', fr:'#8a7fa3', ko:'#6d9393', es:'#b0806a', th:'#8b9466', it:'#8f8a72', de:'#7a8a7e', id:'#a0866e', zh:'#6f8f7a'};
const CUSTOM_COLORS = ['#7f8fa0','#a08a8f','#8f9a84','#9a8fa8','#a8977e','#7e9a9a'];

/* 自訂語言／地區（只是設定，存在手機瀏覽器，很小） */
function customCfg(){ return store.get('nl_custom', {langs:{}, regions:{}}); }
function saveCustom(c){ store.set('nl_custom', c); resetLangCache(); }
/* 語言清單會被反覆用到，算一次就記起來（手機上才不會卡） */
let _allL = null, _regC = {}, _ccMap = {};
function resetLangCache(){ _allL = null; _regC = {}; _ccMap = {}; }
function allLangs(){
  if(_allL) return _allL;
  const c = customCfg(), out = {};
  for(const [k, L] of Object.entries(BUILTIN)) out[k] = {...L, regions:{...L.regions}};
  for(const [k, L] of Object.entries(c.langs || {})) out[k] = {custom:true, words:L.words !== false, ...L, regions:{...(L.regions || {})}};
  for(const [lang, rs] of Object.entries(c.regions || {})) if(out[lang]) for(const [rk, r] of Object.entries(rs)) out[lang].regions[rk] = {...r, custom:true};
  Object.keys(out).forEach((k, i) => out[k].color = LANG_COLORS[k] || CUSTOM_COLORS[i % CUSTOM_COLORS.length]);
  return _allL = out;
}
function regionOf(lang, rk){
  const ck = lang + '|' + rk; if(_regC[ck]) return _regC[ck];
  const L = allLangs()[lang]; if(!L) return null;
  const keys = Object.keys(L.regions);
  const r = L.regions[rk] || L.regions[keys[0]];
  const key = L.regions[rk] ? rk : keys[0];
  const cc = r.cc.toUpperCase();
  return _regC[ck] = {...r, key, lang, flag:flagOf(cc), label:`${flagOf(cc)} ${r.place}`,
          accent: r.accent || `${r.place}${L.name}`, tts: r.tts || `${lang}-${cc}`,
          gn: `hl=${r.hl || lang}&gl=${cc}&ceid=${r.ceid || cc + ':' + (/-419$/.test(r.hl || '') ? r.hl : lang)}`};
}
const CATS = {
  local:{name:'本地', topic:'NATION'}, world:{name:'國際', topic:'WORLD'}, fin:{name:'財經', topic:'BUSINESS'},
  pol:{name:'政治', topic:null}, tech:{name:'科技', topic:'TECHNOLOGY'}, health:{name:'醫療', topic:'HEALTH'}, life:{name:'生活', topic:null}
};
const gnTopic = (topic, ed) => `https://news.google.com/rss/headlines/section/topic/${topic}?${ed}`;
const gnSearch = (q, ed) => `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:2d')}&${ed}`;
const kwCache = {};
async function catKeyword(lang, cat){
  const L = allLangs()[lang];
  if(L[cat]) return L[cat];
  const k = lang + cat; if(kwCache[k]) return kwCache[k];
  try{ kwCache[k] = (await translate(cat === 'pol' ? 'politics' : 'lifestyle', 'en', lang)).t; }catch(e){ kwCache[k] = cat === 'pol' ? 'politics' : 'lifestyle'; }
  return kwCache[k];
}
/* Google 新聞沒有當地版本的國家，先改用 Bing 新聞（同樣免費、可用當地語言） */
const NO_GN = new Set(['QA','KW','BH','OM','JO','IQ','IR','KZ','UZ','KG','TJ','TM','EC','BO','PY','UY','CR','PA','GT','HN','SV','NI','DO','PR','JM','TT','BZ','SR','HT','DK','FI','IS','EE','HR','BA','AL','MK','ME','LU','MT','CY','MD','AD','MC','LI','SM','XK','BY','IE']);
const BING_CAT = {local:'', world:'international', fin:'economy', pol:'politics', tech:'technology', health:'health', life:'lifestyle'};
async function bingQuery(lang, cc, cat){
  let place = cc; try{ place = new Intl.DisplayNames([lang], {type:'region'}).of(cc) || cc; }catch(e){}
  if(cat === 'local') return place;
  let kw = BING_CAT[cat];
  if(lang !== 'en'){ const k = 'bing' + lang + cat; kw = kwCache[k] ||= await translate(BING_CAT[cat], 'en', lang).then(r => r.t).catch(() => BING_CAT[cat]); }
  return cat === 'world' ? kw : `${place} ${kw}`;
}
const bingUrl = (q, lang, cc) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=${lang}&cc=${cc}&mkt=${lang}-${cc}`;
async function sourcesFor(lang, rk, cat){
  const R = regionOf(lang, rk);
  const ex = (R.extra || {})[cat] || [];
  let g;
  if(CATS[cat].topic) g = gnTopic(CATS[cat].topic, R.gn);
  else g = gnSearch(await catKeyword(lang, cat), R.gn);
  const bing = lang === 'zh' ? null : bingUrl(await bingQuery(lang, R.cc.toUpperCase(), cat), lang, R.cc.toUpperCase());
  if(NO_GN.has(R.cc.toUpperCase())) return [...ex, bing, g].filter(Boolean);
  if((R.localFirst || []).includes(cat)) return [ex[0], g, ...ex.slice(1)].filter(Boolean);
  return [g, ...ex, bing].filter(Boolean);
}

/* =========================================================
   抓網頁 / RSS（多個免費轉接站同時試，誰先成功用誰）
   ========================================================= */
const getText = async (u, opt) => { const r = await fetch(u, opt); if(!r.ok) throw new Error(r.status); const t = await r.text(); if(!t) throw new Error('empty'); return t; };
function proxyText(url, check = () => true){
  const e = encodeURIComponent(url);
  const ok = async p => { const t = await p; if(!check(t)) throw new Error('bad'); return t; };
  return timeout(any([
    ok((async () => { const j = await (await fetch('https://api.allorigins.win/get?url=' + e)).json(); return j.contents; })()),
    ok(getText('https://api.allorigins.win/raw?url=' + e)),
    ok(getText('https://corsproxy.io/?url=' + e)),
    ok(getText('https://api.codetabs.com/v1/proxy?quest=' + e)),
    ok(getText('https://cors.eu.org/' + url)),
    ok(getText(url))
  ]), 15000);
}
function parseXml(txt){
  const d = new DOMParser().parseFromString(txt, 'text/xml');
  const items = [...d.querySelectorAll('item')].map(i => ({
    title: i.querySelector('title')?.textContent || '',
    link:  i.querySelector('link')?.textContent || '',
    date:  i.querySelector('pubDate')?.textContent || i.getElementsByTagName('dc:date')[0]?.textContent || '',
    source: i.getElementsByTagName('News:Source')[0]?.textContent || i.getElementsByTagName('source')[0]?.textContent || ''
  })).filter(x => x.title);
  if(!items.length) throw new Error('empty');
  return items;
}
function fetchFeed(url){
  return timeout(any([
    (async () => { const j = await (await fetch('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(url))).json();
                   if(j.status !== 'ok' || !j.items?.length) throw 0;
                   return j.items.map(i => ({title:i.title, link:i.link, date:i.pubDate, source:i.author || ''})); })(),
    (async () => parseXml(await proxyText(url, t => /<item[\s>]/.test(t))))()
  ]), 20000);
}
const SRC_NAME = u => /bing\.com/.test(u) ? '' : /dr\.dk/.test(u) ? 'DR' : /yle\.fi/.test(u) ? 'Yle' : /err\.ee/.test(u) ? 'ERR' : /ruv\.is/.test(u) ? 'RÚV' : /ltn/.test(u) ? '自由時報' : /yahoo/.test(u) ? 'Yahoo新聞' : /bbc/.test(u) ? 'BBC' : /nhk/.test(u) ? 'NHK' : /npr/.test(u) ? 'NPR' : /abc\.net/.test(u) ? 'ABC' : /rnz/.test(u) ? 'RNZ' : '';
function cleanItems(items, srcName, max = 20){
  const seen = new Set(), out = [];
  for(const it of items){
    let title = (it.title || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(), source = srcName;
    let link = it.link || '';
    if(/bing\.com\/news\/apiclick/i.test(link)){ try{ link = new URL(link).searchParams.get('url') || link; }catch(e){} source = it.source || 'Bing'; }
    else if(!srcName){ const k = title.lastIndexOf(' - '); if(k > 0){ source = title.slice(k + 3); title = title.slice(0, k); } else source = it.source || ''; }
    if(!title || seen.has(title)) continue;
    seen.add(title); out.push({title, source, link, date:it.date});
    if(out.length >= max) break;
  }
  return out;
}
/* 先讀 GitHub 每 2 小時在伺服器整理好的新聞（穩定、快），沒有才改用即時抓取 */
const DATA_BASE = 'https://raw.githubusercontent.com/venus52mom-lab/News-learn/data/';
async function loadPrebuilt(lang, rk, cat){
  const r = await timeout(fetch(`${DATA_BASE}feeds/${lang}-${rk}-${cat}.json?h=${Math.floor(Date.now() / 1800000)}`), 8000);
  if(!r.ok) throw new Error('no prebuilt');
  const j = await r.json();
  if(!j.items?.length || Date.now() - new Date(j.updated).getTime() > 14 * 3600e3) throw new Error('stale');
  return j.items;
}
async function loadFeed(lang, rk, cat){
  try{ return await loadPrebuilt(lang, rk, cat); }catch(e){}
  for(const url of await sourcesFor(lang, rk, cat)){
    try{ const items = cleanItems(await fetchFeed(url), SRC_NAME(url)); if(items.length >= 3) return items; }catch(e){}
  }
  throw new Error('no feed');
}

/* =========================================================
   免費翻譯 + 台灣用語
   ========================================================= */
const trCache = {};          // 只在記憶體；新聞頁會自己決定要不要暫存到手機
const TW_TERMS = [
  ['美聯儲','聯準會'],['美聯準','聯準會'],['特朗普','川普'],['奧巴馬','歐巴馬'],['普京','普丁'],['內塔尼亞胡','納坦雅胡'],['澤連斯基','澤倫斯基'],
  ['默克爾','梅克爾'],['馬克龍','馬克宏'],['斯塔默','施凱爾'],['哈里斯','賀錦麗'],['萬斯','范斯'],['佩洛西','裴洛西'],['蓬佩奧','龐佩奧'],['布林肯','布林肯'],
  ['英偉達','輝達'],['高通','高通'],['甲骨文','甲骨文'],['納斯達克','那斯達克'],['道瓊斯','道瓊'],['標準普爾','標普'],['標普500','標普500'],
  ['硅谷','矽谷'],['芯片','晶片'],['人工智能','人工智慧'],['軟件','軟體'],['硬件','硬體'],['網絡','網路'],['互聯網','網際網路'],['信息','資訊'],
  ['視頻','影片'],['帖子','貼文'],['博客','部落格'],['打印','列印'],['服務器','伺服器'],['數據庫','資料庫'],['程序','程式'],['屏幕','螢幕'],['鼠標','滑鼠'],
  ['悉尼','雪梨'],['新西蘭','紐西蘭'],['意大利','義大利'],['澳大利亞','澳洲'],['朝鮮','北韓'],['沙特','沙烏地'],['也門','葉門'],['肯尼亞','肯亞'],
  ['加息','升息'],['通脹','通膨'],['出租車','計程車'],['公交','公車'],['激光','雷射'],['導彈','飛彈'],['航母','航艦'],['質量','品質'],
  ['短信','簡訊'],['移動支付','行動支付'],['新冠肺炎','新冠肺炎'],['疫苗接種','疫苗接種'],['醫保','健保'],['養老金','退休金'],['房地產','房地產'],
  ['首席執行官','執行長'],['首席財務官','財務長'],['土豆','馬鈴薯'],['奔馳','賓士'],['寶馬','BMW'],['臉譜','臉書'],['優步','Uber'],['亞馬遜','亞馬遜']
];
function twFix(t){ for(const [a, b] of TW_TERMS) if(a !== b) t = t.split(a).join(b); return t; }
async function translate(text, sl, tl){
  if(sl === 'zh') sl = 'zh-TW'; if(tl === 'zh') tl = 'zh-TW';
  const key = sl + '>' + tl + '|' + text;
  if(trCache[key]) return trCache[key];
  let res;
  try{
    const u = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&dt=rm&q=${encodeURIComponent(text)}`;
    const d = await timeout(fetch(u).then(r => r.json()), 12000);
    const segs = d[0] || [];
    const t = segs.filter(s => s[0]).map(s => s[0]).join('');
    const rm = segs.find(s => !s[0] && (s[2] || s[3]));
    if(!t) throw 0;
    res = {t, rmT: rm?.[2] || '', rmS: rm?.[3] || '', detected: d[2] || sl};
  }catch(e){
    const d = await timeout(fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=${sl === 'auto' ? 'en' : sl}|${tl}`).then(r => r.json()), 12000);
    if(!d.responseData?.translatedText) throw new Error('tr');
    res = {t: d.responseData.translatedText, rmT:'', rmS:'', detected: sl};
  }
  if(/^zh-TW$/i.test(tl)) res.t = twFix(res.t);
  trCache[key] = res;
  return res;
}
/* 長文翻譯：切段後翻 */
async function translateLong(text, sl, tl){
  const parts = splitChunks(text, 1200);
  const out = [];
  for(const p of parts) out.push((await translate(p, sl, tl)).t);
  return out.join(' ');
}

/* 美國／英語新聞常見縮寫、機構、文化用語 → 台灣人看得懂的說明 */
const GLOSS = {
  'Fed':['聯準會','美國的中央銀行，決定美國利率'], 'Federal Reserve':['聯準會','美國的中央銀行，決定美國利率'], 'FOMC':['聯邦公開市場委員會','聯準會裡決定升降息的會議'],
  'Powell':['鮑爾','美國聯準會主席'], 'GOP':['共和黨','美國兩大黨之一，立場偏保守'], 'Republicans':['共和黨','美國兩大黨之一，立場偏保守'],
  'Democrats':['民主黨','美國兩大黨之一，立場偏自由派'], 'MAGA':['讓美國再次偉大','川普的競選口號，也泛指川普支持者'],
  'SEC':['美國證券交易委員會','管股市的機關，類似台灣金管會證期局'], 'IRS':['美國國稅局','類似台灣財政部國稅局'], 'DOJ':['美國司法部','類似台灣法務部'],
  'FBI':['聯邦調查局','美國聯邦警察與情報機關，類似台灣調查局'], 'CIA':['中央情報局','美國對外情報機關，類似台灣國安局'], 'NSA':['國家安全局','美國負責通訊監聽的情報機關'],
  'DHS':['國土安全部','美國負責邊境、反恐、移民的部會'], 'ICE':['移民及海關執法局','美國抓非法移民的機關'], 'FDA':['食品藥物管理局','類似台灣食藥署'],
  'CDC':['疾病管制與預防中心','類似台灣疾管署'], 'NIH':['國家衛生研究院','美國最大的醫學研究機構'], 'NASA':['美國太空總署',''], 'EPA':['環境保護署','類似台灣環境部'],
  'FTC':['聯邦貿易委員會','管反壟斷和消費者保護，類似台灣公平會'], 'FCC':['聯邦通訊委員會','類似台灣 NCC'], 'FAA':['聯邦航空總署','類似台灣民航局'],
  'NTSB':['國家運輸安全委員會','調查交通事故，類似台灣運安會'], 'Pentagon':['五角大廈','美國國防部的代稱'], 'Capitol Hill':['國會山莊','美國國會的代稱'],
  'White House':['白宮','美國總統府的代稱'], 'Oval Office':['橢圓形辦公室','美國總統的辦公室'], 'Wall Street':['華爾街','美國金融業的代稱'],
  'Treasury':['美國財政部','也常指美國公債'], 'Treasuries':['美國公債',''], 'Dow':['道瓊指數','美國最老牌的股價指數'], 'S&P 500':['標普500指數','美國 500 家大公司的股價指數'],
  'Nasdaq':['那斯達克','以科技股為主的美國股市'], 'CPI':['消費者物價指數','衡量通膨的指標'], 'PCE':['個人消費支出物價指數','聯準會最看重的通膨指標'],
  'GDP':['國內生產毛額','衡量經濟規模與成長'], 'payrolls':['非農就業人數','美國每月公布的就業數據，影響股市'], 'jobs report':['就業報告','美國每月公布的就業數據'],
  'Medicare':['聯邦醫療保險','美國 65 歲以上老人的公營健保'], 'Medicaid':['聯邦醫療補助','美國低收入戶的公營健保'], 'Obamacare':['歐巴馬健保','歐巴馬推動的醫療保險制度'],
  'ACA':['平價醫療法','即歐巴馬健保'], 'Social Security':['社會安全制度','美國的國民年金，類似台灣勞保年金'], 'SNAP':['營養補充援助計畫','俗稱食物券，補助低收入戶買食物'],
  '401(k)':['401(k) 退休帳戶','美國員工自提的退休金帳戶，類似勞退自提'], 'Supreme Court':['最高法院','美國司法最高機關，類似台灣憲法法庭'],
  'Senate':['參議院','美國國會上議院，每州 2 席'], 'House':['眾議院','美國國會下議院，依人口分配席次'], 'Speaker':['議長','通常指美國眾議院議長'],
  'filibuster':['冗長發言','參議院少數派拖延表決的手段'], 'midterms':['期中選舉','總統任期中間的國會選舉'], 'primary':['初選','各黨內部選出候選人的選舉'],
  'swing states':['搖擺州','選舉結果容易翻盤、決定勝負的州'], 'Electoral College':['選舉人團','美國總統是由各州選舉人票決定，不是全國總票數'],
  'governor':['州長',''], 'NATO':['北約','北大西洋公約組織，美歐軍事同盟'], 'OPEC':['石油輸出國組織','主要產油國的聯盟，影響油價'], 'IMF':['國際貨幣基金',''],
  'WHO':['世界衛生組織',''], 'UN':['聯合國',''], 'EU':['歐盟',''], 'G7':['七大工業國集團',''], 'G20':['二十國集團',''], 'BRICS':['金磚國家','巴西、俄羅斯、印度、中國、南非等新興國家組織'],
  'ECB':['歐洲央行',''], 'BoE':['英國央行',''], 'Bank of England':['英國央行',''], 'BOJ':['日本央行',''], 'RBA':['澳洲央行',''], 'NHS':['英國國民保健署','英國的公費醫療體系，類似台灣健保'],
  'Downing Street':['唐寧街','英國首相官邸的代稱'], 'Westminster':['西敏','英國國會的代稱'], 'Tories':['保守黨','英國兩大黨之一'], 'Conservatives':['保守黨','英國兩大黨之一'],
  'Labour':['工黨','英國兩大黨之一，偏左派'], 'Brexit':['英國脫歐',''], 'Kremlin':['克里姆林宮','俄羅斯政府的代稱'], 'ASX':['澳洲證券交易所',''],
  'IPO':['首次公開發行','公司第一次上市賣股票'], 'ETF':['指數股票型基金',''], 'EV':['電動車',''], 'Big Tech':['科技巨頭','指蘋果、微軟、Google、亞馬遜、Meta 等大公司'],
  'Magnificent Seven':['七巨頭','美股最大的七家科技公司'], 'Super Bowl':['超級盃','美式足球年度冠軍賽，美國收視最高的節目'], 'NFL':['國家美式足球聯盟',''],
  'NBA':['美國職籃',''], 'MLB':['美國職棒大聯盟',''], 'Thanksgiving':['感恩節','美國 11 月第四個星期四的重要家庭節日'], 'Black Friday':['黑色星期五','感恩節隔天的購物折扣日'],
  'Silicon Valley':['矽谷','美國加州科技公司聚集地'], 'Ivy League':['常春藤聯盟','美國東北部 8 所頂尖名校'], 'NRA':['全美步槍協會','美國最大的擁槍團體'],
  'tariff':['關稅',''], 'tariffs':['關稅',''], 'shutdown':['政府停擺','國會沒通過預算，聯邦政府部分停止運作'], 'impeachment':['彈劾',''],
  'Fortune 500':['財星 500 大','美國營收最大的 500 家公司'], 'Main Street':['一般老百姓','相對於華爾街，指一般民眾和小商家']
};
function findGloss(en){
  if(!en) return [];
  const out = [];
  for(const [k, v] of Object.entries(GLOSS)){
    const re = new RegExp('(^|[^A-Za-z])' + k.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&') + '($|[^A-Za-z])', /^[A-Z0-9&]+$/.test(k) || /^[A-Z]/.test(k) ? '' : 'i');
    if(re.test(en)) out.push({key:k, zh:v[0], note:v[1]});
  }
  // 避免 Fed 和 Federal Reserve 重複
  const seen = new Set(); return out.filter(g => !seen.has(g.zh) && seen.add(g.zh)).slice(0, 4);
}
const glossText = gs => gs.map(g => `${g.key}＝${g.zh}${g.note ? '（' + g.note + '）' : ''}`).join('；');

/* =========================================================
   查字典、音標
   ========================================================= */
async function lookup(word, sl){
  try{
    const u = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=zh-TW&hl=zh-TW&dt=t&dt=bd&dt=rm&q=${encodeURIComponent(word)}`;
    const d = await timeout(fetch(u).then(r => r.json()), 10000);
    const segs = d[0] || [];
    return { main: twFix(segs.filter(s => s[0]).map(s => s[0]).join('')), rm: segs.find(s => !s[0] && s[3])?.[3] || '',
             dict:(d[1] || []).map(p => ({pos:p[0], terms:(p[1] || []).slice(0, 6).map(twFix)})) };
  }catch(e){
    try{
      const d = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=${sl}|zh-TW`).then(r => r.json());
      return {main: d.responseData.translatedText, rm:'', dict: []};
    }catch(e2){ return {main:'（查詢失敗，請稍後再試）', rm:'', dict:[]}; }
  }
}
/* IPA → KK 音標（台灣學校教的美式音標，依規則換算） */
function ipaToKK(ipa){
  if(!ipa) return '';
  let s = ipa.replace(/^\/|\/$/g, '').replace(/[ˑ]/g, '');
  const rules = [[/ɝː|ɜːr|ɜr|ɝ/g,'ɝ'],[/ɚ|ər(?![aeiouæɑɔəɪʊʌ])/g,'ɚ'],[/eɪ/g,'e'],[/oʊ|əʊ/g,'o'],[/aɪ/g,'aɪ'],[/aʊ/g,'aʊ'],[/ɔɪ/g,'ɔɪ'],
                 [/iː/g,'i'],[/uː/g,'u'],[/ɑː/g,'ɑ'],[/ɔː/g,'ɔ'],[/ː/g,''],[/ɹ/g,'r'],[/ɡ/g,'g'],[/ɾ/g,'t'],[/ɒ/g,'ɑ'],[/ᵻ/g,'ɪ'],[/ɐ/g,'ə'],[/ʔ/g,'']];
  for(const [a, b] of rules) s = s.replace(a, b);
  return '[' + s + ']';
}
const phonCache = {};
async function enPhonetics(word){
  const w = word.toLowerCase();
  if(phonCache[w]) return phonCache[w];
  const res = {us:{}, uk:{}};
  try{
    const d = await timeout(fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(w)).then(r => r.ok ? r.json() : []), 8000);
    const ph = (Array.isArray(d) ? d : []).flatMap(e => [...(e.phonetics || []), {text:e.phonetic}]);
    for(const p of ph){
      if(p.audio && /-us\.mp3/.test(p.audio)){ res.us.audio = res.us.audio || p.audio; if(p.text) res.us.ipa = res.us.ipa || p.text; }
      if(p.audio && /-(uk|gb)\.mp3/.test(p.audio)){ res.uk.audio = res.uk.audio || p.audio; if(p.text) res.uk.ipa = res.uk.ipa || p.text; }
    }
    const generic = ph.find(p => p.text)?.text;
    res.uk.ipa = res.uk.ipa || generic;
    res.us.ipa = res.us.ipa || generic;
  }catch(e){}
  res.kk = ipaToKK(res.us.ipa);
  return phonCache[w] = res;
}
/* 其他語言：從維基詞典找國際音標 IPA */
async function wiktIPA(word, lang){
  try{
    const d = await timeout(fetch('https://en.wiktionary.org/w/api.php?format=json&origin=*&action=parse&prop=wikitext&redirects=1&page=' + encodeURIComponent(word)).then(r => r.json()), 8000);
    const wt = d.parse?.wikitext?.['*'] || '';
    const m = wt.match(new RegExp('\\{\\{IPA\\|' + lang + '\\|([^}|]+)'));
    if(m) return m[1].trim();
    const low = word.toLowerCase();
    if(low !== word) return wiktIPA(low, lang);
  }catch(e){}
  return '';
}

/* =========================================================
   英文難字判斷
   ========================================================= */
const COMMON = new Set(`about above accept access accident account across action active actually added addition address admit adult affect after again against agency agree ahead allow almost alone along already alright although always among amount animal another answer anyone anything appear apply approach april area argue around arrive article artist asked attack attempt attention august author autumn available avoid award aware awful baby back balance based basic beach beautiful became because become before began begin behind being believe below beside best better between beyond bigger billion birth black blood board body border bottom brain branch bread break bring broad brother brought budget build building built business button buyer called camera campaign cancer capital career carry catch cause center central century certain chair chance change charge cheap check chicken child children china chinese choice choose church citizen city civil claim class clean clear climate close clothes coach coast coffee cold college color comes coming common community company compare complete computer concern condition consider continue control corner correct cost could council country county couple course court cover create credit crime crisis cross crowd culture current customer cycle daily damage dance danger dark daughter death debate decade decide decision deep defense degree demand department describe design detail develop development device difference different difficult dinner direct director discover discuss disease doctor dollar double doubt draft drama dream dress drink drive driver during early earth easily eastern economic economy education effect effort eight either election electric element else email emergency employee energy enjoy enough enter entire environment equal error escape especially establish estimate evening event every everyone everything evidence exactly example exchange exist expect expensive experience expert explain export express extra family famous farmer father favorite feature february federal feeling field fight figure final finally finance financial finger finish first floor flower follow food foreign forest forget former forward found free fresh friday friend front fruit full funny future garden general giant girl given glass global goal going golden government great green ground group growth guess guest guide habit half hand happen happy hard health healthy heard heart heavy hello help higher highway himself history holiday home hope hospital hotel hour house however huge human hundred husband idea image impact import important improve include including income increase indeed industry inflation information inside instead interest international internet interview island issue itself january japan japanese job join joint journey judge july june junior keep kitchen know knowledge korea labor land language large later latest laugh launch lawyer leader learn least leave legal less letter level life light likely limit line list listen little live local long look lose loss lower lucky lunch machine magazine main major make manager many march market marriage material matter maybe meaning measure media medical meeting member memory mental message method middle might military million minister minute model modern moment monday money month more morning most mother mountain move movie music must myself nation national natural nature near nearly need network never news next night nobody normal north northern nothing notice novel number nurse object october offer office officer official often older online only open operation opinion order other others outside over owner paper parent party passenger patient pattern peace people percent perfect perhaps period person phone photo picture piece place plan plant player please point police policy political politics poor popular population position positive possible power practice prepare present president pressure pretty prevent price private probably problem process produce product production program project property protect prove provide public pull purpose push quality quarter question quick quickly quite race radio raise range rate rather reach read ready real really reason receive recent recently record reduce region relation release remain remember remove report research resident resource respond rest result return review rich right rise risk river road rock role room round rule safe safety sale same saturday save school science score season second section security seem sell send senior sense series serious serve service seven several share short should shoulder show side sign signal similar simple since single sister situation skill sleep small smile social society soft soldier some someone something sometimes south southern space speak special speech speed spend sport spring staff stage stand standard start state station stay step still stock stone stop store story street strong student study style subject success such sudden suddenly suffer sugar summer sunday supply support sure system table taiwan taiwanese take talk teacher team technology television tell temperature tend term test thank that their them themselves then theory there these thing think third this those though thought thousand three through thursday ticket time today together tomorrow tonight total touch tour toward town trade traffic train training travel treat tree trial trip trouble truck true trust truth try tuesday turn twice type typhoon under understand union unit united university until upon usually value various very victim video view village visit voice vote wait walk wall want watch water weather website wednesday week weekend weight welcome well west western what whatever when where whether which while white whole whose wide wife will window winner winter with within without woman women wonder word work worker world worry would write writer wrong yesterday young yourself youth across agreed announced asked called company companies country countries expected increased major month months people percent prices rates reported reports said says shares stocks still stores students taiwan tariff tariffs think trump using workers years year`.split(/\s+/));
function isHard(w, lang){
  if(lang !== 'en' || /^[A-Z]/.test(w)) return false;
  const lw = w.toLowerCase().replace(/[’']s$/, '');
  if(lw.length <= 4) return false;
  const forms = [lw, lw.replace(/s$/,''), lw.replace(/es$/,''), lw.replace(/ies$/,'y'), lw.replace(/ed$/,''), lw.replace(/d$/,''),
                 lw.replace(/ing$/,''), lw.replace(/ing$/,'e'), lw.replace(/ly$/,''), lw.replace(/er$/,''), lw.replace(/ers$/,'')];
  return !forms.some(f => COMMON.has(f) || (f.length <= 4 && f !== lw));
}

/* =========================================================
   名詞解釋（維基百科，依新聞所在國家優先查當地語言）
   ========================================================= */
const STOP = new Set('a an the of and or for to in on at by with from as is are was were be been after before over amid into than new says said say will would can could may might its it his her their our this that these those how why what who when where not no but up down out off more most first last just now about against under while during'.split(' '));
const NOT_ENT = new Set(['US','UK','TV','OK','AM','PM','I','A']);
function findEntities(text){
  const toks = text.split(/\s+/).filter(Boolean);
  const words = toks.map(t => t.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}.]+$/u, '').replace(/[’']s$/, '').replace(/\.$/, ''));
  const caps = words.filter(w => /^[A-Z]/.test(w)).length;
  const titleCase = caps / (words.length || 1) > 0.6;
  const isAcr = w => /^[A-Z][A-Z0-9&]{1,6}$/.test((w || '').replace(/\./g, ''));
  const isEnt = (w, i) => {
    if(!w) return false;
    if(isAcr(w)) return true;
    if(!/^[A-Z][a-z]/.test(w)) return false;
    const l = w.toLowerCase();
    if(STOP.has(l)) return false;
    if((titleCase || i === 0) && COMMON.has(l)) return false;
    return true;
  };
  const out = []; let cur = [];
  const flush = () => { if(cur.length){ out.push(cur.join(' ')); cur = []; } };
  toks.forEach((t, i) => {
    const w = words[i];
    if(/^["“‘(]/.test(t)) flush();
    if(isEnt(w, i)) cur.push(w);
    else if(cur.length && ['of','de','the','and','for','on'].includes(w) && isEnt(words[i + 1], i + 1)) cur.push(w);
    else flush();
    if(/[,:;?!"”)]$/.test(t)) flush();
  });
  flush();
  return [...new Set(out)].filter(e => !NOT_ENT.has(e) && e.length > 1).slice(0, 6);
}
const LOCAL_STOP = {
  fr:'le la les un une des du de et en au aux ce cet cette ces son sa ses il elle ils elles on nous pour par sur avec dans qui que quand comment pourquoi après avant face selon pas plus',
  es:'el la los las un una unos unas de del y en al con por para su sus que cómo qué tras ante este esta estos estas según sin más',
  it:'il lo la i gli le un una uno di del della dei delle e in con per su che come dopo prima questo questa questi secondo senza più',
  de:'der die das den dem des ein eine einen einem einer und in im mit von zu zum zur auf für bei nach vor über unter wie was wer warum wann nicht mehr',
  id:'di ke dari dan yang untuk dengan pada ini itu akan tidak oleh sebagai dalam'
};
function findEntitiesLatin(text, lang, enText = ''){
  const stop = new Set((LOCAL_STOP[lang] || '').split(' '));
  const toks = text.split(/\s+/).filter(Boolean);
  const raws = toks.map(t => t.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}.]+$/u, '').replace(/\.$/, ''));
  const words = raws.map(r => r.replace(/^(l|d|qu|j|n|s|c|all|dell|nell|sull)['’]/i, ''));
  const isAcr = w => /^\p{Lu}[\p{Lu}0-9&]{1,6}$/u.test((w || '').replace(/\./g, ''));
  // 德文名詞都大寫開頭，所以德文只抓縮寫、或連續兩個以上大寫字、或英文翻譯裡原樣保留的字
  const de = lang === 'de';
  const isEnt = w => !!w && (isAcr(w) || (/^\p{Lu}\p{Ll}/u.test(w) && !stop.has(w.toLowerCase())));
  const out = []; let cur = [], start = -1;
  const keepSingle = w => isAcr(w) || enText.includes(w);
  const flush = () => {
    if(cur.length){
      const single = cur.length === 1;
      if(single && (start === 0 || de) ? keepSingle(cur[0]) : true) out.push(cur.join(' '));
    }
    cur = []; start = -1;
  };
  toks.forEach((t, i) => {
    const w = words[i];
    if(/^["“‘«„(]/.test(t)) flush();
    if(isEnt(w)){ if(!cur.length) start = i; cur.push(cur.length ? raws[i] : w); }
    else if(cur.length && ['de','du','des','la','del','di','della','dei','delle','von','der'].includes(w) && isEnt(words[i + 1])) cur.push(w);
    else flush();
    if(/[,:;?!"”»“)]$/.test(t)) flush();
  });
  flush();
  return [...new Set(out)].filter(e => e.length > 1).slice(0, 6);
}
const WIKI_NAME = {en:'英文', fr:'法文', es:'西班牙文', it:'義大利文', ja:'日文', ko:'韓文', th:'泰文', de:'德文', id:'印尼文', zh:'中文'};
const wikiName = l => WIKI_NAME[l] || (allLangs()[l]?.name || l);
const wikiApi = wl => `https://${wl}.wikipedia.org/w/api.php?format=json&origin=*&`;
const WIKI_PROPS = 'action=query&redirects=1&prop=pageprops|langlinks|extracts&ppprop=disambiguation&lllang=zh&exintro=1&explaintext=1&exsentences=4';
const entCache = {};
async function wikiPage(title, wl){
  const d = await timeout(fetch(wikiApi(wl) + WIKI_PROPS + '&titles=' + encodeURIComponent(title)).then(r => r.json()), 10000);
  const p = Object.values(d.query?.pages || {})[0];
  if(!p || p.missing !== undefined || p.pageprops?.disambiguation !== undefined || !p.extract) return null;
  return p;
}
async function wikiFind(term, ctx, wl){
  let p = await wikiPage(term, wl).catch(() => null);
  if(p) return p;
  for(const q of [ctx ? term + ' ' + ctx : null, term].filter(Boolean)){
    const s = await timeout(fetch(wikiApi(wl) + 'action=query&list=search&srlimit=5&srsearch=' + encodeURIComponent(q)).then(r => r.json()), 10000).catch(() => null);
    for(const h of (s?.query?.search || [])){
      if(/disambiguation|homonymie|desambiguación|disambigua|begriffsklärung|disambiguasi|曖昧さ回避|동음이의|แก้ความกำกวม/i.test(h.title)) continue;
      p = await wikiPage(h.title, wl).catch(() => null);
      if(p) return p;
    }
  }
  return null;
}
const toTW = async t => { if(!t) return ''; try{ return (await translate(t, 'zh-CN', 'zh-TW')).t; }catch(e){ return t; } };
async function explainEntity(ent, headline, wl, term, extraCtx = ''){
  const key = wl + '|' + ent + '|' + headline;
  if(entCache[key]) return entCache[key];
  const latin = /^[\p{Script=Latin}\s\p{P}\p{S}\d]+$/u.test(headline);
  const ctx = (latin ? headline.split(/\s+/).map(w => w.replace(/[^\p{L}]/gu, ''))
      .filter(w => w.length > 4 && !ent.includes(w) && !STOP.has(w.toLowerCase())).slice(0, 3).join(' ') : '') + (extraCtx ? ' ' + extraCtx : '');
  const p = await wikiFind(term || ent, ctx.trim(), wl);
  if(!p) return entCache[key] = {ent, none:true};
  const zhTitleRaw = p.langlinks?.[0]?.['*'] || '';
  let zhText = '';
  if(zhTitleRaw){
    try{
      const d = await timeout(fetch(wikiApi('zh') + 'action=query&prop=extracts&exintro=1&explaintext=1&exsentences=4&titles=' + encodeURIComponent(zhTitleRaw)).then(r => r.json()), 10000);
      zhText = Object.values(d.query?.pages || {})[0]?.extract || '';
    }catch(e){}
  }
  const useLocal = !zhText || (wl !== 'en' && zhText.length < 60 && p.extract.length > zhText.length * 2);
  const [zhTitle, zhBody] = await Promise.all([
    toTW(zhTitleRaw),
    useLocal ? translate(p.extract.slice(0, 700), wl, 'zh-TW').then(r => r.t).catch(() => '') : toTW(zhText)
  ]);
  return entCache[key] = {
    ent, wl, local:p.title, zh:zhTitle, text:zhBody,
    isAcr: /^[A-Z][A-Z0-9&.]{1,7}$/.test(ent) && p.title.replace(/\s/g, '') !== ent,
    url: zhTitleRaw ? 'https://zh.wikipedia.org/zh-tw/' + encodeURIComponent(zhTitleRaw) : `https://${wl}.wikipedia.org/wiki/` + encodeURIComponent(p.title),
    localUrl: `https://${wl}.wikipedia.org/wiki/` + encodeURIComponent(p.title),
    news: 'https://news.google.com/search?q=' + encodeURIComponent(zhTitle || p.title) + '&hl=zh-TW&gl=TW&ceid=TW:zh-Hant'
  };
}
/* 決定這則新聞要查哪一國的維基、找哪些名詞
   opt = {orig, srcLang, region, cat, translated(英文時的翻譯), intl(是否國際版)} */
async function planEntities(opt){
  const {orig, srcLang, region, intl} = opt;
  const toEn = async () => srcLang === 'en' ? orig : (opt.enText || (await translate(orig, srcLang === 'zh' ? 'zh-TW' : srcLang, 'en')).t);
  if(intl || srcLang === 'zh'){
    const en = await toEn();
    return {wl:'en', items: findEntities(en).map(e => ({ent:e, term:e, headline:en})), note:'國際通用名稱'};
  }
  const R = regionOf(srcLang, region);
  if(srcLang === 'en') return {wl:'en', items: findEntities(orig).map(e => ({ent:e, term:e, headline:orig, extra:R.place && ({US:'United States', GB:'United Kingdom', AU:'Australia', NZ:'New Zealand', CA:'Canada', SG:'Singapore'})[R.cc]})), note:R.place + '當地'};
  const latin = /^[\p{Script=Latin}\s\p{P}\p{S}\d]+$/u.test(orig);
  if(latin){
    let en = ''; try{ en = await toEn(); }catch(e){}
    return {wl:srcLang, items: findEntitiesLatin(orig, srcLang, en).map(e => ({ent:e, term:e, headline:orig})), note:wikiName(srcLang) + '維基'};
  }
  const en = await toEn();
  const items = await Promise.all(findEntities(en).map(async e => {
    let term = e; try{ term = (await translate(e, 'en', srcLang)).t || e; }catch(err){}
    return {ent:term, term, headline:orig, enName:e};
  }));
  return {wl:srcLang, items, note:wikiName(srcLang) + '維基'};
}
async function explainAll(plan){
  return Promise.all(plan.items.map(async it => {
    let r = await explainEntity(it.ent, it.headline, plan.wl, it.term, it.extra).catch(() => ({ent:it.ent, none:true}));
    if(r.none && plan.wl !== 'en'){
      const enTerm = it.enName || it.ent;
      r = await explainEntity(enTerm, it.headline, 'en', enTerm).catch(() => r);
      if(!r.none) r = {...r, ent:it.ent, fallback:true};
    }
    return r;
  }));
}
function entsHTML(plan, res){
  const found = res.filter(r => !r.none);
  return `<div class="ent-h">🔍 名詞解釋 <small>優先查：${esc(plan.note)}</small></div>` +
    found.map(r => `
      <div class="ent">
        <div class="ent-t"><b>${esc(r.ent)}</b>${r.zh ? `　${esc(r.zh)}` : ''}</div>
        ${r.isAcr ? `<div class="ent-full">全稱：${esc(r.local)}</div>` : (r.local !== r.ent ? `<div class="ent-full">${r.wl === 'en' ? '英文' : wikiName(r.wl) + '原名'}：${esc(r.local)}</div>` : '')}
        <div class="ent-d">${esc(r.text || '（維基百科沒有摘要）')}</div>
        <div class="ent-l">
          <a href="${r.url}" target="_blank" rel="noopener">${r.url.includes('zh.wikipedia') ? '中文維基' : wikiName(r.wl) + '維基'} ↗</a>
          ${r.url.includes('zh.wikipedia') ? `<a href="${r.localUrl}" target="_blank" rel="noopener">${wikiName(r.wl)}維基 ↗</a>` : ''}
          <a href="${r.news}" target="_blank" rel="noopener">相關新聞 ↗</a>
          ${r.fallback ? '<span class="ent-src">（當地查不到，改用英文維基）</span>' : ''}
        </div>
      </div>`).join('') +
    (res.length > found.length ? `<div class="ent-n">查不到：${res.filter(r => r.none).map(r => esc(r.ent)).join('、')}</div>` : '') +
    (!res.length ? '<div class="ent-n">這則標題沒有找到需要解釋的專有名詞或縮寫。</div>' : '');
}

/* =========================================================
   新聞全文擷取
   ========================================================= */
async function resolveGoogleNews(url){
  if(!/news\.google\.com\/(rss\/)?articles\//.test(url)) return url;
  const id = url.split('/articles/')[1].split('?')[0];
  // 舊格式：網址直接藏在 base64 裡
  try{
    const b64 = id.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const m = bin.match(/https?:\/\/[\x21-\x7e]+/);
    if(m && !m[0].includes('news.google')) return m[0];
  }catch(e){}
  // 新格式：要先拿簽章，再向 Google 換真正網址
  const html = await proxyText('https://news.google.com/rss/articles/' + id, t => /data-n-a-sg/.test(t));
  const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1], ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if(!sg || !ts) throw new Error('no sig');
  const req = [[['Fbv4je', JSON.stringify(['garturlreq', [['X','X',['X','X'],null,null,1,1,'US:en',null,1,null,null,null,null,null,0,1],'X','X',1,[1,1,1],1,1,null,0,0,null,0], id, +ts, sg]), null, 'generic']]];
  const body = 'f.req=' + encodeURIComponent(JSON.stringify(req));
  const target = 'https://news.google.com/_/DotsSplashUi/data/batchexecute';
  const txt = await timeout(any([
    getText('https://corsproxy.io/?url=' + encodeURIComponent(target), {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'}, body}),
    getText('https://cors.eu.org/' + target, {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'}, body})
  ]), 15000);
  const m = txt.match(/\[\\"garturlres\\",\\"(.*?)\\"/);
  if(m) return m[1].replace(/\\\\u003d/g, '=').replace(/\\\\u0026/g, '&');
  throw new Error('decode failed');
}
let readabilityP = null;
function loadReadability(){
  return readabilityP ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.js';
    s.onload = () => res(window.Readability); s.onerror = rej; document.head.appendChild(s);
  });
}
async function fetchArticle(link){
  const url = await resolveGoogleNews(link);
  const [html, Readability] = await Promise.all([proxyText(url, t => t.length > 2000), loadReadability()]);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base'); base.href = url; doc.head.appendChild(base);
  const art = new Readability(doc).parse();
  if(!art?.content) throw new Error('no content');
  const box = document.createElement('div'); box.innerHTML = art.content;
  const paras = [...box.querySelectorAll('p, h2, h3, li, blockquote')]
    .filter(el => !el.querySelector('p, li'))
    .map(el => el.textContent.replace(/\s+/g, ' ').trim())
    .filter(t => t.length > 25);
  const uniq = [...new Set(paras)];
  if(uniq.length < 2) throw new Error('too short');
  return {url, title: art.title || '', site: art.siteName || '', paras: uniq.slice(0, 60)};
}

/* =========================================================
   語音：前景用手機內建語音；背景／鎖屏用音訊檔（Google 免費語音）
   ========================================================= */
function splitChunks(text, max = 180){
  const out = []; let cur = '';
  const parts = text.split(/(?<=[。！？!?；;\.\n，,、:：])/u);
  for(let p of parts){
    if(!p) continue;
    while(p.length > max){ out.push(p.slice(0, max)); p = p.slice(max); }
    if((cur + p).length > max){ if(cur.trim()) out.push(cur.trim()); cur = p; } else cur += p;
  }
  if(cur.trim()) out.push(cur.trim());
  return out;
}
function voiceFor(tts){
  const vs = (window.speechSynthesis?.getVoices?.() || []);
  const norm = x => x.lang.replace('_', '-').toLowerCase(), t = tts.toLowerCase();
  const exact = vs.find(v => norm(v) === t);
  if(exact) return {voice:exact, exact:true};
  return {voice: vs.find(v => norm(v).startsWith(t.slice(0, 2))), exact:false};
}
try{ speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {}; }catch(e){}
function speakNow(text, tts, rate = 1){
  try{
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = tts; u.rate = rate;
    const {voice} = voiceFor(tts); if(voice) u.voice = voice;
    speechSynthesis.speak(u);
    return true;
  }catch(e){ return false; }
}
/* Google 語音的語言代碼 */
function gttsLang(tts){
  const t = tts.toLowerCase();
  if(t.startsWith('zh')) return t.includes('cn') ? 'zh-CN' : 'zh-TW';
  if(['en-gb','en-au','en-in','fr-ca','pt-br','es-mx'].includes(t)) return tts;
  return t.split('-')[0];
}
const ttsUrl = (text, tts) => `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(gttsLang(tts))}&q=${encodeURIComponent(text)}&total=1&idx=0&textlen=${text.length}`;
let wordAudio = null;
function playUrl(url){
  try{ wordAudio?.pause(); }catch(e){}
  wordAudio = new Audio(url);
  return wordAudio.play();
}
/* 說一個字／一句話：手機有正確口音的語音就用手機的，否則用 Google 語音 */
async function sayText(text, tts, rate = 1){
  const {exact} = voiceFor(tts);
  if(exact){ speakNow(text, tts, rate); return 'device'; }
  try{ const a = new Audio(ttsUrl(text.slice(0, 190), tts)); try{ wordAudio?.pause(); }catch(e){} wordAudio = a; a.playbackRate = rate; await a.play(); return 'google'; }
  catch(e){ speakNow(text, tts, rate); return 'device'; }
}

/* 背景播放器：一段一段播放音訊，螢幕關掉、切到別的 App 也能繼續（需從主畫面或瀏覽器開啟，iPhone 需 iOS 15 以上） */
class Player {
  constructor(onChange){
    this.audio = document.createElement('audio');
    this.audio.preload = 'auto'; this.audio.setAttribute('playsinline', '');
    document.body.appendChild(this.audio);
    this.items = []; this.i = 0; this.c = 0; this.rate = 1; this.playing = false; this.onChange = onChange || (() => {});
    this.title = '每日新聞'; this.useDevice = false;
    this.audio.addEventListener('ended', () => { if(this.unlocking || !this.playing){ this.unlocking = false; return; } this.advance(); });
    this.audio.addEventListener('error', () => { if(!this.unlocking) this.fail(); });
    this.audio.addEventListener('playing', () => { this.audio.playbackRate = this.rate; });
    if('mediaSession' in navigator){
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', () => this.resume());
      ms.setActionHandler('pause', () => this.pause());
      ms.setActionHandler('nexttrack', () => this.jump(this.i + 1));
      ms.setActionHandler('previoustrack', () => this.jump(Math.max(0, this.i - 1)));
      try{ ms.setActionHandler('stop', () => this.stop()); }catch(e){}
    }
  }
  /* iPhone 要在按鈕按下的當下先播一次，之後才能自動／背景播放 */
  unlock(){
    try{
      const n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf), w = (o, s) => [...s].forEach((ch, k) => v.setUint8(o + k, ch.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
      for(let k = 0; k < n; k++) v.setUint8(44 + k, 128);
      this.unlocking = true;
      this.audio.src = URL.createObjectURL(new Blob([buf], {type:'audio/wav'}));
      const p = this.audio.play(); if(p) p.catch(() => {}).finally(() => { this.unlocking = false; });
    }catch(e){ this.unlocking = false; }
  }
  /* items: [{text, tts, label}] */
  load(items, title){ this.stop(); this.items = items.map(x => ({...x, chunks: splitChunks(x.text)})); this.i = 0; this.c = 0; if(title) this.title = title; }
  meta(){
    if(!('mediaSession' in navigator)) return;
    const it = this.items[this.i]; if(!it) return;
    try{ navigator.mediaSession.metadata = new MediaMetadata({title: it.label || it.text.slice(0, 60), artist: this.title, album: `${this.i + 1} / ${this.items.length}`}); }catch(e){}
  }
  src(){
    const it = this.items[this.i]; if(!it) return null;
    const chunk = it.chunks[this.c]; if(chunk == null) return null;
    return ttsUrl(chunk, it.tts);
  }
  start(){
    const it = this.items[this.i];
    if(!it){ this.stop(true); return; }
    if(this.c >= it.chunks.length){ this.i++; this.c = 0; return this.start(); }
    this.meta(); this.onChange(this.i, true);
    if(this.useDevice) return this.deviceSpeak();
    this.retried = false;
    this.audio.src = this.src();
    this.audio.playbackRate = this.rate;
    this.playing = true;
    const p = this.audio.play();
    if(p) p.catch(err => { if(err.name === 'NotAllowedError'){ this.playing = false; this.onChange(this.i, false); } });
  }
  advance(){ this.c++; if(this.c >= (this.items[this.i]?.chunks.length || 0)){ this.i++; this.c = 0; } this.start(); }
  fail(){
    // Google 語音失敗：改用手機內建語音（這段只能在螢幕開著時播放）
    const it = this.items[this.i]; if(!it || !this.playing) return;
    this.deviceSpeak(true);
  }
  deviceSpeak(once){
    const it = this.items[this.i];
    try{
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(it.chunks[this.c]);
      u.lang = it.tts; u.rate = this.rate;
      const {voice} = voiceFor(it.tts); if(voice) u.voice = voice;
      u.onend = () => { if(this.playing) this.advance(); };
      u.onerror = () => { if(this.playing) this.advance(); };
      this.playing = true;
      speechSynthesis.speak(u);
    }catch(e){ this.advance(); }
  }
  play(i = this.i){ this.i = i; this.c = 0; this.start(); }
  jump(i){ if(i < 0 || i >= this.items.length) return; this.audio.pause(); try{ speechSynthesis.cancel(); }catch(e){} this.play(i); }
  pause(){ this.playing = false; this.audio.pause(); try{ speechSynthesis.cancel(); }catch(e){} this.onChange(this.i, false); if('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; }
  resume(){
    if(this.useDevice || !this.audio.src){ this.playing = true; this.start(); return; }
    this.playing = true; this.audio.play().catch(() => {}); this.onChange(this.i, true);
    if('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  }
  toggle(){ this.playing ? this.pause() : this.resume(); }
  setRate(r){ this.rate = r; this.audio.playbackRate = r; }
  stop(done){ this.playing = false; try{ this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); }catch(e){} try{ speechSynthesis.cancel(); }catch(e){} if(done) this.onChange(-1, false); }
}

/* 簡易語言偵測（依文字種類），電子書每段用 */
function scriptLang(text, fallback){
  const c = re => (text.match(re) || []).length;
  const kana = c(/[぀-ヿ]/g), han = c(/[一-鿿]/g), hang = c(/[가-힯]/g), thai = c(/[฀-๿]/g), latin = c(/[A-Za-z]/g);
  const max = Math.max(kana + han, hang, thai, latin);
  if(max === 0) return fallback;
  if(hang === max) return 'ko';
  if(thai === max) return 'th';
  if(kana + han === max) return kana > 0 && kana / (kana + han) > 0.1 ? 'ja' : 'zh';
  return /^(zh|ja|ko|th)$/.test(fallback) ? 'en' : fallback;
}

/* =========================================================
   只輸入語言名稱 → 自動找出語言代碼與官方國家（用瀏覽器內建資料，免費）
   ========================================================= */
const normName = s => (s || '').toLowerCase().replace(/\blanguage\b/g, '').replace(/[\s()（）'’-]/g, '').replace(/(語言|語|语|文|話|话)$/, '');
const normPlace = s => (s || '').toLowerCase().replace(/^the\s+/, '').replace(/[\s()（）.'’-]/g, '');
let _langIdx = null, _ccIdx = null;
function langIndex(){
  if(_langIdx) return _langIdx;
  const dn = l => { try{ return new Intl.DisplayNames([l], {type:'language'}); }catch(e){ return null; } };
  const zh = dn('zh-TW'), cn = dn('zh-CN'), en = dn('en');
  const codes = [];
  for(let a = 97; a <= 122; a++) for(let b = 97; b <= 122; b++) codes.push(String.fromCharCode(a, b));
  codes.push('fil', 'haw', 'yue', 'ceb', 'hmn', 'ckb');
  _langIdx = codes.map(c => {
    let n; try{ n = zh?.of(c); }catch(e){ return null; }
    if(!n || n === c) return null;
    return {code:c, zh:n, cn:cn?.of(c) || '', en:en?.of(c) || '', native:''};
  }).filter(Boolean);
  return _langIdx;
}
function ccIndex(){
  if(_ccIdx) return _ccIdx;
  const zh = new Intl.DisplayNames(['zh-TW'], {type:'region'}), cn = new Intl.DisplayNames(['zh-CN'], {type:'region'}), en = new Intl.DisplayNames(['en'], {type:'region'});
  const out = [];
  for(let a = 65; a <= 90; a++) for(let b = 65; b <= 90; b++){
    const c = String.fromCharCode(a, b); let n; try{ n = zh.of(c); }catch(e){ continue; }
    if(n && n !== c) out.push({cc:c, zh:n, cn:cn.of(c), en:en.of(c)});
  }
  return _ccIdx = out;
}
function lev(a, b){
  if(Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({length:a.length + 1}, (_, i) => [i]);
  for(let j = 1; j <= b.length; j++) d[0][j] = j;
  for(let i = 1; i <= a.length; i++) for(let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/* 英文：拼錯幾個字母、或多打了形容詞（例如 Brazilian Portuguese）也找得到 */
function fuzzyIn(list, q, fields, norm){
  const n = norm(q); if(n.length < 3) return null;
  let best = null, bd = 99;
  for(const x of list) for(const f of fields){
    const v = norm(x[f]); if(!v || v.length < 3) continue;
    const dist = lev(n, v), lim = Math.max(1, Math.floor(v.length / 4));
    if(dist <= lim && dist < bd){ best = x; bd = dist; }
  }
  if(best) return best;
  // 輸入裡包含某個語言／國家名稱（取最長的）
  let hit = null;
  for(const x of list) for(const f of fields){ const v = norm(x[f]); if(v.length >= 4 && n.includes(v) && (!hit || v.length > hit.len)) hit = {x, len:v.length}; }
  return hit?.x || null;
}
function matchIn(list, q, fields, norm){
  const n = norm(q); if(!n) return null;
  return list.find(x => fields.some(f => norm(x[f]) === n)) ||
         (n.length >= 2 ? list.find(x => fields.some(f => norm(x[f]).startsWith(n))) : null);
}
const PLACE_FIX = {HK:'香港', MO:'澳門', TW:'台灣', CN:'中國', KR:'韓國', KP:'北韓'};
const countryName = cc => PLACE_FIX[cc] || (() => { try{ return new Intl.DisplayNames(['zh-TW'], {type:'region'}).of(cc); }catch(e){ return cc; } })();
const HOME_COUNTRY = {pt:'PT', ar:'SA', sw:'KE', ms:'MY', fa:'IR', ur:'PK', bn:'BD', ta:'IN'};
async function findLanguage(q){
  q = (q || '').trim(); if(!q) return null;
  const idx = langIndex();
  const ALIAS = {tagalog:'fil', filipino:'fil', 他加祿:'fil', farsi:'fa', persian:'fa', cantonese:'yue', 廣東:'yue', mandarin:'zh', 國:'zh', 普通:'zh', burmese:'my', 緬甸:'my', khmer:'km', 高棉:'km', 柬埔寨:'km', 寮:'lo', lao:'lo', 老撾:'lo', 印度:'hi', 菲律賓:'fil'};
  const al = ALIAS[normName(q)];
  let hit = (al && idx.find(x => x.code === al)) || idx.find(x => x.code === q.toLowerCase()) || matchIn(idx, q, ['zh','cn','en','native'], normName) || fuzzyIn(idx, q, ['en','native'], normName);
  if(!hit){ try{ const en = (await translate(q, 'auto', 'en')).t; hit = matchIn(idx, en, ['en'], normName) || fuzzyIn(idx, en, ['en'], normName); }catch(e){} }
  if(!hit) return null;
  let cc = 'US', script = '';
  try{ const loc = new Intl.Locale(hit.code).maximize(); cc = HOME_COUNTRY[hit.code] || loc.region || cc; script = loc.script || ''; }catch(e){}
  let nat = ''; try{ nat = new Intl.DisplayNames([hit.code], {type:'language'}).of(hit.code); }catch(e){}
  return {code: hit.code === 'fil' ? 'tl' : hit.code, zh:hit.zh, name:nat || hit.en || hit.zh, cc, place:countryName(cc),
          words: !['Hans','Hant','Jpan','Thai','Laoo','Khmr','Mymr','Tibt'].includes(script)};
}
async function findCountry(q){
  q = (q || '').trim(); if(!q) return null;
  const idx = ccIndex();
  let hit = idx.find(x => x.cc === q.toUpperCase()) || matchIn(idx, q, ['zh','cn','en'], normPlace) || fuzzyIn(idx, q, ['en'], normPlace);
  if(!hit){ try{ const en = (await translate(q, 'auto', 'en')).t; hit = matchIn(idx, en, ['en'], normPlace) || fuzzyIn(idx, en, ['en'], normPlace); }catch(e){} }
  if(hit) return {cc:hit.cc, place:PLACE_FIX[hit.cc] || hit.zh};
  const w = await wikidataCountry(q);
  return w ? {cc:w.cc, place:countryName(w.cc), sub:w.sub} : null;
}

/* 輸入的地名不是國家（例如 魁北克、巴伐利亞、香港）時，到維基數據找它屬於哪個國家 */
const wd = async params => (await timeout(fetch('https://www.wikidata.org/w/api.php?format=json&origin=*&' + params).then(r => r.json()), 10000));
const claimId = (ent, p) => ent?.claims?.[p]?.[0]?.mainsnak?.datavalue?.value?.id;
const claimStr = (ent, p) => ent?.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;
async function wikidataCountry(q){
  try{
    const latin = /^[\p{Script=Latin}\s\p{P}]+$/u.test(q);
    let ids = [];
    for(const lg of latin ? ['en', 'zh'] : ['zh', 'en']){
      const s = await wd(`action=wbsearchentities&language=${lg}&uselang=${lg}&limit=5&search=` + encodeURIComponent(q));
      ids = (s.search || []).map(x => x.id); if(ids.length) break;
    }
    if(!ids.length) return null;
    const ents = (await wd('action=wbgetentities&props=claims&ids=' + ids.join('|'))).entities || {};
    for(const id of ids){
      const e = ents[id]; if(!e) continue;
      const own = claimStr(e, 'P297'); if(own) return {cc:own, viaWD:true};
      const cid = claimId(e, 'P17'); if(!cid) continue;
      const c = (await wd('action=wbgetentities&props=claims&ids=' + cid)).entities?.[cid];
      const cc = claimStr(c, 'P297'); if(cc) return {cc, viaWD:true, sub:q};
    }
  }catch(e){}
  return null;
}
/* 國家的官方語言（ISO 639-1） */
async function officialLangs(cc){
  try{
    const s = await wd('action=query&list=search&srlimit=1&srsearch=' + encodeURIComponent('haswbstatement:P297=' + cc));
    const id = s.query?.search?.[0]?.title; if(!id) return [];
    const e = (await wd('action=wbgetentities&props=claims&ids=' + id)).entities[id];
    const lids = (e.claims?.P37 || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
    if(!lids.length) return [];
    const ls = (await wd('action=wbgetentities&props=claims&ids=' + lids.join('|'))).entities || {};
    return lids.map(l => claimStr(ls[l], 'P218')).filter(Boolean);
  }catch(e){ return []; }
}


/* =========================================================
   語言／國家下拉選單（依地區分組）
   ========================================================= */
/* 洲 → 區域 → 國家 */
const CONTINENTS = [
  ['亞洲', '🌏', [['東亞・東南亞', 'TW JP KR TH ID VN SG HK'], ['南亞', 'IN PK BD LK NP'], ['中亞', 'KZ UZ KG TJ TM']]],
  ['中東', '🕌', [['中東・西亞・北非', 'AE SA QA KW BH OM JO LB IQ IR IL EG MA']]],
  ['歐洲', '🏰', [['西歐', 'GB IE FR BE NL LU MC DE AT CH LI'], ['北歐', 'SE NO DK FI IS'], ['中歐', 'CZ SK PL HU SI'],
                 ['南歐', 'ES PT IT SM AD MT'], ['東歐・波羅的海', 'EE LV LT UA MD RO BG RU BY'], ['東南歐・巴爾幹', 'GR CY HR BA RS ME AL XK MK TR']]],
  ['美洲', '🌎', [['北美洲', 'US CA MX'], ['中美洲・加勒比', 'GT HN SV NI CR PA BZ CU DO PR JM TT HT'], ['南美洲', 'BR AR CO CL PE VE EC BO PY UY SR']]],
  ['大洋洲', '🦘', [['大洋洲', 'AU NZ']]]
];
const GROUPS = CONTINENTS.flatMap(([, , subs]) => subs);
/* 常看國家（只是設定，存在手機） */
const getFavs = () => store.get('nl_favs', []);
function toggleFav(v){ const f = getFavs(); const i = f.indexOf(v); i < 0 ? f.push(v) : f.splice(i, 1); store.set('nl_favs', f); return i < 0; }
/* 某國有哪些語言可選 */
function entriesOfCC(cc, includeZh){
  const mk = includeZh ? 'z' : 'n';
  if(!_ccMap[mk]){
    const m = {};
    for(const [k, l] of Object.entries(allLangs())){
      if(l.hidden && !(includeZh && k === 'zh')) continue;
      for(const rk of Object.keys(l.regions)){ const r = regionOf(k, rk), u = r.cc.toUpperCase(); (m[u] ||= []).push({v:`${k}|${rk}`, lang:k, r, name:l.name}); }
    }
    _ccMap[mk] = m;
  }
  return _ccMap[mk][cc] || [];
}
function allCCs(includeZh){ entriesOfCC('', includeZh); return Object.keys(_ccMap[includeZh ? 'z' : 'n']); }
function labelOf(v, style = 'place'){
  const [k, rk] = v.split('|'); const L = allLangs()[k]; if(!L) return v;
  const r = regionOf(k, rk);
  if(k === 'zh') return '🇹🇼 台灣・中文';
  return style === 'accent' ? `${r.flag} ${L.name}（${r.accent}）` : `${r.flag} ${r.place}・${L.name}`;
}
function langRegionList(includeZh){
  const L = allLangs(), all = [];
  for(const [k, l] of Object.entries(L)){
    if(l.hidden && !(includeZh && k === 'zh')) continue;
    for(const rk of Object.keys(l.regions)){ const r = regionOf(k, rk); all.push({v:`${k}|${rk}`, lang:k, r, name:l.name}); }
  }
  const groupOf = cc => (GROUPS.find(g => g[1].split(' ').includes(cc)) || ['其他'])[0];
  const order = [...GROUPS.map(g => g[0]), '其他'];
  return order.map(g => [g, all.filter(x => groupOf(x.r.cc.toUpperCase()) === g)]).filter(([, xs]) => xs.length);
}
/* style: 'place'（國家・語言）或 'accent'（語言・口音） */
function langRegionOptions(selected, style = 'place', includeZh = false){
  const favs = getFavs().filter(v => allLangs()[v.split('|')[0]]);
  const favHtml = favs.length ? `<optgroup label="⭐ 常看國家">${favs.map(v => `<option value="${v}" ${v === selected ? 'selected' : ''}>${esc(labelOf(v, style))}</option>`).join('')}</optgroup>` : '';
  return favHtml + langRegionList(includeZh).map(([g, xs]) => `<optgroup label="${g}">${xs.map(x => {
    const label = x.lang === 'zh' ? '🇹🇼 台灣・中文' : style === 'accent' ? `${x.r.flag} ${x.name}（${x.r.accent}）` : `${x.r.flag} ${x.r.place}・${x.name}`;
    return `<option value="${x.v}" ${x.v === selected ? 'selected' : ''}>${esc(label)}</option>`; }).join('')}</optgroup>`).join('');
}
