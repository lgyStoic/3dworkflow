// ==========================================
// 主程序
// ==========================================

function AiWorkshop() {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [printAdvice, setPrintAdvice] = useState(null);
  const [modifyPrompt, setModifyPrompt] = useState("");
  const [sceneId, setSceneId] = useState('relief');
  const [step4Mode, setStep4Mode] = useState('relief'); // 'relief', 'meshy3d', or 'contour'
  const [meshy3dResult, setMeshy3dResult] = useState(null);
  const [contourConfig, setContourConfig] = useState({ wallHeight: 15, wallThickness: 1.2 });
  const [workflowData, setWorkflowData] = useState({
    description: "一只戴着宇航头盔的小猫，正坐姿态",
    style: 'standard', uploadedReference: null,
    step1Image: null, step2Image: null, step3Image: null,
    colors: ['#000000', '#FF8C00', '#FFFFFF', '#228B22'],
    reliefDepth: 5, reliefBaseHeight: 3, reliefResolution: 128
  });
  const fileInputRef = useRef(null);
  const meshToExport = useRef(null);

  // Scene helpers
  const currentScene = SCENE_PRESETS[sceneId];
  const isStepEnabled = (step) => currentScene.enabledSteps.includes(step);

  const handleSceneChange = (newSceneId) => {
    const scene = SCENE_PRESETS[newSceneId];
    setSceneId(newSceneId);
    setCurrentStep(1);
    setError(null);
    setMeshy3dResult(null);
    setPrintAdvice(null);
    setModifyPrompt("");
    // Set default export mode
    setStep4Mode(scene.defaultExportMode === 'meshy3d' ? 'meshy3d' : scene.defaultExportMode === 'contour' ? 'contour' : 'relief');
    // Apply scene-specific relief defaults
    if (scene.reliefConfig) {
      setWorkflowData(prev => ({
        ...prev,
        step1Image: null, step2Image: null, step3Image: null,
        reliefDepth: scene.reliefConfig.depth ?? prev.reliefDepth,
        reliefBaseHeight: scene.reliefConfig.baseHeight ?? prev.reliefBaseHeight,
        reliefResolution: scene.reliefConfig.resolution ?? 128,
      }));
    } else {
      setWorkflowData(prev => ({ ...prev, step1Image: null, step2Image: null, step3Image: null }));
    }
    if (scene.contourConfig) {
      setContourConfig(scene.contourConfig);
    }
  };

  // Go to the next enabled step after `current`
  const goToNextStep = (current) => {
    const stepOrder = [1, 1.5, 2, 3, 4];
    const currentIdx = stepOrder.indexOf(current);
    for (let i = currentIdx + 1; i < stepOrder.length; i++) {
      if (isStepEnabled(stepOrder[i])) {
        // For steps that get skipped, pass images through
        const nextStep = stepOrder[i];
        if (nextStep === 2 && !isStepEnabled(2)) continue;
        if (nextStep === 3 && !isStepEnabled(3)) continue;
        if (nextStep === 4) {
          // Before going to step 4, ensure images are passed through skipped steps
          setWorkflowData(prev => {
            const updated = { ...prev };
            if (!isStepEnabled(2) && !updated.step2Image) updated.step2Image = updated.step1Image;
            if (!isStepEnabled(3) && !updated.step3Image) updated.step3Image = updated.step2Image || updated.step1Image;
            return updated;
          });
        }
        setCurrentStep(nextStep >= 2 ? Math.ceil(nextStep) : nextStep);
        return;
      }
    }
    // If no more enabled steps, just go to 4
    setWorkflowData(prev => {
      const updated = { ...prev };
      if (!updated.step2Image) updated.step2Image = updated.step1Image;
      if (!updated.step3Image) updated.step3Image = updated.step2Image || updated.step1Image;
      return updated;
    });
    setCurrentStep(4);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setWorkflowData(prev => ({ ...prev, uploadedReference: ev.target.result, step1Image: null }));
      reader.readAsDataURL(file);
    }
  };

  // Step 1: 生成图片
  const handleStep1 = async () => {
    setLoading(true); setError(null);
    try {
      let subjectDesc = workflowData.description;
      if (workflowData.uploadedReference) {
        setLoadingMsg("VLM 视觉分析...");
        subjectDesc = await fetchWithRetry(() => describeImage(workflowData.uploadedReference));
        setWorkflowData(prev => ({ ...prev, description: subjectDesc }));

        setLoadingMsg("参考图重绘...");
        const img = await fetchWithRetry(() => traceImage(subjectDesc, workflowData.uploadedReference, workflowData.style, sceneId));
        setWorkflowData(prev => ({ ...prev, step1Image: img }));
      } else {
        setLoadingMsg("翻译提示词...");
        const translatedPrompt = await fetchWithRetry(() => translateDescription(subjectDesc));
        setLoadingMsg("生成图片...");
        const img = await fetchWithRetry(() => generateImage(translatedPrompt, workflowData.style, sceneId));
        setWorkflowData(prev => ({ ...prev, step1Image: img }));
      }
    } catch (e) { setError("生成失败: " + e.message); }
    finally { setLoading(false); }
  };

  // Step 1.5: 修改线稿
  const handleModifyImage = async () => {
    if (!modifyPrompt.trim() || !workflowData.step1Image) return;
    setLoading(true); setError(null);
    try {
      setLoadingMsg("翻译修改指令...");
      const translatedPrompt = await fetchWithRetry(() => translateDescription(modifyPrompt));
      setLoadingMsg("AI 修改线稿中...");
      const img = await fetchWithRetry(() => editImage(
        `Modify this black and white line art based on the instruction: ${translatedPrompt}. Keep the same style: thick black lines on white background, 2D orthogonal front view, character on a circular base.`,
        workflowData.step1Image
      ));
      setWorkflowData(prev => ({ ...prev, step1Image: img }));
      setModifyPrompt("");
    } catch (e) { setError("修改失败: " + e.message); }
    finally { setLoading(false); }
  };

  // Step 2: 加固
  const handleStep2 = async (skip) => {
    if (skip) {
      setWorkflowData(prev => ({ ...prev, step2Image: prev.step1Image }));
      goToNextStep(2);
      return;
    }
    setLoading(true); setError(null); setLoadingMsg("Step 2: 结构加固中...");
    try {
      const img = await fetchWithRetry(() => refineStructure(workflowData.step1Image, sceneId));
      setWorkflowData(prev => ({ ...prev, step2Image: img }));
      goToNextStep(2);
    } catch (e) { setError("加固失败"); } finally { setLoading(false); }
  };

  // Step 3: 上色
  const handleStep3 = async () => {
    setLoading(true); setError(null); setLoadingMsg("Step 3: 填色中...");
    try {
      const img = await fetchWithRetry(() => colorFill(workflowData.step2Image, workflowData.colors, sceneId));
      setWorkflowData(prev => ({ ...prev, step3Image: img }));
      goToNextStep(3);
    } catch (e) { setError("上色失败"); } finally { setLoading(false); }
  };

  // Step 4: 导出浮雕
  const handleExportRelief = () => {
    if (!meshToExport.current) return;
    const result = exportToObj(meshToExport.current);
    if (!result) return;
    const blob = new Blob([result], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relief_model_${Date.now()}.obj`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExport3mf = async () => {
    if (!meshToExport.current || !workflowData.step3Image) return;
    await exportTo3mf(meshToExport.current, workflowData.step3Image);
  };

  // Meshy AI 3D 生成
  const handleMeshy3D = async () => {
    const sourceImage = workflowData.step3Image || workflowData.step2Image || workflowData.step1Image;
    if (!sourceImage) return;
    // lowpoly/voxel 风格使用 Meshy lowpoly 模式
    const modelType = (workflowData.style === 'lowpoly' || workflowData.style === 'voxel') ? 'lowpoly' : 'standard';
    setLoading(true); setError(null);
    setLoadingMsg(`Meshy AI 3D 建模中${modelType === 'lowpoly' ? '（低面数模式）' : ''}（可能需要几分钟）...`);
    try {
      const result = await generateMeshy3D(sourceImage, modelType);
      setMeshy3dResult(result);
    } catch (e) { setError("3D 生成失败: " + e.message); }
    finally { setLoading(false); }
  };

  // 饼干模具导出
  const handleExportContour = async () => {
    const sourceImage = workflowData.step3Image || workflowData.step2Image || workflowData.step1Image;
    if (!sourceImage) return;
    await exportContourCutter(sourceImage, contourConfig);
  };

  const runPrintAnalysis = async () => {
    setAnalyzing(true);
    try {
      const advice = await analyzePrintingConfig(workflowData.description, workflowData.colors, workflowData.style);
      setPrintAdvice(advice);
    } catch (e) { setError("AI 分析失败"); } finally { setAnalyzing(false); }
  };

  const downloadImage = (base64, name) => {
    const link = document.createElement('a');
    link.href = base64;
    link.download = `${name}.png`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8 bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm">
           <div className="bg-gradient-to-br from-indigo-600 to-blue-700 p-3 rounded-2xl shadow-lg"><Box className="text-white" size={32} /></div>
           <div>
             <h1 className="text-2xl font-black tracking-tight text-slate-800 uppercase italic">AI 灵感工坊</h1>
             <p className="text-xs font-bold text-slate-400 tracking-widest mt-1">MULTI-SCENE 3D PRINTING WORKFLOW</p>
           </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* 左侧操作区 */}
          <div className="lg:col-span-4 space-y-4">
            {error && <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100 flex items-center gap-2"><AlertCircle size={14}/>{error}</div>}

            {/* 场景选择 */}
            <div className="p-5 rounded-[2rem] bg-white border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Layers size={16} className="text-indigo-600"/>
                <span className="text-sm font-bold text-slate-800">选择场景</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {Object.values(SCENE_PRESETS).map(s => {
                  const Icon = s.icon;
                  return (
                    <button key={s.id} onClick={() => handleSceneChange(s.id)} className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all text-center ${sceneId === s.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-slate-50 text-slate-500 hover:bg-white hover:border-slate-300'}`}>
                      {Icon ? React.createElement(Icon, { size: 16 }) : <Box size={16}/>}
                      <span className="text-[9px] font-bold leading-tight">{s.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-400 mt-2">{currentScene.description}</p>
            </div>

            <StepControl active={currentStep === 1} completed={currentStep > 1} title="Step 1: 基础线稿 (Structure)" icon={<BrainCircuit size={16}/>}>
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {Object.values(STYLE_PRESETS).map(s => (
                    <button key={s.id} onClick={() => setWorkflowData(prev => ({...prev, style: s.id}))} className={`p-2 rounded-lg border flex flex-col items-center gap-1 transition-all ${workflowData.style === s.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-400 hover:bg-white'}`}>
                      {s.icon} <span className="text-[9px]">{s.label}</span>
                    </button>
                  ))}
                </div>
                <textarea className="w-full p-3 bg-slate-50 border rounded-xl text-xs h-20" value={workflowData.description} onChange={(e) => setWorkflowData({...workflowData, description: e.target.value})} placeholder="输入描述..." />
                <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />

                {!workflowData.step1Image ? (
                  <div className="flex flex-col gap-2">
                    {workflowData.uploadedReference && (
                      <div className="relative h-24 rounded-xl overflow-hidden border">
                        <img src={workflowData.uploadedReference} className="w-full h-full object-cover opacity-60" alt="ref" />
                        <button onClick={() => setWorkflowData(prev => ({...prev, uploadedReference: null}))} className="absolute top-1 right-1 bg-white rounded-full p-1"><X size={12}/></button>
                      </div>
                    )}
                    <button onClick={handleStep1} disabled={loading} className="w-full py-3 bg-blue-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg hover:bg-blue-700 disabled:opacity-50">
                      {loading ? <><Loader2 className="animate-spin" size={14}/> {loadingMsg}</> : <><Sparkles size={14}/> {workflowData.uploadedReference ? '视觉分析并重绘' : '生成标准线稿'}</>}
                    </button>
                    {!workflowData.uploadedReference && <button onClick={() => fileInputRef.current?.click()} className="w-full py-2 bg-white border text-slate-500 rounded-xl text-xs font-bold hover:bg-slate-50 flex items-center justify-center gap-2"><Upload size={14}/> 上传参考图</button>}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input type="text" value={modifyPrompt} onChange={e => setModifyPrompt(e.target.value)} placeholder="输入修改指令，如：把头盔去掉..." className="flex-1 p-2 bg-slate-50 border rounded-lg text-xs" onKeyDown={e => e.key === 'Enter' && !loading && handleModifyImage()} />
                      <button onClick={handleModifyImage} disabled={loading || !modifyPrompt.trim()} className="px-3 py-2 bg-amber-500 text-white rounded-lg text-xs font-bold disabled:opacity-50 flex items-center gap-1">
                        {loading ? <Loader2 className="animate-spin" size={12}/> : <Wand2 size={12}/>} 修改
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setWorkflowData(prev => ({...prev, step1Image: null})); }} className="flex-1 py-2 bg-slate-100 text-slate-500 rounded-xl text-xs font-bold">重置</button>
                      <button onClick={() => goToNextStep(1.5)} className="flex-1 py-2 bg-green-600 text-white rounded-xl text-xs font-bold">
                        下一步 {isStepEnabled(2) ? '(去加固)' : isStepEnabled(3) ? '(去填色)' : '(去3D)'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </StepControl>

            {isStepEnabled(2) && (
              <StepControl active={currentStep === 2} completed={currentStep > 2} title="Step 2: 结构加固 (Refinement)" icon={<Settings2 size={16}/>}>
                <div className="flex gap-2">
                  <button onClick={() => handleStep2(false)} disabled={loading} className="flex-1 py-3 bg-slate-800 text-white rounded-xl text-xs font-bold">{loading ? "加固中..." : "AI 结构加固"}</button>
                  <button onClick={() => handleStep2(true)} disabled={loading} className="px-4 bg-slate-100 rounded-xl text-xs font-bold">跳过</button>
                </div>
              </StepControl>
            )}

            {isStepEnabled(3) && (
              <StepControl active={currentStep === 3} completed={currentStep > 3} title="Step 3: 填色 (Color Fill)" icon={<Palette size={16}/>}>
                <div className="space-y-3">
                   <div className="space-y-2">
                     {workflowData.colors.map((c, idx) => (
                       <div key={idx} className="flex items-center gap-2">
                         <input type="color" value={c} onChange={e => { const newColors = [...workflowData.colors]; newColors[idx] = e.target.value; setWorkflowData(prev => ({...prev, colors: newColors})); }} className="w-7 h-7 rounded cursor-pointer border-0 p-0" />
                         <input type="text" value={c} onChange={e => { const newColors = [...workflowData.colors]; newColors[idx] = e.target.value; setWorkflowData(prev => ({...prev, colors: newColors})); }} className="flex-1 p-1.5 bg-slate-50 border rounded-lg text-xs font-mono" />
                         {workflowData.colors.length > 2 && <button onClick={() => { const newColors = workflowData.colors.filter((_, i) => i !== idx); setWorkflowData(prev => ({...prev, colors: newColors})); }} className="text-slate-300 hover:text-red-400 text-xs"><X size={12}/></button>}
                       </div>
                     ))}
                     {workflowData.colors.length < 6 && (
                       <button onClick={() => setWorkflowData(prev => ({...prev, colors: [...prev.colors, '#888888']}))} className="w-full py-1.5 border border-dashed border-slate-200 rounded-lg text-[10px] text-slate-400 hover:text-slate-600 hover:border-slate-300">+ 添加颜色</button>
                     )}
                   </div>
                   <button onClick={handleStep3} disabled={loading} className="w-full py-3 bg-orange-500 text-white rounded-xl text-xs font-bold">{loading ? "渲染中..." : "执行填色"}</button>
                </div>
              </StepControl>
            )}

            {/* Step 4: 3D 生成 */}
            <div className={`p-5 rounded-[2rem] border transition-all ${currentStep === 4 ? 'bg-indigo-600 border-indigo-400 shadow-xl' : 'bg-white opacity-50'}`}>
              <div className="flex items-center gap-2 mb-3 text-white"><Mountain size={16}/><span className="text-sm font-bold">Step 4: 3D 生成</span></div>
              {currentStep === 4 && (
                <div className="space-y-4">
                  {/* Mode Switch — show available modes based on scene */}
                  <div className="flex gap-2">
                    {sceneId !== 'cookieCutter' && (
                      <button onClick={() => setStep4Mode('relief')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${step4Mode === 'relief' ? 'bg-white text-indigo-600' : 'bg-indigo-500 text-indigo-200'}`}>
                        <span className="flex items-center justify-center gap-1"><Layers size={12}/> 本地浮雕</span>
                      </button>
                    )}
                    {(sceneId === 'figurine' || sceneId === 'relief' || sceneId === 'keychain') && (
                      <button onClick={() => setStep4Mode('meshy3d')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${step4Mode === 'meshy3d' ? 'bg-white text-indigo-600' : 'bg-indigo-500 text-indigo-200'}`}>
                        <span className="flex items-center justify-center gap-1"><Cpu size={12}/> Meshy AI 3D</span>
                      </button>
                    )}
                    {sceneId === 'cookieCutter' && (
                      <button onClick={() => setStep4Mode('contour')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${step4Mode === 'contour' ? 'bg-white text-indigo-600' : 'bg-indigo-500 text-indigo-200'}`}>
                        <span className="flex items-center justify-center gap-1">{React.createElement(Cookie || Hexagon, { size: 12 })} 轮廓挤出</span>
                      </button>
                    )}
                  </div>

                  {step4Mode === 'relief' ? (
                    <div className="space-y-3">
                      <Slider label="基础厚度 (Base)" value={workflowData.reliefBaseHeight} min={0.5} max={10} step={0.5} onChange={v=>setWorkflowData(p=>({...p, reliefBaseHeight:v}))} />
                      <Slider label="浮雕深度 (Depth)" value={workflowData.reliefDepth} min={1} max={20} onChange={v=>setWorkflowData(p=>({...p, reliefDepth:v}))} />
                      <Slider label="网格精度 (Res)" value={workflowData.reliefResolution} min={64} max={256} step={32} onChange={v=>setWorkflowData(p=>({...p, reliefResolution:v}))} />
                      {currentScene.reliefConfig?.inverted && (
                        <div className="text-[10px] text-indigo-200 bg-indigo-500/30 p-2 rounded-lg">
                          <Sun size={10} className="inline mr-1"/> 透光片模式：暗处厚，亮处薄（反转亮度）
                        </div>
                      )}
                      {currentScene.reliefConfig?.mirrored && (
                        <div className="text-[10px] text-indigo-200 bg-indigo-500/30 p-2 rounded-lg">
                          {React.createElement(Stamp || FileBox, { size: 10, className: "inline mr-1" })} 印章模式：输出已水平镜像
                        </div>
                      )}
                      {sceneId !== 'lithophane' && (
                        <button onClick={handleExport3mf} className="w-full py-3 bg-white text-indigo-600 rounded-xl text-xs font-black shadow-lg flex items-center justify-center gap-2">
                          <Download size={14}/> 导出 3MF（带颜色）
                        </button>
                      )}
                      <button onClick={handleExportRelief} className="w-full py-2 bg-indigo-500/50 text-indigo-100 rounded-xl text-[10px] font-bold flex items-center justify-center gap-2">
                        <Download size={12}/> 导出 OBJ（无颜色）
                      </button>
                    </div>
                  ) : step4Mode === 'contour' ? (
                    <div className="space-y-3">
                      <p className="text-indigo-200 text-[10px]">从轮廓图提取边缘并挤出薄壁，生成饼干模具 OBJ 文件。</p>
                      <Slider label="壁高 (mm)" value={contourConfig.wallHeight} min={5} max={30} onChange={v=>setContourConfig(p=>({...p, wallHeight:v}))} />
                      <Slider label="壁厚 (mm)" value={contourConfig.wallThickness} min={0.8} max={3} step={0.2} onChange={v=>setContourConfig(p=>({...p, wallThickness:v}))} />
                      <button onClick={handleExportContour} className="w-full py-3 bg-white text-indigo-600 rounded-xl text-xs font-black shadow-lg flex items-center justify-center gap-2">
                        <Download size={14}/> 导出饼干模具 OBJ
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-indigo-200 text-[10px]">使用 Meshy AI 从图片生成完整 3D 模型（含贴图），可能需要 2-5 分钟。</p>
                      <button onClick={handleMeshy3D} disabled={loading || meshy3dResult} className="w-full py-3 bg-white text-indigo-600 rounded-xl text-xs font-black shadow-lg flex items-center justify-center gap-2 disabled:opacity-50">
                        {loading ? <><Loader2 className="animate-spin" size={14}/> {loadingMsg}</> : meshy3dResult ? <><CheckCircle2 size={14}/> 已生成</> : <><Cpu size={14}/> 生成 AI 3D 模型</>}
                      </button>
                      {meshy3dResult && (
                        <div className="space-y-2">
                          <a href={meshy3dResult.model_urls?.glb} target="_blank" className="w-full py-2 bg-indigo-500 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1"><Download size={12}/> 下载 GLB</a>
                          <div className="flex gap-2">
                            {meshy3dResult.model_urls?.obj && <a href={meshy3dResult.model_urls.obj} target="_blank" className="flex-1 py-1.5 bg-indigo-500/50 text-indigo-100 rounded-lg text-[10px] font-bold text-center">OBJ</a>}
                            {meshy3dResult.model_urls?.fbx && <a href={meshy3dResult.model_urls.fbx} target="_blank" className="flex-1 py-1.5 bg-indigo-500/50 text-indigo-100 rounded-lg text-[10px] font-bold text-center">FBX</a>}
                            {meshy3dResult.model_urls?.usdz && <a href={meshy3dResult.model_urls.usdz} target="_blank" className="flex-1 py-1.5 bg-indigo-500/50 text-indigo-100 rounded-lg text-[10px] font-bold text-center">USDZ</a>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 右侧展示区 */}
          <div className="lg:col-span-8 space-y-6">
            {/* 3D 预览 */}
            <div className="bg-slate-900 rounded-[2.5rem] overflow-hidden shadow-2xl relative min-h-[500px] border border-slate-800 flex items-center justify-center group">
               {currentStep >= 4 && step4Mode === 'meshy3d' && meshy3dResult?.model_urls?.glb ? (
                 <div style={{position:'absolute',top:0,left:0,right:0,bottom:0}}>
                   <MeshyScene glbUrl={meshy3dResult.model_urls.glb} />
                   <div className="absolute bottom-6 left-6 text-slate-500 text-[10px] font-mono pointer-events-none">MESHY AI 3D MODEL</div>
                   <div className="absolute bottom-0 right-0 p-6">
                      <button onClick={runPrintAnalysis} disabled={analyzing} className="text-[10px] bg-indigo-600/80 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg flex items-center gap-1 backdrop-blur">{analyzing ? <Loader2 className="animate-spin" size={10}/> : <Zap size={10}/>} 打印建议</button>
                      {printAdvice && <div className="mt-2 text-[10px] text-slate-300 bg-slate-800/80 p-3 rounded-xl max-w-xs whitespace-pre-wrap backdrop-blur">{printAdvice}</div>}
                   </div>
                 </div>
               ) : currentStep >= 4 && step4Mode === 'relief' && (workflowData.step3Image || workflowData.step2Image || workflowData.step1Image) ? (
                 <div style={{position:'absolute',top:0,left:0,right:0,bottom:0}}>
                   <ReliefScene
                     imageBase64={workflowData.step3Image || workflowData.step2Image || workflowData.step1Image}
                     depth={workflowData.reliefDepth}
                     baseHeight={workflowData.reliefBaseHeight}
                     smoothing={workflowData.reliefResolution}
                     inverted={!!currentScene.reliefConfig?.inverted}
                     mirrored={!!currentScene.reliefConfig?.mirrored}
                     cutout={!!currentScene.reliefConfig?.cutout}
                     onMeshUpdate={(mesh) => meshToExport.current = mesh}
                   />
                   <div className="absolute bottom-6 left-6 text-slate-500 text-[10px] font-mono pointer-events-none">LOCAL WEBGL RENDERER — {currentScene.label.toUpperCase()}</div>
                   <div className="absolute bottom-0 right-0 p-6">
                      <button onClick={runPrintAnalysis} disabled={analyzing} className="text-[10px] bg-indigo-600/80 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg flex items-center gap-1 backdrop-blur">{analyzing ? <Loader2 className="animate-spin" size={10}/> : <Zap size={10}/>} 打印建议</button>
                      {printAdvice && <div className="mt-2 text-[10px] text-slate-300 bg-slate-800/80 p-3 rounded-xl max-w-xs whitespace-pre-wrap backdrop-blur">{printAdvice}</div>}
                   </div>
                 </div>
               ) : currentStep >= 4 && step4Mode === 'contour' && (workflowData.step1Image) ? (
                 <div className="w-full h-full flex items-center justify-center p-8 relative">
                   <img src={workflowData.step3Image || workflowData.step2Image || workflowData.step1Image} className="max-w-full max-h-full object-contain rounded-xl shadow-lg opacity-80" alt="contour preview" />
                   <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                     <div className="bg-slate-900/70 text-white px-6 py-3 rounded-2xl backdrop-blur text-sm font-bold">
                       {React.createElement(Cookie || Hexagon, { size: 16, className: "inline mr-2" })}
                       饼干模具 — 边缘将被挤出为薄壁
                     </div>
                   </div>
                   <div className="absolute bottom-6 left-6 text-slate-500 text-[10px] font-mono pointer-events-none">CONTOUR EXTRUSION MODE</div>
                 </div>
               ) : (() => {
                 const previewImg = workflowData.step3Image || workflowData.step2Image || workflowData.step1Image;
                 if (previewImg && !loading) {
                   return (
                     <div className="w-full h-full flex items-center justify-center p-8 relative">
                       <img src={previewImg} className="max-w-full max-h-full object-contain rounded-xl shadow-lg" alt="preview" />
                       <div className="absolute bottom-6 left-6 text-slate-500 text-[10px] font-mono pointer-events-none">
                         STEP {workflowData.step3Image ? 3 : workflowData.step2Image ? 2 : 1} PREVIEW
                       </div>
                     </div>
                   );
                 }
                 return (
                   <div className="text-slate-600 flex flex-col items-center">
                     {loading ? <Loader2 className="animate-spin text-blue-500 mb-4" size={48}/> : <ImageIcon size={64} className="opacity-20"/>}
                     <span className="text-xs font-bold tracking-widest uppercase mt-4">{loading ? loadingMsg : "等待完成前序步骤"}</span>
                   </div>
                 );
               })()}
            </div>

            <div className="grid grid-cols-3 gap-4">
              {[workflowData.step1Image, workflowData.step2Image, workflowData.step3Image].map((img, i) => (
                <div key={i} className="aspect-square bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-center relative shadow-sm group">
                  {img ? (
                    <>
                      <img src={img} className="max-w-full max-h-full object-contain" alt="step" />
                      <button onClick={() => downloadImage(img, `step_${i+1}`)} className="absolute top-2 right-2 p-1.5 bg-white rounded-lg shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:text-blue-600"><Download size={12}/></button>
                    </>
                  ) : <span className="text-slate-300 text-[10px] font-bold">STEP {i+1}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Mount the app
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(AiWorkshop));
