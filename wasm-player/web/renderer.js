/* Packed 8-bit I420, including odd dimensions, BT.601/709 and full/limited range. */
export function makeRenderer(canvas) {
  const gl = canvas.getContext("webgl", {alpha:false, antialias:false});
  if (!gl) return make2D(canvas);
  const shader = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, "attribute vec2 p; varying vec2 uv; void main(){gl_Position=vec4(p,0.,1.);uv=vec2((p.x+1.)*.5,(1.-p.y)*.5);}");
  const fs = shader(gl.FRAGMENT_SHADER, [
    "precision mediump float; varying vec2 uv;",
    "uniform sampler2D ty,tu,tv; uniform vec2 yr; uniform float cs; uniform vec4 k;",
    "void main(){float y=(texture2D(ty,uv).r-yr.x)*yr.y;",
    "float u=(texture2D(tu,uv).r-0.5019608)*cs; float v=(texture2D(tv,uv).r-0.5019608)*cs;",
    "gl_FragColor=vec4(y+k.x*v,y-k.y*u-k.z*v,y+k.w*u,1.);}"
  ].join("\n"));
  const program = gl.createProgram();
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const p = gl.getAttribLocation(program,"p"); gl.enableVertexAttribArray(p);
  gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
  const textures = ["ty","tu","tv"].map((name,i) => {
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program,name),i); return t;
  });
  const yr = gl.getUniformLocation(program,"yr"), cs = gl.getUniformLocation(program,"cs"), k = gl.getUniformLocation(program,"k");
  let oldW=0, oldH=0;
  return {name:"WebGL YUV", draw(f) {
    const w=f.width,h=f.height,cw=Math.ceil(w/2),ch=Math.ceil(h/2),n=w*h,c=cw*ch;
    if (gl.isContextLost()) throw new Error("WebGL context lost; reload the page");
    if (w!==oldW || h!==oldH) {canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}
    const data=new Uint8Array(f.pixels);
    if(data.length!==n+2*c) throw new Error("Invalid I420 frame");
    const planes=[[w,h,data.subarray(0,n)],[cw,ch,data.subarray(n,n+c)],[cw,ch,data.subarray(n+c)]];
    planes.forEach(([pw,ph,bytes],i)=>{
      gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,textures[i]);
      if(w!==oldW||h!==oldH) gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,pw,ph,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,bytes);
      else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,pw,ph,gl.LUMINANCE,gl.UNSIGNED_BYTE,bytes);
    });
    oldW=w;oldH=h;
    gl.uniform2f(yr,f.full?0:16/255,f.full?1:255/219);
    gl.uniform1f(cs,f.full?1:255/224);
    gl.uniform4fv(k,f.bt709?[1.5748,.187324,.468124,1.8556]:[1.402,.344136,.714136,1.772]);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }};
}
function make2D(canvas) {
  const ctx=canvas.getContext("2d",{alpha:false});
  if(!ctx) throw new Error("No Canvas renderer");
  let image;
  return {name:"Canvas 2D CPU",draw(f){
    const w=f.width,h=f.height,cw=Math.ceil(w/2),ch=Math.ceil(h/2),n=w*h,c=cw*ch;
    if(!image||canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;image=ctx.createImageData(w,h);}
    const a=new Uint8Array(f.pixels),out=image.data;
    const k=f.bt709?[1.5748,.187324,.468124,1.8556]:[1.402,.344136,.714136,1.772];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x,j=(y>>1)*cw+(x>>1),l=(a[i]-(f.full?0:16))*(f.full?1:255/219);
      const u=(a[n+j]-128)*(f.full?1:255/224),v=(a[n+c+j]-128)*(f.full?1:255/224);
      out[4*i]=l+k[0]*v;out[4*i+1]=l-k[1]*u-k[2]*v;out[4*i+2]=l+k[3]*u;out[4*i+3]=255;
    }
    ctx.putImageData(image,0,0);
  }};
}
