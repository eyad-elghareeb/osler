'use client'

/**
 * FluidOrb
 * ─────────────────────────────────────────────────────────────────────────
 * A WebGL orb with drifting fluid shading, based on the "Fluid Orb"
 * component from Rare UI (https://www.rareui.com/components/fluidorb,
 * https://github.com/swamimalode07/rare-ui — credit: Swami Malode /
 * "inspired by chatgpt.com"). Free to use/modify per that project's license.
 *
 * Extended for Osler's voice mode with two capabilities the original
 * component doesn't have:
 *
 *  1. Themable color — when no explicit `color` is passed, the orb reads
 *     the site's live `--primary` CSS variable (resolved via a computed
 *     style probe, so it works regardless of color space — oklch, hsl,
 *     hex, etc.) and re-resolves it whenever the <html> element's classes
 *     change, which is how Osler's theme switcher applies a theme. Drop
 *     this into any themed site and the orb will always match the active
 *     accent color, light or dark, built-in or custom theme.
 *
 *  2. Voice reactivity — a `level` prop (0..1, or a zero-arg function
 *     returning 0..1 read once per animation frame) drives the fluid's
 *     drift speed and turbulence plus a gentle scale pulse, so the orb
 *     visibly "moves" with mic input while listening and with playback
 *     amplitude while speaking. Passing a function avoids any React
 *     re-renders on every audio frame — the caller can update a ref from
 *     an AudioWorklet/ScriptProcessor callback and the orb will read it
 *     directly in its own rAF loop. If `level` is omitted entirely the
 *     orb gently "breathes" on its own so it never looks static.
 */

