/**
 * @fileoverview Markdown Renderer Service
 * Converts article data (JSON) into a Markdown string with Frontmatter.
 */

const slugify = require('../../lib/slugify');

/**
 * Escapes double quotes in strings for YAML Frontmatter.
 */
const escapeYamlString = (str) => {
    if (!str) return '';
    return str.replace(/"/g, '\\"');
};

/**
 * Converts article data to Markdown format.
 * @param {object} article - The article data object.
 * @param {object} meta - Metadata (date, source, etc.).
 * @param {object} options - Options (image, slug, etc.).
 * @returns {string} The generated Markdown string.
 */
const compileArticleMarkdown = (article, meta, options = {}) => {
    const { date, sourceName, videoTitle, videoUrl } = meta;
    const { slug, image } = options;

    // --- Frontmatter ---
    const frontmatter = [];
    frontmatter.push('---');
    frontmatter.push(`title: "${escapeYamlString(article.title)}"`);
    frontmatter.push(`date: "${date}"`);
    frontmatter.push(`slug: "${slug}"`);
    frontmatter.push(`summary: "${escapeYamlString(article.summary || '')}"`);
    frontmatter.push(`status: "${options.status || 'draft'}"`);

    if (article.tags && Array.isArray(article.tags)) {
        frontmatter.push('tags:');
        article.tags.forEach(tag => {
            if (typeof tag === 'string') {
                frontmatter.push(`  - slug: "${slugify(tag)}"\n    label: "${escapeYamlString(tag)}"`);
            } else {
                frontmatter.push(`  - slug: "${tag.slug}"`);
                frontmatter.push(`    label: "${escapeYamlString(tag.label)}"`);
                if (tag.category) frontmatter.push(`    category: "${escapeYamlString(tag.category)}"`);
                if (tag.style) frontmatter.push(`    style: "${tag.style}"`);
            }
        });
    }

    if (image) {
        frontmatter.push('image:');
        if (image.key) frontmatter.push(`  key: "${image.key}"`);
        frontmatter.push(`  src: "${image.src}"`);
        if (image.alt) frontmatter.push(`  alt: "${escapeYamlString(image.alt)}"`);
        if (image.label) frontmatter.push(`  label: "${escapeYamlString(image.label)}"`);
        if (image.caption) frontmatter.push(`  caption: "${escapeYamlString(image.caption)}"`);
        if (image.category) frontmatter.push(`  category: "${escapeYamlString(image.category)}"`);
    }

    // Add source info to frontmatter if needed, or just keep it in body
    // keeping it simple for now matching current schema

    frontmatter.push('---');
    frontmatter.push('');

    // --- Body Content ---
    const body = [];

    // Intro
    if (article.intro) {
        body.push(article.intro);
        body.push('');
    }

    // Sections
    if (Array.isArray(article.sections)) {
        article.sections.forEach(section => {
            if (section.heading) {
                body.push(`## ${section.heading}`);
                body.push('');
            }

            if (section.overview || section.body) {
                body.push(section.overview || section.body);
                body.push('');
            }

            if (Array.isArray(section.subSections)) {
                section.subSections.forEach(sub => {
                    if (sub.heading) {
                        body.push(`### ${sub.heading}`);
                        body.push('');
                    }
                    if (sub.body || sub.content) {
                        body.push(sub.body || sub.content);
                        body.push('');
                    }
                });
            }
        });
    }

    // Conclusion
    if (article.conclusion) {
        body.push('## まとめ');
        body.push('');
        body.push(article.conclusion);
        body.push('');
    }

    // Source Reference (Optional, but good for attribution)
    if (sourceName || videoTitle) {
        body.push('---');
        body.push('**Source:**');
        if (videoTitle) body.push(`- Video: [${videoTitle}](${videoUrl})`);
        if (sourceName) body.push(`- Channel: ${sourceName}`);
    }

    return frontmatter.join('\n') + '\n' + body.join('\n');
};

module.exports = {
    createMarkdownRenderer: () => ({ compileArticleMarkdown })
};
