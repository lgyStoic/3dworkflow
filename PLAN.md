# AI 灵感工坊 — 项目架构与流程文档

## 项目概述
一个基于 AI 的 3D 打印工作流应用。用户选择场景类型（手办、浮雕、钥匙扣、冰箱贴、透光片、印章、饼干模具），输入描述或上传参考图，经过 AI 多步处理后生成适合 FDM 3D 打印的模型。支持本地浮雕生成（带颜色 3MF 导出）、Meshy AI 全 3D 建模、以及饼干模具轮廓挤出三种输出方式。

## 技术栈
- **前端**: React 18 (CDN UMD) + Tailwind CSS + Three.js r128 + Lucide Icons + JSZip
- **后端**: Node.js + Express
- **AI 服务**:
  - **Meshy API** — 图片生成/编辑 (`text-to-image`, `image-to-image`) + 3D 建模 (`image-to-3d`)
  - **SiliconFlow API** — 文本/视觉 LLM（OpenAI 兼容格式，使用 Qwen 模型）

## 项目结构
```
3dworkflow/
├── server.js              # Express 后端，代理所有 AI API 调用
├── public/
│   ├── index.html          # 入口 HTML，加载 CDN 依赖，按顺序 fetch 多个 .jsx 拼接后 Babel 编译
│   ├── test-3mf.html       # 3MF 多色导出自动测试页（Production Extension 格式验证）
│   ├── app.jsx.bak         # 旧单文件备份
│   └── js/                 # 前端源码（7 个 .jsx 文件，共享全局作用域，无 import/export）
│       ├── presets.jsx      # 数据层：Lucide/React destructure + STYLE_PRESETS + SCENE_PRESETS
│       ├── utils.jsx        # 工具函数：wait, fetchWithRetry, exportToObj, exportTo3mf, exportContourCutter
│       ├── api.jsx          # AI 服务：describeImage, translateDescription, generateImage, editImage 等
│       ├── MeshyScene.jsx   # Three.js GLB 预览组件
│       ├── ReliefScene.jsx  # Three.js 浮雕生成引擎（cutout/plate 模式）
│       ├── ui.jsx           # 通用 UI 组件：StepControl, Slider
│       └── app.jsx          # 主组件 AiWorkshop + ReactDOM mount
├── .env                    # API Keys（MESHY_API_KEY, SILICONFLOW_API_KEY）
├── .env.example
├── package.json
├── PLAN.md                 # 本文档
└── base.html               # 备份/参考文件
```

### 前端加载机制
`index.html` 按顺序 fetch 7 个 `.jsx` 文件，拼接成一个字符串后统一交给 Babel Standalone 编译。
所有文件共享全局作用域（无 webpack/vite），加载顺序保证依赖关系：
1. `presets.jsx` — 定义全局常量（React hooks, Lucide icons, STYLE_PRESETS, SCENE_PRESETS）
2. `utils.jsx` — 工具函数（依赖无）
3. `api.jsx` — AI 服务函数（依赖 STYLE_PRESETS, SCENE_PRESETS, fetchWithRetry）
4. `MeshyScene.jsx` — GLB 预览组件（依赖 THREE, React hooks）
5. `ReliefScene.jsx` — 浮雕引擎组件（依赖 THREE, React hooks）
6. `ui.jsx` — UI 组件（依赖 React hooks, Lucide icons）
7. `app.jsx` — 主组件 + 挂载（依赖以上所有）

## 核心架构：场景驱动的多模式工作流

### 场景预设 (SCENE_PRESETS)
场景类型 (scene) 和艺术风格 (style) 正交组合。7 种场景各自定义：

