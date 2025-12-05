const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
// const glob = require('glob'); // Not used

// Helper to find all HTML files recursively
function findHtmlFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            findHtmlFiles(filePath, fileList);
        } else {
            if (path.extname(file) === '.html') {
                fileList.push(filePath);
            }
        }
    });
    return fileList;
}

const postsDir = path.resolve(__dirname, '../../posts');
const htmlFiles = findHtmlFiles(postsDir);

console.log(`Found ${htmlFiles.length} HTML files.`);

htmlFiles.forEach(filePath => {
    const content = fs.readFileSync(filePath, 'utf8');
    const $ = cheerio.load(content);

    const heroImageContainer = $('.article-hero .article-hero-image-container');
    const articleContent = $('.article-content');

    if (heroImageContainer.length > 0 && articleContent.length > 0) {
        console.log(`Processing: ${path.relative(postsDir, filePath)}`);

        // Get the HTML of the image container
        const imageHtml = $.html(heroImageContainer);

        // Remove from hero
        heroImageContainer.remove();

        // Prepend to article content
        articleContent.prepend(imageHtml);

        // Save file
        fs.writeFileSync(filePath, $.html());
    } else {
        // console.log(`Skipping: ${path.relative(postsDir, filePath)} (No hero image or content container found)`);
    }
});

console.log('Done moving hero images.');
