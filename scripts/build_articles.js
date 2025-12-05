const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

const CONTENT_DIR = path.join(__dirname, '../content/posts');
const TEMPLATE_PATH = path.join(__dirname, '../templates/article.html');
const POSTS_JSON_PATH = path.join(__dirname, '../data/posts.json');
const OUTPUT_BASE_DIR = path.join(__dirname, '../posts');

// Ensure directories exist
if (!fs.existsSync(CONTENT_DIR)) {
  console.log('Creating content directory...');
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
}

// Read template
const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

// Read existing posts.json
let postsData = [];
if (fs.existsSync(POSTS_JSON_PATH)) {
  postsData = JSON.parse(fs.readFileSync(POSTS_JSON_PATH, 'utf-8'));
}

// Helper to format date YYYY-MM-DD
function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper to get output path from date and slug
function getOutputPath(dateStr, slug) {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return path.join(OUTPUT_BASE_DIR, String(year), month, `${slug}.html`);
}

// Helper to get URL relative to site root
function getUrl(dateStr, slug) {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `posts/${year}/${month}/${slug}.html`;
}

// Process all MD files
const files = fs.readdirSync(CONTENT_DIR).filter(file => file.endsWith('.md'));

console.log(`Found ${files.length} markdown files.`);

files.forEach(file => {
  const filePath = path.join(CONTENT_DIR, file);
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(fileContent);

  // Validate required metadata
  if (!data.title || !data.date || !data.slug) {
    console.warn(`Skipping ${file}: Missing title, date, or slug.`);
    return;
  }

  // Convert Markdown to HTML
  const htmlContent = marked(content);

  // Generate Tags HTML
  let tagsHtml = '';
  if (data.tags && Array.isArray(data.tags)) {
    tagsHtml = data.tags.map(tag => 
      `<li class="tag" data-tag-slug="${tag.slug}" data-tag-category="${tag.category || 'その他'}" data-tag-style="${tag.style || 'accent-gray'}">${tag.label}</li>`
    ).join('\n          ');
  }

  // Prepare replacements
  const replacements = {
    '{{TITLE}}': data.title,
    '{{DESCRIPTION}}': data.summary || '',
    '{{DATE}}': formatDate(data.date).replace(/-/g, '.'), // YYYY.MM.DD
    '{{PUBLISHED_TIME}}': new Date(data.date).toISOString(),
    '{{HERO_IMAGE_SRC}}': data.image?.src || '',
    '{{HERO_IMAGE_ALT}}': data.image?.alt || '',
    '{{CONTENT}}': htmlContent,
    '{{TAGS_HTML}}': tagsHtml,
    '{{URL}}': getUrl(data.date, data.slug),
    '{{CATEGORY_LABEL}}': data.image?.label || 'Article'
  };

  // Replace placeholders
  let outputHtml = template;
  for (const [key, value] of Object.entries(replacements)) {
    outputHtml = outputHtml.replace(new RegExp(key, 'g'), value);
  }

  // Determine output path
  const outputPath = getOutputPath(data.date, data.slug);
  const outputDir = path.dirname(outputPath);

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write HTML file
  fs.writeFileSync(outputPath, outputHtml);
  console.log(`Generated: ${outputPath}`);

  // Update posts.json data
  const postEntry = {
    title: data.title,
    date: formatDate(data.date),
    summary: data.summary,
    tags: data.tags,
    url: getUrl(data.date, data.slug),
    slug: data.slug,
    publishedAt: new Date(data.date).toISOString(),
    status: data.status || 'draft',
    image: data.image,
    createdAt: new Date().toISOString() // Or keep original if exists
  };

  // Check if post already exists in JSON
  const existingIndex = postsData.findIndex(p => p.slug === data.slug);
  if (existingIndex >= 0) {
    // Update existing
    postsData[existingIndex] = { ...postsData[existingIndex], ...postEntry };
  } else {
    // Add new
    postsData.push(postEntry);
  }
});

// Sort posts by date (descending)
postsData.sort((a, b) => new Date(b.date) - new Date(a.date));

// Write posts.json
fs.writeFileSync(POSTS_JSON_PATH, JSON.stringify(postsData, null, 2));
console.log('Updated data/posts.json');