| 场景 | ID | 启用步骤 | 默认导出模式 | 浮雕特殊参数 |
|---|---|---|---|---|
| 手办 | `figurine` | 1, 1.5, 2, 3, 4 | meshy3d | 无（走 Meshy AI 3D） |
| 浮雕 | `relief` | 1, 1.5, 2, 3, 4 | relief | depth=5, base=3 |
| 钥匙扣 | `keychain` | 1, 1.5, 2, 3, 4 | **meshy3d** | 走 Meshy AI 3D（同手办） |
| 冰箱贴 | `fridgeMagnet` | 1, 1.5, 3, 4 | relief | depth=1.5, base=2, **cutout=true** |
| 透光片 | `lithophane` | 1, 1.5, 4 | relief | depth=3, base=0.8, **inverted=true**, res=192 |
| 印章 | `stamp` | 1, 1.5, 3, 4 | relief | depth=4, base=5, **mirrored=true** |
| 饼干模具 | `cookieCutter` | 1, 1.5, 4 | **contour** | wallHeight=15, wallThickness=1.2 |

每个场景包含：`id, label, icon, description, enabledSteps, prompts(step1/step1Trace/step2/step3), defaultExportMode, reliefConfig/contourConfig`

### 艺术风格预设 (STYLE_PRESETS)
6 种风格，与场景正交组合：标准 FDM / 低多边形 / 体素风 / Q版可爱 / 机甲硬核 / 生物有机

## API 接口映射

| 接口路径 | 功能 | 后端服务 | 模型 |
|---|---|---|---|
| `POST /api/describe-image` | 视觉理解：分析上传图片，生成文字描述 | SiliconFlow | `Qwen/Qwen2.5-VL-72B-Instruct` |
| `POST /api/translate` | 翻译 + Prompt 增强：中文→英文，并补充视觉细节 | SiliconFlow | `Qwen/Qwen2.5-72B-Instruct` |
| `POST /api/generate-image` | 文生图：根据 prompt 生成图片 | Meshy | `nano-banana-pro` (text-to-image) |
| `POST /api/edit-image` | 图生图：根据 prompt + 参考图编辑图片 | Meshy | `nano-banana-pro` (image-to-image) |
| `POST /api/image-to-3d` | 图生3D：从图片生成完整 3D 模型（含贴图） | Meshy | `meshy-6` (image-to-3d) |
| `POST /api/analyze-printing` | 打印建议：AI 分析模型并给出 FDM 切片建议 | SiliconFlow | `Qwen/Qwen2.5-72B-Instruct` |

**后端不改**：所有 API 端点通用，差异化全在前端 prompt 构造。

## Meshy API 调用特点（异步轮询）
Meshy 是异步 API，流程为：
1. **POST 创建任务** → 返回 `taskId`
2. **GET 轮询状态**（每 3 秒）→ 等待 `SUCCEEDED`
3. 图片接口：获取 `image_urls` → **fetch 图片并转 base64** 返回前端（超时 120 秒）
4. 3D 接口：获取 `model_urls`（GLB/FBX/OBJ/USDZ）直接返回 URL（超时 300 秒）

## 用户工作流

### Step 0: 场景选择
- 左侧操作区最顶部，2×4 网格按钮，每按钮有图标 + 中文标签
- 切换场景时重置所有步骤产物和 3D 结果
- 自动设置该场景的默认浮雕参数和导出模式
- 被禁用的步骤（如冰箱贴的 Step 2）自动隐藏

### Step 1: 基础图片生成 (Structure)
**两种输入路径：**

**路径 A — 文字描述：**
1. 用户输入中文描述
2. 选择风格预设（6 种）
3. → `/api/translate` 翻译 + prompt 增强
4. → `/api/generate-image` 根据场景生成对应类型图片：
   - 手办：概念图，带体积感光影，必须有底座
   - 浮雕/钥匙扣/冰箱贴：严格黑白线稿，正交视图
   - 钥匙扣：额外要求顶部挂孔
   - 透光片：灰度图，丰富层次
   - 印章：高对比度剪影
   - 饼干模具：纯轮廓线，闭合轮廓

**路径 B — 上传参考图：**
1. 用户上传参考图片
2. → `/api/describe-image` VLM 分析
3. → `/api/edit-image` 按场景类型重绘

**Step 1.5: 图片修改（可选，可反复执行）**
- 用户输入修改指令 → 翻译 → editImage

### Step 2: 结构加固 (Refinement) — 部分场景启用
- 手办/浮雕/钥匙扣：启用，AI 加厚薄弱连接
- 冰箱贴/透光片/印章/饼干模具：跳过
- 用户可选择跳过

