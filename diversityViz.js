// diversityViz.js

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';
import { VRButton } from './VRButton.js';
import { XRControllerModelFactory } from './XRControllerModelFactory.js';

export class DiversityVisualizer {
  constructor(container) {
    this.container = container;
    this.people = [];
    this.controllers = [];
    this.dragging = null;

    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      controller.addEventListener('selectstart', this._onSelectStart.bind(this));
      controller.addEventListener('selectend', this._onSelectEnd.bind(this));
      this.scene.add(controller);
      this.controllers.push(controller);

      const controllerGrip = this.renderer.xr.getControllerGrip(i);
      const controllerModelFactory = new XRControllerModelFactory();
      controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip));
      this.scene.add(controllerGrip);
    }

    // VR SLIDER SETUP
    const trackGeometry = new THREE.BoxGeometry(1, 0.02, 0.02);
    const trackMaterial = new THREE.MeshBasicMaterial({ color: 0x888888 });
    this.sliderTrack = new THREE.Mesh(trackGeometry, trackMaterial);
    this.scene.add(this.sliderTrack);
    this.sliderTrack.position.set(0, 1.5, -2);

    const thumbGeometry = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    const thumbMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    this.sliderThumb = new THREE.Mesh(thumbGeometry, thumbMaterial);
    this.scene.add(this.sliderThumb);
    this.sliderThumb.position.set(0, 1.5, -2);

    this.highlighted = null;
    this.mouse = new THREE.Vector2();
    this.lastProgress = 0;

    this.config = {
      clustering: {
        centerAttraction: 0.001,
        minSeparation: 2.0,
        attractionStrength: 0.25,
        repulsionStrength: 0.25,
        globalStrength: 0.1,
        damping: 0.55
      },
      raceColors: [0x588157, 0x3a7ca5, 0xef476f, 0xffc857],
      raceLabels: ['Green', 'Blue', 'Red', 'Yellow'],
      ageHeights: [0.2, 0.5, 1.0],
      ageLabels: ['Young', 'Middle', 'Older'],
      eduLabels: ['None', 'Medium', 'High'],
      cols: 10,
      rows: 10,
      spacing: 2
    };

    this.totalPeople = this.config.cols * this.config.rows;
    this._initScene();
    this._initPeople();
    this._animate();
    this._addEventListeners();


    this.renderer.xr.enabled = true;
    document.body.appendChild(VRButton.createButton(this.renderer));
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
    this.camera.position.set(20, 20, 20);
    this.camera.lookAt(0, 0, 0);

    this.raycaster = new THREE.Raycaster();
    this.renderer = new THREE.WebGLRenderer();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.container.appendChild(this.renderer.domElement);

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(10, 10, 10);
    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0x404040));

    const axesHelper = new THREE.AxesHelper(10);
    this.scene.add(axesHelper);
  }

  _initPeople() {
    const { raceColors, ageHeights, cols, rows, spacing } = this.config;
    const finalDistribution = [0.9, 0.05, 0.03, 0.02];
    const finalCounts = finalDistribution.map(p => Math.floor(p * this.totalPeople));
    while (finalCounts.reduce((a, b) => a + b, 0) < this.totalPeople) finalCounts[0]++;

    const originalRaceIndices = Array.from({ length: this.totalPeople }, () => Math.floor(Math.random() * raceColors.length));

    const targetRaceIndices = [];
    finalCounts.forEach((count, raceIndex) => {
      for (let i = 0; i < count; i++) targetRaceIndices.push(raceIndex);
    });
    for (let i = targetRaceIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [targetRaceIndices[i], targetRaceIndices[j]] = [targetRaceIndices[j], targetRaceIndices[i]];
    }

    for (let i = 0; i < this.totalPeople; i++) {
      const ageIndex = Math.floor(Math.random() * ageHeights.length);
      const educationLevel = Math.floor(Math.random() * 3);
      const x = (i % cols - cols / 2) * spacing;
      const z = (Math.floor(i / cols) - rows / 2) * spacing;
      this.people.push(new Person(i, originalRaceIndices[i], targetRaceIndices[i], ageIndex, 0, educationLevel, 2, x, z, this));
    }
  }

  _animate() {
    // requestAnimationFrame(() => this._animate());
    this.renderer.setAnimationLoop(this._animate.bind(this));

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.people.map(p => p.mesh));

    if (this.highlighted) this.highlighted.mesh.material.emissive.setHex(0x000000);

    const newlyHighlighted = intersects.length > 0 ? this.people.find(p => p.mesh === intersects[0].object) : null;

    if (newlyHighlighted !== this.highlighted) {
      this.highlighted = newlyHighlighted;

      if (this.highlighted) {
        this.highlighted.mesh.material.emissive.setHex(0x444444);
        const data = this.highlighted.getDisplayData();
        window.parent.postMessage({ type: 'hover-info', data }, '*');
      } else {
        window.parent.postMessage({ type: 'hover-info', data: null }, '*');
      }
    }

    this.people.forEach(p => p.applyClusteringForce(this.lastProgress));
    if (this.dragging) {
      const controller = this.controllers.find(c => c.userData.dragging);
      if (controller) {
        const position = new THREE.Vector3();
        position.setFromMatrixPosition(controller.matrixWorld);

        // Constrain thumb's x movement between -0.5 and +0.5
        const minX = -0.5;
        const maxX = 0.5;
        this.dragging.position.x = THREE.MathUtils.clamp(position.x, minX, maxX);

        // Keep y/z fixed
        this.dragging.position.y = this.sliderTrack.position.y;
        this.dragging.position.z = this.sliderTrack.position.z;

        // Map thumb x-position to slider progress (0 to 1)
        const normalizedValue = (this.dragging.position.x - minX) / (maxX - minX);
        this.update(normalizedValue);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  _addEventListeners() {
    window.addEventListener("mousemove", event => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    });
  }

  _onSelectStart(event) {
      const controller = event.target;
      const intersections = this._getIntersections(controller);

      if (intersections.length > 0) {
        this.dragging = intersections[0].object;
        controller.userData.dragging = this.dragging;
      }
    }

  _onSelectEnd(event) {
    const controller = event.target;
    if (controller.userData.dragging) {
      controller.userData.dragging = undefined;
      this.dragging = undefined;
    }
  }

  _getIntersections(controller) {
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(controller.matrixWorld);

    const raycaster = new THREE.Raycaster();
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    return raycaster.intersectObject(this.sliderThumb);
  }

  update(progress) {
    this.lastProgress = progress;
    this.people.forEach(p => p.update(progress));
  }
}

