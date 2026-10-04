/**
 * SpeedPostEffect.ts - High-Speed Optical Velocity Streaks & Peripheral Aerodynamic Flow
 *
 * Provides visceral sensation of speed at high velocity (> 200 km/h):
 * 1. Zero center occlusion: The apex, car and racing line remain 100% crystal-clear.
 * 2. High-speed radial velocity streaks on the outer screen edges starting at 200 km/h.
 * 3. 0ms CPU time, executed in a single lightweight GPU fragment pass.
 */

import * as THREE from 'three';

export class SpeedPostEffect {
  public group: THREE.Group;
  private camera: THREE.Camera;
  private streakMesh: THREE.Mesh;
  private streakMaterial: THREE.ShaderMaterial;
  private time: number = 0;

  constructor(camera: THREE.Camera) {
    this.camera = camera;
    this.group = new THREE.Group();

    // Screen-space camera-aligned plane geometry
    const geo = new THREE.PlaneGeometry(2.0, 2.0);

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, -0.99, 1.0);
      }
    `;

    const fragmentShader = `
      uniform float uSpeedRatio;
      uniform float uTime;
      varying vec2 vUv;

      void main() {
        vec2 p = vUv - 0.5;
        float dist = length(p);

        // Center 72% of screen is completely pristine and crystal-clear
        if (dist < 0.35 || uSpeedRatio <= 0.01) {
          discard;
        }

        float angle = atan(p.y, p.x);
        // High-frequency radial aerodynamic flow streaks
        float streak1 = sin(angle * 56.0 + sin(angle * 16.0) * 3.0 + uTime * 42.0) * 0.5 + 0.5;
        streak1 = pow(streak1, 4.5);

        float streak2 = sin(angle * 32.0 - uTime * 28.0) * 0.5 + 0.5;
        streak2 = pow(streak2, 4.0);

        float edgeMask = smoothstep(0.38, 0.74, dist);
        float alpha = (streak1 * 0.7 + streak2 * 0.3) * edgeMask * uSpeedRatio * 0.30;

        // Subtle electric aerodynamic airflow tint on streaks
        vec3 streakColor = mix(vec3(0.85, 0.94, 1.0), vec3(1.0, 1.0, 1.0), streak1);
        gl_FragColor = vec4(streakColor, alpha);
      }
    `;

    this.streakMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uSpeedRatio: { value: 0.0 },
        uTime: { value: 0.0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.streakMesh = new THREE.Mesh(geo, this.streakMaterial);
    this.streakMesh.frustumCulled = false;
    this.streakMesh.renderOrder = 999;
    this.camera.add(this.streakMesh);
    this.group.add(this.camera);
  }

  public update(dt: number, speedKmh: number, isPaused: boolean): void {
    if (isPaused || speedKmh <= 200.0) {
      this.streakMaterial.uniforms.uSpeedRatio.value = 0;
      this.streakMesh.visible = false;
      return;
    }

    // Crescendo starting right at 200 km/h up to 340+ km/h
    const ratio = Math.min(1.0, (speedKmh - 200.0) / 130.0);
    const speedRatio = Math.pow(ratio, 1.25);

    this.time += dt * (1.0 + speedRatio * 3.5);
    this.streakMaterial.uniforms.uSpeedRatio.value = speedRatio;
    this.streakMaterial.uniforms.uTime.value = this.time;
    this.streakMesh.visible = speedRatio > 0.02;
  }

  public dispose(): void {
    if (this.streakMesh.parent) {
      this.streakMesh.parent.remove(this.streakMesh);
    }
    this.streakMaterial.dispose();
  }
}