### Step 3: 填色 (Color Fill) — 部分场景启用
- 手办/浮雕/钥匙扣/冰箱贴/印章：启用
- 透光片/饼干模具：跳过
- 用户自定义 2-6 个颜色
- cutout 场景（钥匙扣/冰箱贴）的 step3 prompt 强制保留纯白背景，避免 AI 添加背景色干扰裁切

### Step 4: 3D 生成（三种模式）

**模式 A — 本地浮雕（浮雕/钥匙扣/冰箱贴/透光片/印章）：**
- Three.js 将图片转为实体浮雕 3D 模型
- 可调参数：基础厚度、浮雕深度、网格精度
- 特殊模式：
  - **钥匙扣/冰箱贴 (cutout)**：按轮廓裁切，背景白色区域无几何体，只保留前景形状
  - **透光片 (inverted)**：亮度反转，暗处厚亮处薄，隐藏颜色导出
  - **印章 (mirrored)**：水平翻转 canvas，输出镜像浮雕
- 导出 3MF（多色，Production Extension 多部件方案，兼容 OrcaSlicer/Bambu Studio AMS）/ OBJ（无颜色）

**模式 B — Meshy AI 3D（手办/浮雕可选）：**
- → `/api/image-to-3d` 云端生成完整 3D 模型
- 根据风格自动选择 Meshy 模式：
  - **低多边形/体素风** → `model_type: "lowpoly"`（Meshy 原生低面数生成，忽略 polycount）
  - **其他风格** → `model_type: "standard"`（meshy-6，30000 面）
- Three.js GLTFLoader 预览 GLB
- 多格式下载：GLB / OBJ / FBX / USDZ

**模式 C — 轮廓挤出（饼干模具专用）：**
- 图片二值化（阈值 128）→ 边缘检测 → 薄壁挤出
- 可调参数：壁高 (5-30mm)、壁厚 (0.8-3mm)
- 导出 OBJ

### 步骤流控制
- `goToNextStep(current)` 函数自动跳过被禁用的步骤
- 跳过的步骤自动传递上一步图片
- "下一步"按钮文案根据场景动态显示

### 附加功能: 打印建议
- → `/api/analyze-printing` AI 给出 FDM 切片参数建议

## 预览系统
主预览区根据当前步骤和模式自动切换：
- **Steps 1-3**：实时显示最新生成的图片
- **Step 4 本地浮雕模式**：Three.js WebGL 3D 浮雕渲染（支持 inverted/mirrored）
- **Step 4 Meshy 3D 模式**：Three.js GLTFLoader 加载 GLB
- **Step 4 轮廓挤出模式**：显示原图 + 叠加说明文字
- 底部始终显示 Step 1/2/3 的缩略图

## 前端架构

### 重试机制
`fetchWithRetry` — 指数退避重试，最多 5 次（1s, 2s, 4s, 8s, 16s）

### 数据流
- **图片数据**：以 base64 data URL 形式在前端流转
- **3D 模型数据**：后端返回 Meshy 签名 URL，前端直接加载/下载
- **3MF 导出**：纯前端生成，JSZip 打包，采用 **Production Extension 多部件分色方案**（见下方详细说明）
- **饼干模具 OBJ**：纯前端生成，边缘检测 + 薄壁挤出

### 关键组件
- `AiWorkshop` — 主状态管理，驱动整个工作流，含场景选择逻辑
- `ReliefScene` — Three.js 实体浮雕渲染器（支持 inverted/mirrored/cutout props，cutout 模式 UV 已修正翻转）
- `MeshyScene` — Three.js GLB 3D 模型预览器
- `StepControl` — 步骤卡片 UI（条件渲染，由 enabledSteps 控制）
- `Slider` — 参数滑块

### 关键工具函数
- `exportToObj(mesh)` — 从 Three.js mesh 导出 OBJ
- `exportTo3mf(mesh, imageBase64, numFilaments=4)` — 从 mesh + 原图生成多色 3MF（Production Extension 多部件分色，兼容 OrcaSlicer/Bambu Studio AMS 多色打印）
- `exportContourCutter(imageBase64, config)` — 饼干模具轮廓挤出导出 OBJ
- `fetchWithRetry(fn, maxRetries)` — 指数退避重试