class Person {
  constructor(index, originalRace, targetRace, ageIndex, targetAgeIndex, educationLevel, targetEducationLevel, x, z, viz) {
    this.index = index;
    this.originalRace = originalRace;
    this.targetRace = targetRace;
    this.ageIndex = ageIndex;
    this.targetAgeIndex = targetAgeIndex;
    this.educationLevel = educationLevel;
    this.targetEducationLevel = targetEducationLevel;
    this.viz = viz;

    this.x = x;
    this.z = z;
    this.velocity = new THREE.Vector2();
    this.position2D = new THREE.Vector2(x, z);
    this.originalPosition = this.position2D.clone();

    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 32);
    const material = new THREE.MeshStandardMaterial({ color: viz.config.raceColors[this.originalRace], emissive: 0x000000 });
    this.mesh = new THREE.Mesh(geometry, material);
    viz.scene.add(this.mesh);

    this.eduMesh = this.createEducationMesh(this.educationLevel);
    viz.scene.add(this.eduMesh);
  }

createEducationMesh(level) {
  const emojiMap = ['‍🏭', '✏️', '🎓'];
  const emoji = emojiMap[level] || '❓';

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // 🔥 No background fill — fully transparent canvas
  ctx.clearRect(0, 0, size, size);

  ctx.font = '96px serif';
  // ctx.font = '48px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'black'; // or 'white' if the emoji is too dark
  ctx.fillText(emoji, size / 2, size / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.5, 0.5, 0.5);

  return sprite;
}

  applyClusteringForce(progress) {
    const cfg = this.viz.config.clustering;
    const pos = this.position2D;
    const vel = this.velocity;
    let force = new THREE.Vector2();
    const strength = progress * cfg.globalStrength;

    for (const other of this.viz.people) {
      if (other === this) continue;
      const delta = other.position2D.clone().sub(pos);
      const dist = delta.length();
      const distSq = dist * dist + 0.01;
      const dir = delta.normalize();

      if (dist < cfg.minSeparation) {
        force.sub(dir.multiplyScalar(0.1 * (cfg.minSeparation - dist)));
        continue;
      }
      if (other.originalRace === this.originalRace) {
        force.add(dir.multiplyScalar(cfg.attractionStrength * strength / distSq));
      } else {
        force.sub(dir.multiplyScalar(cfg.repulsionStrength * strength / distSq));
      }
    }

    const toCenter = new THREE.Vector2(0, 0).sub(pos);
    force.add(toCenter.multiplyScalar(cfg.centerAttraction));

    vel.add(force);
    vel.multiplyScalar(cfg.damping);
    pos.add(vel);

    this.x = pos.x;
    this.z = pos.y;
    this.mesh.position.set(this.x, this.getHeight() / 2, this.z);
    this.eduMesh.position.set(this.x, this.getHeight() + 0.1, this.z);
  }

  update(progress) {
    const threshold = this.index / this.viz.totalPeople;
    const raceIndex = progress >= threshold ? this.targetRace : this.originalRace;
    const ageIndex = progress >= threshold ? this.targetAgeIndex : this.ageIndex;
    const eduLevel = progress >= threshold ? this.targetEducationLevel : this.educationLevel;

    const height = this.viz.config.ageHeights[ageIndex];
    this.mesh.material.color.setHex(this.viz.config.raceColors[raceIndex]);
    this.mesh.scale.y = height / 0.2;
    this.mesh.position.y = height / 2;

    this.viz.scene.remove(this.eduMesh);
    this.eduMesh = this.createEducationMesh(eduLevel);
    this.eduMesh.position.set(this.x, height + 0.1, this.z);
    this.viz.scene.add(this.eduMesh);
  }

  getHeight() {
    return this.viz.config.ageHeights[this.ageIndex];
  }

  getDisplayData() {
    const { raceLabels, ageLabels, eduLabels } = this.viz.config;
    return {
      index: this.index,
      race: raceLabels[this.originalRace],
      age: ageLabels[this.ageIndex],
      education: eduLabels[this.educationLevel]
    };
  }
} 
