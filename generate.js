/* 依範本產生「查驗相片黏貼表 .docx」與「工程查驗申請表 .xlsx」
 * 瀏覽器與 Node 都能用：Generate.buildDocx / Generate.buildXlsx
 * info = { company, project, item, contractor, date, formNo }
 * photos = [{ data: Uint8Array(JPEG), w, h, caption }]
 */
(function (rootObj) {
  'use strict';

  var EMU_CM = 360000;
  var MAX_W = 15.4 * EMU_CM; // 相片格可用寬度
  var MAX_H = 8.9 * EMU_CM;  // 相片格可用高度

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function rPr(sz, bold) {
    return '<w:rPr><w:rFonts w:ascii="標楷體" w:eastAsia="標楷體" w:hint="eastAsia"/>' + (bold ? '<w:b/>' : '') +
      '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr>';
  }

  function para(text, sz, opt) {
    opt = opt || {};
    var pPr = '<w:pPr>' + (opt.pageBreak ? '<w:pageBreakBefore/>' : '') + (opt.center ? '<w:jc w:val="center"/>' : '') + rPr(sz, opt.bold) + '</w:pPr>';
    var run = opt.raw || (text ? '<w:r>' + rPr(sz, opt.bold) + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>' : '');
    return '<w:p>' + pPr + run + '</w:p>';
  }

  var CELL_MAR = '<w:tblPrEx><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPrEx>';

  function cell(w, inner, extra) {
    return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + (extra || '') + '</w:tcPr>' + inner + '</w:tc>';
  }

  function drawing(n, cx, cy) {
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
      '<wp:docPr id="' + n + '" name="相片' + n + '"/>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + n + '" name="photo' + n + '.jpeg"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rIdPhoto' + n + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }

  function photoRows(photo, n, height, capHeight) {
    var raw = '';
    if (photo) {
      var scale = Math.min(MAX_W / photo.w, MAX_H / photo.h);
      raw = drawing(n, Math.round(photo.w * scale), Math.round(photo.h * scale));
    }
    var span = '<w:gridSpan w:val="2"/>';
    return '<w:tr>' + CELL_MAR + '<w:trPr><w:trHeight w:val="' + height + '"/></w:trPr>' +
      cell(9028, para('', 28, { center: true, raw: raw }), span + '<w:vAlign w:val="center"/>') + '</w:tr>' +
      '<w:tr>' + CELL_MAR + '<w:trPr><w:trHeight w:val="' + capHeight + '"/></w:trPr>' +
      cell(9028, para('說明： ' + ((photo && photo.caption) || ''), 28), span) + '</w:tr>';
  }

  function pageBlock(info, p1, p2, n, first) {
    var tblPr = '<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (k) {
        return '<w:' + k + ' w:val="single" w:sz="6" w:space="0" w:color="auto"/>';
      }).join('') +
      '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="28" w:type="dxa"/><w:right w:w="28" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="4423"/><w:gridCol w:w="4605"/></w:tblGrid>';
    return para(info.company, 40, { center: true, bold: true, pageBreak: !first }) +
      para(info.project, 40, { center: true, bold: true }) +
      para('查驗相片', 32, { center: true, bold: true }) +
      '<w:tbl>' + tblPr +
      '<w:tr>' + CELL_MAR + cell(4423, para('工程項目: ' + info.item, 28)) + cell(4605, para('查驗表單編號: ' + info.formNo, 28)) + '</w:tr>' +
      '<w:tr>' + CELL_MAR + cell(4423, para('承包廠商: ' + info.contractor, 28)) + cell(4605, para('查驗日期: ' + info.date, 28)) + '</w:tr>' +
      photoRows(p1, n, 5552, 407) + photoRows(p2, n + 1, 5197, 399) +
      '</w:tbl>';
  }

  function buildDocx(JSZip, templateBuf, info, photos) {
    return JSZip.loadAsync(templateBuf).then(function (zip) {
      return Promise.all([
        zip.file('word/document.xml').async('string'),
        zip.file('word/_rels/document.xml.rels').async('string'),
        zip.file('[Content_Types].xml').async('string')
      ]).then(function (parts) {
        var doc = parts[0], rels = parts[1], types = parts[2];
        var head = doc.slice(0, doc.indexOf('<w:body>') + 8);
        var sect = doc.slice(doc.lastIndexOf('<w:sectPr'), doc.indexOf('</w:body>'));
        var body = '', relAdd = '';
        var pages = Math.max(1, Math.ceil(photos.length / 2));
        for (var i = 0; i < pages; i++) {
          body += pageBlock(info, photos[i * 2], photos[i * 2 + 1], i * 2 + 1, i === 0);
        }
        photos.forEach(function (p, i) {
          var n = i + 1;
          zip.file('word/media/photo' + n + '.jpeg', p.data);
          relAdd += '<Relationship Id="rIdPhoto' + n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo' + n + '.jpeg"/>';
        });
        // 表格後面一定要有一個段落，設成最小字以免多出空白頁
        body += '<w:p><w:pPr><w:spacing w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>';
        zip.file('word/document.xml', head + body + sect + '</w:body></w:document>');
        zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>', relAdd + '</Relationships>'));
        if (types.indexOf('Extension="jpeg"') < 0) {
          zip.file('[Content_Types].xml', types.replace(/(<Types[^>]*>)/, '$1<Default Extension="jpeg" ContentType="image/jpeg"/>'));
        }
        return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
      });
    });
  }

  function setCell(xml, ref, text) {
    var re = new RegExp('<c r="' + ref + '"( s="\\d+")?[^>]*?(/>|>.*?</c>)');
    if (!re.test(xml)) throw new Error('Excel 範本找不到儲存格 ' + ref);
    return xml.replace(re, function (m, style) {
      return '<c r="' + ref + '"' + (style || '') + ' t="inlineStr"><is><t xml:space="preserve">' + esc(text) + '</t></is></c>';
    });
  }

  function buildXlsx(JSZip, templateBuf, info) {
    return JSZip.loadAsync(templateBuf).then(function (zip) {
      var path = 'xl/worksheets/sheet1.xml';
      return zip.file(path).async('string').then(function (xml) {
        xml = setCell(xml, 'A1', info.company);
        xml = setCell(xml, 'A2', info.project);
        xml = setCell(xml, 'B4', info.item);
        xml = setCell(xml, 'H4', info.formNo);
        xml = setCell(xml, 'B5', info.contractor);
        xml = setCell(xml, 'H5', info.date);
        zip.file(path, xml);
        return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
      });
    });
  }

  var api = { buildDocx: buildDocx, buildXlsx: buildXlsx };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else rootObj.Generate = api;
})(typeof self !== 'undefined' ? self : this);
