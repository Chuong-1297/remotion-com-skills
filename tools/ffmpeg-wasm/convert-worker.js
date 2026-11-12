/* Flow Studio: converts a browser recording to MP4 (H.264 + AAC) with FFmpeg compiled to WebAssembly.
 * Message in:  { id, data: ArrayBuffer, ext, crf, preset, audioKbps, duration }
 * Messages out: { id, type: 'progress', value } | { id, type: 'done', data: ArrayBuffer } | { id, type: 'error', message, log } */
self.importScripts('webm2mp4.js');
self.onmessage = async (e) => {
  const { id, data, ext, crf, preset, audioKbps, duration } = e.data;
  const log = [];
  try {
    const mod = await createWebm2Mp4({
      locateFile: (p) => new URL(p, self.location.href).href,
      print: (t) => log.push(t),
      printErr: (t) => {
        log.push(t);
        const m = /^progress=([\d.]+)/.exec(t);
        if (m && duration > 0) self.postMessage({ id, type: 'progress', value: Math.min(0.99, parseFloat(m[1]) / duration) });
      },
    });
    const input = '/input.' + (ext || 'webm');
    mod.FS.writeFile(input, new Uint8Array(data));
    let code = 0;
    try {
      code = mod.callMain([input, '/output.mp4', String(crf || 23), preset || 'veryfast', String(audioKbps || 128)]);
    } catch (err) {
      code = err && typeof err.status === 'number' ? err.status : 1;
    }
    if (code !== 0) throw new Error(log.filter((l) => !/^progress=/.test(l)).slice(-3).join(' ') || 'FFmpeg báo lỗi ' + code);
    const out = mod.FS.readFile('/output.mp4');
    const buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
    self.postMessage({ id, type: 'done', data: buf }, [buf]);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String((err && err.message) || err), log: log.slice(-20) });
  }
};