import React, { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

export type FluidOrbLevel = number | (() => number)

export type FluidOrbProps = Omit<React.ComponentProps<'div'>, 'color'> & {
  /** Diameter in px used for the canvas's internal resolution (clamped to 2x DPR). */
  size?: number
  /** Explicit hex color, e.g. "#F75001". Omit to auto-theme from `--primary`. */
  color?: string
  /** CSS custom property to read when `color` is omitted. Defaults to `--primary`. */
  themeVar?: string
  /** 0..1 amplitude (or a getter for it) driving drift speed / turbulence / pulse. */
  level?: FluidOrbLevel
}

const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;
uniform float u_level;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.6;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  // Voice level speeds up the drift and deepens the turbulence so the
  // fluid visibly reacts to mic/playback amplitude in real time.
  float t = u_time * (0.22 + u_level * 0.55);
  float turb = 0.7 + u_level * 0.9;

  vec2 drift = vec2(
    sin(t) + 0.6 * sin(t * 1.7 + 1.3),
    cos(t * 0.8) + 0.6 * cos(t * 1.3 + 2.1)
  );

  vec2 p = vec2(uv.x * 1.8, uv.y * 1.0) + drift * turb;

  vec2 q = vec2(fbm(p + drift), fbm(p + vec2(3.2, 1.5) - drift));
  float f = fbm(p + (1.2 + u_level * 0.6) * q);

  float g = clamp(1.0 - uv.y, 0.0, 1.0);
  float anchor = smoothstep(0.0, 0.3, uv.y);
  float shade = clamp(g + (f - 0.5) * (0.8 + u_level * 0.3) * anchor, 0.0, 1.0);

  vec3 white = vec3(0.99, 1.0, 1.0);
  vec3 light = mix(white, u_color, 0.5);
  vec3 dark = u_color;

  vec3 col = white;
  col = mix(col, light, smoothstep(0.28, 0.52, shade));
  col = mix(col, dark, smoothstep(0.58, 0.88, shade));

  float edge = smoothstep(0.5, 0.49, distance(uv, vec2(0.5)));

  gl_FragColor = vec4(col * edge, edge);
}
`

const FALLBACK_RGB: [number, number, number] = [0.1, 0.45, 0.95]

function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.replace('#', '').trim()
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }
  const n = parseInt(h, 16)
  if (h.length !== 6 || Number.isNaN(n)) return null
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function rgbStringToRgb(rgb: string): [number, number, number] | null {
  const m = rgb.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
  if (!m) return null
  return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255]
}

/**
 * Resolves a CSS custom property (e.g. "--primary") to normalized RGB by
 * letting the browser do the color-space math: set an invisible probe
 * element's `color` to `var(--x)`, then read back the computed `color`,
 * which the browser always reports as `rgb()`/`rgba()` regardless of how
 * the variable itself was authored (oklch, hsl, hex, named, ...).
 */
function resolveCssVarToRgb(varName: string): [number, number, number] {
  if (typeof document === 'undefined') return FALLBACK_RGB
  try {
    const probe = document.createElement('span')
    probe.style.position = 'fixed'
    probe.style.opacity = '0'
    probe.style.pointerEvents = 'none'
    probe.style.color = `var(${varName})`
    document.body.appendChild(probe)
    const computed = getComputedStyle(probe).color
    document.body.removeChild(probe)
    return rgbStringToRgb(computed) ?? FALLBACK_RGB
  } catch {
    return FALLBACK_RGB
  }
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

const FluidOrb = ({
  size = 240,
  color,
  themeVar = '--primary',
  level,
  className,
  style,
  ...props
}: FluidOrbProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const colorRef = useRef<[number, number, number]>(color ? hexToRgb(color) ?? FALLBACK_RGB : FALLBACK_RGB)
  const uColorLocRef = useRef<WebGLUniformLocation | null>(null)
  const glRef = useRef<WebGLRenderingContext | null>(null)
  const levelRef = useRef<FluidOrbLevel | undefined>(level)
  const smoothedLevelRef = useRef(0)
  const lastFrameRef = useRef(0)

  useEffect(() => {
    levelRef.current = level
  }, [level])

  // Re-resolve the theme color whenever it might have changed: on mount,
  // whenever the explicit `color`/`themeVar` props change, and whenever
  // <html>'s class list changes (Osler's theme switcher toggles
  // `.dark`/`.light`/`.theme-<id>` classes there).
  useEffect(() => {
    if (color) {
      colorRef.current = hexToRgb(color) ?? FALLBACK_RGB
      const gl = glRef.current
      if (gl && uColorLocRef.current) gl.uniform3f(uColorLocRef.current, ...colorRef.current)
      return
    }
    const apply = () => {
      colorRef.current = resolveCssVarToRgb(themeVar)
      const gl = glRef.current
      if (gl && uColorLocRef.current) gl.uniform3f(uColorLocRef.current, ...colorRef.current)
    }
    apply()
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [color, themeVar])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl', { antialias: true, alpha: true })
    if (!gl) return
    glRef.current = gl

    const program = gl.createProgram()
    const vert = compile(gl, gl.VERTEX_SHADER, VERT)
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    if (!program || !vert || !frag) return

    gl.attachShader(program, vert)
    gl.attachShader(program, frag)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program))
      return
    }
    gl.useProgram(program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )
    const aPos = gl.getAttribLocation(program, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const uResolution = gl.getUniformLocation(program, 'u_resolution')
    const uTime = gl.getUniformLocation(program, 'u_time')
    const uColor = gl.getUniformLocation(program, 'u_color')
    const uLevel = gl.getUniformLocation(program, 'u_level')
    uColorLocRef.current = uColor
    gl.uniform3f(uColor, ...colorRef.current)

    const dpr = Math.min(window.devicePixelRatio || 1, size >= 160 ? 1.5 : 2)
    // The fluid is soft-edged by nature — 1.5x DPR on large orbs is
    // visually indistinguishable from 2x but halves the fragment cost,
    // which matters on integrated GPUs where full-rate fbm at 2x DPR
    // was the main source of voice-mode stutter.
    const px = Math.round(size * dpr)
    canvas.width = px
    canvas.height = px
    gl.viewport(0, 0, px, px)
    gl.uniform2f(uResolution, px, px)

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    lastFrameRef.current = start
    let raf = 0

    // Attack/release envelope rates (per second), normalised by elapsed
    // time so the feel is identical at 60/120/144Hz. Speech onsets rise
    // quickly (responsive); decays trail off slowly (calm — no flicker
    // between syllables, which read as stuttering before).
    const ATTACK_PER_SEC = 16
    const RELEASE_PER_SEC = 4.5

    const render = (now: number) => {
      // Resolve the current level: explicit number, a getter (read fresh
      // every frame, no re-render needed), or — if nothing was passed —
      // a slow idle "breathing" sine so the orb never looks inert.
      const raw = levelRef.current
      let target: number
      if (typeof raw === 'function') target = raw()
      else if (typeof raw === 'number') target = raw
      else target = 0.12 + 0.06 * Math.sin(now / 1400)
      target = Math.max(0, Math.min(1, target))
      // Perceptual curve: quiet speech still lifts the surface while loud
      // peaks don't slam it — keeps motion composed across mic gains.
      target = Math.sqrt(target)

      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameRef.current) / 1000))
      lastFrameRef.current = now
      const rate = target > smoothedLevelRef.current ? ATTACK_PER_SEC : RELEASE_PER_SEC
      smoothedLevelRef.current += (target - smoothedLevelRef.current) * Math.min(1, rate * dt)
      const lvl = smoothedLevelRef.current

      gl.uniform1f(uTime, reduce ? 0 : (now - start) / 1000)
      gl.uniform1f(uLevel, lvl)
      gl.drawArrays(gl.TRIANGLES, 0, 6)

      // A gentle scale pulse driven by the same level — this is what
      // makes the orb visibly "move" with voice, not just shade
      // differently. Applied directly to canvas style to avoid re-renders.
      if (wrapRef.current) {
        wrapRef.current.style.transform = `scale(${(1 + lvl * 0.08).toFixed(4)})`
      }

      if (!reduce || lvl > 0.02) raf = requestAnimationFrame(render)
    }
    render(start)

    return () => {
      cancelAnimationFrame(raf)
      gl.deleteProgram(program)
      gl.deleteShader(vert)
      gl.deleteShader(frag)
      gl.deleteBuffer(buffer)
    }
  }, [size])

  return (
    <div
      ref={wrapRef}
      data-slot="fluid-orb"
      className={cn('relative overflow-hidden rounded-full transition-transform will-change-transform', className)}
      style={{
        width: size,
        height: size,
        ...style,
      }}
      {...props}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  )
}

export default FluidOrb
