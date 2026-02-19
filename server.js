require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const MESHY_API_KEY = process.env.MESHY_API_KEY;
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY;

if (!MESHY_API_KEY) {
  console.error('ERROR: MESHY_API_KEY is not set in .env file');
  process.exit(1);
}
if (!SILICONFLOW_API_KEY) {
  console.error('ERROR: SILICONFLOW_API_KEY is not set in .env file');
  process.exit(1);
}

app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));

// ============ SiliconFlow Helpers (OpenAI-compatible) ============

async function siliconflowChat(model, messages) {
  const res = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SILICONFLOW_API_KEY}`,
    },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SiliconFlow API error (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ============ Meshy Helpers (async task + polling) ============

const MESHY_BASE = 'https://api.meshy.ai/openapi/v1';

async function meshyCreateTask(endpoint, payload) {
  const res = await fetch(`${MESHY_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MESHY_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meshy API error (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.result; // task id
}

async function meshyPollTask(endpoint, taskId, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${MESHY_BASE}/${endpoint}/${taskId}`, {
      headers: { 'Authorization': `Bearer ${MESHY_API_KEY}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meshy poll error (${res.status}): ${text}`);
    }
    const task = await res.json();
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED') throw new Error(`Meshy task failed: ${task.task_error?.message || 'unknown'}`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Meshy task timed out');
}

async function fetchImageAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

// ============ API Endpoints ============

// POST /api/describe-image — VLM image description (SiliconFlow vision model)
app.post('/api/describe-image', async (req, res) => {
  try {
    const { base64Data } = req.body;
    const text = await siliconflowChat('Qwen/Qwen2.5-VL-72B-Instruct', [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe the main subject of this image clearly for a 3D modeler. Focus on the character/object only. Ignore background.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Data}` } }
        ]
      }
    ]);
    res.json({ text });
  } catch (e) {
    console.error('describe-image error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/translate — translate prompt (SiliconFlow text model)
app.post('/api/translate', async (req, res) => {
  try {
    const { text } = req.body;
    const translated = await siliconflowChat('Qwen/Qwen2.5-72B-Instruct', [
      { role: 'system', content: "You are an expert prompt engineer for image generation. The user will give you a description (possibly in Chinese or other languages). Your job: 1) Translate it into English if needed. 2) Enrich it with vivid visual details suitable for image generation (pose, expression, key features, materials, proportions). 3) Keep it concise (1-3 sentences). 4) Do NOT add background descriptions. Focus only on the character/object itself. Reply with the enhanced prompt only, no explanation." },
      { role: 'user', content: text }
    ]);
    res.json({ text: translated || text });
  } catch (e) {
    console.error('translate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/generate-image — Meshy text-to-image
app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt } = req.body;
    const taskId = await meshyCreateTask('text-to-image', {
      ai_model: 'nano-banana-pro',
      prompt,
      aspect_ratio: '1:1',
    });
    const task = await meshyPollTask('text-to-image', taskId);
    const imageUrl = task.image_urls?.[0];
    if (!imageUrl) throw new Error('No image returned');
    const base64 = await fetchImageAsBase64(imageUrl);
    res.json({ base64 });
  } catch (e) {
    console.error('generate-image error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/edit-image — Meshy image-to-image
app.post('/api/edit-image', async (req, res) => {
  try {
    const { prompt, base64Data } = req.body;
    const taskId = await meshyCreateTask('image-to-image', {
      ai_model: 'nano-banana-pro',
      prompt,
      reference_image_urls: [`data:image/png;base64,${base64Data}`],
    });
    const task = await meshyPollTask('image-to-image', taskId);
    const imageUrl = task.image_urls?.[0];
    if (!imageUrl) throw new Error('No image returned');
    const base64 = await fetchImageAsBase64(imageUrl);
    res.json({ base64 });
  } catch (e) {
    console.error('edit-image error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/analyze-printing — printing advice (SiliconFlow text model)
app.post('/api/analyze-printing', async (req, res) => {
  try {
    const { description, colors, styleId } = req.body;
    const prompt = `3D Printing Expert Advice for FDM Slicing based on this model description:
  Model: ${description} (Style: ${styleId})
  Colors: ${colors.join(', ')}
  Provide: 1. Layer Height/Wall Thickness 2. Support Strategy (Overhangs) 3. Infill/Orientation 4. Post-processing. Markdown format.`;
    const text = await siliconflowChat('Qwen/Qwen2.5-72B-Instruct', [
      { role: 'user', content: prompt }
    ]);
    res.json({ text });
  } catch (e) {
    console.error('analyze-printing error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/image-to-3d — Meshy image-to-3d generation
app.post('/api/image-to-3d', async (req, res) => {
  try {
    const { base64Data, modelType } = req.body;
    const payload = {
      image_url: `data:image/png;base64,${base64Data}`,
      should_texture: true,
    };
    if (modelType === 'lowpoly') {
      payload.model_type = 'lowpoly';
    } else {
      payload.ai_model = 'meshy-6';
      payload.topology = 'triangle';
      payload.target_polycount = 30000;
    }
    const taskId = await meshyCreateTask('image-to-3d', payload);
    const task = await meshyPollTask('image-to-3d', taskId, 300000); // 5min timeout for 3D
    res.json({
      model_urls: task.model_urls,
      thumbnail_url: task.thumbnail_url,
    });
  } catch (e) {
    console.error('image-to-3d error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
