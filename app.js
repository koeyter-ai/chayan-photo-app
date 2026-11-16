/* 查驗照片上傳 App 主程式 */
(function () {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;
  var MAX_EDGE = 1600;      // 照片長邊縮到 1600px，省雲端容量
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 本機設定 ---------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('cy_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('cy_' + k, JSON.stringify(v)); } catch (e) { } }
  };

  /* ---------- IndexedDB：待上傳照片 ---------- */
  var dbp = new Promise(function (res, rej) {
    var r = indexedDB.open('chayan', 1);
    r.onupgradeneeded = function () {
      r.result.createObjectStore('photos', { keyPath: 'id' });
      r.result.createObjectStore('mock', { keyPath: 'id' });
    };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
  function idb(name, mode, fn) {
    return dbp.then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(name, mode), out = fn(tx.objectStore(name));
        tx.oncomplete = function () { res(out && out.result); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  var photosDb = {
    all: function () { return idb('photos', 'readonly', function (s) { return s.getAll(); }); },
    put: function (p) { return idb('photos', 'readwrite', function (s) { return s.put(p); }); },
    del: function (id) { return idb('photos', 'readwrite', function (s) { return s.delete(id); }); }
  };

  /* ---------- 小工具 ---------- */
  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.style.display = 'block';
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.style.display = 'none'; }, 3500);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function defaultFolderName(d) { d = d || new Date(); return pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()); }
  function rocDate(d) { d = d || new Date(); return (d.getFullYear() - 1911) + '年' + pad(d.getMonth() + 1) + '月' + pad(d.getDate()) + '日'; }
  function stamp(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()); }
  function b64FromBytes(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  function bytesFromB64(b64) {
    var s = atob(b64), a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }
  function blobBytes(blob) { return blob.arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  function busy(btn, on, text) {
    if (on) { btn.dataset.t = btn.textContent; btn.textContent = text || '處理中…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.t || btn.textContent; btn.disabled = false; }
  }
  function loadImage(blob) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('照片讀取失敗')); };
      img.src = url;
    });
  }
  /** 轉成 JPEG 並縮小，回傳 {blob,w,h} */
  function shrink(file) {
    return loadImage(file).then(function (img) {
      var k = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      return new Promise(function (res, rej) {
        c.toBlob(function (b) { b ? res({ blob: b, w: w, h: h }) : rej(new Error('照片轉檔失敗')); }, 'image/jpeg', 0.82);
      });
    });
  }

  /* ---------- 雲端 API（網址填 demo 可離線試用） ---------- */
  function isDemo() { return store.get('url', '') === 'demo'; }
  function api(action, data) {
    var url = store.get('url', '');
    if (!url) return Promise.reject(new Error('請先到右上角「設定」填入雲端服務網址'));
    if (url === 'demo') return mockApi(action, data || {});
    var body = Object.assign({ action: action, key: store.get('key', '') }, data || {});
    // 不設 Content-Type（瀏覽器會用 text/plain），避免 Apps Script 不支援的 CORS 預檢
    return fetch(url, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('雲端回應錯誤 ' + r.status); return r.json(); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || '雲端發生錯誤'); return j.data; });
  }
  function mockApi(action, d) {
    var all = function () { return idb('mock', 'readonly', function (s) { return s.getAll(); }); };
    var put = function (o) { return idb('mock', 'readwrite', function (s) { return s.put(o); }).then(function () { return o; }); };
    switch (action) {
      case 'ping': return Promise.resolve('ok');
      case 'listFolders': return all().then(function (a) { return a.filter(function (x) { return x.type === 'folder'; }).sort(function (x, y) { return y.created - x.created; }); });
      case 'createFolder': return all().then(function (a) {
        var f = a.find(function (x) { return x.type === 'folder' && x.name === d.name; });
        return f || put({ id: 'f' + Date.now(), type: 'folder', name: d.name, created: Date.now() });
      });
      case 'renameFolder': return all().then(function (a) {
        var f = a.find(function (x) { return x.id === d.folderId; }); f.name = d.name; return put(f);
      });
      case 'upload': return all().then(function (a) {
        var old = a.find(function (x) { return x.type === 'file' && x.folderId === d.folderId && x.name === d.name; });
        if (old && !d.overwrite) return { id: old.id, name: d.name, skipped: true };
        return put({ id: old ? old.id : 'p' + Date.now() + Math.random(), type: 'file', folderId: d.folderId, name: d.name, mime: d.mime, data: d.data });
      });
      case 'listPhotos': return all().then(function (a) {
        return a.filter(function (x) { return x.type === 'file' && x.folderId === d.folderId && /^image\//.test(x.mime); })
          .sort(function (x, y) { return x.name < y.name ? -1 : 1; }).map(function (x) { return { id: x.id, name: x.name }; });
      });
      case 'getPhoto': return all().then(function (a) { return a.find(function (x) { return x.id === d.fileId; }); });
    }
    return Promise.reject(new Error('未知動作'));
  }

  /* ---------- 狀態 ---------- */
  var folders = [];
  function current() { return store.get('folder', null); }
  function setCurrent(f) { store.set('folder', f ? { id: f.id, name: f.name } : null); refreshHeader(); }

  function refreshHeader() {
    var f = current(), c = store.get('consent', null);
    $('st1').textContent = f ? f.name : '';
    $('st2').textContent = c ? '已開啟' : '未開啟';
    $('st3').textContent = f ? '→ ' + f.name : '未選擇';
    $('genFolder').textContent = f ? f.name : '（尚未選擇）';
    $('renameBox').hidden = !f;
    if (f && document.activeElement !== $('renameName')) $('renameName').value = f.name;
    $('btnConsent').hidden = !!c; $('btnRevoke').hidden = !c;
    $('consentInfo').textContent = c ? '已於 ' + new Date(c.at).toLocaleString('zh-TW') + ' 同意並開啟。' : '尚未開啟：照片只會暫存在手機，不會自動上傳。';
    $('consentInfo').className = 'hint ' + (c ? 'ok' : 'warn');
  }

  function renderFolders() {
    var sel = $('folderSelect'), cur = current();
    sel.innerHTML = '';
    if (!folders.length) sel.add(new Option('（雲端還沒有資料夾，請先做第 1 步）', ''));
    folders.forEach(function (f) { sel.add(new Option(f.name, f.id)); });
    if (cur && folders.some(function (f) { return f.id === cur.id; })) sel.value = cur.id;
    else if (folders.length) setCurrent(folders[0]);
  }
  function loadFolders(quiet) {
    return api('listFolders').then(function (list) { folders = list; renderFolders(); })
      .catch(function (e) { if (!quiet) toast(e.message); });
  }

  /* ---------- 展開/收合 ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('.step-btn'), function (b) {
    b.addEventListener('click', function () {
      var sec = $(b.dataset.step), open = sec.classList.contains('open');
      Array.prototype.forEach.call(document.querySelectorAll('.step'), function (s) { s.classList.remove('open'); });
      if (!open) {
        sec.classList.add('open');
        if (b.dataset.step === 's1') $('folderName').placeholder = defaultFolderName();
        if (b.dataset.step === 's3') { loadFolders(true); renderQueue(); }
      }
    });
  });

  /* ---------- 第 1 步：資料夾 ---------- */
  $('btnCreate').addEventListener('click', function () {
    var btn = this, name = $('folderName').value.trim() || defaultFolderName();
    busy(btn, true, '建立中…');
    api('createFolder', { name: name }).then(function (f) {
      setCurrent(f); $('folderName').value = '';
      toast('已建立資料夾「' + f.name + '」');
      return loadFolders(true);
    }).catch(function (e) { toast(e.message); }).then(function () { busy(btn, false); });
  });
  $('btnRename').addEventListener('click', function () {
    var btn = this, f = current(), name = $('renameName').value.trim();
    if (!f || !name) return toast('請輸入新名稱');
    busy(btn, true, '儲存中…');
    api('renameFolder', { folderId: f.id, name: name }).then(function (nf) {
      setCurrent(nf);
      // 還沒上傳的照片也跟著改顯示名稱
      return photosDb.all().then(function (list) {
        return Promise.all(list.filter(function (p) { return p.folderId === nf.id; }).map(function (p) { p.folderName = nf.name; return photosDb.put(p); }));
      }).then(function () { toast('已改名為「' + nf.name + '」'); return loadFolders(true); });
    }).catch(function (e) { toast(e.message); }).then(function () { busy(btn, false); });
  });

  /* ---------- 第 2 步：權限 ---------- */
  $('btnConsent').addEventListener('click', function () {
    var done = function () {
      store.set('consent', { at: Date.now() });
      refreshHeader(); toast('已開啟自動上傳（拍照滿 24 小時後上傳）'); autoUpload();
    };
    // 要求瀏覽器「不要自動清掉」暫存的照片
    var persist = function () {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(done, done); else done();
    };
    // 這時跳出系統的相機權限詢問，之後按「拍照」就能直接開鏡頭
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        .then(function (s) { s.getTracks().forEach(function (t) { t.stop(); }); persist(); },
          function () { toast('相機權限未允許，拍照時會改用系統相機或相簿'); persist(); });
    } else persist();
  });
  $('btnRevoke').addEventListener('click', function () {
    if (!confirm('確定要關閉自動上傳嗎？已暫存的照片會留在手機裡。')) return;
    store.set('consent', null); refreshHeader();
  });

  /* ---------- 第 3 步：拍照、待上傳清單 ---------- */
  $('folderSelect').addEventListener('change', function () {
    var id = this.value, f = folders.find(function (x) { return x.id === id; });
    if (f) setCurrent(f);
  });
  $('btnReload').addEventListener('click', function () { loadFolders().then(function () { toast('資料夾清單已更新'); }); });
  $('btnCam').addEventListener('click', function () { if (needFolder()) openCamera(); });

  /* App 內建相機：直接開鏡頭，不經過系統的檔案選擇畫面 */
  var camStream = null, camCount = 0;
  function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return $('camInput').click();
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    }).then(function (stream) {
      camStream = stream; camCount = 0;
      $('camVideo').srcObject = stream;
      $('camInfo').textContent = '→ ' + current().name;
      $('cam').hidden = false;
      return $('camVideo').play();
    }).catch(function (e) {
      closeCamera();
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
        toast('相機權限被拒絕，請到瀏覽器的網站設定允許「相機」');
      } else {
        toast('無法直接開啟相機，改用系統相機');
        $('camInput').click();
      }
    });
  }
  function closeCamera() {
    if (camStream) camStream.getTracks().forEach(function (t) { t.stop(); });
    camStream = null; $('camVideo').srcObject = null; $('cam').hidden = true;
    renderQueue();
  }
  $('camClose').addEventListener('click', closeCamera);
  $('camShot').addEventListener('click', function () {
    var v = $('camVideo');
    if (!v.videoWidth) return;
    var c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    v.style.opacity = '.3'; setTimeout(function () { v.style.opacity = '1'; }, 120);
    c.toBlob(function (b) {
      if (!b) return toast('拍照失敗，請再試一次');
      addBlobs([b], true).then(function () { camCount++; $('camInfo').textContent = '已拍 ' + camCount + ' 張 → ' + current().name; });
    }, 'image/jpeg', 0.92);
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && camStream) closeCamera(); });
  $('btnPick').addEventListener('click', function () { if (needFolder()) $('pickInput').click(); });
  function needFolder() {
    if (current()) return true;
    toast('請先選擇（或建立）要上傳的資料夾'); return false;
  }
  function addFiles(input) {
    var files = Array.prototype.slice.call(input.files || []);
    input.value = '';
    return addBlobs(files, false);
  }
  function addBlobs(files, quiet) {
    var f = current(), seq = Promise.resolve(), n = 0;
    files.forEach(function (file, i) {
      seq = seq.then(function () { return shrink(file); }).then(function (r) {
        var now = new Date();
        n++;
        return photosDb.put({
          id: now.getTime() + '_' + i, name: stamp(now) + '_' + ('00' + now.getMilliseconds()).slice(-3) + pad(i + 1) + '.jpg',
          blob: r.blob, w: r.w, h: r.h, takenAt: now.getTime(), folderId: f.id, folderName: f.name
        });
      }).catch(function (e) { toast(e.message); });
    });
    return seq.then(function () {
      if (quiet) return;
      if (n) toast('已暫存 ' + n + ' 張，24 小時後上傳到「' + f.name + '」');
      renderQueue();
    });
  }
  $('camInput').addEventListener('change', function () { addFiles(this); });
  $('pickInput').addEventListener('change', function () { addFiles(this); });

  var thumbUrls = [];
  function renderQueue() {
    return photosDb.all().then(function (list) {
      list.sort(function (a, b) { return a.takenAt - b.takenAt; });
      thumbUrls.forEach(function (u) { URL.revokeObjectURL(u); }); thumbUrls = [];
      var box = $('queue'); box.innerHTML = '';
      $('queueInfo').textContent = list.length ? '手機暫存中：' + list.length + ' 張（滿 24 小時自動上傳，之前可刪除）' : '目前沒有待上傳的照片。';
      $('btnUploadNow').hidden = !list.length;
      list.forEach(function (p) {
        var left = p.takenAt + DAY_MS - Date.now();
        var when = left <= 0 ? '已滿 24 小時，等待上傳' : '還有 ' + Math.floor(left / 3600000) + ' 小時 ' + Math.floor(left % 3600000 / 60000) + ' 分上傳';
        var row = document.createElement('div'); row.className = 'item';
        var img = document.createElement('img'), u = URL.createObjectURL(p.blob); thumbUrls.push(u); img.src = u; img.alt = '';
        var info = document.createElement('div'); info.className = 'info';
        var b = document.createElement('b'); b.textContent = '→ ' + p.folderName;
        var s = document.createElement('span'); s.textContent = new Date(p.takenAt).toLocaleString('zh-TW') + '｜' + when + (p.error ? '｜上次失敗：' + p.error : '');
        info.appendChild(b); info.appendChild(s);
        var del = document.createElement('button'); del.textContent = '刪除';
        del.addEventListener('click', function () {
          if (confirm('刪除這張照片？（不會上傳）')) photosDb.del(p.id).then(renderQueue);
        });
        row.appendChild(img); row.appendChild(info); row.appendChild(del); box.appendChild(row);
      });
      return list;
    });
  }

  var uploading = false;
  /** 上傳清單中的照片；force=false 只傳滿 24 小時的 */
  function uploadDue(force) {
    if (uploading) return Promise.resolve(0);
    uploading = true;
    var count = 0;
    return photosDb.all().then(function (list) {
      var due = list.filter(function (p) { return force || Date.now() - p.takenAt >= DAY_MS; });
      return due.reduce(function (seq, p) {
        return seq.then(function () { return blobBytes(p.blob); }).then(function (bytes) {
          return api('upload', { folderId: p.folderId, name: p.name, mime: 'image/jpeg', data: b64FromBytes(bytes) });
        }).then(function () { count++; return photosDb.del(p.id); })
          .catch(function (e) { p.error = e.message; return photosDb.put(p); });
      }, Promise.resolve());
    }).then(function () { uploading = false; renderQueue(); return count; },
      function (e) { uploading = false; throw e; });
  }
  function autoUpload() {
    if (!store.get('consent', null) || !store.get('url', '') || !navigator.onLine) return;
    uploadDue(false).then(function (n) { if (n) toast('已自動上傳 ' + n + ' 張滿 24 小時的照片'); }).catch(function () { });
  }
  $('btnUploadNow').addEventListener('click', function () {
    if (!confirm('不等 24 小時，現在就把暫存的照片全部上傳？')) return;
    var btn = this; busy(btn, true, '上傳中…');
    uploadDue(true).then(function (n) { toast('已上傳 ' + n + ' 張'); }).catch(function (e) { toast(e.message); }).then(function () { busy(btn, false); });
  });

  /* ---------- 第 4 步：生成查驗單 ---------- */
  var FIELDS = { fProject: 'project', fItem: 'item', fContractor: 'contractor', fDate: 'date', fFormNo: 'formNo', fCompany: 'company' };
  var DEFAULTS = { project: 'KL(二期)前置作業假設工程', item: '', contractor: '正鼎營造股份有限公司', date: '', formNo: '', company: '福華工程股份有限公司' };
  var genPhotos = [], genFolderId = null;

  function initForm() {
    var saved = store.get('form', {});
    Object.keys(FIELDS).forEach(function (id) {
      var k = FIELDS[id];
      $(id).value = k === 'date' ? rocDate() : (saved[k] != null ? saved[k] : DEFAULTS[k]);
      // 內容一改就要重新檢核
      $(id).addEventListener('input', function () { $('chkReviewed').checked = false; syncGen(); });
    });
  }
  function readForm() {
    var info = {};
    Object.keys(FIELDS).forEach(function (id) { info[FIELDS[id]] = $(id).value.trim(); });
    return info;
  }
  function syncGen() {
    var ready = isBatch() ? batchSelected().length : genPhotos.length;
    $('btnGenerate').disabled = !($('chkReviewed').checked && ready);
  }
  $('chkReviewed').addEventListener('change', function () {
    var info = readForm(), miss = [];
    if (isBatch()) {
      var sel = batchSelected();
      if (!info.project) miss.push('名稱');
      if (!info.contractor) miss.push('承包廠商');
      sel.forEach(function (f) {
        var st = batchRows[f.id];
        if (!st.item.trim()) miss.push('「' + f.name + '」的工程項目');
        if (!st.date.trim()) miss.push('「' + f.name + '」的查驗日期');
      });
      if (this.checked && !sel.length) { this.checked = false; toast('請先勾選要生成的資料夾'); }
      else if (this.checked && miss.length) { this.checked = false; toast('還沒填：' + miss.join('、')); }
      return syncGen();
    }
    if (!info.project) miss.push('名稱'); if (!info.item) miss.push('工程項目');
    if (!info.contractor) miss.push('承包廠商'); if (!info.date) miss.push('查驗日期');
    if (this.checked && miss.length) { this.checked = false; toast('還沒填：' + miss.join('、')); }
    if (this.checked && !genPhotos.length) toast('請先按「載入雲端資料夾的照片」');
    syncGen();
  });

  $('btnLoadPhotos').addEventListener('click', function () {
    var btn = this, f = current();
    if (!f) return toast('請先在第 3 步選擇資料夾');
    busy(btn, true, '載入中…');
    genPhotos = []; genFolderId = f.id; $('genList').innerHTML = ''; $('genResult').innerHTML = ''; syncGen();
    api('listPhotos', { folderId: f.id }).then(function (list) {
      if (!list.length) { $('genInfo').textContent = '「' + f.name + '」裡還沒有照片（照片要滿 24 小時上傳後才會出現）。'; return; }
      return list.reduce(function (seq, item, i) {
        return seq.then(function () {
          $('genInfo').textContent = '載入照片 ' + (i + 1) + ' / ' + list.length + ' …';
          return api('getPhoto', { folderId: f.id, fileId: item.id });
        }).then(function (r) {
          var bytes = bytesFromB64(r.data);
          return shrink(new Blob([bytes], { type: r.mime || 'image/jpeg' })).then(function (s) {
            return blobBytes(s.blob).then(function (data) {
              var p = { name: item.name, data: data, w: s.w, h: s.h, caption: '', blob: s.blob };
              genPhotos.push(p); addGenRow(p, genPhotos.length);
            });
          });
        });
      }, Promise.resolve()).then(function () {
        $('genInfo').textContent = '共 ' + genPhotos.length + ' 張照片，會排成 ' + Math.ceil(genPhotos.length / 2) + ' 頁（每頁 2 張）。可在下面填每張的說明。';
      });
    }).catch(function (e) { $('genInfo').textContent = ''; toast(e.message); }).then(function () { busy(btn, false); syncGen(); });
  });
  function addGenRow(p, n) {
    var row = document.createElement('div'); row.className = 'item';
    var img = document.createElement('img'); img.src = URL.createObjectURL(p.blob); img.alt = '';
    var info = document.createElement('div'); info.className = 'info';
    var b = document.createElement('b'); b.textContent = '第 ' + n + ' 張';
    var inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = '說明（可不填）';
    inp.addEventListener('input', function () { p.caption = inp.value; });
    info.appendChild(b); info.appendChild(inp); row.appendChild(img); row.appendChild(info);
    $('genList').appendChild(row);
  }

  function fetchTemplate(name) {
    return fetch('templates/' + name).then(function (r) { if (!r.ok) throw new Error('範本讀取失敗：' + name); return r.arrayBuffer(); });
  }
  $('btnGenerate').addEventListener('click', function () {
    var btn = this, f = current(), info = readForm();
    if (isBatch()) return runBatch(btn);
    if (!f || f.id !== genFolderId) return toast('資料夾已變更，請重新載入照片');
    if (typeof JSZip === 'undefined') return toast('元件尚未載入，請確認網路後重新開啟 App');
    store.set('form', info);
    busy(btn, true, '生成中…');
    var safe = f.name.replace(/[\\/:*?"<>|]/g, '');
    var files = [
      { name: '查驗相片_' + safe + '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { name: '工程查驗單_' + safe + '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    ];
    Promise.all([fetchTemplate('photo.docx'), fetchTemplate('form.xlsx')]).then(function (t) {
      return Promise.all([Generate.buildDocx(JSZip, t[0], info, genPhotos), Generate.buildXlsx(JSZip, t[1], info)]);
    }).then(function (out) {
      var box = $('genResult'); box.innerHTML = '';
      out.forEach(function (bytes, i) {
        files[i].bytes = bytes;
        var a = document.createElement('a'); a.className = 'btn light'; a.style.textAlign = 'center'; a.style.textDecoration = 'none';
        a.href = URL.createObjectURL(new Blob([bytes], { type: files[i].mime })); a.download = files[i].name;
        a.textContent = '下載 ' + files[i].name; box.appendChild(a);
      });
      var note = document.createElement('p'); note.className = 'hint'; note.textContent = '正在把查驗單存到雲端資料夾…'; box.appendChild(note);
      return files.reduce(function (seq, file) {
        return seq.then(function () {
          return api('upload', { folderId: f.id, name: file.name, mime: file.mime, data: b64FromBytes(file.bytes), overwrite: true });
        });
      }, Promise.resolve()).then(function () {
        note.textContent = '查驗單也已存到雲端資料夾「' + f.name + '」。'; note.className = 'hint ok';
      }, function (e) { note.textContent = '存到雲端失敗（' + e.message + '），但上面仍可下載。'; note.className = 'hint warn'; });
    }).then(function () { toast('查驗單已生成'); })
      .catch(function (e) { toast('生成失敗：' + e.message); })
      .then(function () { busy(btn, false); syncGen(); });
  });

  /* ---------- 批次生成：一次選多個資料夾 ---------- */
  var MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  var MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var batchRows = {}; // folderId -> { checked, item, date, formNo }
  function isBatch() { return $('chkBatch').checked; }
  function resetReview() { $('chkReviewed').checked = false; syncGen(); }
  function batchSelected() { return folders.filter(function (f) { return batchRows[f.id] && batchRows[f.id].checked; }); }
  function updateBatchInfo() {
    var n = batchSelected().length;
    $('batchInfo').textContent = n ? '已選 ' + n + ' 個資料夾。' : '尚未勾選資料夾。';
    $('btnGenerate').textContent = isBatch() ? '批次生成查驗單（' + n + ' 個資料夾）' : '生成查驗單（Word + Excel）';
  }
  function renderBatch() {
    var box = $('batchList'); box.innerHTML = '';
    if (!folders.length) box.textContent = '雲端還沒有資料夾，請先做第 1 步。';
    folders.forEach(function (f) {
      // 工程項目預設帶資料夾名稱、日期帶今天
      var st = batchRows[f.id] || (batchRows[f.id] = { checked: false, item: f.name, date: rocDate(), formNo: '' });
      var wrap = document.createElement('div'); wrap.className = 'brow';
      var lab = document.createElement('label'); lab.className = 'check'; lab.style.marginTop = '0';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = st.checked;
      var nm = document.createElement('span'); nm.textContent = f.name;
      lab.appendChild(cb); lab.appendChild(nm); wrap.appendChild(lab);
      var fields = document.createElement('div'); fields.className = 'fields'; fields.hidden = !st.checked;
      [['item', '工程項目'], ['date', '查驗日期'], ['formNo', '表單編號（可不填）']].forEach(function (d) {
        var l = document.createElement('label'); l.textContent = d[1];
        var inp = document.createElement('input'); inp.type = 'text'; inp.value = st[d[0]];
        inp.addEventListener('input', function () { st[d[0]] = inp.value; resetReview(); });
        l.appendChild(inp); fields.appendChild(l);
      });
      cb.addEventListener('change', function () { st.checked = cb.checked; fields.hidden = !cb.checked; updateBatchInfo(); resetReview(); });
      wrap.appendChild(fields); box.appendChild(wrap);
    });
    updateBatchInfo();
  }
  $('chkBatch').addEventListener('change', function () {
    $('s4').classList.toggle('batch', this.checked);
    $('genResult').innerHTML = ''; resetReview(); updateBatchInfo();
    if (this.checked) { renderBatch(); loadFolders(true).then(renderBatch); }
  });

  /** 從雲端抓某個資料夾的全部照片 */
  function fetchPhotos(f, progress) {
    return api('listPhotos', { folderId: f.id }).then(function (list) {
      var photos = [];
      return list.reduce(function (seq, item, i) {
        return seq.then(function () { progress(i + 1, list.length); return api('getPhoto', { folderId: f.id, fileId: item.id }); })
          .then(function (r) { return shrink(new Blob([bytesFromB64(r.data)], { type: r.mime || 'image/jpeg' })); })
          .then(function (s) { return blobBytes(s.blob).then(function (data) { photos.push({ data: data, w: s.w, h: s.h, caption: '' }); }); });
      }, Promise.resolve()).then(function () { return photos; });
    });
  }

  function runBatch(btn) {
    var sel = batchSelected(), shared = readForm(), done = [], failed = [];
    if (!sel.length) return toast('請先勾選要生成的資料夾');
    if (typeof JSZip === 'undefined') return toast('元件尚未載入，請確認網路後重新開啟 App');
    var zip = new JSZip();
    store.set('form', Object.assign(store.get('form', {}), { project: shared.project, contractor: shared.contractor, company: shared.company }));
    busy(btn, true, '批次生成中…');
    var box = $('genResult'); box.innerHTML = '';
    var note = document.createElement('p'); note.className = 'hint'; box.appendChild(note);
    Promise.all([fetchTemplate('photo.docx'), fetchTemplate('form.xlsx')]).then(function (t) {
      return sel.reduce(function (seq, f, idx) {
        return seq.then(function () {
          var st = batchRows[f.id], tag = '（' + (idx + 1) + '/' + sel.length + '）「' + f.name + '」';
          var info = { company: shared.company, project: shared.project, contractor: shared.contractor,
            item: st.item.trim(), date: st.date.trim(), formNo: st.formNo.trim() };
          note.textContent = tag + ' 讀取照片清單…';
          return fetchPhotos(f, function (i, n) { note.textContent = tag + ' 載入照片 ' + i + ' / ' + n; }).then(function (photos) {
            if (!photos.length) { failed.push(f.name + '：資料夾裡沒有照片，已略過'); return; }
            note.textContent = tag + ' 生成查驗單…';
            return Promise.all([Generate.buildDocx(JSZip, t[0], info, photos), Generate.buildXlsx(JSZip, t[1], info)]).then(function (out) {
              var safe = f.name.replace(/[\\/:*?"<>|]/g, '');
              var files = [{ name: '查驗相片_' + safe + '.docx', mime: MIME_DOCX, bytes: out[0] },
                { name: '工程查驗單_' + safe + '.xlsx', mime: MIME_XLSX, bytes: out[1] }];
              files.forEach(function (x) { zip.file(safe + '/' + x.name, x.bytes); });
              done.push(f.name + '（' + photos.length + ' 張）');
              note.textContent = tag + ' 存到雲端資料夾…';
              return files.reduce(function (s2, x) {
                return s2.then(function () {
                  return api('upload', { folderId: f.id, name: x.name, mime: x.mime, data: b64FromBytes(x.bytes), overwrite: true });
                });
              }, Promise.resolve()).catch(function (e) { failed.push(f.name + '：已生成，但存到雲端失敗（' + e.message + '），請用下方 zip 下載'); });
            });
          }).catch(function (e) { failed.push(f.name + '：' + e.message); });
        });
      }, Promise.resolve());
    }).then(function () {
      note.textContent = '完成 ' + done.length + ' 個資料夾' + (done.length ? '：' + done.join('、') : '') + '。';
      note.className = 'hint ' + (done.length ? 'ok' : 'warn');
      failed.forEach(function (m) { var p = document.createElement('p'); p.className = 'hint warn'; p.textContent = m; box.appendChild(p); });
      if (!done.length) return;
      return zip.generateAsync({ type: 'blob' }).then(function (blob) {
        var a = document.createElement('a'); a.className = 'btn light'; a.style.textAlign = 'center'; a.style.textDecoration = 'none';
        a.href = URL.createObjectURL(blob); a.download = '查驗單_批次_' + defaultFolderName() + '.zip';
        a.textContent = '下載全部（zip，' + done.length + ' 個資料夾）'; box.appendChild(a);
      });
    }).then(function () { toast('批次生成結束'); })
      .catch(function (e) { toast('批次生成失敗：' + e.message); })
      .then(function () { busy(btn, false); updateBatchInfo(); syncGen(); });
  }

  /* ---------- 設定 ---------- */
  $('btnSettings').addEventListener('click', function () {
    $('setUrl').value = store.get('url', ''); $('setKey').value = store.get('key', ''); $('setInfo').textContent = '';
    $('dlgSettings').showModal();
  });
  $('btnCloseSettings').addEventListener('click', function () { $('dlgSettings').close(); });
  $('btnSaveSettings').addEventListener('click', function () {
    var btn = this;
    store.set('url', $('setUrl').value.trim()); store.set('key', $('setKey').value);
    busy(btn, true, '測試連線中…');
    api('ping').then(function () {
      $('setInfo').textContent = isDemo() ? '試用模式：資料只存在這支手機，不會上傳雲端。' : '連線成功！'; $('setInfo').className = 'hint ok';
      loadFolders(true);
    }).catch(function (e) { $('setInfo').textContent = '連線失敗：' + e.message; $('setInfo').className = 'hint warn'; })
      .then(function () { busy(btn, false); });
  });

  /* ---------- 啟動 ---------- */
  initForm(); refreshHeader();
  $('folderName').placeholder = defaultFolderName();
  if (store.get('url', '')) loadFolders(true).then(autoUpload);
  else $('btnSettings').click();
  renderQueue();
  // App 開著時每 5 分鐘、以及回到前景或恢復網路時，檢查有沒有滿 24 小時的照片
  setInterval(function () { autoUpload(); if ($('s3').classList.contains('open')) renderQueue(); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) autoUpload(); });
  window.addEventListener('online', autoUpload);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () { });
})();
