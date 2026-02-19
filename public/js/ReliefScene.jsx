// ==========================================
// 原生 Three.js 浮雕生成引擎 (Relief Engine)
// ==========================================

function ReliefScene({ imageBase64, depth = 5, baseHeight = 3, smoothing = 128, inverted = false, mirrored = false, cutout = false, cutoutThreshold = 0.92, onMeshUpdate }) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const meshRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 500;
    console.log('[ReliefScene] init renderer size:', w, h);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e293b);

    const camera = new THREE.PerspectiveCamera(45, w/h, 0.1, 1000);
    camera.position.set(0, -50, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(50, 50, 100);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const grid = new THREE.GridHelper(200, 20, 0x444444, 0x222222);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;
    controlsRef.current = controls;

    let frameId;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // ResizeObserver to handle container size changes (including initial layout)
    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      if (nw > 0 && nh > 0) {
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      }
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      if (container) container.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    if (!imageBase64 || !sceneRef.current) return;

    const img = new Image();
    img.src = imageBase64;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const res = Math.min(smoothing, 256);
      canvas.width = res;
      canvas.height = res;
      const ctx = canvas.getContext('2d');
      // Mirrored: horizontal flip for stamp scene
      if (mirrored) {
        ctx.translate(res, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(img, 0, 0, res, res);
      if (mirrored) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      const imgData = ctx.getImageData(0, 0, res, res);
      const data = imgData.data;

      const size = 60;
      const segs = res - 1;
      const cellSize = size / res;
      const halfSize = size / 2;

      // Calculate brightness map
      const brightnessMap = new Float32Array(res * res);
      for (let i = 0; i < res * res; i++) {
        const pi = i * 4;
        brightnessMap[i] = pi < data.length
          ? (data[pi] * 0.299 + data[pi+1] * 0.587 + data[pi+2] * 0.114) / 255
          : 1;
      }

      // Foreground mask
      const isFg = new Uint8Array(res * res);

      if (cutout) {
        // Step 1: Box-blur the brightness map (radius=3) to close small line gaps
        const blurRadius = 3;
        const blurred = new Float32Array(res * res);
        for (let r = 0; r < res; r++) {
          for (let c = 0; c < res; c++) {
            let sum = 0, count = 0;
            for (let dr = -blurRadius; dr <= blurRadius; dr++) {
              for (let dc = -blurRadius; dc <= blurRadius; dc++) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < res && nc >= 0 && nc < res) {
                  sum += brightnessMap[nr * res + nc];
                  count++;
                }
              }
            }
            blurred[r * res + c] = sum / count;
          }
        }

        // Step 2: Flood-fill from edges on the BLURRED map
        // Blurred lines are thicker → gaps are sealed → fill won't leak inside
        const isBackground = new Uint8Array(res * res);
        const queue = [];
        for (let r = 0; r < res; r++) {
          for (let c = 0; c < res; c++) {
            if (r === 0 || r === res - 1 || c === 0 || c === res - 1) {
              const idx = r * res + c;
              if (blurred[idx] > cutoutThreshold) {
                isBackground[idx] = 1;
                queue.push(idx);
              }
            }
          }
        }
        let head = 0;
        while (head < queue.length) {
          const idx = queue[head++];
          const r = Math.floor(idx / res);
          const c = idx % res;
          const neighbors = [];
          if (r > 0) neighbors.push((r-1)*res+c);
          if (r < res-1) neighbors.push((r+1)*res+c);
          if (c > 0) neighbors.push(r*res+(c-1));
          if (c < res-1) neighbors.push(r*res+(c+1));
          for (const ni of neighbors) {
            if (!isBackground[ni] && blurred[ni] > cutoutThreshold) {
              isBackground[ni] = 1;
              queue.push(ni);
            }
          }
        }

        // Step 3: Foreground = NOT background, then dilate 2px to recover edge lost to blur
        const rawFg = new Uint8Array(res * res);
        for (let i = 0; i < res * res; i++) rawFg[i] = isBackground[i] ? 0 : 1;

        // Dilate to compensate for blur shrinking the shape
        let currentFg = rawFg;
        for (let pass = 0; pass < 2; pass++) {
          const expanded = new Uint8Array(res * res);
          for (let r = 0; r < res; r++) {
            for (let c = 0; c < res; c++) {
              const idx = r * res + c;
              if (currentFg[idx]) { expanded[idx] = 1; continue; }
              if (r > 0 && currentFg[(r-1)*res+c]) { expanded[idx] = 1; continue; }
              if (r < res-1 && currentFg[(r+1)*res+c]) { expanded[idx] = 1; continue; }
              if (c > 0 && currentFg[r*res+(c-1)]) { expanded[idx] = 1; continue; }
              if (c < res-1 && currentFg[r*res+(c+1)]) { expanded[idx] = 1; continue; }
            }
          }
          currentFg = expanded;
        }

        for (let i = 0; i < res * res; i++) isFg[i] = currentFg[i];

        // Step 4: Hole detection — find small bright enclosed regions and punch them out
        // These are pixels that are: bright (original brightness > threshold), inside foreground,
        // and NOT reachable from the edge (so they're enclosed by the shape, like a keychain hole)
        let fgCount = 0;
        for (let i = 0; i < res * res; i++) fgCount += isFg[i];

        if (fgCount > 0) {
          // Find all bright pixels that are currently marked as foreground
          // (they were "saved" from the edge flood fill because they're enclosed)
          const visited = new Uint8Array(res * res);
          const holeMaxRatio = 0.08; // holes must be < 8% of total foreground area

          for (let r = 0; r < res; r++) {
            for (let c = 0; c < res; c++) {
              const startIdx = r * res + c;
              // Look for bright foreground pixels not yet visited
              if (visited[startIdx] || !isFg[startIdx] || brightnessMap[startIdx] <= cutoutThreshold) continue;
              // BFS to find this connected bright region within foreground
              const region = [];
              const q = [startIdx];
              visited[startIdx] = 1;
              let qHead = 0;
              while (qHead < q.length) {
                const pi = q[qHead++];
                region.push(pi);
                const pr = Math.floor(pi / res), pc = pi % res;
                const nb = [];
                if (pr > 0) nb.push((pr-1)*res+pc);
                if (pr < res-1) nb.push((pr+1)*res+pc);
                if (pc > 0) nb.push(pr*res+(pc-1));
                if (pc < res-1) nb.push(pr*res+(pc+1));
                for (const ni of nb) {
                  if (!visited[ni] && isFg[ni] && brightnessMap[ni] > cutoutThreshold) {
                    visited[ni] = 1;
                    q.push(ni);
                  }
                }
              }
              // If this enclosed bright region is small relative to foreground → it's a hole
              if (region.length > 4 && region.length < fgCount * holeMaxRatio) {
                for (const pi of region) isFg[pi] = 0;
              }
            }
          }
          // Recount
          fgCount = 0;
          for (let i = 0; i < res * res; i++) fgCount += isFg[i];
        }

        // Fallback: if foreground is empty (flood fill leaked everywhere), use plate mode
        if (fgCount === 0) isFg.fill(1);
      } else {
        isFg.fill(1);
      }

      // Build height map using foreground mask
      const heightMap = [];
      for (let i = 0; i < res * res; i++) {
        if (!isFg[i]) { heightMap.push(0); continue; }
        let b = brightnessMap[i];
        if (inverted) b = 1 - b;
        heightMap.push(baseHeight + b * depth);
      }

      // Debug: log foreground pixel count
      let fgPixels = 0;
      for (let i = 0; i < res * res; i++) fgPixels += isFg[i];
      console.log('[ReliefScene] cutout=' + cutout + ', fgPixels=' + fgPixels + '/' + (res*res) + ', baseHeight=' + baseHeight + ', depth=' + depth);

      try {

      if (cutout) {
        // === Cutout mode: per-pixel boxes for foreground only ===
        // Each foreground pixel → one box with height from heightMap
        // Background & hole pixels → no geometry at all
        const positions = [];
        const normals = [];
        const uvs = [];
        const indices = [];
        let vi = 0; // vertex index counter

        for (let r = 0; r < res; r++) {
          for (let c = 0; c < res; c++) {
            const pi = r * res + c;
            if (!isFg[pi]) continue;

            const h = heightMap[pi];
            const x0 = -halfSize + c * cellSize;
            const x1 = x0 + cellSize;
            const y0 = halfSize - r * cellSize;
            const y1 = y0 - cellSize;

            // UV from pixel position (v flipped: Three.js texture flipY=true, so v=1 is image top)
            const u0 = c / res, u1 = (c + 1) / res;
            const v0 = 1 - r / res, v1 = 1 - (r + 1) / res;

            // Top face (z = h), normal (0,0,1)
            positions.push(x0,y0,h, x1,y0,h, x1,y1,h, x0,y1,h);
            normals.push(0,0,1, 0,0,1, 0,0,1, 0,0,1);
            uvs.push(u0,v0, u1,v0, u1,v1, u0,v1);
            indices.push(vi,vi+1,vi+2, vi,vi+2,vi+3);
            vi += 4;

            // Bottom face (z = 0), normal (0,0,-1)
            positions.push(x0,y1,0, x1,y1,0, x1,y0,0, x0,y0,0);
            normals.push(0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1);
            uvs.push(u0,v1, u1,v1, u1,v0, u0,v0);
            indices.push(vi,vi+1,vi+2, vi,vi+2,vi+3);
            vi += 4;

            // Side walls — only where neighbor is background or edge
            const checkSide = (dr, dc, nx0, ny0, nx1, ny1, fnx, fny) => {
              const nr = r + dr, nc = c + dc;
              const isBg = nr < 0 || nr >= res || nc < 0 || nc >= res || !isFg[nr * res + nc];
              if (!isBg) return;
              // Wall quad from top to bottom
              positions.push(nx0,ny0,h, nx1,ny1,h, nx1,ny1,0, nx0,ny0,0);
              normals.push(fnx,fny,0, fnx,fny,0, fnx,fny,0, fnx,fny,0);
              uvs.push(0,0, 1,0, 1,1, 0,1);
              indices.push(vi,vi+1,vi+2, vi,vi+2,vi+3);
              vi += 4;
            };
            checkSide(-1, 0, x0,y0,x1,y0, 0,1);   // top neighbor → wall faces +Y
            checkSide(1, 0, x1,y1,x0,y1, 0,-1);    // bottom neighbor → wall faces -Y
            checkSide(0, -1, x0,y1,x0,y0, -1,0);   // left neighbor → wall faces -X
            checkSide(0, 1, x1,y0,x1,y1, 1,0);      // right neighbor → wall faces +X
          }
        }

        console.log('[ReliefScene] cutout mesh: ' + (vi) + ' vertices, ' + indices.length + ' indices');

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(indices);

        const texture = new THREE.Texture(img);
        texture.needsUpdate = true;
        const material = new THREE.MeshStandardMaterial({
          map: texture,
          side: THREE.DoubleSide,
          roughness: 0.4,
          metalness: 0.2,
        });

        if (meshRef.current) {
          sceneRef.current.remove(meshRef.current);
          meshRef.current.geometry.dispose();
          meshRef.current.material.dispose();
        }

        const mesh = new THREE.Mesh(geo, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        sceneRef.current.add(mesh);
        meshRef.current = mesh;
        if (onMeshUpdate) onMeshUpdate(mesh);

      } else {
        // === Normal plate mode (relief/lithophane/stamp) ===
        // --- Top face (relief surface) ---
        const topGeo = new THREE.PlaneGeometry(size, size, segs, segs);
        const topPos = topGeo.attributes.position;
        for (let i = 0; i < topPos.count; i++) {
          if (i < heightMap.length) topPos.setZ(i, heightMap[i]);
        }
        topGeo.computeVertexNormals();

        // --- Bottom face (flat) ---
        const bottomGeo = new THREE.PlaneGeometry(size, size, 1, 1);
        const bottomIdx = bottomGeo.index.array;
        for (let i = 0; i < bottomIdx.length; i += 3) {
          const tmp = bottomIdx[i];
          bottomIdx[i] = bottomIdx[i + 2];
          bottomIdx[i + 2] = tmp;
        }

        // --- Side walls (4 edges) ---
        const sideGeos = [];
        function createSideWall(getTopIdx, startX, startY, dirX, dirY, steps) {
          const vertices = [];
          const wallIndices = [];
          for (let i = 0; i <= steps; i++) {
            const x = startX + dirX * (i / steps) * size;
            const y = startY + dirY * (i / steps) * size;
            const topZ = heightMap[getTopIdx(i)];
            vertices.push(x, y, topZ);
            vertices.push(x, y, 0);
          }
          for (let i = 0; i < steps; i++) {
            const a = i * 2, b = i * 2 + 1, cc = (i+1) * 2, d = (i+1) * 2 + 1;
            wallIndices.push(a, b, cc, cc, b, d);
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
          geo.setIndex(wallIndices);
          geo.computeVertexNormals();
          return geo;
        }

        sideGeos.push(createSideWall(i => i, -halfSize, -halfSize, 1, 0, segs));
        sideGeos.push(createSideWall(i => (segs) * res + (segs - i), halfSize, halfSize, -1, 0, segs));
        sideGeos.push(createSideWall(i => (segs - i) * res, -halfSize, halfSize, 0, -1, segs));
        sideGeos.push(createSideWall(i => i * res + segs, halfSize, -halfSize, 0, 1, segs));

        // Merge all geometries
        const allGeos = [topGeo, bottomGeo, ...sideGeos];
        let totalVerts = 0;
        allGeos.forEach(g => { totalVerts += g.attributes.position.count; });

        const mergedPositions = new Float32Array(totalVerts * 3);
        const mergedNormals = new Float32Array(totalVerts * 3);
        const mergedIndices = [];
        let vertOffset = 0;

        allGeos.forEach(g => {
          const pos = g.attributes.position.array;
          const nor = g.attributes.normal ? g.attributes.normal.array : new Float32Array(pos.length);
          mergedPositions.set(pos, vertOffset * 3);
          mergedNormals.set(nor, vertOffset * 3);
          if (g.index) {
            for (let i = 0; i < g.index.count; i++) {
              mergedIndices.push(g.index.array[i] + vertOffset);
            }
          }
          vertOffset += g.attributes.position.count;
        });

        const mergedGeo = new THREE.BufferGeometry();
        mergedGeo.setAttribute('position', new THREE.BufferAttribute(mergedPositions, 3));
        mergedGeo.setAttribute('normal', new THREE.BufferAttribute(mergedNormals, 3));
        mergedGeo.setIndex(mergedIndices);

        const texture = new THREE.Texture(img);
        texture.needsUpdate = true;
        const material = new THREE.MeshStandardMaterial({
          map: texture,
          side: THREE.DoubleSide,
          roughness: 0.4,
          metalness: 0.2,
        });

        if (meshRef.current) {
          sceneRef.current.remove(meshRef.current);
          meshRef.current.geometry.dispose();
          meshRef.current.material.dispose();
        }

        const mesh = new THREE.Mesh(mergedGeo, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        sceneRef.current.add(mesh);
        meshRef.current = mesh;
        if (onMeshUpdate) onMeshUpdate(mesh);
      }

      // Auto-center camera on mesh bounding box
      if (meshRef.current && controlsRef.current && cameraRef.current) {
        const box = new THREE.Box3().setFromObject(meshRef.current);
        const center = box.getCenter(new THREE.Vector3());
        const bSize = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(bSize.x, bSize.y, bSize.z);
        controlsRef.current.target.copy(center);
        cameraRef.current.position.set(center.x, center.y - maxDim * 0.6, center.z + maxDim * 1.2);
        controlsRef.current.update();
      }

      } catch (err) {
        console.error('[ReliefScene] geometry error:', err);
      }
    };
  }, [imageBase64, depth, baseHeight, smoothing, inverted, mirrored, cutout, cutoutThreshold]);

  return <div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />;
}
