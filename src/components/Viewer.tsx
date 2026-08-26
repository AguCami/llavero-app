import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface ViewerHandle {
  resetView(): void;
}

interface ViewerProps {
  model: Group | null;
  showBed: boolean;
  ref?: Ref<ViewerHandle>;
}

/** Lado de la cama de impresión de referencia, en mm. */
const BED_SIZE = 220;

export function Viewer({ model, showBed, ref }: ViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const bedRef = useRef<Group | null>(null);
  const modelRef = useRef<Group | null>(null);

  const frameModel = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const current = modelRef.current;
    if (!camera || !controls) return;
    const box = current ? new Box3().setFromObject(current) : null;
    const sphere = box && !box.isEmpty() ? box.getBoundingSphere(new Sphere()) : new Sphere(new Vector3(), 40);
    const radius = Math.max(sphere.radius, 10);
    const distance = radius / Math.sin((camera.fov * Math.PI) / 360);
    const dir = new Vector3(0.35, -0.9, 0.75).normalize();
    camera.position.copy(sphere.center).addScaledVector(dir, distance * 1.25);
    camera.near = distance / 100;
    camera.far = distance * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(sphere.center);
    controls.update();
  };

  useImperativeHandle(ref, () => ({ resetView: frameModel }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const scene = new Scene();
    scene.background = new Color('#11141b');
    sceneRef.current = scene;

    const camera = new PerspectiveCamera(38, 1, 0.5, 4000);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.98;
    controlsRef.current = controls;

    scene.add(new AmbientLight('#ffffff', 1.4));
    const key = new DirectionalLight('#ffffff', 2.6);
    key.position.set(60, -90, 140);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 500;
    key.shadow.camera.left = -160;
    key.shadow.camera.right = 160;
    key.shadow.camera.top = 160;
    key.shadow.camera.bottom = -160;
    key.shadow.bias = -0.0008;
    scene.add(key);
    const fill = new DirectionalLight('#9fb6ff', 0.7);
    fill.position.set(-120, 60, 60);
    scene.add(fill);

    const bed = new Group();
    const grid = new GridHelper(BED_SIZE, 22, 0x3d4a63, 0x232a38);
    grid.rotation.x = Math.PI / 2;
    bed.add(grid);
    const floor = new Mesh(
      new PlaneGeometry(BED_SIZE * 3, BED_SIZE * 3),
      new MeshStandardMaterial({ color: '#141922', roughness: 1 }),
    );
    floor.position.z = -0.05;
    floor.receiveShadow = true;
    bed.add(floor);
    scene.add(bed);
    bedRef.current = bed;

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      if (!clientWidth || !clientHeight) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (modelRef.current) scene.remove(modelRef.current);
    modelRef.current = model;
    if (model) scene.add(model);
  }, [model]);

  useEffect(() => {
    if (bedRef.current) bedRef.current.visible = showBed;
  }, [showBed]);

  return <div className="viewer" ref={containerRef} />;
}
