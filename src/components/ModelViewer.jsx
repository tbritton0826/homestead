import { Canvas, useLoader } from "@react-three/fiber";
import { OrbitControls, Stage } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

function STLModel({ url }) {
  const geometry = useLoader(STLLoader, url);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial />
    </mesh>
  );
}

export default function ModelViewer({ modelPath }) {
  if (!modelPath) {
    return <div>No STL selected.</div>;
  }

  return (
    <div className="model-viewer-shell">
      <Canvas camera={{ position: [0, 0, 100], fov: 45 }}>
        <ambientLight intensity={0.8} />
        <Stage environment={null}>
          <STLModel url={modelPath} />
        </Stage>
        <OrbitControls />
      </Canvas>
    </div>
  );
}