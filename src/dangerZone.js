// Безопасная зона вокруг дома: всё ВНУТРИ радиуса безопасно, всё снаружи —
// заражено. Стена красного тумана медленно сжимается со всех сторон, а игрок
// вне зоны получает урон раз в секунду.
import * as BABYLON from "@babylonjs/core";
import { damagePlayer } from "./entities.js";
import { getHeight } from "./noise.js";

// Цвет неба/тумана: обычный лес и заражённая зона. Держим их здесь же,
// чтобы небо менялось вместе со стеной заражения и окраской деревьев.
const SKY_NORMAL = new BABYLON.Color3(0.16, 0.18, 0.24);
const SKY_ACID = new BABYLON.Color3(0.10, 0.24, 0.06);

export class DangerZone {
  constructor(scene, player, hud, options = {}) {
    this.scene = scene;
    this.player = player;
    this.hud = hud;
    this.center = new BABYLON.Vector3(options.x ?? 0, 0, options.z ?? 0);
    this.startRadius = options.startRadius ?? 55;
    this.targetRadius = options.targetRadius ?? 18;
    this.radius = this.startRadius;
    this.duration = options.duration ?? 150;
    this.elapsed = 0;
    this.damageTimer = 0;
    this.damageInterval = 1;
    this.damage = options.damage ?? 1.2;
    this.warned = false;
    this.terrain = options.terrain ?? null;
    this.skyMix = 0; // 0 — обычное небо, 1 — кислотное

    // Тонкая линия по рельефу у основания стены — чтобы граница читалась и
    // под ногами, когда туман за спиной или за деревьями.
    const ringMat = new BABYLON.StandardMaterial("zoneSafeMat", scene);
    ringMat.diffuseColor = new BABYLON.Color3(0.08, 0.3, 0.04);
    ringMat.emissiveColor = new BABYLON.Color3(0.5, 1.0, 0.18);
    ringMat.alpha = 0.8;
    ringMat.disableLighting = true;
    ringMat.fogEnabled = false;
    ringMat.backFaceCulling = false;
    ringMat.disableDepthWrite = true;
    this.SEGS = 128;
    this.linePositions = new Float32Array((this.SEGS + 1) * 2 * 3);
    this.lineIndices = [];
    for (let i = 0; i < this.SEGS; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      this.lineIndices.push(a, b, c, c, b, d);
    }
    const vd = new BABYLON.VertexData();
    vd.positions = this.linePositions; vd.indices = this.lineIndices;
    this.ring = new BABYLON.Mesh("dangerZoneRing", scene);
    vd.applyToMesh(this.ring, true);
    this.ring.material = ringMat;
    this.ring.isPickable = false;
    this.lineT = 1;

    // Стена заражения — высокая стена красного тумана, видимая с ОБЕИХ сторон.
    // Плотнее к земле и растворяется кверху: изнутри видно, как она надвигается.
    this.wallHeight = options.wallHeight ?? 18;
    // Стена уходит под землю: рельеф местами ниже нуля, и без «юбки» под
    // стеной оставалась щель. Подземную часть скрывает сам рельеф.
    this.wallDepth = options.wallDepth ?? 16;
    const totalH = this.wallHeight + this.wallDepth;
    const visible = this.wallHeight / totalH; // доля градиента над землёй
    const grad = new BABYLON.DynamicTexture("zoneWallGrad",
      { width: 8, height: 256 }, scene, false);
    const g = grad.getContext();
    const lg = g.createLinearGradient(0, 0, 0, 256);
    lg.addColorStop(0.0, "rgba(255,255,255,0.10)");
    lg.addColorStop(0.3 * visible, "rgba(255,255,255,0.55)");
    lg.addColorStop(0.72 * visible, "rgba(255,255,255,0.95)");
    lg.addColorStop(visible, "rgba(255,255,255,0.40)");
    lg.addColorStop(1.0, "rgba(255,255,255,0.40)");
    g.fillStyle = lg; g.fillRect(0, 0, 8, 256);
    grad.update();
    grad.wrapU = grad.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;

    const wallMat = new BABYLON.StandardMaterial("zoneWallMat", scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.1, 0.25, 0.02);
    wallMat.emissiveColor = new BABYLON.Color3(0.35, 0.85, 0.06);
    wallMat.specularColor = BABYLON.Color3.Black();
    wallMat.disableLighting = true; // стена светится сама, не зависит от солнца
    wallMat.fogEnabled = false;     // не растворяется в синем тумане сцены
    wallMat.backFaceCulling = false; // видна и изнутри, и снаружи
    wallMat.disableDepthWrite = true;
    wallMat.opacityTexture = grad;
    wallMat.alpha = 0.62;
    this.wall = BABYLON.MeshBuilder.CreateCylinder("dangerZoneWall", {
      diameter: 2, height: totalH, tessellation: 96,
      cap: BABYLON.Mesh.NO_CAP,
    }, scene);
    this.wall.material = wallMat;
    this.wall.isPickable = false;
    // Верх остаётся на wallHeight, низ уходит на -wallDepth.
    this.wall.position.set(this.center.x, this.wallHeight - totalH / 2, this.center.z);

    this.rebuildLine();
    this.applyVisuals(0);
  }

