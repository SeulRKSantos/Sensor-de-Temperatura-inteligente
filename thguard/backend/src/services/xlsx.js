// Gerador mínimo de .xlsx (Office Open XML) sem dependências: planilhas com
// texto/número, estilos fixos, painel congelado, filtro e um gráfico de linhas
// numa planilha à parte. O ZIP é montado aqui com o zlib do Node.
const zlib = require('zlib');

// ── ZIP ───────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files, when = new Date()) {
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 6 });
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, comp);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10); cd.writeUInt16LE(time, 12); cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

// ── XML ───────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function colName(i) {          // 0 -> A, 25 -> Z, 26 -> AA
  let s = '';
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}
const quoteSheet = (n) => `'${String(n).replace(/'/g, "''")}'`;

// Estilos disponíveis para as células (índice em cellXfs)
const STYLE = { normal: 0, title: 1, header: 2, num2: 3, muted: 4, bold: 5, int: 6, off: 7, fault: 8, subtitle: 9, num1: 10 };
const STYLES_XML = HDR + `<styleSheet xmlns="${NS_MAIN}">
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="0.0"/></numFmts>
<fonts count="7">
<font><sz val="11"/><color rgb="FF1D2329"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="15"/><color rgb="FF0F1B33"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF1D2329"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="10"/><color rgb="FF5D6973"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="11"/><color rgb="FF5B4FB0"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFB42318"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="11"/><color rgb="FF46505A"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8ECF2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FF9AA5B1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// Célula: null | número | texto | { v, s } (s = nome em STYLE)
function cellXml(ref, cell) {
  if (cell == null) return '';
  const o = typeof cell === 'object' ? cell : { v: cell };
  if (o.v == null || o.v === '') return o.s ? `<c r="${ref}" s="${STYLE[o.s]}"/>` : '';
  const s = o.s ? ` s="${STYLE[o.s]}"` : '';
  if (typeof o.v === 'number' && Number.isFinite(o.v)) return `<c r="${ref}"${s}><v>${o.v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`;
}

function sheetXml(sh, drawingRid) {
  const out = [HDR, `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">`];
  if (sh.fitToPage) out.push('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
  out.push('<sheetViews><sheetView workbookViewId="0"' + (sh.showGrid === false ? ' showGridLines="0"' : '') + '>');
  if (sh.freezeRows) out.push(`<pane ySplit="${sh.freezeRows}" topLeftCell="A${sh.freezeRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sh.freezeRows + 1}" sqref="A${sh.freezeRows + 1}"/>`);
  out.push('</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>');
  if (sh.cols?.length) out.push('<cols>' + sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>');
  out.push('<sheetData>');
  (sh.rows || []).forEach((row, r) => {
    if (!row || !row.length) return;
    const cells = row.map((c, ci) => cellXml(colName(ci) + (r + 1), c)).join('');
    const ht = sh.rowHeights?.[r] ? ` ht="${sh.rowHeights[r]}" customHeight="1"` : '';
    if (cells || ht) out.push(`<row r="${r + 1}"${ht}>${cells}</row>`);
  });
  out.push('</sheetData>');
  if (sh.autoFilter) out.push(`<autoFilter ref="${sh.autoFilter}"/>`);
  if (sh.merges?.length) out.push(`<mergeCells count="${sh.merges.length}">` + sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('') + '</mergeCells>');
  out.push('<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>');
  out.push(`<pageSetup paperSize="9" orientation="${sh.landscape ? 'landscape' : 'portrait'}"${sh.fitToPage ? ' fitToWidth="1" fitToHeight="1"' : ''}/>`);
  if (drawingRid) out.push(`<drawing r:id="${drawingRid}"/>`);
  out.push('</worksheet>');
  return out.join('');
}

// ── Gráfico de linhas ─────────────────────────────────────────────
function richText(text, { sz = 1100, b = false, rot } = {}) {
  return `<c:tx><c:rich><a:bodyPr${rot ? ` rot="${rot}" vert="horz"` : ''}/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${b ? 1 : 0}"/></a:pPr>` +
    `<a:r><a:rPr lang="pt-BR" sz="${sz}" b="${b ? 1 : 0}"><a:solidFill><a:srgbClr val="1D2329"/></a:solidFill></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx>`;
}
const txPr = (sz = 900) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}"><a:solidFill><a:srgbClr val="46505A"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="pt-BR"/></a:p></c:txPr>`;

// chart = { title, xTitle, yTitle, catRef, catValues[], tickSkip, series: [{ name, nameRef, ref, values[], color, dash, width }] }
function chartXml(ch) {
  const cat = `<c:cat><c:strRef><c:f>${esc(ch.catRef)}</c:f><c:strCache><c:ptCount val="${ch.catValues.length}"/>` +
    ch.catValues.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('') + '</c:strCache></c:strRef></c:cat>';
  const sers = ch.series.map((s, i) => {
    const pts = s.values.map((v, j) => (v == null || !Number.isFinite(v) ? '' : `<c:pt idx="${j}"><c:v>${v}</c:v></c:pt>`)).join('');
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>` +
      `<c:tx><c:strRef><c:f>${esc(s.nameRef)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>` +
      `<c:spPr><a:ln w="${s.width || 15875}" cap="rnd"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill>${s.dash ? `<a:prstDash val="${s.dash}"/>` : ''}<a:round/></a:ln></c:spPr>` +
      '<c:marker><c:symbol val="none"/></c:marker>' + cat +
      `<c:val><c:numRef><c:f>${esc(s.ref)}</c:f><c:numCache><c:formatCode>0.00</c:formatCode><c:ptCount val="${s.values.length}"/>${pts}</c:numCache></c:numRef></c:val>` +
      '<c:smooth val="0"/></c:ser>';
  }).join('');
  return HDR + `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/><c:chart>` +
    `<c:title>${richText(ch.title, { sz: 1400, b: true })}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` +
    '<c:plotArea><c:layout/><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' + sers +
    '<c:marker val="1"/><c:axId val="50010001"/><c:axId val="50010002"/></c:lineChart>' +
    '<c:catAx><c:axId val="50010001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>' +
    `<c:title>${richText(ch.xTitle)}<c:overlay val="0"/></c:title><c:numFmt formatCode="General" sourceLinked="1"/>` +
    '<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>' +
    '<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="9AA5B1"/></a:solidFill></a:ln></c:spPr>' + txPr() +
    '<c:crossAx val="50010002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>' +
    `<c:tickLblSkip val="${ch.tickSkip || 1}"/><c:tickMarkSkip val="${ch.tickSkip || 1}"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    '<c:valAx><c:axId val="50010002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>' +
    '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E1E5EA"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' +
    `<c:title>${richText(ch.yTitle, { rot: -5400000 })}<c:overlay val="0"/></c:title><c:numFmt formatCode="0" sourceLinked="0"/>` +
    '<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
    '<c:spPr><a:ln w="9525"><a:noFill/></a:ln></c:spPr>' + txPr() +
    '<c:crossAx val="50010001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>' +
    '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>' +
    `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${txPr(1000)}</c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>';
}

function drawingXml({ from, to }) {
  const pos = (p) => `<xdr:col>${p.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>0</xdr:rowOff>`;
  return HDR + `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS_A}">` +
    `<xdr:twoCellAnchor editAs="oneCell"><xdr:from>${pos(from)}</xdr:from><xdr:to>${pos(to)}</xdr:to>` +
    '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Gráfico 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
    '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
    `<c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
}

// Linhas repetidas na impressão e o intervalo do filtro, como o Excel grava
function definedNames(sheets) {
  const d = [];
  sheets.forEach((s, i) => {
    if (s.autoFilter) d.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(quoteSheet(s.name))}!${s.autoFilter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>`);
    if (s.printTitleRows) d.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${esc(quoteSheet(s.name))}!${s.printTitleRows}</definedName>`);
  });
  return d.length ? `<definedNames>${d.join('')}</definedNames>` : '';
}

// ── Workbook ──────────────────────────────────────────────────────
// sheets: [{ name, rows, cols, freezeRows, autoFilter, merges, showGrid, landscape, chart: { anchor:{from,to}, ...chartXml } }]
function buildWorkbook({ sheets, title = '', author = 'TH-GUARD' }) {
  const files = [];
  const charts = [];
  sheets.forEach((sh, i) => { if (sh.chart) charts.push({ sheet: i + 1, n: charts.length + 1, chart: sh.chart }); });

  files.push({ name: '[Content_Types].xml', data: HDR +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    charts.map((c) => `<Override PartName="/xl/drawings/drawing${c.n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` +
      `<Override PartName="/xl/charts/chart${c.n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join('') +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>' });
  files.push({ name: '_rels/.rels', data: HDR + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    `<Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>` });
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files.push({ name: 'docProps/core.xml', data: HDR +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` });
  files.push({ name: 'docProps/app.xml', data: HDR +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>TH-GUARD</Application></Properties>' });
  files.push({ name: 'xl/workbook.xml', data: HDR + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
    sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>' +
    definedNames(sheets) + '</workbook>' });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: HDR + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>` });
  files.push({ name: 'xl/styles.xml', data: STYLES_XML });

  sheets.forEach((sh, i) => {
    const c = charts.find((x) => x.sheet === i + 1);
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sh, c ? 'rId1' : null) });
    if (c) {
      files.push({ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: HDR + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${REL}/drawing" Target="../drawings/drawing${c.n}.xml"/></Relationships>` });
      files.push({ name: `xl/drawings/drawing${c.n}.xml`, data: drawingXml(c.chart.anchor) });
      files.push({ name: `xl/drawings/_rels/drawing${c.n}.xml.rels`, data: HDR + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${REL}/chart" Target="../charts/chart${c.n}.xml"/></Relationships>` });
      files.push({ name: `xl/charts/chart${c.n}.xml`, data: chartXml(c.chart) });
    }
  });
  return zip(files);
}

module.exports = { buildWorkbook, colName, quoteSheet, crc32, zip, STYLE };
