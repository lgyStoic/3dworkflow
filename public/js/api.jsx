// ==========================================
// AI 引擎服务 (通过后端代理)
// ==========================================

async function describeImage(base64Image) {
  const base64Data = base64Image.split(',')[1];
  const res = await fetch('/api/describe-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Data })
  });
  if (!res.ok) throw new Error('VLM Analysis failed');
  const result = await res.json();
  if (result.error) throw new Error(result.error);
  return result.text;
}

async function translateDescription(userInput) {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: userInput })
  });
  if (!res.ok) throw new Error('Translation failed');
  const result = await res.json();
  if (result.error) throw new Error(result.error);
  return result.text;
}

async function generateImage(prompt, styleId, sceneId = 'relief') {
  const styleConfig = STYLE_PRESETS[styleId];
  const sceneConfig = SCENE_PRESETS[sceneId];
  const finalPrompt = sceneConfig.prompts.step1(styleConfig.promptModifier, prompt);
  const res = await fetch('/api/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: finalPrompt })
  });
  if (!res.ok) throw new Error('Imagen failed');
  const result = await res.json();
  if (result.error) throw new Error(result.error);
  return `data:image/png;base64,${result.base64}`;
}

async function editImage(prompt, base64Image) {
  const base64Data = base64Image.split(',')[1];
  const res = await fetch('/api/edit-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, base64Data })
  });
  if (!res.ok) throw new Error('Edit failed');
  const result = await res.json();
  if (result.error) throw new Error(result.error);
  return `data:image/png;base64,${result.base64}`;
}

async function traceImage(referenceDesc, base64Image, styleId, sceneId = 'relief') {
  const styleConfig = STYLE_PRESETS[styleId];
  const sceneConfig = SCENE_PRESETS[sceneId];
  const prompt = sceneConfig.prompts.step1Trace(styleConfig.promptModifier, referenceDesc);
  return await editImage(prompt, base64Image);
}

async function refineStructure(base64Image, sceneId = 'relief') {
  const sceneConfig = SCENE_PRESETS[sceneId];
  if (!sceneConfig.prompts.step2) return base64Image;
  const prompt = sceneConfig.prompts.step2();
  return await editImage(prompt, base64Image);
}

async function colorFill(base64Image, customColors, sceneId = 'relief') {
  const sceneConfig = SCENE_PRESETS[sceneId];
  if (!sceneConfig.prompts.step3) return base64Image;
  const colors = customColors && customColors.length > 0 ? customColors.join(', ') : "Black, Orange, White, Green";
  const prompt = sceneConfig.prompts.step3(colors);
  return await editImage(prompt, base64Image);
}

async function analyzePrintingConfig(description, colors, styleId) {
  const res = await fetch('/api/analyze-printing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, colors, styleId })
  });
  if (!res.ok) throw new Error('Analysis failed');
  const result = await res.json();
  if (result.error) throw new Error(result.error);
  return result.text;
}

async function generateMeshy3D(base64Image, modelType = 'standard') {
  const base64Data = base64Image.split(',')[1];
  const res = await fetch('/api/image-to-3d', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Data, modelType })
  });
  if (!res.ok) throw new Error('3D generation failed');
  const result = await res.json();
  if (result.error) throw new Error(result.error);
  return result;
}
