const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { createTagMapper } = require('../../automation/generator/services/tagMapper');

// 依存関係の注入
const readJson = (filePath, defaultValue) => {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
        return defaultValue;
    }
};

const tagsConfigPath = path.resolve(__dirname, '../../data/tags.json');
const { mapArticleTags } = createTagMapper({ readJson, tagsConfigPath });

const postsDir = path.resolve(__dirname, '../../content/posts');

async function main() {
    console.log('Starting tag fix process...');

    const files = fs.readdirSync(postsDir).filter(file => file.endsWith('.md'));
    console.log(`Found ${files.length} markdown files.`);

    for (const file of files) {
        const filePath = path.join(postsDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const parsed = matter(content);

        // 既存のタグからラベルを抽出
        const currentTags = parsed.data.tags || [];
        let tagLabels = [];

        if (Array.isArray(currentTags)) {
            tagLabels = currentTags.map(tag => {
                if (typeof tag === 'string') return tag;
                return tag.label; // オブジェクトの場合はlabelを使用
            }).filter(label => label && label !== '下書き' && label !== 'Draft'); // 下書きタグは除外
        }

        if (tagLabels.length === 0) {
            console.log(`Skipping ${file}: No tags found.`);
            continue;
        }

        // 新しいマッパーでタグを再生成
        // これにより、slug, category, style が data/tags.json に基づいて修正される
        const newTags = mapArticleTags(tagLabels);

        // 変更があるか確認（簡易チェック）
        const isChanged = JSON.stringify(currentTags) !== JSON.stringify(newTags);

        if (isChanged) {
            parsed.data.tags = newTags;
            const newContent = matter.stringify(parsed.content, parsed.data);
            fs.writeFileSync(filePath, newContent);
            console.log(`Updated tags for ${file}`);
        } else {
            // console.log(`No changes for ${file}`);
        }
    }

    console.log('Tag fix process completed.');
}

main().catch(console.error);
