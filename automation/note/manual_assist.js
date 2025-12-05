const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const readline = require('readline');
const matter = require('gray-matter');

const POSTS_DIR = path.join(__dirname, '../../content/posts');
const NOTE_URL = 'https://creator.note.com/notes/new';

// Helper: Get latest post
function getLatestPost() {
    const files = fs.readdirSync(POSTS_DIR)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse();

    if (files.length === 0) return null;
    return path.join(POSTS_DIR, files[0]);
}

// Helper: Copy to clipboard (macOS)
function copyToClipboard(text) {
    const proc = spawn('pbcopy');
    proc.stdin.write(text);
    proc.stdin.end();
}

// Helper: Open URL
function openUrl(url) {
    spawn('open', [url]);
}

// Helper: Wait for user input
function promptUser(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => {
        rl.question(query, () => {
            rl.close();
            resolve();
        });
    });
}

// Main Flow
async function main() {
    console.log('\n=== Note Article Posting Assistant ===\n');

    // 0. Environment Check
    if (process.env.CI || process.env.NODE_ENV === 'production') {
        console.error('Error: This script is designed to run in a local environment, not in deployment/CI.');
        process.exit(1);
    }
    if (process.platform !== 'darwin') {
        console.error('Error: This script is designed for macOS (uses pbcopy/open).');
        process.exit(1);
    }

    // 1. Identify Target and Mode
    let targetFile = process.argv[2];
    let mode = 'interactive'; // interactive, init, body

    // Simple arg parsing
    if (process.argv.includes('--step=init')) mode = 'init';
    if (process.argv.includes('--step=body')) mode = 'body';

    if (!targetFile || targetFile.startsWith('--')) {
        targetFile = getLatestPost();
        if (!targetFile) {
            console.error('Error: No Markdown files found in content/posts.');
            process.exit(1);
        }
    } else {
        targetFile = path.resolve(targetFile);
    }

    console.log(`Target: ${path.basename(targetFile)}`);
    console.log(`Mode: ${mode}`);

    // 2. Parse Content
    const rawContent = fs.readFileSync(targetFile, 'utf-8');
    const parsed = matter(rawContent);
    const title = parsed.data.title || 'No Title';
    const body = parsed.content;

    if (mode === 'init') {
        // Step 1: Open Browser and Copy Title
        console.log('Opening Note editor...');
        openUrl(NOTE_URL);

        console.log('Copying TITLE to clipboard...');
        copyToClipboard(title);

        console.log('Done: Browser opened and Title copied.');
        return;
    }

    if (mode === 'body') {
        // Step 2: Copy Body
        console.log('Copying BODY to clipboard...');
        copyToClipboard(body);
        console.log('Done: Body copied.');
        return;
    }

    // Interactive Mode (Legacy automation)
    console.log(`\nArticle Title: "${title}"`);
    console.log(`Body Length: ${body.length} chars`);

    // 3. Open Browser
    console.log('\n[Step 1] Opening Note editor in browser...');
    openUrl(NOTE_URL);
    await new Promise(r => setTimeout(r, 2000)); // Wait a bit for browser to focus

    // 4. Copy Title
    console.log('\n[Step 2] Copying TITLE to clipboard...');
    copyToClipboard(title);
    await promptUser('👉 Title is in clipboard. Paste it into Note, then press ENTER to continue...');

    // 5. Copy Body
    console.log('\n[Step 3] Copying BODY to clipboard...');
    copyToClipboard(body);
    await promptUser('👉 Body is in clipboard. Paste it into the main content area, then press ENTER to finish...');

    console.log('\n✅ Process Complete! Please review and publish manually on Note.');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
