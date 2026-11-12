// A Whitted-style ray tracer, the kind 90s landscape renderers used:
// one camera ray per sample, hard shadow rays to every light, perfect mirror reflection,
// refraction through glass, fog over each ray segment, no bounce light.
// Antialiasing comes from accumulating jittered samples over many passes.
// three-mesh-bvh is used only to find which triangle a ray hits; everything else is here.
import * as THREE from 'three';
import { MeshBVH, MeshBVHUniformStruct, FloatVertexAttributeTexture, BVHShaderGLSL } from 'three-mesh-bvh';

const NM = 64, NS = 16, MAXP = 8;   // materials, analytic spheres, terrain-object patches
// The moon: a small sphere textured with NASA's LRO colour map, near side facing us, north up.
// Shared by the raster sky and the ray tracer so both draw the same moon.
export const MOON_R = 0.045;   // angular radius in radians (about 2.6 degrees across)
export const MOON_GLSL = `
  uniform sampler2D moonTex; uniform float hasMoon, moonLod;
  vec4 moonDisc(vec3 d, vec3 m){
    if (dot(d, m) < 0.) return vec4(0.);
    vec3 up = abs(m.y) > .99 ? vec3(0., 0., 1.) : vec3(0., 1., 0.);
    vec3 t1 = normalize(cross(m, up)), t2 = cross(t1, m);
    vec2 q = vec2(dot(d, t1), dot(d, t2)) / ${MOON_R.toFixed(4)};
    float r = length(q);
    if (r > 1.) return vec4(0.);
    vec3 sn = vec3(q, sqrt(max(0., 1. - r * r)));          // point on the visible hemisphere
    vec2 uv = vec2(.5 + atan(sn.x, sn.z) / 6.2831853, .5 + asin(clamp(sn.y, -1., 1.)) / 3.14159265);
    vec3 c = hasMoon > .5 ? textureLod(moonTex, uv, moonLod).rgb * 1.7 : vec3(1.);
    c *= .62 + .38 * sn.z;                                  // gentle limb darkening
    return vec4(c, smoothstep(1., .92, r));
  }
`;
export const KIND = { diffuse: 0, metal: 1, glass: 2, emissive: 3, checker: 4, leaf: 5, tile: 6 };

// ---------- texture -> per-vertex colour for the Poly Haven models ----------
const texCache = new Map();
const avgCache = new Map();
function texAverage(tex) {   // mean [r,g,b] in 0..1 of a texture, or null
  if (!tex || !tex.image) return null;
  if (avgCache.has(tex)) return avgCache.get(tex);
  let out = null;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(tex.image, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data; out = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { out[0] += d[i]; out[1] += d[i + 1]; out[2] += d[i + 2]; }
    out = out.map(v => v / (255 * 1024));
  } catch (e) { out = null; }
  avgCache.set(tex, out); return out;
}
function texSampler(tex) {
  if (texCache.has(tex)) return texCache.get(tex);
  let f = null;
  try {
    const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(tex.image, 0, 0, S, S);
    const d = g.getImageData(0, 0, S, S).data;
    const lin = v => Math.pow(v / 255, 2.2);
    f = (u, v, out) => {
      u -= Math.floor(u); v -= Math.floor(v);
      const i = (Math.min(S - 1, (v * S) | 0) * S + Math.min(S - 1, (u * S) | 0)) * 4;
      out[0] = lin(d[i]); out[1] = lin(d[i + 1]); out[2] = lin(d[i + 2]);
    };
  } catch (e) { f = null; }
  texCache.set(tex, f);
  return f;
}

function materialEntry(m, flat) {
  const e = baseEntry(m, flat);
  const out = m.userData.trace ? { ...e, ...m.userData.trace } : e;   // editor presets (metal, glass, checker) override
  if (flat && out.kind === KIND.glass) out.tx = [-1, -1, -1, 1];      // glass keeps its IOR in p.w, so its flat flag rides in tx.w
  return out;
}
function baseEntry(m, flat) {
  const b = m.userData.bryce || {};
  let kind = KIND.diffuse, refl = 0, spec = 0.05, shin = 4;
  if (m.isMeshBasicMaterial) kind = KIND.emissive;
  else if ((m.alphaTest > 0 || m.transparent) && m.map) kind = KIND.leaf;
  else if (m.isMeshStandardMaterial) {
    // scanned models: glTF packs roughness in G and metalness in B of one texture; use its average
    const arm = texAverage(m.roughnessMap || m.metalnessMap);
    const r = Math.max(0.05, m.roughness * (m.roughnessMap && arm ? arm[1] : 1));
    const mt = m.metalness * (m.metalnessMap && arm ? arm[2] : 1);
    refl = mt * (1 - r) * 0.85;
    spec = 0.04 + 0.6 * (1 - r) * (0.3 + mt);
    shin = Math.min(2000, Math.max(2, 2 / (r * r + 1e-4)));
  } else if (m.isMeshPhongMaterial) { spec = 0.25; shin = m.shininess; refl = 0.05; }
  return {
    col: m.color ? m.color.clone() : new THREE.Color(1, 1, 1), kind,
    p: [refl, spec, shin, flat ? 1 : 0],
    n1: [b.speckle || 0, b.speckleFreq || 0, b.grain || 0, b.grainFreq || 0],
    // a normal map can't be followed per-pixel here; fine procedural bump stands in for it
    n2: [b.bump || 0, b.bumpFreq || 0, b.strata || 0, b.strataFreq || 0],
    tx: [-1, -1, -1, 0],   // texture-array layers: colour, normal map, roughness/metal (filled in by build)
    mt: m.isMeshStandardMaterial ? m.metalness : 0,   // how much reflections take the surface colour, as in the raster view
  };
}

