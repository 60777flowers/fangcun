const GROUND = 1.0;                       // 草地顶面 y（体素 (x,0,z) 占据 [0,1]）

/* ============================================================
   6. 角色（3D 验证版）
      目的：证明"3D 角色"这条管线能直接接进现有渲染架构
      模型：three.js 官方示例 RobotExpressive.glb（占位，非最终美术）
      最终接入方式见 docs/DEV.md §8（VRM/glTF + character.json）
   ============================================================ */
const CHAR_SLOTS = [
  { name:'大肥鱼', x:CX-0.2, z:CZ+3.4, anim:'Idle',    face: 0.18 },
  { name:'?',      x:CX+2.8, z:CZ+3.9, anim:'Walking', face:-0.22 },
];
const mixers = [];
const CHAR_H = 2.4;                       // 目标身高（方块单位）

new GLTFLoader().load('./assets/RobotExpressive.glb', (gltf) => {
  const src = gltf.scene;
  // 归一化到目标身高，脚底落在 y=0
  const box0 = new THREE.Box3().setFromObject(src);
  const h0 = box0.max.y - box0.min.y;
  const k = CHAR_H / h0;

  CHAR_SLOTS.forEach((slot) => {
    const model = SkeletonUtils.clone(src);
    model.scale.setScalar(k);
    const box = new THREE.Box3().setFromObject(model);
    model.position.set(slot.x, GROUND - box.min.y, slot.z);
    model.rotation.y = slot.face;
    model.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    });
    scene.add(model);

    const mixer = new THREE.AnimationMixer(model);
    const clip = gltf.animations.find(a => a.name === slot.anim) || gltf.animations[0];
    if (clip) {
      const act = mixer.clipAction(clip);
      act.time = Math.random() * clip.duration;   // 错开相位
      act.play();
    }
    mixers.push(mixer);

    // 胶囊接触影
    const sm = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 24),
      new THREE.MeshBasicMaterial({ color:0x1c1208, transparent:true, opacity:0.30, depthWrite:false })
    );
    sm.rotation.x = -Math.PI/2;
    sm.position.set(slot.x, GROUND + 0.015, slot.z);
    scene.add(sm);
  });
  window.__CHAR3D__ = { ok:true, clips: gltf.animations.map(a => a.name), slots: CHAR_SLOTS.length };
  console.log('3D characters ready', window.__CHAR3D__);
}, undefined, (err) => {
  window.__CHAR3D__ = { ok:false, error:String(err) };
  console.warn('3D 模型加载失败，退回胶囊占位', err);
  CHAR_SLOTS.forEach(slot => {
    const cap = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, CHAR_H - 0.7, 6, 12),
      new THREE.MeshStandardMaterial({ color:0x3f86d8, roughness:0.7 })
    );
    cap.position.set(slot.x, GROUND + CHAR_H/2, slot.z);
    cap.castShadow = true;
    scene.add(cap);
  });
});