  rebuildLine() {
    const r = this.radius, p = this.linePositions, half = 0.12;
    for (let i = 0; i <= this.SEGS; i++) {
      const a = i / this.SEGS * Math.PI * 2;
      const cs = Math.cos(a), sn = Math.sin(a);
      for (let side = 0; side < 2; side++) {
        const rr = r + (side === 0 ? -half : half);
        const x = this.center.x + cs * rr, z = this.center.z + sn * rr;
        const o = (i * 2 + side) * 3;
        p[o] = x; p[o + 1] = getHeight(x, z) + 0.14; p[o + 2] = z;
      }
    }
    this.ring.updateVerticesData(BABYLON.VertexBuffer.PositionKind, this.linePositions);
  }

  applyVisuals(dt = 0) {
    this.wall.scaling.set(this.radius, 1, this.radius);
    this.lineT += dt;
    if (this.lineT >= 0.12) { this.lineT = 0; this.rebuildLine(); }
    const pulse = 0.85 + 0.15 * Math.sin(this.elapsed * 1.7);
    this.wall.material.alpha = 0.55 + 0.12 * pulse;
    this.ring.material.emissiveColor.set(0.5 * pulse, 1.0 * pulse, 0.18 * pulse);
  }

  isOutside(x, z) {
    return Math.hypot(x - this.center.x, z - this.center.z) > this.radius;
  }

  // Плавно красим небо (clearColor) и туман в цвет заражения. У импостеров
  // дальнего леса свой ShaderMaterial с закэшированным vFogColor — его тоже
  // обновляем, иначе дальние деревья останутся в серой дымке.
  updateSky(outside, dt) {
    const target = outside ? 1 : 0;
    this.skyMix += (target - this.skyMix) * Math.min(1, dt * 1.1);
    if (Math.abs(this.skyMix - target) < 0.002) this.skyMix = target;
    const fog = this.scene.fogColor;
    BABYLON.Color3.LerpToRef(SKY_NORMAL, SKY_ACID, this.skyMix, fog);
    const c = this.scene.clearColor;
    c.set(fog.r, fog.g, fog.b, 1);
    if (this.terrain) {
      for (const m of [this.terrain.treeMat, this.terrain.bushMat,
        this.terrain.infTreeMat, this.terrain.infBushMat]) {
        m?.setColor3?.("vFogColor", fog);
      }
    }
  }

  update(dt) {
    this.elapsed += dt;
    const progress = Math.min(1, this.elapsed / this.duration);
    this.radius = this.startRadius + (this.targetRadius - this.startRadius) * progress;
    this.applyVisuals(dt);

    const outside = this.isOutside(this.player.mesh.position.x, this.player.mesh.position.z);
    this.updateSky(outside, dt);
    if (outside) {
      this.damageTimer += dt;
      if (this.damageTimer >= this.damageInterval) {
        this.damageTimer = 0;
        damagePlayer(this.player, this.damage, this.hud);
        if (!this.warned) {
          this.warned = true;
          // Сигнал тревоги через общий toast-механизм игры.
          this.onOutside?.(true);
        }
      }
    } else {
      this.damageTimer = 0;
      this.warned = false;
    }
    return outside;
  }
}