export function createTracer(noiseGLSL) {
  const bvhStruct = new MeshBVHUniformStruct();
  const nrmTex = new FloatVertexAttributeTexture(), colTex = new FloatVertexAttributeTexture(), uvTex = new FloatVertexAttributeTexture();
  const V4 = n => Array.from({ length: n }, () => new THREE.Vector4());
  const V3 = n => Array.from({ length: n }, () => new THREE.Vector3());
  const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); blank.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    depthTest: false, depthWrite: false,
    defines: { BVH_STACK_DEPTH: 64, NM, NS, MAXP },
    uniforms: {
      bvh: { value: bvhStruct }, nrmTex: { value: nrmTex }, colTex: { value: colTex }, uvTex: { value: uvTex }, leafTex: { value: blank },
      camWorld: { value: new THREE.Matrix4() }, invProj: { value: new THREE.Matrix4() }, res: { value: new THREE.Vector2() }, frame: { value: 0 },
      sunDir: { value: new THREE.Vector3() }, sunLight: { value: new THREE.Color() }, hemiSky: { value: new THREE.Color() }, hemiGround: { value: new THREE.Color() },
      lampPos: { value: V3(3) }, lampLight: { value: V3(3) }, lampTint: { value: V3(3) },
      sph: { value: V4(NS) }, sphMat: { value: new Array(NS).fill(0) }, nSph: { value: 0 },
      mCol: { value: V4(NM) }, mP: { value: V4(NM) }, mN1: { value: V4(NM) }, mN2: { value: V4(NM) }, mMt: { value: V4(NM) }, mTx: { value: Array.from({ length: NM }, () => new THREE.Vector4(-1, -1, -1, 0)) }, texArr: { value: null },
      fogCol: { value: new THREE.Color() }, fogDensity: { value: 0 },
      zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, skySun: { value: new THREE.Color() }, skySeed: { value: 0 },
      waterCol: { value: new THREE.Color() }, waterTint: { value: new THREE.Color() }, waterSeed: { value: 0 },
      checkA: { value: new THREE.Color('#c81e1e') }, checkB: { value: new THREE.Color('#f4f0e0') },
      floorMode: { value: 0 }, floorA: { value: new THREE.Color() }, floorB: { value: new THREE.Color() }, floorTile: { value: 20 }, poolDepth: { value: 6 }, skyClouds: { value: 1 },
      nHF: { value: 0 },
      hfN0: { value: blank }, hfC0: { value: blank }, hfM0: { value: blank }, hfGeo0: { value: new THREE.Vector4() }, hfInfo0: { value: new THREE.Vector4() },
      night: { value: 0 }, nCloud: { value: 0 }, moonTex: { value: blank }, hasMoon: { value: 0 }, moonLod: { value: 0 }, hasWater: { value: 1 }, waterY: { value: 0 },
      cPos: { value: V4(4) }, cPrm: { value: V4(4) }, cCol: { value: V3(4) },
      nPatch: { value: 0 }, patchN: { value: blank }, patchC: { value: blank }, patchM: { value: blank },
      pGeo: { value: V4(MAXP) }, pInfo: { value: V4(MAXP) },
      pInv: { value: Array.from({ length: MAXP }, () => new THREE.Matrix4()) }, pModel: { value: Array.from({ length: MAXP }, () => new THREE.Matrix4()) },
    },
    vertexShader: `void main(){ gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: /* glsl */`
      ${BVHShaderGLSL.common_functions}
      ${BVHShaderGLSL.bvh_struct_definitions}
      ${BVHShaderGLSL.bvh_ray_functions}
      #define PI 3.14159265

      uniform BVH bvh;
      uniform float hasWater, waterY;
      uniform sampler2D nrmTex, colTex, uvTex, leafTex;
      uniform mat4 camWorld, invProj;
      uniform vec2 res; uniform float frame;
      uniform vec3 sunDir, sunLight, hemiSky, hemiGround;
      uniform vec3 lampPos[3], lampLight[3], lampTint[3];
      uniform vec4 sph[NS]; uniform int sphMat[NS]; uniform int nSph;
      uniform vec4 mCol[NM], mP[NM], mN1[NM], mN2[NM], mMt[NM], mTx[NM];
      uniform highp sampler2DArray texArr;   // model textures, one 512x512 layer each (sRGB-encoded colour, linear data)
      uniform vec3 fogCol; uniform float fogDensity;
      uniform vec3 zenith, horizon, skySun; uniform float skySeed, night, skyClouds;
      // cloud layers: cPos (height, origin x, origin z, seed), cPrm (coverage, softness, opacity, size), cCol (colour x light)
      uniform int nCloud; uniform vec4 cPos[4], cPrm[4]; uniform vec3 cCol[4];
      uniform vec3 waterCol, waterTint; uniform float waterSeed;
      uniform vec3 checkA, checkB;
      uniform float floorMode, floorTile, poolDepth; uniform vec3 floorA, floorB;   // infinite floor instead of water: 1 checker, 2 tiles (A tile, B grout), 3 mirror (A tint)

      ${noiseGLSL}

      // 2D noise shared with the raster sky and water shaders, so both renderers match
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h2(i),h2(i+vec2(1,0)),f.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x), f.y); }
      float fbmSky(vec2 p){ float s=0., a=.5; for(int i=0;i<6;i++){ s+=a*n2(p); p*=2.1; a*=.5; } return s; }
      float fbmW(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n2(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }

      float sh3(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      ${MOON_GLSL}
      vec3 skyColor(vec3 d){
        float y = max(d.y, 0.);
        vec3 col = mix(horizon, zenith, pow(y, .45));
        float s = max(dot(d, sunDir), 0.);
        col += skySun * (pow(s, 6.)*.35 + pow(s, 60.)*.6) * (1. - .8 * night);
        if (d.y > 0. && night > 0.) {
          vec3 cell = floor(d * 420.);
          col += step(.9975, sh3(cell)) * (.35 + .65 * sh3(cell + 7.)) * smoothstep(0., .2, d.y) * night;
        }
        if (night > 0.) { vec4 mo = moonDisc(d, sunDir); col = mix(col, mo.rgb * skySun, mo.a); }   // behind the clouds
        if (d.y > 0.) {
          vec2 p = d.xz / (d.y + .05) * 1.4 + skySeed;
          float c = smoothstep(.48, .8, fbmSky(p)) * skyClouds;
          vec3 cc = mix(horizon*1.05, vec3(1.), .5 + .5*s) * mix(1., .12, night);
          col = mix(col, cc, c * smoothstep(0., .25, d.y) * .9);
        }
        if (night < .5) col += skySun * smoothstep(.9993, .9996, s) * 3.;
        return col;
      }

      // cloud layer i at world point p: returns opacity, writes its colour
      float cloudAt(int i, vec2 xz, out vec3 c){
        float n = fbmSky((xz - cPos[i].yz) / (cPrm[i].w * 400.) + cPos[i].w);
        c = cCol[i] * (.55 + .45 * smoothstep(.3, .9, n));
        return smoothstep(1. - cPrm[i].x - cPrm[i].y * .5, 1. - cPrm[i].x + cPrm[i].y * .5, n) * cPrm[i].z;
      }
      // composite every layer the ray crosses before tEnd, nearest first
      void cloudsAlong(vec3 ro, vec3 rd, float tEnd, inout vec3 col, inout vec3 thr){
        if (nCloud == 0 || abs(rd.y) < 1e-5) return;
        float ts[4]; int ix[4]; int n = 0;
        for (int i = 0; i < 4; i++) {
          if (i >= nCloud) break;
          float t = (cPos[i].x - ro.y) / rd.y;
          if (t > 1e-3 && t < tEnd && t < 20000.) { ts[n] = t; ix[n] = i; n++; }
        }
        for (int a = 0; a < 4; a++) for (int b = 0; b < 3; b++)
          if (b + 1 < n && ts[b + 1] < ts[b]) { float tt = ts[b]; ts[b] = ts[b + 1]; ts[b + 1] = tt; int ii = ix[b]; ix[b] = ix[b + 1]; ix[b + 1] = ii; }
        for (int k = 0; k < 4; k++) {
          if (k >= n) break;
          vec3 c; float a = cloudAt(ix[k], (ro + rd * ts[k]).xz, c);
          float ff = 1. - exp(-fogDensity * fogDensity * ts[k] * ts[k] * .25);
          a *= 1. - ff * .6;
          col += thr * a * mix(c, fogCol, ff); thr *= 1. - a;
        }
      }
      // how much sunlight gets through the cloud layers above a point
      float cloudShadow(vec3 p, vec3 L){
        float T = 1.;
        if (L.y <= 0.) return T;
        for (int i = 0; i < 4; i++) {
          if (i >= nCloud) break;
          float t = (cPos[i].x - p.y) / L.y;
          if (t > 0.) { vec3 c; T *= 1. - cloudAt(i, (p + L * t).xz, c); }
        }
        return T;
      }

      uint rs;
      float rnd(){ rs = rs * 747796405u + 2891336453u; uint w = ((rs >> ((rs >> 28u) + 4u)) ^ rs) * 277803737u; w = (w >> 22u) ^ w; return float(w) / 4294967295.; }

      struct Hit { float t; vec3 p; vec3 sp; vec3 n; vec3 gn; vec3 col; vec2 uv; vec4 tg; int mat; int obj; };   // sp: shadow-ray origin   // obj: 0 mesh, 1 sphere, 2 water

      // ---------- height grids (terrain, island) ----------
      // hfN: per vertex (normal.xyz, height)   hfC: per vertex colour   hfM: max height per 8x8 block
      // hfGeo: (origin x, origin z, cell size, verts per side)   hfInfo: (min y, max y, material, blocks per side)
      uniform int nHF;
      uniform sampler2D hfN0, hfC0, hfM0;
      uniform vec4 hfGeo0, hfInfo0;
      // terrain objects: grids packed side by side in atlases, each with its own transform
      uniform int nPatch;
      uniform sampler2D patchN, patchC, patchM;
      uniform vec4 pGeo[MAXP], pInfo[MAXP];
      uniform mat4 pInv[MAXP], pModel[MAXP];
      #define HFB 8

      // off.x: column offset of this grid in the vertex atlases, off.y: in the block-max atlas
      vec3 hfP(sampler2D nT, vec4 geo, ivec2 v, ivec2 off){ return vec3(geo.x + float(v.x) * geo.z, texelFetch(nT, v + ivec2(off.x, 0), 0).w, geo.y + float(v.y) * geo.z); }

      bool triMT(vec3 ro, vec3 rd, vec3 a, vec3 b, vec3 c, inout float t, out vec2 uv){
        vec3 e1 = b - a, e2 = c - a, pv = cross(rd, e2); float det = dot(e1, pv);
        uv = vec2(0.);
        if (abs(det) < 1e-12) return false;
        float inv = 1. / det; vec3 tv = ro - a; float u = dot(tv, pv) * inv;
        if (u < -1e-5 || u > 1.00001) return false;
        vec3 qv = cross(tv, e1); float v = dot(rd, qv) * inv;
        if (v < -1e-5 || u + v > 1.00001) return false;
        float tt = dot(e2, qv) * inv;
        if (tt <= 1e-4 || tt >= t) return false;
        t = tt; uv = vec2(u, v); return true;
      }

      // the two triangles of grid cell c, split the same way as three's PlaneGeometry
      bool hfCell(sampler2D nT, vec4 geo, ivec2 off, ivec2 c, vec3 ro, vec3 rd, inout float t, out ivec2 v0, out ivec2 v1, out ivec2 v2, out vec3 bc){
        ivec2 a = c, b = c + ivec2(0, 1), cc = c + ivec2(1, 1), d = c + ivec2(1, 0);
        vec3 pa = hfP(nT, geo, a, off), pb = hfP(nT, geo, b, off), pc = hfP(nT, geo, cc, off), pd = hfP(nT, geo, d, off);
        vec2 uv; bool hit = false;
        if (triMT(ro, rd, pa, pb, pd, t, uv)) { v0 = a; v1 = b; v2 = d; bc = vec3(1. - uv.x - uv.y, uv); hit = true; }
        if (triMT(ro, rd, pb, pc, pd, t, uv)) { v0 = b; v1 = cc; v2 = d; bc = vec3(1. - uv.x - uv.y, uv); hit = true; }
        return hit;
      }

      bool hfTrace(sampler2D nT, sampler2D mT, vec4 geo, vec4 info, ivec2 off, vec3 ro, vec3 rd, inout float tHit, out ivec2 v0, out ivec2 v1, out ivec2 v2, out vec3 bc){
        float cell = geo.z; int N = int(geo.w + .5), C = int(info.w + .5);
        float size = cell * float(N - 1);
        vec3 sd = vec3(abs(rd.x) < 1e-8 ? 1e-8 : rd.x, abs(rd.y) < 1e-8 ? 1e-8 : rd.y, abs(rd.z) < 1e-8 ? 1e-8 : rd.z);
        vec3 inv = 1. / sd;
        vec3 ta = (vec3(geo.x, info.x, geo.y) - ro) * inv, tb = (vec3(geo.x + size, info.y, geo.y + size) - ro) * inv;
        vec3 tlo = min(ta, tb), thi = max(ta, tb);
        float tA = max(max(tlo.x, tlo.y), max(tlo.z, 0.)), tB = min(min(thi.x, thi.y), min(thi.z, tHit));
        if (tA >= tB) return false;

        vec2 dir = sd.xz; ivec2 st = ivec2(dir.x >= 0. ? 1 : -1, dir.y >= 0. ? 1 : -1);
        float bs = cell * float(HFB);
        ivec2 ci = clamp(ivec2(floor((ro.xz + rd.xz * tA - geo.xy) / bs)), ivec2(0), ivec2(C - 1));
        vec2 nextB = (vec2(ci + max(st, ivec2(0))) * bs + geo.xy - ro.xz) / dir, dB = abs(bs / dir);
        float tEnter = tA;
        for (int k = 0; k < 256; k++) {
          float tExit = min(min(nextB.x, nextB.y), tB);
          // skip the whole 8x8 block if the ray stays above its highest point
          if (min(ro.y + rd.y * tEnter, ro.y + rd.y * tExit) <= texelFetch(mT, ci + ivec2(off.y, 0), 0).r) {
            ivec2 lo = ci * HFB, hi = min(lo + (HFB - 1), ivec2(N - 2));
            ivec2 fc = clamp(ivec2(floor((ro.xz + rd.xz * (tEnter + 1e-4) - geo.xy) / cell)), lo, hi);
            vec2 nextF = (vec2(fc + max(st, ivec2(0))) * cell + geo.xy - ro.xz) / dir, dF = abs(cell / dir);
            for (int j = 0; j < 2 * HFB + 2; j++) {
              if (hfCell(nT, geo, off, fc, ro, rd, tHit, v0, v1, v2, bc)) return true;
              if (min(nextF.x, nextF.y) > tExit + 1e-3) break;
              if (nextF.x < nextF.y) { fc.x += st.x; nextF.x += dF.x; } else { fc.y += st.y; nextF.y += dF.y; }
              if (any(lessThan(fc, lo)) || any(greaterThan(fc, hi))) break;
            }
          }
          if (tExit >= tB) break;
          tEnter = tExit;
          if (nextB.x < nextB.y) { ci.x += st.x; nextB.x += dB.x; } else { ci.y += st.y; nextB.y += dB.y; }
          if (any(lessThan(ci, ivec2(0))) || any(greaterThan(ci, ivec2(C - 1)))) break;
        }
        return false;
      }

      void hfFill(sampler2D nT, sampler2D cT, vec4 geo, vec4 info, ivec2 v0, ivec2 v1, ivec2 v2, vec3 bc, vec3 ro, vec3 rd, inout Hit h){
        h.obj = 0; h.p = ro + rd * h.t; h.mat = int(info.z + .5); h.uv = vec2(0.);
        vec3 p0 = hfP(nT, geo, v0, ivec2(0)), p1 = hfP(nT, geo, v1, ivec2(0)), p2 = hfP(nT, geo, v2, ivec2(0));
        vec3 n0 = texelFetch(nT, v0, 0).xyz, n1 = texelFetch(nT, v1, 0).xyz, n2 = texelFetch(nT, v2, 0).xyz;
        h.n = normalize(bc.x * n0 + bc.y * n1 + bc.z * n2);
        h.gn = normalize(cross(p1 - p0, p2 - p0));
        if (dot(h.gn, h.n) < 0.) h.gn = -h.gn;
        h.col = bc.x * texelFetch(cT, v0, 0).rgb + bc.y * texelFetch(cT, v1, 0).rgb + bc.z * texelFetch(cT, v2, 0).rgb;
        h.sp = h.p - bc.x * min(0., dot(h.p - p0, n0)) * n0 - bc.y * min(0., dot(h.p - p1, n1)) * n1 - bc.z * min(0., dot(h.p - p2, n2)) * n2;
      }

      // a hit on terrain object i: the grid was walked in its local space; bring the surface back to world space
      void patchFill(int i, ivec2 off, ivec2 v0, ivec2 v1, ivec2 v2, vec3 bc, vec3 ro, vec3 rd, inout Hit h){
        vec4 geo = pGeo[i];
        h.obj = 0; h.p = ro + rd * h.t; h.mat = int(pInfo[i].z + .5); h.uv = vec2(0.);
        vec3 p0 = hfP(patchN, geo, v0, off), p1 = hfP(patchN, geo, v1, off), p2 = hfP(patchN, geo, v2, off);
        ivec2 o = ivec2(off.x, 0);
        vec3 n0 = texelFetch(patchN, v0 + o, 0).xyz, n1 = texelFetch(patchN, v1 + o, 0).xyz, n2 = texelFetch(patchN, v2 + o, 0).xyz;
        mat3 nm = transpose(mat3(pInv[i]));
        h.n = normalize(nm * (bc.x * n0 + bc.y * n1 + bc.z * n2));
        h.gn = normalize(nm * cross(p1 - p0, p2 - p0));
        if (dot(h.gn, h.n) < 0.) h.gn = -h.gn;
        h.col = bc.x * texelFetch(patchC, v0 + o, 0).rgb + bc.y * texelFetch(patchC, v1 + o, 0).rgb + bc.z * texelFetch(patchC, v2 + o, 0).rgb;
        vec3 pl = (pInv[i] * vec4(h.p, 1.)).xyz;
        pl -= bc.x * min(0., dot(pl - p0, n0)) * n0 + bc.y * min(0., dot(pl - p1, n1)) * n1 + bc.z * min(0., dot(pl - p2, n2)) * n2;
        h.sp = (pModel[i] * vec4(pl, 1.)).xyz;
      }

      bool traceOnce(vec3 ro, vec3 rd, float tmax, bool water, out Hit h){
        h.t = tmax; h.obj = -1; h.mat = 0; h.col = vec3(1.); h.uv = vec2(0.);
        for (int i = 0; i < NS; i++) {
          if (i >= nSph) break;
          vec3 oc = ro - sph[i].xyz; float b = dot(oc, rd), c = dot(oc, oc) - sph[i].w * sph[i].w, disc = b*b - c;
          if (disc > 0.) {
            float s = sqrt(disc), t = -b - s;
            if (t < 1e-3) t = -b + s;
            if (t > 1e-3 && t < h.t) { h.t = t; h.obj = 1; h.p = ro + rd*t; h.sp = h.p; h.n = (h.p - sph[i].xyz) / sph[i].w; h.gn = h.n; h.mat = sphMat[i]; }
          }
        }
        uvec4 fi; vec3 fn, bc; float side, dist;
        if (bvhIntersectFirstHit(bvh, ro, rd, fi, fn, bc, side, dist) && dist > 0. && dist < h.t) {
          h.t = dist; h.obj = 0; h.p = ro + rd*dist;
          h.n = normalize(textureSampleBarycoord(nrmTex, bc, fi.xyz).xyz);
          vec4 cm = textureSampleBarycoord(colTex, bc, fi.xyz);
          h.col = cm.rgb; h.mat = int(cm.w + .5);
          h.uv = textureSampleBarycoord(uvTex, bc, fi.xyz).xy;
          h.gn = normalize(fn);
          {   // tangent along +u from the triangle's positions and uvs (w = handedness), for normal maps
            vec3 q0 = texelFetch1D(bvh.position, fi.x).xyz, q1 = texelFetch1D(bvh.position, fi.y).xyz, q2 = texelFetch1D(bvh.position, fi.z).xyz;
            vec2 w0 = texelFetch1D(uvTex, fi.x).xy, w1 = texelFetch1D(uvTex, fi.y).xy, w2 = texelFetch1D(uvTex, fi.z).xy;
            vec3 e1 = q1 - q0, e2 = q2 - q0; vec2 d1 = w1 - w0, d2 = w2 - w0;
            float det = d1.x * d2.y - d2.x * d1.y;
            vec3 T = (e1 * d2.y - e2 * d1.y) * (abs(det) > 1e-12 ? 1. / det : 0.), B = (e2 * d1.x - e1 * d2.x) * (abs(det) > 1e-12 ? 1. / det : 0.);
            h.tg = vec4(T, dot(cross(fn, T), B) < 0. ? -1. : 1.);
          }
          // shadow terminator fix (Hanika 2021): lift the shadow-ray origin onto the curved surface the
          // smooth normals imply, so flat facets don't shadow their neighbours under a low sun
          h.sp = h.p;
          for (int k = 0; k < 3; k++) {
            uint vi = fi[k];
            vec3 vp = texelFetch1D(bvh.position, vi).xyz, vn = texelFetch1D(nrmTex, vi).xyz;
            h.sp -= bc[k] * min(0., dot(h.p - vp, vn)) * vn;
          }
        }
        ivec2 g0, g1, g2; vec3 gb; float th = h.t;
        if (nHF > 0 && hfTrace(hfN0, hfM0, hfGeo0, hfInfo0, ivec2(0), ro, rd, th, g0, g1, g2, gb)) { h.t = th; hfFill(hfN0, hfC0, hfGeo0, hfInfo0, g0, g1, g2, gb, ro, rd, h); }
        for (int i = 0; i < MAXP; i++) {
          if (i >= nPatch) break;
          // walk the grid in the patch's own space; an affine transform keeps the ray parameter t the same
          vec3 lro = (pInv[i] * vec4(ro, 1.)).xyz, lrd = mat3(pInv[i]) * rd;
          ivec2 off = ivec2(i * int(pGeo[i].w + .5), i * int(pInfo[i].w + .5));
          th = h.t;
          if (hfTrace(patchN, patchM, pGeo[i], pInfo[i], off, lro, lrd, th, g0, g1, g2, gb)) { h.t = th; patchFill(i, off, g0, g1, g2, gb, ro, rd, h); }
        }
        if (water && hasWater > .5 && rd.y < 0. && ro.y > waterY) {
          float t = (waterY - ro.y) / rd.y;
          if (t < h.t) { h.t = t; h.obj = 2; h.p = ro + rd*t; h.p.y = waterY; h.sp = h.p; h.n = vec3(0,1,0); h.gn = h.n; h.mat = 0; }
        }
        return h.obj >= 0;
      }

      // same as traceOnce but steps through the transparent parts of alpha-cut leaves
      bool trace(vec3 ro, vec3 rd, float tmax, bool water, out Hit h){
        float acc = 0.;
        for (int k = 0; k < 6; k++) {
          if (!traceOnce(ro, rd, tmax - acc, water, h)) return false;
          if (h.obj == 0 && int(mCol[h.mat].w + .5) == 5 && texture(leafTex, h.uv).a < .5) {
            acc += h.t + 1e-3; ro = h.p + rd * 1e-3; continue;
          }
          h.t += acc; return true;
        }
        return false;
      }

      // light transmitted along a shadow ray: blocked by solids, tinted by glass, ignores bulbs
      vec3 shadowT(vec3 p, vec3 L, float maxT){
        vec3 T = vec3(1.);
        for (int k = 0; k < 4; k++) {
          Hit h;
          if (!trace(p, L, maxT, false, h)) return T;
          int kind = int(mCol[h.mat].w + .5);
          if (kind == 2) T *= mCol[h.mat].rgb * .8;
          else if (kind != 3) return vec3(0.);
          p = h.p + L * .02; maxT -= h.t + .02;
          if (maxT <= 0.) return T;
        }
        return T;
      }

      float bumpH(vec3 p, float f){ return bfbm(p * f) + .35 * bn(p * f * 5.); }
      void surfaceNoise(int m, vec3 p, inout vec3 albedo, inout vec3 n){
        vec4 a = mN1[m], b = mN2[m];
        if (a.x + a.z + b.z > 0.) {
          float bS = bfbm(p * a.y);
          float bG = bn(p * a.w) + .5 * bn(p * a.w * 3.1);
          albedo *= 1. + a.x * (bS - .5) * 2.5 + a.z * (bG - .75) * 1.6;
          float band = sin(p.y * b.w + bS * 9.) * .5 + .5;
          albedo *= mix(1., .72 + .56 * band, b.z);
        }
        if (b.x > 0.) {
          float e = .02 / b.y, h0 = bumpH(p, b.y);
          vec3 g = vec3(bumpH(p + vec3(e,0,0), b.y) - h0, bumpH(p + vec3(0,e,0), b.y) - h0, bumpH(p + vec3(0,0,e), b.y) - h0) / e;
          n = normalize(n - b.x * (g - dot(g, n) * n));
        }
      }

      // square tiles with grout, laid in world space on whichever plane the surface mostly faces
      vec3 tileAlb(vec3 p, vec3 n, vec3 c, float size){
        vec3 a = abs(n);
        vec2 uv = a.x > a.y && a.x > a.z ? p.yz : a.y > a.z ? p.xz : p.xy;
        vec2 f = fract(uv / size), e = min(f, 1. - f);
        return min(e.x, e.y) < .06 ? c * .55 : c;
      }

      vec3 directLight(vec3 p, vec3 sp, vec3 n, vec3 V, vec3 albedo, float spec, float shin){
        vec3 diff = albedo / PI;
        vec3 c = diff * mix(hemiGround, hemiSky, .5 * n.y + .5);
        vec3 o = sp + n * (floorMode > 3.5 && sp.y < waterY ? .003 : .03);
        bool underPool = floorMode > 3.5 && o.y < waterY;
        vec3 sL = underPool ? -refract(-sunDir, vec3(0., 1., 0.), 1. / 1.33) : sunDir;
        float ndl = dot(n, sL);
        if (ndl > 0.) {
          vec3 entry = o;
          vec3 T = vec3(1.);
          if (underPool) {
            float t = (waterY - o.y) / max(sL.y, 1e-4);
            T = shadowT(o, sL, t);
            entry = o + sL * t + vec3(0., .003, 0.);
          }
          T *= shadowT(entry, sunDir, 1e5) * cloudShadow(entry, sunDir);
          c += T * sunLight * (diff * ndl + spec * pow(max(dot(reflect(-sL, n), V), 0.), shin));
        }
        for (int i = 0; i < 3; i++) {
          vec3 dl = lampPos[i] - p; float d2 = dot(dl, dl);
          if (d2 > 25600.) continue;
          float d = sqrt(d2); vec3 L = dl / d;
          vec3 entry = o; vec3 T = vec3(1.); float airD = d;
          if (underPool && lampPos[i].y > waterY) {
            // Find the surface crossing satisfying Snell's law for this finite light.
            float depth = waterY - o.y, height = lampPos[i].y - waterY;
            vec2 delta = lampPos[i].xz - o.xz;
            float span = length(delta), lo = 0., hi = span;
            for (int k = 0; k < 16; k++) {
              float x = (lo + hi) * .5;
              float sw = x / length(vec2(x, depth));
              float sa = (span - x) / length(vec2(span - x, height));
              if (1.33 * sw > sa) hi = x; else lo = x;
            }
            vec2 crossing = o.xz + delta * ((lo + hi) * .5 / max(span, 1e-6));
            entry = vec3(crossing.x, waterY, crossing.y);
            L = normalize(entry - o);
            T = shadowT(o, L, length(entry - o));
            entry.y += .003;
            airD = length(lampPos[i] - entry);
          }
          float nl = dot(n, L);
          if (nl <= 0.) continue;
          T *= shadowT(entry, normalize(lampPos[i] - entry), max(airD - 3., 0.));
          c += T * lampLight[i] / d2 * (diff * nl + spec * pow(max(dot(reflect(-L, n), V), 0.), shin));
        }
        return c;
      }

      float fogF(float t, float y){
        float a = 1. - exp(-fogDensity * fogDensity * t * t);
        float b = 1. - exp(-t * fogDensity * 1.1 * exp(-max(y, 0.) / 18.));
        return max(a, b);
      }

      vec3 halo(vec3 ro, vec3 rd, float tHit){
        vec3 c = vec3(0.);
        for (int i = 0; i < 3; i++) {
          vec3 oc = lampPos[i] - ro; float s = dot(oc, rd);
          if (s < 0. || s > tHit + 3.) continue;
          float d2 = dot(oc, oc) - s*s;
          c += lampTint[i] * (exp(-d2 / 6.) * .6 + exp(-d2 / 30.) * .35);
        }
        return c;
      }

      void main(){
        rs = (uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u + uint(frame) * 26699u) | 1u;
        rnd(); rnd();
        vec2 ndc = ((gl_FragCoord.xy - .5 + vec2(rnd(), rnd())) / res) * 2. - 1.;
        vec3 ro, rd;
        ndcToCameraRay(ndc, camWorld, invProj, ro, rd);
        rd = normalize(rd);

        vec3 col = vec3(0.), thr = vec3(1.);
        for (int bounce = 0; bounce < 6; bounce++) {
          Hit h;
          bool hit = trace(ro, rd, 1e5, true, h);
          if (bounce == 0) col += halo(ro, rd, hit ? h.t : 1e5);
          cloudsAlong(ro, rd, hit ? h.t : 1e9, col, thr);
          if (!hit) { col += thr * skyColor(rd); break; }

          float ff = fogF(h.t, h.p.y);
          col += thr * ff * fogCol; thr *= 1. - ff;
          vec3 V = -rd;

          if (h.obj == 2 && floorMode > 3.5) {   // clear pool: evaluate transmission and reflection on every sample
            vec2 xz = h.p.xz;
            vec2 g = vec2(fbmW(xz * .35 + waterSeed), fbmW(xz * .35 + waterSeed + 11.)) - .5;
            vec3 n = normalize(vec3(g.x * .22, 1., g.y * .22));
            float F = .02 + .98 * pow(1. - max(dot(V, n), 0.), 5.);
            col += thr * sunLight * pow(max(dot(reflect(-sunDir, n), V), 0.), 700.) * 3.;
            // The pool has a level interface; use the same refraction plane as
            // the preview projection and shadow rays. Ripples perturb reflections.
            vec3 rr = refract(rd, vec3(0., 1., 0.), 1. / 1.33);
            vec3 sp0 = h.p + rr * .001;
            float tF = (sp0.y - (waterY - poolDepth)) / max(-rr.y, 1e-3);
            vec3 fp = sp0 + rr * tF, fn = vec3(0., 1., 0.), fsp = fp;
            vec3 alb = tileAlb(fp, fn, floorB, floorTile);
            Hit u;   // anything standing in the water (columns, steps) is seen through it
            if (trace(sp0, rr, tF, false, u)) {
              fp = u.p; fsp = u.sp; fn = u.n; if (dot(fn, rr) > 0.) fn = -fn;
              int uk = int(mCol[u.mat].w + .5);
              vec3 ua = u.obj == 0 ? u.col : mCol[u.mat].rgb;
              if (u.obj == 0 && mTx[u.mat].x >= 0.) ua *= pow(textureLod(texArr, vec3(u.uv, mTx[u.mat].x), 0.).rgb, vec3(2.2));
              alb = uk == 6 ? tileAlb(fp, fn, ua, mTx[u.mat].w) : uk == 3 ? vec3(0.) : ua;
              if (uk == 3) col += thr * (1. - F) * mCol[u.mat].rgb * .5;
            }
            float dist = length(fp - sp0);
            vec3 T = pow(max(floorA, vec3(.02)), vec3(dist / 12.));   // the water's own colour deepens with distance
            vec3 lit = directLight(fp, fsp, fn, -rr, alb, .05, 30.);
            col += thr * (1. - F) * (lit * T + floorA * (1. - T) * (hemiSky * .35 + sunLight * .12));
            thr *= F;
            ro = h.p + vec3(0., .001, 0.); rd = reflect(rd, n);
            if (rd.y < .001) rd = normalize(vec3(rd.x, .001, rd.z));
            continue;
          }
          if (h.obj == 2 && floorMode > 2.5) {   // mirror floor: a perfect tinted reflection plus the sun's highlight
            col += thr * sunLight * pow(max(dot(reflect(-sunDir, vec3(0., 1., 0.)), V), 0.), 1500.);
            thr *= floorA; ro = vec3(h.p.x, waterY + .02, h.p.z); rd = reflect(rd, vec3(0., 1., 0.));
            continue;
          }
          if (h.obj == 2 && floorMode > .5) {   // checker or tile floor: lit, shadowed, glossy enough to mirror what stands on it
            vec3 alb;
            if (floorMode > 1.5) {   // square tiles with thin grout lines; glazed, so a little shinier
              vec2 f = fract(h.p.xz / floorTile), e = min(f, 1. - f);
              alb = min(e.x, e.y) < .035 ? floorB : floorA;
            } else {
              vec2 ck = floor(h.p.xz / floorTile);
              alb = mod(ck.x + ck.y, 2.) < .5 ? floorB : floorA;
            }
            vec3 n = vec3(0., 1., 0.);
            float fr = (floorMode > 1.5 ? .2 : .14) + .5 * pow(1. - max(dot(V, n), 0.), 5.);
            col += thr * (1. - fr) * directLight(h.p, h.p, n, V, alb, .3, 60.);
            thr *= fr; ro = vec3(h.p.x, waterY + .02, h.p.z); rd = reflect(rd, n);
            if (max(thr.r, max(thr.g, thr.b)) < .02) break;
            continue;
          }
          if (h.obj == 2) {   // water: bumpy mirror with a body colour and sun glints
            vec2 xz = h.p.xz, p = xz * vec2(.012, .16) + waterSeed;
            vec2 bm = vec2(fbmW(p), fbmW(p + 37.)) - .5;
            vec2 g = vec2(fbmW(xz * .9 + waterSeed), fbmW(xz * .9 + waterSeed + 11.)) - .5;
            vec3 n = normalize(vec3(bm.x * .5 + g.x * .9, 1., bm.y * 1.2 + g.y * .9));
            vec3 nr = normalize(vec3(bm.x * .1 + g.x * .05, 1., bm.y * .25 + g.y * .05));
            float fres = .25 + .75 * pow(1. - max(dot(V, n), 0.), 4.);
            col += thr * (1. - fres) * waterCol;
            col += thr * skySun * pow(max(dot(reflect(rd, n), sunDir), 0.), 900.) * 14.;
            thr *= fres * waterTint;
            ro = vec3(h.p.x, waterY + .02, h.p.z); rd = reflect(rd, nr);
            if (rd.y < .001) rd = normalize(vec3(rd.x, .001, rd.z));
            continue;
          }

          vec4 mc = mCol[h.mat], mp = mP[h.mat];
          int kind = int(mc.w + .5);
          if (kind == 3) { col += thr * mc.rgb; break; }

          if (kind == 2) {    // glass: Fresnel picks reflect or refract per sample; accumulation blends them
            vec3 n = (h.obj == 0 && mTx[h.mat].w > .5) ? h.gn : h.n; bool entering = dot(rd, n) < 0.;
            if (!entering) n = -n;
            float eta = entering ? 1. / mp.w : mp.w, cosi = -dot(rd, n);
            vec3 refr = refract(rd, n, eta);
            float F0 = pow((1. - mp.w) / (1. + mp.w), 2.), F = F0 + (1. - F0) * pow(1. - cosi, 5.);
            if (entering) col += thr * sunLight * pow(max(dot(reflect(-sunDir, n), V), 0.), 2000.);
            if (dot(refr, refr) == 0. || rnd() < F) { rd = reflect(rd, n); ro = h.p + n * .02; }
            else { rd = refr; ro = h.p - n * .02; thr *= mix(vec3(1.), mc.rgb, .5); }
            continue;
          }

          vec3 n = (mp.w > .5 && h.obj == 0) ? h.gn : h.n;
          if (dot(n, rd) > 0.) n = -n;

          if (kind == 1) {    // polished metal: tinted perfect mirror plus a sharp sun highlight
            col += thr * sunLight * mp.y * pow(max(dot(reflect(-sunDir, n), V), 0.), mp.z);
            thr *= mc.rgb * mp.x; ro = h.p + n * .02; rd = reflect(rd, n);
            continue;
          }

          vec3 albedo = h.obj == 0 ? h.col : mc.rgb;
          if (kind == 4) {   // spheres: 16 x 8 checks; other shapes: solid 3D checks
            vec3 q = h.n;
            float u = atan(q.z, q.x) / (2. * PI) + .5, v = acos(clamp(q.y, -1., 1.)) / PI;
            float c = h.obj == 1 ? floor(u * 16.) + floor(v * 8.) : dot(floor(h.p / 2.5 + 1e-3), vec3(1.));
            albedo = mod(c, 2.) < .5 ? checkB : checkA;
          }
          if (kind == 5) albedo *= texture(leafTex, h.uv).rgb;
          if (kind == 6) albedo = tileAlb(h.p, n, albedo, mTx[h.mat].w);
          vec4 tx = mTx[h.mat];
          float spec = mp.y, shin = mp.z, refl = mp.x; vec3 rtint = vec3(1.);
          if (h.obj == 0 && tx.x >= 0.) albedo *= pow(textureLod(texArr, vec3(h.uv, tx.x), 0.).rgb, vec3(2.2));
          if (h.obj == 0 && tx.y >= 0. && dot(h.tg.xyz, h.tg.xyz) > 0.) {   // tangent-space normal map (OpenGL / +Y up)
            vec3 nt = textureLod(texArr, vec3(h.uv, tx.y), 0.).xyz * 2. - 1.;
            vec3 T = normalize(h.tg.xyz - n * dot(n, h.tg.xyz)), B = cross(n, T) * h.tg.w;
            n = normalize(T * nt.x + B * nt.y + n * nt.z);
          }
          if (h.obj == 0 && tx.z >= 0.) {   // glTF roughness (G) / metalness (B), scaled by the material factors
            vec3 arm = textureLod(texArr, vec3(h.uv, tx.z), 0.).rgb;
            float r = clamp(arm.g * tx.w, .04, 1.), mt = arm.b * mN1[h.mat].x;
            refl = mt * (1. - r) * .85; spec = .04 + .6 * (1. - r) * (.3 + mt); shin = min(2000., max(2., 2. / (r * r + 1e-4)));
            rtint = mix(vec3(1.), clamp(albedo * 1.6, 0., 1.), mt);   // metals tint what they reflect (brass -> gold)
            albedo *= 1. - .5 * mt;   // metals get their colour mostly from reflection
          }
          if (tx.z < 0. && mMt[h.mat].x > 0.) {   // untextured metallic (e.g. Glossy): same colour-tinted reflections as above
            // reflectance at normal incidence is mix(4% grey, albedo, metalness), like the raster PBR shading;
            // refl already carries the overall strength, so the tint is that colour relative to it
            float mt = mMt[h.mat].x;
            rtint = clamp(mix(vec3(.04), albedo, mt) / max(refl, .02), 0., 1.);
            albedo *= 1. - .5 * mt;
          }
          if (h.obj == 0 && tx.x < 0.) surfaceNoise(h.mat, h.p, albedo, n);
          albedo = max(albedo, 0.);

          if (refl > 0.) refl += (1. - refl) * pow(1. - max(dot(n, V), 0.), 5.) * .5;
          col += thr * (1. - refl) * directLight(h.p, h.sp, n, V, albedo, spec, shin);
          if (refl < .02) break;
          thr *= refl * rtint; ro = h.p + n * .02; rd = reflect(rd, n);
          if (max(thr.r, max(thr.g, thr.b)) < .02) break;
        }
        gl_FragColor = vec4(clamp(col, 0., 1.), 1.);
      }`,
  });

  const hfTex = [];
  // Pack a PlaneGeometry-based mesh (rotated flat, any position) into height grid textures.
  function buildHeightField(mesh, slot, matId) {
    const g = mesh.geometry, P = g.attributes.position, Nm = g.attributes.normal, Cl = g.attributes.color;
    const N = g.parameters.widthSegments + 1;
    const mw = mesh.matrixWorld, v = new THREE.Vector3(), nmat = new THREE.Matrix3().getNormalMatrix(mw);
    const base = mesh.material.color || new THREE.Color(1, 1, 1);
    const nd = new Float32Array(N * N * 4), cd = new Float32Array(N * N * 4);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < N * N; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(mw);
      nd[i * 4 + 3] = v.y; minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      v.fromBufferAttribute(Nm, i).applyMatrix3(nmat).normalize();
      nd[i * 4] = v.x; nd[i * 4 + 1] = v.y; nd[i * 4 + 2] = v.z;
      cd[i * 4] = base.r * (Cl ? Cl.getX(i) : 1); cd[i * 4 + 1] = base.g * (Cl ? Cl.getY(i) : 1); cd[i * 4 + 2] = base.b * (Cl ? Cl.getZ(i) : 1); cd[i * 4 + 3] = 1;
    }
    const o = new THREE.Vector3().fromBufferAttribute(P, 0).applyMatrix4(mw), o1 = new THREE.Vector3().fromBufferAttribute(P, 1).applyMatrix4(mw);
    const cell = o1.x - o.x, B = 8, C = Math.ceil((N - 1) / B);
    const md = new Float32Array(C * C);
    for (let bz = 0; bz < C; bz++) for (let bx = 0; bx < C; bx++) {
      let m = -Infinity;
      for (let z = bz * B; z <= Math.min(bz * B + B, N - 1); z++) for (let x = bx * B; x <= Math.min(bx * B + B, N - 1); x++) m = Math.max(m, nd[(z * N + x) * 4 + 3]);
      md[bz * C + bx] = m;
    }
    const tex = (data, w, fmt) => { const t = new THREE.DataTexture(data, w, w, fmt, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; };
    (hfTex[slot] || []).forEach(t => t.dispose());
    hfTex[slot] = [tex(nd, N, THREE.RGBAFormat), tex(cd, N, THREE.RGBAFormat), tex(md, C, THREE.RedFormat)];
    const u = material.uniforms;
    u['hfN' + slot].value = hfTex[slot][0]; u['hfC' + slot].value = hfTex[slot][1]; u['hfM' + slot].value = hfTex[slot][2];
    u['hfGeo' + slot].value.set(o.x, o.z, cell, N);
    u['hfInfo' + slot].value.set(minY - 1, maxY + 1, matId, C);
  }

  let patchTex = [];
  // Pack terrain-object grids side by side into atlases (local space; transforms go in uniforms).
  function buildPatches(meshes, matIds) {
    const u = material.uniforms, K = meshes.length;
    patchTex.forEach(t => t.dispose()); patchTex = [];
    u.nPatch.value = K;
    if (!K) return;
    const N = meshes[0].geometry.parameters.widthSegments + 1, B = 8, C = Math.ceil((N - 1) / B);
    const nd = new Float32Array(N * K * N * 4), cd = new Float32Array(N * K * N * 4), md = new Float32Array(C * K * C);
    meshes.forEach((mesh, k) => {
      const g = mesh.geometry, P = g.attributes.position, Nm = g.attributes.normal, Cl = g.attributes.color;
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material, base = mat.color || new THREE.Color(1, 1, 1);
      let minY = Infinity, maxY = -Infinity;
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        const i = z * N + x, a = (z * N * K + k * N + x) * 4, y = P.getY(i);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        nd[a] = Nm.getX(i); nd[a + 1] = Nm.getY(i); nd[a + 2] = Nm.getZ(i); nd[a + 3] = y;
        cd[a] = base.r * (Cl ? Cl.getX(i) : 1); cd[a + 1] = base.g * (Cl ? Cl.getY(i) : 1); cd[a + 2] = base.b * (Cl ? Cl.getZ(i) : 1); cd[a + 3] = 1;
      }
      for (let bz = 0; bz < C; bz++) for (let bx = 0; bx < C; bx++) {
        let m = -Infinity;
        for (let z = bz * B; z <= Math.min(bz * B + B, N - 1); z++) for (let x = bx * B; x <= Math.min(bx * B + B, N - 1); x++) m = Math.max(m, P.getY(z * N + x));
        md[bz * C * K + k * C + bx] = m;
      }
      const cell = P.getX(1) - P.getX(0);
      u.pGeo.value[k].set(P.getX(0), P.getZ(0), cell, N);
      u.pInfo.value[k].set(minY - 1, maxY + 1, matIds[k], C);
      mesh.updateWorldMatrix(true, false);
      u.pModel.value[k].copy(mesh.matrixWorld); u.pInv.value[k].copy(mesh.matrixWorld).invert();
    });
    const tex = (data, w, h, fmt) => { const t = new THREE.DataTexture(data, w, h, fmt, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; patchTex.push(t); return t; };
    u.patchN.value = tex(nd, N * K, N, THREE.RGBAFormat);
    u.patchC.value = tex(cd, N * K, N, THREE.RGBAFormat);
    u.patchM.value = tex(md, C * K, C, THREE.RedFormat);
  }

  // Gather the current scene into the tracer: triangle meshes into one BVH, spheres analytically.
  function build(ctx) {
    const { scene, camera, spheres } = ctx;
    const heightFields = ctx.heightFields || [];
    const patches = (ctx.patches || []).slice(0, MAXP);   // any beyond MAXP are traced as ordinary triangles
    const skip = new Set([...ctx.skip, ...heightFields, ...patches]);
    scene.updateMatrixWorld(true);
    const mats = [], matIds = new Map();
    const addMat = (key, e) => { if (matIds.has(key)) return matIds.get(key); if (mats.length >= NM) return 0; matIds.set(key, mats.length); mats.push(e); return mats.length - 1; };
    const sphereList = spheres.filter(s => s.mesh.visible).slice(0, NS);   // extra spheres would vanish, so cap first
    const sphereMeshes = new Set(sphereList.map(s => s.mesh));
    let leafTex = null;

    // model textures go into one array texture: 512x512 RGBA8 layers, at most 64
    const SZ = 512, layers = new Map(), layerData = [];
    const addLayer = tex => {
      if (layers.has(tex)) return layers.get(tex);
      if (layerData.length >= 64 || !tex.image) return -1;
      try {
        const c = document.createElement('canvas'); c.width = c.height = SZ;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(tex.image, 0, 0, SZ, SZ);
        layerData.push(g.getImageData(0, 0, SZ, SZ).data);
      } catch (e) { return -1; }
      layers.set(tex, layerData.length - 1); return layerData.length - 1;
    };
    const meshes = [];
    scene.traverseVisible(o => { if (o.isMesh && !skip.has(o) && !sphereMeshes.has(o)) meshes.push(o); });
    let vTotal = 0, iTotal = 0;
    for (const m of meshes) { const g = m.geometry; vTotal += g.attributes.position.count; iTotal += g.index ? g.index.count : g.attributes.position.count; }

    const P = new Float32Array(vTotal * 3), N = new Float32Array(vTotal * 3), CM = new Float32Array(vTotal * 4), UV = new Float32Array(vTotal * 2), I = new Uint32Array(iTotal);
    const v = new THREE.Vector3(), nm = new THREE.Matrix3(), tmp = [1, 1, 1];
    let vb = 0, ib = 0;
    for (const mesh of meshes) {
      const g = mesh.geometry, mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const flat = !!mesh.userData.flat;
      const entry = materialEntry(mat, flat);
      const id = addMat(mat.uuid + flat, entry);
      if (entry.kind === KIND.leaf && !leafTex) leafTex = mat.map;
      const pos = g.attributes.position, uv = g.attributes.uv;
      let nrm = g.attributes.normal;
      if (!nrm) { const c = g.clone(); c.computeVertexNormals(); nrm = c.attributes.normal; }
      const vc = mat.vertexColors && g.attributes.color ? g.attributes.color : null;
      if (entry.kind !== KIND.leaf && uv && (mat.map || mat.normalMap || mat.roughnessMap)) {
        const L = tex => tex ? addLayer(tex) : -1;
        entry.tx = [L(mat.map), L(mat.normalMap), L(mat.roughnessMap || mat.metalnessMap), mat.roughness];
        entry.n1 = [mat.metalness, 0, 0, 0];   // metalness factor rides in n1.x for textured materials
      }
      const samp = null;   // colour now comes from the texture per pixel
      const base = mat.color || new THREE.Color(1, 1, 1);
      nm.getNormalMatrix(mesh.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        const k = vb + i;
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        P[k * 3] = v.x; P[k * 3 + 1] = v.y; P[k * 3 + 2] = v.z;
        v.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
        N[k * 3] = v.x; N[k * 3 + 1] = v.y; N[k * 3 + 2] = v.z;
        let r = base.r, gg = base.g, b = base.b;
        if (vc) { r *= vc.getX(i); gg *= vc.getY(i); b *= vc.getZ(i); }
        if (samp) { samp(uv.getX(i), uv.getY(i), tmp); r *= tmp[0]; gg *= tmp[1]; b *= tmp[2]; }
        CM[k * 4] = r; CM[k * 4 + 1] = gg; CM[k * 4 + 2] = b; CM[k * 4 + 3] = id;
        if (uv) { UV[k * 2] = uv.getX(i); UV[k * 2 + 1] = uv.getY(i); }
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) I[ib++] = vb + g.index.getX(i);
      else for (let i = 0; i < pos.count; i++) I[ib++] = vb + i;
      vb += pos.count;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setIndex(new THREE.BufferAttribute(I, 1));
    const bvh = new MeshBVH(geo);
    bvhStruct.updateFrom(bvh);
    nrmTex.updateFrom(new THREE.BufferAttribute(N, 3));
    colTex.updateFrom(new THREE.BufferAttribute(CM, 4));
    uvTex.updateFrom(new THREE.BufferAttribute(UV, 2));

    // height grids
    const u = material.uniforms;
    heightFields.forEach((m, i) => buildHeightField(m, i, addMat(m.material.uuid + false, materialEntry(m.material, false))));
    u.nHF.value = heightFields.length;
    buildPatches(patches, patches.map(m => addMat(m.material.uuid + false, materialEntry(m.material, false))));

    // analytic spheres
    let ns = 0;
    for (const s of sphereList) {
      const c = new THREE.Vector3().setFromMatrixPosition(s.mesh.matrixWorld);
      const r = s.mesh.geometry.parameters.radius * s.mesh.getWorldScale(new THREE.Vector3()).x;
      const m = Array.isArray(s.mesh.material) ? s.mesh.material[0] : s.mesh.material;
      const e = s.entry ? { ...materialEntry(m, false), ...s.entry } : materialEntry(m, false);
      u.sph.value[ns].set(c.x, c.y, c.z, r);
      u.sphMat.value[ns] = addMat('sph' + ns, e);
      ns++;
    }
    u.nSph.value = ns;

    mats.forEach((e, i) => {
      u.mCol.value[i].set(e.col.r, e.col.g, e.col.b, e.kind);
      u.mP.value[i].fromArray(e.p); u.mN1.value[i].fromArray(e.n1); u.mN2.value[i].fromArray(e.n2); u.mMt.value[i].set(e.mt || 0, 0, 0, 0);
    });
    u.leafTex.value = leafTex || blank;
    mats.forEach((e, i) => u.mTx.value[i].fromArray(e.tx || [-1, -1, -1, 0]));
    if (u.texArr.value) u.texArr.value.dispose();
    const nL = Math.max(1, layerData.length), all = new Uint8Array(SZ * SZ * 4 * nL);
    layerData.forEach((d, i) => all.set(d, i * SZ * SZ * 4));
    const ta = new THREE.DataArrayTexture(all, SZ, SZ, nL);
    ta.minFilter = ta.magFilter = THREE.LinearFilter; ta.wrapS = ta.wrapT = THREE.RepeatWrapping; ta.needsUpdate = true;
    u.texArr.value = ta;

    // lights, sky, fog, water
    const { sun, hemi, lamps, skyU, waterU, fog } = ctx;
    u.sunDir.value.copy(skyU.sunDir.value);
    u.sunLight.value.copy(sun.color).multiplyScalar(sun.intensity);
    u.hemiSky.value.copy(hemi.color).multiplyScalar(hemi.intensity);
    u.hemiGround.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity);
    for (let i = 0; i < 3; i++) {
      const l = lamps[i];
      if (!l) { u.lampPos.value[i].set(0, -1e6, 0); u.lampLight.value[i].set(0, 0, 0); u.lampTint.value[i].set(0, 0, 0); continue; }
      l.light.getWorldPosition(u.lampPos.value[i]);
      u.lampLight.value[i].set(l.light.color.r, l.light.color.g, l.light.color.b).multiplyScalar(l.light.intensity);
      u.lampTint.value[i].set(l.halo.material.color.r, l.halo.material.color.g, l.halo.material.color.b);
    }
    u.fogCol.value.copy(fog.color); u.fogDensity.value = fog.density;
    u.night.value = ctx.night ? 1 : 0;
    u.hasWater.value = ctx.water === false ? 0 : 1; u.waterY.value = ctx.waterY || 0;
    u.floorMode.value = ctx.floor ? ctx.floor.mode : 0;
    if (ctx.floor) { u.floorA.value.copy(ctx.floor.a); u.floorB.value.copy(ctx.floor.b); u.floorTile.value = ctx.floor.tile; u.poolDepth.value = ctx.floor.depth || 6; }
    u.skyClouds.value = skyU.clouds ? skyU.clouds.value : 1;
    u.moonTex.value = skyU.moonTex.value; u.hasMoon.value = skyU.hasMoon.value; u.moonLod.value = skyU.moonLod.value;
    const clouds = ctx.clouds || [];
    u.nCloud.value = clouds.length;
    clouds.forEach((c, i) => {
      u.cPos.value[i].set(c.pos[1], c.pos[0], c.pos[2], c.cseed);
      u.cPrm.value[i].set(c.coverage, c.softness, c.opacity, c.size);
      u.cCol.value[i].set(c.color.r, c.color.g, c.color.b).multiplyScalar(ctx.night ? 0.12 : 1);
    });
    u.zenith.value.copy(skyU.zenith.value); u.horizon.value.copy(skyU.horizon.value);
    u.skySun.value.copy(skyU.sunCol.value); u.skySeed.value = skyU.seed.value;
    u.waterCol.value.copy(waterU.waterCol.value); u.waterTint.value.copy(waterU.color.value); u.waterSeed.value = waterU.seed.value;
    u.camWorld.value.copy(camera.matrixWorld); u.invProj.value.copy(camera.projectionMatrixInverse);
    u.frame.value = 0;
    return { triangles: iTotal / 3, materials: mats.length, spheres: ns, heightFields: heightFields.length };
  }

  return { material, build };
}
