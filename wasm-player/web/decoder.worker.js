/* Classic worker: no SharedArrayBuffer, no WebCodecs, no native video decoder. */
importScripts("./decoder.js");
let wasmPromise, m, generation = 0, target = -1;
function getModule() {
  if (!wasmPromise) wasmPromise = createDecoder({locateFile: name => new URL(name, self.location.href).href});
  return wasmPromise;
}
function check(code) {
  if (code < 0) throw new Error(m.UTF8ToString(m._decoder_error()) || "FFmpeg error");
  return code;
}
function takeFrame() {
  const r = check(m._decoder_next());
  if (!r) return null;
  const ptr = m._decoder_pixels(), len = m._decoder_size();
  return {pts: m._decoder_pts(), width: m._decoder_width(), height: m._decoder_height(),
    full: !!m._decoder_full(), bt709: !!m._decoder_bt709(),
    pixels: m.HEAPU8.slice(ptr, ptr + len).buffer};
}
self.onmessage = async ({data: msg}) => {
  try {
    if (msg.type === "open") {
      m = await getModule();
      generation = msg.generation;
      m._decoder_close();
      try { m.FS.unlink("/input.mp4"); } catch (_) {}
      m.FS.writeFile("/input.mp4", new Uint8Array(msg.buffer), {canOwn:true});
      check(m._decoder_open());
      target = -1;
      self.postMessage({type:"opened", generation, duration:m._decoder_duration()});
    } else if (msg.type === "seek") {
      generation = msg.generation;
      check(m._decoder_seek(msg.seconds));
      target = msg.seconds;
      self.postMessage({type:"seeked", generation});
    } else if (msg.type === "pull" && msg.generation === generation) {
      let frames = [], eof = false;
      // Bound work per message even if seeking from a distant keyframe.
      for (let i = 0; i < 16 && frames.length < msg.count; i++) {
        const f = takeFrame();
        if (!f) { eof = true; break; }
        if (target >= 0 && f.pts + 0.001 < target) continue;
        target = -1;
        frames.push(f);
      }
      self.postMessage({type:"frames", generation, frames, eof}, frames.map(f => f.pixels));
    }
  } catch (err) {
    self.postMessage({type:"error", generation:msg.generation, message:String(err.message || err)});
  }
};
