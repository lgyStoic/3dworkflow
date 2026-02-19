const { useState, useEffect, useRef } = React;
const {
  Box, Download, RefreshCcw, Info,
  CheckCircle2, AlertCircle, Loader2, Image: ImageIcon,
  Cpu, Wand2, RotateCcw, Sticker, Printer, Zap, Sparkles,
  Grid3X3, Hexagon, Ghost, Bot, Upload, X, FileBox, ScanEye,
  Settings2, Palette, BrainCircuit, Layers, Mountain,
  Key, Sun, Stamp, Cookie, Magnet
} = LucideReact;

// ==========================================
// 艺术风格预设 (Style Presets)
// ==========================================

const STYLE_PRESETS = {
  standard: { id: 'standard', label: '标准 FDM', icon: React.createElement(Box, { size: 14 }), promptModifier: "designed as a children's toy model" },
  lowpoly: { id: 'lowpoly', label: '低多边形', icon: React.createElement(Hexagon, { size: 14 }), promptModifier: 'low poly style, faceted geometry' },
  voxel: { id: 'voxel', label: '体素风', icon: React.createElement(Grid3X3, { size: 14 }), promptModifier: 'voxel art style, constructed from cubes' },
  chibi: { id: 'chibi', label: 'Q版可爱', icon: React.createElement(Ghost, { size: 14 }), promptModifier: 'chibi style, super deformed proportions' },
  mecha: { id: 'mecha', label: '机甲硬核', icon: React.createElement(Bot, { size: 14 }), promptModifier: 'mecha style, industrial robotic parts' },
  organic: { id: 'organic', label: '生物有机', icon: React.createElement(Sparkles, { size: 14 }), promptModifier: 'organic style, smooth biomimetic shapes' }
};

// ==========================================
// 场景预设 (Scene Presets)
// ==========================================

