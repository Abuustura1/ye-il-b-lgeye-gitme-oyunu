// game.js — Güncelleme: hedef disk kaldırıldı; hedef artık küçük bir küp (box).
// Oyuncu küre (top) olarak kalıyor. Kazanma kontrolü target box <-> player sphere ile robust şekilde yapıldı.

(() => {
  // === AYARLAR ===
  let cubeSize = 60;
  const playerRadius = 0.6;
  const playerHeight = playerRadius * 2;
  let targetSize = 1.2;       // hedef küpün bir kenarı
  const baseMoveSpeed = 0.16;
  const jumpStrength = 0.36;
  const gravity = -0.03;

  // Engeller rastgeleleştirme ayarları
  const gridSize = 12;
  const obstacleFillProb = 0.50;
  const obstacleAttemptsPerCell = 3;
  const minObstacleSize = 2.0;
  const maxObstacleSize = 5.0;
  const movingObstacleRatio = 0.18;

  // === SAHNE, KAMERA, RENDERER ===
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.1, 2000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.getElementById('game').appendChild(renderer.domElement);

  // === IŞIKLAR (sönük) ===
  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);
  const p1 = new THREE.PointLight(0x66ccff, 0.18, 200);
  p1.position.set(12, 28, -8);
  scene.add(p1);
  const p2 = new THREE.PointLight(0xff99cc, 0.15, 200);
  p2.position.set(-18, 18, 18);
  scene.add(p2);
  const hemi = new THREE.HemisphereLight(0x7788ff, 0x332233, 0.10);
  scene.add(hemi);

  // === OYUN NESNELERİ ===
  let room, floor;
  let player, target;
  let obstacles = [];
  let movingObstacles = [];
  let initialObstacleStates = [];

  // HUD
  const statusEl = document.getElementById('statusMessage');
  const modeEl = document.getElementById('mode');

  // Kamera modu
  let cameraMode = 'follow';
  function updateModeLabel(){ modeEl.textContent = 'Kamera: ' + (cameraMode === 'follow' ? 'Arkadan takip' : 'Yukarıdan görünüş'); }
  updateModeLabel();

  // === ODA & ZEMİN ===
  function createRoom(){
    if (room) { scene.remove(room); room.geometry.dispose(); room.material.dispose(); room = null; }
    if (floor) { scene.remove(floor); floor.geometry.dispose(); floor.material.dispose(); floor = null; }

    const cubeGeom = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
    const cubeMat = new THREE.MeshStandardMaterial({ color: 0x151427, side: THREE.BackSide, roughness: 0.9, metalness: 0.05 });
    room = new THREE.Mesh(cubeGeom, cubeMat);
    scene.add(room);

    const floorGeom = new THREE.PlaneGeometry(cubeSize - 0.2, cubeSize - 0.2);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x11101a, roughness: 1 });
    floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI/2;
    floor.position.y = -cubeSize/2 + 0.01;
    scene.add(floor);
  }

  // === OYUNCU (küre/top) ve HEDEF (küp) ===
  function createPlayerAndTarget(){
    const groundY = -cubeSize/2 + 0.01;

    // player: sphere (top)
    if (player) { scene.remove(player); player.geometry.dispose(); player.material.dispose(); player = null; }
    const playerGeom = new THREE.SphereGeometry(playerRadius, 32, 32);
    const playerMat = new THREE.MeshStandardMaterial({ color: 0x0077ff, roughness: 0.25, metalness: 0.05 });
    player = new THREE.Mesh(playerGeom, playerMat);
    player.position.set(0, groundY + playerRadius, cubeSize/2 - 3);
    scene.add(player);
    player.userData.baseY = player.position.y;

    // target: küçük bir küp (box). Pozisyonu createRandomObstaclesWithRandomTarget içinde rastgele atanır,
    // burada sadece nesne yaratılıyor.
    if (target) { scene.remove(target); target.geometry.dispose(); target.material.dispose(); target = null; }
    const targetGeom = new THREE.BoxGeometry(targetSize, targetSize, targetSize);
    const targetMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x1b8a3a, emissiveIntensity: 0.35 });
    target = new THREE.Mesh(targetGeom, targetMat);
    // temp pozisyon (gerçek pozisyon createRandomObstaclesWithRandomTarget tarafından set edilecek)
    target.position.set(0, groundY + targetSize/2, - (cubeSize/2 - 3));
    scene.add(target);
  }

  // === RASTGELE HEDEF + ENGELLER (hedef artık box) ===
  function worldToGrid(worldVec){
    const half = cubeSize / 2;
    const cellSize = (cubeSize - 2.0) / gridSize;
    const cellStartX = -half + 1.0 + cellSize/2;
    const cellStartZ = -half + 1.0 + cellSize/2;
    const gx = Math.max(0, Math.min(gridSize-1, Math.floor((worldVec.x - cellStartX + cellSize/2) / cellSize)));
    const gz = Math.max(0, Math.min(gridSize-1, Math.floor((worldVec.z - cellStartZ + cellSize/2) / cellSize)));
    return { x: gx, z: gz };
  }
  function gridToWorld(gx, gz){
    const half = cubeSize / 2;
    const cellSize = (cubeSize - 2.0) / gridSize;
    const cellStartX = -half + 1.0 + cellSize/2;
    const cellStartZ = -half + 1.0 + cellSize/2;
    const wx = cellStartX + gx * cellSize;
    const wz = cellStartZ + gz * cellSize;
    return { x: wx, z: wz };
  }
  function generatePathGrid(start, target){
    let cur = { x: start.x, z: start.z };
    const path = [];
    const visited = new Set();
    path.push({x:cur.x,z:cur.z});
    visited.add(`${cur.x},${cur.z}`);
    const maxSteps = gridSize * gridSize * 6;
    let steps = 0;
    while ((cur.x !== target.x || cur.z !== target.z) && steps < maxSteps){
      steps++;
      const dx = target.x - cur.x;
      const dz = target.z - cur.z;
      const neighbors = [];
      if (dx !== 0) neighbors.push({x: cur.x + Math.sign(dx), z: cur.z});
      if (dz !== 0) neighbors.push({x: cur.x, z: cur.z + Math.sign(dz)});
      if (Math.random() < 0.35) {
        const perp = (Math.random() < 0.5) ? {x: cur.x+1, z: cur.z} : {x: cur.x-1, z: cur.z};
        neighbors.push(perp);
      }
      if (Math.random() < 0.2) {
        neighbors.push({x: cur.x, z: cur.z+1});
        neighbors.push({x: cur.x, z: cur.z-1});
      }
      const cand = neighbors.filter(n => n.x >= 0 && n.x < gridSize && n.z >= 0 && n.z < gridSize && !visited.has(`${n.x},${n.z}`));
      let next;
      if (cand.length === 0) {
        const allN = [
          {x:cur.x+1,z:cur.z},{x:cur.x-1,z:cur.z},{x:cur.x,z:cur.z+1},{x:cur.x,z:cur.z-1}
        ].filter(n => n.x>=0 && n.x<gridSize && n.z>=0 && n.z<gridSize);
        next = allN[Math.floor(Math.random()*allN.length)];
      } else {
        next = cand[Math.floor(Math.random()*cand.length)];
      }
      cur = { x: next.x, z: next.z };
      visited.add(`${cur.x},${cur.z}`);
      path.push({x: cur.x, z: cur.z});
      if (path.length > gridSize * gridSize * 3) break;
    }
    if (!visited.has(`${target.x},${target.z}`)) path.push({x:target.x,z:target.z});
    return path;
  }
  function addProtectedNeighbors(set, cell, radius){
    for (let dx=-radius; dx<=radius; dx++){
      for (let dz=-radius; dz<=radius; dz++){
        const nx = cell.x + dx; const nz = cell.z + dz;
        if (nx>=0 && nx<gridSize && nz>=0 && nz<gridSize) set.add(`${nx},${nz}`);
      }
    }
  }
  function randRange(a,b){ return a + Math.random()*(b-a); }

  function createRandomObstaclesWithRandomTarget(){
    // temizle
    for (let ob of obstacles){
      scene.remove(ob.mesh);
      ob.mesh.geometry.dispose();
      ob.mesh.material.dispose();
    }
    obstacles = [];
    movingObstacles = [];
    initialObstacleStates = [];

    const half = cubeSize / 2;
    const cellSize = (cubeSize - 2.0) / gridSize;
    const cellStartX = -half + 1.0 + cellSize/2;
    const cellStartZ = -half + 1.0 + cellSize/2;

    const startWorld = new THREE.Vector3(0, 0, cubeSize/2 - 3);
    const startGrid = worldToGrid(startWorld);

    // rastgele hedef seçimi (start'a çok yakın olmayacak)
    let targetGrid;
    do {
      targetGrid = { x: Math.floor(Math.random() * gridSize), z: Math.floor(Math.random() * gridSize) };
      const dx = targetGrid.x - startGrid.x;
      const dz = targetGrid.z - startGrid.z;
      if (Math.abs(dx) + Math.abs(dz) < 3) { targetGrid = null; }
    } while (!targetGrid);

    const tw = gridToWorld(targetGrid.x, targetGrid.z);
    const groundY = -cubeSize/2 + 0.01;
    // hedef artık küçük bir küp: pozisyonu merkezden yükseğe göre ayarla
    target.position.set(tw.x, groundY + targetSize/2, tw.z);

    // path üret
    const path = generatePathGrid(startGrid, targetGrid);
    const protectedCells = new Set();
    for (const p of path) protectedCells.add(`${p.x},${p.z}`);
    addProtectedNeighbors(protectedCells, startGrid, 1);
    addProtectedNeighbors(protectedCells, targetGrid, 1);

    // hücrelere göre engel yerleştir
    for (let gx=0; gx<gridSize; gx++){
      for (let gz=0; gz<gridSize; gz++){
        const key = `${gx},${gz}`;
        if (protectedCells.has(key)) continue;
        if (Math.random() > obstacleFillProb) continue;

        const cx = cellStartX + gx * cellSize;
        const cz = cellStartZ + gz * cellSize;

        let placed = false;
        for (let attempt=0; attempt<obstacleAttemptsPerCell && !placed; attempt++){
          const w = randRange(minObstacleSize, maxObstacleSize);
          const d = randRange(minObstacleSize, maxObstacleSize);
          const h = randRange(2.0, 6.0);
          const maxOffset = Math.max(0, (cellSize - Math.max(w,d))/2 - 0.1);
          const ox = (maxOffset > 0) ? randRange(-maxOffset, maxOffset) : 0;
          const oz = (maxOffset > 0) ? randRange(-maxOffset, maxOffset) : 0;
          const posX = cx + ox;
          const posZ = cz + oz;
          const posY = -cubeSize/2 + h/2;

          if (Math.abs(posX) + w/2 > half - 0.2) continue;
          if (Math.abs(posZ) + d/2 > half - 0.2) continue;

          const g = new THREE.BoxGeometry(w, h, d);
          const m = new THREE.MeshStandardMaterial({ color: 0xff4444, roughness: 0.6 });
          const mesh = new THREE.Mesh(g, m);
          mesh.position.set(posX, posY, posZ);

          const newBox = new THREE.Box3().setFromObject(mesh);
          let overlap = false;
          for (let ex of obstacles){
            const exBox = new THREE.Box3().setFromObject(ex.mesh);
            if (newBox.intersectsBox(exBox)) { overlap = true; break; }
          }

          const playerStartBox = new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(startWorld.x, groundY + playerHeight/2, startWorld.z),
            new THREE.Vector3(playerRadius*4, playerHeight*2, playerRadius*4)
          );
          if (newBox.intersectsBox(playerStartBox)) overlap = true;

          const targetBox = new THREE.Box3().setFromObject(target);
          if (newBox.intersectsBox(targetBox)) overlap = true;

          if (!overlap) {
            const isMoving = Math.random() < movingObstacleRatio;
            const item = { mesh, type: isMoving ? 'moving' : 'static' };
            if (isMoving) {
              const axis = (Math.random() < 0.5) ? 'x' : 'z';
              const range = randRange(1.5, Math.min(cellSize*1.5, 6.0));
              const speed = randRange(0.008, 0.03);
              const moving = { mesh, axis, base: mesh.position.clone(), range, speed, phase: Math.random()*Math.PI*2 };
              item.moving = moving;
              movingObstacles.push(moving);
            }
            scene.add(mesh);
            obstacles.push(item);
            initialObstacleStates.push({ mesh, pos: mesh.position.clone(), isMoving: !!item.moving, movingCfg: item.moving ? {...item.moving} : null });
            placed = true;
          } else {
            mesh.geometry.dispose(); mesh.material.dispose();
          }
        }
      }
    }
  }

  // === OYUN SETUP ===
  function setupGame(){
    createRoom();
    createPlayerAndTarget();
    createRandomObstaclesWithRandomTarget();
    camera.position.copy(player.position).add(new THREE.Vector3(0,3.0,8.0));
    camera.lookAt(player.position);
  }
  setupGame();

  // === KONTROLLER ===
  const keys = { forward:false, back:false, left:false, right:false, jump:false };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW') keys.forward = true;
    if (e.code === 'KeyS') keys.back = true;
    if (e.code === 'KeyA') keys.left = true;
    if (e.code === 'KeyD') keys.right = true;
    if (e.code === 'Space') { e.preventDefault(); keys.jump = true; }
    if (e.code === 'KeyR') { e.preventDefault(); restartGame(); }
    if (e.code === 'KeyC') { e.preventDefault(); toggleCameraMode(); }
  }, {passive:false});
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') keys.forward = false;
    if (e.code === 'KeyS') keys.back = false;
    if (e.code === 'KeyA') keys.left = false;
    if (e.code === 'KeyD') keys.right = false;
    if (e.code === 'Space') keys.jump = false;
  });

  // === FİZİK VE YARDIMCILAR ===
  let velocityY = 0;
  function isOnGround(){ return player.position.y <= (-cubeSize/2 + playerRadius + 0.001); }
  function boxIntersectsMesh(box, mesh){ const mBox = new THREE.Box3().setFromObject(mesh); return box.intersectsBox(mBox); }
  const minX = -cubeSize/2 + 0.5;
  const maxX = cubeSize/2 - 0.5;
  const minZ = -cubeSize/2 + 0.5;
  const maxZ = cubeSize/2 - 0.5;

  // oyun durumları
  let won = false;
  let lost = false;

  // Kamera + pointer lock
  let yaw = Math.PI;
  let pitch = 0.28;
  let distance = 10.0;
  const minPitch = -Math.PI/2 + 0.12;
  const maxPitch = Math.PI/2 - 0.12;
  const minDistance = 4.0;
  const maxDistance = 40.0;

  let pointerLocked = false;
  const startBtn = document.getElementById('startCameraBtn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      cameraMode = 'follow'; updateModeLabel();
      const elem = renderer.domElement;
      if (elem.requestPointerLock) elem.requestPointerLock();
      else alert('Browser pointer lock desteklemiyor.');
    });
  }
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === renderer.domElement;
    pointerLocked = locked;
    if (pointerLocked && startBtn){ startBtn.textContent = 'Fare kilitlendi — ESC ile çık'; startBtn.style.opacity = '0.55'; }
    else if (startBtn){ startBtn.textContent = 'Kamerayı Başlat'; startBtn.style.opacity = '1'; }
  });

  const sensitivity = 0.0026;
  window.addEventListener('mousemove', (e) => {
    if (!pointerLocked) return;
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;
    yaw -= dx * sensitivity;
    pitch -= dy * sensitivity;
    yaw = ((yaw + Math.PI) % (2*Math.PI) + (2*Math.PI)) % (2*Math.PI) - Math.PI;
    if (pitch < minPitch) pitch = minPitch;
    if (pitch > maxPitch) pitch = maxPitch;
  });

  renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    distance += e.deltaY * 0.02;
    distance = Math.max(minDistance, Math.min(maxDistance, distance));
  }, {passive:false});

  // camera clamp
  const cameraPadding = 0.45;
  function clampCameraToRoom(posVec){
    const half = cubeSize/2;
    const minCamX = -half + cameraPadding;
    const maxCamX = half - cameraPadding;
    const minCamZ = -half + cameraPadding;
    const maxCamZ = half - cameraPadding;
    const minCamY = -half + cameraPadding + 0.2;
    const maxCamY = half - cameraPadding;
    posVec.x = Math.max(minCamX, Math.min(maxCamX, posVec.x));
    posVec.z = Math.max(minCamZ, Math.min(maxCamZ, posVec.z));
    posVec.y = Math.max(minCamY, Math.min(maxCamY, posVec.y));
    return posVec;
  }

  function updateCamera(){
    if (cameraMode === 'follow'){
      const phi = pitch; const theta = yaw; const r = distance;
      const x = r * Math.cos(phi) * Math.sin(theta);
      const y = r * Math.sin(phi);
      const z = r * Math.cos(phi) * Math.cos(theta);
      const desired = new THREE.Vector3(player.position.x + x, player.position.y + y + 0.6, player.position.z + z);
      clampCameraToRoom(desired);
      camera.position.lerp(desired, 0.12);
      camera.lookAt(new THREE.Vector3(player.position.x, player.position.y + 0.8, player.position.z));
    } else {
      const topOffset = new THREE.Vector3(0, cubeSize*0.6, 0.1);
      const desired = new THREE.Vector3().copy(player.position).add(topOffset);
      clampCameraToRoom(desired);
      camera.position.lerp(desired, 0.12);
      camera.lookAt(player.position);
    }
  }

  function toggleCameraMode(){
    cameraMode = (cameraMode === 'follow') ? 'top' : 'follow';
    updateModeLabel();
    if (cameraMode !== 'follow' && pointerLocked) document.exitPointerLock();
  }

  // === RESTART ===
  function restartGame(){
    const groundY = -cubeSize/2 + 0.01;
    player.position.set(0, groundY + playerRadius, cubeSize/2 - 3);
    player.userData.baseY = player.position.y;
    velocityY = 0;
    won = false; lost = false;
    statusEl.classList.add('hidden'); statusEl.textContent = '';
    createRandomObstaclesWithRandomTarget();
  }

  // init moving phases (compat)
  function initMovingPhases(){
    for (let s of initialObstacleStates) {
      if (s.isMoving) s.mesh.userData.movingPhase = (s.movingCfg && s.movingCfg.phase) ? s.movingCfg.phase : 0;
    }
  }
  initMovingPhases();

  // Hareket hesapları (kamera-yönlü 8-yön snap)
  function computeCameraRelativeMovement(forwardInput, strafeInput){
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() < 1e-6) camDir.set(0,0,-1);
    camDir.normalize();
    const up = new THREE.Vector3(0,1,0);
    const rightVec = new THREE.Vector3().crossVectors(up, camDir).normalize();
    const raw = new THREE.Vector3();
    raw.add(camDir.clone().multiplyScalar(forwardInput));
    raw.add(rightVec.clone().multiplyScalar(strafeInput));
    if (raw.lengthSq() === 0) return new THREE.Vector3(0,0,0);

    const camYaw = Math.atan2(camDir.x, camDir.z);
    const rawAngle = Math.atan2(raw.x, raw.z);
    let rel = rawAngle - camYaw;
    rel = ((rel + Math.PI) % (2*Math.PI) + (2*Math.PI)) % (2*Math.PI) - Math.PI;
    const step = Math.PI / 4;
    const snappedRel = Math.round(rel / step) * step;
    const finalAngle = camYaw + snappedRel;
    const nz = Math.cos(finalAngle);
    const nx = Math.sin(finalAngle);
    const out = new THREE.Vector3(nx, 0, nz).normalize();
    return out;
  }

  // === ANA DÖNGÜ ===
  function animate(){
    requestAnimationFrame(animate);
    const t = performance.now();

    // hareketli engeller
    for (let m of movingObstacles){
      const phase = (m.mesh.userData.movingPhase !== undefined) ? m.mesh.userData.movingPhase : 0;
      const v = Math.sin(t * m.speed * 0.001 + phase) * m.range;
      if (m.axis === 'x') m.mesh.position.x = m.base.x + v;
      else m.mesh.position.z = m.base.z + v;
    }

    if (!won && !lost){
      const prevPos = player.position.clone();

      // input mapping: W:+1, S:-1 ; A:+1 (sağ), D:-1 (sol)
      let forwardInput = 0;
      if (keys.forward) forwardInput += 1;
      if (keys.back) forwardInput -= 1;
      let strafeInput = 0;
      if (keys.left) strafeInput += 1;   // A -> sağ
      if (keys.right) strafeInput -= 1;  // D -> sol

      let moveDir;
      if (cameraMode === 'top'){
        const worldForward = new THREE.Vector3(0,0,-1);
        const worldRight = new THREE.Vector3(1,0,0);
        const raw = new THREE.Vector3();
        raw.add(worldForward.clone().multiplyScalar(forwardInput));
        raw.add(worldRight.clone().multiplyScalar(strafeInput));
        if (raw.lengthSq() === 0) moveDir = new THREE.Vector3(0,0,0);
        else {
          const rawAngle = Math.atan2(raw.z, raw.x);
          const step = Math.PI/4;
          const snapped = Math.round(rawAngle/step)*step;
          moveDir = new THREE.Vector3(Math.cos(snapped),0,Math.sin(snapped)).normalize();
        }
      } else {
        moveDir = computeCameraRelativeMovement(forwardInput, strafeInput);
      }

      if (moveDir.lengthSq() > 0){
        const speed = baseMoveSpeed;
        player.position.x += moveDir.x * speed;
        player.position.z += moveDir.z * speed;
      }

      // sınırlar
      player.position.x = Math.max(minX, Math.min(maxX, player.position.x));
      player.position.z = Math.max(minZ, Math.min(maxZ, player.position.z));

      // zıplama & gravity
      if (keys.jump && isOnGround()) velocityY = jumpStrength;
      velocityY += gravity;
      player.position.y += velocityY;
      const groundY = -cubeSize/2 + 0.01;
      if (player.position.y < groundY + playerRadius) {
        player.position.y = groundY + playerRadius;
        player.userData.baseY = player.position.y;
        velocityY = 0;
      }

      // çarpışma: sphere-box kontrolü
      const playerSphere = new THREE.Sphere(new THREE.Vector3(player.position.x, player.position.y, player.position.z), playerRadius * 0.95);
      let collided = false;
      for (let ob of obstacles){
        const obBox = new THREE.Box3().setFromObject(ob.mesh);
        if (obBox.intersectsSphere(playerSphere)) { collided = true; break; }
      }
      if (collided){
        player.position.copy(prevPos);
        velocityY = 0;
        lost = true;
        statusEl.textContent = 'Kaybettin 😞 • R ile yeniden başla';
        statusEl.classList.remove('hidden');
        if (pointerLocked) document.exitPointerLock();
      }

      // kazanma kontrolü: target now is a box
      const targetBox = new THREE.Box3().setFromObject(target);
      if (targetBox.intersectsSphere(playerSphere)){
        won = true;
        statusEl.textContent = 'Kazandın 🎉 • R ile yeniden başla';
        statusEl.classList.remove('hidden');
        if (pointerLocked) document.exitPointerLock();
      }

      // görsel animasyon: top spin
      const isMoving = moveDir.lengthSq() > 0;
      if (isMoving){
        const bob = Math.abs(Math.sin(t * 0.006) * 0.06);
        player.position.y = player.userData.baseY + bob;
        player.rotation.y += 0.08;
      } else {
        player.position.y = player.userData.baseY;
      }
    }

    // camera güncelle
    updateCamera();

    renderer.render(scene, camera);
  }
  animate();

  // yeniden boyutlandırma
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // küçük helper
  function randRange(a,b){ return a + Math.random()*(b-a); }

  console.log('Hedef şimdi küçük bir küp; disk kaldırıldı. Kazanma kontrolü box<->sphere ile yapılıyor — artık D ile de kazanç algılanacaktır.');
})();