### 关键 AI 函数（场景感知）
- `generateImage(prompt, styleId, sceneId)` — Step 1 文生图
- `traceImage(desc, img, styleId, sceneId)` — 参考图重绘
- `refineStructure(img, sceneId)` — Step 2 加固
- `colorFill(img, colors, sceneId)` — Step 3 填色

### CDN 依赖
- React 18 + ReactDOM 18
- Babel Standalone（浏览器端 JSX 编译）
- Three.js r128（含 OrbitControls + GLTFLoader）
- Tailwind CSS
- Lucide React Icons（含 Key, Sun, Stamp, Cookie, Magnet 等新增图标）
- JSZip 3.10（3MF 打包）

## 3MF 多色导出方案（Production Extension 多部件分色）

### 核心策略
按颜色将 mesh 拆分为 N 个子对象（默认 4 个，对应 AMS 4 色槽位），每个子对象放在独立 `.model` 文件中，通过 `model_settings.config` 指定不同 extruder。**不使用 `paint_color`**（会触发 TriangleSelector 反序列化崩溃）。

### 颜色处理流程
1. 从原图采样每个三角面中心点颜色（UV 映射到 XY 平面）
2. RGB 按 Q=51 量化（web-safe 6 级/通道）减少颜色数
3. 保留使用最多的 4 种颜色，其余按欧氏距离合并到最近颜色
4. 按颜色分组三角面，每组重建独立顶点/面片索引

### 3MF 文件结构
```
├── [Content_Types].xml                    # MIME 类型声明
├── _rels/.rels                            # 根关系 → 3dmodel.model
├── 3D/3dmodel.model                       # 组装对象（xmlns:BambuStudio + xmlns:p）
├── 3D/_rels/3dmodel.model.rels            # 子文件关系 → object_N.model
├── 3D/Objects/object_1.model              # 颜色1 mesh（object id=1）
├── 3D/Objects/object_2.model              # 颜色2 mesh（object id=2）
├── 3D/Objects/object_3.model              # 颜色3 mesh（object id=3）
├── 3D/Objects/object_4.model              # 颜色4 mesh（object id=4）
├── Metadata/model_settings.config         # 每个 part 指定 extruder 1-4
└── Metadata/project_settings.config       # filament 槽位定义（JSON，含颜色/类型/冲刷量）
```

### 关键技术点
- **Production Extension** (`xmlns:p`): 组装对象通过 `<component p:path="/3D/Objects/object_N.model" objectid="1"/>` 引用子文件
- **BambuStudio 命名空间** (`xmlns:BambuStudio`): 仅在组装文件 `3dmodel.model` 中声明，触发 OrcaSlicer/BS 解析 `model_settings.config`
- **子文件 object id 必须唯一**: `object_N.model` 中 `<object id="N">`，必须与 config 中 `<part id="N">` 一致（BambuStudio 按 id 匹配 part↔volume，非按顺序）
- **`p:UUID` 必需**: Production Extension 规范要求所有 `<object>`, `<build>`, `<item>`, `<component>` 带 `p:UUID`，BambuStudio 严格执行（缺少会导致部件分离），OrcaSlicer 可忽略
- **无 paint_color**: 完全绕过 TriangleSelector，避免外部生成 mesh 缺少边邻接数据导致的崩溃
- **`project_settings.config`**: JSON 格式，包含 `filament_colour`/`filament_type`/`filament_settings_id` 数组（N 个条目），告诉 BambuStudio 创建对应数量的 filament 槽位。不含此文件时 slicer 使用当前项目配置的 filament 数量，可能不足 N 个
- **测试页面**: `public/test-3mf.html` — 自动测试文件结构、分色、组装引用、config 配置

## 环境变量
```env
MESHY_API_KEY=xxx       # Meshy API 密钥
SILICONFLOW_API_KEY=xxx # SiliconFlow API 密钥
```

## 启动方式
```bash
npm install    # 安装依赖（express, dotenv）
node server.js # 启动服务 → http://localhost:3000
```
