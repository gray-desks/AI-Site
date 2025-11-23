/**
 * @fileoverview Static Site Generation (SSG) Helper
 * Handles the injection of common components (Header, Footer) into HTML files during the build process.
 */

const path = require('path');
const fs = require('fs');

// テンプレートファイルのパス
const TEMPLATE_DIR = path.resolve(__dirname, '../templates/components');
const HEADER_TEMPLATE_PATH = path.join(TEMPLATE_DIR, 'header.html');
const FOOTER_TEMPLATE_PATH = path.join(TEMPLATE_DIR, 'footer.html');

// テンプレートキャッシュ
let cachedHeaderTemplate = null;
let cachedFooterTemplate = null;

/**
 * テンプレートファイルを読み込みます（キャッシュ対応）
 */
const loadTemplates = () => {
  if (!cachedHeaderTemplate) {
    try {
      cachedHeaderTemplate = fs.readFileSync(HEADER_TEMPLATE_PATH, 'utf-8');
    } catch (e) {
      console.error(`[SSG] Header template not found at ${HEADER_TEMPLATE_PATH}`);
      cachedHeaderTemplate = '';
    }
  }
  if (!cachedFooterTemplate) {
    try {
      cachedFooterTemplate = fs.readFileSync(FOOTER_TEMPLATE_PATH, 'utf-8');
    } catch (e) {
      console.error(`[SSG] Footer template not found at ${FOOTER_TEMPLATE_PATH}`);
      cachedFooterTemplate = '';
    }
  }
};

/**
 * Generates the Header HTML with correct paths and active states.
 * @param {string} basePath - Relative path to the root (e.g., "./" or "../")
 * @param {string} currentPath - Current page path for active state determination
 * @returns {string} HTML string for the header
 */
const getHeaderHTML = (basePath, currentPath) => {
  loadTemplates();
  if (!cachedHeaderTemplate) return '';

  const isHome = currentPath === 'index.html' || currentPath === '';
  const isAbout = currentPath === 'about.html';

  const homeLink = basePath === '../' ? '../index.html' : 'index.html';
  const aboutLink = basePath === '../' ? '../about.html' : 'about.html';
  const logoPath = basePath + 'assets/img/logo.svg';

  // プレースホルダーの置換
  return cachedHeaderTemplate
    .replace(/{{HOME_LINK}}/g, homeLink)
    .replace(/{{ABOUT_LINK}}/g, aboutLink)
    .replace(/{{LOGO_PATH}}/g, logoPath)
    .replace(/{{HOME_ACTIVE}}/g, isHome ? ' aria-current="page"' : '')
    .replace(/{{ABOUT_ACTIVE}}/g, isAbout ? ' aria-current="page"' : '');
};

/**
 * Generates the Footer HTML.
 * @param {string} basePath - Relative path to the root
 * @returns {string} HTML string for the footer
 */
const getFooterHTML = (basePath) => {
  loadTemplates();
  if (!cachedFooterTemplate) return '';

  const currentYear = new Date().getFullYear();
  const homeLink = basePath === '../' ? '../index.html' : 'index.html';
  const aboutLink = basePath === '../' ? '../about.html' : 'about.html';
  const privacyLink = basePath === '../' ? '../privacy-policy.html' : 'privacy-policy.html';
  const contactLink = basePath === '../' ? '../contact.html' : 'contact.html';

  // プレースホルダーの置換
  return cachedFooterTemplate
    .replace(/{{HOME_LINK}}/g, homeLink)
    .replace(/{{ABOUT_LINK}}/g, aboutLink)
    .replace(/{{PRIVACY_LINK}}/g, privacyLink)
    .replace(/{{CONTACT_LINK}}/g, contactLink)
    .replace(/{{YEAR}}/g, currentYear);
};

/**
 * Injects Header and Footer into the provided HTML content.
 * @param {string} htmlContent - The original HTML content
 * @param {string} relativeFilePath - Path of the file relative to the project root (e.g., "index.html", "posts/abc.html")
 * @returns {string} The HTML content with injected components
 */
const injectCommonComponents = (htmlContent, relativeFilePath) => {
  // Determine base path based on file depth
  // If file is in root (e.g. "index.html"), depth is 0 -> "./"
  // If file is in posts/ (e.g. "posts/abc.html"), depth is 1 -> "../"
  const depth = relativeFilePath.split('/').length - 1;
  const basePath = depth > 0 ? '../'.repeat(depth) : './';

  // Normalize current path for comparison
  const currentPath = path.basename(relativeFilePath);

  const headerHTML = getHeaderHTML(basePath, currentPath);
  const footerHTML = getFooterHTML(basePath);

  // Remove existing header/footer if any (to avoid duplication on re-runs)
  let newHtml = htmlContent
    .replace(/<header class="site-header">[\s\S]*?<\/header>/, '')
    .replace(/<footer class="site-footer">[\s\S]*?<\/footer>/, '');

  // Inject Header after <body>
  // We look for <body> tag. If it has attributes, we handle that.
  if (newHtml.includes('<body')) {
    newHtml = newHtml.replace(/(<body[^>]*>)/i, `$1\n${headerHTML}`);
  } else {
    // Fallback if no body tag found (unlikely for valid HTML)
    newHtml = headerHTML + newHtml;
  }

  // Inject Footer before </body>
  // We look for components.js script tag to insert before it, or just before </body>
  // Ideally, footer should be at the end of main content or just before scripts.
  // Let's put it before the script tags at the end of body, or just before </body>.
  if (newHtml.includes('</body>')) {
    newHtml = newHtml.replace('</body>', `${footerHTML}\n</body>`);
  } else {
    newHtml = newHtml + footerHTML;
  }

  return newHtml;
};

module.exports = {
  injectCommonComponents
};
