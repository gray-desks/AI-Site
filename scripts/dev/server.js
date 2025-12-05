const express = require('express');
const path = require('path');
const fs = require('fs');
const matter = require('gray-matter');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Middleware to allow CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Serve static files from the project root
app.use(express.static(path.join(__dirname, '../../')));

// API endpoint to update article status
app.post('/api/update-status', (req, res) => {
    const { slug, status } = req.body;

    if (!slug || !status) {
        return res.status(400).json({ error: 'Slug and status are required' });
    }

    const postsDir = path.join(__dirname, '../../content/posts');

    // Find the markdown file with the matching slug
    let targetFile = null;
    const files = fs.readdirSync(postsDir).filter(file => file.endsWith('.md'));

    for (const file of files) {
        const filePath = path.join(postsDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const parsed = matter(content);

        if (parsed.data.slug === slug) {
            targetFile = filePath;
            break;
        }
    }

    if (!targetFile) {
        return res.status(404).json({ error: 'Article not found' });
    }

    try {
        // Update the status in the markdown file
        const fileContent = fs.readFileSync(targetFile, 'utf8');
        const parsed = matter(fileContent);

        if (parsed.data.status === status) {
            return res.json({ message: 'Status already set', status });
        }

        parsed.data.status = status;
        const newContent = matter.stringify(parsed.content, parsed.data);
        fs.writeFileSync(targetFile, newContent);

        console.log(`Updated status of ${slug} to ${status}`);

        // Rebuild posts
        console.log('Rebuilding posts...');
        exec('npm run build:posts', (error, stdout, stderr) => {
            if (error) {
                console.error(`Build error: ${error}`);
                console.error(`Stderr: ${stderr}`);
                return res.status(500).json({ error: `Build failed: ${stderr || error.message}` });
            }
            console.log(`Build output: ${stdout}`);
            res.json({ message: 'Status updated and site rebuilt', status });
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log('Press Ctrl+C to stop');
});
