import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function renderEmailTemplate({ code, firstName, lastName, email, templateName = 'email.html' }) {
  const templatePath = path.join(__dirname, '..', 'templates', 'emails', templateName);

  if (!fs.existsSync(templatePath)) {
    console.error(`Template not found: ${templatePath}`);
    return "";
  }

  let html = fs.readFileSync(templatePath, 'utf8');

  return html
    .replace(/\{\{CODE\}\}/g, code || "")
    .replace(/\{\{firstName\}\}/g, firstName || "")
    .replace(/\{\{lastName\}\}/g, lastName || "")
    .replace(/\{\{email\}\}/g, email || "");
} 