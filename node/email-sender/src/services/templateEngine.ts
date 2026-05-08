/**
 * Email Template Engine
 * Loads and renders email templates with variable substitution
 */

import * as fs from 'fs';
import * as path from 'path';
import { getGlobalLogger } from '../logger';

const logger = getGlobalLogger();

const TEMPLATES_DIR = path.join(__dirname, 'templates');

export interface TemplateVariables {
  [key: string]: string | number | undefined;
}

export interface RenderedTemplate {
  html: string;
  text?: string;
}

/**
 * Available template names (codenames)
 */
export type TemplateName = 'otp' | 'password-reset' | 'email-verify' | 'welcome' | 'order-confirmation';

/**
 * Load template by name
 */
export function loadTemplate(templateName: TemplateName): string {
  const templatePath = path.join(TEMPLATES_DIR, `${templateName}.html`);
  
  try {
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${templateName}`);
    }
    
    const content = fs.readFileSync(templatePath, 'utf-8');
    logger.debug(`Loaded template: ${templateName}`);
    return content;
  } catch (error) {
    logger.error(`Failed to load template ${templateName}:`, error);
    throw error;
  }
}

/**
 * Render template with variables
 * Replaces {{VARIABLE_NAME}} with corresponding values
 */
export function renderTemplate(template: string, variables: TemplateVariables): string {
  let rendered = template;
  
  for (const [key, value] of Object.entries(variables)) {
    if (value === undefined || value === null) {
      continue;
    }
    
    const placeholder = `{{${key}}}`;
    const regex = new RegExp(placeholder, 'g');
    rendered = rendered.replace(regex, String(value));
  }
  
  // Log any unreplaced variables as warnings
  const unreplacedMatches = rendered.match(/\{\{[A-Z_0-9]+\}\}/g);
  if (unreplacedMatches) {
    logger.warn(`Unreplaced variables in template:`, unreplacedMatches);
  }
  
  return rendered;
}

/**
 * Get all available templates
 */
export function getAvailableTemplates(): TemplateName[] {
  try {
    const files = fs.readdirSync(TEMPLATES_DIR);
    return files
      .filter(f => f.endsWith('.html'))
      .map(f => f.replace('.html', '') as TemplateName);
  } catch (error) {
    logger.error('Failed to read templates directory:', error);
    return [];
  }
}

/**
 * Load and render template in one operation
 */
export function loadAndRenderTemplate(
  templateName: TemplateName,
  variables: TemplateVariables
): RenderedTemplate {
  const template = loadTemplate(templateName);
  const html = renderTemplate(template, variables);
  
  return {
    html,
    text: extractTextContent(html),
  };
}

/**
 * Extract plain text from HTML (simple version)
 */
function extractTextContent(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}