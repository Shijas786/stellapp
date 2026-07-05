'use client';

import React, { useEffect, useRef } from 'react';

interface DarkVeilProps {
  hueShift?: number;
  noiseIntensity?: number;
  scanlineIntensity?: number;
  speed?: number;
  scanlineFrequency?: number;
  warpAmount?: number;
  resolutionScale?: number;
}

export default function DarkVeil({
  hueShift = 130,
  noiseIntensity = 0,
  scanlineIntensity = 0,
  speed = 2,
  scanlineFrequency = 50,
  warpAmount = 0.65,
  resolutionScale = 1,
}: DarkVeilProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl');
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }

    // Vertex Shader
    const vsSource = `
      attribute vec2 position;
      varying vec2 uv;
      void main() {
        uv = position * 0.5 + 0.5;
        uv.y = 1.0 - uv.y;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    // Fragment Shader
    const fsSource = `
      precision highp float;
      varying vec2 uv;
      uniform float time;
      uniform float hueShift;
      uniform float noiseIntensity;
      uniform float scanlineIntensity;
      uniform float scanlineFrequency;
      uniform float warpAmount;

      // Hue Shift function
      vec3 hueShiftFn(vec3 color, float angle) {
        float angleRad = radians(angle);
        float k1 = cos(angleRad);
        float k2 = sin(angleRad);
        vec3 k = vec3(0.57735, 0.57735, 0.57735);
        return color * k1 + cross(k, color) * k2 + k * dot(k, color) * (1.0 - k1);
      }

      // Simple 2D Noise
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise2D(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
                   mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
      }

      void main() {
        // Domain warping
        vec2 warpUV = uv;
        float warpX = noise2D(uv * 3.0 + time * 0.15);
        float warpY = noise2D(uv * 3.0 - time * 0.15);
        
        warpUV += vec2(warpX, warpY) * warpAmount * 0.15;

        // Base atmospheric veil
        float n1 = noise2D(warpUV * 2.0 + vec2(time * 0.08, time * 0.04));
        float n2 = noise2D(warpUV * 4.0 - vec2(time * 0.05, time * 0.09));
        float combinedNoise = (n1 * 0.6 + n2 * 0.4);

        // Core base color (brightened for high-contrast visibility on dark themes)
        vec3 baseColor = vec3(0.08, 0.2, 0.1) + vec3(0.15, 0.35, 0.2) * combinedNoise;
        
        // Apply rotation
        vec3 finalColor = hueShiftFn(baseColor, hueShift);

        // Scanlines CRT effect
        if (scanlineIntensity > 0.0) {
          float scanline = sin(uv.y * scanlineFrequency * 6.28318) * 0.5 + 0.5;
          finalColor -= scanline * scanlineIntensity * 0.15;
        }

        // Grain
        if (noiseIntensity > 0.0) {
          float grain = hash(uv + time) * 2.0 - 1.0;
          finalColor += grain * noiseIntensity * 0.03;
        }

        finalColor = max(finalColor, vec3(0.015, 0.015, 0.02));

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `;

    function loadShader(gl: WebGLRenderingContext, type: number, source: string) {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vs = loadShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    const timeLoc = gl.getUniformLocation(program, 'time');
    const hueShiftLoc = gl.getUniformLocation(program, 'hueShift');
    const noiseIntensityLoc = gl.getUniformLocation(program, 'noiseIntensity');
    const scanlineIntensityLoc = gl.getUniformLocation(program, 'scanlineIntensity');
    const scanlineFrequencyLoc = gl.getUniformLocation(program, 'scanlineFrequency');
    const warpAmountLoc = gl.getUniformLocation(program, 'warpAmount');

    let animationFrameId: number;
    const resizeCanvas = () => {
      const width = Math.floor(canvas.clientWidth * resolutionScale);
      const height = Math.floor(canvas.clientHeight * resolutionScale);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const startTime = Date.now();
    const render = () => {
      resizeCanvas();

      const elapsedSeconds = (Date.now() - startTime) / 1000.0;
      gl.uniform1f(timeLoc, elapsedSeconds * speed);
      gl.uniform1f(hueShiftLoc, hueShift);
      gl.uniform1f(noiseIntensityLoc, noiseIntensity);
      gl.uniform1f(scanlineIntensityLoc, scanlineIntensity);
      gl.uniform1f(scanlineFrequencyLoc, scanlineFrequency);
      gl.uniform1f(warpAmountLoc, warpAmount);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(positionBuffer);
    };
  }, [hueShift, noiseIntensity, scanlineIntensity, speed, scanlineFrequency, warpAmount, resolutionScale]);

  return (
    <canvas 
      ref={canvasRef} 
      style={{ 
        width: '100%', 
        height: '100%', 
        display: 'block',
        position: 'absolute',
        top: 0,
        left: 0,
      }} 
    />
  );
}
