#!/usr/bin/env node
/**
 * Build script for AutoPlan plugin
 * Bundles src/core.js into plugin/plugin.js
 * Minifies src/index.html to plugin/index.html (including inline JS and CSS)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { minify } from 'terser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read core.js and strip ES module syntax
let coreCode = readFileSync(join(__dirname, 'src/core.js'), 'utf-8');

// Remove export keywords
coreCode = coreCode.replace(/^export\s+/gm, '');
coreCode = coreCode.replace(/^export\s*{\s*[\w\s,]+\s*};?\s*$/gm, '');

// Read plugin template
const pluginTemplate = readFileSync(join(__dirname, 'src/plugin-template.js'), 'utf-8');

// Combine: core code + plugin-specific code
const pluginCode = `/**
 * AutoPlan - Automatic Task Scheduler for Super Productivity
 * 
 * This plugin implements an urgency-based scheduling algorithm similar to taskcheck.
 * It calculates task priority based on:
 * 1. Base priority (order in list)
 * 2. Tag-based priority boosts
 * 3. Estimated duration factor
 * 4. Task age/oldness factor
 * 
 * Then it splits tasks into time blocks and schedules them by urgency.
 * 
 * AUTO-GENERATED FILE - Do not edit directly!
 * Edit src/core.js and src/plugin-template.js instead, then run: npm run build
 */

${coreCode}

${pluginTemplate}
`;

// Write plugin.js
writeFileSync(join(__dirname, 'plugin/plugin.js'), pluginCode);
console.log('Built plugin/plugin.js successfully');

// Minify CSS
function minifyCSS(css) {
  // Remove comments
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove whitespace around special characters
  css = css.replace(/\s*([{};:,>+~])\s*/g, '$1');
  // Remove whitespace at start/end of lines
  css = css.split('\n').map(line => line.trim()).join('');
  // Remove empty rules
  css = css.replace(/[^{}]+\{\s*\}/g, '');
  // Collapse multiple spaces
  css = css.replace(/\s+/g, ' ');
  return css.trim();
}

// Minify index.html from src to plugin
async function minifyHTML() {
  const srcIndexPath = join(__dirname, 'src/index.html');
  const destIndexPath = join(__dirname, 'plugin/index.html');

  if (!existsSync(srcIndexPath)) {
    console.warn('Warning: src/index.html not found, skipping HTML minification');
    return;
  }

  let html = readFileSync(srcIndexPath, 'utf-8');
  const originalSize = html.length;

  // Extract and minify all <script> tags
  const scriptRegex = /<script>([\s\S]*?)<\/script>/g;
  let match;
  const scripts = [];
  
  while ((match = scriptRegex.exec(html)) !== null) {
    scripts.push({
      full: match[0],
      content: match[1]
    });
  }

  // Minify each script
  for (const script of scripts) {
    try {
      const result = await minify(script.content, {
        compress: {
          dead_code: true,
          drop_console: false,
          drop_debugger: true,
          conditionals: true,
          evaluate: true,
          booleans: true,
          loops: true,
          unused: true,
          if_return: true,
          join_vars: true,
          collapse_vars: true,
          reduce_vars: true,
        },
        mangle: {
          reserved: ['PluginAPI', 'showStatus', 'showTab', 'saveSettings', 'loadSettings', 
                     'runAutoPlanner', 'clearPlanning', 'addTagPriority', 'removeTagPriority',
                     'addProjectPriority', 'removeProjectPriority', 'updateFormulaPreview',
                     'showAddTimeMapModal', 'editTimeMap', 'deleteTimeMap', 'saveTimeMap',
                     'hideTimeMapModal', 'toggleDaySkip', 'addProjectTimeMapAssignment',
                     'removeProjectTimeMapAssignment', 'addTagTimeMapAssignment', 
                     'removeTagTimeMapAssignment', 'updateDefaultTimeMap', 'resetToDefaults',
                     'showClearPlanningModal', 'hideClearPlanningModal', 'confirmClearPlanning']
        },
        format: {
          comments: false
        }
      });
      
      if (result.code) {
        html = html.replace(script.full, `<script>${result.code}</script>`);
      }
    } catch (e) {
      console.error('Error minifying script:', e.message);
      // Keep original on error
    }
  }

  // Extract and minify all <style> tags
  const styleRegex = /<style>([\s\S]*?)<\/style>/g;
  const styles = [];
  
  while ((match = styleRegex.exec(html)) !== null) {
    styles.push({
      full: match[0],
      content: match[1]
    });
  }

  // Minify each style
  for (const style of styles) {
    const minified = minifyCSS(style.content);
    html = html.replace(style.full, `<style>${minified}</style>`);
  }

  // Minify HTML structure
  // 1. Remove HTML comments (but not conditional comments)
  html = html.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
  
  // 2. Remove leading/trailing whitespace from lines
  html = html.split('\n').map(line => line.trim()).join('\n');
  
  // 3. Remove empty lines
  html = html.replace(/\n\s*\n/g, '\n');
  
  // 4. Remove whitespace between tags (but be careful with inline elements)
  html = html.replace(/>\s+</g, '><');
  
  // 5. Remove newlines
  html = html.replace(/\n/g, '');

  const newSize = html.length;
  writeFileSync(destIndexPath, html);
  
  const reduction = Math.round((1 - newSize/originalSize) * 100);
  console.log(`Minified src/index.html -> plugin/index.html: ${originalSize} -> ${newSize} bytes (${reduction}% reduction)`);
  
  if (newSize > 100000) {
    console.warn(`⚠️  WARNING: plugin/index.html is ${newSize} bytes, exceeding 100KB limit!`);
  } else {
    console.log(`✓ Size OK: ${newSize} bytes (${100000 - newSize} bytes under limit)`);
  }
}

minifyHTML().catch(console.error);
