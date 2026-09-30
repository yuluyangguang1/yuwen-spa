import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = /* glsl */ `
varying vec2 vUv;
uniform float uTime, uFoil, uScale, uDepth, uBgDepth;
uniform vec3 uView;
uniform sampler2D tSubject, tBackground;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1, 0)), f.x),
    mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x),
    f.y
  );
}
vec3 spectrum(float t) {
  t = fract(t);
  vec3 pink = vec3(1.0, 0.32, 0.62);
  vec3 yellow = vec3(1.0, 0.85, 0.32);
  vec3 blue = vec3(0.22, 0.62, 1.0);
  if (t < 0.35) return mix(pink, yellow, t / 0.35);
  if (t < 0.7) return mix(yellow, blue, (t - 0.35) / 0.35);
  return mix(blue, vec3(1.0), (t - 0.7) / 0.3);
}
vec3 overlay(vec3 b, vec3 f) {
  return mix(2.0 * b * f, 1.0 - 2.0 * (1.0 - b) * (1.0 - f), step(vec3(0.5), b));
}
float inside(vec2 p) {
  return step(0.0, p.x) * step(0.0, p.y) * step(p.x, 1.0) * step(p.y, 1.0);
}
vec2 parallax(vec2 p, float s, float d) {
  return (p - 0.5) * s + 0.5 + uView.xy / max(abs(uView.z), 0.35) * d * 0.14;
}
float wave(vec2 p) {
  vec2 a = p + uView.xy * 2.4;
  return 0.5 + 0.5 * sin((a.x * 0.848 - a.y * 0.530) * 6.283 * 0.55 + 7.0 * noise(a * 1.5));
}
float star(vec2 p) {
  vec2 q = p * 105.0;
  vec2 id = floor(q);
  vec2 f = fract(q);
  float first = 9.0;
  float second = 9.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash(id + g), hash(id + g + 43.3));
      float d = length(g + o - f);
      if (d < first) { second = first; first = d; }
      else second = min(second, d);
    }
  }
  float edge = 1.0 - smoothstep(0.01, 0.035, second - first);
  float sparse = step(0.90, hash(id + 8.8));
  float twinkle = pow(0.5 + 0.5 * sin(uTime * 1.8 + hash(id) * 30.0 + uView.x * 27.0 + uView.y * 21.0), 6.0);
  return edge * sparse * twinkle;
}

void main() {
  vec2 uv = vUv;
  vec2 su = parallax(uv, uScale, uDepth);
  vec2 bu = parallax(uv, 1.0, uBgDepth);
  vec4 sub = texture2D(tSubject, clamp(su, 0.0, 1.0));
  float subA = inside(su);
  vec3 bg = texture2D(tBackground, clamp(bu, 0.0, 1.0)).rgb;

  float w = wave(uv) + uTime * 0.06;
  vec3 foil = spectrum(w * 0.8 + noise(uv * 5.0) * 0.12);
  vec3 subject = mix(sub.rgb, overlay(sub.rgb, foil), uFoil * 0.22);
  bg = mix(bg, overlay(bg, foil), uFoil * 0.3);
  bg *= 0.85;

  vec3 col = mix(bg, subject, subA);
  float sweep = pow(max(0.0, sin((uv.x * 0.83 + uv.y * 0.35 + uView.x * 1.8 + uView.y * 0.9 + uTime * 0.18) * 6.283)), 12.0);
  col += foil * sweep * uFoil * 0.16;
  col += vec3(0.66, 0.86, 1.0) * star(bu) * uFoil * 0.3 * (1.0 - subA * 0.55);

  float vig = smoothstep(1.2, 0.5, length(uv - 0.5) * 1.55);
  col *= mix(0.72, 1.0, vig);

  gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(2.2)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export type HoloTarget = { x: number; y: number }

function makeBlurredTexture(img: HTMLImageElement) {
  const w = 256
  const h = Math.max(1, Math.round((w * img.naturalHeight) / img.naturalWidth))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.filter = 'blur(14px) brightness(0.5) saturate(1.3)'
  ctx.drawImage(img, -w * 0.1, -h * 0.1, w * 1.2, h * 1.2)
  ctx.filter = 'none'
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

export async function createHolo(
  container: HTMLElement,
  host: HTMLElement,
  src: string,
  target: HoloTarget,
): Promise<() => void> {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let autoSway = !reduced

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setClearColor(0x0a0a09, 1)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  const canvas = renderer.domElement
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.display = 'block'
  container.appendChild(canvas)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  camera.position.set(0, 0, 20)
  camera.lookAt(0, 0, 0)

  const loader = new THREE.TextureLoader()
  const subjectTex = await loader.loadAsync(src)
  subjectTex.colorSpace = THREE.NoColorSpace
  subjectTex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8)
  const bgTex = makeBlurredTexture(subjectTex.image as HTMLImageElement)

  const uniforms = {
    uTime: { value: 0 },
    uView: { value: new THREE.Vector3(0, 0, 1) },
    uFoil: { value: 0.45 },
    uScale: { value: 1.03 },
    uDepth: { value: 0.22 },
    uBgDepth: { value: -0.25 },
    tSubject: { value: subjectTex },
    tBackground: { value: bgTex },
  }

  const geo = new THREE.PlaneGeometry(2, 2)
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader })
  const mesh = new THREE.Mesh(geo, mat)
  scene.add(mesh)

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(720, 1000), 0.14, 0.3, 1.0)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  const resize = () => {
    const w = container.clientWidth
    const h = container.clientHeight
    if (!w || !h) return
    const aspect = w / h
    camera.left = -aspect
    camera.right = aspect
    camera.top = 1
    camera.bottom = -1
    camera.updateProjectionMatrix()
    mesh.scale.set(aspect, 1, 1)
    renderer.setSize(w, h, false)
    composer.setSize(w, h)
  }
  const ro = new ResizeObserver(resize)
  ro.observe(container)
  resize()

  const onEnter = () => {
    autoSway = false
  }
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    autoSway = false
    const r = host.getBoundingClientRect()
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1
    target.y = THREE.MathUtils.clamp(nx * 0.5, -0.65, 0.65)
    target.x = THREE.MathUtils.clamp(-ny * 0.4, -0.43, 0.43)
  }
  const onLeave = () => {
    if (reduced) {
      target.x = 0.025
      target.y = -0.13
      return
    }
    autoSway = true
  }
  host.addEventListener('pointerenter', onEnter)
  host.addEventListener('pointermove', onMove)
  host.addEventListener('pointerleave', onLeave)

  let running = false
  let rotX = target.x
  let rotY = target.y
  let lastTime = 0
  let elapsed = 0

  const tick = (now: number) => {
    const dt = Math.min((now - lastTime) / 1000, 0.1) || 0
    lastTime = now
    if (!reduced) elapsed += dt
    if (autoSway) {
      target.y = Math.sin(elapsed * 0.65) * 0.38
      target.x = Math.sin(elapsed * 0.85) * 0.12
    }
    const ease = reduced ? 1 : 1 - Math.exp(-dt * 8)
    rotX += (target.x - rotX) * ease
    rotY += (target.y - rotY) * ease
    mesh.rotation.set(rotX, rotY, 0)
    mesh.updateMatrixWorld(true)
    uniforms.uView.value
      .copy(camera.position)
      .applyMatrix4(new THREE.Matrix4().copy(mesh.matrixWorld).invert())
      .normalize()
    uniforms.uTime.value = reduced ? 0 : elapsed
    composer.render()
  }

  const setRunning = (on: boolean) => {
    if (on === running) return
    running = on
    if (on) {
      lastTime = performance.now()
      renderer.setAnimationLoop(tick)
    } else {
      renderer.setAnimationLoop(null)
    }
  }

  const io = new IntersectionObserver(entries => {
    setRunning(entries[0]?.isIntersecting ?? true)
  })
  io.observe(host)
  setRunning(true)

  return () => {
    renderer.setAnimationLoop(null)
    ro.disconnect()
    io.disconnect()
    host.removeEventListener('pointerenter', onEnter)
    host.removeEventListener('pointermove', onMove)
    host.removeEventListener('pointerleave', onLeave)
    composer.dispose()
    geo.dispose()
    mat.dispose()
    subjectTex.dispose()
    bgTex.dispose()
    renderer.dispose()
    canvas.remove()
  }
}