const SCENE_PRESETS = {
  figurine: {
    id: 'figurine', label: '手办', icon: Bot,
    description: '完整立体角色，适合 Meshy AI 3D 建模',
    enabledSteps: [1, 1.5, 2, 3, 4],
    defaultExportMode: 'meshy3d',
    prompts: {
      step1: (styleModifier, subject) => `
        A concept art of a character figurine, 2D orthogonal front view, ${styleModifier}.
        Character: ${subject}.
        Requirements: Volumetric shading to show depth and form. Character MUST stand on a thick circular base.
        Compact proportions suitable for 3D FDM printing. No thin or floating parts.
        Negative Prompt: multiple views, character sheet, split screen, side view, back view, text, watermark.
      `,
      step1Trace: (styleModifier, desc) => `
        Redraw this reference image as a concept art figurine, 2D orthogonal front view.
        Target Style: ${styleModifier}.
        Subject: ${desc}.
        Requirements: Show volumetric form with shading. Character on a thick circular base. Single front view only.
      `,
      step2: () => `
        Optimize the structure for 3D printing.
        Requirements: Thicken all weak connection points (neck, ankles, arms). Ensure base connection is solid.
        Maintain the overall style and detail. Make the figure more robust for FDM printing.
      `,
      step3: (colors) => `
        Apply color to this character concept art.
        Color palette: ${colors}.
        Style: Clean flat coloring with subtle shading for volume. Clear color boundaries.
        Keep the structural details visible. Base should be dark colored.
      `
    },
    reliefConfig: null
  },
  relief: {
    id: 'relief', label: '浮雕', icon: Mountain,
    description: '经典浮雕效果，黑白线稿转 3D 浮雕',
    enabledSteps: [1, 1.5, 2, 3, 4],
    defaultExportMode: 'relief',
    prompts: {
      step1: (styleModifier, subject) => `
        A black and white line art, 2D orthogonal front view, ${styleModifier}.
        Reference Character: ${subject}.
        Core Requirements: ONLY thick black lines on white background. Lines must be clear, closed, no breaks.
        Structure Requirements: Character MUST be connected to a thick circular base at the bottom. Compact structure, avoid thin or floating parts, suitable for 3D FDM printing. Emphasize outlines and separation lines.
        Negative Prompt: multiple views, character sheet, split screen, side view, back view, gray scale, shading, gradient, text, watermark, thin lines, broken lines.
      `,
      step1Trace: (styleModifier, desc) => `
        Trace this reference image into a black and white line art, 2D orthogonal front view.
        Target Style: ${styleModifier}.
        Subject: ${desc}.
        Core Requirements: Convert all colors to thick black outlines on white background. Remove all shading and gradients.
        Structure: Ensure the character stands on a thick circular base. Check for closed loops.
        CRITICAL: Output a SINGLE VIEW only. Do not generate a character sheet.
      `,
      step2: () => `
        Optimize the structure of the previous line art.
        Core Requirements: Significantly thicken all weak connection points (neck, ankles, arm connections). Ensure the base connection is very solid. Check and close all tiny line gaps. Maintain black and white line art style.
      `,
      step3: (colors) => `
        Vector color fill of the previous line art.
        Strict Color Limit: 4 colors only (${colors}).
        Coloring Rules:
        1. Keep original thick black outlines unchanged.
        2. Fill closed areas with the specified colors.
        3. Style: Flat Design, pure solid color blocks. NO gradients, NO shadows, NO highlights, NO textures. Clear boundaries.
        4. Fill the base with Black or Dark Green for stability appearance.
      `
    },
    reliefConfig: { depth: 5, baseHeight: 3 }
  },
  keychain: {
    id: 'keychain', label: '钥匙扣', icon: Key,
    description: '小尺寸挂件，顶部带挂孔',
    enabledSteps: [1, 1.5, 2, 3, 4],
    defaultExportMode: 'meshy3d',
    prompts: {
      step1: (styleModifier, subject) => `
        A black and white line art, 2D orthogonal front view, ${styleModifier}.
        Subject: ${subject}.
        Core Requirements: ONLY thick black lines on white background. Simplified design suitable for small size (3-5cm).
        MUST have a small circular HOLE at the top for keychain ring attachment.
        Compact shape, no thin protruding parts. Thick outlines.
        Negative Prompt: multiple views, shading, gradient, text, watermark, thin lines.
      `,
      step1Trace: (styleModifier, desc) => `
        Trace this into a simplified black and white line art for a keychain.
        Style: ${styleModifier}. Subject: ${desc}.
        Simplify details for small size. Add a circular hole at top for ring attachment.
        Thick black outlines on white background only.
      `,
      step2: () => `
        Optimize for keychain production. Thicken ALL lines significantly.
        Ensure the hanging hole at top is clearly defined and circular.
        Remove any thin details that would break at small scale. Black and white only.
      `,
      step3: (colors) => `
        Color fill for keychain design. Colors: ${colors}.
        Flat solid colors only, no gradients. Bold, simple color blocks suitable for small scale viewing.
        CRITICAL: Keep the background PURE WHITE. Do not add any background color or border.
      `
    },
    reliefConfig: { depth: 1, baseHeight: 2, cutout: true }
  },
  fridgeMagnet: {
    id: 'fridgeMagnet', label: '冰箱贴', icon: Magnet || Sticker,
    description: '浅浮雕装饰片，跳过加固步骤',
    enabledSteps: [1, 1.5, 3, 4],
    defaultExportMode: 'relief',
    prompts: {
      step1: (styleModifier, subject) => `
        A black and white line art, 2D orthogonal front view, ${styleModifier}.
        Subject: ${subject}.
        Design for a decorative fridge magnet. Simple, bold outlines on white background.
        Rounded rectangular boundary. Cute, decorative style suitable for kitchen display.
        Negative Prompt: multiple views, shading, gradient, thin lines, complex details.
      `,
      step1Trace: (styleModifier, desc) => `
        Trace into a simplified decorative line art for a fridge magnet.
        Style: ${styleModifier}. Subject: ${desc}.
        Bold black outlines on white. Simple, cute design with rounded edges.
      `,
      step2: null,
      step3: (colors) => `
        Color fill for fridge magnet. Colors: ${colors}.
        Bright, cheerful flat colors. No gradients. Clear bold color blocks.
        Style suitable for a decorative kitchen magnet.
        CRITICAL: Keep the background PURE WHITE. Do not add any background color or border.
      `
    },
    reliefConfig: { depth: 1.5, baseHeight: 2, cutout: true }
  },
  lithophane: {
    id: 'lithophane', label: '透光片', icon: Sun || ScanEye,
    description: '照片转透光浮雕，暗处厚亮处薄',
    enabledSteps: [1, 1.5, 4],
    defaultExportMode: 'relief',
    prompts: {
      step1: (styleModifier, subject) => `
        A grayscale image with rich tonal gradients, ${styleModifier}.
        Subject: ${subject}.
        Requirements: Smooth grayscale transitions from pure black to pure white.
        Rich midtone detail for lithophane light transmission effect.
        No sharp edges or pure line art. Soft, photographic quality.
        Negative Prompt: color, line art, flat design, text, watermark.
      `,
      step1Trace: (styleModifier, desc) => `
        Convert this image to optimized grayscale for lithophane production.
        Subject: ${desc}. Style: ${styleModifier}.
        Create smooth tonal gradients. Enhance contrast for light transmission.
        Pure grayscale, no color.
      `,
      step2: null,
      step3: null
    },
    reliefConfig: { depth: 3, baseHeight: 0.8, inverted: true, resolution: 192 }
  },
  stamp: {
    id: 'stamp', label: '印章', icon: Stamp || FileBox,
    description: '高对比图案，自动镜像输出',
    enabledSteps: [1, 1.5, 3, 4],
    defaultExportMode: 'relief',
    prompts: {
      step1: (styleModifier, subject) => `
        A high contrast black and white silhouette or seal design, ${styleModifier}.
        Subject: ${subject}.
        Requirements: Pure black and white ONLY. No gray tones.
        Bold, thick shapes suitable for rubber stamp production.
        Clear, well-defined edges. Design should work as a stamp impression.
        Negative Prompt: gradients, shading, thin lines, gray tones, multiple views.
      `,
      step1Trace: (styleModifier, desc) => `
        Convert to a high-contrast stamp design. Subject: ${desc}. Style: ${styleModifier}.
        Pure black and white silhouette. No gray tones. Bold shapes for stamp use.
      `,
      step2: null,
      step3: (colors) => `
        This is a stamp design. Apply minimal color: ${colors}.
        Keep maximum contrast. The design must remain clearly readable as a stamp.
        Bold flat colors only.
      `
    },
    reliefConfig: { depth: 4, baseHeight: 5, mirrored: true }
  },
  cookieCutter: {
    id: 'cookieCutter', label: '饼干模具', icon: Cookie || Hexagon,
    description: '纯轮廓挤出薄壁，导出 OBJ',
    enabledSteps: [1, 1.5, 4],
    defaultExportMode: 'contour',
    prompts: {
      step1: (styleModifier, subject) => `
        A pure black outline on white background, single closed contour shape, ${styleModifier}.
        Subject: ${subject}.
        Requirements: ONLY the outer contour/silhouette outline. Single continuous closed loop.
        Thick black outline (3-5px), pure white interior and exterior.
        Simple recognizable shape suitable for cookie cutter production.
        NO internal details, NO fill, NO shading. Just the outline shape.
        Negative Prompt: internal details, shading, fill, multiple shapes, text, open curves.
      `,
      step1Trace: (styleModifier, desc) => `
        Extract only the outer contour silhouette from this image.
        Subject: ${desc}. Style: ${styleModifier}.
        Output: single thick black closed outline on white background.
        Remove ALL internal details. Only the outer shape boundary.
      `,
      step2: null,
      step3: null
    },
    reliefConfig: null,
    contourConfig: { wallHeight: 15, wallThickness: 1.2 }
  }
};
