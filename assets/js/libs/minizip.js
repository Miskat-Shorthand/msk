
(function () {
  var EOCD_SIG = 0x06054b50;
  var CDH_SIG = 0x02014b50;
  var LFH_SIG = 0x04034b50;

  function findEOCD(view, len) {

    var maxBack = Math.min(len, 65557);
    for (var i = len - 22; i >= len - maxBack && i >= 0; i--) {
      if (view.getUint32(i, true) === EOCD_SIG) return i;
    }
    return -1;
  }

  function readEntries(buf) {
    var view = new DataView(buf);
    var len = buf.byteLength;
    var eocdOffset = findEOCD(view, len);
    if (eocdOffset === -1) throw new Error("minizip: not a valid zip (no End Of Central Directory record)");
    var totalEntries = view.getUint16(eocdOffset + 10, true);
    var cdOffset = view.getUint32(eocdOffset + 16, true);

    var entries = {};
    var offset = cdOffset;
    var dec = new TextDecoder("utf-8");
    for (var i = 0; i < totalEntries; i++) {
      if (view.getUint32(offset, true) !== CDH_SIG) break;
      var method = view.getUint16(offset + 10, true);
      var compressedSize = view.getUint32(offset + 20, true);
      var uncompressedSize = view.getUint32(offset + 24, true);
      var nameLen = view.getUint16(offset + 28, true);
      var extraLen = view.getUint16(offset + 30, true);
      var commentLen = view.getUint16(offset + 32, true);
      var localHeaderOffset = view.getUint32(offset + 42, true);
      var name = dec.decode(new Uint8Array(buf, offset + 46, nameLen));
      entries[name] = {
        method: method,
        compressedSize: compressedSize,
        uncompressedSize: uncompressedSize,
        localHeaderOffset: localHeaderOffset
      };
      offset += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  function localDataStart(buf, localHeaderOffset) {
    var view = new DataView(buf);
    if (view.getUint32(localHeaderOffset, true) !== LFH_SIG) throw new Error("minizip: corrupt local file header");
    var nameLen = view.getUint16(localHeaderOffset + 26, true);
    var extraLen = view.getUint16(localHeaderOffset + 28, true);
    return localHeaderOffset + 30 + nameLen + extraLen;
  }

  function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") {
      return Promise.reject(new Error("minizip: DecompressionStream not supported in this browser"));
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  function bytesToBase64(bytes) {
    var CHUNK = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    return btoa(parts.join(""));
  }

  function ZipFile(buf, entry) {
    this._buf = buf;
    this._entry = entry;
  }
  ZipFile.prototype._bytes = function () {
    var start = localDataStart(this._buf, this._entry.localHeaderOffset);
    var raw = new Uint8Array(this._buf, start, this._entry.compressedSize);
    if (this._entry.method === 0) return Promise.resolve(raw.slice());
    if (this._entry.method === 8) return inflateRaw(raw);
    return Promise.reject(new Error("minizip: unsupported compression method " + this._entry.method));
  };
  ZipFile.prototype.async = function (type) {
    return this._bytes().then(function (bytes) {
      if (type === "string") return new TextDecoder("utf-8").decode(bytes);
      if (type === "base64") return bytesToBase64(bytes);
      if (type === "uint8array" || type === "arraybuffer") return bytes;
      throw new Error("minizip: unsupported async() type " + type);
    });
  };

  function Zip(buf, entries) {
    this._buf = buf;
    this._entries = entries;
  }
  Zip.prototype.file = function (path) {
    var entry = this._entries[path];
    return entry ? new ZipFile(this._buf, entry) : null;
  };

  window.JSZip = {
    loadAsync: function (buf) {
      return new Promise(function (resolve, reject) {
        try { resolve(new Zip(buf, readEntries(buf))); }
        catch (e) { reject(e); }
      });
    }
  };
})();
